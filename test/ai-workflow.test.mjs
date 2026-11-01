import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, open, copyFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

let root, state, project, client;
const hash = (value) => createHash('sha256').update(value).digest('hex');
async function connect() {
  client = new Client({ name: 'ai-workflow-tests', version: '1' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve('dist/server.js')],
      env: { ...process.env, WORKBRIDGE_ROOT: root, WORKBRIDGE_STATE_DIR: state },
      stderr: 'pipe',
    }),
  );
}
async function call(tool, args = {}, expectedError) {
  const response = await client.callTool({ name: tool, arguments: args });
  const data = JSON.parse(response.content[0].text);
  if (expectedError) {
    assert.equal(response.isError, true);
    assert.equal(data.error.code, expectedError);
  } else {
    assert.ok(!response.isError, JSON.stringify(data));
    assert.deepEqual(response.structuredContent, data);
  }
  return data;
}
const run = (id, code, timeoutSeconds = 10) =>
  call('terminal_run', {
    cwd: 'Project ü 空',
    executable: process.execPath,
    args: ['-e', code],
    requestId: id,
    timeoutSeconds,
  });
async function ended(id) {
  for (let n = 0; n < 200; n++) {
    const job = await call('command_status', { jobId: id });
    if (job.status !== 'running') return job;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error('Job exceeded test deadline');
}
before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'workbridge-ai-'));
  state = path.join(root, 'private');
  project = path.join(root, 'Project ü 空');
  await mkdir(project);
  await mkdir(state);
  await connect();
});
after(async () => {
  await client?.close();
  assert.ok(root.startsWith(path.join(os.tmpdir(), 'workbridge-ai-')));
  await rm(root, { recursive: true, force: true });
});

test('job discovery recovers live IDs and filters exact canonical project/status', async () => {
  await run('discover-running', 'setInterval(()=>{},1000)');
  const page = await call('command_list', { project, status: 'running' });
  assert.deepEqual(
    page.jobs.map((j) => j.id),
    ['discover-running'],
  );
  assert.deepEqual(
    page.runningJobs.map((j) => j.id),
    ['discover-running'],
  );
  assert.equal(page.complete, true);
  assert.equal('output' in page.jobs[0], false);
  if (process.platform === 'win32')
    assert.equal((await call('command_list', { project: project.toUpperCase() })).jobs.length, 1);
  await call('command_cancel', { jobId: 'discover-running' });
  const cancelled = await call('command_list', { status: 'cancelled' });
  assert.equal(cancelled.jobs[0].id, 'discover-running');
  await call('command_list', { project: os.tmpdir() }, 'OUTSIDE_ROOT');
});

test('catalog scan pagination advances across empty filtered pages', async () => {
  await run('a-passed', 'console.log("done")');
  await ended('a-passed');
  await run('z-failed', 'process.exit(7)');
  await ended('z-failed');
  let offset = 0;
  const ids = [];
  let sawEmpty = false;
  do {
    const page = await call('command_list', { status: 'failed', scanLimit: 1, limit: 1, offset });
    if (page.jobs.length === 0) sawEmpty = true;
    ids.push(...page.jobs.map((j) => j.id));
    if (page.nextOffset !== null) assert.ok(page.nextOffset > offset);
    offset = page.nextOffset;
  } while (offset !== null);
  assert.ok(sawEmpty);
  assert.deepEqual(ids, ['z-failed']);
});

test('catalog reports corrupt and oversized records without reading raw output into results', async () => {
  await writeFile(path.join(state, 'jobs/bad.json'), '{');
  const handle = await open(path.join(state, 'jobs/oversized.json'), 'w');
  await handle.truncate(16 * 1024 * 1024 + 1);
  await handle.close();
  const raw = await client.callTool({ name: 'command_list', arguments: {} });
  assert.equal(raw.isError, true);
  const page = JSON.parse(raw.content[0].text);
  assert.deepEqual(raw.structuredContent, page);
  assert.equal(page.hasErrors, true);
  assert.equal(page.complete, false);
  assert.deepEqual(
    page.issues.map((x) => x.jobId),
    ['bad', 'oversized'],
  );
  assert.ok(page.jobs.some((x) => x.id === 'z-failed'));
  await rm(path.join(state, 'jobs/bad.json'));
  await rm(path.join(state, 'jobs/oversized.json'));
});

test('historical running records are interrupted, not resumed or falsely live', async () => {
  const base = JSON.parse(await readFile(path.join(state, 'jobs/a-passed.json'), 'utf8'));
  await writeFile(
    path.join(state, 'jobs/old-running.json'),
    JSON.stringify({
      ...base,
      id: 'old-running',
      status: 'running',
      exitCode: null,
    }),
  );
  await client.close();
  await connect();
  const page = await call('command_list', { status: 'interrupted' });
  assert.deepEqual(
    page.jobs.map((x) => x.id),
    ['old-running'],
  );
  assert.deepEqual(page.runningJobs, []);
  assert.equal((await call('command_status', { jobId: 'old-running' })).status, 'interrupted');
});

test('tail output keeps status/exit, offsets and separate stream selection', async () => {
  await run('tail', 'process.stdout.write("abcdef");process.stderr.write("ERR-end")');
  await ended('tail');
  const out = await call('command_output', { jobId: 'tail', stream: 'stdout', tailChars: 3 });
  assert.equal(out.text, 'def');
  assert.equal(out.offset, 3);
  assert.equal(out.streamLength, 6);
  assert.equal(out.status, 'passed');
  assert.equal(out.exitCode, 0);
  assert.equal(out.nextOffset, null);
  assert.equal(
    (
      await call('command_output', {
        jobId: 'tail',
        stream: 'stderr',
        tailChars: 100,
      })
    ).text,
    'ERR-end',
  );
  const legacy = await call('command_output', { jobId: 'tail', stream: 'stdout', offset: 1, limit: 2 });
  assert.equal(legacy.text, 'bc');
  assert.equal(legacy.nextOffset, 3);
  await call('command_output', { jobId: 'tail', offset: 0, tailChars: 1 }, 'INVALID_ARGUMENT');
});

test('tail handles empty and running output; missing jobs stay explicit', async () => {
  await run('tail-empty', '');
  await ended('tail-empty');
  const empty = await call('command_output', { jobId: 'tail-empty', tailChars: 1 });
  assert.equal(empty.text, '');
  assert.equal(empty.offset, 0);
  await run('tail-running', 'console.log("ready");setInterval(()=>{},1000)');
  const running = await call('command_output', { jobId: 'tail-running', tailChars: 10 });
  assert.equal(running.status, 'running');
  await call('command_cancel', { jobId: 'tail-running' });
  await call('command_output', { jobId: 'missing', tailChars: 1 }, 'UNKNOWN_JOB');
});

test('tail is explicitly the retained buffer when capture is capped', async () => {
  await run('tail-capped', 'process.stdout.write("x".repeat(1100000)+"FINAL")');
  await ended('tail-capped');
  const out = await call('command_output', { jobId: 'tail-capped', tailChars: 5 });
  assert.equal(out.outputTruncated, true);
  assert.equal(out.text, 'xxxxx');
  assert.equal(out.streamLength, 1024 * 1024);
});

test('legacy combined-only jobs support tails and reject unavailable separate streams', async () => {
  const base = JSON.parse(await readFile(path.join(state, 'jobs/a-passed.json'), 'utf8'));
  delete base.stdout;
  delete base.stderr;
  await writeFile(path.join(state, 'jobs/legacy.json'), JSON.stringify({ ...base, id: 'legacy' }));
  assert.equal((await call('command_output', { jobId: 'legacy', tailChars: 2 })).text, 'e\n');
  await call(
    'command_output',
    { jobId: 'legacy', stream: 'stderr', tailChars: 2 },
    'OUTPUT_STREAM_UNAVAILABLE',
  );
});

test('structured second-edit failure preserves original bytes and identifies zero-based index', async () => {
  const bytes = Buffer.from('alpha\r\nbeta\r\n');
  const file = path.join(project, 'edit.txt');
  await writeFile(file, bytes);
  const result = await call(
    'edit_file',
    {
      operationId: 'second-edit-fails',
      path: file,
      expectedHash: hash(bytes),
      edits: [
        { oldText: 'alpha', newText: 'first' },
        { oldText: 'absent', newText: 'second' },
      ],
    },
    'EDIT_MISMATCH',
  );
  assert.deepEqual(result.error.details, {
    reason: 'missing_text',
    editIndex: 1,
    expectedOccurrences: 1,
    observedOccurrences: 0,
    countExact: true,
    nextAction: 'reread_and_narrow_edit',
  });
  assert.deepEqual(await readFile(file), bytes);
});

test('ambiguous replacement counts are lower bounds and stale hash diagnostics are recoverable', async () => {
  const file = path.join(project, 'repeated.txt');
  const bytes = 'x x x x';
  await writeFile(file, bytes);
  const mismatch = await call(
    'edit_file',
    {
      operationId: 'repeated-fails',
      path: file,
      expectedHash: hash(bytes),
      edits: [{ oldText: 'x', newText: 'y' }],
    },
    'EDIT_MISMATCH',
  );
  assert.equal(mismatch.error.details.observedOccurrences, 2);
  assert.equal(mismatch.error.details.countExact, false);
  const stale = await call(
    'edit_file',
    {
      operationId: 'stale-fails',
      path: file,
      expectedHash: '0'.repeat(64),
      edits: [{ oldText: 'x', newText: 'y' }],
    },
    'CONFLICT',
  );
  assert.equal(stale.error.details.reason, 'stale_hash');
  assert.equal(stale.error.details.actualHash, hash(bytes));
  assert.equal(stale.error.details.nextAction, 'reread');
  assert.equal(await readFile(file, 'utf8'), bytes);
  const applied = await call('edit_file', {
    operationId: 'repeated-pass',
    path: file,
    expectedHash: hash(bytes),
    edits: [{ oldText: 'x', newText: 'y', occurrences: 4 }],
  });
  assert.equal(applied.afterHash, hash('y y y y'));
  await call('undo_change', { operationId: 'repeated-pass' });
  assert.equal(await readFile(file, 'utf8'), bytes);
});

test('CLI performs a full job workflow through Workbridge with one owner and machine output', async () => {
  const request = path.join(project, 'cli request ü.json');
  const cliState = path.join(root, 'cli state ü');
  await writeFile(
    request,
    JSON.stringify([
      {
        tool: 'terminal_run',
        arguments: {
          cwd: '.',
          executable: process.execPath,
          args: ['-e', 'console.log("CLI-result")'],
          requestId: 'cli-job',
          timeoutSeconds: 10,
        },
      },
      { waitForJob: 'cli-job' },
      { tool: 'command_list', arguments: { status: 'passed' } },
      { tool: 'command_output', arguments: { jobId: 'cli-job', tailChars: 7 } },
    ]),
  );
  await call('terminal_run', {
    cwd: project,
    executable: process.execPath,
    args: [
      path.resolve('scripts/workbridge-cli.mjs'),
      '--root',
      project,
      '--state-dir',
      cliState,
      '--input',
      request,
      '--json',
    ],
    requestId: 'cli-driver',
    timeoutSeconds: 20,
  });
  assert.equal((await ended('cli-driver')).exitCode, 0);
  const out = await call('command_output', { jobId: 'cli-driver', stream: 'stdout' });
  const lines = out.text.trim().split('\n').map(JSON.parse);
  assert.equal(lines.length, 4);
  assert.ok(lines.every((x) => x.ok && x.schemaVersion === 1));
  assert.equal(lines[2].result.jobs[0].id, 'cli-job');
  assert.equal(lines[3].result.text, 'result\n');
});

async function cli(id, steps, extra = []) {
  const request = path.join(project, `${id}.json`);
  const cliState = path.join(root, `${id}-state`);
  await writeFile(request, JSON.stringify(steps));
  await call('terminal_run', {
    cwd: project,
    executable: process.execPath,
    args: [
      path.resolve('scripts/workbridge-cli.mjs'),
      '--root',
      project,
      '--state-dir',
      cliState,
      '--input',
      request,
      ...extra,
    ],
    requestId: id,
    timeoutSeconds: 20,
  });
  const job = await ended(id);
  const out = await call('command_output', { jobId: id, stream: 'stdout' });
  return { job, cliState, lines: out.text.trim().split('\n').map(JSON.parse) };
}

test('CLI propagates structured edit errors, stops the batch, and leaves source unchanged', async () => {
  const file = path.join(project, 'cli-edit.txt');
  await writeFile(file, 'before\n');
  const result = await cli('cli-edit-error', [
    {
      tool: 'edit_file',
      arguments: {
        operationId: 'cli-edit-fail',
        path: file,
        expectedHash: hash('before\n'),
        edits: [{ oldText: 'missing', newText: 'after' }],
      },
    },
    {
      tool: 'delete_file',
      arguments: { operationId: 'must-not-run', path: file, expectedHash: hash('before\n') },
    },
  ]);
  assert.equal(result.job.exitCode, 1);
  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0].result.error.details.reason, 'missing_text');
  assert.equal(await readFile(file, 'utf8'), 'before\n');
});

test('CLI can read, edit and undo through shared MCP implementation', async () => {
  const file = path.join(project, 'cli-undo.txt');
  await writeFile(file, 'before\r\n');
  const result = await cli('cli-edit-undo', [
    { tool: 'read_file', arguments: { path: file } },
    {
      tool: 'edit_file',
      arguments: {
        operationId: 'cli-edit',
        path: file,
        expectedHash: hash('before\r\n'),
        edits: [{ oldText: 'before', newText: 'after' }],
      },
    },
    { tool: 'change_status', arguments: { operationId: 'cli-edit' } },
    { tool: 'undo_change', arguments: { operationId: 'cli-edit' } },
  ]);
  assert.equal(result.job.exitCode, 0);
  assert.equal(result.lines[1].result.afterHash, hash('after\r\n'));
  assert.equal(await readFile(file, 'utf8'), 'before\r\n');
});

test('CLI refuses existing state rather than impersonating a live owner', async () => {
  const cliState = path.join(root, 'cli-existing-state');
  await mkdir(cliState);
  await writeFile(path.join(cliState, 'sentinel'), 'preserve');
  const result = await cli('cli-existing', [{ tool: 'workspace_info', arguments: {} }]);
  assert.equal(result.job.exitCode, 2);
  assert.equal(result.lines[0].error.code, 'INVALID_INPUT');
  assert.equal(await readFile(path.join(cliState, 'sentinel'), 'utf8'), 'preserve');
});

test('CLI refuses mismatched source/runtime before executing requested mutations', async () => {
  const fixture = path.join(project, 'mismatched runtime');
  await mkdir(path.join(fixture, 'scripts'), { recursive: true });
  await mkdir(path.join(fixture, 'dist'));
  await symlink(path.resolve('node_modules'), path.join(fixture, 'node_modules'), 'junction');
  await copyFile('scripts/workbridge-cli.mjs', path.join(fixture, 'scripts/workbridge-cli.mjs'));
  await writeFile(
    path.join(fixture, 'package.json'),
    JSON.stringify({ type: 'module', version: '0.0.0-test' }),
  );
  await writeFile(
    path.join(fixture, 'dist/server.js'),
    `import ${JSON.stringify(pathToFileURL(path.resolve('dist/server.js')).href)};`,
  );
  const target = path.join(project, 'mismatch-preserve.txt');
  await writeFile(target, 'preserve');
  const request = path.join(project, 'mismatch-request.json');
  await writeFile(
    request,
    JSON.stringify([
      {
        tool: 'delete_file',
        arguments: { operationId: 'must-not-run', path: target, expectedHash: hash('preserve') },
      },
    ]),
  );
  await call('terminal_run', {
    cwd: project,
    executable: process.execPath,
    args: [
      path.join(fixture, 'scripts/workbridge-cli.mjs'),
      '--root',
      project,
      '--state-dir',
      path.join(root, 'mismatch-state'),
      '--input',
      request,
    ],
    requestId: 'cli-mismatch',
    timeoutSeconds: 20,
  });
  assert.equal((await ended('cli-mismatch')).exitCode, 2);
  const output = await call('command_output', { jobId: 'cli-mismatch', stream: 'stdout' });
  const result = JSON.parse(output.text);
  assert.equal(result.error.code, 'RUNTIME_MISMATCH');
  assert.equal(result.error.expectedVersion, '0.0.0-test');
  assert.equal(result.error.runtimeVersion, JSON.parse(await readFile('package.json', 'utf8')).version);
  assert.equal(await readFile(target, 'utf8'), 'preserve');
});

test('CLI waited process failure is not mistaken for successful launch', async () => {
  const result = await cli('cli-failed-job', [
    {
      tool: 'terminal_run',
      arguments: {
        cwd: '.',
        executable: process.execPath,
        args: ['-e', 'process.exit(9)'],
        requestId: 'failed-child',
        timeoutSeconds: 5,
      },
    },
    { waitForJob: 'failed-child' },
    { tool: 'workspace_info', arguments: {} },
  ]);
  assert.equal(result.job.exitCode, 1);
  assert.equal(result.lines.length, 2);
  assert.equal(result.lines[1].ok, false);
  assert.equal(result.lines[1].result.exitCode, 9);
});

test('CLI deadline exits nonzero and terminates its owned child', async () => {
  const pidFile = path.join(project, 'cli-child.pid');
  const result = await cli(
    'cli-deadline',
    [
      {
        tool: 'terminal_run',
        arguments: {
          cwd: '.',
          executable: process.execPath,
          args: [
            '-e',
            'require("fs").writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)',
            pidFile,
          ],
          requestId: 'waiting-child',
          timeoutSeconds: 10,
        },
      },
      { waitForJob: 'waiting-child' },
    ],
    ['--timeout', '2'],
  );
  assert.equal(result.job.exitCode, 124);
  assert.equal(result.lines.at(-1).error.code, 'DEADLINE');
  const pid = Number(await readFile(pidFile, 'utf8'));
  assert.throws(() => process.kill(pid, 0));
});

test('CLI cancellation and invalid input are explicit and noninteractive', async () => {
  const cancelled = await cli('cli-cancel', [
    {
      tool: 'terminal_run',
      arguments: {
        cwd: '.',
        executable: process.execPath,
        args: ['-e', 'setInterval(()=>{},1000)'],
        requestId: 'cancel-child',
        timeoutSeconds: 10,
      },
    },
    { tool: 'command_cancel', arguments: { jobId: 'cancel-child' } },
    { tool: 'command_list', arguments: { status: 'cancelled' } },
  ]);
  assert.equal(cancelled.job.exitCode, 0);
  assert.equal(cancelled.lines[2].result.jobs[0].status, 'cancelled');
  const invalid = await cli('cli-invalid', [{ tool: 'workspace_info', unexpected: true }]);
  assert.equal(invalid.job.exitCode, 2);
  assert.equal(invalid.lines[0].error.code, 'INVALID_INPUT');
});
