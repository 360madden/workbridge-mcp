import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, lstat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const repo = path.resolve('.');
const cli = path.join(repo, 'scripts', 'workbridge-cli.mjs');
const server = path.join(repo, 'dist', 'server.js');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const execFileAsync = promisify(execFile);

let fixture;
let root;
let state;
let project;
let owner;

async function startOwner() {
  const client = new Client({ name: 'service-cli-owner-test', version: '1' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [server],
    cwd: repo,
    env: {
      ...process.env,
      WORKBRIDGE_ROOT: root,
      WORKBRIDGE_STATE_DIR: state,
      WORKBRIDGE_LOCAL_CLI: '1',
    },
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', (chunk) => (stderr += chunk));
  try {
    await client.connect(transport);
  } catch (error) {
    error.ownerStderr = stderr;
    throw error;
  }
  return { client, transport, stderr: () => stderr };
}

async function call(client, name, args = {}, expectedError) {
  const response = await client.callTool({ name, arguments: args });
  const text = response.content?.find((item) => item.type === 'text')?.text ?? '';
  const data = JSON.parse(text);
  if (expectedError) {
    assert.equal(response.isError, true, `${name} should fail`);
    assert.equal(data.error.code, expectedError);
  } else {
    assert.ok(!response.isError, `${name}: ${text}`);
    assert.deepEqual(response.structuredContent, data);
  }
  return data;
}

async function inputFile(name, steps) {
  const file = path.join(fixture, `${name}.json`);
  await writeFile(file, JSON.stringify(steps));
  return file;
}

function invokeCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: repo,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (code, signal) => {
      const rows = stdout
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      resolve({ code, signal, stdout, stderr, rows });
    });
  });
}

async function runCli(name, steps, extra = []) {
  const input = await inputFile(name, steps);
  return invokeCli(['--service-state', state, '--input', input, ...extra]);
}

async function ended(id, deadline = 10_000) {
  const expires = Date.now() + deadline;
  while (Date.now() < expires) {
    const job = await call(owner.client, 'command_status', { jobId: id });
    if (job.status !== 'running') return job;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Job ${id} exceeded the test deadline`);
}

async function endpoint() {
  const { connectService } = await import('../dist/local-service.js');
  const connection = await connectService(state);
  await connection.transport.close().catch(() => {});
  return connection.endpoint;
}

function windowsPowerShell() {
  return process.env.WINDIR
    ? path.join(process.env.WINDIR, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe';
}

async function powershellJson(script, environment = {}) {
  const { stdout } = await execFileAsync(
    windowsPowerShell(),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    { windowsHide: true, env: { ...process.env, ...environment }, encoding: 'utf8' },
  );
  return JSON.parse(stdout);
}

async function processInfo(pid) {
  return powershellJson(
    [
      '$item=Get-CimInstance Win32_Process -Filter ("ProcessId=" + $env:WB_TEST_PID)',
      'if (!$item) { throw "Process not found" }',
      '$item | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress',
    ].join(';'),
    { WB_TEST_PID: String(pid) },
  );
}

async function stopVerifiedProcess(pid) {
  await execFileAsync(
    windowsPowerShell(),
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Stop-Process -Id ([int]$env:WB_TEST_PID) -Force -PassThru | Wait-Process',
    ],
    { windowsHide: true, env: { ...process.env, WB_TEST_PID: String(pid) }, encoding: 'utf8' },
  );
}

async function waitForProcessExit(pid, deadline = 10_000) {
  const expires = Date.now() + deadline;
  while (Date.now() < expires) {
    try {
      await processInfo(pid);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Process ${pid} did not exit after its ownership boundary failed.`);
}

before(async () => {
  fixture = await mkdtemp(path.join(os.tmpdir(), 'workbridge-service-cli-'));
  root = path.join(fixture, 'Workspace ü');
  state = path.join(fixture, 'Service state');
  project = path.join(root, 'Project');
  await mkdir(project, { recursive: true });
  await mkdir(state);
  owner = await startOwner();
});

after(async () => {
  await owner?.client.close().catch(() => {});
  const expectedPrefix = path.join(os.tmpdir(), 'workbridge-service-cli-');
  assert.ok(fixture?.startsWith(expectedPrefix), `refusing to remove unexpected fixture: ${fixture}`);
  await rm(fixture, { recursive: true, force: true });
});

test('connected CLI discovers the live catalog and an exact tool schema', async () => {
  const stdioInfo = await call(owner.client, 'workspace_info');
  const connectedInfo = await runCli('shared-workspace-info', [{ tool: 'workspace_info' }]);
  assert.equal(connectedInfo.code, 0, connectedInfo.stdout);
  assert.deepEqual(connectedInfo.rows[0].result, stdioInfo);
  assert.equal(stdioInfo.localCli.enabled, true);
  assert.equal(stdioInfo.localCli.pid, owner.transport.pid);
  assert.ok(stdioInfo.localCli.instanceId);
  assert.ok(!('authorization' in stdioInfo.localCli));
  const all = await invokeCli(['--service-state', state, '--list-tools']);
  assert.equal(all.code, 0, all.stderr);
  assert.equal(all.rows.length, 1);
  assert.equal(all.rows[0].ok, true);
  assert.equal(all.rows[0].discovery, 'tools');
  assert.ok(all.rows[0].tools.length >= 35);
  assert.ok(all.rows[0].tools.some((tool) => tool.name === 'edit_file'));

  const one = await invokeCli(['--service-state', state, '--list-tools', '--tool', 'edit_file']);
  assert.equal(one.code, 0, one.stderr);
  assert.deepEqual(
    one.rows[0].tools.map((tool) => tool.name),
    ['edit_file'],
  );
  assert.equal(one.rows[0].tools[0].inputSchema.type, 'object');
  assert.ok(one.rows[0].tools[0].inputSchema.properties.expectedHash);

  const missing = await invokeCli(['--service-state', state, '--list-tools', '--tool', 'not_a_tool']);
  assert.equal(missing.code, 1);
  assert.equal(missing.rows[0].error.code, 'TOOL_NOT_FOUND');
});

test('CLI jobs belong to the stdio owner and survive CLI disconnect and deadline', async () => {
  const launched = await runCli('launch-owner-job', [
    {
      tool: 'terminal_run',
      arguments: {
        cwd: project,
        executable: process.execPath,
        args: ['-e', 'setTimeout(()=>console.log("owner-finished"),300)'],
        timeoutSeconds: 10,
        requestId: 'service-cli-owner-job',
      },
    },
  ]);
  assert.equal(launched.code, 0, launched.stderr);
  assert.equal(launched.rows[0].result.id, 'service-cli-owner-job');
  const completed = await ended('service-cli-owner-job');
  assert.equal(completed.status, 'passed');
  assert.match(
    (await call(owner.client, 'command_output', { jobId: 'service-cli-owner-job', tailChars: 100 })).text,
    /owner-finished/,
  );

  const timed = await runCli(
    'deadline-does-not-cancel',
    [
      {
        tool: 'terminal_run',
        arguments: {
          cwd: project,
          executable: process.execPath,
          args: ['-e', 'setTimeout(()=>console.log("late-finished"),3500)'],
          timeoutSeconds: 10,
          requestId: 'service-cli-deadline-job',
        },
      },
      { waitForJob: 'service-cli-deadline-job' },
    ],
    ['--timeout', '2'],
  );
  assert.equal(timed.code, 124, timed.stderr);
  assert.equal(timed.rows.at(-1).error.code, 'DEADLINE');
  assert.equal(timed.rows.at(-1).error.retryAttempted, false);
  assert.equal(
    (await call(owner.client, 'command_status', { jobId: 'service-cli-deadline-job' })).status,
    'running',
  );
  assert.equal((await ended('service-cli-deadline-job')).status, 'passed');
});

test('edits, journals, and undo are shared in both directions across CLI invocations', async () => {
  const cliFile = path.join(project, 'cli-to-owner.txt');
  const made = await runCli('cli-write', [
    {
      tool: 'write_file',
      arguments: {
        operationId: 'service-cli-write',
        path: cliFile,
        content: 'from cli\n',
        expectedHash: null,
      },
    },
  ]);
  assert.equal(made.code, 0, made.stderr);
  assert.equal(
    (await call(owner.client, 'change_status', { operationId: 'service-cli-write' })).state,
    'applied',
  );
  assert.equal(await readFile(cliFile, 'utf8'), 'from cli\n');
  await call(owner.client, 'undo_change', { operationId: 'service-cli-write' });
  await assert.rejects(readFile(cliFile), (error) => error.code === 'ENOENT');

  const ownerFile = path.join(project, 'owner-to-cli.txt');
  await call(owner.client, 'write_file', {
    operationId: 'service-owner-write',
    path: ownerFile,
    content: 'from owner\n',
    expectedHash: null,
  });
  const inspectedAndUndone = await runCli('cli-inspect-undo', [
    { tool: 'change_status', arguments: { operationId: 'service-owner-write' } },
    { tool: 'undo_change', arguments: { operationId: 'service-owner-write' } },
  ]);
  assert.equal(inspectedAndUndone.code, 0, inspectedAndUndone.stderr);
  assert.deepEqual(
    inspectedAndUndone.rows.map((row) => row.result.state),
    ['applied', 'undone'],
  );
  await assert.rejects(readFile(ownerFile), (error) => error.code === 'ENOENT');
});

test('operation and request IDs replay across separate CLI processes', async () => {
  const target = path.join(project, 'replay.txt');
  const request = [
    {
      tool: 'write_file',
      arguments: {
        operationId: 'service-replayed-write',
        path: target,
        content: 'once\n',
        expectedHash: null,
      },
    },
  ];
  const first = await runCli('replay-first', request);
  const second = await runCli('replay-second', request);
  assert.equal(first.code, 0, first.stderr);
  assert.equal(second.code, 0, second.stderr);
  assert.equal(first.rows[0].result.replayed, false);
  assert.equal(second.rows[0].result.replayed, true);
  assert.equal(await readFile(target, 'utf8'), 'once\n');

  const jobRequest = [
    {
      tool: 'terminal_run',
      arguments: {
        cwd: project,
        executable: process.execPath,
        args: ['-e', 'console.log("once")'],
        timeoutSeconds: 10,
        requestId: 'service-replayed-job',
      },
    },
  ];
  assert.equal((await runCli('job-replay-first', jobRequest)).code, 0);
  await ended('service-replayed-job');
  const replay = await runCli('job-replay-second', jobRequest);
  assert.equal(replay.code, 0, replay.stderr);
  assert.equal(replay.rows[0].result.id, 'service-replayed-job');
  assert.equal(replay.rows[0].result.status, 'passed');
});

test('simultaneous CLI edits share serialization and stale-hash conflict checks', async () => {
  const target = path.join(project, 'concurrent.txt');
  const original = Buffer.from('value=old\n');
  await writeFile(target, original);
  const make = (id, replacement) => [
    {
      tool: 'edit_file',
      arguments: {
        operationId: id,
        path: target,
        expectedHash: hash(original),
        edits: [{ oldText: 'old', newText: replacement, occurrences: 1 }],
      },
    },
  ];
  const inputA = await inputFile('concurrent-a', make('service-concurrent-a', 'alpha'));
  const inputB = await inputFile('concurrent-b', make('service-concurrent-b', 'beta'));
  const [a, b] = await Promise.all([
    invokeCli(['--service-state', state, '--input', inputA]),
    invokeCli(['--service-state', state, '--input', inputB]),
  ]);
  assert.deepEqual([a.code, b.code].sort(), [0, 1]);
  const failure = [a, b].find((result) => result.code === 1);
  assert.equal(failure.rows[0].result.error.code, 'CONFLICT');
  assert.match(await readFile(target, 'utf8'), /^value=(alpha|beta)\n$/);
});

test('connected setup and tool failures have deterministic exits and never auto-start an owner', async () => {
  const wrongRoot = path.join(fixture, 'Wrong root');
  await mkdir(wrongRoot);
  const rootMismatch = await invokeCli(['--service-state', state, '--root', wrongRoot, '--list-tools']);
  assert.equal(rootMismatch.code, 2);
  assert.equal(rootMismatch.rows[0].error.code, 'ROOT_MISMATCH');

  const toolFailure = await runCli('tool-failure', [
    { tool: 'read_file', arguments: { path: path.join(project, 'absent.txt') } },
  ]);
  assert.equal(toolFailure.code, 1);
  assert.equal(toolFailure.rows[0].result.error.code, 'ENOENT');

  const absentState = path.join(fixture, 'No service here');
  const missing = await invokeCli(['--service-state', absentState, '--list-tools']);
  assert.equal(missing.code, 2);
  assert.equal(missing.rows[0].error.code, 'INVALID_INPUT');
});

test('one service state refuses a second owner', async () => {
  const second = new Client({ name: 'duplicate-service-owner-test', version: '1' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [server],
    cwd: repo,
    env: {
      ...process.env,
      WORKBRIDGE_ROOT: root,
      WORKBRIDGE_STATE_DIR: state,
      WORKBRIDGE_LOCAL_CLI: '1',
    },
    stderr: 'pipe',
  });
  await assert.rejects(second.connect(transport));
  await second.close().catch(() => {});
  assert.equal((await call(owner.client, 'workspace_info')).root.toLowerCase(), root.toLowerCase());
});

test('unauthenticated and malformed local HTTP requests cannot invoke tools', async () => {
  const current = await endpoint();
  const callBody = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'workspace_info', arguments: {} },
  });
  const unauthenticated = await fetch(current.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: callBody,
  });
  assert.equal(unauthenticated.status, 401);
  assert.deepEqual(await unauthenticated.json(), { error: 'unauthorized' });

  const malformed = await fetch(current.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{',
  });
  assert.equal(malformed.status, 401);
  assert.deepEqual(await malformed.json(), { error: 'unauthorized' });

  const browserOrigin = await fetch(current.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1' },
    body: callBody,
  });
  assert.equal(browserOrigin.status, 403);
  assert.deepEqual(await browserOrigin.json(), { error: 'forbidden' });
});

test(
  'authenticated local HTTP requests remain bounded and do not disrupt the owner',
  { timeout: 30_000 },
  async () => {
    const { connectService } = await import('../dist/local-service.js');
    const connection = await connectService(state);
    const oversizedClient = new Client({ name: 'oversized-local-request-test', version: '1' });
    await oversizedClient.connect(connection.transport);
    await assert.rejects(
      oversizedClient.callTool(
        {
          name: 'workspace_info',
          arguments: { padding: 'x'.repeat(33 * 1024 * 1024) },
        },
        { timeout: 20_000 },
      ),
    );
    await oversizedClient.close().catch(() => {});
    assert.equal((await call(owner.client, 'workspace_info')).root.toLowerCase(), root.toLowerCase());
  },
);

test(
  'service descriptor is DPAPI protected at rest with a current-user and SYSTEM-only ACL',
  { skip: process.platform !== 'win32' },
  async () => {
    const ipc = path.join(state, 'ipc');
    const descriptor = path.join(ipc, 'endpoint.dpapi');
    const info = await lstat(descriptor);
    assert.equal(info.isFile(), true);
    assert.equal(info.isSymbolicLink(), false);
    const protectedText = await readFile(descriptor, 'utf8');
    assert.doesNotMatch(protectedText, /Bearer |127\.0\.0\.1|Service state|Workspace ü/);

    const script = [
      '$acl=[IO.Directory]::GetAccessControl($env:WB_TEST_IPC)',
      '$rules=@($acl.GetAccessRules($true,$false,[Security.Principal.SecurityIdentifier]) | ForEach-Object {',
      '  [pscustomobject]@{sid=$_.IdentityReference.Value;rights=$_.FileSystemRights.ToString();type=$_.AccessControlType.ToString()}',
      '})',
      '$current=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
      '[pscustomobject]@{protected=$acl.AreAccessRulesProtected;current=$current;rules=$rules} | ConvertTo-Json -Depth 4 -Compress',
    ].join(';');
    const acl = await powershellJson(script, { WB_TEST_IPC: ipc });
    assert.equal(acl.protected, true);
    assert.deepEqual(acl.rules.map((rule) => rule.sid).sort(), [acl.current, 'S-1-5-18'].sort());
    assert.ok(acl.rules.every((rule) => rule.rights === 'FullControl' && rule.type === 'Allow'));
  },
);

test('owner restart publishes a new instance while durable journal and job status remain available', async () => {
  const before = await endpoint();
  await owner.client.close();
  const stale = await invokeCli(['--service-state', state, '--list-tools']);
  assert.equal(stale.code, 1);
  assert.equal(stale.rows[0].error.code, 'MCP_ERROR');
  owner = await startOwner();
  const afterRestart = await endpoint();
  assert.notEqual(afterRestart.instanceId, before.instanceId);
  assert.equal(afterRestart.root.toLowerCase(), root.toLowerCase());

  assert.equal(
    (await call(owner.client, 'change_status', { operationId: 'service-replayed-write' })).state,
    'applied',
  );
  assert.equal(
    (await call(owner.client, 'command_status', { jobId: 'service-replayed-job' })).status,
    'passed',
  );
  const discovered = await invokeCli(['--service-state', state, '--list-tools', '--tool', 'workspace_info']);
  assert.equal(discovered.code, 0, discovered.stderr);
});

test(
  'guardian loss terminates only its disposable owner and a new owner reacquires the state',
  { skip: process.platform !== 'win32', timeout: 30_000 },
  async () => {
    const current = await endpoint();
    assert.equal(current.state.toLowerCase(), state.toLowerCase());
    assert.equal(current.root.toLowerCase(), root.toLowerCase());
    const guardians = await powershellJson(
      [
        '$items=@(Get-CimInstance Win32_Process -Filter ("ParentProcessId=" + $env:WB_TEST_OWNER_PID) |',
        "Where-Object { $_.CommandLine -like '*Local-Service-Descriptor.ps1*' -and $_.CommandLine -like '*-Action Own*' } |",
        'Select-Object ProcessId,ParentProcessId,Name,CommandLine)',
        ';ConvertTo-Json -InputObject $items -Depth 3 -Compress',
      ].join(' '),
      { WB_TEST_OWNER_PID: String(current.pid) },
    );
    assert.equal(guardians.length, 1);
    const guardian = guardians[0];
    assert.equal(guardian.ParentProcessId, current.pid);
    assert.match(guardian.Name, /^powershell\.exe$/i);
    assert.ok(guardian.CommandLine.toLowerCase().includes(path.join(state, 'ipc').toLowerCase()));

    await stopVerifiedProcess(guardian.ProcessId);
    await waitForProcessExit(current.pid);
    await owner.client.close().catch(() => {});
    const stale = await invokeCli(['--service-state', state, '--list-tools']);
    assert.equal(stale.code, 1);
    owner = await startOwner();
    const replacement = await endpoint();
    assert.notEqual(replacement.instanceId, current.instanceId);
    assert.equal(
      (await call(owner.client, 'change_status', { operationId: 'service-replayed-write' })).state,
      'applied',
    );
  },
);

test(
  'abrupt disposable owner exit releases the guardian lock and permits recovery',
  { skip: process.platform !== 'win32', timeout: 30_000 },
  async () => {
    const current = await endpoint();
    const processRecord = await processInfo(current.pid);
    assert.notEqual(processRecord.ProcessId, process.pid);
    assert.match(processRecord.Name, /^node\.exe$/i);
    assert.ok(processRecord.CommandLine.toLowerCase().includes(server.toLowerCase()));
    assert.equal(current.state.toLowerCase(), state.toLowerCase());
    assert.equal(current.root.toLowerCase(), root.toLowerCase());

    await stopVerifiedProcess(processRecord.ProcessId);
    await owner.client.close().catch(() => {});
    const stale = await invokeCli(['--service-state', state, '--list-tools']);
    assert.equal(stale.code, 1);
    owner = await startOwner();
    const replacement = await endpoint();
    assert.notEqual(replacement.instanceId, current.instanceId);
    assert.equal(
      (await call(owner.client, 'command_status', { jobId: 'service-replayed-job' })).status,
      'passed',
    );
  },
);
