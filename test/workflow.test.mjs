import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { readPage } from '../dist/text.js';

let root, state, project, client;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const git = (...args) =>
  execFileSync('git', args, { cwd: project, windowsHide: true, encoding: 'utf8' }).trim();
const file = (name) => `Example project/${name}`;
async function connect() {
  client = new Client({ name: 'workflow-tests', version: '1' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve('dist/server.js')],
      env: {
        ...process.env,
        WORKBRIDGE_ROOT: root,
        WORKBRIDGE_STATE_DIR: state,
        CONTROL_PLANE_API_KEY: 'fixture-not-a-real-key',
      },
      stderr: 'pipe',
    }),
  );
}
async function call(name, args = {}, error) {
  const result = await client.callTool({ name, arguments: args });
  const data = JSON.parse(result.content[0].text);
  if (error) {
    assert.equal(result.isError, true, `${name}: expected ${error}`);
    assert.equal(data.error.code, error);
  } else {
    assert.ok(!result.isError, `${name}: ${JSON.stringify(data)}`);
    assert.deepEqual(result.structuredContent, data);
  }
  return data;
}
async function untilEnded(id) {
  for (let i = 0; i < 100; i++) {
    const result = await call('command_status', { jobId: id });
    if (result.status !== 'running') return result;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Job did not finish');
}
before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'workbridge-workflow-'));
  state = path.join(root, 'private-state');
  project = path.join(root, 'Example project');
  await mkdir(project);
  await mkdir(state);
  await writeFile(path.join(project, 'tracked.txt'), 'baseline\n');
  await writeFile(path.join(project, 'unrelated.txt'), 'original\n');
  git('init', '--initial-branch=main');
  git('config', 'user.name', 'Workflow Test');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('add', '.');
  git('commit', '-m', 'Baseline');
  await writeFile(
    path.join(project, 'package.json'),
    JSON.stringify({ scripts: { test: 'test-command' }, dependencies: { example: '1' } }),
  );
  const command = (code, timeoutSeconds = 10) => ({
    executable: process.execPath,
    args: ['-e', code],
    timeoutSeconds,
  });
  await writeFile(
    path.join(state, 'commands.json'),
    JSON.stringify({
      projects: {
        'Example project': {
          pass: command(
            'console.log("PASS fixture"); console.log("bridge-key-present=" + !!process.env.CONTROL_PLANE_API_KEY)',
          ),
          fail: command('console.error("expected failure"); process.exit(7)'),
          slow: command('setInterval(() => {}, 1000)'),
          timeout: command('setInterval(() => {}, 1000)', 1),
          lots: command('process.stdout.write("x".repeat(1100000))'),
          missing: { executable: path.join(root, 'missing-executable.exe'), args: [] },
        },
      },
    }),
  );
  await connect();
});
after(async () => {
  await client?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

test('create/edit returns real diffs, preserves CRLF, and rejects stale/ambiguous edits', async () => {
  const created = await call('write_file', {
    operationId: 'edit-create',
    path: file('edits.txt'),
    content: 'alpha\r\nbeta\r\n',
    expectedHash: null,
  });
  assert.match(created.diff, /alpha/);
  const read = await call('read_file', { path: file('edits.txt') });
  const edited = await call('edit_file', {
    operationId: 'edit-apply',
    path: file('edits.txt'),
    expectedHash: read.sha256,
    edits: [{ oldText: 'alpha\nbeta', newText: 'new\nvalue' }],
  });
  assert.match(edited.diff, /new/);
  assert.equal(await readFile(path.join(project, 'edits.txt'), 'utf8'), 'new\r\nvalue\r\n');
  await call(
    'edit_file',
    {
      operationId: 'stale-edit',
      path: file('edits.txt'),
      expectedHash: read.sha256,
      edits: [{ oldText: 'new', newText: 'bad' }],
    },
    'CONFLICT',
  );
  await call(
    'edit_file',
    {
      operationId: 'missing-edit',
      path: file('edits.txt'),
      expectedHash: edited.afterHash,
      edits: [{ oldText: 'missing', newText: 'bad' }],
    },
    'EDIT_MISMATCH',
  );
  assert.equal(await readFile(path.join(project, 'edits.txt'), 'utf8'), 'new\r\nvalue\r\n');
});

test('UTF-8 and UTF-16 BOM/endianness survive edits and undo', async () => {
  for (const [label, prefix, encoding, swap] of [
    ['utf8', [239, 187, 191], 'utf8', false],
    ['le', [255, 254], 'utf16le', false],
    ['be', [254, 255], 'utf16le', true],
  ]) {
    const body = Buffer.from('hello\r\nworld', encoding);
    if (swap) body.swap16();
    const original = Buffer.concat([Buffer.from(prefix), body]);
    await writeFile(path.join(project, `${label}.txt`), original);
    const read = await call('read_file', { path: file(`${label}.txt`) });
    await call('edit_file', {
      operationId: `bom-${label}`,
      path: file(`${label}.txt`),
      expectedHash: read.sha256,
      edits: [{ oldText: 'world', newText: 'changed' }],
    });
    assert.deepEqual(
      (await readFile(path.join(project, `${label}.txt`))).subarray(0, prefix.length),
      Buffer.from(prefix),
    );
    await call('undo_change', { operationId: `bom-${label}` });
    assert.deepEqual(await readFile(path.join(project, `${label}.txt`)), original);
  }
});

test('operation IDs prevent duplicate writes and distinguish conflicting reuse', async () => {
  const args = { operationId: 'idempotent', path: file('once.txt'), content: 'original', expectedHash: null };
  await call('write_file', args);
  await writeFile(path.join(project, 'once.txt'), 'changed later');
  assert.equal((await call('write_file', args)).replayed, true);
  assert.equal(await readFile(path.join(project, 'once.txt'), 'utf8'), 'changed later');
  await call('write_file', { ...args, content: 'different' }, 'ID_REUSE');
  assert.equal((await call('change_status', { operationId: args.operationId })).state, 'applied');
  await call('undo_change', { operationId: args.operationId }, 'CONFLICT');
});

test('concurrent edits cannot both apply from the same original hash', async () => {
  await writeFile(path.join(project, 'race.txt'), 'before');
  const sha256 = hash('before');
  const result = await Promise.all(
    ['first', 'second'].map((content) =>
      client.callTool({
        name: 'write_file',
        arguments: { operationId: `race-${content}`, path: file('race.txt'), expectedHash: sha256, content },
      }),
    ),
  );
  assert.equal(result.filter((x) => !x.isError).length, 1);
  assert.equal(result.filter((x) => x.isError).length, 1);
});

test('file moves, Windows case-only renames, deletes, and empty directories are recoverable', async () => {
  await call('create_directory', { operationId: 'dir-create', path: file('folder') });
  await call('write_file', {
    operationId: 'move-create',
    path: file('folder/file.txt'),
    content: 'move me',
    expectedHash: null,
  });
  const sha256 = hash('move me');
  await call('move_file', {
    operationId: 'move-one',
    path: file('folder/file.txt'),
    destination: file('folder/File.txt'),
    expectedHash: sha256,
  });
  assert.ok((await readdir(path.join(project, 'folder'))).includes('File.txt'));
  await call('undo_change', { operationId: 'move-one' });
  assert.ok((await readdir(path.join(project, 'folder'))).includes('file.txt'));
  await call('delete_file', {
    operationId: 'remove-file',
    path: file('folder/file.txt'),
    expectedHash: sha256,
  });
  await call('undo_change', { operationId: 'remove-file' });
  assert.equal(await readFile(path.join(project, 'folder/file.txt'), 'utf8'), 'move me');
  await call(
    'delete_file',
    { operationId: 'nonempty', path: file('folder'), expectedHash: null },
    'NOT_EMPTY',
  );
  await call('undo_change', { operationId: 'move-create' });
  await call('undo_change', { operationId: 'dir-create' });
  assert.equal((await call('undo_change', { operationId: 'dir-create' })).replayed, true);
});

test('new filenames, protected state, root operations, and Windows junctions are checked', async () => {
  for (const target of [
    '../escape.txt',
    file('NUL.txt'),
    file('file.txt:stream'),
    file('bad.'),
    'private-state/commands.json',
    '.git/config',
    '.',
  ]) {
    const response = await client.callTool({
      name: 'write_file',
      arguments: { operationId: 'invalid-path', path: target, content: 'bad', expectedHash: null },
    });
    assert.equal(response.isError, true, target);
  }
  await call('read_file', { path: 'private-state/commands.json' }, 'PROTECTED_PATH');
  const outside = await mkdtemp(path.join(os.tmpdir(), 'workbridge-link-target-'));
  try {
    await symlink(outside, path.join(project, 'junction'), process.platform === 'win32' ? 'junction' : 'dir');
    await call(
      'write_file',
      {
        operationId: 'junction-write',
        path: file('junction/escape.txt'),
        content: 'bad',
        expectedHash: null,
      },
      'LINK_NOT_ALLOWED',
    );
    assert.deepEqual(await readdir(outside), []);
  } finally {
    await rm(path.join(project, 'junction'), { force: true, recursive: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('large text pages resume by cursor and reject changed/tampered cursors', async () => {
  const data = '0123456789 test large line\r\n'.repeat(150000);
  await writeFile(path.join(project, 'big.log'), data);
  const first = await call('read_file', { path: file('big.log'), lineCount: 3 });
  assert.ok(first.size > 2 * 1024 * 1024);
  assert.ok(first.scannedBytes <= 65536);
  assert.ok(first.cursor);
  assert.equal(first.totalLines, null);
  const next = await call('read_file', { path: file('big.log'), cursor: first.cursor, lineCount: 2 });
  assert.match(next.text, /^4: /);
  assert.equal(next.nextLine, 6);
  await call('read_file', { path: file('big.log'), cursor: first.cursor + 'x' }, 'INVALID_CURSOR');
  await writeFile(path.join(project, 'big.log'), 'changed');
  await call('read_file', { path: file('big.log'), cursor: first.cursor }, 'FILE_CHANGED');
});

test('text pages handle UTF-16/CRLF chunk boundaries and huge single lines without whole-file allocation', async () => {
  const original = 'a'.repeat(32766) + '\r\nsecond\r\n';
  await writeFile(
    path.join(project, 'boundary.txt'),
    Buffer.concat([Buffer.from([255, 254]), Buffer.from(original, 'utf16le')]),
  );
  const first = await call('read_file', { path: file('boundary.txt'), lineCount: 1 });
  const next = await call('read_file', { path: file('boundary.txt'), cursor: first.cursor, lineCount: 1 });
  assert.equal(next.text, '2: second');
  await writeFile(path.join(project, 'huge-line.txt'), 'a'.repeat(3 * 1024 * 1024));
  const clipped = await call('read_file', { path: file('huge-line.txt') });
  assert.equal(clipped.text.length, 60000);
  assert.equal(clipped.outputLimitReached, true);
});

test('search honors Git ignores/globs, regex, output paging, and invalid regex errors', async () => {
  await writeFile(path.join(project, '.gitignore'), 'ignored-query.txt\n');
  await writeFile(path.join(project, 'ignored-query.txt'), 'uniqueQuery42');
  await writeFile(path.join(project, 'one-query.ts'), 'uniqueQuery42\nuniqueQuery43\n');
  await writeFile(path.join(project, 'two-query.py'), 'uniqueQuery42\n');
  const found = await call('search_text', {
    directory: 'Example project',
    query: 'uniqueQuery4[23]',
    regex: true,
    glob: ['*.ts'],
    limit: 1,
  });
  assert.equal(found.matches.length, 1);
  assert.equal(found.nextOffset, 1);
  const second = await call('search_text', {
    directory: 'Example project',
    query: 'uniqueQuery4[23]',
    regex: true,
    glob: ['*.ts'],
    limit: 1,
    offset: 1,
  });
  assert.equal(second.matches[0].line, 2);
  const ignored = await call('search_text', { directory: 'Example project', query: 'uniqueQuery42' });
  assert.equal(
    ignored.matches.some((x) => x.path.endsWith('ignored-query.txt')),
    false,
  );
  const included = await call('search_text', {
    directory: 'Example project',
    query: 'uniqueQuery42',
    includeIgnored: true,
  });
  assert.ok(included.matches.some((x) => x.path.endsWith('ignored-query.txt')));
  await call('search_text', { directory: 'Example project', query: '(', regex: true }, 'SEARCH_ERROR');
});

test('project overview returns manifest evidence and no automatic command authorization', async () => {
  const overview = await call('project_overview', { project: 'Example project' });
  assert.ok(overview.manifests.includes(file('package.json')));
  assert.equal(overview.npm.scripts.test, 'test-command');
  assert.ok(overview.languages.TypeScript);
  assert.match(overview.note, /not automatically approved/);
});

test('configured commands pass/fail, strip bridge credentials, and deduplicate requests', async () => {
  assert.ok(
    (await call('commands_list', { project: 'Example project' })).commands.some((x) => x.name === 'pass'),
  );
  await call(
    'command_run',
    { project: 'Example project', command: 'arbitrary', requestId: 'bad-command' },
    'COMMAND_NOT_CONFIGURED',
  );
  const args = { project: 'Example project', command: 'pass', requestId: 'job-pass' };
  await call('command_run', args);
  const status = await untilEnded('job-pass');
  assert.equal(status.status, 'passed');
  assert.equal(status.exitCode, 0);
  const output = await call('command_output', { jobId: 'job-pass' });
  assert.match(output.text, /PASS fixture/);
  assert.match(output.text, /bridge-key-present=false/);
  assert.equal((await call('command_run', args)).id, 'job-pass');
  await call('command_run', { project: 'Example project', command: 'fail', requestId: 'job-fail' });
  const failure = await untilEnded('job-fail');
  assert.equal(failure.status, 'failed');
  assert.equal(failure.exitCode, 7);
  await call('command_run', { project: 'Example project', command: 'missing', requestId: 'job-missing' });
  assert.equal((await untilEnded('job-missing')).status, 'failed');
});

test('commands cancel, time out, and bound captured output', async () => {
  await call('command_run', { project: 'Example project', command: 'slow', requestId: 'job-cancel' });
  assert.equal((await call('command_cancel', { jobId: 'job-cancel' })).status, 'cancelled');
  await call('command_run', { project: 'Example project', command: 'timeout', requestId: 'job-timeout' });
  assert.equal((await untilEnded('job-timeout')).status, 'timed_out');
  await call('command_run', { project: 'Example project', command: 'lots', requestId: 'job-lots' });
  const status = await untilEnded('job-lots');
  assert.equal(status.status, 'passed');
  assert.equal(status.outputTruncated, true);
  assert.equal(status.outputLength, 1048576);
  const output = await call('command_output', { jobId: 'job-lots', limit: 50000 });
  assert.equal(output.text.length, 50000);
  assert.equal(output.nextOffset, 50000);
  assert.equal(
    (await call('command_output', { jobId: 'job-lots', offset: 500000, limit: 50000 })).text.length,
    50000,
  );
});

test('edit expansion is rejected before allocating an oversized result', async () => {
  await writeFile(path.join(project, 'expansion.txt'), 'x'.repeat(1000));
  await call(
    'edit_file',
    {
      operationId: 'expansion-limit',
      path: file('expansion.txt'),
      expectedHash: hash('x'.repeat(1000)),
      edits: [{ oldText: 'x', newText: 'y'.repeat(1024 * 1024), occurrences: 1000 }],
    },
    'EDIT_LIMIT',
  );
  assert.equal((await readFile(path.join(project, 'expansion.txt'))).length, 1000);
});

test('corrupt undo backups cannot replace good working files; metadata stays small', async () => {
  await writeFile(path.join(project, 'backup.txt'), 'before\n');
  await call('write_file', {
    operationId: 'backup-integrity',
    path: file('backup.txt'),
    expectedHash: hash('before\n'),
    content: 'after\n',
  });
  const metadata = await readFile(path.join(state, 'changes/backup-integrity.json'), 'utf8');
  assert.ok(metadata.length < 1000);
  assert.equal(JSON.parse(metadata).before, 'backup-integrity.before');
  await writeFile(path.join(state, 'changes/backup-integrity.before'), 'corrupt');
  await call('undo_change', { operationId: 'backup-integrity' }, 'CORRUPT_BACKUP');
  assert.equal(await readFile(path.join(project, 'backup.txt'), 'utf8'), 'after\n');
});

test('uncertain operation replay reports actual file state instead of applying again', async () => {
  await call('write_file', {
    operationId: 'uncertain-op',
    path: file('uncertain.txt'),
    expectedHash: null,
    content: 'applied once',
  });
  const journal = path.join(state, 'changes/uncertain-op.json');
  const metadata = JSON.parse(await readFile(journal, 'utf8'));
  metadata.state = 'prepared';
  await writeFile(journal, JSON.stringify(metadata));
  const stateResult = await call('change_status', { operationId: 'uncertain-op' });
  assert.equal(stateResult.current[file('uncertain.txt')].sha256, hash('applied once'));
  await call(
    'write_file',
    { operationId: 'uncertain-op', path: file('uncertain.txt'), expectedHash: null, content: 'applied once' },
    'OPERATION_UNCERTAIN',
  );
});

test('scan-budget continuation keeps the requested distant line and advances', async () => {
  const target = path.join(project, 'scan-budget.txt');
  await writeFile(target, 'one\n'.repeat(200));
  let page = await readPage(target, file('scan-budget.txt'), 100, 1, undefined, 64);
  assert.equal(page.text, '');
  assert.ok(page.cursor);
  for (let i = 0; i < 10 && !page.text; i++)
    page = await readPage(target, file('scan-budget.txt'), 1, 1, page.cursor, 64);
  assert.equal(page.text, '100: one');
  await writeFile(target, 'x'.repeat(1000));
  await assert.rejects(
    readPage(target, file('scan-budget.txt'), 2, 1, undefined, 64),
    (e) => e.code === 'LINE_LIMIT',
  );
});

test('workspace root deletion is always forbidden', async () => {
  await call('delete_file', { operationId: 'delete-root', path: '.', expectedHash: null }, 'ROOT_OPERATION');
});

test('initial selected-file commit preserves unrelated staging; missing Git identity is explicit', async () => {
  const initial = path.join(root, 'Initial');
  await mkdir(initial);
  const g = (...args) =>
    execFileSync('git', args, { cwd: initial, encoding: 'utf8', windowsHide: true }).trim();
  g('init', '--initial-branch=main');
  g('config', 'user.name', 'Initial Test');
  g('config', 'user.email', 'initial@example.invalid');
  g('config', 'commit.gpgsign', 'false');
  await writeFile(path.join(initial, 'selected.txt'), 'selected');
  await writeFile(path.join(initial, 'unrelated.txt'), 'unrelated');
  g('add', 'unrelated.txt');
  const commit = await call('git_commit', {
    project: 'Initial',
    operationId: 'initial-commit',
    expectedHead: null,
    message: 'Initial selected file',
    files: [{ path: 'selected.txt', sha256: hash('selected') }],
  });
  assert.equal(commit.commit, g('rev-parse', 'HEAD'));
  assert.equal(g('ls-tree', '--name-only', 'HEAD'), 'selected.txt');
  assert.equal(g('diff', '--cached', '--name-only'), 'unrelated.txt');
  g('config', 'user.name', '');
  g('config', 'user.email', '');
  await call(
    'git_commit',
    {
      project: 'Initial',
      operationId: 'no-identity',
      expectedHead: commit.commit,
      message: 'Should fail',
      files: [{ path: 'unrelated.txt', sha256: hash('unrelated') }],
    },
    'GIT_IDENTITY',
  );
});

test(
  'Windows command cancellation terminates a spawned descendant',
  { skip: process.platform !== 'win32' },
  async () => {
    const configFile = path.join(state, 'commands.json');
    const config = JSON.parse(await readFile(configFile, 'utf8'));
    config.projects['Example project'].tree = {
      executable: process.execPath,
      args: [
        '-e',
        'const {spawn}=require("node:child_process"); const c=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"}); console.log(c.pid); setInterval(()=>{},1000)',
      ],
      timeoutSeconds: 10,
    };
    await writeFile(configFile, JSON.stringify(config));
    await call('command_run', { project: 'Example project', command: 'tree', requestId: 'job-tree' });
    let childPid;
    for (let i = 0; i < 50; i++) {
      const output = await call('command_output', { jobId: 'job-tree' });
      if (/^\d+/.test(output.text)) {
        childPid = Number(output.text.trim());
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(childPid);
    await call('command_cancel', { jobId: 'job-tree' });
    assert.throws(
      () => process.kill(childPid, 0),
      (e) => e.code === 'ESRCH',
    );
  },
);

test('Git historical reads, comparison, blame and selected-file commit preserve unrelated staged changes', async () => {
  const head = git('rev-parse', 'HEAD');
  assert.equal(
    (await call('git_read_file', { project: 'Example project', path: 'tracked.txt', ref: head })).text,
    '1: baseline\n2: ',
  );
  assert.match(
    (await call('git_blame', { project: 'Example project', path: 'tracked.txt', lineCount: 1 })).output,
    /baseline/,
  );
  await writeFile(path.join(project, 'unrelated.txt'), 'user staged this\n');
  git('add', 'unrelated.txt');
  await writeFile(path.join(project, 'selected.txt'), 'commit only this\n');
  const args = {
    project: 'Example project',
    message: 'Add selected file',
    operationId: 'commit-selected',
    expectedHead: head,
    files: [{ path: 'selected.txt', sha256: hash('commit only this\n') }],
  };
  const result = await call('git_commit', args);
  assert.notEqual(result.commit, head);
  assert.equal(git('diff', '--cached', '--name-only'), 'unrelated.txt');
  assert.equal(git('show', 'HEAD:unrelated.txt'), 'original');
  assert.equal(git('show', 'HEAD:selected.txt'), 'commit only this');
  assert.equal((await call('git_commit', args)).replayed, true);
  assert.match(
    (await call('git_compare', { project: 'Example project', base: head, head: result.commit })).output,
    /commit only this/,
  );
  await call('git_commit', { ...args, operationId: 'stale-head' }, 'CONFLICT');
});

test('durable journals survive server restart and diagnostics remain usable', async () => {
  await client.close();
  await connect();
  assert.equal((await call('change_status', { operationId: 'edit-apply' })).state, 'applied');
  assert.equal((await call('command_status', { jobId: 'job-pass' })).status, 'passed');
  assert.ok((await call('change_list')).changes.length);
  assert.equal((await call('diagnostics')).version, '0.6.0');
});
