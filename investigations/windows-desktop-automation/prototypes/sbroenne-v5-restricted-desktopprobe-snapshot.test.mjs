import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { validateManifest, validateLease, projectSnapshot, structuralTree, receiptName, PilotError } from './sbroenne-v5-restricted-desktopprobe-snapshot.mjs';

const repo = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const root = path.join(repo, 'investigations', 'windows-desktop-automation', 'temp');
const runId = 'sbroenneaudit123';
const utcTicks = () => (BigInt(Date.now()) * 10000n + 621355968000000000n).toString();
const evidenceDir = path.join(root, 'desktopprobe-' + runId, 'evidence');
const manifestPath = path.join(evidenceDir, 'target-manifest.json');
function manifest() {
  return {
    schemaVersion: 1, runId, requestId: runId,
    leaseId: 'watchdoglease_100', ownerSid: 'S-1-5-21-100-200-300-1001',
    pid: 12468, startedAtUtcTicks: utcTicks(),
    sessionId: 2, hwnd: '778899', className: 'WindowsForms10.Window.8.app.0.abc',
    title: 'Workbridge GUI-004 Native Input Probe',
    exePath: path.join(root, 'desktopprobe-' + runId, 'publish', 'DesktopProbe.exe'),
    exeSha256: 'e'.repeat(64), foregroundHwnd: '778899', evidenceDir,
    observedAtUtc: new Date().toISOString(), watchdogPid: 12470,
    watchdogStartedAtUtcTicks: '639000000000000001',
    deadlineUtc: new Date(Date.now() + 100000).toISOString(), jobActiveAfterSpawn: 2
  };
}
function lock(m) {
  return {
    schemaVersion: 1, kind: 'workbridge.gui-turn',
    producer: 'desktopprobe-watchdog', runId: m.runId, requestId: m.requestId,
    leaseId: m.leaseId,
    owner: { pid: m.watchdogPid, processStartUtcTicks: m.watchdogStartedAtUtcTicks,
      sessionId: m.sessionId },
    target: { kind: 'window', pid: null, hwnd: null, process: 'DesktopProbe' }
  };
}

test('V5: accept fresh exact native fixture manifest and matching watchdog lease', () => {
  const m = manifest();
  const valid = validateManifest(m, m.requestId, manifestPath);
  assert.equal(valid.pid, m.pid);
  assert.equal(validateLease(lock(valid), valid), true);
});

test('reject non-DesktopProbe, stale, invalid foreground, foreign lock, and bad manifest identity', () => {
  const m = manifest();
  for (const altered of [
    { title: 'VMware' },
    { processStartedAtUtcTicks: null, startedAtUtcTicks: 123 },
    { foregroundHwnd: '0' },
    { startedAtUtcTicks: (BigInt(utcTicks()) - 660000000n).toString() },
    { observedAtUtc: new Date(Date.now() - 300000).toISOString() },
    { className: 'Chrome_WidgetWin_1' },
    { jobActiveAfterSpawn: 3 },
    { exePath: path.join(root, 'desktopprobe-' + runId, 'other', 'DesktopProbe.exe') },
    { evidenceDir: path.join(repo, '.tools', 'desktop-evidence') }
  ]) assert.throws(() => validateManifest({ ...m, ...altered }, m.requestId, manifestPath),
      (err) => err instanceof PilotError);
  assert.throws(() => validateManifest(m, 'different_01', manifestPath), PilotError);
  assert.equal(validateManifest({ ...m, foregroundHwnd: '778898' }, m.requestId, manifestPath).pid, m.pid);
  assert.throws(() => validateLease({ ...lock(m), producer: 'rift-capture' }, m), PilotError);
  assert.throws(() => validateLease({ ...lock(m), leaseId: 'other_lease_99' }, m), PilotError);
});

test('multiple distinct sample receipts share one immutable watchdog lease safely', () => {
  const m = manifest();
  const v = validateManifest(m, m.requestId, manifestPath);
  assert.equal(validateLease(lock(v), v), true);
  assert.notEqual(receiptName('trial_00000001'), receiptName('trial_00000002'));
  assert.equal(v.requestId, v.runId);
  for (const bad of ['../escape', 'a', 'sbroenne/x', '', null])
    assert.throws(() => receiptName(bad), PilotError);
});

test('project only bounded structural tree; sensitive text/name changes cannot alter structural digest', () => {
  const a = [{ id: 'sensitive', name: 'Secret Account', value: '1234', type: 'Window', enabled: true,
    children: [{ id: 'p1', name: 'PIN 4321', type: 'Button', enabled: true, automationId: 'IncrementButton' },
      { id: 'p2', name: 'Reset Label', type: 'Button', enabled: true, automationId: 'ResetButton' },
      { id: 'p3', name: 'Counter Label', type: 'Text', enabled: true, automationId: 'CounterDisplay' }] }];
  const b = [{ ...a[0], id: 'changed', name: 'Private Title', value: '9876',
    children: [{ ...a[0].children[0], name: 'Other PIN', id: 'changed' },
      a[0].children[1], a[0].children[2]] }];
  const first = structuralTree(a);
  const second = structuralTree(b);
  assert.deepEqual(first, second);
  assert.equal(first.nodes, 4);
  assert.equal(first.maxDepth, 1);
  assert.equal(typeof first.structuralSha256, 'string');
  assert.equal(JSON.stringify(first).includes('PIN'), false);
  const payload = { success: true, action: 'get_tree', kind: 'full', tree: a };
  const result = projectSnapshot({ isError: false, content: [{ type: 'text', text: JSON.stringify(payload) }] });
  assert.equal(result.nodes, 4);
  assert.equal(result.fixtureControlsVerified, true);
  assert.equal(Object.hasOwn(result, 'tree'), false);
  assert.equal(JSON.stringify(result).includes('Secret'), false);
});

test('MCP response rejects invalid tool status, diff, incomplete, oversized and deep trees', () => {
  const good = { success: true, action: 'get_tree', kind: 'full',
    tree: [{ type: 'Window', children: [
      { type: 'Button', automationId: 'IncrementButton' },
      { type: 'Button', automationId: 'ResetButton' },
      { type: 'Text', automationId: 'CounterDisplay' }
    ] }] };
  function call(v) { return projectSnapshot({ isError: false, content: [{ type: 'text', text: JSON.stringify(v) }] }); }
  assert.equal(call(good).nodes, 4);
  for (const bad of [
    { ...good, action: 'click' }, { ...good, kind: 'diff' },
    { ...good, snapshotIncomplete: true }, { ...good, tree: null },
    { ...good, tree: [{ type: 'Window', children: [
      { type: 'Button', automationId: 'IncrementButton' },
      { type: 'Button', automationId: 'IncrementButton' },
      { type: 'Button', automationId: 'ResetButton' },
      { type: 'Text', automationId: 'CounterDisplay' }] }] },
    { ...good, tree: [{ type: 'Window', children: [
      { type: 'Text', automationId: 'IncrementButton' },
      { type: 'Button', automationId: 'ResetButton' },
      { type: 'Text', automationId: 'CounterDisplay' }] }] },
    { ...good, tree: [{ type: 'Window', children: [{ type: 'Panel',
      children: [{ type: 'Button', children: [{ type: 'Text' }] }] }] }] }
  ]) assert.throws(() => call(bad), PilotError);
  assert.throws(() => projectSnapshot({ isError: true, content: [{ type: 'text',
    text: JSON.stringify(good) }] }), PilotError);
});


// Deliberately source-only: these tests never call main(), vendor process or UIA.
test('V5 source retains one explicit HWND snapshot and privacy gates', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(fileURLToPath(new URL('./sbroenne-v5-restricted-desktopprobe-snapshot.mjs', import.meta.url)), 'utf8');
  assert.equal(source.split('client.callTool(').length - 1, 1);
  for (const needle of ["name: 'ui_snapshot'", 'windowHandle: m.hwnd', "mode: 'full'",
      'includeDiagnostics: false', 'NATIVE_POWERSHELL', 'EXPECTED_MASK',
      'B_SNAPSHOT_BUDGET_INSUFFICIENT', 'assertLease(m, 40000)', "stage: 'dispatch-pending'"]) {
    assert.ok(source.includes(needle), 'missing immutable guard: ' + needle);
  }
  assert.ok(source.split('await audit.sync();').length - 1 >= 3, 'entered/pending/final fsync required');
  for (const forbidden of ["name: 'ui_click'", "name: 'ui_type'", "name: 'ui_read'"]) {
    assert.ok(!source.includes(forbidden), 'unexpected extra MCP tool dispatch');
  }
});
