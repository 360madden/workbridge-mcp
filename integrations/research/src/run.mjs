import { createHash, randomUUID } from 'node:crypto';
import { appendFile, lstat, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { PlanError, validatePlan } from './plan.mjs';
import { readPlanFile } from './plan-file.mjs';
import { researchProvider } from './providers.mjs';

const MAX_RESULT_BYTES = 1024 * 1024;
const MAX_LEDGER_BYTES = 256 * 1024;
const SHA = /^[0-9a-f]{64}$/;

export class RunError extends PlanError {
  constructor(code, message, directory = null) {
    super(code, message);
    this.name = 'RunError';
    this.directory = directory;
  }
}

function sum(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function file(fullPath, maxBytes = MAX_RESULT_BYTES) {
  const before = await lstat(fullPath);
  if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > maxBytes) {
    throw new RunError('RUN_ARTIFACT_INVALID', 'Missing or unbounded run artifact: ' + fullPath);
  }
  const bytes = await readFile(fullPath);
  const after = await lstat(fullPath);
  if (
    !after.isFile() ||
    after.isSymbolicLink() ||
    bytes.length !== before.size ||
    after.size !== before.size ||
    after.mtimeMs !== before.mtimeMs ||
    after.ctimeMs !== before.ctimeMs ||
    after.ino !== before.ino ||
    after.dev !== before.dev
  ) {
    throw new RunError('RUN_ARTIFACT_CHANGED', 'Run artifact changed while being inspected: ' + fullPath);
  }
  return { bytes, sha256: sum(bytes) };
}

function json(bytes, label) {
  try {
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object');
    return parsed;
  } catch {
    throw new RunError('RUN_JSON_INVALID', label + ' is not a JSON object.');
  }
}

function encode(value) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8');
  if (bytes.length < 2 || bytes.length > MAX_RESULT_BYTES) {
    throw new RunError('RESULT_TOO_LARGE', 'Research result exceeded the 1 MiB limit.');
  }
  return bytes;
}

function artifactNames(steps, recovered = false) {
  const names = ['input.plan.json', 'run-ledger.jsonl', 'run-manifest.json'];
  if (recovered) names.push('recovery-claim.json');
  for (const step of steps) {
    names.push('steps/' + step.id + '/result.json');
    if (step.childKind) names.push('steps/' + step.id + '/bundle/SHA256SUMS.txt');
  }
  return names;
}

function snapshotEqual(a, b) {
  const names = Object.keys(a);
  return (
    names.length === Object.keys(b).length &&
    names.every(
      (key) =>
        b[key]?.sha256 === a[key]?.sha256 &&
        b[key]?.bytes === a[key]?.bytes &&
        b[key]?.path?.toLowerCase() === a[key]?.path?.toLowerCase(),
    )
  );
}

/**
 * One strictly ordered, bounded, offline run using named, reviewed adapter
 * functions. The standalone coordinator is not a second Workbridge service.
 * Failure preserves previous artifacts; M3 adds restart-survivable recovery.
 */
export async function runResearch({
  planFile,
  outputDir,
  host = hostname(),
  registry,
  actions,
  verifiers,
  preflight,
  now = () => new Date().toISOString(),
  onStepCommitted = null,
} = {}) {
  if (!planFile || !outputDir)
    throw new RunError('RUN_ARGUMENTS', 'Run requires a plan and new output directory.');
  const source = await readPlanFile(planFile);
  const plan = validatePlan(source.plan, { host, ...(registry ? { registry } : {}) });
  // Injected trusted adapters remain supported for isolated regression fixtures.
  // Ordinary CLI calls select only built-in, reviewed profile implementations.
  if (!actions || !verifiers || !preflight) {
    const provider = researchProvider(plan.profile);
    actions ??= provider.actions;
    verifiers ??= provider.verifiers;
    preflight ??= provider.preflight;
  }
  const originalSources = await preflight(plan, host);
  const directory = resolve(outputDir);
  let sequence = 0;
  const recorded = [];
  const outcomes = new Map();
  const ledgerPath = join(directory, 'run-ledger.jsonl');
  let completionMarkerCreated = false;
  const attemptId = randomUUID();

  async function ledger(type, details = {}) {
    await appendFile(
      ledgerPath,
      JSON.stringify({
        sequence: ++sequence,
        observedUtc: now(),
        event: type,
        ...details,
      }) + '\n',
      'utf8',
    );
  }

  try {
    await mkdir(directory, { recursive: false });
  } catch (error) {
    if (error?.code === 'EEXIST')
      throw new RunError('OUTPUT_EXISTS', 'Research-run directory already exists.');
    throw error;
  }
  try {
    await writeFile(join(directory, 'input.plan.json'), source.bytes, { flag: 'wx' });
    await writeFile(ledgerPath, '', { flag: 'wx' });
    await mkdir(join(directory, 'steps'));
    await ledger('run_started', {
      planId: plan.planId,
      planSha256: source.sha256,
      attemptId,
      ownerPid: process.pid,
      sourceSnapshotSha256: sum(Buffer.from(JSON.stringify(originalSources))),
    });
    for (const step of plan.orderedSteps) {
      const execute = actions[step.action];
      if (typeof execute !== 'function') {
        throw new RunError('ADAPTER_UNAVAILABLE', 'No implementation for registered action ' + step.action);
      }
      const stepDirectory = join(directory, 'steps', step.id);
      await mkdir(stepDirectory);
      await ledger('step_started', { stepId: step.id, action: step.action, needs: step.needs, attemptId });
      let observed;
      try {
        observed = await execute({ plan, host, stepDirectory, outcomes, step });
        if (!observed || typeof observed !== 'object' || !observed.result) {
          throw new RunError('ADAPTER_RESULT_INVALID', 'Adapter returned no bounded research result.');
        }
        const expectedBundle = Boolean(verifiers[step.action]);
        if (expectedBundle !== Boolean(observed.childBundle)) {
          throw new RunError(
            'ADAPTER_BUNDLE_MISMATCH',
            'Adapter child-bundle declaration disagrees with contract.',
          );
        }
        let child = null;
        if (observed.childBundle) {
          const expectedDir = join(stepDirectory, 'bundle').toLowerCase();
          if (
            observed.childBundle.directory?.toLowerCase() !== expectedDir ||
            observed.childBundle.kind !== step.action
          ) {
            throw new RunError(
              'ADAPTER_BUNDLE_MISMATCH',
              'Adapter returned a foreign child-bundle directory.',
            );
          }
          const verified = await verifiers[step.action](observed.childBundle.directory);
          if (verified?.verified !== true)
            throw new RunError('ADAPTER_BUNDLE_INVALID', 'Child evidence was not verified.');
          child = { kind: step.action, directory: 'steps/' + step.id + '/bundle', verified: true };
        }
        const stepRecord = {
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
        const bytes = encode(stepRecord);
        await writeFile(join(stepDirectory, 'result.json'), bytes, { flag: 'wx' });
        recorded.push({
          id: step.id,
          action: step.action,
          completedUtc: stepRecord.completedUtc,
          resultSha256: sum(bytes),
          childKind: child?.kind ?? null,
        });
        outcomes.set(step.action, observed);
        await ledger('step_completed', { stepId: step.id, resultSha256: sum(bytes), attemptId });
        // Injectable test checkpoint: a child process can exit here to model
        // a hard crash with a fully committed prefix and an unstarted next step.
        if (onStepCommitted) await onStepCommitted(step, recorded.length);
      } catch (error) {
        await ledger('step_failed', { stepId: step.id, code: String(error.code ?? 'STEP_ERROR'), attemptId });
        throw error;
      }
    }
    const latestSource = await readPlanFile(source.path);
    if (latestSource.sha256 !== source.sha256) {
      throw new RunError('PLAN_CHANGED', 'Source plan bytes changed while the research run executed.');
    }
    const finalSources = await preflight(plan, host);
    if (!snapshotEqual(originalSources, finalSources)) {
      throw new RunError('INPUT_CHANGED', 'Source evidence or archived executable changed during the run.');
    }
    await ledger('run_completed', { stepCount: recorded.length, attemptId });
    const manifest = {
      schema: 'workbridge.research-run.v1',
      status: 'completed',
      planId: plan.planId,
      planSha256: source.sha256,
      executedHost: String(host).toUpperCase(),
      profile: plan.profile,
      executionMode: plan.executionMode,
      sources: originalSources,
      steps: recorded,
      artifacts: artifactNames(recorded),
      closedUtc: now(),
      gameContacted: false,
      liveProcessCurrentVerified: false,
      gameMemoryRead: false,
      inputSent: false,
      teleportVerified: false,
      workbridgeOwnerChanged: false,
    };
    await writeFile(join(directory, 'run-manifest.json'), encode(manifest), { flag: 'wx' });
    const sums = [];
    for (const name of manifest.artifacts) {
      const sourceFile = await file(
        join(directory, name),
        name.endsWith('run-ledger.jsonl') ? MAX_LEDGER_BYTES : MAX_RESULT_BYTES,
      );
      sums.push(sourceFile.sha256 + '  ' + name);
    }
    // Completion marker is written last. No false completion for a failed step.
    await writeFile(join(directory, 'SHA256SUMS.txt'), sums.join('\n') + '\n', { flag: 'wx' });
    completionMarkerCreated = true;
    const verified = await verifyResearchRun(directory, { registry, verifiers });
    return {
      status: 'completed_offline_research_run',
      directory,
      planId: plan.planId,
      stepCount: recorded.length,
      actions: recorded.map((item) => item.action),
      bundleVerified: verified.verified,
      gameContacted: false,
      workbridgeOwnerChanged: false,
    };
  } catch (error) {
    if (completionMarkerCreated) {
      // Remove only the success marker this new run created, never child evidence.
      try {
        await unlink(join(directory, 'SHA256SUMS.txt'));
      } catch {
        /* Leave an invalid bundle unqualified. */
      }
    }
    const code = String(error?.code ?? 'RESEARCH_RUN_FAILED');
    try {
      await ledger('run_failed', { code, attemptId });
      await writeFile(
        join(directory, 'run-failed.json'),
        encode({
          schema: 'workbridge.research-run-failure.v1',
          planId: plan.planId,
          failedUtc: now(),
          status: 'failed',
          code,
          completedSteps: recorded.map((item) => item.id),
          successMarkerCreated: false,
          requiresExplicitReviewBeforeRetry: true,
        }),
        { flag: 'wx' },
      );
    } catch {
      // An incomplete ledger is still not a completed run.
    }
    throw new RunError(code, 'Research run did not complete: ' + error.message, directory);
  }
}

/** Verifies *saved* research packages. It never reruns steps or contacts RIFT. */
export async function verifyResearchRun(directoryInput, { registry, verifiers } = {}) {
  if (!directoryInput) throw new RunError('RUN_ARGUMENTS', 'A completed run directory is required.');
  const directory = resolve(directoryInput);
  let inventory;
  try {
    inventory = await file(join(directory, 'SHA256SUMS.txt'), 32 * 1024);
  } catch {
    throw new RunError('RUN_INCOMPLETE', 'No verified completion marker exists for this run.');
  }
  const manifestFile = await file(join(directory, 'run-manifest.json'));
  const manifest = json(manifestFile.bytes, 'run-manifest.json');
  if (
    manifest.schema !== 'workbridge.research-run.v1' ||
    manifest.status !== 'completed' ||
    manifest.gameContacted !== false ||
    manifest.liveProcessCurrentVerified !== false ||
    manifest.gameMemoryRead !== false ||
    manifest.inputSent !== false ||
    manifest.teleportVerified !== false ||
    manifest.workbridgeOwnerChanged !== false
  ) {
    throw new RunError('RUN_MANIFEST_INVALID', 'Run manifest has invalid status or unsupported live claims.');
  }
  const input = await file(join(directory, 'input.plan.json'), 32 * 1024);
  const plan = validatePlan(json(input.bytes, 'input.plan.json'), {
    host: manifest.executedHost,
    ...(registry ? { registry } : {}),
  });
  verifiers ??= researchProvider(plan.profile).verifiers;
  if (
    manifest.planId !== plan.planId ||
    manifest.planSha256 !== input.sha256 ||
    manifest.profile !== plan.profile ||
    manifest.executionMode !== plan.executionMode ||
    !Array.isArray(manifest.steps) ||
    manifest.steps.length !== plan.orderedSteps.length
  ) {
    throw new RunError('RUN_MANIFEST_INVALID', 'Saved plan and completed manifest do not agree.');
  }
  const sourceRoles = Object.keys(plan.inputs);
  if (
    !manifest.sources ||
    typeof manifest.sources !== 'object' ||
    Array.isArray(manifest.sources) ||
    Object.keys(manifest.sources).length !== sourceRoles.length
  ) {
    throw new RunError('RUN_SOURCE_MISMATCH', 'Saved source inventory differs from the declared plan.');
  }
  for (const role of sourceRoles) {
    const evidence = manifest.sources[role];
    if (
      !evidence ||
      typeof evidence.sha256 !== 'string' ||
      !SHA.test(evidence.sha256) ||
      typeof evidence.path !== 'string' ||
      evidence.path.toLowerCase() !== plan.inputs[role].path.toLowerCase() ||
      !Number.isSafeInteger(evidence.bytes) ||
      evidence.bytes <= 0 ||
      (plan.inputs[role].sha256 && evidence.sha256 !== plan.inputs[role].sha256)
    ) {
      throw new RunError(
        'RUN_SOURCE_MISMATCH',
        'Saved source identity is not consistent with the plan: ' + role,
      );
    }
  }
  const steps = [];
  for (let i = 0; i < plan.orderedSteps.length; i++) {
    const step = plan.orderedSteps[i];
    const recorded = manifest.steps[i];
    if (
      recorded?.id !== step.id ||
      recorded.action !== step.action ||
      typeof recorded.resultSha256 !== 'string' ||
      !SHA.test(recorded.resultSha256) ||
      recorded.childKind !== (verifiers[step.action] ? step.action : null)
    ) {
      throw new RunError('RUN_STEP_INVALID', 'Run step identity or child contract is inconsistent.');
    }
    const recordFile = await file(join(directory, 'steps', step.id, 'result.json'));
    const outcome = json(recordFile.bytes, step.id + '/result.json');
    if (
      recordFile.sha256 !== recorded.resultSha256 ||
      outcome.schema !== 'workbridge.research-step.v1' ||
      outcome.status !== 'completed' ||
      outcome.stepId !== step.id ||
      outcome.action !== step.action ||
      outcome.gameContacted !== false ||
      outcome.arbitraryCommandsExecuted !== false ||
      (recorded.childKind ? outcome.childBundle?.kind !== recorded.childKind : outcome.childBundle !== null)
    ) {
      throw new RunError('RUN_STEP_INVALID', 'Saved step result contradicts the completed run.');
    }
    if (recorded.childKind) {
      if (!outcome.childBundle || outcome.childBundle.directory !== 'steps/' + step.id + '/bundle') {
        throw new RunError(
          'RUN_STEP_INVALID',
          'Saved child-bundle path differs from expected step ownership.',
        );
      }
      const child = await verifiers[step.action](join(directory, 'steps', step.id, 'bundle'));
      if (child?.verified !== true)
        throw new RunError('RUN_CHILD_INVALID', 'RIFT child evidence did not verify.');
    } else if (outcome.childBundle !== null) {
      throw new RunError('RUN_STEP_INVALID', 'Unexpected bundle attached to an unbundled action.');
    }
    steps.push({ id: step.id, action: step.action, childKind: recorded.childKind });
  }
  const recovery = manifest.recovery ?? null;
  if (recovery !== null) {
    if (
      typeof recovery !== 'object' ||
      Array.isArray(recovery) ||
      typeof recovery.originalAttemptId !== 'string' ||
      typeof recovery.recoveryAttemptId !== 'string' ||
      typeof recovery.checkpointLedgerSha256 !== 'string' ||
      !SHA.test(recovery.checkpointLedgerSha256) ||
      !Number.isSafeInteger(recovery.completedPrefixCount) ||
      recovery.completedPrefixCount < 0 ||
      recovery.completedPrefixCount >= steps.length
    ) {
      throw new RunError('RUN_RECOVERY_INVALID', 'Completed run has invalid recovery metadata.');
    }
    const claim = json(
      (await file(join(directory, 'recovery-claim.json'), 16 * 1024)).bytes,
      'recovery-claim.json',
    );
    if (
      claim.schema !== 'workbridge.research-recovery-claim.v1' ||
      claim.originalAttemptId !== recovery.originalAttemptId ||
      claim.recoveryAttemptId !== recovery.recoveryAttemptId ||
      claim.checkpointLedgerSha256 !== recovery.checkpointLedgerSha256 ||
      claim.completedPrefixCount !== recovery.completedPrefixCount ||
      claim.planSha256 !== input.sha256 ||
      claim.sourceSnapshotSha256 !== sum(Buffer.from(JSON.stringify(manifest.sources))) ||
      claim.replayCompletedSteps !== false ||
      claim.uncertainOutcomeRetryAuthorized !== false ||
      claim.oldOwnerWasNotRunning !== true
    ) {
      throw new RunError('RUN_RECOVERY_INVALID', 'Recovery claim contradicts the completed run.');
    }
  }
  const expected = artifactNames(steps, recovery !== null);
  if (JSON.stringify(manifest.artifacts) !== JSON.stringify(expected)) {
    throw new RunError('RUN_INVENTORY_INVALID', 'Run manifest artifact order does not match the plan.');
  }
  const lines = inventory.bytes.toString('utf8').trim().split(/\r?\n/);
  if (lines.length !== expected.length) {
    throw new RunError('RUN_INVENTORY_INVALID', 'Run inventory contains missing or excess artifacts.');
  }
  for (let i = 0; i < expected.length; i++) {
    const match = /^([0-9a-f]{64})  ([A-Za-z0-9/._-]+)$/.exec(lines[i]);
    if (!match || match[2] !== expected[i])
      throw new RunError('RUN_INVENTORY_INVALID', 'Run inventory path/order is invalid.');
    const stored = await file(
      join(directory, expected[i]),
      expected[i] === 'run-ledger.jsonl' ? MAX_LEDGER_BYTES : MAX_RESULT_BYTES,
    );
    if (match[1] !== stored.sha256) {
      throw new RunError('RUN_HASH_MISMATCH', 'Run artifact hash mismatch: ' + expected[i]);
    }
  }
  const ledger = await file(join(directory, 'run-ledger.jsonl'), MAX_LEDGER_BYTES);
  const ledgerText = new TextDecoder('utf-8', { fatal: true }).decode(ledger.bytes);
  if (!ledgerText.endsWith('\n')) {
    throw new RunError('RUN_LEDGER_INVALID', 'Run event ledger is not newline-terminated.');
  }
  const serialized = ledgerText.slice(0, -1).split('\n');
  const events = serialized.map((line) => json(Buffer.from(line), 'ledger event'));
  if (
    events.length !== 2 * steps.length + 2 ||
    events[0].event !== 'run_started' ||
    events[0].planSha256 !== input.sha256 ||
    (events[0].sourceSnapshotSha256 !== undefined &&
      events[0].sourceSnapshotSha256 !== sum(Buffer.from(JSON.stringify(manifest.sources)))) ||
    events.at(-1).event !== 'run_completed' ||
    events.at(-1).stepCount !== steps.length ||
    events.some((event, index) => event.sequence !== index + 1)
  ) {
    throw new RunError('RUN_LEDGER_INVALID', 'Run event ledger has missing or unexpected transitions.');
  }
  const originalAttempt = events[0].attemptId;
  if (
    recovery &&
    (originalAttempt !== recovery.originalAttemptId ||
      sum(Buffer.from(serialized.slice(0, 1 + 2 * recovery.completedPrefixCount).join('\n') + '\n')) !==
        recovery.checkpointLedgerSha256)
  ) {
    throw new RunError('RUN_RECOVERY_INVALID', 'Recovery checkpoint ledger prefix changed.');
  }
  for (let i = 0; i < steps.length; i++) {
    const expectedAttempt =
      recovery && i >= recovery.completedPrefixCount ? recovery.recoveryAttemptId : originalAttempt;
    if (
      (originalAttempt !== undefined &&
        (events[2 * i + 1].attemptId !== expectedAttempt ||
          events[2 * i + 2].attemptId !== expectedAttempt)) ||
      events[2 * i + 1].event !== 'step_started' ||
      events[2 * i + 1].stepId !== steps[i].id ||
      events[2 * i + 1].action !== steps[i].action ||
      events[2 * i + 2].event !== 'step_completed' ||
      events[2 * i + 2].stepId !== steps[i].id ||
      events[2 * i + 2].resultSha256 !== manifest.steps[i].resultSha256
    ) {
      throw new RunError('RUN_LEDGER_INVALID', 'Run event order differs from the validated DAG.');
    }
  }
  if (
    originalAttempt !== undefined &&
    events.at(-1).attemptId !== (recovery ? recovery.recoveryAttemptId : originalAttempt)
  ) {
    throw new RunError('RUN_LEDGER_INVALID', 'Run terminal attempt is inconsistent.');
  }
  return {
    verified: true,
    directory,
    stepCount: steps.length,
    planId: plan.planId,
    completedActions: steps.map((step) => step.action),
    savedEvidenceOnly: true,
    sourceSnapshotBound: typeof events[0].sourceSnapshotSha256 === 'string',
    resumedWithClaimVerified: recovery !== null,
    completedPrefixReplayed: false,
    currentGameStateVerified: false,
    teleportVerified: false,
  };
}
