import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import test from 'node:test';

// Exercise current source without building/writing shared dist or loading any
// Windows, command, GUI, service, VM or MCP adapters.
const names = new Set([
  'desktop-action-postcondition',
  'desktop-action-policy',
  'desktop-action-guard',
  'desktop-session-policy',
]);
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    const match = /^\.\/(desktop-[a-z-]+)\.js$/.exec(specifier);
    if (context.parentURL?.startsWith(new URL('../src/', import.meta.url).href) && names.has(match?.[1]))
      return { url: new URL(`../src/${match[1]}.ts`, import.meta.url).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
let verify, EvidenceSchema, PostconditionError, POLICY, plan;
try {
  ({
    verifyDesktopProbeActionPostcondition: verify,
    desktopActionPostconditionEvidenceSchema: EvidenceSchema,
    DesktopActionPostconditionError: PostconditionError,
  } = await import('../src/desktop-action-postcondition.ts'));
  ({ DESKTOP_PROBE_ACTION_POLICY: POLICY, planDesktopProbeAction: plan } =
    await import('../src/desktop-action-policy.ts'));
} finally {
  hook.deregister();
}

const NOW = Date.parse('2026-10-26T12:00:00.000Z');
const target = {
  pid: 9911,
  hwnd: 224466,
  process: 'DesktopProbe',
  title: 'Workbridge GUI-004 Native Input Probe',
  className: 'WinFormsTest',
  processStartedAt: '2026-10-26T11:59:00.000Z',
  sessionId: 2,
};
function fixture() {
  const request = {
    requestId: 'worker8_action_001',
    action: 'invoke',
    target: { ...target },
    expectedCount: 4,
  };
  const requestHash = createHash('sha256')
    .update(JSON.stringify({ schemaVersion: 1, policy: POLICY, request }))
    .digest('hex');
  const fence = {
    ownerId: 'owner_0001',
    contextId: 'context_0001',
    contextRevision: 7,
    leaseId: 'lease_0001',
    generation: 19,
  };
  const desktop = (offset) => ({
    observedAtMs: NOW + offset,
    observedAtMonotonicMs: 1000 + offset,
    session: {
      id: 2,
      ownerSessionId: 2,
      interactive: true,
      connectionState: 'active',
      locked: false,
      loggingOff: false,
      secureDesktop: false,
      windowStation: 'WinSta0',
      inputDesktop: 'Default',
    },
    window: {
      ...target,
      bounds: { x: 400, y: 300, width: 720, height: 460 },
      isForeground: true,
      isVisible: true,
      isMinimized: false,
    },
    foreground: { pid: target.pid, hwnd: target.hwnd, sessionId: 2 },
    monitors: [{ x: 0, y: 0, width: 1920, height: 1080 }],
  });
  const lease = (offset) => ({
    ...fence,
    requestHash,
    resource: 'desktop-input',
    hostSessionId: 2,
    held: true,
    exclusive: true,
    issuedAtMs: NOW - 500,
    expiresAtMs: NOW + 5000,
    observedAtMs: NOW + offset,
    observedAtMonotonicMs: 1000 + offset,
  });
  const binding = { requestId: request.requestId, requestHash, target: { ...target } };
  const beforeCounter = {
    schemaVersion: 1,
    pid: target.pid,
    hwnd: target.hwnd,
    sessionId: 2,
    processStartedAt: target.processStartedAt,
    stage: 'incremented',
    counter: 4,
    eventAtMs: NOW - 200,
    observedAtMs: NOW + 30,
  };
  const afterCounter = {
    ...beforeCounter,
    stage: 'incremented',
    counter: 5,
    eventAtMs: NOW + 110,
    observedAtMs: NOW + 120,
  };
  const evidence = {
    schemaVersion: 1,
    intent: {
      ...binding,
      durable: true,
      expectedCount: 4,
      fence: { ...fence },
      startedAtMs: NOW,
      startedAtMonotonicMs: 1000,
      dispatchedAtMs: NOW + 100,
      dispatchedAtMonotonicMs: 1100,
    },
    receipt: {
      ...structuredClone(binding),
      durable: true,
      outcome: 'completed',
      uncertain: false,
      timedOut: false,
      cancelled: false,
      replayed: false,
      action: 'invoke',
      method: 'uia',
      selector: 'IncrementButton',
      inputMethod: 'UIAutomation.InvokePattern',
      performedAction: 'invoke',
      actionCount: 1,
      reportedHwnd: target.hwnd,
      handleRelationship: 'top-level',
      osMouseKeyboardInjected: false,
      guestInputInjected: false,
      expectedCount: 4,
      afterCount: 5,
      fence: { ...fence },
      startedAtMs: NOW,
      startedAtMonotonicMs: 1000,
      completedAtMs: NOW + 130,
      completedAtMonotonicMs: 1130,
    },
    beforeCounter,
    afterCounter,
    counterEvents: [structuredClone(afterCounter)],
    counterIntervalComplete: true,
    beforeDesktop: desktop(10),
    afterDesktop: desktop(140),
    focusContinuous: true,
    leaseContinuous: true,
    beforeLease: lease(20),
    afterLease: lease(150),
  };
  return { request, fence, evidence, timing: { nowMs: NOW + 200, nowMonotonicMs: 1200 } };
}
function run(f) {
  return verify(f.request, f.fence, f.evidence, f.timing);
}
function denied(f, code) {
  assert.throws(
    () => run(f),
    (error) => {
      assert.ok(error instanceof PostconditionError);
      if (code) assert.equal(error.code, code);
      assert.ok(!error.message.includes('PRIVATE_CONTENT'));
      assert.equal(error.cause, undefined);
      return true;
    },
  );
}
function updateNative(f, change) {
  Object.assign(f.evidence.afterCounter, change);
  f.evidence.counterEvents = [structuredClone(f.evidence.afterCounter)];
}

test('pure success returns bounded immutable evidence with no execution or retry authority', () => {
  const f = fixture(),
    before = structuredClone(f);
  const result = run(f);
  assert.deepEqual(f, before);
  assert.equal(result.postconditionVerified, true);
  assert.equal(result.readOnly, true);
  assert.equal(result.executable, false);
  assert.equal(result.authorizesAction, false);
  assert.equal(result.retryAllowed, false);
  assert.equal(result.beforeCount, 4);
  assert.equal(result.afterCount, 5);
  assert.equal(result.requestHash, f.evidence.intent.requestHash);
  assert.equal(result.then, undefined);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.target));
  f.request.target.hwnd++;
  f.evidence.receipt.target.hwnd++;
  assert.equal(result.target.hwnd, target.hwnd);
  assert.ok(!Object.hasOwn(result, 'receipt'));
  assert.ok(!Object.hasOwn(result, 'lease'));
  assert.ok(!Object.hasOwn(result, 'allowed'));
});

test('canonical request hash is identical to the existing policy planner', async () => {
  const f = fixture();
  const d = structuredClone(f.evidence.beforeDesktop);
  d.observedAtMs = NOW + 30;
  d.observedAtMonotonicMs = 1030;
  const prepared = await plan(f.request, {
    now: () => NOW + 30,
    nowMonotonicMs: () => 1030,
    observeDesktop: async () => structuredClone(d),
    readNativeCounter: async () => structuredClone(f.evidence.beforeCounter),
    executeReadOnly: async () => ({
      readOnly: true,
      operation: 'inspect',
      backend: 'Microsoft.WinAppCli',
      version: '0.7.1',
      target: { ...target, width: 720, height: 460, isForeground: true },
      tree: {
        windows: [
          {
            hwnd: target.hwnd,
            elements: [
              {
                type: 'Window',
                ...d.window.bounds,
                isOffscreen: false,
                children: [
                  {
                    selector: 'IncrementButton',
                    type: 'Button',
                    isEnabled: true,
                    isOffscreen: false,
                    isInvokable: true,
                    x: 450,
                    y: 400,
                    width: 170,
                    height: 58,
                  },
                ],
              },
            ],
          },
        ],
      },
    }),
  });
  assert.equal(prepared.requestHash, run(f).requestHash);
});

test('missing, unknown, malformed evidence and legacy pilot receipts fail closed', () => {
  for (const value of [undefined, null, [], 'PRIVATE_CONTENT', {}, { ...fixture().evidence, extra: true }]) {
    const f = fixture();
    f.evidence = value;
    denied(f, 'INVALID_POSTCONDITION_EVIDENCE');
  }
  for (const key of Object.keys(fixture().evidence)) {
    const f = fixture();
    delete f.evidence[key];
    denied(f, 'INVALID_POSTCONDITION_EVIDENCE');
  }
  const f = fixture();
  f.evidence.receipt = {
    schemaVersion: 1,
    requestId: f.request.requestId,
    pid: target.pid,
    hwnd: target.hwnd,
    expectedCount: 4,
    afterCount: 5,
    completedUtc: new Date(NOW).toISOString(),
  };
  denied(f, 'INVALID_POSTCONDITION_EVIDENCE');
  for (const key of ['requestId', 'target', 'expectedCount']) {
    const bad = fixture();
    delete bad.request[key];
    denied(bad, 'INVALID_POSTCONDITION_REQUEST');
  }
  for (const value of [undefined, {}, { ...fixture().fence, generation: 0 }]) {
    const bad = fixture();
    bad.fence = value;
    denied(bad, 'INVALID_EXPECTED_FENCE');
  }
});

test('every full identity field is required on both intent and receipt', () => {
  const changes = {
    pid: target.pid + 1,
    hwnd: target.hwnd + 1,
    sessionId: 3,
    processStartedAt: '2026-10-26T11:59:01.000Z',
    className: 'OtherClass',
  };
  for (const record of ['intent', 'receipt']) {
    for (const [key, value] of Object.entries(changes)) {
      const f = fixture();
      f.evidence[record].target[key] = value;
      denied(f, 'REQUEST_BINDING_MISMATCH');
      delete f.evidence[record].target[key];
      denied(f, 'INVALID_POSTCONDITION_EVIDENCE');
    }
    for (const [key, value] of [
      ['process', 'vmware'],
      ['title', 'ChatGPT'],
    ]) {
      const f = fixture();
      f.evidence[record].target[key] = value;
      denied(f, 'INVALID_POSTCONDITION_EVIDENCE');
    }
  }
});

test('durable request identity, canonical hash and expected count must bind every record', () => {
  for (const record of ['intent', 'receipt']) {
    for (const [key, value] of [
      ['requestId', 'another_request'],
      ['requestHash', '0'.repeat(64)],
      ['expectedCount', 3],
    ]) {
      const f = fixture();
      f.evidence[record][key] = value;
      denied(f, 'REQUEST_BINDING_MISMATCH');
    }
    const f = fixture();
    f.evidence[record].durable = false;
    denied(f, 'INVALID_POSTCONDITION_EVIDENCE');
  }
  const f = fixture();
  f.request.target.processStartedAt = '2026-10-26T11:59:01.000Z';
  denied(f, 'REQUEST_BINDING_MISMATCH');
  const ordered = fixture();
  ordered.request = Object.fromEntries(Object.entries(ordered.request).reverse());
  assert.equal(run(ordered).requestHash, run(fixture()).requestHash);
});

test('uncertain, timeout, replay, cancelled, guest input and non-UIA receipts cannot verify', () => {
  for (const [key, value] of [
    ['outcome', 'uncertain'],
    ['uncertain', true],
    ['timedOut', true],
    ['cancelled', true],
    ['replayed', true],
    ['guestInputInjected', true],
    ['osMouseKeyboardInjected', true],
    ['actionCount', 2],
    ['performedAction', 'click'],
    ['action', 'enter'],
    ['method', 'keyboard'],
    ['method', 'mouse'],
    ['selector', 'OtherButton'],
    ['inputMethod', 'WinApp pointer click'],
    ['handleRelationship', 'verified-child'],
  ]) {
    const f = fixture();
    f.evidence.receipt[key] = value;
    denied(f, 'INVALID_POSTCONDITION_EVIDENCE');
  }
  for (const [key, value] of [
    ['reportedHwnd', 1],
    ['afterCount', 6],
    ['startedAtMs', NOW + 1],
    ['startedAtMonotonicMs', 1001],
  ]) {
    const f = fixture();
    f.evidence.receipt[key] = value;
    denied(f, 'ACTION_RECEIPT_MISMATCH');
  }
  for (const key of ['focusContinuous', 'leaseContinuous', 'counterIntervalComplete']) {
    const f = fixture();
    f.evidence[key] = false;
    denied(f, 'INVALID_POSTCONDITION_EVIDENCE');
  }
});

test('native before, after and event identities cannot drift or reuse a PID lifetime', () => {
  for (const section of ['beforeCounter', 'afterCounter', 'event']) {
    for (const [key, value] of [
      ['pid', 1],
      ['hwnd', 1],
      ['sessionId', 3],
      ['processStartedAt', '2026-10-26T11:59:01.000Z'],
    ]) {
      const f = fixture();
      const record = section === 'event' ? f.evidence.counterEvents[0] : f.evidence[section];
      record[key] = value;
      denied(f, 'COUNTER_IDENTITY_MISMATCH');
    }
  }
});

test('independent native evidence rejects no change, skips, reset, duplicate and ambiguous signals', () => {
  for (const change of [{ counter: 4 }, { counter: 6 }, { stage: 'shown' }, { stage: 'reset' }]) {
    const f = fixture();
    updateNative(f, change);
    denied(f, 'COUNTER_TRANSITION_MISMATCH');
  }
  for (const change of [{ counter: 3 }, { stage: 'reset' }, { stage: 'shown' }]) {
    const f = fixture();
    Object.assign(f.evidence.beforeCounter, change);
    denied(f, 'COUNTER_TRANSITION_MISMATCH');
  }
  for (const events of [[], [fixture().evidence.afterCounter, fixture().evidence.afterCounter]]) {
    const f = fixture();
    f.evidence.counterEvents = events;
    denied(f, 'INVALID_POSTCONDITION_EVIDENCE');
  }
  const different = fixture();
  different.evidence.counterEvents[0].counter = 6;
  denied(different, 'COUNTER_TRANSITION_MISMATCH');
  for (const offset of [99, 100]) {
    const f = fixture();
    updateNative(f, { eventAtMs: NOW + offset });
    denied(f, 'AMBIGUOUS_COUNTER_EVENT');
  }
});

test('event timestamps must be fresh, causal, within lifetime and actually observed', () => {
  for (const section of ['beforeCounter', 'afterCounter']) {
    for (const change of [
      { eventAtMs: NOW - 2001 },
      { eventAtMs: NOW + 1000 },
      { eventAtMs: Date.parse(target.processStartedAt) - 1 },
      { observedAtMs: NOW + 201 },
    ]) {
      const f = fixture();
      Object.assign(f.evidence[section], change);
      denied(f, 'STALE_COUNTER_EVIDENCE');
    }
  }
  for (const change of [{ observedAtMs: NOW + 140 }, { eventAtMs: NOW + 125, observedAtMs: NOW + 125 }]) {
    const f = fixture();
    updateNative(f, change);
    if (change.observedAtMs === NOW + 140) denied(f, 'EVENT_ORDER_MISMATCH');
    else assert.equal(run(f).postconditionVerified, true);
  }
});

test('expected GUI turn fence must match both journals and both exclusive lease observations', () => {
  for (const section of ['intent', 'receipt', 'beforeLease', 'afterLease']) {
    for (const [key, value] of [
      ['ownerId', 'another_owner'],
      ['contextId', 'another_context'],
      ['contextRevision', 8],
      ['leaseId', 'another_lease'],
      ['generation', 20],
    ]) {
      const f = fixture();
      const record = ['intent', 'receipt'].includes(section)
        ? f.evidence[section].fence
        : f.evidence[section];
      record[key] = value;
      denied(f, 'LEASE_FENCE_MISMATCH');
    }
  }
  for (const section of ['beforeLease', 'afterLease']) {
    for (const [key, value, code] of [
      ['requestHash', '0'.repeat(64), 'LEASE_FENCE_MISMATCH'],
      ['hostSessionId', 3, 'LEASE_FENCE_MISMATCH'],
      ['held', false, 'INVALID_POSTCONDITION_EVIDENCE'],
      ['exclusive', false, 'INVALID_POSTCONDITION_EVIDENCE'],
      ['resource', 'other', 'INVALID_POSTCONDITION_EVIDENCE'],
      ['issuedAtMs', NOW + 1, 'LEASE_EXPIRED'],
      ['expiresAtMs', NOW + 200, 'LEASE_EXPIRED'],
      ['expiresAtMs', NOW + 30001, 'LEASE_EXPIRED'],
    ]) {
      const f = fixture();
      f.evidence[section][key] = value;
      denied(f, code);
    }
  }
  const renewed = fixture();
  renewed.evidence.afterLease.expiresAtMs++;
  denied(renewed, 'LEASE_FENCE_MISMATCH');
});

test('before and after desktop must independently match full identity, session and focus', () => {
  for (const section of ['beforeDesktop', 'afterDesktop']) {
    for (const [key, value, code] of [
      ['pid', 1, 'PROCESS_IDENTITY_MISMATCH'],
      ['hwnd', 1, 'PROCESS_IDENTITY_MISMATCH'],
      ['processStartedAt', '2026-10-26T11:59:01.000Z', 'PROCESS_IDENTITY_MISMATCH'],
      ['className', 'OtherClass', 'PROCESS_IDENTITY_MISMATCH'],
      ['sessionId', 3, 'SESSION_MISMATCH'],
      ['isForeground', false, 'FOREGROUND_MISMATCH'],
      ['isMinimized', true, 'TARGET_NOT_VISIBLE'],
    ]) {
      const f = fixture();
      f.evidence[section].window[key] = value;
      denied(f, code);
    }
    for (const key of ['pid', 'hwnd', 'sessionId']) {
      const f = fixture();
      f.evidence[section].foreground[key] = 1;
      denied(f, 'FOREGROUND_MISMATCH');
    }
    for (const [key, value, code] of [
      ['locked', true, 'SESSION_LOCKED'],
      ['secureDesktop', true, 'SECURE_DESKTOP'],
      ['connectionState', 'disconnected', 'SESSION_NOT_ACTIVE'],
      ['loggingOff', true, 'SESSION_NOT_ACTIVE'],
      ['ownerSessionId', 3, 'SESSION_MISMATCH'],
      ['inputDesktop', 'Winlogon', 'NONDEFAULT_DESKTOP'],
    ]) {
      const f = fixture();
      f.evidence[section].session[key] = value;
      denied(f, code);
    }
  }
});

test('timestamp regressions, future evidence, stale verification and clock jumps fail', () => {
  for (const [section, key, value, code] of [
    ['beforeDesktop', 'observedAtMs', NOW - 1, 'EVENT_ORDER_MISMATCH'],
    ['afterDesktop', 'observedAtMs', NOW + 201, 'EVENT_ORDER_MISMATCH'],
    ['beforeLease', 'observedAtMs', NOW + 31, 'EVENT_ORDER_MISMATCH'],
    ['receipt', 'completedAtMs', NOW + 119, 'EVENT_ORDER_MISMATCH'],
    ['intent', 'dispatchedAtMonotonicMs', 999, 'CLOCK_REGRESSED'],
    ['afterDesktop', 'observedAtMonotonicMs', 1129, 'CLOCK_REGRESSED'],
    ['afterLease', 'observedAtMonotonicMs', 1201, 'CLOCK_REGRESSED'],
  ]) {
    const f = fixture();
    f.evidence[section][key] = value;
    denied(f, code);
  }
  for (const timing of [
    undefined,
    {},
    { nowMs: NaN, nowMonotonicMs: 1200 },
    { nowMs: NOW + 200, nowMonotonicMs: -1 },
    { nowMs: NOW + 200, nowMonotonicMs: Infinity },
  ]) {
    const f = fixture();
    f.timing = timing;
    denied(f, 'INVALID_CLOCK');
  }
  for (const key of ['nowMs', 'nowMonotonicMs']) {
    const f = fixture();
    f.timing[key] += 6000;
    denied(f);
  }
  const stale = fixture();
  stale.timing.nowMonotonicMs = 3131;
  denied(stale, 'POSTCONDITION_EXPIRED');
  const staleDesktop = fixture();
  staleDesktop.timing.nowMonotonicMs = 3011;
  denied(staleDesktop, 'STALE_OBSERVATION');
});

test('reverification never caches success and cannot clear uncertain action evidence', () => {
  const f = fixture();
  const original = structuredClone(f);
  assert.deepEqual(run(f), run(f));
  f.evidence.receipt.uncertain = true;
  denied(f, 'INVALID_POSTCONDITION_EVIDENCE');
  assert.equal(f.evidence.receipt.uncertain, true);
  f.evidence = structuredClone(original.evidence);
  f.evidence.afterLease.generation++;
  denied(f, 'LEASE_FENCE_MISMATCH');
  assert.equal(EvidenceSchema.safeParse(original.evidence).success, true);
});

test('counter maximum 99 to 100 verifies while unsupported targets/counts fail before evidence', () => {
  const f = fixture();
  f.request.expectedCount = 99;
  const requestHash = createHash('sha256')
    .update(JSON.stringify({ schemaVersion: 1, policy: POLICY, request: f.request }))
    .digest('hex');
  for (const record of [f.evidence.intent, f.evidence.receipt]) {
    record.expectedCount = 99;
    record.requestHash = requestHash;
  }
  for (const record of [f.evidence.beforeLease, f.evidence.afterLease]) record.requestHash = requestHash;
  f.evidence.beforeCounter.counter = 99;
  f.evidence.receipt.afterCount = 100;
  updateNative(f, { counter: 100 });
  assert.equal(run(f).afterCount, 100);
  for (const change of [
    { expectedCount: 100 },
    { action: 'keyboard' },
    { command: 'PRIVATE_CONTENT' },
    { target: { ...target, process: 'vmware' } },
    { target: { ...target, className: 'VMUIFrame' } },
  ]) {
    const bad = fixture();
    Object.assign(bad.request, change);
    denied(bad);
  }
});

test('initial shown count zero verifies but incremented count zero is contradictory', () => {
  const f = fixture();
  f.request.expectedCount = 0;
  const requestHash = createHash('sha256')
    .update(JSON.stringify({ schemaVersion: 1, policy: POLICY, request: f.request }))
    .digest('hex');
  for (const record of [f.evidence.intent, f.evidence.receipt]) {
    record.expectedCount = 0;
    record.requestHash = requestHash;
  }
  for (const record of [f.evidence.beforeLease, f.evidence.afterLease]) record.requestHash = requestHash;
  f.evidence.beforeCounter.counter = 0;
  f.evidence.beforeCounter.stage = 'shown';
  f.evidence.receipt.afterCount = 1;
  updateNative(f, { counter: 1 });
  assert.equal(run(f).afterCount, 1);
  f.evidence.beforeCounter.stage = 'incremented';
  denied(f, 'COUNTER_TRANSITION_MISMATCH');
});
