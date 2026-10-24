import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(root, '../scripts/Inspect-DesktopVm.ps1');

function inventory(extra = []) {
  const completed = spawnSync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script, ...extra],
    { encoding: 'utf8', timeout: 15000 },
  );
  assert.equal(completed.error, undefined);
  assert.equal(completed.status, 0, completed.stderr);
  return JSON.parse(completed.stdout.trim());
}

test('GUI-001 inventory has stable read-only schema and no guest listing by default', () => {
  if (process.platform !== 'win32') return;
  const report = inventory();
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.readOnly, true);
  assert.equal(report.inputTested, false);
  assert.equal(report.captureTested, false);
  assert.ok(Number.isInteger(report.session.id));
  assert.equal(typeof report.session.userInteractive, 'boolean');
  assert.equal(typeof report.winapp.available, 'boolean');
  assert.equal(report.vmware.inventoryRequested, false);
  assert.deepEqual(report.vmware.runningVmPaths, []);
  assert.ok(Array.isArray(report.vmware.processes));
  for (const process of report.vmware.processes) {
    assert.ok(['vmware', 'vmware-vmx'].includes(process.name));
    assert.ok(Number.isInteger(process.pid));
    assert.ok(Number.isInteger(process.sessionId));
  }
});

test('GUI-001 optional VMware enumeration reports status without changing VM state', () => {
  if (process.platform !== 'win32') return;
  const report = inventory(['-IncludeRunningVMs']);
  assert.equal(report.readOnly, true);
  assert.equal(report.vmware.inventoryRequested, true);
  assert.ok(Array.isArray(report.vmware.runningVmPaths));
  if (report.vmware.vmrunPath === null) {
    assert.equal(report.vmware.vmrunError, 'VMRUN_NOT_INSTALLED');
  } else if (report.vmware.vmrunError === null) {
    assert.equal(report.vmware.vmrunExitCode, 0);
    assert.ok(report.vmware.runningVmPaths.every((value) => /\.vmx$/i.test(value)));
  } else {
    assert.ok(['VMRUN_LIST_FAILED', 'VMRUN_LAUNCH_FAILED'].includes(report.vmware.vmrunError));
  }
});
