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
const run = promisify(execFile),
  repo = path.resolve('.'),
  sha = (b) => createHash('sha256').update(b).digest('hex');
let suite,
  sequence = 0;
const fixtures = [];
before(async () => {
  suite = await fs.mkdtemp(path.join(os.tmpdir(), 'wb-result-cli-'));
});
after(async () => {
  await Promise.all(fixtures.map((f) => f.client?.close()));
  assert.ok(suite.startsWith(path.resolve(os.tmpdir()) + path.sep));
  await fs.rm(suite, { recursive: true, force: true });
});
async function connect(f) {
  f.client = new Client({ name: 'result-fixture', version: '1' });
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
async function fixture(mode = 'none') {
  const home = path.join(suite, String(sequence++)),
    root = path.join(home, 'Project ü'),
    state = path.join(home, 'State'),
    preload = path.join(home, 'fault.mjs');
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(state);
  await fs.writeFile(path.join(state, 'mode.txt'), mode);
  await fs.writeFile(
    preload,
    `import cp from 'node:child_process';import s from 'node:fs';import fs from 'node:fs/promises';import path from 'node:path';import {syncBuiltinESMExports} from 'node:module';const state=${JSON.stringify(state)},file=path.join(state,'jobs/job.result.json'),spawn=cp.spawn,rename=fs.rename;cp.spawn=function(...args){const c=spawn.apply(this,args);if(!String(args[0]).endsWith('command-host.exe')&&!args[1]?.some(x=>String(x).endsWith('command-worker.js')))return c;const emit=c.emit;c.emit=function(event,...rest){if(event==='close'&&s.existsSync(file)){const mode=s.readFileSync(path.join(state,'mode.txt'),'utf8');const original=JSON.parse(s.readFileSync(file,'utf8'));s.writeFileSync(path.join(state,'original.json'),JSON.stringify(original));if(mode==='missing')s.unlinkSync(file);else if(mode!=='none'){const r={...original,exitCode:0};if(mode==='job')r.jobId='foreign-job';if(mode==='invocation')r.invocationId='11111111-1111-4111-8111-111111111111';if(mode==='oversized')r.padding='x'.repeat(8192);s.writeFileSync(file,JSON.stringify(r));}}return emit.call(this,event,...rest);};return c;};fs.rename=async function(a,b,...rest){if(path.resolve(String(b))===path.join(state,'jobs/job.json')&&s.existsSync(path.join(state,'deny-save')))throw Object.assign(new Error('private save failure'),{code:'EIO'});return rename.call(this,a,b,...rest);};syncBuiltinESMExports();`,
  );
  await fs.writeFile(path.join(root, 'keep.txt'), 'staged\n');
  await run('git', ['init', '--quiet'], { cwd: root, windowsHide: true });
  await run('git', ['add', '--', 'keep.txt'], { cwd: root, windowsHide: true });
  const index = sha(await fs.readFile(path.join(root, '.git/index')));
  await fs.writeFile(path.join(root, 'keep.txt'), 'unrelated dirty\n');
  const f = { home, root, state, preload, index, n: 0 };
  fixtures.push(f);
  await connect(f);
  return f;
}
async function call(f, name, args = {}) {
  const raw = await f.client.callTool({ name, arguments: args });
  assert.equal(!!raw.isError, false, JSON.stringify(raw));
  const value = JSON.parse(raw.content[0].text);
  assert.deepEqual(value, raw.structuredContent);
  return value;
}
const req = (tool, args = {}) => ({ tool, arguments: args });
const sentinel = req('write_file', {
  operationId: 'must-not-run',
  path: 'must-not-run.txt',
  content: 'bad',
  expectedHash: null,
});
function definition(f) {
  return {
    cwd: '.',
    executable: process.execPath,
    args: [
      '-e',
      "require('fs').appendFileSync('count.txt','1');process.stdout.write('original failure');process.exitCode=7",
    ],
    timeoutSeconds: 30,
    requestId: 'job',
  };
}
async function cli(f, steps, expected = 0) {
  const input = path.join(f.home, 'requests-' + f.n++ + '.json');
  await fs.writeFile(input, JSON.stringify(steps));
  let raw;
  try {
    raw = {
      exitCode: 0,
      ...(await run(
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
  } catch (e) {
    raw = { exitCode: e.code, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
  assert.equal(raw.exitCode, expected, JSON.stringify(raw));
  const rows = raw.stdout.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
  if (!expected)
    assert.ok(
      rows.every((r) => r.ok),
      JSON.stringify(rows),
    );
  return rows;
}
async function preserved(f, count = '1') {
  assert.equal(sha(await fs.readFile(path.join(f.root, '.git/index'))), f.index);
  assert.equal(await fs.readFile(path.join(f.root, 'keep.txt'), 'utf8'), 'unrelated dirty\n');
  await assert.rejects(fs.access(path.join(f.root, 'must-not-run.txt')), (e) => e.code === 'ENOENT');
  if (count !== null) assert.equal(await fs.readFile(path.join(f.root, 'count.txt'), 'utf8'), count);
  else await assert.rejects(fs.access(path.join(f.root, 'count.txt')), (e) => e.code === 'ENOENT');
}

for (const mode of ['job', 'invocation', 'oversized', 'missing'])
  test(
    mode + ' result evidence fails through real MCP/CLI, stops the batch, and survives restart',
    async () => {
      const f = await fixture(mode),
        def = definition(f);
      await call(f, 'terminal_run', def);
      const rows = await cli(f, [{ waitForJob: 'job' }, sentinel], 1);
      assert.equal(rows.length, 1);
      const status = await call(f, 'command_status', { jobId: 'job' });
      assert.equal(status.status, 'failed');
      assert.equal(status.exitCode, null);
      assert.equal(
        status.errorCode,
        mode === 'missing' ? 'COMMAND_RESULT_MISSING' : 'COMMAND_RESULT_INVALID',
      );
      assert.equal(JSON.parse(await fs.readFile(path.join(f.state, 'original.json'), 'utf8')).exitCode, 7);
      const out = await call(f, 'command_output', { jobId: 'job' });
      assert.equal(out.text, 'original failure');
      const saved = await fs.readFile(path.join(f.state, 'jobs/job.json'));
      assert.deepEqual((await cli(f, [req('terminal_run', def)]))[0].result, status);
      await preserved(f);
      await f.client.close();
      await connect(f);
      assert.deepEqual(await call(f, 'command_status', { jobId: 'job' }), status);
      assert.deepEqual(await call(f, 'terminal_run', def), status);
      assert.deepEqual(await fs.readFile(path.join(f.state, 'jobs/job.json')), saved);
      await preserved(f);
    },
  );

test('invalid result plus failed save recovers the original failure across clients without a second execution', async () => {
  const f = await fixture('invocation'),
    def = definition(f);
  await fs.writeFile(path.join(f.state, 'deny-save'), 'private');
  await call(f, 'terminal_run', def);
  await cli(f, [{ waitForJob: 'job' }, sentinel], 1);
  const status = await call(f, 'command_status', { jobId: 'job' });
  assert.equal(status.errorCode, 'JOB_RECORD_SAVE_FAILED');
  assert.equal(status.exitCode, null);
  assert.equal((await call(f, 'diagnostics')).jobs.capacity.retainedResults, 1);
  await fs.unlink(path.join(f.state, 'deny-save'));
  const rows = await cli(f, [
    req('command_retry_save', { jobId: 'job' }),
    req('command_status', { jobId: 'job' }),
    req('diagnostics'),
  ]);
  assert.equal(rows[0].result.publication, 'saved');
  assert.equal(rows[0].result.commandRerun, false);
  assert.equal(rows[1].result.errorCode, 'COMMAND_RESULT_INVALID');
  assert.equal(rows[1].result.exitCode, null);
  assert.equal(rows[2].result.jobs.capacity.occupied, 0);
  assert.equal((await call(f, 'command_retry_save', { jobId: 'job' })).publication, 'already_saved');
  await preserved(f);
});

test('ordinary failed child preserves true exit 7 rather than the native host exit', async () => {
  const f = await fixture(),
    def = definition(f);
  await call(f, 'terminal_run', def);
  await cli(f, [{ waitForJob: 'job' }, sentinel], 1);
  const s = await call(f, 'command_status', { jobId: 'job' });
  assert.equal(s.status, 'failed');
  assert.equal(s.exitCode, 7);
  assert.equal(s.errorCode, undefined);
  assert.deepEqual((await cli(f, [req('terminal_run', def)]))[0].result, s);
  await preserved(f);
});

test('pre-existing unbound result refuses launch through MCP and CLI without overwriting it', async () => {
  const f = await fixture();
  await fs.mkdir(path.join(f.state, 'jobs'));
  const file = path.join(f.state, 'jobs/job.result.json'),
    bytes = '{"exitCode":0,"timedOut":false}';
  await fs.writeFile(file, bytes);
  const s = await call(f, 'terminal_run', definition(f));
  assert.equal(s.errorCode, 'COMMAND_RESULT_EXISTS');
  assert.equal(s.exitCode, null);
  await cli(f, [{ waitForJob: 'job' }, sentinel], 1);
  assert.equal(await fs.readFile(file, 'utf8'), bytes);
  await preserved(f, null);
});
