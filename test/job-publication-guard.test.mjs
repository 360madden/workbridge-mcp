import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import { Workspace } from '../dist/workspace.js';
import { Jobs } from '../dist/jobs.js';
let suite,
  sequence = 0;
const owners = [];
before(async () => {
  suite = await fs.mkdtemp(path.join(os.tmpdir(), 'wb-publication-'));
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
const args = ['-e', "require('fs').appendFileSync('count.txt','1');console.log('original output')"];
async function start(f, outcome = 'passed') {
  const executable = outcome === 'prelaunch' ? path.join(f.root, 'missing.exe') : process.execPath;
  const command =
    outcome === 'failed'
      ? [...args.slice(0, 1), args[1] + ';process.exitCode=7']
      : ['cancelled', 'timed_out'].includes(outcome)
        ? ['-e', "console.log('active');setInterval(()=>{},1000)"]
        : args;
  const timeout = outcome === 'timed_out' ? 1 : 30;
  f.definition = { executable, args: command, timeout };
  await f.jobs.terminal('.', executable, command, timeout, 'job');
  const live = f.jobs.live.get('job');
  if (outcome === 'cancelled') await f.jobs.cancel('job');
  else if (live) await live.done;
  return f.jobs.status('job');
}
function intercept(f, hook) {
  const original = f.jobs.save.bind(f.jobs);
  let seen = false;
  f.jobs.save = async function (job, exclusive, ...rest) {
    if (exclusive) {
      const r = await original(job, exclusive, ...rest);
      f.initial = await fs.readFile(f.file);
      return r;
    }
    if (!seen) {
      seen = true;
      return hook(job, () => original(job, exclusive, ...rest));
    }
    return original(job, exclusive, ...rest);
  };
  return () => {
    f.jobs.save = original;
  };
}
async function retained(f, expected = 'passed') {
  const job = await f.jobs.status('job');
  assert.equal(job.status, 'failed');
  assert.equal(job.errorCode, 'JOB_RECORD_SAVE_FAILED');
  assert.equal(job.completionPending, false);
  assert.equal(f.jobs.live.size, 1);
  assert.equal(f.jobs.live.get('job').pending.result.status, expected);
  assert.equal((await f.jobs.recent()).capacity.retainedResults, 1);
  const d = f.definition;
  assert.deepEqual(await f.jobs.terminal('.', d.executable, d.args, d.timeout, 'job'), job);
  return job;
}
async function recoverFixture(f, expected = 'passed') {
  // Test-owned fixtures only: restore their exact saved intent after proving refusal.
  await fs.writeFile(f.file, f.initial);
  const recovered = await f.jobs.retrySave('job');
  assert.equal(recovered.commandRerun, false);
  assert.equal(recovered.publication, 'saved');
  assert.equal(recovered.job.status, expected);
  assert.equal(recovered.job.completionPending, false);
  assert.equal(f.jobs.live.size, 0);
  assert.equal((await f.jobs.retrySave('job')).publication, 'already_saved');
  return recovered.job;
}
for (const mode of ['changed', 'missing', 'corrupt', 'oversized', 'directory'])
  test(mode + ' intent is not overwritten by first final publication', async () => {
    const f = await fixture();
    let altered;
    const restore = intercept(f, async (job, save) => {
      if (mode === 'changed') {
        const r = JSON.parse(f.initial);
        r.command = 'newer metadata';
        altered = Buffer.from(JSON.stringify(r));
        await fs.writeFile(f.file, altered);
      }
      if (mode === 'missing') await fs.unlink(f.file);
      if (mode === 'corrupt') {
        altered = Buffer.from('{damaged');
        await fs.writeFile(f.file, altered);
      }
      if (mode === 'oversized') {
        altered = Buffer.alloc(16 * 1024 * 1024 + 1, 32);
        await fs.writeFile(f.file, altered);
      }
      if (mode === 'directory') {
        await fs.unlink(f.file);
        await fs.mkdir(f.file);
      }
      return save();
    });
    try {
      await start(f);
      await retained(f);
      assert.equal((await f.jobs.output('job')).text, 'original output\n');
      if (altered) assert.deepEqual(await fs.readFile(f.file), altered);
      else if (mode === 'missing') await assert.rejects(fs.access(f.file), (e) => e.code === 'ENOENT');
      else assert.equal((await fs.lstat(f.file)).isDirectory(), true);
      await assert.rejects(f.jobs.retrySave('job'), (e) =>
        ['JOB_SAVE_CONFLICT', 'UNREADABLE_JOB_RECORD'].includes(e.code),
      );
      assert.equal(await fs.readFile(path.join(f.root, 'count.txt'), 'utf8'), '1');
      restore();
      if (mode === 'directory') await fs.rmdir(f.file);
      await recoverFixture(f);
      assert.equal(await fs.readFile(path.join(f.root, 'count.txt'), 'utf8'), '1');
    } finally {
      restore();
    }
  });
for (const mode of ['changed-after-save', 'missing-after-save', 'reported-without-write'])
  test(mode + ' does not release the original result as durable', async () => {
    const f = await fixture();
    let altered;
    const restore = intercept(f, async (job, save) => {
      if (mode === 'reported-without-write') return 'saved';
      const result = await save();
      if (mode === 'missing-after-save') await fs.unlink(f.file);
      else {
        const r = JSON.parse(await fs.readFile(f.file, 'utf8'));
        r.command = 'newer after publication';
        altered = Buffer.from(JSON.stringify(r));
        await fs.writeFile(f.file, altered);
      }
      return result;
    });
    try {
      await start(f);
      await retained(f);
      if (altered) assert.deepEqual(await fs.readFile(f.file), altered);
      else if (mode === 'reported-without-write') assert.deepEqual(await fs.readFile(f.file), f.initial);
      else await assert.rejects(fs.access(f.file), (e) => e.code === 'ENOENT');
      restore();
      await recoverFixture(f);
      assert.equal(await fs.readFile(path.join(f.root, 'count.txt'), 'utf8'), '1');
    } finally {
      restore();
    }
  });
test('transient publication retry rechecks changed bytes rather than replacing them', async () => {
  const f = await fixture(),
    rename = fs.rename;
  let calls = 0,
    altered;
  fs.rename = async function (a, b, ...rest) {
    if (path.resolve(String(b)) === f.file) {
      calls++;
      if (calls === 1) {
        const r = JSON.parse(await fs.readFile(f.file, 'utf8'));
        f.initial = Buffer.from(JSON.stringify(r));
        r.command = 'changed during retry';
        altered = Buffer.from(JSON.stringify(r));
        await fs.writeFile(f.file, altered);
        throw Object.assign(new Error('private busy'), { code: 'EPERM' });
      }
    }
    return rename.call(this, a, b, ...rest);
  };
  syncBuiltinESMExports();
  try {
    await start(f);
    await retained(f);
    assert.equal(calls, 1);
    assert.deepEqual(await fs.readFile(f.file), altered);
    fs.rename = rename;
    syncBuiltinESMExports();
    await recoverFixture(f);
    assert.equal(await fs.readFile(path.join(f.root, 'count.txt'), 'utf8'), '1');
  } finally {
    fs.rename = rename;
    syncBuiltinESMExports();
  }
});
test('already-present exact final bytes are acknowledged without rewriting them', async () => {
  const f = await fixture();
  let time;
  const restore = intercept(f, async (job, save) => {
    await fs.writeFile(f.file, JSON.stringify(job));
    await fs.utimes(f.file, new Date('2020-01-01'), new Date('2020-01-01'));
    time = (await fs.stat(f.file)).mtimeMs;
    return save();
  });
  try {
    const result = await start(f);
    assert.equal(result.status, 'passed');
    assert.equal(result.exitCode, 0);
    assert.equal(result.completionPending, false);
    assert.equal((await fs.stat(f.file)).mtimeMs, time);
    assert.equal(f.jobs.live.size, 0);
    assert.equal(await fs.readFile(path.join(f.root, 'count.txt'), 'utf8'), '1');
  } finally {
    restore();
  }
});
for (const outcome of ['failed', 'cancelled', 'timed_out', 'prelaunch'])
  test(outcome + ' keeps its original outcome through a publication conflict', async () => {
    const f = await fixture();
    let changed;
    const restore = intercept(f, async (job, save) => {
      const r = JSON.parse(f.initial);
      r.command = 'do not overwrite';
      changed = Buffer.from(JSON.stringify(r));
      await fs.writeFile(f.file, changed);
      return save();
    });
    try {
      await start(f, outcome);
      const expected = outcome === 'prelaunch' ? 'failed' : outcome,
        held = await retained(f, expected);
      assert.equal(held.exitCode, outcome === 'failed' ? 7 : null);
      assert.deepEqual(await fs.readFile(f.file), changed);
      restore();
      const saved = await recoverFixture(f, expected);
      assert.equal(saved.exitCode, outcome === 'failed' ? 7 : null);
      if (outcome === 'prelaunch') assert.equal(saved.errorCode, 'EXECUTABLE_NOT_FOUND');
    } finally {
      restore();
    }
  });
test('ordinary publication and historical replay remain byte-preserving', async () => {
  const f = await fixture(),
    job = await start(f);
  assert.equal(job.status, 'passed');
  assert.equal(job.exitCode, 0);
  assert.equal(job.completionPending, false);
  const bytes = await fs.readFile(f.file);
  const reader = new Jobs(f.workspace, f.state);
  owners.push(reader);
  assert.deepEqual(await reader.status('job'), job);
  assert.deepEqual(await f.jobs.terminal('.', process.execPath, args, 30, 'job'), job);
  assert.deepEqual(await fs.readFile(f.file), bytes);
  assert.equal(await fs.readFile(path.join(f.root, 'count.txt'), 'utf8'), '1');
});
