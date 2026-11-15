import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { parseArgs, previewRuntimeRetention } from '../scripts/preview-runtime-retention.mjs';

function scenario({
  version = '1',
  complete = true,
  external = false,
  badManifest = false,
  changeAfterProof = false,
  missingChecks = false,
  reservedName = false,
  prefixCollision = false,
  replaceAfterProof = false,
} = {}) {
  const root = path.join(os.tmpdir(), 'wb-preview-contract');
  const operationRoot = path.join(root, '.local', 'update-operations', 'old');
  const releaseRoot = path.join(root, '.local', 'releases', 'old');
  const digest = 'a'.repeat(64);
  const entries = [
    { path: 'dist/a.js', bytes: 1, sha256: digest },
    { path: 'node_modules/a.js', bytes: 1, sha256: digest },
    { path: 'package.json', bytes: 1, sha256: digest },
    { path: 'package-lock.json', bytes: 1, sha256: digest },
    { path: badManifest ? '../outside' : 'src/source.ts', bytes: 1, sha256: digest },
  ];
  if (reservedName) entries.push({ path: 'src/NUL.txt', bytes: 1, sha256: digest });
  if (prefixCollision) entries.push({ path: 'SRC/source.ts/child', bytes: 1, sha256: digest });
  let verified = false;
  let verifyCalls = 0;
  const data = new Map([
    [path.join(operationRoot, 'request.json'), { value: { releaseDigest: digest }, sha256: 'request' }],
    [
      path.join(operationRoot, 'journal.json'),
      { value: { releaseDigest: digest, version }, sha256: 'journal' },
    ],
    [
      path.join(releaseRoot, 'manifest.json'),
      { value: { schema: 1, version, files: entries }, sha256: digest },
    ],
    [
      path.join(releaseRoot, 'validated.json'),
      {
        value: {
          schema: 1,
          version,
          result: 'passed',
          manifestSha256: digest,
          checks: missingChecks
            ? { test: 0 }
            : { install: 0, tests: 0, startup: 0, updater: 0, format: 0, acceptance: 0 },
        },
        sha256: 'receipt',
      },
    ],
  ]);
  const identity = { dev: '1', ino: '2', size: '3', mtimeNs: '4', ctimeNs: '5', nlink: '1' };
  for (const item of data.values()) item.identity = identity;
  return {
    options: { installRoot: root, operationId: 'old', kind: 'candidate' },
    get verifyCalls() {
      return verifyCalls;
    },
    services: {
      inspect: async () => ({
        complete,
        mutationEligible: false,
        operations: [
          {
            id: 'old',
            phase: 'completed',
            comparisonScopes: ['candidate', 'displaced'],
            requestBinding: { sha256: 'request', identity },
            journalBinding: { sha256: 'journal', identity },
            release: { scope: external ? 'external' : 'internal', path: releaseRoot },
          },
        ],
      }),
      load: async (file) => {
        const item = data.get(file);
        assert.ok(item, `Unexpected metadata open: ${file}`);
        if (replaceAfterProof && verified && file.endsWith('request.json'))
          return { ...item, identity: { ...identity, ino: 'replaced' } };
        return changeAfterProof && verified && file.endsWith('request.json')
          ? { ...item, sha256: 'changed' }
          : item;
      },
      verify: async (options) => {
        verifyCalls++;
        assert.equal(options.retainedRuntimeSubset, true);
        assert.equal(options.manifestFiles.length, 4);
        assert.equal(options.resourceRoot, path.join(operationRoot, 'candidate'));
        assert.equal(options.retainedRoot, path.join(releaseRoot, 'payload'));
        verified = true;
        return { verifiedDuplicate: true, mutationEligible: false };
      },
    },
  };
}

test('a duplicate comparison never authorizes mutation and an incomplete graph stays incomplete', async () => {
  for (const complete of [true, false]) {
    const fixture = scenario({ complete });
    const result = await previewRuntimeRetention(fixture.options, fixture.services);
    assert.equal(result.comparison.verifiedDuplicate, true);
    assert.equal(result.selection.operationId, 'old');
    assert.equal(result.selection.kind, 'candidate');
    assert.equal(result.selection.manifestFileCount, 4);
    assert.equal(result.selection.manifestBinding.sha256, 'a'.repeat(64));
    assert.equal(result.complete, complete);
    assert.equal(result.mutationEligible, false);
    assert.equal(fixture.verifyCalls, 1);
  }
});

test('a changed reference after hashing invalidates the proof', async () => {
  const fixture = scenario({ changeAfterProof: true });
  const result = await previewRuntimeRetention(fixture.options, fixture.services);
  assert.equal(result.complete, false);
  assert.equal(result.comparison.verifiedDuplicate, false);
  assert.equal(result.comparison.invalidated, true);
  assert.deepEqual(result.issues, [{ code: 'REFERENCE_CHANGED' }]);
});

test('same-byte metadata replacement after hashing invalidates the proof', async () => {
  const fixture = scenario({ replaceAfterProof: true });
  const result = await previewRuntimeRetention(fixture.options, fixture.services);
  assert.equal(result.comparison.verifiedDuplicate, false);
  assert.deepEqual(result.issues, [{ code: 'REFERENCE_CHANGED' }]);
});

test('malformed non-runtime manifest entries are refused before hashing', async () => {
  const fixture = scenario({ badManifest: true });
  const result = await previewRuntimeRetention(fixture.options, fixture.services);
  assert.equal(fixture.verifyCalls, 0);
  assert.equal(result.complete, false);
  assert.deepEqual(result.issues, [{ code: 'RELEASE_MANIFEST_INVALID' }]);
});

test('external releases are never opened or passed to the verifier', async () => {
  const fixture = scenario({ external: true });
  const result = await previewRuntimeRetention(fixture.options, fixture.services);
  assert.equal(fixture.verifyCalls, 0);
  assert.deepEqual(result.issues, [{ code: 'RELEASE_OUT_OF_SCOPE' }]);
});

test('a passed label without the required release checks does not bind a seal', async () => {
  const fixture = scenario({ missingChecks: true });
  const result = await previewRuntimeRetention(fixture.options, fixture.services);
  assert.equal(fixture.verifyCalls, 0);
  assert.deepEqual(result.issues, [{ code: 'RELEASE_SEAL_INVALID' }]);
});

test('0.16.4 and 0.16.5 candidate seals both require the GUI validation gates', async () => {
  for (const version of ['0.16.4-dev', '0.16.5-dev']) {
    const missing = scenario({ version });
    const refused = await previewRuntimeRetention(missing.options, missing.services);
    assert.equal(missing.verifyCalls, 0, version);
    assert.deepEqual(refused.issues, [{ code: 'RELEASE_SEAL_INVALID' }], version);

    const complete = scenario({ version });
    const validated = complete.services.load;
    complete.services.load = async (file, options) => {
      const item = await validated(file, options);
      if (file.endsWith('validated.json')) {
        return {
          ...item,
          value: {
            ...item.value,
            checks: {
              ...item.value.checks,
              generic: 0,
              'desktop-stage': 0,
              'desktop-closure': 0,
            },
          },
        };
      }
      return item;
    };
    const accepted = await previewRuntimeRetention(complete.options, complete.services);
    assert.equal(accepted.complete, true, version);
    assert.equal(accepted.comparison.verifiedDuplicate, true, version);
  }
});

test('reserved non-runtime names and file-prefix collisions are refused before hashing', async () => {
  for (const invalid of [{ reservedName: true }, { prefixCollision: true }]) {
    const fixture = scenario(invalid);
    const result = await previewRuntimeRetention(fixture.options, fixture.services);
    assert.equal(fixture.verifyCalls, 0);
    assert.deepEqual(result.issues, [{ code: 'RELEASE_MANIFEST_INVALID' }]);
  }
});

test('CLI selections require an exact bounded operation and paired kind', () => {
  const root = os.tmpdir();
  assert.throws(() => parseArgs(['--install-root', root, '--kind', 'candidate']));
  assert.throws(() => parseArgs(['--install-root', root, '--operation', '../escape', '--kind', 'displaced']));
  assert.throws(() => parseArgs(['--install-root', root, '--max-scan-ms', '60001']));
  assert.throws(() => parseArgs(['--install-root', root, '--purge', 'true']));
  assert.equal(parseArgs(['--install-root', root]).installRoot, path.resolve(root));
});
