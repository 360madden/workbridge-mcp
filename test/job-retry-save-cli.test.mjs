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
  repo = path.resolve('.'),
  sha = (b) => createHash('sha256').update(b).digest('hex');
let suite,
  sequence = 0;
const fixtures = [];
before(async () => {
  suite = await fs.mkdtemp(path.join(os.tmpdir(), 'wb-retry-save-cli-'));
});
after(async () => {
  await Promise.all(fixtures.map((f) => f.client?.close()));
  assert.ok(suite.startsWith(path.resolve(os.tmpdir()) + path.sep));
  await fs.rm(suite, { recursive: true, force: true });
});
async function connect(f) {
  f.client = new Client({ name: 'retry-save-private-tests', version: '1' });
  await f.client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ['--import', pathToFileURL(f.preload).href, path.join(repo, 'dist/server.js')],
      cwd: repo,
      stderr: 'pipe',
      env: {
        ...process.env,
        WORKBRIDGE_ROOT: f.root,
        WORKBRIDGE_STATE_DIR: f.state,
        WORKBRIDGE_LOCAL_CLI: '1',
      },
    }),
  );
}
async function fixture() {
  const home = path.join(suite, String(sequence++)),
    root = path.join(home, 'Project ü'),
    state = path.join(home, 'State'),
    preload = path.join(home, 'fault.mjs');
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(state);
  // Fault injection exists only in this test's private owner; no runtime hook or production setting.
  await fs.writeFile(
    preload,
    `import fs from 'node:fs/promises';import {existsSync} from 'node:fs';import {syncBuiltinESMExports} from 'node:module';import path from 'node:path';const state=${JSON.stringify(state)};const original=fs.rename;fs.rename=async function(a,b,...rest){if(path.dirname(path.resolve(String(b)))===path.join(state,'jobs')&&existsSync(path.join(state,'deny-publish')))throw Object.assign(new Error('private fixture publication failure'),{code:'EIO'});return original.call(this,a,b,...rest);};syncBuiltinESMExports();`,
  );
  await fs.writeFile(path.join(root, 'keep.txt'), 'staged baseline\n');
  await execute('git', ['init', '--quiet'], { cwd: root, windowsHide: true });
  await execute('git', ['add', '--', 'keep.txt'], { cwd: root, windowsHide: true });
  const index = sha(await fs.readFile(path.join(root, '.git/index')));
  await fs.writeFile(path.join(root, 'keep.txt'), 'unrelated dirty bytes\n');
  const f = { home, root, state, preload, index, n: 0 };
  fixtures.push(f);
  await connect(f);
  return f;
}
const req = (tool, args = {}) => ({ tool, arguments: args });
async function call(f, name, args = {}, code) {
  const raw = await f.client.callTool({ name, arguments: args });
  const data = JSON.parse(raw.content[0].text);
  assert.equal(!!raw.isError, !!code, JSON.stringify(data));
  if (code) assert.equal(data.error.code, code);
  else assert.deepEqual(raw.structuredContent, data);
  return data;
}
async function cli(f, steps, expected = 0) {
  const input = path.join(f.home, `request-${f.n++}.json`);
  await fs.writeFile(input, JSON.stringify(steps));
  let raw;
  try {
    raw = {
      exitCode: 0,
      ...(await execute(
        process.execPath,
        [
          path.join(repo, 'scripts/workbridge-cli.mjs'),
          '--service-state',
          f.state,
          '--root',
          f.root,
          '--input',
          input,
          '--json',
          '--timeout',
          '60',
        ],
        { cwd: repo, windowsHide: true, timeout: 90000, maxBuffer: 8 * 1024 * 1024 },
      )),
    };
  } catch (error) {
    raw = { exitCode: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
  assert.equal(raw.exitCode, expected, JSON.stringify(raw));
  const rows = raw.stdout.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
  if (!expected)
    assert.ok(
      rows.every((row) => row.ok),
      JSON.stringify(rows),
    );
  return rows;
}
async function pending(f, id) {
  for (let n = 0; n < 200; n++) {
    const job = await call(f, 'command_status', { jobId: id });
    if (job.errorCode === 'JOB_RECORD_SAVE_FAILED') return job;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('Retained result was not observed');
}
async function retain(f, id = 'retained', exit = 0) {
  await fs.writeFile(path.join(f.state, 'deny-publish'), 'fixture');
  const args = {
    cwd: '.',
    executable: process.execPath,
    args: [
      '-e',
      `require('fs').appendFileSync('count.txt','1');process.stdout.write('kept stdout');process.stderr.write('kept stderr');process.exitCode=${exit};`,
    ],
    timeoutSeconds: 30,
    requestId: id,
  };
  await call(f, 'terminal_run', args);
  const job = await pending(f, id);
  return { args, job };
}
async function release(f) {
  await fs.rm(path.join(f.state, 'deny-publish'));
}
async function preserved(f, count = '1') {
  assert.equal(sha(await fs.readFile(path.join(f.root, '.git/index'))), f.index);
  assert.equal(await fs.readFile(path.join(f.root, 'keep.txt'), 'utf8'), 'unrelated dirty bytes\n');
  assert.equal(await fs.readFile(path.join(f.root, 'count.txt'), 'utf8'), count);
  await assert.rejects(fs.access(path.join(f.root, 'must-not-run.txt')), (e) => e.code === 'ENOENT');
}
const sentinel = req('write_file', {
  operationId: 'must-not-run',
  path: 'must-not-run.txt',
  content: 'bad',
  expectedHash: null,
});

test('catalog exposes explicit bounded publication recovery with its own mutation schema', async () => {
  const f = await fixture(),
    catalog = await f.client.listTools(),
    tool = catalog.tools.find((t) => t.name === 'command_retry_save');
  assert.ok(tool);
  assert.equal(tool.annotations.readOnlyHint, false);
  assert.equal(tool.annotations.idempotentHint, true);
  assert.equal(tool.annotations.openWorldHint, false);
  assert.deepEqual(tool.inputSchema.required, ['jobId']);
  for (const name of ['schemaVersion', 'publication', 'commandRerun', 'job'])
    assert.ok(tool.outputSchema.properties[name]);
  await call(f, 'command_retry_save', { jobId: 'unknown' }, 'UNKNOWN_JOB');
  const rows = await cli(f, [req('command_retry_save', { jobId: 'unknown' }), sentinel], 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].result.error.code, 'UNKNOWN_JOB');
});

test('CLI saves the stdio-owned retained result; replay and restart preserve exactly one execution', async () => {
  const f = await fixture(),
    { args } = await retain(f),
    owner = (await call(f, 'workspace_info')).localCli.instanceId;
  await release(f);
  const rows = await cli(f, [req('command_retry_save', { jobId: 'retained' })]);
  const result = rows[0].result;
  assert.equal(result.publication, 'saved');
  assert.equal(result.commandRerun, false);
  assert.equal(result.job.status, 'passed');
  assert.equal(result.job.exitCode, 0);
  assert.equal((await call(f, 'workspace_info')).localCli.instanceId, owner);
  assert.equal((await call(f, 'command_retry_save', { jobId: 'retained' })).publication, 'already_saved');
  assert.equal(
    (await call(f, 'command_output', { jobId: 'retained', stream: 'stdout' })).text,
    'kept stdout',
  );
  const saved = await fs.readFile(path.join(f.state, 'jobs/retained.json'));
  await f.client.close();
  await connect(f);
  assert.notEqual((await call(f, 'workspace_info')).localCli.instanceId, owner);
  const after = await cli(f, [req('command_retry_save', { jobId: 'retained' }), req('terminal_run', args)]);
  assert.equal(after[0].result.publication, 'already_saved');
  assert.deepEqual(after[0].result.job, result.job);
  assert.equal(after[1].result.status, 'passed');
  assert.deepEqual(await fs.readFile(path.join(f.state, 'jobs/retained.json')), saved);
  await preserved(f);
});

test('saving a failed child is publication success, never a claim that its exit code passed', async () => {
  const f = await fixture();
  await retain(f, 'retained', 7);
  await release(f);
  const result = (await cli(f, [req('command_retry_save', { jobId: 'retained' })]))[0].result;
  assert.equal(result.publication, 'saved');
  assert.equal(result.job.status, 'failed');
  assert.equal(result.job.exitCode, 7);
  const waited = await cli(f, [{ waitForJob: 'retained' }, sentinel], 1);
  assert.equal(waited.length, 1);
  assert.equal(waited[0].ok, false);
  assert.equal(
    (await call(f, 'command_output', { jobId: 'retained', stream: 'stderr' })).text,
    'kept stderr',
  );
  await preserved(f);
});

test('failed publication recovery stops CLI batches, keeps output, and allows explicit later retry', async () => {
  const f = await fixture();
  await retain(f);
  const file = path.join(f.state, 'jobs/retained.json'),
    bytes = await fs.readFile(file);
  const direct = await call(f, 'command_retry_save', { jobId: 'retained' }, 'JOB_RECORD_SAVE_FAILED');
  const rows = await cli(f, [req('command_retry_save', { jobId: 'retained' }), sentinel], 1);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].result, direct);
  assert.deepEqual(await fs.readFile(file), bytes);
  assert.equal(
    (await call(f, 'command_output', { jobId: 'retained', stream: 'stdout' })).text,
    'kept stdout',
  );
  await release(f);
  assert.equal((await call(f, 'command_retry_save', { jobId: 'retained' })).job.status, 'passed');
  await preserved(f);
});

test('changed saved bytes cause the same conflict through MCP and CLI without overwriting them', async () => {
  const f = await fixture();
  await retain(f);
  await release(f);
  const file = path.join(f.state, 'jobs/retained.json'),
    original = await fs.readFile(file);
  await fs.writeFile(file, JSON.stringify({ ...JSON.parse(original), extra: 'later edit' }));
  const newer = await fs.readFile(file);
  const direct = await call(f, 'command_retry_save', { jobId: 'retained' }, 'JOB_SAVE_CONFLICT'),
    rows = await cli(f, [req('command_retry_save', { jobId: 'retained' }), sentinel], 1);
  assert.deepEqual(rows[0].result, direct);
  assert.equal(rows.length, 1);
  assert.deepEqual(await fs.readFile(file), newer);
  assert.equal((await call(f, 'command_status', { jobId: 'retained' })).errorCode, 'JOB_RECORD_SAVE_FAILED');
  await preserved(f);
});

test('concurrent stdio and shared CLI recovery use one owner and one saved result', async () => {
  const f = await fixture();
  await retain(f);
  await release(f);
  const results = await Promise.all([
    call(f, 'command_retry_save', { jobId: 'retained' }),
    cli(f, [req('command_retry_save', { jobId: 'retained' })]).then((rows) => rows[0].result),
  ]);
  assert.equal(results.filter((r) => r.publication === 'saved').length, 1);
  assert.equal(results.filter((r) => r.publication === 'already_saved').length, 1);
  assert.deepEqual(results[0].job, results[1].job);
  await preserved(f);
});

test('a workflow reconciles repaired publication without a new attempt or another command execution', async () => {
  const f = await fixture();
  await fs.writeFile(path.join(f.root, 'target.txt'), 'before\n');
  const patch = await call(f, 'patch_apply', {
    operationId: 'patch',
    files: [
      {
        path: 'target.txt',
        expectedHash: sha('before\n'),
        patch: '--- a/target.txt\n+++ b/target.txt\n@@ -1 +1 @@\n-before\n+after\n',
      },
    ],
  });
  assert.equal(patch.state, 'applied');
  await call(f, 'workflow_create', {
    workflowId: 'wf',
    title: 'Publication recovery check',
    project: '.',
    patchOperationId: 'patch',
    checks: [
      {
        name: 'once',
        kind: 'terminal',
        executable: process.execPath,
        args: ['-e', "require('fs').appendFileSync('count.txt','1');console.log('check once')"],
        timeoutSeconds: 30,
      },
    ],
  });
  await fs.writeFile(path.join(f.state, 'deny-publish'), 'fixture');
  const begun = await call(f, 'workflow_resume', { workflowId: 'wf' }),
    id = begun.steps[0].job.id;
  await pending(f, id);
  assert.equal((await call(f, 'workflow_status', { workflowId: 'wf' })).state, 'blocked');
  await release(f);
  await cli(f, [req('command_retry_save', { jobId: id })]);
  const done = await call(f, 'workflow_resume', { workflowId: 'wf' });
  assert.equal(done.state, 'ready_for_review');
  assert.equal(done.steps[0].attempts.length, 1);
  assert.equal(done.steps[0].job.id, id);
  await preserved(f);
  await call(f, 'patch_undo', { operationId: 'patch' });
  assert.equal(await fs.readFile(path.join(f.root, 'target.txt'), 'utf8'), 'before\n');
});

test('lost owner memory is an explicit refusal after private restart, with no invented final result', async () => {
  const f = await fixture();
  await retain(f);
  await f.client.close();
  await release(f);
  await connect(f);
  const bytes = await fs.readFile(path.join(f.state, 'jobs/retained.json'));
  const rows = await cli(f, [req('command_retry_save', { jobId: 'retained' }), sentinel], 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].result.error.code, 'JOB_RESULT_UNAVAILABLE');
  assert.equal((await call(f, 'command_status', { jobId: 'retained' })).status, 'interrupted');
  assert.deepEqual(await fs.readFile(path.join(f.state, 'jobs/retained.json')), bytes);
  await preserved(f);
});
