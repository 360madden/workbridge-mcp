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
  suite = await fs.mkdtemp(path.join(os.tmpdir(), 'wb-settlement-cli-'));
});
async function release(f) {
  await fs.rm(path.join(f.state, 'block-publish'), { force: true });
}
after(async () => {
  for (const f of fixtures) await release(f);
  await Promise.all(fixtures.map((f) => f.client?.close()));
  assert.ok(suite.startsWith(path.resolve(os.tmpdir()) + path.sep));
  await fs.rm(suite, { recursive: true, force: true });
});
async function fixture() {
  const home = path.join(suite, String(sequence++)),
    root = path.join(home, 'Project ü'),
    state = path.join(home, 'State'),
    preload = path.join(home, 'gate.mjs');
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(state);
  // The bounded pause is private test instrumentation, never an installed runtime option.
  await fs.writeFile(
    preload,
    `import fs from 'node:fs/promises';import {existsSync} from 'node:fs';import {syncBuiltinESMExports} from 'node:module';import path from 'node:path';const state=${JSON.stringify(state)},original=fs.rename;fs.rename=async function(a,b,...rest){if(path.dirname(path.resolve(String(b)))===path.join(state,'jobs')&&existsSync(path.join(state,'block-publish'))){await fs.writeFile(path.join(state,'entered-'+path.basename(String(b))),'entered');const deadline=Date.now()+15000;while(existsSync(path.join(state,'block-publish'))){if(Date.now()>deadline)throw Object.assign(new Error('private test gate expired'),{code:'EIO'});await new Promise(r=>setTimeout(r,10));}if(existsSync(path.join(state,'deny-save')))throw Object.assign(new Error('private save failure'),{code:'EIO'});}return original.call(this,a,b,...rest);};syncBuiltinESMExports();`,
  );
  await fs.writeFile(path.join(root, 'keep.txt'), 'staged baseline\n');
  await run('git', ['init', '--quiet'], { cwd: root, windowsHide: true });
  await run('git', ['add', '--', 'keep.txt'], { cwd: root, windowsHide: true });
  const index = sha(await fs.readFile(path.join(root, '.git/index')));
  await fs.writeFile(path.join(root, 'keep.txt'), 'unrelated dirty\n');
  const f = {
    home,
    root,
    state,
    preload,
    index,
    n: 0,
    client: new Client({ name: 'settlement-fixture', version: '1' }),
  };
  fixtures.push(f);
  await f.client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ['--import', pathToFileURL(preload).href, path.join(repo, 'dist/server.js')],
      cwd: repo,
      stderr: 'pipe',
      env: { ...process.env, WORKBRIDGE_ROOT: root, WORKBRIDGE_STATE_DIR: state, WORKBRIDGE_LOCAL_CLI: '1' },
    }),
  );
  return f;
}
async function call(f, name, args = {}, code) {
  const raw = await f.client.callTool({ name, arguments: args }),
    data = JSON.parse(raw.content[0].text);
  assert.equal(!!raw.isError, !!code, JSON.stringify(data));
  if (code?.startsWith('state:')) assert.equal(data.state, code.slice(6));
  else if (code) assert.equal(data.error.code, code);
  else assert.deepEqual(data, raw.structuredContent);
  return data;
}
async function until(fn) {
  for (let n = 0; n < 400; n++) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error('Private fixture condition not reached');
}
async function entered(f, id) {
  await until(async () => {
    try {
      await fs.access(path.join(f.state, 'entered-' + id + '.json'));
      return true;
    } catch (e) {
      if (e.code === 'ENOENT') return false;
      throw e;
    }
  });
}
const req = (tool, args = {}) => ({ tool, arguments: args }),
  sentinel = req('write_file', {
    operationId: 'must-not-run',
    path: 'must-not-run.txt',
    content: 'bad',
    expectedHash: null,
  });
async function cli(f, steps, expected = 0, timeout = '20') {
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
          timeout,
        ],
        { cwd: repo, windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024 },
      )),
    };
  } catch (e) {
    raw = { exitCode: e.code, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
  assert.equal(raw.exitCode, expected, JSON.stringify(raw));
  const rows = raw.stdout.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
  if (!expected) assert.ok(rows.every((r) => r.ok));
  return rows;
}
async function preserve(f, count = '1') {
  assert.equal(sha(await fs.readFile(path.join(f.root, '.git/index'))), f.index);
  assert.equal(await fs.readFile(path.join(f.root, 'keep.txt'), 'utf8'), 'unrelated dirty\n');
  assert.equal(await fs.readFile(path.join(f.root, 'count.txt'), 'utf8'), count);
  await assert.rejects(fs.access(path.join(f.root, 'must-not-run.txt')), (e) => e.code === 'ENOENT');
}
async function workflow(f, outcome = 'timed_out') {
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
    title: 'Wait for original completion',
    project: '.',
    patchOperationId: 'patch',
    checks: [
      {
        name: 'primary',
        kind: 'terminal',
        executable: process.execPath,
        args: [
          '-e',
          "const fs=require('fs');fs.appendFileSync('count.txt','1');console.log('started');if(fs.readFileSync('count.txt','utf8').length===1)setInterval(()=>{},1000)",
        ],
        // Retain a real timeout on attempt one, but give the quick retry enough
        // startup headroom when many Node test processes run concurrently.
        timeoutSeconds: outcome === 'timed_out' ? 3 : 20,
      },
    ],
  });
  await fs.writeFile(path.join(f.state, 'block-publish'), 'private');
  const view = await call(f, 'workflow_resume', { workflowId: 'wf' }),
    id = view.steps[0].job.id;
  await until(async () => {
    try {
      return (await fs.readFile(path.join(f.root, 'count.txt'), 'utf8')) === '1';
    } catch (e) {
      if (e.code === 'ENOENT') return false;
      throw e;
    }
  });
  let cancellation;
  if (outcome === 'cancelled') cancellation = call(f, 'command_cancel', { jobId: id });
  await entered(f, id);
  return { id, cancellation };
}
async function settled(f, id) {
  return until(async () => {
    const j = await call(f, 'command_status', { jobId: id });
    return j.status !== 'running' && j.completionPending !== true ? j : false;
  });
}

for (const outcome of ['timed_out', 'cancelled'])
  test(
    outcome + ' workflow retry is refused until original completion is saved',
    { timeout: 25000 },
    async () => {
      const f = await fixture();
      let cancellation;
      try {
        const original = await workflow(f, outcome);
        cancellation = original.cancellation;
        const id = original.id,
          before = await fs.readFile(path.join(f.state, 'workflows/wf.json'));
        await call(f, 'workflow_resume', { workflowId: 'wf', retryJobId: id }, 'WORKFLOW_JOB_PENDING');
        assert.deepEqual(await fs.readFile(path.join(f.state, 'workflows/wf.json')), before);
        await preserve(f);
        const job = await call(f, 'command_status', { jobId: id });
        assert.equal(job.status, outcome);
        assert.equal(job.completionPending, true);
        assert.equal(job.endedAt, undefined);
        await release(f);
        await cancellation;
        const finished = await settled(f, id);
        assert.equal(finished.status, outcome);
        assert.equal(finished.completionPending, false);
        assert.ok(finished.endedAt);
        const retry = await call(f, 'workflow_resume', { workflowId: 'wf', retryJobId: id });
        assert.equal(retry.steps[0].attempts.length, 2);
        assert.notEqual(retry.steps[0].job.id, id);
        const done = (await cli(f, [{ runWorkflow: 'wf' }]))[0].result;
        assert.equal(done.state, 'ready_for_review');
        assert.equal(
          (await call(f, 'workflow_resume', { workflowId: 'wf', retryJobId: id })).steps[0].attempts.length,
          2,
        );
        await preserve(f, '11');
      } finally {
        await release(f);
        await cancellation;
      }
    },
  );

test(
  'workflow status and review remain validating while timeout publication is pending',
  { timeout: 20000 },
  async () => {
    const f = await fixture();
    try {
      const { id } = await workflow(f);
      const a = await call(f, 'workflow_status', { workflowId: 'wf' }),
        b = await call(f, 'workflow_review', { workflowId: 'wf' });
      for (const v of [a, b]) {
        assert.equal(v.state, 'validating');
        assert.equal(v.steps[0].job.completionPending, true);
        assert.match(v.nextAction, /completion/i);
      }
      const resumed = await call(f, 'workflow_resume', { workflowId: 'wf' });
      assert.equal(resumed.state, 'validating');
      assert.equal(resumed.steps[0].attempts.length, 1);
      await preserve(f);
      await release(f);
      await settled(f, id);
    } finally {
      await release(f);
    }
  },
);

for (const action of ['waitForJob', 'runWorkflow'])
  test(
    action + ' reaches its deadline instead of declaring an unfinished timeout complete',
    { timeout: 20000 },
    async () => {
      const f = await fixture();
      try {
        const { id } = await workflow(f),
          rows = await cli(
            f,
            [action === 'waitForJob' ? { waitForJob: id } : { runWorkflow: 'wf' }, sentinel],
            124,
            '1',
          );
        assert.equal(rows.length, 1);
        assert.equal(rows[0].error.code, 'DEADLINE');
        const current = await call(f, 'command_status', { jobId: id });
        assert.equal(current.completionPending, true);
        assert.equal((await call(f, 'diagnostics')).jobs.capacity.occupied, 1);
        await preserve(f);
        await release(f);
        await settled(f, id);
        const finished = await cli(f, [{ waitForJob: id }, sentinel], 1);
        assert.equal(finished.length, 1);
        assert.equal(finished[0].result.completionPending, false);
      } finally {
        await release(f);
      }
    },
  );

test(
  'CLI waiter observes a delayed final save failure rather than the provisional timeout',
  { timeout: 20000 },
  async () => {
    const f = await fixture();
    let waiter;
    try {
      const { id } = await workflow(f);
      waiter = cli(f, [{ waitForJob: id }, sentinel], 1);
      await fs.writeFile(path.join(f.state, 'deny-save'), 'private');
      await release(f);
      const rows = await waiter;
      assert.equal(rows[0].result.errorCode, 'JOB_RECORD_SAVE_FAILED');
      assert.equal(rows[0].result.completionPending, false);
      await call(f, 'workflow_resume', { workflowId: 'wf', retryJobId: id }, 'WORKFLOW_RESULT_UNSAVED');
      await fs.unlink(path.join(f.state, 'deny-save'));
      const saved = await call(f, 'command_retry_save', { jobId: id });
      assert.equal(saved.job.status, 'timed_out');
      assert.equal(saved.job.completionPending, false);
      assert.equal(saved.commandRerun, false);
      await preserve(f);
    } finally {
      await release(f);
      await waiter?.catch(() => {});
    }
  },
);

test(
  'concurrent retry requests cannot launch additional pending-completion attempts',
  { timeout: 20000 },
  async () => {
    const f = await fixture();
    try {
      const { id } = await workflow(f);
      const replies = await Promise.all(
        Array.from({ length: 4 }, () =>
          call(f, 'workflow_resume', { workflowId: 'wf', retryJobId: id }, 'WORKFLOW_JOB_PENDING'),
        ),
      );
      assert.equal(replies.length, 4);
      assert.equal((await call(f, 'workflow_status', { workflowId: 'wf' })).steps[0].attempts.length, 1);
      await preserve(f);
    } finally {
      await release(f);
    }
  },
);

test(
  'changed inputs and cancellation remain authoritative while completion is pending',
  { timeout: 20000 },
  async () => {
    const f = await fixture();
    let cancelled;
    try {
      const { id } = await workflow(f);
      await fs.writeFile(path.join(f.root, 'target.txt'), 'later edit\n');
      assert.equal((await call(f, 'workflow_status', { workflowId: 'wf' })).state, 'stale');
      await call(f, 'workflow_resume', { workflowId: 'wf', retryJobId: id }, 'WORKFLOW_JOB_PENDING');
      cancelled = call(f, 'workflow_cancel', { workflowId: 'wf' });
      await release(f);
      const view = await cancelled;
      assert.equal(view.state, 'cancelled');
      assert.equal(
        (await call(f, 'workflow_resume', { workflowId: 'wf' }, 'state:cancelled')).state,
        'cancelled',
      );
      await preserve(f);
      assert.equal(await fs.readFile(path.join(f.root, 'target.txt'), 'utf8'), 'later edit\n');
    } finally {
      await release(f);
      await cancelled;
    }
  },
);
