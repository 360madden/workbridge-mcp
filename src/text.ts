import { open } from 'node:fs/promises';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { BridgeError, limits } from './core.js';

const cursorKey = randomBytes(32);
type Cursor = {
  path: string;
  version: string;
  offset: number;
  line: number;
  targetLine: number;
  skipLF: boolean;
};
export const fingerprint = (s: { size: number; mtimeMs: number; ino: number }) =>
  `${s.ino}:${s.size}:${s.mtimeMs}`;
export function decodeText(bytes: Buffer, clipped = false) {
  const encoding =
    bytes[0] === 255 && bytes[1] === 254
      ? 'utf-16le'
      : bytes[0] === 254 && bytes[1] === 255
        ? 'utf-16be'
        : 'utf-8';
  return { text: decode(bytes, encoding, clipped), encoding };
}
function decode(bytes: Buffer, encoding: string, clipped: boolean) {
  try {
    const value = new TextDecoder(encoding, { fatal: true }).decode(bytes, { stream: clipped });
    if (value.includes('\0')) throw new Error('NUL');
    return value;
  } catch {
    throw new BridgeError('NOT_TEXT', 'Expected UTF-8 or BOM-marked UTF-16 text, without binary NUL bytes.');
  }
}
export async function fileHash(file: string) {
  const handle = await open(file, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new BridgeError('NOT_FILE', 'Expected a regular file for hashing.');
    const before = fingerprint(info);
    if ((await handle.stat()).size > limits.editBytes)
      throw new BridgeError(
        'EDIT_LIMIT',
        'Full-file hashing is limited to editable-size files. Large text reads work without hashing.',
      );
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(64 * 1024);
    let offset = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
      if (!bytesRead) break;
      offset += bytesRead;
      if (offset > limits.editBytes)
        throw new BridgeError('EDIT_LIMIT', 'File grew beyond the hashing limit.');
      hash.update(buffer.subarray(0, bytesRead));
    }
    if (before !== fingerprint(await handle.stat()))
      throw new BridgeError('FILE_CHANGED', 'File changed while hashing; reread it.');
    return hash.digest('hex');
  } finally {
    await handle.close();
  }
}
function encodeCursor(cursor: Cursor) {
  const body = Buffer.from(JSON.stringify(cursor)).toString('base64url');
  return `${body}.${createHmac('sha256', cursorKey).update(body).digest('hex')}`;
}
function parseCursor(value: string): Cursor {
  const [body, mac] = value.split('.');
  if (!body || createHmac('sha256', cursorKey).update(body).digest('hex') !== mac)
    throw new BridgeError('INVALID_CURSOR', 'Cursor is invalid or the server restarted. Start a new read.');
  return JSON.parse(Buffer.from(body, 'base64url').toString()) as Cursor;
}

/** Bounded line paging: no whole-file allocation, including for huge single lines. */
export async function readPage(
  file: string,
  relative: string,
  startLine: number,
  lineCount: number,
  cursor?: string,
  scanBytes = 64 * 1024 * 1024,
) {
  const handle = await open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new BridgeError('NOT_FILE', 'Expected a regular text file.');
    const version = fingerprint(stat);
    const head = Buffer.alloc(3);
    await handle.read(head, 0, 3, 0);
    const encoding =
      head[0] === 255 && head[1] === 254
        ? 'utf-16le'
        : head[0] === 254 && head[1] === 255
          ? 'utf-16be'
          : 'utf-8';
    const step = encoding === 'utf-8' ? 1 : 2;
    const bom = step === 2 ? 2 : head.equals(Buffer.from([239, 187, 191])) ? 3 : 0;
    if (step === 2 && (stat.size - bom) % 2)
      throw new BridgeError('NOT_TEXT', 'UTF-16 data has an incomplete code unit.');
    let position = bom,
      line = 1,
      skipLF = false;
    if (cursor) {
      const saved = parseCursor(cursor);
      if (saved.path !== relative || saved.version !== version)
        throw new BridgeError(
          'FILE_CHANGED',
          'File or path changed since this cursor was issued; start a new read.',
        );
      position = saved.offset;
      line = saved.line;
      skipLF = saved.skipLF;
      startLine = saved.targetLine;
    }
    let lineStart = position,
      scanned = 0,
      output = '',
      selected = 0,
      complete = false,
      limited = false;
    let parts: Buffer[] = [],
      kept = 0,
      clippedLine = false;
    let nextOffset = position,
      nextNumber = line,
      nextSkipLF = skipLF;
    const initialPosition = position;
    const deadline = Date.now() + 5_000,
      maxScan = scanBytes,
      maxLine = limits.outputChars * 4;
    const buffer = Buffer.alloc(Math.min(64 * 1024, maxScan));
    const append = (data: Buffer) => {
      if (line < startLine) return;
      const take = Math.min(data.length, maxLine - kept);
      if (take) {
        parts.push(Buffer.from(data.subarray(0, take)));
        kept += take;
      }
      if (take < data.length) clippedLine = true;
    };
    const emit = (end: number, skip: boolean, partial = false) => {
      if (line < startLine) return false;
      const text = decode(Buffer.concat(parts, kept), encoding, clippedLine || partial);
      const formatted = `${line}: ${text}`;
      const separator = selected ? '\n' : '';
      const room = limits.outputChars - output.length;
      output += (separator + formatted).slice(0, room);
      selected++;
      limited ||= clippedLine || partial || separator.length + formatted.length > room;
      nextOffset = end;
      nextNumber = line + 1;
      nextSkipLF = skip;
      return selected >= lineCount || output.length >= limits.outputChars || partial;
    };
    let stopped = false;
    while (position < stat.size && !stopped) {
      if (scanned >= maxScan || Date.now() > deadline) {
        limited = true;
        break;
      }
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, stat.size - position, maxScan - scanned),
        position,
      );
      if (!bytesRead) break;
      scanned += bytesRead;
      let segment = 0;
      for (let i = 0; i < bytesRead; i += step) {
        const code =
          step === 1
            ? buffer[i]
            : encoding === 'utf-16le'
              ? buffer[i]! | (buffer[i + 1]! << 8)
              : (buffer[i]! << 8) | buffer[i + 1]!;
        if (skipLF) {
          skipLF = false;
          if (code === 10) {
            segment = i + step;
            lineStart = position + segment;
            continue;
          }
        }
        if (code !== 10 && code !== 13) continue;
        append(buffer.subarray(segment, i));
        const end = position + i + step;
        if (emit(end, code === 13)) {
          stopped = true;
          break;
        }
        parts = [];
        kept = 0;
        clippedLine = false;
        line++;
        skipLF = code === 13;
        segment = i + step;
        lineStart = end;
      }
      if (!stopped) append(buffer.subarray(segment, bytesRead));
      position += bytesRead;
    }
    if (!stopped && position >= stat.size) {
      emit(stat.size, false);
      complete = true;
    } else if (!stopped && limited) {
      // An enormous line or a distant requested line consumed this scan budget.
      if (line >= startLine && kept) emit(-1, false, true);
      else {
        if (lineStart === initialPosition)
          throw new BridgeError(
            'LINE_LIMIT',
            'A single preceding line exceeded the scan budget; start reading before that line.',
          );
        nextOffset = lineStart;
        nextNumber = line;
        nextSkipLF = false;
      }
    }
    if (version !== fingerprint(await handle.stat()))
      throw new BridgeError('FILE_CHANGED', 'File changed during this read; retry.');
    const remaining = !complete && nextOffset >= 0;
    return {
      path: relative,
      startLine,
      totalLines: complete ? line : null,
      text: output,
      truncated: !complete || limited,
      nextLine: remaining ? nextNumber : null,
      outputLimitReached: limited,
      cursor: remaining
        ? encodeCursor({
            path: relative,
            version,
            offset: nextOffset,
            line: nextNumber,
            targetLine: selected ? nextNumber : startLine,
            skipLF: nextSkipLF,
          })
        : null,
      sha256: stat.size <= limits.editBytes ? await fileHash(file) : null,
      size: stat.size,
      encoding,
      version,
      scannedBytes: scanned,
    };
  } finally {
    await handle.close();
  }
}
