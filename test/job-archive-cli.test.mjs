import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
const execute = promisify(execFile),
  repo = path.resolve('.');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const req = (tool, args = {}) => ({ tool, arguments: args });
let suite,
  sequence = 0;
const fixtures = [];
const base = {
  id: 'good',
  project: '.',
  command: 'node',
  request: 'a'.repeat(64),
  status: 'passed',
  startedAt: '2026-10-21T03:00:00.000Z',
  endedAt: '2026-10-21T03:00:00.100Z',
  exitCode: 0,
  output: 'retained data '.repeat(5000),
  outputTruncated: false,
  mode: 'terminal',
  executable: process.execPath,
  timeoutSeconds: 30,
  stdout: 'retained\n',
  stderr: '',
};
before(async () => {
  suite = await fs.mkdtemp(path.join(os.tmpdir(), 'wb-job-cli-'));
});
after(async () => {
  await Promise.all(fixtures.map((f) => f.client?.close()));
  assert.ok(suite.startsWith(path.resolve(os.tmpdir()) + path.sep));
  await fs.rm(suite, { recursive: true, force: true });
});
async function connect(f) {
  f.client = new Client({ name: 'wb-job-recovery-tests', version: '1' });
  await f.client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.join(repo, 'dist/server.js')],
      cwd: repo,
      stderr: 'pipe',
      env: {
        ...process.env,
        WORKBRIDGE_ROOT: f.root,
        WORKBRIDGE_STATE_DIR: f.state,
        WORKBRIDGE_LOCAL_CLI: '1',
      },
    }),
  );
}
async function fixture() {
  const home = path.join(suite, String(sequence++)),
    root = path.join(home, 'Project ü'),
    state = path.join(home, 'State');
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(path.join(state, 'jobs'), { recursive: true });
  await fs.writeFile(path.join(root, 'keep.txt'), 'staged fixture\n');
  await execute('git', ['init', '--quiet'], { cwd: root, windowsHide: true });
  await execute('git', ['add', '--', 'keep.txt'], { cwd: root, windowsHide: true });
  const indexHash = hash(await fs.readFile(path.join(root, '.git/index')));
  await fs.writeFile(path.join(root, 'keep.txt'), 'unrelated dirty fixture\n');
  await fs.writeFile(path.join(state, 'jobs/good.json'), JSON.stringify(base));
  const f = { home, root, state, indexHash, sequence: 0 };
  fixtures.push(f);
  await connect(f);
  return f;
}
async function call(f, name, args = {}, error = false) {
  const raw = await f.client.callTool({ name, arguments: args });
  assert.equal(!!raw.isError, error, JSON.stringify(raw));
  const value = JSON.parse(raw.content[0].text);
  if (raw.structuredContent) assert.deepEqual(raw.structuredContent, value);
  return value;
}
async function cli(f, steps, expectedExit = 0) {
  const input = path.join(f.home, 'requests-' + f.sequence++ + '.json');
  await fs.writeFile(input, JSON.stringify(steps));
  let raw;
  try {
    raw = {
      exitCode: 0,
      ...(await execute(
        process.execPath,
        [
          path.join(repo, 'scripts/workbridge-cli.mjs'),
          '--service-state',
          f.state,
          '--root',
          f.root,
          '--input',
          input,
          '--json',
          '--timeout',
          '60',
        ],
        { cwd: repo, windowsHide: true, timeout: 90000, maxBuffer: 8 * 1024 * 1024 },
      )),
    };
  } catch (error) {
    raw = { exitCode: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
  assert.equal(raw.exitCode, expectedExit, JSON.stringify(raw));
  const rows = raw.stdout.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
  if (!expectedExit)
    assert.ok(
      rows.every((r) => r.ok),
      JSON.stringify(rows),
    );
  return { ...raw, rows };
}
async function preserve(f) {
  assert.equal(hash(await fs.readFile(path.join(f.root, '.git/index'))), f.indexHash);
  assert.equal(await fs.readFile(path.join(f.root, 'keep.txt'), 'utf8'), 'unrelated dirty fixture\n');
  await assert.rejects(fs.access(path.join(f.root, 'must-not-run.txt')), (e) => e.code === 'ENOENT');
}
const sentinel = () =>
  req('write_file', {
    operationId: 'must-not-run',
    path: 'must-not-run.txt',
    content: 'bad',
    expectedHash: null,
  });

test(
  'archive tools expose shared-owner CLI compact, restore and historical retry',
  { timeout: 90000 },
  async () => {
    const f = await fixture();
    const file = path.join(f.state, 'jobs/good.json');
    const original = await fs.readFile(file);
    const catalog = await f.client.listTools();
    const archive = catalog.tools.find((t) => t.name === 'command_archive');
    assert.equal(archive.annotations.readOnlyHint, false);
    assert.equal(
      catalog.tools.find((t) => t.name === 'command_archive_status').annotations.readOnlyHint,
      true,
    );
    assert.ok(archive.inputSchema.required.includes('expectedRecordSha256'));
    const operationPattern = new RegExp(archive.inputSchema.properties.operationId.pattern);
    assert.ok(operationPattern.test('a'.repeat(64)));
    assert.equal(operationPattern.test('a'.repeat(65)), false);
    assert.equal(operationPattern.test('_bad'), false);

    const fresh = await call(f, 'command_archive_status', { jobId: 'good', operationId: 'compact' });
    assert.equal(fresh.currentRecordSha256, hash(original));
    assert.equal(fresh.currentRepresentation, 'raw');
    const args = {
      jobId: 'good',
      operationId: 'compact',
      direction: 'compact',
      expectedRecordSha256: fresh.currentRecordSha256,
    };
    const compact = (await cli(f, [req('command_archive', args)])).rows[0].result;
    assert.equal(compact.status, 'completed');
    assert.ok(compact.logicalBytesSaved > 0);
    assert.equal((await call(f, 'command_status', { jobId: 'good' })).status, 'passed');
    const current = await call(f, 'command_archive_status', { jobId: 'good', operationId: 'compact' });
    assert.equal(current.currentRepresentation, 'archived');
    assert.equal(current.currentRecordSha256, compact.resultRecordSha256);
    const restore = {
      jobId: 'good',
      operationId: 'restore',
      direction: 'restore',
      expectedRecordSha256: current.currentRecordSha256,
    };
    await cli(f, [req('command_archive', restore)]);
    assert.deepEqual(await fs.readFile(file), original);
    const retry = await call(f, 'command_archive', args);
    assert.equal(retry.alreadyCompleted, true);
    assert.deepEqual(await fs.readFile(file), original);
    const historical = await call(f, 'command_archive_status', { jobId: 'good', operationId: 'compact' });
    assert.equal(historical.resultRecordSha256, compact.resultRecordSha256);
    assert.equal(historical.currentRecordSha256, hash(original));
    const bad = await cli(
      f,
      [
        req('command_archive', { ...args, operationId: 'stale', expectedRecordSha256: 'b'.repeat(64) }),
        sentinel(),
      ],
      1,
    );
    assert.equal(bad.rows.length, 1);
    assert.equal(bad.rows[0].ok, false);
    assert.deepEqual(await fs.readFile(file), original);
    await preserve(f);
  },
);
