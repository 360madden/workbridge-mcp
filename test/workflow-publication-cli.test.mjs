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
  suite = await fs.mkdtemp(path.join(os.tmpdir(), 'wb-workflow-publication-'));
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
  if (code?.startsWith('state:')) assert.equal(data.state, code.slice(6));
  else if (code) assert.equal(data.error.code, code);
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

async function workflow(f, exit = 0, second = false) {
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
  const checks = [
    {
      name: 'primary',
      kind: 'terminal',
      executable: process.execPath,
      args: [
        '-e',
        "require('fs').appendFileSync('count.txt','1');console.log('check once');process.exitCode=" + exit,
      ],
      timeoutSeconds: 30,
    },
  ];
  if (second)
    checks.push({
      name: 'later',
      kind: 'terminal',
      executable: process.execPath,
      args: ['-e', "require('fs').writeFileSync('later.txt','done')"],
      timeoutSeconds: 30,
    });
  await call(f, 'workflow_create', {
    workflowId: 'wf',
    title: 'Unsaved result retry guard',
    project: '.',
    patchOperationId: 'patch',
    checks,
  });
  await fs.writeFile(path.join(f.state, 'deny-publish'), 'fixture');
  const begun = await call(f, 'workflow_resume', { workflowId: 'wf' }),
    id = begun.steps[0].job.id;
  await pending(f, id);
  return id;
}
async function journal(f) {
  return fs.readFile(path.join(f.state, 'workflows', 'wf.json'));
}
async function noDuplicate(f, id) {
  assert.equal(await fs.readFile(path.join(f.root, 'count.txt'), 'utf8'), '1');
  const status = await call(f, 'workflow_status', { workflowId: 'wf' });
  assert.equal(status.steps[0].attempts.length, 1);
  assert.equal(status.steps[0].job.id, id);
  await preserved(f);
  return status;
}
async function settle(f, id) {
  for (let n = 0; n < 200; n++) {
    const job = await call(f, 'command_status', { jobId: id });
    if (job.status !== 'running') return job;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('Job did not finish');
}

test('workflow status and review identify unsaved results and give save-recovery guidance', async () => {
  const f = await fixture(),
    id = await workflow(f);
  const status = await call(f, 'workflow_status', { workflowId: 'wf' });
  assert.equal(status.state, 'blocked');
  assert.ok(status.issues.some((i) => i.code === 'WORKFLOW_RESULT_UNSAVED' && i.check === 'primary'));
  assert.match(status.nextAction, /command_retry_save/);
  assert.ok(status.nextAction.includes(id));
  const review = await call(f, 'workflow_review', { workflowId: 'wf' });
  assert.equal(review.state, 'blocked');
  assert.match(review.nextAction, /command_retry_save/);
  await noDuplicate(f, id);
});

test('explicit retry refuses unsaved outcome without changing its attempt journal or running twice', async () => {
  const f = await fixture(),
    id = await workflow(f),
    before = await journal(f);
  const direct = await call(
    f,
    'workflow_resume',
    { workflowId: 'wf', retryJobId: id },
    'WORKFLOW_RESULT_UNSAVED',
  );
  assert.deepEqual(await journal(f), before);
  const rows = await cli(f, [req('workflow_resume', { workflowId: 'wf', retryJobId: id }), sentinel], 1);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].result, direct);
  assert.deepEqual(await journal(f), before);
  await noDuplicate(f, id);
});

test('ordinary resume and CLI workflow driver block without saving automatically or advancing later checks', async () => {
  const f = await fixture(),
    id = await workflow(f, 0, true),
    original = await fs.readFile(path.join(f.state, 'jobs', id + '.json'));
  const view = await call(f, 'workflow_resume', { workflowId: 'wf' }, 'state:blocked');
  assert.equal(view.state, 'blocked');
  assert.equal(view.steps[1].attempts.length, 0);
  const rows = await cli(f, [{ runWorkflow: 'wf' }, sentinel], 1);
  assert.ok(rows.every((row) => row.result?.operationId !== 'must-not-run'));
  assert.deepEqual(await fs.readFile(path.join(f.state, 'jobs', id + '.json')), original);
  await assert.rejects(fs.access(path.join(f.root, 'later.txt')), (e) => e.code === 'ENOENT');
  await noDuplicate(f, id);
});

test('saving the successful result resumes the same attempt and advances the next check once', async () => {
  const f = await fixture(),
    id = await workflow(f, 0, true);
  await call(f, 'workflow_resume', { workflowId: 'wf', retryJobId: id }, 'WORKFLOW_RESULT_UNSAVED');
  await release(f);
  await cli(f, [req('command_retry_save', { jobId: id }), { runWorkflow: 'wf' }]);
  const final = await call(f, 'workflow_status', { workflowId: 'wf' });
  assert.equal(final.state, 'ready_for_review');
  assert.equal(final.steps[0].attempts.length, 1);
  assert.equal(final.steps[1].attempts.length, 1);
  assert.equal(await fs.readFile(path.join(f.root, 'later.txt'), 'utf8'), 'done');
  await noDuplicate(f, id);
  await call(f, 'workflow_resume', { workflowId: 'wf', retryJobId: id }, 'WORKFLOW_RETRY_MISMATCH');
});

test('a genuinely failed child still requires one explicit retry after its original result is saved', async () => {
  const f = await fixture(),
    id = await workflow(f, 7);
  await call(f, 'workflow_resume', { workflowId: 'wf', retryJobId: id }, 'WORKFLOW_RESULT_UNSAVED');
  await release(f);
  const saved = await call(f, 'command_retry_save', { jobId: id });
  assert.equal(saved.job.status, 'failed');
  assert.equal(saved.job.exitCode, 7);
  const before = await call(f, 'workflow_resume', { workflowId: 'wf' }, 'state:failed');
  assert.equal(before.state, 'failed');
  assert.equal(before.steps[0].attempts.length, 1);
  const retry = await call(f, 'workflow_resume', { workflowId: 'wf', retryJobId: id });
  const next = retry.steps[0].job.id;
  assert.notEqual(next, id);
  await settle(f, next);
  await call(f, 'workflow_resume', { workflowId: 'wf', retryJobId: id }, 'state:failed');
  assert.equal((await call(f, 'workflow_status', { workflowId: 'wf' })).steps[0].attempts.length, 2);
  await preserved(f, '11');
});

test('changed inputs do not bypass the unsaved-result guard and restored versions still need revalidation', async () => {
  const f = await fixture(),
    id = await workflow(f),
    target = path.join(f.root, 'target.txt');
  await fs.writeFile(target, 'later edit\n');
  const before = await journal(f);
  const stale = await call(f, 'workflow_status', { workflowId: 'wf' });
  assert.equal(stale.state, 'stale');
  assert.ok(stale.issues.some((i) => i.code === 'WORKFLOW_INPUT_CHANGED'));
  assert.match(stale.nextAction, /command_retry_save/);
  await call(f, 'workflow_resume', { workflowId: 'wf', retryJobId: id }, 'WORKFLOW_RESULT_UNSAVED');
  assert.deepEqual(await journal(f), before);
  assert.equal(await fs.readFile(target, 'utf8'), 'later edit\n');
  await release(f);
  await call(f, 'command_retry_save', { jobId: id });
  assert.equal((await call(f, 'workflow_resume', { workflowId: 'wf' }, 'state:stale')).state, 'stale');
  await fs.writeFile(target, 'after\n');
  const invalid = await call(f, 'workflow_resume', { workflowId: 'wf' }, 'state:failed');
  assert.equal(invalid.state, 'failed');
  assert.equal(invalid.steps[0].attempts.length, 1);
  const retried = await call(f, 'workflow_resume', { workflowId: 'wf', retryJobId: id });
  await settle(f, retried.steps[0].job.id);
  assert.equal((await call(f, 'workflow_resume', { workflowId: 'wf' })).state, 'ready_for_review');
  await preserved(f, '11');
});

test('concurrent retry requests cannot multiply unsaved attempts', async () => {
  const f = await fixture(),
    id = await workflow(f),
    before = await journal(f);
  await Promise.all(
    Array.from({ length: 6 }, () =>
      call(f, 'workflow_resume', { workflowId: 'wf', retryJobId: id }, 'WORKFLOW_RESULT_UNSAVED'),
    ),
  );
  assert.deepEqual(await journal(f), before);
  await noDuplicate(f, id);
});

test('workflow cancellation and patch undo remain authoritative even with retained results', async () => {
  const f = await fixture(),
    id = await workflow(f);
  const cancelled = await call(f, 'workflow_cancel', { workflowId: 'wf' });
  assert.equal(cancelled.state, 'cancelled');
  assert.equal(cancelled.nextAction, 'none');
  await release(f);
  await call(f, 'command_retry_save', { jobId: id });
  assert.equal(
    (await call(f, 'workflow_resume', { workflowId: 'wf' }, 'state:cancelled')).state,
    'cancelled',
  );
  await noDuplicate(f, id);
  await call(f, 'patch_undo', { operationId: 'patch' });
  assert.equal(await fs.readFile(path.join(f.root, 'target.txt'), 'utf8'), 'before\n');
});
