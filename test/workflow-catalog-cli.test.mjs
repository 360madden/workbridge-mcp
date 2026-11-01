import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, rename, symlink, readdir, access } from 'node:fs/promises';
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
  owner,
  indexHash,
  args,
  sequence = 0;
const request = (tool, arguments_ = {}) => ({ tool, arguments: arguments_ });
async function start() {
  const client = new Client({ name: 'workflow-catalog-cli', version: '1' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.join(repo, 'dist/server.js')],
      cwd: repo,
      stderr: 'pipe',
      env: { ...process.env, WORKBRIDGE_ROOT: root, WORKBRIDGE_STATE_DIR: state, WORKBRIDGE_LOCAL_CLI: '1' },
    }),
  );
  return client;
}
async function call(tool, arguments_ = {}, expectedError = false) {
  const raw = await owner.callTool({ name: tool, arguments: arguments_ });
  assert.equal(!!raw.isError, expectedError, JSON.stringify(raw));
  const result = JSON.parse(raw.content[0].text);
  if (raw.structuredContent) assert.deepEqual(raw.structuredContent, result);
  return result;
}
async function cli(steps, discovery = false) {
  const input = path.join(fixture, 'request-' + sequence++ + '.json');
  await writeFile(input, JSON.stringify(steps));
  let output;
  try {
    output = {
      code: 0,
      ...(await execute(
        process.execPath,
        [
          path.join(repo, 'scripts/workbridge-cli.mjs'),
          '--service-state',
          state,
          '--root',
          root,
          ...(discovery ? ['--list-tools', '--tool', 'workflow_list'] : ['--input', input]),
          '--json',
        ],
        { cwd: repo, windowsHide: true, timeout: 120000, maxBuffer: 4 * 1024 * 1024 },
      )),
    };
  } catch (error) {
    output = { code: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
  return { ...output, rows: output.stdout.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse) };
}
async function preserve() {
  assert.equal(digest(await readFile(path.join(root, '.git/index'))), indexHash);
  assert.equal(await readFile(path.join(root, 'keep.txt'), 'utf8'), 'dirty file retained\n');
  await assert.rejects(access(path.join(root, 'must-not-run.txt')), (e) => e.code === 'ENOENT');
}
before(async () => {
  fixture = await mkdtemp(path.join(os.tmpdir(), 'wb-workflow-catalog-cli-'));
  root = path.join(fixture, 'Workspace ü');
  state = path.join(fixture, 'State');
  await mkdir(root);
  await mkdir(state);
  await writeFile(path.join(root, 'keep.txt'), 'staged baseline\n');
  await execute('git', ['init', '--quiet'], { cwd: root, windowsHide: true });
  await execute('git', ['add', '--', 'keep.txt'], { cwd: root, windowsHide: true });
  indexHash = digest(await readFile(path.join(root, '.git/index')));
  await writeFile(path.join(root, 'keep.txt'), 'dirty file retained\n');
  owner = await start();
  await call('patch_apply', {
    operationId: 'patch',
    files: [
      {
        path: 'target.txt',
        expectedHash: null,
        patch: createTwoFilesPatch('/dev/null', 'b/target.txt', '', 'applied fixture\n'),
      },
    ],
  });
  args = {
    workflowId: 'zz-valid',
    project: '.',
    title: 'Valid saved plan',
    patchOperationId: 'patch',
    checks: [
      {
        name: 'check',
        kind: 'terminal',
        executable: 'node',
        args: ['-e', 'process.exit(0)'],
        timeoutSeconds: 30,
      },
    ],
  };
  await call('workflow_create', args);
  await writeFile(path.join(state, 'workflows/bad.json'), '{broken');
});
after(async () => {
  await owner?.close();
  assert.ok(fixture.startsWith(path.resolve(os.tmpdir()) + path.sep));
  await rm(fixture, { recursive: true, force: true });
});

test('CLI discovers explicit workflow completeness, partial-error, and bounded-page fields', async () => {
  const result = await cli([], true);
  assert.equal(result.code, 0);
  const tool = result.rows[0].tools[0];
  assert.equal(tool.name, 'workflow_list');
  for (const name of [
    'hasErrors',
    'complete',
    'scanLimitReached',
    'outputLimitReached',
    'timeLimitReached',
    'order',
  ])
    assert.ok(tool.outputSchema.properties[name], name);
  await preserve();
});

test('MCP and CLI retain valid rows on partial failure and CLI stops before subsequent writes', async () => {
  const direct = await call('workflow_list', { limit: 10, scanLimit: 1000 }, true);
  assert.equal(direct.hasErrors, true);
  assert.equal(direct.complete, false);
  assert.equal(direct.issues[0].workflowId, 'bad');
  assert.equal(direct.issues[0].code, 'CORRUPT_WORKFLOW');
  assert.equal(direct.workflows[0].workflowId, 'zz-valid');
  assert.equal(direct.nextOffset, null);
  const output = await cli([
    request('workflow_list', { limit: 10, scanLimit: 1000 }),
    request('write_file', {
      operationId: 'must-not-run',
      path: 'must-not-run.txt',
      content: 'not expected',
      expectedHash: null,
    }),
  ]);
  assert.equal(output.code, 1);
  assert.equal(output.rows.length, 1);
  assert.equal(output.rows[0].ok, false);
  assert.deepEqual(output.rows[0].result, direct);
  await preserve();
});

test('a partial-error page is bounded and its CLI continuation succeeds on good records', async () => {
  const first = await call('workflow_list', { limit: 1, scanLimit: 1000 }, true);
  assert.equal(first.issues.length, 1);
  assert.equal(first.workflows.length, 0);
  assert.equal(first.nextOffset, 1);
  assert.ok(JSON.stringify(first).length <= 60000);
  const output = await cli([
    request('workflow_list', { offset: first.nextOffset, limit: 1, scanLimit: 1000 }),
    request('file_info', { path: 'target.txt', hash: true }),
  ]);
  assert.equal(output.code, 0);
  assert.equal(output.rows.length, 2);
  const last = output.rows[0].result;
  assert.equal(last.hasErrors, false);
  assert.equal(last.complete, true);
  assert.equal(last.nextOffset, null);
  assert.equal(last.workflows[0].workflowId, 'zz-valid');
  await preserve();
});

test('task context keeps successful source and workflow rows alongside the bounded catalog issue', async () => {
  const value = await call(
    'task_context',
    {
      project: '.',
      files: [{ path: 'target.txt', lineCount: 5 }],
      includeOverview: false,
      includeInstructions: false,
      includeDocuments: false,
      includeWorkflows: true,
    },
    true,
  );
  assert.equal(value.hasErrors, true);
  assert.ok(
    value.sections.some(
      (s) => s.kind === 'source' && s.ok && s.result.sha256 === digest('applied fixture\n'),
    ),
  );
  const section = value.sections.find((s) => s.kind === 'workflows');
  assert.equal(section.ok, false);
  assert.equal(section.result.hasErrors, true);
  assert.equal(section.result.workflows[0].workflowId, 'zz-valid');
  assert.equal(section.error.code, 'CONTEXT_CATALOG_ISSUES');
  assert.ok(JSON.stringify(value).length <= 60000);
  await preserve();
});

test('partial-error semantics and good rows persist after owner restart without running workflow checks', async () => {
  const old = (await call('workspace_info')).localCli.instanceId;
  await owner.close();
  owner = await start();
  assert.notEqual((await call('workspace_info')).localCli.instanceId, old);
  const output = await cli([request('workflow_list')]);
  assert.equal(output.code, 1);
  assert.equal(output.rows[0].result.workflows[0].workflowId, 'zz-valid');
  const status = await call('workflow_status', { workflowId: 'zz-valid' });
  assert.equal(status.state, 'pending');
  assert.equal(status.steps[0].attempts.length, 0);
  await preserve();
});

test('linked workflow catalogs are rejected across both transports before journal writes or job launches', async () => {
  const catalog = path.join(state, 'workflows'),
    real = path.join(state, 'preserved-catalog');
  await rename(catalog, real);
  await symlink(real, catalog, process.platform === 'win32' ? 'junction' : 'dir');
  const saved = await readFile(path.join(real, 'zz-valid.json')),
    names = await readdir(real);
  for (const [tool, arguments_] of [
    ['workflow_status', { workflowId: 'zz-valid' }],
    ['workflow_resume', { workflowId: 'zz-valid' }],
    ['workflow_cancel', { workflowId: 'zz-valid' }],
    ['workflow_review', { workflowId: 'zz-valid' }],
    ['workflow_create', args],
    ['workflow_create', { ...args, workflowId: 'new' }],
    ['workflow_list', {}],
  ]) {
    const direct = await call(tool, arguments_, true);
    assert.ok(['CORRUPT_WORKFLOW', 'HISTORY_METADATA'].includes(direct.error.code));
    const output = await cli([
      request(tool, arguments_),
      request('write_file', {
        operationId: 'must-not-run-linked-' + sequence,
        path: 'must-not-run.txt',
        content: 'not expected',
        expectedHash: null,
      }),
    ]);
    assert.equal(output.code, 1);
    assert.equal(output.rows.length, 1);
    assert.deepEqual(output.rows[0].result, direct);
  }
  assert.deepEqual(await readFile(path.join(real, 'zz-valid.json')), saved);
  assert.deepEqual(await readdir(real), names);
  await preserve();
});
