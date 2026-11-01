import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { Workspace, limits } from '../dist/workspace.js';

let root, state, client;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function call(name, args = {}) {
  const response = await client.callTool({ name, arguments: args });
  let data;
  try {
    data = JSON.parse(response.content[0].text);
  } catch {
    data = { message: response.content[0].text };
  }
  if (response.structuredContent) assert.deepEqual(response.structuredContent, data);
  return { response, data };
}
async function batch(files, offset = 0) {
  const result = await call('read_files', { files, offset });
  assert.ok(JSON.stringify(result.data).length <= limits.outputChars);
  assert.equal(Boolean(result.response.isError), result.data.hasErrors);
  return result.data;
}
before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'workbridge-read-files-'));
  state = path.join(root, 'private');
  await mkdir(state);
  await mkdir(path.join(root, 'Source ü 空'));
  await mkdir(path.join(root, '.git'));
  await writeFile(path.join(root, 'Source ü 空', 'one.txt'), 'alpha\r\nbeta\r\ngamma');
  await writeFile(path.join(root, 'empty.txt'), '');
  await writeFile(
    path.join(root, 'utf16le.txt'),
    Buffer.concat([Buffer.from([255, 254]), Buffer.from('你好\nsecond', 'utf16le')]),
  );
  await writeFile(
    path.join(root, 'utf16be.txt'),
    Buffer.concat([Buffer.from([254, 255]), Buffer.from('你好\nsecond', 'utf16le').swap16()]),
  );
  await writeFile(path.join(root, 'binary.dat'), Buffer.from([0, 255, 254]));
  await writeFile(path.join(state, 'secret.txt'), 'protected');
  await symlink(path.join(root, 'Source ü 空'), path.join(root, 'linked'), 'junction');
  client = new Client({ name: 'read-files-test', version: '1' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve('dist/server.js')],
      stderr: 'pipe',
      env: { ...process.env, WORKBRIDGE_ROOT: root, WORKBRIDGE_STATE_DIR: state },
    }),
  );
});
after(async () => {
  await client?.close();
  if (root) {
    assert.ok(path.resolve(root).startsWith(path.join(os.tmpdir(), 'workbridge-read-files-')));
    await rm(root, { recursive: true, force: true });
  }
});

test('batch preserves ordered duplicate requests, encodings, hashes and existing read_file results', async () => {
  const files = [
    { path: 'Source ü 空/one.txt', startLine: 2, lineCount: 1 },
    { path: 'utf16be.txt' },
    { path: 'empty.txt' },
    { path: 'utf16le.txt' },
    { path: 'Source ü 空/one.txt', lineCount: 3 },
  ];
  const result = await batch(files);
  assert.equal(result.nextOffset, null);
  assert.equal(result.hasErrors, false);
  assert.equal(result.outputLimitReached, false);
  assert.equal(result.timeLimitReached, false);
  for (const [index, request] of files.entries()) {
    const item = result.results[index];
    assert.equal(item.index, index);
    assert.equal(item.path, request.path);
    const single = await call('read_file', request);
    assert.deepEqual(item.result, single.data);
    assert.equal(item.result.sha256, hash(await readFile(path.join(root, request.path))));
  }
  const tools = (await client.listTools()).tools;
  const tool = tools.find((t) => t.name === 'read_files');
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.equal(tool.annotations.destructiveHint, false);
  assert.ok(tool.outputSchema.properties.results);
});

test('mixed path and decoding errors keep good pages and enforce the same workspace boundary', async () => {
  const files = [
    'Source ü 空/one.txt',
    'missing.txt',
    'binary.dat',
    'private/secret.txt',
    '.git/config',
    'linked/one.txt',
    path.join(root, '..', 'outside.txt'),
  ].map((path) => ({ path }));
  const result = await batch(files);
  assert.equal(result.nextOffset, null);
  assert.equal(result.hasErrors, true);
  assert.equal(result.results[0].ok, true);
  assert.deepEqual(
    result.results.slice(1).map((item) => item.error.code),
    ['ENOENT', 'NOT_TEXT', 'PROTECTED_PATH', 'GIT_INTERNAL', 'LINK_NOT_ALLOWED', 'OUTSIDE_ROOT'],
  );
  assert.equal(result.results[0].result.sha256, hash(await readFile(path.join(root, files[0].path))));
});

test('batch response budget includes escaped JSON and resumes without skipping requests', async () => {
  const text = 'quoted "\\ slash \t'.repeat(1600);
  await writeFile(path.join(root, 'escaped.txt'), text);
  const files = Array.from({ length: 7 }, () => ({ path: 'escaped.txt', lineCount: 1 }));
  const seen = [];
  let offset = 0;
  do {
    const page = await batch(files, offset);
    assert.equal(page.hasErrors, false);
    assert.ok(page.results.length > 0);
    seen.push(...page.results.map((item) => item.index));
    if (page.nextOffset !== null) {
      assert.ok(page.nextOffset > offset);
      assert.equal(page.outputLimitReached, true);
    }
    offset = page.nextOffset;
  } while (offset !== null);
  assert.deepEqual(seen, [0, 1, 2, 3, 4, 5, 6]);
});

test('a single oversized page reports an actionable error and does not block later files', async () => {
  await writeFile(path.join(root, 'oversized.txt'), '"'.repeat(40000));
  const result = await batch([{ path: 'oversized.txt' }, { path: 'empty.txt' }]);
  assert.equal(result.hasErrors, true);
  assert.equal(result.outputLimitReached, true);
  assert.equal(result.nextOffset, null);
  assert.equal(result.results[1].ok, true);
  assert.equal(result.results[0].error.code, 'BATCH_ITEM_LIMIT');
  assert.equal(result.results[0].error.details.nextAction, 'read_file');
  const single = await call('read_file', { path: 'oversized.txt' });
  assert.equal(Boolean(single.response.isError), false);
  assert.equal(single.data.text.length, 40003);
});

test('batch file cursors interoperate with single reads and reject stale or wrong-path cursors', async () => {
  const first = await batch([{ path: 'Source ü 空/one.txt', lineCount: 1 }]);
  const page = first.results[0].result;
  assert.equal(first.nextOffset, null);
  assert.equal(page.truncated, true);
  assert.ok(page.cursor);
  const next = await call('read_file', { path: 'Source ü 空/one.txt', lineCount: 1, cursor: page.cursor });
  assert.equal(next.data.text, '2: beta');
  const last = await batch([{ path: 'Source ü 空/one.txt', cursor: next.data.cursor, lineCount: 1 }]);
  assert.equal(last.results[0].result.text, '3: gamma');
  const wrong = await batch([{ path: 'utf16le.txt', cursor: page.cursor }]);
  assert.equal(wrong.results[0].error.code, 'FILE_CHANGED');
  await writeFile(path.join(root, 'stale.txt'), 'before\nsecond');
  const stale = await batch([{ path: 'stale.txt', lineCount: 1 }]);
  await writeFile(path.join(root, 'stale.txt'), 'changed contents');
  const refused = await batch([
    { path: 'stale.txt', cursor: stale.results[0].result.cursor },
    { path: 'empty.txt' },
  ]);
  assert.equal(refused.results[0].error.code, 'FILE_CHANGED');
  assert.equal(refused.results[1].ok, true);
});

test('files above the edit limit retain paging and version but do not acquire unsupported hashes', async () => {
  const bytes = Buffer.alloc(limits.editBytes + 1, 97);
  bytes.write('first\n');
  await writeFile(path.join(root, 'large.txt'), bytes);
  const result = await batch([{ path: 'large.txt', lineCount: 1 }]);
  const page = result.results[0].result;
  assert.equal(page.sha256, null);
  assert.equal(page.text, '1: first');
  assert.equal(page.size, bytes.length);
  assert.ok(page.version);
  assert.ok(page.cursor);
  assert.equal(page.truncated, true);
});

test('cardinality, offset and individual request ranges reject invalid batches', async () => {
  for (const args of [
    { files: [] },
    { files: Array.from({ length: 21 }, () => ({ path: 'empty.txt' })) },
    { files: [{ path: 'empty.txt', lineCount: 0 }] },
    { files: [{ path: 'empty.txt', startLine: 0 }] },
    { files: [{ path: 'empty.txt' }], offset: 2 },
  ])
    assert.equal((await call('read_files', args)).response.isError, true);
  const end = await batch([{ path: 'empty.txt' }], 1);
  assert.deepEqual(end.results, []);
  assert.equal(end.nextOffset, null);
  const maximum = await batch(Array.from({ length: 20 }, () => ({ path: 'empty.txt' })));
  assert.equal(maximum.results.length, 20);
});

test('elapsed budget returns the first unreturned index and leaves remaining reads for continuation', async () => {
  const workspace = await Workspace.create(root);
  const originalRead = workspace.read.bind(workspace),
    originalNow = Date.now;
  let now = originalNow(),
    reads = 0;
  try {
    Date.now = () => now;
    workspace.read = async (...args) => {
      const page = await originalRead(...args);
      reads++;
      now += limits.scanMs;
      return page;
    };
    const result = await workspace.readFiles([{ path: 'empty.txt' }, { path: 'utf16le.txt' }]);
    assert.equal(reads, 1);
    assert.equal(result.nextOffset, 1);
    assert.equal(result.timeLimitReached, true);
    assert.equal(result.hasErrors, false);
  } finally {
    Date.now = originalNow;
  }
});

async function cliThroughBridge(name, files, expectedExit) {
  const input = path.join(root, `${name}.json`);
  await writeFile(
    input,
    JSON.stringify([
      { tool: 'read_files', arguments: { files } },
      { tool: 'workspace_info', arguments: {} },
    ]),
  );
  const requestId = `read-files-cli-${name}`;
  const launch = await call('terminal_run', {
    cwd: root,
    executable: process.execPath,
    timeoutSeconds: 30,
    requestId,
    args: [
      path.resolve('scripts/workbridge-cli.mjs'),
      '--root',
      root,
      '--state-dir',
      path.join(root, `${name}-state`),
      '--input',
      input,
      '--timeout',
      '20',
      '--json',
    ],
  });
  assert.ok(!launch.response.isError);
  const deadline = Date.now() + 30000;
  let job;
  do {
    job = (await call('command_status', { jobId: requestId })).data;
    if (job.status !== 'running') break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  assert.equal(job.exitCode, expectedExit);
  const output = (await call('command_output', { jobId: requestId, stream: 'stdout', tailChars: 60000 }))
    .data;
  assert.equal(output.outputTruncated, false);
  return output.text
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}
test('installed batch CLI through Workbridge returns all success pages with structured hashes', async () => {
  const rows = await cliThroughBridge(
    'success',
    [{ path: 'Source ü 空/one.txt' }, { path: 'utf16be.txt' }],
    0,
  );
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.ok));
  assert.equal(rows[0].result.results.length, 2);
  assert.ok(rows[0].result.results.every((item) => /^[a-f0-9]{64}$/.test(item.result.sha256)));
});
test('CLI partial read failure preserves good results, exits one and stops subsequent steps', async () => {
  const rows = await cliThroughBridge('failure', [{ path: 'empty.txt' }, { path: 'missing.txt' }], 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ok, false);
  assert.equal(rows[0].result.results[0].ok, true);
  assert.equal(rows[0].result.results[1].error.code, 'ENOENT');
});
