import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/Diagnose-WorkbridgeRelease.ps1', import.meta.url));
const windows = { skip: process.platform !== 'win32' };
const version = '0.16.3-dev';
const secret = 'PRIVATE_RELEASE_SENTINEL_DO_NOT_ECHO';
const digest = (value) => createHash('sha256').update(value).digest('hex').toUpperCase();
const marker = { schema: 1, version, operationId: null, releaseDigest: null };
const health = (v = version, ready = true) => ({
  ready,
  components: { mcp: { details: { initialize: { server_version: v } } } },
  private: secret,
});

async function put(root, relative, value) {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, typeof value === 'string' ? value : JSON.stringify(value));
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wb-release-diagnose-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.match(path.basename(root), /^wb-release-diagnose-[A-Za-z0-9]+$/);
    await rm(root, { recursive: true, force: true });
  });
  await put(root, 'package.json', { name: 'workbridge-mcp', version });
  await put(root, 'dist/server.js', `const version = '${version}';\nthrow new Error('${secret}');\n`);
  await put(root, '.local/installed-release.json', marker);
  // Unrelated private state must not be traversed or copied by diagnosis.
  await put(root, '.local/control-channel.json', { token: secret });
  await put(root, '.local/tunnel-credentials.bin', secret);
  return root;
}

async function snapshot(root) {
  const result = {};
  async function visit(relative = '') {
    for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
      const child = path.join(relative, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (!entry.isSymbolicLink()) result[child] = digest(await readFile(path.join(root, child)));
    }
  }
  await visit();
  return result;
}

async function diagnose(root, args = [], expectedExit = 0) {
  const child = spawn(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script, '-InstallRoot', root, ...args],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (value) => (stdout += value));
  child.stderr.setEncoding('utf8').on('data', (value) => (stderr += value));
  const timer = setTimeout(() => child.kill(), 15_000);
  let exit;
  try {
    [exit] = await once(child, 'close');
  } finally {
    clearTimeout(timer);
  }
  assert.equal(exit, expectedExit, stderr || stdout);
  assert.equal(stderr, '');
  assert.ok(!stdout.includes(secret));
  const report = JSON.parse(stdout.trim());
  assert.equal(report.readOnly, true);
  assert.equal(report.hostedVerified, false);
  assert.equal(report.integrityVerified, false);
  assert.equal(report.recovery.automatic, false);
  return report;
}

async function server(t, handler) {
  const http = createServer(handler);
  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  t.after(() => new Promise((resolve) => http.close(resolve)));
  return `http://127.0.0.1:${http.address().port}`;
}

test(
  'offline matching identities are read without executing runtime or querying health',
  windows,
  async (t) => {
    const root = await fixture(t);
    let requests = 0;
    const url = await server(t, (_req, res) => {
      requests++;
      res.end(JSON.stringify(health()));
    });
    await put(root, '.local/health-url.txt', url);
    const before = await snapshot(root);
    const report = await diagnose(root);
    assert.equal(report.ok, true);
    assert.equal(report.disk.serverSha256, digest(await readFile(path.join(root, 'dist/server.js'))));
    assert.deepEqual(report.comparisons, {
      packageToBuild: 'match',
      installedToBuild: 'match',
      liveToBuild: 'unknown',
      liveToInstalled: 'unknown',
    });
    assert.equal(report.live.status, 'not_requested');
    assert.equal(report.recovery.code, 'OPT_IN_LIVE_HEALTH');
    assert.equal(requests, 0);
    assert.deepEqual(await snapshot(root), before);
  },
);

test(
  'live/disk mismatch preserves separate identities and recommends baseline verification',
  windows,
  async (t) => {
    const root = await fixture(t);
    await put(root, 'dist/server.js', "const version = '0.16.4-dev';\n");
    await put(root, 'package.json', { name: 'workbridge-mcp', version: '0.16.4-dev' });
    const url = await server(t, (req, res) => {
      assert.equal(req.method, 'GET');
      assert.equal(req.url, '/health?details=true');
      assert.equal(req.headers.authorization, undefined);
      res.end(JSON.stringify(health()));
    });
    await put(root, '.local/health-url.txt', url);
    const before = await snapshot(root);
    const report = await diagnose(root, ['-LiveHealth'], 1);
    assert.equal(report.installed.version, version);
    assert.equal(report.live.version, version);
    assert.equal(report.disk.builtVersion, '0.16.4-dev');
    assert.equal(report.comparisons.liveToInstalled, 'match');
    assert.equal(report.comparisons.liveToBuild, 'mismatch');
    assert.deepEqual(report.findings, ['INSTALLED_BUILD_MISMATCH', 'LIVE_BUILD_MISMATCH']);
    assert.equal(report.recovery.code, 'PRESERVE_OWNER_VERIFY_BASELINE');
    assert.match(report.recovery.guidance.join(' '), /Do not rebuild or force-restart/);
    assert.deepEqual(await snapshot(root), before);
  },
);

test('package edits do not substitute for built identity, including BOM byte hashing', windows, async (t) => {
  const root = await fixture(t);
  await put(root, 'package.json', { name: 'workbridge-mcp', version: '9.9.9-source' });
  await put(root, 'dist/server.js', `\uFEFFconst version = '${version}';\r\n`);
  const report = await diagnose(root, [], 1);
  assert.equal(report.disk.builtVersion, version);
  assert.equal(report.disk.serverSha256, digest(await readFile(path.join(root, 'dist/server.js'))));
  assert.deepEqual(report.findings, ['PACKAGE_BUILD_MISMATCH']);
});

test(
  'fully matching live evidence still does not claim deployment or integrity acceptance',
  windows,
  async (t) => {
    const root = await fixture(t);
    await put(
      root,
      '.local/health-url.txt',
      await server(t, (_req, res) => res.end(JSON.stringify(health()))),
    );
    const report = await diagnose(root, ['-LiveHealth']);
    assert.equal(report.comparisons.liveToBuild, 'match');
    assert.equal(report.recovery.code, 'REVIEW_WB001_PLAN');
    assert.equal(report.live.ready, true);
  },
);

for (const [name, value, finding] of [
  ['malformed package', ['package.json', `{ ${secret}`], 'PACKAGE_IDENTITY_UNVERIFIED'],
  ['missing built literal', ['dist/server.js', secret], 'BUILT_IDENTITY_UNVERIFIED'],
  [
    'ambiguous built literals',
    ['dist/server.js', `const version = '${version}';\nconst version = '1.2.3';`],
    'BUILT_IDENTITY_UNVERIFIED',
  ],
  ['malformed marker', ['.local/installed-release.json', `{ ${secret}`], 'INSTALLED_MARKER_INVALID'],
  ['oversized marker', ['.local/installed-release.json', ' '.repeat(65537)], 'INSTALLED_MARKER_INVALID'],
  [
    'unsafe marker identity',
    ['.local/installed-release.json', { ...marker, operationId: `../${secret}` }],
    'INSTALLED_MARKER_INVALID',
  ],
]) {
  test(`incomplete evidence: ${name}`, windows, async (t) => {
    const root = await fixture(t);
    await put(root, ...value);
    const before = await snapshot(root);
    const report = await diagnose(root, [], 1);
    assert.ok(report.findings.includes(finding));
    assert.equal(report.recovery.code, 'COMPLETE_IDENTITY_EVIDENCE');
    assert.deepEqual(await snapshot(root), before);
  });
}

test('missing marker and build are unknown evidence rather than mismatches', windows, async (t) => {
  const root = await fixture(t);
  await rm(path.join(root, '.local/installed-release.json'));
  await rm(path.join(root, 'dist/server.js'));
  const report = await diagnose(root, [], 1);
  assert.ok(report.findings.includes('INSTALLED_MARKER_MISSING'));
  assert.ok(report.findings.includes('BUILT_IDENTITY_UNVERIFIED'));
  assert.equal(report.comparisons.installedToBuild, 'unknown');
});

test(
  'operation selection projects safe metadata, never raw errors or Recover promises',
  windows,
  async (t) => {
    const root = await fixture(t);
    await put(root, '.local/installed-release.json', {
      ...marker,
      operationId: 'prior-op',
      releaseDigest: 'A'.repeat(64),
    });
    await put(root, '.local/update-operations/prior-op/journal.json', {
      operationId: 'prior-op',
      installRoot: root,
      phase: 'completed',
      error: null,
      recoveryError: null,
    });
    let report = await diagnose(root);
    assert.equal(report.operation.phase, 'completed');
    assert.equal(report.installed.releaseDigest, 'A'.repeat(64));
    await put(root, '.local/update-operations/failed-op/controller-error.json', `{ ${secret}`);
    const before = await snapshot(root);
    report = await diagnose(root, ['-OperationId', 'failed-op'], 1);
    assert.equal(report.operation.journalPresent, false);
    assert.equal(report.operation.controllerErrorPresent, true);
    assert.equal(report.recovery.code, 'REVIEW_RETAINED_OPERATION');
    assert.match(report.recovery.guidance.join(' '), /absent journal does not establish a supported Recover/);
    assert.deepEqual(await snapshot(root), before);
  },
);

test('interrupted operation retains phase and error flags without private text', windows, async (t) => {
  const root = await fixture(t);
  await put(root, '.local/update-operations/interrupted/journal.json', {
    operationId: 'interrupted',
    installRoot: root,
    phase: 'recovery_required',
    error: secret,
    recoveryError: secret,
  });
  const report = await diagnose(root, ['-OperationId', 'interrupted'], 1);
  assert.equal(report.operation.phase, 'recovery_required');
  assert.equal(report.operation.errorPresent, true);
  assert.equal(report.operation.recoveryErrorPresent, true);
});

test('invalid operation ID cannot escape the allowlisted metadata paths', windows, async (t) => {
  const root = await fixture(t);
  const report = await diagnose(root, ['-OperationId', `../${secret}`], 1);
  assert.equal(report.operation.operationId, null);
  assert.ok(report.findings.includes('OPERATION_ID_INVALID'));
});

for (const url of [
  `http://${secret}@example.invalid:80`,
  'http://127.0.0.1:0',
  'http://127.0.0.1:65536',
  'http://localhost:80',
]) {
  test(
    `health URL fails closed: ${url.includes(secret) ? 'credential-bearing URL' : url}`,
    windows,
    async (t) => {
      const root = await fixture(t);
      await put(root, '.local/health-url.txt', url);
      const report = await diagnose(root, ['-LiveHealth'], 1);
      assert.equal(report.live.status, 'unavailable_or_invalid');
      assert.deepEqual(report.findings, ['LIVE_HEALTH_UNVERIFIED']);
    },
  );
}

for (const [name, value] of [
  ['missing version', { ready: true, private: secret }],
  ['nonboolean readiness', health(version, 'true')],
  ['not ready', health(version, false)],
  ['oversized body', { private: secret.repeat(4096) }],
]) {
  test(`unusable health: ${name}`, windows, async (t) => {
    const root = await fixture(t);
    await put(root, '.local/health-url.txt', await server(t, (_req, res) => res.end(JSON.stringify(value))));
    const report = await diagnose(root, ['-LiveHealth'], 1);
    assert.equal(report.ok, false);
    assert.ok(report.findings.some((code) => ['LIVE_NOT_READY', 'LIVE_HEALTH_UNVERIFIED'].includes(code)));
  });
}

test('redirects are rejected and slow responses have a total body deadline', windows, async (t) => {
  const root = await fixture(t);
  let followed = 0;
  const target = await server(t, (_req, res) => {
    followed++;
    res.end(JSON.stringify(health()));
  });
  const redirect = await server(t, (_req, res) => {
    res.writeHead(302, { location: target });
    res.end();
  });
  await put(root, '.local/health-url.txt', redirect);
  assert.equal((await diagnose(root, ['-LiveHealth'], 1)).live.status, 'unavailable_or_invalid');
  assert.equal(followed, 0);
  const slow = await server(t, (_req, res) => {
    res.write('{');
    const timer = setInterval(() => res.write(' '), 100);
    res.on('close', () => clearInterval(timer));
  });
  await put(root, '.local/health-url.txt', slow);
  const started = Date.now();
  assert.equal((await diagnose(root, ['-LiveHealth'], 1)).live.status, 'unavailable_or_invalid');
  assert.ok(Date.now() - started < 10_000);
});

test(
  'junctions and absent roots fail closed; unrelated private links are not traversed',
  windows,
  async (t) => {
    const root = await fixture(t);
    const link = path.join(root, 'install-link');
    await symlink(root, link, 'junction');
    assert.deepEqual((await diagnose(link, [], 2)).findings, ['INSTALL_ROOT_INVALID']);
    await diagnose(root); // Unrelated link is ignored, not recursively inventoried.
    assert.deepEqual((await diagnose(path.join(root, 'missing'), [], 2)).findings, ['INSTALL_ROOT_INVALID']);
    await rm(path.join(root, '.local'), { recursive: true });
    await symlink(path.join(root, 'dist'), path.join(root, '.local'), 'junction');
    const report = await diagnose(root, [], 1);
    assert.ok(report.findings.includes('INSTALLED_MARKER_INVALID'));
  },
);
