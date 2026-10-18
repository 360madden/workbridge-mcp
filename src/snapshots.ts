import { open } from 'node:fs/promises';
import { BridgeError } from './core.js';
import { SnapshotCache, snapshotVersion } from './snapshot-cache.js';

const max64 = (1n << 64n) - 1n;
export function integer(value: unknown, name: string): bigint {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === 'string' && /^(?:0x[0-9a-f]+|[0-9]+)$/i.test(value)) {
    const result = BigInt(value);
    if (result <= max64) return result;
  }
  throw new BridgeError(
    'INVALID_INTEGER',
    `${name} must be an unsigned decimal or 0x-prefixed 64-bit integer string. Unsafe JSON numbers are rejected.`,
  );
}
const hex = (value: bigint) => `0x${value.toString(16).toUpperCase()}`;
export type ValueType = 'u8' | 'i8' | 'u16' | 'i16' | 'u32' | 'i32' | 'u64' | 'i64' | 'f32' | 'f64';
const widths: Record<ValueType, number> = {
  u8: 1,
  i8: 1,
  u16: 2,
  i16: 2,
  u32: 4,
  i32: 4,
  u64: 8,
  i64: 8,
  f32: 4,
  f64: 8,
};
function decode(bytes: Buffer, type: ValueType, little: boolean): (string | number)[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result: (string | number)[] = [];
  for (let offset = 0; offset + widths[type] <= bytes.length && result.length < 128; offset += widths[type]) {
    let value: number | bigint;
    switch (type) {
      case 'u8':
        value = view.getUint8(offset);
        break;
      case 'i8':
        value = view.getInt8(offset);
        break;
      case 'u16':
        value = view.getUint16(offset, little);
        break;
      case 'i16':
        value = view.getInt16(offset, little);
        break;
      case 'u32':
        value = view.getUint32(offset, little);
        break;
      case 'i32':
        value = view.getInt32(offset, little);
        break;
      case 'u64':
        value = view.getBigUint64(offset, little);
        break;
      case 'i64':
        value = view.getBigInt64(offset, little);
        break;
      case 'f32':
        value = view.getFloat32(offset, little);
        break;
      case 'f64':
        value = view.getFloat64(offset, little);
        break;
    }
    result.push(
      typeof value === 'bigint' ? value.toString() : Number.isFinite(value) ? value : String(value),
    );
  }
  return result;
}
export class Snapshots {
  constructor(public cache: SnapshotCache) {}
  async read(args: {
    path: string;
    offset: string;
    length: number;
    type: ValueType;
    endian: 'little' | 'big';
    baseAddress?: string;
    address?: string;
  }) {
    const s = await this.cache.materialized(args.path);
    const base = args.baseAddress === undefined ? null : integer(args.baseAddress, 'baseAddress');
    let offset = integer(args.offset, 'offset');
    if (args.address !== undefined) {
      if (base === null || offset !== 0n)
        throw new BridgeError(
          'INVALID_RANGE',
          'Address reads require baseAddress and offset=0. Use snapshot_manifest to establish the segment base.',
        );
      const address = integer(args.address, 'address');
      if (address < base) throw new BridgeError('INVALID_RANGE', 'Address precedes the segment base.');
      offset = address - base;
    }
    if (offset > BigInt(s.size))
      throw new BridgeError('INVALID_RANGE', 'Offset is beyond the available decompressed bytes.');
    if (base !== null && base + BigInt(s.size) > max64 + 1n)
      throw new BridgeError('INVALID_RANGE', 'Segment mapping exceeds the 64-bit address space.');
    const handle = await open(s.dataFile, 'r');
    try {
      const before = snapshotVersion(await handle.stat());
      if (before !== s.dataVersion)
        throw new BridgeError('FILE_CHANGED', 'Snapshot changed before the read.');
      const bytes = Buffer.alloc(Math.min(args.length, s.size - Number(offset)));
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, Number(offset));
      if (
        bytesRead !== bytes.length ||
        before !== snapshotVersion(await handle.stat()) ||
        s.version !== (await this.cache.source(args.path)).version
      )
        throw new BridgeError('FILE_CHANGED', 'Snapshot changed during the read.');
      const values = decode(bytes, args.type, args.endian === 'little');
      return {
        path: s.relative,
        version: s.version,
        size: s.size,
        offset: offset.toString(),
        address: base === null ? null : hex(base + offset),
        length: bytes.length,
        hex: bytes.toString('hex'),
        ascii: [...bytes].map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '.')).join(''),
        type: args.type,
        endian: args.endian,
        values,
        valuesTruncated: Math.floor(bytes.length / widths[args.type]) > values.length,
        trailingBytes: bytes.length % widths[args.type],
        nextOffset:
          offset + BigInt(bytes.length) < BigInt(s.size) ? (offset + BigInt(bytes.length)).toString() : null,
        sha256: s.sha256,
      };
    } finally {
      await handle.close();
    }
  }
  async search(args: {
    path: string;
    pattern: string;
    offset: string;
    scanMiB: number;
    limit: number;
    baseAddress?: string;
    version?: string;
  }) {
    const text = args.pattern.replace(/\s+/g, '');
    if (!/^(?:[0-9a-f]{2}){1,256}$/i.test(text))
      throw new BridgeError(
        'INVALID_PATTERN',
        'Use 1..256 exact hex byte pairs, optionally separated by spaces.',
      );
    const needle = Buffer.from(text, 'hex');
    const s = await this.cache.materialized(args.path);
    if (args.version !== undefined && args.version !== s.version)
      throw new BridgeError('FILE_CHANGED', 'Snapshot version changed; start a new search.');
    const start = integer(args.offset, 'offset');
    if (start > BigInt(s.size))
      throw new BridgeError('INVALID_RANGE', 'Search offset is beyond the available bytes.');
    const base = args.baseAddress === undefined ? null : integer(args.baseAddress, 'baseAddress');
    if (base !== null && base + BigInt(s.size) > max64 + 1n)
      throw new BridgeError('INVALID_RANGE', 'Segment mapping exceeds the 64-bit address space.');
    const handle = await open(s.dataFile, 'r');
    const matches: { offset: string; address: string | null }[] = [];
    let next = Number(start),
      scannedBytes = 0;
    const end = Math.min(s.size, next + args.scanMiB * 1024 * 1024);
    const deadline = Date.now() + 5000;
    let reason = 'scan_budget';
    try {
      const before = snapshotVersion(await handle.stat());
      if (before !== s.dataVersion)
        throw new BridgeError('FILE_CHANGED', 'Snapshot changed before the search.');
      while (next < end && next + needle.length <= s.size) {
        const candidates = Math.min(64 * 1024, end - next, s.size - needle.length + 1 - next);
        const buffer = Buffer.alloc(candidates + needle.length - 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, next);
        if (bytesRead !== buffer.length)
          throw new BridgeError('FILE_CHANGED', 'Snapshot shrank during search.');
        scannedBytes += bytesRead;
        let found = buffer.indexOf(needle);
        while (found >= 0 && found < candidates) {
          const position = next + found;
          matches.push({
            offset: String(position),
            address: base === null ? null : hex(base + BigInt(position)),
          });
          if (matches.length >= args.limit) {
            next = position + 1;
            reason = 'result_limit';
            break;
          }
          found = buffer.indexOf(needle, found + 1);
        }
        if (matches.length >= args.limit) break;
        next += candidates;
        if (Date.now() >= deadline) {
          reason = 'time_budget';
          break;
        }
      }
      if (
        before !== snapshotVersion(await handle.stat()) ||
        s.version !== (await this.cache.source(args.path)).version
      )
        throw new BridgeError('FILE_CHANGED', 'Snapshot changed during search.');
      const complete = next + needle.length > s.size;
      return {
        path: s.relative,
        version: s.version,
        size: s.size,
        pattern: needle.toString('hex'),
        matches,
        scannedBytes,
        complete,
        reason: complete ? 'eof' : reason,
        nextOffset: complete ? null : String(next),
      };
    } finally {
      await handle.close();
    }
  }
}
