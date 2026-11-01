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
  suite = await fs.mkdtemp(path.join(os.tmpdir(), 'wb-launch-cli-'));
});
after(async () => {
  await Promise.all(fixtures.map((f) => f.client?.close()));
  assert.ok(suite.startsWith(path.resolve(os.tmpdir()) + path.sep));
  await fs.rm(suite, { recursive: true, force: true });
});
async function connect(f) {
  f.client = new Client({ name: 'launch-private-tests', version: '1' });
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
    `import fs from 'node:fs/promises';import {existsSync} from 'node:fs';import {syncBuiltinESMExports} from 'node:module';import path from 'node:path';const state=${JSON.stringify(state)};const original=fs.rename;fs.rename=async function(a,b,...rest){if(path.dirname(path.resolve(String(b)))===path.join(state,'jobs')&&existsSync(path.join(state,'deny-publish')))throw Object.assign(new Error('private fixture publication failure'),{code:'EIO'});return original.call(this,a,b,...rest);};const originalOpen=fs.open;fs.open=async function(a,...r){if(path.resolve(String(a))===path.join(state,'workspace-config.lock')&&existsSync(path.join(state,'deny-setup')))throw Object.assign(new Error('private host setup failure'),{code:'EACCES'});return originalOpen.call(this,a,...r);};syncBuiltinESMExports();`,
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
async function preserved(f) {
  assert.equal(sha(await fs.readFile(path.join(f.root, '.git/index'))), f.index);
  assert.equal(await fs.readFile(path.join(f.root, 'keep.txt'), 'utf8'), 'unrelated dirty bytes\n');
  await assert.rejects(fs.access(path.join(f.root, 'count.txt')), (e) => e.code === 'ENOENT');
  await assert.rejects(fs.access(path.join(f.root, 'must-not-run.txt')), (e) => e.code === 'ENOENT');
}
const sentinel = req('write_file', {
  operationId: 'must-not-run',
  path: 'must-not-run.txt',
  content: 'bad',
  expectedHash: null,
});

const missingArgs = (f, id = 'missing') => ({
  cwd: '.',
  executable: path.join(f.root, 'missing-tool.exe'),
  args: [],
  timeoutSeconds: 30,
  requestId: id,
});
test('missing executable remains a stable failed job through CLI wait, replay and restart', async () => {
  const f = await fixture(),
    args = missingArgs(f);
  const job = await call(f, 'terminal_run', args);
  assert.equal(job.status, 'failed');
  assert.equal(job.errorCode, 'EXECUTABLE_NOT_FOUND');
  assert.equal(job.exitCode, null);
  const before = await fs.readFile(path.join(f.state, 'jobs/missing.json'));
  const rows = await cli(f, [{ waitForJob: 'missing' }, sentinel], 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ok, false);
  assert.deepEqual((await cli(f, [req('terminal_run', args)]))[0].result, job);
  await f.client.close();
  await connect(f);
  assert.deepEqual(await call(f, 'command_status', { jobId: 'missing' }), job);
  assert.deepEqual(await fs.readFile(path.join(f.state, 'jobs/missing.json')), before);
  await preserved(f);
});
for (const kind of ['resolution', 'setup'])
  test(
    kind + ' failure plus save failure can be recovered across clients without any process execution',
    async () => {
      const f = await fixture();
      await fs.writeFile(path.join(f.state, 'deny-publish'), 'fixture');
      if (kind === 'setup') await fs.writeFile(path.join(f.state, 'deny-setup'), 'fixture');
      const args =
        kind === 'resolution'
          ? missingArgs(f)
          : {
              cwd: '.',
              executable: process.execPath,
              args: ['-e', "require('fs').writeFileSync('must-not-run.txt','bad')"],
              timeoutSeconds: 30,
              requestId: 'missing',
            };
      const expected = kind === 'resolution' ? 'EXECUTABLE_NOT_FOUND' : 'COMMAND_SETUP_FAILED';
      const failed = await call(f, 'terminal_run', args);
      assert.equal(failed.errorCode, 'JOB_RECORD_SAVE_FAILED');
      assert.equal(failed.exitCode, null);
      const owner = (await call(f, 'workspace_info')).localCli.instanceId;
      const blocked = await cli(f, [req('command_retry_save', { jobId: 'missing' }), sentinel], 1);
      assert.equal(blocked.length, 1);
      assert.equal(blocked[0].result.error.code, 'JOB_RECORD_SAVE_FAILED');
      await release(f);
      const result = (await cli(f, [req('command_retry_save', { jobId: 'missing' })]))[0].result;
      assert.equal(result.publication, 'saved');
      assert.equal(result.commandRerun, false);
      assert.equal(result.job.status, 'failed');
      assert.equal(result.job.errorCode, expected);
      assert.equal(result.job.exitCode, null);
      assert.equal((await call(f, 'workspace_info')).localCli.instanceId, owner);
      assert.equal((await call(f, 'command_retry_save', { jobId: 'missing' })).publication, 'already_saved');
      assert.deepEqual(await call(f, 'terminal_run', args), result.job);
      const rows = await cli(f, [{ waitForJob: 'missing' }, sentinel], 1);
      assert.equal(rows.length, 1);
      assert.equal((await call(f, 'command_output', { jobId: 'missing' })).text, '');
      await preserved(f);
    },
  );
