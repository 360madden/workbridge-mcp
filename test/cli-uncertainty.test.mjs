import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
const execute = promisify(execFile),
  repo = path.resolve('.');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
let suite,
  sequence = 0;
const fixtures = [];
before(async () => {
  suite = await fs.mkdtemp(path.join(os.tmpdir(), 'wb-cli-uncertainty-'));
});
after(async () => {
  await Promise.all(fixtures.map((f) => f.client?.close()));
  assert.ok(suite.startsWith(path.resolve(os.tmpdir()) + path.sep));
  await fs.rm(suite, { recursive: true, force: true });
});
async function fixture() {
  const home = path.join(suite, String(sequence++)),
    root = path.join(home, 'Workspace ü'),
    state = path.join(home, 'State');
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(state);
  const client = new Client({ name: 'uncertainty-fixture', version: '1' });
  const f = { home, root, state, client, sequence: 0 };
  fixtures.push(f);
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.join(repo, 'dist/server.js')],
      cwd: repo,
      stderr: 'pipe',
      env: { ...process.env, WORKBRIDGE_ROOT: root, WORKBRIDGE_STATE_DIR: state, WORKBRIDGE_LOCAL_CLI: '1' },
    }),
  );
  return f;
}
async function call(f, tool, arguments_ = {}) {
  const raw = await f.client.callTool({ name: tool, arguments: arguments_ });
  assert.equal(Boolean(raw.isError), false, JSON.stringify(raw));
  return raw.structuredContent ?? JSON.parse(raw.content[0].text);
}
async function preload(f, tool, phase, effect = 'deadline') {
  const script = path.join(f.home, `preload-${f.sequence++}.mjs`),
    marker = script + '.json';
  await fs.writeFile(
    script,
    `
import { Client } from ${JSON.stringify(import.meta.resolve('@modelcontextprotocol/client'))};
import fs from 'node:fs/promises';
const original = Client.prototype.callTool;
let held = false;
Client.prototype.callTool = async function(request, options, ...rest) {
  if (held || request.name !== ${JSON.stringify(tool)}) return original.call(this, request, options, ...rest);
  held = true;
  options.signal.throwIfAborted();
  const response = ${JSON.stringify(phase)} === 'after' ? await original.call(this, request, options, ...rest) : null;
  await fs.writeFile(${JSON.stringify(marker)}, JSON.stringify({ phase: ${JSON.stringify(phase)}, response }), { flag: 'wx' });
  if (${JSON.stringify(effect)} === 'disconnect') throw new Error('PRIVATE_RESPONSE_LOST');
  if (${JSON.stringify(effect)} === 'interrupt') process.emit('SIGINT');
  await new Promise((resolve, reject) => {
    if (options.signal.aborted) return reject(options.signal.reason);
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  });
};
`,
    { flag: 'wx' },
  );
  return { script: pathToFileURL(script).href, marker, phase };
}
async function cli(f, requests, { gate, exit = 0, timeout = 4, root = f.root } = {}) {
  const input = path.join(f.home, `input-${f.sequence++}.json`);
  await fs.writeFile(input, JSON.stringify(requests));
  let raw;
  try {
    raw = {
      exit: 0,
      ...(await execute(
        process.execPath,
        [
          ...(gate ? ['--import', gate.script] : []),
          path.join(repo, 'scripts/workbridge-cli.mjs'),
          '--service-state',
          f.state,
          '--root',
          root,
          '--input',
          input,
          '--timeout',
          String(timeout),
          '--json',
        ],
        { cwd: repo, windowsHide: true, timeout: (timeout + 15) * 1000, maxBuffer: 8 * 1024 * 1024 },
      )),
    };
  } catch (error) {
    raw = { exit: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
  assert.equal(raw.exit, exit, JSON.stringify(raw));
  const rows = raw.stdout.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
  if (!exit)
    assert.ok(
      rows.every((row) => row.ok),
      JSON.stringify(rows),
    );
  if (gate) assert.equal(JSON.parse(await fs.readFile(gate.marker, 'utf8')).phase, gate.phase);
  return rows;
}
const request = (tool, arguments_ = {}) => ({ tool, arguments: arguments_ });
const sentinel = request('write_file', {
  operationId: 'sentinel',
  path: 'must-not-run.txt',
  content: 'bad',
  expectedHash: null,
});
async function absent(f) {
  await assert.rejects(fs.access(path.join(f.root, 'must-not-run.txt')), (error) => error.code === 'ENOENT');
}
async function wait(f, jobId) {
  for (let i = 0; i < 200; i++) {
    const result = await call(f, 'command_status', { jobId });
    if (result.status !== 'running' && result.completionPending !== true) return result;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail('Private job did not complete.');
}
function jobDefinition() {
  return {
    cwd: '.',
    executable: process.execPath,
    args: ['-e', "require('fs').appendFileSync('count.txt','X');console.log('original')"],
    timeoutSeconds: 20,
    requestId: 'original-job',
  };
}

test(
  'deadline after accepted job preserves its request ID and read-only inspection without replay',
  { timeout: 20000 },
  async () => {
    const f = await fixture(),
      gate = await preload(f, 'terminal_run', 'after');
    const owner = (await call(f, 'workspace_info')).localCli.instanceId;
    const rows = await cli(
      f,
      [request('workspace_info'), request('terminal_run', jobDefinition()), sentinel],
      { gate, exit: 124 },
    );
    assert.equal(rows.length, 2);
    assert.equal(rows[0].ok, true);
    const error = rows[1].error;
    assert.equal(error.code, 'DEADLINE');
    assert.equal(error.retryAttempted, false);
    assert.deepEqual(error.requestContext, {
      index: 1,
      tool: 'terminal_run',
      requestId: 'original-job',
      inspection: request('command_status', { jobId: 'original-job' }),
    });
    assert.equal((await wait(f, 'original-job')).exitCode, 0);
    const before = await fs.readFile(path.join(f.state, 'jobs/original-job.json'));
    assert.equal((await call(f, 'terminal_run', jobDefinition())).status, 'passed');
    assert.deepEqual(await fs.readFile(path.join(f.state, 'jobs/original-job.json')), before);
    assert.equal(await fs.readFile(path.join(f.root, 'count.txt'), 'utf8'), 'X');
    assert.equal((await call(f, 'workspace_info')).localCli.instanceId, owner);
    await absent(f);
  },
);

test(
  'waitForJob deadline identifies the original ID even before its first status request is submitted',
  { timeout: 20000 },
  async () => {
    const f = await fixture(),
      gate = await preload(f, 'command_status', 'before');
    const rows = await cli(f, [{ waitForJob: 'never-submitted' }, sentinel], { gate, exit: 124 });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].error.code, 'DEADLINE');
    assert.deepEqual(rows[0].error.requestContext, {
      index: 0,
      tool: 'waitForJob',
      jobId: 'never-submitted',
      inspection: request('command_status', { jobId: 'never-submitted' }),
    });
    assert.equal(JSON.parse(await fs.readFile(gate.marker, 'utf8')).response, null);
    await assert.rejects(
      fs.access(path.join(f.state, 'jobs/never-submitted.json')),
      (error) => error.code === 'ENOENT',
    );
    await absent(f);
  },
);

for (const [tool, identity, inspection] of [
  [
    'write_file',
    { operationId: 'write-original' },
    request('change_status', { operationId: 'write-original' }),
  ],
  [
    'patch_apply',
    { operationId: 'patch-original' },
    request('patch_status', { operationId: 'patch-original' }),
  ],
  [
    'workflow_resume',
    { workflowId: 'workflow-original', retryJobId: 'old-attempt' },
    request('workflow_status', { workflowId: 'workflow-original' }),
  ],
])
  test(
    tool + ' transport failure includes only bounded identifiers, not arguments or contents',
    { timeout: 15000 },
    async () => {
      const f = await fixture(),
        gate = await preload(f, tool, 'before', 'disconnect');
      const rows = await cli(
        f,
        [
          request(tool, {
            ...identity,
            content: 'SECRET_NOT_FOR_CONTEXT',
            path: 'private-name.txt',
            args: ['PRIVATE_ARG'],
          }),
          sentinel,
        ],
        { gate, exit: 1 },
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].error.code, 'MCP_ERROR');
      assert.deepEqual(rows[0].error.requestContext, { index: 0, tool, ...identity, inspection });
      assert.doesNotMatch(JSON.stringify(rows[0].error.requestContext), /SECRET|private-name|PRIVATE_ARG/);
      await absent(f);
    },
  );

test(
  'runWorkflow deadline retains legacy workflowId and adds indexed inspection context',
  { timeout: 20000 },
  async () => {
    const f = await fixture(),
      gate = await preload(f, 'workflow_resume', 'before');
    const rows = await cli(f, [{ runWorkflow: 'known-workflow' }, sentinel], { gate, exit: 124 });
    assert.equal(rows[0].error.workflowId, 'known-workflow');
    assert.deepEqual(rows[0].error.requestContext, {
      index: 0,
      tool: 'runWorkflow',
      workflowId: 'known-workflow',
      inspection: request('workflow_status', { workflowId: 'known-workflow' }),
    });
    await absent(f);
  },
);

test(
  'caller interruption carries the same indexed identifier without running the request',
  { timeout: 15000 },
  async () => {
    const f = await fixture(),
      gate = await preload(f, 'terminal_run', 'before', 'interrupt');
    const rows = await cli(f, [request('terminal_run', jobDefinition()), sentinel], { gate, exit: 130 });
    assert.equal(rows[0].error.code, 'INTERRUPTED');
    assert.equal(rows[0].error.requestContext.requestId, 'original-job');
    await assert.rejects(fs.access(path.join(f.root, 'count.txt')), (error) => error.code === 'ENOENT');
    await absent(f);
  },
);

test('setup failure does not attribute an unstarted request or invent its identity', async () => {
  const f = await fixture();
  const rows = await cli(f, [request('terminal_run', jobDefinition())], { root: f.home, exit: 2 });
  assert.equal(rows[0].error.code, 'ROOT_MISMATCH');
  assert.equal(Object.hasOwn(rows[0].error, 'requestContext'), false);
  await assert.rejects(fs.access(path.join(f.root, 'count.txt')), (error) => error.code === 'ENOENT');
});

test('ordinary tool errors retain their established envelope and stop later writes', async () => {
  const f = await fixture();
  const rows = await cli(f, [request('command_status', { jobId: 'missing' }), sentinel], { exit: 1 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].index, 0);
  assert.equal(rows[0].tool, 'command_status');
  assert.equal(rows[0].result.error.code, 'UNKNOWN_JOB');
  assert.equal(rows[0].error, undefined);
  await absent(f);
});

test('lost write response reports the actual operation ID and preserves idempotent inspection', async () => {
  const f = await fixture(),
    gate = await preload(f, 'write_file', 'after', 'disconnect');
  const definition = {
    operationId: 'accepted-write',
    path: 'target.txt',
    content: 'one write\n',
    expectedHash: null,
  };
  const rows = await cli(f, [request('write_file', definition), sentinel], { gate, exit: 1 });
  assert.equal(rows[0].error.requestContext.operationId, definition.operationId);
  const status = await call(
    f,
    rows[0].error.requestContext.inspection.tool,
    rows[0].error.requestContext.inspection.arguments,
  );
  assert.equal(status.operationId, definition.operationId);
  assert.equal(status.state, 'applied');
  const before = sha(await fs.readFile(path.join(f.root, 'target.txt')));
  assert.equal((await call(f, 'write_file', definition)).replayed, true);
  assert.equal(sha(await fs.readFile(path.join(f.root, 'target.txt'))), before);
  await absent(f);
});

for (const invalid of ['../not-an-id', 'x'.repeat(101), 42])
  test('invalid identifiers are omitted: ' + typeof invalid + ':' + String(invalid).length, async () => {
    const f = await fixture(),
      gate = await preload(f, 'terminal_run', 'before', 'disconnect');
    const rows = await cli(
      f,
      [request('terminal_run', { requestId: invalid, args: ['PRIVATE_PAYLOAD'], cwd: 'secret' }), sentinel],
      { gate, exit: 1 },
    );
    assert.deepEqual(rows[0].error.requestContext, { index: 0, tool: 'terminal_run' });
    await absent(f);
  });
for (const tool of ['toString', 'x'.repeat(200)])
  test(
    'unknown tool retains bounded name but does not infer operation identity: ' + tool.length,
    async () => {
      const f = await fixture(),
        gate = await preload(f, tool, 'before', 'disconnect');
      const rows = await cli(
        f,
        [request(tool, { requestId: 'not-trusted', operationId: 'not-trusted', path: 'PRIVATE' }), sentinel],
        { gate, exit: 1 },
      );
      assert.deepEqual(rows[0].error.requestContext, {
        index: 0,
        tool: tool.slice(0, 100),
        ...(tool.length > 100 && { toolTruncated: true }),
      });
      assert.ok(JSON.stringify(rows[0].error.requestContext).length < 200);
      await absent(f);
    },
  );
