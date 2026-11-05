import test from 'node:test';
import assert from 'node:assert/strict';
import { planPhysicalRiftRetryClick } from './rift-retry-click-plan.mjs';

const target = Object.freeze({
  pid: 32156, hwnd: 462734, startedUtc: '2026-11-05T15:31:50.6416621Z', sessionId: 1,
});
const window = Object.freeze({
  pid: target.pid, hwnd: target.hwnd, process: 'rift_x64', title: 'RIFT',
  className: 'TWNClientFramework', ownerHwnd: 0, isForeground: true,
  isVisible: true, x: -1928, y: -2, width: 1936, height: 1048,
});
const capture = Object.freeze({
  pid: target.pid, hwnd: target.hwnd, process: 'rift_x64',
  expectedClass: 'TWNClientFramework', title: 'RIFT',
  requestId: 'rre_retry_capture_20261105_a1',
  sha256: 'a'.repeat(64), capturedUtc: '2026-11-05T23:15:00.000Z',
  width: 1936, height: 1048, imageBytesVerified: true,
  imageSha256Verified: true, imageDimensionsVerified: true,
  inputInjected: false, foregroundMayChange: true,
});
const uiaRoot = Object.freeze({
  hwnd: target.hwnd, className: 'TWNClientFramework',
  isEnabled: true, isOffscreen: false,
  x: window.x, y: window.y, width: window.width, height: window.height,
});
const visual = Object.freeze({
  captureRequestId: capture.requestId, captureSha256: capture.sha256,
  attestation: 'rrecollector-0.4.11-retry-button-visible',
  rect: { left: 1480, top: 445, right: 1548, bottom: 474 },
});
function fixture() {
  return {
    target, processBefore: target, processAfter: target, windowBefore: window, windowAfter: window, uiaRootAfter: uiaRoot,
    capture, visual, nowUtc: '2026-11-05T23:15:05.000Z',
    dpiAwareness: 'per-monitor-v2',
    desktop: { coordinateSpace: 'physical-virtual-screen-pixels', pointerPositionVerified: true, windowFramePixelsVerified: true },
  };
}
function reject(update, code) {
  assert.throws(() => planPhysicalRiftRetryClick({ ...fixture(), ...update }), (e) => e.code === code);
}
test('negative-coordinate monitor yields exact physical virtual-screen center; no executable sender', () => {
  const p = planPhysicalRiftRetryClick(fixture());
  assert.deepEqual(p.virtualScreenPoint, { x: -414, y: 457 });
  assert.equal(p.executable, false);
  assert.equal(p.liveAuthorized, false);
  assert.equal(p.proposedTransport, 'FlaUI.Core.Input.Mouse.Click(Point)');
});
test('wrong target HWND/PID or title fails closed', () => {
  reject({ windowAfter: { ...window, hwnd: 123 } }, 'STALE_WINDOW');
  reject({ windowAfter: { ...window, title: 'Not RIFT' } }, 'STALE_WINDOW');
});
test('capture may affect foreground; independent post-capture foreground is mandatory', () =>
  reject({ windowAfter: { ...window, isForeground: false } }, 'STALE_WINDOW'));
test('changed geometry, including a one-monitor shift, is refused', () =>
  reject({ windowAfter: { ...window, x: 0 } }, 'WINDOW_GEOMETRY_CHANGED'));
test('stale or future screenshots are refused', () => {
  reject({ nowUtc: '2026-11-05T23:15:31.001Z' }, 'CAPTURE_STALE');
  reject({ nowUtc: '2026-11-05T23:14:58.000Z' }, 'CAPTURE_STALE');
});
test('snapshot proof and visual SHA are bound', () => {
  reject({ capture: { ...capture, imageBytesVerified: false } }, 'CAPTURE_UNVERIFIED');
  reject({ visual: { ...visual, captureSha256: 'b'.repeat(64) } }, 'VISUAL_ATTESTATION_REQUIRED');
});
test('independent process-start witness required on both sides of capture', () => {
  reject({ processAfter: { ...target, startedUtc: '2026-11-05T15:31:45.000Z' } }, 'PROCESS_IDENTITY_UNVERIFIED');
});
test('DPI/physical-pixel proof is required; logical or virtualized coordinates rejected', () =>
  reject({ dpiAwareness: 'system' }, 'DPI_COORDINATE_UNVERIFIED'));
test('click rectangle must be bounded within captured button', () => {
  reject({ visual: { ...visual, rect: { left: 0, top: 0, right: 1000, bottom: 999 } } }, 'UNSAFE_BUTTON_RECT');
});
test('custom game toolbar is not semantically exposed; this module has no live execute function', async () => {
  const m = await import('./rift-retry-click-plan.mjs');
  assert.equal(typeof m.executeRetryClick, 'undefined');
});
