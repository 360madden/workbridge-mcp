import { randomUUID, createHash } from 'node:crypto';
import { appendFile, lstat, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { readPlanFile } from './plan-file.mjs';
import { researchProvider } from './providers.mjs';
import { readRecoveryCheckpoint, RecoveryError } from './recovery.mjs';
import { verifyResearchRun } from './run.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const SHA = /^[a-f0-9]{64}$/;
const MAX_RECORD = 1024 * 1024;

function refuse(code, message, directory) {
  throw new RecoveryError(code, message, directory);
}
function asBytes(value) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8');
  if (bytes.length < 2 || bytes.length > MAX_RECORD)
    refuse('RECOVERY_RESULT_BOUNDS', 'Resumed result is too large.');
  return bytes;
}

async function checkedSource(path) {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > MAX_RECORD) {
    refuse('RECOVERY_FILE_INVALID', 'Run artifact is invalid: ' + path);
  }
  const bytes = await readFile(path);
  const after = await lstat(path);
  if (
    bytes.length !== before.size ||
    after.size !== before.size ||
    before.mtimeMs !== after.mtimeMs ||
    before.ctimeMs !== after.ctimeMs ||
    before.ino !== after.ino ||
    before.dev !== after.dev
  ) {
    refuse('RECOVERY_FILE_CHANGED', 'Run artifact changed while being inspected: ' + path);
  }
  return { bytes, sha256: hash(bytes) };
}

const artifactNames = (steps, recovery) => [
  'input.plan.json',
  'run-ledger.jsonl',
  'run-manifest.json',
  ...(recovery ? ['recovery-claim.json'] : []),
  ...steps.flatMap((step) => [
    'steps/' + step.id + '/result.json',
    ...(step.childKind ? ['steps/' + step.id + '/bundle/SHA256SUMS.txt'] : []),
  ]),
];

/**
 * Exactly one explicit guarded continuation of an earlier clean checkpoint.
 * No started/uncertain/failed action can be repeated. A unique claim is
 * created before execution and never deleted, even if recovery later fails.
 */
export async function resumeResearch({
  directory,
  planFile,
  expectedAttemptId,
  expectedLedgerSha256,
  host = hostname(),
  registry,
  actions,
  verifiers,
  preflight,
  ownerAlive,
  now = () => new Date().toISOString(),
} = {}) {
  if (
    !directory ||
    !planFile ||
    !expectedAttemptId ||
    !expectedLedgerSha256 ||
    !SHA.test(expectedLedgerSha256)
  ) {
    refuse(
      'RECOVERY_ARGUMENTS',
      'Resume requires --bundle, --plan, --expect-attempt, --expect-ledger (64-hex SHA).',
      directory,
    );
  }
  const dir = resolve(directory);
  const checkpoint = await readRecoveryCheckpoint({
    directory: dir,
    host,
    registry,
    verifiers,
    preflight,
    ...(ownerAlive ? { ownerAlive } : {}),
  });
  if (!actions || !verifiers || !preflight) {
    const provider = researchProvider(checkpoint.plan.profile);
    actions ??= provider.actions;
    verifiers ??= provider.verifiers;
    preflight ??= provider.preflight;
  }
  if (
    checkpoint.originalAttemptId !== expectedAttemptId ||
    checkpoint.ledgerSha256 !== expectedLedgerSha256
  ) {
    refuse(
      'RECOVERY_CHECKPOINT_CHANGED',
      'Explicit attempt/ledger identity no longer matches the original checkpoint.',
      dir,
    );
  }
  if (!checkpoint.eligibleForGuardedResume) {
    refuse(
      'RECOVERY_NOT_ELIGIBLE',
      'The previous owner is active, the source changed, or a step outcome is not fully verified.',
      dir,
    );
  }
  const source = await readPlanFile(planFile);
  if (source.sha256 !== checkpoint.planSha256) {
    refuse('RECOVERY_PLAN_CHANGED', 'Original plan bytes no longer match the saved checkpoint.', dir);
  }
  const originalSources = await preflight(checkpoint.plan, host);
  if (hash(Buffer.from(JSON.stringify(originalSources))) !== checkpoint.sourceSnapshotSha256) {
    refuse('RECOVERY_INPUT_CHANGED', 'Saved source hashes differ from the original start event.', dir);
  }

  const recoveryId = randomUUID();
  const claim = {
    schema: 'workbridge.research-recovery-claim.v1',
    originalAttemptId: expectedAttemptId,
    recoveryAttemptId: recoveryId,
    checkpointLedgerSha256: expectedLedgerSha256,
    completedPrefixCount: checkpoint.completedSteps.length,
    planSha256: source.sha256,
    sourceSnapshotSha256: checkpoint.sourceSnapshotSha256,
    claimedUtc: now(),
    resumingOwnerPid: process.pid,
    oldOwnerWasNotRunning: true,
    replayCompletedSteps: false,
    uncertainOutcomeRetryAuthorized: false,
  };
  try {
    await writeFile(join(dir, 'recovery-claim.json'), asBytes(claim), { flag: 'wx' });
  } catch (error) {
    if (error?.code === 'EEXIST') {
      refuse(
        'RECOVERY_ALREADY_CLAIMED',
        'The run has a pre-existing recovery claim; no automatic retry.',
        dir,
      );
    }
    throw error;
  }

  let seq = checkpoint.ledgerSequence;
  const ledgerPath = join(dir, 'run-ledger.jsonl');
  const recorded = [...checkpoint.completedSteps];
  const outcomes = new Map(checkpoint.outcomes);
  let createdMarker = false;
  async function event(type, details = {}) {
    await appendFile(
      ledgerPath,
      JSON.stringify({
        sequence: ++seq,
        observedUtc: now(),
        event: type,
        attemptId: recoveryId,
        ...details,
      }) + '\n',
      'utf8',
    );
  }

  try {
    for (const step of checkpoint.plan.orderedSteps.slice(recorded.length)) {
      const execute = actions[step.action];
      if (typeof execute !== 'function') {
        refuse('ADAPTER_UNAVAILABLE', 'Registered adapter is no longer available for step ' + step.id, dir);
      }
      const stepDirectory = join(dir, 'steps', step.id);
      await mkdir(stepDirectory);
      await event('step_started', { stepId: step.id, action: step.action, needs: step.needs });
      let observed;
      try {
        observed = await execute({
          plan: checkpoint.plan,
          host,
          stepDirectory,
          outcomes,
          step,
        });
        if (!observed || typeof observed !== 'object' || !observed.result) {
          refuse('ADAPTER_RESULT_INVALID', 'Resumed adapter returned no bounded result.', dir);
        }
        const expectedChild = Boolean(verifiers[step.action]);
        if (Boolean(observed.childBundle) !== expectedChild) {
          refuse('ADAPTER_BUNDLE_MISMATCH', 'Resumed child-bundle declaration is inconsistent.', dir);
        }
        let child = null;
        if (observed.childBundle) {
          const expectedPath = join(stepDirectory, 'bundle').toLowerCase();
          if (
            observed.childBundle.kind !== step.action ||
            observed.childBundle.directory?.toLowerCase() !== expectedPath
          ) {
            refuse(
              'ADAPTER_BUNDLE_MISMATCH',
              'Resumed child package is not owned by its declared step.',
              dir,
            );
          }
          const verified = await verifiers[step.action](observed.childBundle.directory);
          if (verified?.verified !== true)
            refuse('ADAPTER_BUNDLE_INVALID', 'Resumed child package did not verify.', dir);
          child = { kind: step.action, directory: 'steps/' + step.id + '/bundle', verified: true };
        }
        const record = {
          schema: 'workbridge.research-step.v1',
          stepId: step.id,
          action: step.action,
          status: 'completed',
          result: observed.result,
          childBundle: child,
          completedUtc: now(),
          gameContacted: false,
          arbitraryCommandsExecuted: false,
        };
        const bytes = asBytes(record);
        await writeFile(join(stepDirectory, 'result.json'), bytes, { flag: 'wx' });
        recorded.push({
          id: step.id,
          action: step.action,
          completedUtc: record.completedUtc,
          resultSha256: hash(bytes),
          childKind: child?.kind ?? null,
        });
        outcomes.set(step.action, observed);
        await event('step_completed', { stepId: step.id, resultSha256: hash(bytes) });
      } catch (error) {
        await event('step_failed', { stepId: step.id, code: String(error.code ?? 'STEP_ERROR') });
        throw error;
      }
    }
    const latestPlan = await readPlanFile(source.path);
    if (latestPlan.sha256 !== source.sha256)
      refuse('RECOVERY_PLAN_CHANGED', 'Original plan changed during recovery.', dir);
    const finalSources = await preflight(checkpoint.plan, host);
    if (hash(Buffer.from(JSON.stringify(finalSources))) !== checkpoint.sourceSnapshotSha256) {
      refuse('RECOVERY_INPUT_CHANGED', 'Input evidence changed during recovery.', dir);
    }
    await event('run_completed', { stepCount: recorded.length });
    const manifest = {
      schema: 'workbridge.research-run.v1',
      status: 'completed',
      planId: checkpoint.plan.planId,
      planSha256: source.sha256,
      executedHost: String(host).toUpperCase(),
      profile: checkpoint.plan.profile,
      executionMode: checkpoint.plan.executionMode,
      sources: originalSources,
      steps: recorded,
      recovery: {
        originalAttemptId: expectedAttemptId,
        recoveryAttemptId: recoveryId,
        checkpointLedgerSha256: expectedLedgerSha256,
        completedPrefixCount: claim.completedPrefixCount,
      },
      artifacts: artifactNames(recorded, true),
      closedUtc: now(),
      gameContacted: false,
      liveProcessCurrentVerified: false,
      gameMemoryRead: false,
      inputSent: false,
      teleportVerified: false,
      workbridgeOwnerChanged: false,
    };
    await writeFile(join(dir, 'run-manifest.json'), asBytes(manifest), { flag: 'wx' });
    const inventory = [];
    for (const name of manifest.artifacts) {
      const saved = await checkedSource(join(dir, name));
      inventory.push(saved.sha256 + '  ' + name);
    }
    await writeFile(join(dir, 'SHA256SUMS.txt'), inventory.join('\n') + '\n', { flag: 'wx' });
    createdMarker = true;
    const verified = await verifyResearchRun(dir, { registry, verifiers });
    return {
      status: 'completed_after_guarded_resume',
      directory: dir,
      planId: checkpoint.plan.planId,
      originalAttemptId: expectedAttemptId,
      recoveryAttemptId: recoveryId,
      preservedPrefixSteps: claim.completedPrefixCount,
      executedRemainingSteps: recorded.length - claim.completedPrefixCount,
      completionVerified: verified.verified,
      sourceSnapshotBound: verified.sourceSnapshotBound,
      completedStepsReexecuted: false,
      teleportVerified: false,
      gameContacted: false,
    };
  } catch (error) {
    if (createdMarker) {
      try {
        await unlink(join(dir, 'SHA256SUMS.txt'));
      } catch {
        /* Retain invalid artifact for review; no successful verification. */
      }
    }
    const code = String(error.code ?? 'RECOVERY_FAILED');
    try {
      await event('run_failed', { code });
      await writeFile(
        join(dir, 'run-failed.json'),
        asBytes({
          schema: 'workbridge.research-run-failure.v1',
          status: 'failed',
          planId: checkpoint.plan.planId,
          failedUtc: now(),
          code,
          completedSteps: recorded.map((step) => step.id),
          recoveryAttemptId: recoveryId,
          successMarkerCreated: false,
          requiresExplicitReviewBeforeRetry: true,
        }),
        { flag: 'wx' },
      );
    } catch {
      /* No automatic retry or overwriting an uncertain previous artifact. */
    }
    throw new RecoveryError(code, 'Guarded resume failed: ' + error.message, dir);
  }
}
