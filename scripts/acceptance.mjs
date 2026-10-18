// Self-contained acceptance; no real project, credential, or fixed root required.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';

const repo = fileURLToPath(new URL('..', import.meta.url));
const temporary = path.resolve(os.tmpdir());
const fixture = await mkdtemp(path.join(temporary, 'workbridge-acceptance-'));
const root = path.join(fixture, 'projects ü'),
  state = path.join(fixture, 'private-state');
const project = path.join(root, 'team', 'ordinary-app'),
  plain = path.join(root, 'plain-folder');
const env = { ...getDefaultEnvironment(), WORKBRIDGE_ROOT: root, WORKBRIDGE_STATE_DIR: state };
const client = new Client({ name: 'workbridge-generic-acceptance', version: '1' });
let report;
async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  assert.ok(!result.isError, `${name}: ${JSON.stringify(result.content)}`);
  const data = JSON.parse(result.content[0].text);
  assert.deepEqual(result.structuredContent, data);
  return data;
}
async function ended(id) {
  for (let n = 0; n < 200; n++) {
    const job = await call('command_status', { jobId: id });
    if (job.status !== 'running') return job;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('Acceptance command exceeded its deadline.');
}
try {
  for (const dir of [project, plain, state]) await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(root, 'AGENTS.md'),
    'Synthetic instruction fixture: inspect tests before editing.\n',
  );
  await writeFile(
    path.join(project, 'package.json'),
    '{"private":true,"scripts":{"test":"node verify.cjs"}}\n',
  );
  await writeFile(path.join(project, 'calculate.cjs'), 'module.exports=(a,b)=>a-b;\n');
  await writeFile(
    path.join(project, 'verify.cjs'),
    'require("node:assert/strict").equal(require("./calculate.cjs")(2,3),5);console.log("sum=5");\n',
  );
  await writeFile(path.join(plain, 'notes.py'), '# Ordinary folder without Git\n');
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: project,
      env: getDefaultEnvironment(),
      windowsHide: true,
      encoding: 'utf8',
    });
  git('init', '--initial-branch=main');
  git('add', 'calculate.cjs', 'verify.cjs', 'package.json');
  git(
    '-c',
    'user.name=Workbridge Acceptance Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    'Synthetic baseline',
  );
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.join(repo, 'dist/server.js')],
      env,
      stderr: 'pipe',
    }),
  );
  const info = await call('workspace_info');
  assert.equal(info.root, root);
  const discovered = await call('discover_projects', { recursive: true });
  assert.ok(discovered.projects.some((p) => p.git && p.path === 'team/ordinary-app'));
  const context = await call('project_overview', { project });
  assert.ok(context.instructionFiles.some((x) => x.path === 'AGENTS.md'));
  assert.equal((await call('project_overview', { project: plain })).repository.kind, 'folder');
  const found = await call('search_text', { directory: project, query: 'module.exports' });
  assert.equal(found.matches[0].path, 'team/ordinary-app/calculate.cjs');
  await call('terminal_run', {
    cwd: project,
    executable: 'npm',
    args: ['test', '--silent'],
    requestId: 'generic-fail',
    timeoutSeconds: 20,
  });
  const failure = await ended('generic-fail');
  assert.equal(failure.exitCode, 1);
  assert.match(
    (await call('command_output', { jobId: 'generic-fail', stream: 'stderr' })).text,
    /ERR_ASSERTION/,
  );
  const source = await call('read_file', { path: found.matches[0].path });
  await call('edit_file', {
    path: source.path,
    expectedHash: source.sha256,
    operationId: 'generic-fix',
    edits: [{ oldText: 'a-b', newText: 'a+b' }],
  });
  const request = {
    cwd: project,
    executable: 'npm',
    args: ['test', '--silent'],
    requestId: 'generic-pass',
    timeoutSeconds: 20,
  };
  await call('terminal_run', request);
  const passed = await ended('generic-pass');
  assert.equal(passed.status, 'passed');
  assert.equal(passed.exitCode, 0);
  assert.equal((await call('terminal_run', request)).startedAt, passed.startedAt);
  assert.match((await call('command_output', { jobId: 'generic-pass', stream: 'stdout' })).text, /sum=5/);
  assert.match((await call('git_status', { project })).output, /calculate.cjs/);
  assert.ok((await call('git_history', { project, limit: 1 })).output);
  const scratch = await call('write_file', {
    path: path.join(plain, 'scratch.txt'),
    content: 'temporary',
    expectedHash: null,
    operationId: 'generic-scratch',
  });
  await call('read_file', { path: scratch.path });
  await call('undo_change', { operationId: 'generic-scratch' });
  const bytes = Buffer.from('snapshot-fixture');
  const snapshot = path.join(plain, 'saved.bin.gz');
  await writeFile(snapshot, gzipSync(bytes));
  await call('snapshot_cache', { path: snapshot, action: 'prepare' });
  let cache;
  for (let n = 0; n < 100; n++) {
    cache = await call('snapshot_cache', { path: snapshot });
    if (cache.status !== 'running') break;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(cache.status, 'ready');
  assert.equal(
    (await call('snapshot_read', { path: snapshot, offset: '0', length: bytes.length })).hex,
    bytes.toString('hex'),
  );
  await call('undo_change', { operationId: 'generic-fix' });
  report = {
    result: 'passed',
    version: info.version,
    toolCount: (await client.listTools()).tools.length,
    transport: 'local stdio',
    hostedVerified: false,
    selfContained: true,
    checks: [
      'nested-repository',
      'instruction-context',
      'plain-folder',
      'search-read',
      'failing-test',
      'guarded-fix',
      'passing-test',
      'separate-output',
      'request-replay',
      'Git-inspection',
      'write-read-undo',
      'gzip-snapshot',
    ],
    failureExit: failure.exitCode,
    passedExit: passed.exitCode,
  };
} finally {
  try {
    await client.close();
  } finally {
    const relative = path.relative(temporary, fixture);
    if (
      path.dirname(fixture) !== temporary ||
      !relative.startsWith('workbridge-acceptance-') ||
      relative.includes(path.sep)
    )
      throw new Error('Unexpected acceptance cleanup path.');
    await rm(fixture, { recursive: true, force: true });
  }
}
report.fixtureCleanupComplete = true;
const reportDirectory = path.resolve(process.env.WORKBRIDGE_STATE_DIR ?? path.join(repo, '.local'));
await mkdir(reportDirectory, { recursive: true });
await writeFile(path.join(reportDirectory, 'acceptance.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
