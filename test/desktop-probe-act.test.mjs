import assert from 'node:assert/strict';
import test from 'node:test';
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  parseActionRequest,
  assertProbeActionReady,
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
};
const request = (id = 'gui004_action_001', expectedCount = '0') =>
  parseActionRequest([
    '--pid',
    String(win.processId),
    '--hwnd',
    String(win.hwnd),
    '--request-id',
    id,
    `--expected-count=${expectedCount}`,
  ]);

async function addEvent(root, stage, counter) {
  await appendFile(
    path.join(root, 'native-probe-' + win.processId + '.jsonl'),
    JSON.stringify({ pid: win.processId, hwnd: win.hwnd, stage, counter, utc: new Date().toISOString() }) +
      '\n',
  );
}

function fakeUi(root, { failAction = false } = {}) {
  const calls = [];
  const runner = async (args) => {
    calls.push(args);
    if (args[0] === '--version') return '0.7.1';
    if (args[1] === 'list-windows') return JSON.stringify([win]);
    if (args[1] === 'inspect')
      return JSON.stringify({
        windows: [
          {
            hwnd: win.hwnd,
            elements: [
              {
                children: [
                  {
                    selector: 'IncrementButton',
                    type: 'Button',
                    isEnabled: true,
                    isOffscreen: false,
                    isInvokable: true,
                  },
                ],
              },
            ],
          },
        ],
      });
    if (args[1] === 'invoke') {
      if (failAction) throw new Error('WinApp response unavailable');
      await addEvent(root, 'incremented', 1);
      return JSON.stringify({ hwnd: win.hwnd, performedAction: 'invoke' });
    }
    throw new Error('Unexpected WinApp command ' + args.join(' '));
  };
  return { calls, runner };
}

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
    await assert.rejects(
      () => invokeProbeOnce(action, { runner, root }),
      (e) => e.code === 'ACTION_RECOVERY_REQUIRED',
    );
    assert.equal(calls.filter((x) => x[1] === 'invoke').length, 1);
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
