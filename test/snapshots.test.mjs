import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, open, rm, readdir, utimes } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { Workspace } from '../dist/workspace.js';
import { SnapshotCache } from '../dist/snapshot-cache.js';

let root, state, client;
const base = 0xfedcba9876540000n;
const hex = (n) => `0x${n.toString(16).toUpperCase()}`;
const hash = (b) => createHash('sha256').update(b).digest('hex');
async function connect() {
  client = new Client({ name: 'snapshots-test', version: '1' });
  const env = { ...process.env, WORKBRIDGE_ROOT: root, WORKBRIDGE_STATE_DIR: state };
  delete env.WORKBRIDGE_SNAPSHOT_CACHE_GIB;
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve('dist/server.js')],
      env,
      stderr: 'pipe',
    }),
  );
}
async function call(name, args, error) {
  const r = await client.callTool({ name, arguments: args });
  const data = JSON.parse(r.content[0].text);
  if (error) {
    assert.equal(r.isError, true, name);
    assert.equal(data.error.code, error);
  } else {
    assert.ok(!r.isError, JSON.stringify(data));
    assert.deepEqual(r.structuredContent, data);
  }
  return data;
}
async function prepared(file) {
  await call('snapshot_cache', { path: file, action: 'prepare' });
  for (let i = 0; i < 300; i++) {
    const s = await call('snapshot_cache', { path: file });
    if (s.status !== 'running') return s;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Preparation did not finish');
}
before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'workbridge-snapshot-'));
  state = path.join(root, 'state');
  await mkdir(state);
  await writeFile(path.join(state, 'settings.json'), JSON.stringify({ snapshotCacheGiB: 1 }));
  const bytes = Buffer.alloc(6 * 1024 * 1024, 0);
  bytes.writeBigUInt64LE(base + 0x128n, 0);
  bytes.writeFloatLE(100.25, 35);
  bytes.writeFloatLE(20, 39);
  bytes.writeFloatLE(200.5, 43);
  Buffer.from('deadbeef', 'hex').copy(bytes, 65534);
  Buffer.from('deadbeef', 'hex').copy(bytes, 1024 * 1024 - 1);
  await writeFile(path.join(root, 'dump.bin'), bytes);
  await writeFile(path.join(root, 'dump.bin.gz'), gzipSync(bytes));
  await writeFile(path.join(root, 'broken.gz'), gzipSync(bytes).subarray(0, 20));
  await writeFile(path.join(root, 'overlap.bin'), 'aaaaa');
  await writeFile(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      mode: 'riftreader-family-snapshot-sequence',
      poses: [
        {
          label: 'baseline',
          role: 'baseline',
          segments: [
            {
              id: 'seg-1',
              path: 'dump.bin.gz',
              compression: 'gzip',
              baseHex: hex(base),
              sizeBytes: bytes.length,
              sha256: hash(bytes),
            },
          ],
        },
        {
          label: 'passive',
          role: 'passive',
          segments: [{ path: 'dump.bin', baseAddressHex: hex(base), sizeBytes: bytes.length }],
        },
      ],
    }),
  );
  await connect();
});
after(async () => {
  await client?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

test('raw byte/address reads retain full 64-bit pointers and unaligned floats', async () => {
  const pointer = await call('snapshot_read', {
    path: 'dump.bin',
    length: 8,
    type: 'u64',
    baseAddress: hex(base),
  });
  assert.equal(pointer.address, hex(base));
  assert.equal(pointer.values[0], (base + 0x128n).toString());
  const coords = await call('snapshot_read', {
    path: 'dump.bin',
    baseAddress: hex(base),
    address: hex(base + 35n),
    length: 12,
    type: 'f32',
  });
  assert.equal(coords.offset, '35');
  assert.deepEqual(coords.values, [100.25, 20, 200.5]);
  const big = await call('snapshot_read', { path: 'dump.bin', length: 8, type: 'u64', endian: 'big' });
  assert.notEqual(big.values[0], pointer.values[0]);
  await call('snapshot_read', { path: 'dump.bin', offset: '18446744073709551615' }, 'INVALID_RANGE');
  await call('snapshot_read', { path: 'dump.bin', address: hex(base) }, 'INVALID_RANGE');
});

test('snapshot reads seek beyond 4 GiB without whole-file allocation', async (t) => {
  const handle = await open(path.join(root, 'large-sparse.bin'), 'w');
  const offset = 2 ** 32 + 123;
  try {
    if (process.platform === 'win32') {
      try {
        execFileSync('fsutil.exe', ['sparse', 'setflag', path.join(root, 'large-sparse.bin')], {
          windowsHide: true,
          stdio: 'pipe',
        });
      } catch {
        t.skip('Filesystem does not allow owned sparse fixtures; do not allocate 4 GiB for a test.');
        return;
      }
    }
    await handle.write(Buffer.from('large file'), 0, 10, offset);
  } finally {
    await handle.close();
  }
  const r = await call('snapshot_read', { path: 'large-sparse.bin', offset: String(offset), length: 32 });
  assert.equal(r.size, offset + 10);
  assert.equal(r.ascii, 'large file');
  assert.equal(r.nextOffset, null);
  const eof = await call('snapshot_read', { path: 'large-sparse.bin', offset: String(offset + 10) });
  assert.equal(eof.length, 0);
  assert.deepEqual(eof.values, []);
});

test('streamed gzip cache verifies SHA256, survives restart, and releases without changing source', async () => {
  const original = await readFile(path.join(root, 'dump.bin.gz'));
  await call('snapshot_read', { path: 'dump.bin.gz' }, 'SNAPSHOT_NOT_READY');
  const ready = await prepared('dump.bin.gz');
  assert.equal(ready.cacheBudgetBytes, 1024 ** 3);
  assert.equal(ready.status, 'ready');
  assert.equal(ready.bytes, 6 * 1024 * 1024);
  assert.equal(ready.sha256, hash(await readFile(path.join(root, 'dump.bin'))));
  await client.close();
  await connect();
  const r = await call('snapshot_read', { path: 'dump.bin.gz', offset: '35', length: 12, type: 'f32' });
  assert.deepEqual(r.values, [100.25, 20, 200.5]);
  assert.equal(r.sha256, ready.sha256);
  await call('snapshot_cache', { path: 'dump.bin.gz', action: 'release' });
  assert.equal((await call('snapshot_cache', { path: 'dump.bin.gz' })).status, 'unprepared');
  assert.deepEqual(await readFile(path.join(root, 'dump.bin.gz')), original);
});

test('exact byte searches cross chunk/budget boundaries, paginate overlaps and reject stale versions', async () => {
  const first = await call('snapshot_search', {
    path: 'dump.bin',
    pattern: 'DE AD BE EF',
    scanMiB: 1,
    limit: 1,
    baseAddress: hex(base),
  });
  assert.deepEqual(first.matches, [{ offset: '65534', address: hex(base + 65534n) }]);
  const second = await call('snapshot_search', {
    path: 'dump.bin',
    pattern: 'deadbeef',
    scanMiB: 1,
    offset: first.nextOffset,
    version: first.version,
  });
  assert.equal(second.matches[0].offset, String(1024 * 1024 - 1));
  const budget = await call('snapshot_search', { path: 'dump.bin', pattern: 'deadbeef', scanMiB: 1 });
  assert.equal(budget.matches.length, 2);
  assert.equal(budget.nextOffset, String(1024 * 1024));
  const rest = await call('snapshot_search', {
    path: 'dump.bin',
    pattern: 'deadbeef',
    offset: budget.nextOffset,
    version: budget.version,
  });
  assert.deepEqual(rest.matches, []);
  assert.equal(rest.complete, true);
  const overlap = await call('snapshot_search', { path: 'overlap.bin', pattern: '616161', limit: 1 });
  const follow = await call('snapshot_search', {
    path: 'overlap.bin',
    pattern: '616161',
    offset: overlap.nextOffset,
  });
  assert.deepEqual(
    follow.matches.map((x) => x.offset),
    ['1', '2'],
  );
  assert.equal(follow.complete, true);
  await call('snapshot_search', { path: 'dump.bin', pattern: 'deadbeef', version: 'old' }, 'FILE_CHANGED');
  await call('snapshot_search', { path: 'dump.bin', pattern: '??' }, 'INVALID_PATTERN');
});

test('manifest poses map addresses exactly, page segments, and report segment boundaries', async () => {
  const r = await call('snapshot_manifest', {
    path: 'manifest.json',
    pose: 0,
    address: hex(base + 35n),
    length: 12,
    limit: 1,
  });
  assert.equal(r.mapping.path, 'dump.bin.gz');
  assert.equal(r.mapping.offset, '35');
  assert.equal(r.mapping.baseAddress, hex(base));
  assert.equal(r.poses.length, 2);
  const edge = await call('snapshot_manifest', {
    path: 'manifest.json',
    pose: 1,
    address: hex(base + BigInt(6 * 1024 * 1024 - 2)),
    length: 12,
  });
  assert.equal(edge.mapping.length, 2);
  assert.match(edge.boundary, /segment boundary/);
  const page = await call('snapshot_manifest', { path: 'manifest.json', limit: 1 });
  assert.equal(page.totalSegments, 2);
  assert.equal(page.nextOffset, 1);
  await call('snapshot_manifest', { path: 'manifest.json', address: hex(base) }, 'AMBIGUOUS_POSE');
  await call('snapshot_manifest', { path: 'manifest.json', pose: 2 }, 'INVALID_POSE');
  assert.equal(
    (await call('snapshot_manifest', { path: 'manifest.json', pose: 0, address: '0' })).mapping,
    null,
  );
});

test('manifest and snapshot paths cannot escape workspace, links, or protected runtime state', async () => {
  await writeFile(
    path.join(root, 'escape.json'),
    JSON.stringify({
      poses: [{ label: 'bad', segments: [{ path: '../outside.bin', base: 0, sizeBytes: 12 }] }],
    }),
  );
  await call('snapshot_manifest', { path: 'escape.json' }, 'OUTSIDE_ROOT');
  await call('snapshot_read', { path: 'state/something' }, 'PROTECTED_PATH');
  await call('snapshot_cache', { path: '../outside.gz', action: 'prepare' }, 'OUTSIDE_ROOT');
  await writeFile(
    path.join(root, 'unsafe.json'),
    JSON.stringify({
      poses: [{ label: 'bad', segments: [{ path: 'dump.bin', base: Number(base), sizeBytes: 12 }] }],
    }),
  );
  await call('snapshot_manifest', { path: 'unsafe.json' }, 'INVALID_INTEGER');
});

test('corrupt/truncated gzip fails clearly and never produces ready cache', async () => {
  const r = await prepared('broken.gz');
  assert.equal(r.status, 'failed');
  assert.match(r.error, /corrupt/);
  await call('snapshot_read', { path: 'broken.gz' }, 'SNAPSHOT_NOT_READY');
});

test('gzip detection uses file signatures and stale cache bytes never report ready', async () => {
  await writeFile(
    path.join(root, 'compressed-without-extension'),
    gzipSync(Buffer.from('signature fixture')),
  );
  assert.equal((await call('snapshot_cache', { path: 'compressed-without-extension' })).compressed, true);
  assert.equal((await prepared('compressed-without-extension')).status, 'ready');
  assert.equal(
    (await call('snapshot_read', { path: 'compressed-without-extension', length: 17 })).ascii,
    'signature fixture',
  );
  const directory = path.join(state, 'snapshots');
  for (const name of await readdir(directory)) {
    if (!name.endsWith('.json')) continue;
    const metadata = JSON.parse(await readFile(path.join(directory, name), 'utf8'));
    if (metadata.path === 'compressed-without-extension') {
      await writeFile(path.join(directory, name.replace('.json', '.bin')), 'tampered');
    }
  }
  assert.equal((await call('snapshot_cache', { path: 'compressed-without-extension' })).status, 'unprepared');
  await call('snapshot_read', { path: 'compressed-without-extension' }, 'SNAPSHOT_NOT_READY');
  await call('snapshot_cache', { path: 'compressed-without-extension', action: 'release' });
});

test('cache disk budget, cancellation, and interrupted partial cleanup are bounded', async () => {
  const workspace = await Workspace.create(root);
  const directory = path.join(state, 'tiny-cache');
  const tiny = new SnapshotCache(workspace, directory, 1000);
  await tiny.action('dump.bin.gz', 'prepare');
  for (let i = 0; i < 100 && (await tiny.status('dump.bin.gz')).status === 'running'; i++)
    await new Promise((r) => setTimeout(r, 10));
  assert.equal((await tiny.status('dump.bin.gz')).status, 'failed');
  assert.match((await tiny.status('dump.bin.gz')).error, /CACHE_LIMIT/);
  assert.ok(!(await readdir(directory)).some((x) => x.endsWith('.part') || x.endsWith('.bin')));
  const larger = new SnapshotCache(workspace, directory, 10 * 1024 * 1024);
  await writeFile(path.join(directory, `${'a'.repeat(64)}.part`), 'interrupted');
  await larger.action('dump.bin.gz', 'prepare');
  await larger.action('dump.bin.gz', 'cancel');
  assert.equal((await larger.status('dump.bin.gz')).status, 'cancelled');
  assert.ok(!(await readdir(directory)).some((x) => x.endsWith('.part')));
  await larger.close();
  await tiny.close();
});

test('changed sources invalidate cache and clear recovers disk even if source was removed', async () => {
  await prepared('dump.bin.gz');
  const now = new Date(Date.now() + 2000);
  await utimes(path.join(root, 'dump.bin.gz'), now, now);
  assert.equal((await call('snapshot_cache', { path: 'dump.bin.gz' })).status, 'unprepared');
  await call('snapshot_read', { path: 'dump.bin.gz' }, 'SNAPSHOT_NOT_READY');
  await rm(path.join(root, 'dump.bin.gz'));
  assert.equal((await call('snapshot_cache', { action: 'clear' })).status, 'cleared');
  assert.ok(!(await readdir(path.join(state, 'snapshots'))).some((x) => /\.(bin|part|json)$/.test(x)));
  assert.equal((await readFile(path.join(root, 'dump.bin'))).length, 6 * 1024 * 1024);
});
