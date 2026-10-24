import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  parseCaptureRequest,
  assertVisibleTarget,
  captureWindow,
  verifyPng,
} from '../scripts/desktop-capture.mjs';

const samplePng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/bH8AAAAASUVORK5CYII=',
  'base64',
);
const win = {
  hwnd: 65892,
  processId: 16036,
  processName: 'explorer', // Untitled HWND omits the title field in WinApp JSON.
  className: 'Shell_TrayWnd',
  width: 2560,
  height: 48,
};
const parse = (requestId = 'gui003_test_001') =>
  parseCaptureRequest([
    '--pid',
    String(win.processId),
    '--hwnd',
    String(win.hwnd),
    '--process',
    win.processName,
    '--class',
    win.className,
    '--request-id',
    requestId,
  ]);

function fakeBackend({ offscreen = false } = {}) {
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
                type: 'Pane',
                isOffscreen: offscreen,
                width: offscreen ? 0 : win.width,
                height: offscreen ? 0 : win.height,
              },
            ],
          },
        ],
      });
    if (args[1] === 'screenshot') {
      const output = args[args.indexOf('--output') + 1];
      await writeFile(output, samplePng, { flag: 'wx' });
      return JSON.stringify({
        filePath: output,
        width: 1,
        height: 1,
        processId: win.processId,
        hwnd: win.hwnd,
      });
    }
    throw new Error('Unsupported backend call: ' + args.join(' '));
  };
  return { calls, runner };
}

test('GUI-003 requires an exact, bounded target and durable request ID', () => {
  assert.equal(parse().target.hwnd, 65892);
  assert.throws(
    () => parseCaptureRequest(['--pid', '1', '--hwnd', '2', '--process', 'foo']),
    (e) => e.code === 'INVALID_REQUEST_ID',
  );
  assert.throws(
    () =>
      parseCaptureRequest(['--pid', '1', '--hwnd', '2', '--process', 'foo', '--request-id', '../other-user']),
    (e) => e.code === 'INVALID_REQUEST_ID',
  );
  assert.throws(
    () =>
      parseCaptureRequest([
        '--pid',
        '1',
        '--hwnd',
        '2',
        '--process',
        'foo',
        '--request-id',
        'gui003_test',
        '--capture-screen',
      ]),
    (e) => e.code === 'INVALID_ARGUMENTS',
  );
});

test('GUI-003 refuses minimized and offscreen windows before screenshots', () => {
  const good = {
    target: {
      hwnd: win.hwnd,
      width: 2560,
      height: 48,
      className: win.className,
    },
    tree: {
      windows: [
        {
          hwnd: win.hwnd,
          elements: [
            {
              width: 2560,
              height: 48,
              isOffscreen: false,
            },
          ],
        },
      ],
    },
  };
  assert.equal(assertVisibleTarget(good, win.className).hwnd, win.hwnd);
  assert.throws(
    () => assertVisibleTarget({ ...good, target: { ...good.target, width: 160, height: 28 } }),
    (e) => e.code === 'TARGET_NOT_VISIBLE',
  );
  assert.throws(
    () =>
      assertVisibleTarget({
        ...good,
        tree: {
          windows: [
            {
              hwnd: win.hwnd,
              elements: [
                {
                  width: 0,
                  height: 0,
                  isOffscreen: true,
                },
              ],
            },
          ],
        },
      }),
    (e) => e.code === 'TARGET_NOT_VISIBLE',
  );
  assert.throws(
    () => assertVisibleTarget(good, 'OtherWindow'),
    (e) => e.code === 'STALE_TARGET',
  );
});

test('GUI-003 validates PNG identity and refuses empty evidence', () => {
  assert.deepEqual(verifyPng(samplePng), { width: 1, height: 1 });
  assert.throws(
    () => verifyPng(Buffer.alloc(80)),
    (e) => e.code === 'INVALID_PNG',
  );
});

test('GUI-003 writes fingerprinted evidence once and replays without recapture', async () => {
  const evidenceRoot = await mkdtemp(path.join(os.tmpdir(), 'wb-gui003-test-'));
  try {
    const { calls, runner } = fakeBackend();
    const request = parse();
    const first = await captureWindow(request, { runner, evidenceRoot });
    assert.equal(first.ok, true);
    assert.equal(first.replayed, false);
    assert.equal(first.inputInjected, false);
    assert.equal(first.foregroundMayChange, true);
    assert.equal(first.width, 1);
    assert.equal(first.sha256.length, 64);
    assert.equal(calls.filter((x) => x[1] === 'screenshot').length, 1);
    const replayed = await captureWindow(request, { runner, evidenceRoot });
    assert.equal(replayed.replayed, true);
    assert.equal(calls.filter((x) => x[1] === 'screenshot').length, 1);
    await assert.rejects(
      () =>
        captureWindow(
          {
            ...request,
            expectedClass: 'OtherWindow',
          },
          { runner, evidenceRoot },
        ),
      (e) => e.code === 'REQUEST_ID_CONFLICT',
    );
  } finally {
    await rm(evidenceRoot, { recursive: true, force: true });
  }
});

test('GUI-003 fails closed on offscreen target without writing image', async () => {
  const evidenceRoot = await mkdtemp(path.join(os.tmpdir(), 'wb-gui003-offscreen-'));
  try {
    const { calls, runner } = fakeBackend({ offscreen: true });
    await assert.rejects(
      () => captureWindow(parse('gui003_test_offscreen'), { runner, evidenceRoot }),
      (e) => e.code === 'TARGET_NOT_VISIBLE',
    );
    assert.equal(calls.filter((x) => x[1] === 'screenshot').length, 0);
  } finally {
    await rm(evidenceRoot, { recursive: true, force: true });
  }
});
