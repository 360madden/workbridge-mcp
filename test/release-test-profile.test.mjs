import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

test('serial release profile changes only test-file scheduling', async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.test, 'npm run build && node --test test/*.test.mjs');
  assert.equal(
    pkg.scripts['test:serial'],
    pkg.scripts.test.replace('node --test ', 'node --test --test-concurrency=1 '),
  );
});

const pwsh = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe');
const shells = [
  { executable: 'powershell.exe', optional: false },
  { executable: pwsh, optional: true },
];

for (const { executable: shell, optional } of shells) {
  test(
    'release test profile preserves every gate: ' + path.basename(shell),
    {
      skip:
        process.platform !== 'win32'
          ? 'Windows PowerShell compatibility requires Windows.'
          : optional && !existsSync(shell)
            ? 'Optional PowerShell 7 is absent from its standard installation path.'
            : false,
    },
    () => {
      // Extract and execute only the pure profile and command-list construction.
      // No builder body, native release command, release directory or owner is run.
      const script = String.raw`$ErrorActionPreference = 'Stop'
$scriptPath = [Console]::In.ReadToEnd()
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Builder parse failed.' }
$switch = @($ast.ParamBlock.Parameters | Where-Object { $_.Name.VariablePath.UserPath -ceq 'SerialTests' })
if ($switch.Count -ne 1 -or $null -ne $switch[0].DefaultValue) { throw 'Serial scheduling must remain opt-in.' }
$profileFunction = @($ast.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Get-WBReleaseTestProfile' }, $true))
if ($profileFunction.Count -ne 1) { throw 'Expected one pure profile helper.' }
. ([scriptblock]::Create($profileFunction[0].Extent.Text))
$profileAssignment = @($ast.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.AssignmentStatementAst] -and $_.Left.VariablePath.UserPath -ceq 'testProfile' })
if ($profileAssignment.Count -ne 1) { throw 'Expected one profile selection.' }
$gateLoop = @($ast.FindAll({ param($n) $n -is [Management.Automation.Language.ForEachStatementAst] -and $n.Variable.VariablePath.UserPath -ceq 'command' -and $n.Condition.Extent.Text -ceq '$commands' }, $true))
if ($gateLoop.Count -ne 1) { throw 'Expected one gate loop.' }
$container = $gateLoop[0].Parent
$construction = @($container.Statements | Where-Object { $_.Extent.EndOffset -le $gateLoop[0].Extent.StartOffset })
if ($construction.Count -ne 5) { throw 'Expected all five command construction statements.' }
$constructionBlock = [scriptblock]::Create(($construction | ForEach-Object { $_.Extent.Text }) -join [Environment]::NewLine)
$payload = 'C:\synthetic-source\payload'
$checks = 0
foreach ($SerialTests in @($false, $true)) {
    . ([scriptblock]::Create($profileAssignment[0].Extent.Text))
    if ($SerialTests) {
        if ($testProfile.name -cne 'serial-files' -or $testProfile.fileConcurrency -ne 1 -or ($testProfile.arguments -join '|') -cne 'run|test:serial') { throw 'Wrong serial profile.' }
    } else {
        if ($testProfile.name -cne 'default' -or $null -ne $testProfile.fileConcurrency -or ($testProfile.arguments -join '|') -cne 'test') { throw 'Default test profile changed.' }
    }
    foreach ($requiresDesktopRuntime in @($false, $true)) {
        . $constructionBlock
        $expected = @('install')
        if ($requiresDesktopRuntime) { $expected += @('desktop-prebuild', 'desktop-prestage') }
        $expected += @('tests', 'startup', 'updater', 'format', 'generic')
        if ($requiresDesktopRuntime) { $expected += 'desktop-stage' }
        $expected += 'acceptance'
        if (($commands.name -join '|') -cne ($expected -join '|')) { throw 'Required gates differ.' }
        $testGate = @($commands | Where-Object { $_.name -ceq 'tests' })
        if ($testGate.Count -ne 1 -or ($testGate[0].args -join '|') -cne ($testProfile.arguments -join '|')) { throw 'Test gate does not use selected profile.' }
        $unchanged = @{
            install = @('ci', '--no-audit', '--no-fund')
            'desktop-prebuild' = @('run', 'build')
            'desktop-prestage' = @('scripts/stage-desktop-runtime.mjs', '--repo-root', $payload)
            startup = @('run', 'test:startup')
            updater = @('run', 'test:updater')
            format = @('run', 'format:check')
            generic = @('run', 'acceptance')
            'desktop-stage' = @('scripts/stage-desktop-runtime.mjs', '--repo-root', $payload)
            acceptance = @('run', 'acceptance:release')
        }
        foreach ($command in @($commands | Where-Object { $_.name -cne 'tests' })) {
            if (($command.args -join '|') -cne ($unchanged[$command.name] -join '|')) { throw ('Changed gate: ' + $command.name) }
        }
        $checks++
    }
}
$receipt = @($ast.FindAll({ param($n) $n -is [Management.Automation.Language.CommandAst] -and $n.GetCommandName() -ceq 'Write-WBJson' -and $n.Extent.Text.Contains("'validated.json'") }, $true))
if ($receipt.Count -ne 1 -or !$receipt[0].Extent.Text.Contains('testProfile=$testProfile')) { throw 'Successful receipt must record the chosen test profile.' }
if (!$gateLoop[0].Extent.Text.Contains('if ($code -ne 0) { throw')) { throw 'A failed gate must still reject the release.' }
Write-Output ("PASS profile scenarios=" + $checks)
`;
      const result = spawnSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
        cwd: root,
        input: path.join(root, 'scripts', 'New-WorkbridgeRelease.ps1'),
        encoding: 'utf8',
        windowsHide: true,
        timeout: 30000,
        maxBuffer: 64 * 1024,
      });
      assert.equal(result.error, undefined, String(result.error));
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /PASS profile scenarios=4/);
    },
  );
}
