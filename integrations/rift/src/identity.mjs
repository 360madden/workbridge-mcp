import { createHash } from 'node:crypto';
import { open, lstat } from 'node:fs/promises';
import { hostname } from 'node:os';
import { resolve } from 'node:path';

export const SHA256 = /^[0-9a-f]{64}$/i;
export class ResearchError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ResearchError';
    this.code = code;
  }
}

function sameFile(a, b) {
  return (
    a.isFile() &&
    b.isFile() &&
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeMs === b.mtimeMs &&
    a.ctimeMs === b.ctimeMs
  );
}

function verifyFile(originalPath, before, handleAfter, pathAfter) {
  if (!sameFile(before, handleAfter) || !sameFile(before, pathAfter)) {
    throw new ResearchError('SOURCE_CHANGED', 'Source changed during inspection: ' + originalPath);
  }
}

export async function readEvidence(file, maxBytes = 4 * 1024 * 1024) {
  const fullPath = resolve(file);
  const pathBefore = await lstat(fullPath);
  if (
    !pathBefore.isFile() ||
    pathBefore.isSymbolicLink() ||
    pathBefore.size <= 0 ||
    pathBefore.size > maxBytes
  ) {
    throw new ResearchError('SOURCE_INVALID', 'Source is not a bounded regular file: ' + fullPath);
  }
  const handle = await open(fullPath, 'r');
  try {
    const before = await handle.stat();
    if (!sameFile(pathBefore, before)) {
      throw new ResearchError('SOURCE_CHANGED', 'Source changed before reading: ' + fullPath);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    verifyFile(fullPath, before, after, await lstat(fullPath));
    if (bytes.length !== before.size) {
      throw new ResearchError('SOURCE_TRUNCATED', 'Incomplete source read: ' + fullPath);
    }
    return {
      path: fullPath,
      bytes,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  } finally {
    await handle.close();
  }
}

function validatePeHeader(bytes, actualSize) {
  if (bytes.length < 256 || bytes.toString('ascii', 0, 2) !== 'MZ') {
    throw new ResearchError('CLIENT_FORMAT', 'Client image is not an MZ executable.');
  }
  const peOffset = bytes.readUInt32LE(0x3c);
  if (
    peOffset < 0x40 ||
    peOffset > 4096 ||
    peOffset + 26 > bytes.length ||
    bytes.toString('ascii', peOffset, peOffset + 4) !== 'PE\u0000\u0000'
  ) {
    throw new ResearchError('CLIENT_FORMAT', 'Missing or invalid PE signature.');
  }
  const machine = bytes.readUInt16LE(peOffset + 4);
  const sections = bytes.readUInt16LE(peOffset + 6);
  const optionalSize = bytes.readUInt16LE(peOffset + 20);
  const optionalOffset = peOffset + 24;
  if (
    machine !== 0x8664 ||
    sections < 1 ||
    sections > 96 ||
    optionalSize < 112 ||
    optionalSize > 4096 ||
    optionalOffset + optionalSize + sections * 40 > actualSize ||
    optionalOffset + 2 > bytes.length ||
    bytes.readUInt16LE(optionalOffset) !== 0x20b
  ) {
    throw new ResearchError('CLIENT_FORMAT', 'Expected bounded AMD64 PE32+ executable.');
  }
  return { kind: 'AMD64_PE32_PLUS', machine: 'AMD64', sectionCount: sections };
}

export async function inspectOfflineClient(file, expectedHost, expectedSha256 = null, host = hostname()) {
  const machine = String(host).toUpperCase();
  if (!expectedHost || machine !== String(expectedHost).toUpperCase()) {
    throw new ResearchError(
      'WRONG_HOST',
      'Expected host ' + (expectedHost ?? '(missing)') + ', got ' + machine + '.',
    );
  }
  if (expectedSha256 !== null && !SHA256.test(expectedSha256)) {
    throw new ResearchError('INVALID_HASH', 'Expected SHA-256 must be 64 hexadecimal characters.');
  }
  const fullPath = resolve(file);
  const pathBefore = await lstat(fullPath);
  if (
    !pathBefore.isFile() ||
    pathBefore.isSymbolicLink() ||
    pathBefore.size < 256 ||
    pathBefore.size > 1024 * 1024 * 1024
  ) {
    throw new ResearchError('CLIENT_INVALID', 'Client is not a bounded regular executable file.');
  }
  const handle = await open(fullPath, 'r');
  try {
    const before = await handle.stat();
    if (!sameFile(pathBefore, before)) {
      throw new ResearchError('SOURCE_CHANGED', 'Executable changed before inspection.');
    }
    const header = Buffer.alloc(Math.min(before.size, 8192));
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead !== header.length) throw new ResearchError('SOURCE_TRUNCATED', 'PE header was truncated.');
    const format = validatePeHeader(header, before.size);
    const digest = createHash('sha256');
    for await (const chunk of handle.createReadStream({
      start: 0,
      autoClose: false,
      highWaterMark: 1024 * 1024,
    })) {
      digest.update(chunk);
    }
    verifyFile(fullPath, before, await handle.stat(), await lstat(fullPath));
    const sha256 = digest.digest('hex');
    if (expectedSha256 && sha256 !== expectedSha256.toLowerCase()) {
      throw new ResearchError('BUILD_MISMATCH', 'Expected ' + expectedSha256 + ', got ' + sha256 + '.');
    }
    return {
      path: fullPath,
      sha256,
      bytes: before.size,
      format,
      identity: 'on_disk_image_only',
      process: null,
      liveRuntimeQualified: false,
    };
  } finally {
    await handle.close();
  }
}
