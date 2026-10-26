#!/usr/bin/env node
// Inspection only: never capture, replay, restore, minimize, acquire a lease, or write evidence.
import { createHash } from 'node:crypto';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyPng } from './desktop-capture.mjs';
import { executeReadOnly, runWinapp } from './desktop-ui.mjs';
import { assertVmAndWindow, parseVmwareCaptureRequest, readRunningVmList } from './vmware-host-capture.mjs';

const DEFAULT_ROOT = fileURLToPath(new URL('../.tools/desktop-evidence', import.meta.url));
const MAX_JSON_BYTES = 64 * 1024;
const MAX_PNG_BYTES = 8 * 1024 * 1024;
const MAX_WINAPP_BYTES = 384 * 1024;

class InspectionError extends Error {
  constructor(code, status = 'unsafe-mismatch') {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function requireEvidence(condition, code) {
  if (!condition) throw new InspectionError(code);
}

// Reject junctions/symlinks in every component, including the supplied evidence root.
async function checkedPath(filename, directory = false) {
  const absolute = path.resolve(filename);
  const root = path.parse(absolute).root;
  let current = root;
  const parts = absolute.slice(root.length).split(path.sep).filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    const info = await lstat(current);
    requireEvidence(!info.isSymbolicLink(), 'EVIDENCE_LINK_REJECTED');
    if (i < parts.length - 1 || directory) {
      requireEvidence(info.isDirectory(), 'EVIDENCE_PATH_MISMATCH');
    } else {
      requireEvidence(info.isFile(), 'EVIDENCE_NOT_FILE');
      requireEvidence(info.nlink === 1, 'EVIDENCE_LINK_REJECTED');
    }
  }
  requireEvidence((await realpath(absolute)) === absolute, 'EVIDENCE_PATH_MISMATCH');
  return await lstat(absolute);
}

function unchanged(a, b) {
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeMs === b.mtimeMs &&
    a.ctimeMs === b.ctimeMs
  );
}

async function readBounded(filename, limit, json = true) {
  let handle;
  try {
    const before = await checkedPath(filename);
    requireEvidence(before.size > 0 && before.size <= limit, 'EVIDENCE_BOUNDS');
    handle = await open(filename, 'r');
    requireEvidence(unchanged(before, await handle.stat()), 'EVIDENCE_CHANGED');
    // A single bounded read cannot allocate unbounded memory if a file grows concurrently.
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    requireEvidence(length === before.size, 'EVIDENCE_CHANGED');
    requireEvidence(unchanged(before, await handle.stat()), 'EVIDENCE_CHANGED');
    requireEvidence(unchanged(before, await checkedPath(filename)), 'EVIDENCE_CHANGED');
    const bytes = buffer.subarray(0, length);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (!json) return { bytes, sha256, sizeBytes: length };
    let value;
    try {
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      throw new InspectionError('INVALID_EVIDENCE_JSON');
    }
    requireEvidence(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_EVIDENCE_JSON');
    return { value, sha256, sizeBytes: length };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  } finally {
    await handle?.close();
  }
}

function validTime(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function validateIdentity(value, request, host) {
  requireEvidence(
    value.schemaVersion === 1 &&
      value.requestId === request.requestId &&
      value.pid === request.target.pid &&
      value.hwnd === request.target.hwnd &&
      value.expectedClass === request.expectedClass &&
      (host
        ? value.vmx === request.vmx
        : value.process === request.target.process && value.title === request.target.title),
    'EVIDENCE_TARGET_MISMATCH',
  );
}

function validateIntent(value, request) {
  validateIdentity(value, request, true);
  requireEvidence(
    ['visible', 'minimized'].includes(value.originalWindowState) && validTime(value.startedUtc),
    'INVALID_CAPTURE_INTENT',
  );
}

function validateImageReceipt(value, image, imagePath) {
  requireEvidence(
    typeof value.imagePath === 'string' &&
      path.isAbsolute(value.imagePath) &&
      path.resolve(value.imagePath) === imagePath &&
      value.sha256 === image.sha256 &&
      value.sizeBytes === image.sizeBytes &&
      value.width === image.width &&
      value.height === image.height,
    'IMAGE_EVIDENCE_MISMATCH',
  );
}

async function leaseExists(filename) {
  try {
    await checkedPath(filename);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

// The recovery inspector never trusts a stamp as proof that its process still owns a
// Windows session. It only classifies immutable, bounded evidence and never clears a lease.
const leaseResult = (state, reason, extra = {}) => ({
  state,
  reason,
  ownerVerified: false,
  releaseEligible: false,
  ...extra,
});

async function classifyLease(root, leasePath, request, intent) {
  let info;
  try {
    info = await checkedPath(leasePath);
  } catch (error) {
    if (error.code === 'ENOENT') return leaseResult('changed', 'DESKTOP_TURN_CHANGED');
    throw error;
  }
  if (info.size === 0) return leaseResult('legacy', 'DESKTOP_TURN_UNATTRIBUTED');
  if (info.size > 4096) return leaseResult('invalid', 'INVALID_DESKTOP_LEASE');
  const saved = await readBounded(leasePath, 4096, false);
  if (!saved) return leaseResult('changed', 'DESKTOP_TURN_CHANGED');
  let stamp;
  try {
    stamp = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(saved.bytes));
  } catch {
    const prefix = saved.bytes.toString('utf8').trimStart();
    return prefix.startsWith('{')
      ? leaseResult('invalid', 'INVALID_DESKTOP_LEASE')
      : leaseResult('foreign', 'DESKTOP_TURN_BUSY');
  }
  if (
    !stamp ||
    typeof stamp !== 'object' ||
    Array.isArray(stamp) ||
    stamp.schemaVersion !== 1 ||
    stamp.kind !== 'workbridge.gui-turn' ||
    typeof stamp.leaseId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(stamp.leaseId) ||
    !Number.isSafeInteger(stamp.owner?.pid) ||
    stamp.owner.pid <= 0 ||
    !validTime(stamp.acquiredUtc)
  ) {
    return leaseResult('invalid', 'INVALID_DESKTOP_LEASE');
  }
  const matching =
    stamp.producer === 'vmware-host-capture' &&
    stamp.requestId === request.requestId &&
    stamp.target?.kind === 'vmware-host-window' &&
    stamp.target?.pid === request.target.pid &&
    stamp.target?.hwnd === request.target.hwnd &&
    stamp.target?.vmx === request.vmx;
  if (!matching) return leaseResult('foreign', 'DESKTOP_TURN_BUSY');
  const identity = { leaseId: stamp.leaseId, requestMatches: true };
  if (intent?.value?.leaseId !== stamp.leaseId) {
    return leaseResult('changed', 'LEASE_ID_MISMATCH', identity);
  }
  const quarantine = await readBounded(
    path.join(root, 'desktop-turn-quarantine-' + stamp.leaseId + '.json'),
    4096,
  );
  if (!quarantine) return leaseResult('active', 'DESKTOP_TURN_ACTIVE', identity);
  if (
    quarantine.value.kind !== 'workbridge.gui-turn-quarantine' ||
    quarantine.value.schemaVersion !== 1 ||
    quarantine.value.leaseId !== stamp.leaseId ||
    quarantine.value.requestId !== request.requestId ||
    quarantine.value.ownerStampSha256 !== saved.sha256 ||
    quarantine.value.intentSha256 !== intent.sha256 ||
    quarantine.value.automaticRetryAllowed !== false
  ) {
    return leaseResult('changed', 'LEASE_ID_MISMATCH', identity);
  }
  return leaseResult('quarantined', 'QUARANTINED_CAPTURE_REQUIRES_RELEASE', identity);
}

async function orphanQuarantineExists(root) {
  const entries = await readdir(root, { withFileTypes: true });
  requireEvidence(entries.length <= 4096, 'EVIDENCE_BOUNDS');
  return entries.some((entry) => /^desktop-turn-quarantine-[0-9a-f-]{36}\.json$/.test(entry.name));
}

function canonicalRequest(request) {
  const canonical = parseVmwareCaptureRequest([
    '--pid',
    String(request?.target?.pid ?? ''),
    '--hwnd',
    String(request?.target?.hwnd ?? ''),
    '--request-id',
    request?.requestId ?? '',
  ]);
  requireEvidence(
    request.vmx === canonical.vmx &&
      request.expectedClass === canonical.expectedClass &&
      Object.keys(canonical.target).every((key) => request.target[key] === canonical.target[key]),
    'INVALID_RECOVERY_REQUEST',
  );
  return canonical;
}

/**
 * Read-only classification of a legacy host-capture journal. `recoverable` means
 * verified pixels and original window state permit a separate, explicit journal
 * reconciliation review. It never authorizes resending capture or window input.
 * Legacy intents do not record process creation time, so PID reuse cannot be proved absent.
 */
export async function inspectVmwareHostCaptureRecovery(
  request,
  { runner = runWinapp, vmLister = readRunningVmList, evidenceRoot = DEFAULT_ROOT } = {},
) {
  const result = {
    schemaVersion: 1,
    ok: false,
    readOnly: true,
    status: 'manual-review',
    automaticRetryAllowed: false,
    guestInputInjected: false,
    windowActionsPerformed: false,
    evidence: [],
  };
  try {
    request = canonicalRequest(request);
    result.requestId = request.requestId;
    result.target = { vmx: request.vmx, pid: request.target.pid, hwnd: request.target.hwnd };
    const root = path.resolve(evidenceRoot);
    await checkedPath(root, true);
    const names = [
      `vm-host-capture-${request.requestId}.intent.json`,
      `vm-host-capture-${request.requestId}.json`,
      `capture-${request.requestId}.json`,
      `capture-${request.requestId}.png`,
    ];
    const leasePath = path.join(root, 'desktop-input-turn.lock');
    // A held lease forbids live backend probes, but must not hide inspectable saved evidence.
    const leaseAtStart = await leaseExists(leasePath);
    const records = [];
    for (const [i, name] of names.entries()) {
      const record = await readBounded(
        path.join(root, name),
        i === 3 ? MAX_PNG_BYTES : MAX_JSON_BYTES,
        i !== 3,
      );
      records.push(record);
      if (record) result.evidence.push({ name, sha256: record.sha256, sizeBytes: record.sizeBytes });
    }
    const [intent, receipt, captureReceipt, png] = records;
    if (!intent) {
      requireEvidence(!receipt && !captureReceipt && !png, 'ORPHANED_CAPTURE_EVIDENCE');
      return { ...result, reason: 'CAPTURE_INTENT_MISSING' };
    }
    validateIntent(intent.value, request);
    result.originalWindowState = intent.value.originalWindowState;
    if (captureReceipt) {
      validateIdentity(captureReceipt.value, request, false);
      requireEvidence(
        captureReceipt.value.inputInjected === false &&
          captureReceipt.value.foregroundMayChange === true &&
          validTime(captureReceipt.value.capturedUtc) &&
          Date.parse(captureReceipt.value.capturedUtc) >= Date.parse(intent.value.startedUtc),
        'INVALID_IMAGE_RECEIPT',
      );
    }
    if (receipt) {
      validateIntent(receipt.value, request);
      requireEvidence(
        receipt.value.startedUtc === intent.value.startedUtc &&
          receipt.value.originalWindowState === intent.value.originalWindowState &&
          receipt.value.finalWindowState === intent.value.originalWindowState &&
          validTime(receipt.value.completedUtc) &&
          Date.parse(receipt.value.completedUtc) >= Date.parse(intent.value.startedUtc) &&
          receipt.value.guestInputInjected === false &&
          receipt.value.vmrunPasswordUsed === false &&
          (intent.value.originalWindowState === 'visible'
            ? receipt.value.stateRecovery === 'not-needed'
            : ['minimized', 'already-minimized'].includes(receipt.value.stateRecovery)),
        'INVALID_HOST_RECEIPT',
      );
      requireEvidence(captureReceipt && png, 'COMPLETED_EVIDENCE_MISSING');
    }
    if (captureReceipt) requireEvidence(png, 'IMAGE_EVIDENCE_MISSING');
    if (png) {
      let dimensions;
      try {
        dimensions = verifyPng(png.bytes);
      } catch {
        throw new InspectionError('INVALID_CAPTURE_PNG');
      }
      const image = { ...png, ...dimensions };
      if (captureReceipt) validateImageReceipt(captureReceipt.value, image, path.join(root, names[3]));
      if (receipt) validateImageReceipt(receipt.value, image, path.join(root, names[3]));
    }
    if (receipt && captureReceipt) {
      requireEvidence(
        Date.parse(receipt.value.completedUtc) >= Date.parse(captureReceipt.value.capturedUtc),
        'INVALID_HOST_RECEIPT',
      );
    }
    if (leaseAtStart || (await leaseExists(leasePath))) {
      const lease = await classifyLease(root, leasePath, request, intent);
      return { ...result, reason: lease.reason, lease, evidenceCheckedOffline: true };
    }
    if (await orphanQuarantineExists(root)) {
      return {
        ...result,
        reason: 'ORPHANED_QUARANTINE_RECORD',
        lease: leaseResult('changed', 'ORPHANED_QUARANTINE_RECORD'),
        evidenceCheckedOffline: true,
      };
    }

    const running = await vmLister();
    requireEvidence(
      Array.isArray(running) &&
        running.length <= 1000 &&
        running.every((item) => typeof item === 'string' && item.length <= 4096) &&
        Buffer.byteLength(JSON.stringify(running)) <= 16384,
      'INVALID_VM_INVENTORY',
    );
    requireEvidence(
      running.some((vmx) => vmx.toLowerCase() === request.vmx.toLowerCase()),
      'VM_NOT_RUNNING',
    );
    // Only these exact read-only calls can reach the injected/installed WinApp backend.
    const allowedCalls = [
      ['--version'],
      ['ui', 'list-windows', '-a', String(request.target.pid), '--json'],
      ['ui', 'inspect', '-w', String(request.target.hwnd), '--depth', '2', '--json'],
    ];
    let callIndex = 0;
    const guardedRunner = async (args) => {
      requireEvidence(
        JSON.stringify(args) === JSON.stringify(allowedCalls[callIndex++]),
        'UNSAFE_BACKEND_CALL',
      );
      const output = await runner(args);
      requireEvidence(
        typeof output === 'string' && Buffer.byteLength(output) <= MAX_WINAPP_BYTES,
        'WINAPP_OUTPUT_BOUNDS',
      );
      return output;
    };
    const preflight = await executeReadOnly(request.target, guardedRunner);
    const observed = assertVmAndWindow(request, running, preflight);
    requireEvidence(
      [observed.target.width, observed.target.height, observed.root.width, observed.root.height].every(
        (value) => Number.isFinite(value) && value > 0,
      ) && typeof observed.root.isOffscreen === 'boolean',
      'INVALID_WINDOW_GEOMETRY',
    );
    result.backend = { name: preflight.backend, version: preflight.version };
    result.currentWindowState = observed.state;
    result.processStartIdentityVerified = false;
    // Detect concurrent evidence changes; inspection never owns or clears the shared lease.
    for (const [i, name] of names.entries()) {
      const current = await readBounded(
        path.join(root, name),
        i === 3 ? MAX_PNG_BYTES : MAX_JSON_BYTES,
        i !== 3,
      );
      requireEvidence((current?.sha256 ?? null) === (records[i]?.sha256 ?? null), 'EVIDENCE_CHANGED');
    }
    if (await leaseExists(leasePath)) return { ...result, reason: 'DESKTOP_TURN_BUSY' };
    if (observed.state !== intent.value.originalWindowState) {
      return { ...result, reason: 'WINDOW_STATE_REQUIRES_REVIEW' };
    }
    if (!captureReceipt || !png) {
      return { ...result, reason: png ? 'IMAGE_RECEIPT_MISSING' : 'CAPTURE_INCOMPLETE' };
    }
    return {
      ...result,
      ok: true,
      status: receipt ? 'completed' : 'recoverable',
      reason: receipt ? 'VERIFIED_COMPLETED_CAPTURE' : 'VERIFIED_EVIDENCE_REQUIRES_EXPLICIT_RECONCILIATION',
    };
  } catch (error) {
    if (error instanceof InspectionError) {
      return { ...result, status: error.status, reason: error.code };
    }
    const unsafe = new Set([
      'STALE_TARGET',
      'STALE_VM_WINDOW',
      'INVALID_TARGET',
      'INVALID_REQUEST_ID',
      'INVALID_ARGUMENTS',
    ]);
    return {
      ...result,
      status: unsafe.has(error.code) ? 'unsafe-mismatch' : 'manual-review',
      reason: unsafe.has(error.code) ? error.code : 'INSPECTION_UNAVAILABLE',
    };
  }
}

async function main() {
  let result;
  try {
    result = await inspectVmwareHostCaptureRecovery(parseVmwareCaptureRequest(process.argv.slice(2)));
  } catch {
    result = {
      ok: false,
      readOnly: true,
      status: 'unsafe-mismatch',
      automaticRetryAllowed: false,
      reason: 'INVALID_RECOVERY_REQUEST',
    };
  }
  process.stdout.write(JSON.stringify(result) + '\n');
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
