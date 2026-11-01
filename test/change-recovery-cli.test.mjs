import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
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
  client = new Client({ name: 'change-recovery-cli', version: '1' });
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
  fixture = await mkdtemp(path.join(os.tmpdir(), 'wb-recovery-cli-'));
  root = path.join(fixture, 'Workspace ü');
  state = path.join(fixture, 'State');
  await mkdir(root);
  await mkdir(state);
  await writeFile(path.join(root, 'keep.txt'), 'staged baseline\n');
  await execute('git', ['init', '--quiet'], { cwd: root, windowsHide: true });
  await execute('git', ['add', '.'], { cwd: root, windowsHide: true });
  indexHash = digest(await readFile(path.join(root, '.git/index')));
  await writeFile(path.join(root, 'keep.txt'), 'existing dirty edit\n');
  await start();
});
after(async () => {
  await client?.close();
  assert.ok(fixture.startsWith(path.resolve(os.tmpdir()) + path.sep));
  await rm(fixture, { recursive: true, force: true });
});
async function call(name, args = {}, isError = false) {
  const raw = await client.callTool({ name, arguments: args });
  assert.equal(!!raw.isError, isError, JSON.stringify(raw));
  const result = JSON.parse(raw.content[0].text);
  if (raw.structuredContent) assert.deepEqual(raw.structuredContent, result);
  return result;
}
async function cli(steps) {
  const input = path.join(fixture, 'input-' + sequence++ + '.json');
  await writeFile(input, JSON.stringify(steps));
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
        ],
        { cwd: repo, windowsHide: true },
      )),
    };
  } catch (e) {
    result = { code: e.code, stdout: e.stdout, stderr: e.stderr };
  }
  return { ...result, rows: result.stdout.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse) };
}
const request = (tool, args = {}) => ({ tool, arguments: args });
async function preserve() {
  assert.equal(digest(await readFile(path.join(root, '.git/index'))), indexHash);
  assert.equal(await readFile(path.join(root, 'keep.txt'), 'utf8'), 'existing dirty edit\n');
}

test('MCP and CLI reject a mismatched journal identity before status, replay or undo; later batch writes do not run', async () => {
  const args = {
    operationId: 'original-id',
    path: 'created.txt',
    content: 'applied disposable bytes\n',
    expectedHash: null,
  };
  await call('write_file', args);
  const journal = path.join(state, 'changes/original-id.json'),
    record = JSON.parse(await readFile(journal, 'utf8'));
  record.id = 'different-id';
  await writeFile(journal, JSON.stringify(record));
  const saved = await readFile(journal),
    names = await readdir(path.join(state, 'changes'));
  for (const [tool, arguments_] of [
    ['change_status', { operationId: 'original-id' }],
    ['undo_change', { operationId: 'original-id' }],
    ['write_file', args],
  ]) {
    const direct = await call(tool, arguments_, true);
    assert.equal(direct.error.code, 'CORRUPT_CHANGE');
    const output = await cli([
      request(tool, arguments_),
      request('write_file', {
        operationId: 'must-not-run',
        path: 'unwanted.txt',
        content: 'bad',
        expectedHash: null,
      }),
    ]);
    assert.equal(output.code, 1);
    assert.equal(output.rows.length, 1);
    assert.equal(output.rows[0].ok, false);
    assert.deepEqual(output.rows[0].result, direct);
  }
  assert.deepEqual(await readFile(journal), saved);
  assert.deepEqual(await readdir(path.join(state, 'changes')), names);
  assert.equal(await readFile(path.join(root, 'created.txt'), 'utf8'), args.content);
  assert.equal((await readdir(root)).includes('unwanted.txt'), false);
  await preserve();
});

test('same refusal persists after owner restart and catalog still reports the corrupt operation without dropping valid rows', async () => {
  await call('write_file', {
    operationId: 'valid-id',
    path: 'valid.txt',
    content: 'valid',
    expectedHash: null,
  });
  const old = (await call('workspace_info')).localCli.instanceId;
  await client.close();
  await start();
  assert.notEqual((await call('workspace_info')).localCli.instanceId, old);
  const output = await cli([request('undo_change', { operationId: 'original-id' })]);
  assert.equal(output.code, 1);
  assert.equal(output.rows[0].result.error.code, 'CORRUPT_CHANGE');
  const page = await call('change_list', {}, true);
  assert.equal(page.issues[0].operationId, 'original-id');
  assert.equal(page.issues[0].code, 'CORRUPT_CHANGE');
  assert.equal(page.changes[0].operationId, 'valid-id');
  assert.equal(page.complete, false);
  assert.equal((await cli([request('undo_change', { operationId: 'valid-id' })])).code, 0);
  assert.equal((await call('change_status', { operationId: 'valid-id' })).state, 'undone');
  await preserve();
});
