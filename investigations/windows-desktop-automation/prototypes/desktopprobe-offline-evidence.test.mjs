// Offline synthetic fixtures only. No WinApp, GUI, service, filesystem, screenshots or input.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyDesktopProbeEvidence, parseNativeJournal } from './desktopprobe-offline-evidence.mjs';

const temp = join(resolve(dirname(fileURLToPath(import.meta.url)), '../../..'),
  'investigations', 'windows-desktop-automation', 'temp');
const tickNow = () => (621355968000000000n + BigInt(Date.now()) * 10000n).toString();
const TITLE = 'Workbridge GUI-004 Native Input Probe';
const sha = (b) => createHash('sha256').update(b).digest('hex');

function fixture() {
  const runId = 'wdwinapp-20261105a';
  const manifest = {
    schemaVersion: 1, runId, requestId: runId,
    leaseId: '8b414ca6-208a-4bd4-b78f-f97b1f5750bd',
    watchdogPid: 700, watchdogStartedAtUtcTicks: tickNow(),
    pid: 701, startedAtUtcTicks: tickNow(), sessionId: 1,
    hwnd: '9001', foregroundHwnd: '9002',
    ownerSid: 'S-1-5-21-111-222-333-444',
    title: TITLE, className: 'WindowsForms10.Window.8.app.0.synthetic',
    exePath: join(temp, 'desktopprobe-' + runId, 'publish', 'DesktopProbe.exe'),
    exeSha256: 'a'.repeat(64),
    evidenceDir: join(temp, 'desktopprobe-' + runId, 'evidence'),
    observedAtUtc: new Date().toISOString(),
    deadlineUtc: new Date(Date.now() + 90_000).toISOString(),
  };
  const lease = {
    schemaVersion: 1, kind: 'workbridge.gui-turn',
    producer: 'desktopprobe-watchdog', runId, requestId: runId, leaseId: manifest.leaseId,
    owner: { pid: 700, processStartUtcTicks: manifest.watchdogStartedAtUtcTicks, sessionId: 1 },
    target: { kind: 'window', pid: null, hwnd: null, process: 'DesktopProbe' },
  };
  const records = [
    { schemaVersion: 1, stage: 'starting', pid: 701, sessionId: 1,
      hwnd: 0, counter: 0, title: TITLE, error: null },
    { schemaVersion: 1, stage: 'shown', pid: 701, sessionId: 1,
      hwnd: 9001, counter: 0, title: TITLE, error: null },
  ];
  const nativeJournal = Buffer.from(records.map((x) => JSON.stringify(x)).join('\r\n') + '\r\n');
  const before = {
    schemaVersion: 1, verified: true, pid: 701, startedAtUtcTicks: manifest.startedAtUtcTicks,
    sessionId: 1, ownerSidVerified: true, hwnd: '9001', rootHwnd: '9001',
    ownerHwnd: '0', className: manifest.className, foregroundHwnd: '9002',
    windowStation: 'WinSta0', desktopName: 'Default',
    rect: { left: 100, top: 120, right: 800, bottom: 530, width: 700, height: 410 },
    journal: { shown: true, counter: 0, eventCount: 2,
      unexpectedInputEvents: 0, sha256: sha(nativeJournal) },
  };
  return { manifest, lease, before, after: structuredClone(before), nativeJournal };
}

function expect(f, status, code) {
  const result = classifyDesktopProbeEvidence(f);
  assert.equal(result.status, status);
  assert.equal(result.reasonCode, code);
  assert.equal(result.readOnly, true);
  const redacted = JSON.stringify(result);
  assert.doesNotMatch(redacted, /S-1-5-21|WindowsForms10|GUI-004|DesktopProbe.exe|native-probe-/);
  return result;
}

test('PASS: exact fresh native PID/HWND/start/session, stable nonfixture foreground, counter zero', () => {
  const r = expect(fixture(), 'PASS', 'COMPLETE_READ_ONLY_IDENTITY');
  assert.equal(r.evidence.manifest, true);
  assert.equal(r.evidence.before, true);
  assert.equal(r.evidence.after, true);
  assert.equal(r.evidence.journal, true);
  assert.equal(r.evidence.unchangedForeground, true);
  assert.equal(r.evidence.unchangedCounter, true);
});

test('PASS: bounded object-or-JSON representations and CRLF-preserving native hash', () => {
  const f = fixture();
  f.manifest = JSON.stringify(f.manifest);
  f.lease = JSON.stringify(f.lease);
  f.before = JSON.stringify(f.before);
  f.after = JSON.stringify(f.after);
  expect(f, 'PASS', 'COMPLETE_READ_ONLY_IDENTITY');
  assert.equal(parseNativeJournal(f.nativeJournal).sha256, sha(f.nativeJournal));
});

test('FAIL: contradictory PID, HWND, process-start or session observer', () => {
  for (const [field, value] of [
    ['pid', 702], ['hwnd', '9003'], ['startedAtUtcTicks', '630000000000000000'],
    ['sessionId', 2],
  ]) {
    const f = fixture();
    f.after[field] = value;
    expect(f, 'FAIL', 'INDEPENDENT_IDENTITY_FAILED');
  }
});

test('FAIL: stale manifest process/start/deadline and forged watchdog lease', () => {
  const old = fixture();
  old.manifest.startedAtUtcTicks = '630000000000000000';
  expect(old, 'FAIL', 'PROBE_OUTSIDE_WATCHDOG_BUDGET');
  const noTime = fixture();
  noTime.manifest.deadlineUtc = new Date(Date.now() + 5_000).toISOString();
  expect(noTime, 'FAIL', 'WATCHDOG_DEADLINE_NEAR');
  const foreign = fixture();
  foreign.lease.owner.pid = 999;
  expect(foreign, 'FAIL', 'WATCHDOG_LEASE_MISMATCH');
});

test('FAIL: changed native counter or extra input event (historical counter1 scenario)', () => {
  const counter = fixture();
  const entries = counter.nativeJournal.toString('utf8').trim().split(/\r?\n/).map(JSON.parse);
  entries[1].counter = 1;
  counter.nativeJournal = entries.map(JSON.stringify).join('\n') + '\n';
  expect(counter, 'FAIL', 'JOURNAL_COUNTER_CHANGED');
  const incremented = fixture();
  incremented.nativeJournal = incremented.nativeJournal.toString('utf8') +
    JSON.stringify({ schemaVersion: 1, stage: 'incremented', pid: 701, counter: 1 }) + '\r\n';
  expect(incremented, 'FAIL', 'JOURNAL_EVENT_COUNT_CHANGED');
});

test('FAIL: mismatched journal PID/HWND/hash and changed foreground', () => {
  const forged = fixture();
  const entries = forged.nativeJournal.toString('utf8').trim().split(/\r?\n/).map(JSON.parse);
  entries[1].hwnd = 9999;
  forged.nativeJournal = entries.map(JSON.stringify).join('\n') + '\n';
  expect(forged, 'FAIL', 'JOURNAL_TARGET_IDENTITY_CHANGED');
  const forgedHash = fixture();
  forgedHash.after.journal.sha256 = 'f'.repeat(64);
  expect(forgedHash, 'FAIL', 'JOURNAL_HASH_DID_NOT_MATCH_ORACLE');
  const focusMoved = fixture();
  focusMoved.after.foregroundHwnd = '9003';
  expect(focusMoved, 'FAIL', 'INDEPENDENT_IDENTITY_FAILED');
});

test('UNKNOWN: foreground owner absent/unobservable is inconclusive, not no-focus proof', () => {
  const a = fixture(); a.manifest.foregroundHwnd = null;
  expect(a, 'UNKNOWN', 'FOREGROUND_UNKNOWN');
  const b = fixture(); b.after.foregroundHwnd = 'unknown';
  expect(b, 'UNKNOWN', 'FOREGROUND_UNKNOWN');
  const c = fixture(); c.before.foregroundHwnd = '0';
  expect(c, 'UNKNOWN', 'FOREGROUND_UNKNOWN');
});

test('UNKNOWN: missing journal, lease, before or after prevents verified read-only claim', () => {
  for (const [field, reason] of [
    ['nativeJournal', 'MISSING_NATIVE_JOURNAL'],
    ['lease', 'MISSING_LEASE'], ['before', 'MISSING_BEFORE'], ['after', 'MISSING_AFTER'],
  ]) {
    const f = fixture();
    delete f[field];
    expect(f, 'UNKNOWN', reason);
  }
});

test('FAIL: oversized, malformed and wrong target requests are bounded', () => {
  const huge = fixture(); huge.nativeJournal = 'x'.repeat(65537);
  expect(huge, 'FAIL', 'NATIVE_JOURNAL_INVALID');
  const invalid = fixture(); invalid.before = '{"pi';
  expect(invalid, 'FAIL', 'BEFORE_MALFORMED');
  const request = fixture(); request.manifest.requestId = 'wrong-request-id';
  expect(request, 'FAIL', 'REQUEST_ID_RUN_MISMATCH');
});
