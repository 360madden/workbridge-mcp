import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import syncfs from 'node:fs';
import cp from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import { Workspace } from '../dist/workspace.js';
import { Jobs } from '../dist/jobs.js';
let suite,
  sequence = 0;
const owners = [];
before(async () => {
  suite = await fs.mkdtemp(path.join(os.tmpdir(), 'wb-result-'));
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
  return { root, state, workspace, jobs, result: path.join(state, 'jobs/job.result.json') };
}
const command = [
  '-e',
  "require('fs').appendFileSync('count.txt','1');process.stdout.write('original output');process.exitCode=7",
];
async function start(f, args = command, seconds = 30, id = 'job') {
  await f.jobs.terminal('.', process.execPath, args, seconds, id);
  const owned = f.jobs.live.get(id);
  if (owned) await owned.done;
  return f.jobs.status(id);
}
function substitute(f, transform, failSave = false) {
  const spawn = cp.spawn,
    rename = fs.rename;
  let originalResult,
    spawnCount = 0,
    intercepted = false,
    denied = failSave;
  cp.spawn = function (...args) {
    spawnCount++;
    const child = spawn.apply(this, args),
      emit = child.emit;
    child.emit = function (event, ...rest) {
      if (event === 'close' && !intercepted) {
        intercepted = true;
        originalResult = syncfs.existsSync(f.result)
          ? JSON.parse(syncfs.readFileSync(f.result, 'utf8'))
          : null;
        const injected = transform(f.result, originalResult, f);
        // Native host exits can differ from child exits. Explicitly inject this
        // separate contradiction instead of assuming the Windows host returned 7.
        if (injected?.hostExit !== undefined) rest[0] = injected.hostExit;
      }
      return emit.call(this, event, ...rest);
    };
    return child;
  };
  fs.rename = async function (a, b, ...rest) {
    if (denied && path.resolve(String(b)) === path.join(f.state, 'jobs/job.json'))
      throw Object.assign(new Error('private publication fault'), { code: 'EIO' });
    return rename.call(this, a, b, ...rest);
  };
  syncBuiltinESMExports();
  return {
    original: () => originalResult,
    spawns: () => spawnCount,
    release: () => {
      denied = false;
    },
    restore() {
      cp.spawn = spawn;
      fs.rename = rename;
      syncBuiltinESMExports();
    },
  };
}
const json = (file, value) => syncfs.writeFileSync(file, JSON.stringify(value));
const mutations = [
  [
    'wrong job identity',
    (p, r) => json(p, { ...r, jobId: 'another-job', exitCode: 0 }),
    'COMMAND_RESULT_INVALID',
  ],
  [
    'wrong invocation identity',
    (p, r) => json(p, { ...r, invocationId: '11111111-1111-4111-8111-111111111111', exitCode: 0 }),
    'COMMAND_RESULT_INVALID',
  ],
  ['legacy unbound result', (p) => json(p, { exitCode: 0, timedOut: false }), 'COMMAND_RESULT_INVALID'],
  [
    'unknown schema version',
    (p, r) => json(p, { ...r, schemaVersion: 99, exitCode: 0 }),
    'COMMAND_RESULT_INVALID',
  ],
  [
    'oversized result',
    (p, r) => json(p, { ...r, exitCode: 0, padding: 'x'.repeat(128 * 1024) }),
    'COMMAND_RESULT_INVALID',
  ],
  ['unknown field', (p, r) => json(p, { ...r, exitCode: 0, unexpected: true }), 'COMMAND_RESULT_INVALID'],
  ['malformed JSON', (p) => syncfs.writeFileSync(p, '{broken'), 'COMMAND_RESULT_INVALID'],
  ['missing result', (p) => syncfs.unlinkSync(p), 'COMMAND_RESULT_MISSING'],
  [
    'nonregular result',
    (p) => {
      syncfs.unlinkSync(p);
      syncfs.mkdirSync(p);
    },
    'COMMAND_RESULT_INVALID',
  ],
  [
    'hard-linked result',
    (p, r, f) => {
      const outside = path.join(f.root, 'other.json');
      json(outside, { ...r, exitCode: 0 });
      syncfs.unlinkSync(p);
      syncfs.linkSync(outside, p);
    },
    'COMMAND_RESULT_INVALID',
  ],
  [
    'inconsistent timeout',
    (p, r) => json(p, { ...r, exitCode: 0, timedOut: true }),
    'COMMAND_RESULT_INVALID',
  ],
  ['unexplained null child exit', (p, r) => json(p, { ...r, exitCode: null }), 'COMMAND_RESULT_INVALID'],
  [
    'explicitly failed host with claimed child success',
    (p, r) => {
      json(p, { ...r, exitCode: 0 });
      return { hostExit: 7 };
    },
    'COMMAND_RESULT_INVALID',
  ],
];
for (const [name, mutate, errorCode] of mutations) {
  test(`${name} cannot convert a real failed command into reported success`, { timeout: 20000 }, async () => {
    const f = await fixture(),
      hook = substitute(f, mutate);
    try {
      const result = await start(f);
      assert.equal(hook.original().exitCode, 7);
      assert.equal(result.status, 'failed');
      assert.equal(result.exitCode, null);
      assert.equal(result.errorCode, errorCode);
      assert.equal((await f.jobs.output('job')).text, 'original output');
      assert.equal(await fs.readFile(path.join(f.root, 'count.txt'), 'utf8'), '1');
      assert.equal((await f.jobs.terminal('.', process.execPath, command, 30, 'job')).errorCode, errorCode);
      assert.equal(hook.spawns(), 1);
      assert.equal(f.jobs.live.size, 0);
      const reconstructed = new Jobs(f.workspace, f.state);
      owners.push(reconstructed);
      assert.deepEqual(await reconstructed.status('job'), result);
    } finally {
      hook.restore();
    }
  });
}

test('worker emits a strict job/invocation envelope and successful replay is unchanged', async () => {
  const f = await fixture(),
    args = ['-e', "require('fs').appendFileSync('count.txt','1');console.log('ok')"];
  const a = await start(f, args, 30, 'first'),
    b = await start(f, args, 30, 'second');
  assert.equal(a.status, 'passed');
  assert.equal(a.exitCode, 0);
  assert.equal(b.status, 'passed');
  const first = JSON.parse(await fs.readFile(path.join(f.state, 'jobs/first.result.json'), 'utf8'));
  const second = JSON.parse(await fs.readFile(path.join(f.state, 'jobs/second.result.json'), 'utf8'));
  assert.deepEqual(Object.keys(first).sort(), [
    'exitCode',
    'invocationId',
    'jobId',
    'schemaVersion',
    'timedOut',
  ]);
  assert.equal(first.schemaVersion, 1);
  assert.equal(first.jobId, 'first');
  assert.equal(second.jobId, 'second');
  assert.match(first.invocationId, /^[0-9a-f-]{36}$/);
  assert.notEqual(first.invocationId, second.invocationId);
  const before = await fs.readFile(path.join(f.state, 'jobs/first.json'));
  assert.deepEqual(await f.jobs.terminal('.', process.execPath, args, 30, 'first'), a);
  assert.equal(await fs.readFile(path.join(f.root, 'count.txt'), 'utf8'), '11');
  assert.deepEqual(await fs.readFile(path.join(f.state, 'jobs/first.json')), before);
});

test('invalid evidence survives a save failure and explicit recovery without rerunning', async () => {
  const f = await fixture(),
    hook = substitute(f, (p, r) => json(p, { ...r, jobId: 'other', exitCode: 0 }), true);
  try {
    const failed = await start(f);
    assert.equal(failed.errorCode, 'JOB_RECORD_SAVE_FAILED');
    assert.equal(failed.exitCode, null);
    assert.equal(f.jobs.live.get('job').pending.result.errorCode, 'COMMAND_RESULT_INVALID');
    assert.equal((await f.jobs.output('job')).text, 'original output');
    hook.release();
    const saved = await f.jobs.retrySave('job');
    assert.equal(saved.job.errorCode, 'COMMAND_RESULT_INVALID');
    assert.equal(saved.job.exitCode, null);
    assert.equal(saved.commandRerun, false);
    assert.equal(hook.spawns(), 1);
    assert.equal(await fs.readFile(path.join(f.root, 'count.txt'), 'utf8'), '1');
    assert.equal((await f.jobs.retrySave('job')).publication, 'already_saved');
    assert.equal(f.jobs.live.size, 0);
  } finally {
    hook.restore();
  }
});

for (const outcome of ['cancelled', 'timed_out'])
  test(`${outcome} keeps its status when result evidence is absent`, { timeout: 15000 }, async () => {
    const f = await fixture();
    await f.jobs.terminal(
      '.',
      process.execPath,
      ['-e', "console.log('started');setInterval(()=>{},1000)"],
      outcome === 'timed_out' ? 1 : 30,
      'job',
    );
    const owned = f.jobs.live.get('job');
    assert.ok(owned);
    if (outcome === 'cancelled') await f.jobs.cancel('job');
    else await owned.done;
    const status = await f.jobs.status('job');
    assert.equal(status.status, outcome);
    assert.equal(status.exitCode, null);
    assert.equal(f.jobs.live.size, 0);
  });

test('a pre-existing result is preserved and blocks a new command before launch', async () => {
  const f = await fixture();
  await fs.mkdir(path.dirname(f.result), { recursive: true });
  const stale = '{"exitCode":0,"timedOut":false}';
  await fs.writeFile(f.result, stale);
  const result = await start(f);
  assert.equal(result.status, 'failed');
  assert.equal(result.errorCode, 'COMMAND_RESULT_EXISTS');
  assert.equal(result.exitCode, null);
  assert.equal(await fs.readFile(f.result, 'utf8'), stale);
  await assert.rejects(fs.access(path.join(f.root, 'count.txt')), (e) => e.code === 'ENOENT');
  assert.equal(f.jobs.live.size, 0);
});
