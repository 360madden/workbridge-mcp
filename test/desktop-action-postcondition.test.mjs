import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { registerHooks } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { deflateSync } from 'node:zlib';

// Exercise current source without building/writing shared dist or loading any
// Windows, command, GUI, service, VM or MCP adapters.
const names = new Set([
  'desktop-action-postcondition',
  'desktop-action-capture-proof',
  'desktop-image',
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
let verify,
  EvidenceSchema,
  PostconditionError,
  POLICY,
  plan,
  verifyCapture,
  captureId,
  CaptureError,
  loadImage;
try {
  ({
    verifyDesktopProbeActionPostcondition: verify,
    desktopActionPostconditionEvidenceSchema: EvidenceSchema,
    DesktopActionPostconditionError: PostconditionError,
  } = await import('../src/desktop-action-postcondition.ts'));
  ({ DESKTOP_PROBE_ACTION_POLICY: POLICY, planDesktopProbeAction: plan } =
    await import('../src/desktop-action-policy.ts'));
  ({
    verifyDesktopProbeActionCaptureProof: verifyCapture,
    desktopActionCaptureId: captureId,
    DesktopActionCaptureProofError: CaptureError,
  } = await import('../src/desktop-action-capture-proof.ts'));
  ({ loadDesktopImage: loadImage } = await import('../src/desktop-image.ts'));
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

test('M2 refuses a changed window rectangle despite individually valid before/after snapshots', () => {
  for (const field of ['x', 'y', 'width', 'height']) {
    const f = fixture();
    f.evidence.afterDesktop.window.bounds[field] += 1;
    denied(f, 'WINDOW_GEOMETRY_CHANGED');
  }
});

test('M2 refuses monitor topology changes but ignores observer enumeration order', () => {
  for (const field of ['x', 'y', 'width', 'height']) {
    const f = fixture();
    f.evidence.afterDesktop.monitors[0][field] += 1;
    denied(f, 'DISPLAY_TOPOLOGY_CHANGED');
  }
  const reordered = fixture();
  const second = { x: 1920, y: 0, width: 1920, height: 1080 };
  reordered.evidence.beforeDesktop.monitors.push(second);
  reordered.evidence.afterDesktop.monitors.unshift({ ...second });
  assert.equal(run(reordered).postconditionVerified, true);
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

function captureFixture(f) {
  const sha256 = 'a'.repeat(64);
  const capture = {
    schemaVersion: 1,
    ok: true,
    replayed: false,
    requestId: captureId(f.request.requestId),
    pid: f.request.target.pid,
    hwnd: f.request.target.hwnd,
    process: f.request.target.process,
    title: f.request.target.title,
    expectedClass: f.request.target.className,
    capturedUtc: new Date(NOW + 160).toISOString(),
    imagePath: 'test-owned-path-validated-by-image-loader',
    width: 702,
    height: 442,
    sizeBytes: 2000,
    sha256,
    inputInjected: false,
    foregroundMayChange: true,
  };
  const imageLoader = async (record) => ({
    mimeType: 'image/png',
    requestId: record.requestId,
    sha256: record.sha256,
    width: record.width,
    height: record.height,
    sizeBytes: record.sizeBytes,
    data: 'private-image-bytes-not-for-result',
  });
  return { capture, imageLoader };
}
async function assessCapture(f, c, loader = c.imageLoader) {
  return verifyCapture(f.request, f.fence, f.evidence, f.timing, c.capture, loader);
}
async function captureDenied(f, c, code, loader = c.imageLoader) {
  await assert.rejects(
    () => assessCapture(f, c, loader),
    (error) => {
      assert.ok(error instanceof CaptureError);
      assert.equal(error.code, code);
      assert.equal(error.retryAllowed, false);
      assert.ok(!error.message.includes('private-image'));
      return true;
    },
  );
}

test('M2 capture bundle binds one non-replayed PNG to verified native action effect', async () => {
  const f = fixture();
  const c = captureFixture(f);
  const result = await assessCapture(f, c);
  assert.equal(result.status, 'VERIFIED');
  assert.equal(result.nativeActionEffectVerified, true);
  assert.equal(result.pngArtifactVerified, true);
  assert.equal(result.screenshotContentSemanticsVerified, false);
  assert.equal(result.authorizesAction, false);
  assert.equal(result.retryAllowed, false);
  assert.equal(result.requestId, f.request.requestId);
  assert.equal(result.captureRequestId, c.capture.requestId);
  assert.equal(result.imageSha256, c.capture.sha256);
  assert.deepEqual(result.imageDimensions, { width: 702, height: 442 });
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.imageDimensions));
  assert.ok(!Object.hasOwn(result, 'data'));
  assert.notEqual(captureId('another_action_001'), c.capture.requestId);
  assert.equal(captureId(f.request.requestId), captureId(f.request.requestId));
});

test('M2 refuses stale, replayed, retargeted and different-size screenshot receipts before file I/O', async () => {
  const cases = [
    ['pid', 9912, 'CAPTURE_TARGET_MISMATCH'],
    ['hwnd', 123456, 'CAPTURE_TARGET_MISMATCH'],
    ['process', 'other', 'CAPTURE_TARGET_MISMATCH'],
    ['title', 'other', 'CAPTURE_TARGET_MISMATCH'],
    ['expectedClass', 'OtherClass', 'CAPTURE_TARGET_MISMATCH'],
    ['requestId', 'unrelated_capture_001', 'CAPTURE_TARGET_MISMATCH'],
    ['replayed', true, 'INVALID_CAPTURE_EVIDENCE'],
    ['inputInjected', true, 'INVALID_CAPTURE_EVIDENCE'],
    ['foregroundMayChange', false, 'INVALID_CAPTURE_EVIDENCE'],
    ['capturedUtc', new Date(NOW + 129).toISOString(), 'CAPTURE_NOT_FRESH'],
    ['capturedUtc', new Date(NOW + 201).toISOString(), 'CAPTURE_NOT_FRESH'],
    ['width', 500, 'CAPTURE_GEOMETRY_MISMATCH'],
    ['height', 300, 'CAPTURE_GEOMETRY_MISMATCH'],
    ['sha256', 'not-a-sha256', 'INVALID_CAPTURE_EVIDENCE'],
  ];
  for (const [field, value, code] of cases) {
    const f = fixture(),
      c = captureFixture(f);
    c.capture[field] = value;
    let loads = 0;
    await captureDenied(f, c, code, async () => {
      loads++;
      throw new Error('never called');
    });
    assert.equal(loads, 0, field + ' must fail before image load');
  }
});

test('M2 refuses missing or mismatched PNG bytes and never leaks loaded image content', async () => {
  const f = fixture(),
    c = captureFixture(f);
  await captureDenied(f, c, 'CAPTURE_IMAGE_UNVERIFIED', async () => {
    throw new Error('private-image-file-path');
  });
  await captureDenied(f, c, 'CAPTURE_IMAGE_MISMATCH', async (receipt) => ({
    ...(await c.imageLoader(receipt)),
    sha256: 'b'.repeat(64),
  }));
  await captureDenied(f, c, 'CAPTURE_IMAGE_MISMATCH', async (receipt) => ({
    ...(await c.imageLoader(receipt)),
    width: 701,
  }));
});

test('M2 refuses native uncertainty before reading even a valid screenshot', async () => {
  const f = fixture(),
    c = captureFixture(f);
  f.evidence.receipt.uncertain = true;
  let loads = 0;
  await captureDenied(f, c, 'NATIVE_POSTCONDITION_UNVERIFIED', async () => {
    loads++;
    return {};
  });
  assert.equal(loads, 0);
});

function crc32(bytes) {
  let sum = 0xffffffff;
  for (const value of bytes) {
    sum ^= value;
    for (let bit = 0; bit < 8; bit++) sum = (sum >>> 1) ^ (sum & 1 ? 0xedb88320 : 0);
  }
  return (sum ^ 0xffffffff) >>> 0;
}
function pngChunk(kind, content) {
  const type = Buffer.from(kind, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(content.length);
  const body = Buffer.concat([type, content]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
function nativeSizedPng(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // grayscale, 8 bits per channel
  const scanline = Buffer.concat([Buffer.alloc(1), Buffer.alloc(width, 180)]);
  const pixels = Buffer.concat(Array.from({ length: height }, () => scanline));
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(pixels)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

test('M2 default PNG validator reads real local bytes and refuses a tampered native-sized capture', async (t) => {
  const f = fixture();
  const c = captureFixture(f);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wb-m2-capture-'));
  t.after(async () => {
    assert.ok(directory.startsWith(path.resolve(os.tmpdir()) + path.sep));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const evidenceRoot = path.join(directory, '.tools', 'desktop-evidence');
  await fs.mkdir(evidenceRoot, { recursive: true });
  const bytes = nativeSizedPng(720, 460);
  const imagePath = path.join(evidenceRoot, 'capture-' + c.capture.requestId + '.png');
  await fs.writeFile(imagePath, bytes, { flag: 'wx' });
  Object.assign(c.capture, {
    imagePath,
    width: 720,
    height: 460,
    sizeBytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
  const readValidated = (receipt) => loadImage(receipt, { evidenceRoot });
  const proof = await assessCapture(f, c, readValidated);
  assert.equal(proof.status, 'VERIFIED');
  assert.equal(proof.imageSha256, c.capture.sha256);
  assert.deepEqual(proof.imageDimensions, { width: 720, height: 460 });
  assert.equal(proof.screenshotContentSemanticsVerified, false);
  const modified = Buffer.from(bytes);
  modified[40] ^= 0x1;
  await fs.writeFile(imagePath, modified);
  await captureDenied(f, c, 'CAPTURE_IMAGE_UNVERIFIED', readValidated);
});
