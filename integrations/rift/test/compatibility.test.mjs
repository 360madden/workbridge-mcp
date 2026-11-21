import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { session } from '../src/bundle.mjs';
import { comparePatch } from '../src/patch-drift.mjs';
import { savePhysicalReceipt } from '../src/physical-receipt.mjs';
import { auditArchivedCompatibility } from '../src/compatibility.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

function peFile() {
  const data = Buffer.alloc(0x600);
  data.write('MZ');
  data.writeUInt32LE(0x80, 0x3c);
  data.write('PE\0\0', 0x80);
  data.writeUInt16LE(0x8664, 0x84);
  data.writeUInt16LE(2, 0x86);
  data.writeUInt16LE(0xf0, 0x94);
  data.writeUInt16LE(0x20b, 0x98);
  data.writeUInt32LE(0x5000, 0x98 + 56);
  data.writeUInt32LE(0x200, 0x98 + 60);
  for (let index = 0; index < 2; index++) {
    const offset = 0x98 + 0xf0 + 40 * index;
    data.write(index === 0 ? '.text' : '.rdata', offset);
    data.writeUInt32LE(0x180, offset + 8);
    data.writeUInt32LE((index + 1) * 0x1000, offset + 12);
    data.writeUInt32LE(0x200, offset + 16);
    data.writeUInt32LE((index + 1) * 0x200, offset + 20);
    data.writeUInt32LE(index === 0 ? 0x60000020 : 0x40000040, offset + 36);
    data.fill(0x90 + index, (index + 1) * 0x200, (index + 2) * 0x200);
  }
  return data;
}
const OLD_TICKS = '639301206978915233';
const CURRENT_TICKS = '639308249563595623';

function rr2Record(buildHash) {
  const identity = {
    processId: 40452,
    processStartUtcTicks: OLD_TICKS,
    executableSha256: buildHash,
  };
  return {
    schemaVersion: 1,
    contractVersion: 'native-current-facing-candidate-samples/1',
    status: 'complete',
    identity,
    requestedSamples: 1,
    completedSamples: 1,
    observation: {
      identity: { ...identity },
      startedAtUtc: '2026-11-13T01:32:08.2621379Z',
      completedAtUtc: '2026-11-13T01:32:08.2753417Z',
      positionCandidate: { x: 3, y: 4, z: 5 },
    },
  };
}

function rreReport() {
  return {
    addonVersion: '0.4.13',
    captureVersion: '0.4.13',
    sequence: 7,
    captureSequence: 7,
    memoryPublication: {
      abilities: 54,
      addonVersion: '0.4.13',
      adler32: '2fcd6fa3',
      parts: 5,
      payloadBytes: 18295,
      sequence: 7,
      session: '0b6399207d0e277158ee6c11c3af1bd4',
      status: 'complete',
    },
    player: { id: 'uTEST', coordX: 1, coordY: 2, coordZ: 3 },
  };
}

function rreBinding(buildHash) {
  return {
    schemaVersion: 1,
    evidenceKind: 'rre-lab2-publication-binding/1',
    executableSha256: buildHash,
    processId: 9752,
    processStartUtcTicks: '639294897826627677',
    addonVersion: '0.4.13',
    session: '0b6399207d0e277158ee6c11c3af1bd4',
    sequence: 7,
    parts: 5,
    payloadBytes: 18295,
    observedAtUtc: '2026-11-07T20:40:54Z',
  };
}

function physicalRecord(buildHash, pid = 34596, ticks = CURRENT_TICKS) {
  return {
    schema: 'workbridge.rift-physical-epoch.v1',
    status: 'read_only_identity_observed',
    machine: 'AMD-DESKTOP',
    processCount: 1,
    selected: {
      pid,
      processStartUtcTicks: ticks,
      startedUtc: '2026-11-21T02:29:16.3595623Z',
      executablePath: 'C:\\Program Files (x86)\\Glyph\\Games\\RIFT\\Live\\rift_x64.exe',
      executableSha256: buildHash,
      moduleName: 'rift_x64.exe',
      moduleBaseHex: '0x7FF60DF30000',
      moduleSizeBytes: 63246336,
      sessionId: 1,
      window: {
        hwnd: 658476,
        pid,
        title: 'RIFT',
        className: 'TWNClientFramework',
        processName: 'rift_x64',
        width: 1280,
        height: 720,
        foreground: false,
      },
    },
    validation: {
      processEpochRechecked: true,
      hwndRechecked: true,
      executableHashFromProcessPath: true,
      memoryLayoutQualified: false,
      sourceTelemetryLinked: false,
    },
    inputSent: false,
    memoryRead: false,
    readOnly: true,
    liveBindingVerified: true,
    sampledUtc: '2026-11-21T04:07:38.193Z',
  };
}

async function fixture(t, withArchives = true) {
  const root = await mkdtemp(join(tmpdir(), 'wb-rift-compatibility-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const old = peFile();
  const newer = Buffer.from(old);
  newer[0x205] ^= 1;
  const inputs = join(root, 'inputs');
  await mkdir(inputs);
  const beforeFile = join(inputs, 'old.exe');
  const afterFile = join(inputs, 'new.exe');
  const telemetryFile = join(root, 'telemetry.json');
  const trackFile = join(root, 'track.jsonl');
  const rr2File = join(root, 'rr2.json');
  const rreFile = join(root, 'rre.json');
  const rreBindingFile = join(root, 'rre-binding.json');
  await Promise.all([
    writeFile(beforeFile, old),
    writeFile(afterFile, newer),
    writeFile(telemetryFile, JSON.stringify({ source: 'demo', sequence: 1 })),
    writeFile(
      trackFile,
      JSON.stringify({
        time: 0,
        unit: 'player',
        process: 'demo',
        session: 'one',
        world: 'telara',
        zone: 'silverwood',
        x: 0,
        y: 0,
        z: 0,
      }) + '\n',
    ),
    writeFile(rr2File, JSON.stringify(rr2Record(sha(old)))),
    writeFile(rreFile, JSON.stringify(rreReport())),
    writeFile(rreBindingFile, JSON.stringify(rreBinding(sha(old)))),
  ]);
  const researchBundleDir = join(root, 'research');
  const physicalBundleDir = join(root, 'physical');
  const patchDir = join(root, 'patch');
  await session({
    clientFile: beforeFile,
    expectedSha256: sha(old),
    expectedHost: 'AMD-DESKTOP',
    host: 'AMD-DESKTOP',
    telemetryFile,
    trackFile,
    outputDir: researchBundleDir,
    ...(withArchives ? { rr2File, rreFile, rreBindingFile } : {}),
  });
  await savePhysicalReceipt(physicalRecord(sha(newer)), physicalBundleDir);
  return {
    root,
    beforeFile,
    afterFile,
    oldHash: sha(old),
    newHash: sha(newer),
    physicalBundleDir,
    researchBundleDir,
    patchDir,
  };
}

test('two old archives are build-incompatible with a later saved physical executable', async (t) => {
  const f = await fixture(t);
  const report = await auditArchivedCompatibility(f);
  assert.equal(report.archives.originalClientMatchesObservedImage, false);
  assert.equal(report.archives.rr2.verdict, 'different_executable_build');
  assert.equal(report.archives.rre.verdict, 'different_executable_build');
  assert.equal(report.archives.telemetry.simulatedCount, 1);
  assert.equal(report.archives.telemetry.verifiedCurrentSamples, 0);
  assert.equal(report.physicalEpoch.currentlyRunningVerifiedByAudit, false);
  assert.equal(report.memoryOffsetsQualified, false);
  assert.equal(report.independentTeleportVerified, false);
});

test('same executable hash but another archived process epoch still needs requalification', async (t) => {
  const f = await fixture(t);
  const current = physicalRecord(f.oldHash);
  const newDir = join(f.root, 'physical-same-build');
  await savePhysicalReceipt(current, newDir);
  const report = await auditArchivedCompatibility({ ...f, physicalBundleDir: newDir });
  assert.equal(report.archives.originalClientMatchesObservedImage, true);
  assert.equal(report.archives.rr2.verdict, 'different_declared_process_epoch');
  assert.equal(report.archives.rre.verdict, 'different_declared_process_epoch');
});

test('even matching archived PID/start/build fields cannot prove live capture freshness', async (t) => {
  const f = await fixture(t);
  const oldMatching = physicalRecord(f.oldHash, 40452, OLD_TICKS);
  const newDir = join(f.root, 'physical-matching-epoch');
  await savePhysicalReceipt(oldMatching, newDir);
  const report = await auditArchivedCompatibility({ ...f, physicalBundleDir: newDir });
  assert.equal(report.archives.rr2.verdict, 'matching_declared_process_fields_host_and_freshness_unverified');
  assert.equal(report.archives.rr2.currentGameTelemetryQualified, false);
  assert.equal(report.liveTelemetryAuthenticated, false);
});

test('older research package without optional native archive remains compatible', async (t) => {
  const f = await fixture(t, false);
  const report = await auditArchivedCompatibility(f);
  assert.equal(report.archives.rr2.verdict, 'no_archived_source');
  assert.equal(report.archives.rre.verdict, 'no_archived_source');
  assert.equal(report.archives.researchBundleIntegrityVerified, true);
});

test('the official RRE patch comparator is reused and report tracks the after-image', async (t) => {
  const f = await fixture(t);
  await comparePatch({
    beforeFile: f.beforeFile,
    afterFile: f.afterFile,
    outputDir: f.patchDir,
    expectedBeforeSha256: f.oldHash,
    expectedAfterSha256: f.newHash,
    expectedHost: 'AMD-DESKTOP',
    host: 'AMD-DESKTOP',
  });
  const report = await auditArchivedCompatibility({ ...f, patchBundleDir: f.patchDir });
  assert.equal(report.patch.present, true);
  assert.equal(report.patch.integrityVerified, true);
  assert.equal(report.patch.observedImageRelation, 'matches_after_image');
  assert.equal(report.patch.status, 'CHANGED');
  assert.equal(report.patch.nativeOffsetsQualified, false);
});

test('a tampered physical receipt is rejected before archived findings are compared', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.physicalBundleDir, 'physical-epoch.json'), 'bad');
  await assert.rejects(
    () => auditArchivedCompatibility(f),
    (e) => e.code === 'PHYSICAL_RECEIPT_HASH',
  );
});

test('a tampered archived research bundle fails its checksum gate', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.researchBundleDir, 'evidence.jsonl'), 'modified');
  await assert.rejects(
    () => auditArchivedCompatibility(f),
    (e) => e.code === 'BUNDLE_HASH_MISMATCH',
  );
});

test('missing source directories fail before any compatibility claims are emitted', async () => {
  await assert.rejects(
    () => auditArchivedCompatibility(),
    (e) => e.code === 'MISSING_ARGUMENT',
  );
});
