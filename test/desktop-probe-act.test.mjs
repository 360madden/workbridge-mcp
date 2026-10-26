import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  parseActionRequest,
  assertProbeActionReady,
  assertProbePointerReady,
  inspectChildHandle,
  invokeProbeOnce,
} from '../scripts/desktop-probe-act.mjs';

const win = {
  hwnd: 224466,
  processId: 9911,
  processName: 'DesktopProbe',
  title: 'Workbridge GUI-004 Native Input Probe',
  className: 'WinFormsTest',
  width: 720,
  height: 460,
  isForeground: true,
};
const request = (id = 'gui004_action_001', expectedCount = '0', method = 'uia') =>
  parseActionRequest([
    '--pid',
    String(win.processId),
    '--hwnd',
    String(win.hwnd),
    '--request-id',
    id,
    `--expected-count=${expectedCount}`,
    '--method',
    method,
  ]);

async function addEvent(root, stage, counter) {
  await appendFile(
    path.join(root, 'native-probe-' + win.processId + '.jsonl'),
    JSON.stringify({ pid: win.processId, hwnd: win.hwnd, stage, counter, utc: new Date().toISOString() }) +
      '\n',
  );
}

function fakeUi(
  root,
  { failAction = false, badFocus = false, lostForeground = false, silentClick = false } = {},
) {
  const calls = [];
  const runner = async (args) => {
    calls.push(args);
    if (args[0] === '--version') return '0.7.1';
    if (args[1] === 'list-windows') return JSON.stringify([{ ...win, isForeground: !lostForeground }]);
    if (args[1] === 'inspect') {
      const depthIndex = args.indexOf('--depth');
      if (depthIndex < 0 || args[depthIndex + 1] !== '2') {
        throw new Error('WinApp inspect requires the validated request depth');
      }
      return JSON.stringify({
        windows: [
          {
            hwnd: win.hwnd,
            elements: [
              {
                type: 'Window',
                x: 500,
                y: 300,
                width: 720,
                height: 460,
                isOffscreen: false,
                children: [
                  {
                    selector: 'IncrementButton',
                    automationId: 'IncrementButton',
                    type: 'Button',
                    isEnabled: true,
                    isOffscreen: false,
                    isInvokable: true,
                    x: 550,
                    y: 500,
                    width: 170,
                    height: 58,
                  },
                ],
              },
            ],
          },
        ],
      });
    }
    if (args[1] === 'focus') return JSON.stringify({ hwnd: win.hwnd, elementId: 'btn-probe-test' });
    if (args[1] === 'get-focused') {
      return JSON.stringify({
        hasFocus: true,
        element: {
          automationId: badFocus ? 'ResetButton' : 'IncrementButton',
          type: 'Button',
          isEnabled: true,
          isOffscreen: false,
        },
      });
    }
    if (['invoke', 'send-keys', 'click'].includes(args[1])) {
      if (failAction) throw new Error('WinApp response unavailable');
      if (args[1] !== 'click' || !silentClick) await addEvent(root, 'incremented', 1);
      if (args[1] === 'invoke') return JSON.stringify({ hwnd: win.hwnd, performedAction: 'invoke' });
      if (args[1] === 'send-keys')
        return JSON.stringify({
          hwnd: win.hwnd + 50,
          keys: 'enter',
          via: 'post-message',
          actionCount: 1,
          target: 'IncrementButton',
          warnings: [],
        });
      return JSON.stringify({ hwnd: win.hwnd, clickType: 'click', x: 635, y: 529 });
    }
    throw new Error('Unexpected WinApp command ' + args.join(' '));
  };
  return { calls, runner };
}

const fakeHandleInspector = async ({ parentHwnd, reportedHwnd, expectedPid }) => ({
  schemaVersion: 1,
  parentHwnd,
  reportedHwnd,
  ancestorHwnd: parentHwnd,
  parentPid: expectedPid,
  reportedPid: expectedPid,
  belongsToTarget: true,
});

test('GUI-004 accepts only a numbered probe action, no arbitrary target or verb', () => {
  assert.equal(request().target.process, 'DesktopProbe');
  assert.equal(request().target.title, win.title);
  assert.throws(
    () =>
      parseActionRequest([
        '--pid',
        '1',
        '--hwnd',
        '2',
        '--request-id',
        'gui004_action_001',
        '--expected-count',
        '0',
        '--operation',
        'click',
      ]),
    (e) => e.code === 'INVALID_ARGUMENTS',
  );
  assert.throws(
    () => request('gui004_action_001', '-1'),
    (e) => e.code === 'INVALID_EXPECTED_STATE',
  );
  assert.throws(
    () => request('../escape'),
    (e) => e.code === 'INVALID_REQUEST_ID',
  );
});

test('GUI-004 refuses unverified UIA selectors', () => {
  const preflight = {
    target: { hwnd: win.hwnd, process: 'DesktopProbe', title: win.title, width: 720, height: 460 },
    tree: {
      windows: [
        {
          hwnd: win.hwnd,
          elements: [
            { children: [{ selector: 'Close', type: 'Button', isEnabled: true, isInvokable: true }] },
          ],
        },
      ],
    },
  };
  assert.throws(
    () => assertProbeActionReady(preflight),
    (e) => e.code === 'ACTION_NOT_READY',
  );
});

test('GUI-004 durable UIA action happens once and verifies independent counter receipt', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wb-ui-action-'));
  try {
    await addEvent(root, 'shown', 0);
    const { runner, calls } = fakeUi(root);
    const first = await invokeProbeOnce(request(), { runner, root });
    assert.equal(first.ok, true);
    assert.equal(first.replayed, false);
    assert.equal(first.afterCount, 1);
    assert.equal(first.osMouseKeyboardInjected, false);
    assert.equal(calls.filter((x) => x[1] === 'invoke').length, 1);
    const second = await invokeProbeOnce(request(), { runner, root });
    assert.equal(second.replayed, true);
    assert.equal(calls.filter((x) => x[1] === 'invoke').length, 1);
    await assert.rejects(
      () => invokeProbeOnce(request('gui004_action_001', '1'), { runner, root }),
      (e) => e.code === 'REQUEST_ID_CONFLICT',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('GUI-004 stale expected counter fails before invoking', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wb-ui-stale-'));
  try {
    await addEvent(root, 'shown', 0);
    const { runner, calls } = fakeUi(root);
    await assert.rejects(
      () => invokeProbeOnce(request('gui004_stale_001', '3'), { runner, root }),
      (e) => e.code === 'EXPECTED_STATE_MISMATCH',
    );
    assert.equal(calls.filter((x) => x[1] === 'invoke').length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('GUI-004 uncertain invoke leaves an intent and refuses automatic repeat', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wb-ui-uncertain-'));
  try {
    await addEvent(root, 'shown', 0);
    const { runner, calls } = fakeUi(root, { failAction: true });
    const action = request('gui004_uncertain_001');
    await assert.rejects(
      () => invokeProbeOnce(action, { runner, root }),
      (e) => e.code === 'ACTION_RECOVERY_REQUIRED',
    );
    const intent = JSON.parse(
      await readFile(path.join(root, 'ui-action-gui004_uncertain_001.intent.json'), 'utf8'),
    );
    assert.equal(intent.selector, 'IncrementButton');
    const stampBytes = await readFile(path.join(root, 'desktop-input-turn.lock'));
    const stamp = JSON.parse(stampBytes.toString('utf8'));
    assert.equal(stamp.kind, 'workbridge.gui-turn');
    assert.equal(stamp.producer, 'desktop-probe-action');
    assert.equal(stamp.requestId, action.requestId);
    assert.equal(stamp.target.hwnd, action.target.hwnd);
    assert.equal(stamp.leaseId, intent.leaseId);
    const quarantine = JSON.parse(
      await readFile(path.join(root, 'desktop-turn-quarantine-' + stamp.leaseId + '.json'), 'utf8'),
    );
    assert.equal(quarantine.leaseId, stamp.leaseId);
    assert.equal(quarantine.ownerStampSha256, createHash('sha256').update(stampBytes).digest('hex'));
    assert.equal(
      quarantine.intentSha256,
      createHash('sha256')
        .update(JSON.stringify(intent) + '\n')
        .digest('hex'),
    );
    assert.equal(quarantine.automaticRetryAllowed, false);
    await assert.rejects(
      () => invokeProbeOnce(action, { runner, root }),
      (e) => e.code === 'ACTION_RECOVERY_REQUIRED',
    );
    // Other durable request IDs must also be blocked after uncertain GUI input.
    await assert.rejects(
      () => invokeProbeOnce(request('gui004_uncertain_other'), { runner, root }),
      (e) => e.code === 'UI_TURN_BUSY',
    );
    assert.equal(calls.filter((x) => x[1] === 'invoke').length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('GUI-004 refuses to remove a lock modified after synthetic input', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wb-ui-owner-change-'));
  try {
    await addEvent(root, 'shown', 0);
    const { runner } = fakeUi(root);
    const changedRunner = async (args) => {
      const result = await runner(args);
      if (args[1] === 'invoke') {
        await writeFile(path.join(root, 'desktop-input-turn.lock'), 'foreign-owner');
      }
      return result;
    };
    await assert.rejects(
      () => invokeProbeOnce(request('gui004_changed_owner_001'), { runner: changedRunner, root }),
      (e) => e.code === 'ACTION_RECOVERY_REQUIRED',
    );
    assert.equal(await readFile(path.join(root, 'desktop-input-turn.lock'), 'utf8'), 'foreign-owner');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('GUI-004 existing input lease prevents concurrent action', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wb-ui-busy-'));
  try {
    await writeFile(path.join(root, 'desktop-input-turn.lock'), 'other owner', { flag: 'wx' });
    const { runner, calls } = fakeUi(root);
    await assert.rejects(
      () => invokeProbeOnce(request('gui004_busy_001'), { runner, root }),
      (e) => e.code === 'UI_TURN_BUSY',
    );
    assert.equal(calls.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('GUI-004b accepts only three fixed methods, never arbitrary keys or coordinates', () => {
  assert.equal(request('gui004b_keyboard_001', '0', 'keyboard').method, 'keyboard');
  assert.equal(request('gui004b_mouse_001', '0', 'mouse').method, 'mouse');
  assert.throws(
    () => request('gui004b_invalid_001', '0', 'send-input'),
    (e) => e.code === 'INVALID_METHOD',
  );
});

test('GUI-004b rejects minimized WinForms negative-coordinate UIA elements', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wb-ui-offscreen-'));
  try {
    const { runner } = fakeUi(root);
    const { executeReadOnly } = await import('../scripts/desktop-ui.mjs');
    const preflight = await executeReadOnly(request().target, runner);
    assert.equal(assertProbePointerReady(preflight).button.selector, 'IncrementButton');
    preflight.target.width = 160;
    preflight.target.height = 28;
    preflight.tree.windows[0].elements[0].x = -32000;
    preflight.tree.windows[0].elements[0].y = -32000;
    preflight.tree.windows[0].elements[0].width = 160;
    preflight.tree.windows[0].elements[0].height = 28;
    assert.throws(
      () => assertProbePointerReady(preflight),
      (e) => ['STALE_TARGET', 'TARGET_NOT_VISIBLE'].includes(e.code),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('GUI-004b targeted keyboard Enter requires verified focus and native counter change', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wb-ui-keyboard-'));
  try {
    await addEvent(root, 'shown', 0);
    const { runner, calls } = fakeUi(root);
    const req = request('gui004b_keyboard_002', '0', 'keyboard');
    const result = await invokeProbeOnce(req, { runner, root, handleInspector: fakeHandleInspector });
    assert.equal(result.ok, true);
    assert.equal(result.method, 'keyboard');
    assert.equal(result.handleRelationship, 'verified-child');
    assert.equal(result.reportedHwnd, win.hwnd + 50);
    assert.equal(result.afterCount, 1);
    assert.equal(result.osMouseKeyboardInjected, false);
    assert.equal(result.inputMethod, 'WinApp post-message (HWND-targeted)');
    assert.equal(calls.filter((x) => x[1] === 'send-keys').length, 1);
    assert.deepEqual(
      calls.find((x) => x[1] === 'send-keys'),
      [
        'ui',
        'send-keys',
        'enter',
        '-w',
        String(win.hwnd),
        '--target',
        'IncrementButton',
        '--via',
        'post-message',
        '--json',
      ],
    );
    assert.equal(
      (await invokeProbeOnce(req, { runner, root, handleInspector: fakeHandleInspector })).replayed,
      true,
    );
    assert.equal(calls.filter((x) => x[1] === 'send-keys').length, 1);
    await assert.rejects(
      () => invokeProbeOnce(request('gui004b_keyboard_002', '0', 'mouse'), { runner, root }),
      (e) => e.code === 'REQUEST_ID_CONFLICT',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('GUI-004b validates child HWND ancestry and fails closed on unrelated control', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wb-ui-foreignhwnd-'));
  try {
    await addEvent(root, 'shown', 0);
    const { runner, calls } = fakeUi(root);
    const req = request('gui004b_foreignhwnd_001', '0', 'keyboard');
    await assert.rejects(
      () =>
        invokeProbeOnce(req, {
          runner,
          root,
          handleInspector: async () => ({
            ...(await fakeHandleInspector({
              parentHwnd: win.hwnd,
              reportedHwnd: win.hwnd + 50,
              expectedPid: win.processId,
            })),
            ancestorHwnd: 12345,
            belongsToTarget: false,
          }),
        }),
      (e) => e.code === 'ACTION_RECOVERY_REQUIRED',
    );
    assert.equal(calls.filter((x) => x[1] === 'send-keys').length, 1);
    await assert.rejects(
      () => invokeProbeOnce(req, { runner, root, handleInspector: fakeHandleInspector }),
      (e) => e.code === 'ACTION_RECOVERY_REQUIRED',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('GUI-004b refuses invalid native HWND arguments without spawning inspection', async () => {
  await assert.rejects(
    () => inspectChildHandle({ parentHwnd: 0, reportedHwnd: 1, expectedPid: 3 }),
    (e) => e.code === 'INVALID_WINDOW_HANDLE',
  );
});

test('GUI-004b wrong focused element leaves durable intent without typing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wb-ui-badfocus-'));
  try {
    await addEvent(root, 'shown', 0);
    const { runner, calls } = fakeUi(root, { badFocus: true });
    const req = request('gui004b_badfocus_001', '0', 'keyboard');
    await assert.rejects(
      () => invokeProbeOnce(req, { runner, root }),
      (e) => e.code === 'ACTION_RECOVERY_REQUIRED',
    );
    assert.equal(calls.filter((x) => x[1] === 'send-keys').length, 0);
    const intent = JSON.parse(
      await readFile(path.join(root, 'ui-action-gui004b_badfocus_001.intent.json'), 'utf8'),
    );
    assert.equal(intent.method, 'keyboard');
    await assert.rejects(
      () => invokeProbeOnce(req, { runner, root }),
      (e) => e.code === 'ACTION_RECOVERY_REQUIRED',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('GUI-004b wrong foreground refuses both keyboard and mouse input', async () => {
  for (const method of ['keyboard', 'mouse']) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wb-ui-foreground-'));
    try {
      await addEvent(root, 'shown', 0);
      const { runner, calls } = fakeUi(root, { lostForeground: true });
      await assert.rejects(
        () => invokeProbeOnce(request('gui004b_foreground_' + method, '0', method), { runner, root }),
        (e) => e.code === 'ACTION_RECOVERY_REQUIRED',
      );
      assert.equal(calls.filter((x) => ['send-keys', 'click'].includes(x[1])).length, 0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('GUI-004b targeted mouse click requires verified on-window coordinates and native proof', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wb-ui-mouse-'));
  try {
    await addEvent(root, 'shown', 0);
    const { runner, calls } = fakeUi(root);
    const req = request('gui004b_mouse_002', '0', 'mouse');
    const result = await invokeProbeOnce(req, { runner, root });
    assert.equal(result.ok, true);
    assert.equal(result.afterCount, 1);
    assert.equal(result.osMouseKeyboardInjected, true);
    assert.equal(calls.filter((x) => x[1] === 'click').length, 1);
    assert.equal((await invokeProbeOnce(req, { runner, root })).replayed, true);
    assert.equal(calls.filter((x) => x[1] === 'click').length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('GUI-004b tool-reported mouse success without native effect is never accepted', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wb-ui-silentclick-'));
  try {
    await addEvent(root, 'shown', 0);
    const { runner, calls } = fakeUi(root, { silentClick: true });
    const req = request('gui004b_silentclick_001', '0', 'mouse');
    await assert.rejects(
      () => invokeProbeOnce(req, { runner, root }),
      (e) => e.code === 'ACTION_RECOVERY_REQUIRED',
    );
    assert.equal(calls.filter((x) => x[1] === 'click').length, 1);
    await assert.rejects(
      () => invokeProbeOnce(req, { runner, root }),
      (e) => e.code === 'ACTION_RECOVERY_REQUIRED',
    );
    assert.equal(calls.filter((x) => x[1] === 'click').length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
