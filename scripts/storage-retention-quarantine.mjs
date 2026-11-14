import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { lstat, opendir } from 'node:fs/promises';
import { loadBoundedJson } from './storage-retention-references.mjs';
import { windowsMetadata } from './preview-storage-retention.mjs';

// This engine deliberately has no path-based move fallback. The maintenance
// provider must pin the relevant parents, serialize with the updater, and use a
// no-replace same-volume handle rename. No purge operation is exposed.
const fail = (code) => Object.assign(new Error(code), { code });
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const winDevice = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const planKeys = [
  'schema',
  'host',
  'installRoot',
  'updaterOperationId',
  'kind',
  'displacedId',
  'sourceIdentity',
  'manifestSha256',
  'retainedBindingSha256',
  'metadataSha256',
  'referencesSha256',
  'sourceTreeSha256',
];
const hashKeys = [
  'manifestSha256',
  'retainedBindingSha256',
  'metadataSha256',
  'referencesSha256',
  'sourceTreeSha256',
];

function validId(value) {
  return typeof value === 'string' && idPattern.test(value) && !winDevice.test(value);
}
function exactKeys(value, keys) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join('\0') === [...keys].sort().join('\0')
  );
}
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export function canonicalPlanSha256(plan) {
  validatePlan(plan);
  return createHash('sha256').update(canonical(plan), 'utf8').digest('hex');
}
function validatePlan(plan) {
  if (
    !exactKeys(plan, planKeys) ||
    plan.schema !== 'workbridge-retention-plan/1' ||
    typeof plan.host !== 'string' ||
    !plan.host ||
    typeof plan.installRoot !== 'string' ||
    !path.isAbsolute(plan.installRoot) ||
    path.resolve(plan.installRoot) !== plan.installRoot ||
    !validId(plan.updaterOperationId) ||
    !['candidate', 'displaced'].includes(plan.kind) ||
    (plan.kind === 'candidate'
      ? plan.displacedId !== null
      : !/^[a-f0-9]{32}$/i.test(plan.displacedId ?? '')) ||
    !exactKeys(plan.sourceIdentity, ['volume', 'id']) ||
    !['volume', 'id'].every(
      (k) => typeof plan.sourceIdentity[k] === 'string' && /^[a-f0-9]{1,64}$/i.test(plan.sourceIdentity[k]),
    ) ||
    hashKeys.some((key) => typeof plan[key] !== 'string' || !hashPattern.test(plan[key]))
  )
    throw fail('INVALID_PLAN');
}
function contextFor(installRoot, operationId, plan) {
  validatePlan(plan);
  if (
    !validId(operationId) ||
    typeof installRoot !== 'string' ||
    !path.isAbsolute(installRoot) ||
    path.resolve(installRoot) !== installRoot ||
    installRoot.toLowerCase() !== plan.installRoot.toLowerCase() ||
    plan.host.toLowerCase() !== os.hostname().toLowerCase()
  )
    throw fail('IDENTITY_MISMATCH');
  const operationDir = path.join(installRoot, '.local', 'storage-quarantine', operationId);
  const sourceBase = path.join(installRoot, '.local', 'update-operations', plan.updaterOperationId);
  const source =
    plan.kind === 'candidate'
      ? path.join(sourceBase, 'candidate')
      : path.join(sourceBase, 'displaced', plan.displacedId);
  return {
    installRoot,
    operationId,
    plan,
    source,
    destination: path.join(operationDir, 'payload'),
    operationDir,
  };
}
function sameId(actual, expected) {
  return (
    actual &&
    expected &&
    typeof actual.volume === 'string' &&
    typeof actual.id === 'string' &&
    actual.volume.toLowerCase() === expected.volume.toLowerCase() &&
    actual.id.toLowerCase() === expected.id.toLowerCase()
  );
}
const MISSING = Symbol('missing');
async function readObject(file, installRoot, metadata, missing = false) {
  try {
    return await loadBoundedJson(file, { installRoot, maxBytes: 65536, metadata });
  } catch (error) {
    const exactMissing =
      error.code === 'ENOENT' &&
      typeof error.path === 'string' &&
      path.resolve(error.path).toLowerCase() === path.resolve(file).toLowerCase();
    if (exactMissing && missing) return MISSING;
    if (exactMissing) throw fail('OPERATION_NOT_FOUND');
    throw error;
  }
}
export function validPhaseUtc(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const millis = Date.parse(value);
  return Number.isFinite(millis) && new Date(millis).toISOString() === value;
}
// The purge engine owns record validation. This engine only needs to observe
// when the operation has crossed from review into the destructive journal.
async function observePurgeJournal(dir) {
  const before = await lstat(dir, { bigint: true });
  if (!before.isDirectory() || before.isSymbolicLink()) throw fail('UNSAFE_JOURNAL_DIRECTORY');
  let count = 0;
  let started = false;
  let batch = false;
  let final = false;
  let unexpected = false;
  for await (const entry of await opendir(dir)) {
    if (++count > 2048) throw fail('JOURNAL_DIRECTORY_LIMIT');
    if (!/^purg(?:e|ing)/i.test(entry.name)) continue;
    if (!entry.isFile()) unexpected = true;
    else if (entry.name === 'purging.json') started = true;
    else if (entry.name === 'purged.json') final = true;
    else if (/^purge-batch-\d{5}\.(intent|done)\.json$/.test(entry.name)) batch = true;
    else if (!['purge-manifest.json', 'purge-approval.json'].includes(entry.name)) unexpected = true;
  }
  const after = await lstat(dir, { bigint: true });
  if (before.dev !== after.dev || before.ino !== after.ino || before.ctimeNs !== after.ctimeNs)
    throw fail('JOURNAL_DIRECTORY_CHANGED');
  if (unexpected || (!started && (batch || final)) || (final && !batch)) return 'conflicting-markers';
  if (final) return 'purged-marker-present';
  if (batch) return 'purge-batch-marker-present';
  return started ? 'purging-marker-present' : null;
}
function requireNoPurge(observed) {
  if (observed) throw fail('PURGE_JOURNAL_PRESENT');
}
export async function loadRetentionJournal(installRoot, operationId) {
  if (typeof installRoot !== 'string' || !path.isAbsolute(installRoot) || !validId(operationId))
    throw fail('INVALID_ARGUMENTS');
  const metadata = windowsMetadata();
  try {
    const dir = path.join(installRoot, '.local', 'storage-quarantine', operationId);
    const intentBinding = await readObject(path.join(dir, 'intent.json'), installRoot, metadata);
    const intent = intentBinding.value;
    if (
      !exactKeys(intent, ['schema', 'operationId', 'planSha256', 'plan']) ||
      intent.schema !== 'workbridge-retention-intent/1' ||
      intent.operationId !== operationId ||
      canonicalPlanSha256(intent.plan) !== intent.planSha256
    )
      throw fail('INVALID_JOURNAL');
    const ctx = contextFor(installRoot, operationId, intent.plan);
    const phases = {},
      markers = {},
      bindings = { intent: { sha256: intentBinding.sha256, identity: intentBinding.identity } };
    for (const phase of ['quarantined', 'restoring', 'restored']) {
      const binding = await readObject(path.join(dir, `${phase}.json`), installRoot, metadata, true);
      const marker = binding === MISSING ? MISSING : binding.value;
      if (
        marker !== MISSING &&
        (!(marker?.schema === 'workbridge-retention-phase/1'
          ? exactKeys(marker, ['schema', 'operationId', 'planSha256', 'phase'])
          : marker?.schema === 'workbridge-retention-phase/2' &&
            exactKeys(marker, ['schema', 'operationId', 'planSha256', 'phase', 'publishedAtUtc']) &&
            validPhaseUtc(marker.publishedAtUtc)) ||
          marker.operationId !== operationId ||
          marker.planSha256 !== intent.planSha256 ||
          marker.phase !== phase)
      )
        throw fail('INVALID_JOURNAL');
      phases[phase] = marker !== MISSING;
      markers[phase] = marker === MISSING ? null : marker;
      bindings[phase] = binding === MISSING ? null : { sha256: binding.sha256, identity: binding.identity };
    }
    if ((phases.restoring && !phases.quarantined) || (phases.restored && !phases.restoring))
      throw fail('INVALID_JOURNAL');
    const purgeJournal = await observePurgeJournal(dir);
    return { intent, ctx, phases, markers, bindings: { ...bindings, purgeJournal }, purgeJournal };
  } finally {
    metadata.close();
  }
}
async function publishPhase(guard, ctx, hash, name) {
  requireNoPurge(await observePurgeJournal(ctx.operationDir));
  await guard.publishPhase({ phase: name, planSha256: hash });
  const journal = await loadRetentionJournal(ctx.installRoot, ctx.operationId);
  if (journal.intent.planSha256 !== hash || journal.phases[name] !== true) throw fail('INVALID_JOURNAL');
  return journal;
}
export function classifyRetentionJournal(journal, locations) {
  const { intent, phases } = journal;
  const source = locations?.source,
    destination = locations?.destination;
  if (
    typeof source?.exists !== 'boolean' ||
    typeof destination?.exists !== 'boolean' ||
    locations?.sameVolume !== true
  )
    throw fail('LOCATION_PROOF_UNAVAILABLE');
  const sourceMatch = source.exists && sameId(source.identity, intent.plan.sourceIdentity);
  const destinationMatch = destination.exists && sameId(destination.identity, intent.plan.sourceIdentity);
  if (journal.purgeJournal) {
    const conflict =
      journal.purgeJournal === 'conflicting-markers' ||
      !phases.quarantined ||
      phases.restoring ||
      source.exists ||
      (destination.exists && !destinationMatch) ||
      (journal.purgeJournal === 'purging-marker-present' && !destination.exists) ||
      (journal.purgeJournal === 'purged-marker-present' && destination.exists);
    return {
      operationId: intent.operationId,
      planSha256: intent.planSha256,
      state: conflict ? 'conflict' : 'purge-controlled',
      purgeJournal: journal.purgeJournal,
      purgeLedgerVerified: false,
      pendingCommit: false,
      source,
      destination,
    };
  }
  let state = 'conflict',
    pendingCommit = false;
  if (sourceMatch && !destination.exists) {
    if (!phases.quarantined) state = 'prepared';
    else if (phases.restoring) {
      state = phases.restored ? 'restored' : 'restoring';
      pendingCommit = !phases.restored;
    }
  } else if (!source.exists && destinationMatch) {
    if (!phases.restoring) {
      state = 'quarantined';
      pendingCommit = !phases.quarantined;
    } else if (!phases.restored) state = 'restoring';
  }
  return {
    operationId: intent.operationId,
    planSha256: intent.planSha256,
    state,
    pendingCommit,
    source,
    destination,
  };
}
function requireDeps(deps, ...names) {
  if (names.some((name) => typeof deps[name] !== 'function')) throw fail('SAFE_MAINTENANCE_UNAVAILABLE');
}
async function guardCheck(guard) {
  if (
    !guard ||
    ['inspect', 'moveNoReplace', 'verifyPayload', 'publishPhase'].some((x) => typeof guard[x] !== 'function')
  )
    throw fail('SAFE_MAINTENANCE_UNAVAILABLE');
}
async function runFault(deps, name) {
  if (deps.fault) await deps.fault(name);
}

export async function retentionStatus({ installRoot, operationId }, deps = {}) {
  requireDeps(deps, 'inspectLocations');
  const journal = await loadRetentionJournal(installRoot, operationId);
  return classifyRetentionJournal(journal, await deps.inspectLocations(journal.ctx));
}

export async function quarantine(
  { installRoot, operationId, plan, expectedPlanSha256, maintenanceConfirmed },
  deps = {},
) {
  validatePlan(plan);
  plan = deepFreeze(structuredClone(plan));
  const ctx = contextFor(installRoot, operationId, plan);
  const hash = canonicalPlanSha256(plan);
  if (hash !== expectedPlanSha256) throw fail('PLAN_HASH_MISMATCH');
  if (maintenanceConfirmed !== true) throw fail('MAINTENANCE_REQUIRED');
  requireDeps(deps, 'prepareOperation', 'withMaintenance', 'revalidatePlan');
  const intent = { schema: 'workbridge-retention-intent/1', operationId, planSha256: hash, plan };
  await deps.prepareOperation(ctx, intent);
  const prepared = await loadRetentionJournal(installRoot, operationId);
  if (prepared.intent.planSha256 !== hash) throw fail('OPERATION_CONFLICT');
  return deps.withMaintenance(ctx, async (guard) => {
    await guardCheck(guard);
    let journal = await loadRetentionJournal(installRoot, operationId);
    requireNoPurge(journal.purgeJournal);
    if (journal.intent.planSha256 !== hash || journal.phases.restoring) throw fail('OPERATION_CONFLICT');
    let state = classifyRetentionJournal(journal, await guard.inspect());
    if (state.state === 'conflict') throw fail('LOCATION_CONFLICT');
    if (state.state === 'prepared') {
      if (canonicalPlanSha256(await deps.revalidatePlan(plan)) !== hash) throw fail('STALE_PLAN');
      state = classifyRetentionJournal(journal, await guard.inspect());
      if (state.state !== 'prepared') throw fail('LOCATION_CONFLICT');
      if ((await guard.verifyPayload('source', plan)) !== true) throw fail('PAYLOAD_CHANGED');
      state = classifyRetentionJournal(journal, await guard.inspect());
      if (state.state !== 'prepared') throw fail('LOCATION_CONFLICT');
      await runFault(deps, 'after-intent-before-rename');
      requireNoPurge(await observePurgeJournal(ctx.operationDir));
      await guard.moveNoReplace({ from: 'source', expectedIdentity: plan.sourceIdentity });
      await runFault(deps, 'after-rename-before-commit');
      state = classifyRetentionJournal(journal, await guard.inspect());
    }
    if (state.state !== 'quarantined' || (await guard.verifyPayload('destination', plan)) !== true)
      throw fail('LOCATION_CONFLICT');
    state = classifyRetentionJournal(journal, await guard.inspect());
    if (state.state !== 'quarantined') throw fail('LOCATION_CONFLICT');
    if (!journal.phases.quarantined) journal = await publishPhase(guard, ctx, hash, 'quarantined');
    else journal = await loadRetentionJournal(installRoot, operationId);
    return classifyRetentionJournal(journal, await guard.inspect());
  });
}

export async function restore(
  { installRoot, operationId, expectedPlanSha256, maintenanceConfirmed },
  deps = {},
) {
  if (maintenanceConfirmed !== true) throw fail('MAINTENANCE_REQUIRED');
  requireDeps(deps, 'withMaintenance');
  const prior = await loadRetentionJournal(installRoot, operationId);
  if (prior.intent.planSha256 !== expectedPlanSha256) throw fail('PLAN_HASH_MISMATCH');
  return deps.withMaintenance(prior.ctx, async (guard) => {
    await guardCheck(guard);
    let journal = await loadRetentionJournal(installRoot, operationId);
    requireNoPurge(journal.purgeJournal);
    if (journal.intent.planSha256 !== expectedPlanSha256) throw fail('OPERATION_CONFLICT');
    let state = classifyRetentionJournal(journal, await guard.inspect());
    if (state.state === 'conflict' || state.state === 'prepared' || !journal.phases.quarantined)
      throw fail('LOCATION_CONFLICT');
    if (state.state === 'restored') return state;
    let destinationVerified = false;
    if (!journal.phases.restoring) {
      if (
        state.state !== 'quarantined' ||
        (await guard.verifyPayload('destination', journal.intent.plan)) !== true
      )
        throw fail('PAYLOAD_CHANGED');
      state = classifyRetentionJournal(journal, await guard.inspect());
      if (state.state !== 'quarantined') throw fail('LOCATION_CONFLICT');
      destinationVerified = true;
      journal = await publishPhase(guard, prior.ctx, expectedPlanSha256, 'restoring');
    }
    state = classifyRetentionJournal(journal, await guard.inspect());
    if (state.state !== 'restoring') throw fail('LOCATION_CONFLICT');
    if (state.destination.exists) {
      if (!destinationVerified) {
        if ((await guard.verifyPayload('destination', journal.intent.plan)) !== true)
          throw fail('PAYLOAD_CHANGED');
        state = classifyRetentionJournal(journal, await guard.inspect());
        if (state.state !== 'restoring' || !state.destination.exists) throw fail('LOCATION_CONFLICT');
      }
      await runFault(deps, 'after-restore-intent-before-rename');
      requireNoPurge(await observePurgeJournal(prior.ctx.operationDir));
      await guard.moveNoReplace({
        from: 'destination',
        expectedIdentity: journal.intent.plan.sourceIdentity,
      });
      await runFault(deps, 'after-restore-rename-before-commit');
      state = classifyRetentionJournal(journal, await guard.inspect());
    }
    if (
      state.state !== 'restoring' ||
      !state.source.exists ||
      (await guard.verifyPayload('source', journal.intent.plan)) !== true
    )
      throw fail('LOCATION_CONFLICT');
    state = classifyRetentionJournal(journal, await guard.inspect());
    if (state.state !== 'restoring' || !state.source.exists) throw fail('LOCATION_CONFLICT');
    journal = await publishPhase(guard, prior.ctx, expectedPlanSha256, 'restored');
    return classifyRetentionJournal(journal, await guard.inspect());
  });
}
