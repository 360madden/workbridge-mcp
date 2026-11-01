import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createTwoFilesPatch } from 'diff';
import { Workspace } from '../dist/workspace.js';
import { Changes, Serial, digest } from '../dist/changes.js';
import { Patches, patchLimits } from '../dist/patches.js';

const execute = promisify(execFile);
const repo = path.resolve('.');
let directory;
before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'workbridge-patches-'));
});
after(async () => {
  await rm(directory, { recursive: true, force: true });
});
async function fixture(name) {
  const root = path.join(directory, name);
  await mkdir(root);
  const state = path.join(root, 'State');
  await mkdir(state);
  const workspace = await Workspace.create(root);
  workspace.protect(state);
  const serial = new Serial();
  const journal = path.join(state, 'patches');
  const patches = new Patches(workspace, journal, serial);
  return { root, state, workspace, journal, patches, serial };
}
function patch(file, before, after, bytes = before === null ? null : Buffer.from(before)) {
  return {
    path: file,
    expectedHash: bytes === null ? null : digest(bytes),
    patch: createTwoFilesPatch(
      before === null ? '/dev/null' : `a/${file}`,
      after === null ? '/dev/null' : `b/${file}`,
      before ?? '',
      after ?? '',
      '',
      '',
      { context: 3 },
    ),
  };
}
async function pair(name) {
  const f = await fixture(name);
  await writeFile(path.join(f.root, 'a.txt'), 'old a\n');
  await writeFile(path.join(f.root, 'b.txt'), 'old b\n');
  f.files = [patch('a.txt', 'old a\n', 'new a\n'), patch('b.txt', 'old b\n', 'new b\n')];
  return f;
}
const read = (f, file) => readFile(path.join(f.root, file), 'utf8');
async function errorCode(promise, code) {
  let result;
  await assert.rejects(promise, (error) => {
    result = error;
    return error.code === code;
  });
  return result;
}
async function childOperation(f, action, fault, target = 'a.txt') {
  const helper = path.join(f.state, 'fault-fixture.mjs');
  await writeFile(path.join(f.state, 'request.json'), JSON.stringify(f.files));
  await writeFile(
    helper,
    `
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
const [root,state,action,fault,target]=process.argv.slice(2);
const actual=path.join(root,target);
for (const method of ['rename','link','unlink']) {
  const original=fs[method];
  fs[method]=async function(...args) {
    const destination=method==='unlink'?args[0]:args[1];
    if(destination===actual && fault==='io') throw Object.assign(new Error('fixture lock'),{code:'EACCES'});
    const result=await original(...args);
    if(destination===actual && fault==='crash') process.exit(73);
    if(destination===actual && fault==='external') await fs.writeFile(path.join(root,'b.txt'),'later independent edit\\n');
    if(destination===actual && fault==='earlier') await fs.writeFile(path.join(root,'a.txt'),'later independent edit\\n');
    return result;
  };
}
syncBuiltinESMExports();
const {Workspace}=await import(${JSON.stringify(pathToFileURL(path.join(repo, 'dist/workspace.js')).href)});
const {Serial}=await import(${JSON.stringify(pathToFileURL(path.join(repo, 'dist/changes.js')).href)});
const {Patches}=await import(${JSON.stringify(pathToFileURL(path.join(repo, 'dist/patches.js')).href)});
const workspace=await Workspace.create(root);workspace.protect(state);
const patches=new Patches(workspace,path.join(state,'patches'),new Serial());
try { const files=JSON.parse(await fs.readFile(path.join(state,'request.json'),'utf8'));
 const result=action==='apply'?await patches.apply('operation',files):await patches[action]('operation');
 console.log(JSON.stringify(result));
}catch(error){console.log(JSON.stringify({code:error.code,details:error.details}));process.exitCode=1;}
`,
  );
  try {
    const result = await execute(process.execPath, [helper, f.root, f.state, action, fault, target], {
      windowsHide: true,
    });
    return { code: 0, ...result };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

test('preview is read-only; apply saves a combined diff and guarded undo restores every byte', async () => {
  const f = await pair('preview-apply');
  const preview = await f.patches.preview(f.files);
  assert.equal(preview.applicable, true);
  assert.match(preview.diff, /a\/a\.txt/);
  assert.match(preview.diff, /b\/b\.txt/);
  assert.equal(await read(f, 'a.txt'), 'old a\n');
  await assert.rejects(readdir(f.journal), { code: 'ENOENT' });
  const applied = await f.patches.apply('operation', f.files);
  assert.equal(applied.state, 'applied');
  assert.equal(applied.files.length, 2);
  assert.equal(await read(f, 'a.txt'), 'new a\n');
  let combined = '',
    offset = 0;
  do {
    const page = await f.patches.diff('operation', offset, 17);
    combined += page.diff;
    offset = page.nextOffset;
  } while (offset !== null);
  assert.equal(combined, preview.diff);
  assert.equal((await f.patches.status('operation')).current[0].matches, 'after');
  assert.equal((await f.patches.list()).patches[0].fileCount, 2);
  assert.equal((await f.patches.undo('operation')).state, 'undone');
  assert.equal(await read(f, 'a.txt'), 'old a\n');
  assert.equal(await read(f, 'b.txt'), 'old b\n');
  assert.equal((await f.patches.undo('operation')).replayed, true);
});

test('preflight collects stale hashes and invalid hunks without touching any file or reserving the ID', async () => {
  const f = await pair('preflight');
  await writeFile(path.join(f.root, 'b.txt'), 'newer b\n');
  f.files[0].patch = f.files[0].patch.replace('-old a', '-wrong a');
  const error = await errorCode(f.patches.apply('operation', f.files), 'PATCH_PREFLIGHT');
  assert.deepEqual(
    error.details.issues.map((i) => i.code),
    ['PATCH_MISMATCH', 'CONFLICT'],
  );
  assert.equal(await read(f, 'a.txt'), 'old a\n');
  assert.equal(await read(f, 'b.txt'), 'newer b\n');
  assert.equal((await f.patches.list()).patches.length, 0);
  f.files = [patch('a.txt', 'old a\n', 'new a\n'), patch('b.txt', 'newer b\n', 'new b\n')];
  assert.equal((await f.patches.apply('operation', f.files)).state, 'applied');
});

test('creation, deletion and empty-file creation share reversible snapshots', async () => {
  const f = await fixture('create-delete');
  await writeFile(path.join(f.root, 'delete.txt'), 'delete me');
  const files = [
    patch('new ü.txt', null, 'created\n'),
    patch('delete.txt', 'delete me', null),
    patch('empty.txt', null, ''),
  ];
  await f.patches.apply('operation', files);
  assert.equal(await read(f, 'new ü.txt'), 'created\n');
  assert.equal(await read(f, 'empty.txt'), '');
  await assert.rejects(read(f, 'delete.txt'), { code: 'ENOENT' });
  await f.patches.undo('operation');
  assert.equal(await read(f, 'delete.txt'), 'delete me');
  await assert.rejects(read(f, 'new ü.txt'), { code: 'ENOENT' });
  await assert.rejects(read(f, 'empty.txt'), { code: 'ENOENT' });
});

test('UTF-8 BOM, UTF-16 endianness, CRLF and missing final newline survive apply and undo', async () => {
  const f = await fixture('encodings');
  const variants = [
    Buffer.from('héllo\r\nlast'),
    Buffer.concat([Buffer.from([239, 187, 191]), Buffer.from('héllo\r\nlast')]),
    Buffer.concat([Buffer.from([255, 254]), Buffer.from('héllo\r\nlast', 'utf16le')]),
    Buffer.concat([Buffer.from([254, 255]), Buffer.from('héllo\r\nlast', 'utf16le').swap16()]),
  ];
  const files = [];
  for (const [i, bytes] of variants.entries()) {
    await writeFile(path.join(f.root, `${i}.txt`), bytes);
    files.push(patch(`${i}.txt`, 'héllo\nlast', 'héllo\nchanged', bytes));
  }
  await f.patches.apply('operation', files);
  for (const [i, bytes] of variants.entries()) {
    const actual = await readFile(path.join(f.root, `${i}.txt`));
    const expected =
      i < 2
        ? Buffer.concat([bytes.subarray(0, i === 1 ? 3 : 0), Buffer.from('héllo\r\nchanged')])
        : Buffer.concat([
            bytes.subarray(0, 2),
            i === 2
              ? Buffer.from('héllo\r\nchanged', 'utf16le')
              : Buffer.from('héllo\r\nchanged', 'utf16le').swap16(),
          ]);
    assert.deepEqual(actual, expected);
  }
  await f.patches.undo('operation');
  for (const [i, bytes] of variants.entries())
    assert.deepEqual(await readFile(path.join(f.root, `${i}.txt`)), bytes);
});

test('duplicate canonical paths, header mismatches and unsupported patch types are refused', async () => {
  const f = await pair('invalid');
  const duplicate = { ...f.files[0], path: './a.txt' };
  assert.equal(
    (await errorCode(f.patches.preview([f.files[0], duplicate]), 'PATCH_PREFLIGHT')).details.issues[0].code,
    'DUPLICATE_PATH',
  );
  for (const invalid of [
    f.files[0].patch.replaceAll('a.txt', 'other.txt'),
    'diff --git a/a.txt b/a.txt\nold mode 100644\nnew mode 100755\n',
    'diff --git a/a.txt b/a.txt\nBinary files a/a.txt and b/a.txt differ\n',
    f.files[0].patch + f.files[1].patch,
    '--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,1 @@\n-old a\n+new a\n',
  ])
    await errorCode(f.patches.preview([{ ...f.files[0], patch: invalid }]), 'PATCH_PREFLIGHT');
  assert.equal(await read(f, 'a.txt'), 'old a\n');
});

test('protected state, root escapes, directories and junctions cannot be patched', async () => {
  const f = await pair('paths');
  await mkdir(path.join(f.root, 'folder'));
  await writeFile(path.join(f.state, 'private.txt'), 'secret\n');
  for (const name of [
    '../outside.txt',
    'State/private.txt',
    'folder',
    '.',
    'file.txt:stream',
    '.git/config',
  ]) {
    await errorCode(f.patches.preview([patch(name, null, 'test\n')]), 'PATCH_PREFLIGHT');
  }
  await symlink(f.state, path.join(f.root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  await errorCode(f.patches.preview([patch('link/private.txt', 'secret\n', 'bad\n')]), 'PATCH_PREFLIGHT');
  assert.equal(await readFile(path.join(f.state, 'private.txt'), 'utf8'), 'secret\n');
});

test('replay never reapplies bytes, conflicting reuse fails and concurrent writers share serialization', async () => {
  const f = await pair('replay');
  const [first, second] = await Promise.allSettled([
    f.patches.apply('first', f.files),
    f.patches.apply('second', f.files),
  ]);
  assert.equal(first.status, 'fulfilled');
  assert.equal(second.status, 'rejected');
  assert.equal((await f.patches.apply('first', f.files)).replayed, true);
  await errorCode(f.patches.apply('first', [f.files[0]]), 'ID_REUSE');
  await writeFile(path.join(f.root, 'a.txt'), 'later\n');
  assert.equal((await f.patches.apply('first', f.files)).replayed, true);
  assert.equal(await read(f, 'a.txt'), 'later\n');
  const changes = new Changes(f.workspace, path.join(f.state, 'changes'));
  const shared = new Patches(f.workspace, f.journal, changes.serial);
  const results = await Promise.allSettled([
    shared.apply('third', [patch('a.txt', 'later\n', 'patch\n')]),
    changes.write('single', 'a.txt', 'single\n', digest('later\n')),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
});

test('undo preflights every file and preserves later edits without a partial rollback', async () => {
  const f = await pair('undo-conflict');
  await f.patches.apply('operation', f.files);
  await writeFile(path.join(f.root, 'a.txt'), 'independent later edit\n');
  const error = await errorCode(f.patches.undo('operation'), 'PATCH_BLOCKED');
  assert.equal(error.details.cause.code, 'PATCH_CONFLICT');
  assert.equal(await read(f, 'b.txt'), 'new b\n');
  assert.equal(await read(f, 'a.txt'), 'independent later edit\n');
  assert.equal((await f.patches.status('operation')).current[0].matches, 'conflict');
});

test('I/O failure retains partial progress and undo rolls back only applied files', async () => {
  const f = await pair('io-failure');
  assert.equal((await childOperation(f, 'apply', 'io', 'b.txt')).code, 1);
  const status = await f.patches.status('operation');
  assert.equal(status.state, 'blocked');
  assert.deepEqual(
    status.current.map((c) => c.matches),
    ['after', 'before'],
  );
  await f.patches.undo('operation');
  assert.equal(await read(f, 'a.txt'), 'old a\n');
  assert.equal(await read(f, 'b.txt'), 'old b\n');
  await errorCode(f.patches.resume('operation'), 'PATCH_DIRECTION');
});

test('a crash between file replacement and journal completion resumes from durable hashes', async () => {
  const f = await pair('crash-update');
  assert.equal((await childOperation(f, 'apply', 'crash')).code, 73);
  const status = await f.patches.status('operation');
  assert.equal(status.state, 'applying');
  assert.equal(status.files[0].progress, 'applying');
  assert.deepEqual(
    status.current.map((c) => c.matches),
    ['after', 'before'],
  );
  await errorCode(f.patches.apply('operation', f.files), 'OPERATION_UNCERTAIN');
  assert.equal((await f.patches.resume('operation')).state, 'applied');
  assert.equal(await read(f, 'a.txt'), 'new a\n');
  assert.equal(await read(f, 'b.txt'), 'new b\n');
  assert.equal((await f.patches.resume('operation')).replayed, true);
});

test('a crash during reverse restoration can be undone again without reapplying the patch', async () => {
  const f = await pair('crash-undo');
  await f.patches.apply('operation', f.files);
  assert.equal((await childOperation(f, 'undo', 'crash', 'b.txt')).code, 73);
  assert.equal((await f.patches.status('operation')).direction, 'undo');
  await errorCode(f.patches.resume('operation'), 'PATCH_DIRECTION');
  assert.equal((await f.patches.undo('operation')).state, 'undone');
  assert.equal(await read(f, 'a.txt'), 'old a\n');
  assert.equal(await read(f, 'b.txt'), 'old b\n');
});

test('crashes after exclusive creation and deletion are recoverable', async () => {
  for (const action of ['create', 'delete']) {
    const f = await pair(`crash-${action}`);
    f.files[0] = action === 'create' ? patch('new.txt', null, 'new\n') : patch('a.txt', 'old a\n', null);
    assert.equal((await childOperation(f, 'apply', 'crash', f.files[0].path)).code, 73);
    await f.patches.resume('operation');
    await f.patches.undo('operation');
    assert.equal(await read(f, 'a.txt'), 'old a\n');
    if (action === 'create') await assert.rejects(read(f, 'new.txt'), { code: 'ENOENT' });
  }
});

test('later edits during application block continuation and are not overwritten by undo', async () => {
  const f = await pair('mid-edit');
  const result = await childOperation(f, 'apply', 'external');
  assert.equal(result.code, 1);
  assert.equal(await read(f, 'a.txt'), 'new a\n');
  assert.equal(await read(f, 'b.txt'), 'later independent edit\n');
  await errorCode(f.patches.resume('operation'), 'PATCH_BLOCKED');
  await errorCode(f.patches.undo('operation'), 'PATCH_BLOCKED');
  assert.equal(await read(f, 'a.txt'), 'new a\n');
  assert.equal(await read(f, 'b.txt'), 'later independent edit\n');
});

test('corrupt snapshots block all undo writes and corrupt journals remain discoverable as issues', async () => {
  const f = await pair('corrupt');
  await f.patches.apply('operation', f.files);
  await writeFile(path.join(f.journal, 'operation', '0.before'), 'corrupt');
  const error = await errorCode(f.patches.undo('operation'), 'PATCH_BLOCKED');
  assert.equal(error.details.cause.code, 'CORRUPT_PATCH');
  assert.equal(await read(f, 'a.txt'), 'new a\n');
  assert.equal(await read(f, 'b.txt'), 'new b\n');
  await writeFile(path.join(f.journal, 'operation', 'record.json'), '{}');
  await errorCode(f.patches.status('operation'), 'CORRUPT_PATCH');
  assert.equal((await f.patches.list()).issues[0].code, 'CORRUPT_PATCH');
});

test('saved diffs remain immutable after later edits and reject corrupt artifacts', async () => {
  const f = await pair('diff-integrity');
  await f.patches.apply('operation', f.files);
  const diff = await f.patches.diff('operation');
  await writeFile(path.join(f.root, 'a.txt'), 'later');
  assert.deepEqual(await f.patches.diff('operation'), diff);
  await writeFile(path.join(f.journal, 'operation', 'combined.diff'), 'corrupt');
  await errorCode(f.patches.diff('operation'), 'CORRUPT_PATCH');
});

test('mixed EOL, binary input, oversize files and aggregate snapshot budgets fail before writing', async () => {
  const f = await fixture('limits');
  for (const [name, bytes] of [
    ['mixed', Buffer.from('one\r\ntwo\n')],
    ['binary', Buffer.from([0, 1, 2])],
    ['large', Buffer.alloc(16 * 1024 * 1024 + 1, 97)],
  ]) {
    await writeFile(path.join(f.root, name), bytes);
    await errorCode(f.patches.preview([patch(name, 'one\ntwo\n', 'new\n', bytes)]), 'PATCH_PREFLIGHT');
  }
  const text = 'x'.repeat(8 * 1024 * 1024) + '\n';
  const files = [];
  for (const name of ['first', 'second']) {
    await writeFile(path.join(f.root, name), text);
    files.push({
      path: name,
      expectedHash: digest(text),
      patch: `--- a/${name}\n+++ b/${name}\n@@ -0,0 +1 @@\n+added\n`,
    });
  }
  const error = await errorCode(f.patches.preview(files), 'PATCH_PREFLIGHT');
  assert.equal(error.details.issues.at(-1).code, 'PATCH_LIMIT');
  await errorCode(
    f.patches.preview([patch('new', null, 'x'.repeat(patchLimits.inputBytes))]),
    'INVALID_PATCH',
  );
});

test('bounded combined diff explicitly reports incomplete generation and pages without omissions', async () => {
  const f = await fixture('diff-budget');
  const before = Array.from({ length: 6000 }, (_, i) => `old-${i}\n`).join('');
  const after = Array.from({ length: 6000 }, (_, i) => `new-${i}\n`).join('');
  await writeFile(path.join(f.root, 'large.txt'), before);
  await f.patches.apply('operation', [patch('large.txt', before, after)]);
  const diff = await f.patches.diff('operation');
  assert.equal(diff.diffComplete, false);
  assert.equal(diff.diffTruncated, true);
  assert.equal(diff.nextOffset, null);
  await f.patches.undo('operation');
  assert.equal(await read(f, 'large.txt'), before);
});

test('patching an additional root preserves unrelated Git staging and dirty source', async () => {
  const f = await pair('git-preservation');
  const other = path.join(directory, 'Additional ü root');
  await mkdir(other);
  await writeFile(path.join(other, 'value.txt'), 'dirty value\n');
  await execute('git', ['init', '-q', f.root]);
  await writeFile(path.join(f.root, 'unrelated.txt'), 'staged\n');
  await execute('git', ['-C', f.root, 'add', '--', 'unrelated.txt']);
  const originalIndex = await readFile(path.join(f.root, '.git/index'));
  const workspace = await Workspace.create(f.root, [other]);
  workspace.protect(f.state);
  const patches = new Patches(workspace, f.journal, f.serial);
  const absolute = path.join(other, 'value.txt').replaceAll('\\', '/');
  await patches.apply('operation', [...f.files, patch(absolute, 'dirty value\n', 'new value\n')]);
  await patches.undo('operation');
  assert.equal(await readFile(path.join(other, 'value.txt'), 'utf8'), 'dirty value\n');
  assert.deepEqual(await readFile(path.join(f.root, '.git/index')), originalIndex);
});

test('read-only status remains available while a writer owns the serialization queue', async () => {
  const f = await pair('observable');
  await f.patches.apply('operation', f.files);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const writer = f.serial.run(() => gate);
  let timer;
  try {
    const status = await Promise.race([
      f.patches.status('operation'),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('status waited for writer')), 1000);
      }),
    ]);
    assert.equal(status.state, 'applied');
  } finally {
    clearTimeout(timer);
    release();
    await writer;
  }
});

test('a crash immediately after plan publication leaves all files unchanged and supports resume', async () => {
  const f = await pair('crash-prepared');
  assert.equal(
    (await childOperation(f, 'apply', 'crash', path.join('State', 'patches', 'operation'))).code,
    73,
  );
  assert.equal((await f.patches.status('operation')).state, 'prepared');
  assert.equal(await read(f, 'a.txt'), 'old a\n');
  assert.equal(await read(f, 'b.txt'), 'old b\n');
  await f.patches.resume('operation');
  assert.equal(await read(f, 'a.txt'), 'new a\n');
});

test('pending files that independently acquire proposed bytes cannot be adopted or undone', async () => {
  const f = await pair('pending-conflict');
  await writeFile(path.join(f.root, 'c.txt'), 'old c\n');
  f.files.push(patch('c.txt', 'old c\n', 'new c\n'));
  assert.equal((await childOperation(f, 'apply', 'io', 'b.txt')).code, 1);
  await writeFile(path.join(f.root, 'c.txt'), 'new c\n');
  await errorCode(f.patches.resume('operation'), 'PATCH_BLOCKED');
  await errorCode(f.patches.undo('operation'), 'PATCH_BLOCKED');
  assert.equal(await read(f, 'a.txt'), 'new a\n');
  assert.equal(await read(f, 'c.txt'), 'new c\n');
});

test('a corrupt forward snapshot prevents resume before any remaining file is written', async () => {
  const f = await pair('corrupt-forward');
  assert.equal((await childOperation(f, 'apply', 'crash')).code, 73);
  await writeFile(path.join(f.journal, 'operation', '1.after'), 'bad');
  const error = await errorCode(f.patches.resume('operation'), 'PATCH_BLOCKED');
  assert.equal(error.details.cause.code, 'CORRUPT_PATCH');
  assert.equal(await read(f, 'b.txt'), 'old b\n');
});

test('patch discovery advances past corrupt records and ignores unpublished staging folders', async () => {
  const f = await pair('catalog');
  await f.patches.apply('aaa', f.files);
  await f.patches.undo('aaa');
  await f.patches.apply('bbb', f.files);
  await mkdir(path.join(f.journal, '.prepare-incomplete'));
  await writeFile(path.join(f.journal, 'aaa', 'record.json'), 'broken');
  const first = await f.patches.list(0, 1);
  assert.equal(first.issues[0].operationId, 'aaa');
  assert.equal(first.nextOffset, 1);
  const next = await f.patches.list(first.nextOffset, 1);
  assert.equal(next.patches[0].operationId, 'bbb');
  assert.equal(next.nextOffset, null);
});

test('saved patch paths cannot be redirected by opening the state under a different primary root', async () => {
  const f = await pair('root-identity');
  await f.patches.apply('operation', f.files);
  const other = await pair('root-other');
  const redirected = new Patches(other.workspace, f.journal, other.serial);
  await errorCode(redirected.undo('operation'), 'PATCH_WORKSPACE_MISMATCH');
  assert.equal(await read(other, 'a.txt'), 'old a\n');
});

test('final set verification catches a later edit to an already completed file', async () => {
  const f = await pair('final-check');
  assert.equal((await childOperation(f, 'apply', 'earlier', 'b.txt')).code, 1);
  assert.equal((await f.patches.status('operation')).state, 'blocked');
  assert.equal(await read(f, 'a.txt'), 'later independent edit\n');
  await errorCode(f.patches.undo('operation'), 'PATCH_BLOCKED');
  assert.equal(await read(f, 'b.txt'), 'new b\n');
});
