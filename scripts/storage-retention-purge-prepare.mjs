import { createHash } from 'node:crypto';
import { loadRetentionJournal } from './storage-retention-quarantine.mjs';
import { QUARANTINE_GRACE_MS } from './storage-retention-purge.mjs';
import { canonicalPurgeJson } from './storage-retention-purge-journal.mjs';
import { normalizePurgeInventory } from './storage-retention-purge-inventory.mjs';
import { createPurgeSafetyProof } from './storage-retention-purge-proof.mjs';

const fail = (code) => Object.assign(new Error(code), { code });
const hash = (value) =>
  createHash('sha256')
    .update(`${canonicalPurgeJson(value)}\n`)
    .digest('hex');
const digest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

// Preparation publishes review records only. Deletion needs the separate digest-
// confirmed purge action; this function cannot invoke a delete capability.
export async function preparePurge(options, deps) {
  if (options.maintenanceConfirmed !== true) throw fail('MAINTENANCE_REQUIRED');
  if (typeof deps?.withPurgePreparation !== 'function') throw fail('PURGE_PREPARATION_CAPABILITY_REQUIRED');
  const load = deps.loadRetentionJournal ?? loadRetentionJournal;
  const proof = deps.revalidateSafety ?? createPurgeSafetyProof;
  const first = await load(options.installRoot, options.operationId);
  const ctx = {
    ...first.ctx,
    planSha256: first.intent.planSha256,
    quarantineReceiptSha256: first.bindings.quarantined?.sha256?.toLowerCase(),
    maintenanceConfirmed: true,
  };
  return deps.withPurgePreparation(ctx, async (guard) => {
    if (typeof guard.inspectInventory !== 'function' || typeof guard.publishPurgePreparation !== 'function')
      throw fail('PURGE_PREPARATION_CAPABILITY_REQUIRED');
    const journal = await load(options.installRoot, options.operationId);
    if (journal.purgeJournal) throw fail('PURGE_JOURNAL_PRESENT');
    if (canonicalPurgeJson(journal.bindings) !== canonicalPurgeJson(first.bindings))
      throw fail('PURGE_JOURNAL_CHANGED');
    const marker = journal.markers.quarantined;
    const timestamp = marker?.publishedAtUtc;
    const since = Date.parse(timestamp);
    if (
      marker?.schema !== 'workbridge-retention-phase/2' ||
      typeof timestamp !== 'string' ||
      !Number.isFinite(since) ||
      new Date(since).toISOString() !== timestamp ||
      Date.now() - since < QUARANTINE_GRACE_MS ||
      journal.phases.restoring ||
      journal.phases.restored ||
      !digest(ctx.quarantineReceiptSha256)
    )
      throw fail('PURGE_GRACE_OR_PHASE_REFUSED');
    const observed = await guard.inspectInventory();
    if (Object.hasOwn(observed, 'mutationAuthorized') && observed.mutationAuthorized !== false)
      throw fail('PURGE_INVENTORY_INVALID');
    const { mutationAuthorized: ignored, ...inventoryFields } = observed;
    const inventory = normalizePurgeInventory(inventoryFields, ctx.plan.sourceIdentity);
    const manifest = {
      schema: 'workbridge-purge-manifest/1',
      operationId: ctx.operationId,
      planSha256: ctx.planSha256,
      quarantineReceiptSha256: ctx.quarantineReceiptSha256,
      expectedRoot: ctx.plan.sourceIdentity,
      entries: inventory.entries,
    };
    const manifestSha256 = hash(manifest);
    const binding = { manifest, manifestSha256 };
    const safety = await proof(ctx, binding);
    if (!digest(safety?.referencesSha256) || !digest(safety?.retainedProofSha256))
      throw fail('PURGE_SAFETY_PROOF_INVALID');
    const approval = {
      schema: 'workbridge-purge-approval/1',
      operationId: ctx.operationId,
      planSha256: ctx.planSha256,
      quarantineReceiptSha256: ctx.quarantineReceiptSha256,
      manifestSha256,
      referencesSha256: safety.referencesSha256,
      retainedProofSha256: safety.retainedProofSha256,
    };
    const purgeSha256 = hash(approval);
    const latestJournal = await load(options.installRoot, options.operationId);
    if (
      latestJournal.purgeJournal ||
      canonicalPurgeJson(latestJournal.bindings) !== canonicalPurgeJson(journal.bindings)
    )
      throw fail('PURGE_SAFETY_CHANGED');
    const published = await guard.publishPurgePreparation({
      planSha256: ctx.planSha256,
      quarantineReceiptSha256: ctx.quarantineReceiptSha256,
      manifestSha256,
      referencesSha256: safety.referencesSha256,
      retainedProofSha256: safety.retainedProofSha256,
      expectedPurgeSha256: purgeSha256,
    });
    if (
      published?.status !== 'ok' ||
      published.operationId !== ctx.operationId ||
      published.planSha256 !== ctx.planSha256 ||
      published.quarantineReceiptSha256 !== ctx.quarantineReceiptSha256 ||
      published.manifestSha256 !== manifestSha256 ||
      published.purgeSha256 !== purgeSha256
    )
      throw fail('PURGE_PREPARATION_PUBLICATION_UNCERTAIN');
    return {
      schema: 'workbridge-purge-preparation/1',
      status: 'prepared',
      operationId: ctx.operationId,
      planSha256: ctx.planSha256,
      quarantineReceiptSha256: ctx.quarantineReceiptSha256,
      manifestSha256,
      purgeSha256,
      ...safety,
      entryCount: inventory.entries.length,
      logicalBytes: inventory.totalBytes,
      payloadMutationPerformed: false,
      deletionAuthorized: false,
      qualification:
        'Immutable review records only. Purge needs explicit operation and digest confirmation in coordinated quiet maintenance.',
    };
  });
}
