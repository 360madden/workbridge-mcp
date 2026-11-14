import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, rename, rm, lstat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRetentionPlan } from '../scripts/storage-retention-plan.mjs';
import { canonicalPlanSha256 } from '../scripts/storage-retention-quarantine.mjs';
import { canonicalPurgeJson, runPurge } from '../scripts/storage-retention-purge-journal.mjs';
import { createPurgeSafetyProof } from '../scripts/storage-retention-purge-proof.mjs';
import { runRetention } from '../scripts/storage-retention.mjs';
import { createPurgeProvider } from '../scripts/storage-retention-purge-provider.mjs';
const exec = promisify(execFile),
  repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const native = path.join(repo, 'scripts', 'Storage-RetentionMaintenance.ps1'),
  purgeHelper = path.join(repo, 'scripts', 'Storage-RetentionPurge.ps1');
const powershell = path.join(
  process.env.SystemRoot || 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe',
);
const hash = (v) => createHash('sha256').update(v).digest('hex');
const encode = (v) => Buffer.from(`${canonicalPurgeJson(v)}\n`);
const contents = {
  'dist/a.js': 'alpha',
  'node_modules/p/a.js': 'bravo',
  'package.json': '{}',
  'package-lock.json': '{ }',
};
async function fixture(t, kind) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wb-proof-native-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const op = 'old',
    gc = 'gcfixture',
    displacedId = '1'.repeat(32);
  const opRoot = path.join(root, '.local', 'update-operations', op),
    release = path.join(root, '.local', 'releases', op);
  const source =
    kind === 'candidate' ? path.join(opRoot, 'candidate') : path.join(opRoot, 'displaced', displacedId);
  const retained =
    kind === 'candidate' ? path.join(release, 'payload') : path.join(opRoot, 'backup', 'runtime');
  const files = Object.entries(contents).map(([name, text]) => ({
    path: name,
    bytes: Buffer.byteLength(text),
    sha256: hash(Buffer.from(text)).toUpperCase(),
  }));
  for (const dir of [source, retained])
    for (const [name, text] of Object.entries(contents)) {
      const file = path.join(dir, ...name.split('/'));
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, text);
    }
  const save = async (file, value) => {
    await mkdir(path.dirname(file), { recursive: true });
    const raw = Buffer.from(JSON.stringify(value));
    await writeFile(file, raw);
    return hash(raw).toUpperCase();
  };
  const manifest = { schema: 1, version: '1.0', files };
  const digest = await save(path.join(release, 'manifest.json'), manifest);
  const checks = { install: 0, tests: 0, startup: 0, updater: 0, format: 0, acceptance: 0 };
  await save(path.join(release, 'validated.json'), {
    schema: 1,
    version: '1.0',
    result: 'passed',
    manifestSha256: digest,
    checks,
  });
  await save(path.join(opRoot, 'request.json'), {
    schema: 1,
    action: 'Apply',
    operationId: op,
    installRoot: root,
    releasePath: release,
    releaseDigest: digest,
  });
  await save(path.join(opRoot, 'journal.json'), {
    schema: 1,
    operationId: op,
    installRoot: root,
    phase: 'completed',
    version: '1.0',
    previousVersion: '1.0',
    releaseDigest: digest,
    previousRelease: null,
    updatedUtc: '2000-01-01T00:00:00.000Z',
  });
  if (kind === 'displaced')
    await save(path.join(opRoot, 'backup-manifest.json'), { schema: 1, version: '1.0', files });
  const current = path.join(root, '.local', 'update-operations', 'current'),
    currentRelease = path.join(root, '.local', 'releases', 'current');
  const currentDigest = await save(path.join(currentRelease, 'manifest.json'), {
    schema: 1,
    version: '1.0',
    files: [],
  });
  await save(path.join(currentRelease, 'validated.json'), {
    schema: 1,
    version: '1.0',
    result: 'passed',
    manifestSha256: currentDigest,
    checks,
  });
  await save(path.join(current, 'request.json'), {
    schema: 1,
    action: 'Apply',
    operationId: 'current',
    installRoot: root,
    releasePath: currentRelease,
    releaseDigest: currentDigest,
  });
  await save(path.join(current, 'journal.json'), {
    schema: 1,
    operationId: 'current',
    installRoot: root,
    phase: 'completed',
    version: '1.0',
    previousVersion: '0.9',
    releaseDigest: currentDigest,
    previousRelease: null,
    updatedUtc: '2000-01-01T00:00:00.000Z',
  });
  await save(path.join(root, '.local', 'installed-release.json'), {
    schema: 1,
    operationId: 'current',
    version: '1.0',
    releaseDigest: currentDigest,
  });
  const plan = await createRetentionPlan(
    { installRoot: root, updaterOperationId: op, kind },
    {
      inspectLocations: async () => {
        const args = [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'RemoteSigned',
          '-File',
          native,
          '-Mode',
          'Inspect',
          '-InstallRoot',
          root,
          '-OperationId',
          'preview',
          '-UpdaterOperationId',
          op,
          '-Kind',
          kind,
        ];
        if (kind === 'displaced') args.push('-DisplacedId', displacedId);
        let stdout;
        try {
          ({ stdout } = await exec(powershell, args));
        } catch (error) {
          throw Object.assign(new Error(error.stdout), { code: error.stdout || error.message });
        }
        const result = JSON.parse(stdout.trim());
        assert.equal(result.status, 'ready', JSON.stringify(result));
        return result;
      },
    },
  );
  assert.equal(plan.schema, 'workbridge-retention-plan/1', JSON.stringify(plan));
  const planSha256 = canonicalPlanSha256(plan),
    operationDir = path.join(root, '.local', 'storage-quarantine', gc),
    payload = path.join(operationDir, 'payload');
  await mkdir(operationDir, { recursive: true });
  await rename(source, payload);
  await writeFile(
    path.join(operationDir, 'intent.json'),
    encode({ schema: 'workbridge-retention-intent/1', operationId: gc, planSha256, plan }),
  );
  const receipt = encode({
    schema: 'workbridge-retention-phase/2',
    operationId: gc,
    planSha256,
    phase: 'quarantined',
    publishedAtUtc: '2020-01-01T00:00:00.000Z',
  });
  await writeFile(path.join(operationDir, 'quarantined.json'), receipt);
  const prepared = await runRetention({
    action: 'purge-prepare',
    '--install-root': root,
    '--operation-id': gc,
    '--maintenance-confirmed': true,
  });
  assert.equal(prepared.status, 'prepared', JSON.stringify(prepared));
  const ctx = {
    installRoot: root,
    operationId: gc,
    plan,
    planSha256,
    quarantineReceiptSha256: hash(receipt),
    expectedManifestSha256: prepared.manifestSha256,
    expectedHelperSha256: hash(await readFile(purgeHelper)),
    expectedPurgeSha256: prepared.purgeSha256,
    maintenanceConfirmed: true,
    confirmPermanentlyDelete: gc,
  };
  return {
    root,
    gc,
    ctx,
    payload,
    retained,
    prepared,
    provider: createPurgeProvider({ revalidateSafety: createPurgeSafetyProof }),
  };
}
for (const kind of ['candidate', 'displaced'])
  test(
    `real ${kind} plan and retained proof support reviewed native purge`,
    { skip: process.platform !== 'win32', timeout: 180000 },
    async (t) => {
      const f = await fixture(t, kind);
      if (kind === 'candidate') {
        let interrupted = false;
        const crash = {
          ...f.provider,
          withPurgeLease: (ctx, callback) =>
            f.provider.withPurgeLease(ctx, (guard) =>
              callback({
                ...guard,
                async deleteBatch(batch) {
                  const result = await guard.deleteBatch(batch);
                  if (!interrupted) {
                    interrupted = true;
                    throw Error('SIMULATED_CRASH');
                  }
                  return result;
                },
              }),
            ),
        };
        await assert.rejects(runPurge(f.ctx, crash), /SIMULATED_CRASH/);
        await assert.rejects(lstat(f.payload), { code: 'ENOENT' });
      }
      const result = await runRetention({
        action: 'purge',
        '--install-root': f.root,
        '--operation-id': f.gc,
        '--expect-purge-sha256': f.prepared.purgeSha256,
        '--confirm-permanently-delete': f.gc,
        '--maintenance-confirmed': true,
      });
      assert.equal(result.status, 'purged');
      await assert.rejects(lstat(f.payload), { code: 'ENOENT' });
      assert.equal((await lstat(f.retained)).isDirectory(), true);
    },
  );
