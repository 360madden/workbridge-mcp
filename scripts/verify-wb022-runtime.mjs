#!/usr/bin/env node
// Offline/read-only evidence inspection. Never imports or runs a saved runtime or updater.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const OPERATION_ID = 'wb022-activate-20261021-01';
export const RUNTIME_NAMES = Object.freeze(['dist', 'node_modules', 'package.json', 'package-lock.json']);
const VERSION = '0.16.3-dev';
const SHA = /^[a-f\d]{64}$/i;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (code) => {
  throw Object.assign(new Error(code), { code });
};
const samePath = (a, b) =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  (process.platform === 'win32'
    ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
    : path.resolve(a) === path.resolve(b));
const sameHash = (a, b) => typeof a === 'string' && SHA.test(a) && a.toLowerCase() === b?.toLowerCase();
const signature = (s) => [s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs].join(':');

function manifestMap(files) {
  if (!Array.isArray(files) || !files.length || files.length > 100_000) fail('INVALID_MANIFEST');
  const result = new Map();
  for (const entry of files) {
    if (!entry || typeof entry.path !== 'string') fail('INVALID_MANIFEST_PATH');
    const name = entry.path.replaceAll('\\', '/');
    if (
      name.length > 1024 ||
      name
        .split('/')
        .some(
          (part) => !part || part === '.' || part === '..' || /[\x00-\x1f:]/.test(part) || /[. ]$/.test(part),
        )
    )
      fail('INVALID_MANIFEST_PATH');
    const key = name.toLowerCase();
    if (result.has(key)) fail('AMBIGUOUS_MANIFEST_PATH');
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || !SHA.test(entry.sha256)) {
      fail('INVALID_MANIFEST_ENTRY');
    }
    result.set(key, { path: name, bytes: entry.bytes, sha256: entry.sha256.toLowerCase() });
  }
  return result;
}

const runtimeEntries = (files) => files.filter((f) => RUNTIME_NAMES.includes(f.path.split('/')[0]));
const aggregate = (files) =>
  digest(JSON.stringify([...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))));

/** No writes, service calls, execution of candidate code, network, or credential inspection.
 * Hashes prove observations during this scan, not future immutability or live process health.
 */
export async function verifyWb022Runtime({
  repoRoot = fileURLToPath(new URL('..', import.meta.url)),
  releaseRoot,
  installedEvidencePath,
  timeoutMs = 180_000,
} = {}) {
  const report = {
    schema: 1,
    operationId: OPERATION_ID,
    version: VERSION,
    readOnly: true,
    baselineVerified: false,
    offlineChecksPassed: false,
    recoveryReady: false,
    preflightVerified: false,
    liveHealthVerified: false,
    errors: [],
    trees: {},
    nextSafePath: {
      statusCommand:
        '.\\scripts\\Update-Workbridge.ps1 -Action Status -OperationId gui006-activate-20261026-01',
      gate: 'Read status and retained request/controller error first. No Apply, Recover, Rollback or restart is authorized by this report.',
      recovery:
        'Reconcile disk and loaded-owner identity through a separately reviewed WB-001 restoration plan, preserving displaced bytes and the original operation ID; then rerun the unchanged healthy-installation preflight before activation.',
      caution:
        'WB022 Recover/Rollback restores its previous 0.16.2 runtime, not the saved 0.16.3 candidate. GUI006 Recover requires an existing journal; a controller error alone is insufficient.',
    },
  };
  if (
    typeof repoRoot !== 'string' ||
    !repoRoot ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 300_000
  ) {
    return { ...report, ok: false, errors: ['INVALID_ARGUMENTS'] };
  }
  const deadline = Date.now() + timeoutMs;
  const check = () => {
    if (Date.now() >= deadline) fail('TIMEOUT');
  };
  const metadata = new Map();
  async function safeAncestors(filename) {
    for (let current = path.resolve(filename); ; current = path.dirname(current)) {
      check();
      const info = await lstat(current);
      if (info.isSymbolicLink()) fail('UNSAFE_LINK');
      if (path.dirname(current) === current) break;
    }
  }
  async function stableRead(filename, maxBytes = 16 * 1024 * 1024) {
    check();
    const before = await lstat(filename);
    if (!before.isFile() || before.isSymbolicLink()) fail('UNSAFE_FILE');
    if (before.size > maxBytes) fail('METADATA_BOUNDS');
    const bytes = await readFile(filename);
    if (bytes.length !== before.size || signature(before) !== signature(await lstat(filename)))
      fail('EVIDENCE_CHANGED');
    check();
    return bytes;
  }
  async function json(filename) {
    await safeAncestors(filename);
    const bytes = await stableRead(filename);
    metadata.set(filename, digest(bytes));
    try {
      return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
    } catch {
      fail('INVALID_JSON');
    }
  }
  async function inventory(root, names) {
    await safeAncestors(root);
    const items = [];
    async function walk(relative) {
      check();
      const filename = path.join(root, ...relative.split('/'));
      const info = await lstat(filename);
      if (info.isSymbolicLink()) fail('UNSAFE_LINK');
      if (info.isDirectory()) {
        for (const name of (await readdir(filename)).sort())
          await walk(relative ? `${relative}/${name}` : name);
      } else {
        if (!info.isFile()) fail('UNSAFE_FILE');
        if (items.length >= 100_000) fail('TREE_BOUNDS');
        items.push({ path: relative, filename, info });
      }
    }
    for (const name of names ?? ['']) await walk(name);
    return items;
  }
  async function scan(root, expected, full = false) {
    const items = await inventory(root, full ? undefined : RUNTIME_NAMES);
    const files = [];
    for (const item of items) {
      check();
      const hasher = createHash('sha256');
      const stream = createReadStream(item.filename);
      try {
        for await (const chunk of stream) {
          check();
          hasher.update(chunk);
        }
      } finally {
        stream.destroy();
      }
      if (signature(item.info) !== signature(await lstat(item.filename))) fail('EVIDENCE_CHANGED');
      files.push({ path: item.path, bytes: item.info.size, sha256: hasher.digest('hex') });
    }
    const after = await inventory(root, full ? undefined : RUNTIME_NAMES);
    if (
      items.length !== after.length ||
      items.some((f, i) => f.path !== after[i].path || signature(f.info) !== signature(after[i].info))
    ) {
      fail('EVIDENCE_CHANGED');
    }
    const actual = manifestMap(files);
    const differences = [];
    for (const [key, file] of actual) {
      const wanted = expected.get(key);
      if (
        !wanted ||
        file.bytes !== wanted.bytes ||
        file.sha256 !== wanted.sha256 ||
        file.path !== wanted.path
      ) {
        differences.push({ path: file.path, kind: wanted ? 'checksum' : 'extra' });
      }
    }
    for (const [key, file] of expected)
      if (!actual.has(key)) differences.push({ path: file.path, kind: 'missing' });
    return {
      matches: differences.length === 0,
      count: files.length,
      expectedCount: expected.size,
      sha256: aggregate(files),
      expectedSha256: aggregate(expected.values()),
      components: Object.fromEntries(
        RUNTIME_NAMES.map((name) => [
          name,
          files.filter((f) => f.path === name || f.path.startsWith(name + '/')).length,
        ]),
      ),
      differenceCount: differences.length,
      differences: differences.slice(0, 12),
    };
  }
  const root = path.resolve(repoRoot);
  const operation = path.join(root, '.local', 'update-operations', OPERATION_ID);
  try {
    const journal = await json(path.join(operation, 'journal.json'));
    const request = await json(path.join(operation, 'request.json'));
    const marker = await json(path.join(root, '.local', 'installed-release.json'));
    if (
      journal.schema !== 1 ||
      journal.operationId !== OPERATION_ID ||
      !samePath(journal.installRoot, root) ||
      journal.version !== VERSION ||
      journal.phase !== 'completed' ||
      journal.error !== null ||
      journal.recoveryError !== null
    )
      fail('JOURNAL_NOT_KNOWN_GOOD');
    if (
      request.schema !== 1 ||
      request.operationId !== OPERATION_ID ||
      !samePath(request.installRoot, root) ||
      !sameHash(request.releaseDigest, journal.releaseDigest)
    )
      fail('REQUEST_IDENTITY_MISMATCH');
    if (
      marker.schema !== 1 ||
      marker.operationId !== OPERATION_ID ||
      marker.version !== VERSION ||
      !sameHash(marker.releaseDigest, journal.releaseDigest)
    )
      fail('INSTALLED_MARKER_MISMATCH');
    if (typeof request.releasePath !== 'string' || !path.isAbsolute(request.releasePath))
      fail('INVALID_RELEASE_PATH');
    const release = path.resolve(releaseRoot ?? request.releasePath);
    if (!samePath(release, request.releasePath)) fail('RELEASE_PATH_MISMATCH');
    report.nextSafePath.savedCandidate = path.join(operation, 'candidate');
    report.nextSafePath.originalSeal = release;
    const manifestFile = path.join(release, 'manifest.json');
    const manifest = await json(manifestFile);
    const seal = await json(path.join(release, 'validated.json'));
    const manifestSha256 = metadata.get(manifestFile);
    if (
      manifest.schema !== 1 ||
      manifest.version !== VERSION ||
      seal.schema !== 1 ||
      seal.result !== 'passed' ||
      seal.version !== VERSION ||
      !sameHash(manifestSha256, journal.releaseDigest) ||
      !sameHash(manifestSha256, seal.manifestSha256)
    )
      fail('RELEASE_SEAL_MISMATCH');
    const checks = ['install', 'tests', 'startup', 'updater', 'format', 'generic', 'acceptance'];
    if (
      checks.some((name) => seal.checks?.[name] !== 0) ||
      seal.probe?.toolCount !== 52 ||
      seal.probe?.version !== VERSION ||
      seal.probe?.packageVersion !== VERSION
    )
      fail('RELEASE_GATES_NOT_PASSED');
    const allFiles = manifestMap(manifest.files);
    const runtime = manifestMap(runtimeEntries([...allFiles.values()]));
    if (
      RUNTIME_NAMES.some(
        (name) => ![...runtime.values()].some((f) => f.path === name || f.path.startsWith(name + '/')),
      )
    )
      fail('INCOMPLETE_RUNTIME_MANIFEST');
    report.manifestSha256 = manifestSha256;
    const evidence = await json(
      installedEvidencePath ?? path.resolve(release, '../../../../evidence/deployed-integrity-after.json'),
    );
    if (
      evidence.schemaVersion !== 1 ||
      evidence.passed !== true ||
      evidence.version !== VERSION ||
      evidence.activationOperationId !== OPERATION_ID ||
      !sameHash(evidence.manifestSha256, manifestSha256) ||
      evidence.activationCompletedUtc !== journal.updatedUtc ||
      evidence.checks?.runtime?.count !== runtime.size ||
      !Array.isArray(evidence.checks.runtime.differences) ||
      evidence.checks.runtime.differences.length !== 0
    )
      fail('PRIOR_INSTALLED_EVIDENCE_MISMATCH');
    const backup = await json(path.join(operation, 'backup-manifest.json'));
    if (
      backup.schema !== 1 ||
      backup.version !== journal.previousVersion ||
      journal.previousRelease?.version !== journal.previousVersion
    )
      fail('PREVIOUS_VERSION_MISMATCH');
    const previous = manifestMap(backup.files);
    if (runtimeEntries([...previous.values()]).length !== previous.size) fail('INVALID_PREVIOUS_RUNTIME');
    const tasks = [
      ['candidate', path.join(operation, 'candidate'), runtime, true],
      ['sealedPayload', path.join(release, 'payload'), allFiles, true],
      ['installedDisk', root, runtime, false],
      ['previousRuntime', path.join(operation, 'backup', 'runtime'), previous, true],
    ];
    const displaced = path.join(operation, 'displaced');
    await safeAncestors(displaced);
    const displacedNames = await readdir(displaced);
    if (displacedNames.length !== 1 || !/^[a-f\d]{32}$/i.test(displacedNames[0]))
      fail('AMBIGUOUS_DISPLACED_RUNTIME');
    tasks.push(['displacedRuntime', path.join(displaced, displacedNames[0]), previous, true]);
    for (const [name, location, expected, full] of tasks) {
      try {
        report.trees[name] = await scan(location, expected, full);
      } catch (error) {
        report.errors.push(`${name}:${safeCode(error)}`);
      }
    }
    for (const [name, location, version] of [
      ['candidate', path.join(operation, 'candidate'), VERSION],
      ['installedDisk', root, VERSION],
      ['previousRuntime', path.join(operation, 'backup', 'runtime'), backup.version],
    ]) {
      const pkg = await json(path.join(location, 'package.json'));
      const valid = pkg.name === 'workbridge-mcp' && pkg.version === version;
      if (report.trees[name]) report.trees[name].packageVersionMatches = valid;
      if (!valid) report.errors.push(`${name}:PACKAGE_VERSION_MISMATCH`);
    }
    // A second metadata read detects edits during the scan. Never prints JSON payloads/errors.
    for (const [filename, sha256] of metadata) {
      await safeAncestors(filename);
      if (digest(await stableRead(filename)) !== sha256) fail('EVIDENCE_CHANGED');
    }
    report.baselineVerified =
      report.trees.candidate?.matches === true &&
      report.trees.sealedPayload?.matches === true &&
      report.trees.candidate.packageVersionMatches === true;
    report.offlineChecksPassed =
      report.errors.length === 0 && tasks.every(([name]) => report.trees[name]?.matches === true);
    if (!report.trees.installedDisk?.matches) report.errors.push('DISK_BASELINE_MISMATCH');
    if (!report.offlineChecksPassed)
      report.nextSafePath.blocked =
        'Unchanged WB-001 preflight must remain enabled; evidence does not authorize modifying the installation.';
  } catch (error) {
    report.errors.push(safeCode(error));
  }
  // An offline success never establishes readiness for a live updater action.
  return { ...report, ok: report.offlineChecksPassed && report.errors.length === 0 };
}

function safeCode(error) {
  // Do not expose arbitrary exception messages, JSON values, credentials, or OS paths.
  const code = error?.code;
  return typeof code === 'string' && /^[A-Z][A-Z_0-9]{0,63}$/.test(code) ? code : 'VERIFICATION_FAILED';
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({
      strict: true,
      options: {
        'repo-root': { type: 'string' },
        'release-root': { type: 'string' },
        'installed-evidence': { type: 'string' },
        'timeout-ms': { type: 'string' },
      },
    });
    const result = await verifyWb022Runtime({
      repoRoot: values['repo-root'],
      releaseRoot: values['release-root'],
      installedEvidencePath: values['installed-evidence'],
      timeoutMs: values['timeout-ms'] === undefined ? undefined : Number(values['timeout-ms']),
    });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : result.baselineVerified ? 2 : 1;
  } catch (error) {
    console.error(JSON.stringify({ ok: false, readOnly: true, code: safeCode(error) }));
    process.exitCode = 1;
  }
}
