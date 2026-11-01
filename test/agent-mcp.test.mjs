import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import os from 'node:os';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const serverPath = fileURLToPath(new URL('../dist/server.js', import.meta.url));
let root, client, head;
const git = (dir, ...args) =>
  execFileSync('git', args, { cwd: dir, windowsHide: true, encoding: 'utf8' }).trim();

async function setupRepository(name) {
  const repo = path.join(root, name);
  await mkdir(repo);
  await writeFile(path.join(repo, 'main.ts'), 'export const value = 1;\n');
  git(repo, 'init', '--initial-branch=main', '--quiet');
  git(repo, 'add', 'main.ts');
  git(
    repo,
    '-c',
    'user.name=Agent MCP Test',
    '-c',
    'user.email=agent-test@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--quiet',
    '-m',
    'fixture',
  );
  return git(repo, 'rev-parse', 'HEAD');
}

before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'wb-agent-mcp-'));
  head = await setupRepository('Alpha');
  await setupRepository('Beta');
  client = new Client({ name: 'agent-mcp-fixture', version: '1.0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [serverPath],
      cwd: path.dirname(serverPath),
      stderr: 'pipe',
      env: {
        ...process.env,
        WORKBRIDGE_ROOT: root,
        WORKBRIDGE_STATE_DIR: path.join(root, 'wb-state'),
        WORKBRIDGE_LOCAL_CLI: '0',
      },
    }),
  );
});
after(async () => {
  await client?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

async function call(name, args = {}, expectedError) {
  const response = await client.callTool({ name, arguments: args });
  const result = JSON.parse(response.content[0].text);
  if (expectedError) {
    assert.equal(response.isError, true, name);
    assert.equal(result.error.code, expectedError);
  } else {
    assert.equal(response.isError, undefined, JSON.stringify(result));
    assert.deepEqual(response.structuredContent, result);
  }
  return result;
}

test('MCP agent tools expose the 36-worker limit and isolate repository journals and paths', async () => {
  const tools = (await client.listTools()).tools;
  const names = [
    'agent_list',
    'agent_status',
    'agent_owner_of',
    'agent_assign',
    'agent_dispatch',
    'agent_dispatch_next',
    'agent_finish',
    'agent_verify',
  ];
  assert.equal(tools.length, 64);
  for (const name of names) assert.ok(tools.find((t) => t.name === name)?.outputSchema, name);
  const info = await call('workspace_info');
  assert.equal(info.limits.commandJobs, 36);
  assert.equal(info.limits.coordinatedWorkers, 36);
  assert.match(info.agents, /do not create AI reasoning agents/);

  const empty = await call('agent_list', { project: 'Alpha' });
  assert.equal(empty.maxWorkers, 36);
  assert.deepEqual(empty.tasks, []);
  const assignment = await call('agent_assign', {
    project: 'Alpha',
    taskId: 'task1',
    workerId: 'worker1',
    ownedPaths: ['main.ts'],
    baseHead: head,
  });
  assert.equal(assignment.state, 'queued');
  assert.equal(assignment.ownedPaths[0], path.join(root, 'Alpha', 'main.ts'));
  const owner = await call('agent_owner_of', { project: 'Alpha', path: 'main.ts' });
  assert.equal(owner.owner.workerId, 'worker1');
  assert.equal((await call('agent_status', { project: 'Alpha' })).workers[0].status, 'queued');
  assert.deepEqual((await call('agent_list', { project: 'Beta' })).tasks, []);
  await call(
    'agent_assign',
    {
      project: 'Alpha',
      taskId: 'escape',
      workerId: 'other',
      ownedPaths: ['../Beta/main.ts'],
      baseHead: head,
    },
    'OUTSIDE_PROJECT',
  );
  assert.equal((await call('agent_list', { project: 'Alpha' })).revision, 1);
  const wrongJob = await call('terminal_run', {
    cwd: 'Beta',
    executable: process.execPath,
    args: ['-e', 'console.log("wrong repository fixture")'],
    timeoutSeconds: 15,
    requestId: 'agent-mcp-cross-repo-job-1',
  });
  assert.equal(wrongJob.project, 'Beta');
  await call(
    'agent_dispatch',
    {
      project: 'Alpha',
      taskId: 'task1',
      workerId: 'worker1',
      jobId: wrongJob.id,
      baseHead: head,
    },
    'AGENT_JOB_PROJECT',
  );
  assert.equal((await call('agent_list', { project: 'Alpha' })).running, 0);
  assert.deepEqual(
    await call('agent_dispatch_next', {
      project: 'Alpha',
      workerId: 'missing',
      jobId: 'missingjob',
      baseHead: head,
    }),
    { task: null },
  );
});

test('MCP dispatch uses a real existing job and explicit finish/verify releases ownership', async () => {
  const jobId = 'agent-mcp-smoke-job-1';
  const launch = await call('terminal_run', {
    cwd: 'Alpha',
    executable: process.execPath,
    args: ['-e', 'setTimeout(() => console.log("agent fixture finished"), 7000)'],
    timeoutSeconds: 25,
    requestId: jobId,
  });
  assert.equal(launch.id, jobId);
  assert.equal(launch.status, 'running');
  const bound = await call('agent_dispatch', {
    project: 'Alpha',
    taskId: 'task1',
    workerId: 'worker1',
    jobId,
    baseHead: head,
  });
  assert.equal(bound.state, 'running');
  assert.equal((await call('agent_list', { project: 'Alpha' })).running, 1);
  let status;
  for (let i = 0; i < 20; i++) {
    status = await call('command_status', { jobId });
    if (status.status !== 'running' && !status.completionPending) break;
    await delay(500);
  }
  assert.equal(status.status, 'passed');
  assert.equal(status.exitCode, 0);
  const original = 'export const value = 1;\n';
  const artifact = path.join(root, 'Alpha', 'main.ts');
  assert.equal(
    (
      await call('agent_finish', {
        project: 'Alpha',
        taskId: 'task1',
        workerId: 'worker1',
        jobId,
        baseHead: head,
        receipt: {
          outcome: 'completed',
          testExitCodes: [0],
          artifacts: [{ path: artifact, sha256: createHash('sha256').update(original).digest('hex') }],
        },
      })
    ).state,
    'review',
  );
  await writeFile(artifact, 'export const value = 2;\n');
  await call(
    'agent_verify',
    { project: 'Alpha', taskId: 'task1', baseHead: head },
    'AGENT_ARTIFACT_MISMATCH',
  );
  assert.equal(
    (await call('agent_owner_of', { project: 'Alpha', path: 'main.ts' })).owner.workerId,
    'worker1',
  );
  await rm(artifact);
  await call(
    'agent_verify',
    { project: 'Alpha', taskId: 'task1', baseHead: head },
    'AGENT_ARTIFACT_MISMATCH',
  );
  assert.equal(
    (await call('agent_owner_of', { project: 'Alpha', path: 'main.ts' })).owner.workerId,
    'worker1',
  );
  await writeFile(artifact, original);
  assert.equal(
    (await call('agent_verify', { project: 'Alpha', taskId: 'task1', baseHead: head })).state,
    'verified',
  );
  assert.equal((await call('agent_owner_of', { project: 'Alpha', path: 'main.ts' })).owner, null);
  assert.equal((await call('agent_list', { project: 'Alpha' })).running, 0);
});
