import { open } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Workspace } from './workspace.js';
import { BridgeError } from './core.js';
import { integer } from './snapshots.js';
import { snapshotVersion } from './snapshot-cache.js';

const atom = z.union([z.string().max(4096), z.number()]);
const segment = z.object({
  path: z.string().max(4096).optional(),
  snapshotPath: z.string().max(4096).optional(),
  id: z.string().max(200).optional(),
  compression: z.string().max(30).optional(),
  baseHex: atom.optional(),
  baseAddressHex: atom.optional(),
  base: atom.optional(),
  sizeBytes: atom,
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/i)
    .optional(),
});
const manifestSchema = z.object({
  mode: z.string().max(200).optional(),
  poses: z
    .array(
      z.object({
        label: z.string().max(200),
        role: z.string().max(200).optional(),
        segments: z.array(segment).max(100_000),
      }),
    )
    .min(1)
    .max(200),
});

export async function snapshotManifest(
  workspace: Workspace,
  args: { path: string; pose?: number; offset: number; limit: number; address?: string; length: number },
) {
  const file = await workspace.resolve(args.path);
  const handle = await open(file, 'r');
  let raw: unknown, version: string;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 16 * 1024 * 1024)
      throw new BridgeError(
        'MANIFEST_LIMIT',
        'Manifest must be a regular JSON file up to 16 MiB. Use read_file for larger reports.',
      );
    version = snapshotVersion(stat);
    const bytes = Buffer.alloc(stat.size);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== bytes.length || version !== snapshotVersion(await handle.stat()))
      throw new BridgeError('FILE_CHANGED', 'Manifest changed during read.');
    try {
      raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      throw new BridgeError('INVALID_MANIFEST', 'Expected UTF-8 JSON snapshot manifest.');
    }
  } finally {
    await handle.close();
  }
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success)
    throw new BridgeError(
      'INVALID_MANIFEST',
      'Expected poses[{label, segments[{path, baseHex/baseAddressHex/base, sizeBytes}]}]. Inspect the source JSON for its format.',
    );
  const poses = parsed.data.poses;
  if (args.pose !== undefined && !poses[args.pose])
    throw new BridgeError('INVALID_POSE', 'Pose index is outside this manifest.');
  if (args.address !== undefined && args.pose === undefined && poses.length > 1)
    throw new BridgeError(
      'AMBIGUOUS_POSE',
      'Select a pose index for address mapping; different captures often map the same addresses.',
    );
  const address = args.address === undefined ? null : integer(args.address, 'address');
  const rows = poses.flatMap((pose, index) =>
    args.pose !== undefined && index !== args.pose ? [] : pose.segments.map((s) => ({ s, pose: index })),
  );
  if (rows.length > 100_000)
    throw new BridgeError(
      'MANIFEST_LIMIT',
      'Select a pose; at most 100,000 segments can be inspected at once.',
    );
  const normalized = rows.map((row) => {
    const base = integer(row.s.baseHex ?? row.s.baseAddressHex ?? row.s.base, 'segment base');
    const size = integer(row.s.sizeBytes, 'sizeBytes');
    if (base + size > 1n << 64n || size > BigInt(Number.MAX_SAFE_INTEGER))
      throw new BridgeError('INVALID_MANIFEST', 'Segment size/address exceeds supported bounds.');
    if (!row.s.path && !row.s.snapshotPath)
      throw new BridgeError('INVALID_MANIFEST', 'Every segment needs path or snapshotPath.');
    return { ...row, base, size };
  });
  const visible = normalized.slice(args.offset, args.offset + args.limit);
  const selected =
    address === null ? [] : normalized.filter((row) => address >= row.base && address < row.base + row.size);
  if (selected.length > 1)
    throw new BridgeError(
      'AMBIGUOUS_ADDRESS',
      'Overlapping segments cover this address; inspect the manifest before choosing a segment.',
    );
  async function describe(row: (typeof normalized)[number]) {
    // Resolve even absolute manifest paths through the same workspace jail.
    const target = await workspace.resolve(
      path.resolve(path.dirname(file), row.s.path ?? row.s.snapshotPath!),
    );
    return {
      path: workspace.relative(target),
      pose: row.pose,
      id: row.s.id ?? null,
      baseAddress: `0x${row.base.toString(16).toUpperCase()}`,
      endAddress: `0x${(row.base + row.size).toString(16).toUpperCase()}`,
      size: Number(row.size),
      compression: row.s.compression ?? (/\.gz$/i.test(target) ? 'gzip' : 'none'),
      sha256: row.s.sha256 ?? null,
    };
  }
  const mapping =
    selected[0] && address !== null
      ? {
          ...(await describe(selected[0])),
          offset: (address - selected[0].base).toString(),
          availableBytes: Number(selected[0].size - (address - selected[0].base)),
          length: Math.min(args.length, Number(selected[0].size - (address - selected[0].base))),
        }
      : null;
  return {
    path: workspace.relative(file),
    version,
    mode: parsed.data.mode ?? null,
    poses: poses.map((p, index) => ({
      index,
      label: p.label,
      role: p.role ?? null,
      segmentCount: p.segments.length,
    })),
    segments: await Promise.all(visible.map(describe)),
    totalSegments: rows.length,
    nextOffset: args.offset + visible.length < rows.length ? args.offset + visible.length : null,
    mapping,
    boundary:
      mapping && mapping.length < args.length
        ? 'Range crosses a segment boundary; request the next mapped segment separately.'
        : null,
  };
}
