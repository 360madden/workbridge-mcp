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
  output: 'retained\n',
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

test('job catalog advertises additive budget fields and shared CLI keeps valid summaries', async () => {
  const f = await fixture(),
    catalog = await f.client.listTools();
  const schema = catalog.tools.find((t) => t.name === 'command_list').outputSchema;
  for (const name of [
    'schemaVersion',
    'hasErrors',
    'complete',
    'scanLimitReached',
    'outputLimitReached',
    'timeLimitReached',
  ])
    assert.ok(schema.properties[name]);
  const direct = await call(f, 'command_list');
  assert.equal(direct.hasErrors, false);
  assert.equal(direct.complete, true);
  assert.equal(direct.jobs[0].id, 'good');
  const output = await cli(f, [req('command_list')]);
  assert.deepEqual(output.rows[0].result, direct);
  await preserve(f);
});

test('MCP and CLI refuse corrupt known-ID status, output, cancellation and replay before later writes', async () => {
  const f = await fixture(),
    file = path.join(f.state, 'jobs/bad.json');
  await fs.writeFile(file, JSON.stringify({ ...base, id: 'wrong-id' }));
  const saved = await fs.readFile(file);
  for (const [tool, args] of [
    ['command_status', { jobId: 'bad' }],
    ['command_output', { jobId: 'bad', tailChars: 100 }],
    ['command_cancel', { jobId: 'bad' }],
    [
      'terminal_run',
      {
        cwd: '.',
        executable: process.execPath,
        args: ['-e', "require('fs').writeFileSync('launched.txt','bad')"],
        timeoutSeconds: 30,
        requestId: 'bad',
      },
    ],
  ]) {
    const direct = await call(f, tool, args, true);
    assert.equal(direct.error.code, 'UNREADABLE_JOB_RECORD');
    const output = await cli(f, [req(tool, args), sentinel()], 1);
    assert.equal(output.rows.length, 1);
    assert.equal(output.rows[0].ok, false);
    assert.deepEqual(output.rows[0].result, direct);
  }
  assert.deepEqual(await fs.readFile(file), saved);
  await assert.rejects(fs.access(path.join(f.root, 'launched.txt')), (e) => e.code === 'ENOENT');
  await preserve(f);
});

test('partial job discovery retains good rows, fails the CLI, and pages issues without losing continuation', async () => {
  const f = await fixture();
  await fs.writeFile(path.join(f.state, 'jobs/bad.json'), '{broken');
  const direct = await call(f, 'command_list', { limit: 10, scanLimit: 200 }, true);
  assert.equal(direct.hasErrors, true);
  assert.equal(direct.complete, false);
  assert.equal(direct.jobs[0].id, 'good');
  assert.equal(direct.issues[0].jobId, 'bad');
  const failed = await cli(f, [req('command_list', { limit: 10, scanLimit: 200 }), sentinel()], 1);
  assert.equal(failed.rows.length, 1);
  assert.deepEqual(failed.rows[0].result, direct);
  const first = await call(f, 'command_list', { limit: 1, scanLimit: 200 }, true);
  assert.equal(first.jobs.length, 0);
  assert.equal(first.issues.length, 1);
  assert.ok(Number.isInteger(first.nextOffset));
  const next = await cli(f, [req('command_list', { offset: first.nextOffset, limit: 1, scanLimit: 200 })]);
  assert.deepEqual(
    next.rows[0].result.jobs.map((j) => j.id),
    ['good'],
  );
  assert.equal(next.rows[0].result.complete, true);
  await preserve(f);
});

test('valid terminal replay executes once across clients, exposes tails, and survives owner restart', async () => {
  const f = await fixture();
  const args = {
    cwd: '.',
    executable: process.execPath,
    args: [
      '-e',
      "require('fs').appendFileSync('count.txt','1');process.stdout.write('known stdout');process.stderr.write('known stderr');",
    ],
    timeoutSeconds: 30,
    requestId: 'normal-job',
  };
  await call(f, 'terminal_run', args);
  await cli(f, [{ waitForJob: 'normal-job' }, req('terminal_run', args)]);
  const before = await call(f, 'command_status', { jobId: 'normal-job' });
  assert.equal(before.status, 'passed');
  assert.equal(before.exitCode, 0);
  const owner = (await call(f, 'workspace_info')).localCli.instanceId;
  await f.client.close();
  await connect(f);
  assert.notEqual((await call(f, 'workspace_info')).localCli.instanceId, owner);
  const after = await cli(f, [
    req('terminal_run', args),
    req('command_output', { jobId: 'normal-job', stream: 'stdout', tailChars: 6 }),
  ]);
  assert.deepEqual(after.rows[0].result, before);
  assert.equal(after.rows[1].result.text, 'stdout');
  assert.equal(await fs.readFile(path.join(f.root, 'count.txt'), 'utf8'), '1');
  assert.equal(
    (await call(f, 'command_output', { jobId: 'normal-job', stream: 'stderr' })).text,
    'known stderr',
  );
  await preserve(f);
});

test('corrupt-record refusals and historical interruption survive an isolated owner restart', async () => {
  const f = await fixture();
  await fs.writeFile(path.join(f.state, 'jobs/bad.json'), JSON.stringify({ ...base, id: 'other' }));
  const old = { ...base, id: 'old-running', status: 'running', exitCode: null };
  delete old.endedAt;
  await fs.writeFile(path.join(f.state, 'jobs/old-running.json'), JSON.stringify(old));
  const saved = await fs.readFile(path.join(f.state, 'jobs/old-running.json'));
  await f.client.close();
  await connect(f);
  assert.equal((await call(f, 'command_status', { jobId: 'bad' }, true)).error.code, 'UNREADABLE_JOB_RECORD');
  const cliResult = await cli(f, [req('command_status', { jobId: 'old-running' })]);
  assert.equal(cliResult.rows[0].result.status, 'interrupted');
  const page = await call(f, 'command_list', { status: 'interrupted' }, true);
  assert.deepEqual(page.runningJobs, []);
  assert.deepEqual(
    page.jobs.map((j) => j.id),
    ['old-running'],
  );
  assert.deepEqual(await fs.readFile(path.join(f.state, 'jobs/old-running.json')), saved);
  await preserve(f);
});

test('linked job catalog is refused by both interfaces without reads, launch, or linked-file writes', async () => {
  const f = await fixture(),
    directory = path.join(f.state, 'jobs'),
    real = path.join(f.state, 'saved-jobs');
  await fs.rename(directory, real);
  await fs.symlink(real, directory, process.platform === 'win32' ? 'junction' : 'dir');
  const saved = await fs.readFile(path.join(real, 'good.json')),
    names = await fs.readdir(real);
  for (const [name, args] of [
    ['command_status', { jobId: 'good' }],
    ['command_list', {}],
    [
      'terminal_run',
      {
        cwd: '.',
        executable: process.execPath,
        args: ['-e', 'process.exit(0)'],
        requestId: 'new-job',
        timeoutSeconds: 30,
      },
    ],
  ]) {
    assert.equal((await call(f, name, args, true)).error.code, 'UNREADABLE_JOB_RECORD');
    const output = await cli(f, [req(name, args), sentinel()], 1);
    assert.equal(output.rows.length, 1);
    assert.equal(output.rows[0].result.error.code, 'UNREADABLE_JOB_RECORD');
  }
  assert.deepEqual(await fs.readFile(path.join(real, 'good.json')), saved);
  assert.deepEqual(await fs.readdir(real), names);
  await preserve(f);
});

test('real failing command still retains child exit code and stops a waited CLI batch', async () => {
  const f = await fixture(),
    args = {
      cwd: '.',
      executable: process.execPath,
      args: ['-e', "console.error('expected failure');process.exitCode=7"],
      requestId: 'failed-job',
      timeoutSeconds: 30,
    };
  await call(f, 'terminal_run', args);
  const output = await cli(f, [{ waitForJob: 'failed-job' }, sentinel()], 1);
  assert.equal(output.rows.length, 1);
  assert.equal(output.rows[0].ok, false);
  const status = await call(f, 'command_status', { jobId: 'failed-job' });
  assert.equal(status.status, 'failed');
  assert.equal(status.exitCode, 7);
  const page = await call(f, 'command_list', { status: 'failed' });
  assert.equal(page.hasErrors, false);
  assert.equal(page.jobs[0].id, 'failed-job');
  await preserve(f);
});
