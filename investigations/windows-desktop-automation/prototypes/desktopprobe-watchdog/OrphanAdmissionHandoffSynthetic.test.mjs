// SYNTHETIC TEST ONLY. This file cannot accept a user-supplied recovery root.
// It never reads/writes Workbridge's live .tools/desktop-evidence and has no GUI,
// COM, WinApp, VMware, RIFT, TaskScheduler, or input APIs.
// JavaScript rename/ino models ordering; it does NOT prove Win32 exact-handle
// file-ID no-replace rename/sharing or independently settled OS descendants.
import assert from 'node:assert/strict';
import {
  constants, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync,
  readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync, realpathSync,
} from 'node:fs';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const prefix = 'wb-orphan-handoff-fixture-';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = p => JSON.parse(readFileSync(p, 'utf8'));
const positiveTicks = '638663831240000000';

function fail(reason) {
  const error = new Error(reason);
  error.code = reason;
  throw error;
}

function canonicalFixture(f) {
  // Only the exact directory THIS test freshly created inside OS temp is valid.
  if (!f || !f.createdHere || path.basename(f.parent).startsWith(prefix) !== true ||
      realpathSync(path.dirname(f.parent)) !== realpathSync(os.tmpdir()) ||
      path.dirname(f.root) !== f.parent || path.basename(f.root) !== 'evidence')
    fail('TEST_FIXTURE_ROOT_INVALID');
}

function createFixture(options = {}) {
  const parent = mkdtempSync(path.join(os.tmpdir(), prefix));
  const root = path.join(parent, 'evidence');
  mkdirSync(root);
  const admission = path.join(root, 'desktop-turn-admission.lock');
  const guard = path.join(root, 'desktop-input-turn.lock');
  const runId = 'orphan' + randomBytes(6).toString('hex');
  const ownerPid = 450001;
  const owner = { pid: ownerPid, processStartUtcTicks: positiveTicks, sessionId: 1 };
  const admissionStamp = {
    schemaVersion: 1, kind: 'workbridge.gui-admission',
    admissionId: randomUUID(), mode: 'producer',
    producer: options.admissionProducer ?? 'desktopprobe-watchdog',
    requestId: options.admissionRequestId ?? runId,
    owner: { pid: ownerPid }, acquiredUtc: new Date().toISOString(),
  };
  const guiStamp = {
    schemaVersion: 1, kind: 'workbridge.gui-turn',
    producer: options.guardProducer ?? 'desktopprobe-watchdog',
    runId, requestId: runId, leaseId: randomUUID(), owner,
    target: { kind: 'window', pid: null, hwnd: null, process: 'DesktopProbe' },
    acquiredUtc: new Date().toISOString(), synthetic: false,
  };
  if (!options.omitAdmission) writeFileSync(admission, JSON.stringify(admissionStamp) + '\n', { flag: 'wx' });
  if (!options.omitGuard) writeFileSync(guard, JSON.stringify(guiStamp) + '\n', { flag: 'wx' });
  const expected = {};
  for (const [name, filename] of [['admission', admission], ['guard', guard]]) {
    if (existsSync(filename)) {
      const stats = lstatSync(filename);
      expected[name] = { sha: digest(readFileSync(filename)), dev: stats.dev, ino: stats.ino,
        size: stats.size };
    }
  }
  return { parent, root, admission, guard, runId, ownerPid, expected, createdHere: true };
}

function quiescentCensus(overrides = {}) {
  return {
    complete: true,
    ownerAlive: false,
    childOrDescendantAlive: false,
    launcherEnabled: false,
    uninspectableScriptHost: false,
    ownerPidReused: false,
    allProducersHonorLegacyGuard: true,
    ...overrides,
  };
}

function verifyExactFile(filename, expected) {
  if (!expected || !existsSync(filename)) fail('ORIGINAL_FILE_MISSING');
  const s = lstatSync(filename);
  if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 ||
      s.size < 2 || s.size > 4096) fail('FILE_TYPE_OR_SIZE_REFUSED');
  const bytes = readFileSync(filename);
  if (s.dev !== expected.dev || s.ino !== expected.ino || s.size !== expected.size ||
      digest(bytes) !== expected.sha) fail('PINNED_FILE_ID_OR_SHA_CHANGED');
  return JSON.parse(bytes.toString('utf8'));
}

function classify(f, census) {
  canonicalFixture(f);
  if (!census?.complete || census.ownerAlive || census.childOrDescendantAlive ||
      census.launcherEnabled || census.uninspectableScriptHost || census.ownerPidReused)
    fail('ACTIVE_OR_UNPROVEN_PROCESS_TASK_CENSUS');
  if (!census.allProducersHonorLegacyGuard) fail('LEGACY_GUARD_COVERAGE_UNPROVEN');
  const files = readdirSync(f.root);
  if (files.some(name => /^desktop-turn-quarantine-.*\.json$/i.test(name)))
    fail('SIDECAR_PRESENT_WRONG_PROTOCOL');
  // A canonical pair is required; admission-only and guard-only are hard NO-GO.
  if (!existsSync(f.admission) || !existsSync(f.guard)) fail('ORPHAN_PAIR_INCOMPLETE');
  const a = verifyExactFile(f.admission, f.expected.admission);
  const g = verifyExactFile(f.guard, f.expected.guard);
  if (a.schemaVersion !== 1 || a.kind !== 'workbridge.gui-admission' ||
      a.mode !== 'producer' || a.producer !== 'desktopprobe-watchdog' ||
      g.schemaVersion !== 1 || g.kind !== 'workbridge.gui-turn' ||
      g.producer !== 'desktopprobe-watchdog' || g.synthetic !== false ||
      !/^[a-z0-9][a-z0-9-]{6,38}[a-z0-9]$/.test(g.runId) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(g.leaseId) ||
      a.requestId !== f.runId || a.requestId !== g.requestId ||
      g.runId !== f.runId || a.owner?.pid !== g.owner?.pid ||
      g.owner?.pid !== f.ownerPid || g.owner?.processStartUtcTicks !== positiveTicks ||
      g.owner?.sessionId !== 1 || g.target?.process !== 'DesktopProbe' ||
      g.target?.kind !== 'window' || g.target?.pid !== null || g.target?.hwnd !== null)
    fail('ORPHAN_STAMP_IDENTITY_MISMATCH');
  return { status: 'eligible_for_operator_review_only', priorActionOutcome: 'unknown_outcome',
    newActionPerformed: false, runId: f.runId, leaseId: g.leaseId };
}

function simulateGuardCoveredHandoff(f, census, options = {}) {
  const preflight = classify(f, census);
  const archive = path.join(f.root, 'recovery-archives', 'synthetic-' + f.runId);
  const backup = path.join(archive, 'backup');
  const moved = path.join(archive, 'relocated');
  mkdirSync(backup, { recursive: true });
  mkdirSync(moved);
  const admBackup = path.join(backup, path.basename(f.admission));
  const guardBackup = path.join(backup, path.basename(f.guard));
  copyFileSync(f.admission, admBackup, constants.COPYFILE_EXCL);
  copyFileSync(f.guard, guardBackup, constants.COPYFILE_EXCL);
  if (digest(readFileSync(admBackup)) !== f.expected.admission.sha ||
      digest(readFileSync(guardBackup)) !== f.expected.guard.sha)
    fail('DURABLE_BACKUP_HASH_MISMATCH');
  writeFileSync(path.join(archive, 'manifest.json'), JSON.stringify({
    schemaVersion: 1, source: 'synthetic-model-not-production-recovery',
    originalActionOutcome: 'unknown_outcome', newActionPerformed: false,
    admissionSha: f.expected.admission.sha, guardSha: f.expected.guard.sha,
  }) + '\n', { flag: 'wx' });
  // Before moving either original, verify exactly pinned file identities again.
  verifyExactFile(f.admission, f.expected.admission);
  verifyExactFile(f.guard, f.expected.guard);
  if (options.stopBeforeAdmissionMove) return { outcome: 'stopped_before_move', preflight, archive };
  const archivedAdmission = path.join(moved, 'desktop-turn-admission.lock');
  renameSync(f.admission, archivedAdmission);
  assert.equal(existsSync(f.guard), true, 'original GUI guard covers admission handoff gap');
  if (options.contenderWinsAdmission) {
    // A different GUI claimant wins CREATE_NEW admission. Its stamp must remain
    // untouched. The ORIGINAL old GUI guard still blocks that claimant.
    writeFileSync(f.admission, JSON.stringify({ kind: 'workbridge.gui-admission',
      producer: 'racing-claimant' }) + '\n', { flag: 'wx' });
    assert.throws(() => writeFileSync(f.guard, 'danger\n', { flag: 'wx' }),
      error => error?.code === 'EEXIST');
  }
  try {
    writeFileSync(f.admission, JSON.stringify({
      schemaVersion: 1, kind: 'workbridge.gui-admission',
      mode: 'maintenance', producer: 'desktop-maintenance',
      requestId: 'synthetic-' + f.runId,
    }) + '\n', { flag: 'wx' });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    assert.equal(existsSync(f.guard), true);
    return { outcome: 'contender_win_guard_retained', preflight, archive };
  }
  if (options.stopAfterMaintenance) {
    assert.equal(existsSync(f.guard), true);
    return { outcome: 'maintenance_held_guard_retained', preflight, archive };
  }
  verifyExactFile(f.guard, f.expected.guard);
  const archivedGuard = path.join(moved, 'desktop-input-turn.lock');
  renameSync(f.guard, archivedGuard);
  assert.equal(digest(readFileSync(archivedAdmission)), f.expected.admission.sha);
  assert.equal(digest(readFileSync(archivedGuard)), f.expected.guard.sha);
  const receipt = { archived: true, originalActionOutcome: 'unknown_outcome',
    newActionPerformed: false, runId: f.runId };
  writeFileSync(path.join(archive, 'completed.json'), JSON.stringify(receipt) + '\n', { flag: 'wx' });
  // Exact fixture-only maintenance gate release, *after* archive receipt.
  unlinkSync(f.admission);
  assert.equal(existsSync(f.admission), false);
  return { outcome: 'archival_model_completed', preflight, archive, receipt };
}

test('S01: exact synthetic orphan pair classifies and models admission-first handoff', () => {
  const f = createFixture();
  assert.equal(classify(f, quiescentCensus()).status, 'eligible_for_operator_review_only');
  const result = simulateGuardCoveredHandoff(f, quiescentCensus());
  assert.equal(result.outcome, 'archival_model_completed');
  assert.equal(result.receipt.originalActionOutcome, 'unknown_outcome');
  assert.equal(result.receipt.newActionPerformed, false);
  assert.equal(existsSync(f.guard), false);
});

test('S02/03: active or ambiguous owner, child, task, PID reuse and incomplete census reject', () => {
  for (const change of [
    { ownerAlive: true }, { childOrDescendantAlive: true }, { launcherEnabled: true },
    { uninspectableScriptHost: true }, { ownerPidReused: true }, { complete: false },
  ]) {
    const f = createFixture();
    assert.throws(() => classify(f, quiescentCensus(change)),
      error => error?.code === 'ACTIVE_OR_UNPROVEN_PROCESS_TASK_CENSUS');
    assert.equal(existsSync(f.admission) && existsSync(f.guard), true);
  }
});

test('S04: wrong producer, request and incomplete stamps reject', () => {
  for (const options of [
    { admissionProducer: 'other-provider' },
    { guardProducer: 'other-provider' },
    { admissionRequestId: 'different-request' },
  ]) {
    const f = createFixture(options);
    assert.throws(() => classify(f, quiescentCensus()),
      error => error?.code === 'ORPHAN_STAMP_IDENTITY_MISMATCH');
    assert.equal(existsSync(f.admission) && existsSync(f.guard), true);
  }
});

test('S05: changed admission hash fails before any original is moved', () => {
  const f = createFixture();
  const existing = readFileSync(f.admission);
  writeFileSync(f.admission, Buffer.concat([existing, Buffer.from(' ')]));
  assert.throws(() => simulateGuardCoveredHandoff(f, quiescentCensus()),
    error => error?.code === 'PINNED_FILE_ID_OR_SHA_CHANGED');
  assert.equal(existsSync(f.admission) && existsSync(f.guard), true);
  assert.equal(existsSync(path.join(f.root, 'recovery-archives')), false);
});

test('S06: unexpected quarantine sidecar vetoes orphan-pair path', () => {
  const f = createFixture();
  writeFileSync(path.join(f.root, 'desktop-turn-quarantine-foreign.json'), '{}\n', { flag: 'wx' });
  assert.throws(() => classify(f, quiescentCensus()),
    error => error?.code === 'SIDECAR_PRESENT_WRONG_PROTOCOL');
  assert.equal(existsSync(f.admission) && existsSync(f.guard), true);
});

test('S08: stop before admission relocation retains both originals', () => {
  const f = createFixture();
  const result = simulateGuardCoveredHandoff(f, quiescentCensus(), { stopBeforeAdmissionMove: true });
  assert.equal(result.outcome, 'stopped_before_move');
  assert.equal(existsSync(f.admission) && existsSync(f.guard), true);
});

test('S09: competing admission claimant wins; old GUI guard remains, foreign gate untouched', () => {
  const f = createFixture();
  const result = simulateGuardCoveredHandoff(f, quiescentCensus(), { contenderWinsAdmission: true });
  assert.equal(result.outcome, 'contender_win_guard_retained');
  assert.equal(existsSync(f.guard), true);
  assert.equal(readJson(f.admission).producer, 'racing-claimant');
});

test('S10: stop after maintenance admission created still retains old GUI guard', () => {
  const f = createFixture();
  const result = simulateGuardCoveredHandoff(f, quiescentCensus(), { stopAfterMaintenance: true });
  assert.equal(result.outcome, 'maintenance_held_guard_retained');
  assert.equal(existsSync(f.guard), true);
  assert.equal(readJson(f.admission).mode, 'maintenance');
});

test('S14: admission-only or guard-only shapes are hard rejected', () => {
  for (const opts of [{ omitGuard: true }, { omitAdmission: true }]) {
    const f = createFixture(opts);
    assert.throws(() => classify(f, quiescentCensus()),
      error => error?.code === 'ORPHAN_PAIR_INCOMPLETE');
  }
});

test('S15: unknown producer that ignores GUI guard is hard rejected', () => {
  const f = createFixture();
  assert.throws(() => classify(f, quiescentCensus({ allProducersHonorLegacyGuard: false })),
    error => error?.code === 'LEGACY_GUARD_COVERAGE_UNPROVEN');
});
