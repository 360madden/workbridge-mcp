import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { createTwoFilesPatch } from 'diff';
import { Workspace } from '../dist/workspace.js';
import { Patches } from '../dist/patches.js';
import { Workflows } from '../dist/workflows.js';
import { Serial, digest } from '../dist/changes.js';
import { BridgeError, limits } from '../dist/core.js';
let suite,
  sequence = 0;
before(async () => {
  suite = await fs.mkdtemp(path.join(os.tmpdir(), 'wb-workflow-catalog-'));
});
after(async () => {
  assert.ok(suite.startsWith(path.resolve(os.tmpdir()) + path.sep));
  await fs.rm(suite, { recursive: true, force: true });
});
const options = { offset: 0, limit: 20, scanLimit: 200 };
async function fixture() {
  const root = path.join(suite, String(sequence++));
  await fs.mkdir(root);
  await fs.mkdir(path.join(root, 'Project ü'));
  const state = path.join(root, 'state');
  await fs.mkdir(state);
  const workspace = await Workspace.create(root);
  workspace.protect(state);
  const patches = new Patches(workspace, path.join(state, 'patches'), new Serial());
  await patches.apply('patch', [
    {
      path: 'Project ü/target.txt',
      expectedHash: null,
      patch: createTwoFilesPatch('/dev/null', 'b/Project ü/target.txt', '', 'applied\n'),
    },
  ]);
  const jobs = {
    launches: 0,
    async status() {
      throw new BridgeError('UNKNOWN_JOB', 'Unknown job');
    },
    async terminal() {
      this.launches++;
      throw new Error('Unexpected job launch');
    },
  };
  const directory = path.join(state, 'workflows'),
    workflows = new Workflows(workspace, directory, patches, jobs);
  const args = {
    workflowId: 'zz-valid',
    project: 'Project ü',
    title: 'Saved workflow',
    patchOperationId: 'patch',
    checks: [
      {
        name: 'never execute',
        kind: 'terminal',
        executable: 'node',
        args: ['-e', 'process.exit(0)'],
        timeoutSeconds: 30,
      },
    ],
  };
  return { root, state, workspace, patches, jobs, directory, workflows, args };
}
async function create(f) {
  await f.workflows.create(f.args);
  return path.join(f.directory, 'zz-valid.json');
}
async function clone(f, id, change = () => {}) {
  const record = JSON.parse(await fs.readFile(path.join(f.directory, 'zz-valid.json'), 'utf8'));
  record.workflowId = id;
  change(record);
  record.planHash = digest(JSON.stringify(record.plan));
  await fs.writeFile(path.join(f.directory, id + '.json'), JSON.stringify(record));
}
async function refuseKnown(f, id = 'zz-valid') {
  const record = path.join(f.directory, id + '.json'),
    saved = await fs.readFile(record),
    target = await fs.readFile(path.join(f.root, 'Project ü/target.txt'));
  for (const action of [
    () => f.workflows.status(id),
    () => f.workflows.resume(id),
    () => f.workflows.cancel(id),
    () => f.workflows.review(id),
    () => f.workflows.create({ ...f.args, workflowId: id }),
  ])
    await assert.rejects(action(), (error) => error.code === 'CORRUPT_WORKFLOW');
  assert.deepEqual(await fs.readFile(record), saved);
  assert.deepEqual(await fs.readFile(path.join(f.root, 'Project ü/target.txt')), target);
  assert.equal(f.jobs.launches, 0);
}

test('empty workflow discovery reports completeness without creating storage', async () => {
  const f = await fixture(),
    page = await f.workflows.list(options);
  assert.deepEqual(page.workflows, []);
  assert.deepEqual(page.issues, []);
  assert.equal(page.complete, true);
  assert.equal(page.hasErrors, false);
  assert.equal(page.nextOffset, null);
  assert.equal(page.order, 'workflowId ascending');
  await assert.rejects(fs.access(f.directory), (e) => e.code === 'ENOENT');
});

test('corrupt rows consume the page limit and continuation retains every issue and good workflow', async () => {
  const f = await fixture();
  await create(f);
  for (let i = 0; i < 125; i++)
    await fs.writeFile(path.join(f.directory, 'bad-' + String(i).padStart(3, '0') + '.json'), '{broken');
  const records = [],
    issues = [];
  let offset = 0,
    pages = 0;
  do {
    const page = await f.workflows.list({ ...options, offset, limit: 10, scanLimit: 1000 });
    assert.ok(JSON.stringify(page).length <= limits.outputChars);
    assert.ok(page.workflows.length + page.issues.length <= 10);
    assert.equal(page.hasErrors, page.issues.length > 0);
    if (page.issues.length) assert.equal(page.complete, false);
    assert.equal(page.catalogTruncated, false);
    records.push(...page.workflows);
    issues.push(...page.issues);
    offset = page.nextOffset;
    assert.ok(++pages < 30);
  } while (offset !== null);
  assert.equal(issues.length, 125);
  assert.equal(new Set(issues.map((i) => i.workflowId)).size, 125);
  assert.ok(issues.every((i) => i.code === 'CORRUPT_WORKFLOW'));
  assert.deepEqual(
    records.map((r) => r.workflowId),
    ['zz-valid'],
  );
  assert.equal(f.jobs.launches, 0);
});

test('serialized workflow summaries stay within the output budget and resume at the first omitted record', async () => {
  const f = await fixture();
  await create(f);
  for (let i = 0; i < 45; i++)
    await clone(f, 'long-' + String(i).padStart(3, '0'), (r) => {
      r.plan.project = 'p'.repeat(3000);
      r.plan.title = '\u0001'.repeat(200);
    });
  const records = [];
  let offset = 0,
    limited = false;
  do {
    const page = await f.workflows.list({ ...options, offset, limit: 50, scanLimit: 1000 });
    assert.ok(JSON.stringify(page).length <= limits.outputChars);
    limited ||= page.outputLimitReached;
    assert.equal(page.hasErrors, false);
    records.push(...page.workflows.map((r) => r.workflowId));
    if (page.nextOffset !== null) assert.ok(page.nextOffset > offset);
    offset = page.nextOffset;
  } while (offset !== null);
  assert.equal(limited, true);
  assert.equal(records.length, 46);
  assert.equal(new Set(records).size, 46);
  assert.deepEqual(records, [...records].sort());
});

test('sparse exact-project and path filters expose scan continuation and recorded state', async () => {
  const f = await fixture();
  await create(f);
  for (const name of ['a', 'b', 'c']) await clone(f, name);
  await f.workflows.cancel('b');
  const query = {
    ...options,
    project: 'Project ü',
    path: 'Project ü/target.txt',
    state: 'cancelled',
    limit: 1,
    scanLimit: 1,
  };
  const first = await f.workflows.list(query);
  assert.equal(first.workflows.length, 0);
  assert.equal(first.nextOffset, 1);
  assert.equal(first.scanLimitReached, true);
  assert.equal(first.complete, false);
  const second = await f.workflows.list({ ...query, offset: first.nextOffset });
  assert.equal(second.workflows[0].workflowId, 'b');
  assert.equal(second.workflows[0].recordedState, 'cancelled');
  assert.equal(second.hasErrors, false);
  assert.equal((await f.workflows.list({ ...options, project: '.' })).workflows.length, 0);
});

test('elapsed and directory-entry limits explicitly mark an incomplete workflow catalog', async () => {
  const f = await fixture();
  await create(f);
  await clone(f, 'a');
  await clone(f, 'b');
  const oldTime = limits.scanMs,
    oldEntries = limits.scanEntries;
  try {
    limits.scanMs = 0;
    const timed = await f.workflows.list(options);
    assert.equal(timed.timeLimitReached, true);
    assert.equal(timed.complete, false);
    limits.scanMs = oldTime;
    limits.scanEntries = 1;
    const truncated = await f.workflows.list(options);
    assert.equal(truncated.catalogTruncated, true);
    assert.equal(truncated.complete, false);
  } finally {
    limits.scanMs = oldTime;
    limits.scanEntries = oldEntries;
  }
});

test('invalid direct pagination arguments fail before scanning', async () => {
  const f = await fixture();
  for (const invalid of [
    { offset: -1 },
    { offset: 1.5 },
    { offset: 100001 },
    { limit: 0 },
    { limit: 51 },
    { scanLimit: 0 },
    { scanLimit: 1001 },
  ])
    await assert.rejects(f.workflows.list({ ...options, ...invalid }));
  await assert.rejects(fs.access(f.directory), (e) => e.code === 'ENOENT');
});

test('linked workflow catalog is refused before read, cancellation, resume, replay or new publication', async () => {
  const f = await fixture();
  await create(f);
  const real = path.join(f.state, 'preserved-catalog');
  await fs.rename(f.directory, real);
  await fs.symlink(real, f.directory, process.platform === 'win32' ? 'junction' : 'dir');
  const names = await fs.readdir(real);
  await refuseKnown(f);
  await assert.rejects(
    f.workflows.create({ ...f.args, workflowId: 'new' }),
    (e) => e.code === 'CORRUPT_WORKFLOW',
  );
  await assert.rejects(
    f.workflows.list(options),
    (e) => e.code === 'HISTORY_METADATA' || e.code === 'CORRUPT_WORKFLOW',
  );
  assert.deepEqual(await fs.readdir(real), names);
});

test('a junction masquerading as a workflow metadata file is reported instead of silently omitted', async () => {
  const f = await fixture();
  await create(f);
  await fs.mkdir(path.join(f.state, 'other'));
  await fs.symlink(
    path.join(f.state, 'other'),
    path.join(f.directory, 'linked.json'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const page = await f.workflows.list(options);
  assert.equal(page.hasErrors, true);
  assert.equal(page.complete, false);
  assert.equal(page.issues[0].workflowId, 'linked');
  assert.equal(page.issues[0].code, 'CORRUPT_WORKFLOW');
  assert.equal(page.workflows[0].workflowId, 'zz-valid');
  await assert.rejects(f.workflows.cancel('linked'), (e) => e.code === 'CORRUPT_WORKFLOW');
  assert.equal(f.jobs.launches, 0);
});

test('malformed and oversized workflow records preserve good rows and remain unchanged on refusal', async () => {
  const f = await fixture();
  await create(f);
  await clone(f, 'good');
  for (const text of ['{broken', ' '.repeat(128 * 1024 + 1)]) {
    await fs.writeFile(path.join(f.directory, 'zz-valid.json'), text);
    await refuseKnown(f);
    const page = await f.workflows.list(options);
    assert.equal(page.hasErrors, true);
    assert.equal(page.complete, false);
    assert.equal(page.workflows[0].workflowId, 'good');
    assert.equal(page.issues[0].code, 'CORRUPT_WORKFLOW');
  }
});

test('metadata replacement between lstat and open is detected before a workflow action', async () => {
  const f = await fixture(),
    record = await create(f),
    saved = await fs.readFile(record, 'utf8'),
    originalOpen = fs.open;
  let changed = false;
  fs.open = async function (target, ...args) {
    if (!changed && path.resolve(String(target)) === path.resolve(record)) {
      changed = true;
      await fs.writeFile(record, saved.replace('"state":"pending"', '"state":"blocked"'));
      const future = new Date(Date.now() + 5000);
      await fs.utimes(record, future, future);
    }
    return originalOpen.call(this, target, ...args);
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(f.workflows.cancel('zz-valid'), (e) => e.code === 'CORRUPT_WORKFLOW');
    assert.equal(changed, true);
    assert.equal(f.jobs.launches, 0);
    const actual = JSON.parse(await fs.readFile(record, 'utf8'));
    assert.equal(actual.cancelled, false);
    assert.equal(actual.state, 'blocked');
  } finally {
    fs.open = originalOpen;
    syncBuiltinESMExports();
  }
});

test('valid records remain readable after reconstruction and discovery does not inspect live inputs', async () => {
  const f = await fixture();
  await create(f);
  await fs.rm(path.join(f.root, 'Project ü/target.txt'));
  const fresh = new Workflows(f.workspace, f.directory, f.patches, f.jobs),
    page = await fresh.list(options);
  assert.equal(page.hasErrors, false);
  assert.equal(page.complete, true);
  assert.equal(page.workflows[0].workflowId, 'zz-valid');
  assert.equal((await fresh.status('zz-valid')).state, 'stale');
  assert.equal(f.jobs.launches, 0);
});
