import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { comparePatch, verifyPatch } from '../src/patch-drift.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

function createPE() {
  // Matches the bounded, file-only synthetic PE layout used in RRE's own
  // test_rift_update_analyzer.py: one .text and one .rdata section.
  const bytes = Buffer.alloc(0x600);
  bytes.write('MZ', 0, 'ascii');
  bytes.writeUInt32LE(0x80, 0x3c);
  bytes.write('PE\0\0', 0x80, 'ascii');
  bytes.writeUInt16LE(0x8664, 0x84);
  bytes.writeUInt16LE(2, 0x86);
  bytes.writeUInt16LE(0xf0, 0x94);
  bytes.writeUInt16LE(0x20b, 0x98);
  bytes.writeUInt32LE(0x5000, 0x98 + 56);
  bytes.writeUInt32LE(0x200, 0x98 + 60);
  for (let index = 0; index < 2; index++) {
    const section = 0x98 + 0xf0 + 40 * index;
    bytes.write(index === 0 ? '.text' : '.rdata', section, 'ascii');
    bytes.writeUInt32LE(0x180, section + 8);
    bytes.writeUInt32LE(0x1000 * (index + 1), section + 12);
    bytes.writeUInt32LE(0x200, section + 16);
    bytes.writeUInt32LE(0x200 * (index + 1), section + 20);
    bytes.writeUInt32LE(index === 0 ? 0x60000020 : 0x40000040, section + 36);
    bytes.fill(0x90 + index, 0x200 * (index + 1), 0x200 * (index + 2));
  }
  return bytes;
}

async function fixture(t, mutate = true) {
  const root = await mkdtemp(join(tmpdir(), 'wb-rift-patch-'));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const inputs = join(root, 'inputs');
  await mkdir(inputs);
  const beforeFile = join(inputs, 'before.exe');
  const afterFile = join(inputs, 'after.exe');
  const previous = createPE();
  const next = Buffer.from(previous);
  if (mutate) next[0x205] = 0xcc;
  await writeFile(beforeFile, previous);
  await writeFile(afterFile, next);
  const anchorsFile = join(inputs, 'anchors.json');
  await writeFile(
    anchorsFile,
    JSON.stringify({
      schemaVersion: 1,
      sourceSha256: sha(previous),
      anchors: [{ id: 'synthetic-byte', rva: '0x1005', hex: '90' }],
    }),
  );
  return {
    root,
    beforeFile,
    afterFile,
    anchorsFile,
    outputDir: join(root, 'analysis'),
    expectedHost: 'AMD-DESKTOP',
    host: 'AMD-DESKTOP',
    expectedBeforeSha256: sha(previous),
    expectedAfterSha256: sha(next),
  };
}

test('changed archived sections are a valid analysis result, with no offset qualification', async (t) => {
  const f = await fixture(t);
  const result = await comparePatch(f);
  assert.equal(result.result, 'CHANGED');
  assert.equal(result.nativeOffsetsQualified, false);
  assert.equal(result.changedSections, 1);
  assert.equal(result.anchorsChecked, 1);
  assert.equal(result.artifactVerification.verified, true);
  assert.equal(result.artifactVerification.filesVerified, 5);
  const report = JSON.parse(await readFile(join(f.outputDir, 'report.json'), 'utf8'));
  assert.equal(report.anchors[0].status, 'bytes_different_at_same_rva');
  assert.equal(report.requiresRuntimeRequalification, true);
  assert.equal((await verifyPatch(f.outputDir)).status, 'CHANGED');
});

test('identical bytes at distinct paths are a MATCH without claiming runtime qualification', async (t) => {
  const f = await fixture(t, false);
  f.anchorsFile = null;
  const result = await comparePatch(f);
  assert.equal(result.result, 'MATCH');
  assert.equal(result.changedSections, 0);
  assert.equal(result.anchorsChecked, 0);
  assert.equal((await verifyPatch(f.outputDir)).filesVerified, 4);
  const report = JSON.parse(await readFile(join(f.outputDir, 'report.json'), 'utf8'));
  assert.equal(report.nativeOffsetsQualified, false);
});

test('incorrect SHA-pinned baseline rejects before any output is created', async (t) => {
  const f = await fixture(t);
  f.expectedBeforeSha256 = '0'.repeat(64);
  await assert.rejects(
    () => comparePatch(f),
    (e) => e.code === 'BUILD_MISMATCH',
  );
  await assert.rejects(() => readFile(join(f.outputDir, 'report.json')), { code: 'ENOENT' });
});

test('incorrect pinned post-update image refuses before running the RRE comparator', async (t) => {
  const f = await fixture(t);
  f.expectedAfterSha256 = '0'.repeat(64);
  await assert.rejects(
    () => comparePatch(f),
    (e) => e.code === 'BUILD_MISMATCH',
  );
  await assert.rejects(() => readFile(join(f.outputDir, 'report.json')), { code: 'ENOENT' });
});

test('RRE anchor source hash mismatch fails without inventing a report', async (t) => {
  const f = await fixture(t);
  await writeFile(
    f.anchorsFile,
    JSON.stringify({
      schemaVersion: 1,
      sourceSha256: '0'.repeat(64),
      anchors: [{ id: 'wrong', rva: '0x1005', hex: '90' }],
    }),
  );
  await assert.rejects(
    () => comparePatch(f),
    (e) => e.code === 'PATCH_ANALYZER_FAILED',
  );
  await assert.rejects(() => readFile(join(f.outputDir, 'report.json')), { code: 'ENOENT' });
});

test('existing output is never overwritten', async (t) => {
  const f = await fixture(t);
  await mkdir(f.outputDir);
  await writeFile(join(f.outputDir, 'keep.txt'), 'existing');
  await assert.rejects(
    () => comparePatch(f),
    (e) => e.code === 'OUTPUT_EXISTS',
  );
  assert.equal(await readFile(join(f.outputDir, 'keep.txt'), 'utf8'), 'existing');
});

test('wrong host refuses before touching existing archived PE sources', async (t) => {
  const f = await fixture(t);
  f.expectedHost = 'LEGION';
  await assert.rejects(
    () => comparePatch(f),
    (e) => e.code === 'WRONG_HOST',
  );
  await assert.rejects(() => readFile(join(f.outputDir, 'report.json')), { code: 'ENOENT' });
});

test('same exact image path cannot be compared with itself', async (t) => {
  const f = await fixture(t);
  f.afterFile = f.beforeFile;
  await assert.rejects(
    () => comparePatch(f),
    (e) => e.code === 'PATCH_ARGUMENTS',
  );
});

test('tampered preserved analyzer source is detected independently', async (t) => {
  const f = await fixture(t);
  await comparePatch(f);
  await writeFile(join(f.outputDir, 'analyzer-source.py'), 'tampered');
  await assert.rejects(
    () => verifyPatch(f.outputDir),
    (e) => e.code === 'PATCH_BUNDLE_HASH',
  );
});

test('rehashed but semantically contradictory patch manifest is rejected', async (t) => {
  const f = await fixture(t);
  await comparePatch(f);
  const manifestPath = join(f.outputDir, 'patch-manifest.json');
  const data = JSON.parse(await readFile(manifestPath, 'utf8'));
  data.changedSections += 1;
  const bytes = Buffer.from(JSON.stringify(data) + '\n');
  await writeFile(manifestPath, bytes);
  const sumsPath = join(f.outputDir, 'SHA256SUMS.txt');
  const oldSums = await readFile(sumsPath, 'utf8');
  await writeFile(
    sumsPath,
    oldSums.replace(/^[0-9a-f]{64}  patch-manifest\.json$/m, sha(bytes) + '  patch-manifest.json'),
  );
  await assert.rejects(
    () => verifyPatch(f.outputDir),
    (e) => e.code === 'PATCH_BUNDLE_REPORT',
  );
});

test('tampered patch manifest qualification is rejected', async (t) => {
  const f = await fixture(t);
  await comparePatch(f);
  const path = join(f.outputDir, 'patch-manifest.json');
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  manifest.nativeOffsetsQualified = true;
  await writeFile(path, JSON.stringify(manifest));
  await assert.rejects(
    () => verifyPatch(f.outputDir),
    (e) => e.code === 'PATCH_BUNDLE_MANIFEST',
  );
});
