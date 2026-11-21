import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { readPlanFile } from './plan-file.mjs';
import { validatePlan, PlanError } from './plan.mjs';
import { RIFT_BUNDLE_VERIFIERS, preflightRiftSources } from './adapters/rift.mjs';

const SHA = /^[0-9a-f]{64}$/;
const ATTEMPT = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_LEDGER = 256 * 1024;
const MAX_RESULT = 1024 * 1024;

export class RecoveryError extends PlanError {
  constructor(code, message, directory = null) {
    super(code, message);
    this.name = 'RecoveryError';
    this.directory = directory;
  }
}

function refuse(code, message, dir = null) {
  throw new RecoveryError(code, message, dir);
}
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function boundedFile(file, maximum = MAX_RESULT) {
  let before;
  try {
    before = await lstat(file);
  } catch {
    refuse('RECOVERY_ARTIFACT_MISSING', 'Missing required research artifact: ' + file);
  }
  if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > maximum) {
    refuse('RECOVERY_ARTIFACT_INVALID', 'Research artifact is not a bounded ordinary file: ' + file);
  }
  const bytes = await readFile(file);
  const after = await lstat(file);
  if (
    !after.isFile() ||
    after.isSymbolicLink() ||
    before.size !== bytes.length ||
    before.size !== after.size ||
    before.ino !== after.ino ||
    before.dev !== after.dev ||
    before.mtimeMs !== after.mtimeMs ||
    before.ctimeMs !== after.ctimeMs
  ) {
    refuse('RECOVERY_ARTIFACT_CHANGED', 'Research artifact changed while being read: ' + file);
  }
  return { bytes, sha256: sha256(bytes) };
}

function strictObject(bytes, description) {
  let value;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    refuse('RECOVERY_JSON_INVALID', description + ' is not valid UTF-8 JSON.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    refuse('RECOVERY_JSON_INVALID', description + ' is not a JSON object.');
  }
  return value;
}

export function ownerProcessAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

export async function readRecoveryCheckpoint({
  directory,
  host = hostname(),
  registry,
  verifiers = RIFT_BUNDLE_VERIFIERS,
  preflight = preflightRiftSources,
  ownerAlive = ownerProcessAlive,
  checkSources = true,
} = {}) {
  if (!directory) refuse('RECOVERY_DIRECTORY_REQUIRED', 'Specify the exact saved research directory.');
  const dir = resolve(directory);
  const source = await readPlanFile(join(dir, 'input.plan.json'));
  const plan = validatePlan(source.plan, { host, ...(registry ? { registry } : {}) });
  const ledger = await boundedFile(join(dir, 'run-ledger.jsonl'), MAX_LEDGER);
  const lines = new TextDecoder('utf-8', { fatal: true }).decode(ledger.bytes);
  if (!lines.endsWith('\n')) {
    refuse('RECOVERY_TRUNCATED_LEDGER', 'Ledger has an unfinished final JSONL record.', dir);
  }
  const parts = lines.slice(0, -1).split('\n');
  if (parts.length < 1 || parts.length > 60 || parts.some((row) => row.trim() === '')) {
    refuse('RECOVERY_LEDGER_INVALID', 'Ledger has an unexpected record count or empty event.', dir);
  }
  const events = parts.map((row, i) => strictObject(Buffer.from(row), 'Ledger event ' + i));
  if (events.some((event, index) => event.sequence !== index + 1)) {
    refuse('RECOVERY_LEDGER_INVALID', 'Ledger sequence is discontinuous.', dir);
  }
  const start = events[0];
  if (start.event !== 'run_started' || start.planSha256 !== source.sha256 || start.planId !== plan.planId) {
    refuse('RECOVERY_START_MISMATCH', 'Ledger start does not bind the preserved plan.', dir);
  }
  const alreadyPresent = await readdir(dir);
  if (alreadyPresent.includes('recovery-claim.json')) {
    return {
      schema: 'workbridge.research-recovery-inspection.v1',
      directory: dir,
      plan,
      status: 'manual_review',
      reason: 'recovery_claim_already_exists',
      originalAttemptId: start.attemptId ?? null,
      ownerPid: start.ownerPid ?? null,
      originalOwnerAlive: null,
      ledgerSha256: ledger.sha256,
      sourceSnapshotSha256: start.sourceSnapshotSha256 ?? null,
      planSha256: source.sha256,
      sourceHashesRevalidated: null,
      completedSteps: [],
      nextStep: null,
      eligibleForGuardedResume: false,
      noActionReplayed: true,
      outcomes: new Map(),
      ledgerSequence: events.length,
      ledgerPrefixEvents: events,
    };
  }
  const startTrusted =
    typeof start.attemptId === 'string' &&
    ATTEMPT.test(start.attemptId) &&
    Number.isSafeInteger(start.ownerPid) &&
    start.ownerPid > 0 &&
    typeof start.sourceSnapshotSha256 === 'string' &&
    SHA.test(start.sourceSnapshotSha256);

  let cursor = 1;
  const completed = [];
  const outcomes = new Map();
  let unsafeStep = null;
  while (cursor < events.length) {
    const event = events[cursor];
    if (event.event !== 'step_started') break;
    const expected = plan.orderedSteps[completed.length];
    if (
      !expected ||
      event.stepId !== expected.id ||
      event.action !== expected.action ||
      JSON.stringify(event.needs) !== JSON.stringify(expected.needs)
    ) {
      refuse('RECOVERY_LEDGER_INVALID', 'A step started out of dependency order.', dir);
    }
    const finish = events[cursor + 1];
    if (
      !finish ||
      finish.event !== 'step_completed' ||
      finish.stepId !== expected.id ||
      typeof finish.resultSha256 !== 'string' ||
      !SHA.test(finish.resultSha256)
    ) {
      unsafeStep = expected.id;
      break;
    }
    if (startTrusted && (event.attemptId !== start.attemptId || finish.attemptId !== start.attemptId)) {
      refuse('RECOVERY_ATTEMPT_MISMATCH', 'Completed step has conflicting original attempt ID.', dir);
    }
    const receipt = await boundedFile(join(dir, 'steps', expected.id, 'result.json'), MAX_RESULT);
    const record = strictObject(receipt.bytes, 'Step ' + expected.id);
    const expectedChild = verifiers[expected.action] ? expected.action : null;
    if (
      receipt.sha256 !== finish.resultSha256 ||
      record.schema !== 'workbridge.research-step.v1' ||
      record.status !== 'completed' ||
      record.action !== expected.action ||
      record.stepId !== expected.id ||
      record.gameContacted !== false ||
      record.arbitraryCommandsExecuted !== false ||
      (expectedChild ? record.childBundle?.kind !== expectedChild : record.childBundle !== null)
    ) {
      refuse('RECOVERY_STEP_TAMPERED', 'A previous completed step does not match its receipt.', dir);
    }
    let childBundle = null;
    if (expectedChild) {
      const expectedRel = 'steps/' + expected.id + '/bundle';
      if (record.childBundle.directory !== expectedRel || record.childBundle.verified !== true) {
        refuse('RECOVERY_CHILD_INVALID', 'Completed child-bundle location is inconsistent.', dir);
      }
      const path = join(dir, 'steps', expected.id, 'bundle');
      const proof = await verifiers[expected.action](path);
      if (proof?.verified !== true)
        refuse('RECOVERY_CHILD_INVALID', 'Prior child evidence no longer verifies.', dir);
      childBundle = { kind: expectedChild, directory: path };
    }
    completed.push({
      id: expected.id,
      action: expected.action,
      completedUtc: record.completedUtc,
      resultSha256: receipt.sha256,
      childKind: expectedChild,
    });
    outcomes.set(expected.action, { result: record.result, childBundle });
    cursor += 2;
  }

  const tail = events.slice(cursor);
  let status = 'interrupted_at_checkpoint';
  let reason = null;
  if (unsafeStep) {
    status = 'outcome_uncertain';
    reason = 'step_started_without_verified_completion';
  } else if (tail.length) {
    if (tail.length === 1 && tail[0].event === 'step_failed') {
      status = 'failed';
      reason = 'step_failed';
    } else if (tail.length === 1 && tail[0].event === 'run_failed') {
      status = 'failed';
      reason = 'run_failed';
    } else if (tail.length === 2 && tail[0].event === 'step_failed' && tail[1].event === 'run_failed') {
      status = 'failed';
      reason = 'step_failed';
    } else if (tail.length === 2 && tail[0].event === 'run_completed' && tail[1].event === 'run_failed') {
      status = 'manual_review';
      reason = 'verification_failed_after_all_steps_completed';
    } else if (tail.length === 1 && tail[0].event === 'run_completed') {
      status = 'finalization_uncertain';
      reason = 'completion_marker_or_manifest_not_qualified';
    } else {
      refuse('RECOVERY_LEDGER_INVALID', 'Ledger has unsupported transitions or multiple attempts.', dir);
    }
  }

  const fileNames = await readdir(dir);
  const hasCompletionMarker = fileNames.includes('SHA256SUMS.txt');
  const hasRecoveryClaim = fileNames.includes('recovery-claim.json');
  const hasManifest = fileNames.includes('run-manifest.json');
  const hasFailureReceipt = fileNames.includes('run-failed.json');
  if (hasCompletionMarker || hasManifest || hasRecoveryClaim) {
    status = 'manual_review';
    reason = 'completion_or_claim_artifact_present';
  }
  if (hasFailureReceipt && status === 'interrupted_at_checkpoint') {
    status = 'manual_review';
    reason = 'failure_receipt_without_matching_event';
  }
  const next = plan.orderedSteps[completed.length] ?? null;
  if (next && status === 'interrupted_at_checkpoint') {
    const stepPath = join(dir, 'steps', next.id);
    try {
      const stat = await lstat(stepPath);
      if (stat) {
        status = 'manual_review';
        reason = 'next_step_directory_already_exists';
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        status = 'manual_review';
        reason = 'next_step_directory_unknown';
      }
    }
  }
  if (!next && status === 'interrupted_at_checkpoint') {
    // Finalization after the last step requires a separate, explicit contract;
    // M3 never implicitly overwrites possibly published manifest/marker files.
    status = 'finalization_uncertain';
    reason = 'all_steps_completed_without_terminal_receipt';
  }

  let sourceMatches = null;
  if (startTrusted && checkSources) {
    const current = await preflight(plan, host);
    sourceMatches = sha256(Buffer.from(JSON.stringify(current))) === start.sourceSnapshotSha256;
  }
  const originalOwnerAlive = startTrusted ? ownerAlive(start.ownerPid) : true;
  const eligible =
    startTrusted &&
    status === 'interrupted_at_checkpoint' &&
    sourceMatches === true &&
    originalOwnerAlive === false &&
    next !== null;

  return {
    schema: 'workbridge.research-recovery-inspection.v1',
    directory: dir,
    plan,
    status,
    reason,
    originalAttemptId: start.attemptId ?? null,
    ownerPid: start.ownerPid ?? null,
    originalOwnerAlive,
    ledgerSha256: ledger.sha256,
    sourceSnapshotSha256: start.sourceSnapshotSha256 ?? null,
    planSha256: source.sha256,
    sourceHashesRevalidated: sourceMatches,
    completedSteps: completed,
    nextStep: next ? { id: next.id, action: next.action } : null,
    eligibleForGuardedResume: eligible,
    noActionReplayed: true,
    outcomes,
    ledgerSequence: events.length,
    ledgerPrefixEvents: events,
  };
}

export function summarizeRecoveryInspection(result) {
  return {
    schema: result.schema,
    directory: result.directory,
    status: result.status,
    reason: result.reason,
    originalAttemptId: result.originalAttemptId,
    originalOwnerAlive: result.originalOwnerAlive,
    ledgerSha256: result.ledgerSha256,
    sourceSnapshotSha256: result.sourceSnapshotSha256,
    planSha256: result.planSha256,
    sourceHashesRevalidated: result.sourceHashesRevalidated,
    completedSteps: result.completedSteps.map((step) => step.id),
    nextStep: result.nextStep,
    eligibleForGuardedResume: result.eligibleForGuardedResume,
    noActionReplayed: true,
  };
}
