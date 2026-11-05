import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/Plan-WorkbridgeBaselineRepair.ps1', import.meta.url));
const windows = { skip: process.platform !== 'win32' };
const baselineVersion = '0.16.3-dev';
const candidateVersion = '0.16.4-dev';
const secret = 'PRIVATE_BASELINE_SENTINEL_NEVER_PRINT';
const digest = (value) => createHash('sha256').update(value).digest('hex').toUpperCase();
const json = (value) => JSON.stringify(value);

async function put(root, relative, value) {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, typeof value === 'string' ? value : json(value));
}

async function snapshot(root) {
  const result = {};
  async function visit(relative = '') {
    for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
      const child = path.join(relative, entry.name);
      if (entry.isSymbolicLink()) result[child] = `link:${await readlink(path.join(root, child))}`;
      else if (entry.isDirectory()) {
        result[child] = 'directory';
        await visit(child);
      } else result[child] = digest(await readFile(path.join(root, child)));
    }
  }
  await visit();
  return result;
}

async function seal(root, version) {
  const entries = {
    'package.json': json({ name: 'workbridge-mcp', version }),
    'package-lock.json': '{}',
    'dist/server.js': `const version = '${version}';\nthrow new Error('${secret}');\n`,
    'node_modules/synthetic/index.js': `throw new Error('${secret}');\n`,
  };
  if (version === candidateVersion) {
    const desktopNames = [
      'desktop-ui.mjs',
      'desktop-capture.mjs',
      'vmware-host-capture.mjs',
      'desktop-probe-act.mjs',
      'desktop-turn-admission.mjs',
      'Check-DesktopWindowHandle.ps1',
    ];
    const desktopFiles = [];
    for (const name of desktopNames) {
      const content = `sealed synthetic helper: ${name}\n`;
      entries[`scripts/${name}`] = content;
      entries[`dist/${name}`] = content;
      desktopFiles.push({
        name,
        sizeBytes: Buffer.byteLength(content),
        sha256: digest(content).toLowerCase(),
      });
    }
    entries['dist/desktop-runtime-manifest.json'] = json({ schemaVersion: 1, files: desktopFiles });
  }
  for (const [name, value] of Object.entries(entries)) await put(root, `payload/${name}`, value);
  const manifest = {
    schema: 1,
    version,
    files: Object.entries(entries).map(([name, value]) => ({
      path: name.replaceAll('/', '\\'),
      bytes: Buffer.byteLength(value),
      sha256: digest(value),
    })),
  };
  await put(root, 'manifest.json', manifest);
  const pin = digest(json(manifest));
  await put(root, 'validated.json', {
    schema: 1,
    result: 'passed',
    version,
    manifestSha256: pin,
    checks: {
      install: 0,
      tests: 0,
      startup: 0,
      updater: 0,
      format: 0,
      generic: 0,
      acceptance: 0,
      ...(version === candidateVersion ? { 'desktop-stage': 0, 'desktop-closure': 0 } : {}),
    },
    hostedVerified: false,
  });
  return { root, pin, manifest, entries };
}

async function fixture(t, diskVersion = candidateVersion) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wb-baseline-plan-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.match(path.basename(root), /^wb-baseline-plan-[A-Za-z0-9]+$/);
    await rm(root, { recursive: true, force: true });
  });
  const baseline = await seal(path.join(root, 'last-good'), baselineVersion);
  const candidate = await seal(path.join(root, 'candidate'), candidateVersion);
  const install = path.join(root, 'install');
  const disk = diskVersion === baselineVersion ? baseline : candidate;
  for (const [name, value] of Object.entries(disk.entries)) await put(install, name, value);
  await put(install, '.local/installed-release.json', {
    schema: 1,
    version: baselineVersion,
    releaseDigest: baseline.pin,
    operationId: null,
  });
  await put(install, '.local/tunnel-credentials.bin', secret);
  await put(install, '.local/control-channel.json', { token: secret });
  let requests = 0;
  let liveVersion = baselineVersion;
  let ready = true;
  const http = createServer((req, res) => {
    requests++;
    assert.equal(req.method, 'GET');
    assert.equal(req.url, '/health?details=true');
    assert.equal(req.headers.authorization, undefined);
    res.end(
      json({
        ready,
        components: { mcp: { details: { initialize: { server_version: liveVersion } } } },
        private: secret,
      }),
    );
  });
  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  t.after(() => new Promise((resolve) => http.close(resolve)));
  await put(install, '.local/health-url.txt', `http://127.0.0.1:${http.address().port}`);
  return {
    root,
    baseline,
    candidate,
    install,
    get requests() {
      return requests;
    },
    setLive(version, isReady = true) {
      liveVersion = version;
      ready = isReady;
    },
  };
}

async function plan(f, overrides = {}, expectedExit = 0) {
  const values = {
    InstallRoot: f.install,
    LastGoodReleasePath: f.baseline.root,
    LastGoodVersion: baselineVersion,
    LastGoodManifestSha256: f.baseline.pin,
    CandidateReleasePath: f.candidate.root,
    CandidateVersion: candidateVersion,
    CandidateManifestSha256: f.candidate.pin,
    LiveHealth: true,
    ...overrides,
  };
  const args = Object.entries(values).flatMap(([key, value]) =>
    typeof value === 'boolean' ? (value ? [`-${key}`] : []) : [`-${key}`, value],
  );
  const before = await snapshot(f.root);
  const child = spawn(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script, ...args],
    {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (value) => (stdout += value));
  child.stderr.setEncoding('utf8').on('data', (value) => (stderr += value));
  const timer = setTimeout(() => child.kill(), 30_000);
  let exit;
  try {
    [exit] = await once(child, 'close');
  } finally {
    clearTimeout(timer);
  }
  assert.equal(exit, expectedExit, stderr || stdout);
  assert.equal(stderr, '');
  assert.ok(Buffer.byteLength(stdout) < 32768, 'bounded JSON output');
  assert.ok(!stdout.includes(secret), 'private data/runtime code must never be echoed');
  assert.deepEqual(await snapshot(f.root), before, 'planning must not change any fixture bytes or paths');
  const report = JSON.parse(stdout);
  assert.equal(report.readOnly, true);
  assert.equal(report.automatic, false);
  assert.equal(report.productionRepairAuthorized, false);
  assert.equal(report.hostedVerified, false);
  assert.ok(report.proposedSteps.every((step) => step.automatic === false));
  if (!report.ok) assert.deepEqual(report.proposedSteps, []);
  return report;
}

test('disk mismatch yields a deterministic read-only advisory with pinned seals', windows, async (t) => {
  const f = await fixture(t);
  const report = await plan(f);
  assert.equal(report.ok, true);
  assert.equal(report.repairRequired, true);
  assert.deepEqual(report.blockers, []);
  assert.equal(report.baseline.manifestSha256, f.baseline.pin);
  assert.equal(report.candidate.manifestSha256, f.candidate.pin);
  assert.equal(report.baseline.sealedVerified, true);
  assert.equal(report.diagnosis.live.version, baselineVersion);
  assert.equal(report.diagnosis.disk.builtVersion, candidateVersion);
  assert.equal(report.proposedSteps.at(-1).code, 'REVIEW_BASELINE_RESTORATION');
  assert.match(report.proposedSteps.at(-1).description, /must not be bypassed/);
  assert.deepEqual(await plan(f), report);
  assert.equal(f.requests, 2);
});

test('clean baseline does not propose restoration', windows, async (t) => {
  const f = await fixture(t, baselineVersion);
  const report = await plan(f);
  assert.equal(report.repairRequired, false);
  assert.equal(report.proposedSteps.at(-1).code, 'NO_BASELINE_REPAIR_PROPOSED');
});

for (const which of ['baseline', 'candidate']) {
  for (const mode of [
    'missing receipt',
    'corrupt payload',
    'wrong pin',
    'wrong version',
    'failed check',
    'missing generic gate',
    'coercible gate',
    'corrupt manifest',
    'coercible schema',
    'sealed wrong build',
  ]) {
    test(`${which}: ${mode} blocks the proposal`, windows, async (t) => {
      const f = await fixture(t);
      const release = f[which];
      const overrides = {};
      const prefix = which === 'baseline' ? 'LastGood' : 'Candidate';
      if (mode === 'missing receipt') await rm(path.join(release.root, 'validated.json'));
      if (mode === 'corrupt payload')
        await put(release.root, 'payload/node_modules/synthetic/index.js', secret);
      if (mode === 'wrong pin') overrides[`${prefix}ManifestSha256`] = 'A'.repeat(64);
      if (mode === 'wrong version') overrides[`${prefix}Version`] = '8.8.8-dev';
      if (mode === 'corrupt manifest') await put(release.root, 'manifest.json', `{${secret}`);
      if (['coercible schema', 'sealed wrong build'].includes(mode)) {
        const manifest = structuredClone(release.manifest);
        if (mode === 'coercible schema') manifest.schema = '1';
        else {
          const built = "const version = '8.8.8-dev';\n";
          await put(release.root, 'payload/dist/server.js', built);
          const entry = manifest.files.find((entry) => entry.path === 'dist\\server.js');
          entry.sha256 = digest(built);
          entry.bytes = Buffer.byteLength(built);
        }
        const pin = digest(json(manifest));
        await put(release.root, 'manifest.json', manifest);
        const receipt = JSON.parse(await readFile(path.join(release.root, 'validated.json'), 'utf8'));
        receipt.manifestSha256 = pin;
        await put(release.root, 'validated.json', receipt);
        overrides[`${prefix}ManifestSha256`] = pin;
      }
      if (['failed check', 'missing generic gate', 'coercible gate'].includes(mode)) {
        const receipt = JSON.parse(await readFile(path.join(release.root, 'validated.json'), 'utf8'));
        if (mode === 'failed check') receipt.checks.tests = 1;
        if (mode === 'missing generic gate') delete receipt.checks.generic;
        if (mode === 'coercible gate') receipt.checks.tests = '0';
        await put(release.root, 'validated.json', receipt);
      }
      const report = await plan(f, overrides, 1);
      assert.ok(
        report.blockers.includes(
          which === 'baseline' ? 'LAST_GOOD_SEAL_UNVERIFIED' : 'CANDIDATE_SEAL_UNVERIFIED',
        ),
      );
    });
  }
}

test('missing baseline directory and oversized metadata are rejected', windows, async (t) => {
  const f = await fixture(t);
  await plan(f, { LastGoodReleasePath: path.join(f.root, 'absent') }, 1);
  await put(f.baseline.root, 'validated.json', ' '.repeat(256 * 1024 + 1));
  assert.ok((await plan(f, {}, 1)).blockers.includes('LAST_GOOD_SEAL_UNVERIFIED'));
});

for (const mode of [
  'marker version',
  'marker digest',
  'marker missing',
  'health version',
  'health not ready',
  'offline',
  'disk hash',
  'disk version',
  'operation',
]) {
  test(`identity guard: ${mode}`, windows, async (t) => {
    const f = await fixture(t);
    const overrides = {};
    if (mode.startsWith('marker')) {
      if (mode === 'marker missing') await rm(path.join(f.install, '.local/installed-release.json'));
      else
        await put(f.install, '.local/installed-release.json', {
          schema: 1,
          operationId: null,
          version: mode === 'marker version' ? candidateVersion : baselineVersion,
          releaseDigest: mode === 'marker digest' ? 'B'.repeat(64) : f.baseline.pin,
        });
    }
    if (mode === 'health version') f.setLive(candidateVersion);
    if (mode === 'health not ready') f.setLive(baselineVersion, false);
    if (mode === 'offline') overrides.LiveHealth = false;
    if (mode === 'disk hash')
      await put(f.install, 'dist/server.js', `const version = '${candidateVersion}';\n// changed\n`);
    if (mode === 'disk version')
      await put(f.install, 'package.json', { name: 'workbridge-mcp', version: '8.8.8' });
    if (mode === 'operation') {
      overrides.OperationId = 'interrupted';
      await put(f.install, '.local/update-operations/interrupted/journal.json', {
        operationId: 'interrupted',
        installRoot: f.install,
        phase: 'recovery_required',
        error: secret,
        recoveryError: secret,
      });
    }
    assert.equal((await plan(f, overrides, 1)).ok, false);
    if (mode === 'offline') assert.equal(f.requests, 0);
  });
}

test(
  'untrusted manifest traversal and duplicate aliases fail closed even when repinned',
  windows,
  async (t) => {
    const f = await fixture(t);
    for (const unsafe of [
      '..\\outside',
      'C:\\outside',
      'dist\\server.js:secret',
      'dist\\..\\dist\\server.js',
      'dist\\server.js.',
    ]) {
      const manifest = structuredClone(f.baseline.manifest);
      manifest.files[0].path = unsafe;
      const pin = digest(json(manifest));
      await put(f.baseline.root, 'manifest.json', manifest);
      const receipt = JSON.parse(await readFile(path.join(f.baseline.root, 'validated.json'), 'utf8'));
      receipt.manifestSha256 = pin;
      await put(f.baseline.root, 'validated.json', receipt);
      assert.ok(
        (await plan(f, { LastGoodManifestSha256: pin }, 1)).blockers.includes('LAST_GOOD_SEAL_UNVERIFIED'),
      );
    }
    const manifest = structuredClone(f.baseline.manifest);
    manifest.files[1].path = manifest.files[0].path.toUpperCase();
    const pin = digest(json(manifest));
    await put(f.baseline.root, 'manifest.json', manifest);
    const receipt = JSON.parse(await readFile(path.join(f.baseline.root, 'validated.json'), 'utf8'));
    receipt.manifestSha256 = pin;
    await put(f.baseline.root, 'validated.json', receipt);
    assert.ok(
      (await plan(f, { LastGoodManifestSha256: pin }, 1)).blockers.includes('LAST_GOOD_SEAL_UNVERIFIED'),
    );
  },
);

test(
  'junctions in roots, payloads, metadata ancestors and installed paths are rejected',
  windows,
  async (t) => {
    const f = await fixture(t);
    const link = path.join(f.root, 'release-link');
    await symlink(f.baseline.root, link, 'junction');
    assert.ok(
      (await plan(f, { LastGoodReleasePath: link }, 1)).blockers.includes('LAST_GOOD_SEAL_UNVERIFIED'),
    );
    await symlink(f.install, path.join(f.root, 'install-link'), 'junction');
    await plan(f, { InstallRoot: path.join(f.root, 'install-link') }, 2);
    await symlink(f.candidate.root, path.join(f.baseline.root, 'payload/linked'), 'junction');
    assert.ok((await plan(f, {}, 1)).blockers.includes('LAST_GOOD_SEAL_UNVERIFIED'));
    await rm(path.join(f.baseline.root, 'payload/linked'));
    await rm(path.join(f.baseline.root, 'payload/dist'), { recursive: true });
    await symlink(
      path.join(f.candidate.root, 'payload/dist'),
      path.join(f.baseline.root, 'payload/dist'),
      'junction',
    );
    assert.ok((await plan(f, {}, 1)).blockers.includes('LAST_GOOD_SEAL_UNVERIFIED'));
  },
);

test(
  'installed metadata junction is rejected without following health or credentials',
  windows,
  async (t) => {
    const f = await fixture(t);
    await rm(path.join(f.install, '.local'), { recursive: true });
    await symlink(f.candidate.root, path.join(f.install, '.local'), 'junction');
    assert.ok((await plan(f, {}, 1)).blockers.includes('INSTALLED_BASELINE_MARKER_MISMATCH'));
    assert.equal(f.requests, 0);
  },
);

test('unsafe argument paths and operation IDs produce bounded blockers', windows, async (t) => {
  const f = await fixture(t);
  for (const overrides of [
    { InstallRoot: `${f.install}\\..\\install` },
    { InstallRoot: '\\\\localhost\\share' },
    { InstallRoot: `${f.install}:stream` },
    { OperationId: `../${secret}` },
    { LastGoodManifestSha256: secret },
  ])
    await plan(f, overrides, 2);
});
