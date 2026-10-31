import assert from 'node:assert/strict';
import test from 'node:test';
import { previewDesktopAction, DesktopActionGuardError } from '../src/desktop-action-guard.ts';
import { executeReadOnly } from '../scripts/desktop-ui.mjs';

const NOW = Date.parse('2026-10-26T12:00:00.000Z');
const target = {
  pid: 9911,
  hwnd: 224466,
  process: 'DesktopProbe',
  title: 'Disposable Test Window',
  className: 'WinFormsTest',
  processStartedAt: '2026-10-26T11:59:00.000Z',
  sessionId: 2,
};
const bounds = { x: 500, y: 300, width: 720, height: 460 };

function request() {
  return {
    requestId: 'worker1_preview_001',
    action: 'invoke',
    target: { ...target },
    selector: 'IncrementButton',
    expectedControlType: 'Button',
  };
}

function fixture() {
  let time = NOW;
  const calls = [];
  const observations = [];
  const state = {
    observedAtMs: NOW,
    session: {
      id: 2,
      interactive: true,
      locked: false,
      secureDesktop: false,
      windowStation: 'WinSta0',
      inputDesktop: 'Default',
    },
    window: { ...target, bounds: { ...bounds }, isForeground: true, isVisible: true, isMinimized: false },
    monitors: [{ x: 0, y: 0, width: 1920, height: 1080 }],
  };
  const listing = [
    {
      hwnd: target.hwnd,
      processId: target.pid,
      processName: target.process,
      title: target.title,
      className: target.className,
      width: bounds.width,
      height: bounds.height,
      isForeground: true,
    },
  ];
  const button = {
    selector: 'IncrementButton',
    type: 'Button',
    isEnabled: true,
    isOffscreen: false,
    isInvokable: true,
    x: 550,
    y: 500,
    width: 170,
    height: 58,
  };
  const root = { type: 'Window', ...bounds, isOffscreen: false, children: [button] };
  const tree = { windows: [{ hwnd: target.hwnd, elements: [root] }] };
  const f = {
    calls,
    observations,
    state,
    listing,
    button,
    root,
    tree,
    beforeObserve: undefined,
    beforeCommand: undefined,
    setTime(value) {
      time = value;
    },
    async runner(args) {
      calls.push([...args]);
      await f.beforeCommand?.(args);
      if (args[0] === '--version') return '0.7.1';
      if (args[1] === 'list-windows') return JSON.stringify(listing);
      if (args[1] === 'inspect') return JSON.stringify(tree);
      throw new Error('A preview attempted a non-read-only WinApp command');
    },
  };
  f.dependencies = {
    now: () => time,
    observeDesktop: async (selected) => {
      observations.push(selected);
      await f.beforeObserve?.(observations.length, selected);
      return structuredClone(state);
    },
    executeReadOnly: (selected) => executeReadOnly(selected, f.runner),
  };
  return f;
}

async function rejects(f, code, input = request()) {
  await assert.rejects(previewDesktopAction(input, f.dependencies), (error) => {
    assert.ok(error instanceof DesktopActionGuardError);
    assert.equal(error.code, code);
    return true;
  });
}

test('preview reuses the pinned read-only WinApp adapter and never invokes or focuses', async () => {
  const f = fixture();
  const result = await previewDesktopAction(request(), f.dependencies);
  assert.equal(result.ok, true);
  assert.equal(result.readOnly, true);
  assert.equal(result.previewOnly, true);
  assert.equal(result.executed, false);
  assert.equal(result.executable, false);
  assert.equal(result.requiresFreshExecutionValidation, true);
  assert.deepEqual(result.target, target);
  assert.deepEqual(result.plan, {
    action: 'invoke',
    mechanism: 'UIAutomation.InvokePattern',
    control: {
      selector: 'IncrementButton',
      controlType: 'Button',
      bounds: { x: 550, y: 500, width: 170, height: 58 },
      isEnabled: true,
      isVisible: true,
      isInvokable: true,
    },
  });
  assert.deepEqual(f.calls, [
    ['--version'],
    ['ui', 'list-windows', '-a', String(target.pid), '--json'],
    ['ui', 'inspect', '-w', String(target.hwnd), '--depth', '4', '--json'],
  ]);
  assert.equal(f.observations.length, 2);
  assert.deepEqual(result.evidence.desktopObservedAtMs, [NOW, NOW]);
  assert.equal(result.evidence.sessionId, 2);
  assert.equal(result.evidence.foreground, true);
  assert.ok(Object.isFrozen(f.observations[0]));
});

test('the preview exports no execution path and has no live provider default', async () => {
  const exports = await import('../src/desktop-action-guard.ts');
  assert.deepEqual(Object.keys(exports).sort(), ['DesktopActionGuardError', 'previewDesktopAction']);
  for (const dependencies of [undefined, {}, { executeReadOnly }, { observeDesktop: async () => ({}) }]) {
    await assert.rejects(previewDesktopAction(request(), dependencies), {
      code: 'MISSING_READ_ONLY_PROVIDERS',
    });
  }
});

test('malformed and extra request fields fail before any observation', async () => {
  const bad = [
    undefined,
    null,
    [],
    {},
    { ...request(), action: 'click' },
    { ...request(), focus: true },
    { ...request(), requestId: 'short' },
    { ...request(), requestId: 'x;evil_001' },
  ];
  for (const input of bad) {
    const f = fixture();
    await rejects(f, 'INVALID_REQUEST', input ?? null);
    assert.equal(f.calls.length + f.observations.length, 0);
  }
});

test('all exact target identities are mandatory and bounded', async () => {
  for (const field of Object.keys(target)) {
    const input = request();
    delete input.target[field];
    const f = fixture();
    await rejects(f, 'INVALID_REQUEST', input);
    assert.equal(f.observations.length, 0);
  }
  for (const [field, values] of Object.entries({
    pid: [0, -1, '9911', 1.5, 0x80000000],
    hwnd: [0, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1],
    process: ['', ' ', 'a/b', 'a b', 'x'.repeat(81)],
    title: ['', 'x\ny', 'x'.repeat(201)],
    className: ['', 'x\0', 'x'.repeat(101)],
    sessionId: [0, -1, '2'],
    processStartedAt: ['', 'invalid', '2026-02-30T11:59:00.000Z', '2026-10-26'],
  })) {
    for (const value of values) {
      const input = request();
      input.target[field] = value;
      const f = fixture();
      await rejects(f, 'INVALID_REQUEST', input);
      assert.equal(f.observations.length, 0);
    }
  }
});

test('one exact selector and expected control type are required', async () => {
  for (const selector of [
    undefined,
    null,
    [],
    ['IncrementButton', 'ResetButton'],
    '',
    ' ',
    'a\nb',
    'x'.repeat(201),
  ]) {
    const f = fixture();
    await rejects(f, 'INVALID_REQUEST', { ...request(), selector });
    assert.equal(f.observations.length, 0);
  }
  for (const expectedControlType of [undefined, null, [], '', 'ControlType.Button', 'x'.repeat(65)]) {
    await rejects(fixture(), 'INVALID_REQUEST', { ...request(), expectedControlType });
  }
  const f = fixture();
  await rejects(f, 'SELECTOR_NOT_UNIQUE', { ...request(), selector: 'incrementbutton' });
});

test('ChatGPT and browsers fail closed, even with a benign active title', async () => {
  for (const change of [
    { process: 'ChatGPT.exe' },
    { process: 'chrome' },
    { process: 'MSEDGE.EXE' },
    { process: 'firefox' },
    { process: 'brave' },
    { process: 'dot' },
    { title: 'ChatGPT - Work' },
    { title: 'https://chat.openai.com/' },
    { className: 'Chrome_WidgetWin_1' },
    { className: 'MozillaWindowClass' },
  ]) {
    const f = fixture();
    const input = request();
    Object.assign(input.target, change);
    await rejects(f, 'CHATGPT_BROWSER_FORBIDDEN', input);
    assert.equal(f.observations.length + f.calls.length, 0);
  }
});

test('VMware host and guest identities require a separate path without an override', async () => {
  for (const change of [
    { process: 'vmware' },
    { process: 'vmware-vmx.exe' },
    { className: 'VMUIFrame' },
    { className: 'MKSEmbedded' },
    { title: 'Lab - VMware Workstation' },
  ]) {
    const f = fixture();
    const input = request();
    Object.assign(input.target, change);
    await rejects(f, 'VMWARE_SEPARATE_PATH_REQUIRED', input);
    assert.equal(f.observations.length + f.calls.length, 0);
  }
  const f = fixture();
  await rejects(f, 'INVALID_REQUEST', { ...request(), allowVmware: true });
});

test('secure, locked, noninteractive, other-session and unknown desktop facts reject before UIA', async () => {
  for (const [change, code] of [
    [{ secureDesktop: true }, 'UNSAFE_DESKTOP'],
    [{ secureDesktop: undefined }, 'UNSAFE_DESKTOP'],
    [{ inputDesktop: 'Winlogon' }, 'UNSAFE_DESKTOP'],
    [{ inputDesktop: undefined }, 'UNSAFE_DESKTOP'],
    [{ windowStation: 'Service-0x0-3e7$' }, 'UNSAFE_DESKTOP'],
    [{ locked: true }, 'SESSION_NOT_READY'],
    [{ locked: undefined }, 'SESSION_NOT_READY'],
    [{ interactive: false }, 'SESSION_NOT_READY'],
    [{ interactive: undefined }, 'SESSION_NOT_READY'],
    [{ id: 3 }, 'SESSION_NOT_READY'],
    [{ id: '2' }, 'SESSION_NOT_READY'],
  ]) {
    const f = fixture();
    Object.assign(f.state.session, change);
    await rejects(f, code);
    assert.equal(f.calls.length, 0);
  }
});

test('native PID/HWND/process/title/class/process lifetime/session changes all reject', async () => {
  for (const [key, value] of Object.entries({
    pid: 9912,
    hwnd: 224467,
    process: 'OtherApp',
    title: 'Renamed',
    className: 'OtherClass',
    processStartedAt: '2026-10-26T11:59:01.000Z',
    sessionId: 3,
  })) {
    const f = fixture();
    f.state.window[key] = value;
    await rejects(f, 'STALE_TARGET');
    assert.equal(f.calls.length, 0);
  }
});

test('native visibility and already-foreground state are mandatory', async () => {
  for (const [change, code] of [
    [{ isForeground: false }, 'FOREGROUND_MISMATCH'],
    [{ isForeground: undefined }, 'FOREGROUND_MISMATCH'],
    [{ isVisible: false }, 'TARGET_NOT_VISIBLE'],
    [{ isVisible: undefined }, 'TARGET_NOT_VISIBLE'],
    [{ isMinimized: true }, 'TARGET_NOT_VISIBLE'],
    [{ isMinimized: undefined }, 'TARGET_NOT_VISIBLE'],
  ]) {
    const f = fixture();
    Object.assign(f.state.window, change);
    await rejects(f, code);
    assert.equal(f.calls.length, 0);
  }
});

test('minimized WinApp geometry, off-monitor, malformed and huge rectangles fail closed', async () => {
  for (const change of [
    { width: 160, height: 28 },
    { x: -32000, y: -32000 },
    { x: 5000 },
    { width: 0 },
    { height: -1 },
    { width: NaN },
    { x: Infinity },
    { width: '720' },
    { x: 100001 },
  ]) {
    const f = fixture();
    Object.assign(f.state.window.bounds, change);
    await rejects(f, 'TARGET_NOT_VISIBLE');
    assert.equal(f.calls.length, 0);
  }
  for (const monitors of [undefined, [], Array(17).fill(bounds)]) {
    const f = fixture();
    f.state.monitors = monitors;
    await rejects(f, 'INVALID_EVIDENCE');
  }
});

test('fresh native observations surround the inspection and reject session/focus/identity races', async () => {
  for (const [mutate, code] of [
    [
      (s) => {
        s.session.locked = true;
      },
      'SESSION_NOT_READY',
    ],
    [
      (s) => {
        s.session.inputDesktop = 'Winlogon';
      },
      'UNSAFE_DESKTOP',
    ],
    [
      (s) => {
        s.window.isForeground = false;
      },
      'FOREGROUND_MISMATCH',
    ],
    [
      (s) => {
        s.window.isMinimized = true;
      },
      'TARGET_NOT_VISIBLE',
    ],
    [
      (s) => {
        s.window.processStartedAt = '2026-10-26T11:59:02.000Z';
      },
      'STALE_TARGET',
    ],
    [
      (s) => {
        s.window.hwnd++;
      },
      'STALE_TARGET',
    ],
    [
      (s) => {
        s.window.bounds.x++;
      },
      'GEOMETRY_CHANGED',
    ],
    [
      (s) => {
        s.monitors[0].width++;
      },
      'GEOMETRY_CHANGED',
    ],
  ]) {
    const f = fixture();
    f.beforeObserve = (count) => {
      if (count === 2) mutate(f.state);
    };
    await rejects(f, code);
    assert.equal(f.observations.length, 2);
    assert.equal(f.calls.length, 3);
  }
});

test('WinApp summary identities, foreground and dimensions must agree with native observations', async () => {
  for (const [change, code] of [
    [{ processId: 3 }, 'UIA_INSPECTION_FAILED'],
    [{ hwnd: 3 }, 'UIA_INSPECTION_FAILED'],
    [{ processName: 'other' }, 'UIA_INSPECTION_FAILED'],
    [{ title: 'other' }, 'UIA_INSPECTION_FAILED'],
    [{ processName: 'desktopprobe' }, 'STALE_TARGET'],
    [{ className: 'other' }, 'STALE_TARGET'],
    [{ isForeground: false }, 'FOREGROUND_MISMATCH'],
    [{ width: 719 }, 'GEOMETRY_CHANGED'],
    [{ height: 459 }, 'GEOMETRY_CHANGED'],
  ]) {
    const f = fixture();
    Object.assign(f.listing[0], change);
    await rejects(f, code);
  }
});

test('backend version, malformed JSON and missing tree identities are rejected without retry', async () => {
  for (const [override, code] of [
    [async (args) => (args[0] === '--version' ? '0.8.0' : '[]'), 'UIA_INSPECTION_FAILED'],
    [async (args) => (args[0] === '--version' ? '0.7.1' : 'invalid'), 'UIA_INSPECTION_FAILED'],
  ]) {
    const f = fixture();
    f.dependencies.executeReadOnly = (r) => executeReadOnly(r, override);
    await rejects(f, code);
    assert.equal(f.observations.length, 1);
  }
  for (const mutate of [
    (tree) => {
      tree.windows = [];
    },
    (tree) => {
      tree.windows[0].hwnd++;
    },
  ]) {
    const f = fixture();
    mutate(f.tree);
    await rejects(f, 'UIA_INSPECTION_FAILED');
    assert.equal(f.calls.length, 3);
  }
});

test('missing, duplicated and malformed UIA windows or roots fail closed', async () => {
  for (const mutate of [
    (f) => {
      f.tree.windows.push(structuredClone(f.tree.windows[0]));
    },
    (f) => {
      f.tree.windows[0].elements = [];
    },
    (f) => {
      f.tree.windows[0].elements.push(structuredClone(f.root));
    },
    (f) => {
      f.root.children = {};
    },
    (f) => {
      f.root.children.push(null);
    },
  ]) {
    const f = fixture();
    mutate(f);
    await rejects(f, 'INVALID_EVIDENCE');
  }
});

test('selected control must occur exactly once including nested UIA matches', async () => {
  for (const mutate of [
    (f) => {
      f.root.children = [];
    },
    (f) => {
      f.button.selector = 'OtherButton';
    },
    (f) => {
      f.root.children.push(structuredClone(f.button));
    },
    (f) => {
      f.root.children.push({ children: [structuredClone(f.button)] });
    },
  ]) {
    const f = fixture();
    mutate(f);
    await rejects(f, 'SELECTOR_NOT_UNIQUE');
  }
});

test('exact control type, explicit enabled and explicit invokable facts are required', async () => {
  for (const change of [
    { type: 'Text' },
    { type: 'button' },
    { type: undefined },
    { isEnabled: false },
    { isEnabled: undefined },
    { isEnabled: 'true' },
    { isInvokable: false },
    { isInvokable: undefined },
    { isInvokable: 'true' },
  ]) {
    const f = fixture();
    Object.assign(f.button, change);
    await rejects(f, 'CONTROL_NOT_READY');
  }
});

test('offscreen, absent visibility, clipped, invalid and out-of-window controls are rejected', async () => {
  for (const change of [
    { isOffscreen: true },
    { isOffscreen: undefined },
    { isOffscreen: 'false' },
    { x: 499 },
    { y: 299 },
    { x: -32000, y: -32000 },
    { width: 900 },
    { height: 500 },
    { width: 0 },
    { x: NaN },
  ]) {
    const f = fixture();
    Object.assign(f.button, change);
    await rejects(f, 'TARGET_NOT_VISIBLE');
  }
  for (const mutate of [
    (f) => {
      f.root.isOffscreen = true;
    },
    (f) => {
      delete f.root.isOffscreen;
    },
    (f) => {
      f.root.x = -32000;
    },
    (f) => {
      f.root.width++;
    },
    (f) => {
      f.root.type = 'Pane';
    },
    (f) => {
      f.root.isEnabled = false;
    },
    (f) => {
      f.state.monitors[0].width = 600;
    },
  ]) {
    const f = fixture();
    mutate(f);
    await rejects(f, 'TARGET_NOT_VISIBLE');
  }
});

test('disabled, offscreen or clipped ancestors reject an otherwise enabled child', async () => {
  for (const change of [
    { isEnabled: false },
    { isOffscreen: true },
    { isOffscreen: undefined },
    { width: 10 },
    { height: 10 },
  ]) {
    const f = fixture();
    f.root.children = [{ type: 'Pane', ...bounds, isOffscreen: false, ...change, children: [f.button] }];
    await rejects(f, 'TARGET_NOT_VISIBLE');
  }
});

test('negative coordinates on a real secondary monitor are accepted', async () => {
  const f = fixture();
  f.state.window.bounds.x -= 1920;
  f.root.x -= 1920;
  f.button.x -= 1920;
  f.state.monitors = [{ x: -1920, y: 0, width: 1920, height: 1080 }];
  const result = await previewDesktopAction(request(), f.dependencies);
  assert.equal(result.plan.control.bounds.x, -1370);
});

test('unknown, stale, future or pre-preview native timestamps cannot attest freshness', async () => {
  for (const value of [undefined, null, 'now', NOW - 1, NOW - 2001, NOW + 1]) {
    const f = fixture();
    f.state.observedAtMs = value;
    await rejects(f, 'STALE_EVIDENCE');
    assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  f.beforeCommand = (args) => {
    if (args[1] === 'inspect') f.setTime(NOW + 100);
  };
  await rejects(f, 'STALE_EVIDENCE');
  assert.equal(f.observations.length, 2, 'old final evidence cannot reuse the initial observation');
});

test('slow inspection, slow final observation, total deadline and backward clocks reject', async () => {
  for (const elapsed of [2001, 5001]) {
    const f = fixture();
    f.beforeCommand = (args) => {
      if (args[1] === 'inspect') {
        f.setTime(NOW + elapsed);
        f.state.observedAtMs = NOW + elapsed;
      }
    };
    await rejects(f, 'STALE_EVIDENCE');
  }
  const slowFinal = fixture();
  slowFinal.beforeObserve = (count) => {
    if (count === 2) {
      slowFinal.setTime(NOW + 2001);
      slowFinal.state.observedAtMs = NOW + 2001;
    }
  };
  await rejects(slowFinal, 'STALE_EVIDENCE');
  const backwards = fixture();
  backwards.beforeObserve = () => backwards.setTime(NOW - 1);
  await rejects(backwards, 'STALE_EVIDENCE');
  const invalid = fixture();
  invalid.dependencies.now = () => NaN;
  await rejects(invalid, 'INVALID_CLOCK');
  const badClock = fixture();
  badClock.dependencies.now = 1;
  await rejects(badClock, 'INVALID_CLOCK');
  const intermediate = fixture();
  intermediate.beforeCommand = (args) => {
    if (args[1] === 'inspect') {
      intermediate.setTime(NOW + 100);
      intermediate.state.observedAtMs = NOW + 100;
    }
  };
  intermediate.beforeObserve = (count) => {
    if (count === 2) intermediate.setTime(NOW + 50);
  };
  await rejects(intermediate, 'STALE_EVIDENCE');
});

test('bounded JSON evidence rejects oversized, cyclic and malformed provider responses', async () => {
  const oversized = fixture();
  oversized.tree.privateData = 'x'.repeat(384 * 1024);
  await rejects(oversized, 'EVIDENCE_LIMIT');
  for (const value of [undefined, null, [], 'invalid']) {
    const f = fixture();
    f.dependencies.executeReadOnly = async () => value;
    await rejects(f, 'INVALID_EVIDENCE');
  }
  const cyclic = fixture();
  const value = {};
  value.cycle = value;
  cyclic.dependencies.observeDesktop = async () => value;
  await rejects(cyclic, 'INVALID_EVIDENCE');
  const deep = fixture();
  let parent = deep.root;
  for (let i = 0; i < 34; i++) {
    const child = { children: [] };
    parent.children = [child];
    parent = child;
  }
  await rejects(deep, 'EVIDENCE_LIMIT');
  const wide = fixture();
  wide.root.children = Array.from({ length: 2049 }, () => ({}));
  await rejects(wide, 'EVIDENCE_LIMIT');
});

test('injected UIA metadata must still be pinned successful read-only inspection evidence', async () => {
  const base = fixture();
  const response = await executeReadOnly({ operation: 'inspect', ...target, depth: 4 }, base.runner);
  for (const change of [
    { readOnly: false },
    { operation: 'windows' },
    { backend: 'OtherBackend' },
    { version: '0.8.0' },
    { ok: false },
    { error: {} },
  ]) {
    const f = fixture();
    f.dependencies.executeReadOnly = async () => ({ ...response, ...change });
    await rejects(f, 'INVALID_EVIDENCE');
  }
});

test('raw provider failures and incidental UIA text never escape the result', async () => {
  for (const [provider, code] of [
    ['observeDesktop', 'DESKTOP_OBSERVATION_FAILED'],
    ['executeReadOnly', 'UIA_INSPECTION_FAILED'],
  ]) {
    const f = fixture();
    let attempts = 0;
    f.dependencies[provider] = async () => {
      attempts++;
      throw new Error('PRIVATE_CONTENT credential=secret');
    };
    await assert.rejects(previewDesktopAction(request(), f.dependencies), (error) => {
      assert.equal(error.code, code);
      assert.ok(!error.message.includes('PRIVATE_CONTENT'));
      assert.equal(error.cause, undefined);
      return true;
    });
    assert.equal(attempts, 1);
  }
  const f = fixture();
  f.root.name = 'PRIVATE_CONTENT';
  f.button.name = 'PRIVATE_CONTENT';
  const result = await previewDesktopAction(request(), f.dependencies);
  assert.ok(!JSON.stringify(result).includes('PRIVATE_CONTENT'));
  assert.ok(!Object.hasOwn(result, 'tree'));
  const forgedError = fixture();
  forgedError.dependencies.observeDesktop = async () => {
    throw new DesktopActionGuardError('PRIVATE_CONTENT', 'PRIVATE_CONTENT');
  };
  await rejects(forgedError, 'DESKTOP_OBSERVATION_FAILED');
});

test('caller mutation cannot retarget an in-flight preview and provider mutation cannot rewrite saved evidence', async () => {
  const f = fixture();
  const input = request();
  f.beforeObserve = (count) => {
    if (count === 1) {
      input.target.hwnd = 1;
      input.selector = 'OtherButton';
    }
  };
  const result = await previewDesktopAction(input, f.dependencies);
  assert.equal(result.target.hwnd, target.hwnd);
  assert.equal(result.plan.control.selector, 'IncrementButton');
  f.state.window.bounds.x = 0;
  f.button.x = 0;
  assert.equal(result.evidence.windowBounds.x, 500);
  assert.equal(result.plan.control.bounds.x, 550);
});

test('preview IDs never replay cached readiness and every call inspects again', async () => {
  const f = fixture();
  await previewDesktopAction(request(), f.dependencies);
  f.button.isEnabled = false;
  await rejects(f, 'CONTROL_NOT_READY');
  assert.equal(f.calls.length, 6);
});
