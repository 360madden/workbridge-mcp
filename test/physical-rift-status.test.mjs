import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import {
  choosePhysicalRiftWindow,
  classifyStatus,
  collectPhysicalRiftStatus,
  locateAtankSavedVariables,
  parseSavedVariables,
  readHistoricalReloadEvidence,
  readInputSafety,
} from '../scripts/physical-rift-status.mjs';

const target = {
  pid: 32156,
  hwnd: 462734,
  startedUtc: '2026-11-05T15:31:50.6416621Z',
  sessionId: 1,
};
const window = {
  hwnd: target.hwnd,
  processId: target.pid,
  processName: 'rift_x64',
  title: 'RIFT',
  className: 'TWNClientFramework',
  ownerHwnd: 0,
  width: 1936,
  height: 1048,
  isForeground: true,
};
const receipt = {
  kind: 'workbridge.physical-rift-reloadui-receipt',
  requestId: 'physical_rift_reloadui_20261105_once02',
  pid: target.pid,
  hwnd: target.hwnd,
  submittedUtc: '2026-11-05T22:21:00.132Z',
  submitted: true,
  verified: false,
  integratedFocusVerified: true,
};
const intent = {
  kind: 'workbridge.physical-rift-reloadui-intent',
  requestId: receipt.requestId,
  action: '/reloadui',
  target: { pid: target.pid, hwnd: target.hwnd, startedUtc: target.startedUtc },
};
const good = () => ({
  expectedAddonVersion: '0.4.11',
  service: { ok: true, tunnelReady: true, version: '0.16.4-dev' },
  window: choosePhysicalRiftWindow([window]),
  process: { ...target },
  locks: { desktopInput: false, admission: false, quarantines: [] },
  saved: { ok: true, addonVersion: '0.4.11', catalogCount: 96, toolbarSlots: 8, uniquePins: 8 },
  evidence: { intent, receipt, captureVerified: true },
});

test('unique full-size native RIFT window is accepted; stale and ambiguous identities refused', () => {
  assert.equal(choosePhysicalRiftWindow([window]).pid, target.pid);
  assert.equal(choosePhysicalRiftWindow([{ ...window, className: 'VMUIFrame' }]).ok, false);
  assert.equal(choosePhysicalRiftWindow([{ ...window, width: 160, height: 28 }]).ok, false);
  assert.equal(
    choosePhysicalRiftWindow([window, { ...window, hwnd: 987654 }]).code,
    'AMBIGUOUS_PHYSICAL_RIFT',
  );
  assert.equal(choosePhysicalRiftWindow(null).code, 'WINDOWS_UNAVAILABLE');
});

test('clean matching evidence is healthy but never grants input or replay', () => {
  const result = classifyStatus(good());
  assert.equal(result.status, 'healthy');
  assert.deepEqual(result.reasons, []);
  assert.equal(result.inputAllowed, false);
  assert.equal(result.replayAllowed, false);
  assert.equal(result.readOnly, true);
});

test('stale PID and creation timestamp fail closed', () => {
  const stale = good();
  stale.process.pid = 987;
  assert.equal(classifyStatus(stale).status, 'requires_attention');
  const reused = good();
  reused.process.startedUtc = '2026-11-05T15:31:52.6416621Z';
  assert(classifyStatus(reused).reasons.includes('HISTORICAL_RELOAD_TARGET'));
});

test('orphaned input lock, admission and quarantine require attention', () => {
  for (const scenario of [
    { desktopInput: true, admission: false, quarantines: [] },
    { desktopInput: false, admission: true, quarantines: [] },
    { desktopInput: false, admission: false, quarantines: ['desktop-turn-quarantine-dead.json'] },
  ]) {
    const snapshot = good();
    snapshot.locks = scenario;
    assert.equal(classifyStatus(snapshot).status, 'requires_attention');
  }
});

test('uncertain send, missing receipt and mismatched singleton are not silently accepted', () => {
  const uncertain = good();
  uncertain.evidence = { intent };
  assert.equal(classifyStatus(uncertain).status, 'requires_attention');
  assert(classifyStatus(uncertain).reasons.includes('ONE_SHOT_RECEIPT_INCOMPLETE'));
  const changed = good();
  changed.evidence.receipt = { ...receipt, submitted: false };
  assert.equal(classifyStatus(changed).status, 'requires_attention');
  const mismatch = good();
  mismatch.evidence.receipt = { ...receipt, requestId: 'other_request_id00' };
  assert.equal(classifyStatus(mismatch).status, 'requires_attention');
});

test('stale screenshot, no screenshot and historical game target remain uncertain', () => {
  const screenshot = good();
  screenshot.evidence.captureVerified = false;
  assert.equal(classifyStatus(screenshot).status, 'uncertain');
  assert(classifyStatus(screenshot).reasons.includes('GAME_CAPTURE_UNCORRELATED'));
  const historical = good();
  historical.window = { ...historical.window, hwnd: 1234567 };
  assert(classifyStatus(historical).reasons.includes('HISTORICAL_RELOAD_TARGET'));
  assert.equal(classifyStatus(historical).replayAllowed, false);
});

test('missing addon, wrong version and partial catalog are not reported healthy', () => {
  const absent = good();
  absent.saved = { ok: false };
  assert.equal(classifyStatus(absent).status, 'uncertain');
  const wrong = good();
  wrong.saved.addonVersion = '0.4.10';
  assert.equal(classifyStatus(wrong).status, 'requires_attention');
  const incomplete = good();
  incomplete.saved.toolbarSlots = 7;
  assert.equal(classifyStatus(incomplete).status, 'uncertain');
});

test('service loss and unreadable lease state fail closed', () => {
  const disconnected = good();
  disconnected.service.ok = false;
  assert.equal(classifyStatus(disconnected).status, 'requires_attention');
  const unknown = good();
  unknown.locks = { error: 'LOCK_STATE_UNAVAILABLE', quarantines: [] };
  assert.equal(classifyStatus(unknown).status, 'uncertain');
});

test('saved variables parser extracts only bounded non-executed fields', () => {
  const text =
    'RRECollectorData = {\n\taddonVersion = "0.4.11",\n' +
    '\tcandidateLookup = { counts = { catalog = 96, returned = 51 } },\n' +
    '\ttoolbarSlots = {\n\t\t"A3D21C84687199B44",\n\t\t"A03F53003A62FFD1E",\n' +
    '\t\t"A05213A7D60B13F6B",\n\t\t"A0530A5F074940F78",\n' +
    '\t\t"A05E934712DEB9B9F",\n\t\t"A0A3C4B7D9770624A",\n' +
    '\t\t"A0CB1772899B72707",\n\t\t"A0D674EA083DC58F6"\n\t}\n}\n';
  assert.deepEqual(parseSavedVariables(text), {
    addonVersion: '0.4.11',
    catalogCount: 96,
    toolbarSlots: 8,
    uniquePins: 8,
  });
  const duplicate = text.replace('"A0D674EA083DC58F6"', '"A3D21C84687199B44"');
  assert.equal(parseSavedVariables(duplicate).toolbarSlots, 8);
  assert.equal(parseSavedVariables(duplicate).uniquePins, 7);
  const duplicateSnapshot = good();
  duplicateSnapshot.saved.uniquePins = 7;
  assert.equal(classifyStatus(duplicateSnapshot).status, 'uncertain');
  assert.equal(parseSavedVariables('os.execute("bad")').addonVersion, null);
});

test('read-only lock inventory observes foreign state without removing it', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wb-rift-doctor-lock-test-'));
  const file = path.join(root, 'desktop-input-turn.lock');
  await writeFile(file, 'foreign owner');
  await writeFile(path.join(root, 'desktop-turn-quarantine-example.json'), '{}');
  const locks = await readInputSafety(root);
  assert.equal(locks.desktopInput, true);
  assert.equal(locks.quarantines.length, 1);
  assert.equal(await readFile(file, 'utf8'), 'foreign owner');
});

test('SavedVariables discovery is bounded, account-agnostic and nonmutating', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wb-rift-doctor-saved-test-'));
  const dir = path.join(
    root,
    'OneDrive',
    'Documents',
    'RIFT',
    'Interface',
    'Saved',
    'account-A',
    'Deepwood',
    'Atank',
    'SavedVariables',
  );
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, 'RRECollector.lua');
  await writeFile(file, 'RRECollectorData = {}\n');
  const result = await locateAtankSavedVariables({ userProfile: root, oneDrive: null });
  assert.equal(result.ok, true);
  assert.equal(result.path, file);
  assert.equal(await readFile(file, 'utf8'), 'RRECollectorData = {}\n');
});

test('hash-verified post-submit screenshot is correlated but does not create an input permission', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wb-rift-doctor-evidence-test-'));
  await writeFile(path.join(root, 'physical-rift-reloadui-singleton.intent.json'), JSON.stringify(intent));
  await writeFile(
    path.join(root, 'physical-rift-reloadui-' + receipt.requestId + '.receipt.json'),
    JSON.stringify(receipt),
  );
  const id = 'post_test_capture_001';
  const bytes = Buffer.alloc(12000, 0);
  bytes.set([0x89, 0x50, 0x4e, 0x47], 0);
  const imagePath = path.join(root, 'capture-' + id + '.png');
  await writeFile(imagePath, bytes);
  const meta = {
    requestId: id,
    pid: target.pid,
    hwnd: target.hwnd,
    process: 'rift_x64',
    title: 'RIFT',
    expectedClass: 'TWNClientFramework',
    capturedUtc: '2026-11-05T22:21:20.214Z',
    imagePath,
    width: 1920,
    height: 1032,
    sizeBytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    inputInjected: false,
  };
  await writeFile(path.join(root, 'capture-' + id + '.json'), JSON.stringify(meta));
  const found = await readHistoricalReloadEvidence(root);
  assert.equal(found.receipt.submitted, true);
  assert.equal(found.captureVerified, true);
  assert.equal(found.captureRequestId, id);
  meta.capturedUtc = '2026-11-05T22:20:30.214Z';
  await writeFile(path.join(root, 'capture-' + id + '.json'), JSON.stringify(meta));
  assert.equal((await readHistoricalReloadEvidence(root)).captureVerified, false);
});

test('collector uses injected read-only probes, never invokes an input sender', async () => {
  const actions = [];
  const result = await collectPhysicalRiftStatus({
    serviceProbe: async () => {
      actions.push('service');
      return good().service;
    },
    windowsProbe: async () => {
      actions.push('windows');
      return [window];
    },
    processProbe: async () => {
      actions.push('process');
      return { ...target };
    },
    safetyProbe: async () => {
      actions.push('locks');
      return good().locks;
    },
    evidenceProbe: async () => {
      actions.push('evidence');
      return good().evidence;
    },
    savedProbe: async () => {
      actions.push('saved');
      return good().saved;
    },
  });
  assert.equal(result.status, 'healthy');
  assert.equal(result.readOnly, true);
  assert.equal(result.inputAllowed, false);
  assert.equal(result.replayAllowed, false);
  assert.equal(result.addon.expectedVersion, '0.4.11');
  assert.equal(result.statusScope, 'host-readiness-and-evidence-integrity');
  assert.equal(result.reload.gameOutcome, 'not-assessed');
  assert.deepEqual(actions.sort(), ['evidence', 'locks', 'process', 'saved', 'service', 'windows'].sort());
});
