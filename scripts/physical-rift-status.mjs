#!/usr/bin/env node
// Read-only health report for the current physical RIFT client and the existing
// Workbridge one-shot evidence. No focus, keyboard, mouse, capture or service writes.
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify, parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runWinapp } from './desktop-ui.mjs';
import { getWindowsProcessIdentity } from './physical-rift-reloadui.mjs';

const execFileAsync = promisify(execFile);
const REPO = fileURLToPath(new URL('..', import.meta.url));
const EVIDENCE = path.join(REPO, '.tools', 'desktop-evidence');
const INTENT = 'physical-rift-reloadui-singleton.intent.json';
const PROCESS = 'rift_x64';
const CLASS = 'TWNClientFramework';
const ACTION = '/reloadui';
const MAX_READ = 16 * 1024 * 1024;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function finiteDate(value) {
  const millis = Date.parse(value ?? '');
  return Number.isFinite(millis) ? millis : null;
}

function positive(value) {
  return Number.isSafeInteger(Number(value)) && Number(value) > 0;
}

function isBoundedName(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(value);
}

async function boundedRegularFile(filename, maxBytes = MAX_READ) {
  const before = await lstat(filename);
  if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > maxBytes) {
    throw new Error('NOT_A_BOUNDED_REGULAR_FILE');
  }
  const bytes = await readFile(filename);
  const after = await lstat(filename);
  if (
    !after.isFile() ||
    after.isSymbolicLink() ||
    after.size !== bytes.length ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs
  ) {
    throw new Error('FILE_CHANGED_DURING_READ');
  }
  return { bytes, size: bytes.length, sha256: sha256(bytes), modifiedUtc: after.mtime.toISOString() };
}

async function readJson(filename, limit = 4096) {
  const item = await boundedRegularFile(filename, limit);
  return JSON.parse(item.bytes.toString('utf8'));
}

export function choosePhysicalRiftWindow(windows) {
  if (!Array.isArray(windows)) return { ok: false, code: 'WINDOWS_UNAVAILABLE' };
  const chosen = windows.filter(
    (w) =>
      w.processName === PROCESS &&
      w.title === 'RIFT' &&
      w.className === CLASS &&
      Number(w.ownerHwnd ?? 0) === 0 &&
      positive(w.processId) &&
      positive(w.hwnd) &&
      w.width >= 700 &&
      w.height >= 500,
  );
  if (chosen.length !== 1) {
    return {
      ok: false,
      code: chosen.length === 0 ? 'NO_PHYSICAL_RIFT_WINDOW' : 'AMBIGUOUS_PHYSICAL_RIFT',
      count: chosen.length,
    };
  }
  const w = chosen[0];
  return {
    ok: true,
    pid: Number(w.processId),
    hwnd: Number(w.hwnd),
    foreground: w.isForeground === true,
    width: w.width,
    height: w.height,
  };
}

export function classifyStatus(snapshot) {
  const reasons = [];
  let status = 'healthy';
  function add(next, code) {
    reasons.push(code);
    if (next === 'requires_attention' || status !== 'requires_attention') {
      if (next === 'requires_attention' || status === 'healthy') status = next;
    }
  }
  if (snapshot.service?.ok !== true || snapshot.service?.tunnelReady !== true) {
    add('requires_attention', 'WORKBRIDGE_UNAVAILABLE');
  }
  if (snapshot.window?.ok !== true) add('requires_attention', snapshot.window?.code ?? 'WINDOW_UNAVAILABLE');
  if (
    snapshot.window?.ok &&
    (snapshot.process?.pid !== snapshot.window.pid ||
      !Number.isSafeInteger(snapshot.process?.sessionId) ||
      finiteDate(snapshot.process?.startedUtc) === null)
  ) {
    add('requires_attention', 'PROCESS_IDENTITY_UNVERIFIED');
  }
  if (snapshot.locks?.error) add('uncertain', 'LOCK_STATE_UNVERIFIED');
  if ((snapshot.locks?.quarantines?.length ?? 0) > 0) add('requires_attention', 'INPUT_QUARANTINED');
  if (snapshot.locks?.desktopInput === true || snapshot.locks?.admission === true) {
    add('requires_attention', 'DESKTOP_INPUT_BUSY');
  }
  if (!snapshot.saved?.ok) add('uncertain', 'SAVEDVARIABLES_UNVERIFIED');
  else {
    if (snapshot.saved.addonVersion !== snapshot.expectedAddonVersion) {
      add('requires_attention', 'ADDON_VERSION_MISMATCH');
    }
    if (
      !Number.isSafeInteger(snapshot.saved.catalogCount) ||
      snapshot.saved.catalogCount < 1 ||
      !Number.isSafeInteger(snapshot.saved.toolbarSlots) ||
      snapshot.saved.toolbarSlots !== 8 ||
      !Number.isSafeInteger(snapshot.saved.uniquePins) ||
      snapshot.saved.uniquePins !== 8
    ) {
      add('uncertain', 'ADDON_DATA_INCOMPLETE');
    }
  }

  const evidence = snapshot.evidence ?? {};
  if (evidence.error) add('uncertain', 'ONE_SHOT_EVIDENCE_UNVERIFIED');
  else if (evidence.intent) {
    if (
      !evidence.receipt?.submitted ||
      !isBoundedName(evidence.intent.requestId) ||
      evidence.receipt.requestId !== evidence.intent.requestId ||
      evidence.intent.action !== ACTION ||
      evidence.receipt.pid !== evidence.intent.target?.pid ||
      evidence.receipt.hwnd !== evidence.intent.target?.hwnd
    ) {
      add('requires_attention', 'ONE_SHOT_RECEIPT_INCOMPLETE');
    }
    const sameProcess =
      snapshot.process?.pid === evidence.intent.target?.pid &&
      Math.abs(
        (finiteDate(snapshot.process?.startedUtc) ?? -Infinity) -
          (finiteDate(evidence.intent.target?.startedUtc) ?? Infinity),
      ) <= 1;
    const sameWindow = snapshot.window?.hwnd === evidence.intent.target?.hwnd;
    if (!sameProcess || !sameWindow) add('uncertain', 'HISTORICAL_RELOAD_TARGET');
    else if (evidence.captureVerified !== true) add('uncertain', 'GAME_CAPTURE_UNCORRELATED');
  } else {
    add('uncertain', 'NO_RELOAD_HISTORY');
  }
  return { status, reasons, inputAllowed: false, replayAllowed: false, readOnly: true };
}

export async function readInputSafety(root = EVIDENCE) {
  try {
    const names = await readdir(root);
    return {
      desktopInput: names.includes('desktop-input-turn.lock'),
      admission: names.includes('desktop-turn-admission.lock'),
      quarantines: names.filter((n) => /^desktop-turn-quarantine-.*\.json$/.test(n)).slice(0, 25),
    };
  } catch {
    return { error: 'LOCK_STATE_UNAVAILABLE', quarantines: [] };
  }
}

export async function readHistoricalReloadEvidence(root = EVIDENCE) {
  let intent;
  try {
    intent = await readJson(path.join(root, INTENT));
  } catch (error) {
    return error?.code === 'ENOENT' ? { intent: null } : { error: 'ONE_SHOT_INTENT_UNREADABLE' };
  }
  if (
    intent?.kind !== 'workbridge.physical-rift-reloadui-intent' ||
    !isBoundedName(intent.requestId) ||
    intent.action !== ACTION
  ) {
    return { error: 'ONE_SHOT_INTENT_INVALID' };
  }
  let receipt;
  try {
    receipt = await readJson(path.join(root, 'physical-rift-reloadui-' + intent.requestId + '.receipt.json'));
  } catch {
    return { intent, error: 'ONE_SHOT_RECEIPT_MISSING_OR_INVALID' };
  }
  if (
    receipt?.kind !== 'workbridge.physical-rift-reloadui-receipt' ||
    receipt?.requestId !== intent.requestId
  ) {
    return { intent, receipt, error: 'ONE_SHOT_RECEIPT_MISMATCH' };
  }

  // A receipt's verified:false means the sender itself never performed OCR.
  // A hash-matched later screenshot is evidence of capture, not proof of its contents.
  let captureVerified = false;
  let captureRequestId = null;
  try {
    const submittedMs = finiteDate(receipt.submittedUtc);
    const names = (await readdir(root)).filter((n) => /^capture-[A-Za-z0-9_-]+\.json$/.test(n));
    if (names.length > 500) throw new Error('CAPTURE_INDEX_TOO_LARGE');
    for (const name of names) {
      let candidate;
      try {
        candidate = await readJson(path.join(root, name));
      } catch {
        continue;
      }
      const capturedMs = finiteDate(candidate?.capturedUtc);
      if (
        submittedMs === null ||
        capturedMs === null ||
        capturedMs < submittedMs ||
        capturedMs - submittedMs > 120000 ||
        candidate?.pid !== receipt.pid ||
        candidate?.hwnd !== receipt.hwnd ||
        candidate?.process !== PROCESS ||
        candidate?.title !== 'RIFT' ||
        candidate?.expectedClass !== CLASS ||
        candidate?.inputInjected !== false ||
        !isBoundedName(candidate?.requestId)
      )
        continue;
      const expectedImage = path.join(root, 'capture-' + candidate.requestId + '.png');
      if (path.resolve(candidate.imagePath ?? '').toLowerCase() !== expectedImage.toLowerCase()) continue;
      try {
        const png = await boundedRegularFile(expectedImage);
        if (
          png.sha256 === candidate.sha256 &&
          png.size === candidate.sizeBytes &&
          candidate.width >= 700 &&
          candidate.height >= 500
        ) {
          captureVerified = true;
          captureRequestId = candidate.requestId;
          break;
        }
      } catch {
        /* Ignore malformed screenshot, do not trust it. */
      }
    }
  } catch {
    /* Absence or overlarge index is treated as unverified, never fabricated. */
  }
  return { intent, receipt, captureVerified, captureRequestId };
}

function savedRoots(userProfile, oneDrive) {
  const parents = [
    path.join(userProfile, 'OneDrive', 'Documents', 'RIFT', 'Interface', 'Saved'),
    path.join(userProfile, 'Documents', 'RIFT', 'Interface', 'Saved'),
  ];
  if (oneDrive) parents.push(path.join(oneDrive, 'Documents', 'RIFT', 'Interface', 'Saved'));
  return Array.from(new Set(parents));
}

export async function locateAtankSavedVariables({
  userProfile = process.env.USERPROFILE,
  oneDrive = process.env.OneDrive,
} = {}) {
  if (!userProfile || !path.isAbsolute(userProfile)) return { ok: false, reason: 'USER_PROFILE_UNAVAILABLE' };
  const matches = [];
  for (const base of savedRoots(userProfile, oneDrive)) {
    let entries;
    try {
      entries = await readdir(base, { withFileTypes: true });
    } catch {
      continue;
    }
    if (entries.length > 100) return { ok: false, reason: 'TOO_MANY_RIFT_ACCOUNTS' };
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const candidate = path.join(
        base,
        entry.name,
        'Deepwood',
        'Atank',
        'SavedVariables',
        'RRECollector.lua',
      );
      try {
        const stat = await lstat(candidate);
        if (stat.isFile() && !stat.isSymbolicLink()) matches.push(candidate);
      } catch {
        /* Account does not host Atank. */
      }
    }
  }
  const unique = Array.from(new Set(matches.map((m) => path.resolve(m).toLowerCase())));
  if (unique.length !== 1)
    return { ok: false, reason: unique.length ? 'AMBIGUOUS_SAVEDVARIABLES' : 'SAVEDVARIABLES_NOT_FOUND' };
  return { ok: true, path: matches[0] };
}

export function parseSavedVariables(text) {
  const version = text.match(/^\s*addonVersion\s*=\s*"([^"\r\n]+)"/m)?.[1] ?? null;
  const lookup = text.match(
    /\bcandidateLookup\s*=\s*\{[\s\S]{0,2500}?\bcounts\s*=\s*\{[\s\S]{0,250}?\bcatalog\s*=\s*(\d+)/,
  );
  const slotsSection = text.match(/\btoolbarSlots\s*=\s*\{([\s\S]{0,1024}?)\n\s*\}/);
  const slotIds = slotsSection
    ? [...slotsSection[1].matchAll(/^\s*"([A-Fa-f0-9]{17})"\s*,?\s*$/gm)].map((m) => m[1].toUpperCase())
    : null;
  const toolbarSlots = slotIds?.length ?? null;
  const uniquePins = slotIds ? new Set(slotIds).size : null;
  return { addonVersion: version, catalogCount: lookup ? Number(lookup[1]) : null, toolbarSlots, uniquePins };
}

export async function readSavedVariables(options) {
  const location = await locateAtankSavedVariables(options);
  if (!location.ok) return location;
  try {
    const file = await boundedRegularFile(location.path);
    return {
      ok: true,
      ...parseSavedVariables(file.bytes.toString('utf8')),
      sha256: file.sha256,
      sizeBytes: file.size,
      modifiedUtc: file.modifiedUtc,
      character: 'Atank',
      shard: 'Deepwood',
    };
  } catch {
    return { ok: false, reason: 'SAVEDVARIABLES_READ_FAILED' };
  }
}

async function readService() {
  try {
    const result = await execFileAsync(process.execPath, [path.join(REPO, 'scripts', 'desktop-status.mjs')], {
      cwd: REPO,
      timeout: 17000,
      windowsHide: true,
      maxBuffer: 64 * 1024,
    });
    return JSON.parse(result.stdout.trim());
  } catch {
    return { ok: false, tunnelReady: false };
  }
}

async function listWindows() {
  const version = String(await runWinapp(['--version']))
    .trim()
    .split(/\s+/)
    .at(-1);
  if (version !== '0.7.1') throw new Error('UNSUPPORTED_WINAPP');
  return JSON.parse(await runWinapp(['ui', 'list-windows', '-a', 'rift', '--json']));
}

export async function collectPhysicalRiftStatus({
  serviceProbe = readService,
  windowsProbe = listWindows,
  processProbe = getWindowsProcessIdentity,
  safetyProbe = readInputSafety,
  evidenceProbe = readHistoricalReloadEvidence,
  savedProbe = readSavedVariables,
  expectedAddonVersion = '0.4.11',
} = {}) {
  const [service, windows, locks, evidence, saved] = await Promise.all([
    serviceProbe(),
    windowsProbe().catch(() => null),
    safetyProbe(),
    evidenceProbe(),
    savedProbe(),
  ]);
  const window = choosePhysicalRiftWindow(windows);
  const process = window.ok ? await processProbe(window.pid).catch(() => null) : null;
  const snapshot = { service, window, process, locks, evidence, saved, expectedAddonVersion };
  const decision = classifyStatus(snapshot);
  // Deliberately no original SavedVariables path or account email in output.
  return {
    schemaVersion: 1,
    kind: 'workbridge.physical-rift-status',
    statusScope: 'host-readiness-and-evidence-integrity',
    ...decision,
    sampledUtc: new Date().toISOString(),
    workbridge: {
      ok: service?.ok === true,
      tunnelReady: service?.tunnelReady === true,
      version: service?.version ?? null,
      jobsAvailable: service?.capacity?.available ?? null,
    },
    rift: {
      ok: window.ok && process?.pid === window.pid,
      pid: window.pid ?? null,
      hwnd: window.hwnd ?? null,
      startedUtc: process?.startedUtc ?? null,
      sessionId: process?.sessionId ?? null,
      foreground: window.foreground ?? null,
    },
    input: {
      desktopInputLock: locks?.desktopInput ?? null,
      admissionLock: locks?.admission ?? null,
      quarantines: locks?.quarantines?.length ?? null,
    },
    reload: {
      requestId: evidence?.intent?.requestId ?? null,
      submitted: evidence?.receipt?.submitted === true,
      submittedUtc: evidence?.receipt?.submittedUtc ?? null,
      transportVerified: evidence?.receipt?.verified === true,
      gameOutcome: 'not-assessed',
      captureArtifactVerified: evidence?.captureVerified === true,
      captureRequestId: evidence?.captureRequestId ?? null,
      note: 'Capture artifact verification does not inspect image pixels or prove addon initialization.',
    },
    addon: { ...saved, expectedVersion: expectedAddonVersion, path: undefined },
  };
}

async function main() {
  let expectedAddonVersion = '0.4.11';
  try {
    const parsed = parseArgs({
      args: process.argv.slice(2),
      strict: true,
      options: { 'expected-addon-version': { type: 'string' } },
    });
    if (parsed.values['expected-addon-version']) {
      const value = parsed.values['expected-addon-version'];
      if (!/^\d+\.\d+\.\d+$/.test(value)) throw new Error('INVALID_VERSION');
      expectedAddonVersion = value;
    }
    const result = await collectPhysicalRiftStatus({ expectedAddonVersion });
    process.stdout.write(JSON.stringify(result) + '\n');
    if (result.status === 'requires_attention') process.exitCode = 2;
    if (result.status === 'uncertain') process.exitCode = 1;
  } catch {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        readOnly: true,
        status: 'requires_attention',
        reasons: ['PHYSICAL_RIFT_STATUS_UNAVAILABLE'],
        inputAllowed: false,
        replayAllowed: false,
      }) + '\n',
    );
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
