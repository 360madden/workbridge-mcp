import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, symlink, lstat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createTwoFilesPatch } from 'diff';
import { Workspace } from '../dist/workspace.js';
import { Changes, digest } from '../dist/changes.js';
import { Patches } from '../dist/patches.js';
import { historyJson, historyPage, historyLimits } from '../dist/history.js';
import { limits } from '../dist/core.js';
let suite;
before(async () => {
  suite = await mkdtemp(path.join(os.tmpdir(), 'wb-history-'));
});
after(async () => {
  assert.ok(suite.startsWith(path.resolve(os.tmpdir()) + path.sep));
  await rm(suite, { recursive: true, force: true });
});
async function fixture(name) {
  const base = path.join(suite, name),
    root = path.join(base, 'Root'),
    extra = path.join(base, 'Extra'),
    state = path.join(root, 'State');
  await mkdir(root, { recursive: true });
  await mkdir(extra);
  await mkdir(state);
  const workspace = await Workspace.create(root, [extra]);
  workspace.protect(state);
  const changes = new Changes(workspace, path.join(state, 'changes'));
  const patches = new Patches(workspace, path.join(state, 'patches'), changes.serial);
  for (const p of ['Project ü', 'Project ü-copy', 'Project ü/nested'])
    await mkdir(path.join(root, p), { recursive: true });
  return { base, root, extra, state, workspace, changes, patches };
}
const ids = (result) => result.map((r) => r.operationId);
const code = (expected) => (error) => error.code === expected;
async function write(f, id, file, text = 'value\n') {
  return f.changes.write(id, file, text, null);
}
function patch(file, before, after) {
  const label = file.replaceAll('\\', '/');
  return {
    path: file,
    expectedHash: before === null ? null : digest(before),
    patch: createTwoFilesPatch(
      before === null ? '/dev/null' : 'a/' + label,
      after === null ? '/dev/null' : 'b/' + label,
      before ?? '',
      after ?? '',
    ),
  };
}

test('empty history is read-only and creates no journal directory', async () => {
  const f = await fixture('empty');
  for (const engine of [f.changes, f.patches]) {
    const result = await engine.list();
    assert.equal(result.complete, true);
    assert.equal(result.scanned, 0);
    assert.equal(result.nextOffset, null);
    assert.deepEqual(result.issues, []);
  }
  assert.deepEqual(await readdir(f.state), []);
});
test('single-file filters respect project segments, exact paths, recorded state and ID ordering', async () => {
  const f = await fixture('filters');
  await write(f, 'z-first', 'Project ü/one');
  await write(f, 'b-second', 'Project ü/nested/two');
  await write(f, 'a-sibling', 'Project ü-copy/one');
  await f.changes.undo('b-second');
  assert.deepEqual(ids((await f.changes.list()).changes), ['a-sibling', 'b-second', 'z-first']);
  assert.deepEqual(ids((await f.changes.list(0, 20, { project: 'Project ü' })).changes), [
    'b-second',
    'z-first',
  ]);
  assert.deepEqual(
    ids(
      (await f.changes.list(0, 20, { project: 'Project ü', path: 'Project ü/nested/two', state: 'undone' }))
        .changes,
    ),
    ['b-second'],
  );
  assert.deepEqual(
    (await f.changes.list(0, 20, { project: 'Project ü', path: 'Project ü-copy/one' })).changes,
    [],
  );
  const file = process.platform === 'win32' ? 'project Ü/ONE' : 'Project ü/one';
  assert.equal((await f.changes.list(0, 20, { path: file })).changes[0].operationId, 'z-first');
});
test('move discovery matches source and destination but combined project/path must match one path', async () => {
  const f = await fixture('moves');
  await writeFile(path.join(f.root, 'Project ü/source'), 'move me');
  await f.changes.move('move', 'Project ü/source', 'Project ü-copy/destination', digest('move me'));
  for (const file of ['Project ü/source', 'Project ü-copy/destination'])
    assert.deepEqual(ids((await f.changes.list(0, 20, { path: file })).changes), ['move']);
  assert.deepEqual(ids((await f.changes.list(0, 20, { project: 'Project ü-copy' })).changes), ['move']);
  assert.equal(
    (await f.changes.list(0, 20, { project: 'Project ü', path: 'Project ü-copy/destination' })).changes
      .length,
    0,
  );
  await f.changes.undo('move');
  assert.equal(await readFile(path.join(f.root, 'Project ü/source'), 'utf8'), 'move me');
});
test('deleted files and absent ancestor directories remain discoverable without recreation', async () => {
  const f = await fixture('deleted');
  await write(f, 'old', 'Project ü/nested/file');
  await f.changes.delete('delete', 'Project ü/nested/file', digest('value\n'));
  await rm(path.join(f.root, 'Project ü/nested'), { recursive: true });
  const result = await f.changes.list(0, 20, { project: 'Project ü/nested', path: 'Project ü/nested/file' });
  assert.deepEqual(ids(result.changes), ['delete', 'old']);
  assert.equal(result.complete, true);
  await assert.rejects(lstat(path.join(f.root, 'Project ü/nested')), code('ENOENT'));
});
test('additional-root identities remain absolute and revoked roots do not leak metadata', async () => {
  const f = await fixture('additional'),
    target = path.join(f.extra, 'file');
  await write(f, 'external', target);
  const r = await f.changes.list(0, 20, { project: f.extra, path: target });
  assert.equal(r.changes.length, 1);
  assert.equal(r.changes[0].path, target.split(path.sep).join('/'));
  const restricted = await Workspace.create(f.root);
  restricted.protect(f.state);
  const changes = new Changes(restricted, path.join(f.state, 'changes'));
  const denied = await changes.list();
  assert.deepEqual(denied.changes, []);
  assert.equal(denied.issues[0].code, 'OUTSIDE_ROOT');
  assert.equal(denied.complete, false);
  assert.equal(JSON.stringify(denied).includes(f.extra.split(path.sep).join('/')), false);
  await assert.rejects(changes.list(0, 20, { path: target }), code('OUTSIDE_ROOT'));
});
test('history filters retain protected, reserved-name, Git-internal and junction boundaries', async () => {
  const f = await fixture('boundaries');
  for (const [p, c] of [
    ['../escape', 'OUTSIDE_ROOT'],
    ['State/nope', 'PROTECTED_PATH'],
    ['missing/con/file', 'INVALID_PATH'],
    ['missing/.git/file', 'GIT_INTERNAL'],
    ['missing/file:stream', 'INVALID_PATH'],
  ])
    await assert.rejects(f.changes.list(0, 20, { path: p }), code(c));
  await writeFile(path.join(f.root, 'plain-file'), 'x');
  await assert.rejects(f.changes.list(0, 20, { project: 'plain-file' }), code('NOT_DIRECTORY'));
  await symlink(f.extra, path.join(f.root, 'junction'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(f.patches.list(0, 20, { project: 'junction/deleted' }), code('LINK_NOT_ALLOWED'));
});
test('sparse matches page by inspected IDs and empty pages can continue', async () => {
  const f = await fixture('sparse');
  for (let i = 0; i < 5; i++) await write(f, 'id-' + i, (i === 4 ? 'Project ü' : 'Project ü-copy') + '/' + i);
  const first = await f.changes.list(0, 2, { project: 'Project ü', scanLimit: 2 });
  assert.deepEqual(first.changes, []);
  assert.equal(first.nextOffset, 2);
  assert.equal(first.scanned, 2);
  assert.equal(first.scanLimitReached, true);
  assert.equal(first.complete, false);
  const second = await f.changes.list(first.nextOffset, 2, { project: 'Project ü', scanLimit: 2 });
  assert.equal(second.nextOffset, 4);
  const last = await f.changes.list(second.nextOffset, 2, { project: 'Project ü', scanLimit: 2 });
  assert.deepEqual(ids(last.changes), ['id-4']);
  assert.equal(last.nextOffset, null);
  assert.equal(last.complete, true);
});
test('corrupt metadata is a bounded partial error and does not hide later good records', async () => {
  const f = await fixture('corrupt');
  await write(f, 'a', 'Project ü/a');
  await write(f, 'b', 'Project ü/b');
  await writeFile(path.join(f.state, 'changes/a.json'), '{');
  const first = await f.changes.list(0, 1);
  assert.equal(first.issues[0].operationId, 'a');
  assert.equal(first.hasErrors, true);
  assert.equal(first.complete, false);
  assert.equal(first.nextOffset, 1);
  const next = await f.changes.list(first.nextOffset, 1);
  assert.deepEqual(ids(next.changes), ['b']);
  assert.equal(next.complete, true);
  await writeFile(path.join(f.state, 'changes/a.json'), JSON.stringify({ id: 'wrong' }));
  assert.equal((await f.changes.list(0, 1)).issues[0].code, 'CORRUPT_CHANGE');
});
test('oversized and symbolic-link journal files are reported without following their contents', async () => {
  const f = await fixture('bounded');
  await mkdir(path.join(f.state, 'changes'));
  await writeFile(path.join(f.state, 'changes/large.json'), ' '.repeat(historyLimits.metadataBytes + 1));
  assert.equal((await f.changes.list()).issues[0].code, 'HISTORY_METADATA_LIMIT');
  await mkdir(path.join(f.state, 'patches'));
  await symlink(
    f.extra,
    path.join(f.state, 'patches/linked'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const result = await f.patches.list();
  assert.equal(result.issues[0].code, 'CORRUPT_PATCH');
  assert.equal(result.complete, false);
});
test('patch filters match any file, respect intersections and retain corrupt-record paging', async () => {
  const f = await fixture('patches');
  const a = 'Project ü/a',
    b = 'Project ü-copy/b';
  await f.patches.apply('a-set', [patch(a, null, 'a\n'), patch(b, null, 'b\n')]);
  for (const p of [a, b])
    assert.equal((await f.patches.list(0, 20, { path: p, state: 'applied' })).patches[0].fileCount, 2);
  assert.equal((await f.patches.list(0, 20, { project: 'Project ü', path: b })).patches.length, 0);
  await f.patches.undo('a-set');
  assert.equal((await f.patches.list(0, 20, { state: 'undone' })).patches.length, 1);
  await f.patches.apply('b-set', [patch(a, null, 'again\n')]);
  await writeFile(path.join(f.state, 'patches/a-set/record.json'), 'broken');
  const first = await f.patches.list(0, 1, { state: 'applied' });
  assert.equal(first.issues[0].code, 'CORRUPT_PATCH');
  assert.equal(first.nextOffset, 1);
  assert.equal((await f.patches.list(first.nextOffset, 1)).patches[0].operationId, 'b-set');
});
test('discovery reports recorded state without reading snapshots or current file bytes', async () => {
  const f = await fixture('metadata-only');
  await write(f, 'change', 'Project ü/a');
  await f.patches.apply('patch', [patch('Project ü/b', null, 'b\n')]);
  await writeFile(path.join(f.root, 'Project ü/a'), 'independent later edit');
  await writeFile(path.join(f.root, 'Project ü/b'), 'independent later edit');
  await rm(path.join(f.state, 'patches/patch/0.after'));
  await writeFile(path.join(f.state, 'patches/patch/diff.txt'), 'broken');
  assert.equal((await f.changes.list()).changes[0].state, 'applied');
  const result = await f.patches.list();
  assert.equal(result.patches[0].state, 'applied');
  assert.equal(result.complete, true);
  assert.match(result.stateFreshness, /recorded/);
  assert.equal(await readFile(path.join(f.root, 'Project ü/a'), 'utf8'), 'independent later edit');
});
test('catalog entry and elapsed limits disclose incompleteness, never an exhaustive empty match', async () => {
  const f = await fixture('caps');
  for (let i = 0; i < 4; i++) await write(f, 'id-' + i, 'Project ü/' + i);
  const oldEntries = limits.scanEntries,
    oldMs = limits.scanMs;
  try {
    limits.scanEntries = 2;
    let result = await f.changes.list(0, 20, { project: 'Project ü-copy' });
    assert.equal(result.catalogTruncated, true);
    assert.equal(result.complete, false);
    assert.equal(result.nextOffset, null);
    limits.scanEntries = oldEntries;
    limits.scanMs = 0;
    result = await f.changes.list();
    assert.equal(result.timeLimitReached, true);
    assert.equal(result.catalogTruncated, true);
    assert.equal(result.complete, false);
  } finally {
    limits.scanEntries = oldEntries;
    limits.scanMs = oldMs;
  }
});
test('output limits continue at the unreturned ID and oversized entries cannot stall forever', async () => {
  const f = await fixture('output');
  await mkdir(path.join(f.state, 'catalog'));
  for (const id of ['a', 'b', 'c']) await writeFile(path.join(f.state, 'catalog', id + '.json'), '{}');
  const opts = {
    directory: path.join(f.state, 'catalog'),
    directories: false,
    offset: 0,
    limit: 10,
    load: async (id) => ({ id, text: 'x'.repeat(24000) }),
  };
  const one = await historyPage(opts);
  assert.equal(one.items.length, 2);
  assert.equal(one.nextOffset, 2);
  assert.equal(one.outputLimitReached, true);
  assert.ok(JSON.stringify(one).length <= limits.outputChars);
  const two = await historyPage({ ...opts, offset: one.nextOffset });
  assert.equal(two.items[0].id, 'c');
  assert.equal(two.complete, true);
  const huge = await historyPage({ ...opts, load: async () => ({ text: 'x'.repeat(limits.outputChars) }) });
  assert.equal(huge.issues.length, 3);
  assert.equal(huge.issues[0].code, 'HISTORY_ENTRY_LIMIT');
  assert.equal(huge.nextOffset, null);
  assert.equal(huge.hasErrors, true);
});
test('history page arguments and bounded JSON reads fail explicitly', async () => {
  const f = await fixture('invalid');
  for (const args of [
    [-1, 1, {}],
    [0, 0, {}],
    [0, 1, { scanLimit: 0 }],
    [0, 1, { scanLimit: 1001 }],
  ])
    await assert.rejects(f.changes.list(...args), code('INVALID_HISTORY_PAGE'));
  const file = path.join(f.state, 'array.json');
  await writeFile(file, '[1,2]');
  assert.deepEqual(await historyJson(file), [1, 2]);
  await writeFile(file, '{bad');
  await assert.rejects(historyJson(file), code('HISTORY_METADATA'));
});
test('patch catalogs enforce additional-root access without exposing revoked file labels', async () => {
  const f = await fixture('patch-extra'),
    file = path.join(f.extra, 'external.txt');
  await f.patches.apply('external-set', [patch(file, null, 'outside primary but authorized\n')]);
  assert.equal(
    (await f.patches.list(0, 20, { project: f.extra, path: file })).patches[0].operationId,
    'external-set',
  );
  const restricted = await Workspace.create(f.root);
  restricted.protect(f.state);
  const engine = new Patches(restricted, path.join(f.state, 'patches'), f.changes.serial);
  const r = await engine.list();
  assert.equal(r.patches.length, 0);
  assert.equal(r.issues[0].code, 'OUTSIDE_ROOT');
  assert.equal(r.complete, false);
  assert.equal(JSON.stringify(r).includes('external.txt'), false);
});
test('metadata time budget stops between records with a usable continuation', async () => {
  const f = await fixture('time-records'),
    directory = path.join(f.state, 'catalog');
  await mkdir(directory);
  for (const id of ['a', 'b']) await writeFile(path.join(directory, id + '.json'), '{}');
  const originalNow = Date.now;
  let now = 1000;
  try {
    Date.now = () => now;
    const r = await historyPage({
      directory,
      directories: false,
      offset: 0,
      limit: 10,
      load: async (id) => {
        now += limits.scanMs + 1;
        return { id };
      },
    });
    assert.equal(r.items.length, 1);
    assert.equal(r.nextOffset, 1);
    assert.equal(r.timeLimitReached, true);
    assert.equal(r.complete, false);
  } finally {
    Date.now = originalNow;
  }
});
test('a journal disappearing during discovery is retained as a partial issue', async () => {
  const f = await fixture('disappear'),
    directory = path.join(f.state, 'catalog');
  await mkdir(directory);
  for (const id of ['a', 'b']) await writeFile(path.join(directory, id + '.json'), JSON.stringify({ id }));
  const r = await historyPage({
    directory,
    directories: false,
    offset: 0,
    limit: 10,
    load: async (id) => {
      if (id === 'a') await rm(path.join(directory, 'b.json'));
      return historyJson(path.join(directory, id + '.json'));
    },
  });
  assert.deepEqual(r.items, [{ id: 'a' }]);
  assert.equal(r.issues[0].operationId, 'b');
  assert.equal(r.issues[0].code, 'ENOENT');
  assert.equal(r.hasErrors, true);
  assert.equal(r.complete, false);
  assert.equal(r.nextOffset, null);
});
