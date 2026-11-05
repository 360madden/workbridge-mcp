#!/usr/bin/env node
// Bounded, targeted WinApp screenshot capture. Never sends keyboard or mouse input.
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { DesktopUiError, executeReadOnly, parseRequest, runWinapp } from './desktop-ui.mjs';
import { desktopAdmissionPath } from './desktop-turn-admission.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_EVIDENCE_ROOT = path.join(repo, '.tools', 'desktop-evidence');
const MAX_PNG_BYTES = 8 * 1024 * 1024;
const PNG_HEADER = Buffer.from('89504e470d0a1a0a', 'hex');

function fail(code, message) {
  throw new DesktopUiError(code, message);
}

export function parseCaptureRequest(argv) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      options: {
        pid: { type: 'string' },
        hwnd: { type: 'string' },
        process: { type: 'string' },
        title: { type: 'string' },
        class: { type: 'string' },
        'request-id': { type: 'string' },
      },
    }));
  } catch {
    fail('INVALID_ARGUMENTS', 'Allowed options: --pid --hwnd --process --title --class --request-id');
  }
  const target = parseRequest([
    'inspect',
    '--pid',
    values.pid ?? '',
    '--hwnd',
    values.hwnd ?? '',
    '--process',
    values.process ?? '',
    ...(values.title === undefined ? [] : ['--title', values.title]),
    '--depth',
    '1',
  ]);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(values['request-id'] ?? '')) {
    fail('INVALID_REQUEST_ID', 'request-id must have 8-64 alphanumeric/underscore/hyphen characters');
  }
  if (values.class !== undefined && !/^[A-Za-z0-9_.-]{1,100}$/.test(values.class)) {
    fail('INVALID_ARGUMENTS', 'Invalid expected window class');
  }
  return { target, expectedClass: values.class ?? null, requestId: values['request-id'] };
}

export function assertVisibleTarget(preflight, expectedClass = null) {
  const window = preflight.target;
  if (expectedClass !== null && window.className !== expectedClass) {
    fail('STALE_TARGET', 'Window class changed');
  }
  if (
    !Number.isFinite(window.width) ||
    window.width < 256 ||
    !Number.isFinite(window.height) ||
    window.height < 40
  ) {
    fail('TARGET_NOT_VISIBLE', 'Window is too small or minimized; screenshot may change its state');
  }
  const treeWindow = preflight.tree.windows.find((w) => Number(w.hwnd) === window.hwnd);
  const root = treeWindow?.elements?.[0];
  if (!root || root.isOffscreen || root.width <= 0 || root.height <= 0) {
    fail('TARGET_NOT_VISIBLE', 'UIA root is missing, offscreen, or minimized');
  }
  return window;
}

export function verifyPng(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 45 || !bytes.subarray(0, 8).equals(PNG_HEADER)) {
    fail('INVALID_PNG', 'Screenshot did not contain a PNG signature and image chunks');
  }
  if (bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') {
    fail('INVALID_PNG', 'Screenshot has no valid IHDR chunk');
  }
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  if (
    width < 1 ||
    height < 1 ||
    width > 10000 ||
    height > 10000 ||
    !bytes.includes(Buffer.from('IEND'), 29)
  ) {
    fail('INVALID_PNG', 'Screenshot dimensions or ending chunk are invalid');
  }
  return { width, height };
}

async function readVerifiedEvidence(filename) {
  const info = await lstat(filename);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.nlink !== 1 ||
    info.size < 45 ||
    info.size > MAX_PNG_BYTES
  ) {
    fail('CAPTURE_BOUNDS', 'Screenshot file exceeded bounded image size');
  }
  const image = await readFile(filename);
  return {
    ...verifyPng(image),
    sizeBytes: image.length,
    sha256: createHash('sha256').update(image).digest('hex'),
  };
}

function parseCliJson(output) {
  try {
    return JSON.parse(output);
  } catch {
    fail('INVALID_WINAPP_JSON', 'Screenshot response was not JSON');
  }
}

export async function captureWindow(
  request,
  { runner = runWinapp, evidenceRoot = DEFAULT_EVIDENCE_ROOT } = {},
) {
  // The evidence directory is fixed in production and never caller-supplied from the CLI.
  const imagePath = path.join(evidenceRoot, 'capture-' + request.requestId + '.png');
  const receiptPath = path.join(evidenceRoot, 'capture-' + request.requestId + '.json');
  await mkdir(evidenceRoot, { recursive: true });
  let prior = null;
  try {
    const info = await lstat(receiptPath);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.nlink !== 1 ||
      info.size < 2 ||
      info.size > 64 * 1024
    ) {
      fail('CAPTURE_RECOVERY_REQUIRED', 'Existing receipt is not a bounded regular file');
    }
    prior = JSON.parse(await readFile(receiptPath, 'utf8'));
    if (!prior || typeof prior !== 'object' || Array.isArray(prior)) {
      fail('CAPTURE_RECOVERY_REQUIRED', 'Existing receipt has invalid shape');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') fail('CAPTURE_RECOVERY_REQUIRED', 'Existing receipt is unreadable');
  }
  if (prior) {
    if (
      prior.pid !== request.target.pid ||
      prior.hwnd !== request.target.hwnd ||
      prior.process !== request.target.process ||
      prior.expectedClass !== request.expectedClass
    ) {
      fail('REQUEST_ID_CONFLICT', 'Request ID already belongs to another target');
    }
    const evidence = await readVerifiedEvidence(imagePath);
    if (
      prior.schemaVersion !== 1 ||
      prior.requestId !== request.requestId ||
      typeof prior.title !== 'string' ||
      prior.title.length > 200 ||
      (request.target.title != null && prior.title !== request.target.title) ||
      prior.inputInjected !== false ||
      prior.foregroundMayChange !== true ||
      prior.imagePath !== imagePath ||
      prior.width !== evidence.width ||
      prior.height !== evidence.height ||
      prior.sizeBytes !== evidence.sizeBytes ||
      prior.sha256 !== evidence.sha256
    ) {
      fail('CAPTURE_RECOVERY_REQUIRED', 'Existing receipt or image evidence changed; refusing recapture');
    }
    return { ...prior, ok: true, replayed: true };
  }
  try {
    await lstat(imagePath);
    fail('CAPTURE_RECOVERY_REQUIRED', 'Image exists without receipt; do not overwrite or retry blindly');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const preflight = await executeReadOnly(request.target, runner);
  const target = assertVisibleTarget(preflight, request.expectedClass);
  // A second recent enumeration narrows the stale-handle window before capture.
  const latest = parseCliJson(await runner(['ui', 'list-windows', '-a', String(target.pid), '--json']));
  if (
    !Array.isArray(latest) ||
    !latest.some(
      (w) =>
        Number(w.hwnd) === target.hwnd &&
        Number(w.processId) === target.pid &&
        String(w.processName).toLowerCase() === target.process.toLowerCase() &&
        String(w.className) === target.className &&
        String(w.title ?? '') === target.title,
    )
  ) {
    fail('STALE_TARGET', 'Target identity changed before screenshot');
  }
  const result = parseCliJson(
    await runner(['ui', 'screenshot', '-w', String(target.hwnd), '--output', imagePath, '--json']),
  );
  if (
    Number(result.hwnd) !== target.hwnd ||
    Number(result.processId) !== target.pid ||
    path.resolve(String(result.filePath)) !== path.resolve(imagePath)
  ) {
    fail('CAPTURE_TARGET_MISMATCH', 'Capture metadata did not match requested window');
  }
  const evidence = await readVerifiedEvidence(imagePath);
  if (evidence.width !== Number(result.width) || evidence.height !== Number(result.height)) {
    fail('CAPTURE_DIMENSION_MISMATCH', 'PNG dimensions differ from WinApp metadata');
  }
  const receipt = {
    schemaVersion: 1,
    requestId: request.requestId,
    pid: target.pid,
    hwnd: target.hwnd,
    process: request.target.process,
    expectedClass: request.expectedClass,
    title: target.title,
    capturedUtc: new Date().toISOString(),
    imagePath,
    ...evidence,
    inputInjected: false,
    foregroundMayChange: true,
  };
  try {
    await writeFile(receiptPath, JSON.stringify(receipt) + '\n', { flag: 'wx' });
  } catch {
    fail('CAPTURE_RECOVERY_REQUIRED', 'Screenshot exists but receipt could not be committed');
  }
  return { ok: true, replayed: false, ...receipt };
}

// The CLI is child-owned by the MCP capture turn; it never acquires a second
// admission (which would deadlock). Standalone shell invocations fail closed.
// VMware imports captureWindow() only while its own guarded turn is active.
async function readParentStamp(filename) {
  let before;
  let after;
  let bytes;
  try {
    before = await lstat(filename);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.nlink !== 1 ||
      before.size < 2 ||
      before.size > 4096
    ) {
      fail('UI_TURN_RECOVERY_REQUIRED', 'Desktop parent turn has invalid file identity');
    }
    bytes = await readFile(filename);
    after = await lstat(filename);
  } catch {
    fail('UI_TURN_RECOVERY_REQUIRED', 'Desktop parent turn is missing or unreadable');
  }
  if (
    bytes.length !== before.size ||
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.mtimeMs !== after.mtimeMs ||
    before.ctimeMs !== after.ctimeMs ||
    before.size !== after.size
  ) {
    fail('UI_TURN_RECOVERY_REQUIRED', 'Desktop parent turn changed during inspection');
  }
  try {
    const stamp = JSON.parse(bytes.toString('utf8'));
    if (!stamp || typeof stamp !== 'object' || Array.isArray(stamp)) throw new Error('stamp');
    return stamp;
  } catch {
    fail('UI_TURN_RECOVERY_REQUIRED', 'Desktop parent turn stamp is malformed');
  }
}

export async function captureWindowUnderParentTurn(
  request,
  { runner = runWinapp, evidenceRoot = DEFAULT_EVIDENCE_ROOT, parentPid = process.ppid } = {},
) {
  if (
    !Number.isSafeInteger(parentPid) ||
    parentPid < 1 ||
    !request?.target ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(request.requestId ?? '')
  ) {
    fail('UI_TURN_RECOVERY_REQUIRED', 'Desktop capture has no valid parent identity');
  }
  const lockPath = path.join(evidenceRoot, 'desktop-input-turn.lock');
  // Admission and GUI turn are separately authenticated. A lock merely existing
  // (especially November 2's quarantined lock) is never permission to act.
  const admission = await readParentStamp(desktopAdmissionPath(lockPath));
  const guiTurn = await readParentStamp(lockPath);
  const uuid = (value) =>
    typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
  if (
    admission.schemaVersion !== 1 ||
    admission.kind !== 'workbridge.gui-admission' ||
    !uuid(admission.admissionId) ||
    admission.mode !== 'producer' ||
    admission.producer !== 'desktop-capture-window' ||
    admission.requestId !== request.requestId ||
    admission.owner?.pid !== parentPid ||
    guiTurn.schemaVersion !== 1 ||
    guiTurn.kind !== 'workbridge.gui-turn' ||
    !uuid(guiTurn.leaseId) ||
    guiTurn.producer !== 'desktop-capture-window' ||
    guiTurn.requestId !== request.requestId ||
    guiTurn.owner?.pid !== parentPid ||
    guiTurn.target?.kind !== 'window' ||
    guiTurn.target.pid !== request.target.pid ||
    guiTurn.target.hwnd !== request.target.hwnd ||
    guiTurn.target.process !== request.target.process
  ) {
    fail('UI_TURN_RECOVERY_REQUIRED', 'Desktop capture has no matching live parent-owned turn');
  }
  let entries;
  try {
    entries = await readdir(evidenceRoot);
  } catch {
    fail('UI_TURN_RECOVERY_REQUIRED', 'Desktop quarantine directory cannot be inspected');
  }
  if (entries.some((name) => name.startsWith('desktop-turn-quarantine-') && name.endsWith('.json'))) {
    fail('UI_TURN_RECOVERY_REQUIRED', 'Desktop quarantine vetoes the parent-owned capture turn');
  }
  // Parent retains both locks until this child settles and its own process tree
  // is confirmed stopped; a forced/uncertain exit quarantines the parent's turn.
  return captureWindow(request, { runner, evidenceRoot });
}

async function main() {
  try {
    const request = parseCaptureRequest(process.argv.slice(2));
    process.stdout.write(JSON.stringify(await captureWindowUnderParentTurn(request)) + '\n');
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        inputInjected: false,
        error: {
          code: error instanceof DesktopUiError ? error.code : 'UNEXPECTED_FAILURE',
          message: String(error.message).slice(0, 600),
        },
      }) + '\n',
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
