import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import { Workspace } from '../dist/workspace.js';
import { Jobs, MAX_CONCURRENT_JOBS } from '../dist/jobs.js';
import { limits, errorDetails } from '../dist/core.js';
let suite,
  sequence = 0;
const owners = [];
before(async () => {
  suite = await fs.mkdtemp(path.join(os.tmpdir(), 'wb-capacity-'));
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
  return { root, state, workspace, jobs, directory: path.join(state, 'jobs') };
}
function capacity(report, occupied, retained = 0) {
  const c = report.capacity;
  assert.ok(c, 'Owner capacity must be visible even when no process is running');
  assert.equal(c.schemaVersion, 1);
  assert.equal(c.limit, MAX_CONCURRENT_JOBS);
  assert.equal(c.occupied, occupied);
  assert.equal(c.available, MAX_CONCURRENT_JOBS - occupied);
  assert.equal(c.retainedResults, retained);
  assert.equal(c.inProgress, occupied - retained);
  assert.equal(c.jobs.length, occupied);
  assert.equal(c.jobs.filter((j) => j.kind === 'retained_result').length, retained);
  assert.deepEqual(
    c.jobs.map((j) => j.jobId),
    c.jobs.map((j) => j.jobId).sort(),
  );
  for (const j of c.jobs) {
    assert.equal(j.nextAction, j.kind === 'retained_result' ? 'command_retry_save' : 'command_status');
    assert.equal(Object.hasOwn(j, 'output'), false);
    assert.equal(Object.hasOwn(j, 'command'), false);
  }
  return c;
}
async function hold(f, id) {
  const original = fs.rename;
  fs.rename = async function (a, b, ...rest) {
    if (path.resolve(String(b)) === path.join(f.directory, id + '.json'))
      throw Object.assign(new Error('private publication fault'), { code: 'EIO' });
    return original.call(this, a, b, ...rest);
  };
  syncBuiltinESMExports();
  try {
    const job = await f.jobs.terminal('.', path.join(f.root, 'missing.exe'), [], 30, id);
    assert.equal(job.errorCode, 'JOB_RECORD_SAVE_FAILED');
    return job;
  } finally {
    fs.rename = original;
    syncBuiltinESMExports();
  }
}
async function active(f, id = 'active') {
  await f.jobs.terminal('.', process.execPath, ['-e', 'setInterval(()=>{},1000)'], 30, id);
  return f.jobs.live.get(id);
}

test('idle diagnostics show thirty-six available slots and no inventory directory is created', async () => {
  const f = await fixture(),
    r = await f.jobs.recent();
  capacity(r, 0);
  assert.equal(r.storedJobs, 0);
  assert.equal(r.runningJobs, 0);
  assert.equal(r.inventory.complete, true);
  assert.equal(r.inventory.errorCode, null);
  assert.equal(r.capacity.closing, false);
  await assert.rejects(fs.access(f.directory), (e) => e.code === 'ENOENT');
});

test('thirty-six retained results explain zero running jobs, JOB_LIMIT, and explicit recovery without rerun', async () => {
  const f = await fixture();
  for (let n = MAX_CONCURRENT_JOBS - 1; n >= 0; n--) await hold(f, 'held-' + n);
  const before = await fs.readFile(path.join(f.directory, 'held-0.json'));
  const r = await f.jobs.recent(),
    c = capacity(r, MAX_CONCURRENT_JOBS, MAX_CONCURRENT_JOBS);
  assert.equal(r.runningJobs, 0);
  assert.equal(r.storedJobs, MAX_CONCURRENT_JOBS);
  let error;
  try {
    await f.jobs.terminal(
      '.',
      process.execPath,
      ['-e', "require('fs').writeFileSync('must-not-run.txt','bad')"],
      30,
      'overflow',
    );
  } catch (e) {
    error = e;
  }
  assert.equal(error?.code, 'JOB_LIMIT');
  const details = errorDetails(error);
  assert.deepEqual(details.details.capacity, c);
  assert.equal(details.details.nextAction, 'diagnostics');
  assert.equal((await f.jobs.recent()).capacity.occupied, MAX_CONCURRENT_JOBS);
  assert.deepEqual(await fs.readFile(path.join(f.directory, 'held-0.json')), before);
  await assert.rejects(fs.access(path.join(f.root, 'must-not-run.txt')), (e) => e.code === 'ENOENT');
  const recovery = await f.jobs.retrySave('held-0');
  assert.equal(recovery.job.errorCode, 'EXECUTABLE_NOT_FOUND');
  capacity(await f.jobs.recent(), MAX_CONCURRENT_JOBS - 1, MAX_CONCURRENT_JOBS - 1);
  await f.jobs.retrySave('held-0');
  capacity(await f.jobs.recent(), MAX_CONCURRENT_JOBS - 1, MAX_CONCURRENT_JOBS - 1);
  for (let n = 1; n < MAX_CONCURRENT_JOBS; n++) await f.jobs.retrySave('held-' + n);
  capacity(await f.jobs.recent(), 0);
});

test('mixed active and retained jobs expose separate counts and compact IDs', async () => {
  const f = await fixture();
  await active(f);
  await hold(f, 'held');
  try {
    const r = await f.jobs.recent();
    capacity(r, 2, 1);
    assert.equal(r.runningJobs, 1);
    assert.equal(r.capacity.jobs.find((j) => j.jobId === 'active').kind, 'in_progress');
    assert.equal(r.capacity.jobs.find((j) => j.jobId === 'held').status, 'failed');
    assert.equal(JSON.stringify(r.capacity).includes('missing.exe'), false);
  } finally {
    await f.jobs.cancel('active');
    await f.jobs.retrySave('held');
  }
  capacity(await f.jobs.recent(), 0);
});

for (const outcome of ['success', 'cancelled'])
  test(outcome + ' finalization occupies capacity until the final record is published', async () => {
    const f = await fixture(),
      original = f.jobs.save.bind(f.jobs);
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
      return original(job, exclusive, ...rest);
    };
    let pending;
    try {
      await f.jobs.terminal(
        '.',
        process.execPath,
        ['-e', outcome === 'success' ? "console.log('done')" : 'setInterval(()=>{},1000)'],
        30,
        'finish',
      );
      const owned = f.jobs.live.get('finish');
      assert.ok(owned);
      pending = outcome === 'success' ? owned.done : f.jobs.cancel('finish');
      await entered;
      const r = await f.jobs.recent();
      capacity(r, 1);
      assert.equal(r.runningJobs, outcome === 'success' ? 1 : 0);
      assert.equal(r.capacity.jobs[0].status, outcome === 'success' ? 'running' : 'cancelled');
      release();
      await pending;
      capacity(await f.jobs.recent(), 0);
    } finally {
      release();
      f.jobs.save = original;
      await pending?.catch(() => {});
    }
  });

test('recovery is visible during publication and frees exactly one slot for concurrent callers', async () => {
  const f = await fixture();
  await hold(f, 'held');
  const original = f.jobs.save.bind(f.jobs);
  let release, began;
  const gate = new Promise((r) => {
      release = r;
    }),
    entered = new Promise((r) => {
      began = r;
    });
  f.jobs.save = async function (...args) {
    began();
    await gate;
    return original(...args);
  };
  let calls;
  try {
    calls = Promise.all([f.jobs.retrySave('held'), f.jobs.retrySave('held')]);
    await entered;
    capacity(await f.jobs.recent(), 1, 1);
    release();
    const results = await calls;
    assert.deepEqual(
      results.map((r) => r.publication),
      ['saved', 'already_saved'],
    );
    capacity(await f.jobs.recent(), 0);
  } finally {
    release();
    f.jobs.save = original;
    await calls?.catch(() => {});
  }
});

test('closing state is explicit even with free slots and diagnostics never admits work', async () => {
  const f = await fixture();
  await f.jobs.close();
  const r = await f.jobs.recent();
  capacity(r, 0);
  assert.equal(r.capacity.closing, true);
  await assert.rejects(
    f.jobs.terminal('.', process.execPath, [], 30, 'new'),
    (e) => e.code === 'SERVER_CLOSING',
  );
});

test('unreadable inventory keeps owner capacity and reports unknown rather than zero saved jobs', async () => {
  const f = await fixture();
  await hold(f, 'held');
  const original = fs.opendir;
  fs.opendir = async function (p, ...a) {
    if (path.resolve(String(p)) === f.directory)
      throw Object.assign(new Error('private read denied'), { code: 'EACCES' });
    return original.call(this, p, ...a);
  };
  syncBuiltinESMExports();
  try {
    const r = await f.jobs.recent();
    capacity(r, 1, 1);
    assert.equal(r.storedJobs, null);
    assert.equal(r.inventory.complete, false);
    assert.equal(r.inventory.errorCode, 'UNREADABLE_JOB_CATALOG');
  } finally {
    fs.opendir = original;
    syncBuiltinESMExports();
  }
  assert.equal((await f.jobs.recent()).storedJobs, 1);
  await f.jobs.retrySave('held');
});

for (const storage of ['file', 'link'])
  test(storage + ' catalog is not traversed and is not reported empty', async () => {
    const f = await fixture();
    await fs.mkdir(f.state);
    if (storage === 'file') await fs.writeFile(f.directory, 'not directory');
    else {
      const outside = path.join(f.root, 'private-target');
      await fs.mkdir(outside);
      await fs.writeFile(path.join(outside, 'external.json'), 'do not read');
      await fs.symlink(outside, f.directory, process.platform === 'win32' ? 'junction' : 'dir');
    }
    const r = await f.jobs.recent();
    capacity(r, 0);
    assert.equal(r.storedJobs, null);
    assert.equal(r.inventory.complete, false);
    assert.equal(r.inventory.errorCode, 'UNREADABLE_JOB_CATALOG');
  });

test('entry budget produces an explicit lower-bound count without opening record contents', async () => {
  const f = await fixture();
  await fs.mkdir(f.directory, { recursive: true });
  for (let n = 0; n < 6; n++)
    await fs.writeFile(path.join(f.directory, 'saved-' + n + '.json'), '{not parsed');
  const limit = limits.scanEntries,
    open = fs.open;
  limits.scanEntries = 3;
  fs.open = async () => {
    throw new Error('Diagnostics must not open job records');
  };
  syncBuiltinESMExports();
  try {
    const r = await f.jobs.recent();
    capacity(r, 0);
    assert.equal(r.storedJobs, 3);
    assert.equal(r.inventory.scannedEntries, 3);
    assert.equal(r.inventory.limitReached, true);
    assert.equal(r.inventory.complete, false);
    assert.equal(r.inventory.errorCode, null);
  } finally {
    limits.scanEntries = limit;
    fs.open = open;
    syncBuiltinESMExports();
  }
});

test('time budget is distinct from an empty complete inventory', async () => {
  const f = await fixture();
  await fs.mkdir(f.directory, { recursive: true });
  await fs.writeFile(path.join(f.directory, 'saved.json'), '{}');
  const old = limits.scanMs;
  limits.scanMs = 0;
  try {
    const r = await f.jobs.recent();
    assert.equal(r.storedJobs, 0);
    assert.equal(r.inventory.scannedEntries, 0);
    assert.equal(r.inventory.timeLimitReached, true);
    assert.equal(r.inventory.complete, false);
    capacity(r, 0);
  } finally {
    limits.scanMs = old;
  }
});

test('iteration failure does not present a partial inventory as an exact count', async () => {
  const f = await fixture();
  await fs.mkdir(f.directory, { recursive: true });
  const original = fs.opendir;
  fs.opendir = async () => ({
    async *[Symbol.asyncIterator]() {
      yield { name: 'first.json' };
      throw Object.assign(new Error('private iteration fault'), { code: 'EIO' });
    },
  });
  syncBuiltinESMExports();
  try {
    const r = await f.jobs.recent();
    assert.equal(r.storedJobs, null);
    assert.equal(r.inventory.scannedEntries, 1);
    assert.equal(r.inventory.complete, false);
    assert.equal(r.inventory.errorCode, 'UNREADABLE_JOB_CATALOG');
    capacity(r, 0);
  } finally {
    fs.opendir = original;
    syncBuiltinESMExports();
  }
});

test('saved records and an old interrupted record do not occupy the new owner capacity', async () => {
  const f = await fixture();
  await f.jobs.terminal('.', path.join(f.root, 'missing.exe'), [], 30, 'saved');
  await fs.writeFile(path.join(f.directory, 'old.json'), '{historical bytes, intentionally not validated}');
  const other = new Jobs(f.workspace, f.state);
  owners.push(other);
  const r = await other.recent();
  capacity(r, 0);
  assert.equal(r.storedJobs, 2);
  assert.equal(r.inventory.complete, true);
  assert.equal(r.runningJobs, 0);
});
