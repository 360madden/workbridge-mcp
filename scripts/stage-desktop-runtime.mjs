#!/usr/bin/env node
// Build-time only. Never run this against an active installation's dist.
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const DESKTOP_RUNTIME_FILES = Object.freeze([
  'desktop-ui.mjs',
  'desktop-capture.mjs',
  'vmware-host-capture.mjs',
  'desktop-probe-act.mjs',
  'Check-DesktopWindowHandle.ps1',
]);
export const DESKTOP_RUNTIME_MANIFEST = 'desktop-runtime-manifest.json';
const LOCK = '.desktop-runtime-stage.lock';
const MAX_BYTES = 1024 * 1024;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (code) => {
  throw Object.assign(new Error(code), { code });
};
const sameIdentity = (a, b) => a?.dev === b?.dev && a?.ino === b?.ino;
const sameStat = (a, b) =>
  sameIdentity(a, b) && a?.size === b?.size && a?.mtimeNs === b?.mtimeNs && a?.ctimeNs === b?.ctimeNs;
const manifestBytes = (files) => Buffer.from(JSON.stringify({ schemaVersion: 1, files }, null, 2) + '\n');

async function stat(filename, optional = false, isDirectory = false) {
  let info;
  try {
    info = await lstat(filename, { bigint: true });
  } catch (error) {
    if (optional && error.code === 'ENOENT') return null;
    throw error;
  }
  if (info.isSymbolicLink() || (isDirectory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1n))
    fail('DESKTOP_STAGE_UNSAFE_PATH');
  return info;
}

// Check the opened file AND its directory entry; never accept a link replacement.
async function read(filename, optional = false) {
  const before = await stat(filename, optional);
  if (!before) return null;
  if (before.size < 1n || before.size > BigInt(MAX_BYTES)) fail('DESKTOP_STAGE_FILE_BOUNDS');
  const handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    if (!sameStat(before, await handle.stat({ bigint: true }))) fail('DESKTOP_STAGE_FILE_CHANGED');
    // Bounded allocation even if another process grows a file after the size check.
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let length = 0;
    while (length < buffer.length) {
      const result = await handle.read(buffer, length, buffer.length - length, length);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    const after = await stat(filename);
    if (
      length !== Number(before.size) ||
      !sameStat(before, after) ||
      !sameStat(before, await handle.stat({ bigint: true }))
    )
      fail('DESKTOP_STAGE_FILE_CHANGED');
    return { bytes: buffer.subarray(0, length), info: after };
  } finally {
    await handle.close();
  }
}

function equalSnapshot(a, b) {
  return a === null || b === null ? a === b : sameStat(a.info, b.info) && a.bytes.equals(b.bytes);
}

/** Byte-preserving fixed closure, deterministic manifest, manifest-last publication.
 * Each rename is atomic; the set of files is NOT an atomic directory swap. The
 * exclusive durable lock rejects concurrent/restarted stages. Caught failures
 * restore the prior bytes; process death leaves lock/backups for manual recovery
 * and rejects replay. Consumers/sealers must reject a lock or invalid manifest.
 * This detects filesystem races; it is not an adversarial same-user OS sandbox.
 */
export async function stageDesktopRuntime({
  repoRoot = fileURLToPath(new URL('..', import.meta.url)),
  timeoutMs = 10_000,
  // Offline fault injection only; never exposed by the CLI.
  onCheckpoint = async () => {},
} = {}) {
  if (
    typeof repoRoot !== 'string' ||
    !repoRoot ||
    !path.isAbsolute(repoRoot) ||
    repoRoot.includes('\0') ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 45_000 ||
    typeof onCheckpoint !== 'function'
  )
    fail('DESKTOP_STAGE_INVALID_ARGUMENTS');
  const root = path.resolve(repoRoot);
  const source = path.join(root, 'scripts');
  const target = path.join(root, 'dist');
  const deadline = Date.now() + timeoutMs;
  const normalize = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);
  const directories = new Map();
  const operationId = randomUUID();
  const artifacts = new Map();
  const installed = [];
  let lock;
  let keepEvidence = false;
  const check = () => {
    if (Date.now() >= deadline) fail('DESKTOP_STAGE_TIMEOUT');
  };
  const layout = async (bounded = true) => {
    if (bounded) check();
    for (const directory of [root, source, target]) {
      const info = await stat(directory, false, true);
      if (
        normalize(await realpath(directory)) !== normalize(directory) ||
        (directories.has(directory) && !sameIdentity(directories.get(directory), info))
      ) {
        fail('DESKTOP_STAGE_UNSAFE_PATH');
      }
      directories.set(directory, info);
    }
    if (bounded) check();
  };
  const assertSnapshot = async (filename, expected, code) => {
    if (!equalSnapshot(await read(filename, true), expected)) fail(code);
  };
  const create = async (filename, bytes) => {
    await layout();
    const handle = await open(filename, 'wx', 0o600);
    // Register before writing so even write/sync failure can be cleaned safely.
    artifacts.set(filename, { info: await handle.stat({ bigint: true }) });
    try {
      await handle.writeFile(bytes);
      await handle.sync();
      const snapshot = await read(filename);
      if (!sameIdentity(snapshot.info, artifacts.get(filename).info) || !snapshot.bytes.equals(bytes)) {
        fail('DESKTOP_STAGE_BYTE_MISMATCH');
      }
      artifacts.set(filename, snapshot);
      return snapshot;
    } finally {
      await handle.close();
    }
  };
  const checkpoint = async (phase, name) => {
    await onCheckpoint({ phase, name });
    await layout();
    await assertSnapshot(path.join(target, LOCK), lock, 'DESKTOP_STAGE_TARGET_CHANGED');
  };

  try {
    await layout();
    // Never silently erase evidence left by an interrupted/other invocation.
    if ((await readdir(target)).some((name) => name === LOCK || name.startsWith('.desktop-stage-'))) {
      fail('DESKTOP_STAGE_RECOVERY_REQUIRED');
    }
    try {
      lock = await create(
        path.join(target, LOCK),
        Buffer.from(JSON.stringify({ schemaVersion: 1, operationId }) + '\n'),
      );
    } catch (error) {
      if (error.code === 'EEXIST') fail('DESKTOP_STAGE_RECOVERY_REQUIRED');
      throw error;
    }
    const names = [...DESKTOP_RUNTIME_FILES, DESKTOP_RUNTIME_MANIFEST];
    const previous = new Map();
    for (const name of names) previous.set(name, await read(path.join(target, name), true));
    const oldManifest = previous.get(DESKTOP_RUNTIME_MANIFEST);
    if (!oldManifest && DESKTOP_RUNTIME_FILES.some((name) => previous.get(name))) {
      fail('DESKTOP_STAGE_TAMPERED');
    }
    if (oldManifest) {
      const entries = DESKTOP_RUNTIME_FILES.map((name) => {
        const old = previous.get(name);
        if (!old) fail('DESKTOP_STAGE_TAMPERED');
        return { name, sizeBytes: old.bytes.length, sha256: hash(old.bytes) };
      });
      if (!oldManifest.bytes.equals(manifestBytes(entries))) fail('DESKTOP_STAGE_TAMPERED');
    }
    const inputs = new Map();
    for (const name of DESKTOP_RUNTIME_FILES) inputs.set(name, await read(path.join(source, name)));
    const files = [...inputs].map(([name, { bytes }]) => ({
      name,
      sizeBytes: bytes.length,
      sha256: hash(bytes),
    }));
    const manifest = manifestBytes(files);
    const desired = new Map([...inputs].map(([name, { bytes }]) => [name, bytes]));
    desired.set(DESKTOP_RUNTIME_MANIFEST, manifest);
    const assertInputs = async () => {
      for (const [name, snapshot] of inputs) {
        await assertSnapshot(path.join(source, name), snapshot, 'DESKTOP_STAGE_SOURCE_CHANGED');
      }
    };
    const assertTargets = async () => {
      for (const name of names) {
        const published = installed.find((entry) => entry.name === name);
        await assertSnapshot(
          path.join(target, name),
          published ? published.current : previous.get(name),
          'DESKTOP_STAGE_TARGET_CHANGED',
        );
      }
    };
    await checkpoint('validated');
    await assertInputs();
    await assertTargets();
    // A verified replay does not replace any executable or manifest directory entry.
    if (![...desired].every(([name, bytes]) => previous.get(name)?.bytes.equals(bytes))) {
      const staged = new Map();
      for (const [index, name] of names.entries()) {
        const temporary = path.join(target, `.desktop-stage-${operationId}-${index}.tmp`);
        const backup = path.join(target, `.desktop-stage-${operationId}-${index}.bak`);
        staged.set(name, { temporary, backup, snapshot: await create(temporary, desired.get(name)) });
      }
      await checkpoint('prepared');
      for (const name of names) {
        await checkpoint('before-publish', name);
        await assertInputs();
        await assertTargets();
        const { temporary, backup, snapshot } = staged.get(name);
        await assertSnapshot(temporary, snapshot, 'DESKTOP_STAGE_TARGET_CHANGED');
        const destination = path.join(target, name);
        const old = previous.get(name);
        const entry = { name, destination, backup, old, current: null };
        if (old) {
          if (await stat(backup, true)) fail('DESKTOP_STAGE_TARGET_CHANGED');
          await rename(destination, backup);
          installed.push(entry);
          entry.saved = await read(backup);
          if (!sameIdentity(entry.saved.info, old.info) || !entry.saved.bytes.equals(old.bytes)) {
            fail('DESKTOP_STAGE_TARGET_CHANGED');
          }
        } else installed.push(entry);
        await assertSnapshot(destination, null, 'DESKTOP_STAGE_TARGET_CHANGED');
        await rename(temporary, destination);
        artifacts.delete(temporary);
        entry.current = await read(destination);
        if (
          !sameIdentity(entry.current.info, snapshot.info) ||
          !entry.current.bytes.equals(desired.get(name))
        ) {
          fail('DESKTOP_STAGE_BYTE_MISMATCH');
        }
        await checkpoint('published', name);
      }
    }
    await checkpoint('complete');
    await assertInputs();
    await assertTargets();
    check();
    return {
      ok: true,
      files,
      manifest: { name: DESKTOP_RUNTIME_MANIFEST, sizeBytes: manifest.length, sha256: hash(manifest) },
    };
  } catch (error) {
    // Rollback ignores the expired work deadline but still validates identity.
    if (installed.length) {
      try {
        await layout(false);
        for (const entry of [...installed].reverse()) {
          await assertSnapshot(entry.destination, entry.current, 'DESKTOP_STAGE_TARGET_CHANGED');
          if (entry.old) {
            await assertSnapshot(entry.backup, entry.saved, 'DESKTOP_STAGE_TARGET_CHANGED');
            await rename(entry.backup, entry.destination);
          } else if (entry.current) await unlink(entry.destination);
        }
      } catch {
        keepEvidence = true;
        fail('DESKTOP_STAGE_RECOVERY_REQUIRED');
      }
    }
    throw error;
  } finally {
    if (!keepEvidence && artifacts.size) {
      try {
        await layout(false);
        // Lock is removed last; failed cleanup remains visibly recovery-required.
        for (const entry of installed) {
          if (await stat(entry.backup, true)) {
            await assertSnapshot(entry.backup, entry.saved, 'DESKTOP_STAGE_TARGET_CHANGED');
            await unlink(entry.backup);
          }
        }
        for (const [filename, snapshot] of [...artifacts].reverse()) {
          const current = await stat(filename, true);
          if (!current || !sameIdentity(current, snapshot.info)) fail('DESKTOP_STAGE_TARGET_CHANGED');
          if (snapshot.bytes) await assertSnapshot(filename, snapshot, 'DESKTOP_STAGE_TARGET_CHANGED');
          await unlink(filename);
        }
      } catch {
        fail('DESKTOP_STAGE_RECOVERY_REQUIRED');
      }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { values } = parseArgs({
      strict: true,
      options: { 'repo-root': { type: 'string' }, 'timeout-ms': { type: 'string' } },
    });
    const result = await stageDesktopRuntime({
      repoRoot: values['repo-root'],
      timeoutMs: values['timeout-ms'] === undefined ? undefined : Number(values['timeout-ms']),
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, code: error.code ?? 'DESKTOP_STAGE_FAILED' }));
    process.exitCode = 1;
  }
}
