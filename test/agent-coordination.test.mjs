import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, lstat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import fsPromises from 'node:fs/promises';
import { registerHooks, stripTypeScriptTypes, syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { parsers } from 'prettier/plugins/typescript';

// Exercise current source without generating or importing dist/. The hook is local to
// this test process and maps repository .js specifiers to their TypeScript sources.
const sourceRoot = new URL('../src/', import.meta.url).href;
function executableSource(source) {
  // Node 26 strips types but rejects the existing dependencies' parameter properties.
  // Use the installed TS parser to lower only those constructor assignments in memory.
  const edits = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'MethodDefinition' && node.kind === 'constructor') {
      const properties = node.value.params.filter((p) => p.type === 'TSParameterProperty');
      if (properties.length) {
        const body = node.value.body;
        const first = body.body[0];
        const offset = first?.expression?.callee?.type === 'Super' ? first.range[1] : body.range[0] + 1;
        const assignments = properties
          .map((p) => {
            assert.equal(p.parameter.type, 'Identifier');
            edits.push([p.range[0], p.parameter.range[0], '']);
            return 'this.' + p.parameter.name + ' = ' + p.parameter.name + ';';
          })
          .join('');
        edits.push([offset, offset, assignments]);
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc' || key === 'range') continue;
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  }
  visit(parsers.typescript.parse(source, {}));
  for (const [start, end, text] of edits.sort((a, b) => b[0] - a[0]))
    source = source.slice(0, start) + text + source.slice(end);
  return stripTypeScriptTypes(source);
}
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.startsWith(sourceRoot) && specifier.startsWith('.') && specifier.endsWith('.js')) {
      return next(`${specifier.slice(0, -3)}.ts`, context);
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith(sourceRoot) && url.endsWith('.ts')) {
      return {
        format: 'module',
        source: executableSource(readFileSync(fileURLToPath(url), 'utf8')),
        shortCircuit: true,
      };
    }
    return next(url, context);
  },
});
const { AgentCoordination, MAX_AGENT_WORKERS, agentCoordinationBytes } =
  await import('../src/agent-coordination.ts');
const { Workspace } = await import('../src/workspace.ts');
const { digest } = await import('../src/changes.ts');
const baseHead = 'a'.repeat(40);
const temporary = [];
after(async () => {
  for (const root of temporary) await rm(root, { recursive: true, force: true });
});
class FakeJobs {
  records = new Map();
  reads = 0;
  async status(id) {
    this.reads++;
    const record = this.records.get(id);
    if (!record) throw Object.assign(new Error('Unknown fixture job'), { code: 'UNKNOWN_JOB' });
    return structuredClone(record);
  }
  running(id) {
    this.records.set(id, { id, status: 'running', exitCode: null, completionPending: false });
  }
  complete(id, updates = {}) {
    this.records.set(id, { id, status: 'passed', exitCode: 0, completionPending: false, ...updates });
  }
}
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wb-agent-coordination-'));
  temporary.push(root);
  const directory = path.join(root, '.state', 'agents');
  const workspace = await Workspace.create(root);
  const jobs = new FakeJobs();
  const state = { head: baseHead };
  const create = () => new AgentCoordination(workspace, directory, jobs, async () => state.head);
  return { root, directory, jobs, state, create, agents: create() };
}
const assignment = (n, extra = {}) => ({
  taskId: `task-${n}`,
  workerId: `worker-${n}`,
  ownedPaths: [`file-${n}.ts`],
  baseHead,
  ...extra,
});
const dispatch = (n, extra = {}) => ({
  taskId: `task-${n}`,
  workerId: `worker-${n}`,
  jobId: `job-${n}`,
  baseHead,
  ...extra,
});
const receipt = (extra = {}) => ({ outcome: 'completed', testExitCodes: [0], artifacts: [], ...extra });
const finish = (n, extra = {}) => ({ ...dispatch(n), receipt: receipt(), ...extra });
const rejects = async (action, code) =>
  assert.rejects(
    async () => action(),
    (error) => error.code === code,
  );
const ledgerFile = (f) => path.join(f.directory, 'assignments.json');
async function start(f, n, extra = {}) {
  await f.agents.assign(assignment(n, extra));
  f.jobs.running(`job-${n}`);
  return f.agents.dispatch(dispatch(n));
}

test('durable lifecycle, canonical assignment replay, sanitized finish, explicit review and restart', async () => {
  const f = await fixture();
  await mkdir(path.join(f.root, 'src'));
  await writeFile(path.join(f.root, 'file-1.ts'), 'export const value = 1;\n');
  const args = assignment(1, { ownedPaths: ['src/new.ts', 'file-1.ts'], workflowId: 'existing-workflow' });
  const queued = await f.agents.assign(args);
  assert.equal(queued.state, 'queued');
  assert.deepEqual(
    queued.ownedPaths,
    [path.join(f.root, 'file-1.ts'), path.join(f.root, 'src', 'new.ts')].sort(),
  );
  const initial = await readFile(ledgerFile(f), 'utf8');
  assert.deepEqual(
    await f.create().assign({ ...args, ownedPaths: ['./file-1.ts', 'src/../src/new.ts'] }),
    queued,
  );
  assert.equal(await readFile(ledgerFile(f), 'utf8'), initial);
  f.jobs.running('job-1');
  const running = await f.agents.dispatch(dispatch(1));
  assert.equal(running.state, 'running');
  const runningBytes = await readFile(ledgerFile(f), 'utf8');
  assert.deepEqual(await f.create().dispatch(dispatch(1)), running);
  assert.equal(await readFile(ledgerFile(f), 'utf8'), runningBytes);
  f.jobs.complete('job-1');
  const finished = await f.agents.finish(
    finish(1, {
      receipt: {
        ...receipt(),
        rawOutput: 'SECRET_TOKEN=do-not-persist',
        environment: { token: 'SECRET' },
        artifacts: [{ path: 'file-1.ts', sha256: digest('export const value = 1;\n'), rawOutput: 'SECRET' }],
      },
    }),
  );
  assert.equal(finished.state, 'review');
  assert.deepEqual(Object.keys(finished.receipt).sort(), ['artifacts', 'outcome', 'testExitCodes']);
  assert.equal(JSON.stringify(finished).includes('SECRET'), false);
  const reviewBytes = await readFile(ledgerFile(f), 'utf8');
  assert.equal(reviewBytes.includes('SECRET'), false);
  assert.deepEqual(
    await f.create().finish(finish(1, { receipt: { ...finished.receipt, stdout: 'DIFFERENT_SECRET' } })),
    finished,
  );
  assert.equal(await readFile(ledgerFile(f), 'utf8'), reviewBytes);
  await rejects(
    () => f.agents.finish(finish(1, { receipt: receipt({ testExitCodes: [1] }) })),
    'AGENT_FINISH_CONFLICT',
  );
  const verified = await f.create().verify({ taskId: 'task-1', baseHead });
  assert.equal(verified.state, 'verified');
  assert.deepEqual(await f.agents.verify({ taskId: 'task-1', baseHead }), verified);
  assert.equal((await f.create().list()).tasks[0].state, 'verified');
  assert.equal(
    (await f.agents.assign(assignment(2, { ownedPaths: ['file-1.ts'], dependencies: ['task-1'] }))).state,
    'queued',
  );
});

test('one writer reserves queued, running, review and blocked paths, including case and parent aliases', async () => {
  for (const targetState of ['queued', 'running', 'review', 'blocked']) {
    const f = await fixture();
    await f.agents.assign(assignment(1, { ownedPaths: ['new/thing.ts'] }));
    if (targetState !== 'queued') {
      f.jobs.running('job-1');
      await f.agents.dispatch(dispatch(1));
      if (targetState !== 'running') {
        f.jobs.complete('job-1', targetState === 'blocked' ? { status: 'failed', exitCode: 1 } : {});
        await f.agents.finish(finish(1));
      }
    }
    for (const ownedPaths of [['new/thing.ts'], ['NEW/THING.ts'], ['new'], ['new/thing.ts/child']]) {
      await rejects(() => f.create().assign(assignment(2, { ownedPaths })), 'AGENT_PATH_CONFLICT');
    }
    assert.equal((await f.agents.list()).tasks.length, 1);
  }
});

test('strict IDs, unknown fields, duplicate paths, duplicate/self/unknown dependencies and task ID reuse', async () => {
  const f = await fixture();
  await rejects(() => f.agents.assign(assignment('../escape')), 'INVALID_AGENT_ASSIGNMENT');
  await rejects(
    () => f.agents.assign(assignment(1, { executable: 'forbidden' })),
    'INVALID_AGENT_ASSIGNMENT',
  );
  await rejects(() => f.agents.assign(assignment(1, { baseHead: 'unverified' })), 'INVALID_AGENT_ASSIGNMENT');
  await rejects(() => f.agents.assign(assignment(1, { ownedPaths: ['a', './a'] })), 'AGENT_PATH_CONFLICT');
  await rejects(
    () => f.agents.assign(assignment(1, { ownedPaths: ['a', 'a/child'] })),
    'AGENT_PATH_CONFLICT',
  );
  await rejects(() => f.agents.assign(assignment(1, { dependencies: ['task-1'] })), 'AGENT_DEPENDENCY');
  await rejects(
    () => f.agents.assign(assignment(1, { dependencies: ['missing', 'missing'] })),
    'AGENT_DEPENDENCY',
  );
  await rejects(() => f.agents.assign(assignment(1, { dependencies: ['missing'] })), 'UNKNOWN_AGENT_TASK');
  await f.agents.assign(assignment(1));
  await rejects(() => f.agents.assign(assignment(1, { priority: 1 })), 'AGENT_ID_REUSE');
  await rejects(() => f.agents.assign(assignment(1, { workerId: 'other-worker' })), 'AGENT_ID_REUSE');
  await rejects(() => f.agents.assign(assignment(1, { ownedPaths: ['other.ts'] })), 'AGENT_ID_REUSE');
  assert.equal((await f.agents.list()).tasks.length, 1);
});

test('dependencies require verified evidence; finish and list never automatically dispatch', async () => {
  const f = await fixture();
  await start(f, 1);
  await f.agents.assign(assignment(2, { dependencies: ['task-1'] }));
  f.jobs.running('job-2');
  await rejects(() => f.agents.dispatch(dispatch(2)), 'AGENT_DEPENDENCY');
  f.jobs.complete('job-1');
  await f.agents.finish(finish(1));
  await rejects(() => f.agents.dispatch(dispatch(2)), 'AGENT_DEPENDENCY');
  await f.agents.verify({ taskId: 'task-1', baseHead });
  assert.equal((await f.agents.list()).tasks[1].state, 'queued');
  const next = await f.agents.dispatchNext({ workerId: 'worker-2', jobId: 'job-2', baseHead });
  assert.equal(next.taskId, 'task-2');
  assert.equal(next.state, 'running');
});

test('explicit dispatchNext prioritizes eligible queued tasks and never reuses a completed job for new work', async () => {
  const f = await fixture();
  const workerId = 'one-worker';
  for (const [n, priority] of [
    [1, 1],
    [2, 100],
    [3, 100],
  ])
    await f.agents.assign(assignment(n, { workerId, priority }));
  const request = { workerId, jobId: 'next-job', baseHead };
  f.jobs.running(request.jobId);
  const next = await f.agents.dispatchNext(request);
  assert.equal(next.taskId, 'task-2');
  f.jobs.complete(request.jobId);
  await f.agents.finish({ ...request, taskId: next.taskId, receipt: receipt() });
  assert.equal((await f.agents.dispatchNext(request)).taskId, 'task-2');
  assert.equal((await f.agents.list()).tasks.filter((t) => t.state === 'queued').length, 2);
  f.jobs.running('next-job-2');
  assert.equal((await f.agents.dispatchNext({ ...request, jobId: 'next-job-2' })).taskId, 'task-3');
  assert.equal(await f.agents.dispatchNext({ ...request, workerId: 'empty-worker', jobId: 'unused' }), null);
});

test('thirty-six-worker limit retains logical coordinator and requires explicit dispatch after settlement', async () => {
  const f = await fixture();
  assert.equal(MAX_AGENT_WORKERS, 36);
  for (let n = 1; n <= MAX_AGENT_WORKERS; n++) await start(f, n);
  const overflow = MAX_AGENT_WORKERS + 1;
  await f.agents.assign(assignment(overflow));
  f.jobs.running(`job-${overflow}`);
  await rejects(() => f.agents.dispatch(dispatch(overflow)), 'AGENT_CAPACITY');
  const full = await f.agents.list();
  assert.equal(full.maxWorkers, MAX_AGENT_WORKERS);
  assert.equal(full.running, MAX_AGENT_WORKERS);
  assert.equal(full.available, 0);
  assert.equal(full.coordinatorSlots, 1); // Logical role, not a reserved command-job slot.
  f.jobs.complete('job-1');
  // Existing job settlement alone does not alter recorded metadata or free a slot.
  await rejects(() => f.agents.dispatch(dispatch(overflow)), 'AGENT_CAPACITY');
  await f.agents.finish(finish(1));
  assert.equal((await f.agents.list()).tasks.at(-1).state, 'queued');
  const next = await f.agents.dispatchNext({
    workerId: `worker-${overflow}`,
    jobId: `job-${overflow}`,
    baseHead,
  });
  assert.equal(next.state, 'running');
  assert.equal((await f.agents.list()).running, MAX_AGENT_WORKERS);
});

test('dispatch accepts an active job with pending completion, but finish waits for durable publication', async () => {
  const f = await fixture();
  await f.agents.assign(assignment(1));
  f.jobs.running('job-1');
  f.jobs.records.get('job-1').completionPending = true;
  assert.equal((await f.agents.dispatch(dispatch(1))).state, 'running');
  f.jobs.complete('job-1', { completionPending: true });
  await rejects(() => f.agents.finish(finish(1)), 'AGENT_JOB_UNSETTLED');
  f.jobs.complete('job-1');
  assert.equal((await f.agents.finish(finish(1))).state, 'review');
});

test('one running task per worker; job IDs cannot be shared or rebound', async () => {
  const f = await fixture();
  await start(f, 1);
  await f.agents.assign(assignment(2, { workerId: 'worker-1' }));
  await f.agents.assign(assignment(3));
  f.jobs.running('job-2');
  await rejects(() => f.agents.dispatch(dispatch(2, { workerId: 'worker-1' })), 'AGENT_WORKER_BUSY');
  await rejects(() => f.agents.dispatch(dispatch(3, { jobId: 'job-1' })), 'AGENT_JOB_REUSE');
  await rejects(() => f.agents.dispatch(dispatch(1, { jobId: 'job-2' })), 'AGENT_STATE');
  await rejects(() => f.agents.dispatch(dispatch(1, { workerId: 'wrong' })), 'AGENT_IDENTITY_MISMATCH');
  await rejects(() => f.agents.finish(finish(1, { jobId: 'other' })), 'AGENT_IDENTITY_MISMATCH');
});

test('stale base rejected at assign, dispatch, finish and verify without changing journal', async () => {
  const f = await fixture();
  await start(f, 1);
  const before = await readFile(ledgerFile(f), 'utf8');
  f.state.head = 'b'.repeat(40);
  await rejects(() => f.agents.assign(assignment(2)), 'STALE_AGENT_ASSIGNMENT');
  await rejects(() => f.agents.dispatch(dispatch(1)), 'STALE_AGENT_ASSIGNMENT');
  f.jobs.complete('job-1');
  await rejects(() => f.agents.finish(finish(1)), 'STALE_AGENT_ASSIGNMENT');
  await rejects(() => f.agents.verify({ taskId: 'task-1', baseHead }), 'STALE_AGENT_ASSIGNMENT');
  assert.equal(await readFile(ledgerFile(f), 'utf8'), before);
  f.state.head = baseHead;
  await f.agents.finish(finish(1));
  f.state.head = 'c'.repeat(40);
  await rejects(() => f.agents.verify({ taskId: 'task-1', baseHead }), 'STALE_AGENT_ASSIGNMENT');
});

test('HEAD rechecked after awaited job evidence before any durable transition', async () => {
  const f = await fixture();
  await f.agents.assign(assignment(1));
  f.jobs.running('job-1');
  const before = await readFile(ledgerFile(f), 'utf8');
  const original = f.jobs.status.bind(f.jobs);
  f.jobs.status = async (jobId) => {
    const job = await original(jobId);
    f.state.head = 'b'.repeat(40);
    return job;
  };
  await rejects(() => f.agents.dispatch(dispatch(1)), 'STALE_AGENT_ASSIGNMENT');
  assert.equal(await readFile(ledgerFile(f), 'utf8'), before);
});

test('existing job identity and settlement guard review, failures block and retain file ownership', async () => {
  const f = await fixture();
  await f.agents.assign(assignment(1));
  await rejects(() => f.agents.dispatch(dispatch(1)), 'UNKNOWN_JOB');
  f.jobs.complete('job-1');
  await rejects(() => f.agents.dispatch(dispatch(1)), 'AGENT_JOB_STATE');
  f.jobs.running('job-1');
  f.jobs.records.get('job-1').id = 'wrong';
  await rejects(() => f.agents.dispatch(dispatch(1)), 'AGENT_JOB_MISMATCH');
  f.jobs.running('job-1');
  await f.agents.dispatch(dispatch(1));
  await rejects(() => f.agents.finish(finish(1)), 'AGENT_JOB_UNSETTLED');
  f.jobs.complete('job-1', { completionPending: true });
  await rejects(() => f.agents.finish(finish(1)), 'AGENT_JOB_UNSETTLED');
  f.jobs.complete('job-1', { status: 'failed', exitCode: 1 });
  assert.equal((await f.agents.finish(finish(1))).state, 'blocked');
  await rejects(() => f.agents.verify({ taskId: 'task-1', baseHead }), 'AGENT_STATE');
  await rejects(() => f.agents.assign(assignment(2, { ownedPaths: ['file-1.ts'] })), 'AGENT_PATH_CONFLICT');
});

test('failed, absent and explicitly blocked test evidence never verifies; receipts cannot claim unowned paths', async () => {
  for (const evidence of [
    receipt({ testExitCodes: [1] }),
    receipt({ testExitCodes: [] }),
    receipt({ outcome: 'blocked' }),
  ]) {
    const f = await fixture();
    await start(f, 1);
    f.jobs.complete('job-1');
    assert.equal((await f.agents.finish(finish(1, { receipt: evidence }))).state, 'blocked');
    await rejects(() => f.agents.verify({ taskId: 'task-1', baseHead }), 'AGENT_STATE');
  }
  const f = await fixture();
  await start(f, 1);
  f.jobs.complete('job-1');
  await rejects(
    () =>
      f.agents.finish(
        finish(1, { receipt: receipt({ artifacts: [{ path: 'unowned.ts', sha256: 'a'.repeat(64) }] }) }),
      ),
    'AGENT_RECEIPT_SCOPE',
  );
  const artifact = { path: 'file-1.ts', sha256: 'a'.repeat(64) };
  await rejects(
    () => f.agents.finish(finish(1, { receipt: receipt({ artifacts: [artifact, artifact] }) })),
    'AGENT_RECEIPT_SCOPE',
  );
});

test('parallel independent owners cannot lose assignments or obtain overlapping ownership', async () => {
  const f = await fixture();
  const outcomes = await Promise.allSettled(
    Array.from({ length: 12 }, (_, n) => f.create().assign(assignment(n, { ownedPaths: ['shared.ts'] }))),
  );
  assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(
    outcomes.filter((r) => r.status === 'rejected' && r.reason.code === 'AGENT_PATH_CONFLICT').length,
    11,
  );
  // The bounded cross-process lock may return BUSY under a saturated parallel test runner.
  // Re-issue only that explicit transient refusal; assigning the same task ID is idempotent.
  const independent = await Promise.allSettled(
    Array.from({ length: 15 }, (_, n) => f.create().assign(assignment(n + 20))),
  );
  for (const [n, outcome] of independent.entries()) {
    if (outcome.status === 'fulfilled') continue;
    assert.equal(outcome.reason?.code, 'AGENT_COORDINATION_BUSY');
    await f.create().assign(assignment(n + 20));
  }
  assert.equal((await f.agents.list()).tasks.length, 16);
  assert.equal((await f.agents.list()).revision, 16);
});

test('parallel dispatch capacity is atomic at thirty-six workers across independent instances', async () => {
  const f = await fixture();
  const requests = MAX_AGENT_WORKERS + 1;
  // Set up the full queue before the concurrent dispatch race under test.
  for (let n = 0; n < requests; n++) await f.create().assign(assignment(n));
  for (let n = 0; n < requests; n++) f.jobs.running(`job-${n}`);
  const dispatchWithRetry = async (n) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await f.create().dispatch(dispatch(n));
      } catch (error) {
        if (error?.code !== 'AGENT_COORDINATION_BUSY' || attempt >= 7) throw error;
        // A transient lock wait under heavy parallel test load is not a capacity rejection.
        await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
      }
    }
  };
  const outcomes = await Promise.allSettled(Array.from({ length: requests }, (_, n) => dispatchWithRetry(n)));
  assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, MAX_AGENT_WORKERS);
  assert.equal(
    outcomes.filter((r) => r.status === 'rejected' && r.reason.code === 'AGENT_CAPACITY').length,
    1,
  );
  assert.equal((await f.create().list()).running, MAX_AGENT_WORKERS);
});

test('parallel idempotent assign and finish publish exactly one revision each', async () => {
  const f = await fixture();
  const assigned = await Promise.all(Array.from({ length: 8 }, () => f.create().assign(assignment(1))));
  assert.ok(assigned.every((r) => r.requestHash === assigned[0].requestHash));
  assert.equal((await f.agents.list()).revision, 1);
  f.jobs.running('job-1');
  await f.agents.dispatch(dispatch(1));
  f.jobs.complete('job-1');
  const finished = await Promise.all(Array.from({ length: 8 }, () => f.create().finish(finish(1))));
  assert.ok(finished.every((r) => r.state === 'review'));
  assert.equal((await f.agents.list()).revision, 3);
});

test('journal corruption, overlarge reads, task graph tampering and identity mismatch fail closed', async () => {
  const f = await fixture();
  await f.agents.assign(assignment(1));
  const valid = await readFile(ledgerFile(f), 'utf8');
  for (const invalid of ['{', ' '.repeat(agentCoordinationBytes + 1)]) {
    await writeFile(ledgerFile(f), invalid);
    await rejects(() => f.agents.list(), 'CORRUPT_AGENT_STORAGE');
    assert.equal(await readFile(ledgerFile(f), 'utf8'), invalid);
  }
  for (const mutate of [
    (v) => v.tasks.push(v.tasks[0]),
    (v) => {
      v.tasks[0].priority = 50;
    },
    (v) => {
      v.tasks[0].dependencies = ['task-1'];
    },
    (v) => {
      v.tasks[0].state = 'running';
    },
  ]) {
    const value = JSON.parse(valid);
    mutate(value);
    await writeFile(ledgerFile(f), JSON.stringify(value));
    await rejects(() => f.agents.list(), 'CORRUPT_AGENT_STORAGE');
  }
  const value = JSON.parse(valid);
  value.workspaceRoot = path.join(f.root, 'other');
  await writeFile(ledgerFile(f), JSON.stringify(value));
  await rejects(() => f.agents.list(), 'AGENT_WORKSPACE_MISMATCH');
});

test('out-of-band journal replacement is hash guarded before publication', async () => {
  const f = await fixture();
  await f.agents.assign(assignment(1));
  const original = await readFile(ledgerFile(f), 'utf8');
  f.jobs.running('job-1');
  const status = f.jobs.status.bind(f.jobs);
  f.jobs.status = async (id) => {
    const data = JSON.parse(original);
    data.revision++;
    await writeFile(ledgerFile(f), JSON.stringify(data));
    return status(id);
  };
  await rejects(() => f.agents.dispatch(dispatch(1)), 'AGENT_SAVE_CONFLICT');
  assert.equal(JSON.parse(await readFile(ledgerFile(f), 'utf8')).tasks[0].state, 'queued');
});

test('stale locks are never stolen; directory journals cannot be overwritten', async () => {
  const f = await fixture();
  await f.agents.list();
  const lock = path.join(f.directory, 'assignments.lock');
  await writeFile(lock, 'fixture abandoned owner', { flag: 'wx' });
  await rejects(() => f.agents.assign(assignment(1)), 'AGENT_COORDINATION_BUSY');
  assert.equal(await readFile(lock, 'utf8'), 'fixture abandoned owner');
  await rm(lock);
  await mkdir(ledgerFile(f));
  await rejects(() => f.agents.assign(assignment(1)), 'CORRUPT_AGENT_STORAGE');
  assert.equal((await lstat(ledgerFile(f))).isDirectory(), true);
});

test('assignment path validation reuses workspace boundaries and disallows directories, streams and runtime state', async () => {
  const f = await fixture();
  await mkdir(path.join(f.root, 'existing'));
  for (const [ownedPaths, code] of [
    [['../escape.ts'], 'OUTSIDE_ROOT'],
    [['.git/config'], 'GIT_INTERNAL'],
    [['.state/agents/secret'], 'PROTECTED_PATH'],
    [['existing'], 'INVALID_AGENT_PATH'],
    [['file.ts:stream'], 'INVALID_PATH'],
    [['file.ts.'], 'INVALID_PATH'],
  ])
    await rejects(() => f.agents.assign(assignment(1, { ownedPaths })), code);
  assert.equal(
    (await f.agents.assign(assignment(1, { ownedPaths: ['missing/parents/new.ts'] }))).state,
    'queued',
  );
});

test('symlinked storage parents are rejected before writing through them', async () => {
  const f = await fixture();
  const target = path.join(f.root, 'external');
  await mkdir(target);
  const linked = path.join(f.root, 'linked');
  // Windows junction creation needs no file-symlink privilege.
  await symlink(target, linked, process.platform === 'win32' ? 'junction' : 'dir');
  const workspace = await Workspace.create(f.root);
  const agents = new AgentCoordination(workspace, path.join(linked, 'agents'), f.jobs, async () => baseHead);
  await rejects(() => agents.assign(assignment(1)), 'CORRUPT_AGENT_STORAGE');
  await assert.rejects(lstat(path.join(target, 'agents')), { code: 'ENOENT' });
});

test('paths replaced with junctions after assignment cannot dispatch', async () => {
  const f = await fixture();
  const parent = path.join(f.root, 'parent');
  const other = path.join(f.root, 'other');
  await mkdir(parent);
  await mkdir(other);
  await f.agents.assign(assignment(1, { ownedPaths: ['parent/new.ts'] }));
  await rm(parent, { recursive: true });
  await symlink(other, parent, process.platform === 'win32' ? 'junction' : 'dir');
  f.jobs.running('job-1');
  await rejects(() => f.agents.dispatch(dispatch(1)), 'LINK_NOT_ALLOWED');
});

test('bounded assignment and receipt schemas reject large inputs without leaking payloads', async () => {
  const f = await fixture();
  await rejects(
    () =>
      f.agents.assign(
        assignment(1, { ownedPaths: Array.from({ length: 100 }, (_, n) => `${n}-${'a'.repeat(500)}`) }),
      ),
    'AGENT_LIMIT',
  );
  await rejects(
    () => f.agents.assign(assignment(1, { ownedPaths: Array.from({ length: 101 }, (_, n) => `${n}.ts`) })),
    'INVALID_AGENT_ASSIGNMENT',
  );
  await start(f, 1);
  f.jobs.complete('job-1');
  await rejects(
    () => f.agents.finish(finish(1, { receipt: receipt({ testExitCodes: Array(101).fill(0) }) })),
    'INVALID_AGENT_ASSIGNMENT',
  );
  await rejects(
    () =>
      f.agents.finish(
        finish(1, {
          receipt: receipt({ artifacts: [{ path: 'file-1.ts', sha256: 'SECRET-invalid-hash' }] }),
        }),
      ),
    'INVALID_AGENT_ASSIGNMENT',
  );
  assert.equal((await f.agents.list()).tasks[0].receipt, null);
});

test('verification refuses missing or changed declared artifact hashes without releasing ownership', async () => {
  const f = await fixture();
  const artifactPath = path.join(f.root, 'file-1.ts');
  await writeFile(artifactPath, 'original\n');
  await start(f, 1);
  f.jobs.complete('job-1');
  await f.agents.finish(
    finish(1, {
      receipt: receipt({ artifacts: [{ path: 'file-1.ts', sha256: digest('original\n') }] }),
    }),
  );
  const reviewBytes = await readFile(ledgerFile(f), 'utf8');
  await writeFile(artifactPath, 'changed\n');
  await rejects(() => f.agents.verify({ taskId: 'task-1', baseHead }), 'AGENT_ARTIFACT_MISMATCH');
  assert.equal(await readFile(ledgerFile(f), 'utf8'), reviewBytes);
  await rm(artifactPath);
  await rejects(() => f.agents.verify({ taskId: 'task-1', baseHead }), 'AGENT_ARTIFACT_MISMATCH');
  assert.equal(await readFile(ledgerFile(f), 'utf8'), reviewBytes);
  await writeFile(artifactPath, 'original\n');
  assert.equal((await f.agents.verify({ taskId: 'task-1', baseHead })).state, 'verified');
});

test('verification rechecks job publication rather than trusting a previously successful receipt', async () => {
  const f = await fixture();
  await start(f, 1);
  f.jobs.complete('job-1');
  await f.agents.finish(finish(1));
  const before = digest(await readFile(ledgerFile(f)));
  f.jobs.complete('job-1', { completionPending: true });
  await rejects(() => f.agents.verify({ taskId: 'task-1', baseHead }), 'AGENT_JOB_UNSETTLED');
  assert.equal(digest(await readFile(ledgerFile(f))), before);
});

test('replacement locks are retained and block publication by the old owner', async () => {
  const f = await fixture();
  await f.agents.assign(assignment(1));
  f.jobs.running('job-1');
  const before = await readFile(ledgerFile(f), 'utf8');
  const lock = path.join(f.directory, 'assignments.lock');
  const status = f.jobs.status.bind(f.jobs);
  f.jobs.status = async (id) => {
    await rm(lock);
    await writeFile(lock, 'replacement fixture lock belongs to another owner', { flag: 'wx' });
    return status(id);
  };
  await rejects(() => f.agents.dispatch(dispatch(1)), 'AGENT_LOCK_LOST');
  assert.equal(await readFile(ledgerFile(f), 'utf8'), before);
  assert.equal(await readFile(lock, 'utf8'), 'replacement fixture lock belongs to another owner');
});

test('paths are revalidated after awaiting job evidence', async () => {
  const f = await fixture();
  const parent = path.join(f.root, 'parent');
  const other = path.join(f.root, 'other');
  await mkdir(parent);
  await mkdir(other);
  await f.agents.assign(assignment(1, { ownedPaths: ['parent/new.ts'] }));
  f.jobs.running('job-1');
  const status = f.jobs.status.bind(f.jobs);
  f.jobs.status = async (id) => {
    await rm(parent, { recursive: true });
    await symlink(other, parent, process.platform === 'win32' ? 'junction' : 'dir');
    return status(id);
  };
  await rejects(() => f.agents.dispatch(dispatch(1)), 'LINK_NOT_ALLOWED');
  assert.equal((await f.agents.list()).tasks[0].state, 'queued');
});

test('lock handles close before unlink on success and failure under Windows delete semantics', async (t) => {
  const f = await fixture();
  const lock = path.join(f.directory, 'assignments.lock');
  const originalOpen = fsPromises.open;
  const originalUnlink = fsPromises.unlink;
  const held = new Set();
  let releases = 0;
  t.mock.method(fsPromises, 'open', async (file, ...args) => {
    const handle = await originalOpen(file, ...args);
    if (file === lock) {
      held.add(handle);
      const close = handle.close.bind(handle);
      handle.close = async () => {
        await close();
        held.delete(handle);
      };
    }
    return handle;
  });
  t.mock.method(fsPromises, 'unlink', async (file, ...args) => {
    if (file === lock) {
      // Model Windows sharing failures deterministically, including on other hosts.
      if (held.size) throw Object.assign(new Error('Lock handle still open'), { code: 'EPERM' });
      releases++;
    }
    return originalUnlink(file, ...args);
  });
  syncBuiltinESMExports();
  try {
    await f.agents.assign(assignment(1));
    await assert.rejects(lstat(lock), { code: 'ENOENT' });
    await rejects(() => f.agents.dispatch(dispatch(1)), 'UNKNOWN_JOB');
    await assert.rejects(lstat(lock), { code: 'ENOENT' });
    assert.equal((await f.create().list()).tasks[0].state, 'queued');
    assert.equal(releases, 3);
    assert.equal(held.size, 0);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test(
  'Windows delete-pending acquisition is retried, while persistent EPERM remains an error',
  {
    skip: process.platform !== 'win32',
  },
  async (t) => {
    const f = await fixture();
    const lock = path.join(f.directory, 'assignments.lock');
    const originalOpen = fsPromises.open;
    let attempts = 0;
    let persistent = false;
    t.mock.method(fsPromises, 'open', async (file, ...args) => {
      if (file === lock && (++attempts === 1 || persistent))
        throw Object.assign(new Error('Windows delete-pending fixture'), { code: 'EPERM' });
      return originalOpen(file, ...args);
    });
    syncBuiltinESMExports();
    try {
      assert.equal((await f.agents.assign(assignment(1))).state, 'queued');
      assert.equal(attempts, 2);
      const before = await readFile(ledgerFile(f), 'utf8');
      attempts = 0;
      persistent = true;
      await rejects(() => f.create().assign(assignment(2)), 'EPERM');
      assert.equal(attempts, 101);
      assert.equal(await readFile(ledgerFile(f), 'utf8'), before);
      await assert.rejects(lstat(lock), { code: 'ENOENT' });
    } finally {
      t.mock.restoreAll();
      syncBuiltinESMExports();
    }
  },
);
