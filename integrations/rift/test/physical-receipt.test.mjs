import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { savePhysicalReceipt, verifyPhysicalReceipt } from '../src/physical-receipt.mjs';

function sample() {
  return {
    schema: 'workbridge.rift-physical-epoch.v1',
    status: 'read_only_identity_observed',
    machine: 'AMD-DESKTOP',
    processCount: 1,
    selected: {
      pid: 34596,
      startedUtc: '2026-11-21T02:29:16.3595623Z',
      processStartUtcTicks: '639308249563595623',
      sessionId: 1,
      executablePath: 'C:\\Program Files (x86)\\Glyph\\Games\\RIFT\\Live\\rift_x64.exe',
      moduleName: 'rift_x64.exe',
      moduleBaseHex: '0x7FF60DF30000',
      moduleSizeBytes: 63246336,
      executableSha256: 'df954b798331e18359be62a31cc74b49fc3f50b87385ebb080a5448256322c01',
      executableBytes: 60574536,
      window: {
        hwnd: 658476,
        pid: 34596,
        processName: 'rift_x64',
        title: 'RIFT',
        className: 'TWNClientFramework',
        foreground: false,
        width: 2576,
        height: 1408,
      },
    },
    validation: {
      processEpochRechecked: true,
      hwndRechecked: true,
      executableHashFromProcessPath: true,
      moduleBaseIsReadOnlyObserved: true,
      moduleMemoryBytesVerifiedByRead: false,
      memoryLayoutQualified: false,
      sourceTelemetryLinked: false,
    },
    readOnly: true,
    inputSent: false,
    memoryRead: false,
    liveBindingVerified: true,
    sampledUtc: '2026-11-21T04:06:05.426Z',
  };
}

async function output(t) {
  const root = await mkdtemp(join(tmpdir(), 'wb-rift-physical-receipt-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, dir: join(root, 'physical-epoch') };
}

test('a rechecked read-only process/window identity creates a verifiable frozen receipt', async (t) => {
  const { dir } = await output(t);
  const result = await savePhysicalReceipt(sample(), dir);
  assert.equal(result.verified, true);
  assert.equal(result.pid, 34596);
  assert.equal(result.hwnd, 658476);
  assert.equal(result.processStartUtcTicks, '639308249563595623');
  assert.equal(result.currentProcessAliveVerified, false);
  assert.equal(result.memoryLayoutQualified, false);
  assert.equal(result.inputAuthorized, false);
  const persisted = JSON.parse(await readFile(join(dir, 'physical-epoch.json'), 'utf8'));
  assert.equal(persisted.selected.processStartUtcTicks, '639308249563595623');
  assert.equal((await verifyPhysicalReceipt(dir)).verified, true);
});

test('an existing output directory is never overwritten', async (t) => {
  const { dir } = await output(t);
  await mkdir(dir);
  await writeFile(join(dir, 'keep.txt'), 'untouched');
  await assert.rejects(
    () => savePhysicalReceipt(sample(), dir),
    (e) => e.code === 'OUTPUT_EXISTS',
  );
  assert.equal(await readFile(join(dir, 'keep.txt'), 'utf8'), 'untouched');
});

test('absence or ambiguity cannot be saved as a verified physical process epoch', async (t) => {
  const { dir } = await output(t);
  const record = sample();
  record.status = 'no_process_observed';
  record.liveBindingVerified = false;
  record.selected = null;
  await assert.rejects(
    () => savePhysicalReceipt(record, dir),
    (e) => e.code === 'PHYSICAL_RECEIPT_INVALID',
  );
  await assert.rejects(() => readFile(join(dir, 'physical-epoch.json')), { code: 'ENOENT' });
});

test('mutated receipt body fails independent checksum verification', async (t) => {
  const { dir } = await output(t);
  await savePhysicalReceipt(sample(), dir);
  const path = join(dir, 'physical-epoch.json');
  const rec = JSON.parse(await readFile(path, 'utf8'));
  rec.selected.pid = 666;
  await writeFile(path, JSON.stringify(rec));
  await assert.rejects(
    () => verifyPhysicalReceipt(dir),
    (e) => e.code === 'PHYSICAL_RECEIPT_HASH',
  );
});

test('even with replaced checksums, contradictory process/window metadata is rejected', async (t) => {
  const { dir } = await output(t);
  await savePhysicalReceipt(sample(), dir);
  const path = join(dir, 'physical-epoch.json');
  const rec = JSON.parse(await readFile(path, 'utf8'));
  rec.selected.window.pid = 22222;
  const bytes = Buffer.from(JSON.stringify(rec) + '\n', 'utf8');
  await writeFile(path, bytes);
  await writeFile(
    join(dir, 'SHA256SUMS.txt'),
    createHash('sha256').update(bytes).digest('hex') + '  physical-epoch.json\n',
  );
  await assert.rejects(
    () => verifyPhysicalReceipt(dir),
    (e) => e.code === 'PHYSICAL_RECEIPT_INVALID',
  );
});

test('the checksum file is required as the completion marker', async (t) => {
  const { dir } = await output(t);
  await mkdir(dir);
  await writeFile(join(dir, 'physical-epoch.json'), JSON.stringify(sample()) + '\n');
  await assert.rejects(() => verifyPhysicalReceipt(dir), { code: 'ENOENT' });
});
