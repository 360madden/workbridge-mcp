import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { createTwoFilesPatch, parsePatch } from 'diff';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { digest } from '../dist/changes.js';

const execute = promisify(execFile);
const repo = path.resolve('.');
let fixture, root, state, wrapper, owner;
before(async () => {
  fixture = await mkdtemp(path.join(os.tmpdir(), 'workbridge-patch-cli-'));
  root = path.join(fixture, 'Workspace ü');
  state = path.join(fixture, 'State');
  await mkdir(root);
  await mkdir(state);
  wrapper = path.join(fixture, 'disposable-owner.mjs');
  await writeFile(
    wrapper,
    `
import fs from 'node:fs/promises';import {existsSync} from 'node:fs';import {syncBuiltinESMExports} from 'node:module';import path from 'node:path';
const rename=fs.rename;
fs.rename=async function(...args){
 if(args[1]===path.join(process.env.WORKBRIDGE_ROOT,'recover','b.txt') && existsSync(path.join(process.env.WORKBRIDGE_STATE_DIR,'fixture-fault')))
  throw Object.assign(new Error('fixture locked file'),{code:'EACCES'});
 return rename(...args);
};syncBuiltinESMExports();
await import(${JSON.stringify(pathToFileURL(path.join(repo, 'dist/server.js')).href)});
`,
  );
  owner = await start();
});
after(async () => {
  await owner?.close();
  await rm(fixture, { recursive: true, force: true });
});
async function start() {
  const client = new Client({ name: 'patch-cli-fixture', version: '1' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [wrapper],
      cwd: repo,
      stderr: 'pipe',
      env: { ...process.env, WORKBRIDGE_ROOT: root, WORKBRIDGE_STATE_DIR: state, WORKBRIDGE_LOCAL_CLI: '1' },
    }),
  );
  return client;
}
async function call(tool, args = {}) {
  const result = await owner.callTool({ name: tool, arguments: args });
  const data = JSON.parse(result.content[0].text);
  if (!result.isError) assert.deepEqual(result.structuredContent, data);
  return { error: !!result.isError, data };
}
async function cli(name, requests) {
  const input = path.join(fixture, `${name}.json`);
  await writeFile(input, JSON.stringify(requests));
  let result;
  try {
    result = {
      code: 0,
      ...(await execute(
        process.execPath,
        [path.join(repo, 'scripts/workbridge-cli.mjs'), '--service-state', state, '--input', input, '--json'],
        { cwd: repo, windowsHide: true },
      )),
    };
  } catch (error) {
    result = { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
  return {
    ...result,
    rows: result.stdout
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
  };
}
async function files(name) {
  await mkdir(path.join(root, name));
  const result = [];
  for (const file of ['a.txt', 'b.txt']) {
    const label = `${name}/${file}`;
    const before = `old ${file}\n`,
      after = `new ${file}\n`;
    await writeFile(path.join(root, label), before);
    result.push({
      path: label,
      expectedHash: digest(before),
      patch: createTwoFilesPatch(`a/${label}`, `b/${label}`, before, after),
    });
  }
  return result;
}

test('CLI discovers patch schemas and uses preview/apply/diff/undo across separate invocations', async () => {
  const catalog = await owner.listTools();
  assert.equal(catalog.tools.length, 64);
  for (const name of [
    'patch_preview',
    'patch_apply',
    'patch_status',
    'patch_diff',
    'patch_list',
    'patch_resume',
    'patch_undo',
  ]) {
    assert.ok(catalog.tools.find((tool) => tool.name === name)?.outputSchema);
  }
  const entries = await files('Shared ü files');
  const preview = await cli('preview', [{ tool: 'patch_preview', arguments: { files: entries } }]);
  assert.equal(preview.code, 0, preview.stdout);
  assert.equal(preview.rows[0].result.applicable, true);
  const applied = await cli('apply', [
    { tool: 'patch_apply', arguments: { operationId: 'cli-patch', files: entries } },
  ]);
  assert.equal(applied.code, 0, applied.stdout);
  assert.equal(applied.rows[0].result.state, 'applied');
  const status = await call('patch_status', { operationId: 'cli-patch' });
  assert.equal(status.error, false);
  assert.ok(status.data.current.every((file) => file.matches === 'after'));
  const review = await cli('review', [
    { tool: 'patch_list', arguments: {} },
    { tool: 'patch_diff', arguments: { operationId: 'cli-patch' } },
  ]);
  assert.equal(review.code, 0, review.stdout);
  assert.equal(review.rows[0].result.patches[0].fileCount, 2);
  assert.equal(parsePatch(review.rows[1].result.diff)[0].oldFileName, 'a/Shared ü files/a.txt');
  const undone = await cli('undo', [{ tool: 'patch_undo', arguments: { operationId: 'cli-patch' } }]);
  assert.equal(undone.code, 0, undone.stdout);
  assert.equal((await call('patch_status', { operationId: 'cli-patch' })).data.state, 'undone');
});

test('CLI preflight and undo conflicts exit nonzero with structured errors and preserve files', async () => {
  const entries = await files('conflicts');
  const invalid = structuredClone(entries);
  invalid[1].expectedHash = '0'.repeat(64);
  const failed = await cli('preflight-failure', [
    { tool: 'patch_apply', arguments: { operationId: 'conflict-patch', files: invalid } },
  ]);
  assert.equal(failed.code, 1);
  assert.equal(failed.rows[0].ok, false);
  assert.equal(failed.rows[0].result.error.code, 'PATCH_PREFLIGHT');
  assert.equal(await readFile(path.join(root, 'conflicts/a.txt'), 'utf8'), 'old a.txt\n');
  assert.equal((await call('patch_apply', { operationId: 'conflict-patch', files: entries })).error, false);
  await writeFile(path.join(root, 'conflicts/a.txt'), 'later edit\n');
  const undo = await cli('undo-conflict', [
    { tool: 'patch_undo', arguments: { operationId: 'conflict-patch' } },
  ]);
  assert.equal(undo.code, 1);
  assert.equal(undo.rows[0].result.error.details.cause.code, 'PATCH_CONFLICT');
  assert.equal(await readFile(path.join(root, 'conflicts/b.txt'), 'utf8'), 'new b.txt\n');
  assert.equal(await readFile(path.join(root, 'conflicts/a.txt'), 'utf8'), 'later edit\n');
});

test('partial CLI patches remain discoverable after owner restart and resume without repeating completed files', async () => {
  const entries = await files('recover');
  await writeFile(path.join(state, 'fixture-fault'), 'enabled');
  const failed = await cli('partial', [
    { tool: 'patch_apply', arguments: { operationId: 'recover-patch', files: entries } },
  ]);
  assert.equal(failed.code, 1);
  assert.equal(failed.rows[0].result.error.code, 'PATCH_BLOCKED');
  const before = (await call('patch_status', { operationId: 'recover-patch' })).data;
  assert.deepEqual(
    before.current.map((file) => file.matches),
    ['after', 'before'],
  );
  await owner.close();
  await unlink(path.join(state, 'fixture-fault'));
  owner = await start();
  const after = (
    await cli('recover-status', [{ tool: 'patch_status', arguments: { operationId: 'recover-patch' } }])
  ).rows[0].result;
  assert.deepEqual(after.current, before.current);
  const resumed = await cli('resume', [
    { tool: 'patch_resume', arguments: { operationId: 'recover-patch' } },
  ]);
  assert.equal(resumed.code, 0, resumed.stdout);
  assert.equal(resumed.rows[0].result.state, 'applied');
  assert.equal((await call('patch_undo', { operationId: 'recover-patch' })).data.state, 'undone');
  assert.equal(await readFile(path.join(root, 'recover/a.txt'), 'utf8'), 'old a.txt\n');
  assert.equal(await readFile(path.join(root, 'recover/b.txt'), 'utf8'), 'old b.txt\n');
});
