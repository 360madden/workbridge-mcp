import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join, resolve, win32 } from 'node:path';
import { promisify } from 'node:util';
import { ResearchError, readEvidence, SHA256 } from './identity.mjs';
import { physicalRiftIdentity } from './physical-epoch.mjs';
import { savePhysicalReceipt, verifyPhysicalReceipt } from './physical-receipt.mjs';

const execAsync = promisify(execFile);
const PHYSICAL = 'workbridge.rift-physical-epoch.v1';
const WITNESS = 'workbridge.rift-live-witness.v1';
const ENTRIES = [
  'physical-before/physical-epoch.json',
  'physical-before/SHA256SUMS.txt',
  'telemetry.source',
  'physical-after/physical-epoch.json',
  'physical-after/SHA256SUMS.txt',
  'manifest.json',
];
const TELEMETRY_ROOT = 'C:\\work\\Telemetry';
const MAX_TELEMETRY_BYTES = 256 * 1024;
const CAPTURE_LIMIT_MS = 30_000;
const SHA = /^[0-9a-f]{64}$/;
const TICKS = /^[1-9][0-9]{1,21}$/;

function refuse(code, message) {
  throw new ResearchError(code, message);
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function assertPid(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 0x7fffffff)
    refuse('WITNESS_PID', 'Select one explicit positive RIFT PID.');
}

function validateOptions({
  expectedHost,
  host,
  pid,
  expectedStartTicks,
  expectedExeSha256,
  telemetryExecutable,
  telemetrySha256,
  outputDir,
  telemetryRoot,
}) {
  if (!expectedHost || host.toUpperCase() !== expectedHost.toUpperCase())
    refuse('WRONG_HOST', 'The live witness requires the verified exact Windows host.');
  assertPid(pid);
  if (typeof expectedStartTicks !== 'string' || !TICKS.test(expectedStartTicks))
    refuse('WITNESS_TICKS', 'Pin the exact decimal process-start ticks as a string.');
  if (typeof expectedExeSha256 !== 'string' || !SHA256.test(expectedExeSha256))
    refuse('WITNESS_BUILD', 'Pin the current executable SHA-256 before capture.');
  if (typeof telemetrySha256 !== 'string' || !SHA256.test(telemetrySha256))
    refuse('WITNESS_CLI_HASH', 'Pin the current Telemetry CLI executable SHA-256.');
  if (typeof outputDir !== 'string' || !outputDir)
    refuse('WITNESS_OUTPUT', 'Supply a new output folder; existing evidence is never overwritten.');
  if (
    typeof telemetryExecutable !== 'string' ||
    !/^[A-Za-z]:\\/.test(telemetryExecutable) ||
    telemetryExecutable.split('\\').some((s) => s === '..' || s === '.')
  ) {
    refuse('WITNESS_CLI_PATH', 'Telemetry executable must use a trusted absolute local path.');
  }
  const root = win32.normalize(telemetryRoot);
  const path = win32.normalize(telemetryExecutable);
  const allowed = [
    win32.join(root, 'src', 'Telemetry.Cli', 'bin', 'Release', 'net10.0', 'Telemetry.Cli.exe'),
    win32.join(root, 'artifacts', 'publish', 'Telemetry.Cli.exe'),
  ];
  if (!allowed.some((item) => item.toLowerCase() === path.toLowerCase())) {
    refuse('WITNESS_CLI_PATH', 'Only the reviewed Telemetry project release executable paths are accepted.');
  }
}

function assertPhysical(record, pid, ticks, exeSha256) {
  const selected = record?.selected;
  if (
    record?.schema !== PHYSICAL ||
    record.status !== 'read_only_identity_observed' ||
    record.liveBindingVerified !== true ||
    record.readOnly !== true ||
    record.inputSent !== false ||
    record.memoryRead !== false ||
    record.validation?.processEpochRechecked !== true ||
    record.validation?.hwndRechecked !== true ||
    record.validation?.executableHashFromProcessPath !== true ||
    selected?.pid !== pid ||
    selected.processStartUtcTicks !== ticks ||
    selected.executableSha256?.toLowerCase() !== exeSha256 ||
    !Number.isSafeInteger(selected.window?.hwnd) ||
    selected.window?.pid !== pid
  ) {
    refuse('WITNESS_IDENTITY', 'The physical game epoch is not a fully verified selected process.');
  }
}

function assertSameEpoch(before, after) {
  const a = before.selected,
    b = after.selected;
  const fields = [
    'pid',
    'processStartUtcTicks',
    'startedUtc',
    'sessionId',
    'moduleBaseHex',
    'moduleSizeBytes',
    'executablePath',
    'executableSha256',
    'executableBytes',
  ];
  if (
    fields.some((field) => a[field] !== b[field]) ||
    a.window.hwnd !== b.window.hwnd ||
    a.window.className !== b.window.className ||
    a.window.title !== b.window.title
  ) {
    refuse('WITNESS_EPOCH_CHANGED', 'RIFT process epoch, image, or HWND changed between observations.');
  }
}

function timestamp(value, field) {
  if (
    typeof value !== 'string' ||
    value.length < 20 ||
    value.length > 55 ||
    !/(?:Z|\+00:00)$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    refuse('WITNESS_TIME', 'Missing or invalid UTC time for ' + field);
  }
  return Date.parse(value);
}

/** Validates source status without echoing potentially identifying player data. */
export function interpretNativeTelemetry(value, executableSha256) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value.application?.repository !== 'Telemetry' ||
    !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(value.application?.version ?? '') ||
    value.source !== 'rift' ||
    !['unavailable', 'live', 'no-target'].includes(value.state) ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 1 ||
    !Number.isFinite(value.readMs) ||
    value.readMs < 0 ||
    !value.sources ||
    typeof value.sources !== 'object' ||
    !['unavailable', 'live', 'no-target'].includes(value.sources.native?.state) ||
    ['rr2-api', 'lua-api', 'player-api'].some((key) => value.sources[key]?.state !== 'disabled')
  ) {
    refuse('WITNESS_TELEMETRY_SCHEMA', 'Telemetry CLI response is not a native-only RIFT observation.');
  }
  timestamp(value.sampledAt, 'telemetry sample');
  const message = value.message;
  const unsupported = /^Unsupported RIFT build ([0-9A-Fa-f]{64})\.$/.exec(message ?? '');
  if (unsupported && unsupported[1].toLowerCase() !== executableSha256) {
    refuse('WITNESS_SOURCE_BUILD', 'Telemetry CLI observed a different executable hash.');
  }
  if (
    unsupported &&
    (value.state !== 'unavailable' ||
      value.sources.native.state !== 'unavailable' ||
      value.target !== null ||
      value.player !== null)
  ) {
    refuse(
      'WITNESS_TELEMETRY_SCHEMA',
      'Unsupported build cannot simultaneously report qualified live unit fields.',
    );
  }
  const classification = unsupported
    ? 'unsupported_build_observed'
    : value.state === 'unavailable'
      ? 'unavailable_unbound'
      : 'sample_unbound_no_process_epoch';
  return {
    state: value.state,
    nativeState: value.sources.native.state,
    applicationVersion: value.application.version,
    sampledAt: value.sampledAt,
    sequence: value.sequence,
    readMs: value.readMs,
    classification,
    unsupportedBuildHash: unsupported?.[1].toLowerCase() ?? null,
    sourceEpochBound: false,
    currentPlayerStatsQualified: false,
    currentTargetStatsQualified: false,
  };
}

async function runTelemetryNative(executable) {
  let stdout;
  try {
    ({ stdout } = await execAsync(executable, ['snapshot', '--native-only', '--wait', '0'], {
      windowsHide: true,
      shell: false,
      timeout: 20_000,
      maxBuffer: MAX_TELEMETRY_BYTES,
    }));
  } catch {
    refuse('WITNESS_TELEMETRY_EXEC', 'The read-only Telemetry CLI did not complete successfully.');
  }
  return Buffer.from(stdout, 'utf8');
}

function parseJson(bytes, label) {
  try {
    const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw Error();
    return result;
  } catch {
    refuse('WITNESS_JSON', 'Malformed saved JSON artifact: ' + label);
  }
}

function boundedNativeBytes(raw) {
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  if (bytes.length < 32 || bytes.length > MAX_TELEMETRY_BYTES) {
    refuse('WITNESS_TELEMETRY_SIZE', 'The source Telemetry snapshot is missing or too large.');
  }
  return bytes;
}

function assertCaptureWindow(before, sample, after) {
  const first = timestamp(before.sampledUtc, 'physical before');
  const observed = timestamp(sample.sampledAt, 'telemetry sample');
  const last = timestamp(after.sampledUtc, 'physical after');
  if (last < first || last - first > CAPTURE_LIMIT_MS || observed < first - 2000 || observed > last + 2000) {
    refuse('WITNESS_CAPTURE_WINDOW', 'The native sample is not inside a bounded physical epoch window.');
  }
  return {
    startUtc: before.sampledUtc,
    telemetryUtc: sample.sampledAt,
    endUtc: after.sampledUtc,
    captureDurationMs: last - first,
  };
}

/**
 * Acquire exactly one read-only native-only CLI observation between independently
 * verified process/HWND/image identity probes. The Telemetry 0.5.0 sample has
 * no PID/start-tick field; sourceEpochBound MUST remain false.
 */
export async function captureLiveWitness({
  expectedHost,
  pid,
  expectedStartTicks,
  expectedExeSha256,
  telemetryExecutable,
  telemetrySha256,
  outputDir,
  telemetryRoot = TELEMETRY_ROOT,
  host = hostname(),
  physicalProbe = physicalRiftIdentity,
  telemetryRunner = runTelemetryNative,
  sourceReader = readEvidence,
} = {}) {
  validateOptions({
    expectedHost,
    host,
    pid,
    expectedStartTicks,
    expectedExeSha256,
    telemetryExecutable,
    telemetrySha256,
    outputDir,
    telemetryRoot,
  });
  const expectedHash = expectedExeSha256.toLowerCase();
  const cliHash = telemetrySha256.toLowerCase();
  const cli = await sourceReader(telemetryExecutable, 2 * 1024 * 1024);
  if (cli.sha256 !== cliHash) refuse('WITNESS_CLI_HASH', 'Pinned Telemetry CLI source does not match.');
  const params = { expectedHost, pid, expectedSha256: expectedHash, host };
  const before = await physicalProbe(params);
  assertPhysical(before, pid, expectedStartTicks, expectedHash);
  const snapshotBytes = boundedNativeBytes(await telemetryRunner(telemetryExecutable));
  const snapshot = parseJson(snapshotBytes, 'telemetry.source');
  const telemetry = interpretNativeTelemetry(snapshot, expectedHash);
  const after = await physicalProbe(params);
  assertPhysical(after, pid, expectedStartTicks, expectedHash);
  assertSameEpoch(before, after);
  const captureWindow = assertCaptureWindow(before, telemetry, after);
  const cliAfter = await sourceReader(telemetryExecutable, 2 * 1024 * 1024);
  if (cliAfter.sha256 !== cliHash) refuse('WITNESS_CLI_CHANGED', 'Telemetry CLI changed during the witness.');

  const destination = resolve(outputDir);
  if (existsSync(destination)) refuse('OUTPUT_EXISTS', 'Witness evidence directory already exists.');
  try {
    await mkdir(destination, { recursive: false });
  } catch (error) {
    if (error?.code === 'EEXIST')
      refuse('OUTPUT_EXISTS', 'Witness evidence directory appeared concurrently.');
    throw error;
  }
  await savePhysicalReceipt(before, join(destination, 'physical-before'));
  await writeFile(join(destination, 'telemetry.source'), snapshotBytes, { flag: 'wx' });
  await savePhysicalReceipt(after, join(destination, 'physical-after'));
  const manifest = {
    schema: WITNESS,
    captureStatus: telemetry.classification,
    expectedHost: host.toUpperCase(),
    selectedPid: pid,
    processStartUtcTicks: expectedStartTicks,
    executableSha256: expectedHash,
    telemetryExecutableSha256: cliHash,
    telemetryExecutablePath: telemetryExecutable,
    physicalHwnd: before.selected.window.hwnd,
    captureWindow,
    telemetry: {
      ...telemetry,
      rawSha256: hash(snapshotBytes),
    },
    sourceEpochBound: false,
    livePlayerTelemetryVerified: false,
    liveTargetTelemetryVerified: false,
    processEpochObservedTwice: true,
    inputSent: false,
    gameMemoryWritten: false,
    archivedAfterCapture: true,
  };
  await writeFile(join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', {
    flag: 'wx',
  });
  const checks = [];
  for (const name of ENTRIES) {
    const source = await readEvidence(join(destination, name), MAX_TELEMETRY_BYTES);
    checks.push(source.sha256 + '  ' + name);
  }
  // Completion marker last: interrupted writes cannot be verified as complete.
  await writeFile(join(destination, 'SHA256SUMS.txt'), checks.join('\n') + '\n', { flag: 'wx' });
  let verified;
  try {
    verified = await verifyLiveWitness(destination);
  } catch (error) {
    // Withdraw only the completion marker published by this new capture.
    try {
      await unlink(join(destination, 'SHA256SUMS.txt'));
    } catch {
      /* Incomplete packages do not verify. */
    }
    throw error;
  }
  return {
    status: manifest.captureStatus,
    verified: verified.verified,
    directory: destination,
    selectedPid: pid,
    processStartUtcTicks: expectedStartTicks,
    executableSha256: expectedHash,
    sourceEpochBound: false,
    livePlayerTelemetryVerified: false,
    liveTargetTelemetryVerified: false,
  };
}

export async function verifyLiveWitness(bundleDir) {
  if (!bundleDir) refuse('WITNESS_BUNDLE', 'Supply the exact saved witness package.');
  const directory = resolve(bundleDir);
  const marker = await readEvidence(join(directory, 'SHA256SUMS.txt'), 16 * 1024);
  const lines = new TextDecoder('utf-8', { fatal: true }).decode(marker.bytes).trim().split('\n');
  if (lines.length !== ENTRIES.length) refuse('WITNESS_INVENTORY', 'Missing or extra evidence files.');
  for (let i = 0; i < ENTRIES.length; i++) {
    const match = /^([0-9a-f]{64})  ([A-Za-z0-9./_-]+)$/.exec(lines[i]);
    if (!match || match[2] !== ENTRIES[i])
      refuse('WITNESS_INVENTORY', 'Unexpected evidence inventory path/order.');
    const source = await readEvidence(join(directory, match[2]), MAX_TELEMETRY_BYTES);
    if (source.sha256 !== match[1]) refuse('WITNESS_HASH', 'Evidence SHA-256 does not match the inventory.');
  }
  const beforeReceipt = await verifyPhysicalReceipt(join(directory, 'physical-before'));
  const afterReceipt = await verifyPhysicalReceipt(join(directory, 'physical-after'));
  const before = parseJson(
    (await readEvidence(join(directory, ENTRIES[0]), 16 * 1024)).bytes,
    'physical before',
  );
  const after = parseJson(
    (await readEvidence(join(directory, ENTRIES[3]), 16 * 1024)).bytes,
    'physical after',
  );
  const manifest = parseJson(
    (await readEvidence(join(directory, 'manifest.json'), 16 * 1024)).bytes,
    'manifest',
  );
  const source = await readEvidence(join(directory, 'telemetry.source'), MAX_TELEMETRY_BYTES);
  const raw = parseJson(source.bytes, 'telemetry.source');
  assertPhysical(before, manifest.selectedPid, manifest.processStartUtcTicks, manifest.executableSha256);
  assertPhysical(after, manifest.selectedPid, manifest.processStartUtcTicks, manifest.executableSha256);
  assertSameEpoch(before, after);
  const telemetry = interpretNativeTelemetry(raw, manifest.executableSha256);
  const captureWindow = assertCaptureWindow(before, telemetry, after);
  if (
    manifest.schema !== WITNESS ||
    manifest.expectedHost !== before.machine ||
    manifest.expectedHost !== after.machine ||
    manifest.captureStatus !== telemetry.classification ||
    manifest.physicalHwnd !== before.selected.window.hwnd ||
    manifest.processEpochObservedTwice !== true ||
    manifest.sourceEpochBound !== false ||
    manifest.livePlayerTelemetryVerified !== false ||
    manifest.liveTargetTelemetryVerified !== false ||
    manifest.inputSent !== false ||
    manifest.gameMemoryWritten !== false ||
    manifest.archivedAfterCapture !== true ||
    !manifest.telemetry ||
    typeof manifest.telemetry !== 'object' ||
    manifest.telemetry.rawSha256 !== source.sha256 ||
    JSON.stringify(manifest.telemetry) !== JSON.stringify({ ...telemetry, rawSha256: source.sha256 }) ||
    JSON.stringify(manifest.captureWindow) !== JSON.stringify(captureWindow) ||
    !SHA.test(manifest.telemetryExecutableSha256) ||
    beforeReceipt.executableSha256 !== afterReceipt.executableSha256 ||
    beforeReceipt.pid !== afterReceipt.pid
  ) {
    refuse('WITNESS_MANIFEST', 'Manifest claims disagree with the independently checked saved sources.');
  }
  return {
    verified: true,
    directory,
    status: manifest.captureStatus,
    selectedPid: beforeReceipt.pid,
    processStartUtcTicks: beforeReceipt.processStartUtcTicks,
    executableSha256: beforeReceipt.executableSha256,
    savedEvidenceOnly: true,
    currentProcessAliveVerified: false,
    sourceEpochBound: false,
    livePlayerTelemetryVerified: false,
    liveTargetTelemetryVerified: false,
    inputSent: false,
  };
}
