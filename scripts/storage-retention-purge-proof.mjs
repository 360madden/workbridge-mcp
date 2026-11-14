import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { inspectRetentionReferences, loadBoundedJson } from './storage-retention-references.mjs';
import { verifyRetainedRuntime } from './storage-retention-duplicates.mjs';
import { canonicalPlanSha256 } from './storage-retention-quarantine.mjs';
import { canonicalPurgeJson } from './storage-retention-purge-journal.mjs';
import { normalizePurgeInventory } from './storage-retention-purge-inventory.mjs';

const fail = (code) => Object.assign(new Error(code), { code });
const hash = (v) => createHash('sha256').update(canonicalPurgeJson(v)).digest('hex');
const sha = (v) => (typeof v === 'string' && /^[a-f0-9]{64}$/i.test(v) ? v.toLowerCase() : null);
const samePath = (a, b) =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const within = (root, file) => {
  const r = path.relative(path.resolve(root), path.resolve(file));
  return !path.isAbsolute(r) && r !== '..' && !r.startsWith('..' + path.sep);
};
const overlap = (a, b) => within(a, b) || within(b, a);
const transient = new Set([
  'bytesRead',
  'bytesHashed',
  'filesHashed',
  'entriesVisited',
  'elapsedMs',
  'limits',
]);
const stable = (v) =>
  Array.isArray(v)
    ? v.map(stable)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.entries(v)
            .filter(([k]) => !transient.has(k))
            .map(([k, x]) => [k, stable(x)]),
        )
      : v;
function graphHash(graph) {
  const value = stable(graph);
  value.operations?.sort((a, b) => a.id.localeCompare(b.id));
  value.references?.sort((a, b) => canonicalPurgeJson(a).localeCompare(canonicalPurgeJson(b)));
  value.protectedPaths?.sort();
  for (const op of value.operations ?? []) op.protectedPaths?.sort();
  return hash(value);
}
function normalizedBindings(bindings) {
  const seen = new Set();
  return bindings
    .map(({ file, sha256, identity }) => {
      if (
        typeof file !== 'string' ||
        !path.isAbsolute(file) ||
        !sha(sha256) ||
        !identity ||
        typeof identity !== 'object'
      )
        throw fail('METADATA_BINDINGS_UNAVAILABLE');
      const resolved = path.resolve(file),
        key = resolved.toLowerCase();
      if (seen.has(key)) throw fail('METADATA_BINDINGS_UNAVAILABLE');
      seen.add(key);
      return { file: resolved, sha256: sha(sha256), identity };
    })
    .sort((a, b) => a.file.localeCompare(b.file));
}
function eligibleGraph(graph, ctx) {
  const { plan } = ctx;
  const opRoot = path.join(plan.installRoot, '.local', 'update-operations', plan.updaterOperationId);
  const source =
    plan.kind === 'candidate'
      ? path.join(opRoot, 'candidate')
      : path.join(opRoot, 'displaced', plan.displacedId);
  const payload = path.join(plan.installRoot, '.local', 'storage-quarantine', ctx.operationId, 'payload');
  if (
    graph?.complete !== true ||
    graph.chain?.complete !== true ||
    !samePath(graph.installRoot, plan.installRoot) ||
    !Array.isArray(graph.operations) ||
    graph.operations.some(
      (o) =>
        ![
          'completed',
          'rolled_back',
          'failed_rolled_back',
          'preflight_failed',
          'controller_preflight_refused',
        ].includes(o.phase),
    ) ||
    !graph.installed?.operationId ||
    graph.installed.sealBinding?.status !== 'manifest-bound' ||
    !graph.installed.binding ||
    !graph.installed.sealBinding.manifestBinding ||
    !graph.installed.sealBinding.validatedBinding ||
    !Array.isArray(graph.references) ||
    !Array.isArray(graph.protectedPaths)
  )
    throw fail('REFERENCE_GRAPH_INCOMPLETE');
  const op = graph.operations.find((x) => x.id === plan.updaterOperationId);
  if (
    !op ||
    op.phase !== 'completed' ||
    !op.comparisonScopes?.includes(plan.kind) ||
    [graph.installed.operationId, graph.chain.operationIds?.[1]].includes(op.id)
  )
    throw fail('OPERATION_NOT_COMPARABLE');
  const time = Date.parse(op.updatedUtc);
  if (
    typeof op.updatedUtc !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(op.updatedUtc) ||
    !Number.isFinite(time) ||
    new Date(time).toISOString().slice(0, 19) !== op.updatedUtc.slice(0, 19) ||
    Date.now() - time < 14 * 86400000
  )
    throw fail('OPERATION_TOO_RECENT');
  for (const ref of graph.references) {
    if (typeof ref.path !== 'string' || !path.isAbsolute(ref.path)) throw fail('INVALID_REFERENCE_PATH');
    if (overlap(source, ref.path) || overlap(payload, ref.path)) throw fail('REFERENCED_RESOURCE');
  }
  for (const p of graph.protectedPaths) {
    if (typeof p !== 'string' || !path.isAbsolute(p)) throw fail('INVALID_REFERENCE_PATH');
    if ((!samePath(p, opRoot) && overlap(source, p)) || overlap(payload, p)) throw fail('PROTECTED_RESOURCE');
  }
  return { op, opRoot };
}
function compareFiles(inventory, list) {
  if (!Array.isArray(list) || !list.length) throw fail('INVALID_MANIFEST');
  const files = new Map(),
    dirs = new Set(['']);
  for (const x of list) {
    if (typeof x?.path !== 'string' || !Number.isSafeInteger(x.bytes) || x.bytes < 0 || !sha(x.sha256))
      throw fail('INVALID_MANIFEST');
    const name = x.path.replaceAll('\\', '/').toLowerCase();
    if (files.has(name)) throw fail('MANIFEST_COLLISION');
    files.set(name, { size: x.bytes, sha256: sha(x.sha256) });
    const parts = name.split('/');
    for (let n = 1; n < parts.length; n++) dirs.add(parts.slice(0, n).join('/'));
  }
  let fileCount = 0,
    dirCount = 0;
  for (const entry of inventory.entries) {
    const name = entry.path.toLowerCase();
    if (entry.type === 'file') {
      const wanted = files.get(name);
      if (!wanted || wanted.size !== entry.size || wanted.sha256 !== entry.sha256)
        throw fail('PURGE_MANIFEST_PROJECTION_MISMATCH');
      fileCount++;
    } else {
      if (!dirs.has(name)) throw fail('PURGE_MANIFEST_PROJECTION_MISMATCH');
      dirCount++;
    }
  }
  if (fileCount !== files.size || dirCount !== dirs.size) throw fail('PURGE_MANIFEST_PROJECTION_MISMATCH');
}

// Read-only. Invoke while the caller owns the native purge lease. This does not
// pin the independently retained copy; cooperating updater/builders must stay quiet.
export async function createPurgeSafetyProof(ctx, binding, deps = {}) {
  const plan = ctx?.plan;
  const planSha = canonicalPlanSha256(plan);
  if (
    plan.host.toLowerCase() !== os.hostname().toLowerCase() ||
    !samePath(ctx.installRoot, plan.installRoot) ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(ctx.operationId ?? '') ||
    ctx.planSha256 !== planSha ||
    binding?.manifest?.schema !== 'workbridge-purge-manifest/1' ||
    binding.manifest.operationId !== ctx.operationId ||
    binding.manifest.planSha256 !== planSha ||
    binding.manifest.quarantineReceiptSha256 !== ctx.quarantineReceiptSha256 ||
    createHash('sha256')
      .update(`${canonicalPurgeJson(binding.manifest)}\n`)
      .digest('hex') !== binding.manifestSha256
  )
    throw fail('PURGE_PROOF_BINDING_INVALID');
  const manifest = binding.manifest;
  const bytes = manifest.entries?.reduce((n, e) => n + (e.type === 'file' ? e.size : 0), 0);
  let inventory;
  try {
    inventory = normalizePurgeInventory(
      {
        schema: 'workbridge-retention-inventory/1',
        complete: true,
        nonAtomic: true,
        namedStreams: 0,
        totalBytes: bytes,
        entries: manifest.entries,
      },
      manifest.expectedRoot,
    );
  } catch {
    throw fail('PURGE_MANIFEST_INVALID');
  }
  if (
    canonicalPurgeJson(inventory.entries) !== canonicalPurgeJson(manifest.entries) ||
    canonicalPurgeJson(manifest.expectedRoot) !== canonicalPurgeJson(plan.sourceIdentity)
  )
    throw fail('PURGE_MANIFEST_INVALID');
  const inspect = deps.inspectRetentionReferences ?? inspectRetentionReferences;
  const load = deps.loadBoundedJson ?? loadBoundedJson;
  const verify = deps.verifyRetainedRuntime ?? verifyRetainedRuntime;
  const first = await inspect({ installRoot: plan.installRoot });
  const { op, opRoot } = eligibleGraph(first, ctx);
  const referencesSha256 = graphHash(first);
  const reads = [];
  const read = async (file) => {
    const r = await load(file, { installRoot: plan.installRoot, maxBytes: 2 * 1024 * 1024 });
    reads.push({ file, sha256: r.sha256, identity: r.identity });
    return r;
  };
  const request = await read(path.join(opRoot, 'request.json'));
  const journal = await read(path.join(opRoot, 'journal.json'));
  if (
    request.value.operationId !== plan.updaterOperationId ||
    journal.value.operationId !== plan.updaterOperationId ||
    !samePath(request.value.installRoot, plan.installRoot) ||
    !samePath(journal.value.installRoot, plan.installRoot)
  )
    throw fail('METADATA_BINDING_MISMATCH');
  let retainedRoot, updaterManifest;
  if (plan.kind === 'candidate') {
    if (
      op.release?.scope !== 'internal' ||
      !path.isAbsolute(op.release.path) ||
      !within(plan.installRoot, op.release.path) ||
      !samePath(request.value.releasePath, op.release.path)
    )
      throw fail('RELEASE_OUT_OF_SCOPE');
    updaterManifest = await read(path.join(op.release.path, 'manifest.json'));
    await read(path.join(op.release.path, 'validated.json'));
    retainedRoot = path.join(op.release.path, 'payload');
  } else {
    updaterManifest = await read(path.join(opRoot, 'backup-manifest.json'));
    retainedRoot = path.join(opRoot, 'backup', 'runtime');
  }
  if (
    sha(updaterManifest.sha256) !== plan.manifestSha256 ||
    hash(normalizedBindings(reads)) !== plan.metadataSha256 ||
    !Array.isArray(updaterManifest.value.files)
  )
    throw fail('METADATA_BINDING_MISMATCH');
  const runtime = new Set(['dist', 'node_modules', 'package.json', 'package-lock.json']);
  const manifestFiles =
    plan.kind === 'candidate'
      ? updaterManifest.value.files.filter(
          (e) => typeof e?.path === 'string' && runtime.has(e.path.split(/[\\/]/)[0].toLowerCase()),
        )
      : updaterManifest.value.files;
  compareFiles(inventory, manifestFiles);
  const proof = await verify({
    retainedRoot,
    manifestFiles,
    retainedRuntimeSubset: plan.kind === 'candidate',
  });
  if (
    proof?.verifiedRetained !== true ||
    !sha(proof.retainedTreeSha256) ||
    hash({ retainedRoot, retainedTreeSha256: sha(proof.retainedTreeSha256) }) !== plan.retainedBindingSha256
  )
    throw fail('RETAINED_PROOF_MISMATCH');
  for (const prior of reads) {
    const current = await load(prior.file, { installRoot: plan.installRoot, maxBytes: 2 * 1024 * 1024 });
    if (
      sha(current.sha256) !== sha(prior.sha256) ||
      canonicalPurgeJson(current.identity) !== canonicalPurgeJson(prior.identity)
    )
      throw fail('METADATA_CHANGED');
  }
  const last = await inspect({ installRoot: plan.installRoot });
  eligibleGraph(last, ctx);
  if (graphHash(last) !== referencesSha256) throw fail('REFERENCE_GRAPH_CHANGED');
  return {
    referencesSha256,
    retainedProofSha256: hash({
      schema: 'workbridge-retained-purge-proof/1',
      planSha256: planSha,
      manifestSha256: binding.manifestSha256,
      retainedBindingSha256: plan.retainedBindingSha256,
      metadataSha256: plan.metadataSha256,
    }),
  };
}
