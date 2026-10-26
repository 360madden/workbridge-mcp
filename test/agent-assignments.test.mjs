import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { parsers } from 'prettier/plugins/typescript';

// Import current TS sources in memory; do not build the running installation.
const sourceRoot = new URL('../src/', import.meta.url).href;
function lower(source) {
  const edits = [];
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'MethodDefinition' && node.kind === 'constructor') {
      const params = node.value.params.filter((p) => p.type === 'TSParameterProperty');
      if (params.length) {
        const body = node.value.body;
        const first = body.body[0];
        const index = first?.expression?.callee?.type === 'Super' ? first.range[1] : body.range[0] + 1;
        edits.push([
          index,
          index,
          params
            .map((p) => {
              assert.equal(p.parameter.type, 'Identifier');
              edits.push([p.range[0], p.parameter.range[0], '']);
              return 'this.' + p.parameter.name + ' = ' + p.parameter.name + ';';
            })
            .join(''),
        ]);
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc' || key === 'range') continue;
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') walk(value);
    }
  }
  walk(parsers.typescript.parse(source, {}));
  for (const [start, end, replace] of edits.sort((a, b) => b[0] - a[0]))
    source = source.slice(0, start) + replace + source.slice(end);
  return stripTypeScriptTypes(source);
}
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.startsWith(sourceRoot) && specifier.startsWith('.') && specifier.endsWith('.js'))
      return next(specifier.slice(0, -3) + '.ts', context);
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith(sourceRoot) && url.endsWith('.ts'))
      return {
        format: 'module',
        source: lower(readFileSync(fileURLToPath(url), 'utf8')),
        shortCircuit: true,
      };
    return next(url, context);
  },
});
const { AgentAssignments, MAX_AGENT_WORKERS, agentWorkerStatuses } =
  await import('../src/agent-assignments.ts');
const { AgentCoordination } = await import('../src/agent-coordination.ts');
const { Workspace } = await import('../src/workspace.ts');
const head = 'a'.repeat(40);
const temp = [];
after(async () => {
  for (const root of temp) await rm(root, { recursive: true, force: true });
});
class FakeJobs {
  records = new Map();
  async status(id) {
    if (!this.records.has(id)) throw Object.assign(new Error('Unknown fixture job'), { code: 'UNKNOWN_JOB' });
    return structuredClone(this.records.get(id));
  }
  running(id) {
    this.records.set(id, { id, status: 'running', exitCode: null, completionPending: false });
  }
  finished(id, status = 'passed', code = 0) {
    this.records.set(id, { id, status, exitCode: code, completionPending: false });
  }
}
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wb-agent-assignments-'));
  temp.push(root);
  const directory = path.join(root, '.state', 'agents');
  const workspace = await Workspace.create(root);
  const jobs = new FakeJobs();
  const make = () => new AgentAssignments(workspace, directory, jobs, async () => head);
  const base = new AgentCoordination(workspace, directory, jobs, async () => head);
  return { root, directory, jobs, make, base, agents: make() };
}
const assignment = (id, worker, paths) => ({
  taskId: id,
  workerId: worker,
  ownedPaths: paths,
  baseHead: head,
});
const dispatch = (id, worker, job) => ({ taskId: id, workerId: worker, jobId: job, baseHead: head });
const finish = (id, worker, job) => ({
  ...dispatch(id, worker, job),
  receipt: { outcome: 'completed', testExitCodes: [0], artifacts: [] },
});
test('exposes five-worker durable coordination states rather than process claims', () => {
  assert.equal(MAX_AGENT_WORKERS, 5);
  assert.deepEqual([...agentWorkerStatuses], ['idle', 'queued', 'review', 'blocked', 'running']);
});
test('queued assignment reports file ownership, sorted workers and independent snapshots', async () => {
  const f = await fixture();
  await f.agents.assign(assignment('task1', 'worker1', ['a.ts']));
  const state = await f.agents.status();
  assert.equal(state.revision, 1);
  assert.deepEqual(state.workers, [
    {
      workerId: 'worker1',
      status: 'queued',
      runningTaskId: null,
      tasks: { queued: ['task1'], running: [], review: [], verified: [], blocked: [] },
    },
  ]);
  assert.equal(state.owners[0].path, path.join(f.root, 'a.ts'));
  assert.equal((await f.agents.ownerOf('a.ts')).owner.taskId, 'task1');
  state.owners[0].workerId = 'malicious';
  assert.equal((await f.make().status()).owners[0].workerId, 'worker1');
});
test('actual job settlement controls review, verification and released ownership', async () => {
  const f = await fixture();
  await f.agents.assign(assignment('task1', 'worker1', ['a.ts']));
  f.jobs.running('job1');
  await f.agents.dispatch(dispatch('task1', 'worker1', 'job1'));
  assert.equal((await f.agents.status()).workers[0].status, 'running');
  assert.equal((await f.agents.status()).workers[0].runningTaskId, 'task1');
  f.jobs.finished('job1');
  assert.equal((await f.agents.finish(finish('task1', 'worker1', 'job1'))).state, 'review');
  assert.equal((await f.agents.ownerOf('a.ts')).owner.state, 'review');
  assert.equal((await f.agents.verify({ taskId: 'task1', baseHead: head })).state, 'verified');
  const view = await f.agents.status();
  assert.equal(view.workers[0].status, 'idle');
  assert.deepEqual(view.workers[0].tasks.verified, ['task1']);
  assert.deepEqual(view.owners, []);
});
test('failed settled jobs retain exclusive paths and report blocked state', async () => {
  const f = await fixture();
  await f.agents.assign(assignment('task1', 'worker1', ['a.ts']));
  f.jobs.running('job1');
  await f.agents.dispatch(dispatch('task1', 'worker1', 'job1'));
  f.jobs.finished('job1', 'failed', 1);
  assert.equal((await f.agents.finish(finish('task1', 'worker1', 'job1'))).state, 'blocked');
  assert.equal((await f.agents.status()).workers[0].status, 'blocked');
  await assert.rejects(f.agents.assign(assignment('task2', 'worker2', ['a.ts'])), {
    code: 'AGENT_PATH_CONFLICT',
  });
  assert.equal((await f.agents.ownerOf('a.ts')).owner.workerId, 'worker1');
});
test('uses existing journal across independent coordination wrappers', async () => {
  const f = await fixture();
  await mkdir(path.join(f.root, 'src'));
  await f.base.assign(assignment('task2', 'worker2', ['src/b.ts', 'src/a.ts']));
  await f.agents.assign(assignment('task1', 'worker1', ['one.ts']));
  const one = await f.agents.status();
  const two = await f.make().status();
  assert.deepEqual(two, one);
  assert.deepEqual(
    one.workers.map((x) => x.workerId),
    ['worker1', 'worker2'],
  );
  assert.equal((await f.agents.ownerOf('src/a.ts')).owner.taskId, 'task2');
  assert.equal(
    (await readFile(path.join(f.directory, 'assignments.json'), 'utf8')).includes('worker2'),
    true,
  );
});
test('rejects out-of-root ownership query and preserves the journal bytes', async () => {
  const f = await fixture();
  await f.agents.assign(assignment('task1', 'worker1', ['one.ts']));
  const p = path.join(f.directory, 'assignments.json');
  const before = await readFile(p, 'utf8');
  await assert.rejects(f.agents.ownerOf(path.resolve(f.root, '..', 'outside.ts')));
  assert.equal(await readFile(p, 'utf8'), before);
});
