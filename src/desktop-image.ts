import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const evidenceRoot = fileURLToPath(new URL('../.tools/desktop-evidence', import.meta.url));
const maxBytes = 8 * 1024 * 1024;
const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');

type DesktopImage = {
  mimeType: 'image/png';
  data: string;
  sha256: string;
  width: number;
  height: number;
  sizeBytes: number;
  requestId: string;
};

function invalidImage() {
  return Object.assign(
    new Error(
      'Desktop image evidence is invalid, linked, changed, oversized, or inconsistent with its receipt.',
    ),
    { code: 'DESKTOP_IMAGE_INVALID' },
  );
}

type Entry = Awaited<ReturnType<typeof lstat>>;
const stamp = (s: Entry) => `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
const regularImage = (s: Entry) =>
  s.isFile() && !s.isSymbolicLink() && s.nlink === 1 && s.size >= 45 && s.size <= maxBytes;
const samePath = (a: string, b: string) =>
  process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

// Walk every ancestor: checking only the file would follow a linked .tools or evidence directory.
async function directories(root: string) {
  let current = path.parse(root).root;
  const identities: string[] = [];
  for (const segment of ['', ...root.slice(current.length).split(path.sep).filter(Boolean)]) {
    current = path.join(current, segment);
    const entry = await lstat(current);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw invalidImage();
    }
    identities.push(`${entry.dev}:${entry.ino}`);
  }
  if (!samePath(await realpath(root), root)) throw invalidImage();
  return identities.join('/');
}

function dimensions(bytes: Buffer) {
  // Same byte/dimension bounds as scripts/desktop-capture.mjs. Walk chunk boundaries so an
  // IEND string inside image data cannot substitute for the actual final zero-length chunk.
  if (
    !bytes.subarray(0, 8).equals(pngSignature) ||
    bytes.readUInt32BE(8) !== 13 ||
    bytes.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    throw invalidImage();
  }
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  if (width < 1 || height < 1 || width > 10000 || height > 10000) throw invalidImage();
  for (let offset = 33; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset),
      type = bytes.toString('ascii', offset + 4, offset + 8),
      end = offset + length + 12;
    if (end > bytes.length || type === 'IHDR') throw invalidImage();
    if (type === 'IEND') {
      if (length !== 0 || end !== bytes.length || bytes.readUInt32BE(offset + 8) !== 0xae426082) {
        throw invalidImage();
      }
      return { width, height };
    }
    offset = end;
  }
  throw invalidImage();
}

/** Load only completed local capture evidence. The optional root is trusted test injection, never receipt data. */
export async function loadDesktopImage(
  receipt: unknown,
  options: { evidenceRoot?: string } = {},
): Promise<DesktopImage> {
  let handle;
  try {
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) throw invalidImage();
    const source = receipt as Record<string, unknown>;
    // Snapshot fields before the first await; unrelated desktop/VM receipt metadata is allowed.
    const { ok, requestId, imagePath, sha256, width, height, sizeBytes, mimeType } = source;
    if (
      ok !== true ||
      typeof requestId !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(requestId) ||
      typeof imagePath !== 'string' ||
      typeof sha256 !== 'string' ||
      !/^[a-fA-F0-9]{64}$/.test(sha256) ||
      typeof width !== 'number' ||
      !Number.isInteger(width) ||
      width < 1 ||
      width > 10000 ||
      typeof height !== 'number' ||
      !Number.isInteger(height) ||
      height < 1 ||
      height > 10000 ||
      typeof sizeBytes !== 'number' ||
      !Number.isInteger(sizeBytes) ||
      sizeBytes < 45 ||
      sizeBytes > maxBytes ||
      (mimeType !== undefined && mimeType !== 'image/png')
    ) {
      throw invalidImage();
    }
    const root = path.resolve(options.evidenceRoot ?? evidenceRoot);
    const expected = path.join(root, `capture-${requestId}.png`);
    // Exact spelling rejects traversal, alternate streams, device paths, URLs and sibling prefixes.
    if (!path.isAbsolute(imagePath) || imagePath !== expected) throw invalidImage();
    const parents = await directories(root);
    const entry = await lstat(expected);
    if (!regularImage(entry) || entry.size !== sizeBytes || !samePath(await realpath(expected), expected)) {
      throw invalidImage();
    }
    handle = await open(expected, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = await handle.stat();
    if (!regularImage(before) || stamp(entry) !== stamp(before)) throw invalidImage();
    // One extra byte detects concurrent growth without ever allocating an unbounded readFile buffer.
    const bytes = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const part = await handle.read(bytes, length, bytes.length - length, length);
      if (!part.bytesRead) break;
      length += part.bytesRead;
    }
    const after = await handle.stat(),
      current = await lstat(expected);
    if (
      length !== before.size ||
      !regularImage(after) ||
      !regularImage(current) ||
      stamp(before) !== stamp(after) ||
      stamp(before) !== stamp(current) ||
      parents !== (await directories(root)) ||
      !samePath(await realpath(expected), expected)
    ) {
      throw invalidImage();
    }
    const image = bytes.subarray(0, length),
      digest = createHash('sha256').update(image).digest('hex'),
      actual = dimensions(image);
    if (digest !== sha256.toLowerCase() || actual.width !== width || actual.height !== height) {
      throw invalidImage();
    }
    return {
      mimeType: 'image/png',
      data: image.toString('base64'),
      sha256: digest,
      ...actual,
      sizeBytes,
      requestId,
    };
  } catch {
    // Do not expose private paths or low-level filesystem details in MCP errors.
    throw invalidImage();
  } finally {
    await handle?.close().catch(() => {});
  }
}
