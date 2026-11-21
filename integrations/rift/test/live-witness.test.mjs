import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import test from 'node:test';
import { captureLiveWitness, verifyLiveWitness, interpretNativeTelemetry } from '../src/live-witness.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const PID = 34596;
const TICKS = '639308249563595623';
const EXE = 'df954b798331e18359be62a31cc74b49fc3f50b87385ebb080a5448256322c01';
const HOST = 'AMD-DESKTOP';

function epoch(sampledUtc, changes = {}) {
  return {
    schema: 'workbridge.rift-physical-epoch.v1',
    status: 'read_only_identity_observed',
    machine: HOST,
    processCount: 1,
    selected: {
      pid: PID,
      processStartUtcTicks: TICKS,
      startedUtc: '2026-11-21T02:29:16.3595623Z',
      sessionId: 1,
      executablePath: 'C:\\Program Files (x86)\\Glyph\\Games\\RIFT\\Live\\rift_x64.exe',
      moduleName: 'rift_x64.exe',
      moduleBaseHex: '0x7FF60DF30000',
      moduleSizeBytes: 63246336,
      window: {
        hwnd: 658476,
        pid: PID,
        processName: 'rift_x64',
        className: 'TWNClientFramework',
        title: 'RIFT',
        foreground: false,
        width: 2576,
        height: 1408,
      },
      executableSha256: EXE,
      executableBytes: 60574536,
      executableFormat: 'AMD64_PE32_PLUS',
    },
    validation: {
      processEpochRechecked: true,
      hwndRechecked: true,
      executableHashFromProcessPath: true,
      memoryLayoutQualified: false,
      sourceTelemetryLinked: false,
    },
    sampledUtc,
    readOnly: true,
    inputSent: false,
    memoryRead: false,
    liveBindingVerified: true,
    ...changes,
  };
}

function sample(message = 'Unsupported RIFT build ' + EXE.toUpperCase() + '.') {
  return {
    sequence: 1,
    sampledAt: '2026-11-21T06:00:01.0000000+00:00',
    readMs: 146.372,
    intervalMs: 50,
    source: 'rift',
    state: 'unavailable',
    message,
    target: null,
    player: null,
    sources: {
      native: { state: 'unavailable', message },
      'rr2-api': { state: 'disabled', message: 'Native-only mode.' },
      'lua-api': { state: 'disabled', message: 'Native-only mode.' },
      'player-api': { state: 'disabled', message: 'Native-only mode.' },
    },
    application: { repository: 'Telemetry', version: '0.5.0' },
  };
}

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'wb-rift-live-witness-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const exe = join(dir, 'src', 'Telemetry.Cli', 'bin', 'Release', 'net10.0', 'Telemetry.Cli.exe');
  await mkdir(dirname(exe), { recursive: true });
  const bytes = Buffer.from('synthetic Telemetry.Cli.exe pinned file fixture\n');
  await writeFile(exe, bytes);
  const outputDir = join(dir, 'witness-01');
  let probes = 0;
  let telemetryCalls = 0;
  let observed = sample();
  const before = epoch('2026-11-21T06:00:00.000Z');
  const after = epoch('2026-11-21T06:00:02.000Z');
  const physicalProbe = async () => {
    probes++;
    return structuredClone(probes === 1 ? before : after);
  };
  const telemetryRunner = async () => {
    telemetryCalls++;
    return Buffer.from(JSON.stringify(observed) + '\n');
  };
  const options = {
    host: HOST,
    expectedHost: HOST,
    pid: PID,
    expectedStartTicks: TICKS,
    expectedExeSha256: EXE,
    telemetryExecutable: exe,
    telemetrySha256: hash(bytes),
    telemetryRoot: dir,
    outputDir,
    physicalProbe,
    telemetryRunner,
  };
  return {
    dir,
    exe,
    outputDir,
    before,
    after,
    options,
    calls: () => ({ probes, telemetryCalls }),
    setSample: (x) => {
      observed = x;
    },
  };
}

test('unsupported game build produces a qualified physical witness but no linked stats', async (t) => {
  const f = await fixture(t);
  const result = await captureLiveWitness(f.options);
  assert.equal(result.verified, true);
  assert.equal(result.status, 'unsupported_build_observed');
  assert.equal(result.sourceEpochBound, false);
  assert.equal(result.livePlayerTelemetryVerified, false);
  assert.equal(result.liveTargetTelemetryVerified, false);
  assert.deepEqual(f.calls(), { probes: 2, telemetryCalls: 1 });
  const verified = await verifyLiveWitness(f.outputDir);
  assert.equal(verified.verified, true);
  assert.equal(verified.savedEvidenceOnly, true);
  assert.equal(verified.currentProcessAliveVerified, false);
  assert.equal(verified.processStartUtcTicks, TICKS);
  const manifest = JSON.parse(await readFile(join(f.outputDir, 'manifest.json')));
  assert.equal(manifest.telemetry.unsupportedBuildHash, EXE);
  assert.equal(manifest.processEpochObservedTwice, true);
  assert.equal(manifest.sourceEpochBound, false);
});

test('source unavailable other than a build mismatch remains unbound', async (t) => {
  const f = await fixture(t);
  const s = sample('Reader has not qualified the current process.');
  f.setSample(s);
  const result = await captureLiveWitness(f.options);
  assert.equal(result.status, 'unavailable_unbound');
  assert.equal((await verifyLiveWitness(f.outputDir)).liveTargetTelemetryVerified, false);
});

test('even a source-reported live sample cannot invent explicit process-epoch binding', async (t) => {
  const f = await fixture(t);
  const s = sample('Reader reported live fields.');
  s.state = 'live';
  s.sources.native.state = 'live';
  s.target = { id: 'fixture-unit', health: 100 };
  f.setSample(s);
  const result = await captureLiveWitness(f.options);
  assert.equal(result.status, 'sample_unbound_no_process_epoch');
  assert.equal((await verifyLiveWitness(f.outputDir)).sourceEpochBound, false);
});

test('wrong host refuses before any native CLI invocation or output', async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    () => captureLiveWitness({ ...f.options, host: 'LEGION' }),
    (e) => e.code === 'WRONG_HOST',
  );
  assert.deepEqual(f.calls(), { probes: 0, telemetryCalls: 0 });
  await assert.rejects(access(f.outputDir), { code: 'ENOENT' });
});

test('wrong exact PID or start ticks refuses before binary or game state is combined', async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    () => captureLiveWitness({ ...f.options, expectedStartTicks: '639308249563595624' }),
    (e) => e.code === 'WITNESS_IDENTITY',
  );
  assert.equal(f.calls().telemetryCalls, 0);
});

test('second process epoch moving between before and after is rejected without output', async (t) => {
  const f = await fixture(t);
  let count = 0;
  const changed = epoch('2026-11-21T06:00:02.000Z');
  changed.selected.window.hwnd++;
  const physicalProbe = async () => (++count === 1 ? f.before : changed);
  await assert.rejects(
    () => captureLiveWitness({ ...f.options, physicalProbe }),
    (e) => e.code === 'WITNESS_EPOCH_CHANGED',
  );
  await assert.rejects(access(f.outputDir), { code: 'ENOENT' });
});

test('an unsupported-build report cannot simultaneously claim live target fields', async (t) => {
  const f = await fixture(t);
  const s = sample();
  s.state = 'live';
  s.sources.native.state = 'live';
  s.target = { id: 'unqualified', health: 100 };
  f.setSample(s);
  await assert.rejects(
    () => captureLiveWitness(f.options),
    (e) => e.code === 'WITNESS_TELEMETRY_SCHEMA',
  );
  await assert.rejects(access(f.outputDir), { code: 'ENOENT' });
});

test('source message naming another client build is refused, not treated as game match', async (t) => {
  const f = await fixture(t);
  f.setSample(sample('Unsupported RIFT build ' + 'a'.repeat(64) + '.'));
  await assert.rejects(
    () => captureLiveWitness(f.options),
    (e) => e.code === 'WITNESS_SOURCE_BUILD',
  );
  await assert.rejects(access(f.outputDir), { code: 'ENOENT' });
});

test('no producer binding can be claimed from a demo/bridge snapshot', async (t) => {
  const f = await fixture(t);
  const s = sample();
  s.source = 'demo';
  assert.throws(
    () => interpretNativeTelemetry(s, EXE),
    (e) => e.code === 'WITNESS_TELEMETRY_SCHEMA',
  );
  s.source = 'rift';
  s.sources['rr2-api'].state = 'live';
  assert.throws(
    () => interpretNativeTelemetry(s, EXE),
    (e) => e.code === 'WITNESS_TELEMETRY_SCHEMA',
  );
});

test('sample outside the physical bracketing window refuses publication', async (t) => {
  const f = await fixture(t);
  const s = sample();
  s.sampledAt = '2026-11-21T07:00:00+00:00';
  f.setSample(s);
  await assert.rejects(
    () => captureLiveWitness(f.options),
    (e) => e.code === 'WITNESS_CAPTURE_WINDOW',
  );
});

test('pinned Telemetry CLI source changed before capture cannot run', async (t) => {
  const f = await fixture(t);
  await writeFile(f.exe, 'changed exe fixture\n');
  await assert.rejects(
    () => captureLiveWitness(f.options),
    (e) => e.code === 'WITNESS_CLI_HASH',
  );
  assert.equal(f.calls().telemetryCalls, 0);
});

test('pinned CLI changed after telemetry sampling refuses publication', async (t) => {
  const f = await fixture(t);
  const original = f.options.telemetryRunner;
  const telemetryRunner = async (...args) => {
    const bytes = await original(...args);
    await writeFile(f.exe, 'changed executable during the sample\n');
    return bytes;
  };
  await assert.rejects(
    () => captureLiveWitness({ ...f.options, telemetryRunner }),
    (e) => e.code === 'WITNESS_CLI_CHANGED',
  );
  await assert.rejects(access(f.outputDir), { code: 'ENOENT' });
});

test('unapproved telemetry executable path cannot become an arbitrary command launcher', async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    () => captureLiveWitness({ ...f.options, telemetryExecutable: join(f.dir, 'other.exe') }),
    (e) => e.code === 'WITNESS_CLI_PATH',
  );
  assert.equal(f.calls().telemetryCalls, 0);
});

test('existing witness package is never overwritten', async (t) => {
  const f = await fixture(t);
  await captureLiveWitness(f.options);
  const old = await readFile(join(f.outputDir, 'manifest.json'));
  await assert.rejects(
    () => captureLiveWitness(f.options),
    (e) => e.code === 'OUTPUT_EXISTS',
  );
  assert.deepEqual(await readFile(join(f.outputDir, 'manifest.json')), old);
});

test('tampering with archived CLI sample is rejected during verification', async (t) => {
  const f = await fixture(t);
  await captureLiveWitness(f.options);
  await writeFile(join(f.outputDir, 'telemetry.source'), JSON.stringify(sample('tampered')) + '\n');
  await assert.rejects(
    () => verifyLiveWitness(f.outputDir),
    (e) => e.code === 'WITNESS_HASH',
  );
});

test('a rewritten manifest hash cannot silently promote unbound player stats', async (t) => {
  const f = await fixture(t);
  await captureLiveWitness(f.options);
  const manifestFile = join(f.outputDir, 'manifest.json');
  const inventoryFile = join(f.outputDir, 'SHA256SUMS.txt');
  const m = JSON.parse(await readFile(manifestFile));
  m.sourceEpochBound = true;
  m.livePlayerTelemetryVerified = true;
  const newManifest = Buffer.from(JSON.stringify(m, null, 2) + '\n');
  await writeFile(manifestFile, newManifest);
  const inventory = await readFile(inventoryFile, 'utf8');
  await writeFile(
    inventoryFile,
    inventory.replace(/^[0-9a-f]{64}  manifest\.json$/m, hash(newManifest) + '  manifest.json'),
  );
  await assert.rejects(
    () => verifyLiveWitness(f.outputDir),
    (e) => e.code === 'WITNESS_MANIFEST',
  );
});

test('a checksum-rewritten manifest lacking telemetry metadata fails without a raw TypeError', async (t) => {
  const f = await fixture(t);
  await captureLiveWitness(f.options);
  const manifestFile = join(f.outputDir, 'manifest.json');
  const inventoryFile = join(f.outputDir, 'SHA256SUMS.txt');
  const m = JSON.parse(await readFile(manifestFile));
  delete m.telemetry;
  const bytes = Buffer.from(JSON.stringify(m, null, 2) + '\n');
  await writeFile(manifestFile, bytes);
  const inventory = await readFile(inventoryFile, 'utf8');
  await writeFile(
    inventoryFile,
    inventory.replace(/^[0-9a-f]{64}  manifest\.json$/m, hash(bytes) + '  manifest.json'),
  );
  await assert.rejects(
    () => verifyLiveWitness(f.outputDir),
    (e) => e.code === 'WITNESS_MANIFEST',
  );
});

test('a witness with no completion marker is never a verified artifact', async (t) => {
  const f = await fixture(t);
  await mkdir(f.outputDir);
  await assert.rejects(() => verifyLiveWitness(f.outputDir));
});
