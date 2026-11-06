import assert from 'node:assert/strict';
import test from 'node:test';
import { assessDesktopProbeNativeSurface, nativeSurfaceSnapshotSchema } from './native-surface-snapshot.mjs';

const expected = Object.freeze({
  pid: 100,
  hwnd: 123456,
  sessionId: 2,
  processStartedAt: '2026-11-06T10:00:00.000Z',
});
const good = () => ({
  schemaVersion: 1,
  kind: 'desktopprobe-native-surface-snapshot',
  status: 'OBSERVED_NOT_VERIFIED',
  target: { ...expected, processStartedAt: '2026-11-06T10:00:00.0000000Z' },
  sample: {
    observedAtUtc: '2026-11-06T10:01:00.0000000Z',
    observerTick: '146001230',
    observerFrequency: '10000000',
    outerRect: { x: -300, y: 100, width: 720, height: 460 },
    clientRect: { x: -290, y: 140, width: 700, height: 410 },
    windowDpi: 144,
    monitorDpi: 144,
    monitorHandle: '9876',
    isWindowVisible: true,
    isMinimized: false,
    isEnabled: true,
    cloaked: false,
    foregroundHwnd: '123456',
    isForeground: true,
    centerHitRootHwnd: '123456',
    visibleOwnedTopLevelCount: 0,
  },
  modalCoverage: 'unknown',
  occlusion: 'unknown',
  actionAuthorized: false,
  inputInjected: false,
});
const check = (snapshot, code, status = 'UNKNOWN') => {
  const outcome = assessDesktopProbeNativeSurface(snapshot, expected);
  assert.equal(outcome.code, code);
  assert.equal(outcome.status, status);
  assert.equal(outcome.independentOriginVerified, false);
  assert.equal(outcome.intervalCoverageVerified, false);
  assert.equal(outcome.authorizesAction, false);
  assert.equal(outcome.retryAllowed, false);
};

test('point sample is parseable but never a verified interval', () => {
  assert.equal(nativeSurfaceSnapshotSchema.safeParse(good()).success, true);
  check(good(), 'NATIVE_SNAPSHOT_ONLY');
});

test('missing, malformed and fabricated coverage fail closed', () => {
  check(undefined, 'INVALID_OR_MISSING_NATIVE_SNAPSHOT');
  const forged = good();
  forged.modalCoverage = 'complete';
  check(forged, 'INVALID_OR_MISSING_NATIVE_SNAPSHOT');
  const fakeClear = good();
  fakeClear.occlusion = 'clear';
  check(fakeClear, 'INVALID_OR_MISSING_NATIVE_SNAPSHOT');
  const extra = good();
  extra.extraPassword = 'do not log';
  check(extra, 'INVALID_OR_MISSING_NATIVE_SNAPSHOT');
});

test('identity reuse, other Windows session and other HWND are rejected', () => {
  for (const mutation of [
    (s) => {
      s.target.pid++;
    },
    (s) => {
      s.target.hwnd++;
    },
    (s) => {
      s.target.sessionId++;
    },
    (s) => {
      s.target.processStartedAt = '2026-11-06T10:00:01.000Z';
    },
  ]) {
    const snapshot = good();
    mutation(snapshot);
    check(snapshot, 'NATIVE_TARGET_IDENTITY_CHANGED', 'REJECTED');
  }
});

test('hidden, minimized and cloaked target are rejected', () => {
  for (const mutation of [
    (s) => {
      s.sample.isWindowVisible = false;
    },
    (s) => {
      s.sample.isMinimized = true;
    },
    (s) => {
      s.sample.cloaked = true;
    },
  ]) {
    const snapshot = good();
    mutation(snapshot);
    check(snapshot, 'NATIVE_TARGET_NOT_VISIBLE', 'REJECTED');
  }
});

test('foreground loss and center hit occlusion reject', () => {
  const unfocused = good();
  unfocused.sample.isForeground = false;
  check(unfocused, 'NATIVE_FOREGROUND_LOST', 'REJECTED');
  const obscured = good();
  obscured.sample.centerHitRootHwnd = '654321';
  check(obscured, 'NATIVE_CENTER_HIT_OCCLUDED', 'REJECTED');
});

test('possible owned window and owner disabled remain UNKNOWN', () => {
  const owned = good();
  owned.sample.visibleOwnedTopLevelCount = 1;
  check(owned, 'POSSIBLE_OWNED_MODAL');
  const disabled = good();
  disabled.sample.isEnabled = false;
  check(disabled, 'POSSIBLE_OWNED_MODAL');
});

test('invalid DPI, geometry, invented timestamps and injected input reject schema', () => {
  const invalid = [
    (s) => {
      s.sample.clientRect.width = -1;
    },
    (s) => {
      s.sample.windowDpi = 0;
    },
    (s) => {
      s.sample.monitorDpi = 2000;
    },
    (s) => {
      s.sample.observerTick = '-1';
    },
    (s) => {
      s.sample.observedAtUtc = 'not-a-date';
    },
    (s) => {
      s.inputInjected = true;
    },
    (s) => {
      s.actionAuthorized = true;
    },
  ];
  for (const mutation of invalid) {
    const snapshot = good();
    mutation(snapshot);
    check(snapshot, 'INVALID_OR_MISSING_NATIVE_SNAPSHOT');
  }
});
