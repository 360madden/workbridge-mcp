import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  previewDesktopAction,
  type DesktopActionGuardDependencies,
  type DesktopActionTarget,
} from './desktop-action-guard.js';
import { createDesktopSessionObserver, type DesktopSessionObservation } from './desktop-session-policy.js';

/**
 * Preparation only: no runner, registration, lock acquisition or input backend.
 * The coordinator supplies trusted read-only observers, never caller assertions.
 * Verification is an observation, not a transferable execution permit. Integration
 * must revalidate immediately before dispatch, retain/fence the shared GUI turn,
 * and use the existing pilot's durable intent/receipt and native postcondition.
 * Do not acquire desktop-input-turn.lock here: the pilot already owns that lock.
 */
export const DESKTOP_PROBE_ACTION_POLICY = Object.freeze({
  process: 'DesktopProbe',
  title: 'Workbridge GUI-004 Native Input Probe',
  selector: 'IncrementButton',
  controlType: 'Button',
  action: 'invoke',
  method: 'uia',
  mechanism: 'UIAutomation.InvokePattern',
  resource: 'desktop-input',
} as const);

const MAX_PREPARATION_MS = 5000;
const MAX_EVIDENCE_AGE_MS = 2000;
const MAX_APPROVAL_MS = 60_000;
const MAX_LEASE_MS = 30_000;
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/);
const positive = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const timestamp = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const boundedText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[^\u0000-\u001f\u007f]+$/)
    .refine((s) => !!s.trim());
const processStartedAt = z.string().refine((s) => {
  const parsed = Date.parse(s);
  return s.length === 24 && Number.isFinite(parsed) && new Date(parsed).toISOString() === s;
});

const targetSchema = z
  .object({
    pid: positive.max(0x7fffffff),
    hwnd: positive,
    process: z.literal(DESKTOP_PROBE_ACTION_POLICY.process),
    title: z.literal(DESKTOP_PROBE_ACTION_POLICY.title),
    className: boundedText(100),
    processStartedAt,
    sessionId: positive.max(0x7fffffff),
  })
  .strict();

export const desktopProbePolicyRequestSchema = z
  .object({
    requestId: id,
    action: z.literal('invoke'),
    target: targetSchema,
    expectedCount: z.number().int().min(0).max(99),
  })
  .strict();

export type DesktopProbePolicyRequest = z.infer<typeof desktopProbePolicyRequestSchema>;

const counterSchema = z
  .object({
    schemaVersion: z.literal(1),
    pid: positive,
    hwnd: positive,
    sessionId: positive,
    processStartedAt,
    stage: z.enum(['shown', 'incremented', 'reset']),
    counter: z.number().int().min(0).max(100),
    eventAtMs: timestamp,
    observedAtMs: timestamp,
  })
  .strict();

export type DesktopProbeCounterObservation = z.infer<typeof counterSchema>;

/** Wall time is UTC epoch milliseconds; monotonic time has a single local origin. */
export type DesktopActionPlanningDependencies = Omit<DesktopActionGuardDependencies, 'observeDesktop'> & {
  now: () => number;
  nowMonotonicMs: () => number;
  observeDesktop: (target: DesktopActionTarget) => Promise<DesktopSessionObservation>;
  // Resolve the exact native-probe log without accepting caller-controlled paths;
  // validate its HWND/session/lifetime as well as PID, then project these fields.
  readNativeCounter: (request: Readonly<DesktopProbePolicyRequest>) => Promise<unknown>;
};

const referencesSchema = z
  .object({
    ownerId: id,
    contextId: id,
    approvalId: id,
    leaseId: id,
  })
  .strict();
export type DesktopActionAuthorityReferences = z.infer<typeof referencesSchema>;

const contextSchema = z
  .object({
    contextId: id,
    ownerId: id,
    revision: positive,
    hostSessionId: positive,
    active: z.literal(true),
    observedAtMs: timestamp,
  })
  .strict();
const approvalSchema = z
  .object({
    approvalId: id,
    contextId: id,
    ownerId: id,
    contextRevision: positive,
    requestHash: z.string().regex(/^[a-f0-9]{64}$/),
    decision: z.literal('approved'),
    issuedAtMs: timestamp,
    expiresAtMs: timestamp,
    observedAtMs: timestamp,
  })
  .strict();
const leaseSchema = z
  .object({
    leaseId: id,
    contextId: id,
    ownerId: id,
    contextRevision: positive,
    requestHash: z.string().regex(/^[a-f0-9]{64}$/),
    resource: z.literal('desktop-input'),
    hostSessionId: positive,
    held: z.literal(true),
    exclusive: z.literal(true),
    generation: positive,
    issuedAtMs: timestamp,
    expiresAtMs: timestamp,
    observedAtMs: timestamp,
  })
  .strict();

export type DesktopActionContextEvidence = z.infer<typeof contextSchema>;
export type DesktopActionApprovalEvidence = z.infer<typeof approvalSchema>;
export type DesktopActionLeaseEvidence = z.infer<typeof leaseSchema>;
export type DesktopActionAuthorityQuery = Readonly<
  DesktopActionAuthorityReferences & {
    requestId: string;
    requestHash: string;
    hostSessionId: number;
  }
>;

export type DesktopActionVerificationDependencies = DesktopActionPlanningDependencies & {
  // These functions must consult host-owned stores. In particular inspectLease
  // verifies current exclusive ownership AND its fencing generation; it must not
  // synthesize a grant from an ID or steal/recover an orphaned pilot lock.
  inspectContext: (query: DesktopActionAuthorityQuery) => Promise<unknown>;
  inspectApproval: (query: DesktopActionAuthorityQuery) => Promise<unknown>;
  inspectLease: (query: DesktopActionAuthorityQuery) => Promise<unknown>;
};

export class DesktopActionPolicyError extends Error {
  readonly code: string;
  constructor(code: string) {
    super('Desktop action preparation denied; no action was dispatched.');
    this.name = 'DesktopActionPolicyError';
    this.code = code;
  }
}
function fail(code: string): never {
  throw new DesktopActionPolicyError(code);
}
function parse<T>(schema: z.ZodType<T>, value: unknown, code: string): T {
  try {
    const result = schema.safeParse(value);
    if (result.success) return result.data;
  } catch {
    /* Never expose observer payloads or validation values. */
  }
  return fail(code);
}
function freeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function clock(deps: DesktopActionPlanningDependencies) {
  if (typeof deps?.now !== 'function' || typeof deps.nowMonotonicMs !== 'function') fail('INVALID_CLOCK');
  let firstWall: number | undefined, firstMono: number | undefined;
  let lastWall = 0,
    lastMono = 0;
  return () => {
    let wall: number, mono: number;
    try {
      wall = deps.now();
      mono = deps.nowMonotonicMs();
    } catch {
      return fail('INVALID_CLOCK');
    }
    if (
      !Number.isSafeInteger(wall) ||
      !Number.isFinite(mono) ||
      wall < lastWall ||
      mono < lastMono ||
      mono > Number.MAX_SAFE_INTEGER
    )
      fail('INVALID_CLOCK');
    firstWall ??= wall;
    firstMono ??= mono;
    if (wall - firstWall > MAX_PREPARATION_MS || mono - firstMono > MAX_PREPARATION_MS)
      fail('PREPARATION_EXPIRED');
    lastWall = wall;
    lastMono = mono;
    return wall;
  };
}
function fresh(observed: number, started: number, completed: number): void {
  if (observed < started || observed > completed || completed - observed > MAX_EVIDENCE_AGE_MS)
    fail('STALE_POLICY_EVIDENCE');
}
async function bounded<T>(work: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new DesktopActionPolicyError('PREPARATION_EXPIRED')),
          MAX_PREPARATION_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function inspect<T>(schema: z.ZodType<T>, provider: () => Promise<unknown>, code: string): Promise<T> {
  let value: unknown;
  try {
    value = await provider();
  } catch {
    return fail(code);
  }
  return parse(schema, value, code);
}

function requestHash(request: DesktopProbePolicyRequest): string {
  // Schema parsing fixes key order, includes the full lifetime identity and count,
  // and excludes live geometry so the reviewed operation has a stable binding.
  return createHash('sha256')
    .update(
      JSON.stringify({
        schemaVersion: 1,
        policy: DESKTOP_PROBE_ACTION_POLICY,
        request,
      }),
    )
    .digest('hex');
}

async function prepare(input: unknown, deps: DesktopActionPlanningDependencies, tick: () => number) {
  const request = freeze(parse(desktopProbePolicyRequestSchema, input, 'INVALID_POLICY_REQUEST'));
  if (typeof deps?.readNativeCounter !== 'function') fail('MISSING_COUNTER_OBSERVER');
  const preview = await previewDesktopAction(
    {
      requestId: request.requestId,
      action: 'invoke',
      target: request.target,
      selector: DESKTOP_PROBE_ACTION_POLICY.selector,
      expectedControlType: DESKTOP_PROBE_ACTION_POLICY.controlType,
    },
    {
      executeReadOnly: deps.executeReadOnly,
      observeDesktop: createDesktopSessionObserver({
        observeDesktop: deps.observeDesktop,
        nowMonotonicMs: deps.nowMonotonicMs,
      }),
      now: tick,
    },
  );
  const started = tick();
  const counter = await inspect(
    counterSchema,
    () => deps.readNativeCounter(request),
    'INVALID_COUNTER_EVIDENCE',
  );
  const completed = tick();
  fresh(counter.observedAtMs, started, completed);
  const t = request.target;
  if (
    counter.pid !== t.pid ||
    counter.hwnd !== t.hwnd ||
    counter.sessionId !== t.sessionId ||
    counter.processStartedAt !== t.processStartedAt ||
    counter.eventAtMs < Date.parse(t.processStartedAt) ||
    counter.eventAtMs > counter.observedAtMs
  )
    fail('COUNTER_IDENTITY_MISMATCH');
  if (counter.counter !== request.expectedCount) fail('EXPECTED_STATE_MISMATCH');
  if (completed - preview.evidence.completedAtMs > MAX_EVIDENCE_AGE_MS) fail('STALE_POLICY_EVIDENCE');
  return freeze({
    schemaVersion: 1 as const,
    readOnly: true as const,
    dryRun: true as const,
    executed: false as const,
    executable: false as const,
    requiresFreshExecutionValidation: true as const,
    request,
    requestHash: requestHash(request),
    policy: DESKTOP_PROBE_ACTION_POLICY,
    preview,
    counter,
    preparedAtMs: completed,
  });
}

/** Every invocation gathers fresh UIA, desktop and independent counter evidence. */
export async function planDesktopProbeAction(input: unknown, deps: DesktopActionPlanningDependencies) {
  const tick = clock(deps);
  tick();
  return bounded(() => prepare(input, deps, tick));
}

/**
 * References alone carry no authority. Re-read trusted context, approval and lease
 * records on every verification, even for identical request IDs. This does not
 * consume approval, reserve input, clear an intent or dispatch/replay the pilot.
 */
export async function verifyDesktopProbeActionAuthorization(
  input: unknown,
  references: unknown,
  deps: DesktopActionVerificationDependencies,
) {
  const refs = parse(referencesSchema, references, 'INVALID_AUTHORITY_REFERENCES');
  for (const key of ['inspectContext', 'inspectApproval', 'inspectLease'] as const)
    if (typeof deps?.[key] !== 'function') fail('MISSING_AUTHORITY_OBSERVER');
  const tick = clock(deps);
  tick();
  return bounded(async () => {
    const plan = await prepare(input, deps, tick);
    const query = freeze({
      ...refs,
      requestId: plan.request.requestId,
      requestHash: plan.requestHash,
      hostSessionId: plan.request.target.sessionId,
    });
    const contextStarted = tick();
    const context = await inspect(contextSchema, () => deps.inspectContext(query), 'CONTEXT_NOT_READY');
    fresh(context.observedAtMs, contextStarted, tick());
    function assertContext(c: DesktopActionContextEvidence) {
      if (
        c.contextId !== refs.contextId ||
        c.ownerId !== refs.ownerId ||
        c.hostSessionId !== query.hostSessionId ||
        c.revision !== context.revision
      )
        fail('CONTEXT_MISMATCH');
    }
    assertContext(context);
    const approvalStarted = tick();
    const approval = await inspect(approvalSchema, () => deps.inspectApproval(query), 'APPROVAL_NOT_READY');
    fresh(approval.observedAtMs, approvalStarted, tick());
    const leaseStarted = tick();
    const lease = await inspect(leaseSchema, () => deps.inspectLease(query), 'LEASE_NOT_READY');
    fresh(lease.observedAtMs, leaseStarted, tick());
    const finalContextStarted = tick();
    const finalContext = await inspect(contextSchema, () => deps.inspectContext(query), 'CONTEXT_NOT_READY');
    const completed = tick();
    fresh(finalContext.observedAtMs, finalContextStarted, completed);
    assertContext(finalContext);
    for (const [evidence, maximum] of [
      [approval, MAX_APPROVAL_MS],
      [lease, MAX_LEASE_MS],
    ] as const) {
      if (
        evidence.contextId !== refs.contextId ||
        evidence.ownerId !== refs.ownerId ||
        evidence.contextRevision !== context.revision ||
        evidence.requestHash !== plan.requestHash
      )
        fail('AUTHORITY_BINDING_MISMATCH');
      if (
        evidence.issuedAtMs > evidence.observedAtMs ||
        evidence.expiresAtMs <= completed ||
        evidence.expiresAtMs <= evidence.issuedAtMs ||
        evidence.expiresAtMs - evidence.issuedAtMs > maximum
      )
        fail('AUTHORITY_EXPIRED');
      fresh(evidence.observedAtMs, plan.preparedAtMs, completed);
    }
    if (
      approval.approvalId !== refs.approvalId ||
      lease.leaseId !== refs.leaseId ||
      lease.hostSessionId !== query.hostSessionId
    )
      fail('AUTHORITY_BINDING_MISMATCH');
    if (
      completed - plan.preview.evidence.completedAtMs > MAX_EVIDENCE_AGE_MS ||
      completed - plan.counter.observedAtMs > MAX_EVIDENCE_AGE_MS
    )
      fail('STALE_POLICY_EVIDENCE');
    return freeze({
      ...plan,
      authorizationVerified: true as const,
      verifiedAtMs: completed,
      authority: {
        ownerId: refs.ownerId,
        contextId: refs.contextId,
        contextRevision: context.revision,
        approvalId: refs.approvalId,
        leaseId: refs.leaseId,
        leaseGeneration: lease.generation,
        expiresAtMs: Math.min(approval.expiresAtMs, lease.expiresAtMs),
      },
    });
  });
}
