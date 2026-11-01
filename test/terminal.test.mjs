import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { MAX_CONCURRENT_JOBS } from '../dist/jobs.js';

let root, project, state, client, transport;
const cwd = 'Project ü 空';
async function connect() {
  client = new Client({ name: 'terminal-tests', version: '1' });
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve('dist/server.js')],
    env: {
      ...process.env,
      WORKBRIDGE_ROOT: root,
      WORKBRIDGE_STATE_DIR: state,
      CONTROL_PLANE_API_KEY: 'fixture-never-forward',
      GIT_CONFIG_COUNT: '0',
    },
    stderr: 'pipe',
  });
  await client.connect(transport);
}
async function call(name, args, error) {
  const result = await client.callTool({ name, arguments: args });
  const data = JSON.parse(result.content[0].text);
  if (error) {
    assert.equal(result.isError, true);
    assert.equal(data.error.code, error);
  } else {
    assert.ok(!result.isError, JSON.stringify(data));
    assert.deepEqual(data, result.structuredContent);
  }
  return data;
}
const run = (id, code, args = [], timeoutSeconds = 10) =>
  call('terminal_run', {
    requestId: id,
    cwd,
    executable: process.execPath,
    args: ['-e', code, ...args],
    timeoutSeconds,
  });
async function ended(id) {
  for (let n = 0; n < 200; n++) {
    const job = await call('command_status', { jobId: id });
    if (job.status !== 'running') return job;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Job did not end: ${id}`);
}
async function outputUntil(id, predicate) {
  for (let n = 0; n < 100; n++) {
    const out = await call('command_output', { jobId: id });
    if (predicate(out.text)) return out.text;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Expected job output: ${id}`);
}
async function gone(pid) {
  for (let n = 0; n < 50; n++) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Command descendant is still alive: ${pid}`);
}
before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'workbridge-terminal-'));
  project = path.join(root, cwd);
  state = path.join(root, 'private-state');
  await mkdir(project);
  await mkdir(state);
  await connect();
});
after(async () => {
  await client?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

test('terminal requires cwd and advertises broad command effects', async () => {
  const { tools } = await client.listTools();
  const terminal = tools.find((t) => t.name === 'terminal_run');
  assert.ok(terminal.annotations.openWorldHint);
  assert.ok(terminal.annotations.destructiveHint);
  assert.ok(terminal.inputSchema.required.includes('cwd'));
  assert.ok(terminal.inputSchema.required.includes('requestId'));
});
test('literal Unicode, empty, quote, trailing-slash and metacharacter arguments survive Windows execution', async () => {
  const args = [
    '',
    'two words',
    '"quotes"',
    'trailing\\',
    'C:\\path with spaces\\',
    '&|<>%^!$() `',
    '中文 ü',
  ];
  await run(
    'literal',
    'console.log(JSON.stringify({cwd:process.cwd(),args:process.argv.slice(1),key:process.env.CONTROL_PLANE_API_KEY??null,git:process.env.GIT_CONFIG_COUNT??null}))',
    args,
  );
  assert.equal((await ended('literal')).status, 'passed');
  const data = JSON.parse((await call('command_output', { jobId: 'literal' })).text);
  assert.deepEqual(data.args, args);
  assert.equal(data.cwd, project);
  assert.equal(data.key, null);
  assert.equal(data.git, null);
});
test('stdout and stderr can be paged separately and the real nonzero exit code is retained', async () => {
  await run(
    'streams',
    'process.stdout.write("stdout αβ");process.stderr.write("stderr γδ");process.exitCode=7',
  );
  const job = await ended('streams');
  assert.equal(job.status, 'failed');
  assert.equal(job.exitCode, 7);
  assert.equal((await call('command_output', { jobId: 'streams', stream: 'stdout' })).text, 'stdout αβ');
  assert.equal((await call('command_output', { jobId: 'streams', stream: 'stderr' })).text, 'stderr γδ');
  const page = await call('command_output', { jobId: 'streams', stream: 'stderr', offset: 2, limit: 3 });
  assert.equal(page.text, 'der');
  assert.equal(page.nextOffset, 5);
});
test('terminal request IDs deduplicate writes and reject changed arguments/timeouts', async () => {
  const code = 'require("node:fs").appendFileSync("once.txt","x")';
  await run('once', code, ['argument-not-echoed']);
  await ended('once');
  assert.equal((await run('once', code, ['argument-not-echoed'])).status, 'passed');
  assert.equal(await readFile(path.join(project, 'once.txt'), 'utf8'), 'x');
  await call(
    'terminal_run',
    {
      requestId: 'once',
      cwd,
      executable: process.execPath,
      args: ['-e', code, 'changed'],
      timeoutSeconds: 10,
    },
    'ID_REUSE',
  );
  await call(
    'terminal_run',
    {
      requestId: 'once',
      cwd,
      executable: process.execPath,
      args: ['-e', code, 'argument-not-echoed'],
      timeoutSeconds: 11,
    },
    'ID_REUSE',
  );
  const record = await readFile(path.join(state, 'jobs/once.json'), 'utf8');
  assert.ok(!record.includes('argument-not-echoed'));
  assert.ok(!record.includes(code));
});
test('missing and invalid executables fail clearly instead of reporting success', async () => {
  const job = await call('terminal_run', {
    cwd,
    executable: 'workbridge-no-such-executable-935729',
    requestId: 'missing',
  });
  assert.equal(job.status, 'failed');
  assert.equal(job.exitCode, null);
  assert.equal(job.errorCode, 'EXECUTABLE_NOT_FOUND');
  await writeFile(path.join(project, 'invalid.exe'), 'not an executable');
  await call('terminal_run', { cwd, executable: path.join(project, 'invalid.exe'), requestId: 'invalid' });
  const failure = await ended('invalid');
  assert.equal(failure.status, 'failed');
  assert.equal(failure.exitCode, null);
  assert.ok(failure.error);
});
test('working directories cannot escape the root, enter protected state, or follow junctions', async () => {
  await call(
    'terminal_run',
    { cwd: '..', executable: process.execPath, requestId: 'outside' },
    'OUTSIDE_ROOT',
  );
  await call(
    'terminal_run',
    { cwd: 'private-state', executable: process.execPath, requestId: 'state' },
    'PROTECTED_PATH',
  );
  const outside = await mkdtemp(path.join(os.tmpdir(), 'workbridge-terminal-outside-'));
  const link = path.join(project, 'link');
  try {
    await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    await call(
      'terminal_run',
      { cwd: `${cwd}/link`, executable: process.execPath, requestId: 'link' },
      'LINK_NOT_ALLOWED',
    );
  } finally {
    await rm(link, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
test('output remains bounded while retaining separate stream lengths', async () => {
  await run('bounded', 'process.stdout.write("x".repeat(1100000))');
  const job = await ended('bounded');
  assert.equal(job.status, 'passed');
  assert.equal(job.outputLength, 1048576);
  assert.ok(job.outputTruncated);
  assert.equal(job.stdoutLength, 1048576);
  assert.equal(job.stderrLength, 0);
  assert.equal(
    (await call('command_output', { jobId: 'bounded', stream: 'stdout', offset: 500000, limit: 40000 })).text
      .length,
    40000,
  );
});
test(
  'timeout and cancellation terminate Windows command descendants',
  { skip: process.platform !== 'win32' },
  async () => {
    const code =
      'const c=require("node:child_process").spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:["ignore","inherit","inherit"]});require("node:fs").writeSync(1,JSON.stringify([process.pid,c.pid])+"\\n");setInterval(()=>{},1000)';
    await run('cancel-tree', code);
    const pids = JSON.parse((await outputUntil('cancel-tree', (text) => text.includes(']'))).trim());
    assert.equal((await call('command_cancel', { jobId: 'cancel-tree' })).status, 'cancelled');
    for (const pid of pids) await gone(pid);
    await run('timeout-tree', code, [], 1);
    const timedPids = JSON.parse((await outputUntil('timeout-tree', (text) => text.includes(']'))).trim());
    assert.equal((await ended('timeout-tree')).status, 'timed_out');
    for (const pid of timedPids) await gone(pid);
  },
);
test(
  'an exited command cannot leave a descendant holding the output pipe open',
  { skip: process.platform !== 'win32' },
  async () => {
    const code =
      'const c=require("node:child_process").spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:["ignore","inherit","inherit"]});require("node:fs").writeSync(1,String(c.pid));process.exit(0)';
    await run('exited-parent', code);
    const job = await ended('exited-parent');
    assert.equal(job.status, 'passed');
    assert.equal(job.exitCode, 0);
    await gone(Number((await call('command_output', { jobId: 'exited-parent' })).text));
  },
);
test(
  'server process death cleans children and persisted request replay stays interrupted',
  { skip: process.platform !== 'win32' },
  async () => {
    const code =
      'require("node:fs").appendFileSync("crash-once.txt","x");const c=require("node:child_process").spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:["ignore","inherit","inherit"]});require("node:fs").writeSync(1,JSON.stringify([process.pid,c.pid]));setInterval(()=>{},1000)';
    await run('server-death', code);
    const pids = JSON.parse((await outputUntil('server-death', (text) => text.includes(']'))).trim());
    process.kill(transport.pid);
    for (const pid of pids) await gone(pid);
    await client.close().catch(() => {});
    await connect();
    assert.equal((await call('command_status', { jobId: 'server-death' })).status, 'interrupted');
    assert.equal((await run('server-death', code)).status, 'interrupted');
    assert.equal(await readFile(path.join(project, 'crash-once.txt'), 'utf8'), 'x');
  },
);
test('legacy output records remain readable without inventing separated streams', async () => {
  await run('legacy-source', 'process.stdout.write("combined only")');
  assert.equal((await ended('legacy-source')).status, 'passed');
  // Passed is published only after the final record is saved; no fixture timing workaround.
  const legacy = JSON.parse(await readFile(path.join(state, 'jobs/legacy-source.json'), 'utf8'));
  assert.equal(legacy.status, 'passed');
  assert.equal(legacy.output, 'combined only');
  // Preserve genuine request/date metadata; only remove fields absent from legacy records.
  legacy.id = 'legacy';
  for (const field of ['mode', 'executable', 'timeoutSeconds', 'stdout', 'stderr']) delete legacy[field];
  await writeFile(path.join(state, 'jobs/legacy.json'), JSON.stringify(legacy));
  assert.equal((await call('command_output', { jobId: 'legacy' })).text, 'combined only');
  await call('command_output', { jobId: 'legacy', stream: 'stdout' }, 'OUTPUT_STREAM_UNAVAILABLE');
});
test('profile and terminal jobs share thirty-six slots, preserve replay, and reuse released capacity', async () => {
  const code = 'console.log("capacity-ready");setInterval(()=>{},1000)';
  assert.equal(MAX_CONCURRENT_JOBS, 36);
  const ids = Array.from({ length: MAX_CONCURRENT_JOBS }, (_, index) => `capacity-${index + 1}`);
  const admitted = [];
  const profilesFile = path.join(state, 'commands.json');
  const previousProfiles = await readFile(profilesFile).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  const terminalArgs = (requestId) => ({
    cwd,
    executable: process.execPath,
    args: ['-e', code],
    timeoutSeconds: 30,
    requestId,
  });
  const profileArgs = (requestId) => ({ project: cwd, command: 'capacity', requestId });
  const seventh = {
    cwd,
    executable: process.execPath,
    args: ['--version'],
    timeoutSeconds: 30,
    requestId: 'capacity-seventh',
  };
  await writeFile(
    profilesFile,
    JSON.stringify({
      projects: {
        [cwd]: {
          capacity: { executable: process.execPath, args: ['-e', code], timeoutSeconds: 30 },
        },
      },
    }),
  );
  try {
    for (let index = 0; index < ids.length; index++) {
      const id = ids[index];
      const job =
        index % 2 === 0
          ? await call('terminal_run', terminalArgs(id))
          : await call('command_run', profileArgs(id));
      admitted.push(job);
      assert.equal(job.status, 'running');
    }
    for (const id of ids) await outputUntil(id, (text) => text.includes('capacity-ready'));
    assert.equal((await call('workspace_info')).limits.commandJobs, MAX_CONCURRENT_JOBS);
    assert.equal((await call('diagnostics')).jobs.runningJobs, MAX_CONCURRENT_JOBS);
    await call('terminal_run', seventh, 'JOB_LIMIT');
    await call('command_run', profileArgs('capacity-profile-overflow'), 'JOB_LIMIT');

    for (let index = 0; index < 2; index++) {
      const replay =
        index === 0
          ? await call('terminal_run', terminalArgs(ids[index]))
          : await call('command_run', profileArgs(ids[index]));
      assert.equal(replay.id, admitted[index].id);
      assert.equal(replay.startedAt, admitted[index].startedAt);
      assert.equal(replay.status, 'running');
    }
    assert.equal((await call('diagnostics')).jobs.runningJobs, MAX_CONCURRENT_JOBS);

    await call('command_cancel', { jobId: ids[0] });
    assert.equal((await ended(ids[0])).status, 'cancelled');
    assert.equal((await call('diagnostics')).jobs.runningJobs, MAX_CONCURRENT_JOBS - 1);
    await call('terminal_run', seventh);
    const completed = await ended(seventh.requestId);
    assert.equal(completed.status, 'passed');
    assert.equal(completed.exitCode, 0);
  } finally {
    for (const job of admitted) await call('command_cancel', { jobId: job.id });
    if (previousProfiles) await writeFile(profilesFile, previousProfiles);
    else await rm(profilesFile, { force: true });
  }
});
test(
  'npm is callable without a shell and arbitrary Windows batch files require an explicit interpreter',
  { skip: process.platform !== 'win32' },
  async () => {
    await call('terminal_run', { requestId: 'npm-version', cwd, executable: 'npm', args: ['--version'] });
    assert.equal((await ended('npm-version')).status, 'passed');
    assert.match((await call('command_output', { jobId: 'npm-version' })).text, /\d+\.\d+\.\d+/);
    await writeFile(path.join(project, 'script.cmd'), '@echo fixture');
    const failure = await call('terminal_run', { requestId: 'batch', cwd, executable: '.\\script.cmd' });
    assert.equal(failure.status, 'failed');
    assert.equal(failure.errorCode, 'SHELL_REQUIRED');
  },
);
test(
  'installed developer CLIs execute through the terminal API',
  { skip: process.platform !== 'win32' },
  async () => {
    for (const executable of ['python', 'dotnet', 'git', 'gh', 'powershell.exe']) {
      const args =
        executable === 'powershell.exe'
          ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', 'Write-Output "PowerShell fixture"']
          : ['--version'];
      const id = 'cli-' + executable.replace(/\W/g, '-');
      await call('terminal_run', { cwd, executable, args, requestId: id, timeoutSeconds: 20 });
      const job = await ended(id);
      assert.equal(job.status, 'passed', `${executable}: ${job.error}`);
      assert.ok((await call('command_output', { jobId: id })).text.trim());
    }
  },
);
