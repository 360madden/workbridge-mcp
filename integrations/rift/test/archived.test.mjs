import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { session, verifyBundle } from '../src/bundle.mjs';
import { normalizeRR2, normalizeRRE, compareArchivedEpochs } from '../src/archived-sources.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sessionToken = 'a'.repeat(32);
const exactTicks = '639301206978915233';
const sha = 'a'.repeat(64);
const source = (data) => {
  const bytes = Buffer.from(data);
  return { bytes, sha256: hash(bytes) };
};

function rr2Sample(executableSha = sha) {
  const identity = {
    processId: 40452,
    processStartUtcTicks: exactTicks,
    executableSha256: executableSha,
  };
  const payload = {
    schemaVersion: 1,
    contractVersion: 'native-current-facing-candidate-samples/1',
    status: 'complete',
    identity,
    requestedSamples: 1,
    completedSamples: 1,
    observation: {
      identity: { ...identity },
      startedAtUtc: '2026-11-13T01:32:08.2621379+00:00',
      completedAtUtc: '2026-11-13T01:32:08.2753417+00:00',
      positionCandidate: { x: 7417.2764, y: 863.58655, z: 2944.8325 },
      playerSystemBearingDegreesCandidate: 76.13,
      headingQualified: false,
    },
  };
  // The real RR2 producer writes 64-bit ticks as JSON numbers. Ensure the
  // parser preserves their source digits rather than the rounded JS double.
  return JSON.stringify(payload).replaceAll(
    '"processStartUtcTicks":"' + exactTicks + '"',
    '"processStartUtcTicks":' + exactTicks,
  );
}

function rreSample() {
  return {
    addonVersion: '0.4.13',
    sequence: 7,
    captureVersion: '0.4.13',
    captureSequence: 7,
    memoryPublication: {
      abilities: 54,
      addonVersion: '0.4.13',
      adler32: '2fcd6fa3',
      parts: 5,
      payloadBytes: 18295,
      sequence: 7,
      session: sessionToken,
      status: 'complete',
    },
    player: { id: 'uTEST', health: 0, coordX: 0, coordY: 10, coordZ: 3 },
  };
}
function rreBinding(executableSha = sha) {
  return {
    schemaVersion: 1,
    evidenceKind: 'rre-lab2-publication-binding/1',
    processId: 9752,
    processStartUtcTicks: '639294897826627677',
    executableSha256: executableSha,
    addonVersion: '0.4.13',
    session: sessionToken,
    sequence: 7,
    parts: 5,
    payloadBytes: 18295,
    observedAtUtc: '2026-11-07T20:40:54Z',
  };
}

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'wb-rift-rr2-rre-'));
  t.after(async () => rm(dir, { recursive: true, force: true }));
  const pe = Buffer.alloc(1024);
  pe.write('MZ');
  pe.writeUInt32LE(0x80, 0x3c);
  pe.write('PE\0\0', 0x80);
  pe.writeUInt16LE(0x8664, 0x84);
  pe.writeUInt16LE(1, 0x86);
  pe.writeUInt16LE(0xf0, 0x94);
  pe.writeUInt16LE(0x20b, 0x98);
  const clientFile = join(dir, 'rift_x64.exe');
  const telemetryFile = join(dir, 'telemetry.json');
  const trackFile = join(dir, 'track.jsonl');
  const rr2File = join(dir, 'rr2.json');
  const rreFile = join(dir, 'rre.json');
  const rreBindingFile = join(dir, 'rre-binding.json');
  const clientSha256 = hash(pe);
  const rr2 = rr2Sample(clientSha256);
  const rre = JSON.stringify(rreSample());
  const binding = JSON.stringify(rreBinding(clientSha256));
  await Promise.all([
    writeFile(clientFile, pe),
    writeFile(telemetryFile, JSON.stringify({ source: 'demo', sequence: 0, target: { health: null } })),
    writeFile(
      trackFile,
      JSON.stringify({
        time: 0,
        unit: 'player',
        x: 0,
        y: 0,
        z: 0,
        process: 'sample',
        session: 'sample',
        world: 'telara',
        zone: 'zone',
      }) + '\n',
    ),
    writeFile(rr2File, rr2),
    writeFile(rreFile, rre),
    writeFile(rreBindingFile, binding),
  ]);
  return {
    dir,
    clientFile,
    telemetryFile,
    trackFile,
    rr2File,
    rreFile,
    rreBindingFile,
    clientSha256,
    outputDir: join(dir, 'bundle'),
    expectedHost: 'AMD-DESKTOP',
    host: 'AMD-DESKTOP',
  };
}

test('RR2 preserves original 64-bit process-start ticks, including nested identity', () => {
  const record = normalizeRR2(source(rr2Sample()), sha);
  assert.equal(record.processEpoch.processStartUtcTicks, exactTicks);
  assert.equal(record.positionCandidate.x, 7417.2764);
  assert.equal(record.buildMatch, true);
  assert.equal(record.headingQualified, false);
  assert.equal(record.freshnessVerified, false);
});

test('RRE binding must agree exactly with publication session, count and version', () => {
  const good = normalizeRRE(source(JSON.stringify(rreSample())), source(JSON.stringify(rreBinding())), sha);
  assert.equal(good.publicationSession, sessionToken);
  assert.equal(good.playerHealthReported, 0);
  assert.equal(good.playerPositionReported.x, 0);
  assert.equal(good.wirePayloadDecodedByThisTool, false);
  const bad = rreBinding();
  bad.sequence = 8;
  assert.throws(
    () => normalizeRRE(source(JSON.stringify(rreSample())), source(JSON.stringify(bad)), sha),
    (error) => error.code === 'RRE_BINDING_MISMATCH',
  );
});

test('RRE enforces exact 4096-byte part count, even if both saved receipts agree', () => {
  const pub = rreSample();
  const binding = rreBinding();
  pub.memoryPublication.parts = 4;
  binding.parts = 4;
  assert.throws(
    () => normalizeRRE(source(JSON.stringify(pub)), source(JSON.stringify(binding)), sha),
    (error) => error.code === 'RRE_CONTRACT',
  );
  pub.memoryPublication.parts = 1;
  binding.parts = 1;
  pub.memoryPublication.payloadBytes = 4096;
  binding.payloadBytes = 4096;
  const validBoundary = normalizeRRE(source(JSON.stringify(pub)), source(JSON.stringify(binding)), sha);
  assert.equal(validBoundary.partCountDeclared, 1);
  pub.memoryPublication.payloadBytes = 4097;
  binding.payloadBytes = 4097;
  assert.throws(
    () => normalizeRRE(source(JSON.stringify(pub)), source(JSON.stringify(binding)), sha),
    (error) => error.code === 'RRE_CONTRACT',
  );
});

test('same game build does not mean same process epoch', () => {
  const rr2 = normalizeRR2(source(rr2Sample()), sha);
  const rre = normalizeRRE(source(JSON.stringify(rreSample())), source(JSON.stringify(rreBinding())), sha);
  assert.equal(rr2.buildMatch, true);
  assert.equal(rre.buildMatch, true);
  const comparison = compareArchivedEpochs(rr2, rre);
  assert.equal(comparison.verdict, 'different_declared_epoch');
  assert.equal(comparison.crossSourceCausalityVerified, false);
});

test('RR2 rejects different report and observation PID, ticks or executable identity', () => {
  const json = rr2Sample();
  const modified = json.replace('"processId":40452', '"processId":11111');
  assert.throws(
    () => normalizeRR2(source(modified), sha),
    (error) => error.code === 'RR2_EPOCH_MISMATCH',
  );
  const alteredTicks = json.replace(
    '"processStartUtcTicks":639301206978915233',
    '"processStartUtcTicks":639301206978915234',
  );
  assert.throws(
    () => normalizeRR2(source(alteredTicks), sha),
    (error) => error.code === 'RR2_EPOCH_MISMATCH',
  );
});

test('RR2 refuses incomplete or unsupported report versions', () => {
  const unsupported = JSON.parse(rr2Sample());
  unsupported.contractVersion = 'unsupported';
  assert.throws(
    () => normalizeRR2(source(JSON.stringify(unsupported)), sha),
    (error) => error.code === 'RR2_CONTRACT',
  );
});

test('the optional archives are preserved verbatim and independently hashed in one session', async (t) => {
  const f = await fixture(t);
  const result = await session({ ...f });
  assert.equal(result.bundleVerified, true);
  assert.equal(result.rr2Records, 1);
  assert.equal(result.rreRecords, 1);
  assert.equal(result.archivedEpochs.verdict, 'different_declared_epoch');
  const manifest = JSON.parse(await readFile(join(f.outputDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.processIdentityVerified, false);
  assert.equal(manifest.inputs.rr2.sha256, hash(await readFile(f.rr2File)));
  assert.equal(manifest.archivedEpochs.liveFreshnessVerified, false);
  assert.deepEqual(await readFile(join(f.outputDir, 'rr2.source')), await readFile(f.rr2File));
  assert.deepEqual(await readFile(join(f.outputDir, 'rre.source')), await readFile(f.rreFile));
  assert.equal((await verifyBundle(f.outputDir)).filesVerified, 9);
  const normalized = (await readFile(join(f.outputDir, 'evidence.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(normalized.length, 4);
  assert.equal(normalized.at(-1).source, 'RRECollector.saved-publication');
  assert.equal(normalized.at(-2).processEpoch.processStartUtcTicks, exactTicks);
});

test('missing RRE binding rejects before any output is created', async (t) => {
  const f = await fixture(t);
  f.rreBindingFile = null;
  await assert.rejects(
    () => session({ ...f }),
    (error) => error.code === 'RRE_PAIR_REQUIRED',
  );
  await assert.rejects(() => readFile(join(f.outputDir, 'manifest.json')), { code: 'ENOENT' });
});

test('conflicting archived RRE generation rejects before creating a package', async (t) => {
  const f = await fixture(t);
  const mismatched = rreBinding(f.clientSha256);
  mismatched.sequence = 8;
  await writeFile(f.rreBindingFile, JSON.stringify(mismatched));
  await assert.rejects(
    () => session({ ...f }),
    (error) => error.code === 'RRE_BINDING_MISMATCH',
  );
  await assert.rejects(() => readFile(join(f.outputDir, 'manifest.json')), { code: 'ENOENT' });
});

test('optional artifact corruption is detected', async (t) => {
  const f = await fixture(t);
  await session({ ...f });
  await writeFile(join(f.outputDir, 'rre-binding.source'), 'corrupted');
  await assert.rejects(
    () => verifyBundle(f.outputDir),
    (error) => error.code === 'BUNDLE_HASH_MISMATCH',
  );
});

test('a selected archive with another build stays present but explicitly incompatible', () => {
  const record = normalizeRR2(source(rr2Sample('b'.repeat(64))), sha);
  assert.equal(record.buildMatch, false);
  assert.equal(record.sourceBuildSha256, 'b'.repeat(64));
  assert.equal(record.freshnessVerified, false);
});
