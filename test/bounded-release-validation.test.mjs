import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const runner = path.join(root, 'scripts/Invoke-BoundedReleaseValidation.ps1');
const lifetime = path.join(root, 'scripts/Desktop-JobLifetime.cs');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sourceCommit = '1'.repeat(40);
const releaseId = 'synthetic-validation';
const pwsh = path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'PowerShell/7/pwsh.exe');

test('bounded validation runner preserves isolation, deadlines, and official gate contract', async () => {
  const source = (await readFile(runner, 'utf8')).replaceAll('\r\n', '\n');
  assert.match(source, /^#Requires -Version 7\.0/);
  assert.match(source, /\[ValidateRange\(1, 1140\)\]\[int\]\$TimeoutSeconds = 1140/);
  assert.ok(source.indexOf('[Workbridge.DesktopJobLifetime]::Attach()') < source.indexOf('$process.Start()'));
  assert.ok(
    source.indexOf('$env:CONTROL_PLANE_API_KEY = $null') < source.indexOf('Add-Type -Path $lifetime'),
  );
  assert.match(source, /Environment\.Remove\('CONTROL_PLANE_API_KEY'\)/);
  assert.match(source, /'-RefreshUserEnvironment', '-SerialTests'/);
  assert.match(source, /FileMode\.CreateNew/);
  assert.match(source, /Math\.Min\(count, Math\.Max\(0, limit - result\.Bytes\)\)/);
  assert.match(source, /\$stdout\.Result\.Truncated -or \$stderr\.Result\.Truncated/);
  assert.match(source, /\$record\.activeProcesses -ne 1/);
  assert.match(source, /validated\.runner-blocked\.json/);
  assert.doesNotMatch(
    source,
    /Register-ScheduledTask|Start-ScheduledTask|Update-Workbridge\.ps1|Restart-Computer/,
  );
});

test(
  'bounded validation fixtures reject stale inputs, failed gates, deadlines, output overflow, and replay',
  {
    skip:
      process.platform !== 'win32'
        ? 'Windows only'
        : !existsSync(pwsh)
          ? 'Optional PowerShell 7 validation prerequisite is not installed'
          : false,
    timeout: 60000,
  },
  async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'wb-bounded-validation-'));
    const lifetimeBytes = await readFile(lifetime);
    async function fixture(name, body = '') {
      const directory = path.join(base, name);
      const sourceRoot = path.join(directory, 'source');
      const evidence = path.join(directory, 'evidence');
      await mkdir(path.join(sourceRoot, 'scripts'), { recursive: true });
      await copyFile(lifetime, path.join(sourceRoot, 'scripts/Desktop-JobLifetime.cs'));
      const builder = String.raw`param([string]$SourceRoot, [string]$ReleaseId, [string]$WorkspaceRoot, [switch]$RefreshUserEnvironment, [switch]$SerialTests)
$ErrorActionPreference = 'Stop'
if (!$RefreshUserEnvironment -or !$SerialTests) { throw 'Required complete serial profile switches missing.' }
if ($env:CONTROL_PLANE_API_KEY) { throw 'Synthetic credential reached child.' }
${body}
$release = Join-Path $SourceRoot ('.local\releases\' + $ReleaseId)
$null = [IO.Directory]::CreateDirectory($release)
[IO.File]::WriteAllText((Join-Path $release 'validated.json'), '{"result":"passed","testProfile":{"name":"serial-files","fileConcurrency":1}}')
[Console]::WriteLine('synthetic gates passed')
`;
      await writeFile(path.join(sourceRoot, 'scripts/New-WorkbridgeRelease.ps1'), builder);
      const provenancePath = path.join(directory, 'provenance.json');
      const provenance = JSON.stringify({ sourceCommit, sourceRoot });
      await writeFile(provenancePath, provenance);
      const args = [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-File',
        runner,
        '-SourceRoot',
        sourceRoot,
        '-EvidenceDirectory',
        evidence,
        '-ReleaseId',
        releaseId,
        '-ExpectedHostname',
        os.hostname(),
        '-SourceCommit',
        sourceCommit,
        '-ProvenancePath',
        provenancePath,
        '-ExpectedProvenanceSha256',
        sha(provenance),
        '-ExpectedBuilderSha256',
        sha(builder),
        '-ExpectedLifetimeSha256',
        sha(lifetimeBytes),
        '-WorkspaceRoot',
        base,
        '-TimeoutSeconds',
        '15',
      ];
      return { sourceRoot, evidence, args, release: path.join(sourceRoot, '.local/releases', releaseId) };
    }
    function run(fixture, overrides = {}) {
      const args = [...fixture.args];
      for (const [key, value] of Object.entries(overrides)) args[args.indexOf(key) + 1] = value;
      return spawnSync(pwsh, args, {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true,
        timeout: 20000,
        maxBuffer: 65536,
        env: { ...process.env, CONTROL_PLANE_API_KEY: 'synthetic-do-not-inherit' },
      });
    }
    const receipt = async (fixture) =>
      JSON.parse(await readFile(path.join(fixture.evidence, 'completed.json'), 'utf8'));
    try {
      const identity = await fixture('wrong-host');
      assert.notEqual(run(identity, { '-ExpectedHostname': 'WRONG-HOST-FIXTURE' }).status, 0);
      await assert.rejects(stat(identity.evidence), { code: 'ENOENT' });

      const stale = await fixture('stale-hash');
      assert.notEqual(run(stale, { '-ExpectedBuilderSha256': '0'.repeat(64) }).status, 0);
      await assert.rejects(stat(stale.evidence), { code: 'ENOENT' });

      const passed = await fixture('pass');
      const positive = run(passed);
      assert.equal(positive.status, 0, positive.stderr + positive.stdout);
      const success = await receipt(passed);
      assert.equal(success.result, 'passed');
      assert.equal(success.activeProcesses, 1);
      assert.equal(success.childExitCode, 0);
      assert.equal(success.receiptSha256, sha(await readFile(path.join(passed.release, 'validated.json'))));
      assert.notEqual(run(passed).status, 0);
      assert.deepEqual(await receipt(passed), success);

      const failed = await fixture('fail', "throw 'Synthetic required gate failure.'");
      assert.notEqual(run(failed).status, 0);
      assert.equal((await receipt(failed)).result, 'failed');
      await assert.rejects(stat(path.join(failed.release, 'validated.json')), { code: 'ENOENT' });

      const timed = await fixture('timeout', 'Start-Sleep -Seconds 20');
      const timeout = run(timed, { '-TimeoutSeconds': '2' });
      assert.equal(timeout.status, 124, timeout.stderr + timeout.stdout);
      assert.equal((await receipt(timed)).result, 'timed_out');
      await assert.rejects(stat(path.join(timed.release, 'validated.json')), { code: 'ENOENT' });

      const overflow = await fixture('overflow', "[Console]::Write(('x' * 4194305))");
      assert.notEqual(run(overflow).status, 0);
      assert.equal((await receipt(overflow)).result, 'failed');
      assert.equal((await stat(path.join(overflow.evidence, 'stdout.log'))).size, 4194304);
      await assert.rejects(stat(path.join(overflow.release, 'validated.json')), { code: 'ENOENT' });
      assert.equal(
        JSON.parse(await readFile(path.join(overflow.release, 'validated.runner-blocked.json'), 'utf8'))
          .result,
        'passed',
      );
    } finally {
      // This exact OS-temp test root was created by this test and contains only
      // synthetic builder sources/receipts; the real repository is never built.
      await rm(base, { recursive: true, force: true });
    }
  },
);
