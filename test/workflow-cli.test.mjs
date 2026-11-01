import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createTwoFilesPatch } from 'diff';
import { digest } from '../dist/changes.js';

const execute = promisify(execFile),
  repo = path.resolve('.');
let fixture, root, state, owner, transport;
before(async () => {
  fixture = await mkdtemp(path.join(os.tmpdir(), 'wb-workflow-cli-'));
  root = path.join(fixture, 'Workspace ü');
  state = path.join(fixture, 'State');
  await mkdir(root);
  await mkdir(state);
  await start();
});
after(async () => {
  await owner?.close();
  await rm(fixture, { recursive: true, force: true });
});
async function start() {
  owner = new Client({ name: 'workflow-fixture', version: '1' });
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(repo, 'dist/server.js')],
    cwd: repo,
    stderr: 'pipe',
    env: { ...process.env, WORKBRIDGE_ROOT: root, WORKBRIDGE_STATE_DIR: state, WORKBRIDGE_LOCAL_CLI: '1' },
  });
  await owner.connect(transport);
}
async function call(tool, args = {}, error = false) {
  const result = await owner.callTool({ name: tool, arguments: args });
  assert.equal(!!result.isError, error, JSON.stringify(result));
  const data = JSON.parse(result.content[0].text);
  if (result.structuredContent) assert.deepEqual(result.structuredContent, data);
  return data;
}
let sequence = 0;
async function cli(requests, options = {}) {
  const input = path.join(fixture, `request-${sequence++}.json`);
  await writeFile(input, JSON.stringify(requests));
  const args = [
    ...(options.preload ? ['--import', options.preload] : []),
    path.join(repo, 'scripts/workbridge-cli.mjs'),
    '--service-state',
    state,
    '--input',
    input,
    '--json',
    '--timeout',
    String(options.timeout ?? 20),
  ];
  let result;
  try {
    result = {
      code: 0,
      ...(await execute(process.execPath, args, {
        cwd: repo,
        windowsHide: true,
        timeout: ((options.timeout ?? 20) + 15) * 1000,
        maxBuffer: 8 * 1024 * 1024,
      })),
    };
  } catch (error) {
    result = { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
  return { ...result, rows: result.stdout.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse) };
}
const run = (name, script, args = []) => ({
  name,
  kind: 'terminal',
  executable: process.execPath,
  args: ['-e', script, ...args],
  timeoutSeconds: 20,
});
const latest = (result, index = 0) => result.steps[index].attempts.at(-1).jobId;
async function plan(name, checks) {
  await mkdir(path.join(root, name));
  await writeFile(path.join(root, name, 'a.txt'), 'before a\n');
  await writeFile(path.join(root, name, 'b.txt'), 'before b\n');
  const files = ['a', 'b'].map((f) => ({
    path: `${name}/${f}.txt`,
    expectedHash: digest(`before ${f}\n`),
    patch: createTwoFilesPatch(`a/${name}/${f}.txt`, `b/${name}/${f}.txt`, `before ${f}\n`, `after ${f}\n`),
  }));
  await call('patch_apply', { operationId: `${name}-patch`, files });
  return { workflowId: name, title: name, project: name, patchOperationId: `${name}-patch`, checks };
}
async function waitJob(id) {
  for (let n = 0; n < 200; n++) {
    const job = await call('command_status', { jobId: id });
    if (job.status !== 'running' && job.completionPending !== true) return job;
    await delay(50);
  }
  assert.fail('fixture job did not complete');
}

test('shared CLI and MCP discover all workflow schemas, run sequential literal commands, and review saved output', async () => {
  const catalog = await owner.listTools();
  assert.equal(catalog.tools.length, 64);
  for (const name of [
    'workflow_create',
    'workflow_status',
    'workflow_resume',
    'workflow_review',
    'workflow_cancel',
    'workflow_list',
  ])
    assert.ok(catalog.tools.find((t) => t.name === name)?.outputSchema);
  const literals = ['space value', 'quote"value', '$(not-a-shell)', '; & literal'];
  const script = `const fs=require('node:fs'); if(JSON.stringify(process.argv.slice(1))!==${JSON.stringify(JSON.stringify(literals))})process.exit(7);fs.appendFileSync('count.txt','A');console.log('LITERAL_OK');`;
  const args = await plan('success', [
    run('literal build', script, literals),
    run('tests', "require('node:fs').appendFileSync('count.txt','B');console.log('TEST_OK');"),
  ]);
  const created = await cli([{ tool: 'workflow_create', arguments: args }]);
  assert.equal(created.code, 0, created.stdout);
  assert.equal(created.rows[0].result.state, 'pending');
  const started = await call('workflow_resume', { workflowId: 'success' });
  const completed = await cli([
    { runWorkflow: 'success' },
    { tool: 'workflow_review', arguments: { workflowId: 'success', limit: 15 } },
  ]);
  assert.equal(completed.code, 0, completed.stdout);
  assert.equal(completed.rows[0].tool, 'runWorkflow');
  assert.equal(completed.rows[0].result.state, 'ready_for_review');
  assert.equal(completed.rows[0].result.steps[0].attempts[0].jobId, latest(started));
  assert.ok(completed.rows[1].result.outputs[0].text.includes('LITERAL_OK'));
  assert.ok(completed.rows[1].result.diff.nextOffset);
  assert.equal(await readFile(path.join(root, 'success/count.txt'), 'utf8'), 'AB');
  assert.equal((await cli([{ runWorkflow: 'success' }])).code, 0);
  assert.equal(await readFile(path.join(root, 'success/count.txt'), 'utf8'), 'AB');
});

test('failed checks stop CLI automation; explicit retry is shared and idempotent', async () => {
  const args = await plan('retry', [
    run(
      'check',
      "const fs=require('node:fs');fs.appendFileSync('attempts.txt','X');if(!fs.existsSync('allow-pass')){console.error('FIXTURE_FAIL');process.exit(3)}console.log('RETRY_OK');",
    ),
  ]);
  const failed = await cli([{ tool: 'workflow_create', arguments: args }, { runWorkflow: 'retry' }]);
  assert.equal(failed.code, 1, failed.stdout);
  assert.equal(failed.rows.at(-1).result.state, 'failed');
  const jobId = latest(failed.rows.at(-1).result);
  assert.equal((await call('command_output', { jobId })).exitCode, 3);
  assert.equal((await cli([{ runWorkflow: 'retry' }])).code, 1);
  assert.equal(await readFile(path.join(root, 'retry/attempts.txt'), 'utf8'), 'X');
  await writeFile(path.join(root, 'retry/allow-pass'), 'fixture only');
  await call('workflow_resume', { workflowId: 'retry', retryJobId: jobId });
  const success = await cli([
    { runWorkflow: 'retry' },
    { tool: 'workflow_resume', arguments: { workflowId: 'retry', retryJobId: jobId } },
  ]);
  assert.equal(success.code, 0, success.stdout);
  assert.equal(success.rows[0].result.steps[0].attempts.length, 2);
  assert.equal(await readFile(path.join(root, 'retry/attempts.txt'), 'utf8'), 'XX');
});

// Private fixture gates establish phase ordering; the CLI still uses its real deadline.
// No timer is mocked, and no test hook is installed in application code.
const deadlineScript = `
const fs = require('node:fs');
fs.appendFileSync('runs.txt', 'X');
fs.writeFileSync('started.txt', 'ready');
const timer = setInterval(() => {
  if (fs.existsSync('release.txt')) {
    clearInterval(timer);
    console.log('LATE_OK');
  }
}, 20);
setTimeout(() => {
  clearInterval(timer);
  console.error('PRIVATE_FIXTURE_GATE_EXPIRED');
  process.exitCode = 97;
}, 25000).unref();
`;
const deadlineSentinel = (name) => ({
  tool: 'write_file',
  arguments: {
    operationId: `${name}-sentinel`,
    path: `${name}/must-not-run.txt`,
    content: 'unexpected',
    expectedHash: null,
  },
});
async function waitForMarker(name) {
  const file = path.join(root, name, 'started.txt');
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      assert.equal(await readFile(file, 'utf8'), 'ready');
      return;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await delay(25);
  }
  assert.fail('Private fixture never reached its execution marker.');
}
async function deadlinePreload(name, phase) {
  assert.ok(['before_submission', 'after_admission'].includes(phase));
  const file = path.join(fixture, `${name}-preload.mjs`);
  const observation = path.join(fixture, `${name}-phase.json`);
  await writeFile(
    file,
    `
import { Client } from ${JSON.stringify(import.meta.resolve('@modelcontextprotocol/client'))};
import fs from 'node:fs/promises';
const original = Client.prototype.callTool;
let intercepted = false;
Client.prototype.callTool = async function(request, options, ...rest) {
  if (intercepted || request.name !== 'workflow_resume' || request.arguments?.workflowId !== ${JSON.stringify(name)})
    return original.call(this, request, options, ...rest);
  intercepted = true;
  options.signal.throwIfAborted();
  const response = ${JSON.stringify(phase)} === 'after_admission'
    ? await original.call(this, request, options, ...rest)
    : null;
  await fs.writeFile(${JSON.stringify(observation)}, JSON.stringify({ phase: ${JSON.stringify(phase)}, response }), { flag: 'wx' });
  // Hold only the private caller's request/response path until its actual abort.
  await new Promise((resolve, reject) => {
    if (options.signal.aborted) return reject(options.signal.reason);
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  });
};
`,
    { flag: 'wx' },
  );
  return { preload: pathToFileURL(file).href, observation };
}
async function assertDeadline(timed, name, requireWorkflowId = false) {
  assert.equal(timed.code, 124, timed.stdout);
  assert.equal(timed.rows.length, 1, timed.stdout);
  const error = timed.rows[0].error;
  assert.equal(error.code, 'DEADLINE');
  assert.equal(error.retryAttempted, false);
  // A preaccepted job survives even if this separate caller times out in connection setup.
  // The injected phases below prove tool entry explicitly and require its workflow ID.
  if (requireWorkflowId || error.workflowId !== undefined) assert.equal(error.workflowId, name);
  await assert.rejects(readFile(path.join(root, name, 'must-not-run.txt')), (e) => e.code === 'ENOENT');
}
async function completeOnce(name, originalId, originalOwner) {
  const completed = await cli([{ runWorkflow: name }]);
  assert.equal(completed.code, 0, completed.stdout);
  const view = completed.rows[0].result;
  assert.equal(view.state, 'ready_for_review');
  assert.equal(view.steps[0].attempts.length, 1);
  assert.equal(latest(view), originalId);
  assert.equal(view.steps[0].job.status, 'passed');
  assert.equal(view.steps[0].job.exitCode, 0);
  assert.equal(view.steps[0].job.completionPending, false);
  assert.equal(await readFile(path.join(root, name, 'runs.txt'), 'utf8'), 'X');
  const jobFile = path.join(state, 'jobs', originalId + '.json');
  const saved = await readFile(jobFile);
  const replay = await cli([{ runWorkflow: name }, { waitForJob: originalId }]);
  assert.equal(replay.code, 0, replay.stdout);
  assert.equal(latest(replay.rows[0].result), originalId);
  assert.equal(replay.rows[0].result.steps[0].attempts.length, 1);
  assert.deepEqual(await readFile(jobFile), saved);
  assert.equal(await readFile(path.join(root, name, 'runs.txt'), 'utf8'), 'X');
  assert.equal((await call('diagnostics')).localCli.instanceId, originalOwner);
}

test(
  'CLI deadline preserves a preaccepted gated job; another client completes the same attempt',
  { timeout: 40000 },
  async () => {
    const name = 'deadline';
    const args = await plan(name, [{ ...run('gated', deadlineScript), timeoutSeconds: 30 }]);
    await call('workflow_create', args);
    const before = await call('diagnostics');
    const accepted = await call('workflow_resume', { workflowId: name });
    const originalId = latest(accepted);
    try {
      await waitForMarker(name);
      const intent = await readFile(path.join(state, 'jobs', originalId + '.json'));
      const timed = await cli([{ runWorkflow: name }, deadlineSentinel(name)], { timeout: 1 });
      await assertDeadline(timed, name);
      const progress = await call('workflow_status', { workflowId: name });
      assert.equal(progress.state, 'validating');
      assert.equal(progress.steps[0].job.id, originalId);
      assert.equal(progress.steps[0].attempts.length, 1);
      assert.equal(progress.steps[0].job.completionPending, true);
      assert.deepEqual(await readFile(path.join(state, 'jobs', originalId + '.json')), intent);
      await writeFile(path.join(root, name, 'release.txt'), 'release');
      await completeOnce(name, originalId, before.localCli.instanceId);
    } finally {
      await writeFile(path.join(root, name, 'release.txt'), 'release');
      await call('command_cancel', { jobId: originalId });
    }
  },
);

test(
  'CLI deadline before submission leaves no attempt; a later caller starts exactly once',
  { timeout: 40000 },
  async () => {
    const name = 'deadline-before-send';
    const args = await plan(name, [
      run('count', "require('node:fs').appendFileSync('runs.txt','X');console.log('ONCE')"),
    ]);
    await call('workflow_create', args);
    const before = await call('diagnostics');
    const journal = await readFile(path.join(state, 'workflows', name + '.json'));
    const gate = await deadlinePreload(name, 'before_submission');
    const timed = await cli([{ runWorkflow: name }, deadlineSentinel(name)], {
      timeout: 5,
      preload: gate.preload,
    });
    await assertDeadline(timed, name, true);
    assert.deepEqual(JSON.parse(await readFile(gate.observation, 'utf8')), {
      phase: 'before_submission',
      response: null,
    });
    const progress = await call('workflow_status', { workflowId: name });
    assert.equal(progress.state, 'pending');
    assert.equal(progress.steps[0].attempts.length, 0);
    assert.equal(progress.steps[0].job, null);
    assert.deepEqual(await readFile(path.join(state, 'workflows', name + '.json')), journal);
    await assert.rejects(readFile(path.join(root, name, 'runs.txt')), (e) => e.code === 'ENOENT');
    assert.equal((await call('diagnostics')).localCli.instanceId, before.localCli.instanceId);
    const started = await call('workflow_resume', { workflowId: name });
    await completeOnce(name, latest(started), before.localCli.instanceId);
  },
);

test(
  'CLI deadline after admission withholds the response but does not duplicate the owned attempt',
  { timeout: 40000 },
  async () => {
    const name = 'deadline-after-admission';
    const args = await plan(name, [{ ...run('gated', deadlineScript), timeoutSeconds: 30 }]);
    await call('workflow_create', args);
    const before = await call('diagnostics');
    const gate = await deadlinePreload(name, 'after_admission');
    let originalId;
    try {
      const timed = await cli([{ runWorkflow: name }, deadlineSentinel(name)], {
        timeout: 5,
        preload: gate.preload,
      });
      await assertDeadline(timed, name, true);
      const observation = JSON.parse(await readFile(gate.observation, 'utf8'));
      assert.equal(observation.phase, 'after_admission');
      assert.equal(Boolean(observation.response.isError), false);
      const accepted =
        observation.response.structuredContent ?? JSON.parse(observation.response.content[0].text);
      originalId = latest(accepted);
      assert.equal(accepted.state, 'validating');
      assert.equal(accepted.steps[0].job.completionPending, true);
      await waitForMarker(name);
      const progress = await call('workflow_status', { workflowId: name });
      assert.equal(progress.state, 'validating');
      assert.equal(latest(progress), originalId);
      assert.equal(progress.steps[0].attempts.length, 1);
      assert.equal(await readFile(path.join(root, name, 'runs.txt'), 'utf8'), 'X');
      await writeFile(path.join(root, name, 'release.txt'), 'release');
      await completeOnce(name, originalId, before.localCli.instanceId);
    } finally {
      await writeFile(path.join(root, name, 'release.txt'), 'release');
      if (originalId) await call('command_cancel', { jobId: originalId });
    }
  },
);

test('owner restart retains completed steps and requires explicit retry of the interrupted step', async () => {
  const args = await plan('restart', [
    run('first', "require('node:fs').appendFileSync('count.txt','A')"),
    run('second', "setTimeout(()=>require('node:fs').appendFileSync('count.txt','B'),2500)"),
  ]);
  await call('workflow_create', args);
  const one = await call('workflow_resume', { workflowId: 'restart' });
  assert.equal((await waitJob(latest(one))).status, 'passed');
  const two = await call('workflow_resume', { workflowId: 'restart' });
  assert.equal(two.steps[0].attempts[0].state, 'passed');
  const interruptedId = latest(two, 1);
  await owner.close();
  await start();
  const recovered = await call('workflow_status', { workflowId: 'restart' });
  assert.equal(recovered.state, 'failed');
  assert.ok(['cancelled', 'interrupted'].includes(recovered.steps[1].job.status));
  const blocked = await cli([{ runWorkflow: 'restart' }]);
  assert.equal(blocked.code, 1);
  assert.equal(await readFile(path.join(root, 'restart/count.txt'), 'utf8'), 'A');
  await call('workflow_resume', { workflowId: 'restart', retryJobId: interruptedId });
  const complete = await cli([{ runWorkflow: 'restart' }]);
  assert.equal(complete.code, 0, complete.stdout);
  assert.equal(complete.rows[0].result.steps[0].attempts.length, 1);
  assert.equal(complete.rows[0].result.steps[1].attempts.length, 2);
  assert.equal(await readFile(path.join(root, 'restart/count.txt'), 'utf8'), 'AB');
});

test('watched edit failures, cancellation, filtering, and guarded undo preserve newer bytes', async () => {
  const args = await plan('cancel', [run('slow', "setTimeout(()=>console.log('never'),10000)")]);
  await call('workflow_create', args);
  const started = await call('workflow_resume', { workflowId: 'cancel' });
  const cancelled = await cli([{ tool: 'workflow_cancel', arguments: { workflowId: 'cancel' } }]);
  assert.equal(cancelled.code, 0, cancelled.stdout);
  assert.equal((await call('command_status', { jobId: latest(started) })).status, 'cancelled');
  assert.equal((await cli([{ runWorkflow: 'cancel' }])).code, 1);
  const list = await call('workflow_list', { project: 'cancel', path: 'cancel/a.txt', state: 'cancelled' });
  assert.equal(list.workflows[0].workflowId, 'cancel');
  await writeFile(path.join(root, 'cancel/a.txt'), 'later independent edit');
  await call('patch_undo', { operationId: 'cancel-patch' }, true);
  assert.equal(await readFile(path.join(root, 'cancel/a.txt'), 'utf8'), 'later independent edit');
  assert.equal(await readFile(path.join(root, 'cancel/b.txt'), 'utf8'), 'after b\n');
  const stale = await plan('stale', [run('test', "console.log('not run')")]);
  await call('workflow_create', stale);
  await writeFile(path.join(root, 'stale/a.txt'), 'newer edit');
  const result = await cli([{ runWorkflow: 'stale' }]);
  assert.equal(result.code, 1);
  assert.equal(result.rows[0].result.state, 'stale');
  assert.equal(result.rows[0].result.steps[0].attempts.length, 0);
});

test('configured profiles remain pinned through the real job runner', async () => {
  const args = await plan('profile', [{ name: 'configured test', kind: 'profile', command: 'test' }]);
  const profiles = {
    projects: {
      profile: {
        test: { executable: process.execPath, args: ['-e', "console.log('PROFILE_OK')"], timeoutSeconds: 10 },
      },
    },
  };
  await writeFile(path.join(state, 'commands.json'), JSON.stringify(profiles));
  await call('workflow_create', args);
  profiles.projects.profile.test.args = ['--version'];
  await writeFile(path.join(state, 'commands.json'), JSON.stringify(profiles));
  const changed = await cli([{ runWorkflow: 'profile' }]);
  assert.equal(changed.code, 1);
  assert.equal(changed.rows[0].result.issues[0].code, 'WORKFLOW_COMMAND_CHANGED');
  profiles.projects.profile.test.args = ['-e', "console.log('PROFILE_OK')"];
  await writeFile(path.join(state, 'commands.json'), JSON.stringify(profiles));
  const passed = await cli([
    { runWorkflow: 'profile' },
    { tool: 'workflow_review', arguments: { workflowId: 'profile' } },
  ]);
  assert.equal(passed.code, 0, passed.stdout);
  assert.equal(passed.rows[0].result.steps[0].job.mode, 'profile');
  assert.match(passed.rows[1].result.outputs[0].text, /PROFILE_OK/);
});
