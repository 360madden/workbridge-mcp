// Synthetic-only pure unit tests; no GUI, Win32, UIA, fs, child process or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ModalOutcome, reduceOwnedModalTimeline } from './oracle-model.mjs';

const target = Object.freeze({
  pid: 8181, startUtcTicks: '638976543210000000',
  sessionId: 2, ownerHwnd: '4096',
});
const owner = (enabled, changes = {}) => ({
  alive: true, pid: target.pid, startUtcTicks: target.startUtcTicks,
  sessionId: target.sessionId, hwnd: target.ownerHwnd,
  rootSelf: true, iconic: false, enabled, ...changes,
});
const modal = (hwnd = '8192') => ({
  hwnd, pid: target.pid, ownerHwnd: target.ownerHwnd,
  rootSelf: true, visible: true,
});
const probe = (exists, changes = {}) => ({
  hwnd: '8192', exists,
  ...(exists ? { pid: target.pid, ownerHwnd: target.ownerHwnd } : {}),
  ...changes,
});
const snap = (tickMs, enabled, owned = [], modalProbe = undefined, ownerChanges = {}) => ({
  tickMs, owner: owner(enabled, ownerChanges), owned,
  ...(modalProbe === undefined ? {} : { modalProbe }),
});
const reduce = (samples, extra = {}) =>
  reduceOwnedModalTimeline({ target, samples, ...extra });

const baseline = () => snap(0, true);
const appeared = () => snap(5000, false, [modal()], probe(true));
const destroyed = () => snap(35_100, true, [], probe(false));

test('N01 late attach with already-disabled owner and visible modal cannot pass', () => {
  const out = reduce([
    snap(8000, false, [modal()], probe(true)),
    destroyed(),
  ]);
  assert.equal(out.outcome, ModalOutcome.UNKNOWN);
  assert.equal(out.reason, 'LATE_ATTACH_OR_DISABLED_BASELINE');
});

test('N02 two simultaneously new visible owned HWNDs fail closed as ambiguous', () => {
  const out = reduce([
    baseline(),
    snap(5000, false, [modal(), modal('12288')], probe(true)),
  ]);
  assert.equal(out.outcome, ModalOutcome.UNKNOWN);
  assert.equal(out.reason, 'AMBIGUOUS_NEW_OWNED_HWND');
  assert.equal(out.transitions.some((s) => s.stage === 'complete'), false);
});

test('N03 original modal HWND reused by foreign PID is never accepted as destroyed', () => {
  const out = reduce([
    baseline(), appeared(),
    snap(5600, false, [modal()], probe(true, { pid: 9000 })),
    destroyed(),
  ]);
  assert.equal(out.outcome, ModalOutcome.UNKNOWN);
  assert.equal(out.reason, 'MODAL_HWND_REUSED_OR_OWNER_CHANGED');
});

test('N04 original owner process exits mid-modal: no terminal proof', () => {
  const out = reduce([
    baseline(), appeared(),
    snap(6000, false, [modal()], probe(true), { alive: false }),
  ]);
  assert.equal(out.outcome, ModalOutcome.UNKNOWN);
  assert.equal(out.reason, 'OWNER_IDENTITY_CHANGED_OR_EXITED');
});

test('N05 missing native WinEvent callbacks do NOT negate a fully observed native poll cycle', () => {
  const trace = { target, samples: [baseline(), appeared(), destroyed()], winEvents: [] };
  const immutableBefore = JSON.stringify(trace);
  const out = reduceOwnedModalTimeline(trace);
  assert.equal(out.outcome, ModalOutcome.VERIFIED_NATIVE_CYCLE);
  assert.equal(out.reason, 'COMPLETE_NATIVE_OWNER_MODAL_CYCLE');
  assert.deepEqual(out.transitions.map((s) => s.stage),
    ['baseline_clean', 'owner_disabled', 'owned_modal_appeared',
      'owned_modal_destroyed', 'owner_reenabled', 'complete']);
  assert.equal(JSON.stringify(trace), immutableBefore, 'pure reducer must not mutate input');
});

test('N06 50s deadline without a new owned modal remains unknown, not no-modal proof', () => {
  const out = reduce([
    baseline(),
    snap(5000, false, []),
    snap(50_000, false, []),
  ]);
  assert.equal(out.outcome, ModalOutcome.UNKNOWN);
  assert.equal(out.reason, 'INCOMPLETE_OR_LATE_DEADLINE');
  assert.equal(out.transitions.some((s) => s.stage === 'complete'), false);
});

test('N07 one visible modal cannot be marked IsWindow=false in the same sample', () => {
  const out = reduce([
    baseline(), snap(5000, false, [modal()], probe(false)), destroyed(),
  ]);
  assert.equal(out.outcome, ModalOutcome.UNKNOWN);
  assert.equal(out.reason, 'CONTRADICTORY_VISIBLE_BUT_DESTROYED_SAME_SAMPLE');
});

test('P01 positive control with supplemental WinEvents still requires native destroy and owner recovery', () => {
  const out = reduce([baseline(), appeared(), destroyed()], {
    winEvents: [{ kind: '0010', tickMs: 5001 }, { kind: '0011', tickMs: 35_099 }],
  });
  assert.equal(out.outcome, ModalOutcome.VERIFIED_NATIVE_CYCLE);
  assert.equal(out.transitions.at(-1).stage, 'complete');
});
