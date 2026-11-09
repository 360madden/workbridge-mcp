import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

// Extract only the pure helpers and scoped environment block. Never execute the
// builder, create a release, write the registry, or contact a running service.
test(
  'release builder refresh is opt-in, restored, and preflighted before payload writes',
  { skip: process.platform !== 'win32' },
  () => {
    const script = String.raw`$ErrorActionPreference = 'Stop'
$inputData = [Console]::In.ReadToEnd() | ConvertFrom-Json
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($inputData.scriptPath, [ref]$tokens, [ref]$errors)
$script:checks = 0
function Check([bool]$Condition, [string]$Message) {
    if (!$Condition) { throw $Message }
    $script:checks++
}
Check ($errors.Count -eq 0) 'Release builder must parse without errors.'
$definitions = @{}
foreach ($name in @('Get-WBRegisteredValidationEnvironment', 'Invoke-WBPrerequisiteVersion', 'Assert-WBReleasePrerequisites')) {
    $matches = @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true))
    Check ($matches.Count -eq 1) "Expected one helper: $name"
    $definitions[$name] = $matches[0].Extent.Text
    . ([scriptblock]::Create($definitions[$name]))
}
$switch = @($ast.ParamBlock.Parameters | Where-Object { $_.Name.VariablePath.UserPath -eq 'RefreshUserEnvironment' })
Check ($switch.Count -eq 1 -and $null -eq $switch[0].DefaultValue) 'Environment refresh must be opt-in.'
$reader = $definitions['Get-WBRegisteredValidationEnvironment']
Check ($reader.Contains('DoNotExpandEnvironmentNames')) 'Registered values must be read without implicit expansion.'
Check ($reader -notmatch 'SetValue|CreateSubKey|SetEnvironmentVariable') 'Registry reader must not write anything.'
$outer = @($ast.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.TryStatementAst] })
Check ($outer.Count -eq 1) 'Expected one outer release try/finally.'
$firstStatement = $outer[0].Body.Statements[0]
Check ($firstStatement -is [Management.Automation.Language.AssignmentStatementAst] -and $firstStatement.Left.VariablePath.UserPath -ceq 'env:CONTROL_PLANE_API_KEY' -and $firstStatement.Right.Extent.Text -ceq '$null') 'Caller tunnel key must be removed before any preflight or payload work.'
$keySave = @($ast.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.AssignmentStatementAst] -and $_.Left.VariablePath.UserPath -ceq 'previousKey' })
Check ($keySave.Count -eq 1 -and $keySave[0].Right.Extent.Text -ceq '$env:CONTROL_PLANE_API_KEY' -and $keySave[0].Extent.EndOffset -lt $outer[0].Extent.StartOffset) 'Existing caller key restoration source must remain before the outer try.'
$keyRestore = @($outer[0].Finally.Statements | Where-Object { $_ -is [Management.Automation.Language.AssignmentStatementAst] -and $_.Left.VariablePath.UserPath -ceq 'env:CONTROL_PLANE_API_KEY' })
Check ($keyRestore.Count -eq 1 -and $keyRestore[0].Right.Extent.Text -ceq '$previousKey') 'Existing caller key restoration must remain in the outer finally.'
$refresh = @($outer[0].Body.Statements | Where-Object { $_ -is [Management.Automation.Language.IfStatementAst] -and $_.Clauses[0].Item1.Extent.Text -eq '$RefreshUserEnvironment' })
$restore = @($outer[0].Finally.Statements | Where-Object { $_ -is [Management.Automation.Language.IfStatementAst] -and $_.Clauses[0].Item1.Extent.Text -eq '$RefreshUserEnvironment' })
Check ($refresh.Count -eq 1 -and $restore.Count -eq 1) 'Refresh and restoration must share the outer try/finally.'
$copy = @($outer[0].Body.FindAll({ param($node) $node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -in @('New-Item', 'Copy-WBTree') }, $true))
Check ($copy.Count -eq 2 -and ($copy | Where-Object { $_.Extent.StartOffset -lt $refresh[0].Extent.EndOffset }).Count -eq 0) 'Preflight must run before payload creation or copy.'
$saved = @($ast.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.AssignmentStatementAst] -and $_.Left.VariablePath.UserPath -in @('previousValidationPath', 'previousValidationDotNetRoot') })
Check ($saved.Count -eq 2) 'Both original process values must be saved.'
$saveBlock = [scriptblock]::Create(($saved | ForEach-Object { $_.Extent.Text }) -join [Environment]::NewLine)
$refreshBlock = [scriptblock]::Create($refresh[0].Extent.Text)
$restoreBlock = [scriptblock]::Create($restore[0].Extent.Text)
$actualPath = [Environment]::GetEnvironmentVariable('Path', 'Process')
$actualDotnet = [Environment]::GetEnvironmentVariable('DOTNET_ROOT', 'Process')
$actualVenv = [Environment]::GetEnvironmentVariable('VIRTUAL_ENV', 'Process')
$callerPath = 'C:\custom-venv\Scripts;%KeepRaw%;C:\caller;C:\caller'
$callerDotnet = 'C:\caller-dotnet'
$script:registered = [pscustomobject]@{ Path = '%SystemRoot%\System32;%DOTNET_ROOT%;C:\registered-user'; DotNetRoot = 'C:\registered-dotnet' }
function Get-WBRegisteredValidationEnvironment { return $script:registered }
function Assert-WBReleasePrerequisites {
    $script:preflightCount++
    if ($script:failPreflight) { throw 'synthetic preflight failure' }
}
function Exercise-Refresh([bool]$Enabled, [bool]$FailAction) {
    $RefreshUserEnvironment = $Enabled
    . $saveBlock
    try {
        . $refreshBlock
        $script:actionCount++
        $expectedPath = $callerPath
        $expectedDotnet = $callerDotnet
        if ($Enabled) {
            $expectedPath = [Environment]::ExpandEnvironmentVariables($script:registered.Path)
            $expectedDotnet = $script:registered.DotNetRoot
        }
        Check ([Environment]::GetEnvironmentVariable('Path', 'Process') -ceq $expectedPath) 'Process PATH differs from selected mode.'
        Check ([Environment]::GetEnvironmentVariable('DOTNET_ROOT', 'Process') -ceq $expectedDotnet) 'Process DOTNET_ROOT differs from selected mode.'
        Check ($env:VIRTUAL_ENV -ceq 'C:\custom-venv') 'Refresh must not alter VIRTUAL_ENV.'
        if ($FailAction) { throw 'synthetic action failure' }
    } finally { . $restoreBlock }
}
try {
    [Environment]::SetEnvironmentVariable('VIRTUAL_ENV', 'C:\custom-venv', 'Process')
    foreach ($scenario in @(
        @{ Enabled = $false; FailAction = $false; FailPreflight = $false },
        @{ Enabled = $true; FailAction = $false; FailPreflight = $false },
        @{ Enabled = $true; FailAction = $true; FailPreflight = $false },
        @{ Enabled = $true; FailAction = $false; FailPreflight = $true }
    )) {
        [Environment]::SetEnvironmentVariable('Path', $callerPath, 'Process')
        [Environment]::SetEnvironmentVariable('DOTNET_ROOT', $callerDotnet, 'Process')
        $script:failPreflight = $scenario.FailPreflight
        $script:preflightCount = 0
        $script:actionCount = 0
        $caught = $null
        try { Exercise-Refresh $scenario.Enabled $scenario.FailAction } catch { $caught = $_.Exception.Message }
        $expectedError = $null
        if ($scenario.FailAction) { $expectedError = 'synthetic action failure' }
        if ($scenario.FailPreflight) { $expectedError = 'synthetic preflight failure' }
        Check ($caught -ceq $expectedError) 'Unexpected refresh/action failure.'
        Check ($script:preflightCount -eq [int]$scenario.Enabled) 'Default mode must not preflight or replace a custom environment.'
        Check ($script:actionCount -eq [int](!$scenario.FailPreflight)) 'Preflight failure must prevent payload work.'
        Check ([Environment]::GetEnvironmentVariable('Path', 'Process') -ceq $callerPath) 'Caller PATH must be restored exactly, including raw tokens and duplicates.'
        Check ([Environment]::GetEnvironmentVariable('DOTNET_ROOT', 'Process') -ceq $callerDotnet) 'Caller DOTNET_ROOT must be restored on all exits.'
    }
    $callerDotnet = $null
    $script:registered.DotNetRoot = $null
    [Environment]::SetEnvironmentVariable('DOTNET_ROOT', $null, 'Process')
    $script:failPreflight = $false
    Exercise-Refresh $true $false
    Check ($null -eq [Environment]::GetEnvironmentVariable('DOTNET_ROOT', 'Process')) 'Absent DOTNET_ROOT must remain absent after restoration.'
} finally {
    [Environment]::SetEnvironmentVariable('Path', $actualPath, 'Process')
    [Environment]::SetEnvironmentVariable('DOTNET_ROOT', $actualDotnet, 'Process')
    [Environment]::SetEnvironmentVariable('VIRTUAL_ENV', $actualVenv, 'Process')
}
. ([scriptblock]::Create($definitions['Assert-WBReleasePrerequisites']))
$script:missingTool = ''
$script:failVersion = ''
$script:probes = @()
function Get-Command {
    param([string]$Name, [string]$CommandType, [string]$ErrorAction)
    Check ($CommandType -eq 'Application') 'Preflight must resolve an application explicitly.'
    if ($Name -eq $script:missingTool) { throw 'synthetic missing tool' }
    $extension = '.exe'
    if ($Name -eq 'npm') { $extension = '.cmd' }
    if ($Name -eq 'powershell.exe') { $extension = '' }
    return [pscustomobject]@{ Source = "C:\probe tools\$Name$extension" }
}
function Test-Path { param([string]$LiteralPath, [string]$PathType) return $LiteralPath -ceq 'C:\probe tools\node_modules\npm\bin\npm-cli.js' -and $PathType -eq 'Leaf' }
function Invoke-WBPrerequisiteVersion {
    param([string]$Name, [string]$Executable, [string]$Arguments)
    $script:probes += [pscustomobject]@{ Name = $Name; Executable = $Executable; Arguments = $Arguments }
    if ($Name -eq $script:failVersion) { throw 'synthetic version failure' }
    return 'probe-v1'
}
Assert-WBReleasePrerequisites
Check ($script:probes.Count -eq 7) 'All existing test prerequisites must be checked.'
Check ($script:probes[1].Executable -ceq 'C:\probe tools\node.exe' -and $script:probes[1].Arguments -ceq '"C:\probe tools\node_modules\npm\bin\npm-cli.js" --version') 'npm must use its official Node CLI without an implicit shell.'
Check ($script:probes[6].Arguments.Contains('-NoProfile -NonInteractive')) 'PowerShell probe must be noninteractive.'
$script:missingTool = 'python'
$caught = $null
try { Assert-WBReleasePrerequisites } catch { $caught = $_.Exception.Message }
Check ($caught -like '*prerequisite python*refreshed PATH*') 'Missing tool must fail clearly.'
$script:missingTool = ''
$script:failVersion = 'dotnet'
$caught = $null
try { Assert-WBReleasePrerequisites } catch { $caught = $_.Exception.Message }
Check ($caught -eq 'synthetic version failure') 'Version failure must propagate.'
. ([scriptblock]::Create($definitions['Invoke-WBPrerequisiteVersion']))
Check ((Invoke-WBPrerequisiteVersion -Name synthetic -Executable $inputData.nodeExe -Arguments '-e "process.stdout.write(''probe-v1'')"') -ceq 'probe-v1') 'Successful native version output must be returned.'
foreach ($probe in @(
    @{ Arguments = '-e "process.exit(7)"'; Timeout = 15000; Expected = '*exited 7:*' },
    @{ Arguments = '-e "process.exit(0)"'; Timeout = 15000; Expected = '*no version output*' },
    @{ Arguments = '-e "setTimeout(()=>{},10000)"'; Timeout = 100; Expected = '*version probe timed out*' }
)) {
    $caught = $null
    try { Invoke-WBPrerequisiteVersion -Name synthetic -Executable $inputData.nodeExe -Arguments $probe.Arguments -TimeoutMilliseconds $probe.Timeout | Out-Null } catch { $caught = $_.Exception.Message }
    Check ($caught -like $probe.Expected) "Unexpected native probe result: $caught"
}
Write-Output ("PASS checks=" + $script:checks)
`;
    const result = spawnSync(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      {
        cwd: root,
        input: JSON.stringify({
          scriptPath: path.join(root, 'scripts', 'New-WorkbridgeRelease.ps1'),
          nodeExe: process.execPath,
        }),
        encoding: 'utf8',
        windowsHide: true,
        timeout: 30000,
        maxBuffer: 64 * 1024,
      },
    );
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /PASS checks=\d+/);
  },
);
