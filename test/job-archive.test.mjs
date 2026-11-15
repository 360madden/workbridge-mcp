import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, link, symlink } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { readArchivedJob } from '../dist/job-archive.js';
const sha = (b) => createHash('sha256').update(b).digest('hex');
async function fixture(t, raw = Buffer.from('{"id":"j1","output":"😀","unknown":{"kept":true}}')) {
  const state = await mkdtemp(path.join(os.tmpdir(), 'wb-job-archive-reader-'));
  t.after(() => rm(state, { recursive: true, force: true }));
  const compressed = gzipSync(raw),
    descriptor = {
      schema: 'workbridge-job-archive/1',
      id: 'j1',
      sourceSha256: sha(raw),
      sourceBytes: raw.length,
      gzipSha256: sha(compressed),
      gzipBytes: compressed.length,
    };
  const dir = path.join(state, 'job-archives', 'j1');
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${descriptor.sourceSha256}.json.gz`);
  await writeFile(file, compressed);
  return { state, raw, compressed, descriptor, dir, file };
}
test('restores exact original bytes without interpreting or stripping unknown fields', async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await readArchivedJob(f.state, 'j1', f.descriptor), f.raw);
});
test('rejects noncanonical descriptor shapes, IDs, digests, and bounds', async (t) => {
  const f = await fixture(t);
  for (const changed of [
    { extra: 'x' },
    { id: 'other' },
    { schema: 'wrong' },
    { sourceSha256: 'A'.repeat(64) },
    { gzipSha256: 'b'.repeat(63) },
    { sourceBytes: 0 },
    { sourceBytes: 16 * 1024 * 1024 + 1 },
    { gzipBytes: 0 },
    { gzipBytes: 17 * 1024 * 1024 + 1 },
    { gzipBytes: 1.5 },
  ])
    await assert.rejects(readArchivedJob(f.state, 'j1', { ...f.descriptor, ...changed }));
  await assert.rejects(readArchivedJob(f.state, '../j1', f.descriptor));
});
test('missing, changed, hardlinked and redirected archives refuse read', async (t) => {
  const f = await fixture(t);
  await writeFile(f.file, Buffer.alloc(f.compressed.length));
  await assert.rejects(readArchivedJob(f.state, 'j1', f.descriptor));
  await writeFile(f.file, f.compressed);
  const hard = path.join(f.state, 'hardlink');
  await link(f.file, hard);
  await assert.rejects(readArchivedJob(f.state, 'j1', f.descriptor));
  await rm(hard);
  const target = path.join(f.state, 'real-archives'),
    alias = path.join(f.state, 'job-archives');
  await import('node:fs/promises').then((fs) => fs.rename(alias, target));
  await symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(readArchivedJob(f.state, 'j1', f.descriptor));
  await rm(alias);
  await import('node:fs/promises').then((fs) => fs.rename(target, alias));
  await rm(f.file);
  await assert.rejects(readArchivedJob(f.state, 'j1', f.descriptor));
});
test('valid gzip with expansion exceeding declared source length refuses', async (t) => {
  const f = await fixture(t, Buffer.from('x'.repeat(4096)));
  await assert.rejects(readArchivedJob(f.state, 'j1', { ...f.descriptor, sourceBytes: 10 }));
});
