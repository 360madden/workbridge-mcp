import { join } from 'node:path';
import { inspectOfflineClient, readEvidence, ResearchError } from '../../../rift/src/identity.mjs';
import { verifyPhysicalReceipt } from '../../../rift/src/physical-receipt.mjs';
import { doctor, session, verifyBundle } from '../../../rift/src/bundle.mjs';
import { comparePatch, verifyPatch } from '../../../rift/src/patch-drift.mjs';
import { auditArchivedCompatibility } from '../../../rift/src/compatibility.mjs';

/** Snapshot input identity, with actual source SHA checks, before any run folder is created. */
export async function preflightRiftSources(plan, host) {
  const snapshots = {};
  for (const [name, input] of Object.entries(plan.inputs)) {
    if (name === 'client' || name === 'afterClient') {
      const image = await inspectOfflineClient(input.path, plan.expectedHost, input.sha256, host);
      snapshots[name] = { path: image.path, sha256: image.sha256, bytes: image.bytes, kind: 'archived_pe' };
    } else if (name === 'physicalReceipt') {
      const receipt = await verifyPhysicalReceipt(input.path);
      const source = await readEvidence(join(input.path, 'physical-epoch.json'), 16 * 1024);
      snapshots[name] = {
        path: input.path,
        sha256: source.sha256,
        bytes: source.size,
        kind: 'historical_identity_bundle',
        receiptVerified: receipt.verified,
        currentlyRunningVerified: false,
      };
    } else {
      const source = await readEvidence(input.path, name === 'anchors' ? 128 * 1024 : 4 * 1024 * 1024);
      if (input.sha256 && input.sha256 !== source.sha256) {
        throw new ResearchError(
          'INPUT_HASH_MISMATCH',
          'Pinned saved input differs from the selected source: ' + name,
        );
      }
      snapshots[name] = { path: source.path, sha256: source.sha256, bytes: source.size, kind: 'saved_file' };
    }
  }
  const selected = plan.orderedSteps.some((step) => step.action === 'rift.patch-compare');
  if (selected && snapshots.client.path.toLowerCase() === snapshots.afterClient.path.toLowerCase()) {
    throw new ResearchError('PATCH_SAME_IMAGE', 'Patch comparison requires distinct executable paths.');
  }
  return snapshots;
}

export const RIFT_ACTIONS = Object.freeze({
  'rift.doctor': async ({ plan, host }) => {
    const client = plan.inputs.client;
    return {
      result: await doctor({
        clientFile: client.path,
        expectedHost: plan.expectedHost,
        expectedSha256: client.sha256,
        host,
      }),
      childBundle: null,
    };
  },

  'rift.saved-session': async ({ plan, host, stepDirectory }) => {
    const input = plan.inputs;
    const directory = join(stepDirectory, 'bundle');
    const result = await session({
      clientFile: input.client.path,
      expectedHost: plan.expectedHost,
      expectedSha256: input.client.sha256,
      telemetryFile: input.telemetry.path,
      trackFile: input.track.path,
      rr2File: input.rr2?.path ?? null,
      rreFile: input.rre?.path ?? null,
      rreBindingFile: input.rreBinding?.path ?? null,
      outputDir: directory,
      host,
    });
    return {
      result,
      childBundle: { kind: 'rift.saved-session', directory },
    };
  },

  'rift.patch-compare': async ({ plan, host, stepDirectory }) => {
    const input = plan.inputs;
    const directory = join(stepDirectory, 'bundle');
    const result = await comparePatch({
      beforeFile: input.client.path,
      afterFile: input.afterClient.path,
      outputDir: directory,
      expectedHost: plan.expectedHost,
      expectedBeforeSha256: input.client.sha256,
      expectedAfterSha256: input.afterClient.sha256,
      anchorsFile: input.anchors?.path ?? null,
      host,
    });
    return {
      result,
      childBundle: { kind: 'rift.patch-compare', directory },
    };
  },

  'rift.compat-audit': async ({ plan, outcomes }) => {
    const sessionResult = outcomes.get('rift.saved-session');
    const patchResult = outcomes.get('rift.patch-compare') ?? null;
    return {
      result: await auditArchivedCompatibility({
        physicalBundleDir: plan.inputs.physicalReceipt.path,
        researchBundleDir: sessionResult.childBundle.directory,
        patchBundleDir: patchResult?.childBundle.directory ?? null,
      }),
      childBundle: null,
    };
  },
});

export const RIFT_BUNDLE_VERIFIERS = Object.freeze({
  'rift.saved-session': verifyBundle,
  'rift.patch-compare': verifyPatch,
});
