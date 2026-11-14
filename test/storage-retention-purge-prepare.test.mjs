import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { preparePurge } from '../scripts/storage-retention-purge-prepare.mjs';

const sha = (c) => c.repeat(64);
function fixture() {
  const identity = { volume: '1'.repeat(16), id: '2'.repeat(32) };
  const ctx = { installRoot: os.tmpdir(), operationId: 'gc-fixture', plan: { sourceIdentity: identity } };
  const journal = {
    ctx,
    intent: { planSha256: sha('a') },
    bindings: { quarantined: { sha256: sha('B') } },
    phases: {},
    markers: {
      quarantined: {
        schema: 'workbridge-retention-phase/2',
        publishedAtUtc: new Date(Date.now() - 8 * 86400000).toISOString(),
      },
    },
  };
  const inventory = {
    schema: 'workbridge-retention-inventory/1',
    complete: true,
    nonAtomic: true,
    namedStreams: 0,
    totalBytes: 0,
    mutationAuthorized: false,
    entries: [{ path: '', type: 'directory', identity, size: 0, nlink: 1, sha256: null }],
  };
  let published = 0;
  const guard = {
    inspectInventory: async () => inventory,
    publishPurgePreparation: async (value) => {
      published++;
      return { status: 'ok', operationId: ctx.operationId, ...value, purgeSha256: value.expectedPurgeSha256 };
    },
  };
  const deps = {
    loadRetentionJournal: async () => structuredClone(journal),
    revalidateSafety: async () => ({ referencesSha256: sha('c'), retainedProofSha256: sha('d') }),
    withPurgePreparation: async (context, callback) => {
      assert.equal(context.maintenanceConfirmed, true);
      return callback(guard);
    },
  };
  const options = { installRoot: ctx.installRoot, operationId: ctx.operationId, maintenanceConfirmed: true };
  return { journal, deps, guard, options, published: () => published };
}

test('preparation binds normalized inventory and fresh proof without payload mutation', async () => {
  const f = fixture();
  const result = await preparePurge(f.options, f.deps);
  assert.equal(result.status, 'prepared');
  assert.equal(result.deletionAuthorized, false);
  assert.equal(result.payloadMutationPerformed, false);
  assert.equal(result.entryCount, 1);
  assert.match(result.purgeSha256, /^[a-f0-9]{64}$/);
  assert.equal(f.published(), 1);
});

test('changed journal prevents review record publication', async () => {
  const f = fixture();
  let n = 0;
  f.deps.loadRetentionJournal = async () => {
    const journal = structuredClone(f.journal);
    if (++n === 3) journal.bindings.quarantined.sha256 = sha('e');
    return journal;
  };
  await assert.rejects(preparePurge(f.options, f.deps), { code: 'PURGE_SAFETY_CHANGED' });
  assert.equal(f.published(), 0);
});

test('started or conflicting purge cannot prepare again', async () => {
  const f = fixture();
  f.journal.purgeJournal = 'purging-marker-present';
  await assert.rejects(preparePurge(f.options, f.deps), { code: 'PURGE_JOURNAL_PRESENT' });
  assert.equal(f.published(), 0);
});

test('recent, future, legacy and restoring quarantine cannot prepare', async () => {
  for (const kind of ['recent', 'future', 'legacy', 'restoring']) {
    const f = fixture();
    if (kind === 'legacy') f.journal.markers.quarantined.schema = 'workbridge-retention-phase/1';
    else if (kind === 'restoring') f.journal.phases.restoring = true;
    else
      f.journal.markers.quarantined.publishedAtUtc = new Date(
        Date.now() + (kind === 'future' ? 86400000 : -86400000),
      ).toISOString();
    await assert.rejects(preparePurge(f.options, f.deps), { code: 'PURGE_GRACE_OR_PHASE_REFUSED' });
    assert.equal(f.published(), 0);
  }
});

test('missing maintenance and uncertain publication cannot report prepared', async () => {
  const f = fixture();
  await assert.rejects(preparePurge({ ...f.options, maintenanceConfirmed: false }, f.deps), {
    code: 'MAINTENANCE_REQUIRED',
  });
  f.guard.publishPurgePreparation = async () => ({ status: 'ok' });
  await assert.rejects(preparePurge(f.options, f.deps), { code: 'PURGE_PREPARATION_PUBLICATION_UNCERTAIN' });
});
