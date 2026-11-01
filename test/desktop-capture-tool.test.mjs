import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { desktopCaptureWindow } from '../dist/desktop-capture-tool.js';
import { parseCaptureRequest } from '../scripts/desktop-capture.mjs';

const target = {
  pid: 100,
  hwnd: 200,
  process: 'DesktopProbe',
  requestId: 'gui006_capture_test_001',
  title: 'Disposable capture test',
  className: 'WindowsForms10.Window.8.app.0',
};

function receiptFor(request = target) {
  return {
    ok: true,
    replayed: false,
    schemaVersion: 1,
    requestId: request.requestId,
    pid: request.pid,
    hwnd: request.hwnd,
    process: request.process,
    expectedClass: request.className ?? null,
    title: request.title ?? '',
    capturedUtc: '2026-10-26T12:00:00.000Z',
    imagePath: fileURLToPath(
      new URL(`../.tools/desktop-evidence/capture-${request.requestId}.png`, import.meta.url),
    ),
    width: 702,
    height: 442,
    sizeBytes: 12345,
    sha256: 'a'.repeat(64),
    inputInjected: false,
    foregroundMayChange: true,
  };
}

test('capture tool calls only the existing script with exact guards and preserves safe receipt fields', async () => {
  const source = receiptFor();
  const calls = [];
  const result = await desktopCaptureWindow(target, async (script, args) => {
    calls.push({ script, args });
    const parsed = parseCaptureRequest(args);
    assert.equal(parsed.target.pid, target.pid);
    assert.equal(parsed.target.hwnd, target.hwnd);
    assert.equal(parsed.target.process, target.process);
    assert.equal(parsed.target.title, target.title);
    assert.equal(parsed.expectedClass, target.className);
    assert.equal(parsed.requestId, target.requestId);
    return { ...source, unexpected: 'must not escape', imageBase64: 'must not escape' };
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].script, 'desktop-capture.mjs');
  assert.deepEqual(result, source);
});

test('capture tool supports omitted optional guards and source replay without recapturing', async () => {
  const request = { pid: 1, hwnd: 2, process: 'explorer', requestId: 'capture8' };
  const source = { ...receiptFor(request), replayed: true };
  let calls = 0;
  assert.deepEqual(
    await desktopCaptureWindow(request, async (_script, args) => {
      calls++;
      const parsed = parseCaptureRequest(args);
      assert.equal(parsed.target.title, null);
      assert.equal(parsed.expectedClass, null);
      return source;
    }),
    source,
  );
  assert.equal(calls, 1);
});

test('capture tool preserves option-like class names as literal CLI values', async () => {
  const request = { ...target, className: '-TestWindow' };
  await desktopCaptureWindow(request, async (_script, args) => {
    const parsed = parseCaptureRequest(args);
    assert.equal(parsed.target.title, target.title);
    assert.equal(parsed.expectedClass, '-TestWindow');
    return receiptFor(request);
  });
});

test('capture tool rejects unsafe and unbounded requests before calling a runner', async () => {
  const invalid = [
    null,
    [],
    ...[0, -1, 1.5, '100', NaN, Infinity, 0x80000000].map((pid) => ({ ...target, pid })),
    ...[0, -1, 1.5, '200', Number.MAX_SAFE_INTEGER + 1].map((hwnd) => ({ ...target, hwnd })),
    ...['', '--focus', '../explorer', 'a b', 'x\0y', 'x'.repeat(81), null].map((process) => ({
      ...target,
      process,
    })),
    ...['', 'short', '../escape', '_capture8', 'x'.repeat(65), 'capture\n8', null].map((requestId) => ({
      ...target,
      requestId,
    })),
    ...['', '--focus', '-title', 'x'.repeat(201), 'hello\nworld', 'hello\0world', null, 42].map((title) => ({
      ...target,
      title,
    })),
    ...['', 'x'.repeat(101), 'a b', 'a\nb', '../class', null, 42].map((className) => ({
      ...target,
      className,
    })),
  ];
  for (const request of invalid) {
    await assert.rejects(
      desktopCaptureWindow(request, async () => assert.fail('invalid request reached runner')),
      (error) => ['INVALID_ARGUMENTS', 'INVALID_TARGET', 'INVALID_REQUEST_ID'].includes(error.code),
    );
  }
});

test('capture tool rejects every mismatched receipt identity including replay title changes', async () => {
  for (const change of [
    { requestId: 'another_request' },
    { pid: target.pid + 1 },
    { pid: String(target.pid) },
    { hwnd: target.hwnd + 1 },
    { process: 'OtherProcess' },
    { expectedClass: 'OtherClass' },
    { expectedClass: null },
    { title: 'Other title', replayed: true },
  ]) {
    await assert.rejects(
      desktopCaptureWindow(target, async () => ({ ...receiptFor(), ...change })),
      (error) => error.code === 'CAPTURE_TARGET_MISMATCH',
    );
  }
});

test('capture tool rejects successful-exit impostors and invalid evidence metadata', async () => {
  for (const value of [null, [], {}, { ok: false }, { ok: 'true' }]) {
    await assert.rejects(
      desktopCaptureWindow(target, async () => value),
      (error) => error.code === 'INVALID_CAPTURE_RECEIPT',
    );
  }
  for (const change of [
    { schemaVersion: 2 },
    { replayed: 1 },
    { title: 'bad\nmetadata' },
    { capturedUtc: 'not a date' },
    { capturedUtc: '2026-02-30T12:00:00.000Z' },
    { imagePath: 'capture.png' },
    { imagePath: receiptFor().imagePath.replace('.png', '-other.png') },
    { imagePath: receiptFor().imagePath.replace('desktop-evidence', 'desktop-evidence/../desktop-evidence') },
    { width: 0 },
    { width: 10001 },
    { width: '702' },
    { height: 1.5 },
    { height: 10001 },
    { sizeBytes: 44 },
    { sizeBytes: 8 * 1024 * 1024 + 1 },
    { sha256: 'z'.repeat(64) },
    { sha256: 'a'.repeat(63) },
    { inputInjected: true },
    { foregroundMayChange: false },
  ]) {
    await assert.rejects(
      desktopCaptureWindow(target, async () => ({ ...receiptFor(), ...change })),
      (error) => ['INVALID_CAPTURE_RECEIPT', 'CAPTURE_TARGET_MISMATCH'].includes(error.code),
    );
  }
});

test('capture tool propagates runner failure once without retrying uncertain capture', async () => {
  let calls = 0;
  const failure = Object.assign(new Error('sanitized capture failure'), { code: 'CAPTURE_TIMEOUT' });
  await assert.rejects(
    desktopCaptureWindow(target, async () => {
      calls++;
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.equal(calls, 1);
});

test('capture tool snapshots request guards before awaiting the runner', async () => {
  const request = { ...target };
  const source = receiptFor();
  const result = await desktopCaptureWindow(request, async () => {
    request.pid++;
    request.requestId = 'other_request';
    return source;
  });
  assert.deepEqual(result, source);
});
