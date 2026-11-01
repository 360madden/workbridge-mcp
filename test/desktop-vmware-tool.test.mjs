import assert from 'node:assert/strict';
import test from 'node:test';
import { desktopCaptureVmware } from '../dist/desktop-vmware-tool.js';

const request = { pid: 1234, hwnd: 987654, requestId: 'worker4_test_001' };
const vmx = String.raw`C:\rift modding\VMs\RIFT-Lab\RIFT-Lab.vmx`;
const receipt = {
  ok: true,
  schemaVersion: 1,
  ...request,
  vmx,
  expectedClass: 'VMUIFrame',
  replayed: false,
  originalWindowState: 'minimized',
  finalWindowState: 'minimized',
  stateRecovery: 'minimized',
  guestInputInjected: false,
  vmrunPasswordUsed: false,
  startedUtc: '2026-10-26T12:00:00.000Z',
  completedUtc: '2026-10-26T12:00:01.000Z',
  imagePath: String.raw`C:\work\workbridge-mcp\.tools\desktop-evidence\capture-worker4_test_001.png`,
  width: 1215,
  height: 878,
  sizeBytes: 1520754,
  sha256: 'a'.repeat(64),
};

test('delegates only pinned script arguments and bounded execution options', async () => {
  const calls = [];
  const result = await desktopCaptureVmware(request, async (...args) => {
    calls.push(args);
    return { ...receipt, guestReceiverHealthy: true, privateDiagnostic: 'omit this' };
  });
  assert.deepEqual(calls, [
    [
      'vmware-host-capture.mjs',
      ['--pid', '1234', '--hwnd', '987654', '--request-id', request.requestId],
      { timeoutMs: 45_000, maxOutputBytes: 16_384 },
    ],
  ]);
  assert.deepEqual(result, receipt);
  assert.equal(Object.hasOwn(result, 'guestReceiverHealthy'), false);
  assert.equal(Object.hasOwn(result, 'privateDiagnostic'), false);
});

test('accepts verified visible state, already-minimized recovery, and exact replay evidence', async () => {
  for (const fields of [
    { originalWindowState: 'visible', finalWindowState: 'visible', stateRecovery: 'not-needed' },
    { stateRecovery: 'already-minimized' },
    { replayed: true },
  ]) {
    const expected = { ...receipt, ...fields };
    assert.deepEqual(await desktopCaptureVmware(request, async () => expected), expected);
  }
});

test('rejects malformed numeric target and durable ID before invoking the runner', async () => {
  let calls = 0;
  const runner = async () => {
    calls++;
    return receipt;
  };
  for (const badRequest of [
    null,
    undefined,
    {},
    ...[0, -1, 1.5, NaN, Infinity, '1234', 0x80000000, Number.MAX_SAFE_INTEGER + 1].map((pid) => ({
      ...request,
      pid,
    })),
    ...[0, -1, 1.5, NaN, Infinity, '987654', Number.MAX_SAFE_INTEGER + 1].map((hwnd) => ({
      ...request,
      hwnd,
    })),
  ]) {
    await assert.rejects(desktopCaptureVmware(badRequest, runner), { code: 'INVALID_TARGET' });
  }
  for (const requestId of [
    undefined,
    null,
    12345678,
    '',
    'short',
    '_invalid1',
    '-invalid1',
    '../invalid',
    'invalid id',
    'validid1\n',
    'a'.repeat(65),
  ]) {
    await assert.rejects(desktopCaptureVmware({ ...request, requestId }, runner), {
      code: 'INVALID_REQUEST_ID',
    });
  }
  assert.equal(calls, 0);
});

test('accepts parser boundary values without numeric rounding', async () => {
  const target = { pid: 0x7fffffff, hwnd: Number.MAX_SAFE_INTEGER, requestId: 'a'.repeat(64) };
  let args;
  const result = await desktopCaptureVmware(target, async (_script, observedArgs) => {
    args = observedArgs;
    return { ...receipt, ...target };
  });
  assert.equal(result.hwnd, Number.MAX_SAFE_INTEGER);
  assert.deepEqual(args, [
    '--pid',
    String(target.pid),
    '--hwnd',
    String(target.hwnd),
    '--request-id',
    target.requestId,
  ]);
  const shortest = { ...request, requestId: 'a1234567' };
  assert.equal(
    (await desktopCaptureVmware(shortest, async () => ({ ...receipt, ...shortest }))).requestId,
    shortest.requestId,
  );
});

test('refuses mismatched identities and uncertain or unsafe receipt claims', async () => {
  const invalid = [
    null,
    {},
    ...[
      { ok: false },
      { schemaVersion: 2 },
      { requestId: 'different_id' },
      { pid: request.pid + 1 },
      { pid: String(request.pid) },
      { hwnd: request.hwnd + 1 },
      { hwnd: String(request.hwnd) },
      { vmx: String.raw`C:\other\RIFT-Lab.vmx` },
      { expectedClass: 'OtherFrame' },
      { guestInputInjected: true },
      { guestInputInjected: undefined },
      { vmrunPasswordUsed: true },
      { replayed: undefined },
      { stateRecovery: 'requires-review' },
      { stateRecovery: 'pending' },
      { stateRecovery: 'uncertain' },
      { stateRecovery: undefined },
      { originalWindowState: 'visible' },
      { finalWindowState: 'visible' },
      { stateRecovery: 'not-needed' },
      { originalWindowState: 'unknown', finalWindowState: 'unknown' },
      { imagePath: '' },
      { imagePath: 'a'.repeat(4097) },
      { imagePath: 'bad\npath' },
      { imagePath: 'bad\0path' },
      { width: 0 },
      { height: 1.5 },
      { sizeBytes: -1 },
      { sha256: 'z'.repeat(64) },
      { sha256: 'a'.repeat(63) + '\n' },
      { startedUtc: undefined },
      { completedUtc: 'invalid' },
    ].map((fields) => ({ ...receipt, ...fields })),
  ];
  for (const result of invalid) {
    await assert.rejects(
      desktopCaptureVmware(request, async () => result),
      {
        code: 'INVALID_VMWARE_CAPTURE_RECEIPT',
      },
    );
  }
});

test('propagates sanitized runner failures without retrying an uncertain capture', async () => {
  const failure = Object.assign(new Error('Inspect saved intent'), { code: 'CAPTURE_RECOVERY_REQUIRED' });
  let calls = 0;
  await assert.rejects(
    desktopCaptureVmware(request, async () => {
      calls++;
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.equal(calls, 1);
});
