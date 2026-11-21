import { ResearchError, SHA256 } from './identity.mjs';

const RR2_CONTRACT = 'native-current-facing-candidate-samples/1';
const RRE_BINDING = 'rre-lab2-publication-binding/1';
const SESSION = /^[0-9a-f]{32}$/;
const TICKS = /^[0-9]{1,22}$/;

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function validInt(value, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}
function sha(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new ResearchError('ARCHIVE_IDENTITY', label + ' is missing a full SHA-256.');
  }
  return value.toLowerCase();
}
function utc(value, label) {
  if (typeof value !== 'string' || value.length > 80 || !/(Z|[+-]\d\d:\d\d)$/i.test(value)) {
    throw new ResearchError('ARCHIVE_TIMESTAMP', label + ' is not offset-aware.');
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new ResearchError('ARCHIVE_TIMESTAMP', label + ' is invalid.');
  return new Date(ms).toISOString();
}
function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function coordinates(source, names) {
  if (!object(source)) return null;
  const [a, b, c] = names.map((key) => numberOrNull(source[key]));
  return [a, b, c].every((value) => value !== null) ? { x: a, y: b, z: c } : null;
}
function processEpoch(source, label) {
  if (!object(source)) throw new ResearchError('ARCHIVE_IDENTITY', label + ' has no process identity.');
  if (!validInt(source.processId, 1, 2147483647)) {
    throw new ResearchError('ARCHIVE_IDENTITY', label + ' has an invalid process ID.');
  }
  let ticks = source.processStartUtcTicks;
  if (typeof ticks === 'number' && Number.isSafeInteger(ticks)) ticks = String(ticks);
  if (typeof ticks !== 'string' || !TICKS.test(ticks) || BigInt(ticks) === 0n) {
    throw new ResearchError('ARCHIVE_TICKS', label + ' does not preserve exact process-start ticks.');
  }
  return {
    processId: source.processId,
    processStartUtcTicks: BigInt(ticks).toString(),
    executableSha256: sha(source.executableSha256, label + ' executable'),
  };
}
function compareEpochPair(a, b) {
  const keys = ['processId', 'processStartUtcTicks', 'executableSha256'];
  return keys.every((key) => a[key] === b[key]);
}
function decodeJson(source, label, exactTicks = false) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(source.bytes);
  } catch {
    throw new ResearchError('ARCHIVE_ENCODING', label + ' is not valid UTF-8.');
  }
  try {
    const parsed = JSON.parse(text, (key, value, context) => {
      if (exactTicks && key === 'processStartUtcTicks' && typeof value === 'number') {
        if (typeof context?.source !== 'string' || !TICKS.test(context.source)) {
          throw new ResearchError('ARCHIVE_TICKS', 'Cannot recover exact numeric process-start ticks.');
        }
        return context.source;
      }
      return value;
    });
    if (!object(parsed)) throw new ResearchError('ARCHIVE_FORMAT', label + ' must be a JSON object.');
    return parsed;
  } catch (error) {
    if (error instanceof ResearchError) throw error;
    throw new ResearchError('ARCHIVE_FORMAT', label + ' is not valid JSON: ' + error.message);
  }
}

export function normalizeRR2(source, clientSha256) {
  const report = decodeJson(source, 'RR2 native candidate', true);
  if (
    report.schemaVersion !== 1 ||
    report.contractVersion !== RR2_CONTRACT ||
    report.status !== 'complete' ||
    !validInt(report.requestedSamples, 1, 4096) ||
    report.completedSamples !== report.requestedSamples ||
    !object(report.observation)
  ) {
    throw new ResearchError('RR2_CONTRACT', 'Unsupported or incomplete RR2 native candidate report.');
  }
  const epoch = processEpoch(report.identity, 'RR2 report');
  const sampleEpoch = processEpoch(report.observation.identity, 'RR2 observation');
  if (!compareEpochPair(epoch, sampleEpoch)) {
    throw new ResearchError('RR2_EPOCH_MISMATCH', 'RR2 report and observation describe different processes.');
  }
  const start = utc(report.observation.startedAtUtc, 'RR2 startedAtUtc');
  const end = utc(report.observation.completedAtUtc, 'RR2 completedAtUtc');
  if (end < start) throw new ResearchError('RR2_TIME_ORDER', 'RR2 observation ends before it starts.');
  return {
    schema: 'workbridge.rift-evidence.v1',
    source: 'RiftReader2.native-current-facing',
    sourceFileSha256: source.sha256,
    sourceMode: 'historical_saved',
    sampleTimeUtc: end,
    sourceContract: RR2_CONTRACT,
    processEpoch: epoch,
    processBinding: 'internal_archive_consistency_only',
    sourceBuildSha256: epoch.executableSha256,
    buildMatch: epoch.executableSha256 === clientSha256,
    sampleCount: report.completedSamples,
    positionCandidate: coordinates(report.observation.positionCandidate, ['x', 'y', 'z']),
    bearingDegreesCandidate: numberOrNull(report.observation.playerSystemBearingDegreesCandidate),
    headingQualified: report.observation.headingQualified === true,
    noTeleportProof: true,
    freshnessVerified: false,
  };
}

export function normalizeRRE(publicationSource, bindingSource, clientSha256) {
  const report = decodeJson(publicationSource, 'RRE publication');
  const binding = decodeJson(bindingSource, 'RRE binding');
  const wire = report.memoryPublication;
  if (
    !object(wire) ||
    wire.status !== 'complete' ||
    !validInt(report.sequence, 1, Number.MAX_SAFE_INTEGER) ||
    report.captureSequence !== report.sequence ||
    report.addonVersion !== report.captureVersion ||
    typeof report.addonVersion !== 'string' ||
    report.addonVersion !== wire.addonVersion ||
    report.sequence !== wire.sequence ||
    !SESSION.test(wire.session) ||
    !validInt(wire.parts, 1, 16) ||
    !validInt(wire.payloadBytes, 1, 65536) ||
    !validInt(wire.abilities, 1, 512) ||
    !/^[0-9a-f]{8}$/.test(wire.adler32)
  ) {
    throw new ResearchError('RRE_CONTRACT', 'RRE publication lacks coherent complete-generation metadata.');
  }
  if (
    binding.schemaVersion !== 1 ||
    binding.evidenceKind !== RRE_BINDING ||
    binding.session !== wire.session ||
    binding.sequence !== wire.sequence ||
    binding.addonVersion !== wire.addonVersion ||
    binding.parts !== wire.parts ||
    binding.payloadBytes !== wire.payloadBytes
  ) {
    throw new ResearchError('RRE_BINDING_MISMATCH', 'RRE generation and historical binding do not agree.');
  }
  const epoch = processEpoch(binding, 'RRE binding');
  return {
    schema: 'workbridge.rift-evidence.v1',
    source: 'RRECollector.saved-publication',
    sourceFileSha256: publicationSource.sha256,
    bindingFileSha256: bindingSource.sha256,
    sourceMode: 'historical_saved',
    sourceContract: 'rre-publication-receipt-with-binding/1',
    sampleTimeUtc: utc(binding.observedAtUtc, 'RRE binding observedAtUtc'),
    timeMeaning: 'host_binding_receipt_not_game_capture_time',
    publicationSession: wire.session,
    publicationSequence: wire.sequence,
    addonVersion: wire.addonVersion,
    abilityCountDeclared: wire.abilities,
    partCountDeclared: wire.parts,
    payloadBytesDeclared: wire.payloadBytes,
    processEpoch: epoch,
    processBinding: 'declared_archived_binding_not_runtime_authenticated',
    sourceBuildSha256: epoch.executableSha256,
    buildMatch: epoch.executableSha256 === clientSha256,
    playerId: typeof report.player?.id === 'string' ? report.player.id : null,
    playerPositionReported: coordinates(report.player, ['coordX', 'coordY', 'coordZ']),
    playerHealthReported: numberOrNull(report.player?.health),
    noTeleportProof: true,
    freshnessVerified: false,
    wirePayloadDecodedByThisTool: false,
  };
}

export function compareArchivedEpochs(rr2, rre) {
  if (!rr2 || !rre) {
    return {
      verdict: 'not_comparable',
      reason: 'both_archived_sources_required',
      liveFreshnessVerified: false,
    };
  }
  const a = rr2.processEpoch;
  const b = rre.processEpoch;
  return {
    verdict: compareEpochPair(a, b)
      ? 'matching_declared_process_fields_host_unverified'
      : 'different_declared_epoch',
    reason: 'exact_saved_pid_start_ticks_and_executable_hash',
    rr2BuildMatchesSelectedClient: rr2.buildMatch,
    rreBuildMatchesSelectedClient: rre.buildMatch,
    liveFreshnessVerified: false,
    crossSourceCausalityVerified: false,
  };
}
