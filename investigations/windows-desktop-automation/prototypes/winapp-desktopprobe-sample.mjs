#!/usr/bin/env node
// Investigation-only WinApp 0.7.1 READ-ONLY DesktopProbe sample.
// No fixture launch, focus, input, screenshot, VMware, daemon or Workbridge service change.
import { createHash } from 'node:crypto';
import { readFile, lstat } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';
import { executeReadOnly, runWinapp } from '../../../scripts/desktop-ui.mjs';

const execFileAsync = promisify(execFile);
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const TEMP = join(REPO, 'investigations', 'windows-desktop-automation', 'temp');
const OBSERVER = join(dirname(fileURLToPath(import.meta.url)), 'Observe-DesktopProbeReadOnly.ps1');
const LEASE = join(REPO, '.tools', 'desktop-evidence', 'desktop-input-turn.lock');
const TITLE = 'Workbridge GUI-004 Native Input Probe';
const EPOCH_TICKS = 621355968000000000n;
const MAX_MANIFEST_BYTES = 8192;
const MAX_LEASE_BYTES = 4096;
const MAX_PROBE_AGE_MS = 65_000;

class Blocked extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const deny = (code) => { throw new Blocked(code); };
const decimal = (v) => typeof v === 'string' && /^[1-9][0-9]{0,17}$/.test(v);
const sha = (v) => typeof v === 'string' && /^[0-9a-f]{64}$/i.test(v);
const sid = (v) => typeof v === 'string' && /^S-[0-9]+-[0-9]+(-[0-9]+)+$/.test(v);
const fixedId = (v) => typeof v === 'string' && /^[a-z0-9][a-z0-9_-]{5,63}$/.test(v);
const safeCode = (v) => typeof v === 'string' && /^[A-Z][A-Z0-9_]{2,70}$/.test(v) ? v : 'UNCLASSIFIED_ERROR';

export function parseArgs(argv) {
  let targetPath, sampleId;
  if (argv.length !== 4) deny('INVALID_ARGUMENTS');
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i] === '--target' && !targetPath) targetPath = argv[i + 1];
    else if (argv[i] === '--sample-id' && !sampleId) sampleId = argv[i + 1];
    else deny('INVALID_ARGUMENTS');
  }
  if (!targetPath || !fixedId(sampleId)) deny('INVALID_ARGUMENTS');
  return { targetPath, sampleId };
}

export function validateManifest(v) {
  if (!v || v.schemaVersion !== 1 || !/^[a-z0-9][a-z0-9-]{5,50}$/.test(v.runId) || !fixedId(v.requestId) ||
      !fixedId(v.leaseId) || !Number.isSafeInteger(v.pid) || v.pid < 1 ||
      !decimal(v.hwnd) || !decimal(v.foregroundHwnd) ||
      typeof v.startedAtUtcTicks !== 'string' || !/^[1-9][0-9]{16,18}$/.test(v.startedAtUtcTicks) ||
      !Number.isSafeInteger(v.sessionId) || v.sessionId < 1 ||
      !Number.isSafeInteger(v.watchdogPid) || v.watchdogPid < 1 ||
      typeof v.watchdogStartedAtUtcTicks !== 'string' || !/^[1-9][0-9]{16,18}$/.test(v.watchdogStartedAtUtcTicks) ||
      !sid(v.ownerSid) || !sha(v.exeSha256) ||
      typeof v.exePath !== 'string' || typeof v.evidenceDir !== 'string' ||
      typeof v.className !== 'string' || v.className.length < 1 || v.className.length > 240 ||
      v.title !== TITLE) deny('INVALID_TARGET_MANIFEST');
  if (basename(v.exePath).toLowerCase() !== 'desktopprobe.exe') deny('WRONG_PROBE_EXE');
  const expectedEvidence = join(TEMP, 'desktopprobe-' + v.runId, 'evidence');
  if (resolve(v.evidenceDir).toLowerCase() !== expectedEvidence.toLowerCase()) {
    deny('WRONG_EVIDENCE_DIRECTORY');
  }
  const expectedPublish = join(TEMP, 'desktopprobe-' + v.runId, 'publish', 'DesktopProbe.exe');
  if (resolve(v.exePath).toLowerCase() !== expectedPublish.toLowerCase()) {
    deny('WRONG_EXE_DIRECTORY');
  }
  const startMs = Number((BigInt(v.startedAtUtcTicks) - EPOCH_TICKS) / 10000n);
  const ageMs = Date.now() - startMs;
  if (ageMs < -1000 || ageMs > MAX_PROBE_AGE_MS) deny('PROBE_OUTSIDE_WATCHDOG_BUDGET');
  return v;
}

async function readSmallJson(path, limit) {
  const meta = await lstat(path);
  if (!meta.isFile() || meta.isSymbolicLink() || meta.size < 2 || meta.size > limit) {
    deny('JSON_ARTIFACT_INVALID');
  }
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch { deny('JSON_ARTIFACT_UNREADABLE'); }
}

export function validateLease(stamp, target) {
  if (!stamp || stamp.schemaVersion !== 1 || stamp.kind !== 'workbridge.gui-turn' ||
      stamp.producer !== 'desktopprobe-watchdog' ||
      stamp.runId !== target.runId || stamp.requestId !== target.requestId ||
      stamp.leaseId !== target.leaseId ||
      stamp.owner?.pid !== target.watchdogPid ||
      stamp.owner?.processStartUtcTicks !== target.watchdogStartedAtUtcTicks ||
      stamp.owner?.sessionId !== target.sessionId ||
      stamp.target?.kind !== 'window' || stamp.target?.pid !== null ||
      stamp.target?.hwnd !== null || stamp.target?.process !== 'DesktopProbe') {
    deny('WATCHDOG_LEASE_MISMATCH');
  }
  return stamp;
}

async function confirmLease(target) {
  let stamp;
  try { stamp = await readSmallJson(LEASE, MAX_LEASE_BYTES); }
  catch { deny('WATCHDOG_LEASE_ABSENT_OR_INVALID'); }
  return validateLease(stamp, target);
}

export function validateObserver(data, target) {
  if (!data || data.schemaVersion !== 1 || data.verified !== true ||
      data.pid !== target.pid || data.startedAtUtcTicks !== target.startedAtUtcTicks ||
      data.sessionId !== target.sessionId || data.ownerSidVerified !== true ||
      data.hwnd !== target.hwnd || data.rootHwnd !== target.hwnd ||
      data.ownerHwnd !== '0' || data.className !== target.className ||
      data.foregroundHwnd !== target.foregroundHwnd ||
      data.windowStation?.toLowerCase() !== 'winsta0' ||
      data.desktopName?.toLowerCase() !== 'default' ||
      data.journal?.shown !== true || data.journal?.counter !== 0 ||
      data.journal?.eventCount !== 2 || data.journal?.unexpectedInputEvents !== 0 ||
      !sha(data.journal?.sha256) ||
      !Number.isSafeInteger(data.rect?.width) || data.rect.width < 300 ||
      !Number.isSafeInteger(data.rect?.height) || data.rect.height < 200) {
    deny('INDEPENDENT_IDENTITY_FAILED');
  }
  return data;
}

async function observe(target) {
  const args = [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', OBSERVER,
    '-TargetPid', String(target.pid), '-TargetHwnd', target.hwnd,
    '-StartTicks', target.startedAtUtcTicks, '-TargetSession', String(target.sessionId),
    '-ExePath', target.exePath, '-ExeSha256', target.exeSha256,
    '-OwnerSid', target.ownerSid, '-ClassName', target.className,
    '-ForegroundHwnd', target.foregroundHwnd, '-EvidenceDir', target.evidenceDir,
  ];
  let stdout;
  try {
    ({ stdout } = await execFileAsync('powershell.exe', args, {
      cwd: REPO, shell: false, windowsHide: true, encoding: 'utf8',
      timeout: 8000, maxBuffer: 8192,
    }));
  } catch { deny('OBSERVER_FAILED_OR_TIMED_OUT'); }
  let result;
  try { result = JSON.parse(stdout); }
  catch { deny('OBSERVER_RESULT_INVALID'); }
  return validateObserver(result, target);
}

export function sameOracle(a, b) {
  if (!a || !b || a.journal.sha256 !== b.journal.sha256 ||
      a.foregroundHwnd !== b.foregroundHwnd ||
      a.hwnd !== b.hwnd || a.startedAtUtcTicks !== b.startedAtUtcTicks ||
      a.sessionId !== b.sessionId || a.ownerSid !== b.ownerSid ||
      JSON.stringify(a.rect) !== JSON.stringify(b.rect)) {
    deny('OBSERVED_STATE_CHANGED');
  }
  return true;
}

export function projectTree(tree, payloadBytes) {
  const window = tree?.windows;
  if (!Array.isArray(window) || window.length !== 1 || !Array.isArray(window[0].elements)) {
    deny('WINAPP_TREE_SHAPE_UNSUPPORTED');
  }
  const structural = [];
  const fixtureControls = { IncrementButton: 0, ResetButton: 0, CounterDisplay: 0 };
  let maxDepth = 0;
  const visit = (items, depth) => {
    if (!Array.isArray(items)) deny('WINAPP_TREE_SHAPE_UNSUPPORTED');
    for (const item of items) {
      if (structural.length >= 4096 || depth > 6) deny('WINAPP_TREE_BOUNDS');
      const children = item?.children ?? [];
      if (!Array.isArray(children)) deny('WINAPP_TREE_SHAPE_UNSUPPORTED');
      const type = typeof item?.type === 'string' && /^[a-zA-Z]{1,32}$/.test(item.type)
        ? item.type.toLowerCase() : 'other';
      // Known disposable fixture selectors only: never retain arbitrary element names or values.
      if (item.selector === 'IncrementButton' && type === 'button') fixtureControls.IncrementButton += 1;
      if (item.selector === 'ResetButton' && type === 'button') fixtureControls.ResetButton += 1;
      if (item.selector === 'CounterDisplay' && ['text', 'label'].includes(type)) fixtureControls.CounterDisplay += 1;
      structural.push([depth, type, children.length]);
      maxDepth = Math.max(maxDepth, depth);
      visit(children, depth + 1);
    }
  };
  visit(window[0].elements, 0);
  if (structural.length < 4 || !Number.isSafeInteger(payloadBytes) ||
      payloadBytes < 2 || payloadBytes > 384 * 1024) deny('INSUFFICIENT_UI_TREE');
  if (Object.values(fixtureControls).some((count) => count !== 1)) {
    deny('DESKTOPPROBE_CONTROL_STRUCTURE_MISMATCH');
  }
  return {
    nodes: structural.length,
    maxDepth,
    fixtureControlsVerified: true,
    payloadBytes,
    structuralSha256: createHash('sha256').update(JSON.stringify(structural)).digest('hex'),
  };
}

function receiptStart(sampleId) {
  return {
    schemaVersion: 1, provider: 'Microsoft.WinAppCli', backendVersion: '0.7.1',
    sampleId, result: 'blocked', reasonCode: 'NOT_STARTED', readOnly: true,
    actualInputActions: 0, screenshots: 0,
    latencyMs: { before: null, version: null, discover: null, inspect: null, after: null, total: null },
    tree: null,
    target: null,
    oracle: { before: false, after: false, foregroundUnchanged: false, journalUnchanged: false, rectUnchanged: false },
    processTreeSettlement: 'not-proven',
  };
}

export async function sample(target, sampleId, deps = {}) {
  const receipt = receiptStart(sampleId);
  const started = performance.now();
  let before, after;
  const lease = deps.confirmLease ?? confirmLease;
  const observer = deps.observe ?? observe;
  const command = deps.runWinapp ?? runWinapp;
  try {
    validateManifest(target);
    receipt.target = {
      pid: target.pid, startedAtUtcTicks: target.startedAtUtcTicks,
      sessionId: target.sessionId, hwnd: target.hwnd,
    };
    await lease(target);
    let t = performance.now();
    before = await observer(target);
    receipt.latencyMs.before = Math.round(performance.now() - t);
    validateObserver(before, target);
    receipt.oracle.before = true;
    if (Date.now() - Number((BigInt(target.startedAtUtcTicks) - EPOCH_TICKS) / 10000n) > MAX_PROBE_AGE_MS) {
      deny('PROBE_OUTSIDE_WATCHDOG_BUDGET');
    }
    let inspectBytes = 0;
    let expectedCommandIndex = 0;
    const expectedCommands = [
      ['--version'],
      ['ui', 'list-windows', '-a', String(target.pid), '--json'],
      ['ui', 'inspect', '-w', String(target.hwnd), '--depth', '1', '--json'],
    ];
    const wrapped = async (args) => {
      const expected = expectedCommands[expectedCommandIndex++];
      if (!expected || JSON.stringify(args) !== JSON.stringify(expected)) {
        deny('UNEXPECTED_WINAPP_COMMAND');
      }
      const phase = args[0] === '--version' ? 'version'
        : args[0] === 'ui' && args[1] === 'list-windows' ? 'discover'
        : args[0] === 'ui' && args[1] === 'inspect' ? 'inspect' : null;
      if (!phase) deny('UNEXPECTED_WINAPP_COMMAND');
      const t0 = performance.now();
      // Explicit literal command disables WORKBRIDGE_WINAPP_EXE ambient executable overrides.
      const raw = await command(args, { timeoutMs: 7000, executable: 'winapp.exe' });
      receipt.latencyMs[phase] = Math.round(performance.now() - t0);
      if (phase === 'inspect') inspectBytes = Buffer.byteLength(raw, 'utf8');
      return raw;
    };
    const result = await executeReadOnly({
      operation: 'inspect', pid: target.pid, hwnd: Number(target.hwnd),
      depth: 1, title: TITLE, process: 'DesktopProbe',
    }, wrapped);
    if (expectedCommandIndex !== expectedCommands.length) deny('MISSING_WINAPP_PHASE');
    if (result.target?.className !== target.className ||
        Number(result.target.hwnd) !== Number(target.hwnd) ||
        Number(result.target.pid) !== target.pid ||
        result.target.width < 300 || result.target.height < 200) {
      deny('PROVIDER_TARGET_IDENTITY_CHANGED');
    }
    receipt.tree = projectTree(result.tree, inspectBytes);
    t = performance.now();
    after = await observer(target);
    receipt.latencyMs.after = Math.round(performance.now() - t);
    validateObserver(after, target);
    sameOracle(before, after);
    await lease(target);
    receipt.oracle = { before: true, after: true, foregroundUnchanged: true, journalUnchanged: true, rectUnchanged: true };
    receipt.result = 'success';
    receipt.reasonCode = 'UIA_READ_ONLY_VERIFIED';
  } catch (error) {
    receipt.reasonCode = safeCode(error?.code);
    receipt.result = before ? 'unknown_outcome' : 'blocked';
    if (before && !after) {
      try {
        const t = performance.now();
        after = await observer(target);
        receipt.latencyMs.after = Math.round(performance.now() - t);
        validateObserver(after, target);
        sameOracle(before, after);
        await lease(target);
        receipt.oracle.after = true;
        receipt.oracle.foregroundUnchanged = true;
        receipt.oracle.journalUnchanged = true;
        receipt.oracle.rectUnchanged = true;
        receipt.result = 'blocked';
      } catch {
        receipt.result = 'unknown_outcome';
      }
    }
  }
  receipt.latencyMs.total = Math.round(performance.now() - started);
  return receipt;
}

async function main() {
  let receipt = receiptStart('invalid');
  try {
    const { targetPath, sampleId } = parseArgs(process.argv.slice(2));
    receipt = receiptStart(sampleId);
    const target = await readSmallJson(targetPath, MAX_MANIFEST_BYTES);
    validateManifest(target);
    const expectedDir = resolve(target.evidenceDir).toLowerCase();
    const actualParent = resolve(dirname(targetPath)).toLowerCase();
    if (actualParent !== expectedDir) deny('TARGET_MANIFEST_NOT_RUN_OWNED');
    receipt = await sample(target, sampleId);
  } catch (error) {
    receipt.result = 'blocked';
    receipt.reasonCode = safeCode(error?.code);
  }
  process.stdout.write(JSON.stringify(receipt) + '\n');
  process.exitCode = receipt.result === 'success' ? 0
    : receipt.result === 'blocked' ? 2 : 4;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
