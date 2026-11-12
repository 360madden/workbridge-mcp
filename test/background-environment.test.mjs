import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const background = path.join(repo, 'scripts', 'Start-BackgroundTunnel.ps1');
const interactive = path.join(repo, 'scripts', 'Start-Tunnel.ps1');
const cases = [
  {
    label: 'machine then user PATH, user SDK wins',
    machinePath: 'C:\\Windows;C:\\Machine Tools',
    userPath: 'C:\\Python;C:\\User Tools',
    machineDotNetRoot: 'C:\\MachineSDK',
    userDotNetRoot: 'C:\\UserSDK',
    expectedPath: 'C:\\Windows;C:\\Machine Tools;C:\\Python;C:\\User Tools',
    expectedDotNetRoot: 'C:\\UserSDK',
  },
  {
    label: 'machine-only fallback',
    machinePath: 'C:\\Windows',
    userPath: '',
    machineDotNetRoot: 'C:\\MachineSDK',
    userDotNetRoot: '',
    expectedPath: 'C:\\Windows',
    expectedDotNetRoot: 'C:\\MachineSDK',
  },
  {
    label: 'user-only PATH expands values and clears removed SDK',
    machinePath: '',
    userPath: '%WB_BACKGROUND_ENV_TEST%\\bin;C:\\Other',
    machineDotNetRoot: '',
    userDotNetRoot: '',
    expectedPath: 'C:\\Fixture Tools\\bin;C:\\Other',
    expectedDotNetRoot: '',
  },
  {
    label: 'registered SDK expansion',
    machinePath: 'C:\\Windows',
    userPath: '  ',
    machineDotNetRoot: '',
    userDotNetRoot: '%WB_BACKGROUND_ENV_TEST%\\sdk',
    expectedPath: 'C:\\Windows',
    expectedDotNetRoot: 'C:\\Fixture Tools\\sdk',
  },
  {
    label: 'PATH uses the fresh registered SDK, not the inherited SDK',
    machinePath: 'C:\\Windows',
    userPath: '%DOTNET_ROOT%\\bin',
    machineDotNetRoot: 'C:\\MachineSDK',
    userDotNetRoot: 'C:\\NewSDK',
    expectedPath: 'C:\\Windows;C:\\NewSDK\\bin',
    expectedDotNetRoot: 'C:\\NewSDK',
  },
  {
    label: 'missing registered PATH fails before changing either value',
    machinePath: '',
    userPath: '  ',
    machineDotNetRoot: 'C:\\UnusedSDK',
    userDotNetRoot: '',
    fail: true,
    expectedPath: 'C:\\Stale',
    expectedDotNetRoot: 'C:\\StaleSDK',
  },
];

test('background refresh runs before the tunnel; interactive launcher is untouched', () => {
  const source = readFileSync(background, 'utf8').replace(/\r\n/g, '\n');
  const invocation = source.indexOf('\n    Set-WBBackgroundDeveloperEnvironment\n');
  assert.ok(invocation > 0);
  assert.ok(invocation < source.indexOf('    Add-Type -Path (Join-Path $PSScriptRoot'));
  assert.match(source, /RegistryValueOptions\]::DoNotExpandEnvironmentNames/);
  assert.match(source, /ValidateSet\('Path', 'DOTNET_ROOT'\)/);
  assert.doesNotMatch(source, /SetValue|CreateSubKey|SetEnvironmentVariable/);
  assert.doesNotMatch(readFileSync(interactive, 'utf8'), /Set-WBBackgroundDeveloperEnvironment/);
});

const pwsh = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe');
for (const shell of ['powershell.exe', ...(existsSync(pwsh) ? [pwsh] : [])]) {
  test(
    `background registered environment is process-only and isolated: ${path.basename(shell)}`,
    {
      skip: process.platform !== 'win32',
    },
    () => {
      const ps = [
        "$ErrorActionPreference='Stop'; $tokens=$null; $errors=$null",
        "$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path (Get-Location) 'scripts/Start-BackgroundTunnel.ps1'),[ref]$tokens,[ref]$errors)",
        "if ($errors.Count) { throw 'Background PowerShell syntax failed' }",
        "$nodes=@($ast.FindAll({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Set-WBBackgroundDeveloperEnvironment'},$true))",
        "if ($nodes.Count -ne 1) { throw 'Expected one background environment function' }",
        '. ([scriptblock]::Create($nodes[0].Extent.Text))',
        "$env:WB_BACKGROUND_ENV_TEST='C:\\Fixture Tools'; $env:WB_BACKGROUND_UNRELATED='preserved'",
        '$cases=@((ConvertFrom-Json -InputObject ([Console]::In.ReadToEnd())))',
        'foreach ($row in $cases) {',
        "  $env:Path='C:\\Stale'; $env:DOTNET_ROOT='C:\\StaleSDK'; $failed=$false",
        '  try { Set-WBBackgroundDeveloperEnvironment -MachinePath $row.machinePath -UserPath $row.userPath -MachineDotNetRoot $row.machineDotNetRoot -UserDotNetRoot $row.userDotNetRoot }',
        "  catch { if ($_.Exception.Message -notlike 'BACKGROUND_ENVIRONMENT_MISSING:*') { throw }; $failed=$true }",
        "  if ($failed -ne [bool]$row.fail -or $env:Path -cne $row.expectedPath -or [string]$env:DOTNET_ROOT -cne $row.expectedDotNetRoot) { throw ('Unexpected environment: ' + $row.label) }",
        "  if ($env:WB_BACKGROUND_UNRELATED -cne 'preserved') { throw 'Unrelated environment changed' }",
        '}',
        "Write-Output ('PASS ' + $cases.Count + ' background environment cases')",
      ].join('\n');
      const child = spawnSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', ps], {
        cwd: repo,
        input: JSON.stringify(cases),
        encoding: 'utf8',
        windowsHide: true,
        timeout: 30_000,
        maxBuffer: 16 * 1024,
      });
      assert.equal(child.error, undefined, String(child.error));
      assert.equal(child.status, 0, child.stderr || child.stdout);
      assert.match(child.stdout, /PASS 6 background environment cases/);
    },
  );
}
