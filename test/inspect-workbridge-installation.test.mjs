import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const inspector = fileURLToPath(new URL('../scripts/Inspect-WorkbridgeInstallation.ps1', import.meta.url));
const windows = { skip: process.platform !== 'win32' };
const version = '0.16.4-dev';
const secret = 'PRIVATE_DIAGNOSTIC_SENTINEL_DO_NOT_PRINT';
const launcherScripts = [
  'Start-BackgroundTunnel.ps1',
  'Start-Tunnel.ps1',
  'Tunnel-Credential.ps1',
  'Tunnel-ProcessLifetime.cs',
];
const desktopScripts = [
  'desktop-ui.mjs',
  'desktop-capture.mjs',
  'vmware-host-capture.mjs',
  'desktop-probe-act.mjs',
  'Check-DesktopWindowHandle.ps1',
];
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex').toUpperCase();

async function put(root, relative, value) {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, typeof value === 'string' ? value : JSON.stringify(value));
}

async function files(root, prefix = '') {
  const result = [];
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...(await files(root, relative)));
    else result.push(relative);
  }
  return result.sort();
}

async function snapshot(root) {
  return Object.fromEntries(
    await Promise.all(
      (await files(root)).map(async (file) => [file, digest(await readFile(path.join(root, file)))]),
    ),
  );
}

async function installation(root, { desktop = false, built = version, pkg = built } = {}) {
  await put(root, 'package.json', { name: 'workbridge-mcp', version: pkg });
  await put(root, 'package-lock.json', {});
  await put(root, 'node_modules/fixture/index.js', '// inert dependency');
  await put(
    root,
    'dist/server.js',
    `const version = '${built}';\nthrow new Error('${secret}: server must never execute');\n`,
  );
  for (const file of [...launcherScripts, ...(desktop ? desktopScripts : [])]) {
    await put(root, `scripts/${file}`, `inert fixture ${file}`);
  }
  if (desktop) await put(root, 'dist/desktop-cli-runner.js', '// desktop dependency signal');
}

async function seal(root, mutateManifest = (value) => value, mutateReceipt = (value) => value) {
  const payload = path.join(root, 'payload');
  const entries = await Promise.all(
    (await files(payload)).map(async (relative) => {
      const bytes = await readFile(path.join(payload, relative));
      return { path: relative.replaceAll(path.sep, '\\'), bytes: bytes.length, sha256: digest(bytes) };
    }),
  );
  const manifest = JSON.stringify(mutateManifest({ schema: 1, version, files: entries }));
  await put(root, 'manifest.json', manifest);
  await put(
    root,
    'validated.json',
    mutateReceipt({
      schema: 1,
      result: 'passed',
      version,
      manifestSha256: digest(manifest),
      checks: { install: 0, tests: 0, startup: 0, updater: 0, format: 0, generic: 0, acceptance: 0 },
    }),
  );
}

async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wb-install-inspector-'));
  t.after(async () => {
    const resolved = path.resolve(root);
    const parent = path.resolve(os.tmpdir()) + path.sep;
    assert.ok(resolved.startsWith(parent));
    assert.match(path.basename(resolved), /^wb-install-inspector-[A-Za-z0-9]+$/);
    await rm(resolved, { recursive: true, force: true });
  });
  const install = path.join(root, 'installation with spaces');
  const release = path.join(root, 'sealed release');
  await installation(install, options);
  await installation(path.join(release, 'payload'), options);
  await seal(release);
  return { root, install, release };
}

async function inspect(install, args = [], expectedExit = 0) {
  const child = spawn(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', inspector, '-InstallRoot', install, ...args],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
  const timer = setTimeout(() => child.kill(), 20_000);
  let exit;
  try {
    [exit] = await once(child, 'exit');
  } finally {
    clearTimeout(timer);
  }
  assert.equal(exit, expectedExit, stderr || stdout);
  assert.equal(stderr, '');
  assert.ok(!stdout.includes(secret), 'raw private content must never be emitted');
  const report = JSON.parse(stdout.trim());
  assert.equal(report.readOnly, true);
  assert.equal(report.hostedVerified, false);
  assert.equal(report.nextAction.automatic, false);
  return report;
}

async function healthServer(t, handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

function health(version, ready = true) {
  return {
    ready,
    components: { mcp: { details: { initialize: { server_version: version } } } },
    private: secret,
  };
}
const codes = (report) => report.issues.map((finding) => finding.code);

test(
  'offline inspection validates a seal and does not query health or change any fixture bytes',
  windows,
  async (t) => {
    const f = await fixture(t, { desktop: true });
    let requests = 0;
    const url = await healthServer(t, (_req, res) => {
      requests++;
      res.end(JSON.stringify(health('0.16.3-dev')));
    });
    await put(f.install, '.local/health-url.txt', url);
    await put(f.install, '.local/installed-release.json', {
      schema: 1,
      version,
      operationId: 'prior-install',
      releaseDigest: 'A'.repeat(64),
      private: secret,
    });
    await put(f.install, '.local/ipc/endpoint.dpapi', secret);
    const before = await snapshot(f.root);
    const report = await inspect(f.install, ['-CandidateRelease', f.release]);
    assert.equal(report.ok, true);
    assert.equal(report.installation.packageVersion, version);
    assert.equal(report.installation.builtVersion, version);
    assert.equal(report.candidate.sealed, true);
    assert.equal(report.candidate.checksPassed, true);
    assert.equal(report.candidate.scripts.length, 9);
    assert.equal(report.candidate.scriptGaps.length, 0);
    assert.equal(report.marker.matchesDisk, true);
    assert.equal(report.live.status, 'not_requested');
    assert.equal(report.live.version, null);
    assert.equal(report.nextAction.code, 'OPT_IN_LIVE_HEALTH');
    assert.equal(requests, 0);
    assert.deepEqual(await snapshot(f.root), before);
  },
);

test(
  'GUI006 disk/live mismatch, stale marker and pre-journal controller error remain separate evidence',
  windows,
  async (t) => {
    const f = await fixture(t);
    const url = await healthServer(t, (req, res) => {
      assert.equal(req.url, '/health?details=true');
      assert.equal(req.method, 'GET');
      assert.equal(req.headers.authorization, undefined);
      res.end(JSON.stringify(health('0.16.3-dev')));
    });
    await put(f.install, '.local/health-url.txt', url);
    await put(f.install, '.local/installed-release.json', {
      schema: 1,
      version: '0.16.3-dev',
      operationId: 'wb022',
      releaseDigest: null,
    });
    await put(f.install, '.local/update-operations/gui006-activate-20261026-01/controller-error.json', {
      error: secret,
    });
    const before = await snapshot(f.root);
    const report = await inspect(f.install, ['-CandidateRelease', f.release, '-LiveHealth'], 1);
    assert.equal(report.installation.builtVersion, '0.16.4-dev');
    assert.equal(report.live.version, '0.16.3-dev');
    assert.equal(report.live.matchesDisk, false);
    assert.equal(report.marker.version, '0.16.3-dev');
    assert.equal(report.marker.matchesDisk, false);
    assert.equal(report.candidate.sealed, true);
    assert.equal(report.operations[0].journalPresent, false);
    assert.equal(report.operations[0].controllerErrorPresent, true);
    assert.ok(codes(report).includes('DISK_LIVE_VERSION_MISMATCH'));
    assert.ok(codes(report).includes('UPDATE_CONTROLLER_ERROR'));
    assert.equal(report.nextAction.code, 'RESOLVE_DISK_LIVE_MISMATCH');
    assert.deepEqual(await snapshot(f.root), before);
  },
);

test('a sealed GUI candidate exposes missing scripts outside WB001 copy boundary', windows, async (t) => {
  const f = await fixture(t);
  await installation(path.join(f.release, 'payload'), { desktop: true });
  await seal(f.release);
  const report = await inspect(f.install, ['-CandidateRelease', f.release], 1);
  assert.equal(report.candidate.sealed, true);
  assert.deepEqual(
    report.candidate.scriptGaps.map((row) => row.path).sort(),
    desktopScripts.map((name) => `scripts/${name}`).sort(),
  );
  assert.ok(
    report.candidate.scriptGaps.every((row) => row.installed === 'missing' && row.copiedByWB001 === false),
  );
  assert.equal(report.nextAction.code, 'REVIEW_SCRIPT_PACKAGING');
});

test('stale installed script hashes also block a candidate even when all files exist', windows, async (t) => {
  const f = await fixture(t, { desktop: true });
  await put(f.install, 'scripts/desktop-ui.mjs', 'old installed adapter');
  const report = await inspect(f.install, ['-CandidateRelease', f.release], 1);
  assert.deepEqual(report.candidate.scriptGaps, [
    { path: 'scripts/desktop-ui.mjs', installed: 'different', copiedByWB001: false },
  ]);
});

for (const [name, corrupt] of [
  ['tampered payload', async (f) => put(f.release, 'payload/dist/server.js', secret)],
  ['extra unsealed file', async (f) => put(f.release, 'payload/unsealed.txt', secret)],
  [
    'receipt digest mismatch',
    async (f) => seal(f.release, undefined, (r) => ({ ...r, manifestSha256: '0'.repeat(64) })),
  ],
  [
    'missing generic gate',
    async (f) =>
      seal(f.release, undefined, (r) => {
        delete r.checks.generic;
        return r;
      }),
  ],
  [
    'failed gate',
    async (f) =>
      seal(f.release, undefined, (r) => {
        r.checks.tests = 1;
        return r;
      }),
  ],
  [
    'traversal manifest',
    async (f) =>
      seal(f.release, (m) => {
        m.files[0].path = `..\\${secret}`;
        return m;
      }),
  ],
  [
    'duplicate manifest alias',
    async (f) =>
      seal(f.release, (m) => {
        m.files.push({ ...m.files[0], path: m.files[0].path.toUpperCase() });
        return m;
      }),
  ],
  [
    'ADS manifest path',
    async (f) =>
      seal(f.release, (m) => {
        m.files[0].path = `dist/server.js:${secret}`;
        return m;
      }),
  ],
  [
    'sealed built-version mismatch',
    async (f) => {
      await put(f.release, 'payload/dist/server.js', "const version = '0.16.3-dev';\n");
      await seal(f.release);
    },
  ],
  [
    'sealed missing script dependency',
    async (f) => {
      await rm(path.join(f.release, 'payload/scripts/Start-Tunnel.ps1'));
      await seal(f.release);
    },
  ],
]) {
  test(`candidate fails closed: ${name}`, windows, async (t) => {
    const f = await fixture(t);
    await corrupt(f);
    const before = await snapshot(f.root);
    const report = await inspect(f.install, ['-CandidateRelease', f.release], 1);
    assert.equal(report.candidate.sealed, false);
    assert.ok(codes(report).includes('CANDIDATE_RELEASE_INVALID'));
    assert.equal(report.nextAction.code, 'VALIDATE_CANDIDATE');
    assert.deepEqual(await snapshot(f.root), before);
  });
}

test('source package version is never substituted for the built runtime version', windows, async (t) => {
  const f = await fixture(t, { pkg: '9.9.9-source-edit' });
  const report = await inspect(f.install, [], 1);
  assert.equal(report.installation.packageVersion, '9.9.9-source-edit');
  assert.equal(report.installation.builtVersion, version);
  assert.ok(codes(report).includes('PACKAGE_BUILD_VERSION_MISMATCH'));
});

test(
  'missing build, malformed marker and missing bundled scripts return JSON findings',
  windows,
  async (t) => {
    const f = await fixture(t, { desktop: true });
    await rm(path.join(f.install, 'dist/server.js'));
    await rm(path.join(f.install, 'scripts/desktop-ui.mjs'));
    await put(f.install, '.local/installed-release.json', `{ ${secret}`);
    const report = await inspect(f.install, [], 1);
    assert.ok(codes(report).includes('INSTALLED_BUILD_INVALID'));
    assert.ok(codes(report).includes('INSTALLED_MARKER_INVALID'));
    assert.ok(codes(report).includes('INSTALLED_SCRIPT_DEPENDENCY_MISSING'));
    assert.deepEqual(report.installation.missingScripts, ['scripts/desktop-ui.mjs']);
  },
);

test(
  'retained journal errors are projected without raw error text or automatic recovery',
  windows,
  async (t) => {
    const f = await fixture(t);
    await put(f.install, '.local/update-operations/interrupted/journal.json', {
      operationId: 'interrupted',
      installRoot: f.install,
      phase: 'recovery_required',
      error: secret,
      recoveryError: secret,
    });
    await put(f.install, '.local/update-operations/old-failure/journal.json', {
      operationId: 'old-failure',
      installRoot: f.install,
      phase: 'preflight_failed',
      error: secret,
      recoveryError: null,
    });
    const report = await inspect(f.install, [], 1);
    assert.equal(report.operations.length, 2);
    assert.equal(report.operations[0].recoveryErrorPresent, true);
    assert.equal(report.operations[1].errorPresent, true);
    assert.ok(codes(report).includes('PRIOR_UPDATE_ERROR'));
    assert.equal(report.nextAction.code, 'REVIEW_EXISTING_OPERATION');
    assert.match(report.nextAction.message, /absent journal/);
  },
);

test('invalid installation root returns a safe JSON failure', windows, async (t) => {
  const f = await fixture(t);
  const report = await inspect(path.join(f.root, 'missing'), [], 2);
  assert.deepEqual(codes(report), ['INSTALL_ROOT_INVALID']);
});

test('external or credential-bearing health URL is rejected before any network call', windows, async (t) => {
  const f = await fixture(t);
  await put(f.install, '.local/health-url.txt', `http://${secret}@example.invalid:80`);
  const report = await inspect(f.install, ['-LiveHealth'], 1);
  assert.equal(report.live.status, 'unavailable_or_invalid');
  assert.equal(report.live.version, null);
});

test('loopback health redirects are never followed', windows, async (t) => {
  const f = await fixture(t);
  let redirects = 0;
  const target = await healthServer(t, (_req, res) => {
    redirects++;
    res.end(JSON.stringify(health(version)));
  });
  const url = await healthServer(t, (_req, res) => {
    res.writeHead(302, { location: target });
    res.end();
  });
  await put(f.install, '.local/health-url.txt', url);
  const report = await inspect(f.install, ['-LiveHealth'], 1);
  assert.equal(report.live.status, 'unavailable_or_invalid');
  assert.equal(redirects, 0);
});

test('matching live version is an observation, not hosted deployment acceptance', windows, async (t) => {
  const f = await fixture(t);
  const url = await healthServer(t, (_req, res) => res.end(JSON.stringify(health(version))));
  await put(f.install, '.local/health-url.txt', url);
  const report = await inspect(f.install, ['-LiveHealth']);
  assert.equal(report.live.status, 'observed');
  assert.equal(report.live.matchesDisk, true);
  assert.equal(report.nextAction.code, 'REVIEW_WB001_PLAN');
  assert.equal(report.candidate.requested, false);
});

for (const [name, response] of [
  ['missing service version', { ready: true }],
  ['nonboolean readiness', { ...health(version), ready: 'true' }],
  ['not ready', health(version, false)],
  ['oversized response', { ready: true, private: secret.repeat(4096) }],
]) {
  test(`live health fails closed: ${name}`, windows, async (t) => {
    const f = await fixture(t);
    const url = await healthServer(t, (_req, res) => res.end(JSON.stringify(response)));
    await put(f.install, '.local/health-url.txt', url);
    const report = await inspect(f.install, ['-LiveHealth'], 1);
    assert.equal(report.ok, false);
    assert.ok(codes(report).some((code) => ['LIVE_NOT_READY', 'LIVE_HEALTH_UNVERIFIED'].includes(code)));
  });
}

test(
  'installation and candidate junctions fail closed without traversing payload links',
  windows,
  async (t) => {
    const f = await fixture(t);
    const linkedInstall = path.join(f.root, 'linked-install');
    await symlink(f.install, linkedInstall, 'junction');
    assert.deepEqual(codes(await inspect(linkedInstall, [], 2)), ['INSTALL_ROOT_INVALID']);
    const extra = path.join(f.root, 'outside-payload');
    await mkdir(extra);
    await put(extra, 'private.txt', secret);
    await symlink(extra, path.join(f.release, 'payload/linked'), 'junction');
    const report = await inspect(f.install, ['-CandidateRelease', f.release], 1);
    assert.equal(report.candidate.sealed, false);
  },
);

test('slash-separated sealed manifests are accepted', windows, async (t) => {
  const f = await fixture(t);
  await seal(f.release, (manifest) => {
    for (const entry of manifest.files) entry.path = entry.path.replaceAll('\\', '/');
    return manifest;
  });
  const report = await inspect(f.install, ['-CandidateRelease', f.release]);
  assert.equal(report.candidate.sealed, true);
});

test('a slow health body has a total read deadline', windows, async (t) => {
  const f = await fixture(t);
  const url = await healthServer(t, (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{');
    const timer = setInterval(() => res.write(' '), 100);
    res.on('close', () => clearInterval(timer));
  });
  await put(f.install, '.local/health-url.txt', url);
  const started = Date.now();
  const report = await inspect(f.install, ['-LiveHealth'], 1);
  assert.ok(Date.now() - started < 10_000);
  assert.equal(report.live.status, 'unavailable_or_invalid');
});

test('malformed installed package and missing runtime directory are safe findings', windows, async (t) => {
  const f = await fixture(t);
  await put(f.install, 'package.json', `{ ${secret}`);
  await rm(path.join(f.install, 'node_modules'), { recursive: true });
  const report = await inspect(f.install, [], 1);
  assert.ok(codes(report).includes('INSTALLED_PACKAGE_INVALID'));
  assert.deepEqual(report.installation.missingRuntime, ['node_modules']);
});
