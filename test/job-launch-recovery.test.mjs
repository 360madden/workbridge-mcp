import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import cp from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import { Workspace } from '../dist/workspace.js';
import { Jobs, MAX_CONCURRENT_JOBS } from '../dist/jobs.js';
import { rootsLock } from '../dist/roots-config.js';
let suite,
  sequence = 0;
const owners = [];
before(async () => {
  suite = await fs.mkdtemp(path.join(os.tmpdir(), 'wb-prelaunch-'));
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
    workspace = await Workspace.create(root),
    jobs = new Jobs(workspace, state);
  owners.push(jobs);
  return { root, state, workspace, jobs, file: (id) => path.join(state, 'jobs', id + '.json') };
}
function inject(f, { publication = false, setup = false, spawn = false } = {}) {
  const original = { rename: fs.rename, open: fs.open, spawn: cp.spawn };
  let blocked = publication,
    spawns = 0;
  fs.rename = async function (a, b, ...r) {
    if (blocked && path.dirname(path.resolve(String(b))) === path.join(f.state, 'jobs'))
      throw Object.assign(new Error('private save fault'), { code: 'EIO' });
    return original.rename.call(this, a, b, ...r);
  };
  fs.open = async function (a, ...r) {
    if (setup && path.resolve(String(a)) === rootsLock(f.state))
      throw Object.assign(new Error('private lock fault'), { code: 'EACCES' });
    return original.open.call(this, a, ...r);
  };
  cp.spawn = function (...a) {
    spawns++;
    if (spawn) throw Object.assign(new Error('private host fault'), { code: 'EINVAL' });
    return original.spawn.apply(this, a);
  };
  syncBuiltinESMExports();
  return {
    release() {
      blocked = false;
    },
    spawns: () => spawns,
    restore() {
      Object.assign(fs, { rename: original.rename, open: original.open });
      cp.spawn = original.spawn;
      syncBuiltinESMExports();
    },
  };
}
const missing = (f) => path.join(f.root, 'missing-tool.exe');
async function launch(f, id, executable = missing(f)) {
  return f.jobs.terminal('.', executable, [], 30, id);
}
async function noOutput(f, id) {
  assert.equal((await f.jobs.output(id)).text, '');
  assert.equal((await f.jobs.output(id, 0, 100, 'stdout')).text, '');
  assert.equal((await f.jobs.output(id, 0, 100, 'stderr')).text, '');
}
for (const [label, options, code] of [
  ['missing executable', {}, 'EXECUTABLE_NOT_FOUND'],
  ['host setup', { setup: true }, 'COMMAND_SETUP_FAILED'],
  ['synchronous spawn', { spawn: true }, 'COMMAND_LAUNCH_FAILED'],
]) {
  test(`${label} is recorded as failed, not a fictitious interrupted command`, async () => {
    const f = await fixture(),
      hook = inject(f, options);
    try {
      const executable = label === 'missing executable' ? missing(f) : process.execPath;
      const result = await launch(f, 'job', executable);
      assert.equal(result.status, 'failed');
      assert.equal(result.errorCode, code);
      assert.equal(result.exitCode, null);
      assert.ok(result.endedAt);
      assert.deepEqual(await f.jobs.status('job'), result);
      assert.equal(JSON.parse(await fs.readFile(f.file('job'), 'utf8')).errorCode, code);
      await noOutput(f, 'job');
      const n = hook.spawns();
      assert.deepEqual(await launch(f, 'job', executable), result);
      assert.equal(hook.spawns(), n);
      assert.equal(f.jobs.live.size, 0);
    } finally {
      hook.restore();
    }
  });
  test(`${label} plus failed publication retains the original error for explicit recovery`, async () => {
    const f = await fixture(),
      hook = inject(f, { ...options, publication: true });
    try {
      const executable = label === 'missing executable' ? missing(f) : process.execPath;
      const failed = await launch(f, 'job', executable);
      assert.equal(failed.errorCode, 'JOB_RECORD_SAVE_FAILED');
      assert.equal(failed.status, 'failed');
      assert.equal(failed.exitCode, null);
      assert.equal(f.jobs.live.size, 1);
      assert.equal(f.jobs.live.get('job').pending.result.errorCode, code);
      assert.equal(JSON.parse(await fs.readFile(f.file('job'), 'utf8')).status, 'running');
      assert.deepEqual(await launch(f, 'job', executable), failed);
      await noOutput(f, 'job');
      await assert.rejects(f.jobs.retrySave('job'), (e) => e.code === 'JOB_RECORD_SAVE_FAILED');
      const n = hook.spawns();
      hook.release();
      const saved = await f.jobs.retrySave('job');
      assert.equal(saved.publication, 'saved');
      assert.equal(saved.commandRerun, false);
      assert.equal(saved.job.errorCode, code);
      assert.equal(saved.job.status, 'failed');
      assert.equal(saved.job.exitCode, null);
      assert.equal(f.jobs.live.size, 0);
      assert.equal((await f.jobs.retrySave('job')).publication, 'already_saved');
      assert.deepEqual(await launch(f, 'job', executable), saved.job);
      assert.equal(hook.spawns(), n);
      const reconstructed = new Jobs(f.workspace, f.state);
      owners.push(reconstructed);
      assert.deepEqual(await reconstructed.status('job'), saved.job);
    } finally {
      hook.restore();
    }
  });
}
test('full-capacity pre-launch publication failures recover without executing', async () => {
  const f = await fixture(),
    hook = inject(f, { publication: true });
  try {
    for (let n = 0; n < MAX_CONCURRENT_JOBS; n++)
      assert.equal((await launch(f, 'held-' + n)).errorCode, 'JOB_RECORD_SAVE_FAILED');
    assert.equal(f.jobs.live.size, MAX_CONCURRENT_JOBS);
    await assert.rejects(launch(f, 'overflow'), (e) => e.code === 'JOB_LIMIT');
    assert.deepEqual((await f.jobs.catalog({ offset: 0, limit: 20, scanLimit: 200 })).runningJobs, []);
    hook.release();
    await f.jobs.retrySave('held-0');
    assert.equal((await launch(f, 'next')).errorCode, 'EXECUTABLE_NOT_FOUND');
    for (let n = 1; n < MAX_CONCURRENT_JOBS; n++) await f.jobs.retrySave('held-' + n);
    assert.equal(f.jobs.live.size, 0);
    assert.equal(hook.spawns(), 0);
  } finally {
    hook.restore();
  }
});
test('changed intent cannot be overwritten when repairing a pre-launch save failure', async () => {
  const f = await fixture(),
    hook = inject(f, { publication: true });
  try {
    await launch(f, 'job');
    hook.release();
    const file = f.file('job');
    await fs.writeFile(
      file,
      JSON.stringify({ ...JSON.parse(await fs.readFile(file, 'utf8')), extra: 'later change' }),
    );
    const before = await fs.readFile(file);
    await assert.rejects(f.jobs.retrySave('job'), (e) => e.code === 'JOB_SAVE_CONFLICT');
    assert.deepEqual(await fs.readFile(file), before);
    assert.equal((await f.jobs.status('job')).errorCode, 'JOB_RECORD_SAVE_FAILED');
    assert.equal(hook.spawns(), 0);
  } finally {
    hook.restore();
  }
});
for (const cancelMode of ['cancel', 'close'])
  test(
    `${cancelMode} during executable resolution keeps ownership and prevents launch`,
    { timeout: 10000 },
    async () => {
      const f = await fixture(),
        original = fs.stat;
      let release, began;
      const gate = new Promise((r) => {
          release = r;
        }),
        entered = new Promise((r) => {
          began = r;
        });
      fs.stat = async function (file, ...args) {
        if (path.resolve(String(file)) === path.resolve(process.execPath)) {
          began();
          await gate;
        }
        return original.call(this, file, ...args);
      };
      syncBuiltinESMExports();
      const hook = inject(f);
      let starting;
      try {
        starting = f.jobs.terminal(
          '.',
          process.execPath,
          ['-e', "require('fs').writeFileSync('must-not-run.txt','bad')"],
          30,
          'pending',
        );
        await entered;
        assert.equal((await f.jobs.status('pending')).status, 'running');
        const stopped = cancelMode === 'cancel' ? f.jobs.cancel('pending') : f.jobs.close();
        release();
        const job = await starting;
        await stopped;
        assert.equal(job.status, 'cancelled');
        assert.equal(job.exitCode, null);
        assert.equal(hook.spawns(), 0);
        await assert.rejects(fs.access(path.join(f.root, 'must-not-run.txt')), (e) => e.code === 'ENOENT');
        assert.equal(JSON.parse(await fs.readFile(f.file('pending'), 'utf8')).status, 'cancelled');
      } finally {
        release();
        fs.stat = original;
        hook.restore();
        await starting?.catch(() => {});
      }
    },
  );
test('status remains owned while a missing-executable result is being saved', async () => {
  const f = await fixture(),
    save = f.jobs.save.bind(f.jobs);
  let release, began;
  const gate = new Promise((r) => {
      release = r;
    }),
    entered = new Promise((r) => {
      began = r;
    });
  f.jobs.save = async function (job, exclusive, ...rest) {
    if (!exclusive) {
      began();
      await gate;
    }
    return save(job, exclusive, ...rest);
  };
  let starting;
  try {
    starting = launch(f, 'delayed');
    await entered;
    assert.equal((await f.jobs.status('delayed')).status, 'running');
    release();
    assert.equal((await starting).errorCode, 'EXECUTABLE_NOT_FOUND');
    assert.equal(f.jobs.live.size, 0);
  } finally {
    release();
    f.jobs.save = save;
    await starting?.catch(() => {});
  }
});
test('exclusive intent write failure creates no retained phantom result or occupied slot', async () => {
  const f = await fixture(),
    original = fs.link;
  fs.link = async () => {
    throw Object.assign(new Error('exclusive fixture fault'), { code: 'EIO' });
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(launch(f, 'not-admitted'), (e) => e.code === 'EIO');
    assert.equal(f.jobs.live.size, 0);
    await assert.rejects(f.jobs.status('not-admitted'), (e) => e.code === 'UNKNOWN_JOB');
  } finally {
    fs.link = original;
    syncBuiltinESMExports();
  }
});
