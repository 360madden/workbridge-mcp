#!/usr/bin/env node
// Physical Windows RIFT only. One-shot /reloadui admission and read-only preflight.
// Deliberately NO production keyboard transport: RIFT exposes no chat UIA selector.
// A validated, same-session native transport must be supplied explicitly by a tested caller.
// Never invoke this file with a synthetic sender against a real game.
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { open, mkdir, readdir, readFile, lstat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { promisify, parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { withDesktopAdmission } from './desktop-turn-admission.mjs';
import { runWinapp } from './desktop-ui.mjs';

const execFileAsync = promisify(execFile);
const ROOT = path.join(fileURLToPath(new URL('..', import.meta.url)), '.tools', 'desktop-evidence');
const PROCESS = 'rift_x64';
const TITLE = 'RIFT';
const CLASS = 'TWNClientFramework';
const VERSION = '0.7.1';
const CONFIRMATION = 'one-physical-rift-reloadui';
const ACTION = Object.freeze(['Enter', '/reloadui', 'Enter']);
const ONE_SHOT_NAME = 'physical-rift-reloadui-singleton.intent.json';

export class RiftReloadError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RiftReloadError';
    this.code = code;
  }
}

function refuse(code, message) {
  throw new RiftReloadError(code, message);
}

function decimal(value, label) {
  if (!/^[1-9][0-9]*$/.test(String(value ?? ''))) refuse('INVALID_TARGET', label + ' must be decimal');
  const n = Number(value);
  if (!Number.isSafeInteger(n)) refuse('INVALID_TARGET', label + ' must be a safe integer');
  return n;
}

export function parseReloadRequest(argv) {
  const seenOptions = new Set();
  for (const token of argv) {
    if (!token.startsWith('--')) continue;
    const name = token.split('=')[0];
    if (seenOptions.has(name)) refuse('INVALID_ARGUMENTS', 'Repeated command option');
    seenOptions.add(name);
  }
  let v;
  try {
    ({ values: v } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        pid: { type: 'string' },
        hwnd: { type: 'string' },
        'started-utc': { type: 'string' },
        'request-id': { type: 'string' },
        confirm: { type: 'string' },
        'preflight-only': { type: 'boolean' },
      },
    }));
  } catch {
    refuse('INVALID_ARGUMENTS', 'Required --pid --hwnd --started-utc --request-id --confirm; --preflight-only optional');
  }
  const pid = decimal(v.pid, 'pid');
  const hwnd = decimal(v.hwnd, 'hwnd');
  if (pid > 0x7fffffff) refuse('INVALID_TARGET', 'PID out of range');
  const startedUtc = v['started-utc'];
  if (typeof startedUtc !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/.test(startedUtc) || !Number.isFinite(Date.parse(startedUtc))) {
    refuse('INVALID_PROCESS_START', 'Provide the freshly observed UTC process creation timestamp');
  }
  const requestId = v['request-id'];
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(requestId ?? '')) {
    refuse('INVALID_REQUEST_ID', 'Use a unique bounded request ID');
  }
  if (v.confirm !== CONFIRMATION) refuse('CONFIRMATION_REQUIRED', 'Explicit physical RIFT one-reload confirmation required');
  return Object.freeze({
    pid, hwnd, startedUtc, requestId,
    preflightOnly: v['preflight-only'] === true,
  });
}

function parseJson(raw, label) {
  try { return JSON.parse(raw); }
  catch { refuse('INVALID_PROVIDER_JSON', label + ' was not valid JSON'); }
}

function assertProcessIdentity(result, request) {
  if (Number(result?.pid) !== request.pid || !Number.isInteger(result?.sessionId) || result.sessionId < 0) {
    refuse('STALE_PROCESS', 'Process identity/session unavailable or changed');
  }
  const actual = Date.parse(result?.startedUtc ?? '');
  if (!Number.isFinite(actual) || Math.abs(actual - Date.parse(request.startedUtc)) > 1) {
    refuse('STALE_PROCESS', 'RIFT PID was reused or process creation timestamp changed');
  }
}

export function assertPhysicalRiftWindow(result, request) {
  if (!Array.isArray(result?.windows)) refuse('INVALID_PROVIDER_JSON', 'Window list unavailable');
  const matches = result.windows.filter((w) => Number(w.hwnd) === request.hwnd);
  if (matches.length !== 1) refuse('STALE_TARGET', 'Selected HWND absent or ambiguous');
  const w = matches[0];
  if (Number(w.processId) !== request.pid ||
      w.processName !== PROCESS || w.title !== TITLE ||
      w.className !== CLASS || Number(w.ownerHwnd ?? 0) !== 0) {
    refuse('WRONG_TARGET', 'The exact physical RIFT window identity did not match');
  }
  if (w.isForeground !== true) refuse('NOT_FOREGROUND', 'Operator must foreground physical RIFT before an action');
  if (!Number.isFinite(w.width) || !Number.isFinite(w.height) ||
      w.width < 700 || w.height < 500 || w.width > 15000 || w.height > 15000) {
    refuse('TARGET_NOT_VISIBLE', 'Window appears minimized, invalid, or unexpectedly sized');
  }
  return w;
}

export function assertPhysicalGeometry(tree, request, w) {
  const windows = tree?.windows;
  const chosen = Array.isArray(windows) ? windows.filter((x) => Number(x.hwnd) === request.hwnd) : [];
  const e = chosen[0]?.elements?.[0];
  if (chosen.length !== 1 || e?.type !== 'Window' || e.name !== TITLE ||
      e.className !== CLASS || e.isEnabled !== true || e.isOffscreen === true ||
      ![e.x, e.y, e.width, e.height].every(Number.isFinite) ||
      Math.abs(e.x) > 20000 || Math.abs(e.y) > 20000 ||
      e.width < 700 || e.height < 500 ||
      Math.abs(e.width - w.width) > 60 || Math.abs(e.height - w.height) > 60) {
    refuse('TARGET_NOT_VISIBLE', 'Current RIFT UIA root geometry/visibility did not match');
  }
  return { x: e.x, y: e.y, width: e.width, height: e.height };
}

// Read-only Windows process identity. It does not read command line, environment or secrets.
export async function getWindowsProcessIdentity(pid) {
  const script = "$ErrorActionPreference='Stop'; $p=Get-Process -Id " + String(decimal(pid, 'pid')) +
    " -ErrorAction Stop; [pscustomobject]@{pid=$p.Id;startedUtc=$p.StartTime.ToUniversalTime().ToString('o');sessionId=$p.SessionId} | ConvertTo-Json -Compress";
  let stdout;
  try {
    ({ stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command', script,
    ], { timeout: 10000, windowsHide: true, maxBuffer: 8192 }));
  } catch {
    refuse('PROCESS_IDENTITY_UNAVAILABLE', 'Could not independently read process start/session');
  }
  return parseJson(stdout, 'Process identity');
}

export async function inspectPhysicalRift(request, {
  runner = runWinapp,
  getProcess = getWindowsProcessIdentity,
} = {}) {
  const version = String(await runner(['--version'])).trim().split(/\s+/).at(-1);
  if (version !== VERSION) refuse('UNSUPPORTED_WINAPP', 'Require Microsoft WinApp CLI 0.7.1');
  const processRecord = await getProcess(request.pid);
  assertProcessIdentity(processRecord, request);
  // WinApp and the eventual sender run from this Node process. Never type from
  // a non-interactive/different Windows session than the physical game.
  const caller = await getProcess(process.pid);
  if (Number(caller?.pid) !== process.pid || caller?.sessionId !== processRecord.sessionId) {
    refuse('SESSION_MISMATCH', 'Input helper is not in the physical RIFT Windows session');
  }
  const list = parseJson(await runner(['ui', 'list-windows', '-a', String(request.pid), '--json']), 'Window list');
  const w = assertPhysicalRiftWindow({ windows: list }, request);
  const tree = parseJson(await runner(['ui', 'inspect', '-w', String(request.hwnd), '--depth', '1', '--json']), 'UIA inspection');
  const bounds = assertPhysicalGeometry(tree, request, w);
  // Confirm same PID creation/session survived the UIA work.
  const after = await getProcess(request.pid);
  assertProcessIdentity(after, request);
  if (after.sessionId !== processRecord.sessionId) refuse('STALE_PROCESS', 'Process session changed');
  return {
    pid: request.pid, hwnd: request.hwnd, startedUtc: request.startedUtc,
    sessionId: after.sessionId, process: PROCESS, title: TITLE, className: CLASS,
    foreground: true, bounds,
  };
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function writeExclusiveJson(filename, obj) {
  const bytes = Buffer.from(JSON.stringify(obj) + '\n', 'utf8');
  if (bytes.length > 4096) refuse('RECEIPT_TOO_LARGE', 'Bounded journal record exceeded 4096 bytes');
  let h;
  try { h = await open(filename, 'wx', 0o600); }
  catch (e) {
    if (e?.code === 'EEXIST') refuse('ACTION_RECOVERY_REQUIRED', 'Existing one-shot intent or receipt requires review');
    throw e;
  }
  try {
    await h.writeFile(bytes);
    await h.sync();
  } finally { await h.close(); }
  return { bytes, sha256: hash(bytes) };
}

async function quarantineVeto(root) {
  const names = await readdir(root);
  if (names.some((n) => n.startsWith('desktop-turn-quarantine-') && n.endsWith('.json'))) {
    refuse('UI_TURN_RECOVERY_REQUIRED', 'A desktop quarantine sidecar forbids new keyboard input');
  }
}

async function releaseOwnedTurn(filename, original, journal) {
  const before = await lstat(filename);
  const bytes = await readFile(filename);
  const after = await lstat(filename);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 ||
      before.dev !== original.dev || before.ino !== original.ino ||
      after.dev !== before.dev || after.ino !== before.ino ||
      before.size !== journal.bytes.length ||
      after.size !== before.size || before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs || hash(bytes) !== journal.sha256) {
    refuse('UI_TURN_RECOVERY_REQUIRED', 'Desktop turn owner changed; retain the foreign lock');
  }
  await unlink(filename);
}

async function createTurn(root, request, observed) {
  const filename = path.join(root, 'desktop-input-turn.lock');
  const stamp = {
    schemaVersion: 1, kind: 'workbridge.gui-turn',
    leaseId: randomUUID(), producer: 'physical-rift-reloadui',
    requestId: request.requestId, owner: { pid: process.pid, processStartUtc: null, sessionId: observed.sessionId },
    target: { kind: 'window', pid: request.pid, hwnd: request.hwnd, process: PROCESS },
    acquiredUtc: new Date().toISOString(),
  };
  const bytes = Buffer.from(JSON.stringify(stamp) + '\n', 'utf8');
  let h;
  try { h = await open(filename, 'wx', 0o600); }
  catch (e) {
    if (e?.code === 'EEXIST') refuse('UI_TURN_BUSY', 'Another desktop GUI turn or retained lock exists');
    throw e;
  }
  const original = await h.stat();
  try {
    await h.writeFile(bytes);
    await h.sync();
  } finally { await h.close(); }
  return { filename, original, leaseId: stamp.leaseId, journal: { bytes, sha256: hash(bytes) } };
}

async function readBoundedJson(filename) {
  let bytes;
  try { bytes = await readFile(filename); }
  catch (e) {
    if (e?.code === 'ENOENT') return null;
    throw e;
  }
  if (bytes.length > 4096) refuse('ACTION_RECOVERY_REQUIRED', 'Existing marker exceeded bound');
  return parseJson(bytes.toString('utf8'), 'Existing one-shot marker');
}

/**
 * One synthetic-testable, single-action transaction. sender is intentionally REQUIRED.
 * No production sender is wired until a separately validated same-session native route exists.
 * Once intent exists, any exception is uncertain: do not delete intent or turn lock or retry.
 */
export async function executePhysicalReloadOnce(request, {
  runner = runWinapp,
  getProcess = getWindowsProcessIdentity,
  sender,
  root = ROOT,
} = {}) {
  if (typeof sender !== 'function') {
    refuse('NO_VALIDATED_INPUT_TRANSPORT', 'No production-safe physical RIFT keyboard transport has been validated');
  }
  await mkdir(root, { recursive: true });
  const lockPath = path.join(root, 'desktop-input-turn.lock');
  return await withDesktopAdmission(lockPath,
    { producer: 'physical-rift-reloadui', requestId: request.requestId },
    async () => {
      await quarantineVeto(root);
      const markerPath = path.join(root, ONE_SHOT_NAME);
      const existing = await readBoundedJson(markerPath);
      if (existing) {
        if (existing.requestId === request.requestId) {
          const receiptPath = path.join(root, 'physical-rift-reloadui-' + request.requestId + '.receipt.json');
          const receipt = await readBoundedJson(receiptPath);
          if (receipt?.submitted !== true || receipt?.requestId !== request.requestId) {
            refuse('ACTION_RECOVERY_REQUIRED', 'Previous attempt outcome uncertain; no replay');
          }
          return { ok: true, replayed: true, submitted: true,
            verified: false, status: 'PREVIOUS_SUBMISSION_DO_NOT_RESEND' };
        }
        refuse('ACTION_RECOVERY_REQUIRED', 'One physical RIFT reload already attempted; no second ID permitted');
      }
      const observed = await inspectPhysicalRift(request, { runner, getProcess });
      const turn = await createTurn(root, request, observed);
      let intentCreated = false;
      let intentSha256 = null;
      let actionStarted = false;
      try {
        await quarantineVeto(root);
        // Recheck focus, visibility and creation immediately before journaling.
        const latest = await inspectPhysicalRift(request, { runner, getProcess });
        if (latest.sessionId !== observed.sessionId) refuse('STALE_PROCESS', 'Target session changed');
        const intent = {
          schemaVersion: 1, kind: 'workbridge.physical-rift-reloadui-intent',
          requestId: request.requestId, target: {
            pid: request.pid, hwnd: request.hwnd, process: PROCESS, startedUtc: request.startedUtc,
          }, phase: 'started', action: '/reloadui', startedUtc: new Date().toISOString(),
        };
        intentCreated = true;
        const intentJournal = await writeExclusiveJson(markerPath, intent);
        intentSha256 = intentJournal.sha256;
        actionStarted = true;
        // Only the literal, immutable three-part sequence may be supplied.
        const response = await sender(Object.freeze({
          pid: request.pid, hwnd: request.hwnd,
          startedUtc: request.startedUtc, sessionId: observed.sessionId,
          sequence: ACTION,
        }));
        if (response?.submitted !== true || response?.sequenceCount !== 3 ||
            response?.targetPid !== request.pid || response?.targetHwnd !== request.hwnd ||
            response?.senderSessionId !== observed.sessionId) {
          refuse('ACTION_RECOVERY_REQUIRED', 'Native input delivery result was uncertain');
        }
        // A sender receipt is NOT proof RIFT interpreted/reloaded; external screenshot
        // plus SavedVariables verification is a separate mandatory acceptance gate.
        await writeExclusiveJson(path.join(root, 'physical-rift-reloadui-' + request.requestId + '.receipt.json'), {
          schemaVersion: 1, kind: 'workbridge.physical-rift-reloadui-receipt',
          requestId: request.requestId, pid: request.pid, hwnd: request.hwnd,
          submittedUtc: new Date().toISOString(), submitted: true, verified: false,
        });
        await releaseOwnedTurn(turn.filename, turn.original, turn.journal);
        return { ok: true, replayed: false, submitted: true,
          verified: false, status: 'SUBMITTED_PENDING_EXTERNAL_GAME_EVIDENCE' };
      } catch (error) {
        // Before an intent is created, no input was attempted: release an owned turn.
        // After intent, retain ownership AND seal a linked quarantine sidecar.
        // A failed/partial sender might have opened chat or submitted the command.
        if (intentCreated || actionStarted) {
          try {
            await writeExclusiveJson(path.join(root, 'desktop-turn-quarantine-' + turn.leaseId + '.json'), {
              schemaVersion: 1, kind: 'workbridge.gui-turn-quarantine',
              leaseId: turn.leaseId, requestId: request.requestId,
              ownerStampSha256: turn.journal.sha256, intentSha256,
              reasonCode: 'ACTION_RECOVERY_REQUIRED', processTreeSettlement: 'unknown',
              automaticRetryAllowed: false, createdUtc: new Date().toISOString(),
            });
          } catch {
            refuse('ACTION_RECOVERY_REQUIRED', 'Quarantine seal unavailable; original GUI lock retained');
          }
        }
        if (!intentCreated && !actionStarted) {
          await releaseOwnedTurn(turn.filename, turn.original, turn.journal);
        }
        throw error;
      }
    });
}

async function main() {
  try {
    const request = parseReloadRequest(process.argv.slice(2));
    if (!request.preflightOnly) {
      refuse('NO_VALIDATED_INPUT_TRANSPORT',
        'Live physical RIFT input is disabled until a native interactive sender is separately validated');
    }
    const observed = await inspectPhysicalRift(request);
    console.log(JSON.stringify({ ok: true, readOnly: true, status: 'PREFLIGHT_ONLY',
      target: observed, inputSubmitted: false }));
  } catch (error) {
    console.log(JSON.stringify({ ok: false,
      code: error?.code ?? 'PREFLIGHT_FAILED', message: error?.message ?? 'Unknown failure',
      inputSubmitted: false }));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
