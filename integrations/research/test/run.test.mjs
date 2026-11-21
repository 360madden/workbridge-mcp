import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runResearch, verifyResearchRun } from '../src/run.mjs';

const sum = (value) => createHash('sha256').update(value).digest('hex');
const HOST = 'AMD-DESKTOP';
const PROFILE = 'generic.saved.v1';

const GENERIC = {
  [PROFILE]: {
    inputs: { artifact: { kind: 'file' } },
    actions: {
      'generic.inspect': { requires: ['artifact'], prior: [] },
      'generic.compare': { requires: ['artifact'], prior: ['generic.inspect'] },
    },
    inputPairs: [],
    uniqueActions: true,
    executionMode: 'offline_saved_data',
  },
};

function genericPlan(path, twoSteps = true) {
  return {
    schema: 'workbridge.research-plan.v1',
    planId: 'generic-local-fixture',
    expectedHost: HOST,
    profile: PROFILE,
    inputs: { artifact: { path } },
    steps: [
      { id: 'read', action: 'generic.inspect', needs: [] },
      ...(twoSteps ? [{ id: 'compare', action: 'generic.compare', needs: ['read'] }] : []),
    ],
  };
}

async function fixture(t, twoSteps = true) {
  const root = await mkdtemp(join(tmpdir(), 'wb-research-run-fixture-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const artifact = join(root, 'sample.json');
  const planFile = join(root, 'plan.json');
  const outputDir = join(root, 'run');
  await writeFile(artifact, '{"source":"synthetic","sequence":1}\n');
  await writeFile(planFile, JSON.stringify(genericPlan(artifact, twoSteps)) + '\n');
  return { root, artifact, planFile, outputDir };
}

function harness(f, overrides = {}) {
  const calls = [];
  const actions = {
    'generic.inspect': async () => {
      calls.push('inspect');
      return { result: { kind: 'saved-fixture', available: true }, childBundle: null };
    },
    'generic.compare': async ({ outcomes }) => {
      calls.push('compare');
      assert.equal(outcomes.get('generic.inspect').result.available, true);
      return { result: { status: 'same-saved-fixture', differences: 0 }, childBundle: null };
    },
    ...(overrides.actions ?? {}),
  };
  let preflightCount = 0;
  const preflight = async (plan) => {
    preflightCount++;
    if (overrides.preflight) return overrides.preflight(plan, preflightCount);
    const bytes = await readFile(f.artifact);
    return {
      artifact: {
        path: plan.inputs.artifact.path,
        sha256: sum(bytes),
        bytes: bytes.length,
        kind: 'saved_file',
      },
    };
  };
  return {
    calls,
    invocation: {
      planFile: f.planFile,
      outputDir: f.outputDir,
      host: HOST,
      registry: GENERIC,
      actions,
      verifiers: {},
      preflight,
    },
    verify: () => verifyResearchRun(f.outputDir, { registry: GENERIC, verifiers: {} }),
  };
}

test('generic coordinator executes validated DAG and checks a complete run bundle', async (t) => {
  const f = await fixture(t);
  const h = harness(f);
  const result = await runResearch(h.invocation);
  assert.equal(result.bundleVerified, true);
  assert.equal(result.stepCount, 2);
  assert.deepEqual(h.calls, ['inspect', 'compare']);
  const verified = await h.verify();
  assert.equal(verified.verified, true);
  assert.equal(verified.savedEvidenceOnly, true);
  assert.equal(verified.sourceSnapshotBound, true);
  assert.equal(verified.currentGameStateVerified, false);
  const manifest = JSON.parse(await readFile(join(f.outputDir, 'run-manifest.json'), 'utf8'));
  assert.equal(manifest.status, 'completed');
  assert.equal(manifest.teleportVerified, false);
  assert.equal(manifest.gameContacted, false);
  assert.equal(manifest.steps.length, 2);
  assert.equal(manifest.artifacts.length, 5);
  const ledger = (await readFile(join(f.outputDir, 'run-ledger.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    ledger.map((row) => row.event),
    ['run_started', 'step_started', 'step_completed', 'step_started', 'step_completed', 'run_completed'],
  );
});

test('a failed second action preserves first result and refuses success marker', async (t) => {
  const f = await fixture(t);
  const h = harness(f, {
    actions: {
      'generic.compare': async () => {
        throw Object.assign(new Error('fixture fail'), { code: 'SIMULATED_BLOCKER' });
      },
    },
  });
  await assert.rejects(
    () => runResearch(h.invocation),
    (error) => error.code === 'SIMULATED_BLOCKER' && error.directory === f.outputDir,
  );
  const prior = JSON.parse(await readFile(join(f.outputDir, 'steps', 'read', 'result.json'), 'utf8'));
  assert.equal(prior.status, 'completed');
  const failed = JSON.parse(await readFile(join(f.outputDir, 'run-failed.json'), 'utf8'));
  assert.equal(failed.code, 'SIMULATED_BLOCKER');
  assert.deepEqual(failed.completedSteps, ['read']);
  assert.equal(failed.requiresExplicitReviewBeforeRetry, true);
  await assert.rejects(
    () => h.verify(),
    (error) => error.code === 'RUN_INCOMPLETE',
  );
});

test('reusing a previous research output directory never overwrites evidence', async (t) => {
  const f = await fixture(t);
  const h = harness(f);
  await runResearch(h.invocation);
  const original = await readFile(join(f.outputDir, 'input.plan.json'));
  await assert.rejects(
    () => runResearch(h.invocation),
    (error) => error.code === 'OUTPUT_EXISTS',
  );
  assert.deepEqual(await readFile(join(f.outputDir, 'input.plan.json')), original);
  assert.equal((await h.verify()).verified, true);
});

test('changing plan source bytes during execution fails before completed publication', async (t) => {
  const f = await fixture(t, false);
  const h = harness(f, {
    actions: {
      'generic.inspect': async () => {
        const old = JSON.parse(await readFile(f.planFile, 'utf8'));
        old.planId = 'changed-after-preflight';
        await writeFile(f.planFile, JSON.stringify(old));
        return { result: { status: 'simulated' }, childBundle: null };
      },
    },
  });
  await assert.rejects(
    () => runResearch(h.invocation),
    (error) => error.code === 'PLAN_CHANGED',
  );
  await assert.rejects(
    () => h.verify(),
    (error) => error.code === 'RUN_INCOMPLETE',
  );
});

test('changing a saved input between snapshots fails and retains prior result', async (t) => {
  const f = await fixture(t, false);
  const h = harness(f, {
    actions: {
      'generic.inspect': async () => {
        await writeFile(f.artifact, '{"source":"modified","sequence":2}\n');
        return { result: { status: 'read-only-test' }, childBundle: null };
      },
    },
  });
  await assert.rejects(
    () => runResearch(h.invocation),
    (error) => error.code === 'INPUT_CHANGED',
  );
  assert.equal(
    JSON.parse(await readFile(join(f.outputDir, 'steps', 'read', 'result.json'), 'utf8')).status,
    'completed',
  );
  await assert.rejects(
    () => h.verify(),
    (error) => error.code === 'RUN_INCOMPLETE',
  );
});

test('tampering with a saved result is detected without reexecuting adapters', async (t) => {
  const f = await fixture(t);
  const h = harness(f);
  await runResearch(h.invocation);
  await writeFile(
    join(f.outputDir, 'steps', 'read', 'result.json'),
    '{"status":"completed","forged":true}\n',
  );
  await assert.rejects(
    () => h.verify(),
    (error) => error.code === 'RUN_STEP_INVALID',
  );
  assert.deepEqual(h.calls, ['inspect', 'compare']);
});

test('a manipulated source inventory is rejected even if manifest checksum is replaced', async (t) => {
  const f = await fixture(t);
  const h = harness(f);
  await runResearch(h.invocation);
  const name = join(f.outputDir, 'run-manifest.json');
  const old = JSON.parse(await readFile(name, 'utf8'));
  old.sources.artifact.sha256 = '0'.repeat(64);
  const bytes = Buffer.from(JSON.stringify(old) + '\n');
  await writeFile(name, bytes);
  const sumsPath = join(f.outputDir, 'SHA256SUMS.txt');
  const sums = await readFile(sumsPath, 'utf8');
  await writeFile(
    sumsPath,
    sums.replace(/^[0-9a-f]{64}  run-manifest\.json$/m, sum(bytes) + '  run-manifest.json'),
  );
  // A rewritten manifest checksum is insufficient: the original source
  // snapshot digest is independently committed to the step ledger.
  await assert.rejects(
    () => h.verify(),
    (error) => error.code === 'RUN_LEDGER_INVALID',
  );
});

test('older run ledgers remain verifiable but explicitly report weaker source binding', async (t) => {
  const f = await fixture(t);
  const h = harness(f);
  await runResearch(h.invocation);
  const ledgerPath = join(f.outputDir, 'run-ledger.jsonl');
  const events = (await readFile(ledgerPath, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  delete events[0].sourceSnapshotSha256;
  const newLedger = Buffer.from(events.map((event) => JSON.stringify(event)).join('\n') + '\n');
  await writeFile(ledgerPath, newLedger);
  const inventoryPath = join(f.outputDir, 'SHA256SUMS.txt');
  const inventory = await readFile(inventoryPath, 'utf8');
  await writeFile(
    inventoryPath,
    inventory.replace(/^[0-9a-f]{64}  run-ledger\.jsonl$/m, sum(newLedger) + '  run-ledger.jsonl'),
  );
  const observed = await h.verify();
  assert.equal(observed.verified, true);
  assert.equal(observed.sourceSnapshotBound, false);
  assert.equal(observed.currentGameStateVerified, false);
});

test('unknown implementation fails closed before invoking arbitrary tools', async (t) => {
  const f = await fixture(t);
  const h = harness(f);
  delete h.invocation.actions['generic.compare'];
  await assert.rejects(
    () => runResearch(h.invocation),
    (error) => error.code === 'ADAPTER_UNAVAILABLE',
  );
  await assert.rejects(
    () => h.verify(),
    (error) => error.code === 'RUN_INCOMPLETE',
  );
});

test('late verifier rejection removes only its own success marker, retaining evidence', async (t) => {
  const f = await fixture(t, false);
  const h = harness(f);
  let verificationCalls = 0;
  h.invocation.actions['generic.inspect'] = async ({ stepDirectory }) => {
    const child = join(stepDirectory, 'bundle');
    await mkdir(child);
    await writeFile(join(child, 'SHA256SUMS.txt'), 'synthetic child receipt\n');
    return {
      result: { result: 'candidate-only' },
      childBundle: { kind: 'generic.inspect', directory: child },
    };
  };
  h.invocation.verifiers = {
    'generic.inspect': async () => {
      verificationCalls++;
      if (verificationCalls === 1) return { verified: true };
      throw Object.assign(new Error('synthetic final verifier refusal'), { code: 'POST_VERIFY_REFUSAL' });
    },
  };
  await assert.rejects(
    () => runResearch(h.invocation),
    (error) => error.code === 'POST_VERIFY_REFUSAL',
  );
  await assert.rejects(() => readFile(join(f.outputDir, 'SHA256SUMS.txt')), { code: 'ENOENT' });
  assert.equal(
    (await readFile(join(f.outputDir, 'steps', 'read', 'result.json'), 'utf8')).includes('candidate-only'),
    true,
  );
  assert.equal(
    JSON.parse(await readFile(join(f.outputDir, 'run-failed.json'), 'utf8')).code,
    'POST_VERIFY_REFUSAL',
  );
  assert.equal(verificationCalls, 2);
});

test('a minimal real RIFT doctor workflow reuses existing native file identity code', async (t) => {
  const f = await fixture(t, false);
  const pe = Buffer.alloc(1024);
  pe.write('MZ', 0, 'ascii');
  pe.writeUInt32LE(0x80, 0x3c);
  pe.write('PE\0\0', 0x80, 'ascii');
  pe.writeUInt16LE(0x8664, 0x84);
  pe.writeUInt16LE(1, 0x86);
  pe.writeUInt16LE(0xf0, 0x94);
  pe.writeUInt16LE(0x20b, 0x98);
  const client = join(f.root, 'rift_x64.exe');
  await writeFile(client, pe);
  await writeFile(
    f.planFile,
    JSON.stringify({
      schema: 'workbridge.research-plan.v1',
      planId: 'rift-doctor-fixture',
      expectedHost: HOST,
      profile: 'rift.offline.v1',
      inputs: { client: { path: client, sha256: sum(pe) } },
      steps: [{ id: 'identify', action: 'rift.doctor', needs: [] }],
    }),
  );
  const result = await runResearch({ planFile: f.planFile, outputDir: f.outputDir, host: HOST });
  assert.equal(result.bundleVerified, true);
  assert.deepEqual(result.actions, ['rift.doctor']);
  assert.equal((await verifyResearchRun(f.outputDir)).verified, true);
  const observed = JSON.parse(await readFile(join(f.outputDir, 'steps', 'identify', 'result.json')));
  assert.equal(observed.result.client.sha256, sum(pe));
  assert.equal(observed.result.gameContacted, false);
});
