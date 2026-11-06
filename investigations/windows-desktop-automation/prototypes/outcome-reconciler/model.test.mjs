// D1 deterministic fixtures only: no child processes, MCP, GUI, COM, WinApp, RIFT or VMware.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OutcomeModelError, OUTCOME_STATES, PHASE_NAMES, reduceDesktopOutcome,
} from './model.mjs';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const HASH_D = 'd'.repeat(64);
const BASE_NS = 100_000_000_000n;
const STEP_NS = 100_000_000n;
const owner = Object.freeze({
  pid: 5577,
  startedUtcTicks: '638980000000000000',
  sessionId: 2,
  jobId: 'job_0001',
});
const target = Object.freeze({
  pid: 333,
  hwnd: 555,
  process: 'DesktopProbe',
  title: 'Workbridge GUI-004 Native Input Probe',
  className: 'WinFormsMain',
  processStartedAt: '2026-11-06T00:00:00.000Z',
  sessionId: 2,
});
const sources = {
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
};
function fixture(id = 'request_0001') {
  const intent = {
    schemaVersion: 1,
    requestId: id,
    requestHash: HASH_A,
    providerId: 'microsoft_winapp_cli',
    providerHash: HASH_B,
    target: { ...target },
    leaseId: 'lease_0001',
    generation: 19,
    clockDomain: 'hostmonotonic',
    deadlineNs: String(BASE_NS + 20_000_000_000n),
  };
  const events = [];
  let tick = BASE_NS;
  function add(kind, extra = {}) {
    tick += STEP_NS;
    const e = {
      seq: events.length + 1,
      kind,
      source: sources[kind],
      requestId: intent.requestId,
      requestHash: intent.requestHash,
      providerHash: intent.providerHash,
      leaseId: intent.leaseId,
      generation: intent.generation,
      target: { ...intent.target },
      clockDomain: intent.clockDomain,
      tNs: String(tick),
      ...extra,
    };
    events.push(e);
    return e;
  }
  function advance(deltaNs) { tick += BigInt(deltaNs); }
  function start() {
    add('request_received');
    add('gui_turn_acquired');
    add('before_durable');
    add('intent_durable');
    add('worker_registered', { owner: { ...owner } });
    add('worker_ready', { owner: { ...owner } });
    add('lease_held', { owner: { ...owner } });
    add('dispatch_entered', { providerCallId: 'provider_call_0001' });
  }
  function live() {
    add('lease_held', { owner: { ...owner } });
    add('worker_alive', { owner: { ...owner } });
  }
  function verified(kind = 'oracle_verified_once') {
    add('oracle_observed');
    const extra = { proofHash: HASH_C };
    if (kind === 'oracle_terminal_no_effect') extra.terminalNoQueued = true;
    add(kind, extra);
  }
  function settle() {
    add('job_settled', { owner: { ...owner }, activeCount: 0 });
    add('lease_released');
    add('lease_release_verified');
    add('receipt_durable', { receiptHash: HASH_D });
  }
  const now = (delay = STEP_NS) => String(tick + delay);
  const run = (delay = STEP_NS) => reduceDesktopOutcome(intent, events, now(delay));
  return { intent, events, add, advance, start, live, verified, settle, now, run };
}
function outcome(f, state, proof, cleanup = undefined) {
  const r = f.run();
  assert.equal(r.state, state);
  assert.equal(r.semanticProof, proof);
  assert.equal(r.retryAllowed, false);
  assert.equal(r.authorizesInput, false);
  assert.equal(r.phasesAdditive, false);
  assert.deepEqual(Object.keys(r.phaseSpans), PHASE_NAMES);
  assert.ok(OUTCOME_STATES.includes(r.state));
  if (cleanup) assert.equal(r.cleanup, cleanup);
  return r;
}

test('O01 pre-dispatch admission denial is blocked and never executable', () => {
  const f = fixture();
  f.add('request_received');
  f.add('admission_denied');
  const r = outcome(f, 'blocked', 'incomplete', 'not_started');
  assert.equal(r.phaseSpans.L3, null);
});

test('O02 one independent effect, settlement and receipt verify success', () => {
  const f = fixture();
  f.start();
  f.add('provider_ack', { providerCallId: 'provider_call_0001' });
  f.verified();
  f.settle();
  const r = outcome(f, 'verified_success', 'applied_once', 'owned_tree_settled_and_lease_released');
  assert.equal(r.phaseSpans.L3.durationNs, String(STEP_NS));
  assert.ok(r.phaseSpans.L8);
  assert.ok(Object.isFrozen(r));
  assert.ok(Object.isFrozen(r.phaseSpans));
});

test('O03 provider ACK is not an app result; live ownership permits only pending', () => {
  const f = fixture();
  f.start();
  f.add('provider_ack', { providerCallId: 'provider_call_0001' });
  f.live();
  assert.equal(outcome(f, 'pending', 'incomplete').reasonCode, 'WORKER_PENDING');
  assert.equal(reduceDesktopOutcome(f.intent, f.events, String(BASE_NS + 30_000_000_000n)).state,
    'unknown_outcome');
});

test('O04 effect then hang preserves semantic proof but quarantines cleanup', () => {
  const f = fixture();
  f.start();
  f.verified();
  f.add('worker_lost', { owner: { ...owner } });
  const r = outcome(f, 'unknown_outcome', 'applied_once', 'quarantined');
  assert.equal(r.reasonCode, 'WORKER_LOST_UNCERTAIN');
});

test('O05 source-backed never-started blocks; mere missing dispatch is unknown', () => {
  const f = fixture();
  f.add('request_received');
  f.add('gui_turn_acquired');
  f.add('before_durable');
  f.add('intent_durable');
  assert.equal(outcome(f, 'unknown_outcome', 'incomplete').state, 'unknown_outcome');
  f.add('worker_never_started');
  outcome(f, 'blocked', 'incomplete', 'not_started');
});

test('O06 350ms delayed owned modal with active worker remains pending', () => {
  const f = fixture();
  f.start();
  const ack = f.add('provider_ack', { providerCallId: 'provider_call_0001' });
  f.advance(250_000_000n);
  const modal = f.add('modal_opened', { modalHwnd: 700, ownerHwnd: target.hwnd });
  assert.equal(BigInt(modal.tNs) - BigInt(ack.tNs), 350_000_000n);
  f.live();
  const r = outcome(f, 'pending', 'incomplete');
  assert.equal(r.operationTracking, 'modal_known');
  assert.equal(r.phaseSpans.L4, null);
});

test('O07 provider timeout is uncertain even if the modal later closes', () => {
  const f = fixture();
  f.start();
  f.add('provider_timeout', { providerCallId: 'provider_call_0001' });
  f.add('modal_opened', { modalHwnd: 700, ownerHwnd: target.hwnd });
  f.add('modal_closed', { modalHwnd: 700, ownerHwnd: target.hwnd });
  const r = outcome(f, 'unknown_outcome', 'incomplete');
  assert.equal(r.reasonCode, 'PROVIDER_TIMEOUT_UNCERTAIN');
  assert.equal(r.phaseSpans.L3.durationNs, String(STEP_NS));
  assert.ok(r.phaseSpans.L4.durationNs);
});

test('O08 provider completion while a native owned modal persists cannot verify', () => {
  const f = fixture();
  f.start();
  f.add('provider_ack', { providerCallId: 'provider_call_0001' });
  f.add('modal_opened', { modalHwnd: 700, ownerHwnd: target.hwnd });
  f.add('provider_status_pending', { providerCallId: 'provider_call_0001' });
  f.live();
  outcome(f, 'pending', 'incomplete');
});

test('O09 identity mismatch before entry blocks, after entry is unknown', () => {
  const pre = fixture('request_0009');
  pre.add('request_received');
  const changed = { ...target, hwnd: 999 };
  pre.add('target_changed', { target: changed });
  outcome(pre, 'blocked', 'incomplete');
  const post = fixture('request_0099');
  post.start();
  post.add('target_changed', { target: changed });
  const r = outcome(post, 'unknown_outcome', 'incomplete');
  assert.equal(r.cleanup, 'quarantined');
});

test('O10 duplicate independent postconditions are contradictory, not success', () => {
  const f = fixture();
  f.start();
  f.add('oracle_observed');
  f.add('oracle_verified_once', { proofHash: HASH_C });
  f.add('oracle_verified_once', { proofHash: HASH_D });
  f.settle();
  outcome(f, 'unknown_outcome', 'contradictory');
});

test('O11 an authoritative terminal no-effect with no queue and settlement fails', () => {
  const f = fixture();
  f.start();
  f.add('provider_ack', { providerCallId: 'provider_call_0001' });
  f.verified('oracle_terminal_no_effect');
  f.settle();
  outcome(f, 'verified_failure', 'terminal_no_effect', 'owned_tree_settled_and_lease_released');
});

test('O12 unchanged screenshot or 1.2s missing marker never proves failure', () => {
  const f = fixture();
  f.start();
  f.add('provider_ack', { providerCallId: 'provider_call_0001' });
  f.add('oracle_observed');
  outcome(f, 'unknown_outcome', 'incomplete');
});

test('O13 incomplete provider tree cannot prove absence of a control', () => {
  const f = fixture();
  f.start();
  f.add('snapshot_incomplete');
  f.live();
  const r = outcome(f, 'pending', 'incomplete');
  assert.equal(r.semanticProof, 'incomplete');
});

test('O14 six competing agents yield one modelled owner and five safe refusals', () => {
  const active = fixture('request_owner_001');
  active.start();
  active.live();
  assert.equal(active.run().state, 'pending');
  for (let i = 0; i < 5; i++) {
    const f = fixture('request_busy_00' + i);
    f.add('request_received');
    f.add('admission_denied');
    const r = outcome(f, 'blocked', 'incomplete');
    assert.equal(r.retryAllowed, false);
  }
  // This is a reducer mapping test, NOT proof that any deployed gate is atomic.
});

test('O15 lost worker and unproven descendants retain unknown even after ACK', () => {
  const f = fixture();
  f.start();
  f.add('provider_ack', { providerCallId: 'provider_call_0001' });
  f.add('worker_lost', { owner: { ...owner } });
  const r = outcome(f, 'unknown_outcome', 'incomplete', 'quarantined');
  assert.equal(r.reasonCode, 'WORKER_LOST_UNCERTAIN');
});

test('O16 replaying one immutable request is pure and cannot retry UNKNOWN', () => {
  const f = fixture();
  f.start();
  f.add('provider_timeout', { providerCallId: 'provider_call_0001' });
  const inputBefore = JSON.stringify(f.events);
  const a = f.run();
  const b = f.run();
  assert.deepEqual(a, b);
  assert.equal(a.state, 'unknown_outcome');
  assert.equal(a.retryAllowed, false);
  assert.equal(JSON.stringify(f.events), inputBefore);
});

test('O17 wrong clock origin and regressed monotonic events cannot form spans', () => {
  const guest = fixture();
  guest.start();
  guest.add('provider_ack', { providerCallId: 'provider_call_0001', clockDomain: 'guestclock' });
  const a = outcome(guest, 'unknown_outcome', 'incomplete');
  assert.equal(a.reasonCode, 'CLOCK_AMBIGUOUS');
  assert.equal(a.phaseSpans.L3, null);
  const backward = fixture();
  backward.start();
  backward.events.at(-1).tNs = String(BASE_NS);
  const b = outcome(backward, 'unknown_outcome', 'incomplete');
  assert.equal(b.reasonCode, 'CLOCK_AMBIGUOUS');
});

test('O18 invalid provider provenance and raw unexpected private fields refuse', () => {
  const f = fixture();
  delete f.intent.providerHash;
  assert.throws(() => f.run(), (error) =>
    error instanceof OutcomeModelError && error.code === 'INVALID_INTENT');
  const coerced = fixture();
  coerced.intent.providerId = 12345678;
  assert.throws(() => coerced.run(), (error) =>
    error instanceof OutcomeModelError && error.code === 'INVALID_INTENT');
  const g = fixture();
  g.add('request_received', { rawWindowText: 'PRIVATE_SENTINEL' });
  assert.throws(() => g.run(), (error) =>
    error instanceof OutcomeModelError && error.code === 'INVALID_EVENT');
});

test('O19 post-dispatch changed HWND cannot be verified despite independent-effect receipt', () => {
  const f = fixture('request_case_0019');
  f.start();
  f.add('target_changed', { target: { ...target, hwnd: 999 } });
  f.verified();
  f.settle();
  const r = outcome(f, 'unknown_outcome', 'incomplete', 'quarantined');
  assert.equal(r.reasonCode, 'EVIDENCE_OR_IDENTITY_CONTRADICTION');
  assert.equal(r.phaseSpans.L8, null);
});

test('O20 closing an unrelated HWND cannot complete the modal or verify an effect', () => {
  const f = fixture('request_case_0020');
  f.start();
  f.add('modal_opened', { modalHwnd: 700, ownerHwnd: target.hwnd });
  f.add('modal_closed', { modalHwnd: 701, ownerHwnd: target.hwnd });
  f.verified();
  f.settle();
  const r = outcome(f, 'unknown_outcome', 'incomplete', 'quarantined');
  assert.equal(r.reasonCode, 'EVIDENCE_OR_IDENTITY_CONTRADICTION');
});

test('O21 admission denial plus stray provider ACK is contradictory and unknown', () => {
  const f = fixture('request_case_0021');
  f.add('request_received');
  f.add('admission_denied');
  f.add('provider_ack', { providerCallId: 'provider_call_0001' });
  const r = outcome(f, 'unknown_outcome', 'incomplete');
  assert.notEqual(r.state, 'blocked');
  assert.equal(r.reasonCode, 'EVIDENCE_OR_IDENTITY_CONTRADICTION');
});

test('O22 missing or mismatched native held lease cannot verify a terminal outcome', () => {
  const missing = fixture('request_case_0022');
  missing.start();
  const heldIndex = missing.events.findIndex((e) => e.kind === 'lease_held');
  missing.events.splice(heldIndex, 1);
  missing.events.forEach((e, i) => { e.seq = i + 1; });
  missing.verified();
  missing.settle();
  const noHeld = outcome(missing, 'unknown_outcome', 'incomplete', 'quarantined');
  assert.equal(noHeld.reasonCode, 'EVIDENCE_OR_IDENTITY_CONTRADICTION');
  const mismatched = fixture('request_case_0023');
  mismatched.start();
  const held = mismatched.events.find((e) => e.kind === 'lease_held');
  held.owner.pid++;
  mismatched.verified();
  mismatched.settle();
  const wrongOwner = outcome(mismatched, 'unknown_outcome', 'incomplete', 'quarantined');
  assert.equal(wrongOwner.reasonCode, 'EVIDENCE_OR_IDENTITY_CONTRADICTION');
});
