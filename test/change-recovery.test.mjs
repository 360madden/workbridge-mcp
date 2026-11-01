import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, symlink, truncate } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Workspace } from '../dist/workspace.js';
import { Changes, digest } from '../dist/changes.js';
import { historyLimits } from '../dist/history.js';
import { limits } from '../dist/core.js';
let suite,
  sequence = 0;
before(async () => {
  suite = await mkdtemp(path.join(os.tmpdir(), 'wb-change-recovery-'));
});
after(async () => {
  assert.ok(suite.startsWith(path.resolve(os.tmpdir()) + path.sep));
  await rm(suite, { recursive: true, force: true });
});
async function fixture() {
  const root = path.join(suite, String(sequence++));
  await mkdir(root);
  const state = path.join(root, 'state'),
    workspace = await Workspace.create(root);
  const changes = new Changes(workspace, state);
  const original = Buffer.from('untouched original\r\n'),
    current = Buffer.from('applied version\r\n');
  await writeFile(path.join(root, 'file.txt'), original);
  await changes.write('known-id', 'file.txt', current.toString(), digest(original));
  return { root, state, changes, original, current, journal: path.join(state, 'known-id.json') };
}
const mutations = [
  [
    'mismatched ID',
    (r) => {
      r.id = 'different-id';
    },
  ],
  [
    'missing request identity',
    (r) => {
      delete r.request;
    },
  ],
  [
    'invalid request identity',
    (r) => {
      r.request = 'bad';
    },
  ],
  [
    'file marked as directory',
    (r) => {
      r.directory = true;
    },
  ],
  [
    'foreign backup name',
    (r) => {
      r.before = 'other.before';
    },
  ],
  [
    'missing backup reference',
    (r) => {
      r.before = null;
    },
  ],
  [
    'missing before hash',
    (r) => {
      r.beforeHash = null;
    },
  ],
  [
    'unexpected destination',
    (r) => {
      r.destination = 'other.txt';
    },
  ],
  [
    'invalid state',
    (r) => {
      r.state = 'completed';
    },
  ],
  [
    'invalid operation kind',
    (r) => {
      r.type = 'unknown';
    },
  ],
  [
    'missing write after hash',
    (r) => {
      r.afterHash = null;
    },
  ],
  [
    'unrecognized metadata field',
    (r) => {
      r.unrecognized = true;
    },
  ],
];
for (const [name, mutate] of mutations)
  test(`corrupt ${name} blocks status, undo and replay without rewriting evidence`, async () => {
    const f = await fixture(),
      record = JSON.parse(await readFile(f.journal, 'utf8'));
    mutate(record);
    await writeFile(f.journal, JSON.stringify(record));
    const saved = await readFile(f.journal),
      names = await readdir(f.state);
    const error = (e) => e.code === 'CORRUPT_CHANGE';
    await assert.rejects(f.changes.status('known-id'), error);
    await assert.rejects(f.changes.undo('known-id'), error);
    await assert.rejects(
      f.changes.write('known-id', 'file.txt', f.current.toString(), digest(f.original)),
      error,
    );
    const catalog = await f.changes.list();
    assert.equal(catalog.issues[0].code, 'CORRUPT_CHANGE');
    assert.deepEqual(catalog.changes, []);
    assert.equal(catalog.complete, false);
    assert.deepEqual(await readFile(path.join(f.root, 'file.txt')), f.current);
    assert.deepEqual(await readFile(f.journal), saved);
    assert.deepEqual(await readdir(f.state), names);
  });

test('known-ID metadata reads share catalog byte and JSON limits', async () => {
  const f = await fixture();
  for (const [contents, code] of [
    ['{broken', 'HISTORY_METADATA'],
    [' '.repeat(historyLimits.metadataBytes + 1), 'HISTORY_METADATA_LIMIT'],
  ]) {
    await writeFile(f.journal, contents);
    for (const action of [
      () => f.changes.status('known-id'),
      () => f.changes.undo('known-id'),
      () => f.changes.write('known-id', 'file.txt', 'replacement', null),
    ])
      await assert.rejects(action, (e) => e.code === code);
    assert.equal((await f.changes.list()).issues[0].code, code);
    assert.equal(await readFile(f.journal, 'utf8'), contents);
    assert.deepEqual(await readFile(path.join(f.root, 'file.txt')), f.current);
  }
});

test('known-ID recovery refuses a linked catalog without reading or modifying its records', async () => {
  const f = await fixture(),
    link = path.join(f.root, 'linked-state');
  await symlink(f.state, link, process.platform === 'win32' ? 'junction' : 'dir');
  const engine = new Changes(await Workspace.create(f.root), link),
    saved = await readFile(f.journal);
  for (const action of [
    () => engine.status('known-id'),
    () => engine.undo('known-id'),
    () => engine.write('known-id', 'file.txt', 'replacement', null),
  ])
    await assert.rejects(action, (e) => e.code === 'HISTORY_METADATA');
  assert.deepEqual(await readFile(f.journal), saved);
  assert.deepEqual(await readFile(path.join(f.root, 'file.txt')), f.current);
});

test('oversized or nonregular backups cannot overwrite good files or alter the journal', async () => {
  const f = await fixture(),
    backup = path.join(f.state, 'known-id.before'),
    saved = await readFile(f.journal);
  await truncate(backup, limits.editBytes + 1);
  await assert.rejects(f.changes.undo('known-id'), (e) => e.code === 'CORRUPT_BACKUP');
  await rm(backup);
  await mkdir(backup);
  await assert.rejects(f.changes.undo('known-id'), (e) => e.code === 'CORRUPT_BACKUP');
  assert.deepEqual(await readFile(f.journal), saved);
  assert.deepEqual(await readFile(path.join(f.root, 'file.txt')), f.current);
});

test('valid persisted create, write, move, delete and directory operations remain recoverable', async () => {
  const f = await fixture();
  await f.changes.undo('known-id');
  assert.deepEqual(await readFile(path.join(f.root, 'file.txt')), f.original);
  assert.equal((await f.changes.undo('known-id')).replayed, true);
  await f.changes.write('create', 'created.txt', 'created', null);
  await f.changes.move('move', 'created.txt', 'moved.txt', digest('created'));
  await f.changes.delete('delete', 'moved.txt', digest('created'));
  await f.changes.createDirectory('mkdir', 'folder');
  await f.changes.delete('rmdir', 'folder', null);
  const restored = new Changes(await Workspace.create(f.root), f.state);
  assert.equal((await restored.list()).hasErrors, false);
  for (const id of ['create', 'move', 'delete', 'mkdir', 'rmdir'])
    assert.equal((await restored.status(id)).operationId, id);
  for (const id of ['rmdir', 'mkdir', 'delete', 'move', 'create'])
    assert.equal((await restored.undo(id)).state, 'undone');
  assert.equal(
    (await restored.list()).changes.every((c) => c.state === 'undone'),
    true,
  );
  assert.deepEqual(await readFile(path.join(f.root, 'file.txt')), f.original);
  assert.deepEqual((await readdir(f.root)).sort(), ['file.txt', 'state']);
});
