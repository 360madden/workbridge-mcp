// Pure, synthetic-only companion to Program.cs. NEVER calls Win32, UIA, GUI or filesystem.
// It verifies state-machine acceptance boundaries; it does NOT prove the C# observer ran.
export const ModalOutcome = Object.freeze({
  VERIFIED_NATIVE_CYCLE: 'verified_native_cycle',
  UNKNOWN: 'unknown',
  INVALID_TRACE: 'invalid_trace',
});

const DEADLINE_MS = 50_000;
const MAX_SAMPLES = 1200;
const MAX_OWNED_PER_SAMPLE = 32;

const result = (outcome, reason, transitions) => Object.freeze({
  outcome, reason, transitions: Object.freeze(transitions.map((item) => Object.freeze({ ...item }))),
});

const invalid = (reason, transitions) => result(ModalOutcome.INVALID_TRACE, reason, transitions);
const unknown = (reason, transitions) => result(ModalOutcome.UNKNOWN, reason, transitions);

// One exact owner process instance and native-owned-HWND lineage, no UIA labels or titles.
// Each synthetic sample includes the caller's independent IsWindow(modal) probe, when known.
export function reduceOwnedModalTimeline(trace) {
  if (!trace || typeof trace !== 'object' || !trace.target ||
      !Array.isArray(trace.samples) || trace.samples.length < 1 ||
      trace.samples.length > MAX_SAMPLES) return invalid('TRACE_SHAPE_OR_BOUNDS', []);

  const target = trace.target;
  if (!Number.isInteger(target.pid) || target.pid < 1 ||
      !Number.isInteger(target.sessionId) || target.sessionId < 1 ||
      typeof target.startUtcTicks !== 'string' || !/^[0-9]+$/.test(target.startUtcTicks) ||
      typeof target.ownerHwnd !== 'string' || !/^[1-9][0-9]*$/.test(target.ownerHwnd))
    return invalid('TARGET_SHAPE', []);

  const transitions = [];
  const seenAtBaseline = new Set();
  let baselineClean = false;
  let ownerDisabled = false;
  let modalHwnd = null;
  let modalDestroyed = false;
  let ownerReenabled = false;
  let previousTick = -1;

  for (const snapshot of trace.samples) {
    if (!snapshot || !Number.isInteger(snapshot.tickMs) || snapshot.tickMs <= previousTick ||
        snapshot.tickMs < 0 || !snapshot.owner || !Array.isArray(snapshot.owned) ||
        snapshot.owned.length > MAX_OWNED_PER_SAMPLE)
      return invalid('SNAPSHOT_SHAPE_OR_TIME_ORDER', transitions);
    previousTick = snapshot.tickMs;
    if (snapshot.tickMs > DEADLINE_MS) return unknown('INCOMPLETE_OR_LATE_DEADLINE', transitions);

    const owner = snapshot.owner;
    if (owner.alive !== true ||
        owner.pid !== target.pid ||
        owner.startUtcTicks !== target.startUtcTicks ||
        owner.sessionId !== target.sessionId ||
        owner.hwnd !== target.ownerHwnd ||
        owner.rootSelf !== true ||
        owner.iconic === true)
      return unknown('OWNER_IDENTITY_CHANGED_OR_EXITED', transitions);
    if (typeof owner.enabled !== 'boolean') return invalid('OWNER_ENABLED_MISSING', transitions);

    const handles = new Set();
    for (const w of snapshot.owned) {
      if (!w || typeof w.hwnd !== 'string' || !/^[1-9][0-9]*$/.test(w.hwnd) ||
          typeof w.visible !== 'boolean' || handles.has(w.hwnd))
        return invalid('OWNED_WINDOW_SHAPE_OR_DUPLICATE', transitions);
      handles.add(w.hwnd);
      // Only actual top-level same-process owner children are candidates.
      if (w.pid !== target.pid || w.ownerHwnd !== target.ownerHwnd ||
          w.rootSelf !== true)
        return unknown('OWNED_WINDOW_IDENTITY_MISMATCH', transitions);
    }

    const visible = snapshot.owned.filter((w) => w.visible);
    if (transitions.length === 0) {
      baselineClean = owner.enabled && visible.length === 0;
      for (const w of snapshot.owned) seenAtBaseline.add(w.hwnd);
      transitions.push({ stage: baselineClean ? 'baseline_clean' : 'baseline_missed',
        tickMs: snapshot.tickMs });
      if (!baselineClean) return unknown('LATE_ATTACH_OR_DISABLED_BASELINE', transitions);
    }
    if (!owner.enabled && !ownerDisabled) {
      ownerDisabled = true;
      transitions.push({ stage: 'owner_disabled', tickMs: snapshot.tickMs });
    }
    if (ownerDisabled && owner.enabled && !modalHwnd)
      return unknown('OWNER_REENABLED_WITHOUT_MODAL', transitions);

    const newVisible = visible.filter((w) => !seenAtBaseline.has(w.hwnd));
    let appearedThisSample = false;
    if (!modalHwnd && newVisible.length > 1)
      return unknown('AMBIGUOUS_NEW_OWNED_HWND', transitions);
    if (!modalHwnd && ownerDisabled && !owner.enabled &&
        visible.length === 1 && newVisible.length === 1) {
      modalHwnd = newVisible[0].hwnd;
      appearedThisSample = true;
      transitions.push({ stage: 'owned_modal_appeared',
        hwnd: modalHwnd, tickMs: snapshot.tickMs });
    }

    if (modalHwnd && !modalDestroyed) {
      const probe = snapshot.modalProbe;
      if (!probe || probe.hwnd !== modalHwnd || typeof probe.exists !== 'boolean')
        return unknown('MISSING_INDEPENDENT_MODAL_ISWINDOW_PROBE', transitions);
      if (appearedThisSample && !probe.exists)
        return unknown('CONTRADICTORY_VISIBLE_BUT_DESTROYED_SAME_SAMPLE', transitions);
      if (probe.exists) {
        if (probe.pid !== target.pid || probe.ownerHwnd !== target.ownerHwnd)
          return unknown('MODAL_HWND_REUSED_OR_OWNER_CHANGED', transitions);
      } else {
        modalDestroyed = true;
        transitions.push({ stage: 'owned_modal_destroyed',
          hwnd: modalHwnd, tickMs: snapshot.tickMs });
      }
    }
    if (ownerDisabled && modalDestroyed && owner.enabled && !ownerReenabled) {
      ownerReenabled = true;
      transitions.push({ stage: 'owner_reenabled', tickMs: snapshot.tickMs });
    }
    if (baselineClean && ownerDisabled && modalHwnd && modalDestroyed &&
        ownerReenabled && visible.length === 0) {
      transitions.push({ stage: 'complete', tickMs: snapshot.tickMs });
      return result(ModalOutcome.VERIFIED_NATIVE_CYCLE,
        'COMPLETE_NATIVE_OWNER_MODAL_CYCLE', transitions);
    }
  }

  return unknown(previousTick >= DEADLINE_MS
    ? 'INCOMPLETE_OR_LATE_DEADLINE'
    : 'INCOMPLETE_OBSERVATION_INTERVAL', transitions);
}
