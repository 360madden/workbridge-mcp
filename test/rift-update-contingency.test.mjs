import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  captureSnapshot,
  compareSnapshots,
  markdownReport,
  runCli,
  SCHEMA,
} from '../scripts/rift-update-contingency.mjs';

async function fixture(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rift-update-fixture-'));
  try {
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('captures game and addons; compares code hashes and asset metadata', async () => {
  await fixture(async (root) => {
    const game = path.join(root, 'Live');
    const addons = path.join(root, 'AddOns');
    await mkdir(game);
    await mkdir(addons);
    await writeFile(path.join(game, 'rift_x64.exe'), 'old binary');
    await writeFile(path.join(game, 'world.dat'), 'unchanged asset');
    await writeFile(path.join(game, 'removed.bin'), 'to remove');
    await writeFile(path.join(addons, 'Test.toc'), 'Version: 1');
    await writeFile(path.join(addons, 'texture.png'), 'not addon code');
    await mkdir(path.join(addons, 'Old.disabled'));
    await writeFile(path.join(addons, 'Old.disabled', 'Old.toc'), 'inactive');
    const roots = [
      { scope: 'game', path: game },
      { scope: 'addons', path: addons },
    ];
    const before = await captureSnapshot('before', roots);
    assert.equal(before.schema, SCHEMA);
    assert.equal(before.complete, true);
    assert.equal(before.files.length, 4);
    assert.equal(before.hashedFiles, 2);
    assert.equal(before.skippedDirectories, 1);
    assert.equal(before.skippedNonCode, 1);
    await writeFile(path.join(game, 'rift_x64.exe'), 'new binary');
    await writeFile(path.join(game, 'new.pak'), 'new');
    await rm(path.join(game, 'removed.bin'));
    const after = await captureSnapshot('after', roots);
    const report = compareSnapshots(before, after);
    assert.deepEqual(report.counts, { added: 1, removed: 1, modified: 1, unchanged: 2 });
    assert.equal(report.changes.find((c) => c.path === 'rift_x64.exe').evidence, 'SHA-256');
    assert.match(markdownReport(report), /RIFT patch-change report/);
    assert.match(markdownReport(report), /rift_x64.exe/);
  });
});

test('comparison refuses machine, roots and incomplete snapshot mismatch', async () => {
  await fixture(async (root) => {
    await writeFile(path.join(root, 'rift_x64.exe'), 'game');
    const roots = [{ scope: 'game', path: root }];
    const before = await captureSnapshot('before', roots);
    const after = await captureSnapshot('after', roots);
    assert.equal(compareSnapshots(before, after).counts.unchanged, 1);
    assert.throws(
      () => compareSnapshots(before, { ...after, hostname: 'ANOTHER-PC' }),
      /Machine identity mismatch/,
    );
    assert.throws(() => compareSnapshots(before, { ...after, complete: false }), /Invalid or incomplete/);
    assert.throws(() => compareSnapshots(before, { ...after, roots: [] }), /Root paths or scope/);
  });
});

test('before/after CLI creates unique files and automatically writes a comparison', async () => {
  await fixture(async (root) => {
    const game = path.join(root, 'Live');
    const reports = path.join(root, 'reports');
    await mkdir(game);
    await writeFile(path.join(game, 'rift_x64.exe'), 'version 1');
    const first = await runCli(['before', '--game-dir', game, '--no-addons'], reports);
    assert.equal(first.status, 'captured');
    assert.equal(first.files, 1);
    await writeFile(path.join(game, 'rift_x64.exe'), 'version 2');
    const second = await runCli(['after', '--game-dir', game, '--no-addons'], reports);
    assert.equal(second.status, 'captured');
    assert.equal(second.counts.modified, 1);
    assert.match(await readFile(second.markdown, 'utf8'), /rift_x64.exe/);
    assert.equal((await readdir(reports)).filter((name) => name.endsWith('.json')).length, 3);
  });
});

test('inventory skips symbolic links instead of following outside directories', async () => {
  await fixture(async (root) => {
    const game = path.join(root, 'Live');
    await mkdir(game);
    await writeFile(path.join(game, 'rift_x64.exe'), 'safe');
    try {
      await symlink(root, path.join(game, 'outside-link'), 'dir');
    } catch (error) {
      if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) return;
      throw error;
    }
    const snapshot = await captureSnapshot('before', [{ scope: 'game', path: game }]);
    assert.equal(snapshot.files.length, 1);
    assert.equal(snapshot.skippedLinks, 1);
    assert.equal(snapshot.complete, true);
  });
});
