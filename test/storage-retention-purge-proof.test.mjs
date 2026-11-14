import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createPurgeSafetyProof } from '../scripts/storage-retention-purge-proof.mjs';
import { canonicalPurgeJson } from '../scripts/storage-retention-purge-journal.mjs';
import { canonicalPlanSha256 } from '../scripts/storage-retention-quarantine.mjs';
import { verifyRetainedRuntime, verifyRuntimeDuplicate } from '../scripts/storage-retention-duplicates.mjs';
const hash = (v) => createHash('sha256').update(canonicalPurgeJson(v)).digest('hex');
const rawhash = (v) =>
  createHash('sha256')
    .update(`${canonicalPurgeJson(v)}\n`)
    .digest('hex');
const a = 'a'.repeat(64),
  b = 'b'.repeat(64),
  tree = 'c'.repeat(64);
function fixture(kind = 'candidate') {
  const root = path.join(os.tmpdir(), 'wb-purge-proof-fixture'),
    opRoot = path.join(root, '.local', 'update-operations', 'old'),
    release = path.join(root, '.local', 'releases', 'old');
  const retainedRoot =
    kind === 'candidate' ? path.join(release, 'payload') : path.join(opRoot, 'backup', 'runtime');
  const bytes = [
    { path: 'dist/a', bytes: 1, sha256: a },
    { path: 'node_modules/p/a', bytes: 2, sha256: b },
    { path: 'package.json', bytes: 1, sha256: a },
    { path: 'package-lock.json', bytes: 2, sha256: b },
  ];
  const records = new Map();
  const put = (file, value, digest = a) => {
    const r = { value, sha256: digest, identity: { ino: String(records.size + 1) } };
    records.set(file, r);
    return { file, sha256: digest, identity: r.identity };
  };
  const meta = [
    put(path.join(opRoot, 'request.json'), { operationId: 'old', installRoot: root, releasePath: release }),
    put(path.join(opRoot, 'journal.json'), { operationId: 'old', installRoot: root }),
  ];
  if (kind === 'candidate') {
    meta.push(put(path.join(release, 'manifest.json'), { files: bytes }));
    meta.push(put(path.join(release, 'validated.json'), {}));
  } else meta.push(put(path.join(opRoot, 'backup-manifest.json'), { files: bytes }));
  const identity = { volume: '1'.repeat(16), id: '1'.repeat(32) };
  const sorted = [...meta].sort((x, y) => x.file.localeCompare(y.file));
  const plan = {
    schema: 'workbridge-retention-plan/1',
    host: os.hostname().toUpperCase(),
    installRoot: root,
    updaterOperationId: 'old',
    kind,
    displacedId: kind === 'candidate' ? null : '2'.repeat(32),
    sourceIdentity: identity,
    manifestSha256: a,
    retainedBindingSha256: hash({ retainedRoot, retainedTreeSha256: tree }),
    metadataSha256: hash(sorted),
    referencesSha256: 'd'.repeat(64),
    sourceTreeSha256: 'e'.repeat(64),
  };
  const ids = (n) => ({ volume: identity.volume, id: n.toString(16).padStart(32, '0') });
  const entries = [
    { path: '', type: 'directory', identity, size: 0, nlink: 1, sha256: null },
    ...['dist', 'node_modules', 'node_modules/p'].map((name, i) => ({
      path: name,
      type: 'directory',
      identity: ids(i + 2),
      size: 0,
      nlink: 1,
      sha256: null,
    })),
    ...bytes.map((entry, i) => ({
      path: entry.path,
      type: 'file',
      identity: ids(i + 5),
      size: entry.bytes,
      nlink: 1,
      sha256: entry.sha256,
    })),
  ].sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
  const manifest = {
    schema: 'workbridge-purge-manifest/1',
    operationId: 'gc1',
    planSha256: canonicalPlanSha256(plan),
    quarantineReceiptSha256: 'f'.repeat(64),
    expectedRoot: identity,
    entries,
  };
  const ctx = {
    operationId: 'gc1',
    installRoot: root,
    plan,
    planSha256: manifest.planSha256,
    quarantineReceiptSha256: manifest.quarantineReceiptSha256,
  };
  const marker = { path: path.join(root, 'marker'), sha256: a, identity: { ino: '1' } };
  const op = {
    id: 'old',
    phase: 'completed',
    updatedUtc: '2000-01-01T00:00:00Z',
    comparisonScopes: ['candidate', 'displaced'],
    release: { scope: 'internal', path: release },
    protectedPaths: [opRoot],
  };
  const graph = {
    installRoot: root,
    complete: true,
    chain: { complete: true, operationIds: ['current', 'previous'] },
    installed: {
      operationId: 'current',
      binding: marker,
      sealBinding: { status: 'manifest-bound', manifestBinding: marker, validatedBinding: marker },
    },
    operations: [op],
    references: [],
    protectedPaths: [opRoot, release],
    bytesRead: 1,
  };
  const state = {
    ctx,
    binding: { manifest, manifestSha256: rawhash(manifest) },
    records,
    graph,
    tree,
    retainedRoot,
  };
  state.deps = {
    inspectRetentionReferences: async () => structuredClone(state.graph),
    loadBoundedJson: async (file) => {
      const value = records.get(file);
      if (!value) throw Error('missing metadata');
      return structuredClone(value);
    },
    verifyRetainedRuntime: async () => ({ verifiedRetained: true, retainedTreeSha256: state.tree }),
  };
  return state;
}
for (const kind of ['candidate', 'displaced'])
  test(`surviving ${kind} proof binds full immutable original without payload`, async () => {
    const f = fixture(kind);
    const proof = await createPurgeSafetyProof(f.ctx, f.binding, f.deps);
    assert.match(proof.referencesSha256, /^[a-f0-9]{64}$/);
    assert.match(proof.retainedProofSha256, /^[a-f0-9]{64}$/);
    assert.notEqual(proof.referencesSha256, f.ctx.plan.referencesSha256);
  });
test('rejects even a missing previously deleted file in original manifest projection', async () => {
  const f = fixture();
  f.binding.manifest.entries = f.binding.manifest.entries.filter((e) => e.path !== 'dist/a');
  f.binding.manifestSha256 = rawhash(f.binding.manifest);
  await assert.rejects(
    createPurgeSafetyProof(f.ctx, f.binding, f.deps),
    /PURGE_MANIFEST_PROJECTION_MISMATCH/,
  );
});
test('rejects newly protected quarantine or source path', async () => {
  const f = fixture();
  f.graph.protectedPaths.push(
    path.join(f.ctx.installRoot, '.local', 'storage-quarantine', 'gc1', 'payload', 'dist'),
  );
  await assert.rejects(createPurgeSafetyProof(f.ctx, f.binding, f.deps), /PROTECTED_RESOURCE/);
  const g = fixture();
  g.graph.references.push({
    path: path.join(g.ctx.installRoot, '.local', 'update-operations', 'old', 'candidate'),
  });
  await assert.rejects(createPurgeSafetyProof(g.ctx, g.binding, g.deps), /REFERENCED_RESOURCE/);
});
test('rejects stale graph, changed retained fingerprint and metadata', async () => {
  const f = fixture();
  f.graph.complete = false;
  await assert.rejects(createPurgeSafetyProof(f.ctx, f.binding, f.deps), /REFERENCE_GRAPH_INCOMPLETE/);
  const g = fixture();
  g.tree = '7'.repeat(64);
  await assert.rejects(createPurgeSafetyProof(g.ctx, g.binding, g.deps), /RETAINED_PROOF_MISMATCH/);
  const h = fixture();
  let n = 0;
  const inspect = h.deps.inspectRetentionReferences;
  h.deps.inspectRetentionReferences = async () => {
    const v = await inspect();
    if (++n === 2) v.chain.operationIds.push('changed');
    return v;
  };
  await assert.rejects(createPurgeSafetyProof(h.ctx, h.binding, h.deps), /REFERENCE_GRAPH_CHANGED/);
  const j = fixture();
  j.records.values().next().value.sha256 = '1'.repeat(64);
  await assert.rejects(createPurgeSafetyProof(j.ctx, j.binding, j.deps), /METADATA_BINDING_MISMATCH/);
});
test('single surviving tree fingerprint matches duplicate verifier and rejects same-size changes', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'wb-retained-proof-'));
  try {
    const src = path.join(temp, 'src'),
      ret = path.join(temp, 'ret');
    const data = { 'dist/a': 'a', 'node_modules/p/a': 'bb', 'package.json': 'c', 'package-lock.json': 'dd' };
    const files = Object.entries(data).map(([file, text]) => ({
      path: file,
      bytes: Buffer.byteLength(text),
      sha256: createHash('sha256').update(text).digest('hex'),
    }));
    for (const root of [src, ret])
      for (const [file, text] of Object.entries(data)) {
        const target = path.join(root, ...file.split('/'));
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, text);
      }
    const both = await verifyRuntimeDuplicate({ resourceRoot: src, retainedRoot: ret, manifestFiles: files });
    assert.equal(both.verifiedDuplicate, true, both.reason);
    const one = await verifyRetainedRuntime({ retainedRoot: ret, manifestFiles: files });
    assert.equal(one.verifiedRetained, true, one.reason);
    assert.equal(one.retainedTreeSha256, both.retainedTreeSha256);
    await writeFile(path.join(ret, 'dist', 'a'), 'x');
    const changed = await verifyRetainedRuntime({ retainedRoot: ret, manifestFiles: files });
    assert.notEqual(changed.verifiedRetained, true);
    assert.equal(changed.reason, 'HASH_MISMATCH');
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
