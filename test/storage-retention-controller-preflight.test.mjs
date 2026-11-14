import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, readdir, lstat, link, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  classifyControllerPreflight,
  matchControllerEvidence,
} from '../scripts/storage-retention-controller-preflight.mjs';
import { loadBoundedBytes } from '../scripts/storage-retention-references.mjs';
import { windowsMetadata } from '../scripts/preview-storage-retention.mjs';
const hash = (v) => createHash('sha256').update(v).digest('hex');
async function fixture(t, probePresent = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wb-controller-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'controller'));
  await mkdir(path.join(root, 'probe-state'));
  const files = {
    'request.json': 'request',
    'controller-error.json': 'error',
    'service-task.xml': 'task',
    'probe.log': 'probe',
    'controller/Invoke-WorkbridgeUpdate.ps1': 'entry',
    'controller/Workbridge-Update.ps1': 'deployment',
    'controller/release-acceptance.mjs': 'acceptance',
    ...(probePresent ? { 'probe-state/release-probe.json': 'result' } : {}),
  };
  for (const [name, value] of Object.entries(files))
    await writeFile(path.join(root, ...name.split('/')), value);
  const metadata = windowsMetadata();
  t.after(() => metadata.close());
  const io = {
    readFile: (name) =>
      loadBoundedBytes(path.join(root, ...name.split('/')), {
        installRoot: root,
        maxBytes: 131072,
        metadata,
      }),
    async readDirectory(name) {
      const dir = path.join(root, name);
      const info = await lstat(dir);
      if (!info.isDirectory() || info.isSymbolicLink()) throw Error('linked');
      const entries = (await readdir(dir, { withFileTypes: true })).map((e) => ({
        name: e.name,
        type: e.isSymbolicLink() ? 'link' : e.isDirectory() ? 'directory' : e.isFile() ? 'file' : 'other',
      }));
      return { identity: { ino: String(info.ino) }, entries };
    },
  };
  return {
    root,
    files,
    io,
    spec: {
      files: Object.fromEntries(Object.entries(files).map(([name, value]) => [name, hash(value)])),
      probeState: probePresent ? ['release-probe.json'] : [],
    },
  };
}
for (const hasProbe of [false, true])
  test(`matches bounded immutable evidence with probe-state ${hasProbe ? 'present' : 'empty'}`, async (t) => {
    const f = await fixture(t, hasProbe);
    const out = await matchControllerEvidence(f.spec, f.io);
    assert.equal(out.observedInvocationOnly, true);
    assert.equal(out.earlierHistoryUnproven, true);
    assert.equal(Object.keys(out.files).length, Object.keys(f.files).length);
  });
test('unknown operation id cannot enter fixed catalog, even with valid-looking evidence', async () => {
  let called = false;
  assert.equal(
    await classifyControllerPreflight('another-operation', {
      readFile: () => {
        called = true;
      },
      readDirectory: () => {
        called = true;
      },
    }),
    null,
  );
  assert.equal(called, false);
});
test('an unexpected entry created while evidence is read is rejected', async (t) => {
  const f = await fixture(t);
  const read = f.io.readFile;
  let changed = false;
  f.io.readFile = async (name) => {
    const value = await read(name);
    if (!changed) {
      changed = true;
      await writeFile(path.join(f.root, 'probe-state', 'unexpected'), 'x');
    }
    return value;
  };
  await assert.rejects(matchControllerEvidence(f.spec, f.io));
});
test('missing or modified evidence and unexpected nested files refuse classification', async (t) => {
  for (const target of [
    'request.json',
    'controller-error.json',
    'probe.log',
    'controller/Workbridge-Update.ps1',
    'service-task.xml',
  ]) {
    const f = await fixture(t);
    await writeFile(path.join(f.root, ...target.split('/')), 'changed');
    await assert.rejects(matchControllerEvidence(f.spec, f.io));
  }
  const f = await fixture(t);
  await rm(path.join(f.root, 'probe.log'));
  await assert.rejects(matchControllerEvidence(f.spec, f.io));
  const g = await fixture(t);
  await writeFile(path.join(g.root, 'probe-state', 'unexpected'), 'x');
  await assert.rejects(matchControllerEvidence(g.spec, g.io));
  const h = await fixture(t);
  await writeFile(path.join(h.root, 'journal.json'), '{}');
  await assert.rejects(matchControllerEvidence(h.spec, h.io));
});
test('hardlinked evidence and linked controller ancestry fail closed', async (t) => {
  const f = await fixture(t);
  await link(path.join(f.root, 'request.json'), path.join(f.root, 'alias'));
  // Keep the root namespace valid while retaining the second hardlink outside it.
  const other = await mkdtemp(path.join(os.tmpdir(), 'wb-hardlink-'));
  t.after(() => rm(other, { recursive: true, force: true }));
  await link(path.join(f.root, 'request.json'), path.join(other, 'alias'));
  await rm(path.join(f.root, 'alias'));
  await assert.rejects(matchControllerEvidence(f.spec, f.io));
  const g = await fixture(t);
  const external = await mkdtemp(path.join(os.tmpdir(), 'wb-link-'));
  t.after(() => rm(external, { recursive: true, force: true }));
  await rm(path.join(g.root, 'probe-state'), { recursive: true });
  await symlink(
    external,
    path.join(g.root, 'probe-state'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await assert.rejects(matchControllerEvidence(g.spec, g.io));
});
