import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  rename,
  symlink,
  readdir,
  truncate,
} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createTwoFilesPatch } from 'diff';
import { Workspace } from '../dist/workspace.js';
import { Serial, digest } from '../dist/changes.js';
import { Patches } from '../dist/patches.js';
import { limits } from '../dist/core.js';
let suite,
  sequence = 0;
before(async () => {
  suite = await mkdtemp(path.join(os.tmpdir(), 'wb-patch-recovery-'));
});
after(async () => {
  assert.ok(suite.startsWith(path.resolve(os.tmpdir()) + path.sep));
  await rm(suite, { recursive: true, force: true });
});
async function fixture() {
  const root = path.join(suite, String(sequence++));
  await mkdir(root);
  const state = path.join(root, 'state');
  await mkdir(state);
  const workspace = await Workspace.create(root);
  workspace.protect(state);
  const directory = path.join(state, 'patches');
  const patches = new Patches(workspace, directory, new Serial());
  const before = 'original value\r\n',
    after = 'applied value\r\n';
  const target = path.join(root, 'target.txt');
  await writeFile(target, before);
  const files = [
    {
      path: 'target.txt',
      expectedHash: digest(before),
      patch: createTwoFilesPatch('a/target.txt', 'b/target.txt', before, after),
    },
  ];
  await patches.apply('operation', files);
  return {
    root,
    state,
    workspace,
    directory,
    patches,
    before,
    after,
    target,
    files,
    record: path.join(directory, 'operation/record.json'),
  };
}
async function refused(f) {
  const saved = await readFile(f.record),
    current = await readFile(f.target);
  for (const operation of [
    () => f.patches.status('operation'),
    () => f.patches.diff('operation'),
    () => f.patches.resume('operation'),
    () => f.patches.undo('operation'),
    () => f.patches.apply('operation', f.files),
  ])
    await assert.rejects(operation(), (error) => error.code === 'CORRUPT_PATCH');
  assert.deepEqual(await readFile(f.record), saved);
  assert.deepEqual(await readFile(f.target), current);
}
const corrupt = [
  [
    'undone with apply direction',
    (r) => {
      r.state = 'undone';
    },
  ],
  [
    'applied with undo direction',
    (r) => {
      r.direction = 'undo';
    },
  ],
  [
    'applied with pending file',
    (r) => {
      r.files[0].progress = 'pending';
    },
  ],
  [
    'applied with applying file',
    (r) => {
      r.files[0].progress = 'applying';
    },
  ],
  [
    'undone with unrestored file',
    (r) => {
      r.state = 'undone';
      r.direction = 'undo';
    },
  ],
  [
    'prepared with applied file',
    (r) => {
      r.state = 'prepared';
    },
  ],
  [
    'prepared with undo direction',
    (r) => {
      r.state = 'prepared';
      r.direction = 'undo';
      r.files[0].progress = 'pending';
    },
  ],
  [
    'applying with undo direction',
    (r) => {
      r.state = 'applying';
      r.direction = 'undo';
    },
  ],
  [
    'undoing with apply direction',
    (r) => {
      r.state = 'undoing';
    },
  ],
  [
    'forward blocked record with undoing file',
    (r) => {
      r.state = 'blocked';
      r.files[0].progress = 'undoing';
    },
  ],
  [
    'forward blocked record with undone file',
    (r) => {
      r.state = 'blocked';
      r.files[0].progress = 'undone';
    },
  ],
  [
    'invalid creation timestamp',
    (r) => {
      r.createdAt = 'yesterday';
    },
  ],
  [
    'invalid update timestamp',
    (r) => {
      r.updatedAt = 'not a timestamp';
    },
  ],
  [
    'out-of-range error file index',
    (r) => {
      r.state = 'blocked';
      r.error = { code: 'EACCES', fileIndex: r.files.length };
    },
  ],
  [
    'error on completed state',
    (r) => {
      r.error = { code: 'EACCES' };
    },
  ],
];
for (const [name, mutate] of corrupt) {
  test(`contradictory patch metadata: ${name} is refused without rewriting evidence`, async () => {
    const f = await fixture();
    const record = JSON.parse(await readFile(f.record, 'utf8'));
    mutate(record);
    await writeFile(f.record, JSON.stringify(record));
    await refused(f);
    const page = await f.patches.list();
    assert.equal(page.complete, false);
    assert.equal(page.issues[0].code, 'CORRUPT_PATCH');
    assert.equal(page.patches.length, 0);
  });
}

test('linked operation directory is rejected by known-ID access and discovery, preserving good rows', async () => {
  const f = await fixture();
  const good = [
    {
      path: 'good.txt',
      expectedHash: null,
      patch: createTwoFilesPatch('/dev/null', 'b/good.txt', '', 'good\n'),
    },
  ];
  await f.patches.apply('valid', good);
  const real = path.join(f.state, 'preserved-operation');
  await rename(path.join(f.directory, 'operation'), real);
  await symlink(real, path.join(f.directory, 'operation'), process.platform === 'win32' ? 'junction' : 'dir');
  await refused(f);
  const page = await f.patches.list();
  assert.equal(page.issues[0].operationId, 'operation');
  assert.equal(page.issues[0].code, 'CORRUPT_PATCH');
  assert.equal(page.patches[0].operationId, 'valid');
  assert.equal(page.hasErrors, true);
  assert.equal(page.complete, false);
  assert.equal((await f.patches.undo('valid')).state, 'undone');
});

test('linked catalog rejects known IDs and fresh publication without writing through the link', async () => {
  const f = await fixture();
  const real = path.join(f.state, 'preserved-catalog');
  await rename(f.directory, real);
  await symlink(real, f.directory, process.platform === 'win32' ? 'junction' : 'dir');
  const names = await readdir(real);
  await refused(f);
  await assert.rejects(f.patches.apply('new', f.files), (error) => error.code === 'CORRUPT_PATCH');
  await assert.rejects(f.patches.list(), (error) => error.code === 'HISTORY_METADATA');
  assert.deepEqual(await readdir(real), names);
});

test('nonregular metadata is refused consistently; valid restored record remains recoverable', async () => {
  const f = await fixture(),
    saved = await readFile(f.record);
  await rm(f.record);
  await mkdir(f.record);
  for (const call of [
    () => f.patches.status('operation'),
    () => f.patches.undo('operation'),
    () => f.patches.apply('operation', f.files),
  ])
    await assert.rejects(call(), (error) => error.code === 'CORRUPT_PATCH');
  assert.equal(await readFile(f.target, 'utf8'), f.after);
  await rm(f.record, { recursive: true });
  await writeFile(f.record, saved);
  assert.equal((await f.patches.undo('operation')).state, 'undone');
  assert.equal(await readFile(f.target, 'utf8'), f.before);
});

test('malformed and oversized metadata are refused by every known-ID path and listing', async () => {
  const f = await fixture();
  for (const text of ['{broken', ' '.repeat(256 * 1024 + 1)]) {
    await writeFile(f.record, text);
    await refused(f);
    assert.equal((await f.patches.list()).issues[0].code, 'CORRUPT_PATCH');
  }
});

test('valid in-progress and interrupted-undo states remain loadable and recoverable', async () => {
  for (const [state, direction, progress, actual] of [
    ['prepared', 'apply', 'pending', 'before'],
    ['applying', 'apply', 'applying', 'before'],
    ['applying', 'apply', 'applying', 'after'],
    ['applying', 'apply', 'applied', 'after'],
    ['blocked', 'apply', 'applying', 'after'],
    ['blocked', 'apply', 'applied', 'after'],
    ['undoing', 'undo', 'applied', 'after'],
    ['undoing', 'undo', 'undoing', 'after'],
    ['undoing', 'undo', 'undoing', 'before'],
    ['undoing', 'undo', 'undone', 'before'],
    ['blocked', 'undo', 'pending', 'before'],
    ['blocked', 'undo', 'applying', 'after'],
    ['blocked', 'undo', 'undone', 'before'],
  ]) {
    const f = await fixture(),
      record = JSON.parse(await readFile(f.record, 'utf8'));
    record.state = state;
    record.direction = direction;
    record.files[0].progress = progress;
    if (state === 'blocked') record.error = { code: 'EACCES' };
    await writeFile(f.record, JSON.stringify(record));
    await writeFile(f.target, f[actual]);
    assert.equal((await f.patches.status('operation')).state, state);
    assert.equal((await f.patches.list()).hasErrors, false);
    assert.equal((await f.patches.undo('operation')).state, 'undone');
    assert.equal(await readFile(f.target, 'utf8'), f.before);
  }
});

test('metadata-only discovery does not load snapshots, but recovery refuses oversized snapshots before writes', async () => {
  const f = await fixture();
  await truncate(path.join(f.directory, 'operation/0.before'), limits.editBytes + 1);
  assert.equal((await f.patches.list()).hasErrors, false);
  assert.equal((await f.patches.status('operation')).state, 'applied');
  await assert.rejects(
    f.patches.undo('operation'),
    (error) => error.code === 'PATCH_BLOCKED' && error.details.cause.code === 'CORRUPT_PATCH',
  );
  assert.equal(await readFile(f.target, 'utf8'), f.after);
});

test('an unknown ID remains unknown without reserving or creating a journal', async () => {
  const f = await fixture(),
    names = await readdir(f.directory);
  await assert.rejects(f.patches.status('missing'), (error) => error.code === 'UNKNOWN_PATCH');
  assert.deepEqual(await readdir(f.directory), names);
});
