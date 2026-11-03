import assert from 'node:assert/strict';
import { formatStatus, serializeStatus, MAX_DESKTOP_LINE_CHARS } from '../../scripts/desktop-monitor-format.mjs';

let assertions = 0;
function check(value, message) {
  assert.ok(value, message);
  assertions++;
}
function parse(line) {
  check(line.endsWith('\n'), 'newline-delimited message');
  check(line.length - 1 <= MAX_DESKTOP_LINE_CHARS, 'serialized line within WPF input bound');
  return JSON.parse(line);
}

const basic = {
  version: '0.16.4-dev',
  tunnel: { ready: true, controlPlane: 'ok' },
  jobs: {
    runningJobs: 2,
    inventory: { complete: true },
    capacity: {
      limit: 36, occupied: 2, available: 34, retainedResults: 0,
      jobs: [
        { jobId: 'one', project: 'workbridge-mcp', status: 'running', kind: 'in_progress', nextAction: 'command_status' },
        { jobId: 'two', project: 'riftreader2', status: 'passed', kind: 'retained_result', nextAction: 'command_retry_save' }
      ]
    }
  }
};
const normal = parse(serializeStatus(formatStatus(basic, {})));
check(normal.ok === true && normal.inventoryComplete === true, 'normal healthy complete sample');
check(normal.jobs.length === 2 && normal.capacity.limit === 36, 'normal job identifiers/counters preserved');
check(normal.version === '0.16.4-dev' && normal.tunnelReady, 'normal version and tunnel state preserved');

const partialCounters = structuredClone(basic);
partialCounters.jobs.capacity.limit = null;
partialCounters.jobs.capacity.occupied = null;
partialCounters.jobs.capacity.available = null;
partialCounters.jobs.runningJobs = null;
partialCounters.jobs.inventory.complete = false;
const unknownCounts = parse(serializeStatus(formatStatus(partialCounters, {})));
check(unknownCounts.ok && unknownCounts.tunnelReady, 'unknown counts do not mean disconnected');
check(unknownCounts.capacity.limit === null && unknownCounts.capacity.occupied === null &&
      unknownCounts.runningJobs === null, 'unknown counts preserved as null');
check(unknownCounts.inventoryComplete === false, 'partial inventory remains labeled partial');

const hugeJob = { jobId: 'J'.repeat(2000), project: '\u0000'.repeat(100_000),
  status: 'running', kind: 'in_progress', nextAction: 'command_status' };
const all = structuredClone(basic);
all.jobs.capacity.jobs = Array.from({ length: 2000 }, (_, i) => ({ ...hugeJob, jobId: 'job_' + i }));
const bounded = parse(serializeStatus(formatStatus(all, {})));
check(bounded.ok === true, 'healthy engine preserved under oversized job inventory');
check(bounded.inventoryComplete === false, 'truncated inventory explicitly partial');
check(bounded.jobs.length <= 36, 'at most 36 job rows');
check(bounded.capacity.available === 34, 'capacity counters preserved when trimming');
check(bounded.jobs.every(x => x.project.length <= 512), 'project text bounded before serialization');

const escaping = structuredClone(basic);
escaping.jobs.capacity.jobs = Array.from({ length: 36 }, (_, i) => ({
  ...hugeJob, jobId: 'id_' + i, project: '\u0000'.repeat(512)
}));
const escapeResult = parse(serializeStatus(formatStatus(escaping, {})));
check(escapeResult.inventoryComplete === false, 'escaped job metadata is not falsely complete');
check(escapeResult.jobs.length <= 36, 'escape-heavy rows bounded');

const tooLarge = parse(serializeStatus({
  ok: true, version: 'x'.repeat(300_000), inventoryComplete: true, jobs: []
}));
check(tooLarge.ok === false, 'unbounded non-job fields produce bounded failure');
check(tooLarge.error === 'Diagnostic sample exceeds desktop transport limit',
  'oversize fallback reports diagnostic error without leaking payload');

const disconnected = parse(serializeStatus({ ok: false, error: 'Workbridge status unavailable' }));
check(disconnected.ok === false, 'offline sample preserved');

process.stdout.write('PASS: ' + assertions + ' desktop monitor format assertions\n');
