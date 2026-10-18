import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { Workspace } from '../dist/workspace.js';

let fixture, primary, secondary, outside, state, project, client, workspace;
const portable = (s) => s.split(path.sep).join('/');
async function call(name, args = {}, error) {
  const result = await client.callTool({ name, arguments: args });
  const data = JSON.parse(result.content[0].text);
  if (error) {
    assert.equal(result.isError, true);
    assert.equal(data.error.code, error);
  } else {
    assert.ok(!result.isError, JSON.stringify(data));
    assert.deepEqual(result.structuredContent, data);
  }
  return data;
}
before(async () => {
  fixture = await mkdtemp(path.join(os.tmpdir(), 'workbridge-roots-'));
  primary = path.join(fixture, 'work');
  secondary = path.join(fixture, 'rift modding Ã¼');
  outside = path.join(fixture, 'rift modding Ã¼-other');
  state = path.join(primary, 'private-state');
  project = path.join(secondary, 'Project with spaces');
  for (const dir of [state, project, outside]) await mkdir(dir, { recursive: true });
  await writeFile(path.join(state, 'workspace-roots.json'), JSON.stringify({ additionalRoots: [secondary] }));
  await writeFile(path.join(state, 'secret.txt'), 'protected fixture');
  await writeFile(path.join(primary, 'primary.txt'), 'primary unchanged');
  await writeFile(path.join(project, 'source.txt'), 'secondary source marker\n');
  await writeFile(path.join(project, 'package.json'), '{"private":true}');
  await writeFile(path.join(outside, 'secret.txt'), 'not an allowed root');
  const git = (...args) => execFileSync('git', args, { cwd: project, windowsHide: true, encoding: 'utf8' });
  git('init', '--initial-branch=main');
  git('add', 'source.txt');
  git(
    '-c',
    'user.name=Roots Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    'Fixture',
  );
  workspace = await Workspace.create(primary, [secondary, secondary]);
  workspace.protect(state);
  client = new Client({ name: 'roots-tests', version: '1' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve('dist/server.js')],
      env: { ...process.env, WORKBRIDGE_ROOT: primary, WORKBRIDGE_STATE_DIR: state },
      stderr: 'pipe',
    }),
  );
});
after(async () => {
  await client?.close();
  if (fixture) await rm(fixture, { recursive: true, force: true });
});

test('workspace advertises both canonical roots and keeps primary relative paths stable', async () => {
  const info = await call('workspace_info');
  assert.equal(info.root, primary);
  assert.deepEqual(info.roots, [primary, secondary]);
  assert.equal(workspace.roots.length, 2);
  const first = await call('read_file', { path: 'primary.txt' });
  assert.equal(first.path, 'primary.txt');
  const second = await call('read_file', { path: path.join(project, 'source.txt') });
  assert.equal(second.path, portable(path.join(project, 'source.txt')));
  assert.equal((await call('read_file', { path: second.path })).sha256, second.sha256);
});
test('discovery, listing and search return reusable paths with correct secondary Git detection', async () => {
  const discovered = await call('discover_projects', { directory: secondary });
  const found = discovered.projects.find((x) => x.path === portable(project));
  assert.ok(found);
  assert.equal(found.git, true);
  const listed = await call('list_directory', { directory: project });
  assert.ok(listed.entries.some((x) => x.path === portable(path.join(project, 'source.txt'))));
  const foundText = await call('search_text', { directory: project, query: 'secondary source marker' });
  assert.ok(JSON.stringify(foundText).includes(portable(path.join(project, 'source.txt'))));
  assert.equal((await call('project_overview', { project })).project, portable(project));
});
test('secondary writes and cross-root moves retain durable undo paths', async () => {
  const file = path.join(project, 'scratch.txt');
  const written = await call('write_file', {
    path: file,
    content: 'scratch',
    expectedHash: null,
    operationId: 'roots-write',
  });
  assert.equal(written.path, portable(file));
  const moved = await call('move_file', {
    path: file,
    destination: 'scratch-primary.txt',
    expectedHash: written.afterHash,
    operationId: 'roots-move',
  });
  assert.equal(moved.destination, 'scratch-primary.txt');
  await call('undo_change', { operationId: 'roots-move' });
  assert.equal((await call('read_file', { path: file })).sha256, written.afterHash);
  await call('undo_change', { operationId: 'roots-write' });
  await assert.rejects(readFile(file), { code: 'ENOENT' });
});
test('Git inspection and saved raw snapshots work in the secondary root', async () => {
  assert.equal((await call('git_status', { project })).project, portable(project));
  const history = await call('git_read_file', { project, path: 'source.txt' });
  assert.match(history.text, /secondary source marker/);
  const raw = path.join(project, 'snapshot.bin');
  await writeFile(raw, Buffer.from([1, 2, 3, 4]));
  const result = await call('snapshot_read', { path: raw, offset: '0', length: 4 });
  assert.equal(result.path, portable(raw));
  assert.match(result.hex, /01.*02.*03.*04/);
});
test('terminal execution accepts an explicit secondary cwd and retains its absolute identity', async () => {
  const job = await call('terminal_run', {
    cwd: project,
    executable: process.execPath,
    args: ['-e', 'console.log(process.cwd())'],
    requestId: 'roots-terminal',
    timeoutSeconds: 10,
  });
  assert.equal(job.project, portable(project));
  let status;
  for (let n = 0; n < 100; n++) {
    status = await call('command_status', { jobId: job.id });
    if (status.status !== 'running') break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(status.status, 'passed');
  assert.equal(status.exitCode, 0);
  assert.equal((await call('command_output', { jobId: job.id })).text.trim(), project);
});
test('outside roots, prefix siblings, parents and protected state remain inaccessible', async () => {
  await call('read_file', { path: path.join(outside, 'secret.txt') }, 'OUTSIDE_ROOT');
  await call('list_directory', { directory: fixture }, 'OUTSIDE_ROOT');
  await call(
    'write_file',
    { path: path.join(outside, 'new.txt'), content: 'no', expectedHash: null, operationId: 'roots-outside' },
    'OUTSIDE_ROOT',
  );
  await call('read_file', { path: path.join(state, 'secret.txt') }, 'PROTECTED_PATH');
  await call(
    'terminal_run',
    { cwd: outside, executable: process.execPath, requestId: 'outside-cwd' },
    'OUTSIDE_ROOT',
  );
});
test('each configured root is protected from mutation, including Windows case variants', async () => {
  for (const root of [primary, secondary]) {
    await call(
      'delete_file',
      {
        path: root,
        expectedHash: null,
        operationId: 'root-delete-' + path.basename(root).replace(/\W/g, '-'),
      },
      'ROOT_OPERATION',
    );
    await assert.rejects(workspace.resolveForCreate(root), (e) => e.code === 'ROOT_OPERATION');
    if (process.platform === 'win32')
      await assert.rejects(
        workspace.resolveForCreate(root.toUpperCase()),
        (e) => e.code === 'ROOT_OPERATION',
      );
  }
});
test('junctions between allowed roots and from an allowed root to outside are rejected', async () => {
  const allowed = path.join(project, 'primary-link'),
    forbidden = path.join(project, 'outside-link');
  for (const [link, target] of [
    [allowed, primary],
    [forbidden, outside],
  ]) {
    await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    try {
      await call('list_directory', { directory: link }, 'LINK_NOT_ALLOWED');
    } finally {
      await rm(link, { recursive: true, force: true });
    }
  }
});
test('invalid roots fail closed and missing configuration preserves the single-root default', async () => {
  await assert.rejects(Workspace.create(primary, ['relative-root']), (e) => e.code === 'INVALID_ROOT');
  await assert.rejects(Workspace.create(primary, [path.join(fixture, 'missing-root')]), { code: 'ENOENT' });
  assert.deepEqual((await Workspace.create(primary)).roots, [primary]);
  const badState = path.join(fixture, 'invalid-state');
  await mkdir(badState);
  for (const config of [{ additionalRoots: 'C:/' }, { additionalRoots: [secondary], extra: true }]) {
    await writeFile(path.join(badState, 'workspace-roots.json'), JSON.stringify(config));
    assert.throws(
      () =>
        execFileSync(process.execPath, [path.resolve('dist/server.js')], {
          env: { ...process.env, WORKBRIDGE_ROOT: primary, WORKBRIDGE_STATE_DIR: badState },
          timeout: 4000,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        }),
      (e) => e.status === 1 && /INVALID_CONFIG|workspace-roots/.test(e.stderr.toString()),
    );
  }
});
