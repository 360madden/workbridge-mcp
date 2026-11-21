import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readRecoveryCheckpoint, summarizeRecoveryInspection } from '../src/recovery.mjs';
import { resumeResearch } from '../src/resume.mjs';
import { verifyResearchRun } from '../src/run.mjs';

const HOST = 'AMD-DESKTOP';
const profile = 'fixture.offline.v1';
const registry = {
  [profile]: {
    inputs: { artifact: { kind: 'file' } },
    actions: {
      'fixture.first': { requires: ['artifact'], prior: [] },
      'fixture.second': { requires: ['artifact'], prior: ['fixture.first'] },
    },
    uniqueActions: true,
    inputPairs: [],
    executionMode: 'offline_saved_data',
  },
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'wb-research-m3-'));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const artifact = join(root, 'source.json');
  const planFile = join(root, 'plan.json');
  const directory = join(root, 'run');
  await writeFile(artifact, '{"verified":"fixture"}\n');
  await writeFile(
    planFile,
    JSON.stringify({
      schema: 'workbridge.research-plan.v1',
      planId: 'm3-pinned-recovery',
      expectedHost: HOST,
      profile,
      inputs: { artifact: { path: artifact } },
      steps: [
        { id: 'first', action: 'fixture.first', needs: [] },
        { id: 'second', action: 'fixture.second', needs: ['first'] },
      ],
    }) + '\n',
  );
  const preflight = async (plan) => {
    const bytes = await readFile(artifact);
    return {
      artifact: {
        path: plan.inputs.artifact.path,
        sha256: hash(bytes),
        bytes: bytes.length,
        kind: 'saved_file',
      },
    };
  };
  return { root, artifact, planFile, directory, preflight };
}

function hardCrashAfterFirst(f) {
  const script = [
    'import {createHash} from "node:crypto";',
    'import {readFile} from "node:fs/promises";',
    'import {runResearch} from ' + JSON.stringify(new URL('../src/run.mjs', import.meta.url).href) + ';',
    'const planFile=process.argv[1], outputDir=process.argv[2], artifact=process.argv[3];',
    'const registry=' + JSON.stringify(registry) + ';',
    'const preflight=async(p)=>{const bytes=await readFile(artifact);return {artifact:{path:p.inputs.artifact.path,sha256:createHash("sha256").update(bytes).digest("hex"),bytes:bytes.length,kind:"saved_file"}};};',
    'const actions={"fixture.first":async()=>({result:{first:"completed"},childBundle:null}),"fixture.second":async()=>({result:{second:"completed"},childBundle:null})};',
    'await runResearch({planFile,outputDir,host:"AMD-DESKTOP",registry,actions,verifiers:{},preflight,onStepCommitted:(_step,count)=>{if(count===1)process.exit(73);}});',
  ].join('\n');
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', script, f.planFile, f.directory, f.artifact],
    { windowsHide: true, timeout: 30_000, encoding: 'utf8' },
  );
  assert.equal(
    result.status,
    73,
    result.stderr || result.error?.message || 'child did not exit at checkpoint',
  );
}

async function inspect(f, options = {}) {
  return readRecoveryCheckpoint({
    directory: f.directory,
    host: HOST,
    registry,
    verifiers: {},
    preflight: f.preflight,
    ownerAlive: () => false,
    ...options,
  });
}
function continueFrom(f, checkpoint, overrides = {}) {
  let replayFirst = false;
  let executedSecond = 0;
  const invocation = {
    directory: f.directory,
    planFile: f.planFile,
    expectedAttemptId: checkpoint.originalAttemptId,
    expectedLedgerSha256: checkpoint.ledgerSha256,
    host: HOST,
    registry,
    verifiers: {},
    preflight: f.preflight,
    ownerAlive: () => false,
    actions: {
      'fixture.first': async () => {
        replayFirst = true;
        throw new Error('previously completed action must never replay');
      },
      'fixture.second': async ({ outcomes }) => {
        executedSecond++;
        assert.equal(outcomes.get('fixture.first').result.first, 'completed');
        return { result: { second: 'completed-after-restart' }, childBundle: null };
      },
      ...overrides.actions,
    },
  };
  return { invocation, counters: () => ({ replayFirst, executedSecond }) };
}

test('a real subprocess exit leaves one exact, independently verifiable prefix', async (t) => {
  const f = await fixture(t);
  hardCrashAfterFirst(f);
  const state = await inspect(f);
  assert.equal(state.status, 'interrupted_at_checkpoint');
  assert.equal(state.eligibleForGuardedResume, true);
  assert.deepEqual(
    state.completedSteps.map((step) => step.id),
    ['first'],
  );
  assert.equal(state.nextStep.id, 'second');
  assert.equal(state.originalOwnerAlive, false);
  assert.match(state.originalAttemptId, /^[0-9a-f-]{36}$/);
  assert.match(state.ledgerSha256, /^[0-9a-f]{64}$/);
  assert.equal(summarizeRecoveryInspection(state).noActionReplayed, true);
  await assert.rejects(
    () => verifyResearchRun(f.directory, { registry, verifiers: {} }),
    (e) => e.code === 'RUN_INCOMPLETE',
  );
});

test('guarded resume continues only unstarted work, with new attempt ID and verified claim', async (t) => {
  const f = await fixture(t);
  hardCrashAfterFirst(f);
  const checkpoint = await inspect(f);
  const h = continueFrom(f, checkpoint);
  const result = await resumeResearch(h.invocation);
  assert.equal(result.completionVerified, true);
  assert.equal(result.preservedPrefixSteps, 1);
  assert.equal(result.executedRemainingSteps, 1);
  assert.equal(result.completedStepsReexecuted, false);
  assert.equal(h.counters().replayFirst, false);
  assert.equal(h.counters().executedSecond, 1);
  assert.notEqual(result.recoveryAttemptId, result.originalAttemptId);
  const archived = await verifyResearchRun(f.directory, { registry, verifiers: {} });
  assert.equal(archived.verified, true);
  assert.equal(archived.resumedWithClaimVerified, true);
  assert.equal(archived.completedPrefixReplayed, false);
  assert.equal(archived.sourceSnapshotBound, true);
});

test('incorrect attempt or ledger hash blocks resume before any claim is written', async (t) => {
  const f = await fixture(t);
  hardCrashAfterFirst(f);
  const checkpoint = await inspect(f);
  const h = continueFrom(f, checkpoint);
  await assert.rejects(
    () => resumeResearch({ ...h.invocation, expectedAttemptId: '0'.repeat(36) }),
    (e) => e.code === 'RECOVERY_CHECKPOINT_CHANGED',
  );
  await assert.rejects(
    () => resumeResearch({ ...h.invocation, expectedLedgerSha256: '0'.repeat(64) }),
    (e) => e.code === 'RECOVERY_CHECKPOINT_CHANGED',
  );
  assert.equal((await inspect(f)).eligibleForGuardedResume, true);
});

test('an owner that still appears running cannot be resumed', async (t) => {
  const f = await fixture(t);
  hardCrashAfterFirst(f);
  const blocked = await inspect(f, { ownerAlive: () => true });
  assert.equal(blocked.eligibleForGuardedResume, false);
  const h = continueFrom(f, blocked);
  await assert.rejects(
    () => resumeResearch({ ...h.invocation, ownerAlive: () => true }),
    (e) => e.code === 'RECOVERY_NOT_ELIGIBLE',
  );
});

test('saved source mutation invalidates the recovery checkpoint', async (t) => {
  const f = await fixture(t);
  hardCrashAfterFirst(f);
  const checkpoint = await inspect(f);
  await writeFile(f.artifact, '{"verified":"changed"}\n');
  assert.equal((await inspect(f)).sourceHashesRevalidated, false);
  const h = continueFrom(f, checkpoint);
  await assert.rejects(
    () => resumeResearch(h.invocation),
    (e) => e.code === 'RECOVERY_NOT_ELIGIBLE',
  );
});

test('a started step with no completed receipt is uncertain and never retried', async (t) => {
  const f = await fixture(t);
  hardCrashAfterFirst(f);
  const ledgerPath = join(f.directory, 'run-ledger.jsonl');
  const original = await readFile(ledgerPath, 'utf8');
  await writeFile(
    ledgerPath,
    original +
      JSON.stringify({
        sequence: 4,
        observedUtc: new Date().toISOString(),
        event: 'step_started',
        stepId: 'second',
        action: 'fixture.second',
        needs: ['first'],
      }) +
      '\n',
  );
  const state = await inspect(f);
  assert.equal(state.status, 'outcome_uncertain');
  assert.equal(state.eligibleForGuardedResume, false);
  const h = continueFrom(f, state);
  await assert.rejects(
    () => resumeResearch(h.invocation),
    (e) => e.code === 'RECOVERY_NOT_ELIGIBLE',
  );
});

test('prior completed-step receipt tampering refuses inspection and restart', async (t) => {
  const f = await fixture(t);
  hardCrashAfterFirst(f);
  await writeFile(join(f.directory, 'steps', 'first', 'result.json'), '{"forged":true}\n');
  await assert.rejects(
    () => inspect(f),
    (e) => e.code === 'RECOVERY_STEP_TAMPERED',
  );
});

test('a completed recovery cannot be resumed twice because of the immutable claim', async (t) => {
  const f = await fixture(t);
  hardCrashAfterFirst(f);
  const checkpoint = await inspect(f);
  const h = continueFrom(f, checkpoint);
  await resumeResearch(h.invocation);
  await assert.rejects(
    () => resumeResearch(h.invocation),
    (e) =>
      ['RECOVERY_NOT_ELIGIBLE', 'RECOVERY_ALREADY_CLAIMED', 'RECOVERY_CHECKPOINT_CHANGED'].includes(e.code),
  );
  assert.equal((await verifyResearchRun(f.directory, { registry, verifiers: {} })).verified, true);
});

test('resumed step failure retains prior evidence and prohibits another automatic attempt', async (t) => {
  const f = await fixture(t);
  hardCrashAfterFirst(f);
  const checkpoint = await inspect(f);
  const h = continueFrom(f, checkpoint, {
    actions: {
      'fixture.second': async () => {
        throw Object.assign(new Error('controlled fixture failure'), { code: 'SYNTHETIC_FAILURE' });
      },
    },
  });
  await assert.rejects(
    () => resumeResearch(h.invocation),
    (e) => e.code === 'SYNTHETIC_FAILURE',
  );
  assert.equal((await inspect(f)).eligibleForGuardedResume, false);
  const prior = JSON.parse(await readFile(join(f.directory, 'steps', 'first', 'result.json')));
  assert.equal(prior.result.first, 'completed');
  const failure = JSON.parse(await readFile(join(f.directory, 'run-failed.json')));
  assert.equal(failure.code, 'SYNTHETIC_FAILURE');
  await assert.rejects(
    () => verifyResearchRun(f.directory, { registry, verifiers: {} }),
    (e) => e.code === 'RUN_INCOMPLETE',
  );
});

test('a rehashed but contradictory recovery claim still fails semantic verification', async (t) => {
  const f = await fixture(t);
  hardCrashAfterFirst(f);
  const checkpoint = await inspect(f);
  const h = continueFrom(f, checkpoint);
  await resumeResearch(h.invocation);
  const claimPath = join(f.directory, 'recovery-claim.json');
  const claim = JSON.parse(await readFile(claimPath, 'utf8'));
  claim.completedPrefixCount = 0;
  const bytes = Buffer.from(JSON.stringify(claim, null, 2) + '\n');
  await writeFile(claimPath, bytes);
  const sumsPath = join(f.directory, 'SHA256SUMS.txt');
  const sums = await readFile(sumsPath, 'utf8');
  await writeFile(
    sumsPath,
    sums.replace(/^[0-9a-f]{64}  recovery-claim\.json$/m, hash(bytes) + '  recovery-claim.json'),
  );
  await assert.rejects(
    () => verifyResearchRun(f.directory, { registry, verifiers: {} }),
    (e) => e.code === 'RUN_RECOVERY_INVALID',
  );
});

test('recovery cannot claim success if saved input changes during resumed work', async (t) => {
  const f = await fixture(t);
  hardCrashAfterFirst(f);
  const checkpoint = await inspect(f);
  const h = continueFrom(f, checkpoint, {
    actions: {
      'fixture.second': async ({ outcomes }) => {
        assert.equal(outcomes.get('fixture.first').result.first, 'completed');
        await writeFile(f.artifact, '{"verified":"mutated-during-resume"}\n');
        return { result: { second: 'incomplete' }, childBundle: null };
      },
    },
  });
  await assert.rejects(
    () => resumeResearch(h.invocation),
    (e) => e.code === 'RECOVERY_INPUT_CHANGED',
  );
  await assert.rejects(
    () => verifyResearchRun(f.directory, { registry, verifiers: {} }),
    (e) => e.code === 'RUN_INCOMPLETE',
  );
  const state = await inspect(f);
  assert.equal(state.eligibleForGuardedResume, false);
  assert.equal(state.reason, 'recovery_claim_already_exists');
});

test('original plan bytes changed on disk cannot be used as a recovery plan', async (t) => {
  const f = await fixture(t);
  hardCrashAfterFirst(f);
  const checkpoint = await inspect(f);
  const plan = JSON.parse(await readFile(f.planFile));
  plan.planId = 'another-valid-plan';
  await writeFile(f.planFile, JSON.stringify(plan) + '\n');
  const h = continueFrom(f, checkpoint);
  await assert.rejects(
    () => resumeResearch(h.invocation),
    (e) => e.code === 'RECOVERY_PLAN_CHANGED',
  );
});
