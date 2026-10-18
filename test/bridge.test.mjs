import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { Workspace, limits } from '../dist/workspace.js';

let root, workspace, client, project, outside;
const git = (...args) => execFileSync('git', args, { cwd: project, windowsHide: true, encoding: 'utf8' });
const call = async (name, args = {}) => {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content[0].text;
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { message: text };
  }
  if (!result.isError)
    assert.deepEqual(result.structuredContent, data, `${name}: structured output must match text output`);
  return { error: result.isError === true, data, structured: result.structuredContent };
};

before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'workbridge-test-'));
  outside = await mkdtemp(path.join(os.tmpdir(), 'workbridge-outside-'));
  project = path.join(root, 'Project with spaces');
  await mkdir(path.join(project, 'src'), { recursive: true });
  await mkdir(path.join(project, 'node_modules'), { recursive: true });
  await writeFile(
    path.join(project, 'src', 'chain.ts'),
    'first\r\nfunction resolvePointerChain() {}\r\nlast',
  );
  await writeFile(
    path.join(project, 'src', 'utf16.cs'),
    Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Pointer in UTF16', 'utf16le')]),
  );
  await writeFile(path.join(project, 'node_modules', 'ignored.js'), 'resolvePointerChain');
  await writeFile(path.join(project, 'binary.dat'), Buffer.from([0, 1, 2]));
  await writeFile(path.join(project, 'large.txt'), Buffer.alloc(3 * 1024 * 1024, 97));
  await writeFile(path.join(outside, 'private.txt'), 'must not escape');
  git('init', '--initial-branch=main');
  git('add', 'src');
  git(
    '-c',
    'user.name=Bridge Test',
    '-c',
    'user.email=bridge@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    'Add resolver',
  );
  await writeFile(
    path.join(project, 'src', 'chain.ts'),
    'first\r\nfunction resolvePointerChain() { return 1; }\r\nlast',
  );
  workspace = await Workspace.create(root);
  client = new Client({ name: 'workbridge-test', version: '1.0.0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve('dist/server.js')],
      env: { ...process.env, WORKBRIDGE_ROOT: root },
      stderr: 'pipe',
    }),
  );
});

after(async () => {
  await client?.close();
  // These are exact mkdtemp-owned fixtures, never a workspace/project checkout.
  if (root) await rm(root, { recursive: true, force: true });
  if (outside) await rm(outside, { recursive: true, force: true });
});

test('MCP initialize, discovery, and accurate read/write annotations', async () => {
  const { tools } = await client.listTools();
  assert.equal(tools.length, 33);
  assert.ok(tools.find((t) => t.name === 'read_file').annotations.readOnlyHint);
  assert.equal(tools.find((t) => t.name === 'edit_file').annotations.readOnlyHint, false);
  assert.equal(tools.find((t) => t.name === 'command_run').annotations.openWorldHint, true);
  assert.equal(tools.find((t) => t.name === 'terminal_run').annotations.openWorldHint, true);
  assert.equal(tools.find((t) => t.name === 'terminal_run').annotations.destructiveHint, true);
  const info = await call('workspace_info');
  assert.equal(info.data.root.toLowerCase(), root.toLowerCase());
  const found = await call('discover_projects');
  assert.ok(found.data.projects.some((p) => p.path === 'Project with spaces' && p.git));
});

test('literal source search, exclusions, UTF-16, and line reads over real stdio', async () => {
  const result = await call('search_text', {
    directory: 'Project with spaces',
    query: 'resolvePointerChain',
  });
  assert.deepEqual(
    result.data.matches.map((x) => [x.path, x.line]),
    [['Project with spaces/src/chain.ts', 2]],
  );
  assert.equal(result.data.truncated, false);
  const read = await call('read_file', { path: result.data.matches[0].path, startLine: 2, lineCount: 1 });
  assert.match(read.data.text, /^2: function resolvePointerChain/);
  assert.equal(read.data.nextLine, 3);
  assert.equal(
    (await call('read_file', { path: 'Project with spaces/src/utf16.cs' })).data.text,
    '1: Pointer in UTF16',
  );
});

test('listing pagination and generated-file opt in are explicit', async () => {
  const first = await call('list_directory', { directory: 'Project with spaces/src', limit: 1 });
  assert.equal(first.data.entries.length, 1);
  assert.equal(first.data.nextOffset, 1);
  const second = await call('list_directory', { directory: 'Project with spaces/src', limit: 1, offset: 1 });
  assert.notEqual(first.data.entries[0].path, second.data.entries[0].path);
  const search = await call('search_text', {
    directory: 'Project with spaces',
    query: 'resolvePointerChain',
    includeGenerated: true,
    limit: 1,
  });
  assert.equal(search.data.truncated, true);
});

test('outside-root, alternate-stream, Git internals, and binary reads fail clearly', async () => {
  for (const p of [
    '../escape',
    outside,
    'Project with spaces/.git/config',
    'Project with spaces/src/chain.ts:stream',
    'Project with spaces/NUL',
  ]) {
    assert.equal((await call('read_file', { path: p })).error, true, p);
  }
  assert.equal(
    (await call('read_file', { path: 'Project with spaces/binary.dat' })).data.error.code,
    'NOT_TEXT',
  );
  assert.equal((await call('read_file', { path: 'Project with spaces/large.txt' })).error, false);
  assert.equal((await call('read_file', { path: 'missing.txt' })).data.error.code, 'ENOENT');
});

test('Windows directory junction escape is rejected and not searched', async () => {
  await symlink(outside, path.join(project, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(
    workspace.read('Project with spaces/linked/private.txt'),
    (e) => e.code === 'LINK_NOT_ALLOWED',
  );
  const result = await workspace.search('Project with spaces', 'must not escape');
  assert.equal(result.matches.length, 0);
  assert.ok((await workspace.list('Project with spaces', true)).skipped >= 1);
});

test('Git status/diff/history inspect real staged, unstaged, and deleted files', async () => {
  const status = await call('git_status', { project: 'Project with spaces' });
  assert.equal(status.error, false);
  assert.match(status.data.output, / M src\/chain.ts/);
  const diff = await call('git_diff', { project: 'Project with spaces', path: 'src/chain.ts' });
  assert.match(diff.data.output, /return 1/);
  const history = await call('git_history', { project: 'Project with spaces', path: 'src/chain.ts' });
  assert.match(history.data.output, /Add resolver/);
  assert.equal((await call('git_history', { project: 'Project with spaces', ref: '--all' })).error, true);
  assert.equal((await call('git_diff', { project: 'Project with spaces', path: '../escape' })).error, true);
  git('add', 'src/chain.ts');
  assert.match(
    (await call('git_diff', { project: 'Project with spaces', staged: true })).data.output,
    /return 1/,
  );
  await rm(path.join(project, 'src', 'chain.ts'));
  assert.match(
    (await call('git_diff', { project: 'Project with spaces', path: 'src/chain.ts' })).data.output,
    /deleted file/,
  );
});

test('Git cannot use external diff helpers or fsmonitor commands', async () => {
  const marker = path.join(project, 'helper-was-run.txt');
  const helper = path.join(project, 'helper.cjs');
  await writeFile(helper, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'BAD');`);
  const command = `"${process.execPath.replaceAll('\\', '/')}" "${helper.replaceAll('\\', '/')}"`;
  git('config', 'diff.external', command);
  git('config', 'core.fsmonitor', command);
  assert.equal((await call('git_status', { project: 'Project with spaces' })).error, false);
  assert.equal((await call('git_diff', { project: 'Project with spaces' })).error, false);
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
});

test('schema errors do not break subsequent calls, and output is bounded', async () => {
  assert.equal((await call('read_file', { path: 'x', lineCount: 0 })).error, true);
  const file = path.join(project, 'long.txt');
  await writeFile(file, 'a'.repeat(limits.outputChars + 100));
  const result = await call('read_file', { path: 'Project with spaces/long.txt' });
  assert.equal(result.data.outputLimitReached, true);
  assert.equal(result.data.text.length, limits.outputChars);
  assert.equal((await call('workspace_info')).error, false);
});

test('file reads advertise a schema and deliver source as structured text', async () => {
  const { tools } = await client.listTools();
  const tool = tools.find((t) => t.name === 'read_file');
  assert.ok(tool.outputSchema.properties.text);
  const result = await call('read_file', { path: 'Project with spaces/src/utf16.cs', lineCount: 1 });
  assert.equal(result.structured.text, '1: Pointer in UTF16');
  assert.equal('content' in result.structured, false);
});
