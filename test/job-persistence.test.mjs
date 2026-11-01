import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import { Workspace } from '../dist/workspace.js';
import { Jobs, MAX_CONCURRENT_JOBS } from '../dist/jobs.js';
let suite,
  sequence = 0;
const owners = [];
before(async () => {
  suite = await fs.mkdtemp(path.join(os.tmpdir(), 'wb-job-publication-'));
});
after(async () => {
  await Promise.all(owners.map((j) => j.close()));
  assert.ok(suite.startsWith(path.resolve(os.tmpdir()) + path.sep));
  await fs.rm(suite, { recursive: true, force: true });
});
async function fixture() {
  const root = path.join(suite, String(sequence++));
  await fs.mkdir(root);
  const state = path.join(root, 'State'),
    jobs = new Jobs(await Workspace.create(root), state);
  owners.push(jobs);
  return { root, state, jobs };
}
async function bounded(promise, timeoutMs = 10000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Publication did not finish within test bound')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
const args = ['-e', "require('fs').appendFileSync('count.txt','1');process.stdout.write('retained output');"];
async function start(f, id) {
  await f.jobs.terminal('.', process.execPath, args, 30, id);
  const active = f.jobs.live.get(id);
  assert.ok(active, 'Fixture must observe the owned job');
  return active.done;
}
function interceptRename(f, code, failures = Infinity) {
  const original = fs.rename;
  let calls = 0;
  fs.rename = async function (source, target, ...rest) {
    if (
      path.dirname(path.resolve(String(target))) === path.join(f.state, 'jobs') &&
      !path.basename(String(target)).startsWith('.')
    ) {
      calls++;
      if (calls <= failures) throw Object.assign(new Error('injected record publication failure'), { code });
    }
    return original.call(this, source, target, ...rest);
  };
  syncBuiltinESMExports();
  return {
    calls: () => calls,
    restore() {
      fs.rename = original;
      syncBuiltinESMExports();
    },
  };
}

test('successful process is not reported passed before its final record is published', async () => {
  const f = await fixture(),
    original = f.jobs.save.bind(f.jobs);
  let release, began;
  const gate = new Promise((resolve) => {
      release = resolve;
    }),
    entered = new Promise((resolve) => {
      began = resolve;
    });
  f.jobs.save = async (job, exclusive) => {
    if (!exclusive) {
      began();
      await gate;
    }
    return original(job, exclusive);
  };
  try {
    const done = start(f, 'delayed');
    await bounded(entered);
    assert.equal((await f.jobs.status('delayed')).status, 'running');
    assert.equal(
      JSON.parse(await fs.readFile(path.join(f.state, 'jobs/delayed.json'), 'utf8')).status,
      'running',
    );
    release();
    await bounded(done);
    assert.equal((await f.jobs.status('delayed')).status, 'passed');
    assert.equal(
      JSON.parse(await fs.readFile(path.join(f.state, 'jobs/delayed.json'), 'utf8')).status,
      'passed',
    );
    assert.equal(await fs.readFile(path.join(f.root, 'count.txt'), 'utf8'), '1');
  } finally {
    release();
    f.jobs.save = original;
  }
});

test('transient record rename failures retry publication without rerunning the command', async () => {
  const f = await fixture(),
    hook = interceptRename(f, 'EPERM', 2);
  try {
    await bounded(start(f, 'transient'));
    const status = await f.jobs.status('transient');
    assert.equal(status.status, 'passed');
    assert.equal(status.exitCode, 0);
    assert.equal(hook.calls(), 3);
    assert.equal(await fs.readFile(path.join(f.root, 'count.txt'), 'utf8'), '1');
    const saved = JSON.parse(await fs.readFile(path.join(f.state, 'jobs/transient.json'), 'utf8'));
    assert.equal(saved.status, 'passed');
    assert.equal(saved.output, 'retained output');
    assert.equal((await f.jobs.terminal('.', process.execPath, args, 30, 'transient')).status, 'passed');
    assert.equal(await fs.readFile(path.join(f.root, 'count.txt'), 'utf8'), '1');
  } finally {
    hook.restore();
  }
});

test('permanent publication failure retains output and true child exit without false success or replay', async () => {
  const f = await fixture(),
    hook = interceptRename(f, 'EPERM');
  try {
    await bounded(start(f, 'permanent'));
    const status = await f.jobs.status('permanent');
    assert.equal(status.status, 'failed');
    assert.equal(status.errorCode, 'JOB_RECORD_SAVE_FAILED');
    assert.equal(status.exitCode, 0);
    assert.ok(hook.calls() > 1 && hook.calls() <= 10);
    assert.equal((await f.jobs.output('permanent')).text, 'retained output');
    assert.equal(
      (await f.jobs.terminal('.', process.execPath, args, 30, 'permanent')).errorCode,
      'JOB_RECORD_SAVE_FAILED',
    );
    assert.equal((await f.jobs.cancel('permanent')).errorCode, 'JOB_RECORD_SAVE_FAILED');
    assert.equal(await fs.readFile(path.join(f.root, 'count.txt'), 'utf8'), '1');
    const page = await f.jobs.catalog({ offset: 0, limit: 20, scanLimit: 200 });
    assert.deepEqual(page.runningJobs, []);
    assert.equal(page.jobs[0].errorCode, 'JOB_RECORD_SAVE_FAILED');
    assert.equal(
      JSON.parse(await fs.readFile(path.join(f.state, 'jobs/permanent.json'), 'utf8')).status,
      'running',
    );
  } finally {
    hook.restore();
  }
});

test('nontransient publication errors are not retried', async () => {
  const f = await fixture(),
    hook = interceptRename(f, 'EIO');
  try {
    await bounded(start(f, 'nontransient'));
    assert.equal(hook.calls(), 1);
    assert.equal((await f.jobs.status('nontransient')).errorCode, 'JOB_RECORD_SAVE_FAILED');
    assert.equal((await f.jobs.output('nontransient')).text, 'retained output');
  } finally {
    hook.restore();
  }
});

test('unresolved publication failures remain bounded by shared job capacity without spawning more work', async () => {
  const f = await fixture(),
    hook = interceptRename(f, 'EPERM');
  try {
    const ids = Array.from({ length: MAX_CONCURRENT_JOBS }, (_, i) => 'retained-' + i);
    // Spawning the full configured capacity can take longer under parallel suite load.
    await bounded(Promise.all(ids.map((id) => start(f, id))), 30000);
    for (const id of ids) assert.equal((await f.jobs.status(id)).errorCode, 'JOB_RECORD_SAVE_FAILED');
    await assert.rejects(
      f.jobs.terminal('.', process.execPath, args, 30, 'must-not-launch'),
      (error) => error.code === 'JOB_LIMIT',
    );
    assert.equal((await fs.readFile(path.join(f.root, 'count.txt'), 'utf8')).length, MAX_CONCURRENT_JOBS);
    await assert.rejects(
      fs.access(path.join(f.state, 'jobs/must-not-launch.json')),
      (error) => error.code === 'ENOENT',
    );
    assert.deepEqual((await f.jobs.catalog({ offset: 0, limit: 20, scanLimit: 200 })).runningJobs, []);
  } finally {
    hook.restore();
  }
});
