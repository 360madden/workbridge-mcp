import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, stat, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  acquireDesktopAdmission,
  acquireDesktopMaintenanceAdmission,
  desktopAdmissionPath,
  releaseDesktopAdmission,
  withDesktopAdmission,
} from '../scripts/desktop-turn-admission.mjs';
import { invokeProbeOnce } from '../scripts/desktop-probe-act.mjs';
import { captureVmwareHostOnce, parseVmwareCaptureRequest } from '../scripts/vmware-host-capture.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wb-admission-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, guiLock: path.join(root, 'desktop-input-turn.lock') };
}

const producer = { producer: 'desktop-probe-action', requestId: 'admission_probe_001' };

test('maintenance and producer use one atomic admission; neither can overtake the other', async (t) => {
  const { guiLock } = await fixture(t);
  const lease = await acquireDesktopMaintenanceAdmission(guiLock, 'maintenance_test_001');
  assert.equal(JSON.parse(await readFile(desktopAdmissionPath(guiLock), 'utf8')).mode, 'maintenance');
  await assert.rejects(acquireDesktopAdmission(guiLock, producer), { code: 'UI_TURN_BUSY' });
  await assert.rejects(acquireDesktopMaintenanceAdmission(guiLock, 'maintenance_test_002'), {
    code: 'UI_TURN_BUSY',
  });
  await releaseDesktopAdmission(lease);
  await assert.rejects(stat(desktopAdmissionPath(guiLock)), { code: 'ENOENT' });
  const newLease = await acquireDesktopAdmission(guiLock, producer);
  await assert.rejects(acquireDesktopMaintenanceAdmission(guiLock, 'maintenance_test_003'), {
    code: 'UI_TURN_BUSY',
  });
  await releaseDesktopAdmission(newLease);
});

test('admission protects foreign and rewritten ownership without auto-cleanup', async (t) => {
  const { guiLock } = await fixture(t);
  const first = await acquireDesktopAdmission(guiLock, producer);
  const filename = desktopAdmissionPath(guiLock);
  await writeFile(filename, 'a foreign or damaged admission stamp');
  await assert.rejects(releaseDesktopAdmission(first), { code: 'UI_TURN_RECOVERY_REQUIRED' });
  assert.equal(await readFile(filename, 'utf8'), 'a foreign or damaged admission stamp');
  await assert.rejects(acquireDesktopMaintenanceAdmission(guiLock, 'maintenance_test_004'), {
    code: 'UI_TURN_BUSY',
  });
  await assert.rejects(releaseDesktopAdmission({ ...first }), { code: 'UI_TURN_RECOVERY_REQUIRED' });
});

test('callback errors release a still-owned admission without masking the original exception', async (t) => {
  const { guiLock } = await fixture(t);
  const sentinel = new Error('synthetic preflight failure');
  await assert.rejects(
    withDesktopAdmission(guiLock, producer, async () => {
      throw sentinel;
    }),
    (error) => error === sentinel,
  );
  await assert.rejects(stat(desktopAdmissionPath(guiLock)), { code: 'ENOENT' });
});

test('maintenance blocks both direct script GUI producers before any runner or VM inventory', async (t) => {
  const { root, guiLock } = await fixture(t);
  const lease = await acquireDesktopMaintenanceAdmission(guiLock, 'maintenance_test_005');
  let runnerCalls = 0;
  const request = parseVmwareCaptureRequest([
    '--pid',
    '9476',
    '--hwnd',
    '2230572',
    '--request-id',
    'maintenance_vm_001',
  ]);
  await assert.rejects(
    captureVmwareHostOnce(request, {
      evidenceRoot: root,
      runner: async () => {
        runnerCalls++;
        throw new Error('unexpected GUI call');
      },
      vmLister: async () => {
        runnerCalls++;
        throw new Error('unexpected VM inventory');
      },
    }),
    { code: 'UI_TURN_BUSY' },
  );
  await assert.rejects(
    invokeProbeOnce(
      { requestId: 'maintenance_probe_001' },
      {
        root,
        runner: async () => {
          runnerCalls++;
          throw new Error('unexpected GUI call');
        },
      },
    ),
    { code: 'UI_TURN_BUSY' },
  );
  assert.equal(runnerCalls, 0);
  await releaseDesktopAdmission(lease);
});

test('canonical absolute GUI turn lock is required; abandoned admission never expires automatically', async (t) => {
  assert.throws(() => desktopAdmissionPath('../relative/desktop-input-turn.lock'), {
    code: 'UI_TURN_RECOVERY_REQUIRED',
  });
  const { guiLock } = await fixture(t);
  const filename = desktopAdmissionPath(guiLock);
  await writeFile(filename, 'abandoned-stamp');
  await assert.rejects(acquireDesktopAdmission(guiLock, producer), { code: 'UI_TURN_BUSY' });
  assert.equal(await readFile(filename, 'utf8'), 'abandoned-stamp');
});

// O_EXCL must arbitrate simultaneous contenders without a check-then-create gap.
test('simultaneous producer acquisition admits exactly one lease', async (t) => {
  const { guiLock } = await fixture(t);
  const contenders = await Promise.allSettled([
    acquireDesktopAdmission(guiLock, producer),
    acquireDesktopAdmission(guiLock, { producer: 'vmware-host-capture', requestId: 'admission_vm_002' }),
  ]);
  const fulfilled = contenders.filter((item) => item.status === 'fulfilled');
  const rejected = contenders.filter((item) => item.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, 'UI_TURN_BUSY');
  await releaseDesktopAdmission(fulfilled[0].value);
});
