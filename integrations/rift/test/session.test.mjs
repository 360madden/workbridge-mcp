import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { doctor, session, verifyBundle, DEFAULT_ANALYZER } from '../src/bundle.mjs';
import { ResearchError } from '../src/identity.mjs';
import { normalizeTelemetry, parseRecords } from '../src/records.mjs';

function sha(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
const fixtureTrack = [
  {
    time: 0,
    unit: 'player',
    x: 0,
    y: 10,
    z: 0,
    process: 'fixture',
    session: 's1',
    world: 'telara',
    zone: 'silverwood',
  },
  {
    time: 0.5,
    unit: 'player',
    x: 2,
    y: 10,
    z: 1,
    process: 'fixture',
    session: 's1',
    world: 'telara',
    zone: 'silverwood',
  },
  {
    time: 1,
    unit: 'player',
    x: 200,
    y: 10,
    z: 1,
    process: 'fixture',
    session: 's1',
    world: 'telara',
    zone: 'silverwood',
  },
  {
    time: 1.5,
    unit: 'player',
    x: 900,
    y: 10,
    z: 100,
    process: 'fixture',
    session: 's1',
    world: 'telara',
    zone: 'sanctum',
  },
];

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'wb-rift-offline-'));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const client = join(root, 'rift_x64.exe');
  const pe = Buffer.alloc(1024);
  pe.write('MZ', 0, 'ascii');
  pe.writeUInt32LE(0x80, 0x3c);
  pe.write('PE\0\0', 0x80, 'ascii');
  pe.writeUInt16LE(0x8664, 0x84);
  pe.writeUInt16LE(1, 0x86);
  pe.writeUInt16LE(0xf0, 0x94);
  pe.writeUInt16LE(0x20b, 0x98);
  await writeFile(client, pe);
  const telemetry = join(root, 'telemetry.jsonl');
  const original = [
    {
      sequence: 1,
      sampledAt: '2026-11-15T12:56:06.6546555+00:00',
      source: 'demo',
      state: 'live',
      target: { id: 'sample', health: null, x: 0, y: 10, z: 0 },
    },
    {
      sequence: 2,
      source: 'demo',
      state: 'unavailable',
      target: { id: 'sample', health: 25, healthMax: 100, x: 3, y: 10, z: 1 },
    },
  ];
  const telemetryBytes = Buffer.from(original.map((x) => JSON.stringify(x)).join('\n') + '\n');
  await writeFile(telemetry, telemetryBytes);
  const track = join(root, 'track.jsonl');
  await writeFile(track, fixtureTrack.map((x) => JSON.stringify(x)).join('\n') + '\n');
  return {
    root,
    client,
    clientHash: sha(pe),
    telemetry,
    track,
    telemetryBytes,
    outputDir: join(root, 'bundle'),
    expectedHost: 'AMD-DESKTOP',
    host: 'AMD-DESKTOP',
  };
}

test('offline doctor hashes the selected PE and does not invent a running process', async (t) => {
  const f = await fixture(t);
  const result = await doctor({ clientFile: f.client, expectedHost: f.expectedHost, host: f.host });
  assert.equal(result.client.sha256, f.clientHash);
  assert.equal(result.client.format.kind, 'AMD64_PE32_PLUS');
  assert.equal(result.host.verified, true);
  assert.equal(result.client.process, null);
  assert.equal(result.client.liveRuntimeQualified, false);
  assert.equal(result.gameContacted, false);
});

test('one coordinated offline session copies evidence and verifies the entire artifact package', async (t) => {
  const f = await fixture(t);
  const output = await session({
    clientFile: f.client,
    telemetryFile: f.telemetry,
    trackFile: f.track,
    outputDir: f.outputDir,
    expectedHost: f.expectedHost,
    host: f.host,
  });
  assert.equal(output.status, 'completed_offline_replay');
  assert.equal(output.bundleVerified, true);
  assert.equal(output.telemetryRecords, 2);
  assert.equal(output.positionRecords, 4);
  assert.equal(output.classificationCounts.candidate_discontinuity, 1);
  assert.equal(output.classificationCounts.boundary, 1);
  assert.equal(output.transportOrTeleportVerified, false);
  assert.deepEqual(await readFile(join(f.outputDir, 'telemetry.source')), f.telemetryBytes);
  const manifest = JSON.parse(await readFile(join(f.outputDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.client.sha256, f.clientHash);
  assert.equal(manifest.machine.observed, 'AMD-DESKTOP');
  assert.equal(manifest.processIdentityVerified, false);
  assert.equal(manifest.currentSessionTelemetry, false);
  assert.equal(manifest.sourceBinding, 'historical_unbound');
  const evidence = parseRecords(await readFile(join(f.outputDir, 'evidence.jsonl')), 'package');
  assert.equal(evidence.length, 6);
  assert.equal(evidence[0].target.health, null);
  assert.equal(evidence[0].target.position.x, 0);
  assert.equal(evidence[0].sourceMode, 'simulated');
  assert.equal(evidence[0].sampleTimeUtc, '2026-11-15T12:56:06.654Z');
  assert.equal(evidence[1].sampleTimeUtc, null);
  assert.equal(evidence[3].classification, 'continuous_candidate');
  assert.equal((await verifyBundle(f.outputDir)).filesVerified, 6);
});

test('wrong hostname rejects before any output is created', async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    () =>
      session({
        ...f,
        expectedHost: 'LEGION',
        telemetryFile: f.telemetry,
        trackFile: f.track,
        clientFile: f.client,
      }),
    (e) => e.code === 'WRONG_HOST',
  );
  await assert.rejects(() => readFile(join(f.outputDir, 'manifest.json')), { code: 'ENOENT' });
});

test('wrong pinned build is rejected before any output is created', async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    () =>
      session({
        ...f,
        telemetryFile: f.telemetry,
        trackFile: f.track,
        clientFile: f.client,
        expectedSha256: '0'.repeat(64),
      }),
    (e) => e.code === 'BUILD_MISMATCH',
  );
  await assert.rejects(() => readFile(join(f.outputDir, 'manifest.json')), { code: 'ENOENT' });
});

test('modified original bundle evidence fails exact hash verification', async (t) => {
  const f = await fixture(t);
  await session({ ...f, clientFile: f.client, telemetryFile: f.telemetry, trackFile: f.track });
  await writeFile(join(f.outputDir, 'telemetry.source'), 'changed');
  await assert.rejects(
    () => verifyBundle(f.outputDir),
    (e) => e.code === 'BUNDLE_HASH_MISMATCH',
  );
});

test('malformed telemetry rejects without output', async (t) => {
  const f = await fixture(t);
  await writeFile(f.telemetry, '{"sequence":1}\nnot-json\n');
  await assert.rejects(
    () => session({ ...f, clientFile: f.client, telemetryFile: f.telemetry, trackFile: f.track }),
    (e) => e.code === 'INVALID_RECORDS',
  );
  await assert.rejects(() => readFile(join(f.outputDir, 'manifest.json')), { code: 'ENOENT' });
});

test('invalid positional track observation cannot be promoted into a session', async (t) => {
  const f = await fixture(t);
  await writeFile(f.track, JSON.stringify({ ...fixtureTrack[0], x: null }) + '\n');
  await assert.rejects(
    () => session({ ...f, clientFile: f.client, telemetryFile: f.telemetry, trackFile: f.track }),
    (e) => e.code === 'EXPERIMENT_INVALID',
  );
  await assert.rejects(() => readFile(join(f.outputDir, 'manifest.json')), { code: 'ENOENT' });
});

test('existing bundle is never overwritten', async (t) => {
  const f = await fixture(t);
  await mkdir(f.outputDir);
  await writeFile(join(f.outputDir, 'keep.txt'), 'untouched');
  await assert.rejects(
    () => session({ ...f, clientFile: f.client, telemetryFile: f.telemetry, trackFile: f.track }),
    (e) => e.code === 'OUTPUT_EXISTS',
  );
  assert.equal(await readFile(join(f.outputDir, 'keep.txt'), 'utf8'), 'untouched');
});

test('telemetry build conflict fails instead of silently assuming compatibility', () => {
  const record = [
    {
      source: 'rift',
      target: { details: { buildSha256: 'a'.repeat(64) } },
      client: { sha256: 'b'.repeat(64) },
    },
  ];
  assert.throws(
    () => normalizeTelemetry(record, '0'.repeat(64), 'a'.repeat(64)),
    (e) => e instanceof ResearchError && e.code === 'CONFLICTING_BUILD',
  );
});

test('available zero and unavailable null are distinguished', () => {
  const records = [
    { source: 'rift', state: 'live', target: { health: 0, healthMax: null, x: 0, y: 1, z: 0 } },
  ];
  const [entry] = normalizeTelemetry(records, '0'.repeat(64), '1'.repeat(64));
  assert.equal(entry.target.health, 0);
  assert.equal(entry.target.healthMax, null);
  assert.deepEqual(entry.target.position, { x: 0, y: 1, z: 0 });
  assert.equal(entry.binding, 'unverified_offline');
});

test('the RPT analyzer integration points to the real sibling Python source', async () => {
  const data = await readFile(DEFAULT_ANALYZER, 'utf8');
  assert.match(data, /def analyze\(/);
});

test('doctor requires explicit offline client and expected host', async () => {
  await assert.rejects(
    () => doctor({ clientFile: null, expectedHost: 'AMD-DESKTOP' }),
    (e) => e.code === 'MISSING_ARGUMENT',
  );
});

test('unrecognized JSON does not masquerade as Telemetry', () => {
  assert.throws(
    () => normalizeTelemetry([{ arbitrary: true }], '0'.repeat(64), '1'.repeat(64)),
    (e) => e.code === 'UNKNOWN_TELEMETRY',
  );
});

test('invalid UTF-8 fails with a structured error', () => {
  assert.throws(
    () => parseRecords(Buffer.from([0xff, 0xfe]), 'bad source'),
    (e) => e.code === 'INVALID_ENCODING',
  );
});
