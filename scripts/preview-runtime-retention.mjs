import path from 'node:path';
import { lstat, opendir } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { inspectRetentionReferences, loadBoundedJson } from './storage-retention-references.mjs';
import { verifyRuntimeDuplicate } from './storage-retention-duplicates.mjs';
import { windowsMetadata } from './preview-storage-retention.mjs';

const runtimeNames = new Set(['dist', 'node_modules', 'package.json', 'package-lock.json']);
const operationPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const digestPattern = /^[a-f0-9]{64}$/i;
const baseChecks = ['install', 'tests', 'startup', 'updater', 'format', 'acceptance'];
const fail = (code) => Object.assign(new Error(code), { code });
const sameBinding = (left, right) =>
  left?.sha256 === right?.sha256 &&
  ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'nlink'].every(
    (key) => typeof left?.identity?.[key] === 'string' && left.identity[key] === right?.identity?.[key],
  );

export function parseArgs(args) {
  const result = { maxScanMs: 30000, maxBytes: 512 * 1024 * 1024 };
  const keys = new Map([
    ['--install-root', 'installRoot'],
    ['--operation', 'operationId'],
    ['--kind', 'kind'],
    ['--max-scan-ms', 'maxScanMs'],
    ['--max-bytes', 'maxBytes'],
  ]);
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const key = keys.get(args[i]);
    if (!key || seen.has(key) || i + 1 >= args.length) throw fail('INVALID_ARGUMENTS');
    seen.add(key);
    const value = args[++i];
    if (key === 'maxScanMs' || key === 'maxBytes') {
      const ceiling = key === 'maxScanMs' ? 60000 : 2 * 1024 * 1024 * 1024;
      if (
        !/^\d+$/.test(value) ||
        !Number.isSafeInteger(Number(value)) ||
        Number(value) < 1 ||
        Number(value) > ceiling
      )
        throw fail('INVALID_LIMIT');
      result[key] = Number(value);
    } else result[key] = value;
  }
  if (!result.installRoot || !path.isAbsolute(result.installRoot)) throw fail('ABSOLUTE_ROOT_REQUIRED');
  result.installRoot = path.resolve(result.installRoot);
  if (
    Boolean(result.operationId) !== Boolean(result.kind) ||
    (result.operationId && !operationPattern.test(result.operationId)) ||
    (result.kind && !['candidate', 'displaced'].includes(result.kind))
  )
    throw fail('INVALID_SELECTION');
  return result;
}

function within(root, file) {
  const relative = path.relative(root, file);
  return (
    relative !== '' &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== '..' &&
    !path.isAbsolute(relative)
  );
}

function runtimeSubset(files) {
  const names = new Set();
  for (const item of files) {
    if (
      !item ||
      typeof item.path !== 'string' ||
      !Number.isSafeInteger(item.bytes) ||
      item.bytes < 0 ||
      typeof item.sha256 !== 'string' ||
      !digestPattern.test(item.sha256)
    )
      throw fail('RELEASE_MANIFEST_INVALID');
    const parts = item.path.replaceAll('\\', '/').split('/');
    if (
      parts.some(
        (part) =>
          !part ||
          part === '.' ||
          part === '..' ||
          /[<>:"|?*\x00-\x1f]/.test(part) ||
          /[. ]$/.test(part) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part),
      )
    )
      throw fail('RELEASE_MANIFEST_INVALID');
    const name = parts.join('/').toLowerCase();
    if (names.has(name)) throw fail('RELEASE_MANIFEST_INVALID');
    names.add(name);
  }
  for (const name of names) {
    const parts = name.split('/');
    for (let index = 1; index < parts.length; index++) {
      if (names.has(parts.slice(0, index).join('/'))) throw fail('RELEASE_MANIFEST_INVALID');
    }
  }
  return files.filter((item) => runtimeNames.has(item.path.split(/[\\/]/)[0].toLowerCase()));
}

async function displacedTree(operationRoot, remaining) {
  const directoryPath = path.join(operationRoot, 'displaced');
  const metadata = windowsMetadata();
  try {
    const parsed = path.parse(directoryPath);
    let current = parsed.root;
    for (const part of directoryPath.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
      remaining();
      current = path.join(current, part);
      const info = await lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink()) throw fail('UNSAFE_DISPLACED_PATH');
      await metadata.check(current);
    }
    const directory = await opendir(directoryPath);
    const children = [];
    for await (const entry of directory) {
      remaining();
      if (children.length >= 1 || !entry.isDirectory() || !/^[a-f0-9]{32}$/i.test(entry.name))
        throw fail('DISPLACED_LAYOUT_UNKNOWN');
      children.push(entry.name);
    }
    if (children.length !== 1) throw fail('DISPLACED_LAYOUT_UNKNOWN');
    return path.join(directoryPath, children[0]);
  } finally {
    metadata.close();
  }
}

export async function previewRuntimeRetention(options, services = {}) {
  const inspect = services.inspect ?? inspectRetentionReferences;
  const load = services.load ?? loadBoundedJson;
  const verify = services.verify ?? verifyRuntimeDuplicate;
  const started = performance.now();
  const maxScanMs = options.maxScanMs ?? 30000;
  const maxBytes = options.maxBytes ?? 512 * 1024 * 1024;
  const root = path.resolve(options.installRoot);
  const remaining = () => {
    const value = Math.floor(maxScanMs - (performance.now() - started));
    if (value <= 0) throw fail('TIME_LIMIT');
    return value;
  };
  const result = {
    schema: 'workbridge-runtime-retention-preview/1',
    readOnly: true,
    mutationEligible: false,
    installRoot: root,
    complete: false,
    comparison: null,
    selection: options.operationId ? { operationId: options.operationId, kind: options.kind } : null,
    issues: [],
    qualification:
      'Read-only non-atomic evidence. Duplicate bytes do not establish reference closure, age eligibility, maintenance ownership or deletion authority.',
  };
  try {
    result.references = await inspect({
      installRoot: root,
      limits: { maxScanMs: Math.min(20000, remaining()) },
    });
    if (!options.operationId) {
      remaining();
      result.complete = result.references.complete;
      return result;
    }
    const operation = result.references.operations.find((item) => item.id === options.operationId);
    if (!operation || operation.phase !== 'completed' || !operation.comparisonScopes?.includes(options.kind))
      throw fail('OPERATION_NOT_COMPARABLE');
    const operationRoot = path.join(root, '.local', 'update-operations', operation.id);
    const reads = [];
    const read = async (file) => {
      remaining();
      const receipt = await load(file, {
        maxBytes: 2 * 1024 * 1024,
        installRoot: root,
        maxScanMs: Math.min(20000, remaining()),
      });
      reads.push({ file, sha256: receipt.sha256, identity: receipt.identity });
      return receipt;
    };
    const request = await read(path.join(operationRoot, 'request.json'));
    const journal = await read(path.join(operationRoot, 'journal.json'));
    if (!sameBinding(request, operation.requestBinding) || !sameBinding(journal, operation.journalBinding))
      throw fail('REFERENCE_CHANGED');
    let resourceRoot,
      retainedRoot,
      manifest,
      manifestBinding,
      retainedRuntimeSubset = false;
    if (options.kind === 'candidate') {
      const release = operation.release;
      if (release?.scope !== 'internal' || !within(root, release.path)) throw fail('RELEASE_OUT_OF_SCOPE');
      const sealed = await read(path.join(release.path, 'manifest.json'));
      const validated = await read(path.join(release.path, 'validated.json'));
      const digest = request.value.releaseDigest;
      const requiredChecks =
        journal.value.version === '0.16.4-dev'
          ? [...baseChecks, 'generic', 'desktop-stage', 'desktop-closure']
          : baseChecks;
      if (
        !digestPattern.test(digest) ||
        sealed.sha256.toLowerCase() !== digest.toLowerCase() ||
        String(journal.value.releaseDigest).toLowerCase() !== digest.toLowerCase() ||
        validated.value.schema !== 1 ||
        validated.value.result !== 'passed' ||
        String(validated.value.manifestSha256).toLowerCase() !== digest.toLowerCase() ||
        sealed.value.schema !== 1 ||
        sealed.value.version !== journal.value.version ||
        validated.value.version !== journal.value.version ||
        !Array.isArray(sealed.value.files) ||
        !validated.value.checks ||
        requiredChecks.some((name) => validated.value.checks[name] !== 0) ||
        Object.values(validated.value.checks).some((value) => value !== 0)
      )
        throw fail('RELEASE_SEAL_INVALID');
      manifest = runtimeSubset(sealed.value.files);
      manifestBinding = reads.find((item) => item.file === path.join(release.path, 'manifest.json'));
      resourceRoot = path.join(operationRoot, 'candidate');
      retainedRoot = path.join(release.path, 'payload');
      retainedRuntimeSubset = true;
    } else {
      const backup = await read(path.join(operationRoot, 'backup-manifest.json'));
      if (
        backup.value.schema !== 1 ||
        backup.value.version !== journal.value.previousVersion ||
        !Array.isArray(backup.value.files)
      )
        throw fail('BACKUP_MANIFEST_INVALID');
      manifest = backup.value.files;
      manifestBinding = reads.find((item) => item.file === path.join(operationRoot, 'backup-manifest.json'));
      // Only a single updater-created GUID tree is accepted in this first CLI.
      // Its path is not an arbitrary caller-supplied recursive target.
      resourceRoot = await displacedTree(operationRoot, remaining);
      retainedRoot = path.join(operationRoot, 'backup', 'runtime');
    }
    Object.assign(result.selection, {
      resourceRoot,
      retainedRoot,
      manifestBinding,
      manifestFileCount: manifest.length,
    });
    result.comparison = await verify({
      resourceRoot,
      retainedRoot,
      manifestFiles: manifest,
      retainedRuntimeSubset,
      limits: { maxScanMs: remaining(), maxBytes },
    });
    // Reread the selected metadata after hashing. The wider graph remains a
    // point-in-time observation, never authorization for a concurrent mutation.
    for (const prior of reads) {
      remaining();
      const current = await load(prior.file, {
        maxBytes: 2 * 1024 * 1024,
        installRoot: root,
        maxScanMs: Math.min(20000, remaining()),
      });
      if (!sameBinding(current, prior)) throw fail('REFERENCE_CHANGED');
    }
    remaining();
    result.complete = result.references.complete && result.comparison.verifiedDuplicate === true;
  } catch (error) {
    result.issues.push({ code: error.code ?? 'PREVIEW_FAILED' });
    if (result.comparison)
      result.comparison = { ...result.comparison, verifiedDuplicate: false, invalidated: true };
  } finally {
    result.elapsedMs = Math.round(performance.now() - started);
  }
  return result;
}

async function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write(
      'Usage: node scripts/preview-runtime-retention.mjs --install-root ABSOLUTE_PATH [--operation ID --kind candidate|displaced] [--max-scan-ms 30000] [--max-bytes 536870912]\nRead-only reference and duplicate preview; never deletion eligibility. Exit: 0 complete, 1 partial/refused, 2 invalid arguments.\n',
    );
    return 0;
  }
  let options;
  try {
    options = parseArgs(args);
  } catch (error) {
    process.stderr.write(`${error.code ?? 'INVALID_ARGUMENTS'}\n`);
    return 2;
  }
  const result = await previewRuntimeRetention(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.complete ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  process.exitCode = await main(process.argv.slice(2));
