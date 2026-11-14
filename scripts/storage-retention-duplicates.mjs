import { constants } from 'node:fs';
import { lstat, open, opendir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { windowsMetadata } from './preview-storage-retention.mjs';
import { performance } from 'node:perf_hooks';

// Proof is a point-in-time, read-only comparison, never deletion authority.
export const duplicateLimits = Object.freeze({
  maxEntries: 200000,
  maxFiles: 100000,
  maxBytes: 10 * 1024 ** 3,
  maxScanMs: 60000,
});
const ceiling = Object.freeze({
  maxEntries: 1000000,
  maxFiles: 500000,
  maxBytes: 1024 ** 4,
  maxScanMs: 60000,
});
const runtime = new Set(['dist', 'node_modules', 'package.json', 'package-lock.json']);
const fail = (code) => Object.assign(new Error(code), { code });
const inspect = (file) => lstat(file, { bigint: true });
const same = (a, b) =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.size === b.size &&
  a.mtimeNs === b.mtimeNs &&
  a.ctimeNs === b.ctimeNs &&
  a.nlink === b.nlink;
const directorySame = (a, b) =>
  a.dev === b.dev && a.ino === b.ino && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
function normalized(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 4096 ||
    path.win32.isAbsolute(value) ||
    path.posix.isAbsolute(value)
  )
    throw fail('INVALID_MANIFEST_PATH');
  const parts = value.replaceAll('\\', '/').split('/');
  for (const part of parts) {
    if (
      !part ||
      part === '.' ||
      part === '..' ||
      /[\x00-\x1f<>:"|?*]/.test(part) ||
      /[. ]$/.test(part) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part)
    )
      throw fail('INVALID_MANIFEST_PATH');
  }
  if (!runtime.has(parts[0].toLowerCase())) throw fail('INVALID_RUNTIME_ROOT');
  return parts.join('/').toLowerCase();
}
function checkedLimits(value = {}) {
  const result = { ...duplicateLimits };
  for (const [name, number] of Object.entries(value)) {
    if (!(name in result) || !Number.isSafeInteger(number) || number < 1 || number > ceiling[name])
      throw fail('INVALID_LIMIT');
    result[name] = number;
  }
  return result;
}

export async function verifyRuntimeDuplicate(
  { resourceRoot, retainedRoot, manifestFiles, limits, retainedRuntimeSubset = false } = {},
  dependencies = {},
) {
  const result = {
    schema: 'workbridge-runtime-duplicate-proof/1',
    verifiedDuplicate: false,
    mutationEligible: false,
    reason: null,
    nonAtomic: true,
    entriesVisited: 0,
    filesHashed: 0,
    bytesHashed: 0,
    qualification:
      'Read-only non-atomic observation; directory replacement races and reparse changes without an observed stat change cannot be excluded.',
  };
  let metadata;
  try {
    if (typeof retainedRuntimeSubset !== 'boolean') throw fail('INVALID_OPTIONS');
    const inspectPath = dependencies.inspect ?? inspect;
    const bound = checkedLimits(limits);
    const clock = performance.now();
    const checkTime = () => {
      if (performance.now() - clock >= bound.maxScanMs) throw fail('TIME_LIMIT');
    };
    if (
      typeof resourceRoot !== 'string' ||
      typeof retainedRoot !== 'string' ||
      !path.isAbsolute(resourceRoot) ||
      !path.isAbsolute(retainedRoot)
    )
      throw fail('INVALID_ROOT');
    const roots = [path.resolve(resourceRoot), path.resolve(retainedRoot)];
    const left = roots[0].toLowerCase(),
      right = roots[1].toLowerCase();
    if (left === right || left.startsWith(right + path.sep) || right.startsWith(left + path.sep))
      throw fail('OVERLAPPING_ROOTS');
    if (!Array.isArray(manifestFiles) || manifestFiles.length < 1 || manifestFiles.length > bound.maxFiles)
      throw fail('INVALID_MANIFEST');
    const files = new Map(),
      directories = new Set();
    let expectedBytes = 0;
    for (const item of manifestFiles) {
      checkTime();
      if (
        !item ||
        !Number.isSafeInteger(item.bytes) ||
        item.bytes < 0 ||
        typeof item.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/i.test(item.sha256)
      )
        throw fail('INVALID_MANIFEST');
      const key = normalized(item.path);
      if (files.has(key)) throw fail('MANIFEST_COLLISION');
      expectedBytes += item.bytes;
      if (!Number.isSafeInteger(expectedBytes) || expectedBytes > Math.floor(bound.maxBytes / 2))
        throw fail('BYTE_LIMIT');
      files.set(key, { bytes: item.bytes, sha256: item.sha256.toLowerCase() });
      const segments = key.split('/');
      for (let n = 1; n < segments.length; n++) directories.add(segments.slice(0, n).join('/'));
    }
    if (
      !files.has('package.json') ||
      !files.has('package-lock.json') ||
      !directories.has('dist') ||
      !directories.has('node_modules')
    )
      throw fail('INCOMPLETE_MANIFEST');
    for (const key of files.keys()) if (directories.has(key)) throw fail('MANIFEST_COLLISION');
    metadata = dependencies.metadata ?? windowsMetadata();
    // Scoped to this proof only. A changed metadata fingerprint is rechecked
    // before reuse; this is still a non-atomic, path-based observation.
    const checkedMetadata = new Map();
    const sameMetadata = (a, b) => same(a, b) && a.mode === b.mode;
    async function checkMetadata(file, info, outsideAncestor = false) {
      // Shared ancestors can gain unrelated children during a proof. Retry their
      // attribute read only when the directory still has the same identity.
      for (let attempt = 0; attempt < 3; attempt++) {
        checkTime();
        if (info.isSymbolicLink()) throw fail('LINK_OR_REPARSE');
        const previous = checkedMetadata.get(file);
        if (
          outsideAncestor &&
          previous &&
          (!previous.isDirectory() ||
            !info.isDirectory() ||
            previous.dev !== info.dev ||
            previous.ino !== info.ino ||
            previous.mode !== info.mode)
        )
          throw fail('METADATA_CHANGED');
        if (attempt === 0 && previous && sameMetadata(previous, info)) return;
        await metadata.check(file);
        const confirmed = await inspectPath(file);
        if (confirmed.isSymbolicLink()) throw fail('LINK_OR_REPARSE');
        if (sameMetadata(info, confirmed)) {
          checkedMetadata.set(file, confirmed);
          return;
        }
        if (
          !outsideAncestor ||
          !info.isDirectory() ||
          !confirmed.isDirectory() ||
          info.dev !== confirmed.dev ||
          info.ino !== confirmed.ino ||
          info.mode !== confirmed.mode
        )
          throw fail('METADATA_CHANGED');
        info = confirmed;
      }
      throw fail('METADATA_CHANGED');
    }
    const isOutsideAncestor = (file) =>
      roots.some((root) => {
        const relative = path.relative(file, root);
        return (
          relative !== '' &&
          relative !== '..' &&
          !relative.startsWith(`..${path.sep}`) &&
          !path.isAbsolute(relative)
        );
      });
    async function checkChain(file, includeLeaf = true) {
      const parsed = path.parse(file);
      let current = parsed.root;
      await checkMetadata(current, await inspectPath(current), isOutsideAncestor(current));
      const parts = file.slice(parsed.root.length).split(path.sep).filter(Boolean);
      for (const [i, part] of parts.entries()) {
        checkTime();
        current = path.join(current, part);
        const info = await inspectPath(current);
        if (info.isSymbolicLink()) throw fail('LINK_OR_REPARSE');
        if (i < parts.length - 1 && !info.isDirectory()) throw fail('INVALID_ANCESTOR');
        if (i < parts.length - 1 || includeLeaf)
          await checkMetadata(current, info, isOutsideAncestor(current));
      }
    }
    async function enumerate(root, allowOtherTopLevel) {
      await checkChain(root);
      const found = new Map(),
        foundDirs = new Set(),
        directoryStamps = new Map();
      async function walk(directory, relative = '') {
        checkTime();
        const before = await inspectPath(directory);
        if (!before.isDirectory() || before.isSymbolicLink()) throw fail('LINK_OR_REPARSE');
        await checkMetadata(directory, before);
        const handle = await opendir(directory);
        for await (const entry of handle) {
          checkTime();
          if (++result.entriesVisited > bound.maxEntries) throw fail('ENTRY_LIMIT');
          if (!relative && allowOtherTopLevel && !runtime.has(entry.name.toLowerCase())) continue;
          const rel = relative ? `${relative}/${entry.name}` : entry.name;
          const key = normalized(rel);
          if (found.has(key) || foundDirs.has(key)) throw fail('PATH_COLLISION');
          const absolute = path.join(directory, entry.name);
          const info = await inspectPath(absolute);
          if (info.isSymbolicLink()) throw fail('LINK_OR_REPARSE');
          await checkMetadata(absolute, info);
          if (info.isDirectory()) {
            if (!directories.has(key)) throw fail('UNEXPECTED_ENTRY');
            foundDirs.add(key);
            await walk(absolute, rel);
          } else if (info.isFile()) {
            if (info.nlink !== 1n) throw fail('HARDLINK');
            const expected = files.get(key);
            if (!expected) throw fail('UNEXPECTED_ENTRY');
            if (info.size !== BigInt(expected.bytes)) throw fail('SIZE_MISMATCH');
            found.set(key, { absolute, info });
          } else throw fail('UNEXPECTED_ENTRY');
        }
        const after = await inspectPath(directory);
        if (!after.isDirectory() || after.isSymbolicLink() || !directorySame(before, after))
          throw fail('DIRECTORY_CHANGED');
        directoryStamps.set(directory, after);
      }
      await walk(root);
      if (found.size !== files.size || foundDirs.size !== directories.size) throw fail('MISSING_ENTRY');
      return { found, directoryStamps };
    }
    const inventories = [await enumerate(roots[0], false), await enumerate(roots[1], retainedRuntimeSubset)];
    for (const inventory of inventories) {
      for (const [key, expected] of files) {
        checkTime();
        const entry = inventory.found.get(key);
        await dependencies.beforeOpen?.(entry.absolute);
        await checkChain(entry.absolute);
        const current = await inspectPath(entry.absolute);
        if (
          !current.isFile() ||
          current.isSymbolicLink() ||
          current.nlink !== 1n ||
          !same(entry.info, current)
        )
          throw fail('FILE_CHANGED');
        let handle;
        try {
          handle = await open(entry.absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
          const opened = await handle.stat({ bigint: true });
          if (!opened.isFile() || opened.nlink !== 1n || !same(current, opened)) throw fail('FILE_CHANGED');
          const hash = createHash('sha256');
          const buffer = Buffer.allocUnsafe(256 * 1024);
          let offset = 0;
          while (true) {
            checkTime();
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
            if (!bytesRead) break;
            offset += bytesRead;
            result.bytesHashed += bytesRead;
            if (result.bytesHashed > bound.maxBytes || offset > expected.bytes) throw fail('BYTE_LIMIT');
            hash.update(buffer.subarray(0, bytesRead));
          }
          const after = await handle.stat({ bigint: true });
          await checkChain(entry.absolute);
          const named = await inspectPath(entry.absolute);
          if (
            !named.isFile() ||
            named.isSymbolicLink() ||
            named.nlink !== 1n ||
            !same(opened, after) ||
            !same(after, named) ||
            offset !== expected.bytes
          )
            throw fail('FILE_CHANGED');
          if (hash.digest('hex') !== expected.sha256) throw fail('HASH_MISMATCH');
          result.filesHashed++;
        } finally {
          await handle?.close();
        }
      }
    }
    // Recheck both inventories after hashing, including already-read files.
    for (const inventory of inventories) {
      for (const [directory, before] of inventory.directoryStamps) {
        checkTime();
        await checkChain(directory);
        const after = await inspectPath(directory);
        if (!after.isDirectory() || !directorySame(before, after)) throw fail('DIRECTORY_CHANGED');
      }
      for (const entry of inventory.found.values()) {
        checkTime();
        await checkChain(entry.absolute);
        const after = await inspectPath(entry.absolute);
        if (!after.isFile() || after.nlink !== 1n || !same(entry.info, after)) throw fail('FILE_CHANGED');
      }
    }
    checkTime();
    result.verifiedDuplicate = true;
    result.reason = 'verified-read-only';
  } catch (error) {
    result.reason = error.code ?? 'IO_OR_METADATA_ERROR';
  } finally {
    metadata?.close();
  }
  return result;
}

async function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write(
      'Usage: node scripts/storage-retention-duplicates.mjs --json-stdin\nInput: {resourceRoot,retainedRoot,manifestFiles,limits?,retainedRuntimeSubset?}; read-only and never deletion authority.\n',
    );
    return 0;
  }
  if (args.length !== 1 || args[0] !== '--json-stdin') return 2;
  try {
    const chunks = [];
    let length = 0;
    for await (const chunk of process.stdin) {
      length += chunk.length;
      if (length > 16 * 1024 * 1024) throw fail('INPUT_LIMIT');
      chunks.push(chunk);
    }
    const result = await verifyRuntimeDuplicate(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result.verifiedDuplicate ? 0 : 1;
  } catch {
    process.stderr.write('Invalid or oversized JSON input.\n');
    return 2;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  process.exitCode = await main(process.argv.slice(2));
