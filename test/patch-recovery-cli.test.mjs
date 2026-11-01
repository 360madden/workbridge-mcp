import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, rename, symlink, access } from 'node:fs/promises';
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
  badRequest,
  sequence = 0;
const request = (tool, args = {}) => ({ tool, arguments: args });
async function start() {
  const client = new Client({ name: 'patch-recovery-cli', version: '1' });
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
before(async () => {
  fixture = await mkdtemp(path.join(os.tmpdir(), 'wb-patch-recovery-cli-'));
  root = path.join(fixture, 'Workspace ü');
  state = path.join(fixture, 'State');
  await mkdir(root);
  await mkdir(state);
  await writeFile(path.join(root, 'keep.txt'), 'staged baseline\n');
  await execute('git', ['init', '--quiet'], { cwd: root, windowsHide: true });
  await execute('git', ['add', '--', 'keep.txt'], { cwd: root, windowsHide: true });
  indexHash = digest(await readFile(path.join(root, '.git/index')));
  await writeFile(path.join(root, 'keep.txt'), 'unrelated dirty edit\n');
  owner = await start();
});
after(async () => {
  await owner?.close();
  assert.ok(fixture.startsWith(path.resolve(os.tmpdir()) + path.sep));
  await rm(fixture, { recursive: true, force: true });
});
async function call(name, args = {}, expectedError = false) {
  const raw = await owner.callTool({ name, arguments: args });
  assert.equal(!!raw.isError, expectedError, JSON.stringify(raw));
  const value = JSON.parse(raw.content[0].text);
  if (raw.structuredContent) assert.deepEqual(raw.structuredContent, value);
  return value;
}
async function cli(steps) {
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
          '--input',
          input,
          '--json',
        ],
        { cwd: repo, windowsHide: true, timeout: 120000 },
      )),
    };
  } catch (error) {
    output = { code: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
  return { ...output, rows: output.stdout.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse) };
}
async function preserve() {
  assert.equal(digest(await readFile(path.join(root, '.git/index'))), indexHash);
  assert.equal(await readFile(path.join(root, 'keep.txt'), 'utf8'), 'unrelated dirty edit\n');
  await assert.rejects(access(path.join(root, 'must-not-run.txt')), (error) => error.code === 'ENOENT');
}
async function create(id, file) {
  const before = 'original ' + file + '\r\n',
    after = 'changed ' + file + '\r\n';
  await writeFile(path.join(root, file), before);
  const args = {
    operationId: id,
    files: [
      {
        path: file,
        expectedHash: digest(before),
        patch: createTwoFilesPatch('a/' + file, 'b/' + file, before, after),
      },
    ],
  };
  await call('patch_apply', args);
  return { args, before, after, file, record: path.join(state, 'patches', id, 'record.json') };
}
async function rejectedAcrossClients(tool, args) {
  const direct = await call(tool, args, true);
  assert.equal(direct.error.code, 'CORRUPT_PATCH');
  const output = await cli([
    request(tool, args),
    request('write_file', {
      operationId: 'must-not-run-' + sequence,
      path: 'must-not-run.txt',
      content: 'must not appear',
      expectedHash: null,
    }),
  ]);
  assert.equal(output.code, 1, JSON.stringify(output));
  assert.equal(output.rows.length, 1);
  assert.equal(output.rows[0].ok, false);
  assert.deepEqual(output.rows[0].result, direct);
  await preserve();
}

test('CLI/MCP refuse contradictory completed patch state and stop later batch writes, preserving staging', async () => {
  const f = await create('bad', 'bad.txt');
  badRequest = f;
  const record = JSON.parse(await readFile(f.record, 'utf8'));
  record.state = 'undone';
  await writeFile(f.record, JSON.stringify(record));
  const saved = await readFile(f.record),
    names = await readdir(path.dirname(f.record));
  for (const tool of ['patch_status', 'patch_diff', 'patch_resume', 'patch_undo'])
    await rejectedAcrossClients(tool, { operationId: 'bad' });
  await rejectedAcrossClients('patch_apply', f.args);
  assert.deepEqual(await readFile(f.record), saved);
  assert.deepEqual(await readdir(path.dirname(f.record)), names);
  assert.equal(await readFile(path.join(root, f.file), 'utf8'), f.after);
});

test('refusal survives owner restart and partial catalog results retain valid patches', async () => {
  const good = await create('valid', 'valid.txt');
  const old = (await call('workspace_info')).localCli.instanceId;
  await owner.close();
  owner = await start();
  assert.notEqual((await call('workspace_info')).localCli.instanceId, old);
  await rejectedAcrossClients('patch_undo', { operationId: 'bad' });
  const direct = await call('patch_list', {}, true),
    output = await cli([request('patch_list')]);
  assert.equal(output.code, 1);
  assert.equal(output.rows[0].ok, false);
  assert.deepEqual(output.rows[0].result, direct);
  assert.equal(direct.hasErrors, true);
  assert.equal(direct.complete, false);
  assert.equal(direct.issues[0].operationId, 'bad');
  assert.equal(direct.issues[0].code, 'CORRUPT_PATCH');
  assert.equal(direct.patches[0].operationId, 'valid');
  assert.equal((await cli([request('patch_undo', { operationId: 'valid' })])).code, 0);
  assert.equal(await readFile(path.join(root, good.file), 'utf8'), good.before);
  assert.equal(await readFile(path.join(root, badRequest.file), 'utf8'), badRequest.after);
  await preserve();
});

test('linked patch operation is refused over both transports without rewriting linked evidence', async () => {
  const f = await create('linked', 'linked.txt');
  const source = path.dirname(f.record),
    real = path.join(state, 'preserved-operation');
  await rename(source, real);
  await symlink(real, source, process.platform === 'win32' ? 'junction' : 'dir');
  const saved = await readFile(f.record);
  for (const tool of ['patch_status', 'patch_diff', 'patch_resume', 'patch_undo'])
    await rejectedAcrossClients(tool, { operationId: 'linked' });
  await rejectedAcrossClients('patch_apply', f.args);
  assert.deepEqual(await readFile(f.record), saved);
  assert.equal(await readFile(path.join(root, f.file), 'utf8'), f.after);
  const catalog = await call('patch_list', {}, true);
  assert.ok(catalog.issues.some((issue) => issue.operationId === 'linked' && issue.code === 'CORRUPT_PATCH'));
  await preserve();
});
