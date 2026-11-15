import { constants, type Stats } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import path from 'node:path';

const maxSourceBytes = 16 * 1024 * 1024;
const maxGzipBytes = 17 * 1024 * 1024;
const ungzip = promisify(gunzip);
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const stamp = (s: Stats) => [s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs, s.mode, s.nlink].join(':');
const samePath = (a: string, b: string) =>
  process.platform === 'win32'
    ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
    : path.resolve(a) === path.resolve(b);
const invalid = () => new Error('Invalid archived job');
const keys = ['schema', 'id', 'sourceSha256', 'sourceBytes', 'gzipSha256', 'gzipBytes'];
type Descriptor = {
  schema: 'workbridge-job-archive/1';
  id: string;
  sourceSha256: string;
  sourceBytes: number;
  gzipSha256: string;
  gzipBytes: number;
};
function validate(value: unknown, id: string): Descriptor {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')
  )
    throw invalid();
  const v = value as Record<string, unknown>;
  if (
    v.schema !== 'workbridge-job-archive/1' ||
    v.id !== id ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(id) ||
    typeof v.sourceSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(v.sourceSha256) ||
    typeof v.gzipSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(v.gzipSha256) ||
    !Number.isSafeInteger(v.sourceBytes) ||
    (v.sourceBytes as number) < 1 ||
    (v.sourceBytes as number) > maxSourceBytes ||
    !Number.isSafeInteger(v.gzipBytes) ||
    (v.gzipBytes as number) < 1 ||
    (v.gzipBytes as number) > maxGzipBytes
  )
    throw invalid();
  return v as Descriptor;
}
async function directoryChain(directory: string) {
  const parsed = path.parse(directory);
  let current = parsed.root;
  const chain: { file: string; info: Stats }[] = [];
  for (const part of ['', ...directory.slice(parsed.root.length).split(path.sep).filter(Boolean)]) {
    if (part) current = path.join(current, part);
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink() || !samePath(await realpath(current), current))
      throw invalid();
    chain.push({ file: current, info });
  }
  return chain;
}
async function checkChain(chain: { file: string; info: Stats }[]) {
  for (const { file, info } of chain) {
    const current = await lstat(file);
    if (
      !current.isDirectory() ||
      current.isSymbolicLink() ||
      current.dev !== info.dev ||
      current.ino !== info.ino ||
      !samePath(await realpath(file), file)
    )
      throw invalid();
  }
}
// Exact original bytes are restored only from a fixed, digest-derived path.
// This function never creates files, modifies a job, or falls back to a result receipt.
export async function readArchivedJob(
  stateDirectory: string,
  expectedJobId: string,
  value: unknown,
): Promise<Buffer> {
  const descriptor = validate(value, expectedJobId);
  if (typeof stateDirectory !== 'string' || !path.isAbsolute(stateDirectory)) throw invalid();
  const directory = path.join(path.resolve(stateDirectory), 'job-archives', expectedJobId);
  const file = path.join(directory, `${descriptor.sourceSha256}.json.gz`);
  const chain = await directoryChain(directory);
  const before = await lstat(file);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    before.size !== descriptor.gzipBytes ||
    !samePath(await realpath(file), file)
  )
    throw invalid();
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let compressed: Buffer;
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || stamp(before) !== stamp(opened)) throw invalid();
    const bounded = Buffer.alloc(descriptor.gzipBytes + 1);
    let count = 0;
    while (count < bounded.length) {
      const r = await handle.read(bounded, count, bounded.length - count, count);
      count += r.bytesRead;
      if (!r.bytesRead) break;
    }
    const after = await handle.stat(),
      named = await lstat(file);
    if (
      count !== descriptor.gzipBytes ||
      !named.isFile() ||
      named.isSymbolicLink() ||
      named.nlink !== 1 ||
      stamp(opened) !== stamp(after) ||
      stamp(after) !== stamp(named) ||
      !samePath(await realpath(file), file)
    )
      throw invalid();
    await checkChain(chain);
    compressed = bounded.subarray(0, count);
  } finally {
    await handle.close();
  }
  if (hash(compressed) !== descriptor.gzipSha256) throw invalid();
  const restored = await ungzip(compressed, { maxOutputLength: descriptor.sourceBytes });
  if (restored.length !== descriptor.sourceBytes || hash(restored) !== descriptor.sourceSha256)
    throw invalid();
  await checkChain(chain);
  const named = await lstat(file);
  if (
    !named.isFile() ||
    named.isSymbolicLink() ||
    named.nlink !== 1 ||
    stamp(before) !== stamp(named) ||
    !samePath(await realpath(file), file)
  )
    throw invalid();
  return restored;
}
