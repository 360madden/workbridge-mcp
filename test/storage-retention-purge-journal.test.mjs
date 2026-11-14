import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  canonicalPurgeJson,
  inspectPurgeLedger,
  runPurge,
} from '../scripts/storage-retention-purge-journal.mjs';

const encode = (v) => Buffer.from(`${canonicalPurgeJson(v)}\n`);
const hash = (v) => createHash('sha256').update(v).digest('hex');
function fixture(count = 3) {
  const id = (n) => n.toString(16).padStart(32, '0');
  const identity = (n) => ({ volume: '1'.repeat(16), id: id(n) });
  const entries = [{ path: '', type: 'directory', identity: identity(1), size: 0, nlink: 1, sha256: null }];
  for (let i = 1; i < count; i++)
    entries.push({
      path: `f${String(i).padStart(3, '0')}`,
      type: 'file',
      identity: identity(i + 1),
      size: 1,
      nlink: 1,
      sha256: 'a'.repeat(64),
    });
  const manifest = {
    schema: 'workbridge-purge-manifest/1',
    operationId: 'gc1',
    planSha256: 'b'.repeat(64),
    quarantineReceiptSha256: 'c'.repeat(64),
    expectedRoot: identity(1),
    entries,
  };
  const manifestBytes = encode(manifest);
  const approval = {
    schema: 'workbridge-purge-approval/1',
    operationId: 'gc1',
    planSha256: manifest.planSha256,
    quarantineReceiptSha256: manifest.quarantineReceiptSha256,
    manifestSha256: hash(manifestBytes),
    referencesSha256: 'd'.repeat(64),
    retainedProofSha256: 'e'.repeat(64),
  };
  const approvalBytes = encode(approval);
  const files = { 'purge-manifest.json': manifestBytes, 'purge-approval.json': approvalBytes };
  const ctx = {
    operationId: 'gc1',
    planSha256: manifest.planSha256,
    quarantineReceiptSha256: manifest.quarantineReceiptSha256,
    maintenanceConfirmed: true,
    confirmPermanentlyDelete: 'gc1',
    expectedPurgeSha256: hash(approvalBytes),
  };
  const f = { files, ctx, missing: 0, failAt: null, conflict: false, proof: true };
  const check = (name) => {
    if (f.failAt === name) {
      f.failAt = null;
      throw Error('simulated crash');
    }
  };
  const guard = {
    async readJournals() {
      return { ...files };
    },
    async inspectRemaining({ committedPrefix, inflightEnd }) {
      if (f.conflict || f.missing < committedPrefix || f.missing > (inflightEnd ?? committedPrefix))
        throw Error('tree conflict');
      return {
        status: 'ok',
        remaining: {
          complete: true,
          sourcePresent: false,
          committedPrefix,
          observedAbsentPrefix: f.missing,
          entryCount: count,
          rootPresent: f.missing < count,
        },
      };
    },
    async publish(kind, record) {
      check(`before-${kind}`);
      const name =
        kind === 'intent' || kind === 'done'
          ? `purge-batch-${String(record.start).padStart(5, '0')}.${kind}.json`
          : `${kind}.json`;
      if (files[name]) throw Error('duplicate');
      files[name] = encode(record);
      check(`after-${kind}`);
    },
    async deleteBatch({ start, end }) {
      const firstIndex = f.missing;
      check('before-delete');
      while (f.missing < end) {
        f.missing++;
        check('after-item');
        if (f.missing === end) check('after-last-item');
      }
      return { status: 'ok', firstIndex, nextIndex: end, removedCount: end - firstIndex };
    },
  };
  f.deps = {
    withPurgeLease: async (_ctx, callback) => callback(guard),
    revalidateSafety: async () =>
      f.proof
        ? { referencesSha256: approval.referencesSha256, retainedProofSha256: approval.retainedProofSha256 }
        : null,
  };
  return f;
}
test('purge batches complete and repeat idempotently', async () => {
  const f = fixture(35);
  const first = await runPurge(f.ctx, f.deps);
  assert.equal(first.logicalBytesRemoved, 34);
  assert.equal(f.missing, 35);
  assert.equal(inspectPurgeLedger(f.files, f.ctx).status, 'purged');
  assert.equal((await runPurge(f.ctx, f.deps)).alreadyPurged, true);
});
for (const crash of [
  'before-intent',
  'after-intent',
  'before-delete',
  'after-item',
  'after-last-item',
  'before-done',
  'after-done',
  'before-purged',
]) {
  test(`resumes after ${crash}`, async () => {
    const f = fixture();
    f.failAt = crash;
    await assert.rejects(runPurge(f.ctx, f.deps));
    assert.notEqual(inspectPurgeLedger(f.files, f.ctx).status, 'purged');
    assert.equal((await runPurge(f.ctx, f.deps)).status, 'purged');
  });
}
test('root absence without final marker never reports success', async () => {
  const f = fixture();
  f.failAt = 'before-purged';
  await assert.rejects(runPurge(f.ctx, f.deps));
  assert.equal(f.missing, 3);
  assert.equal(inspectPurgeLedger(f.files, f.ctx).status, 'partial');
});
test('a crash after final marker publication resumes idempotently', async () => {
  const f = fixture();
  f.failAt = 'after-purged';
  await assert.rejects(runPurge(f.ctx, f.deps));
  assert.equal(inspectPurgeLedger(f.files, f.ctx).status, 'purged');
  assert.equal((await runPurge(f.ctx, f.deps)).alreadyPurged, true);
});
test('changed approval and retained proof prevent mutation', async () => {
  const f = fixture();
  f.files['purge-approval.json'] = Buffer.from('{}\n');
  await assert.rejects(runPurge(f.ctx, f.deps));
  assert.equal(f.missing, 0);
  const g = fixture();
  g.proof = false;
  await assert.rejects(runPurge(g.ctx, g.deps), /PURGE_SAFETY_CHANGED/);
  assert.equal(Object.keys(g.files).length, 2);
});
test('changed safety proof stops before the next batch and can resume', async () => {
  const f = fixture(35);
  const validProof = f.deps.revalidateSafety;
  f.deps.revalidateSafety = async () => (f.missing >= 32 ? null : validProof());
  await assert.rejects(runPurge(f.ctx, f.deps), /PURGE_SAFETY_CHANGED/);
  assert.equal(f.missing, 32);
  assert.ok(f.files['purge-batch-00000.done.json']);
  assert.equal(f.files['purge-batch-00032.intent.json'], undefined);
  assert.equal(f.files['purged.json'], undefined);
  f.deps.revalidateSafety = validProof;
  assert.equal((await runPurge(f.ctx, f.deps)).status, 'purged');
  assert.equal(f.missing, 35);
});
test('changed safety proof prevents the final marker and permits recovery', async () => {
  const f = fixture();
  const validProof = f.deps.revalidateSafety;
  f.deps.revalidateSafety = async () => (f.missing === 3 ? null : validProof());
  await assert.rejects(runPurge(f.ctx, f.deps), /PURGE_SAFETY_CHANGED/);
  assert.equal(f.missing, 3);
  assert.equal(f.files['purged.json'], undefined);
  assert.equal(inspectPurgeLedger(f.files, f.ctx).status, 'partial');
  f.deps.revalidateSafety = validProof;
  assert.equal((await runPurge(f.ctx, f.deps)).status, 'purged');
});
test('safety change after intent prevents the batch deletion', async () => {
  const f = fixture();
  const validProof = f.deps.revalidateSafety;
  f.deps.revalidateSafety = async () => (f.files['purge-batch-00000.intent.json'] ? null : validProof());
  await assert.rejects(runPurge(f.ctx, f.deps), /PURGE_SAFETY_CHANGED/);
  assert.equal(f.missing, 0);
  assert.ok(f.files['purge-batch-00000.intent.json']);
  assert.equal(f.files['purge-batch-00000.done.json'], undefined);
  f.deps.revalidateSafety = validProof;
  assert.equal((await runPurge(f.ctx, f.deps)).status, 'purged');
});
test('unexpected tree changes and invalid ledger fail closed', async () => {
  const f = fixture();
  f.conflict = true;
  await assert.rejects(runPurge(f.ctx, f.deps));
  assert.equal(f.missing, 0);
  const g = fixture();
  g.files['purge-batch-00032.done.json'] = encode({});
  assert.throws(() => inspectPurgeLedger(g.files, g.ctx), /PURGE_LEDGER_CONFLICT/);
  const h = fixture();
  h.files['purge-unknown.json'] = encode({});
  assert.throws(() => inspectPurgeLedger(h.files, h.ctx), /PURGE_JOURNAL_NAMESPACE/);
});
test('missing native or explicit confirmations fail closed', async () => {
  const f = fixture();
  await assert.rejects(runPurge(f.ctx, {}), /PURGE_NATIVE_CAPABILITY_REQUIRED/);
  f.ctx.confirmPermanentlyDelete = 'other';
  await assert.rejects(runPurge(f.ctx, f.deps), /PURGE_CONFIRMATION_REQUIRED/);
});
