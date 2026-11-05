// Atomic cross-process admission for every desktop GUI producer and maintenance operator.
// Admission is independent of the older desktop-input-turn.lock and quarantine sidecars.
// Never remove an admission stamp by age or assume a different process has stopped.
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';

const HELD = new WeakMap();
const NAME = 'desktop-turn-admission.lock';

export class DesktopAdmissionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DesktopAdmissionError';
    this.code = code;
  }
}

function refusal(code, message) {
  throw new DesktopAdmissionError(code, message);
}

export function desktopAdmissionPath(guiLockPath) {
  if (
    typeof guiLockPath !== 'string' ||
    !path.isAbsolute(guiLockPath) ||
    path.basename(guiLockPath) !== 'desktop-input-turn.lock'
  ) {
    refusal('UI_TURN_RECOVERY_REQUIRED', 'A canonical absolute desktop turn lock is required');
  }
  return path.join(path.dirname(guiLockPath), NAME);
}

function validateOwner({ producer, requestId, mode }) {
  if (
    !['producer', 'maintenance'].includes(mode) ||
    typeof producer !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/.test(producer) ||
    (requestId !== null &&
      (typeof requestId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(requestId))) ||
    (mode === 'maintenance' && (producer !== 'desktop-maintenance' || requestId === null))
  ) {
    refusal('UI_TURN_RECOVERY_REQUIRED', 'Invalid desktop admission owner metadata');
  }
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

// The sole admission point is O_EXCL (wx); contenders, including maintenance, fail closed.
// Acquiring this gate does NOT clear or override the independent GUI-turn quarantine.
export async function acquireDesktopAdmission(
  guiLockPath,
  { producer, requestId = null, mode = 'producer' },
) {
  validateOwner({ producer, requestId, mode });
  const filename = desktopAdmissionPath(guiLockPath);
  await mkdir(path.dirname(filename), { recursive: true });
  let handle;
  try {
    handle = await open(filename, 'wx', 0o600);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      refusal('UI_TURN_BUSY', 'Desktop admission is owned by another producer or maintenance');
    }
    throw error;
  }

  // The file is already an exclusive veto before the first byte of the stamp is written.
  // Any failure after creation intentionally leaves the file for manual reconciliation.
  const stamp = {
    schemaVersion: 1,
    kind: 'workbridge.gui-admission',
    admissionId: randomUUID(),
    mode,
    producer,
    requestId,
    owner: { pid: process.pid },
    acquiredUtc: new Date().toISOString(),
  };
  const bytes = Buffer.from(JSON.stringify(stamp) + '\n', 'utf8');
  let original;
  try {
    original = await handle.stat();
    if (bytes.length > 4096) {
      refusal('UI_TURN_RECOVERY_REQUIRED', 'Desktop admission stamp exceeds 4 KiB');
    }
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  const lease = Object.freeze({ filename, admissionId: stamp.admissionId, mode });
  HELD.set(lease, { original, fingerprint: digest(bytes), size: bytes.length });
  return lease;
}

export async function acquireDesktopMaintenanceAdmission(guiLockPath, requestId) {
  return acquireDesktopAdmission(guiLockPath, {
    producer: 'desktop-maintenance',
    requestId,
    mode: 'maintenance',
  });
}

// Ownership is validated against creation identity AND exact bytes before guarded unlink.
// No stale-timeout release, force override, or cleanup of a foreign/replaced file.
export async function releaseDesktopAdmission(lease) {
  const owned = lease && HELD.get(lease);
  if (!owned)
    refusal('UI_TURN_RECOVERY_REQUIRED', 'Desktop admission ownership is not valid or already released');
  let before;
  let after;
  let bytes;
  try {
    before = await lstat(lease.filename);
    bytes = await readFile(lease.filename);
    after = await lstat(lease.filename);
  } catch {
    refusal(
      'UI_TURN_RECOVERY_REQUIRED',
      'Desktop admission is missing or unreadable; manual reconciliation required',
    );
  }
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    before.dev !== owned.original.dev ||
    before.ino !== owned.original.ino ||
    after.dev !== before.dev ||
    after.ino !== before.ino ||
    before.size !== owned.size ||
    after.size !== before.size ||
    before.mtimeMs !== after.mtimeMs ||
    before.ctimeMs !== after.ctimeMs ||
    digest(bytes) !== owned.fingerprint
  ) {
    refusal('UI_TURN_RECOVERY_REQUIRED', 'Desktop admission owner changed; foreign lock preserved');
  }
  try {
    await unlink(lease.filename);
  } catch {
    refusal('UI_TURN_RECOVERY_REQUIRED', 'Desktop admission release failed; review required');
  }
  HELD.delete(lease);
}

export async function withDesktopAdmission(guiLockPath, owner, action) {
  if (typeof action !== 'function') {
    refusal('UI_TURN_RECOVERY_REQUIRED', 'Desktop admission requires a bounded action');
  }
  const lease = await acquireDesktopAdmission(guiLockPath, owner);
  try {
    return await action();
  } finally {
    await releaseDesktopAdmission(lease);
  }
}
