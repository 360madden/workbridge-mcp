import { join } from 'node:path';
import { readEvidence, ResearchError } from './identity.mjs';
import { parseRecords } from './records.mjs';
import { verifyBundle } from './bundle.mjs';
import { verifyPhysicalReceipt } from './physical-receipt.mjs';
import { verifyPatch } from './patch-drift.mjs';

async function readJson(file, size = 1024 * 1024) {
  const content = await readEvidence(file, size);
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(content.bytes));
  } catch {
    throw new ResearchError('AUDIT_SOURCE_INVALID', 'Saved research source is not valid JSON: ' + file);
  }
}

function exactSameEpoch(item, physical) {
  return (
    item?.processEpoch?.processId === physical.pid &&
    item.processEpoch.processStartUtcTicks === physical.processStartUtcTicks &&
    item.processEpoch.executableSha256?.toLowerCase() === physical.executableSha256.toLowerCase()
  );
}

function sourceVerdict(entry, physicalSha, physical) {
  if (!entry)
    return {
      present: false,
      verdict: 'no_archived_source',
      currentGameTelemetryQualified: false,
    };
  if (!entry.sourceBuildSha256)
    return {
      present: true,
      verdict: 'unknown_build_unqualified',
      currentGameTelemetryQualified: false,
    };
  if (entry.sourceBuildSha256.toLowerCase() !== physicalSha.toLowerCase())
    return {
      present: true,
      verdict: 'different_executable_build',
      sourceBuildSha256: entry.sourceBuildSha256,
      currentGameTelemetryQualified: false,
    };
  return {
    present: true,
    verdict: exactSameEpoch(entry, physical)
      ? 'matching_declared_process_fields_host_and_freshness_unverified'
      : 'different_declared_process_epoch',
    sourceBuildSha256: entry.sourceBuildSha256,
    currentGameTelemetryQualified: false,
  };
}

function locateOnly(rows, name, expectedHash = null) {
  const matches = rows.filter((record) => record?.source === name);
  if (matches.length > 1)
    throw new ResearchError('AUDIT_SOURCE_AMBIGUOUS', 'Multiple archive records of type ' + name);
  const item = matches[0] ?? null;
  if (item && expectedHash && item.sourceFileSha256 !== expectedHash) {
    throw new ResearchError(
      'AUDIT_SOURCE_HASH',
      name + ' record points to unexpected archived source bytes.',
    );
  }
  return item;
}

/**
 * Static compatibility audit of previously *saved* artifacts only.
 * Verifying a saved PID/window receipt does not re-open the process or prove it
 * still exists. No archive is elevated to live or current telemetry.
 */
export async function auditArchivedCompatibility({
  physicalBundleDir,
  researchBundleDir,
  patchBundleDir = null,
} = {}) {
  if (!physicalBundleDir || !researchBundleDir) {
    throw new ResearchError(
      'MISSING_ARGUMENT',
      'Compatibility audit requires physical and research bundle directories.',
    );
  }
  const [physicalCheck, researchCheck, patchCheck] = await Promise.all([
    verifyPhysicalReceipt(physicalBundleDir),
    verifyBundle(researchBundleDir),
    patchBundleDir ? verifyPatch(patchBundleDir) : Promise.resolve(null),
  ]);
  const [physicalFile, manifest, evidenceFile, patchReport] = await Promise.all([
    readJson(join(physicalCheck.directory, 'physical-epoch.json'), 16 * 1024),
    readJson(join(researchCheck.directory, 'manifest.json'), 1024 * 1024),
    readEvidence(join(researchCheck.directory, 'evidence.jsonl'), 4 * 1024 * 1024),
    patchCheck
      ? readJson(join(patchCheck.directory, 'report.json'), 12 * 1024 * 1024)
      : Promise.resolve(null),
  ]);
  const physical = physicalFile.selected;
  const records = parseRecords(evidenceFile.bytes, 'normalized saved research evidence');
  const rr2 = locateOnly(records, 'RiftReader2.native-current-facing', manifest.inputs?.rr2?.sha256);
  const rre = locateOnly(records, 'RRECollector.saved-publication', manifest.inputs?.rre?.sha256);
  const telemetry = records.filter((record) => record?.source === 'Telemetry');
  if ((rr2 && !manifest.inputs?.rr2) || (rre && !manifest.inputs?.rre)) {
    throw new ResearchError(
      'AUDIT_SOURCE_MANIFEST',
      'Normalized archive source is absent from the verified manifest.',
    );
  }
  if (
    patchReport &&
    (patchReport.status !== patchCheck.status ||
      patchReport.nativeOffsetsQualified !== false ||
      patchReport.requiresRuntimeRequalification !== true)
  ) {
    throw new ResearchError(
      'AUDIT_PATCH_SCOPE',
      'Patch evidence contradicts its verified qualification boundary.',
    );
  }
  const physicalSha = physical.executableSha256.toLowerCase();
  const rr2Status = sourceVerdict(rr2, physicalSha, physical);
  const rreStatus = sourceVerdict(rre, physicalSha, physical);
  return {
    schema: 'workbridge.rift-research-compatibility.v1',
    mode: 'saved_artifacts_only_no_live_refresh',
    physicalEpoch: {
      observedAtUtc: physicalFile.sampledUtc,
      machine: physicalFile.machine,
      pid: physical.pid,
      processStartUtcTicks: physical.processStartUtcTicks,
      executableSha256: physicalSha,
      receiptIntegrityVerified: physicalCheck.verified,
      currentlyRunningVerifiedByAudit: false,
    },
    archives: {
      researchBundleIntegrityVerified: researchCheck.verified,
      originalClientMatchesObservedImage: manifest.client?.sha256 === physicalSha,
      rr2: rr2Status,
      rre: rreStatus,
      telemetry: {
        count: telemetry.length,
        simulatedCount: telemetry.filter((x) => x.sourceMode === 'simulated').length,
        verifiedCurrentSamples: 0,
      },
    },
    patch: patchReport
      ? {
          present: true,
          integrityVerified: patchCheck.verified,
          status: patchReport.status,
          observedImageRelation:
            patchReport.after?.sha256 === physicalSha
              ? 'matches_after_image'
              : patchReport.before?.sha256 === physicalSha
                ? 'matches_before_image'
                : 'not_one_of_compared_images',
          changedHistoricalRvaAnchors: patchReport.anchors.filter(
            (x) => x.status === 'bytes_different_at_same_rva',
          ).length,
          originalRvaFunctionIdentityQualified: false,
          nativeOffsetsQualified: false,
        }
      : { present: false, nativeOffsetsQualified: false },
    conclusion: 'historical_evidence_needs_build_epoch_and_freshness_requalification',
    liveTelemetryAuthenticated: false,
    independentTeleportVerified: false,
    memoryOffsetsQualified: false,
  };
}
