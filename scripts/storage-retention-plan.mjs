import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { previewRuntimeRetention as defaultPreview } from './preview-runtime-retention.mjs';
import { loadBoundedJson } from './storage-retention-references.mjs';
import { verifyRuntimeDuplicate as defaultVerify } from './storage-retention-duplicates.mjs';
import { canonicalPlanSha256 } from './storage-retention-quarantine.mjs';

const fail = (code) => Object.assign(new Error(code), { code });
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const device = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const hashPattern = /^[a-f0-9]{64}$/i;
const runtime = new Set(['dist', 'node_modules', 'package.json', 'package-lock.json']);
const transient = new Set([
  'bytesRead',
  'bytesHashed',
  'filesHashed',
  'entriesVisited',
  'elapsedMs',
  'limits',
]);
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ':' + canonical(value[key]))
        .join(',') +
      '}'
    );
  if (value === undefined || (typeof value === 'number' && !Number.isFinite(value)))
    throw fail('INVALID_EVIDENCE');
  return JSON.stringify(value);
}
const hash = (value) => createHash('sha256').update(canonical(value)).digest('hex');
function sha(value) {
  if (typeof value !== 'string' || !hashPattern.test(value)) throw fail('EVIDENCE_HASH_UNAVAILABLE');
  return value.toLowerCase();
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !transient.has(key))
        .map(([key, child]) => [key, stable(child)]),
    );
  return value;
}
function graphProjection(graph) {
  const result = stable(graph);
  result.operations?.sort((a, b) => a.id.localeCompare(b.id));
  result.references?.sort((a, b) => canonical(a).localeCompare(canonical(b)));
  result.protectedPaths?.sort();
  for (const op of result.operations ?? []) op.protectedPaths?.sort();
  return result;
}
const samePath = (a, b) =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
function within(root, file) {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
}
const overlap = (a, b) => within(a, b) || within(b, a);
function selectionPaths(installRoot, updaterOperationId, kind, resourceRoot) {
  const opRoot = path.join(installRoot, '.local', 'update-operations', updaterOperationId);
  let displacedId = null;
  if (kind === 'displaced') {
    displacedId = path.basename(resourceRoot);
    if (!/^[a-f0-9]{32}$/i.test(displacedId)) throw fail('DISPLACED_LAYOUT_UNKNOWN');
    displacedId = displacedId.toLowerCase();
  }
  const source =
    kind === 'candidate' ? path.join(opRoot, 'candidate') : path.join(opRoot, 'displaced', displacedId);
  if (!samePath(resourceRoot, source)) throw fail('SOURCE_OUT_OF_SCOPE');
  return { opRoot, source, displacedId };
}
function normalizedBindings(bindings) {
  if (!Array.isArray(bindings) || bindings.length < 3) throw fail('METADATA_BINDINGS_UNAVAILABLE');
  const seen = new Set();
  return bindings
    .map((binding) => {
      const file = binding.file ?? binding.path;
      if (
        typeof file !== 'string' ||
        !path.isAbsolute(file) ||
        !binding.identity ||
        typeof binding.identity !== 'object'
      )
        throw fail('METADATA_BINDINGS_UNAVAILABLE');
      const key = path.resolve(file).toLowerCase();
      if (seen.has(key)) throw fail('METADATA_BINDINGS_UNAVAILABLE');
      seen.add(key);
      return { file: path.resolve(file), sha256: sha(binding.sha256), identity: binding.identity };
    })
    .sort((a, b) => a.file.localeCompare(b.file));
}
function nativeIdentity(value) {
  if (
    !value ||
    !['volume', 'id'].every((key) => typeof value[key] === 'string' && /^[a-f0-9]{1,64}$/i.test(value[key]))
  )
    throw fail('NATIVE_IDENTITY_UNAVAILABLE');
  return Object.fromEntries(['volume', 'id'].map((key) => [key, value[key].toLowerCase()]));
}
function oldEnough(value, now) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value))
    throw fail('OPERATION_AGE_UNAVAILABLE');
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 19) !== value.slice(0, 19))
    throw fail('OPERATION_AGE_UNAVAILABLE');
  if (now - time < 14 * 86400000) throw fail('OPERATION_TOO_RECENT');
}
async function build(options, deps) {
  const { updaterOperationId, kind } = options;
  if (
    typeof options.installRoot !== 'string' ||
    !path.isAbsolute(options.installRoot) ||
    typeof updaterOperationId !== 'string' ||
    !idPattern.test(updaterOperationId) ||
    device.test(updaterOperationId) ||
    !['candidate', 'displaced'].includes(kind)
  )
    throw fail('INVALID_PLAN_SELECTION');
  const installRoot = path.resolve(options.installRoot);
  const host = os.hostname().toUpperCase();
  if (typeof deps.inspectLocations !== 'function') throw fail('NATIVE_IDENTITY_UNAVAILABLE');
  const previewer = deps.previewRuntimeRetention ?? defaultPreview;
  const checkGraph = (view) => {
    if (view.references?.complete !== true || view.references.chain?.complete !== true)
      throw fail('REFERENCE_GRAPH_INCOMPLETE');
    if (!samePath(view.installRoot, installRoot) || !samePath(view.references.installRoot, installRoot))
      throw fail('INSTALL_ROOT_MISMATCH');
    const graph = view.references;
    if (
      !Array.isArray(graph.operations) ||
      graph.operations.some(
        (operation) =>
          ![
            'completed',
            'rolled_back',
            'failed_rolled_back',
            'preflight_failed',
            'controller_preflight_refused',
          ].includes(operation.phase),
      )
    )
      throw fail('UNRESOLVED_UPDATER_OPERATION');
    if (
      !graph.installed?.operationId ||
      graph.installed.sealBinding?.status !== 'manifest-bound' ||
      !graph.installed.binding ||
      !graph.installed.sealBinding.manifestBinding ||
      !graph.installed.sealBinding.validatedBinding
    )
      throw fail('ACTIVE_SEAL_UNAVAILABLE');
    const op = graph.operations?.find((row) => row.id === updaterOperationId);
    if (!op || op.phase !== 'completed' || !op.comparisonScopes?.includes(kind))
      throw fail('OPERATION_NOT_COMPARABLE');
    if ([graph.installed.operationId, graph.chain.operationIds?.[1]].includes(updaterOperationId))
      throw fail('PROTECTED_UPDATER_GENERATION');
    oldEnough(op.updatedUtc, (deps.now ?? Date.now)());
    return { graph, op };
  };
  // Metadata refusals precede potentially expensive duplicate-byte proofs.
  // The selected preview then reacquires the graph and repeats every policy gate.
  checkGraph(await previewer({ installRoot }));
  const preview = await previewer({ installRoot, operationId: updaterOperationId, kind });
  const { graph, op } = checkGraph(preview);
  if (
    preview.complete !== true ||
    preview.comparison?.verifiedDuplicate !== true ||
    preview.comparison.invalidated === true
  )
    throw fail('DUPLICATE_PROOF_UNAVAILABLE');
  const selection = preview.selection;
  if (selection?.operationId !== updaterOperationId || selection.kind !== kind)
    throw fail('SELECTION_BINDING_MISMATCH');
  const { opRoot, source, displacedId } = selectionPaths(
    installRoot,
    updaterOperationId,
    kind,
    selection.resourceRoot,
  );
  for (const reference of graph.references ?? []) {
    if (typeof reference.path !== 'string' || !path.isAbsolute(reference.path))
      throw fail('INVALID_REFERENCE_PATH');
    if (overlap(source, reference.path)) throw fail('REFERENCED_RESOURCE');
  }
  for (const protectedPath of graph.protectedPaths ?? []) {
    if (samePath(protectedPath, opRoot)) continue; // The old operation's allowed copy is inside its audit root.
    if (overlap(source, protectedPath)) throw fail('PROTECTED_RESOURCE');
  }
  const retainedRoot =
    kind === 'candidate'
      ? path.join(op.release?.path ?? '', 'payload')
      : path.join(opRoot, 'backup', 'runtime');
  if (
    (kind === 'candidate' && op.release?.scope !== 'internal') ||
    !within(installRoot, retainedRoot) ||
    !samePath(selection.retainedRoot, retainedRoot)
  )
    throw fail('RETAINED_RESOURCE_OUT_OF_SCOPE');
  const metadataBindings = normalizedBindings(selection.metadataBindings);
  const expectedFiles = [
    path.join(opRoot, 'request.json'),
    path.join(opRoot, 'journal.json'),
    ...(kind === 'candidate'
      ? [path.join(op.release.path, 'manifest.json'), path.join(op.release.path, 'validated.json')]
      : [path.join(opRoot, 'backup-manifest.json')]),
  ];
  if (
    metadataBindings.length !== expectedFiles.length ||
    expectedFiles.some((file) => !metadataBindings.some((binding) => samePath(binding.file, file)))
  )
    throw fail('METADATA_BINDINGS_UNAVAILABLE');
  const locations = await deps.inspectLocations({
    installRoot,
    operationId: 'preview',
    plan: { updaterOperationId, kind, displacedId },
    source,
    destination: path.join(installRoot, '.local', 'storage-quarantine', 'preview', 'payload'),
    operationDir: path.join(installRoot, '.local', 'storage-quarantine', 'preview'),
  });
  if (locations?.source?.exists !== true) throw fail('NATIVE_IDENTITY_UNAVAILABLE');
  const plan = {
    schema: 'workbridge-retention-plan/1',
    host,
    installRoot,
    updaterOperationId,
    kind,
    displacedId,
    sourceIdentity: nativeIdentity(locations.source.identity),
    manifestSha256: sha(selection.manifestBinding?.sha256),
    retainedBindingSha256: hash({
      retainedRoot,
      retainedTreeSha256: sha(preview.comparison.retainedTreeSha256),
    }),
    metadataSha256: hash(metadataBindings),
    referencesSha256: hash(graphProjection(graph)),
    sourceTreeSha256: sha(preview.comparison.sourceTreeSha256),
  };
  canonicalPlanSha256(plan);
  return plan;
}
export async function createRetentionPlan(options, deps = {}) {
  try {
    return await build(options, deps);
  } catch (error) {
    return { status: 'refused', code: error.code ?? 'PLAN_UNAVAILABLE', mutationEligible: false };
  }
}
export async function revalidateRetentionPlan(plan, deps = {}) {
  const expected = canonicalPlanSha256(plan);
  if (plan.host.toLowerCase() !== os.hostname().toLowerCase()) throw fail('IDENTITY_MISMATCH');
  const current = await build(plan, deps);
  if (canonicalPlanSha256(current) !== expected) throw fail('STALE_RETENTION_PLAN');
  return current;
}
export async function verifyRetentionPayload(plan, locationRoot, deps = {}) {
  try {
    canonicalPlanSha256(plan);
    if (
      typeof locationRoot !== 'string' ||
      !path.isAbsolute(locationRoot) ||
      !within(plan.installRoot, locationRoot)
    )
      throw fail('PAYLOAD_OUT_OF_SCOPE');
    const original =
      plan.kind === 'candidate'
        ? path.join(plan.installRoot, '.local', 'update-operations', plan.updaterOperationId, 'candidate')
        : path.join(
            plan.installRoot,
            '.local',
            'update-operations',
            plan.updaterOperationId,
            'displaced',
            plan.displacedId,
          );
    const quarantine = path
      .relative(path.join(plan.installRoot, '.local', 'storage-quarantine'), locationRoot)
      .split(path.sep);
    if (
      !samePath(locationRoot, original) &&
      !(
        quarantine.length === 2 &&
        idPattern.test(quarantine[0]) &&
        !device.test(quarantine[0]) &&
        quarantine[1] === 'payload'
      )
    )
      throw fail('PAYLOAD_OUT_OF_SCOPE');
    const load = deps.loadBoundedJson ?? loadBoundedJson;
    const bindings = [],
      opRoot = path.join(plan.installRoot, '.local', 'update-operations', plan.updaterOperationId);
    const read = async (file) => {
      const result = await load(file, { installRoot: plan.installRoot, maxBytes: 2 * 1024 * 1024 });
      bindings.push({ file, sha256: result.sha256, identity: result.identity });
      return result;
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
    let manifest,
      retainedRoot,
      retainedRuntimeSubset = false;
    if (plan.kind === 'candidate') {
      if (
        typeof request.value.releasePath !== 'string' ||
        !path.isAbsolute(request.value.releasePath) ||
        !within(plan.installRoot, request.value.releasePath)
      )
        throw fail('RELEASE_OUT_OF_SCOPE');
      manifest = await read(path.join(request.value.releasePath, 'manifest.json'));
      await read(path.join(request.value.releasePath, 'validated.json'));
      retainedRoot = path.join(request.value.releasePath, 'payload');
      retainedRuntimeSubset = true;
    } else {
      manifest = await read(path.join(opRoot, 'backup-manifest.json'));
      retainedRoot = path.join(opRoot, 'backup', 'runtime');
    }
    if (
      sha(manifest.sha256) !== plan.manifestSha256 ||
      hash(normalizedBindings(bindings)) !== plan.metadataSha256
    )
      throw fail('METADATA_BINDING_MISMATCH');
    if (!Array.isArray(manifest.value.files)) throw fail('INVALID_MANIFEST');
    const manifestFiles = retainedRuntimeSubset
      ? manifest.value.files.filter(
          (entry) =>
            typeof entry?.path === 'string' && runtime.has(entry.path.split(/[\\/]/)[0].toLowerCase()),
        )
      : manifest.value.files;
    const comparison = await (deps.verifyRuntimeDuplicate ?? defaultVerify)({
      resourceRoot: locationRoot,
      retainedRoot,
      manifestFiles,
      retainedRuntimeSubset,
    });
    if (
      comparison.verifiedDuplicate !== true ||
      sha(comparison.sourceTreeSha256) !== plan.sourceTreeSha256 ||
      hash({ retainedRoot, retainedTreeSha256: sha(comparison.retainedTreeSha256) }) !==
        plan.retainedBindingSha256
    )
      throw fail('PAYLOAD_PROOF_MISMATCH');
    // Selected restore evidence must remain bound while hashing the archived copy.
    for (const prior of bindings) {
      const current = await load(prior.file, { installRoot: plan.installRoot, maxBytes: 2 * 1024 * 1024 });
      if (
        sha(current.sha256) !== sha(prior.sha256) ||
        canonical(current.identity) !== canonical(prior.identity)
      )
        throw fail('METADATA_CHANGED');
    }
    return true;
  } catch (error) {
    return { status: 'refused', code: error.code ?? 'PAYLOAD_PROOF_UNAVAILABLE', verified: false };
  }
}
