import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, unlink, utimes, truncate } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createTwoFilesPatch } from 'diff';
import { Workspace } from '../dist/workspace.js';
import { Serial, digest } from '../dist/changes.js';
import { Patches } from '../dist/patches.js';
import { Workflows } from '../dist/workflows.js';
import { BridgeError } from '../dist/core.js';

const temporary = [];
after(async () => {
  for (const root of temporary) await rm(root, { recursive: true, force: true });
});
class FakeJobs {
  records = new Map();
  profiles = { check: { executable: process.execPath, args: ['--version'], timeoutSeconds: 10 } };
  launches = 0;
  failAfterLaunch = false;
  async definition(_project, name) {
    if (!this.profiles[name]) throw new BridgeError('COMMAND_NOT_CONFIGURED', 'missing profile');
    return structuredClone(this.profiles[name]);
  }
  async runPinned(project, name, expected, id) {
    assert.deepEqual(await this.definition(project, name), expected);
    return this.terminal(project, expected.executable, expected.args, expected.timeoutSeconds, id);
  }
  async terminal(project, executable, args, timeoutSeconds, id) {
    const request = JSON.stringify({ project, executable, args, timeoutSeconds });
    const old = this.records.get(id);
    if (old) {
      if (old.request !== request) throw new BridgeError('ID_REUSE', 'different command');
      return this.status(id);
    }
    this.launches++;
    this.records.set(id, {
      id,
      request,
      project,
      command: executable,
      status: 'running',
      startedAt: new Date().toISOString(),
      exitCode: null,
      outputTruncated: false,
      outputLength: 2,
    });
    if (this.failAfterLaunch) {
      this.failAfterLaunch = false;
      throw new Error('lost job launch response');
    }
    return this.status(id);
  }
  async status(id) {
    if (!this.records.has(id)) throw new BridgeError('UNKNOWN_JOB', 'unknown');
    const { request, ...job } = this.records.get(id);
    return { ...job };
  }
  complete(id, status = 'passed') {
    Object.assign(this.records.get(id), {
      status,
      endedAt: new Date().toISOString(),
      exitCode: status === 'passed' ? 0 : 1,
    });
  }
  async cancel(id) {
    this.complete(id, 'cancelled');
    return this.status(id);
  }
  async output(id) {
    return {
      ...(await this.status(id)),
      offset: 0,
      text: 'ok',
      nextOffset: null,
      stream: 'combined',
      streamLength: 2,
    };
  }
}
const terminal = (name = 'test') => ({
  name,
  kind: 'terminal',
  executable: process.execPath,
  args: ['--version'],
  timeoutSeconds: 10,
});
async function fixture(checks = [terminal()]) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wb-workflows-'));
  temporary.push(root);
  const state = path.join(root, '.state');
  await mkdir(state);
  await mkdir(path.join(root, 'project'));
  const workspace = await Workspace.create(root);
  workspace.protect(state);
  const patches = new Patches(workspace, path.join(state, 'patches'), new Serial());
  const jobs = new FakeJobs();
  const directory = path.join(state, 'workflows');
  const workflows = new Workflows(workspace, directory, patches, jobs);
  const files = ['a.txt', 'b.txt'].map((file) => ({
    path: `project/${file}`,
    expectedHash: digest(`before ${file}\n`),
    patch: createTwoFilesPatch(
      `a/project/${file}`,
      `b/project/${file}`,
      `before ${file}\n`,
      `after ${file}\n`,
    ),
  }));
  for (const file of ['a.txt', 'b.txt'])
    await writeFile(path.join(root, 'project', file), `before ${file}\n`);
  await patches.apply('patch', files);
  const args = {
    workflowId: 'workflow',
    project: 'project',
    patchOperationId: 'patch',
    title: 'Fixture checks',
    checks,
  };
  return { root, state, workspace, patches, jobs, directory, workflows, args };
}
const latest = (state, index = 0) => state.steps[index].attempts.at(-1).jobId;
const codes = (code) => (e) => e.code === code;

test('workflow create is nonexecuting, idempotent and binds all patch after-hashes', async () => {
  const f = await fixture();
  const saved = await f.workflows.create(f.args);
  assert.equal(saved.state, 'pending');
  assert.equal(saved.inputs.length, 2);
  assert.ok(saved.inputs.every((v) => v.matches));
  assert.equal(f.jobs.launches, 0);
  assert.equal((await f.workflows.create(f.args)).replayed, true);
  await assert.rejects(f.workflows.create({ ...f.args, title: 'changed' }), codes('ID_REUSE'));
  assert.equal(await readFile(path.join(f.root, 'project/a.txt'), 'utf8'), 'after a.txt\n');
});

test('sequential checks survive reconstruction and completed checks are not rerun', async () => {
  const f = await fixture([terminal('build'), terminal('tests')]);
  await f.workflows.create(f.args);
  const first = await f.workflows.resume('workflow');
  assert.equal(first.state, 'validating');
  assert.equal(f.jobs.launches, 1);
  await Promise.all(Array.from({ length: 5 }, () => f.workflows.resume('workflow')));
  assert.equal(f.jobs.launches, 1);
  f.jobs.complete(latest(first));
  assert.equal((await f.workflows.status('workflow')).state, 'pending');
  const continued = new Workflows(f.workspace, f.directory, f.patches, f.jobs);
  const second = await continued.resume('workflow');
  assert.equal(f.jobs.launches, 2);
  assert.equal(second.steps[0].attempts[0].state, 'passed');
  f.jobs.complete(latest(second, 1));
  assert.equal((await continued.resume('workflow')).state, 'ready_for_review');
  const review = await continued.review('workflow', 0, 20, 10);
  assert.equal(review.state, 'ready_for_review');
  assert.equal(review.outputs.length, 2);
  assert.equal(review.diff.diff.length, 20);
  assert.ok(review.diff.nextOffset);
  await continued.resume('workflow');
  assert.equal(f.jobs.launches, 2);
});

test('lost launch response recovers the same job and never accepts another request at its ID', async () => {
  const f = await fixture();
  await f.workflows.create(f.args);
  f.jobs.failAfterLaunch = true;
  await assert.rejects(f.workflows.resume('workflow'), /lost job launch/);
  const stored = JSON.parse(await readFile(path.join(f.directory, 'workflow.json'), 'utf8'));
  assert.equal(stored.attempts[0][0].state, 'starting');
  f.jobs.complete(stored.attempts[0][0].jobId);
  assert.equal((await f.workflows.resume('workflow')).state, 'ready_for_review');
  assert.equal(f.jobs.launches, 1);
  const g = await fixture();
  await g.workflows.create(g.args);
  const save = g.workflows.save.bind(g.workflows);
  g.workflows.save = async (record, exclusive) => {
    await save(record, exclusive);
    if (record.attempts[0].length) throw new Error('crash before job launch');
  };
  await assert.rejects(g.workflows.resume('workflow'), /crash before job/);
  assert.equal(g.jobs.launches, 0);
  const intent = JSON.parse(await readFile(path.join(g.directory, 'workflow.json'), 'utf8')).attempts[0][0];
  await g.jobs.terminal('project', process.execPath, ['different'], 10, intent.jobId);
  g.jobs.complete(intent.jobId);
  const fresh = new Workflows(g.workspace, g.directory, g.patches, g.jobs);
  await assert.rejects(fresh.resume('workflow'), codes('ID_REUSE'));
  assert.equal(g.jobs.launches, 1);
  assert.notEqual((await fresh.status('workflow')).state, 'ready_for_review');
});

test('failure and interruption require explicit idempotent retry tokens, retaining older output IDs', async () => {
  for (const outcome of ['failed', 'interrupted', 'timed_out', 'cancelled']) {
    const f = await fixture();
    await f.workflows.create(f.args);
    const first = await f.workflows.resume('workflow');
    const original = latest(first);
    f.jobs.complete(original, outcome);
    assert.equal((await f.workflows.resume('workflow')).state, 'failed');
    assert.equal(f.jobs.launches, 1);
    const retry = await f.workflows.resume('workflow', original);
    assert.equal(retry.steps[0].attempts.length, 2);
    assert.notEqual(latest(retry), original);
    await f.workflows.resume('workflow', original);
    assert.equal(f.jobs.launches, 2);
    f.jobs.complete(latest(retry));
    await f.workflows.resume('workflow', original);
    assert.equal(f.jobs.launches, 2);
    assert.equal((await f.workflows.resume('workflow')).state, 'ready_for_review');
    await assert.rejects(f.workflows.resume('workflow', latest(retry)), codes('WORKFLOW_RETRY_MISMATCH'));
    await assert.rejects(f.workflows.resume('workflow', 'unknown'), codes('WORKFLOW_RETRY_MISMATCH'));
  }
});

test('changed inputs block launches and invalidate passing results; later files are preserved', async () => {
  const f = await fixture();
  await writeFile(path.join(f.root, 'project/config.json'), '{}');
  await f.workflows.create({
    ...f.args,
    inputs: [{ path: 'project/config.json', expectedHash: digest('{}') }],
  });
  await writeFile(path.join(f.root, 'project/config.json'), '{"new":true}');
  assert.equal((await f.workflows.resume('workflow')).state, 'stale');
  assert.equal(f.jobs.launches, 0);
  await writeFile(path.join(f.root, 'project/config.json'), '{}');
  const started = await f.workflows.resume('workflow');
  f.jobs.complete(latest(started));
  await writeFile(path.join(f.root, 'project/a.txt'), 'independent edit');
  assert.equal((await f.workflows.resume('workflow')).state, 'stale');
  assert.equal((await f.workflows.review('workflow')).state, 'stale');
  assert.equal(f.jobs.launches, 1);
  await assert.rejects(f.patches.undo('patch'), codes('PATCH_BLOCKED'));
  assert.equal(await readFile(path.join(f.root, 'project/a.txt'), 'utf8'), 'independent edit');
  assert.equal(await readFile(path.join(f.root, 'project/b.txt'), 'utf8'), 'after b.txt\n');
});

test('review rechecks watched bytes after readiness, including expected missing files', async () => {
  const f = await fixture();
  await f.workflows.create({ ...f.args, inputs: [{ path: 'project/absent.txt', expectedHash: null }] });
  const start = await f.workflows.resume('workflow');
  f.jobs.complete(latest(start));
  await f.workflows.resume('workflow');
  await writeFile(path.join(f.root, 'project/absent.txt'), 'new file');
  const review = await f.workflows.review('workflow');
  assert.equal(review.state, 'stale');
  assert.equal(review.recordedState, 'ready_for_review');
  assert.ok(review.issues.some((i) => i.path === 'project/absent.txt'));
  assert.equal(f.jobs.launches, 1);
});

test('saved profile definitions refuse configuration drift before and after validation', async () => {
  const f = await fixture([{ name: 'test', kind: 'profile', command: 'check' }]);
  await f.workflows.create(f.args);
  f.jobs.profiles.check.args = ['--help'];
  assert.equal((await f.workflows.resume('workflow')).state, 'blocked');
  assert.equal(f.jobs.launches, 0);
  f.jobs.profiles.check.args = ['--version'];
  const started = await f.workflows.resume('workflow');
  f.jobs.complete(latest(started));
  assert.equal((await f.workflows.resume('workflow')).state, 'ready_for_review');
  delete f.jobs.profiles.check;
  assert.equal((await f.workflows.status('workflow')).state, 'blocked');
});

test('rewritten then restored bytes invalidate the earlier file version and require one explicit retry', async () => {
  const f = await fixture();
  await f.workflows.create(f.args);
  const first = await f.workflows.resume('workflow');
  const file = path.join(f.root, 'project/a.txt');
  await writeFile(file, 'temporary source change');
  await writeFile(file, 'after a.txt\n');
  await utimes(file, new Date(), new Date(Date.now() + 1000));
  f.jobs.complete(latest(first));
  const stale = await f.workflows.resume('workflow');
  assert.equal(stale.state, 'failed');
  assert.ok(stale.inputs.every((f) => f.matches));
  assert.ok(stale.steps[0].attempts[0].invalidated);
  assert.equal(f.jobs.launches, 1);
  const retried = await f.workflows.resume('workflow', latest(first));
  f.jobs.complete(latest(retried));
  assert.equal((await f.workflows.resume('workflow')).state, 'ready_for_review');
  await f.workflows.resume('workflow', latest(first));
  assert.equal(f.jobs.launches, 2);
});

test('cancellation is durable, stops the current job, and leaves patch undo explicit', async () => {
  const f = await fixture([terminal('one'), terminal('two')]);
  await f.workflows.create(f.args);
  const started = await f.workflows.resume('workflow');
  assert.equal((await f.workflows.cancel('workflow')).state, 'cancelled');
  assert.equal((await f.jobs.status(latest(started))).status, 'cancelled');
  const continued = new Workflows(f.workspace, f.directory, f.patches, f.jobs);
  await continued.cancel('workflow');
  assert.equal((await continued.resume('workflow')).state, 'cancelled');
  assert.equal(f.jobs.launches, 1);
  assert.equal(await readFile(path.join(f.root, 'project/a.txt'), 'utf8'), 'after a.txt\n');
  await f.patches.undo('patch');
  assert.equal((await continued.status('workflow')).patchState, 'undone');
});

test('retrying a stale earlier check waits for any later running job', async () => {
  const f = await fixture([terminal('first'), terminal('second')]);
  await f.workflows.create(f.args);
  const one = await f.workflows.resume('workflow');
  f.jobs.complete(latest(one));
  const two = await f.workflows.resume('workflow');
  await utimes(path.join(f.root, 'project/a.txt'), new Date(), new Date(Date.now() + 1000));
  const blocked = await f.workflows.resume('workflow', latest(one));
  assert.equal(blocked.state, 'failed');
  assert.equal(f.jobs.launches, 2);
  f.jobs.complete(latest(two, 1));
  await f.workflows.resume('workflow', latest(one));
  assert.equal(f.jobs.launches, 3);
});

test('durable intent without a job recovers once and cancellation prevents its later launch', async () => {
  const f = await fixture();
  await f.workflows.create(f.args);
  const save = f.workflows.save.bind(f.workflows);
  f.workflows.save = async (record, exclusive) => {
    await save(record, exclusive);
    if (record.attempts[0].length) throw new Error('crash before launch');
  };
  await assert.rejects(f.workflows.resume('workflow'), /crash before launch/);
  assert.equal(f.jobs.launches, 0);
  const recovered = new Workflows(f.workspace, f.directory, f.patches, f.jobs);
  await utimes(path.join(f.root, 'project/a.txt'), new Date(), new Date(Date.now() + 1000));
  await recovered.resume('workflow');
  await recovered.resume('workflow');
  assert.equal(f.jobs.launches, 1);
  const g = await fixture();
  await g.workflows.create(g.args);
  const original = g.workflows.save.bind(g.workflows);
  g.workflows.save = async (record, exclusive) => {
    await original(record, exclusive);
    if (record.attempts[0].length) throw new Error('crash');
  };
  await assert.rejects(g.workflows.resume('workflow'), /crash/);
  const cancelled = new Workflows(g.workspace, g.directory, g.patches, g.jobs);
  await cancelled.cancel('workflow');
  await cancelled.resume('workflow');
  assert.equal(g.jobs.launches, 0);
});

test('request, hashing, attempt and journal bounds refuse work without silently trimming it', async () => {
  const f = await fixture();
  const large = [terminal('one'), terminal('two')].map((c) => ({ ...c, args: ['x'.repeat(20000)] }));
  await assert.rejects(f.workflows.create({ ...f.args, checks: large }), codes('WORKFLOW_LIMIT'));
  const bytes = Buffer.alloc(16 * 1024 * 1024);
  const inputs = [];
  for (let i = 0; i < 4; i++) {
    const file = `project/big-${i}.dat`;
    await writeFile(path.join(f.root, file), '');
    await truncate(path.join(f.root, file), bytes.length);
    inputs.push({ path: file, expectedHash: digest(bytes) });
  }
  await assert.rejects(f.workflows.create({ ...f.args, inputs }), codes('WORKFLOW_LIMIT'));
  await f.workflows.create(f.args);
  let result = await f.workflows.resume('workflow');
  for (let n = 1; n < 10; n++) {
    f.jobs.complete(latest(result), 'failed');
    result = await f.workflows.resume('workflow', latest(result));
  }
  f.jobs.complete(latest(result), 'failed');
  await assert.rejects(f.workflows.resume('workflow', latest(result)), codes('WORKFLOW_LIMIT'));
  assert.equal(f.jobs.launches, 10);
  await writeFile(path.join(f.directory, 'workflow.json'), ' '.repeat(128 * 1024 + 1));
  await assert.rejects(f.workflows.resume('workflow'), codes('CORRUPT_WORKFLOW'));
  assert.equal(f.jobs.launches, 10);
});

test('partial patch recovery precedes validation and undone patches cannot be reapplied by a workflow', async () => {
  const f = await fixture();
  // Reconstruct the durable state left after the first file was applied.
  const recordFile = path.join(f.state, 'patches/patch/record.json');
  const record = JSON.parse(await readFile(recordFile, 'utf8'));
  record.state = 'applying';
  record.files[1].progress = 'pending';
  await writeFile(path.join(f.root, 'project/b.txt'), 'before b.txt\n');
  await writeFile(recordFile, JSON.stringify(record));
  await f.workflows.create(f.args);
  assert.equal(f.jobs.launches, 0);
  const resumed = await f.workflows.resume('workflow');
  assert.equal(resumed.patchState, 'applied');
  assert.equal(f.jobs.launches, 1);
  f.jobs.complete(latest(resumed));
  await f.workflows.resume('workflow');
  await f.patches.undo('patch');
  assert.equal((await f.workflows.resume('workflow')).state, 'undone');
  assert.equal(f.jobs.launches, 1);
  assert.equal(await readFile(path.join(f.root, 'project/a.txt'), 'utf8'), 'before a.txt\n');
});

test('discovery filters page through nonmatches and corrupt journals without hiding incompleteness', async () => {
  const f = await fixture();
  for (const workflowId of ['a', 'b', 'c']) await f.workflows.create({ ...f.args, workflowId });
  await f.workflows.cancel('b');
  await writeFile(path.join(f.directory, 'bad.json'), '{}');
  const options = {
    project: 'project',
    path: 'project/a.txt',
    state: 'cancelled',
    offset: 0,
    limit: 1,
    scanLimit: 1,
  };
  const first = await f.workflows.list(options);
  assert.equal(first.workflows.length, 0);
  assert.equal(first.nextOffset, 1);
  const second = await f.workflows.list({ ...options, offset: first.nextOffset });
  assert.equal(second.workflows[0].workflowId, 'b');
  const corrupt = await f.workflows.list({ ...options, offset: second.nextOffset });
  assert.equal(corrupt.issues[0].code, 'CORRUPT_WORKFLOW');
  assert.equal(corrupt.nextOffset, 3);
  const final = await f.workflows.list({ ...options, offset: corrupt.nextOffset });
  assert.equal(final.nextOffset, null);
  assert.equal(final.catalogTruncated, false);
});

test('scope, protected paths, corrupt plans and missing job evidence fail closed', async () => {
  const f = await fixture();
  await writeFile(path.join(f.root, 'elsewhere.txt'), 'x');
  await assert.rejects(
    f.workflows.create({ ...f.args, inputs: [{ path: 'elsewhere.txt', expectedHash: digest('x') }] }),
    codes('WORKFLOW_SCOPE'),
  );
  await assert.rejects(
    f.workflows.create({ ...f.args, inputs: [{ path: '.state/private.txt', expectedHash: null }] }),
    codes('PROTECTED_PATH'),
  );
  await assert.rejects(
    f.workflows.create({ ...f.args, inputs: [{ path: 'project/a.txt', expectedHash: digest('other') }] }),
    codes('WORKFLOW_INPUT_CONFLICT'),
  );
  await assert.rejects(
    f.workflows.create({ ...f.args, checks: [terminal(), terminal()] }),
    codes('INVALID_WORKFLOW'),
  );
  await f.workflows.create(f.args);
  const started = await f.workflows.resume('workflow');
  f.jobs.records.delete(latest(started));
  assert.equal((await f.workflows.resume('workflow')).state, 'blocked');
  assert.equal(f.jobs.launches, 1);
  const recordPath = path.join(f.directory, 'workflow.json');
  const record = JSON.parse(await readFile(recordPath, 'utf8'));
  record.plan.checks[0].definition.args = ['modified'];
  await writeFile(recordPath, JSON.stringify(record));
  await assert.rejects(f.workflows.resume('workflow'), codes('CORRUPT_WORKFLOW'));
  assert.equal(f.jobs.launches, 1);
  await unlink(recordPath);
  await assert.rejects(f.workflows.status('workflow'), codes('UNKNOWN_WORKFLOW'));
});
