import { createHash } from 'node:crypto';
import { z } from 'zod';
import { DESKTOP_PROBE_ACTION_POLICY, desktopProbePolicyRequestSchema } from './desktop-action-policy.js';
import type { DesktopActionTarget } from './desktop-action-guard.js';
import { evaluateDesktopSessionPolicy } from './desktop-session-policy.js';

/**
 * Pure AFTER-action verifier, never an authorization, dispatcher or retry policy.
 * Supply independently collected host-owned journal/receipt, native event stream,
 * session observations and GUI-turn records. Booleans below are explicit adapter
 * attestations, not facts this offline function can discover or authenticate.
 * Legacy desktop-probe-act receipts alone intentionally cannot satisfy this API.
 * No approval is created, consumed or inferred; no live adapters are installed.
 */
const MAX_AGE_MS = 2000;
const MAX_ACTION_MS = 5000;
const MAX_LEASE_MS = 30_000;
const stamp = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const mono = z.number().min(0).max(Number.MAX_SAFE_INTEGER);
const positive = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const target = desktopProbePolicyRequestSchema.shape.target;
const binding = { requestId: id, requestHash: hash, target };
const fence = z
  .object({
    ownerId: id,
    contextId: id,
    contextRevision: positive,
    leaseId: id,
    generation: positive,
  })
  .strict();
const lease = fence
  .extend({
    requestHash: hash,
    resource: z.literal('desktop-input'),
    hostSessionId: positive,
    held: z.literal(true),
    exclusive: z.literal(true),
    issuedAtMs: stamp,
    expiresAtMs: stamp,
    observedAtMs: stamp,
    observedAtMonotonicMs: mono,
  })
  .strict();
const counter = z
  .object({
    schemaVersion: z.literal(1),
    pid: positive,
    hwnd: positive,
    sessionId: positive,
    processStartedAt: target.shape.processStartedAt,
    stage: z.enum(['shown', 'incremented', 'reset']),
    counter: z.number().int().min(0).max(100),
    eventAtMs: stamp,
    observedAtMs: stamp,
  })
  .strict();
const rect = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).strict();
const desktop = z
  .object({
    observedAtMs: stamp,
    observedAtMonotonicMs: mono,
    session: z
      .object({
        id: positive,
        ownerSessionId: positive,
        interactive: z.boolean(),
        connectionState: z.string().max(32),
        locked: z.boolean(),
        loggingOff: z.boolean(),
        secureDesktop: z.boolean(),
        windowStation: z.string().max(64),
        inputDesktop: z.string().max(64),
      })
      .strict(),
    window: target
      .extend({
        bounds: rect,
        isForeground: z.boolean(),
        isVisible: z.boolean(),
        isMinimized: z.boolean(),
      })
      .strict(),
    foreground: z.object({ pid: positive, hwnd: positive, sessionId: positive }).strict(),
    monitors: z.array(rect).min(1).max(16),
  })
  .strict();

export const desktopActionPostconditionEvidenceSchema = z
  .object({
    schemaVersion: z.literal(1),
    intent: z
      .object({
        ...binding,
        durable: z.literal(true),
        expectedCount: z.number().int().min(0).max(99),
        fence,
        startedAtMs: stamp,
        startedAtMonotonicMs: mono,
        dispatchedAtMs: stamp,
        dispatchedAtMonotonicMs: mono,
      })
      .strict(),
    receipt: z
      .object({
        ...binding,
        durable: z.literal(true),
        outcome: z.literal('completed'),
        uncertain: z.literal(false),
        timedOut: z.literal(false),
        cancelled: z.literal(false),
        replayed: z.literal(false),
        action: z.literal('invoke'),
        method: z.literal('uia'),
        selector: z.literal('IncrementButton'),
        inputMethod: z.literal('UIAutomation.InvokePattern'),
        performedAction: z.literal('invoke'),
        actionCount: z.literal(1),
        reportedHwnd: positive,
        handleRelationship: z.literal('top-level'),
        osMouseKeyboardInjected: z.literal(false),
        guestInputInjected: z.literal(false),
        expectedCount: z.number().int().min(0).max(99),
        afterCount: z.number().int().min(1).max(100),
        fence,
        startedAtMs: stamp,
        startedAtMonotonicMs: mono,
        completedAtMs: stamp,
        completedAtMonotonicMs: mono,
      })
      .strict(),
    beforeCounter: counter,
    afterCounter: counter,
    // Complete interval AFTER beforeCounter through afterCounter: exactly one
    // native increment, with no intervening reset, duplicate or unexplained event.
    counterIntervalComplete: z.literal(true),
    counterEvents: z.array(counter).length(1),
    beforeDesktop: desktop,
    afterDesktop: desktop,
    focusContinuous: z.literal(true),
    leaseContinuous: z.literal(true),
    beforeLease: lease,
    afterLease: lease,
  })
  .strict();
const timingSchema = z.object({ nowMs: stamp, nowMonotonicMs: mono }).strict();
export type DesktopActionPostconditionEvidence = z.infer<typeof desktopActionPostconditionEvidenceSchema>;
export type DesktopActionPostconditionFence = z.infer<typeof fence>;

export class DesktopActionPostconditionError extends Error {
  readonly code: string;
  constructor(code: string) {
    super('Desktop postcondition could not be verified; no action or retry is authorized.');
    this.name = 'DesktopActionPostconditionError';
    this.code = code;
  }
}
function fail(code: string): never {
  throw new DesktopActionPostconditionError(code);
}
function parse<T>(schema: z.ZodType<T>, value: unknown, code: string): T {
  try {
    const result = schema.safeParse(value);
    if (result.success) return result.data;
  } catch {
    /* Do not expose evidence or validator payloads. */
  }
  return fail(code);
}
function sameTarget(expected: DesktopActionTarget, actual: DesktopActionTarget) {
  return (Object.keys(expected) as (keyof DesktopActionTarget)[]).every((k) => expected[k] === actual[k]);
}
function sameFence(expected: DesktopActionPostconditionFence, actual: DesktopActionPostconditionFence) {
  return (Object.keys(expected) as (keyof DesktopActionPostconditionFence)[]).every(
    (k) => expected[k] === actual[k],
  );
}
function ordered(values: number[], code: string) {
  if (values.some((value, i) => i > 0 && value < values[i - 1]!)) fail(code);
}

/**
 * expectedFence is the captured dispatch fence, not a new lease request. Timing
 * and every observation must share the same trusted wall/monotonic origins.
 * Caller-supplied JSON cannot establish authenticity; integration must resolve
 * evidence from trusted stores and must never treat this result as a permit.
 */
export function verifyDesktopProbeActionPostcondition(
  input: unknown,
  expectedFence: unknown,
  evidence: unknown,
  timing: unknown,
) {
  const request = parse(desktopProbePolicyRequestSchema, input, 'INVALID_POSTCONDITION_REQUEST');
  const expected = parse(fence, expectedFence, 'INVALID_EXPECTED_FENCE');
  const e = parse(desktopActionPostconditionEvidenceSchema, evidence, 'INVALID_POSTCONDITION_EVIDENCE');
  const now = parse(timingSchema, timing, 'INVALID_CLOCK');
  // Keep the canonical binding identical to desktop-action-policy's plan hash.
  const requestHash = createHash('sha256')
    .update(
      JSON.stringify({
        schemaVersion: 1,
        policy: DESKTOP_PROBE_ACTION_POLICY,
        request,
      }),
    )
    .digest('hex');
  const { intent: i, receipt: r, beforeCounter: b, afterCounter: a } = e;
  for (const record of [i, r]) {
    if (
      record.requestId !== request.requestId ||
      record.requestHash !== requestHash ||
      !sameTarget(request.target, record.target) ||
      record.expectedCount !== request.expectedCount
    )
      fail('REQUEST_BINDING_MISMATCH');
    if (!sameFence(expected, record.fence)) fail('LEASE_FENCE_MISMATCH');
  }
  if (r.reportedHwnd !== request.target.hwnd || r.afterCount !== request.expectedCount + 1)
    fail('ACTION_RECEIPT_MISMATCH');
  if (r.startedAtMs !== i.startedAtMs || r.startedAtMonotonicMs !== i.startedAtMonotonicMs)
    fail('ACTION_RECEIPT_MISMATCH');
  const native = e.counterEvents[0]!;
  for (const c of [b, a, native]) {
    if (
      c.pid !== request.target.pid ||
      c.hwnd !== request.target.hwnd ||
      c.sessionId !== request.target.sessionId ||
      c.processStartedAt !== request.target.processStartedAt
    )
      fail('COUNTER_IDENTITY_MISMATCH');
    if (
      c.eventAtMs < Date.parse(request.target.processStartedAt) ||
      c.eventAtMs > c.observedAtMs ||
      c.observedAtMs > now.nowMs ||
      now.nowMs - c.eventAtMs > MAX_AGE_MS
    )
      fail('STALE_COUNTER_EVIDENCE');
  }
  if (
    b.stage === 'reset' ||
    (b.stage === 'shown' && b.counter !== 0) ||
    (b.stage === 'incremented' && b.counter === 0) ||
    b.counter !== request.expectedCount ||
    a.stage !== 'incremented' ||
    a.counter !== request.expectedCount + 1 ||
    JSON.stringify(native) !== JSON.stringify(a)
  )
    fail('COUNTER_TRANSITION_MISMATCH');
  if (a.eventAtMs <= i.dispatchedAtMs || a.eventAtMs <= b.eventAtMs) fail('AMBIGUOUS_COUNTER_EVENT');
  ordered(
    [
      i.startedAtMs,
      e.beforeDesktop.observedAtMs,
      e.beforeLease.observedAtMs,
      b.observedAtMs,
      i.dispatchedAtMs,
      a.eventAtMs,
      a.observedAtMs,
      r.completedAtMs,
      e.afterDesktop.observedAtMs,
      e.afterLease.observedAtMs,
      now.nowMs,
    ],
    'EVENT_ORDER_MISMATCH',
  );
  ordered(
    [
      i.startedAtMonotonicMs,
      e.beforeDesktop.observedAtMonotonicMs,
      e.beforeLease.observedAtMonotonicMs,
      i.dispatchedAtMonotonicMs,
      r.completedAtMonotonicMs,
      e.afterDesktop.observedAtMonotonicMs,
      e.afterLease.observedAtMonotonicMs,
      now.nowMonotonicMs,
    ],
    'CLOCK_REGRESSED',
  );
  if (
    Date.parse(request.target.processStartedAt) > i.startedAtMs ||
    now.nowMs - i.startedAtMs > MAX_ACTION_MS ||
    now.nowMonotonicMs - i.startedAtMonotonicMs > MAX_ACTION_MS ||
    now.nowMs - r.completedAtMs > MAX_AGE_MS ||
    now.nowMonotonicMs - r.completedAtMonotonicMs > MAX_AGE_MS
  )
    fail('POSTCONDITION_EXPIRED');
  for (const d of [e.beforeDesktop, e.afterDesktop]) {
    if (now.nowMs - d.observedAtMs > MAX_AGE_MS) fail('STALE_DESKTOP_EVIDENCE');
    const decision = evaluateDesktopSessionPolicy(request.target, d, {
      nowMonotonicMs: now.nowMonotonicMs,
      notBeforeMonotonicMs: i.startedAtMonotonicMs,
    });
    if (!decision.allowed) fail(decision.reason);
  }
  for (const l of [e.beforeLease, e.afterLease]) {
    if (
      !sameFence(expected, l) ||
      l.requestHash !== requestHash ||
      l.hostSessionId !== request.target.sessionId
    )
      fail('LEASE_FENCE_MISMATCH');
    if (
      l.issuedAtMs > i.startedAtMs ||
      l.expiresAtMs <= now.nowMs ||
      l.expiresAtMs <= l.issuedAtMs ||
      l.expiresAtMs - l.issuedAtMs > MAX_LEASE_MS
    )
      fail('LEASE_EXPIRED');
    if (now.nowMs - l.observedAtMs > MAX_AGE_MS || now.nowMonotonicMs - l.observedAtMonotonicMs > MAX_AGE_MS)
      fail('STALE_LEASE_EVIDENCE');
  }
  if (
    e.beforeLease.issuedAtMs !== e.afterLease.issuedAtMs ||
    e.beforeLease.expiresAtMs !== e.afterLease.expiresAtMs
  )
    fail('LEASE_FENCE_MISMATCH');
  return Object.freeze({
    schemaVersion: 1 as const,
    readOnly: true as const,
    postconditionVerified: true as const,
    authorizesAction: false as const,
    executable: false as const,
    retryAllowed: false as const,
    requestId: request.requestId,
    requestHash,
    target: Object.freeze({ ...request.target }),
    beforeCount: b.counter,
    afterCount: a.counter,
    verifiedAtMs: now.nowMs,
  });
}
