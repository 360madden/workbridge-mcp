import { ResearchError, SHA256 } from './identity.mjs';

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseRecords(buffer, label) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new ResearchError('INVALID_ENCODING', label + ' must use valid UTF-8.');
  }
  const trimmed = text.trim();
  if (!trimmed) throw new ResearchError('EMPTY_RECORDS', label + ' contained no records.');
  let items;
  try {
    const parsed = JSON.parse(trimmed);
    items = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    try {
      items = trimmed
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
    } catch (error) {
      throw new ResearchError('INVALID_RECORDS', label + ' is not JSON or valid JSONL: ' + error.message);
    }
  }
  if (items.length < 1 || items.length > 4096 || items.some((item) => !object(item))) {
    throw new ResearchError('RECORD_BOUNDS', label + ' must contain 1..4096 JSON object records.');
  }
  return items;
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function date(value) {
  if (typeof value !== 'string' || value.length > 80) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && /[zZ]|[+-]\d\d:\d\d$/.test(value)
    ? new Date(milliseconds).toISOString()
    : null;
}

function sourceBuild(record) {
  const candidates = [record.target?.details?.buildSha256, record.client?.sha256, record.gameBuildSha256];
  const hashes = candidates.filter((value) => typeof value === 'string' && SHA256.test(value));
  if (hashes.length > 1 && hashes.some((value) => value.toLowerCase() !== hashes[0].toLowerCase())) {
    throw new ResearchError('CONFLICTING_BUILD', 'Telemetry record contains conflicting build identities.');
  }
  return hashes.length ? hashes[0].toLowerCase() : null;
}

function targetValues(record) {
  const target = object(record.target) ? record.target : null;
  return {
    id: typeof target?.id === 'string' ? target.id : null,
    health: finite(target?.health),
    healthMax: finite(target?.healthMax),
    position: [target?.x, target?.y, target?.z].every((value) => finite(value) !== null)
      ? { x: target.x, y: target.y, z: target.z }
      : null,
  };
}

export function normalizeTelemetry(records, sourceSha256, offlineClientSha256) {
  return records.map((record, index) => {
    if (
      typeof record.source !== 'string' &&
      record.application?.repository !== 'Telemetry' &&
      !object(record.sources)
    ) {
      throw new ResearchError(
        'UNKNOWN_TELEMETRY',
        'Saved record is not a recognized Telemetry observation at index ' + index,
      );
    }
    const build = sourceBuild(record);
    const state = typeof record.state === 'string' ? record.state : null;
    const simulated = record.source === 'demo' || record.sources?.demo?.state === 'live';
    return {
      schema: 'workbridge.rift-evidence.v1',
      source: 'Telemetry',
      recordIndex: index,
      sourceFileSha256: sourceSha256,
      sampleSequence: Number.isSafeInteger(record.sequence) && record.sequence >= 0 ? record.sequence : null,
      sampleTimeUtc: date(record.sampledAt) ?? date(record.sampledAtUtc) ?? date(record.timestamp),
      sourceReportedState: state,
      sourceBuildSha256: build,
      buildMatch: build ? build === offlineClientSha256 : null,
      sourceMode: simulated ? 'simulated' : 'historical_saved',
      binding: 'unverified_offline',
      target: targetValues(record),
      noTeleportProof: true,
    };
  });
}

export function normalizeExperiment(track, classifications, sourceSha256) {
  if (track.length !== classifications.length) {
    throw new ResearchError('EXPERIMENT_COUNT', 'Analyzer output does not match input row count.');
  }
  const supported = new Set([
    'baseline',
    'continuous_candidate',
    'candidate_discontinuity',
    'boundary',
    'invalid',
  ]);
  return track.map((sample, index) => {
    const analysis = classifications[index];
    if (!object(analysis) || analysis.index !== index || !supported.has(analysis.kind)) {
      throw new ResearchError('EXPERIMENT_OUTPUT', 'Malformed or out-of-order analyzer result at ' + index);
    }
    if (analysis.kind === 'invalid') {
      throw new ResearchError('EXPERIMENT_INVALID', 'Track contains an invalid observation at ' + index);
    }
    return {
      schema: 'workbridge.rift-evidence.v1',
      source: 'RPT.teleport_analyzer',
      recordIndex: index,
      sourceFileSha256: sourceSha256,
      sampleSequence: null,
      sampleTimeUtc: null,
      relativeTimeSeconds: finite(sample.time),
      unit: typeof sample.unit === 'string' ? sample.unit : null,
      zone: typeof sample.zone === 'string' ? sample.zone : null,
      position: [sample.x, sample.y, sample.z].every((value) => finite(value) !== null)
        ? { x: sample.x, y: sample.y, z: sample.z }
        : null,
      classification: analysis.kind,
      reason: typeof analysis.reason === 'string' ? analysis.reason : null,
      sourceMode: 'offline_replay',
      binding: 'unverified_offline',
      noTeleportProof: true,
    };
  });
}
