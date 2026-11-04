// Offline synthetic tests only; no process, GUI, CLI, daemon, screenshot or VM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseArgs, validateManifest, validateLease, validateObserver, sameOracle,
  projectTree, sample,
} from './winapp-desktopprobe-sample.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const temp = join(repo, 'investigations', 'windows-desktop-automation', 'temp');
const tickNow = () => (621355968000000000n + BigInt(Date.now()) * 10000n).toString();

function target() {
  const runId = '20261104-pilot';
  return {
    schemaVersion: 1, runId, requestId: 'request-001', leaseId: 'lease-001',
    watchdogPid: 456, watchdogStartedAtUtcTicks: tickNow(),
    pid: 321, hwnd: '1234', startedAtUtcTicks: tickNow(), sessionId: 2,
    ownerSid: 'S-1-5-21-123-456-789-1001',
    title: 'Workbridge GUI-004 Native Input Probe',
    className: 'WindowsForms10.Window.8.app.0.sample',
    foregroundHwnd: '1234',
    exePath: join(temp, 'desktopprobe-' + runId, 'publish', 'DesktopProbe.exe'),
    exeSha256: 'a'.repeat(64),
    evidenceDir: join(temp, 'desktopprobe-' + runId, 'evidence'),
  };
}
function lease(t) {
  return {
    schemaVersion: 1, kind: 'workbridge.gui-turn', producer: 'desktopprobe-watchdog',
    runId: t.runId, requestId: t.requestId, leaseId: t.leaseId,
    owner: { pid: t.watchdogPid, processStartUtcTicks: t.watchdogStartedAtUtcTicks, sessionId: t.sessionId },
    target: { kind: 'window', pid: null, hwnd: null, process: 'DesktopProbe' },
  };
}
function observer(t) {
  return {
    schemaVersion: 1, verified: true, pid: t.pid,
    startedAtUtcTicks: t.startedAtUtcTicks, sessionId: t.sessionId,
    ownerSidVerified: true, hwnd: t.hwnd, rootHwnd: t.hwnd, ownerHwnd: '0',
    className: t.className, foregroundHwnd: t.foregroundHwnd,
    windowStation: 'WinSta0', desktopName: 'Default',
    rect: { left: 100, top: 120, right: 800, bottom: 530, width: 700, height: 410 },
    journal: { eventCount: 2, shown: true, counter: 0, unexpectedInputEvents: 0, sha256: 'b'.repeat(64) },
  };
}
function fakeWinapp(t, received) {
  return async (args) => {
    received.push(args.join(' '));
    if (args[0] === '--version') return 'Microsoft WinApp CLI 0.7.1\n';
    if (args[1] === 'list-windows') {
      return JSON.stringify([{
        hwnd: Number(t.hwnd), processId: t.pid, processName: 'DesktopProbe',
        title: t.title, className: t.className, width: 700, height: 410, isForeground: true,
      }]);
    }
    if (args[1] === 'inspect') {
      return JSON.stringify({ windows: [{
        hwnd: Number(t.hwnd),
        elements: [{ type: 'Window', name: 'private label', children: [
          { type: 'Button', selector: 'IncrementButton', name: 'private increment', children: [] },
          { type: 'Button', selector: 'ResetButton', name: 'private reset', children: [] },
          { type: 'Text', selector: 'CounterDisplay', name: 'private counter', children: [] },
        ] }],
      }] });
    }
    throw Error('Unexpected test command');
  };
}

test('arguments and manifest reject ambiguous or stale target', () => {
  assert.deepEqual(parseArgs(['--target', 'x', '--sample-id', 'sample-001']), { targetPath: 'x', sampleId: 'sample-001' });
  assert.throws(() => parseArgs(['--target', 'x', '--sample-id', 'x']), /INVALID_ARGUMENTS/);
  assert.equal(validateManifest(target()).pid, 321);
  const wrongDir = target(); wrongDir.evidenceDir = 'C:\\other\\DesktopProbe';
  assert.throws(() => validateManifest(wrongDir), /WRONG_EVIDENCE_DIRECTORY/);
  const stale = target(); stale.startedAtUtcTicks = '630000000000000000';
  assert.throws(() => validateManifest(stale), /PROBE_OUTSIDE_WATCHDOG_BUDGET/);
});

test('exact private watchdog lease only', () => {
  const t = target();
  assert.equal(validateLease(lease(t), t).producer, 'desktopprobe-watchdog');
  const foreign = lease(t); foreign.producer = 'rift-capture';
  assert.throws(() => validateLease(foreign, t), /WATCHDOG_LEASE_MISMATCH/);
  const stale = lease(t); stale.owner.processStartUtcTicks = '630000000000000000';
  assert.throws(() => validateLease(stale, t), /WATCHDOG_LEASE_MISMATCH/);
});

test('native oracle rejects changed journal, foreground or process identity', () => {
  const t = target();
  const a = observer(t);
  assert.equal(validateObserver(a, t).verified, true);
  assert.equal(sameOracle(a, observer(t)), true);
  const changed = structuredClone(a); changed.journal.sha256 = 'f'.repeat(64);
  assert.throws(() => sameOracle(a, changed), /OBSERVED_STATE_CHANGED/);
  const wrong = structuredClone(a); wrong.foregroundHwnd = '999';
  assert.throws(() => validateObserver(wrong, t), /INDEPENDENT_IDENTITY_FAILED/);
  const wrongSid = structuredClone(a); wrongSid.ownerSidVerified = false;
  assert.throws(() => validateObserver(wrongSid, t), /INDEPENDENT_IDENTITY_FAILED/);
});

test('structural projection excludes private UI text', () => {
  const make = (name) => ({ windows: [{ elements: [{ type: 'Window', name, children: [
    { type: 'Button', selector: 'IncrementButton', name, children: [] },
    { type: 'Button', selector: 'ResetButton', name, children: [] },
    { type: 'Text', selector: 'CounterDisplay', name, children: [] },
  ] }] }] });
  const a = projectTree(make('Secret A'), 120);
  const b = projectTree(make('Secret B'), 120);
  assert.equal(a.nodes, 4);
  assert.equal(a.maxDepth, 1);
  assert.equal(a.structuralSha256, b.structuralSha256);
});

test('one synthetic WinApp sample contains 3 expected readonly verbs and independent before/after', async () => {
  const t = target();
  const commands = [];
  let observations = 0, leases = 0;
  const got = await sample(t, 'sample-001', {
    confirmLease: async () => { leases += 1; },
    observe: async () => { observations += 1; return observer(t); },
    runWinapp: fakeWinapp(t, commands),
  });
  assert.equal(got.result, 'success');
  assert.equal(got.tree.nodes, 4);
  assert.equal(got.tree.fixtureControlsVerified, true);
  assert.equal(got.actualInputActions, 0);
  assert.equal(got.screenshots, 0);
  assert.equal(observations, 2);
  assert.equal(leases, 2);
  assert.equal(commands.length, 3);
  assert.equal(commands[0], '--version');
  assert.match(commands[1], /ui list-windows/);
  assert.match(commands[2], /ui inspect/);
});

test('a changed after-state fails closed even when provider reported success', async () => {
  const t = target();
  let reads = 0;
  const got = await sample(t, 'sample-002', {
    confirmLease: async () => {},
    observe: async () => {
      reads += 1;
      const value = observer(t);
      if (reads === 2) value.journal.sha256 = 'f'.repeat(64);
      return value;
    },
    runWinapp: fakeWinapp(t, []),
  });
  assert.equal(got.result, 'unknown_outcome');
  assert.equal(got.reasonCode, 'OBSERVED_STATE_CHANGED');
});
