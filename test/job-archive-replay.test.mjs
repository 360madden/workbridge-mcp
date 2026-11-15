import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { Workspace } from '../dist/workspace.js';
import { Jobs } from '../dist/jobs.js';
const sha = (b) => createHash('sha256').update(b).digest('hex');
async function fixture(t, overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wb-archive-job-replay-'));
  const state = path.join(root, 'state');
  await fs.mkdir(path.join(state, 'jobs'), { recursive: true });
  const workspace = await Workspace.create(root),
    jobs = new Jobs(workspace, state);
  t.after(async () => {
    await jobs.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const args = ['-e', "require('fs').writeFileSync('must-not-start','bad')"],
    request = sha(
      JSON.stringify({ mode: 'terminal', cwd: '.', executable: process.execPath, args, timeoutSeconds: 30 }),
    );
  const job = {
    id: 'saved',
    project: '.',
    command: 'node',
    request,
    status: 'passed',
    startedAt: '2026-10-21T03:00:00.000Z',
    endedAt: '2026-10-21T03:00:00.100Z',
    exitCode: 0,
    output: 'first 😀 second',
    outputTruncated: false,
    mode: 'terminal',
    executable: process.execPath,
    timeoutSeconds: 30,
    stdout: 'out 😀',
    stderr: '',
    unknownLegacyField: { keep: 'raw' },
    ...overrides,
  };
  const raw = Buffer.from(JSON.stringify(job)),
    compressed = gzipSync(raw),
    descriptor = {
      schema: 'workbridge-job-archive/1',
      id: 'saved',
      sourceSha256: sha(raw),
      sourceBytes: raw.length,
      gzipSha256: sha(compressed),
      gzipBytes: compressed.length,
    };
  const archiveDir = path.join(state, 'job-archives', 'saved');
  await fs.mkdir(archiveDir, { recursive: true });
  const archive = path.join(archiveDir, `${descriptor.sourceSha256}.json.gz`);
  await fs.writeFile(archive, compressed);
  const descriptorFile = path.join(state, 'jobs', 'saved.json'),
    descriptorBytes = Buffer.from(JSON.stringify(descriptor));
  await fs.writeFile(descriptorFile, descriptorBytes);
  return { root, state, jobs, args, job, raw, archive, descriptor, descriptorFile, descriptorBytes };
}
test('archive keeps status, streams, paging, tail, replay, cancel, and descriptor CAS', async (t) => {
  const f = await fixture(t);
  const status = await f.jobs.status('saved');
  assert.equal(status.status, 'passed');
  assert.equal('unknownLegacyField' in status, false);
  assert.equal((await f.jobs.output('saved', 2, 5)).text, f.job.output.slice(2, 7));
  assert.equal((await f.jobs.output('saved', undefined, 10, 'combined', 4)).text, f.job.output.slice(-4));
  assert.equal((await f.jobs.output('saved', 0, 100, 'stdout')).text, f.job.stdout);
  assert.equal((await f.jobs.output('saved', 0, 100, 'stderr')).text, '');
  assert.deepEqual(await f.jobs.cancel('saved'), status);
  assert.equal((await f.jobs.retrySave('saved')).publication, 'already_saved');
  assert.deepEqual(await f.jobs.terminal('.', process.execPath, f.args, 30, 'saved'), status);
  await assert.rejects(
    f.jobs.terminal('.', process.execPath, ['-e', 'different'], 30, 'saved'),
    (e) => e.code === 'ID_REUSE',
  );
  const stored = await f.jobs.readStored('saved');
  assert.equal(stored.sha256, sha(f.descriptorBytes));
  assert.deepEqual(await fs.readFile(f.descriptorFile), f.descriptorBytes);
  await assert.rejects(fs.access(path.join(f.root, 'must-not-start')), { code: 'ENOENT' });
});
test('archive preserves legacy absent streams separately from empty strings', async (t) => {
  const f = await fixture(t, { stdout: undefined, stderr: undefined });
  assert.equal((await f.jobs.output('saved')).text, f.job.output);
  await assert.rejects(
    f.jobs.output('saved', 0, 10, 'stdout'),
    (e) => e.code === 'OUTPUT_STREAM_UNAVAILABLE',
  );
  await assert.rejects(
    f.jobs.output('saved', 0, 10, 'stderr'),
    (e) => e.code === 'OUTPUT_STREAM_UNAVAILABLE',
  );
});
test('legacy job containing reserved schema and output remains legacy', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.descriptorFile, JSON.stringify({ ...f.job, schema: 'workbridge-job-archive/1' }));
  await fs.rm(f.archive);
  assert.equal((await f.jobs.status('saved')).status, 'passed');
  assert.equal((await f.jobs.output('saved')).text, f.job.output);
});
test('missing or corrupt archives and descriptor/inner ID mismatch never start a command', async (t) => {
  for (const scenario of ['missing', 'corrupt', 'descriptor-id', 'inner-id', 'nested-envelope']) {
    const f = await fixture(t, scenario === 'inner-id' ? { id: 'other' } : {});
    if (scenario === 'missing') await fs.rm(f.archive);
    if (scenario === 'corrupt') await fs.writeFile(f.archive, Buffer.alloc(f.descriptor.gzipBytes));
    if (scenario === 'descriptor-id')
      await fs.writeFile(f.descriptorFile, JSON.stringify({ ...f.descriptor, id: 'wrong' }));
    if (scenario === 'nested-envelope') {
      const raw = Buffer.from(JSON.stringify(f.descriptor)),
        zip = gzipSync(raw),
        d = {
          ...f.descriptor,
          sourceSha256: sha(raw),
          sourceBytes: raw.length,
          gzipSha256: sha(zip),
          gzipBytes: zip.length,
        };
      await fs.writeFile(path.join(path.dirname(f.archive), `${d.sourceSha256}.json.gz`), zip);
      await fs.writeFile(f.descriptorFile, JSON.stringify(d));
    }
    for (const call of [
      () => f.jobs.status('saved'),
      () => f.jobs.output('saved'),
      () => f.jobs.cancel('saved'),
      () => f.jobs.retrySave('saved'),
      () => f.jobs.terminal('.', process.execPath, f.args, 30, 'saved'),
    ])
      await assert.rejects(call(), (e) => e.code === 'UNREADABLE_JOB_RECORD', scenario);
    await assert.rejects(fs.access(path.join(f.root, 'must-not-start')), { code: 'ENOENT' });
  }
});
test('descriptor replacement during archive read fails closed', async (t) => {
  const f = await fixture(t);
  const originalOpen = fs.open;
  let changed = false;
  try {
    fs.open = async function (file, ...args) {
      const h = await originalOpen.call(this, file, ...args);
      if (path.resolve(String(file)) === f.archive) {
        const read = h.read.bind(h);
        h.read = async (...params) => {
          const result = await read(...params);
          if (!changed) {
            changed = true;
            await fs.writeFile(
              f.descriptorFile,
              JSON.stringify({ ...f.descriptor, gzipBytes: f.descriptor.gzipBytes + 1 }),
            );
          }
          return result;
        };
      }
      return h;
    };
    syncBuiltinESMExports();
    await assert.rejects(f.jobs.status('saved'), (e) => e.code === 'UNREADABLE_JOB_RECORD');
    assert.equal(changed, true);
  } finally {
    fs.open = originalOpen;
    syncBuiltinESMExports();
  }
});
