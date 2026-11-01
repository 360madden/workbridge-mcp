import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { OPERATION_ID, verifyWb022Runtime } from '../scripts/verify-wb022-runtime.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = async (filename, value) => writeFile(filename, JSON.stringify(value));
const readJson = async (filename) => JSON.parse((await readFile(filename, 'utf8')).replace(/^\uFEFF/, ''));
const script = fileURLToPath(new URL('../scripts/verify-wb022-runtime.mjs', import.meta.url));
const displacedId = 'a'.repeat(32);

async function writeFiles(root, files) {
  const manifest = [];
  for (const [name, bytes] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), bytes);
    manifest.push({
      path: name.replaceAll('/', '\\'),
      bytes: Buffer.byteLength(bytes),
      sha256: sha(bytes).toUpperCase(),
    });
  }
  return manifest;
}

async function fixture(t) {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'wb022-readonly-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = path.join(parent, 'install');
  const operation = path.join(root, '.local', 'update-operations', OPERATION_ID);
  const release = path.join(parent, 'historical', 'candidate', '.local', 'releases', 'wb022-fixture');
  const payload = path.join(release, 'payload');
  const evidence = path.join(parent, 'historical', 'evidence', 'deployed-integrity-after.json');
  await mkdir(path.dirname(evidence), { recursive: true });
  const files = {
    // Invalid JavaScript deliberately proves that inspection never executes saved code.
    'dist/server.js': 'NOT EXECUTABLE: synthetic runtime bytes',
    'node_modules/fixture/index.js': 'synthetic dependency',
    'package.json': JSON.stringify({ name: 'workbridge-mcp', version: '0.16.3-dev' }),
    'package-lock.json': '{}',
  };
  const runtime = await writeFiles(root, files);
  const full = await writeFiles(payload, { ...files, 'src/server.ts': 'source only' });
  await writeFiles(path.join(operation, 'candidate'), files);
  const previous = await writeFiles(path.join(operation, 'backup', 'runtime'), {
    ...files,
    'dist/server.js': 'previous runtime',
    'package.json': JSON.stringify({ name: 'workbridge-mcp', version: '0.16.2-dev' }),
  });
  await cp(path.join(operation, 'backup', 'runtime'), path.join(operation, 'displaced', displacedId), {
    recursive: true,
  });
  const manifest = { schema: 1, version: '0.16.3-dev', files: full };
  // PowerShell may use a BOM and uppercase hashes; the digest covers exact manifest bytes.
  await writeFile(path.join(release, 'manifest.json'), '\uFEFF' + JSON.stringify(manifest));
  const digest = sha(await readFile(path.join(release, 'manifest.json'))).toUpperCase();
  await json(path.join(release, 'validated.json'), {
    schema: 1,
    version: '0.16.3-dev',
    result: 'passed',
    manifestSha256: digest,
    checks: Object.fromEntries(
      ['install', 'tests', 'startup', 'updater', 'format', 'generic', 'acceptance'].map((k) => [k, 0]),
    ),
    probe: { toolCount: 52, version: '0.16.3-dev', packageVersion: '0.16.3-dev' },
  });
  const identity = { schema: 1, operationId: OPERATION_ID, version: '0.16.3-dev', releaseDigest: digest };
  await json(path.join(operation, 'journal.json'), {
    ...identity,
    installRoot: root,
    previousVersion: '0.16.2-dev',
    previousRelease: { version: '0.16.2-dev' },
    phase: 'completed',
    updatedUtc: '2026-10-21T12:24:37.6891055Z',
    error: null,
    recoveryError: null,
  });
  await json(path.join(operation, 'request.json'), { ...identity, installRoot: root, releasePath: release });
  await json(path.join(root, '.local', 'installed-release.json'), identity);
  await json(path.join(operation, 'backup-manifest.json'), {
    schema: 1,
    version: '0.16.2-dev',
    files: previous,
  });
  await json(evidence, {
    schemaVersion: 1,
    passed: true,
    version: '0.16.3-dev',
    activationOperationId: OPERATION_ID,
    activationCompletedUtc: '2026-10-21T12:24:37.6891055Z',
    manifestSha256: digest,
    checks: { runtime: { count: runtime.length, differences: [] } },
  });
  return { root, operation, release, evidence, options: { repoRoot: root } };
}

async function snapshot(root) {
  const entries = [];
  async function walk(directory, prefix = '') {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const relative = prefix + entry.name;
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), relative + '/');
      else entries.push([relative, sha(await readFile(path.join(directory, entry.name)))]);
    }
  }
  await walk(root);
  return entries;
}

async function mutate(filename, edit) {
  const value = await readJson(filename);
  edit(value);
  await json(filename, value);
}

async function reseal(f, edit) {
  const filename = path.join(f.release, 'manifest.json');
  await mutate(filename, edit);
  const digest = sha(await readFile(filename));
  for (const name of ['journal.json', 'request.json']) {
    await mutate(path.join(f.operation, name), (v) => {
      v.releaseDigest = digest;
    });
  }
  await mutate(path.join(f.root, '.local', 'installed-release.json'), (v) => {
    v.releaseDigest = digest;
  });
  await mutate(path.join(f.release, 'validated.json'), (v) => {
    v.manifestSha256 = digest;
  });
  await mutate(f.evidence, (v) => {
    v.manifestSha256 = digest;
  });
}

test('verifies exact candidate, seal, previous manifest and all four runtime components without any writes', async (t) => {
  const f = await fixture(t);
  const before = await snapshot(path.dirname(f.root));
  const result = await verifyWb022Runtime(f.options);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.baselineVerified, true);
  assert.equal(result.offlineChecksPassed, true);
  assert.equal(result.recoveryReady, false);
  assert.equal(result.preflightVerified, false);
  assert.equal(result.liveHealthVerified, false);
  assert.equal(result.trees.candidate.count, 4);
  assert.equal(result.trees.sealedPayload.count, 5);
  assert.deepEqual(result.trees.candidate.components, {
    dist: 1,
    node_modules: 1,
    'package.json': 1,
    'package-lock.json': 1,
  });
  assert.equal(result.trees.candidate.sha256, result.trees.installedDisk.sha256);
  assert.equal(result.trees.previousRuntime.sha256, result.trees.displacedRuntime.sha256);
  assert.deepEqual(await snapshot(path.dirname(f.root)), before);
});

test('disk rebuild is a blocked recovery with a separately verified last-good candidate', async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, 'dist', 'server.js'), 'rebuilt disk runtime');
  const before = await snapshot(path.dirname(f.root));
  const result = await verifyWb022Runtime(f.options);
  assert.equal(result.ok, false);
  assert.equal(result.baselineVerified, true);
  assert.equal(result.recoveryReady, false);
  assert.equal(result.trees.installedDisk.differenceCount, 1);
  assert.notEqual(result.trees.installedDisk.sha256, result.trees.candidate.sha256);
  assert.match(result.nextSafePath.caution, /0\.16\.2/);
  assert.match(result.nextSafePath.statusCommand, /-Action Status/);
  assert.deepEqual(await snapshot(path.dirname(f.root)), before);
});

test('candidate same-length tampering, extra root file and missing component fail closed', async (t) => {
  for (const mode of ['checksum', 'extra', 'missing']) {
    const f = await fixture(t);
    const candidate = path.join(f.operation, 'candidate');
    if (mode === 'checksum') {
      const filename = path.join(candidate, 'dist', 'server.js');
      const bytes = await readFile(filename);
      bytes[0] ^= 1;
      await writeFile(filename, bytes);
    } else if (mode === 'extra') await writeFile(path.join(candidate, 'unexpected'), 'extra');
    else await unlink(path.join(candidate, 'package-lock.json'));
    const result = await verifyWb022Runtime(f.options);
    assert.equal(result.ok, false);
    assert.equal(result.baselineVerified, false);
    if (mode !== 'missing') assert.equal(result.trees.candidate.differences[0].kind, mode);
  }
});

test('missing original seal or installed hash evidence cannot be replaced by version claims', async (t) => {
  for (const mode of ['manifest', 'receipt', 'installed-evidence']) {
    const f = await fixture(t);
    await unlink(
      mode === 'installed-evidence'
        ? f.evidence
        : path.join(f.release, mode === 'manifest' ? 'manifest.json' : 'validated.json'),
    );
    const result = await verifyWb022Runtime(f.options);
    assert.equal(result.ok, false);
    assert.equal(result.baselineVerified, false);
    assert.ok(result.errors.includes('ENOENT'));
  }
});

test('journal identity, uncertain completion, marker and release digest disagreements fail closed', async (t) => {
  for (const mode of ['operationId', 'installRoot', 'error', 'phase', 'marker', 'digest']) {
    const f = await fixture(t);
    const filename =
      mode === 'marker'
        ? path.join(f.root, '.local', 'installed-release.json')
        : path.join(f.operation, 'journal.json');
    await mutate(filename, (v) => {
      if (mode === 'operationId') v.operationId = 'other';
      if (mode === 'installRoot') v.installRoot = path.dirname(f.root);
      if (mode === 'error') v.error = 'DO-NOT-EXPOSE-private-secret';
      if (mode === 'phase') v.phase = 'starting';
      if (mode === 'marker') v.version = '0.16.4-dev';
      if (mode === 'digest') v.releaseDigest = '0'.repeat(64);
    });
    const result = await verifyWb022Runtime(f.options);
    assert.equal(result.ok, false);
    assert.equal(result.baselineVerified, false);
    assert.doesNotMatch(JSON.stringify(result), /DO-NOT-EXPOSE/);
  }
});

test('rehashed manifests still reject traversal, aliases and Windows case collisions', async (t) => {
  for (const name of [
    '../secret',
    'C:\\secret',
    '/secret',
    'dist/../secret',
    'dist//secret',
    'dist/secret.',
    'dist/secret ',
  ]) {
    const f = await fixture(t);
    await reseal(f, (v) => {
      v.files[0].path = name;
    });
    const result = await verifyWb022Runtime(f.options);
    assert.equal(result.ok, false);
    assert.ok(result.errors.includes('INVALID_MANIFEST_PATH'), JSON.stringify(result));
  }
  const f = await fixture(t);
  await reseal(f, (v) => {
    v.files.push({ ...v.files[0], path: 'DIST/server.js' });
  });
  assert.deepEqual((await verifyWb022Runtime(f.options)).errors, ['AMBIGUOUS_MANIFEST_PATH']);
});

test('all release gates, tool identity and prior installed counts/digests are required', async (t) => {
  for (const mode of ['gate', 'probe', 'count', 'differences', 'digest']) {
    const f = await fixture(t);
    if (mode === 'gate' || mode === 'probe') {
      await mutate(path.join(f.release, 'validated.json'), (v) => {
        if (mode === 'gate') delete v.checks.generic;
        else v.probe.toolCount = 56;
      });
    } else
      await mutate(f.evidence, (v) => {
        if (mode === 'count') v.checks.runtime.count++;
        if (mode === 'differences') v.checks.runtime.differences.push({ path: 'dist/server.js' });
        if (mode === 'digest') v.manifestSha256 = '1'.repeat(64);
      });
    const result = await verifyWb022Runtime(f.options);
    assert.equal(result.ok, false);
    assert.equal(result.baselineVerified, false);
  }
});

test('sealed payload tampering invalidates baseline and rollback tampering blocks recovery', async (t) => {
  for (const mode of ['payload', 'previous', 'displaced']) {
    const f = await fixture(t);
    const location =
      mode === 'payload'
        ? path.join(f.release, 'payload')
        : mode === 'previous'
          ? path.join(f.operation, 'backup', 'runtime')
          : path.join(f.operation, 'displaced', displacedId);
    await writeFile(path.join(location, 'dist', 'server.js'), 'tampered runtime');
    const result = await verifyWb022Runtime(f.options);
    assert.equal(result.ok, false);
    assert.equal(result.baselineVerified, mode !== 'payload');
    assert.equal(result.recoveryReady, false);
  }
});

test('ambiguous displacement and mismatched previous versions are rejected', async (t) => {
  const f = await fixture(t);
  await mkdir(path.join(f.operation, 'displaced', 'b'.repeat(32)));
  assert.ok((await verifyWb022Runtime(f.options)).errors.includes('AMBIGUOUS_DISPLACED_RUNTIME'));
  await rm(path.join(f.operation, 'displaced', 'b'.repeat(32)), { recursive: true });
  await mutate(path.join(f.operation, 'backup-manifest.json'), (v) => {
    v.version = '0.16.3-dev';
  });
  assert.ok((await verifyWb022Runtime(f.options)).errors.includes('PREVIOUS_VERSION_MISMATCH'));
});

test('rejects runtime and ancestor junctions without following the linked target', async (t) => {
  for (const mode of ['runtime', 'root']) {
    const f = await fixture(t);
    const target = path.join(f.operation, 'candidate', 'dist');
    if (mode === 'runtime') {
      await rm(target, { recursive: true });
      await symlink(path.join(f.root, 'dist'), target, process.platform === 'win32' ? 'junction' : 'dir');
    } else {
      const alias = path.join(path.dirname(f.root), 'alias');
      await symlink(f.root, alias, process.platform === 'win32' ? 'junction' : 'dir');
      f.options.repoRoot = alias;
    }
    const result = await verifyWb022Runtime(f.options);
    assert.equal(result.ok, false);
    assert.equal(result.baselineVerified, false);
    assert.ok(result.errors.some((code) => code.includes('UNSAFE_LINK')));
  }
});

test('invalid options and expired scan return safe bounded diagnostics', async (t) => {
  const f = await fixture(t);
  for (const timeoutMs of [0, -1, 300001, Infinity, '100', 1.5]) {
    assert.deepEqual((await verifyWb022Runtime({ ...f.options, timeoutMs })).errors, ['INVALID_ARGUMENTS']);
  }
  t.mock.method(
    Date,
    'now',
    (() => {
      let n = 0;
      return () => n++ * 10;
    })(),
  );
  const expired = await verifyWb022Runtime({ ...f.options, timeoutMs: 1 });
  assert.deepEqual(expired.errors, ['TIMEOUT']);
});

test('CLI exits 0 for matching fixture, 2 for intact candidate with disk drift and 1 for missing evidence', async (t) => {
  const f = await fixture(t);
  const args = [script, '--repo-root', f.root];
  const run = (extra = []) =>
    spawnSync(process.execPath, [...args, ...extra], { encoding: 'utf8', timeout: 30_000 });
  const good = run();
  assert.equal(good.status, 0, good.stderr + good.stdout);
  assert.equal(JSON.parse(good.stdout).readOnly, true);
  await writeFile(path.join(f.root, 'dist', 'server.js'), 'disk drift');
  const drift = run();
  assert.equal(drift.status, 2, drift.stderr + drift.stdout);
  assert.equal(JSON.parse(drift.stdout).baselineVerified, true);
  await unlink(f.evidence);
  assert.equal(run().status, 1);
  const bad = run(['--deploy']);
  assert.equal(bad.status, 1);
  assert.equal(JSON.parse(bad.stderr).ok, false);
});
