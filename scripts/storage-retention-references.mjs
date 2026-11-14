// Read-only updater references. No service imports, configuration reads, or mutations.
import { constants } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { windowsMetadata as sharedWindowsMetadata } from './preview-storage-retention.mjs';

export const referenceLimits = Object.freeze({
  maxOperations: 1000,
  maxJsonBytes: 2 * 1024 * 1024,
  maxReadBytes: 16 * 1024 * 1024,
  maxScanMs: 20000,
});
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const digestPattern = /^[a-fA-F0-9]{64}$/;
const requestKeys = new Set([
  'schema',
  'action',
  'installRoot',
  'operationId',
  'releasePath',
  'releaseDigest',
  'nodePath',
  'serviceTaskName',
  'readinessTimeoutSeconds',
  'version',
]);
const fail = (code) => Object.assign(new Error(code), { code });
const stamp = (s) => [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs, s.nlink].join(':');
const sameDirectory = (a, b) => a.dev === b.dev && a.ino === b.ino;
const normalize = (p) => path.resolve(p).toLowerCase();
const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
const validDigest = (v) => typeof v === 'string' && digestPattern.test(v);
const digest = (v) => v.toUpperCase();
const inside = (root, p) => {
  const relative = path.relative(root, p);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep))
  );
};
function limitsFor(input = {}) {
  const result = { ...referenceLimits };
  for (const [key, value] of Object.entries(input)) {
    if (!(key in result) || !Number.isSafeInteger(value) || value < 1 || value > referenceLimits[key])
      throw fail('INVALID_REFERENCE_LIMIT');
    result[key] = value;
  }
  return result;
}
function makeBudget(limits) {
  return {
    limits,
    bytesRead: 0,
    deadline: performance.now() + limits.maxScanMs,
    check() {
      if (performance.now() >= this.deadline) throw fail('REFERENCE_TIME_LIMIT');
    },
  };
}
function windowsMetadata(budget) {
  const reader = sharedWindowsMetadata();
  return {
    async check(file) {
      budget.check();
      await reader.check(file);
      budget.check();
    },
    close() {
      reader.close();
    },
  };
}
async function directoryChain(directory, budget, metadata) {
  const root = path.parse(directory).root;
  const paths = [root];
  for (const component of directory.slice(root.length).split(path.sep).filter(Boolean))
    paths.push(path.join(paths.at(-1), component));
  const chain = [];
  for (const file of paths) {
    budget.check();
    const info = await lstat(file, { bigint: true });
    if (!info.isDirectory() || info.isSymbolicLink()) throw fail('LINKED_REFERENCE_PATH');
    await metadata.check(file);
    if (normalize(await realpath(file)) !== normalize(file)) throw fail('LINKED_REFERENCE_PATH');
    chain.push({ file, info });
  }
  return chain;
}
async function checkChain(chain, budget, metadata) {
  for (const { file, info } of chain) {
    budget.check();
    const now = await lstat(file, { bigint: true });
    if (!now.isDirectory() || now.isSymbolicLink() || !sameDirectory(info, now))
      throw fail('REFERENCE_ANCESTRY_CHANGED');
    await metadata.check(file);
  }
}
function binding(file, result) {
  return { path: file, sha256: result.sha256, identity: result.identity };
}
export async function loadBoundedJson(file, options = {}) {
  const maxBytes = options.maxBytes ?? referenceLimits.maxJsonBytes;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > referenceLimits.maxJsonBytes)
    throw fail('INVALID_REFERENCE_LIMIT');
  const budget =
    options.budget ??
    makeBudget(limitsFor(options.maxScanMs === undefined ? {} : { maxScanMs: options.maxScanMs }));
  const metadata = options.metadata ?? windowsMetadata(budget);
  const owned = !options.metadata;
  let handle;
  try {
    budget.check();
    file = path.resolve(file);
    if (options.installRoot && !inside(path.resolve(options.installRoot), file))
      throw fail('EXTERNAL_REFERENCE_NOT_FOLLOWED');
    const chain = await directoryChain(path.dirname(file), budget, metadata);
    const before = await lstat(file, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n)
      throw fail('LINKED_REFERENCE_FILE');
    await metadata.check(file);
    if (before.size > BigInt(maxBytes)) throw fail('REFERENCE_JSON_TOO_LARGE');
    if (budget.bytesRead + Number(before.size) > budget.limits.maxReadBytes)
      throw fail('REFERENCE_READ_LIMIT');
    handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = await handle.stat({ bigint: true });
    if (stamp(before) !== stamp(opened)) throw fail('REFERENCE_CHANGED');
    const bytes = Buffer.alloc(Number(opened.size) + 1);
    let count = 0;
    while (count < bytes.length) {
      budget.check();
      const read = await handle.read(bytes, count, bytes.length - count, count);
      count += read.bytesRead;
      budget.bytesRead += read.bytesRead;
      if (budget.bytesRead > budget.limits.maxReadBytes) throw fail('REFERENCE_READ_LIMIT');
      if (!read.bytesRead) break;
    }
    const after = await handle.stat({ bigint: true });
    const current = await lstat(file, { bigint: true });
    await metadata.check(file);
    await checkChain(chain, budget, metadata);
    if (
      count !== Number(opened.size) ||
      !current.isFile() ||
      current.isSymbolicLink() ||
      stamp(opened) !== stamp(after) ||
      stamp(after) !== stamp(current)
    )
      throw fail('REFERENCE_CHANGED');
    let value;
    try {
      value = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, count)).replace(/^\uFEFF/, ''),
      );
    } catch {
      throw fail('INVALID_REFERENCE_JSON');
    }
    return {
      value,
      sha256: createHash('sha256').update(bytes.subarray(0, count)).digest('hex').toUpperCase(),
      identity: Object.fromEntries(
        ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'nlink'].map((key) => [key, String(opened[key])]),
      ),
    };
  } finally {
    await handle?.close();
    if (owned) metadata.close();
  }
}
const validMarker = (v, sentinel = false) =>
  object(v) &&
  v.schema === 1 &&
  typeof v.version === 'string' &&
  v.version.length > 0 &&
  v.version.length <= 128 &&
  ((sentinel && v.operationId === null && v.releaseDigest === null) ||
    (typeof v.operationId === 'string' && idPattern.test(v.operationId) && validDigest(v.releaseDigest)));

export async function inspectRetentionReferences({ installRoot, limits = {} } = {}) {
  if (typeof installRoot !== 'string' || !path.isAbsolute(installRoot)) throw fail('INSTALL_ROOT_REQUIRED');
  installRoot = path.resolve(installRoot);
  const effective = limitsFor(limits),
    budget = makeBudget(effective),
    metadata = windowsMetadata(budget);
  const result = {
    schema: 1,
    installRoot,
    installed: null,
    operations: [],
    references: [],
    protectedPaths: [],
    chain: { operationIds: [], complete: true, blockers: [] },
    blockers: [],
    complete: true,
    mutationEligible: false,
  };
  const protect = (file) => {
    if (!result.protectedPaths.includes(file)) result.protectedPaths.push(file);
  };
  const read = async (file) =>
    loadBoundedJson(file, { installRoot, maxBytes: effective.maxJsonBytes, budget, metadata });
  const block = (code, operationId) => {
    result.complete = false;
    result.blockers.push({ code, ...(operationId ? { operationId } : {}) });
  };
  try {
    const catalog = path.join(installRoot, '.local', 'update-operations');
    const chain = await directoryChain(catalog, budget, metadata);
    const catalogBefore = await lstat(catalog, { bigint: true });
    const markerPath = path.join(installRoot, '.local', 'installed-release.json');
    protect(markerPath);
    try {
      const marker = await read(markerPath);
      if (!validMarker(marker.value, true)) throw fail('INVALID_INSTALLED_MARKER');
      result.installed = {
        schema: 1,
        operationId: marker.value.operationId,
        version: marker.value.version,
        releaseDigest: marker.value.releaseDigest,
        binding: binding(markerPath, marker),
      };
    } catch (error) {
      block(error.code || 'UNREADABLE_INSTALLED_MARKER');
    }
    const directory = await opendir(catalog);
    try {
      for await (const entry of directory) {
        budget.check();
        if (result.operations.length >= effective.maxOperations) {
          block('REFERENCE_OPERATION_LIMIT');
          break;
        }
        const root = path.join(catalog, entry.name);
        const op = {
          id: entry.name,
          phase: null,
          requestBinding: null,
          journalBinding: null,
          release: null,
          previousRelease: null,
          protectedPaths: [root],
          comparisonScopes: [],
          blockers: [],
          caveats: [],
        };
        result.operations.push(op);
        protect(root);
        const opBlock = (code) => {
          op.blockers.push(code);
          block(code, op.id);
        };
        try {
          if (!idPattern.test(entry.name)) throw fail('INVALID_OPERATION_ID');
          const info = await lstat(root, { bigint: true });
          if (!info.isDirectory() || info.isSymbolicLink()) throw fail('INVALID_OPERATION_DIRECTORY');
          await metadata.check(root);
          for (const relative of [
            'backup/runtime',
            'backup/source',
            'backup/configuration',
            'controller',
            'journal.json',
            'request.json',
            'backup-manifest.json',
          ]) {
            const p = path.join(root, relative);
            op.protectedPaths.push(p);
            protect(p);
          }
          let request, journal;
          try {
            const r = await read(path.join(root, 'request.json'));
            request = r.value;
            op.requestBinding = binding(path.join(root, 'request.json'), r);
            if (
              !object(request) ||
              request.schema !== 1 ||
              request.operationId !== op.id ||
              typeof request.installRoot !== 'string' ||
              normalize(request.installRoot) !== normalize(installRoot) ||
              !validDigest(request.releaseDigest) ||
              !['Apply', 'Recover', 'Rollback'].includes(request.action)
            )
              throw fail('INVALID_OPERATION_REQUEST');
            // Unknown request fields could introduce another resource reference.
            // Keep safely parsed known references, but do not claim closure.
            if (Object.keys(request).some((key) => !requestKeys.has(key)))
              opBlock('UNKNOWN_OPERATION_REQUEST_FIELD');
            if (typeof request.releasePath !== 'string' || !path.isAbsolute(request.releasePath))
              throw fail('INVALID_RELEASE_REFERENCE');
            const releasePath = path.resolve(request.releasePath);
            op.release = {
              path: releasePath,
              digest: digest(request.releaseDigest),
              scope: inside(installRoot, releasePath) ? 'internal' : 'external',
            };
            result.references.push({ operationId: op.id, ...op.release });
            if (op.release.scope === 'internal') protect(releasePath);
            if (Object.hasOwn(request, 'nodePath')) {
              if (
                typeof request.nodePath !== 'string' ||
                request.nodePath.length < 1 ||
                request.nodePath.length > 32767 ||
                /[\u0000-\u001f]/.test(request.nodePath) ||
                !path.isAbsolute(request.nodePath)
              )
                throw fail('INVALID_NODE_EXECUTABLE_REFERENCE');
              const nodePath = path.resolve(request.nodePath);
              const scope = inside(installRoot, nodePath) ? 'internal' : 'external';
              result.references.push({ operationId: op.id, kind: 'node-executable', path: nodePath, scope });
              if (scope === 'internal') protect(nodePath);
            }
            if (request.action !== 'Apply') op.caveats.push('request-action-rewritten');
          } catch (error) {
            opBlock(error.code || 'UNREADABLE_OPERATION_REQUEST');
          }
          try {
            const r = await read(path.join(root, 'journal.json'));
            journal = r.value;
            op.journalBinding = binding(path.join(root, 'journal.json'), r);
            if (
              !object(journal) ||
              journal.schema !== 1 ||
              journal.operationId !== op.id ||
              typeof journal.installRoot !== 'string' ||
              normalize(journal.installRoot) !== normalize(installRoot) ||
              !validDigest(journal.releaseDigest) ||
              typeof journal.version !== 'string' ||
              !journal.version ||
              typeof journal.previousVersion !== 'string' ||
              typeof journal.phase !== 'string' ||
              !(journal.previousRelease === null || validMarker(journal.previousRelease, true))
            )
              throw fail('INVALID_OPERATION_JOURNAL');
            op.phase = journal.phase;
            op.updatedUtc = journal.updatedUtc ?? null;
            op.version = journal.version;
            op.releaseDigest = digest(journal.releaseDigest);
            op.previousRelease =
              journal.previousRelease === null
                ? null
                : {
                    schema: 1,
                    operationId: journal.previousRelease.operationId,
                    version: journal.previousRelease.version,
                    releaseDigest: journal.previousRelease.releaseDigest,
                  };
            if (
              request &&
              validDigest(request.releaseDigest) &&
              digest(request.releaseDigest) !== op.releaseDigest
            )
              throw fail('REQUEST_JOURNAL_DIGEST_CONFLICT');
            if (request && Object.hasOwn(request, 'version') && request.version !== journal.version)
              throw fail('REQUEST_JOURNAL_VERSION_CONFLICT');
            if (journal.previousRelease && journal.previousVersion !== journal.previousRelease.version)
              op.caveats.push('previous-runtime-marker-version-diverged');
          } catch (error) {
            opBlock(error.code || 'UNREADABLE_OPERATION_JOURNAL');
          }
          if (op.blockers.length === 0 && op.phase === 'completed')
            op.comparisonScopes = [...(op.release?.scope === 'internal' ? ['candidate'] : []), 'displaced'];
        } catch (error) {
          opBlock(error.code || 'UNREADABLE_OPERATION');
        }
      }
    } finally {
      await directory.close().catch(() => {});
    }
    await checkChain(chain, budget, metadata);
    const catalogAfter = await lstat(catalog, { bigint: true });
    if (stamp(catalogBefore) !== stamp(catalogAfter)) block('OPERATION_CATALOG_CHANGED');
    const index = new Map(result.operations.map((op) => [op.id, op]));
    const chainBlock = (code, operationId) => {
      result.chain.complete = false;
      result.chain.blockers.push({ code, operationId });
      block(code, operationId);
    };
    // Validate edges outside the installed lineage too; an orphan operation's
    // missing predecessor still prevents a complete reference inventory.
    for (const first of result.operations) {
      const seen = new Set();
      let current = first;
      while (current) {
        budget.check();
        if (seen.has(current.id)) {
          chainBlock('PREDECESSOR_CYCLE', current.id);
          break;
        }
        seen.add(current.id);
        if (current.blockers.some((code) => code.includes('CONFLICT'))) {
          chainBlock('PREDECESSOR_BINDING_CONFLICT', current.id);
          break;
        }
        const previous = current.previousRelease;
        if (!previous?.operationId) break;
        const parent = index.get(previous.operationId);
        if (!parent) {
          chainBlock('MISSING_PREDECESSOR', previous.operationId);
          break;
        }
        if (!parent.journalBinding || !parent.releaseDigest) {
          chainBlock('INVALID_PREDECESSOR', previous.operationId);
          break;
        }
        if (parent.releaseDigest !== digest(previous.releaseDigest) || parent.version !== previous.version) {
          chainBlock('PREDECESSOR_BINDING_CONFLICT', previous.operationId);
          break;
        }
        current = parent;
      }
    }
    let marker = result.installed;
    if (!marker) chainBlock('INSTALLED_CHAIN_UNAVAILABLE');
    const visited = new Set();
    while (marker?.operationId) {
      budget.check();
      if (visited.has(marker.operationId)) {
        chainBlock('PREDECESSOR_CYCLE', marker.operationId);
        break;
      }
      visited.add(marker.operationId);
      result.chain.operationIds.push(marker.operationId);
      const op = index.get(marker.operationId);
      if (!op) {
        chainBlock('MISSING_PREDECESSOR', marker.operationId);
        break;
      }
      if (!op.journalBinding || !op.releaseDigest) {
        chainBlock('INVALID_PREDECESSOR', marker.operationId);
        break;
      }
      if (op.releaseDigest !== digest(marker.releaseDigest) || op.version !== marker.version) {
        chainBlock('PREDECESSOR_BINDING_CONFLICT', marker.operationId);
        break;
      }
      marker = op.previousRelease;
    }
    // Bind the installed generation to its saved release seal, not to payload
    // bytes. External paths remain references only and are never opened.
    const finishBindings = result.installed?.binding ? [result.installed.binding] : [];
    if (result.installed) result.installed.sealBinding = null;
    let activeSeal = null;
    if (result.installed?.operationId) {
      const active = index.get(result.installed.operationId);
      try {
        if (
          !active ||
          active.blockers.length ||
          active.phase !== 'completed' ||
          active.version !== result.installed.version ||
          active.releaseDigest !== digest(result.installed.releaseDigest)
        )
          throw fail('ACTIVE_REFERENCE_BINDING_INVALID');
        if (active.release?.scope !== 'internal') throw fail('ACTIVE_RELEASE_EXTERNAL');
        finishBindings.push(active.requestBinding, active.journalBinding);
        const manifestPath = path.join(active.release.path, 'manifest.json');
        const validatedPath = path.join(active.release.path, 'validated.json');
        protect(manifestPath);
        protect(validatedPath);
        const manifest = await read(manifestPath),
          validated = await read(validatedPath);
        const expected = digest(result.installed.releaseDigest);
        const checks = ['install', 'tests', 'startup', 'updater', 'format', 'acceptance'];
        if (active.version === '0.16.4-dev') checks.push('generic', 'desktop-stage', 'desktop-closure');
        if (
          !object(manifest.value) ||
          manifest.value.schema !== 1 ||
          manifest.value.version !== active.version ||
          !Array.isArray(manifest.value.files) ||
          !object(validated.value) ||
          validated.value.schema !== 1 ||
          validated.value.version !== active.version ||
          validated.value.result !== 'passed' ||
          !validDigest(validated.value.manifestSha256) ||
          digest(validated.value.manifestSha256) !== expected ||
          manifest.sha256 !== expected ||
          active.release.digest !== expected ||
          !object(validated.value.checks) ||
          checks.some((name) => validated.value.checks[name] !== 0)
        )
          throw fail('ACTIVE_RELEASE_SEAL_INVALID');
        const manifestBinding = binding(manifestPath, manifest),
          validatedBinding = binding(validatedPath, validated);
        finishBindings.push(manifestBinding, validatedBinding);
        activeSeal = {
          status: 'manifest-bound',
          payloadVerified: false,
          releasePath: active.release.path,
          releaseDigest: expected,
          version: active.version,
          manifestBinding,
          validatedBinding,
        };
      } catch (error) {
        block(error.code || 'ACTIVE_RELEASE_SEAL_UNAVAILABLE', result.installed.operationId);
      }
    }
    // Recheck content bindings after the selected active metadata was read.
    // Stable individual reads do not make this multi-file view atomic.
    try {
      for (const prior of finishBindings) {
        const current = await read(prior.path);
        if (
          current.sha256 !== prior.sha256 ||
          JSON.stringify(current.identity) !== JSON.stringify(prior.identity)
        )
          throw fail('ACTIVE_METADATA_CHANGED');
      }
      if (activeSeal) result.installed.sealBinding = activeSeal;
    } catch (error) {
      block(error.code || 'ACTIVE_METADATA_CHANGED');
    }
    result.operations.sort((a, b) => a.id.localeCompare(b.id));
  } catch (error) {
    block(error.code || 'REFERENCE_INSPECTION_FAILED');
    result.chain.complete = false;
  } finally {
    metadata.close();
  }
  result.bytesRead = budget.bytesRead;
  result.limits = effective;
  return result;
}
