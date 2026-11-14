import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, rm, lstat, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalPlanSha256 } from '../scripts/storage-retention-quarantine.mjs';
import { normalizePurgeInventory } from '../scripts/storage-retention-purge-inventory.mjs';
import { canonicalPurgeJson, runPurge } from '../scripts/storage-retention-purge-journal.mjs';
import { createPurgeProvider } from '../scripts/storage-retention-purge-provider.mjs';

const exec = promisify(execFile);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const maintenance = path.join(repo, 'scripts', 'Storage-RetentionMaintenance.ps1');
const purgeHelper = path.join(repo, 'scripts', 'Storage-RetentionPurge.ps1');
const powershell = path.join(
  process.env.SystemRoot || 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe',
);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const record = (value) => Buffer.from(`${canonicalPurgeJson(value)}\n`, 'utf8');

async function fixture(
  t,
  fileCount,
  { receiptSchema = 'workbridge-retention-phase/2', publishedAtUtc = '2020-01-01T00:00:00.000Z' } = {},
) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wb-purge-e2e-'));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const operationId = 'gcfixture',
    updaterOperationId = 'upfixture';
  const operationDir = path.join(root, '.local', 'storage-quarantine', operationId);
  const payload = path.join(operationDir, 'payload');
  await mkdir(payload, { recursive: true });
  await mkdir(path.join(root, '.local', 'update-operations', updaterOperationId), { recursive: true });
  await mkdir(path.join(payload, 'nested'));
  for (let i = 0; i < fileCount; i++)
    await writeFile(path.join(payload, `file-${String(i).padStart(3, '0')}`), `content-${i}`);
  await writeFile(path.join(payload, 'nested', 'file'), 'nested');
  const { stdout } = await exec(
    powershell,
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'RemoteSigned',
      '-File',
      maintenance,
      '-Mode',
      'Inventory',
      '-InstallRoot',
      root,
      '-OperationId',
      operationId,
      '-UpdaterOperationId',
      updaterOperationId,
      '-Kind',
      'candidate',
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  const snapshot = JSON.parse(stdout.trim());
  assert.equal(snapshot.status, 'ready');
  const expectedRoot = snapshot.destination.identity;
  const normalized = normalizePurgeInventory(snapshot.inventory, expectedRoot);
  const plan = {
    schema: 'workbridge-retention-plan/1',
    host: os.hostname(),
    installRoot: root,
    updaterOperationId,
    kind: 'candidate',
    displacedId: null,
    sourceIdentity: expectedRoot,
    manifestSha256: 'a'.repeat(64),
    retainedBindingSha256: 'b'.repeat(64),
    metadataSha256: 'c'.repeat(64),
    referencesSha256: 'd'.repeat(64),
    sourceTreeSha256: 'e'.repeat(64),
  };
  const planSha256 = canonicalPlanSha256(plan);
  await writeFile(
    path.join(operationDir, 'intent.json'),
    record({ schema: 'workbridge-retention-intent/1', operationId, planSha256, plan }),
  );
  const receipt = {
    schema: receiptSchema,
    operationId,
    planSha256,
    phase: 'quarantined',
  };
  if (receiptSchema === 'workbridge-retention-phase/2') receipt.publishedAtUtc = publishedAtUtc;
  const quarantine = record(receipt);
  await writeFile(path.join(operationDir, 'quarantined.json'), quarantine);
  const quarantineReceiptSha256 = hash(quarantine);
  const manifest = record({
    schema: 'workbridge-purge-manifest/1',
    operationId,
    planSha256,
    quarantineReceiptSha256,
    expectedRoot: { volume: expectedRoot.volume.toLowerCase(), id: expectedRoot.id.toLowerCase() },
    entries: normalized.entries,
  });
  await writeFile(path.join(operationDir, 'purge-manifest.json'), manifest);
  const expectedManifestSha256 = hash(manifest);
  const approval = record({
    schema: 'workbridge-purge-approval/1',
    operationId,
    planSha256,
    quarantineReceiptSha256,
    manifestSha256: expectedManifestSha256,
    referencesSha256: 'd'.repeat(64),
    retainedProofSha256: 'e'.repeat(64),
  });
  await writeFile(path.join(operationDir, 'purge-approval.json'), approval);
  const ctx = {
    installRoot: root,
    operationId,
    plan,
    planSha256,
    quarantineReceiptSha256,
    expectedManifestSha256,
    expectedPurgeSha256: hash(approval),
    expectedHelperSha256: hash(await readFile(purgeHelper)),
    maintenanceConfirmed: true,
    confirmPermanentlyDelete: operationId,
  };
  const provider = createPurgeProvider({
    revalidateSafety: async () => ({ referencesSha256: 'd'.repeat(64), retainedProofSha256: 'e'.repeat(64) }),
  });
  return { root, operationDir, payload, ctx, provider, count: normalized.entries.length };
}

test(
  'real provider and native helper purge multiple disposable batches and repeat idempotently',
  { skip: process.platform !== 'win32', timeout: 120000 },
  async (t) => {
    const f = await fixture(t, 35);
    const result = await runPurge(f.ctx, f.provider);
    assert.equal(result.status, 'purged');
    await assert.rejects(lstat(f.payload), { code: 'ENOENT' });
    assert.ok(f.count > 32);
    assert.equal((await runPurge(f.ctx, f.provider)).alreadyPurged, true);
    assert.ok((await readFile(path.join(f.operationDir, 'purged.json'), 'utf8')).endsWith('\n'));
  },
);

test(
  'real provider resumes a completed batch interrupted before its done receipt',
  { skip: process.platform !== 'win32', timeout: 120000 },
  async (t) => {
    const f = await fixture(t, 3);
    let interrupted = false;
    const simulatedCrash = {
      ...f.provider,
      withPurgeLease: (ctx, callback) =>
        f.provider.withPurgeLease(ctx, (guard) =>
          callback({
            ...guard,
            async deleteBatch(batch) {
              const result = await guard.deleteBatch(batch);
              if (!interrupted) {
                interrupted = true;
                throw new Error('SIMULATED_PROCESS_INTERRUPTION');
              }
              return result;
            },
          }),
        ),
    };
    await assert.rejects(runPurge(f.ctx, simulatedCrash), /SIMULATED_PROCESS_INTERRUPTION/);
    assert.equal((await runPurge(f.ctx, f.provider)).status, 'purged');
    await assert.rejects(lstat(f.payload), { code: 'ENOENT' });
  },
);

test(
  'native helper refuses legacy, recent, future and malformed quarantine times without mutation',
  { skip: process.platform !== 'win32', timeout: 120000 },
  async (t) => {
    const scenarios = [
      { receiptSchema: 'workbridge-retention-phase/1', reason: 'QUARANTINE_LEGACY_NO_TIME' },
      {
        publishedAtUtc: new Date(Date.now() - (7 * 86400000 - 120000)).toISOString(),
        reason: 'QUARANTINE_GRACE_NOT_ELAPSED',
      },
      { publishedAtUtc: new Date(Date.now() + 86400000).toISOString(), reason: 'QUARANTINE_IN_FUTURE' },
      { publishedAtUtc: '2026-02-30T12:00:00.000Z', reason: 'QUARANTINE_RECEIPT_MISMATCH' },
    ];
    for (const scenario of scenarios) {
      const f = await fixture(t, 1, scenario);
      const args = [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'RemoteSigned',
        '-File',
        purgeHelper,
        '-InstallRoot',
        f.root,
        '-OperationId',
        f.ctx.operationId,
        '-UpdaterOperationId',
        f.ctx.plan.updaterOperationId,
        '-Kind',
        'candidate',
        '-ExpectedPurgeSha256',
        f.ctx.expectedPurgeSha256,
        '-ExpectedManifestSha256',
        f.ctx.expectedManifestSha256,
        '-ConfirmPermanentlyDelete',
        f.ctx.operationId,
        '-MaintenanceConfirmed',
      ];
      await assert.rejects(exec(powershell, args), (error) => {
        assert.equal(JSON.parse(error.stdout.trim()).code, scenario.reason);
        return true;
      });
      assert.equal((await lstat(f.payload)).isDirectory(), true);
      await assert.rejects(lstat(path.join(f.operationDir, 'purging.json')), { code: 'ENOENT' });
    }
  },
);

test(
  'real provider reconciles a simulated partial batch with one expected item absent',
  { skip: process.platform !== 'win32', timeout: 120000 },
  async (t) => {
    const f = await fixture(t, 3);
    const simulatedCrash = {
      ...f.provider,
      withPurgeLease: (ctx, callback) =>
        f.provider.withPurgeLease(ctx, (guard) =>
          callback({
            ...guard,
            async deleteBatch() {
              // Fixture-only simulation of an interruption after the first postorder item.
              await unlink(path.join(f.payload, 'nested', 'file'));
              throw new Error('SIMULATED_PARTIAL_BATCH');
            },
          }),
        ),
    };
    await assert.rejects(runPurge(f.ctx, simulatedCrash), /SIMULATED_PARTIAL_BATCH/);
    assert.equal((await runPurge(f.ctx, f.provider)).status, 'purged');
    await assert.rejects(lstat(f.payload), { code: 'ENOENT' });
  },
);
