import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  lstat,
  open,
  symlink,
  link,
  utimes,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { previewJobRetention, retentionLimits } from '../scripts/preview-job-retention.mjs';

// Deliberately retain disposable fixtures: this test suite performs no deletion.
const root = await mkdtemp(path.join(os.tmpdir(), 'wb-retention-preview-'));
const now = '2026-10-26T12:00:00.000Z';
const script = fileURLToPath(new URL('../scripts/preview-job-retention.mjs', import.meta.url));
let fixtureNumber = 0;
async function fixture() {
  const directory = path.join(root, String(++fixtureNumber));
  await mkdir(directory);
  return directory;
}
function record(id, changes = {}) {
  return {
    id,
    project: 'PRIVATE_PROJECT',
    command: 'PRIVATE_COMMAND',
    request: 'a'.repeat(64),
    status: 'passed',
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T00:01:00.000Z',
    exitCode: 0,
    output: 'PRIVATE_OUTPUT',
    outputTruncated: false,
    ...changes,
  };
}
async function put(directory, id, changes = {}) {
  const bytes = JSON.stringify(record(id, changes));
  await writeFile(path.join(directory, id + '.json'), bytes, { flag: 'wx' });
  return Buffer.byteLength(bytes);
}
const preview = (directory, extra = {}) => previewJobRetention({ jobsDirectory: directory, now, ...extra });
async function snapshot(directory) {
  const result = {};
  for (const name of (await readdir(directory)).sort()) {
    const file = path.join(directory, name),
      info = await lstat(file);
    result[name] =
      info.isFile() && !info.isSymbolicLink()
        ? createHash('sha256')
            .update(await readFile(file))
            .digest('hex')
        : { linked: info.isSymbolicLink(), directory: info.isDirectory() };
  }
  return result;
}
async function unchanged(directory, action) {
  const before = await snapshot(directory);
  const result = await action();
  assert.deepEqual(await snapshot(directory), before);
  return result;
}
function noPrivateData(value) {
  const text = JSON.stringify(value);
  for (const secret of ['PRIVATE_', root, 'UNTRUSTED_SECRET', 'a'.repeat(64)])
    assert.equal(text.includes(secret), false);
}

test('aggregate old successful records with logical sizes and provisional owner caveat', async () => {
  const directory = await fixture();
  const old = await put(directory, 'PRIVATE_ID');
  const fresh = await put(directory, 'fresh', { endedAt: '2026-10-25T12:00:00.000Z' });
  const evidence = 'UNTRUSTED_SECRET not even JSON';
  await writeFile(path.join(directory, 'PRIVATE_ID.result.json'), evidence, { flag: 'wx' });
  await writeFile(path.join(directory, 'PRIVATE_NOT_A_RECORD.txt'), 'UNTRUSTED_SECRET', { flag: 'wx' });
  const r = await unchanged(directory, () => preview(directory));
  assert.equal(r.schemaVersion, 1);
  assert.equal(r.mode, 'preview');
  assert.equal(r.readOnly, true);
  assert.equal(r.complete, true);
  assert.equal(r.truncated, false);
  assert.equal(r.hasErrors, false);
  assert.equal(r.catalog.countsAreLowerBounds, false);
  assert.equal(r.catalog.recordCount, 2);
  assert.equal(r.catalog.validRecords, 2);
  assert.equal(r.catalog.recordBytes, old + fresh);
  assert.equal(r.catalog.bytesRead, old + fresh);
  assert.deepEqual(r.catalog.workerEvidence, { count: 1, bytes: Buffer.byteLength(evidence) });
  assert.deepEqual(r.groups.byState.passed, { count: 2, bytes: old + fresh });
  assert.deepEqual(r.groups.byAge['90_days_or_more'], { count: 1, bytes: old });
  assert.deepEqual(r.groups.byAge['1_to_7_days'], { count: 1, bytes: fresh });
  assert.equal(r.archivalReview.count, 1);
  assert.equal(r.archivalReview.bytes, old);
  assert.equal(r.archivalReview.provisional, true);
  assert.equal(r.archivalReview.actionableCount, 0);
  assert.equal(r.archivalReview.safeToArchive, false);
  assert.equal(r.catalog.uninspectedRecords, 0);
  assert.equal(r.owner.state, 'unverified');
  assert.equal(r.owner.retainedInMemoryResultsKnown, false);
  assert.equal(r.policy.automaticCleanup, false);
  noPrivateData(r);
});

test('preserve active intent, unsaved results, errors, non-success, incomplete and future metadata', async () => {
  const directory = await fixture();
  const cases = [
    ['running', { status: 'running', endedAt: undefined, exitCode: null }, 'active_or_unsaved_intent'],
    ['unsaved', { status: 'failed', errorCode: 'JOB_RECORD_SAVE_FAILED' }, 'unsaved_result'],
    ['error', { errorCode: 'PRIVATE_ERROR' }, 'stored_error'],
    ['empty_error', { error: '' }, 'stored_error'],
    ['failed', { status: 'failed', exitCode: 2 }, 'non_success_result'],
    ['cancelled', { status: 'cancelled' }, 'non_success_result'],
    ['timeout', { status: 'timed_out' }, 'non_success_result'],
    ['interrupted', { status: 'interrupted' }, 'non_success_result'],
    ['missing_end', { endedAt: undefined }, 'incomplete_result'],
    ['null_exit', { exitCode: null }, 'incomplete_result'],
    ['truncated', { outputTruncated: true }, 'truncated_output'],
    ['pending', { completionPending: true }, 'unknown_metadata'],
    ['owned', { ownerActive: true }, 'unknown_metadata'],
    ['future_field', { futureField: 'PRIVATE_NEW_FIELD' }, 'unknown_metadata'],
    ['future', { endedAt: '2027-01-01T00:00:00Z' }, 'invalid_timeline'],
    ['reversed', { startedAt: '2026-02-01T00:00:00Z' }, 'invalid_timeline'],
  ];
  const expected = {};
  for (const [id, changes, reason] of cases) {
    const bytes = await put(directory, id, changes);
    expected[reason] ??= { count: 0, bytes: 0 };
    expected[reason].count++;
    expected[reason].bytes += bytes;
  }
  const r = await unchanged(directory, () => preview(directory));
  assert.equal(r.complete, true);
  assert.deepEqual(r.groups.byDisposition, expected);
  assert.equal(r.archivalReview.count, 0);
  noPrivateData(r);
});

test('age threshold uses endedAt and never filesystem timestamps', async () => {
  const directory = await fixture();
  const exactly = new Date(Date.parse(now) - 90 * 86400000).toISOString();
  await put(directory, 'boundary', { endedAt: exactly });
  await put(directory, 'recent', { endedAt: new Date(Date.parse(exactly) + 1).toISOString() });
  await utimes(path.join(directory, 'boundary.json'), new Date(now), new Date(now));
  await utimes(path.join(directory, 'recent.json'), new Date('2000-01-01'), new Date('2000-01-01'));
  const r = await unchanged(directory, () => preview(directory));
  assert.equal(r.archivalReview.count, 1);
  assert.equal((await preview(directory, { olderThanDays: 91 })).archivalReview.count, 0);
  assert.equal((await preview(directory, { olderThanDays: 89 })).archivalReview.count, 2);
});

test('epoch timestamps retain a computed age rather than being treated as absent', async () => {
  const directory = await fixture();
  await put(directory, 'epoch', { startedAt: '1970-01-01T00:00:00Z', endedAt: '1970-01-01T00:00:00Z' });
  const r = await preview(directory);
  assert.equal(r.groups.byAge['90_days_or_more'].count, 1);
  assert.equal(r.archivalReview.count, 1);
});

test('malformed and mismatched records suppress suggestions without leaking contents', async () => {
  const directory = await fixture();
  await put(directory, 'good');
  const malformed = {
    invalid_json: 'UNTRUSTED_SECRET{',
    null_record: 'null',
    array: '[]',
    wrong_id: JSON.stringify(record('different')),
    bad_request: JSON.stringify(record('bad_request', { request: 'PRIVATE_HASH' })),
    bad_date: JSON.stringify(record('bad_date', { startedAt: '2026-02-30T00:00:00Z' })),
    bad_output: JSON.stringify(record('bad_output', { output: 123 })),
    bad_exit: JSON.stringify(record('bad_exit', { exitCode: 0.5 })),
    bad_optional: JSON.stringify(record('bad_optional', { stdout: null })),
    bad_status: JSON.stringify(record('bad_status', { status: 'PRIVATE_STATUS' })),
    bad_utf8: Buffer.from([0xc0, 0xaf]),
  };
  for (const [id, bytes] of Object.entries(malformed))
    await writeFile(path.join(directory, id + '.json'), bytes, { flag: 'wx' });
  const r = await unchanged(directory, () => preview(directory));
  assert.equal(r.complete, false);
  assert.equal(r.truncated, false);
  assert.equal(r.hasErrors, true);
  assert.equal(r.catalog.invalidRecords, Object.keys(malformed).length);
  assert.equal(r.issues.INVALID_JOB_RECORD, Object.keys(malformed).length);
  assert.equal(r.groups.byDisposition.old_success_review.count, 1);
  assert.equal(r.archivalReview.suppressed, true);
  assert.equal(r.archivalReview.count, 0);
  noPrivateData(r);
});

test('oversized sparse record is refused before any read and original bytes are preserved', async () => {
  const directory = await fixture(),
    file = path.join(directory, 'huge.json');
  const handle = await open(file, 'wx');
  try {
    await handle.truncate(retentionLimits.maxRecordBytes + 1);
  } finally {
    await handle.close();
  }
  const r = await unchanged(directory, () => preview(directory));
  assert.equal(r.complete, false);
  assert.equal(r.catalog.bytesRead, 0);
  assert.equal(r.catalog.recordBytes, retentionLimits.maxRecordBytes + 1);
  assert.equal(r.issues.OVERSIZED_JOB_RECORD, 1);
});

test('linked directory entries and linked ancestors are refused without following targets', async () => {
  const directory = await fixture(),
    outside = await fixture();
  await put(outside, 'PRIVATE_TARGET');
  const targetBefore = await snapshot(outside);
  await symlink(
    outside,
    path.join(directory, 'linked.json'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const r = await unchanged(directory, () => preview(directory));
  assert.equal(r.complete, false);
  assert.equal(r.catalog.bytesRead, 0);
  assert.equal(r.issues.LINKED_CATALOG_ENTRY, 1);
  const alias = path.join(root, 'linked_catalog');
  await symlink(outside, alias, process.platform === 'win32' ? 'junction' : 'dir');
  for (const name of [alias, path.join(alias, 'missing')]) {
    const rejected = await preview(name);
    assert.equal(rejected.complete, false);
    assert.equal(rejected.issues.LINKED_JOB_CATALOG, 1);
    assert.equal(rejected.catalog.scannedEntries, 0);
    assert.equal(rejected.catalog.bytesRead, 0);
    noPrivateData(rejected);
  }
  assert.deepEqual(await snapshot(outside), targetBefore);
});

test('file symlink is refused, where file-symlink privilege is available', async (t) => {
  const directory = await fixture(),
    outside = await fixture();
  await put(outside, 'target');
  try {
    await symlink(path.join(outside, 'target.json'), path.join(directory, 'alias.json'), 'file');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {
      t.skip('Host does not permit file-symlink fixtures; directory junction coverage remains required.');
      return;
    }
    throw error;
  }
  const r = await unchanged(directory, () => preview(directory));
  assert.equal(r.issues.LINKED_CATALOG_ENTRY, 1);
  assert.equal(r.catalog.bytesRead, 0);
});

test('hardlinked records and directories named as records are preserved and rejected', async () => {
  const directory = await fixture();
  await put(directory, 'original');
  await link(path.join(directory, 'original.json'), path.join(directory, 'alias.json'));
  await mkdir(path.join(directory, 'folder.json'));
  const r = await unchanged(directory, () => preview(directory));
  assert.equal(r.issues.NONREGULAR_CATALOG_ENTRY, 3);
  assert.equal(r.catalog.bytesRead, 0);
  assert.equal(r.catalog.invalidRecords, 3);
});

test('missing catalog is a complete empty inventory without directory creation', async () => {
  const directory = await fixture(),
    missing = path.join(directory, 'absent');
  const r = await unchanged(directory, () => preview(missing));
  assert.equal(r.complete, true);
  assert.equal(r.catalog.exists, false);
  assert.equal(r.catalog.recordCount, 0);
  assert.equal(r.archivalReview.count, 0);
  await assert.rejects(lstat(missing), { code: 'ENOENT' });
});

test('non-directory catalog is an error rather than an empty successful count', async () => {
  const directory = await fixture(),
    file = path.join(directory, 'catalog');
  await writeFile(file, 'UNTRUSTED_SECRET', { flag: 'wx' });
  const r = await unchanged(directory, () => preview(file));
  assert.equal(r.complete, false);
  assert.equal(r.catalog.exists, null);
  assert.equal(r.catalog.countsAreLowerBounds, true);
  assert.equal(r.issues.UNREADABLE_JOB_CATALOG, 1);
  noPrivateData(r);
});

for (const [key, amount, expectedCount] of [
  ['maxEntries', 2, 2],
  ['maxRecords', 2, 2],
  ['maxReadBytes', 1, 0],
]) {
  test(key + ' bounds scan and withholds provisional suggestions', async () => {
    const directory = await fixture();
    for (let i = 0; i < 3; i++) await put(directory, 'job' + i);
    const r = await unchanged(directory, () => preview(directory, { limits: { [key]: amount } }));
    assert.equal(r.complete, false);
    assert.equal(r.truncated, true);
    assert.equal(r.hasErrors, false);
    assert.equal(r.catalog.validRecords, expectedCount);
    assert.equal(r.catalog.uninspectedRecords, key === 'maxReadBytes' ? 1 : 0);
    assert.equal(r.catalog.countsAreLowerBounds, true);
    assert.equal(r.archivalReview.suppressed, true);
    assert.equal(r.archivalReview.count, 0);
    assert.equal(
      r.catalog.bytesRead <= (key === 'maxReadBytes' ? amount : retentionLimits.maxReadBytes),
      true,
    );
  });
}

test('exact entry and record bounds do not falsely label a complete catalog truncated', async () => {
  const directory = await fixture();
  await put(directory, 'one');
  await put(directory, 'two');
  const r = await preview(directory, { limits: { maxEntries: 2, maxRecords: 2 } });
  assert.equal(r.complete, true);
  assert.equal(r.truncated, false);
});

test('default bounds cover a synthetic 3700-record catalog with a compact aggregate report', async () => {
  const directory = await fixture();
  let bytes = 0;
  for (let i = 0; i < 3700; i++) bytes += await put(directory, 'scale_' + i);
  const r = await unchanged(directory, () => preview(directory));
  assert.equal(r.complete, true);
  assert.equal(r.catalog.recordCount, 3700);
  assert.equal(r.catalog.validRecords, 3700);
  assert.equal(r.catalog.bytesRead, bytes);
  assert.equal(r.catalog.recordBytes, bytes);
  assert.equal(r.archivalReview.count, 3700);
  assert.equal(r.archivalReview.actionableCount, 0);
  assert.equal(Buffer.byteLength(JSON.stringify(r)) < 5000, true);
  noPrivateData(r);
});

test('cooperative deadline sets explicit partial flags without relying on wall-clock timing', async (t) => {
  const directory = await fixture();
  await put(directory, 'one');
  let tick = 0;
  t.mock.method(performance, 'now', () => tick++ * 100);
  const r = await unchanged(directory, () => preview(directory, { limits: { maxScanMs: 1 } }));
  assert.equal(r.complete, false);
  assert.equal(r.truncated, true);
  assert.equal(r.limitsReached.time, true);
  assert.equal(r.catalog.bytesRead, 0);
});

test('option validation rejects unbounded settings and unsupported mutation flags', async () => {
  const directory = await fixture();
  for (const extra of [
    { olderThanDays: 0 },
    { olderThanDays: 1.5 },
    { now: 'PRIVATE_INVALID_DATE' },
    { limits: { maxEntries: 100001 } },
    { limits: { maxRecordBytes: 16777217 } },
    { limits: { maxReadBytes: Infinity } },
    { limits: { maxRecords: -1 } },
    { limits: { unknown: 1 } },
    { limits: [] },
    { delete: true },
  ])
    await assert.rejects(preview(directory, extra), { code: 'INVALID_ARGUMENTS' });
  await assert.rejects(previewJobRetention(), { code: 'INVALID_ARGUMENTS' });
});

test('CLI complete, partial and invalid invocations have exact exits and JSON-only safe output', async () => {
  const directory = await fixture();
  await put(directory, 'PRIVATE_ID');
  for (const [args, exit, code] of [
    [['--jobs-dir', directory, '--now', now], 0],
    [['--jobs-dir', directory, '--max-read-bytes', '1'], 1],
    [['--jobs-dir', directory, '--delete'], 2, 'INVALID_ARGUMENTS'],
    [['--jobs-dir', directory, '--apply', 'yes'], 2, 'INVALID_ARGUMENTS'],
    [['--jobs-dir', directory, '--jobs-dir', directory], 2, 'INVALID_ARGUMENTS'],
    [['--jobs-dir', directory, '--max-records', 'Infinity'], 2, 'INVALID_ARGUMENTS'],
    [[], 2, 'INVALID_ARGUMENTS'],
  ]) {
    const before = await snapshot(directory);
    const run = spawnSync(process.execPath, [script, ...args], {
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
    });
    assert.equal(run.error, undefined);
    assert.equal(run.status, exit);
    assert.equal(run.stderr, '');
    const r = JSON.parse(run.stdout);
    if (code) assert.equal(r.errorCode, code);
    noPrivateData(r);
    assert.deepEqual(await snapshot(directory), before);
  }
});
