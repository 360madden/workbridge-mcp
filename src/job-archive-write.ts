import { constants, type Stats } from 'node:fs';
import { lstat, mkdir, open, realpath, link, unlink, rename } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import path from 'node:path';
import { digest } from './changes.js';
import { BridgeError } from './core.js';
import { readArchivedJob } from './job-archive.js';

const compress = promisify(gzip),
  decompress = promisify(gunzip);
const idPattern = /^[A-Za-z0-9_-]{1,100}$/;
const operationPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const maxBytes = 16 * 1024 * 1024,
  maxZip = 17 * 1024 * 1024;
const failure = (code: string, message: string) => new BridgeError(code, message);
const conflict = () =>
  failure('JOB_ARCHIVE_CONFLICT', 'Job archive state is unexpected or changed; no job was rerun.');
const stamp = (s: Stats) => [s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs, s.mode, s.nlink].join(':');
const samePath = (a: string, b: string) =>
  process.platform === 'win32'
    ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
    : path.resolve(a) === path.resolve(b);
const encode = (v: unknown) => Buffer.from(JSON.stringify(v));
export type ArchiveDirection = 'compact' | 'restore';
type Descriptor = {
  schema: 'workbridge-job-archive/1';
  id: string;
  sourceSha256: string;
  sourceBytes: number;
  gzipSha256: string;
  gzipBytes: number;
};
type Marker = {
  schema: 'workbridge-job-archive-operation/1';
  jobId: string;
  operationId: string;
  direction: ArchiveDirection;
  expectedRecordSha256: string;
  resultRecordSha256: string;
  descriptor: Descriptor;
  sourceRecordBytes: number;
  resultRecordBytes: number;
};
export type ArchiveResult = {
  schemaVersion: 1;
  status: 'completed';
  jobId: string;
  operationId: string;
  direction: ArchiveDirection;
  expectedRecordSha256: string;
  resultRecordSha256: string;
  logicalBytesSaved: number;
  alreadyCompleted: boolean;
};
type Lease = { verify(name: string): Promise<void>; assertAlive(): void; close(): Promise<void> };
function markerValid(value: unknown, jobId: string): value is Marker {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).sort().join('\0') !==
    [
      'schema',
      'jobId',
      'operationId',
      'direction',
      'expectedRecordSha256',
      'resultRecordSha256',
      'descriptor',
      'sourceRecordBytes',
      'resultRecordBytes',
    ]
      .sort()
      .join('\0')
  )
    return false;
  if (
    v.schema !== 'workbridge-job-archive-operation/1' ||
    v.jobId !== jobId ||
    typeof v.operationId !== 'string' ||
    !operationPattern.test(v.operationId) ||
    !['compact', 'restore'].includes(String(v.direction)) ||
    typeof v.expectedRecordSha256 !== 'string' ||
    !hashPattern.test(v.expectedRecordSha256) ||
    typeof v.resultRecordSha256 !== 'string' ||
    !hashPattern.test(v.resultRecordSha256) ||
    !Number.isSafeInteger(v.sourceRecordBytes) ||
    !Number.isSafeInteger(v.resultRecordBytes)
  )
    return false;
  const d = v.descriptor as Record<string, unknown> | null;
  const shape =
    !!d &&
    typeof d === 'object' &&
    !Array.isArray(d) &&
    Object.keys(d).sort().join('\0') ===
      ['schema', 'id', 'sourceSha256', 'sourceBytes', 'gzipSha256', 'gzipBytes'].sort().join('\0') &&
    d.schema === 'workbridge-job-archive/1' &&
    d.id === jobId &&
    typeof d.sourceSha256 === 'string' &&
    hashPattern.test(d.sourceSha256) &&
    typeof d.gzipSha256 === 'string' &&
    hashPattern.test(d.gzipSha256) &&
    Number.isSafeInteger(d.sourceBytes) &&
    (d.sourceBytes as number) > 0 &&
    (d.sourceBytes as number) <= maxBytes &&
    Number.isSafeInteger(d.gzipBytes) &&
    (d.gzipBytes as number) > 0 &&
    (d.gzipBytes as number) <= maxZip &&
    (v.sourceRecordBytes as number) > 0 &&
    (v.sourceRecordBytes as number) <= maxBytes &&
    (v.resultRecordBytes as number) > 0 &&
    (v.resultRecordBytes as number) <= maxBytes;
  if (!shape || !d) return false;
  const descriptorBytes = encode(d);
  const expectedSavings =
    (v.sourceRecordBytes as number) -
    (v.resultRecordBytes as number) -
    (v.direction === 'compact' ? (d.gzipBytes as number) : 0) -
    2 * encode(v).length;
  if (v.direction === 'compact')
    return (
      v.expectedRecordSha256 === d.sourceSha256 &&
      v.resultRecordSha256 === digest(descriptorBytes) &&
      v.sourceRecordBytes === d.sourceBytes &&
      v.resultRecordBytes === descriptorBytes.length &&
      expectedSavings > 0
    );
  return v.resultRecordSha256 === d.sourceSha256 && v.resultRecordBytes === d.sourceBytes;
}
function asResult(m: Marker, alreadyCompleted: boolean): ArchiveResult {
  return {
    schemaVersion: 1,
    status: 'completed',
    jobId: m.jobId,
    operationId: m.operationId,
    direction: m.direction,
    expectedRecordSha256: m.expectedRecordSha256,
    resultRecordSha256: m.resultRecordSha256,
    logicalBytesSaved: savings(m),
    alreadyCompleted,
  };
}
function savings(m: Marker): number {
  return (
    m.sourceRecordBytes -
    m.resultRecordBytes -
    (m.direction === 'compact' ? m.descriptor.gzipBytes : 0) -
    2 * encode(m).length
  );
}
function validateArgs(state: string, id: string, op: string, direction: ArchiveDirection, expected: string) {
  if (
    !path.isAbsolute(state) ||
    !idPattern.test(id) ||
    !operationPattern.test(op) ||
    !['compact', 'restore'].includes(direction) ||
    !hashPattern.test(expected)
  )
    throw failure(
      'INVALID_JOB_ARCHIVE_REQUEST',
      'A job ID, operation ID, direction and exact record SHA-256 are required.',
    );
}
async function safeDirectory(file: string) {
  const root = path.parse(file).root;
  let current = root;
  for (const part of ['', ...file.slice(root.length).split(path.sep).filter(Boolean)]) {
    if (part) current = path.join(current, part);
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink() || !samePath(await realpath(current), current))
      throw conflict();
  }
}
async function readFileSafe(
  file: string,
  limit: number,
  allowedLinks = 1,
): Promise<{ bytes: Buffer; info: Stats } | null> {
  let before: Stats;
  try {
    before = await lstat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== allowedLinks ||
    before.size > limit ||
    !samePath(await realpath(file), file)
  )
    throw conflict();
  const h = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const start = await h.stat();
    if (stamp(before) !== stamp(start)) throw conflict();
    const bytes = Buffer.alloc(start.size + 1);
    let n = 0;
    while (n < bytes.length) {
      const part = await h.read(bytes, n, bytes.length - n, n);
      n += part.bytesRead;
      if (!part.bytesRead) break;
    }
    const end = await h.stat(),
      named = await lstat(file);
    if (
      n !== start.size ||
      !named.isFile() ||
      named.isSymbolicLink() ||
      stamp(start) !== stamp(end) ||
      stamp(end) !== stamp(named)
    )
      throw conflict();
    return { bytes: bytes.subarray(0, n), info: start };
  } finally {
    await h.close();
  }
}
async function privateDirectory(directory: string): Promise<Lease> {
  if (process.platform !== 'win32') {
    try {
      await mkdir(directory, { mode: 0o700 });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    const s = await lstat(directory);
    if (
      !s.isDirectory() ||
      s.isSymbolicLink() ||
      (s.mode & 0o077) !== 0 ||
      (process.getuid && s.uid !== process.getuid())
    )
      throw conflict();
    return {
      async verify(name) {
        const s = await lstat(path.join(directory, name));
        if (!s.isFile() || s.isSymbolicLink() || (s.mode & 0o077) !== 0) throw conflict();
      },
      assertAlive() {},
      async close() {},
    };
  }
  let exists = false;
  try {
    const s = await lstat(directory);
    if (!s.isDirectory() || s.isSymbolicLink()) throw conflict();
    exists = true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const powershell = path.join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const helper = fileURLToPath(new URL('./Job-Archive-Private.ps1', import.meta.url));
  const child = spawn(
    powershell,
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'RemoteSigned',
      '-File',
      helper,
      '-Directory',
      directory,
      '-Mode',
      exists ? 'Existing' : 'Create',
    ],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
  );
  let dead = false,
    failure = false,
    stderr = 0,
    stdout = 0;
  child.on('error', () => {
    failure = true;
  });
  child.stdin.on('error', () => {
    failure = true;
  });
  child.stdout.on('data', (b: Buffer) => {
    stdout += b.length;
    if (stdout > 8192) {
      failure = true;
      child.kill();
    }
  });
  child.stderr.on('data', (b: Buffer) => {
    stderr += b.length;
    if (stderr > 8192) {
      failure = true;
      child.kill();
    }
  });
  const exit = new Promise<number | null>((resolve) =>
    child.once('close', (code) => {
      dead = true;
      resolve(code);
    }),
  );
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity }),
    iter = lines[Symbol.asyncIterator]();
  async function response(expected: string) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const item = await Promise.race([
        iter.next(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(conflict()), 15000);
        }),
      ]);
      if (item.done || item.value !== expected || dead || failure) throw conflict();
    } finally {
      clearTimeout(timer);
    }
  }
  try {
    await response('READY');
  } catch (error) {
    child.kill();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const stopped = await Promise.race([
        exit.then(() => true),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), 5000);
        }),
      ]);
      if (!stopped) throw conflict();
    } finally {
      clearTimeout(timer);
      lines.close();
    }
    throw error;
  }
  return {
    assertAlive() {
      if (dead || failure) throw conflict();
    },
    async verify(name) {
      if (!/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,199}$/.test(name) || name.includes('..') || name.endsWith('.'))
        throw conflict();
      child.stdin.write(`VERIFY ${name}\n`);
      await response('VERIFIED');
    },
    async close() {
      child.stdin.end();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          exit,
          new Promise<null>((resolve) => {
            timer = setTimeout(() => resolve(null), 5000);
          }),
        ]);
        if (result === null) {
          child.kill();
          throw conflict();
        }
        if (result !== 0) throw conflict();
      } finally {
        clearTimeout(timer);
        lines.close();
      }
    },
  };
}
async function writeStage(dir: string, name: string, data: Buffer, lease: Lease) {
  const file = path.join(dir, name);
  let existing = await readFileSafe(file, data.length);
  if (existing) await lease.verify(name);
  if (!existing) {
    let handle;
    try {
      handle = await open(file, 'wx', 0o600);
      await lease.verify(name);
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle?.close();
    }
    existing = await readFileSafe(file, data.length);
  }
  if (
    !existing ||
    existing.bytes.length > data.length ||
    !data.subarray(0, existing.bytes.length).equals(existing.bytes)
  )
    throw conflict();
  if (existing.bytes.length < data.length) {
    const h = await open(file, 'r+');
    try {
      const now = await h.stat();
      if (stamp(now) !== stamp(existing.info)) throw conflict();
      let offset = existing.bytes.length;
      while (offset < data.length) {
        const part = await h.write(data, offset, data.length - offset, offset);
        if (!part.bytesWritten) throw conflict();
        offset += part.bytesWritten;
      }
      await h.sync();
    } finally {
      await h.close();
    }
  }
  const final = await readFileSafe(file, data.length);
  if (!final || !final.bytes.equals(data)) throw conflict();
  return final;
}
async function immutable(dir: string, name: string, stageName: string, data: Buffer, lease: Lease) {
  const finalPath = path.join(dir, name),
    stagePath = path.join(dir, stageName);
  let final = await readFileSafe(finalPath, Math.max(data.length, 65536), 1).catch(async (error) => {
    const s = await lstat(finalPath).catch(() => null);
    if (!s || s.nlink !== 2) throw error;
    const pair = await readFileSafe(finalPath, Math.max(data.length, 65536), 2),
      stage = await readFileSafe(stagePath, Math.max(data.length, 65536), 2);
    if (
      !pair ||
      !stage ||
      pair.info.dev !== stage.info.dev ||
      pair.info.ino !== stage.info.ino ||
      !pair.bytes.equals(data) ||
      !stage.bytes.equals(data)
    )
      throw conflict();
    await unlink(stagePath);
    return readFileSafe(finalPath, Math.max(data.length, 65536));
  });
  if (final) {
    await lease.verify(name);
    if (!final.bytes.equals(data)) throw conflict();
    return;
  }
  await writeStage(dir, stageName, data, lease);
  await link(stagePath, finalPath);
  const pair = await readFileSafe(finalPath, data.length, 2),
    stage = await readFileSafe(stagePath, data.length, 2);
  if (
    !pair ||
    !stage ||
    pair.info.dev !== stage.info.dev ||
    pair.info.ino !== stage.info.ino ||
    !pair.bytes.equals(data)
  )
    throw conflict();
  await unlink(stagePath);
  final = await readFileSafe(finalPath, data.length);
  if (!final || !final.bytes.equals(data)) throw conflict();
}
async function safeDelete(file: string, bytes: Buffer) {
  const current = await readFileSafe(file, 65536);
  if (!current || !current.bytes.equals(bytes)) throw conflict();
  await unlink(file);
}
async function readMarker(dir: string, name: string, jobId: string): Promise<Marker | null> {
  const file = await readFileSafe(path.join(dir, name), 65536);
  if (!file) return null;
  let value: unknown;
  try {
    value = JSON.parse(file.bytes.toString('utf8'));
  } catch {
    throw conflict();
  }
  if (!markerValid(value, jobId) || !file.bytes.equals(encode(value))) throw conflict();
  return value;
}
async function observeMarker(dir: string, name: string, jobId: string): Promise<Marker | null> {
  const file = path.join(dir, name);
  let info: Stats;
  try {
    info = await lstat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  if (info.nlink === 1) return readMarker(dir, name, jobId);
  if (info.nlink !== 2) throw conflict();
  const first = await readFileSafe(file, 65536, 2);
  if (!first) throw conflict();
  let marker: unknown;
  try {
    marker = JSON.parse(first.bytes.toString('utf8'));
  } catch {
    throw conflict();
  }
  if (!markerValid(marker, jobId) || !first.bytes.equals(encode(marker))) throw conflict();
  const stage =
    name === 'pending.json'
      ? `stage-pending-${marker.operationId}.json`
      : `stage-done-${marker.operationId}.json`;
  const second = await readFileSafe(path.join(dir, stage), 65536, 2);
  if (
    !second ||
    first.info.dev !== second.info.dev ||
    first.info.ino !== second.info.ino ||
    !first.bytes.equals(second.bytes)
  )
    throw conflict();
  return marker;
}
async function withArchiveDirectory<T>(
  state: string,
  id: string,
  fn: (dir: string, lease: Lease) => Promise<T>,
): Promise<T> {
  await safeDirectory(path.resolve(state));
  const root = path.join(path.resolve(state), 'job-archives');
  const rootLease = await privateDirectory(root);
  try {
    await safeDirectory(root);
    rootLease.assertAlive();
    const dir = path.join(root, id);
    const lease = await privateDirectory(dir);
    try {
      await safeDirectory(dir);
      lease.assertAlive();
      rootLease.assertAlive();
      return await fn(dir, lease);
    } finally {
      await lease.close();
    }
  } finally {
    await rootLease.close();
  }
}

async function readMarkerRecover(
  dir: string,
  name: string,
  stageName: string,
  jobId: string,
  lease: Lease,
): Promise<Marker | null> {
  const file = path.join(dir, name);
  let info: Stats;
  try {
    info = await lstat(file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
  if (info.nlink === 2) {
    const a = await readFileSafe(file, 65536, 2),
      b = await readFileSafe(path.join(dir, stageName), 65536, 2);
    if (!a || !b || a.info.dev !== b.info.dev || a.info.ino !== b.info.ino || !a.bytes.equals(b.bytes))
      throw conflict();
    let m: unknown;
    try {
      m = JSON.parse(a.bytes.toString('utf8'));
    } catch {
      throw conflict();
    }
    if (!markerValid(m, jobId) || !a.bytes.equals(encode(m))) throw conflict();
    await lease.verify(name);
    await unlink(path.join(dir, stageName));
  }
  const marker = await readMarker(dir, name, jobId);
  if (marker) await lease.verify(name);
  return marker;
}
async function loadBlob(dir: string, d: Descriptor, lease: Lease): Promise<Buffer | null> {
  const name = `${d.sourceSha256}.json.gz`,
    stageName = `stage-${d.sourceSha256}.blob`,
    file = path.join(dir, name);
  let info: Stats;
  try {
    info = await lstat(file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
  const links = info.nlink;
  if (links !== 1 && links !== 2) throw conflict();
  const stored = await readFileSafe(file, maxZip, links);
  if (!stored) throw conflict();
  await lease.verify(name);
  if (stored.bytes.length !== d.gzipBytes || digest(stored.bytes) !== d.gzipSha256) throw conflict();
  const original = await decompress(stored.bytes, { maxOutputLength: d.sourceBytes });
  if (original.length !== d.sourceBytes || digest(original) !== d.sourceSha256) throw conflict();
  if (links === 2) {
    const stage = await readFileSafe(path.join(dir, stageName), maxZip, 2);
    if (
      !stage ||
      stage.info.dev !== stored.info.dev ||
      stage.info.ino !== stored.info.ino ||
      !stage.bytes.equals(stored.bytes)
    )
      throw conflict();
    await lease.verify(stageName);
    await unlink(path.join(dir, stageName));
    const final = await readFileSafe(file, maxZip);
    if (!final || !final.bytes.equals(stored.bytes)) throw conflict();
  }
  return original;
}
function sameRequest(m: Marker, id: string, op: string, direction: ArchiveDirection, expected: string) {
  return (
    m.jobId === id && m.operationId === op && m.direction === direction && m.expectedRecordSha256 === expected
  );
}
export type CurrentJobArchiveRecord = {
  sha256: string;
  storedBytes: Buffer;
  originalBytes: Buffer | null;
  eligible: boolean;
};
export async function executeJobArchive(
  state: string,
  jobId: string,
  operationId: string,
  direction: ArchiveDirection,
  expectedRecordSha256: string,
  readCurrent: () => Promise<CurrentJobArchiveRecord | null>,
): Promise<ArchiveResult> {
  validateArgs(state, jobId, operationId, direction, expectedRecordSha256);
  return withArchiveDirectory(state, jobId, async (dir, lease) => {
    const doneName = `done-${operationId}.json`,
      doneStage = `stage-done-${operationId}.json`,
      pendingName = 'pending.json',
      pendingStage = `stage-pending-${operationId}.json`;
    const done = await readMarkerRecover(dir, doneName, doneStage, jobId, lease);
    if (done) {
      if (!sameRequest(done, jobId, operationId, direction, expectedRecordSha256))
        throw failure('JOB_ARCHIVE_OPERATION_ID_REUSE', 'The operation ID belongs to a different request.');
      const observedPending = await observeMarker(dir, pendingName, jobId);
      if (observedPending && observedPending.operationId === operationId) {
        if (!encode(observedPending).equals(encode(done))) throw conflict();
        const pending = await readMarkerRecover(dir, pendingName, pendingStage, jobId, lease);
        if (!pending || !encode(pending).equals(encode(done))) throw conflict();
        await safeDelete(path.join(dir, pendingName), encode(pending));
      }
      return asResult(done, true);
    }
    let pending = await readMarkerRecover(dir, pendingName, pendingStage, jobId, lease);
    if (pending && !sameRequest(pending, jobId, operationId, direction, expectedRecordSha256)) {
      const previous = await readMarkerRecover(
        dir,
        `done-${pending.operationId}.json`,
        `stage-done-${pending.operationId}.json`,
        jobId,
        lease,
      );
      if (!previous || !encode(previous).equals(encode(pending)))
        throw failure('JOB_ARCHIVE_BUSY', 'A different archive operation is pending for this job.');
      await safeDelete(path.join(dir, pendingName), encode(pending));
      pending = null;
    }
    let current = await readCurrent();
    if (!current) throw failure('UNKNOWN_JOB', 'No such job ID.');
    let newZip: Buffer | null = null;
    if (!pending) {
      if (current.sha256 !== expectedRecordSha256)
        throw failure('JOB_ARCHIVE_PRECONDITION', 'The canonical job record changed.');
      let descriptor: Descriptor, resultBytes: Buffer;
      if (direction === 'compact') {
        if (!current.eligible || current.originalBytes !== null)
          throw failure(
            'JOB_ARCHIVE_INELIGIBLE',
            'Only an inactive terminal unarchived job can be compacted.',
          );
        const raw = current.storedBytes,
          sourceSha256 = digest(raw);
        const existingPath = path.join(dir, `${sourceSha256}.json.gz`);
        let existing: Awaited<ReturnType<typeof readFileSafe>> = null;
        try {
          const info = await lstat(existingPath);
          if (info.nlink !== 1 && info.nlink !== 2) throw conflict();
          existing = await readFileSafe(existingPath, maxZip, info.nlink);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        }
        if (existing) {
          await lease.verify(`${sourceSha256}.json.gz`);
          const original = await decompress(existing.bytes, { maxOutputLength: raw.length });
          if (!original.equals(raw)) throw conflict();
          newZip = existing.bytes;
        } else newZip = await compress(raw, { level: 9 });
        if (newZip.length > maxZip) throw conflict();
        descriptor = {
          schema: 'workbridge-job-archive/1',
          id: jobId,
          sourceSha256,
          sourceBytes: raw.length,
          gzipSha256: digest(newZip),
          gzipBytes: newZip.length,
        };
        resultBytes = encode(descriptor);
      } else {
        if (!current.eligible || !current.originalBytes)
          throw failure('JOB_ARCHIVE_INELIGIBLE', 'Only an inactive archived terminal job can be restored.');
        let value: unknown;
        try {
          value = JSON.parse(current.storedBytes.toString('utf8'));
        } catch {
          throw conflict();
        }
        descriptor = value as Descriptor;
        resultBytes = current.originalBytes;
      }
      pending = {
        schema: 'workbridge-job-archive-operation/1',
        jobId,
        operationId,
        direction,
        expectedRecordSha256,
        resultRecordSha256: digest(resultBytes),
        descriptor,
        sourceRecordBytes: current.storedBytes.length,
        resultRecordBytes: resultBytes.length,
      };
      if (direction === 'compact' && savings(pending) <= 0)
        throw failure(
          'JOB_ARCHIVE_NOT_BENEFICIAL',
          'Compression and receipt overhead do not produce positive logical savings.',
        );
      if (!markerValid(pending, jobId)) throw conflict();
      if (direction === 'compact') {
        if (!newZip) throw conflict();
        await immutable(
          dir,
          `${descriptor.sourceSha256}.json.gz`,
          `stage-${descriptor.sourceSha256}.blob`,
          newZip,
          lease,
        );
        const verified = await readArchivedJob(state, jobId, descriptor);
        if (!verified.equals(current.storedBytes)) throw conflict();
      }
      await immutable(dir, pendingName, pendingStage, encode(pending), lease);
    }
    if (!markerValid(pending, jobId)) throw conflict();
    let raw: Buffer;
    if (current.sha256 === pending.expectedRecordSha256)
      raw = direction === 'compact' ? current.storedBytes : (current.originalBytes ?? Buffer.alloc(0));
    else if (current.sha256 === pending.resultRecordSha256)
      raw = direction === 'compact' ? (current.originalBytes ?? Buffer.alloc(0)) : current.storedBytes;
    else
      throw failure('JOB_ARCHIVE_PRECONDITION', 'The canonical job record changed during archive recovery.');
    if (direction === 'restore' && current.sha256 === pending.expectedRecordSha256) {
      let currentDescriptor: unknown;
      try {
        currentDescriptor = JSON.parse(current.storedBytes.toString('utf8'));
      } catch {
        throw conflict();
      }
      if (
        !encode(currentDescriptor).equals(encode(pending.descriptor)) ||
        current.storedBytes.length !== pending.sourceRecordBytes
      )
        throw conflict();
    }
    if (raw.length !== pending.descriptor.sourceBytes || digest(raw) !== pending.descriptor.sourceSha256)
      throw conflict();
    let blob = await loadBlob(dir, pending.descriptor, lease);
    if (!blob) {
      if (direction !== 'compact') throw conflict();
      const candidate = newZip ?? (await compress(raw, { level: 9 }));
      if (
        candidate.length !== pending.descriptor.gzipBytes ||
        digest(candidate) !== pending.descriptor.gzipSha256
      )
        throw conflict();
      await immutable(
        dir,
        `${pending.descriptor.sourceSha256}.json.gz`,
        `stage-${pending.descriptor.sourceSha256}.blob`,
        candidate,
        lease,
      );
      blob = await loadBlob(dir, pending.descriptor, lease);
      if (!blob || !blob.equals(raw)) throw conflict();
    }
    if (!blob.equals(raw)) throw conflict();
    const verifiedOriginal = await readArchivedJob(state, jobId, pending.descriptor);
    if (!verifiedOriginal.equals(raw)) throw conflict();
    if (current.sha256 === pending.expectedRecordSha256) {
      const target = direction === 'compact' ? encode(pending.descriptor) : raw;
      if (target.length !== pending.resultRecordBytes || digest(target) !== pending.resultRecordSha256)
        throw conflict();
      const stage = `stage-record-${operationId}.json`;
      await writeStage(dir, stage, target, lease);
      current = await readCurrent();
      if (!current || current.sha256 !== pending.expectedRecordSha256)
        throw failure('JOB_ARCHIVE_PRECONDITION', 'The canonical job record changed before publication.');
      lease.assertAlive();
      await safeDirectory(path.join(state, 'jobs'));
      await rename(path.join(dir, stage), path.join(state, 'jobs', `${jobId}.json`));
      current = await readCurrent();
      if (!current || current.sha256 !== pending.resultRecordSha256) throw conflict();
    }
    await immutable(dir, doneName, doneStage, encode(pending), lease);
    await safeDelete(path.join(dir, pendingName), encode(pending));
    return asResult(pending, false);
  });
}
export async function getJobArchiveStatus(state: string, jobId: string, operationId: string) {
  if (!path.isAbsolute(state) || !idPattern.test(jobId) || !operationPattern.test(operationId))
    throw failure('INVALID_JOB_ARCHIVE_REQUEST', 'A valid job ID and operation ID are required.');
  const dir = path.join(path.resolve(state), 'job-archives', jobId);
  try {
    await safeDirectory(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT')
      return {
        schemaVersion: 1,
        jobId,
        operationId,
        status: 'unknown' as const,
        pendingOperationId: null,
        pendingDirection: null,
        pendingExpectedRecordSha256: null,
        pendingResultRecordSha256: null,
      };
    throw e;
  }
  const done = await observeMarker(dir, `done-${operationId}.json`, jobId);
  const pending = await observeMarker(dir, 'pending.json', jobId);
  if (done && done.operationId !== operationId) throw conflict();
  const pendingFields = {
    pendingOperationId: pending?.operationId ?? null,
    pendingDirection: pending?.direction ?? null,
    pendingExpectedRecordSha256: pending?.expectedRecordSha256 ?? null,
    pendingResultRecordSha256: pending?.resultRecordSha256 ?? null,
  };
  if (done) return { ...asResult(done, true), ...pendingFields };
  return {
    schemaVersion: 1,
    jobId,
    operationId,
    status: pending?.operationId === operationId ? ('pending' as const) : ('unknown' as const),
    ...pendingFields,
  };
}
