import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inventory, parseArgs } from '../scripts/preview-storage-retention.mjs';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wb-inventory-'));
  const put = async (relative, value) => {
    const file = path.join(root, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, value);
  };
  return { root, put, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test('classifies no deletion eligibility and attributes nested release and backups once', async () => {
  const f = await fixture();
  try {
    await f.put('.local/update-operations/op-a/backup/source/data', '12345');
    await f.put('.local/update-operations/op-a/backup/runtime/data', '12');
    await f.put('.local/update-operations/op-a/candidate/file', '123');
    await f.put('.local/wb001-gui-src-abc/.local/releases/live/payload', '1234567');
    await f.put('.local/wb001-gui-src-abc/source', '1234');
    await f.put('temp/example/file', '123456');
    const result = await inventory({ installRoot: f.root, maxScanMs: 60000 });
    assert.equal(result.complete, true, JSON.stringify(result.diagnostics));
    assert.equal(result.totals.logicalFileBytes, 27);
    assert.equal(result.units.find((u) => u.subgroup === 'nested-releases').logicalFileBytes, 7);
    assert.equal(
      result.units.find((u) => u.category === 'staging' && u.subgroup === 'other').logicalFileBytes,
      4,
    );
    assert.equal(result.units.find((u) => u.subgroup === 'backup/source').logicalFileBytes, 5);
    assert.ok(result.units.every((u) => u.classification === 'unclassified'));
    assert.equal(await readFile(path.join(f.root, 'temp/example/file'), 'utf8'), '123456');
  } finally {
    await f.cleanup();
  }
});

test('shallow discovery preserves nested release when sizing budget is exhausted', async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 20; i++) await f.put(`.local/update-operations/op/backup/source/f${i}`, 'x');
    await f.put('.local/wb001-gui-src-one/.local/releases/live/file', 'abc');
    await f.put('temp/late/file', 'x');
    const result = await inventory({ installRoot: f.root, maxEntries: 8, maxScanMs: 60000 });
    assert.equal(result.complete, false);
    assert.ok(result.units.some((u) => u.subgroup === 'nested-releases'));
    assert.ok(result.units.some((u) => u.category === 'temp'));
    assert.ok(result.unscannedUnits > 0);
    assert.ok(result.units.filter((u) => !u.visited).every((u) => !u.complete));
    assert.ok(result.totals.entryVisits <= 8);
  } finally {
    await f.cleanup();
  }
});

test('skips directory junction without reading its contents', async (t) => {
  const f = await fixture();
  try {
    await f.put('outside/secret', 'this must not be counted');
    await f.put('temp/unit/visible', '123');
    try {
      await symlink(path.join(f.root, 'outside'), path.join(f.root, 'temp/unit/link'), 'junction');
    } catch (error) {
      if (error.code === 'EPERM') return t.skip('junction creation unavailable');
      throw error;
    }
    const result = await inventory({ installRoot: f.root, maxScanMs: 60000 });
    assert.equal(result.complete, false);
    assert.equal(result.totals.logicalFileBytes, 3);
    assert.ok(result.units.some((u) => u.skippedLinks === 1));
    assert.ok(
      result.diagnostics.some((d) => d.code === 'LINK_SKIPPED' || d.code === 'REPARSE_POINT_SKIPPED'),
    );
  } finally {
    await f.cleanup();
  }
});

test('depth and unit bounds report incomplete rather than eligibility', async () => {
  const f = await fixture();
  try {
    await f.put('temp/a/deep/file', '123');
    await f.put('temp/b/deep/file', '123');
    const result = await inventory({ installRoot: f.root, maxDepth: 1, maxUnits: 1, maxScanMs: 60000 });
    assert.equal(result.complete, false);
    assert.ok(result.units.length <= 1);
    assert.ok(result.diagnostics.some((d) => d.code === 'UNIT_LIMIT' || d.code === 'DEPTH_LIMIT'));
  } finally {
    await f.cleanup();
  }
});

test('arguments require an absolute root and enforce finite limits', () => {
  assert.throws(() => parseArgs([]));
  assert.throws(() => parseArgs(['--install-root', 'relative']));
  assert.throws(() => parseArgs(['--install-root', path.parse(process.cwd()).root, '--max-entries', '0']));
  assert.throws(() => parseArgs(['--install-root', path.parse(process.cwd()).root, '--apply']));
});

test('metadata provider errors are incomplete and always close the worker', async () => {
  const f = await fixture();
  let closed = false;
  try {
    const result = await inventory(
      { installRoot: f.root },
      {
        metadata: {
          check: async () => {
            throw Object.assign(new Error('provider failed'), { code: 'METADATA_PROVIDER_FAILED' });
          },
          close: () => {
            closed = true;
          },
        },
      },
    );
    assert.equal(result.complete, false);
    assert.equal(result.diagnostics[0].code, 'METADATA_PROVIDER_FAILED');
    assert.equal(closed, true);
  } finally {
    await f.cleanup();
  }
});

test('a slow final metadata call cannot produce a complete receipt after its deadline', async () => {
  const f = await fixture();
  let closed = false;
  try {
    const result = await inventory(
      { installRoot: f.root, maxScanMs: 1 },
      {
        metadata: {
          check: async () => new Promise((resolve) => setTimeout(resolve, 5)),
          close: () => {
            closed = true;
          },
        },
      },
    );
    assert.equal(result.complete, false);
    assert.ok(result.diagnostics.some((d) => d.code === 'TIME_LIMIT'));
    assert.equal(closed, true);
  } finally {
    await f.cleanup();
  }
});
