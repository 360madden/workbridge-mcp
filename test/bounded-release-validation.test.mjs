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
const installedPwsh = path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'PowerShell/7/pwsh.exe');
const configuredPwsh = process.env.PWSH_BIN;
const pwsh = configuredPwsh ?? (existsSync(installedPwsh) ? installedPwsh : 'pwsh.exe');
const probe =
  process.platform === 'win32'
    ? spawnSync(
        pwsh,
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.Major'],
        {
          encoding: 'utf8',
          windowsHide: true,
          timeout: 10000,
        },
      )
    : null;
const skipNative =
  process.platform !== 'win32'
    ? 'Windows only'
    : !configuredPwsh && probe?.error?.code === 'ENOENT'
      ? 'PowerShell 7 is unavailable; set PWSH_BIN to its full executable path'
      : false;

function requirePwsh() {
  if (configuredPwsh !== undefined) assert.ok(path.isAbsolute(configuredPwsh), 'PWSH_BIN must be absolute');
  assert.equal(probe.error, undefined, String(probe.error));
  assert.equal(probe.status, 0, probe.stderr);
  assert.match(probe.stdout.trim(), /^7$/, 'The selected executable must be PowerShell 7');
}

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
  assert.ok(source.indexOf('$watchdog.CancelAfter(') < source.indexOf('$workspace = Get-WBValidationPath'));
  assert.match(source, /\$hardLimitSeconds = 1200/);
  assert.doesNotMatch(source, /'validated\.json'/);
  assert.doesNotMatch(
    source,
    /Register-ScheduledTask|Start-ScheduledTask|Update-Workbridge\.ps1|Restart-Computer/,
  );
});

test(
  'bounded validation fixtures reject stale inputs, failed gates, deadlines, output overflow, and replay',
  {
    skip: skipNative,
    timeout: 60000,
  },
  async () => {
    requirePwsh();
    const base = await mkdtemp(path.join(os.tmpdir(), 'wb-bounded-validation-'));
    const lifetimeBytes = await readFile(lifetime);
    async function fixture(name, body = '', afterReceipt = '') {
      const directory = path.join(base, name);
      const sourceRoot = path.join(directory, 'source');
      const evidence = path.join(directory, 'evidence');
      await mkdir(path.join(sourceRoot, 'scripts'), { recursive: true });
      await copyFile(lifetime, path.join(sourceRoot, 'scripts/Desktop-JobLifetime.cs'));
      const builder = String.raw`param([string]$SourceRoot, [string]$ReleaseId, [string]$WorkspaceRoot, [switch]$RefreshUserEnvironment, [switch]$SerialTests, [switch]$PendingReceipt)
$ErrorActionPreference = 'Stop'
if (!$RefreshUserEnvironment -or !$SerialTests -or !$PendingReceipt) { throw 'Required complete serial profile switches missing.' }
if ($env:CONTROL_PLANE_API_KEY) { throw 'Synthetic credential reached child.' }
${body}
$release = Join-Path $SourceRoot ('.local\releases\' + $ReleaseId)
$null = [IO.Directory]::CreateDirectory($release)
[IO.File]::WriteAllText((Join-Path $release 'validated.pending.json'), '{"result":"passed","testProfile":{"name":"serial-files","fileConcurrency":1}}')
${afterReceipt}
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
      assert.equal(success.wrapperHardLimitSeconds, 1200);
      assert.equal(success.receiptFile, 'validated.pending.json');
      assert.equal(
        success.receiptSha256,
        sha(await readFile(path.join(passed.release, success.receiptFile))),
      );
      await assert.rejects(stat(path.join(passed.release, 'validated.json')), { code: 'ENOENT' });
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

      // Instrument only disposable copies: production has no deadline override or injected stall hook.
      async function blockedCase(name, anchor, seconds, afterReceipt = '') {
        const stalled = await fixture(name, '', afterReceipt);
        const script = await readFile(runner, 'utf8');
        const duration = '$hardLimitSeconds = 1200';
        assert.equal(script.split(duration).length, 2);
        assert.equal(script.split(anchor).length, 2);
        const modified = script
          .replace(duration, '$hardLimitSeconds = ' + seconds)
          .replace(
            anchor,
            "[IO.File]::WriteAllText((Join-Path $WorkspaceRoot '" +
              name +
              ".entered'), '1')\n" +
              '[Threading.Thread]::Sleep(30000)\n' +
              anchor,
          );
        const copy = path.join(base, name + '-runner.ps1');
        await writeFile(copy, modified);
        const started = performance.now();
        const result = run(stalled, { '-File': copy });
        assert.equal(result.error, undefined, String(result.error));
        assert.equal(result.status >>> 0, 0xffffffff, result.stderr + result.stdout);
        assert.ok(performance.now() - started < (seconds + 4) * 1000, 'parent timeout must not be the bound');
        assert.equal(await readFile(path.join(base, name + '.entered'), 'utf8'), '1');
        await assert.rejects(stat(path.join(stalled.release, 'validated.json')), { code: 'ENOENT' });
        await assert.rejects(stat(path.join(stalled.evidence, 'completed.json')), { code: 'ENOENT' });
        return stalled;
      }
      const before = await blockedCase('blocked-preflight', '$workspace = Get-WBValidationPath', 3);
      await assert.rejects(stat(before.evidence), { code: 'ENOENT' });
      const during = await blockedCase(
        'blocked-child',
        '$stdout = [Workbridge.ValidationOutput]',
        7,
        '[Threading.Thread]::Sleep(30000)',
      );
      assert.ok(await stat(path.join(during.release, 'validated.pending.json')));
      const child = JSON.parse(await readFile(path.join(during.evidence, 'child.json'), 'utf8'));
      for (let i = 0; i < 20; i++) {
        try {
          process.kill(child.pid, 0);
        } catch (error) {
          if (error.code === 'ESRCH') break;
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
      const after = await blockedCase('blocked-finalization', '$record.endedUtc =', 6);
      assert.ok(await stat(path.join(after.release, 'validated.pending.json')));

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

test(
  'standalone canonical receipt and pending-only review remain distinct',
  { skip: skipNative },
  async () => {
    requirePwsh();
    const base = await mkdtemp(path.join(os.tmpdir(), 'wb-pending-contract-'));
    try {
      const script = String.raw`
$ErrorActionPreference = 'Stop'
. (Join-Path (Get-Location) 'scripts/Workbridge-Update.ps1')
$release = $env:WB_SYNTHETIC_RELEASE
$payload = Join-Path $release 'payload'
$null = New-Item -ItemType Directory (Join-Path $payload 'dist'), (Join-Path $payload 'node_modules') -Force
$package = @{ name='workbridge-mcp'; version='0.4.0' }
Write-WBJson (Join-Path $payload 'package.json') $package
Write-WBJson (Join-Path $payload 'package-lock.json') @{}
Write-WBJson (Join-Path $release 'manifest.json') @{ schema=1; version=$package.version; files=@(Get-WBManifest $payload) }
$checks = @{ install=0; tests=0; startup=0; updater=0; format=0; acceptance=0 }
$testProfile = @{ name='serial-files'; fileConcurrency=1 }
$probe = @{}
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path (Get-Location) 'scripts/New-WorkbridgeRelease.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Builder did not parse.' }
$write=@($ast.FindAll({ param($n) $n -is [Management.Automation.Language.CommandAst] -and $n.GetCommandName() -ceq 'Write-WBJson' -and $n.Extent.Text.Contains('manifestSha256=') }, $true))
if ($write.Count -ne 1) { throw 'Expected one actual builder receipt write.' }
$emit=[scriptblock]::Create($write[0].Extent.Text)
$PendingReceipt=$true; & $emit
$null=Get-WBRelease $release -PendingReceipt
try { $null=Get-WBRelease $release; throw 'Canonical lookup unexpectedly accepted pending receipt.' }
catch [Management.Automation.ItemNotFoundException] { if ($_.Exception.Message -notmatch 'validated\.json') { throw } }
$PendingReceipt=$false; & $emit
$null=Get-WBRelease $release
[Console]::WriteLine('PASS pending and canonical paths')
`;
      const result = spawnSync(pwsh, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true,
        timeout: 15000,
        env: { ...process.env, WB_SYNTHETIC_RELEASE: base },
      });
      assert.equal(result.error, undefined, String(result.error));
      assert.equal(result.status, 0, result.stderr + result.stdout);
      assert.match(result.stdout, /PASS pending and canonical paths/);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  },
);
