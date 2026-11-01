import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
const run = promisify(execFile),
  repo = path.resolve('.'),
  sha = (b) => createHash('sha256').update(b).digest('hex');
let suite,
  sequence = 0;
const fixtures = [];
before(async () => {
  suite = await fs.mkdtemp(path.join(os.tmpdir(), 'wb-publication-cli-'));
});
after(async () => {
  await Promise.all(fixtures.map((f) => f.client?.close()));
  assert.ok(suite.startsWith(path.resolve(os.tmpdir()) + path.sep));
  await fs.rm(suite, { recursive: true, force: true });
});
async function connect(f) {
  f.client = new Client({ name: 'publication-guard-fixture', version: '1' });
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
async function fixture(mode) {
  const home = path.join(suite, String(sequence++)),
    root = path.join(home, 'Project ü'),
    state = path.join(home, 'State'),
    preload = path.join(home, 'fault.mjs');
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(state);
  await fs.writeFile(path.join(state, 'mode.txt'), mode);
  // Intercept the private fixture owner only. No live state or application source is modified.
  await fs.writeFile(
    preload,
    `import fs from 'node:fs/promises';import path from 'node:path';import {Jobs} from ${JSON.stringify(pathToFileURL(path.join(repo, 'dist/jobs.js')).href)};const state=${JSON.stringify(state)},original=Jobs.prototype.save,seen=new Set();Jobs.prototype.save=async function(job,exclusive,...rest){if(exclusive||seen.has(job.id))return original.call(this,job,exclusive,...rest);seen.add(job.id);const mode=await fs.readFile(path.join(state,'mode.txt'),'utf8');if(mode==='none')return original.call(this,job,exclusive,...rest);const file=path.join(state,'jobs',job.id+'.json'),initial=await fs.readFile(file);await fs.writeFile(path.join(state,'initial-'+job.id),initial);const change=async()=>{if(mode==='missing'){await fs.unlink(file);return;}const text=mode==='corrupt'?'{damaged':JSON.stringify({...JSON.parse(initial.toString('utf8')),command:'newer fixture metadata'});await fs.writeFile(file,text);await fs.writeFile(path.join(state,'changed-'+job.id),text);};if(mode==='after'){const result=await original.call(this,job,exclusive,...rest);await change();return result;}await change();return original.call(this,job,exclusive,...rest);};`,
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
async function call(f, name, args = {}, errorCode) {
  const raw = await f.client.callTool({ name, arguments: args }),
    data = JSON.parse(raw.content[0].text);
  assert.equal(!!raw.isError, !!errorCode, JSON.stringify(data));
  if (errorCode) assert.equal(data.error.code, errorCode);
  else assert.deepEqual(data, raw.structuredContent);
  return data;
}
const req = (tool, args = {}) => ({ tool, arguments: args }),
  sentinel = req('write_file', {
    operationId: 'sentinel',
    path: 'must-not-run.txt',
    content: 'bad',
    expectedHash: null,
  });
async function cli(f, steps, exitCode = 0) {
  const file = path.join(f.home, 'requests-' + f.n++ + '.json');
  await fs.writeFile(file, JSON.stringify(steps));
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
          file,
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
  assert.equal(raw.exitCode, exitCode, JSON.stringify(raw));
  const rows = raw.stdout.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
  if (!exitCode) assert.ok(rows.every((r) => r.ok));
  return rows;
}
async function preserve(f, count = '1') {
  assert.equal(sha(await fs.readFile(path.join(f.root, '.git/index'))), f.index);
  assert.equal(await fs.readFile(path.join(f.root, 'keep.txt'), 'utf8'), 'unrelated dirty\n');
  assert.equal(await fs.readFile(path.join(f.root, 'count.txt'), 'utf8'), count);
  await assert.rejects(fs.access(path.join(f.root, 'must-not-run.txt')), (e) => e.code === 'ENOENT');
}
async function restorePrivateIntent(f, id) {
  await fs.writeFile(path.join(f.state, 'mode.txt'), 'none');
  await fs.writeFile(
    path.join(f.state, 'jobs', id + '.json'),
    await fs.readFile(path.join(f.state, 'initial-' + id)),
  );
}
for (const mode of ['changed', 'missing', 'corrupt', 'after'])
  test(
    mode + ' publication conflict retains outcome and recovers across real MCP/CLI without rerunning',
    async () => {
      const f = await fixture(mode),
        definition = {
          cwd: '.',
          executable: process.execPath,
          args: ['-e', "require('fs').appendFileSync('count.txt','1');console.log('kept output')"],
          timeoutSeconds: 30,
          requestId: 'job',
        };
      await call(f, 'terminal_run', definition);
      const waited = await cli(f, [{ waitForJob: 'job' }, sentinel], 1);
      assert.equal(waited.length, 1);
      assert.equal(waited[0].result.errorCode, 'JOB_RECORD_SAVE_FAILED');
      assert.equal(waited[0].result.exitCode, 0);
      assert.equal(waited[0].result.completionPending, false);
      const disk = path.join(f.state, 'jobs/job.json');
      if (mode === 'missing') await assert.rejects(fs.access(disk), (e) => e.code === 'ENOENT');
      else assert.deepEqual(await fs.readFile(disk), await fs.readFile(path.join(f.state, 'changed-job')));
      assert.equal((await call(f, 'command_output', { jobId: 'job' })).text, 'kept output\n');
      assert.equal((await call(f, 'diagnostics')).jobs.capacity.retainedResults, 1);
      assert.equal((await call(f, 'terminal_run', definition)).errorCode, 'JOB_RECORD_SAVE_FAILED');
      const refused = await cli(f, [req('command_retry_save', { jobId: 'job' }), sentinel], 1);
      assert.equal(refused.length, 1);
      assert.equal(
        refused[0].result.error.code,
        mode === 'corrupt' ? 'UNREADABLE_JOB_RECORD' : 'JOB_SAVE_CONFLICT',
      );
      await preserve(f);
      await restorePrivateIntent(f, 'job');
      const recovered = await cli(f, [
        req('command_retry_save', { jobId: 'job' }),
        { waitForJob: 'job' },
        req('diagnostics'),
      ]);
      assert.equal(recovered[0].result.publication, 'saved');
      assert.equal(recovered[0].result.commandRerun, false);
      assert.equal(recovered[0].result.job.status, 'passed');
      assert.equal(recovered[2].result.jobs.capacity.occupied, 0);
      const bytes = await fs.readFile(disk);
      assert.equal((await call(f, 'command_retry_save', { jobId: 'job' })).publication, 'already_saved');
      await f.client.close();
      await connect(f);
      assert.equal((await call(f, 'terminal_run', definition)).status, 'passed');
      assert.deepEqual(await fs.readFile(disk), bytes);
      await preserve(f);
    },
  );
test('workflow blocks a conflicted failed result until recovery, then permits one explicit retry', async () => {
  const f = await fixture('changed');
  await fs.writeFile(path.join(f.root, 'target.txt'), 'before\n');
  await call(f, 'patch_apply', {
    operationId: 'patch',
    files: [
      {
        path: 'target.txt',
        expectedHash: sha('before\n'),
        patch: '--- a/target.txt\n+++ b/target.txt\n@@ -1 +1 @@\n-before\n+after\n',
      },
    ],
  });
  await call(f, 'workflow_create', {
    workflowId: 'wf',
    title: 'Preserve original failed result',
    project: '.',
    patchOperationId: 'patch',
    checks: [
      {
        name: 'check',
        kind: 'terminal',
        executable: process.execPath,
        args: [
          '-e',
          "const fs=require('fs');fs.appendFileSync('count.txt','1');console.log('original check');process.exitCode=fs.readFileSync('count.txt','utf8').length===1?7:0",
        ],
        timeoutSeconds: 30,
      },
    ],
  });
  const first = (await cli(f, [{ runWorkflow: 'wf' }, sentinel], 1))[0].result,
    job = first.steps[0].job;
  assert.equal(job.errorCode, 'JOB_RECORD_SAVE_FAILED');
  assert.equal(job.exitCode, 7);
  const journal = await fs.readFile(path.join(f.state, 'workflows/wf.json'));
  await call(f, 'workflow_resume', { workflowId: 'wf', retryJobId: job.id }, 'WORKFLOW_RESULT_UNSAVED');
  assert.deepEqual(await fs.readFile(path.join(f.state, 'workflows/wf.json')), journal);
  await preserve(f);
  await restorePrivateIntent(f, job.id);
  const recovered = await call(f, 'command_retry_save', { jobId: job.id });
  assert.equal(recovered.job.status, 'failed');
  assert.equal(recovered.job.exitCode, 7);
  assert.equal(recovered.commandRerun, false);
  await call(f, 'workflow_resume', { workflowId: 'wf', retryJobId: job.id });
  const passed = (await cli(f, [{ runWorkflow: 'wf' }]))[0].result;
  assert.equal(passed.state, 'ready_for_review');
  assert.equal(passed.steps[0].attempts.length, 2);
  assert.equal(
    (await call(f, 'workflow_resume', { workflowId: 'wf', retryJobId: job.id })).steps[0].attempts.length,
    2,
  );
  await preserve(f, '11');
});
