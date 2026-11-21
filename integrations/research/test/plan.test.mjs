import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { validatePlan, describePlan, PlanError } from '../src/plan.mjs';
import { readPlanFile } from '../src/plan-file.mjs';
import { main } from '../src/cli.mjs';

const HEX = 'a'.repeat(64);
const HOME = 'C:\\work\\rift-reader\\';
const winfile = (name, sha256 = null) => ({
  path: HOME + name,
  ...(sha256 ? { sha256 } : {}),
});

function baseline() {
  return {
    schema: 'workbridge.research-plan.v1',
    planId: 'rift-m1-test',
    expectedHost: 'AMD-DESKTOP',
    profile: 'rift.offline.v1',
    inputs: {
      client: winfile('old\\rift_x64.exe', HEX),
      telemetry: winfile('snapshot.json'),
      track: winfile('track.jsonl'),
      rre: winfile('publication.json'),
      rreBinding: winfile('binding.json'),
      afterClient: winfile('new\\rift_x64.exe', 'b'.repeat(64)),
      physicalReceipt: { path: HOME + 'receipts\\epoch-01' },
    },
    steps: [
      { id: 'identify', action: 'rift.doctor', needs: [] },
      { id: 'replay', action: 'rift.saved-session', needs: ['identify'] },
      { id: 'patch', action: 'rift.patch-compare', needs: ['identify'] },
      { id: 'audit', action: 'rift.compat-audit', needs: ['replay', 'patch'] },
    ],
  };
}

function invalid(change, code, expectedHost = 'AMD-DESKTOP') {
  const plan = baseline();
  change(plan);
  assert.throws(
    () => validatePlan(plan, { host: expectedHost }),
    (error) => error instanceof PlanError && error.code === code,
  );
}

test('valid full RIFT plan validates with deterministic DAG order and no execution', () => {
  const validated = validatePlan(baseline(), { host: 'AMD-DESKTOP' });
  const preview = describePlan(validated);
  assert.deepEqual(
    preview.executionOrder.map((step) => step.id),
    ['identify', 'replay', 'patch', 'audit'],
  );
  assert.equal(preview.stepCount, 4);
  assert.equal(preview.toolsInvoked, false);
  assert.equal(preview.gameContacted, false);
  assert.equal(preview.writesPerformed, false);
  assert.equal(validated.inputs.client.sha256, HEX);
});

test('DAG executes prerequisites first even when source JSON lists them later', () => {
  const plan = baseline();
  plan.steps = [plan.steps[3], plan.steps[2], plan.steps[1], plan.steps[0]];
  const { executionOrder } = describePlan(validatePlan(plan, { host: 'AMD-DESKTOP' }));
  assert.deepEqual(
    executionOrder.map((step) => step.id),
    ['identify', 'patch', 'replay', 'audit'],
  );
});

test('rejects schema mismatch and any unknown top-level or nested source fields', () => {
  invalid((p) => {
    p.schema = 'research-plan-v0';
  }, 'PLAN_VERSION');
  invalid((p) => {
    p.unrestrictedCommand = 'powershell';
  }, 'UNKNOWN_FIELD');
  invalid((p) => {
    p.inputs.client.command = 'cmd.exe';
  }, 'UNKNOWN_FIELD');
  invalid((p) => {
    p.steps[0].executable = 'cmd.exe';
  }, 'UNKNOWN_FIELD');
});

test('rejects malformed plan IDs and duplicated step IDs or action registrations', () => {
  invalid((p) => {
    p.planId = '../another-plan';
  }, 'PLAN_ID');
  invalid((p) => {
    p.steps[1].id = 'identify';
  }, 'DUPLICATE_STEP');
  invalid((p) => {
    p.steps[1].action = 'rift.doctor';
  }, 'DUPLICATE_ACTION');
});

test('wrong hostname refuses before any research action exists', () => {
  invalid(() => {}, 'WRONG_HOST', 'LEGION');
  invalid((p) => {
    p.expectedHost = 'AMD-DESKTOP\nLEGION';
  }, 'HOST_INVALID');
});

test('a missing pinned client build is rejected independently of source existence', () => {
  invalid((p) => {
    delete p.inputs.client.sha256;
  }, 'INPUT_HASH_REQUIRED');
  invalid((p) => {
    p.inputs.client.sha256 = '0x1234';
  }, 'INVALID_INPUT_HASH');
  invalid((p) => {
    delete p.inputs.afterClient.sha256;
  }, 'INPUT_HASH_REQUIRED');
});

test('Windows local paths are required: traversal, UNC, relative and control chars reject', () => {
  invalid((p) => {
    p.inputs.track.path = '..\\track.jsonl';
  }, 'INVALID_SOURCE_PATH');
  invalid((p) => {
    p.inputs.track.path = 'C:\\work\\..\\secret.json';
  }, 'INVALID_SOURCE_PATH');
  invalid((p) => {
    p.inputs.track.path = '\\\\server\\share\\track.jsonl';
  }, 'INVALID_SOURCE_PATH');
  invalid((p) => {
    p.inputs.track.path = 'C:\\work\\bad\n.json';
  }, 'INVALID_SOURCE_PATH');
  invalid((p) => {
    p.inputs.track.path = 'C:\\work\\\\track.jsonl';
  }, 'INVALID_SOURCE_PATH');
});

test('RRE publication and binding must be supplied together', () => {
  invalid((p) => {
    delete p.inputs.rreBinding;
  }, 'INPUT_PAIR');
  invalid((p) => {
    delete p.inputs.rre;
  }, 'INPUT_PAIR');
});

test('unexpected action or profile cannot become a free-form command runner', () => {
  invalid((p) => {
    p.steps[1].action = 'run.shell';
  }, 'UNKNOWN_ACTION');
  invalid((p) => {
    p.profile = 'run.anything.v9';
  }, 'UNKNOWN_PROFILE');
});

test('missing, duplicate, self and cyclic dependencies reject', () => {
  invalid((p) => {
    p.steps[1].needs = ['missing'];
  }, 'MISSING_DEPENDENCY');
  invalid((p) => {
    p.steps[1].needs = ['identify', 'identify'];
  }, 'DUPLICATE_DEPENDENCY');
  invalid((p) => {
    p.steps[0].needs = ['identify'];
  }, 'STEP_SELF_DEPENDENCY');
  invalid((p) => {
    p.steps[0].needs = ['replay'];
  }, 'DEPENDENCY_CYCLE');
});

test('mandatory action dependency contracts cannot be bypassed', () => {
  invalid((p) => {
    p.steps[1].needs = [];
  }, 'ACTION_PREREQUISITE');
  invalid((p) => {
    p.steps[3].needs = ['replay'];
  }, 'ACTION_PREREQUISITE');
  invalid((p) => {
    p.steps.splice(0, 1);
  }, 'MISSING_DEPENDENCY');
  invalid((p) => {
    delete p.inputs.physicalReceipt;
  }, 'MISSING_INPUT');
  invalid((p) => {
    delete p.inputs.afterClient;
  }, 'MISSING_INPUT');
});

test('the profile supports a minimal doctor-only run without unrelated inputs', () => {
  const p = baseline();
  p.inputs = { client: p.inputs.client };
  p.steps = [p.steps[0]];
  const preview = describePlan(validatePlan(p, { host: 'AMD-DESKTOP' }));
  assert.deepEqual(preview.inputRoles, ['client']);
  assert.equal(preview.executionOrder.length, 1);
});

test('plan size and step count are bounded', () => {
  invalid((p) => {
    p.planId = 'x'.repeat(65);
  }, 'PLAN_ID');
  invalid((p) => {
    p.steps = [];
  }, 'STEP_COUNT');
  invalid((p) => {
    p.inputs.client.path = HOME + 'x'.repeat(35000);
  }, 'PLAN_SIZE');
});

test('generic planner accepts another registered type-safe research adapter', () => {
  const alternative = {
    schema: 'workbridge.research-plan.v1',
    planId: 'generic-doc-analysis',
    expectedHost: 'AMD-DESKTOP',
    profile: 'generic.saved.v1',
    inputs: { artifact: winfile('record.json') },
    steps: [{ id: 'inspect', action: 'generic.validate-saved', needs: [] }],
  };
  const registry = {
    'generic.saved.v1': {
      inputs: { artifact: { kind: 'file' } },
      actions: { 'generic.validate-saved': { requires: ['artifact'], prior: [] } },
      uniqueActions: true,
      inputPairs: [],
      executionMode: 'saved_data_only',
    },
  };
  const result = validatePlan(alternative, { host: 'AMD-DESKTOP', registry });
  assert.equal(result.orderedSteps[0].action, 'generic.validate-saved');
  assert.equal(result.profile, 'generic.saved.v1');
});

test('CLI reads exact plan bytes and supplies stable source SHA-256', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wb-research-m1-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'plan.json');
  const bytes = Buffer.from(JSON.stringify(baseline(), null, 2) + '\n');
  await writeFile(path, bytes);
  const file = await readPlanFile(path);
  assert.equal(file.bytes.length, bytes.length);
  assert.equal(file.plan.planId, 'rift-m1-test');
  // Portable tests call the same parser with an injected host; the actual CLI
  // retains OS-native hostname enforcement.
  assert.equal(validatePlan(file.plan, { host: 'AMD-DESKTOP' }).orderedSteps.length, 4);
  assert.match(file.sha256, /^[a-f0-9]{64}$/);
  assert.equal((await readFile(path)).compare(bytes), 0);
});

test('CLI help does not read source files or run jobs', async () => {
  const result = await main(['help']);
  assert.match(result, /research coordinator/);
});

test('CLI refuses missing and unsupported options', async () => {
  await assert.rejects(
    () => main(['plan']),
    (error) => error.code === 'CLI_ARGUMENTS',
  );
  await assert.rejects(
    () => main(['execute', '--plan', 'hello.json']),
    (error) => error.code === 'CLI_ARGUMENTS',
  );
  await assert.rejects(
    () => main(['plan', '--plan', 'a.json', '--exec', 'powershell.exe']),
    (error) => error.code === 'CLI_ARGUMENTS',
  );
});
