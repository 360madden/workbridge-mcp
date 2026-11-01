import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { digest } from '../dist/changes.js';
const execute = promisify(execFile),
  repo = path.resolve('.');
let fixture,
  root,
  state,
  client,
  sequence = 0,
  indexHash;
async function start() {
  client = new Client({ name: 'config-cli-test', version: '1' });
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
  fixture = await mkdtemp(path.join(os.tmpdir(), 'wb-config-cli-'));
  root = path.join(fixture, 'Workspace ü');
  state = path.join(fixture, 'State');
  await mkdir(root);
  await mkdir(state);
  await mkdir(path.join(root, 'Project with spaces'));
  await writeFile(path.join(root, 'Project with spaces/a.json'), '{"value":1}\n');
  await writeFile(
    path.join(root, 'Project with spaces/b.jsonc'),
    '// preserve this comment\n{\n  "enabled": false,\n}\n',
  );
  await execute('git', ['init', '--quiet'], { cwd: root, windowsHide: true });
  await execute('git', ['add', '.'], { cwd: root, windowsHide: true });
  indexHash = digest(await readFile(path.join(root, '.git/index')));
  await start();
});
after(async () => {
  await client?.close();
  assert.ok(fixture.startsWith(path.resolve(os.tmpdir()) + path.sep));
  await rm(fixture, { recursive: true, force: true });
});
const step = (tool, args = {}) => ({ tool, arguments: args });
async function call(tool, args = {}, error = false) {
  const r = await client.callTool({ name: tool, arguments: args });
  assert.equal(!!r.isError, error, JSON.stringify(r));
  const result = JSON.parse(r.content[0].text);
  if (r.structuredContent) assert.deepEqual(r.structuredContent, result);
  return result;
}
async function cli(requests, extra = []) {
  const input = path.join(fixture, 'input-' + sequence++ + '.json');
  await writeFile(input, JSON.stringify(requests));
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
          ...(extra.includes('--list-tools') ? [] : ['--input', input]),
          '--json',
          ...extra,
        ],
        { cwd: repo, windowsHide: true },
      )),
    };
  } catch (e) {
    output = { code: e.code, stdout: e.stdout, stderr: e.stderr };
  }
  return { ...output, rows: output.stdout.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse) };
}
async function entry(file, pointer, value, format = 'json') {
  const p = 'Project with spaces/' + file;
  return {
    path: p,
    expectedHash: digest(await readFile(path.join(root, p))),
    format,
    operations: [{ op: 'replace', path: pointer, value }],
  };
}

test('CLI discovers both structured tools and previews/applies a multi-file set with shared MCP review and guarded undo', async () => {
  const discovered = await cli([], ['--list-tools']);
  assert.equal(discovered.code, 0);
  const catalog = discovered.rows[0];
  assert.equal(catalog.serverVersion, '0.16.4-dev');
  assert.equal(catalog.tools.length, 64);
  for (const name of ['config_preview', 'config_apply'])
    assert.ok(catalog.tools.find((t) => t.name === name)?.outputSchema);
  assert.equal(catalog.tools.find((t) => t.name === 'config_preview').annotations.readOnlyHint, true);
  assert.equal(catalog.tools.find((t) => t.name === 'config_apply').annotations.readOnlyHint, false);
  const files = [await entry('a.json', '/value', 2), await entry('b.jsonc', '/enabled', true, 'jsonc')];
  const result = await cli([
    step('config_preview', { files }),
    step('config_apply', { operationId: 'cli-config', files }),
  ]);
  assert.equal(result.code, 0, result.stdout);
  assert.equal(result.rows[0].result.applicable, true);
  assert.equal(result.rows[1].result.state, 'applied');
  const status = await call('patch_status', { operationId: 'cli-config' });
  assert.ok(status.current.every((f) => f.matches === 'after'));
  assert.equal((await call('patch_diff', { operationId: 'cli-config' })).diff, result.rows[0].result.diff);
  assert.ok((await call('patch_list')).patches.some((p) => p.operationId === 'cli-config'));
  assert.ok(
    (await readFile(path.join(root, 'Project with spaces/b.jsonc'), 'utf8')).startsWith(
      '// preserve this comment\n',
    ),
  );
  const replay = await cli([step('config_apply', { operationId: 'cli-config', files })]);
  assert.equal(replay.rows[0].result.replayed, true);
  await call('patch_undo', { operationId: 'cli-config' });
  assert.equal(await readFile(path.join(root, 'Project with spaces/a.json'), 'utf8'), '{"value":1}\n');
  assert.equal(digest(await readFile(path.join(root, '.git/index'))), indexHash);
});
test('MCP-created structured changes are validated/reviewed by CLI workflows and undone by the shared patch ID', async () => {
  const files = [await entry('a.json', '/value', 3)];
  await call('config_apply', { operationId: 'mcp-config', files });
  await call('workflow_create', {
    workflowId: 'config-check',
    title: 'Validate actual JSON',
    project: 'Project with spaces',
    patchOperationId: 'mcp-config',
    inputs: [],
    checks: [
      {
        name: 'JSON value',
        kind: 'terminal',
        executable: process.execPath,
        args: [
          '-e',
          "const f=require('fs');const a=require('assert/strict');a.equal(JSON.parse(f.readFileSync('a.json','utf8')).value,3);console.log('CONFIG_VALIDATION_OK')",
        ],
        timeoutSeconds: 30,
      },
    ],
  });
  const result = await cli([
    { runWorkflow: 'config-check' },
    step('workflow_review', { workflowId: 'config-check' }),
    step('patch_undo', { operationId: 'mcp-config' }),
  ]);
  assert.equal(result.code, 0, result.stdout);
  assert.equal(result.rows[0].result.state, 'ready_for_review');
  assert.equal(result.rows[1].result.steps[0].job.exitCode, 0);
  assert.equal(result.rows[2].result.state, 'undone');
  assert.equal((await call('workflow_status', { workflowId: 'config-check' })).state, 'undone');
  assert.equal(digest(await readFile(path.join(root, '.git/index'))), indexHash);
});
test('failed CLI config preflight exits 1, identifies the operation, preserves all files and stops later requests', async () => {
  const a = await entry('a.json', '/value', 4),
    b = await entry('b.jsonc', '/enabled', true, 'jsonc');
  b.operations.push({ op: 'test', path: '/enabled', value: false });
  const result = await cli([
    step('config_apply', { operationId: 'failed-config', files: [a, b] }),
    step('write_file', {
      path: 'should-not-exist',
      text: 'bad',
      expectedHash: null,
      operationId: 'must-not-run',
    }),
  ]);
  assert.equal(result.code, 1);
  assert.equal(result.rows.length, 1);
  const error = result.rows[0].result.error;
  assert.equal(error.code, 'CONFIG_PREFLIGHT');
  assert.equal(error.details.issues[0].fileIndex, 1);
  assert.equal(error.details.issues[0].details.operationIndex, 1);
  assert.equal(error.details.issues[0].code, 'CONFIG_TEST_FAILED');
  assert.equal(
    (await call('patch_status', { operationId: 'failed-config' }, true)).error.code,
    'UNKNOWN_PATCH',
  );
  assert.equal(await readFile(path.join(root, 'Project with spaces/a.json'), 'utf8'), '{"value":1}\n');
  await assert.rejects(readFile(path.join(root, 'should-not-exist')), { code: 'ENOENT' });
});
test('owner restart retains structured request replay identity and refuses changed args or overwriting a later edit', async () => {
  const files = [await entry('a.json', '/value', 5)];
  assert.equal((await cli([step('config_apply', { operationId: 'restart-config', files })])).code, 0);
  const before = (await call('workspace_info')).localCli.instanceId;
  await client.close();
  await start();
  assert.notEqual((await call('workspace_info')).localCli.instanceId, before);
  const replay = await cli([step('config_apply', { operationId: 'restart-config', files })]);
  assert.equal(replay.code, 0);
  assert.equal(replay.rows[0].result.replayed, true);
  const changed = await cli([
    step('config_apply', {
      operationId: 'restart-config',
      files: [{ ...files[0], operations: [{ op: 'replace', path: '/value', value: 6 }] }],
    }),
  ]);
  assert.equal(changed.code, 1);
  assert.equal(changed.rows[0].result.error.code, 'ID_REUSE');
  const target = path.join(root, 'Project with spaces/a.json'),
    after = await readFile(target);
  await writeFile(target, '{"value":99}\n');
  const refused = await cli([step('patch_undo', { operationId: 'restart-config' })]);
  assert.equal(refused.code, 1);
  assert.equal(refused.rows[0].result.error.details.cause.code, 'PATCH_CONFLICT');
  assert.equal(await readFile(target, 'utf8'), '{"value":99}\n');
  await writeFile(target, after);
  await call('patch_undo', { operationId: 'restart-config' });
  assert.equal(digest(await readFile(path.join(root, '.git/index'))), indexHash);
});
