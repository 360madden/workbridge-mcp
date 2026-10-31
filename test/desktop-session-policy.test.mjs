import assert from 'node:assert/strict';
import test from 'node:test';
import { previewDesktopAction } from '../src/desktop-action-guard.ts';
import {
  evaluateDesktopSessionPolicy,
  assertDesktopSessionPolicy,
  createDesktopSessionObserver,
  DesktopSessionPolicyError,
} from '../src/desktop-session-policy.ts';

const target = {
  pid: 9911,
  hwnd: 224466,
  process: 'DesktopProbe',
  title: 'Disposable Test Window',
  className: 'WinFormsTest',
  processStartedAt: '2026-10-26T11:59:00.000Z',
  sessionId: 2,
};
const timing = { nowMonotonicMs: 1100, notBeforeMonotonicMs: 1000, previousMonotonicMs: 1050 };
function fixture() {
  return {
    observedAtMs: Date.parse('2026-10-26T12:00:00.000Z'),
    observedAtMonotonicMs: 1050,
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
  };
}
function denied(observation, reason, expected, clock) {
  if (arguments.length < 3) expected = target;
  if (arguments.length < 4) clock = timing;
  const result = evaluateDesktopSessionPolicy(expected, observation, clock);
  assert.equal(result.allowed, false);
  assert.equal(result.reason, reason);
  assert.ok(result.message.length > 10);
  assert.throws(
    () => assertDesktopSessionPolicy(expected, observation, clock),
    (error) => error instanceof DesktopSessionPolicyError && error.code === reason,
  );
}

test('a verified observation returns only bounded preview evidence and does not mutate inputs', () => {
  const o = fixture();
  const before = structuredClone(o);
  assert.deepEqual(evaluateDesktopSessionPolicy(target, o, timing), {
    allowed: true,
    previewOnly: true,
    requiresFreshExecutionValidation: true,
    sessionId: 2,
    observedAtMonotonicMs: 1050,
    ageMs: 50,
  });
  assert.deepEqual(o, before);
});

test('missing and malformed identities fail before considering desktop readiness', () => {
  for (const value of [
    undefined,
    null,
    [],
    'target',
    {},
    { ...target, pid: '9911' },
    { ...target, hwnd: 0 },
    { ...target, sessionId: 0 },
    { ...target, pid: 0x80000000 },
    { ...target, title: '' },
    { ...target, className: 'x'.repeat(101) },
    { ...target, process: 'app/other' },
    { ...target, processStartedAt: 'yesterday' },
    { ...target, processStartedAt: '2026-10-26' },
  ]) {
    denied(fixture(), 'INVALID_TARGET', value);
  }
});

test('missing observations and required sections never imply a safe desktop', () => {
  for (const value of [
    undefined,
    null,
    [],
    'data',
    {},
    { ...fixture(), session: null },
    { ...fixture(), window: null },
    { ...fixture(), foreground: undefined },
    { ...fixture(), observedAtMs: NaN },
  ])
    denied(value, 'INVALID_OBSERVATION');
});

test('locked, disconnected, logging off, noninteractive and session-zero cases are blocked', () => {
  const cases = [
    ['interactive', false, 'NONINTERACTIVE_SESSION'],
    ['interactive', undefined, 'NONINTERACTIVE_SESSION'],
    ['locked', true, 'SESSION_LOCKED'],
    ['locked', undefined, 'SESSION_LOCKED'],
    ['connectionState', 'disconnected', 'SESSION_NOT_ACTIVE'],
    ['connectionState', 'unknown', 'SESSION_NOT_ACTIVE'],
    ['loggingOff', true, 'SESSION_NOT_ACTIVE'],
    ['loggingOff', undefined, 'SESSION_NOT_ACTIVE'],
    ['id', 0, 'SESSION_MISMATCH'],
    ['id', 3, 'SESSION_MISMATCH'],
    ['ownerSessionId', 3, 'SESSION_MISMATCH'],
    ['ownerSessionId', undefined, 'SESSION_MISMATCH'],
  ];
  for (const [field, value, reason] of cases) {
    const o = fixture();
    o.session[field] = value;
    denied(o, reason);
  }
});

test('UAC, lock/logon desktops, noninteractive stations and unknown security state fail closed', () => {
  for (const change of [
    { secureDesktop: true },
    { secureDesktop: undefined },
    { inputDesktop: 'Winlogon' },
    { inputDesktop: 'Consent' },
    { inputDesktop: undefined },
    { windowStation: 'Service-0x0-3e7$' },
    { windowStation: undefined },
  ]) {
    const o = fixture();
    Object.assign(o.session, change);
    denied(o, Object.hasOwn(change, 'secureDesktop') ? 'SECURE_DESKTOP' : 'NONDEFAULT_DESKTOP');
  }
  for (const process of ['consent.exe', 'Winlogon', 'LogonUI', 'CredentialUIBroker', 'LockApp']) {
    denied(fixture(), 'SYSTEM_TARGET_FORBIDDEN', { ...target, process });
  }
});

test('exact PID, HWND, process, title, class, process lifetime and process session must agree', () => {
  const changes = {
    pid: 9912,
    hwnd: 224467,
    process: 'OtherApp',
    title: 'Another window',
    className: 'OtherClass',
    processStartedAt: '2026-10-26T11:59:01.000Z',
    sessionId: 3,
  };
  for (const [key, value] of Object.entries(changes)) {
    const o = fixture();
    o.window[key] = value;
    denied(o, key === 'sessionId' ? 'SESSION_MISMATCH' : 'PROCESS_IDENTITY_MISMATCH');
    delete o.window[key];
    denied(o, key === 'sessionId' ? 'SESSION_MISMATCH' : 'PROCESS_IDENTITY_MISMATCH');
  }
});

test('app requests cannot disguise VMware, ChatGPT, browser or system observations', () => {
  const cases = [
    [{ process: 'chrome.exe' }, 'CHATGPT_BROWSER_FORBIDDEN'],
    [{ process: 'msedge' }, 'CHATGPT_BROWSER_FORBIDDEN'],
    [{ title: 'ChatGPT - Private work' }, 'CHATGPT_BROWSER_FORBIDDEN'],
    [{ title: 'chat.openai.com' }, 'CHATGPT_BROWSER_FORBIDDEN'],
    [{ className: 'Chrome_WidgetWin_1' }, 'CHATGPT_BROWSER_FORBIDDEN'],
    [{ className: 'MozillaWindowClass' }, 'CHATGPT_BROWSER_FORBIDDEN'],
    [{ process: 'vmware-vmx.exe' }, 'VMWARE_SEPARATE_PATH_REQUIRED'],
    [{ title: 'Fixture - VMware Workstation' }, 'VMWARE_SEPARATE_PATH_REQUIRED'],
    [{ className: 'VMUIFrame' }, 'VMWARE_SEPARATE_PATH_REQUIRED'],
    [{ className: 'MKSEmbedded' }, 'VMWARE_SEPARATE_PATH_REQUIRED'],
    [{ process: 'consent' }, 'SYSTEM_TARGET_FORBIDDEN'],
  ];
  for (const [change, reason] of cases) {
    denied(fixture(), reason, { ...target, ...change });
    const o = fixture();
    Object.assign(o.window, change);
    denied(o, reason);
  }
});

test('independent foreground PID/HWND/session are required even when target claims foreground', () => {
  for (const change of [{ pid: 1 }, { hwnd: 1 }, { sessionId: 3 }, { pid: undefined }]) {
    const o = fixture();
    Object.assign(o.foreground, change);
    denied(o, 'FOREGROUND_MISMATCH');
  }
  const o = fixture();
  o.window.isForeground = false;
  denied(o, 'FOREGROUND_MISMATCH');
});

test('visibility, minimized geometry, offscreen and invalid monitor cases are blocked', () => {
  for (const change of [
    { isVisible: false },
    { isVisible: undefined },
    { isMinimized: true },
    { isMinimized: undefined },
    { bounds: { x: 0, y: 0, width: 160, height: 28 } },
  ]) {
    const o = fixture();
    Object.assign(o.window, change);
    denied(o, 'TARGET_NOT_VISIBLE');
  }
  for (const bounds of [
    null,
    {},
    { x: 0, y: 0, width: NaN, height: 500 },
    { x: 0, y: 0, width: 0, height: 500 },
    { x: 100001, y: 0, width: 500, height: 500 },
  ]) {
    const o = fixture();
    o.window.bounds = bounds;
    denied(o, 'INVALID_GEOMETRY');
  }
  for (const monitors of [undefined, [], Array(17).fill(fixture().monitors[0]), [{}]]) {
    const o = fixture();
    o.monitors = monitors;
    denied(o, 'INVALID_GEOMETRY');
  }
  const o = fixture();
  o.window.bounds.x = -32000;
  denied(o, 'TARGET_OFFSCREEN');
  o.window.bounds.x = 1920;
  denied(o, 'TARGET_OFFSCREEN');
  o.window.bounds.x = -1000;
  o.monitors[0].x = -1920;
  assert.equal(evaluateDesktopSessionPolicy(target, o, timing).allowed, true);
});

test('monotonic freshness rejects future, cached, expired and invalid observations', () => {
  for (const stamp of [undefined, null, '1050', NaN, Infinity, -1, 999, 1101]) {
    const o = fixture();
    o.observedAtMonotonicMs = stamp;
    denied(o, 'STALE_OBSERVATION');
  }
  const o = fixture();
  o.observedAtMonotonicMs = 1000;
  assert.equal(
    evaluateDesktopSessionPolicy(target, o, { nowMonotonicMs: 3000, notBeforeMonotonicMs: 1000 }).allowed,
    true,
  );
  denied(o, 'STALE_OBSERVATION', target, { nowMonotonicMs: 3000.001, notBeforeMonotonicMs: 1000 });
  o.observedAtMonotonicMs = 6001;
  denied(o, 'STALE_OBSERVATION', target, { nowMonotonicMs: 6001, notBeforeMonotonicMs: 1000 });
  o.observedAtMonotonicMs = 6000;
  assert.equal(
    evaluateDesktopSessionPolicy(target, o, { nowMonotonicMs: 6000, notBeforeMonotonicMs: 1000 }).allowed,
    true,
  );
});

test('invalid clocks, regressions and wall clock jumps cannot extend monotonic freshness', () => {
  for (const clock of [
    undefined,
    {},
    { ...timing, nowMonotonicMs: NaN },
    { ...timing, notBeforeMonotonicMs: -1 },
    { ...timing, previousMonotonicMs: Infinity },
  ]) {
    denied(fixture(), 'INVALID_CLOCK', target, clock);
  }
  denied(fixture(), 'CLOCK_REGRESSED', target, { ...timing, nowMonotonicMs: 999 });
  denied(fixture(), 'CLOCK_REGRESSED', target, { ...timing, previousMonotonicMs: 1101 });
  const o = fixture();
  o.observedAtMs = 1;
  assert.equal(evaluateDesktopSessionPolicy(target, o, timing).allowed, true);
  denied(o, 'STALE_OBSERVATION', target, { nowMonotonicMs: 4000, notBeforeMonotonicMs: 1000 });
});

test('observer helper fits preview observer shape, copies evidence and never caches a pass', async () => {
  const o = fixture();
  o.observedAtMonotonicMs = 1000;
  o.privateText = 'PRIVATE_CONTENT';
  o.session.privateText = 'PRIVATE_CONTENT';
  let calls = 0;
  const observe = createDesktopSessionObserver({
    nowMonotonicMs: () => 1000,
    observeDesktop: async (selected) => {
      calls++;
      assert.deepEqual(selected, target);
      return o;
    },
  });
  const result = await observe(target);
  assert.equal(result.session.id, target.sessionId);
  assert.equal(result.window.processStartedAt, target.processStartedAt);
  assert.ok(!JSON.stringify(result).includes('PRIVATE_CONTENT'));
  o.window.bounds.x = 800;
  assert.equal(result.window.bounds.x, 400);
  o.session.locked = true;
  await assert.rejects(observe(target), { code: 'SESSION_LOCKED' });
  assert.equal(calls, 2);
});

test('observer helper rejects bad targets before observing and sanitizes provider errors', async () => {
  let calls = 0;
  const observe = createDesktopSessionObserver({
    nowMonotonicMs: () => 1000,
    observeDesktop: async () => {
      calls++;
      throw new Error('PRIVATE_CONTENT');
    },
  });
  await assert.rejects(observe({ ...target, process: 'ChatGPT' }), { code: 'CHATGPT_BROWSER_FORBIDDEN' });
  await assert.rejects(observe({ ...target, pid: 0 }), { code: 'INVALID_TARGET' });
  assert.equal(calls, 0);
  await assert.rejects(
    observe(target),
    (error) =>
      error.code === 'OBSERVATION_FAILED' && !error.message.includes('PRIVATE_CONTENT') && !error.cause,
  );
  assert.equal(calls, 1);
  assert.throws(() => createDesktopSessionObserver({}), { code: 'OBSERVATION_FAILED' });
  assert.throws(() => createDesktopSessionObserver({ observeDesktop: async () => fixture() }), {
    code: 'INVALID_CLOCK',
  });
});

test('observer helper detects clock regression, long calls and missing monotonic stamps', async () => {
  for (const [ticks, stamp, code] of [
    [[1000, 999], 1000, 'CLOCK_REGRESSED'],
    [[1000, 6001], 6001, 'STALE_OBSERVATION'],
    [[1000, 1000], undefined, 'STALE_OBSERVATION'],
    [[NaN], 1000, 'INVALID_CLOCK'],
  ]) {
    const o = fixture();
    o.observedAtMonotonicMs = stamp;
    const observe = createDesktopSessionObserver({
      nowMonotonicMs: () => ticks.shift(),
      observeDesktop: async () => o,
    });
    await assert.rejects(observe(target), { code });
  }
  const ticks = [1000, 1000, 999];
  const o = fixture();
  o.observedAtMonotonicMs = 1000;
  const observe = createDesktopSessionObserver({
    nowMonotonicMs: () => ticks.shift(),
    observeDesktop: async () => o,
  });
  await observe(target);
  await assert.rejects(observe(target), { code: 'CLOCK_REGRESSED' });
  const badClock = createDesktopSessionObserver({
    nowMonotonicMs: () => {
      throw Error('PRIVATE_CONTENT');
    },
    observeDesktop: async () => o,
  });
  await assert.rejects(badClock(target), { code: 'INVALID_CLOCK' });
});

test('a caller cannot retarget a pending observation', async () => {
  const expected = { ...target };
  const o = fixture();
  o.observedAtMonotonicMs = 1000;
  const observe = createDesktopSessionObserver({
    nowMonotonicMs: () => 1000,
    observeDesktop: async (selected) => {
      expected.hwnd = 1;
      assert.equal(selected.hwnd, target.hwnd);
      return o;
    },
  });
  assert.equal((await observe(expected)).window.hwnd, target.hwnd);
});

test('observer wrapper bounds the whole preparation and rejects cached evidence on later reads', async () => {
  for (const [secondStart, secondStamp, reason] of [
    [1001, 1000, 'STALE_OBSERVATION'],
    [6001, 6001, 'STALE_OBSERVATION'],
  ]) {
    let time = 1000;
    let calls = 0;
    const o = fixture();
    o.observedAtMonotonicMs = 1000;
    const observe = createDesktopSessionObserver({
      nowMonotonicMs: () => time,
      observeDesktop: async () => {
        calls++;
        return o;
      },
    });
    await observe(target);
    time = secondStart;
    o.observedAtMonotonicMs = secondStamp;
    await assert.rejects(observe(target), { code: reason });
    assert.equal(calls, secondStart > 6000 ? 1 : 2);
  }
});

test('worker1 preview accepts the wrapped observer and fails before UIA on a locked session', async () => {
  const o = fixture();
  o.observedAtMonotonicMs = 1000;
  const observeDesktop = createDesktopSessionObserver({
    nowMonotonicMs: () => 1000,
    observeDesktop: async () => o,
  });
  let inspections = 0;
  const request = {
    requestId: 'worker7_fixture_001',
    action: 'invoke',
    target: { ...target },
    selector: 'IncrementButton',
    expectedControlType: 'Button',
  };
  const dependencies = {
    now: () => o.observedAtMs,
    observeDesktop,
    executeReadOnly: async () => {
      inspections++;
      return {
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
                  ...o.window.bounds,
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
      };
    },
  };
  const result = await previewDesktopAction(request, dependencies);
  assert.equal(result.executed, false);
  assert.equal(result.executable, false);
  assert.equal(inspections, 1);
  o.session.locked = true;
  await assert.rejects(previewDesktopAction(request, dependencies), { code: 'DESKTOP_OBSERVATION_FAILED' });
  assert.equal(inspections, 1);
});
