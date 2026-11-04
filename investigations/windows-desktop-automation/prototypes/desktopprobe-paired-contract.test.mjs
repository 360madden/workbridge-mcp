// Source-only cross-provider contract tests. No GUI, process, daemon, input or screenshot.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateManifest as winManifest, validateLease as winLease,
  projectTree as winTree,
} from './winapp-desktopprobe-sample.mjs';
import {
  validateManifest as sbManifest, validateLease as sbLease,
  projectSnapshot as sbSnapshot, receiptName,
} from './sbroenne-desktopprobe-sample.mjs';

const repo = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const temp = path.join(repo, 'investigations', 'windows-desktop-automation', 'temp');
const nowTicks = () => (621355968000000000n + BigInt(Date.now()) * 10000n).toString();

function target() {
  const runId = 'paired-20261104-01';
  const evidenceDir = path.join(temp, 'desktopprobe-' + runId, 'evidence');
  return {
    schemaVersion: 1, runId, requestId: runId, leaseId: 'watchdoglease-01',
    watchdogPid: 21002, watchdogStartedAtUtcTicks: nowTicks(),
    pid: 21003, startedAtUtcTicks: nowTicks(), sessionId: 2,
    ownerSid: 'S-1-5-21-100-200-300-1001',
    hwnd: '778899', foregroundHwnd: '778898',
    className: 'WindowsForms10.Window.8.app.0.paired',
    title: 'Workbridge GUI-004 Native Input Probe',
    exePath: path.join(temp, 'desktopprobe-' + runId, 'publish', 'DesktopProbe.exe'),
    exeSha256: 'a'.repeat(64), evidenceDir,
    observedAtUtc: new Date().toISOString(),
    deadlineUtc: new Date(Date.now() + 85_000).toISOString(),
    jobActiveAfterSpawn: 2,
  };
}
const manifestPath = (t) => path.join(t.evidenceDir, 'target-manifest.json');
function lease(t) {
  return {
    schemaVersion: 1, kind: 'workbridge.gui-turn', producer: 'desktopprobe-watchdog',
    runId: t.runId, requestId: t.requestId, leaseId: t.leaseId,
    owner: { pid: t.watchdogPid, processStartUtcTicks: t.watchdogStartedAtUtcTicks, sessionId: t.sessionId },
    target: { kind: 'window', pid: null, hwnd: null, process: 'DesktopProbe' },
  };
}
function bothAccept(t) {
  assert.equal(winManifest(t).pid, t.pid);
  assert.equal(sbManifest(t, t.requestId, manifestPath(t)).pid, t.pid);
}
function bothReject(t) {
  assert.throws(() => winManifest(t));
  assert.throws(() => sbManifest(t, t.requestId, manifestPath(t)));
}
const controls = [
  { id: 'IncrementButton', type: 'Button' },
  { id: 'ResetButton', type: 'Button' },
  { id: 'CounterDisplay', type: 'Text' },
];
const winPayload = (items) => ({ windows: [{ elements: [{
  type: 'Window', children: items.map((item) => ({
    type: item.type, selector: item.id, children: [],
  })),
}] }] });
const sbPayload = (items) => ({
  isError: false,
  content: [{ type: 'text', text: JSON.stringify({
    success: true, action: 'get_tree', kind: 'full', snapshotIncomplete: false,
    tree: [{ type: 'Window', children: items.map((item) => ({
      id: 'private-' + item.id, type: item.type, automationId: item.id,
    })) }],
  }) }],
});

test('canonical native manifest accepted by both with arbitrary stable foreground', () => {
  const t = target();
  assert.notEqual(t.hwnd, t.foregroundHwnd);
  bothAccept(t);
  assert.equal(winLease(lease(t), t).producer, 'desktopprobe-watchdog');
  assert.equal(sbLease(lease(t), t), true);
});

test('both reject identical deadline, stale process and foreign identity', () => {
  const t = target();
  bothReject({ ...t, deadlineUtc: new Date(Date.now() + 10_000).toISOString() });
  bothReject({ ...t, startedAtUtcTicks: '630000000000000000' });
  bothReject({ ...t, ownerSid: 'invalid' });
  bothReject({ ...t, title: 'Other window' });
  const bad = { ...lease(t), producer: 'other-owner' };
  assert.throws(() => winLease(bad, t));
  assert.throws(() => sbLease(bad, t));
});

test('separate B sample IDs preserve immutable watchdog request and never alias receipts', () => {
  const t = target();
  bothAccept(t);
  assert.equal(t.requestId, t.runId);
  const first = receiptName('sample-001');
  const second = receiptName('sample-002');
  assert.notEqual(first, second);
  assert.throws(() => receiptName('../shared-lease'));
});

test('three typed fixture controls exactly once for both providers', () => {
  assert.equal(winTree(winPayload(controls), 128).fixtureControlsVerified, true);
  assert.equal(sbSnapshot(sbPayload(controls)).fixtureControlsVerified, true);
  const duplicate = controls.concat(controls[0]);
  assert.throws(() => winTree(winPayload(duplicate), 128));
  assert.throws(() => sbSnapshot(sbPayload(duplicate)));
  const wrongType = controls.map((c) => c.id === 'ResetButton' ? { ...c, type: 'Text' } : c);
  assert.throws(() => winTree(winPayload(wrongType), 128));
  assert.throws(() => sbSnapshot(sbPayload(wrongType)));
});
