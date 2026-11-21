import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectOfflineClient, readEvidence, ResearchError } from './identity.mjs';
import { parseRecords, normalizeTelemetry, normalizeExperiment } from './records.mjs';
import { runRPTAnalyzer } from './experiment.mjs';
import { normalizeRR2, normalizeRRE, compareArchivedEpochs } from './archived-sources.mjs';

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
const OPTIONAL = [
  ['rr2', 'rr2.source'],
  ['rre', 'rre.source'],
  ['rreBinding', 'rre-binding.source'],
];

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
  rr2File = null,
  rreFile = null,
  rreBindingFile = null,
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
  if (Boolean(rreFile) !== Boolean(rreBindingFile)) {
    throw new ResearchError(
      'RRE_PAIR_REQUIRED',
      'RRE publication requires its matching saved binding receipt.',
    );
  }
  const inputPaths = [telemetryFile, trackFile, analyzerFile, rr2File, rreFile, rreBindingFile]
    .filter(Boolean)
    .map((item) => resolve(item).toLowerCase());
  if (new Set(inputPaths).size !== inputPaths.length) {
    throw new ResearchError('SOURCE_CONFLICT', 'Experiment inputs must be independent source files.');
  }
  const examined = await doctor({ clientFile, expectedHost, expectedSha256, analyzerFile, host });
  const [telemetry, track, analyzer] = await Promise.all([
    readEvidence(telemetryFile, FILE_LIMIT),
    readEvidence(trackFile, FILE_LIMIT),
    readEvidence(analyzerFile, 128 * 1024),
  ]);
  const [rr2, rre, rreBinding] = await Promise.all([
    rr2File ? readEvidence(rr2File, FILE_LIMIT) : Promise.resolve(null),
    rreFile ? readEvidence(rreFile, FILE_LIMIT) : Promise.resolve(null),
    rreBindingFile ? readEvidence(rreBindingFile, FILE_LIMIT) : Promise.resolve(null),
  ]);
  const rr2Record = rr2 ? normalizeRR2(rr2, examined.client.sha256) : null;
  const rreRecord = rre ? normalizeRRE(rre, rreBinding, examined.client.sha256) : null;
  const archivedEpochs = compareArchivedEpochs(rr2Record, rreRecord);
  const optionalSources = { rr2, rre, rreBinding };
  const artifactNames = [
    ...ARTIFACTS,
    ...OPTIONAL.filter(([key]) => optionalSources[key]).map(([, name]) => name),
  ];
  const telemetryRows = parseRecords(telemetry.bytes, 'Telemetry');
  const trackRows = parseRecords(track.bytes, 'RPT track');
  const observed = normalizeTelemetry(telemetryRows, telemetry.sha256, examined.client.sha256);
  const result = await runRPTAnalyzer({
    python,
    scriptPath: analyzer.path,
    trackPath: track.path,
  });
  const analysis = normalizeExperiment(trackRows, result.classifications, track.sha256);
  await Promise.all(
    [telemetry, track, analyzer, rr2, rre, rreBinding]
      .filter(Boolean)
      .map((source) => verifySameSource(source)),
  );
  const confirmedClient = await inspectOfflineClient(clientFile, expectedHost, examined.client.sha256, host);
  if (confirmedClient.path !== examined.client.path) {
    throw new ResearchError('CLIENT_CHANGED', 'Selected game executable path changed during experiment.');
  }
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
      ...Object.fromEntries(
        OPTIONAL.filter(([key]) => optionalSources[key]).map(([key]) => [
          key,
          {
            originalPath: optionalSources[key].path,
            sha256: optionalSources[key].sha256,
            bytes: optionalSources[key].size,
          },
        ]),
      ),
    },
    archivedEpochs,
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
      rr2: rr2Record ? 1 : 0,
      rre: rreRecord ? 1 : 0,
      unavailableNumericsRemainNull: true,
    },
    artifacts: artifactNames,
  };
  const outputs = new Map([
    ['telemetry.source', telemetry.bytes],
    ['track.source', track.bytes],
    ['analyzer-source.py', analyzer.bytes],
    ['analysis.jsonl', jsonl(result.classifications)],
    ['evidence.jsonl', jsonl([...observed, ...analysis, ...[rr2Record, rreRecord].filter(Boolean)])],
    ['manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8')],
  ]);
  for (const [key, name] of OPTIONAL) {
    if (optionalSources[key]) outputs.set(name, optionalSources[key].bytes);
  }
  // Preflight, analyzer execution and source revalidation complete before any output is created.
  await mkdir(out, { recursive: false });
  for (const [name, bytes] of outputs) {
    await writeFile(join(out, name), bytes, { flag: 'wx' });
  }
  const sums = artifactNames.map((name) => digest(outputs.get(name)) + '  ' + name).join('\n') + '\n';
  await writeFile(join(out, 'SHA256SUMS.txt'), sums, { flag: 'wx' });
  return {
    status: 'completed_offline_replay',
    directory: out,
    clientSha256: examined.client.sha256,
    telemetryRecords: observed.length,
    positionRecords: analysis.length,
    rr2Records: rr2Record ? 1 : 0,
    rreRecords: rreRecord ? 1 : 0,
    archivedEpochs,
    classificationCounts: manifest.experiment.classificationCounts,
    transportOrTeleportVerified: false,
    bundleVerified: (await verifyBundle(out)).verified,
  };
}

export async function verifyBundle(outputDir) {
  const dir = resolve(outputDir);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  } catch {
    throw new ResearchError('BUNDLE_MANIFEST', 'Bundle manifest is not valid JSON.');
  }
  if (
    manifest?.schema !== 'workbridge.rift-research-session.v1' ||
    manifest.complete !== true ||
    manifest.transportOrTeleportVerified !== false ||
    manifest.currentSessionTelemetry !== false
  ) {
    throw new ResearchError('BUNDLE_MANIFEST', 'Bundle manifest has invalid or unsupported claims.');
  }
  const expectedNames = [
    ...ARTIFACTS,
    ...OPTIONAL.filter(([key]) => manifest.inputs?.[key]).map(([, name]) => name),
  ];
  if (
    !Array.isArray(manifest.artifacts) ||
    JSON.stringify(manifest.artifacts) !== JSON.stringify(expectedNames) ||
    Boolean(manifest.inputs?.rre) !== Boolean(manifest.inputs?.rreBinding)
  ) {
    throw new ResearchError('BUNDLE_MANIFEST', 'Bundle artifact inventory is inconsistent with inputs.');
  }
  const sums = await readEvidence(join(dir, 'SHA256SUMS.txt'), 16 * 1024);
  const lines = new TextDecoder('utf-8', { fatal: true }).decode(sums.bytes).trim().split(/\r?\n/);
  if (lines.length !== expectedNames.length) {
    throw new ResearchError('BUNDLE_INCOMPLETE', 'Bundle checksum inventory is incomplete.');
  }
  const expected = new Map();
  for (const line of lines) {
    const match = /^([0-9a-f]{64})  ([a-zA-Z0-9.-]+)$/.exec(line);
    if (!match || !expectedNames.includes(match[2]) || expected.has(match[2])) {
      throw new ResearchError(
        'BUNDLE_INVENTORY',
        'Bundle checksum list contains an invalid or repeated entry.',
      );
    }
    expected.set(match[2], match[1]);
  }
  for (const name of expectedNames) {
    const source = await readEvidence(join(dir, name), FILE_LIMIT);
    if (expected.get(name) !== source.sha256) {
      throw new ResearchError('BUNDLE_HASH_MISMATCH', 'Bundle artifact hash mismatch: ' + name);
    }
  }
  return {
    verified: true,
    directory: dir,
    filesVerified: expectedNames.length,
    statement: 'Content hashes match; live process, source provenance and teleport are not verified.',
  };
}
