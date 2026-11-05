// OFFLINE-ONLY physical RIFT RRECollector Retry-button geometry gate.
// This file has NO mouse, keyboard, focus, screenshot, or process invocation.
// A future live adapter must wrap it in the *existing* Workbridge desktop
// admission + input-turn lock with fsynced one-shot intent and quarantine.
// FlaUI Core Input.Mouse.Click(System.Drawing.Point) is the proposed transport,
// not yet linked, tested against disposable app, or approved for live RIFT.
export class RetryClickPlanError extends Error {
  constructor(code, message) { super(message); this.name = 'RetryClickPlanError'; this.code = code; }
}
function fail(code, message) { throw new RetryClickPlanError(code, message); }
const integer = (v) => Number.isSafeInteger(v);
const sha = (v) => /^[a-f0-9]{64}$/i.test(v ?? '');
const boundedId = (v) => /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(v ?? '');
const iso = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/.test(v) && Number.isFinite(Date.parse(v));
const close = (a, b) => Math.abs(a - b) <= 1;

/**
 * Build a NON-EXECUTABLE physical-pixel click plan for one exact GUI target.
 *
 * All inputs must derive from independently observed Windows process identity,
 * WinApp's exact top-level RIFT window, verified capture receipt+PNG hash, and
 * explicit human visual selection of the Retry button. windowBefore is
 * captured before screenshot; windowAfter and uiaRootAfter are sampled after
 * screenshot because WinApp capture may change foreground. Do not use monitor-
 * relative offsets, DPI-scaled coordinates, or preview image dimensions.
 */
export function planPhysicalRiftRetryClick({
  target, processBefore, processAfter, windowBefore, windowAfter, uiaRootAfter, capture, visual, desktop,
  nowUtc, dpiAwareness,
}) {
  if (!target || !integer(target.pid) || target.pid < 1 ||
      !integer(target.hwnd) || target.hwnd < 1 ||
      !iso(target.startedUtc) || !integer(target.sessionId) || target.sessionId < 0) {
    fail('INVALID_TARGET', 'Pinned PID/HWND/start/session required');
  }
  const processMatch = (p) => p && p.pid === target.pid && p.sessionId === target.sessionId &&
    iso(p.startedUtc) && Math.abs(Date.parse(p.startedUtc) - Date.parse(target.startedUtc)) <= 1;
  if (!processMatch(processBefore) || !processMatch(processAfter)) {
    fail('PROCESS_IDENTITY_UNVERIFIED', 'Independent process start/session witness missing before or after capture');
  }
  const identity = (w) => w &&
    w.pid === target.pid && w.hwnd === target.hwnd &&
    w.process === 'rift_x64' && w.title === 'RIFT' &&
    w.className === 'TWNClientFramework' && w.ownerHwnd === 0;
  if (!identity(windowBefore) || !identity(windowAfter) ||
      !windowAfter.isForeground || !windowAfter.isVisible) {
    fail('STALE_WINDOW', 'Exact physical RIFT window must remain visible and foreground after capture');
  }
  const rectKeys = ['x', 'y', 'width', 'height'];
  if (!rectKeys.every((k) => integer(windowBefore[k]) && integer(windowAfter[k])) ||
      windowAfter.width < 700 || windowAfter.height < 500 ||
      !rectKeys.every((k) => close(windowBefore[k], windowAfter[k]))) {
    fail('WINDOW_GEOMETRY_CHANGED', 'Fresh window bounds changed or invalid');
  }
  if (!uiaRootAfter || uiaRootAfter.hwnd !== target.hwnd ||
      uiaRootAfter.className !== 'TWNClientFramework' ||
      !uiaRootAfter.isEnabled || uiaRootAfter.isOffscreen ||
      !rectKeys.every((k) => integer(uiaRootAfter[k]) && close(uiaRootAfter[k], windowAfter[k]))) {
    fail('UIA_ROOT_CHANGED', 'Independent top-level RIFT UIA geometry did not match');
  }
  if (dpiAwareness !== 'per-monitor-v2' ||
      desktop?.coordinateSpace !== 'physical-virtual-screen-pixels' ||
      desktop?.pointerPositionVerified !== true ||
      desktop?.windowFramePixelsVerified !== true) {
    fail('DPI_COORDINATE_UNVERIFIED', 'FlaUI global screen coordinates require DPI-aware physical-pixel verification');
  }
  if (!capture || capture.pid !== target.pid || capture.hwnd !== target.hwnd ||
      capture.process !== 'rift_x64' || capture.expectedClass !== 'TWNClientFramework' ||
      capture.title !== 'RIFT' || !capture.imageBytesVerified ||
      !capture.imageSha256Verified || !capture.imageDimensionsVerified ||
      capture.inputInjected !== false || !boundedId(capture.requestId) ||
      !sha(capture.sha256) || !iso(capture.capturedUtc) ||
      capture.width !== windowAfter.width || capture.height !== windowAfter.height ||
      Date.parse(capture.capturedUtc) < Date.parse(target.startedUtc) ||
      !iso(nowUtc)) {
    fail('CAPTURE_UNVERIFIED', 'Capture metadata/PNG/window dimensions not proven');
  }
  const age = Date.parse(nowUtc) - Date.parse(capture.capturedUtc);
  if (age < -1000 || age > 30000) fail('CAPTURE_STALE', 'Capture older than 30 seconds or in the future');
  if (!visual || visual.captureRequestId !== capture.requestId ||
      visual.captureSha256 !== capture.sha256 ||
      visual.attestation !== 'rrecollector-0.4.11-retry-button-visible' ||
      !visual.rect || !['left', 'top', 'right', 'bottom'].every((k) => integer(visual.rect[k]))) {
    fail('VISUAL_ATTESTATION_REQUIRED', 'Explicit pinned Retry-button visual rectangle required');
  }
  const { left, top, right, bottom } = visual.rect;
  if (left < 10 || top < 32 || right > capture.width - 10 ||
      bottom > capture.height - 10 || right - left < 35 ||
      right - left > 120 || bottom - top < 18 || bottom - top > 50) {
    fail('UNSAFE_BUTTON_RECT', 'Click rectangle did not resemble a bounded toolbar button');
  }
  const x = windowAfter.x + Math.floor((left + right) / 2);
  const y = windowAfter.y + Math.floor((top + bottom) / 2);
  if (!integer(x) || !integer(y) ||
      x <= windowAfter.x || x >= windowAfter.x + windowAfter.width ||
      y <= windowAfter.y || y >= windowAfter.y + windowAfter.height) {
    fail('OUT_OF_WINDOW', 'Computed physical coordinate is outside the target window');
  }
  return Object.freeze({
    kind: 'physical-rift-retry-OFFLINE-PLAN',
    executable: false, liveAuthorized: false,
    target: Object.freeze({ ...target }),
    captureRequestId: capture.requestId, captureSha256: capture.sha256,
    sourceWindowRect: Object.freeze(Object.fromEntries(rectKeys.map((k) => [k, windowAfter[k]]))),
    virtualScreenPoint: Object.freeze({ x, y }),
    proposedTransport: 'FlaUI.Core.Input.Mouse.Click(Point)',
    requiredNextGate: 'Synthetic disposable-app click then separate target-specific live approval',
  });
}
