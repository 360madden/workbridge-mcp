import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, link, symlink } from 'node:fs/promises';
import os from 'node:os';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { inspectRetentionReferences, loadBoundedJson } from '../scripts/storage-retention-references.mjs';

const fixtureManifest = { schema: 1, version: '1.0', files: [] };
const digest = createHash('sha256').update(JSON.stringify(fixtureManifest)).digest('hex').toUpperCase();
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wb-references-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, '.local', 'update-operations'), { recursive: true });
  const save = async (relative, value) => {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(value));
    return file;
  };
  const marker = (id, version = '1.0', sha = digest) => ({
    schema: 1,
    operationId: id,
    version,
    releaseDigest: sha,
  });
  const operation = async (id, previous = null, changes = {}) => {
    const prefix = '.local/update-operations/' + id + '/';
    await save('.local/releases/' + id + '/manifest.json', fixtureManifest);
    await save('.local/releases/' + id + '/validated.json', {
      schema: 1,
      version: '1.0',
      result: 'passed',
      manifestSha256: digest,
      checks: {
        install: 0,
        tests: 0,
        startup: 0,
        updater: 0,
        format: 0,
        acceptance: 0,
      },
    });

    await save(prefix + 'request.json', {
      schema: 1,
      action: 'Apply',
      operationId: id,
      installRoot: root,
      releasePath: path.join(root, '.local/releases', id),
      releaseDigest: digest,
      ...changes.request,
    });
    await save(prefix + 'journal.json', {
      schema: 1,
      operationId: id,
      installRoot: root,
      phase: 'completed',
      version: '1.0',
      previousVersion: previous?.version ?? '0.9',
      releaseDigest: digest,
      previousRelease: previous,
      ...changes.journal,
    });
  };
  return { root, save, marker, operation };
}
test('references bind complete predecessor chain and protect recovery roots', async (t) => {
  const f = await fixture(t);
  await f.operation('old');
  await f.operation('new', f.marker('old'));
  await f.save('.local/installed-release.json', f.marker('new'));
  const graph = await inspectRetentionReferences({ installRoot: f.root });
  assert.equal(graph.complete, true, JSON.stringify(graph.blockers));
  assert.equal(graph.chain.complete, true);
  assert.deepEqual(graph.chain.operationIds, ['new', 'old']);
  assert.equal(graph.mutationEligible, false);
  assert.match(graph.installed.binding.sha256, /^[A-F0-9]{64}$/);
  assert.equal(graph.installed.sealBinding.status, 'manifest-bound');
  assert.equal(graph.installed.sealBinding.payloadVerified, false);
  assert.equal(graph.installed.sealBinding.manifestBinding.sha256, digest);
  const op = graph.operations.find((row) => row.id === 'old');
  assert.deepEqual(op.comparisonScopes, ['candidate', 'displaced']);
  for (const name of [
    'backup/runtime',
    'backup/source',
    'backup/configuration',
    'controller',
    'journal.json',
  ])
    assert.ok(op.protectedPaths.includes(path.join(f.root, '.local/update-operations/old', name)));
  assert.equal(typeof op.requestBinding.identity.ino, 'string');
});
test('unknown journal retains operation and safely keyed internal release reference', async (t) => {
  const f = await fixture(t);
  await f.operation('old');
  await rm(path.join(f.root, '.local/update-operations/old/journal.json'));
  await f.save('.local/installed-release.json', f.marker('old'));
  const graph = await inspectRetentionReferences({ installRoot: f.root });
  assert.equal(graph.complete, false);
  assert.equal(graph.chain.complete, false);
  assert.equal(graph.operations[0].release.scope, 'internal');
  assert.ok(graph.protectedPaths.includes(graph.operations[0].release.path));
  assert.deepEqual(graph.operations[0].comparisonScopes, []);
});
test('a normal journal cannot impersonate the reserved controller preflight disposition', async (t) => {
  const f = await fixture(t);
  await f.operation('old', null, { journal: { phase: 'controller_preflight_refused' } });
  await f.save('.local/installed-release.json', f.marker('old'));
  const graph = await inspectRetentionReferences({ installRoot: f.root });
  assert.equal(graph.complete, false);
  assert.ok(graph.blockers.some((row) => row.code === 'INVALID_OPERATION_JOURNAL'));
  assert.notEqual(graph.operations[0].phase, 'controller_preflight_refused');
});
test('external release is recorded without traversal and only displaced comparison remains', async (t) => {
  const f = await fixture(t);
  const external = path.join(path.dirname(f.root), 'never-follow-this-release');
  await f.operation('old', null, { request: { releasePath: external } });
  await f.save('.local/installed-release.json', f.marker('old'));
  const graph = await inspectRetentionReferences({ installRoot: f.root });
  assert.equal(graph.complete, false);
  assert.ok(graph.blockers.some((b) => b.code === 'ACTIVE_RELEASE_EXTERNAL'));
  assert.equal(graph.installed.sealBinding, null);
  assert.equal(graph.operations[0].release.scope, 'external');
  assert.deepEqual(graph.operations[0].comparisonScopes, ['displaced']);
  assert.ok(!graph.protectedPaths.includes(external));
});
test('sentinel installed marker has no updater generation and no missing-chain error', async (t) => {
  const f = await fixture(t);
  await f.save('.local/installed-release.json', f.marker(null, '0.9', null));
  const graph = await inspectRetentionReferences({ installRoot: f.root });
  assert.equal(graph.complete, true, JSON.stringify(graph.blockers));
  assert.equal(graph.chain.complete, true);
  assert.deepEqual(graph.chain.operationIds, []);
});
test('predecessor runtime version divergence is a caveat while parent identity remains traversable', async (t) => {
  const f = await fixture(t);
  await f.operation('old');
  await f.operation('new', f.marker('old'), { journal: { previousVersion: 'different-runtime' } });
  await f.save('.local/installed-release.json', f.marker('new'));
  const graph = await inspectRetentionReferences({ installRoot: f.root });
  assert.equal(graph.chain.complete, true);
  assert.deepEqual(graph.chain.operationIds, ['new', 'old']);
  assert.ok(
    graph.operations
      .find((op) => op.id === 'new')
      .caveats.includes('previous-runtime-marker-version-diverged'),
  );
});
test('missing, cyclic and conflicting predecessor bindings are incomplete', async (t) => {
  for (const scenario of ['missing', 'cycle', 'conflict']) {
    const f = await fixture(t);
    const previous = f.marker(
      scenario === 'missing' ? 'absent' : 'old',
      scenario === 'conflict' ? 'conflicting-version' : '1.0',
    );
    await f.operation('old', previous);
    await f.save('.local/installed-release.json', f.marker('old'));
    const graph = await inspectRetentionReferences({ installRoot: f.root });
    assert.equal(graph.chain.complete, false, scenario);
    assert.equal(graph.complete, false, scenario);
    assert.equal(graph.mutationEligible, false);
  }
});
test('request/journal identity and digest conflicts suppress copy comparisons', async (t) => {
  for (const request of [
    { operationId: 'another' },
    { installRoot: path.parse(os.tmpdir()).root },
    { releaseDigest: 'B'.repeat(64) },
    { schema: 2 },
    { version: 'conflict' },
  ]) {
    const f = await fixture(t);
    await f.operation('old', null, { request });
    await f.save('.local/installed-release.json', f.marker('old'));
    const graph = await inspectRetentionReferences({ installRoot: f.root });
    assert.equal(graph.complete, false);
    assert.deepEqual(graph.operations[0].comparisonScopes, []);
  }
});
test('JSON helper binds bytes and refuses excess size, invalid JSON and hard links', async (t) => {
  const f = await fixture(t);
  const file = await f.save('record.json', { schema: 1 });
  const loaded = await loadBoundedJson(file, { maxBytes: 1024 });
  assert.deepEqual(loaded.value, { schema: 1 });
  assert.match(loaded.sha256, /^[A-F0-9]{64}$/);
  await assert.rejects(loadBoundedJson(file, { maxBytes: 1 }), { code: 'REFERENCE_JSON_TOO_LARGE' });
  await link(file, path.join(f.root, 'linked.json'));
  await assert.rejects(loadBoundedJson(file), { code: 'LINKED_REFERENCE_FILE' });
  const malformed = path.join(f.root, 'bad.json');
  await writeFile(malformed, '{');
  await assert.rejects(loadBoundedJson(malformed), { code: 'INVALID_REFERENCE_JSON' });
});
test('linked ancestry and linked operation directories fail closed', async (t) => {
  const f = await fixture(t);
  await f.operation('old');
  await f.save('.local/installed-release.json', f.marker('old'));
  const alias = path.join(f.root, 'alias');
  await symlink(path.join(f.root, '.local'), alias, 'junction');
  await assert.rejects(loadBoundedJson(path.join(alias, 'installed-release.json')), {
    code: 'LINKED_REFERENCE_PATH',
  });
  await symlink(
    path.join(f.root, '.local/update-operations/old'),
    path.join(f.root, '.local/update-operations/linked'),
    'junction',
  );
  const graph = await inspectRetentionReferences({ installRoot: f.root });
  assert.equal(graph.complete, false);
  assert.deepEqual(graph.operations.find((op) => op.id === 'linked').comparisonScopes, []);
});
test('operation and total read limits produce partial, permanently read-only graphs', async (t) => {
  const f = await fixture(t);
  await f.operation('old');
  await f.operation('new', f.marker('old'));
  await f.save('.local/installed-release.json', f.marker('new'));
  const count = await inspectRetentionReferences({ installRoot: f.root, limits: { maxOperations: 1 } });
  assert.equal(count.complete, false);
  assert.ok(count.blockers.some((b) => b.code === 'REFERENCE_OPERATION_LIMIT'));
  const bytes = await inspectRetentionReferences({ installRoot: f.root, limits: { maxReadBytes: 1 } });
  assert.equal(bytes.complete, false);
  assert.equal(bytes.mutationEligible, false);
});

test('known rewritten request actions retain completed metadata comparisons as caveats', async (t) => {
  const f = await fixture(t);
  await f.operation('old', null, { request: { action: 'Recover' } });
  await f.save('.local/installed-release.json', {
    ...f.marker('old'),
    unexpectedPrivateField: 'never-output',
  });
  const graph = await inspectRetentionReferences({ installRoot: f.root });
  assert.equal(graph.complete, true);
  assert.deepEqual(graph.operations[0].comparisonScopes, ['candidate', 'displaced']);
  assert.ok(graph.operations[0].caveats.includes('request-action-rewritten'));
  assert.ok(!JSON.stringify(graph).includes('never-output'));
});
test('uninstalled orphan with a missing predecessor prevents a complete graph', async (t) => {
  const f = await fixture(t);
  await f.operation('orphan', f.marker('absent'));
  await f.save('.local/installed-release.json', f.marker(null, 'initial', null));
  const graph = await inspectRetentionReferences({ installRoot: f.root });
  assert.equal(graph.chain.complete, false);
  assert.ok(graph.chain.blockers.some((b) => b.code === 'MISSING_PREDECESSOR'));
});

test('active seal rejects digest mismatch, missing receipts and missing named checks independently of copy scope', async (t) => {
  for (const scenario of ['mismatch', 'missing', 'checks']) {
    const f = await fixture(t);
    await f.operation('old');
    await f.save('.local/installed-release.json', f.marker('old'));
    if (scenario === 'mismatch')
      await f.save('.local/releases/old/manifest.json', { ...fixtureManifest, changed: true });
    else if (scenario === 'missing') await rm(path.join(f.root, '.local/releases/old/validated.json'));
    else
      await f.save('.local/releases/old/validated.json', {
        schema: 1,
        version: '1.0',
        result: 'passed',
        manifestSha256: digest,
        checks: { unrelated: 0 },
      });
    const graph = await inspectRetentionReferences({ installRoot: f.root });
    assert.equal(graph.complete, false, scenario);
    assert.equal(graph.installed.sealBinding, null, scenario);
    assert.deepEqual(graph.operations[0].comparisonScopes, ['candidate', 'displaced']);
    assert.equal(graph.mutationEligible, false);
  }
});

test('0.16.4-dev active seal additionally requires all three GUI validation gates', async (t) => {
  const f = await fixture(t);
  const manifest = { schema: 1, version: '0.16.4-dev', files: [] };
  const sha = createHash('sha256').update(JSON.stringify(manifest)).digest('hex').toUpperCase();
  await f.operation('gui', null, {
    request: { releaseDigest: sha },
    journal: { version: '0.16.4-dev', releaseDigest: sha },
  });
  await f.save('.local/releases/gui/manifest.json', manifest);
  const receipt = {
    schema: 1,
    version: '0.16.4-dev',
    result: 'passed',
    manifestSha256: sha,
    checks: { install: 0, tests: 0, startup: 0, updater: 0, format: 0, acceptance: 0 },
  };
  await f.save('.local/releases/gui/validated.json', receipt);
  await f.save('.local/installed-release.json', f.marker('gui', '0.16.4-dev', sha));
  const missing = await inspectRetentionReferences({ installRoot: f.root });
  assert.equal(missing.installed.sealBinding, null);
  assert.ok(missing.blockers.some((b) => b.code === 'ACTIVE_RELEASE_SEAL_INVALID'));
  Object.assign(receipt.checks, { generic: 0, 'desktop-stage': 0, 'desktop-closure': 0 });
  await f.save('.local/releases/gui/validated.json', receipt);
  const complete = await inspectRetentionReferences({ installRoot: f.root });
  assert.equal(complete.complete, true, JSON.stringify(complete.blockers));
  assert.equal(complete.installed.sealBinding.status, 'manifest-bound');
  assert.equal(complete.installed.sealBinding.payloadVerified, false);
});

test('unknown request path fields prevent reference closure while known release remains protected', async (t) => {
  const f = await fixture(t);
  await f.operation('old', null, { request: { futureRecoveryPath: path.join(f.root, 'other-resource') } });
  await f.save('.local/installed-release.json', f.marker('old'));
  const graph = await inspectRetentionReferences({ installRoot: f.root });
  assert.equal(graph.complete, false);
  assert.ok(graph.blockers.some((b) => b.code === 'UNKNOWN_OPERATION_REQUEST_FIELD'));
  assert.deepEqual(graph.operations[0].comparisonScopes, []);
  assert.equal(graph.operations[0].release.scope, 'internal');
  assert.ok(graph.protectedPaths.includes(graph.operations[0].release.path));
});

test('known node executable references protect internal copy aliases without traversal', async (t) => {
  const f = await fixture(t);
  const alias = path.join(f.root, '.local/update-operations/old/candidate/node.exe');
  await f.operation('old', null, { request: { nodePath: alias } });
  await f.save('.local/installed-release.json', f.marker('old'));
  const graph = await inspectRetentionReferences({ installRoot: f.root });
  assert.equal(graph.complete, true, JSON.stringify(graph.blockers));
  assert.ok(
    graph.references.some((r) => r.kind === 'node-executable' && r.path === alias && r.scope === 'internal'),
  );
  assert.ok(graph.protectedPaths.includes(alias));
});
test('malformed node executable references prevent closure without hiding the release reference', async (t) => {
  for (const nodePath of [false, '', 'relative-node.exe', 'x'.repeat(32768)]) {
    const f = await fixture(t);
    await f.operation('old', null, { request: { nodePath } });
    await f.save('.local/installed-release.json', f.marker('old'));
    const graph = await inspectRetentionReferences({ installRoot: f.root });
    assert.equal(graph.complete, false);
    assert.ok(graph.blockers.some((b) => b.code === 'INVALID_NODE_EXECUTABLE_REFERENCE'));
    assert.equal(graph.operations[0].release.scope, 'internal');
  }
});
