import { test } from 'node:test';
import assert from 'node:assert/strict';
// Node's native type stripping reads source without rebuilding or importing dist/.
import { summarizeOperations } from '../src/operations-summary.ts';

const now = '2026-10-26T12:00:00.000Z';
const snapshot = (data, observedAt = now) => ({ data, observedAt });
function fixture() {
  return {
    now,
    sourceVersion: '0.16.4-dev',
    diagnostics: snapshot({
      version: '0.16.4-dev',
      localCli: {
        enabled: true,
        instanceId: '9fb4e652-4e27-42fd-824c-eaa2aa7d6273',
        pid: 1234,
        startedUtc: '2026-10-26T10:00:00.000Z',
        version: '0.16.4-dev',
      },
      jobs: {
        storedJobs: 0,
        capacity: {
          schemaVersion: 1,
          limit: 6,
          occupied: 0,
          available: 6,
          inProgress: 0,
          retainedResults: 0,
          closing: false,
          jobs: [],
        },
        inventory: {
          complete: true,
          limitReached: false,
          timeLimitReached: false,
          errorCode: null,
        },
      },
    }),
    commandList: snapshot({ jobs: [], complete: true, nextOffset: null, issues: [], hasErrors: false }),
    workflowList: snapshot({ workflows: [], complete: true, nextOffset: null, issues: [], hasErrors: false }),
  };
}
function occupy(input, kinds) {
  const capacity = input.diagnostics.data.jobs.capacity;
  capacity.occupied = kinds.length;
  capacity.available = capacity.limit - kinds.length;
  capacity.retainedResults = kinds.filter((kind) => kind === 'retained_result').length;
  capacity.inProgress = kinds.length - capacity.retainedResults;
  capacity.jobs = kinds.map((kind, i) => ({ jobId: `job-${i}`, kind, status: 'failed' }));
}

test('idle owner has six slots and unknown agent count, never six inferred agents', () => {
  const result = summarizeOperations(fixture());
  assert.equal(result.readOnly, true);
  assert.equal(result.owner.identityKnown, true);
  assert.equal(result.owner.liveVerified, false);
  assert.equal(result.owner.freshness.state, 'fresh');
  assert.equal(result.activeSlots.available, 6);
  assert.equal(result.activeSlots.reservation, false);
  assert.equal(result.savedInventory.countKind, 'exact_names');
  assert.equal(result.savedInventory.validatesResults, false);
  assert.equal(result.agents.reportedCount, null);
  assert.equal(result.agents.inferredFromSlots, false);
  assert.equal(result.versions.mismatch, false);
});

test('active work and retained results stay separate, even with zero public running jobs', () => {
  const input = fixture();
  occupy(input, ['in_progress', 'retained_result']);
  input.diagnostics.data.jobs.runningJobs = 0;
  const result = summarizeOperations(input);
  assert.equal(result.activeSlots.occupied, 2);
  assert.equal(result.activeSlots.inProgress, 1);
  assert.equal(result.activeSlots.retainedResults, 1);
  assert.deepEqual(result.nextAction, {
    tool: 'command_status',
    jobId: 'job-1',
    reason: 'Inspect the retained result and storage; recovery requires an explicit separate action.',
  });
  assert.equal(result.activeSlots.jobs[1].nextAction, 'command_status');
});

test('pending, blocked and failed evidence is counted only in supplied catalog pages', () => {
  const input = fixture();
  input.commandList.data.jobs = [
    { id: 'running', status: 'running', completionPending: true },
    { id: 'saving', status: 'cancelled', completionPending: true },
    { id: 'failed', status: 'failed', completionPending: false },
    { id: 'timed', status: 'timed_out', completionPending: false },
  ];
  input.workflowList.data.workflows = ['pending', 'validating', 'blocked', 'failed'].map((state) => ({
    workflowId: `wf-${state}`,
    recordedState: state,
  }));
  const result = summarizeOperations(input);
  assert.equal(result.commands.pending, 2);
  assert.equal(result.commands.counts.failed, 1);
  assert.equal(result.commands.counts.timed_out, 1);
  assert.equal(result.workflows.counts.pending, 1);
  assert.equal(result.workflows.counts.validating, 1);
  assert.equal(result.workflows.counts.blocked, 1);
  assert.equal(result.workflows.counts.failed, 1);
  assert.equal(result.commands.scope, 'supplied_page_only');
  assert.match(result.workflows.stateFreshness, /recorded/);
  assert.equal(result.activeSlots.occupied, 0, 'historical catalog records do not occupy slots');
});

test('missing and malformed data is unknown rather than an idle healthy owner', () => {
  for (const data of [undefined, null, 'private failure text', [], {}]) {
    const result = summarizeOperations({ now, diagnostics: snapshot(data) });
    assert.equal(result.owner.identityKnown, false);
    assert.equal(result.activeSlots.valid, false);
    assert.equal(result.activeSlots.available, null);
    assert.equal(result.savedInventory.recordNames, null);
    assert.equal(result.commands.complete, false);
    assert.equal(result.workflows.complete, false);
    assert.equal(result.nextAction.tool, 'diagnostics');
  }
});

test('stale, undated and future observations require fresh diagnostics', () => {
  for (const observedAt of ['2026-10-26T11:58:00.000Z', undefined, 'bad', '2026-10-26T12:01:00Z']) {
    const input = fixture();
    input.diagnostics.observedAt = observedAt;
    const result = summarizeOperations(input);
    assert.equal(result.owner.freshness.state, observedAt?.includes('11:58') ? 'stale' : 'unknown');
    assert.equal(result.nextAction.tool, 'diagnostics');
    assert.equal(result.activeSlots.freshness.state, result.owner.freshness.state);
  }
  const input = fixture();
  input.now = 'invalid';
  assert.equal(summarizeOperations(input).owner.freshness.state, 'unknown');
});

test('old process start does not make a recently observed owner stale', () => {
  const input = fixture();
  input.diagnostics.data.localCli.startedUtc = '2025-01-01T00:00:00Z';
  assert.equal(summarizeOperations(input).owner.freshness.state, 'fresh');
  input.diagnostics.observedAt = '2026-10-26T11:59:00Z';
  assert.equal(summarizeOperations(input).owner.freshness.state, 'fresh');
  input.maxAgeSeconds = 59;
  assert.equal(summarizeOperations(input).owner.freshness.state, 'stale');
});

test('an owner start after its observation is an invalid process identity', () => {
  const input = fixture();
  input.diagnostics.data.localCli.startedUtc = '2026-10-26T12:01:00Z';
  const result = summarizeOperations(input);
  assert.equal(result.owner.identityKnown, false);
  assert.equal(result.nextAction.tool, 'diagnostics');
});

test('source version and installed response are compared without deployment claims or restart guidance', () => {
  const input = fixture();
  input.diagnostics.data.version = '0.16.3-dev';
  input.diagnostics.data.localCli.version = '0.16.3-dev';
  const result = summarizeOperations(input);
  assert.equal(result.versions.mismatch, true);
  assert.equal(result.versions.installed, '0.16.3-dev');
  assert.equal(result.nextAction.tool, 'diagnostics');
  assert.match(result.nextAction.reason, /WB-001/);
  delete input.sourceVersion;
  assert.equal(summarizeOperations(input).versions.mismatch, null);
  input.diagnostics.data.localCli.version = '0.16.2-dev';
  assert.equal(summarizeOperations(input).versions.ownerVersionConflict, true);
});

for (const field of ['commandList', 'workflowList']) {
  test(`${field}: empty filtered pages with continuation remain incomplete`, () => {
    const input = fixture();
    input[field].data.complete = true; // Contradictory producer flags must not hide the cursor.
    input[field].data.nextOffset = 200;
    const result = summarizeOperations(input);
    const page = field === 'commandList' ? result.commands : result.workflows;
    assert.equal(page.complete, false);
    assert.equal(page.nextOffset, 200);
    assert.equal(result.nextAction.tool, field === 'commandList' ? 'command_list' : 'workflow_list');
    assert.equal(result.nextAction.offset, 200);
  });
  test(`${field}: all partial-data flags and issues override complete=true`, () => {
    for (const flag of [
      'catalogTruncated',
      'scanLimitReached',
      'outputLimitReached',
      'timeLimitReached',
      'hasErrors',
      'issues',
    ]) {
      const input = fixture();
      input[field].data[flag] = flag === 'issues' ? [{ code: 'UNREADABLE_RECORD' }] : true;
      const result = summarizeOperations(input);
      assert.equal((field === 'commandList' ? result.commands : result.workflows).complete, false, flag);
    }
  });
  test(`${field}: stale page restarts discovery instead of following its old cursor`, () => {
    const input = fixture();
    input[field].observedAt = '2026-10-26T11:00:00Z';
    input[field].data.nextOffset = 40;
    assert.equal(summarizeOperations(input).nextAction.offset, 0);
  });
}

test('partial or failed name inventory is explicit and never means zero validated results', () => {
  const input = fixture();
  const jobs = input.diagnostics.data.jobs;
  jobs.storedJobs = 7;
  jobs.inventory.complete = false;
  jobs.inventory.limitReached = true;
  let result = summarizeOperations(input);
  assert.equal(result.savedInventory.recordNames, 7);
  assert.equal(result.savedInventory.countKind, 'lower_bound_names');
  assert.equal(result.savedInventory.complete, false);
  jobs.storedJobs = null;
  jobs.inventory.errorCode = 'UNREADABLE_JOB_CATALOG';
  result = summarizeOperations(input);
  assert.equal(result.savedInventory.recordNames, null);
  assert.equal(result.savedInventory.countKind, 'unknown');
});

test('inconsistent capacity is rejected instead of invented or inferred from history', () => {
  for (const mutate of [
    (c) => (c.occupied = 1),
    (c) => (c.available = -1),
    (c) => (c.schemaVersion = 2),
    (c) => (c.jobs = undefined),
    (c) => (c.closing = undefined),
    (c) => (c.jobs[0].kind = 'unknown'),
    (c) => (c.jobs[1].jobId = c.jobs[0].jobId),
  ]) {
    const input = fixture();
    occupy(input, ['in_progress', 'retained_result']);
    mutate(input.diagnostics.data.jobs.capacity);
    const result = summarizeOperations(input);
    assert.equal(result.activeSlots.valid, false);
    assert.equal(result.activeSlots.available, null);
    assert.equal(result.nextAction.tool, 'diagnostics');
  }
  const input = fixture();
  input.diagnostics.data.jobs.capacity.closing = true;
  assert.equal(summarizeOperations(input).nextAction.tool, 'diagnostics');
});

test('only explicit independent metadata produces reported agents', () => {
  const input = fixture();
  input.agents = snapshot({
    complete: true,
    agents: [
      { agentId: 'worker-1', status: 'running', prompt: 'private prompt' },
      { agentId: 'worker-2', status: 'blocked' },
    ],
  });
  const result = summarizeOperations(input);
  assert.equal(result.agents.reportedCount, 2);
  assert.equal(result.agents.complete, true);
  assert.equal(result.activeSlots.available, 6);
  assert.equal(JSON.stringify(result).includes('private prompt'), false);
  input.agents.observedAt = '2026-10-26T11:00:00Z';
  assert.equal(summarizeOperations(input).agents.freshness.state, 'stale');
});

test('raw secrets, arguments, output, titles, paths and unsafe identifiers never escape the projection', () => {
  const input = fixture();
  const secrets = [
    'Bearer abc123private',
    'password=hunter2',
    'sk-privatekey123456',
    'ghp_privatekey123456',
    'https://user:pass@example.test/?token=private',
    'raw command --private-value',
    'eyJhbGciOiJIUzI1NiJ9.private.signature',
  ];
  input.diagnostics.data.authorization = secrets[0];
  input.diagnostics.data.localCli.url = secrets[4];
  input.diagnostics.data.localCli.authorization = secrets[2];
  input.diagnostics.data.root = secrets[5];
  input.commandList.data.jobs = secrets.map((secret, i) => ({
    id: `safe-${i}`,
    status: 'failed',
    args: [secret],
    command: secret,
    output: secret,
    error: secret,
    project: secret,
  }));
  input.workflowList.data.workflows = secrets.map((secret, i) => ({
    workflowId: `wf-${i}`,
    recordedState: 'blocked',
    title: secret,
    checks: [{ args: [secret] }],
  }));
  input.agents = snapshot({
    complete: true,
    agents: secrets.map((agentId) => ({ agentId, status: 'running' })),
  });
  let result = summarizeOperations(input);
  let serialized = JSON.stringify(result);
  for (const secret of secrets) assert.equal(serialized.includes(secret), false, secret);
  input.commandList.data.jobs = secrets.map((id) => ({ id, status: 'failed' }));
  input.workflowList.data.workflows = secrets.map((workflowId) => ({ workflowId, recordedState: 'blocked' }));
  input.sourceVersion = secrets[0];
  input.diagnostics.data.version = secrets[2];
  input.diagnostics.data.localCli.instanceId = secrets[1];
  result = summarizeOperations(input);
  serialized = JSON.stringify(result);
  for (const secret of secrets) assert.equal(serialized.includes(secret), false, secret);
  assert.equal(result.commands.complete, false);
  assert.equal(result.workflows.complete, false);
  assert.equal(result.owner.identityKnown, false);
});

test('bounded rows, scans and identifiers keep oversized input summaries compact', () => {
  const input = fixture();
  input.commandList.data.jobs = Array.from({ length: 10000 }, (_, i) => ({
    id: `job-${i}`,
    status: 'failed',
  }));
  input.workflowList.data.workflows = Array.from({ length: 10000 }, (_, i) => ({
    workflowId: `wf-${i}`,
    recordedState: 'pending',
  }));
  input.agents = snapshot({
    complete: true,
    agents: Array.from({ length: 10000 }, (_, i) => ({ agentId: `agent-${i}`, status: 'running' })),
  });
  const result = summarizeOperations(input);
  assert.equal(result.commands.rows.length, 20);
  assert.equal(result.commands.counts.failed, 100);
  assert.equal(result.commands.rowsOmitted, 80);
  assert.equal(result.commands.inputTruncated, true);
  assert.equal(result.workflows.rows.length, 20);
  assert.equal(result.workflows.counts.pending, 50);
  assert.equal(result.agents.rows.length, 20);
  assert.equal(result.agents.reportedCount, 100);
  assert.equal(result.agents.complete, false);
  assert.ok(JSON.stringify(result).length < 30000);
});

test('invalid rows, duplicates and unknown states remain incomplete with bounded known counts', () => {
  const input = fixture();
  input.commandList.data.jobs = [
    { id: 'same', status: 'failed' },
    { id: 'same', status: 'failed' },
    { id: 'other', status: 'future-state' },
    null,
  ];
  input.workflowList.data.workflows = [{ workflowId: 'wf', recordedState: 'future-state' }];
  const result = summarizeOperations(input);
  assert.equal(result.commands.counts.failed, 1);
  assert.equal(result.commands.invalidRows, 3);
  assert.equal(result.commands.complete, false);
  assert.equal(result.workflows.invalidRows, 1);
  assert.equal(result.workflows.complete, false);
});

test('summary is deterministic, does not mutate frozen inputs, and recommends inspection only', () => {
  const input = fixture();
  occupy(input, Array(6).fill('retained_result'));
  function freeze(value) {
    if (value && typeof value === 'object') {
      Object.freeze(value);
      for (const child of Object.values(value)) freeze(child);
    }
    return value;
  }
  const before = JSON.stringify(input);
  freeze(input);
  assert.deepEqual(summarizeOperations(input), summarizeOperations(input));
  assert.equal(JSON.stringify(input), before);
  assert.equal(summarizeOperations(input).nextAction.tool, 'command_status');
});

test('fresh complete evidence selects current job or workflow inspection, never a mutation', () => {
  const input = fixture();
  occupy(input, ['in_progress']);
  assert.equal(summarizeOperations(input).nextAction.jobId, 'job-0');
  occupy(input, []);
  input.workflowList.data.workflows = [{ workflowId: 'needs-inspection', recordedState: 'blocked' }];
  const result = summarizeOperations(input);
  assert.equal(result.nextAction.tool, 'workflow_status');
  assert.equal(result.nextAction.workflowId, 'needs-inspection');
  delete input.commandList;
  assert.equal(summarizeOperations(input).nextAction.tool, 'command_list');
});
