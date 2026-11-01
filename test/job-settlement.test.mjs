import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Workspace } from '../dist/workspace.js';
import { Jobs } from '../dist/jobs.js';
let suite,
  sequence = 0;
const owners = [];
before(async () => {
  suite = await fs.mkdtemp(path.join(os.tmpdir(), 'wb-settlement-'));
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
  return { root, state, workspace, jobs, file: path.join(state, 'jobs/job.json') };
}
async function bound(p) {
  let timer;
  try {
    return await Promise.race([
      p,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Private gate did not settle')), 10000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function gate(f, fail = false) {
  const original = f.jobs.save.bind(f.jobs);
  let release, enter;
  const wait = new Promise((r) => {
      release = r;
    }),
    entered = new Promise((r) => {
      enter = r;
    });
  f.jobs.save = async (job, exclusive, ...rest) => {
    if (!exclusive) {
      enter();
      await wait;
      if (fail) throw Object.assign(new Error('Private save fault'), { code: 'EIO' });
    }
    return original(job, exclusive, ...rest);
  };
  return {
    entered,
    release,
    restore() {
      f.jobs.save = original;
    },
  };
}
for (const outcome of ['passed', 'failed', 'cancelled', 'timed_out', 'prelaunch'])
  test(outcome + ' stays completion-pending through its final publication', { timeout: 15000 }, async () => {
    const f = await fixture(),
      g = gate(f);
    let launch, cancellation, owned;
    try {
      const hold = ['cancelled', 'timed_out'].includes(outcome),
        args = [
          '-e',
          hold
            ? "console.log('started');setInterval(()=>{},1000)"
            : `console.log('result');process.exitCode=${outcome === 'failed' ? 7 : 0}`,
        ];
      launch = f.jobs.terminal(
        '.',
        outcome === 'prelaunch' ? path.join(f.root, 'missing.exe') : process.execPath,
        args,
        outcome === 'timed_out' ? 1 : 30,
        'job',
      );
      if (outcome !== 'prelaunch') {
        const initial = await launch;
        assert.equal(initial.completionPending, true);
        owned = f.jobs.live.get('job');
        assert.ok(owned);
        if (outcome === 'cancelled') cancellation = f.jobs.cancel('job');
      }
      await bound(g.entered);
      const pending = await f.jobs.status('job');
      assert.equal(pending.completionPending, true);
      assert.equal(pending.status, hold ? outcome : 'running');
      assert.equal(pending.endedAt, undefined);
      assert.equal((await f.jobs.output('job')).completionPending, true);
      assert.equal(
        (await f.jobs.catalog({ offset: 0, limit: 10, scanLimit: 20 })).jobs[0].completionPending,
        true,
      );
      assert.equal((await f.jobs.recent()).capacity.occupied, 1);
      assert.equal(Object.hasOwn(JSON.parse(await fs.readFile(f.file, 'utf8')), 'completionPending'), false);
      // Pre-launch terminal() still owns the serialized admission queue until publication.
      if (outcome !== 'prelaunch')
        await assert.rejects(f.jobs.retrySave('job'), (e) => e.code === 'JOB_SAVE_NOT_READY');
      g.release();
      await launch;
      await cancellation;
      await bound(owned?.done ?? Promise.resolve());
      const final = await f.jobs.status('job');
      assert.equal(final.status, outcome === 'prelaunch' ? 'failed' : outcome);
      assert.equal(final.completionPending, false);
      assert.ok(final.endedAt);
      assert.equal(f.jobs.live.size, 0);
      const bytes = await fs.readFile(f.file);
      assert.equal(Object.hasOwn(JSON.parse(bytes.toString('utf8')), 'completionPending'), false);
      const reconstructed = new Jobs(f.workspace, f.state);
      owners.push(reconstructed);
      assert.deepEqual(await reconstructed.status('job'), final);
      assert.deepEqual(await fs.readFile(f.file), bytes);
    } finally {
      g.release();
      g.restore();
      await launch;
      await cancellation;
    }
  });

test(
  'a retained failure is no longer pending but still requires explicit result recovery',
  { timeout: 15000 },
  async () => {
    const f = await fixture(),
      g = gate(f, true);
    try {
      await f.jobs.terminal('.', process.execPath, ['-e', "console.log('kept')"], 30, 'job');
      const owned = f.jobs.live.get('job');
      await bound(g.entered);
      assert.equal((await f.jobs.status('job')).completionPending, true);
      g.release();
      await bound(owned.done);
      const failed = await f.jobs.status('job');
      assert.equal(failed.completionPending, false);
      assert.equal(failed.errorCode, 'JOB_RECORD_SAVE_FAILED');
      assert.equal((await f.jobs.recent()).capacity.retainedResults, 1);
      g.restore();
      const saved = await f.jobs.retrySave('job');
      assert.equal(saved.job.completionPending, false);
      assert.equal(saved.job.status, 'passed');
      assert.equal(saved.commandRerun, false);
      assert.equal((await f.jobs.output('job')).text, 'kept\n');
    } finally {
      g.release();
      g.restore();
    }
  },
);

test('legacy finalized and interrupted records derive completion state without trusting or rewriting disk fields', async () => {
  const f = await fixture();
  await f.jobs.terminal('.', path.join(f.root, 'missing.exe'), [], 30, 'job');
  const record = JSON.parse(await fs.readFile(f.file, 'utf8'));
  record.completionPending = true;
  await fs.writeFile(f.file, JSON.stringify(record));
  const before = await fs.readFile(f.file);
  assert.equal((await f.jobs.status('job')).completionPending, false);
  assert.equal((await f.jobs.retrySave('job')).job.completionPending, false);
  assert.deepEqual(await fs.readFile(f.file), before);
  record.status = 'running';
  delete record.endedAt;
  delete record.error;
  delete record.errorCode;
  await fs.writeFile(f.file, JSON.stringify(record));
  const interrupted = await f.jobs.status('job');
  assert.equal(interrupted.status, 'interrupted');
  assert.equal(interrupted.completionPending, false);
  assert.equal((await f.jobs.recent()).capacity.occupied, 0);
});

test('active job replay stays pending and cancellation waits for its one owned execution', async () => {
  const f = await fixture(),
    args = ['-e', 'setInterval(()=>{},1000)'];
  const initial = await f.jobs.terminal('.', process.execPath, args, 30, 'job');
  assert.equal(initial.completionPending, true);
  assert.equal((await f.jobs.terminal('.', process.execPath, args, 30, 'job')).completionPending, true);
  assert.equal((await f.jobs.recent()).capacity.occupied, 1);
  const ended = await f.jobs.cancel('job');
  assert.equal(ended.status, 'cancelled');
  assert.equal(ended.completionPending, false);
  assert.equal((await f.jobs.recent()).capacity.occupied, 0);
});
