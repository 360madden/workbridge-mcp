#!/usr/bin/env node
// Physical Windows RIFT only. Explicit read-only, focus-only or one-shot /reloadui modes.
// Live keyboard transport is limited to exact HWND-bound WinApp 0.7.1 send-input,
// backed by a fresh hash-verified screenshot and exclusive desktop input admission.
// Never invoke this file with a synthetic sender against a real game.
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { open, mkdir, readdir, readFile, lstat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { promisify, parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
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
        'execute-once': { type: 'boolean' },
        'focus-only': { type: 'boolean' },
        'screenshot-request-id': { type: 'string' },
        'chat-visual-attestation': { type: 'string' },
      },
    }));
  } catch {
    refuse(
      'INVALID_ARGUMENTS',
      'Required --pid --hwnd --started-utc --request-id --confirm; --preflight-only optional',
    );
  }
  const pid = decimal(v.pid, 'pid');
  const hwnd = decimal(v.hwnd, 'hwnd');
  if (pid > 0x7fffffff) refuse('INVALID_TARGET', 'PID out of range');
  const startedUtc = v['started-utc'];
  if (
    typeof startedUtc !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/.test(startedUtc) ||
    !Number.isFinite(Date.parse(startedUtc))
  ) {
    refuse('INVALID_PROCESS_START', 'Provide the freshly observed UTC process creation timestamp');
  }
  const requestId = v['request-id'];
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(requestId ?? '')) {
    refuse('INVALID_REQUEST_ID', 'Use a unique bounded request ID');
  }
  if (v.confirm !== CONFIRMATION)
    refuse('CONFIRMATION_REQUIRED', 'Explicit physical RIFT one-reload confirmation required');
  const executeOnce = v['execute-once'] === true;
  const focusOnly = v['focus-only'] === true;
  const preflightOnly = v['preflight-only'] === true;
  if (Number(executeOnce) + Number(focusOnly) + Number(preflightOnly) > 1) {
    refuse('INVALID_ARGUMENTS', 'Preflight, focus-only and live execution are mutually exclusive');
  }
  if (executeOnce) {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(v['screenshot-request-id'] ?? '') ||
      v['chat-visual-attestation'] !== 'chat-closed-empty'
    ) {
      refuse(
        'CHAT_STATE_GATE_REQUIRED',
        'Live input requires a fresh verified capture ID and explicit closed-empty chat attestation',
      );
    }
  } else if (v['screenshot-request-id'] !== undefined || v['chat-visual-attestation'] !== undefined) {
    refuse('INVALID_ARGUMENTS', 'Chat visual attestation is valid only for --execute-once');
  }
  return Object.freeze({
    pid,
    hwnd,
    startedUtc,
    requestId,
    preflightOnly,
    executeOnce,
    focusOnly,
    screenshotRequestId: executeOnce ? v['screenshot-request-id'] : null,
    chatVisualAttestation: executeOnce ? v['chat-visual-attestation'] : null,
  });
}

function parseJson(raw, label) {
  try {
    return JSON.parse(raw);
  } catch {
    refuse('INVALID_PROVIDER_JSON', label + ' was not valid JSON');
  }
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

export function assertPhysicalRiftWindow(result, request, { requireForeground = true } = {}) {
  if (!Array.isArray(result?.windows)) refuse('INVALID_PROVIDER_JSON', 'Window list unavailable');
  const matches = result.windows.filter((w) => Number(w.hwnd) === request.hwnd);
  if (matches.length !== 1) refuse('STALE_TARGET', 'Selected HWND absent or ambiguous');
  const w = matches[0];
  if (
    Number(w.processId) !== request.pid ||
    w.processName !== PROCESS ||
    w.title !== TITLE ||
    w.className !== CLASS ||
    Number(w.ownerHwnd ?? 0) !== 0
  ) {
    refuse('WRONG_TARGET', 'The exact physical RIFT window identity did not match');
  }
  if (requireForeground && w.isForeground !== true)
    refuse('NOT_FOREGROUND', 'Operator must foreground physical RIFT before an action');
  if (
    !Number.isFinite(w.width) ||
    !Number.isFinite(w.height) ||
    w.width < 700 ||
    w.height < 500 ||
    w.width > 15000 ||
    w.height > 15000
  ) {
    refuse('TARGET_NOT_VISIBLE', 'Window appears minimized, invalid, or unexpectedly sized');
  }
  return w;
}

export function assertPhysicalGeometry(tree, request, w) {
  const windows = tree?.windows;
  const chosen = Array.isArray(windows) ? windows.filter((x) => Number(x.hwnd) === request.hwnd) : [];
  const e = chosen[0]?.elements?.[0];
  if (
    chosen.length !== 1 ||
    e?.type !== 'Window' ||
    e.name !== TITLE ||
    e.className !== CLASS ||
    e.isEnabled !== true ||
    e.isOffscreen === true ||
    ![e.x, e.y, e.width, e.height].every(Number.isFinite) ||
    Math.abs(e.x) > 20000 ||
    Math.abs(e.y) > 20000 ||
    e.width < 700 ||
    e.height < 500 ||
    Math.abs(e.width - w.width) > 60 ||
    Math.abs(e.height - w.height) > 60
  ) {
    refuse('TARGET_NOT_VISIBLE', 'Current RIFT UIA root geometry/visibility did not match');
  }
  return { x: e.x, y: e.y, width: e.width, height: e.height };
}

// Read-only Windows process identity. It does not read command line, environment or secrets.
export async function getWindowsProcessIdentity(pid) {
  const script =
    "$ErrorActionPreference='Stop'; $p=Get-Process -Id " +
    String(decimal(pid, 'pid')) +
    " -ErrorAction Stop; [pscustomobject]@{pid=$p.Id;startedUtc=$p.StartTime.ToUniversalTime().ToString('o');sessionId=$p.SessionId} | ConvertTo-Json -Compress";
  let stdout;
  try {
    ({ stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 10000, windowsHide: true, maxBuffer: 8192 },
    ));
  } catch {
    refuse('PROCESS_IDENTITY_UNAVAILABLE', 'Could not independently read process start/session');
  }
  return parseJson(stdout, 'Process identity');
}

export async function inspectPhysicalRift(
  request,
  { runner = runWinapp, getProcess = getWindowsProcessIdentity, requireForeground = true } = {},
) {
  const version = String(await runner(['--version']))
    .trim()
    .split(/\s+/)
    .at(-1);
  if (version !== VERSION) refuse('UNSUPPORTED_WINAPP', 'Require Microsoft WinApp CLI 0.7.1');
  const processRecord = await getProcess(request.pid);
  assertProcessIdentity(processRecord, request);
  // WinApp and the eventual sender run from this Node process. Never type from
  // a non-interactive/different Windows session than the physical game.
  const caller = await getProcess(process.pid);
  if (Number(caller?.pid) !== process.pid || caller?.sessionId !== processRecord.sessionId) {
    refuse('SESSION_MISMATCH', 'Input helper is not in the physical RIFT Windows session');
  }
  const list = parseJson(
    await runner(['ui', 'list-windows', '-a', String(request.pid), '--json']),
    'Window list',
  );
  const w = assertPhysicalRiftWindow({ windows: list }, request, { requireForeground });
  const tree = parseJson(
    await runner(['ui', 'inspect', '-w', String(request.hwnd), '--depth', '1', '--json']),
    'UIA inspection',
  );
  const bounds = assertPhysicalGeometry(tree, request, w);
  const rootSelector = tree.windows?.find((x) => Number(x.hwnd) === request.hwnd)?.elements?.[0]?.selector;
  // Confirm same PID creation/session survived the UIA work.
  const after = await getProcess(request.pid);
  assertProcessIdentity(after, request);
  if (after.sessionId !== processRecord.sessionId) refuse('STALE_PROCESS', 'Process session changed');
  return {
    pid: request.pid,
    hwnd: request.hwnd,
    startedUtc: request.startedUtc,
    sessionId: after.sessionId,
    process: PROCESS,
    title: TITLE,
    className: CLASS,
    foreground: w.isForeground === true,
    bounds,
    rootSelector,
  };
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Bind an explicit human-verified chat-closed attestation to a real,
 * Workbridge-captured physical RIFT PNG. Pure read-only verification occurs
 * BEFORE acquiring desktop admission/GUI locks. An arbitrary caller SHA or
 * timestamp is never accepted as capture evidence.
 */
export async function readVerifiedChatEvidence(
  request,
  { root = ROOT, now = () => Date.now(), getProcess = getWindowsProcessIdentity } = {},
) {
  if (request?.executeOnce !== true || request.chatVisualAttestation !== 'chat-closed-empty') {
    refuse('CHAT_STATE_GATE_REQUIRED', 'Explicit one-shot closed-empty chat attestation required');
  }
  const id = request.screenshotRequestId;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(id ?? '')) {
    refuse('INVALID_CAPTURE_ID', 'A bounded captured screenshot ID is required');
  }
  const stem = 'capture-' + id;
  const metadataPath = path.join(root, stem + '.json');
  const imagePath = path.join(root, stem + '.png');
  const metadataStat = await lstat(metadataPath).catch(() => null);
  const imageStat = await lstat(imagePath).catch(() => null);
  if (
    !metadataStat?.isFile() ||
    metadataStat.isSymbolicLink() ||
    !imageStat?.isFile() ||
    imageStat.isSymbolicLink() ||
    metadataStat.size < 100 ||
    metadataStat.size > 4096 ||
    imageStat.size < 10000 ||
    imageStat.size > 16 * 1024 * 1024
  ) {
    refuse(
      'CAPTURE_EVIDENCE_UNAVAILABLE',
      'Expected bounded regular screenshot and receipt files are absent',
    );
  }
  const receipt = parseJson(await readFile(metadataPath, 'utf8'), 'Capture receipt');
  const bytes = await readFile(imagePath);
  const age = now() - Date.parse(receipt.capturedUtc ?? '');
  if (
    receipt.schemaVersion !== 1 ||
    receipt.requestId !== id ||
    receipt.pid !== request.pid ||
    receipt.hwnd !== request.hwnd ||
    receipt.process !== PROCESS ||
    receipt.title !== TITLE ||
    receipt.expectedClass !== CLASS ||
    receipt.inputInjected !== false ||
    typeof receipt.imagePath !== 'string' ||
    receipt.imagePath.toLowerCase() !== path.resolve(imagePath).toLowerCase() ||
    !Number.isInteger(receipt.sizeBytes) ||
    receipt.sizeBytes !== bytes.length ||
    receipt.sizeBytes !== imageStat.size ||
    !Number.isFinite(receipt.width) ||
    receipt.width < 700 ||
    !Number.isFinite(receipt.height) ||
    receipt.height < 500 ||
    !/^[a-f0-9]{64}$/i.test(receipt.sha256 ?? '') ||
    hash(bytes) !== receipt.sha256.toLowerCase() ||
    !Number.isFinite(age) ||
    age < -1000 ||
    age > 30000
  ) {
    refuse(
      'CHAT_STATE_UNVERIFIED',
      'Screenshot receipt, pinned image, target identity or 30-second freshness did not match',
    );
  }
  const processRecord = await getProcess(request.pid);
  assertProcessIdentity(processRecord, request);
  return Object.freeze({
    confirmed: true,
    state: 'chat-closed-empty',
    pid: request.pid,
    hwnd: request.hwnd,
    startedUtc: request.startedUtc,
    sessionId: processRecord.sessionId,
    capturedUtc: receipt.capturedUtc,
    imageSha256: receipt.sha256.toLowerCase(),
  });
}

async function writeExclusiveJson(filename, obj) {
  const bytes = Buffer.from(JSON.stringify(obj) + '\n', 'utf8');
  if (bytes.length > 4096) refuse('RECEIPT_TOO_LARGE', 'Bounded journal record exceeded 4096 bytes');
  let h;
  try {
    h = await open(filename, 'wx', 0o600);
  } catch (e) {
    if (e?.code === 'EEXIST')
      refuse('ACTION_RECOVERY_REQUIRED', 'Existing one-shot intent or receipt requires review');
    throw e;
  }
  try {
    await h.writeFile(bytes);
    await h.sync();
  } finally {
    await h.close();
  }
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
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    before.dev !== original.dev ||
    before.ino !== original.ino ||
    after.dev !== before.dev ||
    after.ino !== before.ino ||
    before.size !== journal.bytes.length ||
    after.size !== before.size ||
    before.mtimeMs !== after.mtimeMs ||
    before.ctimeMs !== after.ctimeMs ||
    hash(bytes) !== journal.sha256
  ) {
    refuse('UI_TURN_RECOVERY_REQUIRED', 'Desktop turn owner changed; retain the foreign lock');
  }
  await unlink(filename);
}

async function createTurn(root, request, observed, producer = 'physical-rift-reloadui') {
  const filename = path.join(root, 'desktop-input-turn.lock');
  const stamp = {
    schemaVersion: 1,
    kind: 'workbridge.gui-turn',
    leaseId: randomUUID(),
    producer,
    requestId: request.requestId,
    owner: { pid: process.pid, processStartUtc: null, sessionId: observed.sessionId },
    target: { kind: 'window', pid: request.pid, hwnd: request.hwnd, process: PROCESS },
    acquiredUtc: new Date().toISOString(),
  };
  const bytes = Buffer.from(JSON.stringify(stamp) + '\n', 'utf8');
  let h;
  try {
    h = await open(filename, 'wx', 0o600);
  } catch (e) {
    if (e?.code === 'EEXIST') refuse('UI_TURN_BUSY', 'Another desktop GUI turn or retained lock exists');
    throw e;
  }
  const original = await h.stat();
  try {
    await h.writeFile(bytes);
    await h.sync();
  } finally {
    await h.close();
  }
  return { filename, original, leaseId: stamp.leaseId, journal: { bytes, sha256: hash(bytes) } };
}

async function readBoundedJson(filename) {
  let bytes;
  try {
    bytes = await readFile(filename);
  } catch (e) {
    if (e?.code === 'ENOENT') return null;
    throw e;
  }
  if (bytes.length > 4096) refuse('ACTION_RECOVERY_REQUIRED', 'Existing marker exceeded bound');
  return parseJson(bytes.toString('utf8'), 'Existing one-shot marker');
}

/**
 * One synthetic-testable, single-action transaction. sender is intentionally REQUIRED.
 * In --execute-once, native root focus occurs after fsynced reload intent inside one lease.
 * Once intent exists, any exception is uncertain: do not delete intent or turn lock or retry.
 */
export async function executePhysicalReloadOnce(
  request,
  { runner = runWinapp, getProcess = getWindowsProcessIdentity, sender, root = ROOT } = {},
) {
  if (typeof sender !== 'function') {
    refuse(
      'NO_VALIDATED_INPUT_TRANSPORT',
      'No production-safe physical RIFT keyboard transport has been validated',
    );
  }
  await mkdir(root, { recursive: true });
  const lockPath = path.join(root, 'desktop-input-turn.lock');
  return await withDesktopAdmission(
    lockPath,
    { producer: 'physical-rift-reloadui', requestId: request.requestId },
    async () => {
      await quarantineVeto(root);
      const markerPath = path.join(root, ONE_SHOT_NAME);
      const existing = await readBoundedJson(markerPath);
      if (existing) {
        if (existing.requestId === request.requestId) {
          const receiptPath = path.join(
            root,
            'physical-rift-reloadui-' + request.requestId + '.receipt.json',
          );
          const receipt = await readBoundedJson(receiptPath);
          if (receipt?.submitted !== true || receipt?.requestId !== request.requestId) {
            refuse('ACTION_RECOVERY_REQUIRED', 'Previous attempt outcome uncertain; no replay');
          }
          return {
            ok: true,
            replayed: true,
            submitted: true,
            verified: false,
            status: 'PREVIOUS_SUBMISSION_DO_NOT_RESEND',
          };
        }
        refuse(
          'ACTION_RECOVERY_REQUIRED',
          'One physical RIFT reload already attempted; no second ID permitted',
        );
      }
      const observed = await inspectPhysicalRift(request, {
        runner,
        getProcess,
        requireForeground: request.executeOnce !== true,
      });
      const turn = await createTurn(root, request, observed);
      let intentCreated = false;
      let intentSha256 = null;
      let actionStarted = false;
      try {
        await quarantineVeto(root);
        // Recheck exact process/window/root; focus is planned after durable intent.
        const latest = await inspectPhysicalRift(request, {
          runner,
          getProcess,
          requireForeground: request.executeOnce !== true,
        });
        if (
          latest.sessionId !== observed.sessionId ||
          latest.rootSelector !== observed.rootSelector ||
          !/^[A-Za-z0-9_-]{3,96}$/.test(latest.rootSelector ?? '')
        ) {
          refuse('STALE_TARGET', 'Physical RIFT root selector/session changed');
        }
        const intent = {
          schemaVersion: 1,
          kind: 'workbridge.physical-rift-reloadui-intent',
          requestId: request.requestId,
          target: {
            pid: request.pid,
            hwnd: request.hwnd,
            process: PROCESS,
            startedUtc: request.startedUtc,
            sessionId: observed.sessionId,
            className: CLASS,
            title: TITLE,
            rootSelector: latest.rootSelector,
          },
          phase: 'started',
          action: '/reloadui',
          plannedActions: request.executeOnce ? ['uia-root-focus', ...ACTION] : [...ACTION],
          startedUtc: new Date().toISOString(),
        };
        const intentJournal = await writeExclusiveJson(markerPath, intent);
        intentCreated = true;
        intentSha256 = intentJournal.sha256;
        actionStarted = true;
        // Only the literal, immutable three-part sequence may be supplied.
        const response = await sender(
          Object.freeze({
            pid: request.pid,
            hwnd: request.hwnd,
            startedUtc: request.startedUtc,
            sessionId: observed.sessionId,
            rootSelector: latest.rootSelector,
            allowInitialFocus: request.executeOnce === true,
            sequence: ACTION,
          }),
        );
        if (
          response?.submitted !== true ||
          response?.sequenceCount !== 3 ||
          response?.targetPid !== request.pid ||
          response?.targetHwnd !== request.hwnd ||
          response?.senderSessionId !== observed.sessionId ||
          (request.executeOnce === true && response?.focusPerformed !== true)
        ) {
          refuse('ACTION_RECOVERY_REQUIRED', 'Native input delivery result was uncertain');
        }
        // A sender receipt is NOT proof RIFT interpreted/reloaded; external screenshot
        // plus SavedVariables verification is a separate mandatory acceptance gate.
        await writeExclusiveJson(
          path.join(root, 'physical-rift-reloadui-' + request.requestId + '.receipt.json'),
          {
            schemaVersion: 1,
            kind: 'workbridge.physical-rift-reloadui-receipt',
            requestId: request.requestId,
            pid: request.pid,
            hwnd: request.hwnd,
            submittedUtc: new Date().toISOString(),
            submitted: true,
            verified: false,
            integratedFocusVerified: request.executeOnce === true,
          },
        );
        await releaseOwnedTurn(turn.filename, turn.original, turn.journal);
        return {
          ok: true,
          replayed: false,
          submitted: true,
          verified: false,
          status: 'SUBMITTED_PENDING_EXTERNAL_GAME_EVIDENCE',
        };
      } catch (error) {
        // Before an intent is created, no input was attempted: release an owned turn.
        // After intent, retain ownership AND seal a linked quarantine sidecar.
        // A failed/partial sender might have opened chat or submitted the command.
        if (intentCreated || actionStarted) {
          try {
            await writeExclusiveJson(path.join(root, 'desktop-turn-quarantine-' + turn.leaseId + '.json'), {
              schemaVersion: 1,
              kind: 'workbridge.gui-turn-quarantine',
              leaseId: turn.leaseId,
              requestId: request.requestId,
              ownerStampSha256: turn.journal.sha256,
              intentSha256,
              reasonCode: 'ACTION_RECOVERY_REQUIRED',
              processTreeSettlement: 'unknown',
              automaticRetryAllowed: false,
              createdUtc: new Date().toISOString(),
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
    },
  );
}

/**
 * Narrow physical-RIFT foreground operation. It may only UIA-focus the newly
 * inspected TOP-LEVEL RIFT window selector; it never sends keyboard/mouse input.
 * A focus attempt is journaled separately from the single /reloadui intent.
 */
export async function executePhysicalFocusOnce(
  request,
  { runner = runWinapp, getProcess = getWindowsProcessIdentity, root = ROOT } = {},
) {
  if (request?.focusOnly !== true || request.executeOnce || request.preflightOnly) {
    refuse('INVALID_OPERATION', 'Explicit --focus-only is required for this mode');
  }
  await mkdir(root, { recursive: true });
  const lockPath = path.join(root, 'desktop-input-turn.lock');
  return await withDesktopAdmission(
    lockPath,
    { producer: 'physical-rift-focus-only', requestId: request.requestId },
    async () => {
      await quarantineVeto(root);
      const focusIntentPath = path.join(root, 'physical-rift-focus-' + request.requestId + '.intent.json');
      const focusReceiptPath = path.join(root, 'physical-rift-focus-' + request.requestId + '.receipt.json');
      const old = await readBoundedJson(focusIntentPath);
      if (old) {
        const receipt = await readBoundedJson(focusReceiptPath);
        if (
          old.requestId === request.requestId &&
          receipt?.focused === true &&
          receipt.requestId === request.requestId
        ) {
          return {
            ok: true,
            replayed: true,
            focused: true,
            inputSubmitted: false,
            status: 'PREVIOUS_FOCUS_DO_NOT_REPEAT',
          };
        }
        refuse('ACTION_RECOVERY_REQUIRED', 'Existing focus attempt is uncertain; no automatic replay');
      }
      const observed = await inspectPhysicalRift(request, { runner, getProcess, requireForeground: false });
      if (observed.foreground) {
        return {
          ok: true,
          alreadyForeground: true,
          focused: true,
          inputSubmitted: false,
          status: 'ALREADY_FOREGROUND_NO_ACTION',
        };
      }
      if (typeof observed.rootSelector !== 'string' || !/^[A-Za-z0-9_-]{3,96}$/.test(observed.rootSelector)) {
        refuse('FOCUS_SELECTOR_UNAVAILABLE', 'Fresh RIFT top-level UIA selector was not verified');
      }
      const turn = await createTurn(root, request, observed, 'physical-rift-focus-only');
      let intentCreated = false;
      let intentSha256 = null;
      try {
        await quarantineVeto(root);
        const fresh = await inspectPhysicalRift(request, { runner, getProcess, requireForeground: false });
        if (
          fresh.rootSelector !== observed.rootSelector ||
          fresh.sessionId !== observed.sessionId ||
          fresh.foreground !== false
        ) {
          refuse('STALE_TARGET', 'RIFT selector/session/foreground changed before focus');
        }
        const intent = {
          schemaVersion: 1,
          kind: 'workbridge.physical-rift-focus-only-intent',
          requestId: request.requestId,
          leaseId: turn.leaseId,
          target: {
            pid: request.pid,
            hwnd: request.hwnd,
            process: PROCESS,
            startedUtc: request.startedUtc,
            selector: fresh.rootSelector,
          },
          action: 'uia-root-focus-only',
          startedUtc: new Date().toISOString(),
        };
        // The focus attempt becomes uncertain only AFTER its durable intent.
        const journal = await writeExclusiveJson(focusIntentPath, intent);
        intentCreated = true;
        intentSha256 = journal.sha256;
        // This is the ONLY GUI action in focus mode; there are no key events.
        const response = parseJson(
          await runner(['ui', 'focus', fresh.rootSelector, '-w', String(request.hwnd), '--json']),
          'WinApp focus response',
        );
        if (response?.hwnd !== undefined && Number(response.hwnd) !== request.hwnd) {
          refuse('ACTION_RECOVERY_REQUIRED', 'WinApp focused a window other than physical RIFT');
        }
        const post = await inspectPhysicalRift(request, { runner, getProcess, requireForeground: true });
        if (
          post.sessionId !== observed.sessionId ||
          post.rootSelector !== observed.rootSelector ||
          post.foreground !== true
        ) {
          refuse('ACTION_RECOVERY_REQUIRED', 'RIFT did not become foreground with identical identity');
        }
        await writeExclusiveJson(focusReceiptPath, {
          schemaVersion: 1,
          kind: 'workbridge.physical-rift-focus-only-receipt',
          requestId: request.requestId,
          leaseId: turn.leaseId,
          pid: request.pid,
          hwnd: request.hwnd,
          focused: true,
          inputSubmitted: false,
          verifiedUtc: new Date().toISOString(),
        });
        await releaseOwnedTurn(turn.filename, turn.original, turn.journal);
        return {
          ok: true,
          replayed: false,
          focused: true,
          inputSubmitted: false,
          status: 'FOREGROUND_VERIFIED',
        };
      } catch (error) {
        if (intentCreated) {
          try {
            await writeExclusiveJson(path.join(root, 'desktop-turn-quarantine-' + turn.leaseId + '.json'), {
              schemaVersion: 1,
              kind: 'workbridge.gui-turn-quarantine',
              leaseId: turn.leaseId,
              requestId: request.requestId,
              ownerStampSha256: turn.journal.sha256,
              intentSha256,
              reasonCode: 'FOCUS_ACTION_RECOVERY_REQUIRED',
              processTreeSettlement: 'unknown',
              automaticRetryAllowed: false,
              createdUtc: new Date().toISOString(),
            });
          } catch {
            refuse('ACTION_RECOVERY_REQUIRED', 'Focus quarantine seal unavailable; GUI lock retained');
          }
        } else {
          await releaseOwnedTurn(turn.filename, turn.original, turn.journal);
        }
        throw error;
      }
    },
  );
}

/**
 * Staged keyboard delivery for a single already-admitted physical-RIFT reload.
 * The CLI wires this factory ONLY under explicit --execute-once. An independently
 * captured and visually checked screenshot must attest chat CLOSED and EMPTY before the GUI
 * lease is acquired. We only verify that immutable evidence is still fresh
 * during input; we never start an acquiring screenshot adapter while holding
 * the desktop admission/turn locks.
 *
 * After Enter opens chat, the initial screenshot cannot prove the new state.
 * Target/process/session/foreground are instead rechecked immediately before
 * every phase, with uncertain outcomes sealed for manual reconciliation.
 *
 * WinApp's HWND-bound send-input route is intentionally used without --target:
 * RIFT's custom chat field is absent from its UI Automation tree.
 */
export function createGuardedWinappSender({
  runner = runWinapp,
  getProcess = getWindowsProcessIdentity,
  chatClosedEvidence,
  now = () => Date.now(),
  settle = delay,
} = {}) {
  if (!chatClosedEvidence || typeof chatClosedEvidence !== 'object') {
    refuse('CHAT_STATE_GATE_REQUIRED', 'Fresh pre-lock chat-closed evidence is required');
  }
  const evidence = Object.freeze({
    confirmed: chatClosedEvidence.confirmed,
    state: chatClosedEvidence.state,
    pid: chatClosedEvidence.pid,
    hwnd: chatClosedEvidence.hwnd,
    startedUtc: chatClosedEvidence.startedUtc,
    sessionId: chatClosedEvidence.sessionId,
    capturedUtc: chatClosedEvidence.capturedUtc,
    imageSha256: chatClosedEvidence.imageSha256,
  });
  return async function sendOneReload(input) {
    if (
      !input ||
      !Array.isArray(input.sequence) ||
      input.sequence.length !== ACTION.length ||
      input.sequence.some((key, index) => key !== ACTION[index])
    ) {
      refuse('INVALID_ACTION_SEQUENCE', 'Only one literal Enter /reloadui Enter sequence is permitted');
    }
    const target = { pid: input.pid, hwnd: input.hwnd, startedUtc: input.startedUtc };
    let sessionId = null;
    let firstKeyStartedAt = null;
    for (let phase = 0; phase < ACTION.length; phase++) {
      if (
        firstKeyStartedAt !== null &&
        (now() - firstKeyStartedAt < 0 || now() - firstKeyStartedAt > 60000)
      ) {
        refuse('INPUT_TURN_EXPIRED', 'A keyboard phase exceeded the bounded 60-second input turn');
      }
      const current = await inspectPhysicalRift(target, {
        runner,
        getProcess,
        requireForeground: !(phase === 0 && input.allowInitialFocus === true),
      });
      if (current.sessionId !== input.sessionId || (sessionId !== null && current.sessionId !== sessionId)) {
        refuse('SESSION_MISMATCH', 'Physical game or input session changed before a key phase');
      }
      sessionId = current.sessionId;
      // The same pre-lock screenshot only proves chat was initially closed/empty.
      // No nested capture/control call or invented per-phase chat-state assertion.
      const age = now() - Date.parse(evidence.capturedUtc ?? '');
      if (
        evidence.confirmed !== true ||
        evidence.state !== 'chat-closed-empty' ||
        evidence.pid !== input.pid ||
        evidence.hwnd !== input.hwnd ||
        evidence.startedUtc !== input.startedUtc ||
        evidence.sessionId !== input.sessionId ||
        (phase === 0 && (!Number.isFinite(age) || age < -1000 || age > 60000)) ||
        !/^[a-f0-9]{64}$/i.test(evidence.imageSha256 ?? '')
      ) {
        refuse('CHAT_STATE_UNVERIFIED', 'Initial chat-closed screenshot proof is missing/stale');
      }
      // Exactly one UIA focus after durable intent in this same exclusive lease.
      // No full UIA inspection or external tool roundtrip after focus, and
      // never refocus if any keyboard event may already have been delivered.
      if (phase === 0 && input.allowInitialFocus === true) {
        if (
          typeof input.rootSelector !== 'string' ||
          !/^[A-Za-z0-9_-]{3,96}$/.test(input.rootSelector) ||
          current.rootSelector !== input.rootSelector
        ) {
          refuse('FOCUS_SELECTOR_UNAVAILABLE', 'Physical RIFT root changed before focus');
        }
        const focusReply = parseJson(
          await runner(['ui', 'focus', current.rootSelector, '-w', String(input.hwnd), '--json']),
          'Integrated native UIA focus',
        );
        if (
          focusReply?.ok === false ||
          focusReply?.success === false ||
          focusReply?.error ||
          (focusReply?.hwnd !== undefined && Number(focusReply.hwnd) !== input.hwnd)
        ) {
          refuse('ACTION_RECOVERY_REQUIRED', 'Native focus targeted unexpected HWND');
        }
      }
      // Verify exact foreground HWND + process/session immediately before key.
      const justBefore = parseJson(
        await runner(['ui', 'list-windows', '-a', String(input.pid), '--json']),
        'Immediate foreground check',
      );
      assertPhysicalRiftWindow({ windows: justBefore }, target);
      const processBeforeKey = await getProcess(input.pid);
      assertProcessIdentity(processBeforeKey, target);
      if (processBeforeKey.sessionId !== sessionId) {
        refuse('TARGET_CHANGED_BEFORE_KEY', 'Physical game session changed immediately before key');
      }
      const literal = phase === 1;
      const keys = literal ? ACTION[phase] : 'enter';
      const args = ['ui', 'send-keys', keys, '-w', String(input.hwnd), '--via', 'send-input'];
      if (literal) args.push('--verbatim');
      args.push('--json');
      // Guard a slow focus/identity check: evidence remains fresh at first key.
      const ageBeforeFirstKey = now() - Date.parse(evidence.capturedUtc ?? '');
      if (
        phase === 0 &&
        (!Number.isFinite(ageBeforeFirstKey) || ageBeforeFirstKey < -1000 || ageBeforeFirstKey > 60000)
      ) {
        refuse('CHAT_STATE_UNVERIFIED', 'Chat-closed evidence expired before the first physical RIFT key');
      }
      if (firstKeyStartedAt === null) firstKeyStartedAt = now();
      const reply = parseJson(await runner(args), 'WinApp send-input response');
      if (
        reply?.via !== 'send-input' ||
        reply?.keys !== keys ||
        Number(reply?.hwnd) !== input.hwnd ||
        reply.actionCount !== 1 ||
        !Array.isArray(reply?.warnings) ||
        reply.warnings.length !== 0 ||
        (reply.target !== undefined &&
          reply.target !== null &&
          reply.target !== '' &&
          reply.target !== 'RIFT' &&
          reply.target !== 'Window' &&
          reply.target !== current.rootSelector)
      ) {
        refuse('ACTION_RECOVERY_REQUIRED', 'Native keyboard delivery was not independently attributable');
      }
      // WinApp completion can precede the last custom-chat KeyPress event by
      // ~50 ms. Allow 500 ms after the literal command before the final Enter.
      // This does not resend keys; the next phase rechecks the target first.
      if (phase === 1) await settle(500);
    }
    return {
      submitted: true,
      sequenceCount: ACTION.length,
      targetPid: input.pid,
      targetHwnd: input.hwnd,
      senderSessionId: sessionId,
      focusPerformed: input.allowInitialFocus === true,
    };
  };
}

async function main() {
  let liveAttemptStarted = false;
  try {
    const request = parseReloadRequest(process.argv.slice(2));
    if (request.focusOnly) {
      const result = await executePhysicalFocusOnce(request);
      console.log(JSON.stringify(result));
      return;
    }
    if (request.executeOnce) {
      // The specific Workbridge capture receipt+PNG is verified, hash-pinned,
      // target-bound and <=30 seconds old BEFORE any GUI admission is acquired.
      // The explicit chat-closed-empty assertion must come from visual review.
      const evidence = await readVerifiedChatEvidence(request);
      const sender = createGuardedWinappSender({ chatClosedEvidence: evidence });
      liveAttemptStarted = true;
      const result = await executePhysicalReloadOnce(request, { sender });
      console.log(JSON.stringify(result));
      return;
    }
    if (!request.preflightOnly) {
      refuse('MODE_REQUIRED', 'Explicit --preflight-only, --focus-only or --execute-once required');
    }
    const observed = await inspectPhysicalRift(request);
    console.log(
      JSON.stringify({
        ok: true,
        readOnly: true,
        status: 'PREFLIGHT_ONLY',
        target: observed,
        inputSubmitted: false,
      }),
    );
  } catch (error) {
    console.log(
      JSON.stringify({
        ok: false,
        code: error?.code ?? 'RIFT_OPERATION_FAILED',
        message: error?.message ?? 'Unknown failure',
        inputSubmitted: liveAttemptStarted ? 'UNKNOWN_RECONCILE_INTENT' : false,
      }),
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
