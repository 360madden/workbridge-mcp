import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { MAX_CONCURRENT_JOBS } from '../dist/jobs.js';
const run = promisify(execFile),
  repo = path.resolve('.'),
  sha = (b) => createHash('sha256').update(b).digest('hex');
let suite,
  sequence = 0;
const fixtures = [];
before(async () => {
  suite = await fs.mkdtemp(path.join(os.tmpdir(), 'wb-capacity-cli-'));
});
after(async () => {
  await Promise.all(fixtures.map((f) => f.client.close()));
  assert.ok(suite.startsWith(path.resolve(os.tmpdir()) + path.sep));
  await fs.rm(suite, { recursive: true, force: true });
});
async function fixture() {
  const home = path.join(suite, String(sequence++)),
    root = path.join(home, 'Project ü'),
    state = path.join(home, 'State'),
    preload = path.join(home, 'fault.mjs');
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(state);
  await fs.writeFile(
    preload,
    `import fs from 'node:fs/promises';import {existsSync} from 'node:fs';import {syncBuiltinESMExports} from 'node:module';import path from 'node:path';const state=${JSON.stringify(state)};const rename=fs.rename,opendir=fs.opendir;fs.rename=async function(a,b,...r){if(path.dirname(path.resolve(String(b)))===path.join(state,'jobs')&&existsSync(path.join(state,'deny-publish')))throw Object.assign(new Error('private publication fault'),{code:'EIO'});return rename.call(this,a,b,...r);};fs.opendir=async function(p,...r){if(path.resolve(String(p))===path.join(state,'jobs')&&existsSync(path.join(state,'deny-read')))throw Object.assign(new Error('private inventory fault'),{code:'EACCES'});return opendir.call(this,p,...r);};syncBuiltinESMExports();`,
  );
  await fs.writeFile(path.join(root, 'keep.txt'), 'staged baseline\n');
  await run('git', ['init', '--quiet'], { cwd: root, windowsHide: true });
  await run('git', ['add', '--', 'keep.txt'], { cwd: root, windowsHide: true });
  const index = sha(await fs.readFile(path.join(root, '.git/index')));
  await fs.writeFile(path.join(root, 'keep.txt'), 'unrelated dirty bytes\n');
  const client = new Client({ name: 'capacity-fixture', version: '1' }),
    f = { home, root, state, client, index, n: 0 };
  fixtures.push(f);
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ['--import', pathToFileURL(preload).href, path.join(repo, 'dist/server.js')],
      cwd: repo,
      stderr: 'pipe',
      env: { ...process.env, WORKBRIDGE_ROOT: root, WORKBRIDGE_STATE_DIR: state, WORKBRIDGE_LOCAL_CLI: '1' },
    }),
  );
  return f;
}
async function call(f, name, args = {}, code) {
  const raw = await f.client.callTool({ name, arguments: args }),
    data = JSON.parse(raw.content[0].text);
  assert.equal(!!raw.isError, !!code, JSON.stringify(data));
  if (code) assert.equal(data.error.code, code);
  else assert.deepEqual(raw.structuredContent, data);
  return data;
}
const req = (tool, args = {}) => ({ tool, arguments: args });
async function cli(f, steps, expected = 0) {
  const input = path.join(f.home, 'requests-' + f.n++ + '.json');
  await fs.writeFile(input, JSON.stringify(steps));
  let raw;
  try {
    raw = {
      exitCode: 0,
      ...(await run(
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
  assert.equal(raw.exitCode, expected, JSON.stringify(raw));
  const rows = raw.stdout.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
  if (!expected)
    assert.ok(
      rows.every((r) => r.ok),
      JSON.stringify(rows),
    );
  return rows;
}
async function retained(f, id) {
  await fs.writeFile(path.join(f.state, 'deny-publish'), 'private fixture');
  const job = await call(f, 'terminal_run', {
    cwd: '.',
    executable: path.join(f.root, 'missing.exe'),
    args: [],
    timeoutSeconds: 30,
    requestId: id,
  });
  assert.equal(job.errorCode, 'JOB_RECORD_SAVE_FAILED');
  return job;
}
async function preserved(f) {
  assert.equal(sha(await fs.readFile(path.join(f.root, '.git/index'))), f.index);
  assert.equal(await fs.readFile(path.join(f.root, 'keep.txt'), 'utf8'), 'unrelated dirty bytes\n');
  await assert.rejects(fs.access(path.join(f.root, 'must-not-run.txt')), (e) => e.code === 'ENOENT');
}
const sentinel = req('write_file', {
  operationId: 'must-not-run',
  path: 'must-not-run.txt',
  content: 'bad',
  expectedHash: null,
});

test('existing diagnostics advertises bounded capacity and inventory schemas with read-only annotations', async () => {
  const f = await fixture(),
    catalog = await f.client.listTools(),
    tool = catalog.tools.find((t) => t.name === 'diagnostics');
  assert.equal(catalog.tools.length, 64);
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.ok(tool.outputSchema.properties.jobs.properties.capacity);
  assert.ok(tool.outputSchema.properties.jobs.properties.inventory);
  const a = await call(f, 'diagnostics'),
    b = (await cli(f, [req('diagnostics')]))[0].result;
  assert.deepEqual(a.jobs, b.jobs);
  assert.equal(a.localCli.instanceId, b.localCli.instanceId);
  assert.equal(a.jobs.capacity.occupied, 0);
  assert.equal(a.jobs.capacity.available, MAX_CONCURRENT_JOBS);
  assert.equal(a.jobs.inventory.complete, true);
  await preserved(f);
});

test('all retained slots are discoverable and JOB_LIMIT gives the same actionable IDs through MCP and CLI', async () => {
  const f = await fixture();
  for (let n = MAX_CONCURRENT_JOBS - 1; n >= 0; n--) await retained(f, 'held-' + n);
  const before = await fs.readFile(path.join(f.state, 'jobs/held-0.json'));
  const a = await call(f, 'diagnostics'),
    c = a.jobs.capacity;
  assert.equal(a.jobs.runningJobs, 0);
  assert.equal(c.occupied, MAX_CONCURRENT_JOBS);
  assert.equal(c.available, 0);
  assert.equal(c.retainedResults, MAX_CONCURRENT_JOBS);
  assert.deepEqual(
    c.jobs.map((j) => j.jobId),
    Array.from({ length: MAX_CONCURRENT_JOBS }, (_, i) => 'held-' + i).sort(),
  );
  assert.ok(c.jobs.every((j) => j.nextAction === 'command_retry_save'));
  const launch = {
    cwd: '.',
    executable: process.execPath,
    args: ['-e', "require('fs').writeFileSync('must-not-run.txt','bad')"],
    timeoutSeconds: 30,
    requestId: 'overflow',
  };
  const direct = await call(f, 'terminal_run', launch, 'JOB_LIMIT'),
    rows = await cli(f, [req('terminal_run', launch), sentinel], 1);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].result, direct);
  assert.deepEqual(direct.error.details.capacity, c);
  assert.equal(direct.error.details.nextAction, 'diagnostics');
  assert.deepEqual(await fs.readFile(path.join(f.state, 'jobs/held-0.json')), before);
  const b = (await cli(f, [req('diagnostics')]))[0].result;
  assert.deepEqual(b.jobs, a.jobs);
  await fs.rm(path.join(f.state, 'deny-publish'));
  const saved = await cli(f, [req('command_retry_save', { jobId: 'held-0' }), req('diagnostics')]);
  assert.equal(saved[0].result.job.errorCode, 'EXECUTABLE_NOT_FOUND');
  assert.equal(saved[1].result.jobs.capacity.available, 1);
  assert.equal(saved[1].result.localCli.instanceId, a.localCli.instanceId);
  await call(f, 'command_retry_save', { jobId: 'held-0' });
  assert.equal((await call(f, 'diagnostics')).jobs.capacity.occupied, MAX_CONCURRENT_JOBS - 1);
  for (let n = 1; n < MAX_CONCURRENT_JOBS; n++) await call(f, 'command_retry_save', { jobId: 'held-' + n });
  assert.equal((await call(f, 'diagnostics')).jobs.capacity.available, MAX_CONCURRENT_JOBS);
  await preserved(f);
});

test('private storage error preserves useful owner information and reports unknown saved-job count', async () => {
  const f = await fixture();
  await retained(f, 'held');
  await fs.writeFile(path.join(f.state, 'deny-read'), 'private fixture');
  const a = await call(f, 'diagnostics'),
    b = (await cli(f, [req('diagnostics')]))[0].result;
  assert.equal(a.jobs.storedJobs, null);
  assert.equal(a.jobs.inventory.complete, false);
  assert.equal(a.jobs.inventory.errorCode, 'UNREADABLE_JOB_CATALOG');
  assert.equal(a.jobs.capacity.retainedResults, 1);
  assert.equal(a.jobs.capacity.jobs[0].jobId, 'held');
  assert.deepEqual(a.jobs, b.jobs);
  await fs.rm(path.join(f.state, 'deny-read'));
  await fs.rm(path.join(f.state, 'deny-publish'));
  await call(f, 'command_retry_save', { jobId: 'held' });
  const done = await call(f, 'diagnostics');
  assert.equal(done.jobs.capacity.available, MAX_CONCURRENT_JOBS);
  assert.equal(done.jobs.storedJobs, 1);
  assert.equal(done.jobs.inventory.complete, true);
  await preserved(f);
});

test('active-job occupancy is visible to both clients and cancellation releases only that slot', async () => {
  const f = await fixture();
  await retained(f, 'held');
  await fs.rm(path.join(f.state, 'deny-publish'));
  await call(f, 'terminal_run', {
    cwd: '.',
    executable: process.execPath,
    args: ['-e', 'setInterval(()=>{},1000)'],
    timeoutSeconds: 30,
    requestId: 'active',
  });
  try {
    const a = await call(f, 'diagnostics'),
      b = (await cli(f, [req('diagnostics')]))[0].result;
    assert.deepEqual(a.jobs, b.jobs);
    assert.equal(a.jobs.capacity.occupied, 2);
    assert.equal(a.jobs.capacity.inProgress, 1);
    assert.equal(a.jobs.capacity.retainedResults, 1);
    assert.equal(a.jobs.runningJobs, 1);
    assert.equal(a.jobs.capacity.jobs.find((j) => j.jobId === 'active').nextAction, 'command_status');
    await call(f, 'command_cancel', { jobId: 'active' });
    const r = await call(f, 'diagnostics');
    assert.equal(r.jobs.capacity.occupied, 1);
    assert.equal(r.jobs.capacity.retainedResults, 1);
    assert.equal(r.jobs.runningJobs, 0);
  } finally {
    await call(f, 'command_cancel', { jobId: 'active' });
    await call(f, 'command_retry_save', { jobId: 'held' });
  }
  await preserved(f);
});
