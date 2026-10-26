import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyOperationalAlerts } from '../src/operational-alerts.ts';

const now = '2026-10-26T12:00:00.000Z';
const old = '2026-10-26T11:58:59.000Z';
function fixture(slots = [], jobs = []) {
  const retainedResults = slots.filter((row) => row.kind === 'retained_result').length;
  return {
    now,
    diagnostics: {
      observedAt: now,
      data: {
        jobs: {
          capacity: {
            schemaVersion: 1,
            limit: 6,
            occupied: slots.length,
            available: 6 - slots.length,
            inProgress: slots.length - retainedResults,
            retainedResults,
            closing: false,
            jobs: slots,
          },
        },
      },
    },
    commandList: {
      observedAt: now,
      data: {
        jobs,
        complete: true,
        nextOffset: null,
        issues: [],
        hasErrors: false,
      },
    },
  };
}
const slot = (jobId, status = 'running', kind = 'in_progress') => ({ jobId, status, kind });
const job = (id, status = 'running', completionPending = false) => ({ id, status, completionPending });
const codes = (result) => result.alerts.map((item) => item.code);

test('fresh empty evidence is idle and does not reserve six slots or infer agents', () => {
  const result = classifyOperationalAlerts(fixture());
  assert.equal(result.state, 'idle');
  assert.equal(result.readOnly, true);
  assert.equal(result.capacity.available, 6);
  assert.equal(result.capacity.reservation, false);
  assert.equal(result.jobs.complete, true);
  assert.deepEqual(result.alerts, []);
});

test('fresh slots distinguish live work, terminal finalization, and blocked publication', () => {
  const input = fixture(
    [slot('running'), slot('cancelled', 'cancelled'), slot('held', 'failed', 'retained_result')],
    [job('running'), job('cancelled', 'cancelled', true), job('held', 'failed')],
  );
  const result = classifyOperationalAlerts(input);
  assert.equal(result.state, 'blocked');
  assert.deepEqual(
    result.jobs.rows.map((row) => row.state),
    ['live_reported', 'finalizing', 'blocked'],
  );
  assert.equal(result.capacity.occupied, 3);
  assert.equal(result.capacity.inProgress, 2);
  assert.deepEqual(result.nextAction, { tool: 'command_status', jobId: 'held' });
  assert.ok(codes(result).includes('RESULT_PUBLICATION_BLOCKED'));
});

test('full live capacity is busy; retained results make capacity blocked', () => {
  for (const held of [false, true]) {
    const slots = Array.from({ length: 6 }, (_, i) =>
      slot(`j-${i}`, held ? 'failed' : 'running', held ? 'retained_result' : 'in_progress'),
    );
    const result = classifyOperationalAlerts(fixture(slots));
    assert.equal(result.state, held ? 'blocked' : 'live_reported');
    assert.ok(codes(result).includes(held ? 'CAPACITY_BLOCKED' : 'CAPACITY_BUSY'));
  }
});

test('closing owner blocks admission even with all slots available', () => {
  const input = fixture();
  input.diagnostics.data.jobs.capacity.closing = true;
  const result = classifyOperationalAlerts(input);
  assert.equal(result.state, 'blocked');
  assert.equal(result.nextAction.tool, 'diagnostics');
  assert.ok(codes(result).includes('OWNER_CLOSING'));
});

test('persisted running and pending records alone never prove live ownership', () => {
  const result = classifyOperationalAlerts(fixture([], [job('old'), job('pending', 'timed_out', true)]));
  assert.equal(result.jobs.counts.unknown, 2);
  assert.equal(result.capacity.occupied, 0);
  assert.equal(result.state, 'attention');
  assert.deepEqual(result.nextAction, { tool: 'command_status', jobId: 'old' });
});

test('all terminal statuses remain outcomes and do not consume owner slots', () => {
  const result = classifyOperationalAlerts(
    fixture(
      [],
      [
        job('passed', 'passed'),
        job('failed', 'failed'),
        job('cancelled', 'cancelled'),
        job('timed', 'timed_out'),
        job('interrupted', 'interrupted'),
      ],
    ),
  );
  assert.equal(result.jobs.counts.completed, 1);
  assert.equal(result.jobs.counts.attention, 4);
  assert.equal(result.jobs.counts.blocked, 0);
  assert.equal(result.capacity.occupied, 0);
});

test('stale observations never label retained or running slots currently blocked or live', () => {
  const input = fixture([slot('live'), slot('held', 'failed', 'retained_result')]);
  input.diagnostics.observedAt = old;
  const result = classifyOperationalAlerts(input);
  assert.equal(result.state, 'stale');
  assert.equal(result.jobs.counts.stale, 2);
  assert.equal(result.jobs.counts.blocked, 0);
  assert.ok(!codes(result).includes('RESULT_PUBLICATION_BLOCKED'));
  assert.equal(result.nextAction.tool, 'diagnostics');
});

test('staleness uses observation age, with an inclusive threshold, not job runtime', () => {
  const input = fixture(
    [slot('long-running')],
    [{ ...job('long-running'), startedAt: '2020-01-01T00:00:00Z' }],
  );
  input.diagnostics.observedAt = '2026-10-26T11:59:00Z';
  input.commandList.observedAt = input.diagnostics.observedAt;
  assert.equal(classifyOperationalAlerts(input).jobs.rows[0].state, 'live_reported');
  input.maxAgeSeconds = 59;
  assert.equal(classifyOperationalAlerts(input).state, 'stale');
});

test('fresh owner slot supersedes catalog, while stale slot cannot override fresh completion', () => {
  const input = fixture([slot('same')], [job('same', 'passed')]);
  assert.equal(classifyOperationalAlerts(input).jobs.rows[0].state, 'live_reported');
  input.diagnostics.observedAt = old;
  const result = classifyOperationalAlerts(input);
  assert.equal(result.jobs.rows[0].state, 'completed');
  assert.equal(result.jobs.rows.length, 1);
});

test('stale catalog refresh starts at zero and does not imply current outcome failures', () => {
  const input = fixture([], [job('failed', 'failed')]);
  input.commandList.observedAt = old;
  input.commandList.data.nextOffset = 90;
  const result = classifyOperationalAlerts(input);
  assert.equal(result.jobs.rows[0].state, 'stale');
  assert.deepEqual(result.nextAction, { tool: 'command_list', offset: 0 });
  assert.ok(!codes(result).includes('JOB_OUTCOME_ATTENTION'));
});

test('newer completed evidence supersedes an older slot even within the freshness window', () => {
  const input = fixture([slot('same')], [job('same', 'passed')]);
  input.diagnostics.observedAt = '2026-10-26T11:59:59Z';
  const result = classifyOperationalAlerts(input);
  assert.equal(result.jobs.rows[0].state, 'completed');
  assert.equal(result.jobs.counts.live_reported, 0);
  assert.equal(result.state, 'attention');
  assert.ok(codes(result).includes('CAPACITY_JOB_OBSERVATION_CHANGED'));
  assert.equal(result.capacity.occupied, 1, 'separate snapshots retain their own capacity evidence');
});

test('missing, future, invalid calendar dates and malformed inputs are unknown', () => {
  for (const observedAt of [undefined, '2026-10-26T12:00:01Z', '2026-02-30T00:00:00Z', 'no', 42]) {
    const input = fixture([slot('j')]);
    input.diagnostics.observedAt = observedAt;
    const result = classifyOperationalAlerts(input);
    assert.equal(result.state, 'unknown');
    assert.equal(result.jobs.rows[0].state, 'unknown');
  }
  for (const input of [undefined, null, {}, { now, diagnostics: { data: [] } }]) {
    const result = classifyOperationalAlerts(input);
    assert.equal(result.state, 'unknown');
    assert.equal(result.capacity.available, null);
    assert.equal(result.jobs.complete, false);
  }
});

test('invalid capacities cannot provide live or idle evidence', () => {
  const mutations = [
    (c) => {
      c.available = 6;
    },
    (c) => {
      c.limit = 7;
    },
    (c) => {
      c.inProgress = 0;
    },
    (c) => {
      c.closing = 'false';
    },
    (c) => {
      c.jobs.push(c.jobs[0]);
      c.occupied = 2;
      c.available = 4;
      c.inProgress = 2;
    },
    (c) => {
      c.jobs[0].kind = 'other';
    },
    (c) => {
      c.jobs[0].status = 'queued';
    },
    (c) => {
      c.jobs[0].kind = 'retained_result';
      c.retainedResults = 1;
      c.inProgress = 0;
    },
    (c) => {
      c.jobs = Array(1000).fill(c.jobs[0]);
    },
  ];
  for (const mutate of mutations) {
    const input = fixture([slot('j')], [job('j')]);
    mutate(input.diagnostics.data.jobs.capacity);
    const result = classifyOperationalAlerts(input);
    assert.equal(result.capacity.valid, false);
    assert.equal(result.state, 'unknown');
    assert.equal(result.jobs.rows[0].state, 'unknown');
  }
});

test('incomplete pages, catalog errors, malformed rows and duplicates stay explicit', () => {
  for (const field of [
    'catalogTruncated',
    'scanLimitReached',
    'outputLimitReached',
    'timeLimitReached',
    'hasErrors',
  ]) {
    const input = fixture();
    input.commandList.data[field] = true;
    assert.equal(classifyOperationalAlerts(input).jobs.complete, false);
  }
  const malformedFlag = fixture();
  malformedFlag.commandList.data.catalogTruncated = 'true';
  assert.equal(classifyOperationalAlerts(malformedFlag).jobs.complete, false);
  const input = fixture([], [job('ok', 'passed'), job('ok'), job('bad', 'queued'), {}]);
  input.commandList.data.nextOffset = 20;
  const result = classifyOperationalAlerts(input);
  assert.equal(result.jobs.invalidRows, 3);
  assert.equal(result.jobs.complete, false);
  assert.deepEqual(result.nextAction, { tool: 'command_list', offset: 20 });
});

test('bounds scanning and output; preserves owner rows and reports omissions', () => {
  const input = fixture(
    [slot('owner')],
    Array.from({ length: 10000 }, (_, i) => job(`saved-${i}`, 'passed')),
  );
  const result = classifyOperationalAlerts(input);
  assert.equal(result.jobs.rows.length, 20);
  assert.equal(result.jobs.rows[0].jobId, 'owner');
  assert.equal(result.jobs.rowsOmitted, 81);
  assert.equal(result.jobs.counts.completed, 100);
  assert.equal(result.jobs.inputTruncated, true);
  assert.equal(result.jobs.complete, false);
  assert.ok(JSON.stringify(result).length < 10000);
});

test('allowlists metadata and remains pure, deterministic and inspection-only', () => {
  const input = fixture([slot('held', 'failed', 'retained_result')], [job('saved', 'failed')]);
  input.diagnostics.data.password = 'PRIVATE_MARKER';
  input.commandList.data.jobs[0].output = 'PRIVATE_MARKER';
  input.commandList.data.jobs[0].error = 'PRIVATE_MARKER';
  input.commandList.data.jobs.push(job('token_PRIVATE_MARKER', 'failed'));
  const before = structuredClone(input);
  const freeze = (value) => {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
  };
  freeze(input);
  const result = classifyOperationalAlerts(input);
  assert.deepEqual(input, before);
  assert.deepEqual(result, classifyOperationalAlerts(input));
  assert.ok(!JSON.stringify(result).includes('PRIVATE_MARKER'));
  for (const action of [
    result.nextAction,
    ...result.alerts.map((a) => a.nextAction),
    ...result.jobs.rows.map((r) => r.nextAction),
  ])
    assert.ok(['diagnostics', 'command_list', 'command_status'].includes(action.tool));
});
