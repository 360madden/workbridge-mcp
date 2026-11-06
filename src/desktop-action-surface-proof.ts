import { z } from 'zod';
import { desktopActionPostconditionEvidenceSchema } from './desktop-action-postcondition.js';
import { evaluateDesktopSessionPolicy } from './desktop-session-policy.js';

/**
 * M2 source-only evaluator of separately collected Windows/UIA surface facts.
 * The caller must independently obtain these observations; a producer-filled
 * object cannot establish its own origin or prove unobserved transient events.
 * No Windows/VM input, image capture, retry or authorization occurs here.
 */
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const stamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const monotonic = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER);
const bounds = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
  })
  .strict();
const uiObservation = z
  .object({
    observedAtMs: stamp,
    observedAtMonotonicMs: monotonic,
    pid: positive,
    hwnd: positive,
    sessionId: positive,
    processStartedAt: z.string().datetime({ offset: false }),
    clientRect: bounds,
    windowDpi: z.number().int().min(48).max(960),
    monitorDpi: z.number().int().min(48).max(960),
    ownedModalCount: z.number().int().min(0).max(64),
    modalCoverage: z.enum(['complete', 'unknown']),
    occlusion: z.enum(['clear', 'occluded', 'unknown']),
    cloaked: z.boolean(),
  })
  .strict();

export const desktopActionSurfaceEvidenceSchema = z
  .object({
    schemaVersion: z.literal(1),
    beforeAction: uiObservation,
    afterAction: uiObservation,
    afterCapture: uiObservation,
    afterCaptureDesktop: desktopActionPostconditionEvidenceSchema.shape.afterDesktop,
  })
  .strict();

export class DesktopActionSurfaceProofError extends Error {
  readonly code: string;
  readonly status: 'REJECTED' | 'UNKNOWN';
  readonly retryAllowed = false;
  constructor(code: string, status: 'REJECTED' | 'UNKNOWN') {
    super('After-capture desktop surface could not be verified; no retry is authorized.');
    this.name = 'DesktopActionSurfaceProofError';
    this.code = code;
    this.status = status;
  }
}

function fail(code: string, status: 'REJECTED' | 'UNKNOWN'): never {
  throw new DesktopActionSurfaceProofError(code, status);
}
function rectEqual(a: z.infer<typeof bounds>, b: z.infer<typeof bounds>): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}
function topologyEqual(a: readonly z.infer<typeof bounds>[], b: readonly z.infer<typeof bounds>[]): boolean {
  if (a.length !== b.length) return false;
  const key = (r: z.infer<typeof bounds>) => [r.x, r.y, r.width, r.height].join(':');
  const left = a.map(key).sort();
  const right = b.map(key).sort();
  return left.every((value, index) => value === right[index]);
}

/** All clocks must come from one trusted wall/monotonic clock pair. */
export function verifyDesktopProbeAfterCaptureSurface(
  target: z.infer<typeof desktopActionPostconditionEvidenceSchema>['intent']['target'],
  actionEvidence: z.infer<typeof desktopActionPostconditionEvidenceSchema>,
  clock: { nowMs: number; nowMonotonicMs: number },
  captureAtMs: number,
  rawSurface: unknown,
) {
  const parsed = desktopActionSurfaceEvidenceSchema.safeParse(rawSurface);
  if (!parsed.success) fail('SURFACE_EVIDENCE_MISSING', 'UNKNOWN');
  const s = parsed.data;
  const { beforeAction: b, afterAction: a, afterCapture: c, afterCaptureDesktop: d } = s;
  const e = actionEvidence;
  for (const observation of [b, a, c]) {
    if (
      observation.pid !== target.pid ||
      observation.hwnd !== target.hwnd ||
      observation.sessionId !== target.sessionId ||
      observation.processStartedAt !== target.processStartedAt
    )
      fail('SURFACE_TARGET_CHANGED', 'REJECTED');
  }
  if (
    b.observedAtMs < e.beforeDesktop.observedAtMs ||
    b.observedAtMs >= e.intent.dispatchedAtMs ||
    a.observedAtMs < e.afterDesktop.observedAtMs ||
    a.observedAtMs > captureAtMs ||
    d.observedAtMs < captureAtMs ||
    c.observedAtMs < d.observedAtMs ||
    c.observedAtMs > clock.nowMs ||
    b.observedAtMonotonicMs < e.beforeDesktop.observedAtMonotonicMs ||
    b.observedAtMonotonicMs >= e.intent.dispatchedAtMonotonicMs ||
    a.observedAtMonotonicMs < e.afterDesktop.observedAtMonotonicMs ||
    d.observedAtMonotonicMs < e.afterDesktop.observedAtMonotonicMs ||
    c.observedAtMonotonicMs < d.observedAtMonotonicMs ||
    c.observedAtMonotonicMs > clock.nowMonotonicMs ||
    a.observedAtMonotonicMs > d.observedAtMonotonicMs ||
    a.observedAtMs > d.observedAtMs ||
    clock.nowMs - c.observedAtMs > 2000 ||
    clock.nowMonotonicMs - c.observedAtMonotonicMs > 2000
  )
    fail('SURFACE_TIME_UNCERTAIN', 'UNKNOWN');

  const desktop = evaluateDesktopSessionPolicy(target, d, {
    nowMonotonicMs: clock.nowMonotonicMs,
    notBeforeMonotonicMs: e.intent.startedAtMonotonicMs,
    previousMonotonicMs: e.afterDesktop.observedAtMonotonicMs,
  });
  if (!desktop.allowed) {
    const status = ['STALE_OBSERVATION', 'INVALID_CLOCK', 'CLOCK_REGRESSED', 'INVALID_OBSERVATION'].includes(
      desktop.reason,
    )
      ? 'UNKNOWN'
      : 'REJECTED';
    fail('POST_CAPTURE_DESKTOP_' + desktop.reason, status);
  }
  if (
    !rectEqual(d.window.bounds, e.afterDesktop.window.bounds) ||
    !topologyEqual(d.monitors, e.afterDesktop.monitors)
  )
    fail('POST_CAPTURE_GEOMETRY_CHANGED', 'REJECTED');
  if (!rectEqual(b.clientRect, a.clientRect) || !rectEqual(a.clientRect, c.clientRect))
    fail('CLIENT_GEOMETRY_CHANGED', 'REJECTED');
  // All rectangles are in physical screen pixels. Refuse a stale coordinate
  // mapping even if three client rectangles happen to agree with each other.
  const outer = d.window.bounds;
  const slack = 24; // DWM invisible borders and ordinary window frame variance.
  if (
    [b, a, c].some(
      ({ clientRect: r }) =>
        r.x < outer.x - slack ||
        r.y < outer.y - slack ||
        r.x + r.width > outer.x + outer.width + slack ||
        r.y + r.height > outer.y + outer.height + slack,
    )
  )
    fail('CLIENT_OUTSIDE_TARGET', 'REJECTED');
  if (
    b.windowDpi !== a.windowDpi ||
    a.windowDpi !== c.windowDpi ||
    b.monitorDpi !== a.monitorDpi ||
    a.monitorDpi !== c.monitorDpi
  )
    fail('SURFACE_DPI_CHANGED', 'REJECTED');

  for (const observation of [b, a, c]) {
    if (observation.modalCoverage !== 'complete') fail('MODAL_OBSERVER_INCOMPLETE', 'UNKNOWN');
    if (observation.ownedModalCount > 0) fail('UNEXPECTED_OWNED_MODAL', 'REJECTED');
    if (observation.occlusion === 'unknown') fail('OCCLUSION_UNOBSERVED', 'UNKNOWN');
    if (observation.occlusion === 'occluded') fail('TARGET_OCCLUDED', 'REJECTED');
    if (observation.cloaked) fail('TARGET_CLOAKED', 'REJECTED');
  }

  return Object.freeze({
    surfaceVerified: true as const,
    afterCaptureObservedAtMs: d.observedAtMs,
    observerCoverage: 'three-snapshots' as const,
    screenshotContentSemanticsVerified: false as const,
    retryAllowed: false as const,
    authorizesAction: false as const,
  });
}
