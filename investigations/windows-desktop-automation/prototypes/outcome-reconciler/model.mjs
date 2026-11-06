// D1 offline outcome reducer: pure, deterministic, no filesystem, process, network,
// timers, UI Automation, MCP, Windows desktop, or game input. NOT an action runner.
// Sources are trusted evidence adapters in a future integration; this function
// validates envelopes/causality, but cannot authenticate their real-world claims.

export const OUTCOME_STATES = Object.freeze([
  'blocked', 'pending', 'verified_success', 'verified_failure', 'unknown_outcome',
]);
export const PHASE_NAMES = Object.freeze([
  'L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8',
]);
const SHA = /^[a-f0-9]{64}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,63}$/;
const NS = /^(0|[1-9]\d{0,24})$/;
const MAX_EVENTS = 128;
const MAX_EVENT_BYTES = 4096;
const FRESH_NS = 2_000_000_000n;
const TARGET_KEYS = ['pid', 'hwnd', 'process', 'title', 'className', 'processStartedAt', 'sessionId'];
const OWNER_KEYS = ['pid', 'startedUtcTicks', 'sessionId', 'jobId'];
const BASE_EVENT_KEYS = [
  'seq', 'kind', 'source', 'requestId', 'requestHash', 'providerHash',
  'leaseId', 'generation', 'target', 'clockDomain', 'tNs',
];
const SOURCES = Object.freeze({
  request_received: 'workbridge',
  admission_denied: 'workbridge',
  gui_turn_acquired: 'workbridge',
  before_durable: 'native-oracle',
  intent_durable: 'workbridge',
  worker_registered: 'workbridge',
  worker_ready: 'supervisor',
  worker_alive: 'supervisor',
  worker_never_started: 'supervisor',
  worker_lost: 'supervisor',
  dispatch_entered: 'workbridge',
  provider_ack: 'provider',
  provider_timeout: 'provider',
  provider_status_pending: 'provider',
  snapshot_incomplete: 'provider',
  modal_opened: 'native-observer',
  modal_closed: 'native-observer',
  target_changed: 'native-observer',
  lease_held: 'native-observer',
  oracle_observed: 'native-oracle',
  oracle_verified_once: 'postcondition',
  oracle_terminal_no_effect: 'postcondition',
  oracle_contradiction: 'postcondition',
  deadline_expired: 'supervisor',
  job_settled: 'supervisor',
  lease_released: 'workbridge',
  lease_release_verified: 'native-observer',
  receipt_durable: 'workbridge',
});
const EXTRAS = Object.freeze({
  worker_registered: ['owner'],
  worker_ready: ['owner'],
  worker_alive: ['owner'],
  worker_lost: ['owner'],
  worker_never_started: [],
  dispatch_entered: ['providerCallId'],
  job_settled: ['owner', 'activeCount'],
  lease_held: ['owner'],
  provider_ack: ['providerCallId'],
  provider_timeout: ['providerCallId'],
  provider_status_pending: ['providerCallId'],
  modal_opened: ['modalHwnd', 'ownerHwnd'],
  modal_closed: ['modalHwnd', 'ownerHwnd'],
  oracle_verified_once: ['proofHash'],
  oracle_terminal_no_effect: ['proofHash', 'terminalNoQueued'],
  oracle_contradiction: ['proofHash'],
  receipt_durable: ['receiptHash'],
});

export class OutcomeModelError extends TypeError {
  constructor(code) {
    super(code);
    this.name = 'OutcomeModelError';
    this.code = code;
  }
}
function invalid(code) { throw new OutcomeModelError(code); }
function record(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
function onlyKeys(value, keys) {
  return record(value) && Object.keys(value).every((k) => keys.includes(k));
}
function ns(value) {
  if (typeof value !== 'string' || !NS.test(value)) invalid('INVALID_CLOCK');
  return BigInt(value);
}
function ownerValid(owner) {
  return onlyKeys(owner, OWNER_KEYS) &&
    OWNER_KEYS.every((k) => Object.hasOwn(owner, k)) &&
    Number.isSafeInteger(owner.pid) && owner.pid > 0 &&
    Number.isSafeInteger(owner.sessionId) && owner.sessionId > 0 &&
    typeof owner.startedUtcTicks === 'string' && NS.test(owner.startedUtcTicks) &&
    typeof owner.jobId === 'string' && ID.test(owner.jobId);
}
function sameOwner(a, b) {
  return ownerValid(a) && ownerValid(b) && OWNER_KEYS.every((key) => a[key] === b[key]);
}
function targetValid(target) {
  return onlyKeys(target, TARGET_KEYS) &&
    TARGET_KEYS.every((k) => Object.hasOwn(target, k)) &&
    Number.isSafeInteger(target.pid) && target.pid > 0 &&
    Number.isSafeInteger(target.hwnd) && target.hwnd > 0 &&
    Number.isSafeInteger(target.sessionId) && target.sessionId > 0 &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(target.processStartedAt) &&
    !Number.isNaN(Date.parse(target.processStartedAt)) &&
    ['process', 'title', 'className', 'processStartedAt'].every((k) =>
      typeof target[k] === 'string' && target[k].length > 0 && target[k].length <= 200);
}
function sameTarget(a, b) {
  return targetValid(a) && targetValid(b) && TARGET_KEYS.every((key) => a[key] === b[key]);
}
function validateIntent(i, nowNs) {
  if (!onlyKeys(i, [
    'schemaVersion', 'requestId', 'requestHash', 'providerId',
    'providerHash', 'target', 'leaseId', 'generation',
    'clockDomain', 'deadlineNs',
  ]) || i.schemaVersion !== 1 ||
      ['requestId', 'requestHash', 'providerId', 'providerHash', 'leaseId', 'clockDomain']
        .some((k) => typeof i[k] !== 'string') ||
      !ID.test(i.requestId) || !SHA.test(i.requestHash) ||
      !SHA.test(i.providerHash) || !ID.test(i.providerId) ||
      !ID.test(i.leaseId) ||
      !Number.isSafeInteger(i.generation) || i.generation < 1 ||
      !targetValid(i.target) || !ID.test(i.clockDomain)) invalid('INVALID_INTENT');
  ns(i.deadlineNs);
  return ns(nowNs);
}
function validateEvent(e, index) {
  if (!record(e) || !Object.hasOwn(SOURCES, e.kind) || e.source !== SOURCES[e.kind] ||
      !onlyKeys(e, [...BASE_EVENT_KEYS, ...(EXTRAS[e.kind] ?? [])]) ||
      BASE_EVENT_KEYS.some((key) => !Object.hasOwn(e, key)) ||
      e.seq !== index + 1 || !Number.isSafeInteger(e.seq) ||
      typeof e.requestId !== 'string' || typeof e.requestHash !== 'string' ||
      typeof e.providerHash !== 'string' || typeof e.leaseId !== 'string' ||
      typeof e.clockDomain !== 'string' || !Number.isSafeInteger(e.generation) ||
      !targetValid(e.target)) invalid('INVALID_EVENT');
  if (JSON.stringify(e).length > MAX_EVENT_BYTES) invalid('EVENT_TOO_LARGE');
  ns(e.tNs);
  if (['worker_registered', 'worker_ready', 'worker_alive', 'worker_lost', 'lease_held', 'job_settled']
      .includes(e.kind) && !ownerValid(e.owner)) invalid('INVALID_EVENT');
  if (e.kind === 'job_settled' && e.activeCount !== 0) invalid('INVALID_EVENT');
  if (['dispatch_entered', 'provider_ack', 'provider_timeout', 'provider_status_pending'].includes(e.kind) &&
      (typeof e.providerCallId !== 'string' || !ID.test(e.providerCallId))) invalid('INVALID_EVENT');
  if (['modal_opened', 'modal_closed'].includes(e.kind) &&
      (![e.modalHwnd, e.ownerHwnd].every((n) => Number.isSafeInteger(n) && n > 0))) invalid('INVALID_EVENT');
  if (['oracle_verified_once', 'oracle_terminal_no_effect', 'oracle_contradiction'].includes(e.kind) &&
      (typeof e.proofHash !== 'string' || !SHA.test(e.proofHash))) invalid('INVALID_EVENT');
  if (e.kind === 'oracle_terminal_no_effect' && e.terminalNoQueued !== true) invalid('INVALID_EVENT');
  if (e.kind === 'receipt_durable' &&
      (typeof e.receiptHash !== 'string' || !SHA.test(e.receiptHash))) invalid('INVALID_EVENT');
}
function freezeDeep(value) {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) freezeDeep(v);
    Object.freeze(value);
  }
  return value;
}
function first(byKind, kind) { return (byKind.get(kind) ?? [])[0] ?? null; }
function last(byKind, kind) { return (byKind.get(kind) ?? []).at(-1) ?? null; }
function duration(start, end) {
  if (!start || !end || BigInt(end.tNs) < BigInt(start.tNs)) return null;
  return {
    from: start.kind,
    to: end.kind,
    durationNs: String(BigInt(end.tNs) - BigInt(start.tNs)),
  };
}
function phaseSpans(byKind) {
  const get = (k) => first(byKind, k);
  const providerEnd = get('provider_ack') ?? get('provider_timeout');
  const postcondition = get('oracle_verified_once') ?? get('oracle_terminal_no_effect');
  const modalStarted = get('modal_opened');
  const modalEnd = get('modal_closed') ?? get('deadline_expired');
  return {
    L0: duration(get('request_received'), get('gui_turn_acquired')),
    L1: duration(get('gui_turn_acquired'), get('before_durable')),
    L2: duration(get('intent_durable'), get('worker_ready')),
    L3: duration(get('dispatch_entered'), providerEnd),
    L4: modalStarted ? duration(get('dispatch_entered'), modalEnd) : null,
    L5: duration(get('dispatch_entered'), get('oracle_observed')),
    L6: duration(get('oracle_observed'), postcondition),
    L7: duration(providerEnd, get('lease_release_verified')),
    L8: duration(get('request_received'), get('receipt_durable')),
  };
}

/**
 * Pure reduction of already authenticated, bounded, immutable events.
 * This offline model does not authorize dispatch, retry, recovery or lock release.
 * 'verified_success' requires the existing independent postcondition verifier's
 * attestation plus separately attested process-tree and lease settlement.
 */
export function reduceDesktopOutcome(intent, events, nowNs) {
  const now = validateIntent(intent, nowNs);
  if (!Array.isArray(events) || events.length > MAX_EVENTS) invalid('INVALID_EVENTS');
  const byKind = new Map();
  let mismatch = false;
  let clockProblem = false;
  let changedTarget = false;
  let lastLocalNs = -1n;
  for (const [index, e] of events.entries()) {
    validateEvent(e, index);
    const t = BigInt(e.tNs);
    if (e.requestId !== intent.requestId || e.requestHash !== intent.requestHash ||
        e.providerHash !== intent.providerHash || e.leaseId !== intent.leaseId ||
        e.generation !== intent.generation) mismatch = true;
    if (e.kind === 'target_changed') changedTarget = true;
    else if (!sameTarget(intent.target, e.target)) mismatch = true;
    if (e.clockDomain !== intent.clockDomain) clockProblem = true;
    else if (t < lastLocalNs || t > now) clockProblem = true;
    else lastLocalNs = t;
    if (!byKind.has(e.kind)) byKind.set(e.kind, []);
    byKind.get(e.kind).push(e);
  }
  const f = (k) => first(byKind, k);
  const l = (k) => last(byKind, k);
  const single = (k) => (byKind.get(k) ?? []).length <= 1;
  const entered = !!f('dispatch_entered');
  const registered = f('worker_registered')?.owner;
  const alive = l('worker_alive');
  const held = l('lease_held');
  const settled = f('job_settled');
  const released = f('lease_released');
  const verifiedRelease = f('lease_release_verified');
  const opens = byKind.get('modal_opened') ?? [];
  const closes = byKind.get('modal_closed') ?? [];
  const modalIdentity = opens.every((e) => e.ownerHwnd === intent.target.hwnd) &&
    closes.every((e) => e.ownerHwnd === intent.target.hwnd) &&
    (!closes.length || (opens.length === 1 && closes.length === 1 &&
      opens[0].modalHwnd === closes[0].modalHwnd &&
      opens[0].ownerHwnd === closes[0].ownerHwnd &&
      BigInt(opens[0].tNs) <= BigInt(closes[0].tNs)));
  const modalOpen = opens.length > 0 && closes.length === 0;
  const workerIdentity = registered &&
    ['worker_ready', 'worker_alive', 'worker_lost', 'job_settled', 'lease_held'].every((k) =>
      (byKind.get(k) ?? []).every((e) => sameOwner(registered, e.owner)));
  const oneProof = f('oracle_verified_once');
  const negative = f('oracle_terminal_no_effect');
  const proofs = (byKind.get('oracle_verified_once') ?? []).length +
    (byKind.get('oracle_terminal_no_effect') ?? []).length +
    (byKind.get('oracle_contradiction') ?? []).length;
  const contradictory = proofs > 1 || !!f('oracle_contradiction');
  const order = (...kinds) => {
    const present = kinds.map((k) => f(k)).filter(Boolean);
    return present.every((e, i) => i === 0 || BigInt(present[i - 1].tNs) <= BigInt(e.tNs));
  };
  const passivePolls = new Set([
    'worker_alive', 'lease_held', 'provider_status_pending', 'snapshot_incomplete',
  ]);
  const providerCallId = f('dispatch_entered')?.providerCallId;
  const providerBinding = ['provider_ack', 'provider_timeout', 'provider_status_pending']
    .every((k) => (byKind.get(k) ?? [])
      .every((e) => providerCallId && e.providerCallId === providerCallId));
  const causal = order('request_received', 'gui_turn_acquired', 'before_durable',
      'intent_durable', 'dispatch_entered', 'oracle_observed') &&
    order('gui_turn_acquired', 'lease_held', 'dispatch_entered') &&
    order('oracle_observed', 'oracle_verified_once', 'receipt_durable') &&
    order('oracle_observed', 'oracle_terminal_no_effect', 'receipt_durable') &&
    order('worker_registered', 'worker_ready', 'dispatch_entered') &&
    order('dispatch_entered', 'provider_ack') &&
    order('dispatch_entered', 'provider_timeout') &&
    order('dispatch_entered', 'provider_status_pending') &&
    order('dispatch_entered', 'job_settled', 'lease_released',
      'lease_release_verified', 'receipt_durable') &&
    (!entered || (!!f('worker_registered') && !!f('worker_ready') &&
      !!f('lease_held') && !!f('intent_durable'))) &&
    [...byKind.keys()].every((k) => passivePolls.has(k) || single(k));
  const leaseAfterRelease = !!f('lease_release_verified') &&
    (byKind.get('lease_held') ?? []).some((e) =>
      BigInt(e.tNs) >= BigInt(f('lease_release_verified').tNs));
  const aliveAfterSettle = !!settled &&
    (byKind.get('worker_alive') ?? []).some((e) => BigInt(e.tNs) >= BigInt(settled.tNs));
  const structuralProblem = mismatch || clockProblem || (registered && !workerIdentity) ||
    (entered && changedTarget) || !modalIdentity || !providerBinding || !causal ||
    leaseAfterRelease || aliveAfterSettle ||
    (!!f('worker_never_started') && (!!registered || entered)) ||
    (!!f('admission_denied') && !!f('gui_turn_acquired'));
  const hasBeforeAndIntent = !!f('before_durable') && !!f('intent_durable') &&
    !!f('request_received') && !!f('gui_turn_acquired');
  const hasOracle = !!f('oracle_observed') && hasBeforeAndIntent && entered;
  const semanticProof = contradictory ? 'contradictory' :
    structuralProblem || !hasOracle ? 'incomplete' :
    oneProof ? 'applied_once' :
    negative ? 'terminal_no_effect' : 'incomplete';
  const cleanupVerified = !!(settled && released && verifiedRelease &&
    registered && f('worker_ready') && f('lease_held') && entered &&
    workerIdentity && hasBeforeAndIntent && !structuralProblem);
  const cleanup = cleanupVerified ? 'owned_tree_settled_and_lease_released' :
    entered || registered ? 'quarantined' : 'not_started';
  const currentOwner = !!(registered && alive && held && workerIdentity &&
    sameOwner(registered, alive.owner) && sameOwner(registered, held.owner) &&
    now >= BigInt(alive.tNs) && now - BigInt(alive.tNs) <= FRESH_NS &&
    now >= BigInt(held.tNs) && now - BigInt(held.tNs) <= FRESH_NS &&
    now < BigInt(intent.deadlineNs) && !settled);
  const downstreamKinds = [
    'worker_alive', 'worker_lost', 'lease_held', 'provider_ack', 'provider_timeout',
    'provider_status_pending', 'snapshot_incomplete', 'modal_opened', 'modal_closed',
    'oracle_observed', 'oracle_verified_once', 'oracle_terminal_no_effect',
    'oracle_contradiction', 'job_settled', 'lease_released', 'lease_release_verified',
  ];
  const blockedBeforeDispatch = !entered && !registered &&
    !downstreamKinds.some((k) => !!f(k)) &&
    (!!f('admission_denied') || !!f('worker_never_started') || changedTarget);
  const terminal = cleanupVerified && !!f('receipt_durable') && !modalOpen &&
    !structuralProblem && !contradictory;
  let state = 'unknown_outcome';
  let reasonCode = 'INCOMPLETE_INDEPENDENT_PROOF';
  if (!structuralProblem && blockedBeforeDispatch) {
    state = 'blocked';
    reasonCode = 'PRE_DISPATCH_REFUSAL';
  } else if (terminal && semanticProof === 'applied_once') {
    state = 'verified_success';
    reasonCode = 'INDEPENDENT_EFFECT_AND_SETTLEMENT';
  } else if (terminal && semanticProof === 'terminal_no_effect' && negative.terminalNoQueued) {
    state = 'verified_failure';
    reasonCode = 'AUTHORITATIVE_TERMINAL_NO_EFFECT';
  } else if (!structuralProblem && !oneProof && !negative && !f('worker_lost') &&
      !f('provider_timeout') && !f('deadline_expired') && currentOwner &&
      hasBeforeAndIntent && !contradictory) {
    state = 'pending';
    reasonCode = modalOpen ? 'OWNED_MODAL_PENDING' : 'WORKER_PENDING';
  } else if (mismatch) reasonCode = 'BINDING_MISMATCH';
  else if (clockProblem) reasonCode = 'CLOCK_AMBIGUOUS';
  else if (structuralProblem) reasonCode = 'EVIDENCE_OR_IDENTITY_CONTRADICTION';
  else if (f('provider_timeout')) reasonCode = 'PROVIDER_TIMEOUT_UNCERTAIN';
  else if (f('worker_lost')) reasonCode = 'WORKER_LOST_UNCERTAIN';
  else if (now >= BigInt(intent.deadlineNs)) reasonCode = 'DEADLINE_EXPIRED_UNCERTAIN';
  else if (semanticProof === 'applied_once' && !cleanupVerified)
    reasonCode = 'EFFECT_PROVED_SETTLEMENT_UNKNOWN';
  const spans = structuralProblem ?
    Object.fromEntries(PHASE_NAMES.map((k) => [k, null])) : phaseSpans(byKind);
  return freezeDeep({
    schemaVersion: 1,
    requestId: intent.requestId,
    requestHash: intent.requestHash,
    providerHash: intent.providerHash,
    state,
    reasonCode,
    retryAllowed: false,
    authorizesInput: false,
    semanticProof,
    cleanup,
    operationTracking: state === 'pending' ? (modalOpen ? 'modal_known' : 'active_known') :
      f('worker_lost') ? 'lost_unknown' : 'inactive',
    phaseSpans: spans,
    phasesAdditive: false,
    retainedEventCount: events.length,
  });
}
