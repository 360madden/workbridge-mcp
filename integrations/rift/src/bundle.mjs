import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectOfflineClient, readEvidence, ResearchError } from './identity.mjs';
import { parseRecords, normalizeTelemetry, normalizeExperiment } from './records.mjs';
import { runRPTAnalyzer } from './experiment.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const DEFAULT_ANALYZER = join(ROOT, 'Rift-Personal-Teleporter', 'src', 'teleport_analyzer.py');
export const DEFAULT_PYTHON = process.platform === 'win32' ? 'C:\\Python314\\python.exe' : 'python3';
const ARTIFACTS = [
  'telemetry.source',
  'track.source',
  'analyzer-source.py',
  'analysis.jsonl',
  'evidence.jsonl',
  'manifest.json',
];
const FILE_LIMIT = 4 * 1024 * 1024;

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function jsonl(items) {
  return Buffer.from(items.map((item) => JSON.stringify(item)).join('\n') + '\n', 'utf8');
}

function countByClass(events) {
  const result = {};
  for (const item of events) result[item.classification] = (result[item.classification] ?? 0) + 1;
  return result;
}

async function verifySameSource(original) {
  const reread = await readEvidence(original.path, Math.max(original.size, 1));
  if (reread.sha256 !== original.sha256 || reread.size !== original.size) {
    throw new ResearchError(
      'SOURCE_CHANGED',
      'Input changed while running the offline experiment: ' + original.path,
    );
  }
}

export async function doctor({
  clientFile,
  expectedHost,
  expectedSha256 = null,
  analyzerFile = DEFAULT_ANALYZER,
  host = hostname(),
}) {
  if (!clientFile || !expectedHost) {
    throw new ResearchError('MISSING_ARGUMENT', 'Doctor requires a client file and expected hostname.');
  }
  const client = await inspectOfflineClient(clientFile, expectedHost, expectedSha256, host);
  const analyzer = await readEvidence(analyzerFile, 128 * 1024);
  return {
    schema: 'workbridge.rift-doctor.v1',
    host: { expected: expectedHost.toUpperCase(), observed: String(host).toUpperCase(), verified: true },
    client,
    analyzer: { path: analyzer.path, sha256: analyzer.sha256, mode: 'saved_file_only' },
    gameContacted: false,
  };
}

export async function session({
  clientFile,
  telemetryFile,
  trackFile,
  outputDir,
  expectedHost,
  expectedSha256 = null,
  python = DEFAULT_PYTHON,
  analyzerFile = DEFAULT_ANALYZER,
  host = hostname(),
}) {
  if (!clientFile || !telemetryFile || !trackFile || !outputDir || !expectedHost) {
    throw new ResearchError(
      'MISSING_ARGUMENT',
      'Client, telemetry, track, output and expected host are required.',
    );
  }
  const out = resolve(outputDir);
  if (existsSync(out)) {
    throw new ResearchError(
      'OUTPUT_EXISTS',
      'Refusing to overwrite a pre-existing evidence directory: ' + out,
    );
  }
  if (resolve(telemetryFile) === resolve(trackFile)) {
    throw new ResearchError('SOURCE_CONFLICT', 'Telemetry and position track must be independent files.');
  }
  const examined = await doctor({ clientFile, expectedHost, expectedSha256, analyzerFile, host });
  const [telemetry, track, analyzer] = await Promise.all([
    readEvidence(telemetryFile, FILE_LIMIT),
    readEvidence(trackFile, FILE_LIMIT),
    readEvidence(analyzerFile, 128 * 1024),
  ]);
  const telemetryRows = parseRecords(telemetry.bytes, 'Telemetry');
  const trackRows = parseRecords(track.bytes, 'RPT track');
  const observed = normalizeTelemetry(telemetryRows, telemetry.sha256, examined.client.sha256);
  const result = await runRPTAnalyzer({
    python,
    scriptPath: analyzer.path,
    trackPath: track.path,
  });
  const analysis = normalizeExperiment(trackRows, result.classifications, track.sha256);
  await Promise.all([verifySameSource(telemetry), verifySameSource(track), verifySameSource(analyzer)]);
  if (existsSync(out)) {
    throw new ResearchError(
      'OUTPUT_EXISTS',
      'Output directory appeared during experiment; refusing overwrite.',
    );
  }

  const manifest = {
    schema: 'workbridge.rift-research-session.v1',
    complete: true,
    createdUtc: new Date().toISOString(),
    mode: 'offline_saved_data',
    machine: examined.host,
    client: examined.client,
    sourceBinding: 'historical_unbound',
    processIdentityVerified: false,
    currentSessionTelemetry: false,
    transportOrTeleportVerified: false,
    inputs: {
      telemetry: {
        originalPath: telemetry.path,
        sha256: telemetry.sha256,
        bytes: telemetry.size,
        recordCount: telemetryRows.length,
        modes: [...new Set(observed.map((item) => item.sourceMode))],
      },
      track: {
        originalPath: track.path,
        sha256: track.sha256,
        bytes: track.size,
        recordCount: trackRows.length,
      },
      analyzer: {
        originalPath: analyzer.path,
        sha256: analyzer.sha256,
        bytes: analyzer.size,
        command: 'python -B teleport_analyzer.py <saved-track>',
        exitCode: result.exitCode,
      },
    },
    experiment: {
      kind: 'RPT_offline_position_classification',
      classificationCounts: countByClass(analysis),
      observationCount: analysis.length,
      positionDiscontinuityIsNotTeleportProof: true,
      classificationClaim: 'replay_of_saved_track_only',
    },
    normalizedRecords: {
      telemetry: observed.length,
      position: analysis.length,
      unavailableNumericsRemainNull: true,
    },
    artifacts: ARTIFACTS,
  };
  const outputs = new Map([
    ['telemetry.source', telemetry.bytes],
    ['track.source', track.bytes],
    ['analyzer-source.py', analyzer.bytes],
    ['analysis.jsonl', jsonl(result.classifications)],
    ['evidence.jsonl', jsonl([...observed, ...analysis])],
    ['manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8')],
  ]);
  // Preflight, analyzer execution and source revalidation complete before any output is created.
  await mkdir(out, { recursive: false });
  for (const [name, bytes] of outputs) {
    await writeFile(join(out, name), bytes, { flag: 'wx' });
  }
  const sums = ARTIFACTS.map((name) => digest(outputs.get(name)) + '  ' + name).join('\n') + '\n';
  await writeFile(join(out, 'SHA256SUMS.txt'), sums, { flag: 'wx' });
  return {
    status: 'completed_offline_replay',
    directory: out,
    clientSha256: examined.client.sha256,
    telemetryRecords: observed.length,
    positionRecords: analysis.length,
    classificationCounts: manifest.experiment.classificationCounts,
    transportOrTeleportVerified: false,
    bundleVerified: (await verifyBundle(out)).verified,
  };
}

export async function verifyBundle(outputDir) {
  const dir = resolve(outputDir);
  const sums = await readEvidence(join(dir, 'SHA256SUMS.txt'), 16 * 1024);
  const lines = new TextDecoder('utf-8', { fatal: true }).decode(sums.bytes).trim().split(/\r?\n/);
  if (lines.length !== ARTIFACTS.length) {
    throw new ResearchError('BUNDLE_INCOMPLETE', 'Bundle checksum inventory is incomplete.');
  }
  const expected = new Map();
  for (const line of lines) {
    const match = /^([0-9a-f]{64})  ([a-zA-Z0-9.-]+)$/.exec(line);
    if (!match || !ARTIFACTS.includes(match[2]) || expected.has(match[2])) {
      throw new ResearchError(
        'BUNDLE_INVENTORY',
        'Bundle checksum list contains an invalid or repeated entry.',
      );
    }
    expected.set(match[2], match[1]);
  }
  for (const name of ARTIFACTS) {
    const source = await readEvidence(join(dir, name), FILE_LIMIT);
    if (expected.get(name) !== source.sha256) {
      throw new ResearchError('BUNDLE_HASH_MISMATCH', 'Bundle artifact hash mismatch: ' + name);
    }
  }
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  if (
    manifest.schema !== 'workbridge.rift-research-session.v1' ||
    manifest.complete !== true ||
    manifest.transportOrTeleportVerified !== false ||
    manifest.currentSessionTelemetry !== false
  ) {
    throw new ResearchError('BUNDLE_MANIFEST', 'Bundle manifest has invalid or unsupported claims.');
  }
  return {
    verified: true,
    directory: dir,
    filesVerified: ARTIFACTS.length,
    statement: 'Content hashes match; live process, source provenance and teleport are not verified.',
  };
}
