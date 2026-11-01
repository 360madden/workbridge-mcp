import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
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
  indexHash,
  sequence = 0;
async function start() {
  client = new Client({ name: 'history-cli-test', version: '1' });
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
  fixture = await mkdtemp(path.join(os.tmpdir(), 'wb-history-cli-'));
  root = path.join(fixture, 'Workspace ü');
  state = path.join(fixture, 'State');
  await mkdir(root);
  await mkdir(state);
  for (const p of ['Project', 'Project-copy']) await mkdir(path.join(root, p));
  await writeFile(path.join(root, 'Project/config.json'), '{"value":1}\n');
  await writeFile(path.join(root, 'Project/keep.txt'), 'staged baseline\n');
  await execute('git', ['init', '--quiet'], { cwd: root, windowsHide: true });
  await execute('git', ['add', '.'], { cwd: root, windowsHide: true });
  indexHash = digest(await readFile(path.join(root, '.git/index')));
  await writeFile(path.join(root, 'Project/keep.txt'), 'existing dirty edit\n');
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
async function preserved() {
  assert.equal(digest(await readFile(path.join(root, '.git/index'))), indexHash);
  assert.equal(await readFile(path.join(root, 'Project/keep.txt'), 'utf8'), 'existing dirty edit\n');
}

test('CLI discovers history filters and continues a sparse MCP page without modifying files or journals', async () => {
  const discovery = await cli([], ['--list-tools']);
  assert.equal(discovery.code, 0);
  assert.equal(discovery.rows[0].serverVersion, '0.16.4-dev');
  assert.equal(discovery.rows[0].tools.length, 64);
  for (const name of ['change_list', 'patch_list']) {
    const tool = discovery.rows[0].tools.find((t) => t.name === name);
    for (const field of ['project', 'path', 'state', 'scanLimit'])
      assert.ok(tool.inputSchema.properties[field]);
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.ok(tool.outputSchema.properties.complete);
  }
  for (const [id, file] of [
    ['a-out', 'Project-copy/a'],
    ['b-one', 'Project/one'],
    ['c-out', 'Project-copy/c'],
    ['d-two', 'Project/two'],
  ])
    await call('write_file', { operationId: id, path: file, content: id, expectedHash: null });
  const before = await readFile(path.join(state, 'changes/b-one.json'));
  const args = { project: 'Project', state: 'applied', limit: 1, scanLimit: 1 };
  const first = await call('change_list', args);
  assert.equal(first.changes.length, 0);
  assert.equal(first.nextOffset, 1);
  assert.equal(first.scanLimitReached, true);
  const continued = await cli([step('change_list', { ...args, offset: first.nextOffset })]);
  assert.equal(continued.code, 0, continued.stdout);
  assert.equal(continued.rows[0].result.changes[0].operationId, 'b-one');
  assert.equal(continued.rows[0].result.nextOffset, 2);
  const reverse = await cli([step('change_list', { ...args, offset: 2 })]);
  const final = await call('change_list', { ...args, offset: reverse.rows[0].result.nextOffset });
  assert.equal(final.changes[0].operationId, 'd-two');
  assert.equal(final.nextOffset, null);
  assert.deepEqual(await readFile(path.join(state, 'changes/b-one.json')), before);
  assert.equal((await readdir(state)).includes('jobs'), false);
  await preserved();
});
test('CLI configuration patches are found by MCP filters and can be guardedly undone by discovered ID', async () => {
  const file = 'Project/config.json';
  const files = [
    {
      path: file,
      expectedHash: digest(await readFile(path.join(root, file))),
      operations: [{ op: 'replace', path: '/value', value: 2 }],
    },
  ];
  const applied = await cli([step('config_apply', { operationId: 'history-config', files })]);
  assert.equal(applied.code, 0, applied.stdout);
  const found = await call('patch_list', { project: 'Project', path: file, state: 'applied', scanLimit: 1 });
  assert.equal(found.patches.length, 1);
  assert.equal(found.patches[0].operationId, 'history-config');
  assert.equal(found.patches[0].fileCount, 1);
  assert.equal(found.complete, true);
  const journal = await readFile(path.join(state, 'patches/history-config/record.json'));
  const again = await cli([step('patch_list', { project: 'Project', path: file, state: 'applied' })]);
  assert.deepEqual(again.rows[0].result, found);
  assert.deepEqual(await readFile(path.join(state, 'patches/history-config/record.json')), journal);
  await call('patch_undo', { operationId: found.patches[0].operationId });
  const undone = await cli([step('patch_list', { project: 'Project', state: 'undone' })]);
  assert.equal(undone.rows[0].result.patches[0].operationId, 'history-config');
  assert.equal(await readFile(path.join(root, file), 'utf8'), '{"value":1}\n');
  await preserved();
});
test('history continuation and exact IDs survive owner restart without relaunching commands', async () => {
  const first = await call('change_list', { project: 'Project', limit: 1 });
  const owner = (await call('workspace_info')).localCli.instanceId;
  await client.close();
  await start();
  assert.notEqual((await call('workspace_info')).localCli.instanceId, owner);
  const continued = await cli([
    step('change_list', { project: 'Project', limit: 1, offset: first.nextOffset }),
  ]);
  assert.equal(continued.code, 0);
  assert.equal(continued.rows[0].result.changes[0].operationId, 'd-two');
  assert.equal((await call('command_list', { status: 'running' })).jobs.length, 0);
  await preserved();
});
test('partial history failures preserve good rows, exit 1 and stop later CLI mutations', async () => {
  await writeFile(path.join(state, 'changes/aa-corrupt.json'), '{broken');
  const result = await cli([
    step('change_list', { project: 'Project' }),
    step('write_file', {
      operationId: 'must-not-run',
      path: 'should-not-exist',
      content: 'bad',
      expectedHash: null,
    }),
  ]);
  assert.equal(result.code, 1, result.stdout);
  assert.equal(result.rows.length, 1);
  const page = result.rows[0].result;
  assert.equal(result.rows[0].ok, false);
  assert.equal(page.hasErrors, true);
  assert.equal(page.complete, false);
  assert.equal(page.issues[0].operationId, 'aa-corrupt');
  assert.deepEqual(
    page.changes.map((c) => c.operationId),
    ['b-one', 'd-two'],
  );
  assert.deepEqual(await call('change_list', { project: 'Project' }, true), page);
  await assert.rejects(readFile(path.join(root, 'should-not-exist')), (e) => e.code === 'ENOENT');
  await preserved();
});
test('CLI history errors retain path and input validation without widening access', async () => {
  const outside = await cli([step('patch_list', { project: fixture })]);
  assert.equal(outside.code, 1);
  assert.equal(outside.rows[0].result.error.code, 'OUTSIDE_ROOT');
  const invalid = await cli([step('change_list', { scanLimit: 1001 })]);
  assert.equal(invalid.code, 1);
  assert.equal(invalid.rows[0].ok, false);
  const protectedResult = await cli([step('change_list', { path: state })]);
  assert.equal(protectedResult.code, 1);
  assert.equal(protectedResult.rows[0].result.error.code, 'PROTECTED_PATH');
  await preserved();
});
