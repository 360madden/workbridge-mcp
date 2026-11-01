import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createTwoFilesPatch } from 'diff';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { digest } from '../dist/changes.js';
const execute = promisify(execFile),
  repo = path.resolve('.');
let fixture,
  root,
  state,
  client,
  sequence = 0;
async function start() {
  client = new Client({ name: 'context-fixture', version: '1' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.join(repo, 'dist/server.js')],
      cwd: repo,
      stderr: 'pipe',
      env: { ...process.env, WORKBRIDGE_ROOT: root, WORKBRIDGE_STATE_DIR: state, WORKBRIDGE_LOCAL_CLI: '1' },
    }),
  );
}
before(async () => {
  fixture = await mkdtemp(path.join(os.tmpdir(), 'wb-context-cli-'));
  root = path.join(fixture, 'Workspace ü');
  state = path.join(fixture, 'State');
  await mkdir(root);
  await mkdir(state);
  await mkdir(path.join(root, 'Project with spaces/src'), { recursive: true });
  await writeFile(path.join(root, 'AGENTS.md'), 'root instructions\n');
  await writeFile(path.join(root, 'Project with spaces/AGENTS.md'), 'project instructions\n');
  await writeFile(path.join(root, 'Project with spaces/README.md'), 'project docs\n');
  await writeFile(path.join(root, 'Project with spaces/src/a.ts'), 'export const value=1;\nsecond line\n');
  await start();
});
after(async () => {
  await client?.close();
  if (fixture) {
    assert.ok(fixture.startsWith(path.resolve(os.tmpdir()) + path.sep));
    await rm(fixture, { recursive: true, force: true });
  }
});
async function call(tool, args = {}, error = false) {
  const r = await client.callTool({ name: tool, arguments: args });
  assert.equal(!!r.isError, error, JSON.stringify(r));
  const data = JSON.parse(r.content[0].text);
  if (r.structuredContent) assert.deepEqual(r.structuredContent, data);
  return data;
}
async function cli(requests, extra = []) {
  const input = path.join(fixture, 'request-' + sequence++ + '.json');
  await writeFile(input, JSON.stringify(requests));
  let result;
  try {
    result = {
      code: 0,
      ...(await execute(
        process.execPath,
        [
          path.join(repo, 'scripts/workbridge-cli.mjs'),
          '--service-state',
          state,
          '--root',
          root,
          '--input',
          input,
          '--json',
          ...extra,
        ],
        { cwd: repo, windowsHide: true },
      )),
    };
  } catch (e) {
    result = { code: e.code, stdout: e.stdout, stderr: e.stderr };
  }
  return { ...result, rows: result.stdout.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse) };
}
const step = (args) => ({ tool: 'task_context', arguments: args });
const only = {
  includeOverview: false,
  includeInstructions: false,
  includeDocuments: false,
  includeWorkflows: false,
};
test('connected CLI discovers task_context and shares section continuation and source hashes with MCP', async () => {
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 64);
  const tool = tools.tools.find((t) => t.name === 'task_context');
  assert.ok(tool.inputSchema);
  assert.ok(tool.outputSchema);
  assert.equal(tool.annotations.readOnlyHint, true);
  const args = {
    project: 'Project with spaces',
    files: [{ path: 'Project with spaces/src/a.ts', lineCount: 1 }],
    searches: [{ query: 'value', glob: ['src/*.ts'] }],
    limit: 2,
  };
  const first = await cli([step(args)]);
  assert.equal(first.code, 0, first.stdout);
  assert.equal(first.rows[0].schemaVersion, 1);
  const collected = [...first.rows[0].result.sections];
  let page = first.rows[0].result;
  const hash = page.planHash;
  while (page.nextOffset !== null) {
    page = await call('task_context', { ...args, offset: page.nextOffset, expectedPlanHash: hash });
    assert.equal(page.planHash, hash);
    collected.push(...page.sections);
  }
  assert.deepEqual(
    collected.map((s) => s.index),
    collected.map((_, i) => i),
  );
  const source = collected.find((s) => s.kind === 'source');
  assert.equal(source.result.sha256, digest(await readFile(path.join(root, 'Project with spaces/src/a.ts'))));
  const tail = await cli([source.followUp]);
  assert.equal(tail.code, 0);
  assert.ok(tail.rows[0].result.text.includes('second line'));
  const identity = await call('workspace_info');
  assert.equal(identity.version, '0.16.4-dev');
  assert.ok(identity.context.includes('task_context'));
});
test('partial context errors preserve successful data and propagate a failing CLI exit', async () => {
  const result = await cli([
    step({
      ...only,
      project: 'Project with spaces',
      files: [{ path: 'Project with spaces/src/a.ts' }, { path: 'Project with spaces/missing.ts' }],
    }),
  ]);
  assert.equal(result.code, 1, result.stdout);
  assert.equal(result.rows[0].ok, false);
  assert.equal(result.rows[0].result.hasErrors, true);
  assert.equal(result.rows[0].result.sections[0].ok, true);
  assert.equal(result.rows[0].result.sections[1].error.code, 'ENOENT');
  const invalid = await cli([step({ ...only, project: 'Project with spaces', offset: 1 })]);
  assert.equal(invalid.code, 1);
  assert.equal(invalid.rows[0].result.error.code, 'CONTEXT_PLAN_REQUIRED');
});
test('newly discovered instructions reject a stale cross-client plan and are included on fresh inspection', async () => {
  const args = {
    project: 'Project with spaces',
    files: [{ path: 'Project with spaces/src/a.ts' }],
    limit: 1,
  };
  const first = await call('task_context', args);
  await writeFile(path.join(root, 'Project with spaces/src/AGENTS.md'), 'new applicable instructions\n');
  const rejected = await cli([step({ ...args, offset: first.nextOffset, expectedPlanHash: first.planHash })]);
  assert.equal(rejected.code, 1);
  assert.equal(rejected.rows[0].result.error.code, 'CONTEXT_PLAN_CHANGED');
  const fresh = await cli([step({ ...args, limit: 20 })]);
  assert.equal(fresh.code, 0);
  assert.ok(
    fresh.rows[0].result.sections.some(
      (s) => s.kind === 'instruction' && s.request.arguments.path.endsWith('src/AGENTS.md'),
    ),
  );
});
test('CLI context discovers the same MCP workflow and patch without launching checks or touching staging', async () => {
  const project = 'History project';
  await mkdir(path.join(root, project));
  await writeFile(path.join(root, project, 'a.txt'), 'before\n');
  await execute('git', ['init', '--initial-branch=main'], {
    cwd: path.join(root, project),
    windowsHide: true,
  });
  await execute('git', ['add', 'a.txt'], { cwd: path.join(root, project), windowsHide: true });
  const index = await readFile(path.join(root, project, '.git/index'));
  await call('patch_apply', {
    operationId: 'context-cli-patch',
    files: [
      {
        path: project + '/a.txt',
        expectedHash: digest('before\n'),
        patch: createTwoFilesPatch(
          'a/' + project + '/a.txt',
          'b/' + project + '/a.txt',
          'before\n',
          'after\n',
        ),
      },
    ],
  });
  await call('workflow_create', {
    workflowId: 'context-cli-flow',
    title: 'context fixture',
    project,
    patchOperationId: 'context-cli-patch',
    checks: [
      {
        name: 'unstarted',
        kind: 'terminal',
        executable: process.execPath,
        args: ['-e', 'process.exit(88)'],
        timeoutSeconds: 10,
      },
    ],
  });
  const result = await cli([
    step({ ...only, includeWorkflows: true, project, files: [{ path: project + '/a.txt' }] }),
  ]);
  assert.equal(result.code, 0);
  const related = result.rows[0].result.sections.find((s) => s.kind === 'workflows').result;
  assert.equal(related.workflows[0].workflowId, 'context-cli-flow');
  assert.equal(related.workflows[0].patchOperationId, 'context-cli-patch');
  const status = await call('workflow_status', { workflowId: related.workflows[0].workflowId });
  assert.equal(status.steps[0].attempts.length, 0);
  assert.equal(status.state, 'pending');
  assert.deepEqual(await readFile(path.join(root, project, '.git/index')), index);
  const absent = await cli([step({ ...only, includeWorkflows: true, project: 'Project with spaces' })]);
  assert.deepEqual(absent.rows[0].result.sections[0].result.workflows, []);
});
test('selection pagination survives an owner restart while old file cursors require a fresh read', async () => {
  const args = {
    ...only,
    project: 'Project with spaces',
    files: [
      { path: 'Project with spaces/src/a.ts', lineCount: 1 },
      { path: 'Project with spaces/README.md' },
    ],
    limit: 1,
  };
  const before = await call('workspace_info'),
    first = await call('task_context', args);
  assert.equal(first.nextOffset, 1);
  await client.close();
  await start();
  assert.notEqual((await call('workspace_info')).localCli.instanceId, before.localCli.instanceId);
  const continued = await cli([
    step({ ...args, offset: first.nextOffset, expectedPlanHash: first.planHash }),
  ]);
  assert.equal(continued.code, 0);
  assert.equal(continued.rows[0].result.sections[0].index, 1);
  assert.equal(continued.rows[0].result.nextOffset, null);
  const old = first.sections[0].followUp;
  const invalid = await call(old.tool, old.arguments, true);
  assert.equal(invalid.error.code, 'INVALID_CURSOR');
  const fresh = await cli([step(args)]);
  assert.equal(fresh.code, 0);
  assert.equal(fresh.rows[0].result.sections[0].result.sha256, first.sections[0].result.sha256);
});
