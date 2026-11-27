#!/usr/bin/env node
// Build/release-only closure of the standalone, fixed-action research companion.
// The published Workbridge service consumes files from dist/research-runtime,
// NOT from mutable integrations source after the release is applied.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { existsSync } from 'node:fs';
import { lstat, mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RESEARCH_RUNTIME_FILES = Object.freeze([
  'research/package.json',
  'research/src/cli.mjs',
  'research/src/plan-file.mjs',
  'research/src/plan.mjs',
  'research/src/registry.mjs',
  'research/src/providers.mjs',
  'research/src/run.mjs',
  'research/src/recovery.mjs',
  'research/src/resume.mjs',
  'research/src/adapters/rift.mjs',
  'research/src/adapters/starwrath.mjs',
  'rift/package.json',
  'rift/src/archived-sources.mjs',
  'rift/src/bundle.mjs',
  'rift/src/cli.mjs',
  'rift/src/compatibility.mjs',
  'rift/src/experiment.mjs',
  'rift/src/identity.mjs',
  'rift/src/live-witness.mjs',
  'rift/src/patch-drift.mjs',
  'rift/src/physical-epoch.mjs',
  'rift/src/physical-receipt.mjs',
  'rift/src/records.mjs',
  'rift/src/workspace-path.mjs',
  'support/desktop-ui.mjs',
]);
export const RESEARCH_RUNTIME_MANIFEST = 'research-runtime-manifest.json';
const MAX_SOURCE_BYTES = 1024 * 1024;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

export class ResearchStageError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ResearchStageError';
    this.code = code;
  }
}
function reject(code) {
  throw new ResearchStageError(code);
}

async function regular(file, maxBytes = MAX_SOURCE_BYTES) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > maxBytes || info.nlink !== 1)
    reject('RESEARCH_STAGE_UNSAFE_FILE');
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const start = await handle.stat();
    if (
      start.ino !== info.ino ||
      start.dev !== info.dev ||
      start.size !== info.size ||
      start.mtimeMs !== info.mtimeMs
    ) {
      reject('RESEARCH_STAGE_CHANGED');
    }
    const bytes = await handle.readFile();
    const end = await handle.stat();
    const named = await lstat(file);
    if (
      bytes.length !== start.size ||
      end.ino !== start.ino ||
      end.dev !== start.dev ||
      end.size !== start.size ||
      end.mtimeMs !== start.mtimeMs ||
      named.ino !== start.ino ||
      named.dev !== start.dev ||
      named.size !== start.size ||
      named.mtimeMs !== start.mtimeMs
    )
      reject('RESEARCH_STAGE_CHANGED');
    return { bytes, sha256: hash(bytes) };
  } finally {
    await handle.close();
  }
}
function directoryIn(root, input) {
  const resolved = path.resolve(input);
  const relative = path.relative(root, resolved);
  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith('..' + path.sep) ||
    path.isAbsolute(relative)
  )
    reject('RESEARCH_STAGE_OUTSIDE_ROOT');
  return resolved;
}

export async function verifyResearchRuntime({
  repoRoot = fileURLToPath(new URL('..', import.meta.url)),
  destination = path.join(repoRoot, 'dist', 'research-runtime'),
} = {}) {
  const root = path.resolve(repoRoot);
  const target = directoryIn(root, destination);
  const manifestFile = await regular(path.join(target, RESEARCH_RUNTIME_MANIFEST), 32 * 1024);
  let manifest;
  try {
    manifest = JSON.parse(manifestFile.bytes.toString('utf8'));
  } catch {
    reject('RESEARCH_STAGE_MANIFEST_INVALID');
  }
  if (
    manifest?.schemaVersion !== 1 ||
    !Array.isArray(manifest.files) ||
    manifest.files.length !== RESEARCH_RUNTIME_FILES.length ||
    manifest.files.some(
      (entry, index) =>
        entry === null ||
        typeof entry !== 'object' ||
        Array.isArray(entry) ||
        entry.path !== RESEARCH_RUNTIME_FILES[index] ||
        typeof entry.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(entry.sha256) ||
        !Number.isSafeInteger(entry.bytes) ||
        entry.bytes < 1 ||
        entry.bytes > MAX_SOURCE_BYTES,
    )
  ) {
    reject('RESEARCH_STAGE_MANIFEST_INVALID');
  }
  for (const entry of manifest.files) {
    const saved = await regular(path.join(target, ...entry.path.split('/')));
    if (saved.sha256 !== entry.sha256 || saved.bytes.length !== entry.bytes) {
      reject('RESEARCH_STAGE_HASH_MISMATCH');
    }
  }
  return {
    verified: true,
    fileCount: manifest.files.length,
    manifestSha256: manifestFile.sha256,
    runtimeDir: target,
  };
}

export async function stageResearchRuntime({
  repoRoot = fileURLToPath(new URL('..', import.meta.url)),
  destination = path.join(repoRoot, 'dist', 'research-runtime'),
} = {}) {
  const root = path.resolve(repoRoot);
  const target = directoryIn(root, destination);
  const source = path.join(root, 'integrations');
  const files = [];
  const contents = [];
  for (const rel of RESEARCH_RUNTIME_FILES) {
    const split = rel.split('/');
    // Reuse the authoritative Workbridge WinApp helper byte-for-byte.
    // This is the only file whose source lives outside integrations/.
    const file =
      rel === 'support/desktop-ui.mjs'
        ? path.join(root, 'scripts', 'desktop-ui.mjs')
        : path.join(source, ...split);
    const data = await regular(file);
    files.push({ path: rel, sha256: data.sha256, bytes: data.bytes.length });
    contents.push(data.bytes);
  }
  const manifestBytes = Buffer.from(JSON.stringify({ schemaVersion: 1, files }, null, 2) + '\n');
  if (existsSync(path.join(target, RESEARCH_RUNTIME_MANIFEST))) {
    try {
      const existing = await verifyResearchRuntime({ repoRoot: root, destination: target });
      if (existing.manifestSha256 === hash(manifestBytes)) {
        return { status: 'unchanged', ...existing };
      }
    } catch {
      // Old manifest is invalid or represents different code; no success claim.
    }
  }
  await mkdir(target, { recursive: true });
  // The marker is invalidated *before* any staged source is changed.
  try {
    await unlink(path.join(target, RESEARCH_RUNTIME_MANIFEST));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  for (let index = 0; index < RESEARCH_RUNTIME_FILES.length; index++) {
    const file = path.join(target, ...RESEARCH_RUNTIME_FILES[index].split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    const old = await lstat(file).catch((error) => {
      if (error?.code === 'ENOENT') return null;
      throw error;
    });
    if (old && (!old.isFile() || old.isSymbolicLink() || old.nlink !== 1)) {
      reject('RESEARCH_STAGE_UNSAFE_DESTINATION');
    }
    await writeFile(file, contents[index], { flag: old ? 'w' : 'wx' });
    const check = await regular(file);
    if (check.sha256 !== files[index].sha256) reject('RESEARCH_STAGE_HASH_MISMATCH');
  }
  await writeFile(path.join(target, RESEARCH_RUNTIME_MANIFEST), manifestBytes, { flag: 'wx' });
  const verified = await verifyResearchRuntime({ repoRoot: root, destination: target });
  if (verified.manifestSha256 !== hash(manifestBytes)) {
    reject('RESEARCH_STAGE_MANIFEST_INVALID');
  }
  return { status: 'staged', ...verified };
}

// Parse before touching the runtime: a misspelled verification flag must not
// silently select the default staging operation and overwrite staged files.
function parseCliArgs(args) {
  let verify = false;
  let repoRoot;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--verify' && !verify) {
      verify = true;
    } else if (arg === '--repo-root' && repoRoot === undefined) {
      const value = args[++index];
      if (!value || value.startsWith('-')) reject('RESEARCH_STAGE_ARGUMENTS');
      repoRoot = value;
    } else {
      reject('RESEARCH_STAGE_ARGUMENTS');
    }
  }
  return { verify, opts: repoRoot === undefined ? {} : { repoRoot } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  Promise.resolve()
    .then(() => {
      const { verify, opts } = parseCliArgs(process.argv.slice(2));
      return verify ? verifyResearchRuntime(opts) : stageResearchRuntime(opts);
    })
    .then((value) => process.stdout.write(JSON.stringify(value) + '\n'))
    .catch((error) => {
      process.stderr.write(JSON.stringify({ code: error.code || 'RESEARCH_STAGE_FAILED' }) + '\n');
      process.exitCode = 2;
    });
}
