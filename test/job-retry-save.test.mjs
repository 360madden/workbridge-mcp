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
  suite = await fs.mkdtemp(path.join(os.tmpdir(), 'wb-retry-save-'));
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
const command = [
  '-e',
  "require('fs').appendFileSync('count.txt','1');process.stdout.write('kept stdout');process.stderr.write('kept stderr');",
];
function failPublication(f) {
  const original = fs.rename;
  let blocked = true,
    attempts = 0;
  fs.rename = async function (from, to, ...rest) {
    if (path.dirname(path.resolve(String(to))) === path.join(f.state, 'jobs')) {
      attempts++;
      if (blocked) throw Object.assign(new Error('fixture-only publication failure'), { code: 'EIO' });
    }
    return original.call(this, from, to, ...rest);
  };
  syncBuiltinESMExports();
  return {
    release() {
      blocked = false;
    },
    attempts: () => attempts,
    restore() {
      fs.rename = original;
      syncBuiltinESMExports();
    },
  };
}
async function retain(f, id = 'retained', args = command, timeout = 30, cancel = false) {
  await f.jobs.terminal('.', process.execPath, args, timeout, id);
  const entry = f.jobs.live.get(id);
  assert.ok(entry);
  if (cancel) {
    // The counter is written before stdout/stderr and is not output-readiness evidence.
    // Observe the captured streams this test later asserts before requesting cancellation.
    const deadline = Date.now() + 10000;
    let captured = false;
    while (Date.now() < deadline) {
      const stdout = await f.jobs.output(id, 0, 100, 'stdout');
      const stderr = await f.jobs.output(id, 0, 100, 'stderr');
      if (stdout.text === 'kept stdout' && stderr.text === 'kept stderr') {
        captured = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await f.jobs.cancel(id);
    assert.equal(captured, true, 'Private fixture output was not captured before cancellation.');
  }
  await entry.done;
  assert.equal((await f.jobs.status(id)).errorCode, 'JOB_RECORD_SAVE_FAILED');
  return { id, args, timeout, bytes: await fs.readFile(f.file(id)) };
}
async function recover(f, id = 'retained') {
  assert.equal(typeof f.jobs.retrySave, 'function', 'Explicit save recovery API is required');
  return f.jobs.retrySave(id);
}
async function count(f, expected = '1') {
  assert.equal(await fs.readFile(path.join(f.root, 'count.txt'), 'utf8'), expected);
}

for (const [label, suffix, expectedStatus, exitCode, timeout, cancel] of [
  ['success', '', 'passed', 0, 30, false],
  ['failed child', 'process.exitCode=7;', 'failed', 7, 30, false],
  ['cancellation', 'setInterval(()=>{},1000);', 'cancelled', null, 30, true],
  // A one-second whole-suite deadline can expire before a contended Windows Node child emits its fixture output.
  ['timeout', 'setInterval(()=>{},1000);', 'timed_out', null, 5, false],
])
  test(`explicit recovery preserves ${label}, output, and request identity without executing twice`, async () => {
    const f = await fixture(),
      hook = failPublication(f);
    try {
      const args = ['-e', command[1] + suffix],
        original = await retain(f, 'retained', args, timeout, cancel);
      hook.release();
      const result = await recover(f);
      assert.equal(result.schemaVersion, 1);
      assert.equal(result.publication, 'saved');
      assert.equal(result.commandRerun, false);
      assert.equal(result.job.status, expectedStatus);
      assert.equal(result.job.exitCode, exitCode);
      assert.equal(result.job.errorCode, undefined);
      assert.equal((await f.jobs.output('retained', 0, 100, 'stdout')).text, 'kept stdout');
      assert.equal((await f.jobs.output('retained', 0, 100, 'stderr')).text, 'kept stderr');
      const saved = await fs.readFile(f.file('retained'));
      assert.notDeepEqual(saved, original.bytes);
      assert.equal(JSON.parse(saved).status, expectedStatus);
      assert.equal((await recover(f)).publication, 'already_saved');
      assert.deepEqual(await fs.readFile(f.file('retained')), saved);
      assert.equal(
        (await f.jobs.terminal('.', process.execPath, args, timeout, 'retained')).status,
        expectedStatus,
      );
      await count(f);
      const reconstructed = new Jobs(f.workspace, f.state);
      owners.push(reconstructed);
      assert.equal((await reconstructed.retrySave('retained')).publication, 'already_saved');
      assert.equal((await reconstructed.status('retained')).status, expectedStatus);
      await count(f);
    } finally {
      hook.restore();
    }
  });

test('another failed save leaves the retained result and capacity intact; explicit later recovery succeeds', async () => {
  const f = await fixture(),
    hook = failPublication(f);
  try {
    const original = await retain(f);
    await assert.rejects(recover(f), (e) => e.code === 'JOB_RECORD_SAVE_FAILED');
    assert.deepEqual(await fs.readFile(f.file('retained')), original.bytes);
    assert.equal((await f.jobs.status('retained')).errorCode, 'JOB_RECORD_SAVE_FAILED');
    assert.equal((await f.jobs.output('retained', 0, 100, 'stdout')).text, 'kept stdout');
    hook.release();
    assert.equal((await recover(f)).job.status, 'passed');
    await count(f);
  } finally {
    hook.restore();
  }
});

test('concurrent save-recovery callers publish once and share the completed result', async () => {
  const f = await fixture(),
    hook = failPublication(f);
  try {
    await retain(f);
    hook.release();
    const before = hook.attempts();
    const results = await Promise.all(Array.from({ length: 8 }, () => recover(f)));
    assert.equal(results.filter((r) => r.publication === 'saved').length, 1);
    assert.equal(results.filter((r) => r.publication === 'already_saved').length, 7);
    assert.equal(hook.attempts() - before, 1);
    await count(f);
  } finally {
    hook.restore();
  }
});

test('recovery releases occupied capacity without owner restart', async () => {
  const f = await fixture(),
    hook = failPublication(f);
  try {
    await Promise.all(Array.from({ length: MAX_CONCURRENT_JOBS }, (_, n) => retain(f, 'held-' + n)));
    await assert.rejects(
      f.jobs.terminal('.', process.execPath, command, 30, 'next'),
      (e) => e.code === 'JOB_LIMIT',
    );
    hook.release();
    const r = await recover(f, 'held-0');
    assert.equal(r.job.status, 'passed');
    await f.jobs.terminal('.', process.execPath, command, 30, 'next');
    await f.jobs.live.get('next').done;
    assert.equal((await f.jobs.status('next')).status, 'passed');
    await count(f, '1'.repeat(MAX_CONCURRENT_JOBS + 1));
    for (let n = 1; n < MAX_CONCURRENT_JOBS; n++) await recover(f, 'held-' + n);
    assert.equal(f.jobs.live.size, 0);
  } finally {
    hook.restore();
  }
});

for (const [label, transform, expected] of [
  [
    'later valid edit',
    (b) => JSON.stringify({ ...JSON.parse(b), output: 'later bytes', stdout: 'later bytes' }),
    'JOB_SAVE_CONFLICT',
  ],
  ['unknown-field edit', (b) => JSON.stringify({ ...JSON.parse(b), extra: 'newer' }), 'JOB_SAVE_CONFLICT'],
  ['malformed record', () => '{broken', 'UNREADABLE_JOB_RECORD'],
])
  test(`${label} is preserved and recovery does not discard retained output`, async () => {
    const f = await fixture(),
      hook = failPublication(f);
    try {
      await retain(f);
      hook.release();
      await fs.writeFile(f.file('retained'), transform(await fs.readFile(f.file('retained'), 'utf8')));
      const saved = await fs.readFile(f.file('retained'));
      await assert.rejects(recover(f), (e) => e.code === expected);
      assert.deepEqual(await fs.readFile(f.file('retained')), saved);
      assert.equal((await f.jobs.output('retained', 0, 100, 'stdout')).text, 'kept stdout');
      await count(f);
    } finally {
      hook.restore();
    }
  });

for (const storage of ['missing record', 'missing directory', 'linked directory', 'directory record'])
  test(`${storage} is refused without implicit recreation or overwrite`, async () => {
    const f = await fixture(),
      hook = failPublication(f);
    try {
      await retain(f);
      hook.release();
      const directory = path.join(f.state, 'jobs');
      if (storage === 'missing record') await fs.rename(f.file('retained'), f.file('saved-original'));
      if (storage === 'missing directory') await fs.rename(directory, path.join(f.state, 'saved-jobs'));
      if (storage === 'linked directory') {
        const real = path.join(f.state, 'saved-jobs');
        await fs.rename(directory, real);
        await fs.symlink(real, directory, process.platform === 'win32' ? 'junction' : 'dir');
      }
      if (storage === 'directory record') {
        await fs.rename(f.file('retained'), f.file('saved-original'));
        await fs.mkdir(f.file('retained'));
      }
      await assert.rejects(recover(f), (e) =>
        ['JOB_SAVE_CONFLICT', 'UNREADABLE_JOB_RECORD'].includes(e.code),
      );
      if (storage === 'missing record' || storage === 'missing directory')
        await assert.rejects(fs.access(f.file('retained')), (e) => e.code === 'ENOENT');
      assert.equal((await f.jobs.status('retained')).errorCode, 'JOB_RECORD_SAVE_FAILED');
      await count(f);
    } finally {
      hook.restore();
    }
  });

test('already-written exact final bytes are acknowledged without a redundant write', async () => {
  const f = await fixture(),
    hook = failPublication(f);
  try {
    await retain(f);
    hook.release();
    const entry = f.jobs.live.get('retained');
    assert.ok(entry.pending?.result);
    await fs.writeFile(f.file('retained'), JSON.stringify(entry.pending.result));
    const before = hook.attempts();
    assert.equal((await recover(f)).publication, 'already_saved');
    assert.equal(hook.attempts(), before);
    assert.equal(f.jobs.live.size, 0);
    await count(f);
  } finally {
    hook.restore();
  }
});

test('running jobs and unknown or interrupted results cannot be repaired or rerun', async () => {
  const f = await fixture();
  await f.jobs.terminal('.', process.execPath, ['-e', 'setInterval(()=>{},1000)'], 30, 'active');
  await assert.rejects(recover(f, 'active'), (e) => e.code === 'JOB_SAVE_NOT_READY');
  await f.jobs.cancel('active');
  await assert.rejects(recover(f, 'missing'), (e) => e.code === 'UNKNOWN_JOB');
  await assert.rejects(recover(f, '../bad'), (e) => e.code === 'INVALID_JOB_ID');
  const old = JSON.parse(await fs.readFile(f.file('active'), 'utf8'));
  old.id = 'old';
  old.status = 'running';
  old.exitCode = null;
  delete old.endedAt;
  await fs.writeFile(f.file('old'), JSON.stringify(old));
  const bytes = await fs.readFile(f.file('old'));
  await assert.rejects(recover(f, 'old'), (e) => e.code === 'JOB_RESULT_UNAVAILABLE');
  assert.deepEqual(await fs.readFile(f.file('old')), bytes);
});

test('recovery rechecks changed bytes between transient publication attempts', async () => {
  const f = await fixture(),
    hook = failPublication(f);
  let prior;
  try {
    await retain(f);
    hook.release();
    prior = fs.rename;
    let writes = 0;
    fs.rename = async function (from, to, ...rest) {
      if (path.resolve(String(to)) === f.file('retained')) {
        writes++;
        await fs.writeFile(
          to,
          JSON.stringify({
            ...JSON.parse(await fs.readFile(to, 'utf8')),
            extra: 'edit between retry attempts',
          }),
        );
        throw Object.assign(new Error('transient fixture failure'), { code: 'EPERM' });
      }
      return prior.call(this, from, to, ...rest);
    };
    syncBuiltinESMExports();
    await assert.rejects(recover(f), (e) => e.code === 'JOB_SAVE_CONFLICT');
    assert.equal(writes, 1);
    assert.equal(
      JSON.parse(await fs.readFile(f.file('retained'), 'utf8')).extra,
      'edit between retry attempts',
    );
    assert.equal((await f.jobs.status('retained')).errorCode, 'JOB_RECORD_SAVE_FAILED');
    await count(f);
  } finally {
    hook.restore();
  }
});

test('readback detects replacement after publication and retains the original result', async () => {
  const f = await fixture(),
    hook = failPublication(f);
  let prior;
  try {
    await retain(f);
    hook.release();
    prior = fs.rename;
    fs.rename = async function (from, to, ...rest) {
      const result = await prior.call(this, from, to, ...rest);
      if (path.resolve(String(to)) === f.file('retained'))
        await fs.writeFile(
          to,
          JSON.stringify({ ...JSON.parse(await fs.readFile(to, 'utf8')), extra: 'later external write' }),
        );
      return result;
    };
    syncBuiltinESMExports();
    await assert.rejects(recover(f), (e) => e.code === 'JOB_SAVE_CONFLICT');
    assert.equal(JSON.parse(await fs.readFile(f.file('retained'), 'utf8')).extra, 'later external write');
    assert.equal((await f.jobs.output('retained', 0, 100, 'stdout')).text, 'kept stdout');
    await count(f);
  } finally {
    hook.restore();
  }
});

test('normal finalization cannot be mistaken for retained-result recovery', async () => {
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
  try {
    await f.jobs.terminal('.', process.execPath, command, 30, 'normal');
    const done = f.jobs.live.get('normal').done;
    await entered;
    await assert.rejects(recover(f, 'normal'), (e) => e.code === 'JOB_SAVE_NOT_READY');
    release();
    await done;
    assert.equal((await recover(f, 'normal')).publication, 'already_saved');
    await count(f);
  } finally {
    release();
    f.jobs.save = save;
  }
});

test('owner shutdown waits for an already-started recovery and refuses another one', async () => {
  const f = await fixture(),
    hook = failPublication(f);
  let release;
  try {
    await retain(f);
    hook.release();
    const save = f.jobs.save.bind(f.jobs);
    let began;
    const entered = new Promise((r) => {
        began = r;
      }),
      gate = new Promise((r) => {
        release = r;
      });
    f.jobs.save = async function (...args) {
      began();
      await gate;
      return save(...args);
    };
    const saving = recover(f);
    await entered;
    const closing = f.jobs.close();
    release();
    assert.equal((await saving).job.status, 'passed');
    await closing;
    await assert.rejects(recover(f), (e) => e.code === 'SERVER_CLOSING');
    assert.equal(JSON.parse(await fs.readFile(f.file('retained'), 'utf8')).status, 'passed');
    await count(f);
  } finally {
    release?.();
    hook.restore();
  }
});

test('a new owner cannot reconstruct an unsaved result, and closing refuses new recovery', async () => {
  const f = await fixture(),
    hook = failPublication(f);
  try {
    await retain(f);
    hook.release();
    const other = new Jobs(f.workspace, f.state);
    owners.push(other);
    await assert.rejects(other.retrySave('retained'), (e) => e.code === 'JOB_RESULT_UNAVAILABLE');
    assert.equal((await other.status('retained')).status, 'interrupted');
    await recover(f);
    await f.jobs.close();
    await assert.rejects(recover(f), (e) => e.code === 'SERVER_CLOSING');
    await count(f);
  } finally {
    hook.restore();
  }
});
