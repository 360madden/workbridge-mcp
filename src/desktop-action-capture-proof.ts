import { createHash } from 'node:crypto';
import { z } from 'zod';
import { loadDesktopImage } from './desktop-image.js';
import {
  DesktopActionSurfaceProofError,
  verifyDesktopProbeAfterCaptureSurface,
} from './desktop-action-surface-proof.js';
import {
  desktopActionPostconditionEvidenceSchema,
  verifyDesktopProbeActionPostcondition,
} from './desktop-action-postcondition.js';

/**
 * M2 offline evidence assembly only. Does not take a screenshot, operate a desktop,
 * acquire an input lease, authorize another action or inspect PNG visual semantics.
 * The default image loader checks the actual on-disk PNG bytes, dimensions and SHA.
 * The caller must independently originate capture metadata and native observations.
 */
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const requestId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/);
const captureSchema = z.object({
  schemaVersion: z.literal(1),
  ok: z.literal(true),
  replayed: z.literal(false),
  requestId,
  pid: z.number().int().positive(),
  hwnd: z.number().int().positive(),
  process: z.string().min(1).max(80),
  title: z.string().min(1).max(200),
  expectedClass: z.string().min(1).max(100),
  capturedUtc: z.string().datetime({ offset: false }),
  imagePath: z.string().min(1).max(32767),
  width: z.number().int().min(1).max(10000),
  height: z.number().int().min(1).max(10000),
  sizeBytes: z
    .number()
    .int()
    .min(45)
    .max(8 * 1024 * 1024),
  sha256: sha,
  inputInjected: z.literal(false),
  foregroundMayChange: z.literal(true),
});
const clockSchema = z.object({
  nowMs: z.number().int().nonnegative(),
  nowMonotonicMs: z.number().nonnegative().finite(),
});
const MAX_CAPTURE_AGE_MS = 2000;
const FRAME_DELTA_PX = 96;

export class DesktopActionCaptureProofError extends Error {
  readonly code: string;
  readonly status: 'REJECTED' | 'UNKNOWN';
  readonly retryAllowed = false;
  constructor(code: string, status: 'REJECTED' | 'UNKNOWN' = 'UNKNOWN') {
    super('M2 after-action capture evidence could not be verified; no retry is authorized.');
    this.name = 'DesktopActionCaptureProofError';
    this.code = code;
    this.status = status;
  }
}
function fail(code: string, status: 'REJECTED' | 'UNKNOWN' = 'UNKNOWN'): never {
  throw new DesktopActionCaptureProofError(code, status);
}

/** Deterministically bind a separate one-shot capture ID to the action ID. */
export function desktopActionCaptureId(actionId: string): string {
  if (!requestId.safeParse(actionId).success) fail('INVALID_ACTION_ID');
  return (
    'm2_' +
    createHash('sha256').update('workbridge.m2.capture.v1\0').update(actionId).digest('hex').slice(0, 32)
  );
}

type ImageLoader = typeof loadDesktopImage;

export async function verifyDesktopProbeActionCaptureProof(
  actionRequest: unknown,
  expectedFence: unknown,
  actionEvidence: unknown,
  timing: unknown,
  captureReceipt: unknown,
  surfaceEvidence: unknown,
  imageLoader: ImageLoader = loadDesktopImage,
) {
  // Native postcondition must succeed BEFORE touching a screenshot or trusting
  // a WinApp success receipt. Invalid or uncertain action evidence stops here.
  let post;
  try {
    post = verifyDesktopProbeActionPostcondition(actionRequest, expectedFence, actionEvidence, timing);
  } catch {
    fail('NATIVE_POSTCONDITION_UNVERIFIED');
  }
  const evidence = desktopActionPostconditionEvidenceSchema.safeParse(actionEvidence);
  const clock = clockSchema.safeParse(timing);
  const capture = captureSchema.safeParse(captureReceipt);
  if (!evidence.success || !clock.success || !capture.success) fail('INVALID_CAPTURE_EVIDENCE', 'REJECTED');
  const c = capture.data;
  const target = post.target;
  if (
    c.requestId !== desktopActionCaptureId(post.requestId) ||
    c.pid !== target.pid ||
    c.hwnd !== target.hwnd ||
    c.process !== target.process ||
    c.title !== target.title ||
    c.expectedClass !== target.className
  )
    fail('CAPTURE_TARGET_MISMATCH', 'REJECTED');

  const capturedMs = Date.parse(c.capturedUtc);
  if (
    !Number.isFinite(capturedMs) ||
    new Date(capturedMs).toISOString() !== c.capturedUtc ||
    capturedMs <= evidence.data.receipt.completedAtMs ||
    capturedMs < evidence.data.afterDesktop.observedAtMs ||
    capturedMs > clock.data.nowMs ||
    clock.data.nowMs - capturedMs > MAX_CAPTURE_AGE_MS
  )
    fail('CAPTURE_NOT_FRESH');

  // The desktop fixture is an ordinary bordered window; capture dimensions may
  // exclude non-client chrome, but must describe this same-sized target.
  const bounds = evidence.data.afterDesktop.window.bounds;
  if (
    Math.abs(c.width - bounds.width) > FRAME_DELTA_PX ||
    Math.abs(c.height - bounds.height) > FRAME_DELTA_PX
  )
    fail('CAPTURE_GEOMETRY_MISMATCH', 'REJECTED');

  // A screenshot may change the foreground. Recheck host/session/geometry and
  // independent UIA/Win32 surface signals AFTER capture, before reading bytes.
  let surface;
  try {
    surface = verifyDesktopProbeAfterCaptureSurface(
      target,
      evidence.data,
      clock.data,
      capturedMs,
      surfaceEvidence,
    );
  } catch (error) {
    if (error instanceof DesktopActionSurfaceProofError) fail(error.code, error.status);
    fail('SURFACE_UNVERIFIED');
  }

  let image;
  try {
    // c is a copied/validated snapshot; caller mutation after the first await
    // cannot redirect the file path or alter the expected hash.
    image = await imageLoader(c);
  } catch {
    fail('CAPTURE_IMAGE_UNVERIFIED');
  }
  if (
    image.requestId !== c.requestId ||
    image.mimeType !== 'image/png' ||
    image.sha256 !== c.sha256 ||
    image.width !== c.width ||
    image.height !== c.height ||
    image.sizeBytes !== c.sizeBytes
  )
    fail('CAPTURE_IMAGE_MISMATCH', 'REJECTED');

  return Object.freeze({
    schemaVersion: 1 as const,
    status: 'VERIFIED' as const,
    nativeActionEffectVerified: true as const,
    pngArtifactVerified: true as const,
    afterCaptureSurfaceVerified: surface.surfaceVerified,
    afterCaptureObservedAtMs: surface.afterCaptureObservedAtMs,
    screenshotContentSemanticsVerified: false as const,
    authorizesAction: false as const,
    retryAllowed: false as const,
    requestId: post.requestId,
    captureRequestId: c.requestId,
    pid: target.pid,
    hwnd: target.hwnd,
    imageSha256: image.sha256,
    imageDimensions: Object.freeze({ width: image.width, height: image.height }),
    capturedAtMs: capturedMs,
  });
}
