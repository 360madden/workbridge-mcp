import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { canonicalPlanSha256 } from '../scripts/storage-retention-quarantine.mjs';
import { inspectPurgeGrace, QUARANTINE_GRACE_MS } from '../scripts/storage-retention-purge.mjs';

async function fixture(t, markerSchema = 2) {
  const installRoot = await mkdtemp(path.join(os.tmpdir(), 'wb-retention-grace-'));
  t.after(() => rm(installRoot, { recursive: true, force: true }));
  const operationId = 'grace-fixture';
  const dir = path.join(installRoot, '.local', 'storage-quarantine', operationId);
  await mkdir(dir, { recursive: true });
  const plan = {
    schema: 'workbridge-retention-plan/1',
    host: os.hostname(),
    installRoot,
    updaterOperationId: 'old-update',
    kind: 'candidate',
    displacedId: null,
    sourceIdentity: { volume: 'abc', id: 'def' },
    manifestSha256: 'a'.repeat(64),
    retainedBindingSha256: 'b'.repeat(64),
    metadataSha256: 'c'.repeat(64),
    referencesSha256: 'd'.repeat(64),
    sourceTreeSha256: 'e'.repeat(64),
  };
  const planSha256 = canonicalPlanSha256(plan);
  const intent = { schema: 'workbridge-retention-intent/1', operationId, planSha256, plan };
  const publishedAtUtc = '2026-11-01T00:00:00.000Z';
  const marker = {
    schema: `workbridge-retention-phase/${markerSchema}`,
    operationId,
    planSha256,
    phase: 'quarantined',
    ...(markerSchema === 2 ? { publishedAtUtc } : {}),
  };
  await writeFile(path.join(dir, 'intent.json'), JSON.stringify(intent));
  if (markerSchema) await writeFile(path.join(dir, 'quarantined.json'), JSON.stringify(marker));
  const locations = {
    sameVolume: true,
    source: { exists: false },
    destination: { exists: true, identity: plan.sourceIdentity },
  };
  const deps = { inspectLocations: async () => locations };
  return { installRoot, operationId, dir, plan, planSha256, marker, publishedAtUtc, locations, deps };
}

test('seven full days threshold and future receipt are exact', async (t) => {
  const f = await fixture(t);
  const then = Date.parse(f.publishedAtUtc);
  const inspect = (now) =>
    inspectPurgeGrace({ installRoot: f.installRoot, operationId: f.operationId, now }, f.deps);
  assert.equal((await inspect(then + QUARANTINE_GRACE_MS - 1)).reason, 'GRACE_NOT_ELAPSED');
  const ready = await inspect(then + QUARANTINE_GRACE_MS);
  assert.equal(ready.eligible, true);
  assert.equal(ready.mutationAuthorized, false);
  assert.equal(ready.reason, 'GRACE_ELAPSED');
  assert.equal((await inspect(then - 1)).reason, 'FUTURE_RECEIPT');
});

test('legacy or missing marker cannot establish grace', async (t) => {
  const legacy = await fixture(t, 1);
  const inspect = (f) =>
    inspectPurgeGrace({ installRoot: f.installRoot, operationId: f.operationId }, f.deps);
  assert.equal((await inspect(legacy)).reason, 'LEGACY_RECEIPT_NO_TIME');
  const absent = await fixture(t, 0);
  assert.equal((await inspect(absent)).reason, 'QUARANTINE_RECEIPT_MISSING');
});

test('invalid timestamps and marker identity fail closed', async (t) => {
  const f = await fixture(t);
  const inspect = () => inspectPurgeGrace({ installRoot: f.installRoot, operationId: f.operationId }, f.deps);
  for (const invalid of [
    '2026-02-30T00:00:00.000Z',
    '2026-11-01T00:00:00Z',
    '2026-11-01T00:00:00.000+00:00',
    'not-a-time',
  ]) {
    await writeFile(
      path.join(f.dir, 'quarantined.json'),
      JSON.stringify({ ...f.marker, publishedAtUtc: invalid }),
    );
    assert.equal((await inspect()).reason, 'INVALID_JOURNAL');
  }
  await writeFile(
    path.join(f.dir, 'quarantined.json'),
    JSON.stringify({ ...f.marker, planSha256: 'f'.repeat(64) }),
  );
  assert.equal((await inspect()).reason, 'INVALID_JOURNAL');
});

test('source present, wrong destination or restore phase refuses', async (t) => {
  const f = await fixture(t);
  const inspect = () => inspectPurgeGrace({ installRoot: f.installRoot, operationId: f.operationId }, f.deps);
  f.locations.source = { exists: true, identity: f.plan.sourceIdentity };
  assert.equal((await inspect()).reason, 'LOCATION_CONFLICT');
  f.locations.source = { exists: false };
  f.locations.destination = { exists: true, identity: { volume: 'abc', id: 'eee' } };
  assert.equal((await inspect()).reason, 'LOCATION_CONFLICT');
  f.locations.destination = { exists: true, identity: f.plan.sourceIdentity };
  await writeFile(path.join(f.dir, 'restoring.json'), JSON.stringify({ ...f.marker, phase: 'restoring' }));
  assert.equal((await inspect()).reason, 'RESTORE_IN_PROGRESS_OR_COMPLETE');
});

test('changed journal during location inspection is refused', async (t) => {
  const f = await fixture(t);
  const deps = {
    inspectLocations: async () => {
      await writeFile(
        path.join(f.dir, 'quarantined.json'),
        JSON.stringify({ ...f.marker, publishedAtUtc: '2026-11-02T00:00:00.000Z' }),
      );
      return f.locations;
    },
  };
  const result = await inspectPurgeGrace(
    { installRoot: f.installRoot, operationId: f.operationId, now: Date.parse('2026-12-01T00:00:00.000Z') },
    deps,
  );
  assert.equal(result.reason, 'JOURNAL_CHANGED');
  assert.equal(result.mutationAuthorized, false);
});
