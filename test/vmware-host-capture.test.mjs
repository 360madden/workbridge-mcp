import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertSystemButton,
  assertVmAndWindow,
  captureVmwareHostOnce,
  parseVmwareCaptureRequest,
} from '../scripts/vmware-host-capture.mjs';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1sAAAAASUVORK5CYII=',
  'base64',
);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const PID = 9476;
const HWND = 2230572;
const request = parseVmwareCaptureRequest([
  '--pid',
  String(PID),
  '--hwnd',
  String(HWND),
  '--request-id',
  'vmware_test_001',
]);

function makeHarness({ minimized = true, running = true, foreground = true, restoreButton = true } = {}) {
  const calls = [];
  const counters = { capture: 0, restore: 0, minimize: 0, list: 0 };
  const state = { minimized, foreground, restoreButton };
  const runner = async (args) => {
    calls.push(args.join(' '));
    if (args[0] === '--version') return 'winapp 0.7.1';
    if (args[0] === 'ui' && args[1] === 'list-windows') {
      return JSON.stringify([
        {
          hwnd: HWND,
          processId: PID,
          processName: 'vmware',
          title: 'RIFT-Lab-1 - VMware Workstation',
          className: 'VMUIFrame',
          width: state.minimized ? 160 : 1229,
          height: state.minimized ? 28 : 885,
          isForeground: state.foreground,
        },
      ]);
    }
    if (args[0] === 'ui' && args[1] === 'inspect') {
      const children = state.restoreButton
        ? [
            {
              type: 'TitleBar',
              children: [
                {
                  type: 'Button',
                  selector: 'Minimize-Restore',
                  name: state.minimized ? 'Restore' : 'Minimize',
                  isEnabled: true,
                  isInvokable: true,
                },
              ],
            },
          ]
        : [];
      return JSON.stringify({
        windows: [
          {
            hwnd: HWND,
            elements: [
              {
                type: 'Window',
                className: 'VMUIFrame',
                x: state.minimized ? -32000 : 55,
                y: state.minimized ? -32000 : 45,
                width: state.minimized ? 160 : 1229,
                height: state.minimized ? 28 : 885,
                isOffscreen: state.minimized,
                children,
              },
            ],
          },
        ],
      });
    }
    if (args[0] === 'ui' && args[1] === 'invoke') {
      if (state.minimized) counters.restore++;
      else counters.minimize++;
      state.minimized = !state.minimized;
      return JSON.stringify({ hwnd: HWND, performedAction: 'invoke' });
    }
    throw new Error('Unexpected WinApp args: ' + args.join(' '));
  };
  const vmLister = async () => {
    counters.list++;
    return running ? [request.vmx] : [];
  };
  const capture = async () => {
    counters.capture++;
    return {
      imagePath: 'fake-verified-image.png',
      width: 1215,
      height: 878,
      sizeBytes: 1000000,
      sha256: 'f'.repeat(64),
    };
  };
  return { calls, counters, state, runner, vmLister, capture };
}

async function withEvidence(t) {
  const evidenceRoot = await mkdtemp(path.join(os.tmpdir(), 'workbridge-vm-host-capture-'));
  t.after(() => rm(evidenceRoot, { recursive: true, force: true }));
  return evidenceRoot;
}

test('parser only accepts pinned PID/HWND arguments and durable capture ID', () => {
  assert.equal(request.target.pid, PID);
  assert.equal(request.target.hwnd, HWND);
  assert.equal(request.expectedClass, 'VMUIFrame');
  assert.throws(() => parseVmwareCaptureRequest(['--pid', '12', '--hwnd', '34']), {
    code: 'INVALID_REQUEST_ID',
  });
  assert.throws(
    () => parseVmwareCaptureRequest(['--pid', 'x', '--hwnd', '34', '--request-id', 'validid_1']),
    { code: 'INVALID_TARGET' },
  );
  assert.throws(
    () =>
      parseVmwareCaptureRequest([
        '--pid',
        '12',
        '--hwnd',
        '34',
        '--request-id',
        'validid_1',
        '--guest-input',
      ]),
    { code: 'INVALID_ARGUMENTS' },
  );
});

test('minimized VM restores for capture then returns to original minimized state', async (t) => {
  const evidenceRoot = await withEvidence(t);
  const h = makeHarness();
  h.capture = async (captureRequest, { evidenceRoot: outputRoot }) => {
    h.counters.capture++;
    const imagePath = path.join(outputRoot, 'capture-' + captureRequest.requestId + '.png');
    await writeFile(imagePath, PNG);
    const evidence = {
      imagePath,
      width: 1,
      height: 1,
      sizeBytes: PNG.length,
      sha256: digest(PNG),
    };
    await writeFile(
      path.join(outputRoot, 'capture-' + captureRequest.requestId + '.json'),
      JSON.stringify({
        schemaVersion: 1,
        requestId: captureRequest.requestId,
        pid: captureRequest.target.pid,
        hwnd: captureRequest.target.hwnd,
        process: captureRequest.target.process,
        title: captureRequest.target.title,
        expectedClass: captureRequest.expectedClass,
        capturedUtc: new Date().toISOString(),
        ...evidence,
        inputInjected: false,
        foregroundMayChange: true,
      }) + '\n',
    );
    return evidence;
  };
  const receipt = await captureVmwareHostOnce(request, { ...h, evidenceRoot });
  assert.equal(receipt.ok, true);
  assert.equal(receipt.replayed, false);
  assert.equal(receipt.originalWindowState, 'minimized');
  assert.equal(receipt.finalWindowState, 'minimized');
  assert.equal(receipt.stateRecovery, 'minimized');
  assert.equal(receipt.guestInputInjected, false);
  assert.equal(receipt.vmrunPasswordUsed, false);
  assert.equal(h.state.minimized, true);
  assert.deepEqual(h.counters, { capture: 1, restore: 1, minimize: 1, list: 1 });
  const persisted = JSON.parse(
    await readFile(path.join(evidenceRoot, 'vm-host-capture-vmware_test_001.json'), 'utf8'),
  );
  assert.equal(persisted.sha256, digest(PNG));
  assert.ok(!(await readdir(evidenceRoot)).includes('desktop-input-turn.lock'));

  const again = await captureVmwareHostOnce(request, { ...h, evidenceRoot });
  assert.equal(again.replayed, true);
  assert.deepEqual(
    h.counters,
    { capture: 1, restore: 1, minimize: 1, list: 1 },
    'replay verifies evidence without a fresh capture, UI action, or VM inventory',
  );
  const aggregatePath = path.join(evidenceRoot, 'vm-host-capture-' + request.requestId + '.json');
  await writeFile(aggregatePath, JSON.stringify({ ...persisted, stateRecovery: 'requires-review' }) + '\n');
  await assert.rejects(captureVmwareHostOnce(request, { ...h, evidenceRoot }), {
    code: 'CAPTURE_RECOVERY_REQUIRED',
  });
  await writeFile(aggregatePath, JSON.stringify(persisted) + '\n');
  await writeFile(path.join(evidenceRoot, 'capture-' + request.requestId + '.png'), 'tampered-image');
  await assert.rejects(captureVmwareHostOnce(request, { ...h, evidenceRoot }), {
    code: 'CAPTURE_RECOVERY_REQUIRED',
  });
  assert.equal(h.counters.capture, 1, 'tampered replay never captures again');
});

test('already visible VMware window is captured without an unwanted minimize', async (t) => {
  const evidenceRoot = await withEvidence(t);
  const h = makeHarness({ minimized: false });
  const receipt = await captureVmwareHostOnce(request, { ...h, evidenceRoot });
  assert.equal(receipt.finalWindowState, 'visible');
  assert.equal(receipt.stateRecovery, 'not-needed');
  assert.deepEqual(h.counters, { capture: 1, restore: 0, minimize: 0, list: 1 });
  assert.equal(h.state.minimized, false);
});

test('wrong running VM inventory is refused before WinApp interaction', async (t) => {
  const evidenceRoot = await withEvidence(t);
  const h = makeHarness({ running: false });
  await assert.rejects(captureVmwareHostOnce(request, { ...h, evidenceRoot }), { code: 'VM_NOT_RUNNING' });
  assert.deepEqual(h.counters, { capture: 0, restore: 0, minimize: 0, list: 1 });
  assert.equal(h.calls.length, 3, 'read-only inspect is acceptable but no desktop mutation');
});

test('unverified titlebar control cannot change window and leaves an inspectable intent', async (t) => {
  const evidenceRoot = await withEvidence(t);
  const h = makeHarness({ restoreButton: false });
  await assert.rejects(captureVmwareHostOnce(request, { ...h, evidenceRoot }), {
    code: 'CAPTURE_RECOVERY_REQUIRED',
  });
  assert.equal(h.state.minimized, true);
  assert.equal(h.counters.restore, 0);
  assert.equal(h.counters.capture, 0);
  assert.ok((await readdir(evidenceRoot)).includes('vm-host-capture-vmware_test_001.intent.json'));
  assert.ok((await readdir(evidenceRoot)).includes('desktop-input-turn.lock'));
  const intentBytes = await readFile(
    path.join(evidenceRoot, 'vm-host-capture-' + request.requestId + '.intent.json'),
  );
  const ownerBytes = await readFile(path.join(evidenceRoot, 'desktop-input-turn.lock'));
  const intent = JSON.parse(intentBytes.toString('utf8'));
  const owner = JSON.parse(ownerBytes.toString('utf8'));
  assert.equal(owner.kind, 'workbridge.gui-turn');
  assert.equal(owner.producer, 'vmware-host-capture');
  assert.equal(owner.requestId, request.requestId);
  assert.equal(owner.target.kind, 'vmware-host-window');
  assert.equal(owner.target.pid, PID);
  assert.equal(owner.target.hwnd, HWND);
  assert.equal(owner.target.vmx, request.vmx);
  assert.equal(intent.leaseId, owner.leaseId);
  const quarantine = JSON.parse(
    await readFile(path.join(evidenceRoot, 'desktop-turn-quarantine-' + owner.leaseId + '.json'), 'utf8'),
  );
  assert.equal(quarantine.kind, 'workbridge.gui-turn-quarantine');
  assert.equal(quarantine.ownerStampSha256, digest(ownerBytes));
  assert.equal(quarantine.intentSha256, digest(intentBytes));
  assert.equal(quarantine.automaticRetryAllowed, false);
  await assert.rejects(captureVmwareHostOnce(request, { ...h, evidenceRoot }), {
    code: 'UI_TURN_BUSY',
  });
  assert.equal(h.counters.list, 1, 'quarantined lease prevents retries without review');
});

test('VMware host sidecar seal failure keeps the owner lock and blocks another request', async (t) => {
  const evidenceRoot = await withEvidence(t);
  const h = makeHarness();
  let sidecar;
  const runner = async (args) => {
    if (args[0] === 'ui' && args[1] === 'invoke') {
      const owner = JSON.parse(await readFile(path.join(evidenceRoot, 'desktop-input-turn.lock'), 'utf8'));
      sidecar = path.join(evidenceRoot, 'desktop-turn-quarantine-' + owner.leaseId + '.json');
      await writeFile(sidecar, 'foreign-sidecar', { flag: 'wx' });
      throw new Error('Synthetic WinApp failure after capture intent');
    }
    return h.runner(args);
  };
  await assert.rejects(captureVmwareHostOnce(request, { ...h, evidenceRoot, runner }), {
    code: 'CAPTURE_RECOVERY_REQUIRED',
  });
  const lockBytes = await readFile(path.join(evidenceRoot, 'desktop-input-turn.lock'));
  assert.equal(JSON.parse(lockBytes.toString('utf8')).producer, 'vmware-host-capture');
  assert.equal(await readFile(sidecar, 'utf8'), 'foreign-sidecar');
  const otherRequest = parseVmwareCaptureRequest([
    '--pid',
    String(PID),
    '--hwnd',
    String(HWND),
    '--request-id',
    'vmware_second_002',
  ]);
  await assert.rejects(captureVmwareHostOnce(otherRequest, { ...h, evidenceRoot, runner }), {
    code: 'UI_TURN_BUSY',
  });
  assert.equal(h.counters.list, 1, 'second request never probes VMware');
});

test('an existing shared desktop-input lease blocks all further action', async (t) => {
  const evidenceRoot = await withEvidence(t);
  const lock = path.join(evidenceRoot, 'desktop-input-turn.lock');
  await writeFile(lock, 'someone-else-owns-this');
  const h = makeHarness();
  await assert.rejects(captureVmwareHostOnce(request, { ...h, evidenceRoot }), { code: 'UI_TURN_BUSY' });
  assert.deepEqual(h.counters, { capture: 0, restore: 0, minimize: 0, list: 0 });
  assert.deepEqual(h.calls, []);
});

test('changed foreground prevents accidental minimization of a user-owned window', async (t) => {
  const evidenceRoot = await withEvidence(t);
  const h = makeHarness();
  const underlyingCapture = h.capture;
  h.capture = async (...args) => {
    const result = await underlyingCapture(...args);
    h.state.foreground = false;
    return result;
  };
  await assert.rejects(captureVmwareHostOnce(request, { ...h, evidenceRoot }), {
    code: 'CAPTURE_RECOVERY_REQUIRED',
  });
  assert.equal(h.counters.capture, 1);
  assert.equal(h.counters.minimize, 0);
  assert.equal(h.state.minimized, false);
  assert.ok((await readdir(evidenceRoot)).includes('vm-host-capture-vmware_test_001.intent.json'));
});

test('existing aggregate without inner evidence cannot trigger a fresh capture', async (t) => {
  const evidenceRoot = await withEvidence(t);
  const h = makeHarness({ minimized: false });
  await captureVmwareHostOnce(request, { ...h, evidenceRoot });
  await assert.rejects(captureVmwareHostOnce(request, { ...h, evidenceRoot }), {
    code: 'CAPTURE_RECOVERY_REQUIRED',
  });
  assert.deepEqual(h.counters, { capture: 1, restore: 0, minimize: 0, list: 1 });
});

test('invalid persisted receipts and orphan images fail before VMware access', async (t) => {
  for (const [name, value] of [
    ['vm-host-capture-' + request.requestId + '.json', 'null\n'],
    ['vm-host-capture-' + request.requestId + '.intent.json', 'false\n'],
    ['capture-' + request.requestId + '.png', 'orphan'],
  ]) {
    const evidenceRoot = await withEvidence(t);
    await writeFile(path.join(evidenceRoot, name), value);
    const h = makeHarness();
    await assert.rejects(captureVmwareHostOnce(request, { ...h, evidenceRoot }), {
      code: 'CAPTURE_RECOVERY_REQUIRED',
    });
    assert.deepEqual(h.counters, { capture: 0, restore: 0, minimize: 0, list: 0 });
    assert.deepEqual(h.calls, []);
  }
});

test('identity and window geometry are strictly validated', () => {
  const h = makeHarness();
  const win = {
    pid: PID,
    hwnd: HWND,
    process: 'vmware',
    title: 'RIFT-Lab-1 - VMware Workstation',
    className: 'VMUIFrame',
    width: 160,
    height: 28,
  };
  const root = {
    type: 'Window',
    className: 'VMUIFrame',
    isOffscreen: true,
    width: 160,
    height: 28,
    children: [
      { type: 'Button', selector: 'Minimize-Restore', name: 'Restore', isEnabled: true, isInvokable: true },
    ],
  };
  const valid = { readOnly: true, target: win, tree: { windows: [{ hwnd: HWND, elements: [root] }] } };
  assert.equal(assertVmAndWindow(request, [request.vmx], valid).state, 'minimized');
  assert.equal(assertSystemButton(valid, 'Restore').name, 'Restore');
  assert.throws(
    () =>
      assertVmAndWindow(request, [request.vmx], {
        ...valid,
        target: { ...win, title: 'Different window' },
      }),
    { code: 'STALE_VM_WINDOW' },
  );
  assert.throws(
    () =>
      assertVmAndWindow(request, [request.vmx], {
        ...valid,
        target: { ...win, width: 320, height: 200 },
      }),
    { code: 'TARGET_NOT_VISIBLE' },
  );
  assert.ok(h);
});
