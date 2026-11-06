import { z } from 'zod';

// Validation of bounded JSON from the disposable .NET native snapshot candidate.
// Does not authenticate the producer, align its monotonic clock or certify an interval.
const unsigned = z.number().int().positive().safe();
const handle = z.string().regex(/^-?(?:0|[1-9][0-9]{0,19})$/);
const tick = z.string().regex(/^[1-9][0-9]{0,19}$/);
const rectangle = z
  .object({
    x: z.number().int().safe(),
    y: z.number().int().safe(),
    width: z.number().int().positive().max(32768),
    height: z.number().int().positive().max(32768),
  })
  .strict();
const identity = z
  .object({
    pid: unsigned,
    hwnd: unsigned,
    sessionId: unsigned,
    processStartedAt: z.string().datetime({ offset: false }),
  })
  .strict();
const sample = z
  .object({
    observedAtUtc: z.string().datetime({ offset: false }),
    observerTick: tick,
    observerFrequency: tick,
    outerRect: rectangle,
    clientRect: rectangle,
    windowDpi: z.number().int().min(48).max(960),
    monitorDpi: z.number().int().min(48).max(960),
    monitorHandle: handle,
    isWindowVisible: z.boolean(),
    isMinimized: z.boolean(),
    isEnabled: z.boolean(),
    cloaked: z.boolean(),
    foregroundHwnd: handle,
    isForeground: z.boolean(),
    centerHitRootHwnd: handle,
    visibleOwnedTopLevelCount: z.number().int().min(0).max(64),
  })
  .strict();

export const nativeSurfaceSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal('desktopprobe-native-surface-snapshot'),
    status: z.literal('OBSERVED_NOT_VERIFIED'),
    target: identity,
    sample,
    modalCoverage: z.literal('unknown'),
    occlusion: z.literal('unknown'),
    actionAuthorized: z.literal(false),
    inputInjected: z.literal(false),
  })
  .strict();

const result = (status, code, observedAtUtc) =>
  Object.freeze({
    status,
    code,
    observedAtUtc: observedAtUtc ?? null,
    independentOriginVerified: false,
    intervalCoverageVerified: false,
    authorizesAction: false,
    retryAllowed: false,
  });

/**
 * Advisory preflight of a native, target-pinned *snapshot* against a separately
 * pinned expected target. No path can return VERIFIED or fabricate full coverage.
 * A missing or suspect snapshot is UNKNOWN, not evidence of a safe retry.
 */
export function assessDesktopProbeNativeSurface(raw, expectedTarget) {
  const actual = nativeSurfaceSnapshotSchema.safeParse(raw);
  const expected = identity.safeParse(expectedTarget);
  if (!actual.success || !expected.success) return result('UNKNOWN', 'INVALID_OR_MISSING_NATIVE_SNAPSHOT');
  const { target, sample: s } = actual.data;
  const birth = Date.parse(target.processStartedAt);
  const expectedBirth = Date.parse(expected.data.processStartedAt);
  if (!Number.isFinite(birth) || !Number.isFinite(expectedBirth))
    return result('UNKNOWN', 'INVALID_PROCESS_BIRTH');
  if (
    target.pid !== expected.data.pid ||
    target.hwnd !== expected.data.hwnd ||
    target.sessionId !== expected.data.sessionId ||
    birth !== expectedBirth
  )
    return result('REJECTED', 'NATIVE_TARGET_IDENTITY_CHANGED', s.observedAtUtc);

  // A time-stamped point sample may positively observe a bad state. Absence of
  // these signals does NOT imply a continuously safe target or full screenshot.
  if (!s.isWindowVisible || s.isMinimized || s.cloaked)
    return result('REJECTED', 'NATIVE_TARGET_NOT_VISIBLE', s.observedAtUtc);
  if (!s.isForeground) return result('REJECTED', 'NATIVE_FOREGROUND_LOST', s.observedAtUtc);
  if (s.centerHitRootHwnd !== String(target.hwnd))
    return result('REJECTED', 'NATIVE_CENTER_HIT_OCCLUDED', s.observedAtUtc);
  if (s.visibleOwnedTopLevelCount > 0 || !s.isEnabled)
    return result('UNKNOWN', 'POSSIBLE_OWNED_MODAL', s.observedAtUtc);

  // Must be corroborated by independently validated and timed action/capture
  // receipts, a complete modal observer and separate occlusion interval proof.
  return result('UNKNOWN', 'NATIVE_SNAPSHOT_ONLY', s.observedAtUtc);
}
