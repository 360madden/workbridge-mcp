import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { Workspace } from '../dist/workspace.js';
import { Jobs } from '../dist/jobs.js';
import { limits } from '../dist/core.js';
let suite,
  sequence = 0;
const owners = [];
before(async () => {
  suite = await fs.mkdtemp(path.join(os.tmpdir(), 'wb-job-recovery-'));
});
after(async () => {
  await Promise.all(owners.map((j) => j.close()));
  assert.ok(suite.startsWith(path.resolve(os.tmpdir()) + path.sep));
  await fs.rm(suite, { recursive: true, force: true });
});
const base = {
  id: 'saved',
  project: '.',
  command: 'node',
  request: 'a'.repeat(64),
  status: 'passed',
  startedAt: '2026-10-21T03:00:00.000Z',
  endedAt: '2026-10-21T03:00:00.100Z',
  exitCode: 0,
  output: 'retained output\n',
  outputTruncated: false,
  mode: 'terminal',
  executable: process.execPath,
  timeoutSeconds: 30,
  stdout: 'retained output\n',
  stderr: '',
};
const pageOptions = { offset: 0, limit: 20, scanLimit: 200 };
async function fixture(withRecord = true) {
  const root = path.join(suite, String(sequence++));
  await fs.mkdir(root);
  const state = path.join(root, 'state');
  await fs.mkdir(state);
  const directory = path.join(state, 'jobs');
  if (withRecord) await fs.mkdir(directory);
  const workspace = await Workspace.create(root),
    jobs = new Jobs(workspace, state);
  owners.push(jobs);
  const record = path.join(directory, 'saved.json');
  if (withRecord) await fs.writeFile(record, JSON.stringify(base));
  return { root, state, directory, workspace, jobs, record };
}
async function refused(f) {
  const saved = await fs.readFile(f.record);
  for (const call of [
    () => f.jobs.status('saved'),
    () => f.jobs.output('saved'),
    () => f.jobs.cancel('saved'),
    () =>
      f.jobs.terminal(
        '.',
        process.execPath,
        ['-e', "require('fs').writeFileSync('must-not-run.txt','bad')"],
        30,
        'saved',
      ),
  ])
    await assert.rejects(call(), (e) => e.code === 'UNREADABLE_JOB_RECORD');
  assert.deepEqual(await fs.readFile(f.record), saved);
  await assert.rejects(fs.access(path.join(f.root, 'must-not-run.txt')), (e) => e.code === 'ENOENT');
}
const mutations = [
  [
    'mismatched ID',
    (r) => {
      r.id = 'different';
    },
  ],
  [
    'case-mismatched ID',
    (r) => {
      r.id = 'SAVED';
    },
  ],
  [
    'missing request',
    (r) => {
      delete r.request;
    },
  ],
  [
    'short request hash',
    (r) => {
      r.request = 'bad';
    },
  ],
  [
    'nonhex request hash',
    (r) => {
      r.request = 'g'.repeat(64);
    },
  ],
  [
    'fractional timeout',
    (r) => {
      r.timeoutSeconds = 1.5;
    },
  ],
  [
    'out-of-range timeout',
    (r) => {
      r.timeoutSeconds = 601;
    },
  ],
  [
    'invalid status',
    (r) => {
      r.status = 'finished';
    },
  ],
  [
    'invalid date',
    (r) => {
      r.startedAt = 'yesterday';
    },
  ],
  [
    'invalid exit code',
    (r) => {
      r.exitCode = '0';
    },
  ],
  [
    'missing output',
    (r) => {
      delete r.output;
    },
  ],
  [
    'invalid output type',
    (r) => {
      r.output = [];
    },
  ],
  [
    'invalid stream type',
    (r) => {
      r.stdout = {};
    },
  ],
];
for (const [name, mutate] of mutations)
  test(`invalid saved job ${name} is refused consistently before replay`, async () => {
    const f = await fixture(),
      record = { ...base };
    mutate(record);
    await fs.writeFile(f.record, JSON.stringify(record));
    await refused(f);
    const page = await f.jobs.catalog(pageOptions);
    assert.equal(page.hasErrors, true);
    assert.equal(page.complete, false);
    assert.equal(page.issues[0].code, 'UNREADABLE_JOB_RECORD');
    assert.equal(page.jobs.length, 0);
  });

test('malformed and oversized saved jobs fail without unbounded status/output reads', async () => {
  const f = await fixture();
  for (const text of ['{broken', JSON.stringify({ ...base, extra: 'x'.repeat(16 * 1024 * 1024 + 1) })]) {
    await fs.writeFile(f.record, text);
    await refused(f);
    assert.equal((await f.jobs.catalog(pageOptions)).issues[0].code, 'UNREADABLE_JOB_RECORD');
  }
});

test('unknown fields are stripped from summaries without rewriting historical metadata', async () => {
  const f = await fixture();
  await fs.writeFile(f.record, JSON.stringify({ ...base, extra: 'not part of public job summary' }));
  const saved = await fs.readFile(f.record);
  const status = await f.jobs.status('saved'),
    output = await f.jobs.output('saved');
  assert.equal('extra' in status, false);
  assert.equal('extra' in output, false);
  assert.deepEqual((await f.jobs.catalog(pageOptions)).jobs, [status]);
  assert.deepEqual(await fs.readFile(f.record), saved);
});

test('legacy combined-only output and historical running interruption retain existing behavior', async () => {
  const f = await fixture(),
    legacy = { ...base };
  delete legacy.stdout;
  delete legacy.stderr;
  delete legacy.mode;
  delete legacy.executable;
  delete legacy.timeoutSeconds;
  legacy.status = 'running';
  legacy.exitCode = null;
  delete legacy.endedAt;
  await fs.writeFile(f.record, JSON.stringify(legacy));
  const saved = await fs.readFile(f.record);
  assert.equal((await f.jobs.status('saved')).status, 'interrupted');
  assert.equal((await f.jobs.output('saved')).text, base.output);
  await assert.rejects(
    f.jobs.output('saved', 0, 10, 'stdout'),
    (e) => e.code === 'OUTPUT_STREAM_UNAVAILABLE',
  );
  const page = await f.jobs.catalog({ ...pageOptions, status: 'interrupted' });
  assert.equal(page.hasErrors, false);
  assert.equal(page.jobs[0].status, 'interrupted');
  assert.deepEqual(page.runningJobs, []);
  assert.deepEqual(await fs.readFile(f.record), saved);
});

test('linked catalog refuses known-ID access and new launch without modifying its target', async () => {
  const f = await fixture(),
    real = path.join(f.state, 'preserved-jobs');
  await fs.rename(f.directory, real);
  await fs.symlink(real, f.directory, process.platform === 'win32' ? 'junction' : 'dir');
  const names = await fs.readdir(real);
  await refused(f);
  await assert.rejects(
    f.jobs.terminal('.', process.execPath, ['-e', 'process.exit(0)'], 30, 'new'),
    (e) => e.code === 'UNREADABLE_JOB_RECORD',
  );
  await assert.rejects(f.jobs.catalog(pageOptions), (e) => e.code === 'UNREADABLE_JOB_RECORD');
  assert.deepEqual(await fs.readdir(real), names);
});

test('directory and junction metadata records are refused without opening them', async () => {
  const f = await fixture();
  await fs.rm(f.record);
  await fs.mkdir(f.record);
  for (const call of [
    () => f.jobs.status('saved'),
    () => f.jobs.output('saved'),
    () => f.jobs.cancel('saved'),
  ])
    await assert.rejects(call(), (e) => e.code === 'UNREADABLE_JOB_RECORD');
  assert.equal((await f.jobs.catalog(pageOptions)).issues[0].code, 'UNREADABLE_JOB_RECORD');
  await fs.rm(f.record, { recursive: true });
  await fs.mkdir(path.join(f.state, 'other'));
  await fs.symlink(path.join(f.state, 'other'), f.record, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(f.jobs.status('saved'), (e) => e.code === 'UNREADABLE_JOB_RECORD');
});

test('metadata replacement between lstat and open is detected before status or replay', async () => {
  const f = await fixture(),
    saved = await fs.readFile(f.record, 'utf8'),
    open = fs.open;
  let replaced = false;
  fs.open = async function (target, ...args) {
    if (!replaced && path.resolve(String(target)) === path.resolve(f.record)) {
      replaced = true;
      await fs.writeFile(f.record, saved.replace('retained output', 'modified output'));
      const later = new Date(Date.now() + 5000);
      await fs.utimes(f.record, later, later);
    }
    return open.call(this, target, ...args);
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(f.jobs.status('saved'), (e) => e.code === 'UNREADABLE_JOB_RECORD');
    assert.equal(replaced, true);
  } finally {
    fs.open = open;
    syncBuiltinESMExports();
  }
});

test('catalog issues count toward the page limit and continuation keeps all good IDs', async () => {
  const f = await fixture();
  for (let i = 0; i < 60; i++)
    await fs.writeFile(path.join(f.directory, 'bad-' + String(i).padStart(3, '0') + '.json'), '{broken');
  const jobs = [],
    issues = [];
  let offset = 0;
  do {
    const page = await f.jobs.catalog({ ...pageOptions, offset, limit: 7, scanLimit: 1000 });
    assert.ok(page.jobs.length + page.issues.length <= 7);
    assert.ok(JSON.stringify(page).length <= 60000);
    assert.equal(page.hasErrors, page.issues.length > 0);
    jobs.push(...page.jobs);
    issues.push(...page.issues);
    if (page.nextOffset !== null) assert.ok(page.nextOffset > offset);
    offset = page.nextOffset;
  } while (offset !== null);
  assert.equal(issues.length, 60);
  assert.equal(new Set(issues.map((i) => i.jobId)).size, 60);
  assert.deepEqual(
    jobs.map((j) => j.id),
    ['saved'],
  );
});

test('long summaries obey output bounds and explicitly mark continuation', async () => {
  const f = await fixture();
  for (let i = 0; i < 30; i++) {
    const id = 'long-' + String(i).padStart(3, '0');
    await fs.writeFile(
      path.join(f.directory, id + '.json'),
      JSON.stringify({ ...base, id, command: '\u0001'.repeat(4000), error: 'e'.repeat(4000) }),
    );
  }
  let offset = 0,
    limited = false;
  const ids = [];
  do {
    const page = await f.jobs.catalog({ ...pageOptions, offset, limit: 100, scanLimit: 1000 });
    assert.ok(JSON.stringify(page).length <= 60000);
    limited ||= page.outputLimitReached;
    ids.push(...page.jobs.map((j) => j.id));
    offset = page.nextOffset;
  } while (offset !== null);
  assert.equal(limited, true);
  assert.equal(ids.length, 31);
  assert.equal(new Set(ids).size, 31);
});

test('time, scan and catalog limits explicitly report incomplete discovery', async () => {
  const f = await fixture();
  await fs.writeFile(path.join(f.directory, 'another.json'), JSON.stringify({ ...base, id: 'another' }));
  const scan = await f.jobs.catalog({ ...pageOptions, status: 'failed', scanLimit: 1 });
  assert.equal(scan.scanLimitReached, true);
  assert.equal(scan.complete, false);
  assert.equal(scan.hasErrors, false);
  const oldMs = limits.scanMs,
    oldEntries = limits.scanEntries;
  try {
    limits.scanMs = 0;
    const timed = await f.jobs.catalog(pageOptions);
    assert.equal(timed.timeLimitReached, true);
    assert.equal(timed.complete, false);
    limits.scanMs = oldMs;
    limits.scanEntries = 1;
    const truncated = await f.jobs.catalog(pageOptions);
    assert.equal(truncated.catalogTruncated, true);
    assert.equal(truncated.complete, false);
  } finally {
    limits.scanMs = oldMs;
    limits.scanEntries = oldEntries;
  }
});

test('invalid paging and unknown job IDs do not create storage', async () => {
  const f = await fixture(false);
  for (const invalid of [
    { offset: -1 },
    { offset: 1.5 },
    { offset: 100001 },
    { limit: 0 },
    { limit: 101 },
    { scanLimit: 0 },
    { scanLimit: 1001 },
  ])
    await assert.rejects(f.jobs.catalog({ ...pageOptions, ...invalid }));
  await assert.rejects(f.jobs.status('missing'), (e) => e.code === 'UNKNOWN_JOB');
  await assert.rejects(f.jobs.status('../bad'), (e) => e.code === 'INVALID_JOB_ID');
  const empty = await f.jobs.catalog(pageOptions);
  assert.equal(empty.complete, true);
  assert.equal(empty.hasErrors, false);
  await assert.rejects(fs.access(f.directory), (e) => e.code === 'ENOENT');
});

test('the live owner remains authoritative and retains cancellation without overwriting corrupt storage', async () => {
  const f = await fixture();
  await f.jobs.terminal('.', process.execPath, ['-e', 'setInterval(()=>{},1000)'], 30, 'active');
  const activeFile = path.join(f.directory, 'active.json');
  const originalIntent = await fs.readFile(activeFile);
  const corrupt = '{corrupt disk copy while owner is live';
  await fs.writeFile(activeFile, corrupt);
  const live = await f.jobs.status('active');
  assert.equal(live.status, 'running');
  await fs.writeFile(path.join(f.directory, 'bad.json'), '{broken');
  const page = await f.jobs.catalog({ ...pageOptions, limit: 1 });
  assert.equal(page.runningJobs[0].id, 'active');
  assert.equal(page.runningJobs[0].status, 'running');
  assert.equal((await f.jobs.output('active')).status, 'running');
  await f.jobs.cancel('active');
  const held = await f.jobs.status('active');
  assert.equal(held.status, 'failed');
  assert.equal(held.errorCode, 'JOB_RECORD_SAVE_FAILED');
  assert.equal(held.completionPending, false);
  assert.equal(f.jobs.live.get('active').pending.result.status, 'cancelled');
  assert.equal(await fs.readFile(activeFile, 'utf8'), corrupt);
  await assert.rejects(f.jobs.retrySave('active'), (e) => e.code === 'UNREADABLE_JOB_RECORD');
  // Restore only this private fixture's exact intent, then save the original cancellation.
  await fs.writeFile(activeFile, originalIntent);
  const saved = await f.jobs.retrySave('active');
  assert.equal(saved.commandRerun, false);
  assert.equal(saved.job.status, 'cancelled');
  assert.equal(f.jobs.live.size, 0);
});
