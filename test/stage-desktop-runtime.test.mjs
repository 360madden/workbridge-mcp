import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  link,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  DESKTOP_RUNTIME_FILES,
  DESKTOP_RUNTIME_MANIFEST,
  stageDesktopRuntime,
} from '../scripts/stage-desktop-runtime.mjs';

const project = fileURLToPath(new URL('..', import.meta.url));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const writeIdentity = ({ dev, ino, size, mtimeNs, ctimeNs }) => ({ dev, ino, size, mtimeNs, ctimeNs });
const expectedNames = [
  'desktop-ui.mjs',
  'desktop-capture.mjs',
  'vmware-host-capture.mjs',
  'desktop-probe-act.mjs',
  'desktop-turn-admission.mjs',
  'Check-DesktopWindowHandle.ps1',
];

async function fixture(t, actual = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wb-stage-desktop-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'scripts'));
  await mkdir(path.join(root, 'dist'));
  for (const name of expectedNames) {
    await writeFile(
      path.join(root, 'scripts', name),
      actual
        ? await readFile(path.join(project, 'scripts', name))
        : Buffer.from(`// ${name}\r\nexport const marker = 'exact bytes: café ☃';\r\n`),
    );
  }
  return root;
}

test('stages the complete six-file closure with deterministic manifest and stable replay', async (t) => {
  const root = await fixture(t, true);
  await writeFile(path.join(root, 'scripts', 'untrusted.mjs'), 'must not copy');
  await writeFile(path.join(root, 'dist', 'server.js'), 'existing compiled server');
  assert.deepEqual(DESKTOP_RUNTIME_FILES, expectedNames);
  assert.ok(Object.isFrozen(DESKTOP_RUNTIME_FILES));
  const first = await stageDesktopRuntime({ repoRoot: root });
  const independentRoot = await fixture(t, true);
  assert.deepEqual(await stageDesktopRuntime({ repoRoot: independentRoot }), first);
  const beforeReplay = await Promise.all(
    [...expectedNames, DESKTOP_RUNTIME_MANIFEST].map(async (name) =>
      writeIdentity(await lstat(path.join(root, 'dist', name), { bigint: true })),
    ),
  );
  assert.deepEqual(await stageDesktopRuntime({ repoRoot: root }), first);
  assert.deepEqual(
    await Promise.all(
      [...expectedNames, DESKTOP_RUNTIME_MANIFEST].map(async (name) =>
        writeIdentity(await lstat(path.join(root, 'dist', name), { bigint: true })),
      ),
    ),
    beforeReplay,
  );
  assert.equal(first.ok, true);
  assert.deepEqual(
    first.files.map((file) => file.name),
    expectedNames,
  );
  for (const file of first.files) {
    const source = await readFile(path.join(root, 'scripts', file.name));
    assert.deepEqual(await readFile(path.join(root, 'dist', file.name)), source);
    assert.equal(file.sizeBytes, source.length);
    assert.equal(file.sha256, hash(source));
  }
  const manifest = await readFile(path.join(root, 'dist', DESKTOP_RUNTIME_MANIFEST));
  assert.deepEqual(JSON.parse(manifest), { schemaVersion: 1, files: first.files });
  assert.equal(manifest.toString(), JSON.stringify({ schemaVersion: 1, files: first.files }, null, 2) + '\n');
  assert.deepEqual(first.manifest, {
    name: DESKTOP_RUNTIME_MANIFEST,
    sizeBytes: manifest.length,
    sha256: hash(manifest),
  });
  assert.deepEqual(
    (await readdir(path.join(root, 'dist'))).sort(),
    [...expectedNames, DESKTOP_RUNTIME_MANIFEST, 'server.js'].sort(),
  );
  assert.equal(await readFile(path.join(root, 'dist', 'server.js'), 'utf8'), 'existing compiled server');
  // All real relative imports resolve from the staged directory without invoking a CLI main.
  for (const name of expectedNames.filter((name) => name.endsWith('.mjs'))) {
    await import(pathToFileURL(path.join(root, 'dist', name)).href);
  }
});

test('staged runner executes only fixture siblings with repository-root and relative-import semantics', async (t) => {
  const root = await fixture(t);
  await writeFile(
    path.join(root, 'scripts', 'desktop-ui.mjs'),
    `import {fileURLToPath} from 'node:url';
import {marker} from './desktop-capture.mjs';
console.log(JSON.stringify({ok:true,marker,repoRoot:fileURLToPath(new URL('..',import.meta.url))}));`,
  );
  await stageDesktopRuntime({ repoRoot: root });
  // Relocate the TypeScript source directly: Node strips types; no compiler/build or main dist writes.
  await writeFile(
    path.join(root, 'dist', 'desktop-cli-runner.ts'),
    await readFile(path.join(project, 'src', 'desktop-cli-runner.ts')),
  );
  // Removing the source tree proves the invoker and the peer import use only staged files.
  await rm(path.join(root, 'scripts'), { recursive: true });
  const { invokeDesktopPrototype } = await import(
    pathToFileURL(path.join(root, 'dist', 'desktop-cli-runner.ts')).href
  );
  assert.deepEqual(await invokeDesktopPrototype('desktop-ui.mjs', [], { timeoutMs: 1000 }), {
    ok: true,
    marker: 'exact bytes: café ☃',
    repoRoot: root + path.sep,
  });
});

test('real staged capture keeps default evidence under the fixture repository root', async (t) => {
  const root = await fixture(t, true);
  await stageDesktopRuntime({ repoRoot: root });
  const { captureWindow, parseCaptureRequest } = await import(
    pathToFileURL(path.join(root, 'dist', 'desktop-capture.mjs')).href
  );
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/bH8AAAAASUVORK5CYII=',
    'base64',
  );
  const request = parseCaptureRequest([
    '--pid',
    '100',
    '--hwnd',
    '200',
    '--process',
    'fixture',
    '--request-id',
    'offline_stage_001',
  ]);
  const runner = async (args) => {
    if (args[0] === '--version') return '0.7.1';
    if (args[1] === 'list-windows')
      return JSON.stringify([
        {
          hwnd: 200,
          processId: 100,
          processName: 'fixture',
          className: 'FixtureClass',
          width: 800,
          height: 600,
        },
      ]);
    if (args[1] === 'inspect')
      return JSON.stringify({
        windows: [{ hwnd: 200, elements: [{ isOffscreen: false, width: 800, height: 600 }] }],
      });
    if (args[1] === 'screenshot') {
      const filename = args[args.indexOf('--output') + 1];
      assert.equal(path.dirname(filename), path.join(root, '.tools', 'desktop-evidence'));
      await writeFile(filename, png, { flag: 'wx' });
      return JSON.stringify({ filePath: filename, width: 1, height: 1, processId: 100, hwnd: 200 });
    }
    assert.fail('Unexpected synthetic backend call');
  };
  const result = await captureWindow(request, { runner });
  assert.equal(result.ok, true);
  assert.deepEqual(
    await readFile(path.join(root, '.tools', 'desktop-evidence', 'capture-offline_stage_001.png')),
    png,
  );
  assert.equal(
    (await readdir(path.join(root, 'dist'))).some((name) => name.includes('capture-offline')),
    false,
  );
});

test('staged direct capture CLI refuses missing or foreign November 2 guards without WinApp', async (t) => {
  const root = await fixture(t, true);
  await stageDesktopRuntime({ repoRoot: root });
  const script = path.join(root, 'dist', 'desktop-capture.mjs');
  const args = [
    script,
    '--pid',
    '100',
    '--hwnd',
    '200',
    '--process',
    'fixture',
    '--request-id',
    'staged_unowned_001',
  ];
  const run = () =>
    spawnSync(process.execPath, args, {
      cwd: root,
      encoding: 'utf8',
      timeout: 10_000,
    });
  const first = run();
  assert.equal(first.status, 1);
  assert.equal(JSON.parse(first.stdout).error.code, 'UI_TURN_RECOVERY_REQUIRED');
  assert.equal(first.stderr, '');
  const evidenceRoot = path.join(root, '.tools', 'desktop-evidence');
  await mkdir(evidenceRoot, { recursive: true });
  const original = 'November 2 unresolved desktop-input-turn lock';
  await writeFile(path.join(evidenceRoot, 'desktop-input-turn.lock'), original, { flag: 'wx' });
  const second = run();
  assert.equal(second.status, 1);
  assert.equal(JSON.parse(second.stdout).error.code, 'UI_TURN_RECOVERY_REQUIRED');
  assert.equal(await readFile(path.join(evidenceRoot, 'desktop-input-turn.lock'), 'utf8'), original);
  assert.equal(
    (await readdir(evidenceRoot)).some((name) => name.startsWith('capture-')),
    false,
  );
});

test('staged child accepts exact parent-owned locks before invoking only its injected fake backend', async (t) => {
  const root = await fixture(t, true);
  await stageDesktopRuntime({ repoRoot: root });
  const script = path.join(root, 'dist', 'desktop-capture.mjs');
  const evidenceRoot = path.join(root, '.tools', 'desktop-evidence');
  await mkdir(evidenceRoot, { recursive: true });
  const requestId = 'staged_owned_001';
  const admission = {
    schemaVersion: 1,
    kind: 'workbridge.gui-admission',
    admissionId: randomUUID(),
    mode: 'producer',
    producer: 'desktop-capture-window',
    requestId,
    owner: { pid: process.pid },
    acquiredUtc: new Date().toISOString(),
  };
  const turn = {
    schemaVersion: 1,
    kind: 'workbridge.gui-turn',
    leaseId: randomUUID(),
    producer: 'desktop-capture-window',
    requestId,
    owner: { pid: process.pid },
    target: { kind: 'window', pid: 100, hwnd: 200, process: 'fixture' },
    acquiredUtc: new Date().toISOString(),
  };
  const admissionBytes = JSON.stringify(admission) + '\n';
  const turnBytes = JSON.stringify(turn) + '\n';
  await writeFile(path.join(evidenceRoot, 'desktop-turn-admission.lock'), admissionBytes, { flag: 'wx' });
  await writeFile(path.join(evidenceRoot, 'desktop-input-turn.lock'), turnBytes, { flag: 'wx' });
  // A real child process (process.ppid === this test process.pid) imports the
  // staged module; only a fake runner is passed, so no Windows GUI can be touched.
  const program = [
    'const mod = await import(' + JSON.stringify(pathToFileURL(script).href) + ');',
    'const req = mod.parseCaptureRequest(' +
      JSON.stringify(['--pid', '100', '--hwnd', '200', '--process', 'fixture', '--request-id', requestId]) +
      ');',
    'let calls = 0;',
    "try { await mod.captureWindowUnderParentTurn(req, {runner: async () => {calls++; throw new Error('SYNTHETIC_BACKEND_REACHED');}}); } catch {}",
    'process.stdout.write(JSON.stringify({calls}));',
    'process.exitCode = calls === 1 ? 0 : 1;',
  ].join('\n');
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', program], {
    cwd: root,
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { calls: 1 });
  assert.equal(
    await readFile(path.join(evidenceRoot, 'desktop-turn-admission.lock'), 'utf8'),
    admissionBytes,
  );
  assert.equal(await readFile(path.join(evidenceRoot, 'desktop-input-turn.lock'), 'utf8'), turnBytes);
  assert.equal(
    (await readdir(evidenceRoot)).some((name) => name.startsWith('capture-')),
    false,
  );
});
test('missing or oversized inputs and non-file destinations fail before publication', async (t) => {
  for (const invalid of ['missing', 'oversized', 'directory']) {
    const root = await fixture(t);
    const name = expectedNames.at(-1);
    if (invalid === 'missing') await unlink(path.join(root, 'scripts', name));
    if (invalid === 'oversized')
      await writeFile(path.join(root, 'scripts', name), Buffer.alloc(1024 * 1024 + 1));
    if (invalid === 'directory') await mkdir(path.join(root, 'dist', name));
    await assert.rejects(stageDesktopRuntime({ repoRoot: root }), {
      code: {
        missing: 'ENOENT',
        oversized: 'DESKTOP_STAGE_FILE_BOUNDS',
        directory: 'DESKTOP_STAGE_UNSAFE_PATH',
      }[invalid],
    });
    assert.deepEqual(await readdir(path.join(root, 'dist')), invalid === 'directory' ? [name] : []);
  }
});

test('rejects directory links/junctions at source, destination and repository root', async (t) => {
  for (const kind of ['scripts', 'dist', 'root']) {
    const root = await fixture(t);
    const linked = path.join(root, 'linked-root');
    let supplied = root;
    if (kind === 'root') {
      await symlink(root, linked, process.platform === 'win32' ? 'junction' : 'dir');
      supplied = linked;
    } else {
      const directory = path.join(root, kind);
      await rm(directory, { recursive: true });
      await mkdir(path.join(root, 'other'));
      await symlink(path.join(root, 'other'), directory, process.platform === 'win32' ? 'junction' : 'dir');
    }
    await assert.rejects(stageDesktopRuntime({ repoRoot: supplied }), { code: 'DESKTOP_STAGE_UNSAFE_PATH' });
  }
});

test('rejects file symlinks without reading or overwriting their targets', async (t) => {
  const root = await fixture(t);
  const sentinel = path.join(root, 'sentinel.mjs');
  await writeFile(sentinel, 'unrelated bytes');
  for (const directory of ['scripts', 'dist']) {
    const filename = path.join(root, directory, expectedNames[0]);
    if (directory === 'scripts') await unlink(filename);
    try {
      await symlink(sentinel, filename, 'file');
    } catch (error) {
      if (process.platform === 'win32' && error.code === 'EPERM') {
        t.skip('Windows file symlink privilege unavailable; directory junction rejection tested separately');
        return;
      }
      throw error;
    }
    await assert.rejects(stageDesktopRuntime({ repoRoot: root }), { code: 'DESKTOP_STAGE_UNSAFE_PATH' });
    assert.equal(await readFile(sentinel, 'utf8'), 'unrelated bytes');
    await unlink(filename);
    if (directory === 'scripts') await writeFile(filename, 'restored fixture');
  }
});

test('validates deadlines and stops expired work before creating staging files', async (t) => {
  const root = await fixture(t);
  for (const timeoutMs of [0, -1, 45_001, NaN, Infinity, 1.5, '1000']) {
    await assert.rejects(stageDesktopRuntime({ repoRoot: root, timeoutMs }), {
      code: 'DESKTOP_STAGE_INVALID_ARGUMENTS',
    });
  }
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  const pending = stageDesktopRuntime({ repoRoot: root, timeoutMs: 1000 });
  const rejected = assert.rejects(pending, { code: 'DESKTOP_STAGE_TIMEOUT' });
  t.mock.timers.tick(1000);
  await rejected;
  assert.deepEqual(await readdir(path.join(root, 'dist')), []);
});

test('offline CLI succeeds with deterministic hashes and rejects arbitrary filename options', async (t) => {
  const root = await fixture(t);
  const script = path.join(project, 'scripts', 'stage-desktop-runtime.mjs');
  const args = [script, '--repo-root', root, '--timeout-ms', '10000'];
  const run = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 15_000 });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), await stageDesktopRuntime({ repoRoot: root }));
  const bad = spawnSync(process.execPath, [...args, '--files', '../other.mjs'], {
    encoding: 'utf8',
    timeout: 15_000,
  });
  assert.equal(bad.status, 1);
  assert.equal(JSON.parse(bad.stderr).ok, false);
});

async function outputBytes(root) {
  const entries = await readdir(path.join(root, 'dist'));
  return Object.fromEntries(
    await Promise.all(
      entries
        .sort()
        .map(async (name) => [name, (await readFile(path.join(root, 'dist', name))).toString('base64')]),
    ),
  );
}

async function changeInputs(root) {
  for (const name of expectedNames) {
    await writeFile(path.join(root, 'scripts', name), `// revised ${name}\n`);
  }
}

test('staged default deferred helper resolves beside the probe without invoking PowerShell', async (t) => {
  const root = await fixture(t, true);
  await stageDesktopRuntime({ repoRoot: root });
  await rm(path.join(root, 'scripts'), { recursive: true });
  // Patch only the isolated child's built-in execFile before importing the real
  // staged probe; the production default helper path and arguments are exercised.
  const code = `
    import assert from 'node:assert/strict';
    import cp from 'node:child_process';
    import {syncBuiltinESMExports} from 'node:module';
    import {readFile} from 'node:fs/promises';
    const expected = ${JSON.stringify(path.join(root, 'dist', 'Check-DesktopWindowHandle.ps1'))};
    let calls = 0;
    cp.execFile = (executable, args, options, callback) => {
      calls++;
      assert.equal(executable, 'powershell.exe');
      assert.equal(args[args.indexOf('-File') + 1], expected);
      assert.deepEqual(args.slice(-6), ['-ParentHwnd','200','-ReportedHwnd','201','-ExpectedPid','100']);
      assert.equal(options.shell, false);
      readFile(expected, 'utf8').then(text => {
        assert.match(text, /GetAncestor/);
        callback(null, JSON.stringify({schemaVersion:1,parentHwnd:200,reportedHwnd:201,parentPid:100,reportedPid:100,ancestorHwnd:200}), '');
      }).catch(callback);
    };
    cp.execFile[Symbol.for('nodejs.util.promisify.custom')] = (...args) => new Promise((resolve, reject) => {
      cp.execFile(...args, (error, stdout, stderr) => error ? reject(error) : resolve({stdout,stderr}));
    });
    syncBuiltinESMExports();
    const {inspectChildHandle} = await import(${JSON.stringify(pathToFileURL(path.join(root, 'dist', 'desktop-probe-act.mjs')).href)});
    const result = await inspectChildHandle({parentHwnd:200,reportedHwnd:201,expectedPid:100});
    assert.equal(result.ancestorHwnd, 200);
    assert.equal(calls, 1);
    console.log('offline-default-helper-ok');
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', code], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'offline-default-helper-ok');
});

test('changed source restages coherently and keeps unrelated dist output', async (t) => {
  const root = await fixture(t);
  const first = await stageDesktopRuntime({ repoRoot: root });
  await writeFile(path.join(root, 'dist', 'unrelated.js'), 'preserved');
  await changeInputs(root);
  const second = await stageDesktopRuntime({ repoRoot: root });
  assert.notEqual(second.manifest.sha256, first.manifest.sha256);
  for (const file of second.files) {
    assert.equal(hash(await readFile(path.join(root, 'dist', file.name))), file.sha256);
  }
  assert.deepEqual(await stageDesktopRuntime({ repoRoot: root }), second);
  assert.equal(await readFile(path.join(root, 'dist', 'unrelated.js'), 'utf8'), 'preserved');
});

test('rejects changed, missing or malformed manifested output without repairing or deleting it', async (t) => {
  for (const kind of [
    'script',
    'helper',
    'missing-file',
    'missing-manifest',
    'manifest',
    'duplicate',
    'unexpected',
    'traversal',
  ]) {
    const root = await fixture(t);
    await stageDesktopRuntime({ repoRoot: root });
    const manifestPath = path.join(root, 'dist', DESKTOP_RUNTIME_MANIFEST);
    if (kind === 'script') await writeFile(path.join(root, 'dist', expectedNames[0]), 'tampered');
    if (kind === 'helper') await writeFile(path.join(root, 'dist', expectedNames.at(-1)), 'tampered helper');
    if (kind === 'missing-file') await unlink(path.join(root, 'dist', expectedNames[0]));
    if (kind === 'missing-manifest') await unlink(manifestPath);
    if (kind === 'manifest') await writeFile(manifestPath, '{invalid');
    if (['duplicate', 'unexpected', 'traversal'].includes(kind)) {
      const manifest = JSON.parse(await readFile(manifestPath));
      if (kind === 'duplicate') manifest.files.push(manifest.files[0]);
      if (kind === 'unexpected')
        manifest.files.push({ name: 'untrusted.mjs', sizeBytes: 1, sha256: '0'.repeat(64) });
      if (kind === 'traversal') manifest.files[0].name = '../outside.mjs';
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    }
    const before = await outputBytes(root);
    await assert.rejects(stageDesktopRuntime({ repoRoot: root }), { code: 'DESKTOP_STAGE_TAMPERED' });
    assert.deepEqual(await outputBytes(root), before, kind);
  }
});

test('caught interruptions roll back initial and replacement stages, including manifest publication', async (t) => {
  for (const existing of [false, true]) {
    for (const boundary of ['prepared', ...expectedNames, DESKTOP_RUNTIME_MANIFEST, 'complete']) {
      const root = await fixture(t);
      await writeFile(path.join(root, 'dist', 'server.js'), 'unrelated server bytes');
      if (existing) {
        await stageDesktopRuntime({ repoRoot: root });
        await changeInputs(root);
      }
      const before = await outputBytes(root);
      const interruption = new Error('synthetic stage interruption');
      await assert.rejects(
        stageDesktopRuntime({
          repoRoot: root,
          onCheckpoint: ({ phase, name }) => {
            if (phase === boundary || (phase === 'published' && name === boundary)) throw interruption;
          },
        }),
        (error) => error === interruption,
      );
      assert.deepEqual(await outputBytes(root), before, `${existing}:${boundary}`);
      const recovered = await stageDesktopRuntime({ repoRoot: root });
      assert.equal(recovered.ok, true);
    }
  }
});

test('source mutations during preparation and publication fail and restore the old output', async (t) => {
  for (const phaseToChange of ['prepared', 'published', 'complete']) {
    const root = await fixture(t);
    await stageDesktopRuntime({ repoRoot: root });
    await changeInputs(root);
    const before = await outputBytes(root);
    let changed = false;
    await assert.rejects(
      stageDesktopRuntime({
        repoRoot: root,
        onCheckpoint: async ({ phase }) => {
          if (!changed && phase === phaseToChange) {
            changed = true;
            await writeFile(path.join(root, 'scripts', expectedNames.at(-1)), 'raced helper bytes');
          }
        },
      }),
      { code: 'DESKTOP_STAGE_SOURCE_CHANGED' },
    );
    assert.ok(changed);
    assert.deepEqual(await outputBytes(root), before);
  }
});

test('destination races are rejected without overwriting the competing writer', async (t) => {
  for (const phaseToChange of ['prepared', 'published']) {
    const root = await fixture(t);
    await stageDesktopRuntime({ repoRoot: root });
    await changeInputs(root);
    let changed = false;
    const racedName = phaseToChange === 'prepared' ? expectedNames.at(-1) : expectedNames[0];
    await assert.rejects(
      stageDesktopRuntime({
        repoRoot: root,
        onCheckpoint: async ({ phase }) => {
          if (!changed && phase === phaseToChange) {
            changed = true;
            await writeFile(path.join(root, 'dist', racedName), 'competing writer');
          }
        },
      }),
      {
        code:
          phaseToChange === 'prepared' ? 'DESKTOP_STAGE_TARGET_CHANGED' : 'DESKTOP_STAGE_RECOVERY_REQUIRED',
      },
    );
    assert.equal(await readFile(path.join(root, 'dist', racedName), 'utf8'), 'competing writer');
    if (phaseToChange === 'published') {
      assert.ok((await readdir(path.join(root, 'dist'))).includes('.desktop-runtime-stage.lock'));
      await assert.rejects(stageDesktopRuntime({ repoRoot: root }), {
        code: 'DESKTOP_STAGE_RECOVERY_REQUIRED',
      });
    }
  }
});

test('exclusive stage lock refuses a concurrent caller and preserves the active stage', async (t) => {
  const root = await fixture(t);
  let checked = false;
  await stageDesktopRuntime({
    repoRoot: root,
    onCheckpoint: async ({ phase }) => {
      if (phase === 'prepared') {
        const before = await outputBytes(root);
        await assert.rejects(stageDesktopRuntime({ repoRoot: root }), {
          code: 'DESKTOP_STAGE_RECOVERY_REQUIRED',
        });
        assert.deepEqual(await outputBytes(root), before);
        checked = true;
      }
    },
  });
  assert.ok(checked);
  assert.deepEqual(
    (await readdir(path.join(root, 'dist'))).sort(),
    [...expectedNames, DESKTOP_RUNTIME_MANIFEST].sort(),
  );
});

test('process death leaves durable evidence and cannot be silently replayed', async (t) => {
  for (const existing of [false, true]) {
    const root = await fixture(t);
    await writeFile(path.join(root, 'dist', 'server.js'), 'unrelated');
    if (existing) {
      await stageDesktopRuntime({ repoRoot: root });
      await changeInputs(root);
    }
    const code = `
      import {stageDesktopRuntime} from ${JSON.stringify(pathToFileURL(path.join(project, 'scripts', 'stage-desktop-runtime.mjs')).href)};
      await stageDesktopRuntime({repoRoot:${JSON.stringify(root)},onCheckpoint:({phase})=>{
        if (phase === 'published') process.exit(73);
      }});
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', code], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(result.status, 73, result.stderr);
    const before = await outputBytes(root);
    assert.ok(Object.hasOwn(before, '.desktop-runtime-stage.lock'));
    assert.ok(Object.keys(before).some((name) => name.startsWith('.desktop-stage-')));
    await assert.rejects(stageDesktopRuntime({ repoRoot: root }), {
      code: 'DESKTOP_STAGE_RECOVERY_REQUIRED',
    });
    assert.deepEqual(await outputBytes(root), before);
    assert.equal(await readFile(path.join(root, 'dist', 'server.js'), 'utf8'), 'unrelated');
  }
});

test('directory replacement during staging is rejected and replacement output is preserved', async (t) => {
  const root = await fixture(t);
  const moved = path.join(root, 'original-dist');
  let changed = false;
  await assert.rejects(
    stageDesktopRuntime({
      repoRoot: root,
      onCheckpoint: async ({ phase }) => {
        if (phase === 'prepared') {
          await rename(path.join(root, 'dist'), moved);
          await mkdir(path.join(root, 'dist'));
          await writeFile(path.join(root, 'dist', 'sentinel'), 'replacement directory');
          changed = true;
        }
      },
    }),
    { code: 'DESKTOP_STAGE_RECOVERY_REQUIRED' },
  );
  assert.ok(changed);
  assert.deepEqual(await readdir(path.join(root, 'dist')), ['sentinel']);
  assert.equal(await readFile(path.join(root, 'dist', 'sentinel'), 'utf8'), 'replacement directory');
  assert.ok((await readdir(moved)).includes('.desktop-runtime-stage.lock'));
});

test('deadline expiry after publication restores old output without timing out rollback', async (t) => {
  const root = await fixture(t);
  await stageDesktopRuntime({ repoRoot: root });
  await changeInputs(root);
  const before = await outputBytes(root);
  t.mock.timers.enable({ apis: ['Date'] });
  await assert.rejects(
    stageDesktopRuntime({
      repoRoot: root,
      timeoutMs: 1000,
      onCheckpoint: ({ phase }) => {
        if (phase === 'published') t.mock.timers.tick(1000);
      },
    }),
    { code: 'DESKTOP_STAGE_TIMEOUT' },
  );
  assert.deepEqual(await outputBytes(root), before);
});

test('rejects orphan staging artifacts and strict invalid arguments without removing evidence', async (t) => {
  const root = await fixture(t);
  for (const repoRoot of ['', '.', '..', null, 123, root + '\0']) {
    await assert.rejects(stageDesktopRuntime({ repoRoot }), { code: 'DESKTOP_STAGE_INVALID_ARGUMENTS' });
  }
  for (const name of ['.desktop-runtime-stage.lock', '.desktop-stage-unrelated.tmp']) {
    const filename = path.join(root, 'dist', name);
    await writeFile(filename, 'preserved recovery evidence');
    const before = await outputBytes(root);
    await assert.rejects(stageDesktopRuntime({ repoRoot: root }), {
      code: 'DESKTOP_STAGE_RECOVERY_REQUIRED',
    });
    assert.deepEqual(await outputBytes(root), before);
    await unlink(filename);
  }
});

test('rejects source and target hard-link aliases without changing their other names', async (t) => {
  const root = await fixture(t);
  const sentinel = path.join(root, 'sentinel');
  await writeFile(sentinel, 'unrelated hard-linked bytes');
  for (const directory of ['scripts', 'dist']) {
    const filename = path.join(root, directory, expectedNames[0]);
    if (directory === 'scripts') await unlink(filename);
    await link(sentinel, filename);
    await assert.rejects(stageDesktopRuntime({ repoRoot: root }), { code: 'DESKTOP_STAGE_UNSAFE_PATH' });
    assert.equal(await readFile(sentinel, 'utf8'), 'unrelated hard-linked bytes');
    await unlink(filename);
    if (directory === 'scripts') await writeFile(filename, 'restored fixture');
  }
});
