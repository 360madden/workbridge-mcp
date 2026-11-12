import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
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
$saved = @($ast.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.AssignmentStatementAst] -and $_.Left.VariablePath.UserPath -in @('previousValidationPath', 'previousValidationDotNetRoot', 'previousValidationModulePath') })
Check ($saved.Count -eq 3) 'All three original process values must be saved.'
$saveBlock = [scriptblock]::Create(($saved | ForEach-Object { $_.Extent.Text }) -join [Environment]::NewLine)
$refreshBlock = [scriptblock]::Create($refresh[0].Extent.Text)
$restoreBlock = [scriptblock]::Create($restore[0].Extent.Text)
Check (!$refresh[0].Extent.Text.Contains("'PSModulePath'")) 'Clear the module path at each native boundary, not before command discovery.'
$gateLoop = @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.ForEachStatementAst] -and $node.Variable.VariablePath.UserPath -ceq 'command' }, $true))[0]
$dispatch = @($gateLoop.Body.FindAll({ param($node) $node -is [Management.Automation.Language.IfStatementAst] -and $node.Clauses[0].Item1.Extent.Text -ceq '$RefreshUserEnvironment' }, $true))
Check ($dispatch.Count -eq 1 -and $dispatch[0].Clauses[0].Item2.Extent.Text.Contains('Invoke-WBReleaseNativeGate')) 'Every refreshed release gate must use native isolation.'
Check ($dispatch[0].ElseClause.Extent.Text.Contains('& node @arguments') -and $dispatch[0].ElseClause.Extent.Text.Contains('& npm @arguments') -and !$dispatch[0].ElseClause.Extent.Text.Contains('Invoke-WBReleaseNativeGate')) 'Default native command dispatch must remain unchanged.'
$actualPath = [Environment]::GetEnvironmentVariable('Path', 'Process')
$actualDotnet = [Environment]::GetEnvironmentVariable('DOTNET_ROOT', 'Process')
$actualModulePath = [Environment]::GetEnvironmentVariable('PSModulePath', 'Process')
$actualVenv = [Environment]::GetEnvironmentVariable('VIRTUAL_ENV', 'Process')
$callerPath = 'C:\custom-venv\Scripts;%KeepRaw%;C:\caller;C:\caller'
$callerDotnet = 'C:\caller-dotnet'
$callerModulePath = 'C:\custom-modules;%KeepRaw%;C:\custom-modules'
$script:registered = [pscustomobject]@{ Path = '%SystemRoot%\System32;%DOTNET_ROOT%;C:\registered-user'; DotNetRoot = 'C:\registered-dotnet' }
function Get-WBRegisteredValidationEnvironment { return $script:registered }
function Assert-WBReleasePrerequisites {
    Check ([Environment]::GetEnvironmentVariable('PSModulePath', 'Process') -ceq $callerModulePath) 'Preflight must not rely on a one-time module-path clear.'
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
        $expectedModulePath = $callerModulePath
        if ($Enabled) {
            $expectedPath = [Environment]::ExpandEnvironmentVariables($script:registered.Path)
            $expectedDotnet = $script:registered.DotNetRoot
        }
        Check ([Environment]::GetEnvironmentVariable('Path', 'Process') -ceq $expectedPath) 'Process PATH differs from selected mode.'
        Check ([Environment]::GetEnvironmentVariable('DOTNET_ROOT', 'Process') -ceq $expectedDotnet) 'Process DOTNET_ROOT differs from selected mode.'
        Check ([Environment]::GetEnvironmentVariable('PSModulePath', 'Process') -ceq $expectedModulePath) 'Process module path differs from selected mode.'
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
        [Environment]::SetEnvironmentVariable('PSModulePath', $callerModulePath, 'Process')
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
        Check ([Environment]::GetEnvironmentVariable('PSModulePath', 'Process') -ceq $callerModulePath) 'Caller PSModulePath must be restored exactly on all exits, including raw tokens and duplicates.'
    }
    $callerDotnet = $null
    $callerModulePath = $null
    [Environment]::SetEnvironmentVariable('PSModulePath', $null, 'Process')
    $script:registered.DotNetRoot = $null
    [Environment]::SetEnvironmentVariable('DOTNET_ROOT', $null, 'Process')
    $script:failPreflight = $false
    Exercise-Refresh $true $false
    Check ($null -eq [Environment]::GetEnvironmentVariable('DOTNET_ROOT', 'Process')) 'Absent DOTNET_ROOT must remain absent after restoration.'
    Check ($null -eq [Environment]::GetEnvironmentVariable('PSModulePath', 'Process')) 'Absent PSModulePath must remain absent after restoration.'
} finally {
    [Environment]::SetEnvironmentVariable('Path', $actualPath, 'Process')
    [Environment]::SetEnvironmentVariable('DOTNET_ROOT', $actualDotnet, 'Process')
    [Environment]::SetEnvironmentVariable('PSModulePath', $actualModulePath, 'Process')
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

const pwsh = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe');
const nativeBoundaryShells = [
  { executable: 'powershell.exe', optional: false },
  { executable: pwsh, optional: true },
];

const nativeBoundaryFixture = String.raw`const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');
const mode = process.argv[2];
if (mode !== 'baseline') {
  assert.deepEqual(Object.keys(process.env).filter((name) => name.toLowerCase() === 'psmodulepath'), []);
}
if (mode === 'chain') {
  const inputPath = process.argv[3];
  const executable = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const result = spawnSync(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'\nif($PSVersionTable.PSVersion.Major -ne 5){throw 'Expected Windows PowerShell 5.1.'}\n$inputPath=[Console]::In.ReadToEnd()\n$command=Get-Command -Name Get-FileHash -ErrorAction Stop\nif(!$command.Module.Path.StartsWith($PSHOME + '\\', [StringComparison]::OrdinalIgnoreCase)){throw 'Wrong PowerShell Utility module.'}\n[Console]::WriteLine('HASH_OK:' + (Get-FileHash -LiteralPath $inputPath -Algorithm SHA256).Hash)\n"], {
    input: inputPath, encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 65536,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.stderr, '');
  const hash = createHash('sha256').update(readFileSync(inputPath)).digest('hex').toUpperCase();
  assert.equal(result.stdout.trim(), 'HASH_OK:' + hash);
  process.stdout.write('CHILD_MODULE_PATH_ABSENT;CHILD_HASH_PASS\n');
} else if (mode === 'exit') {
  process.stdout.write('NATIVE_STDOUT\n');
  process.stderr.write('NATIVE_STDERR\n');
  process.exitCode = Number(process.argv[3]);
} else {
  process.stdout.write('ARGV:' + JSON.stringify(process.argv.slice(3)) + '\n');
  process.stderr.write('NATIVE_STDERR\n');
}
`;

for (const { executable: shell, optional } of nativeBoundaryShells) {
  test(
    'native release gates isolate child modules and restore caller state: ' + path.basename(shell),
    {
      skip:
        process.platform !== 'win32'
          ? 'Windows PowerShell compatibility requires Windows.'
          : optional && !existsSync(shell)
            ? 'Optional PowerShell 7 is absent from its standard installation path.'
            : false,
    },
    () => {
      const scratch = mkdtempSync(path.join(os.tmpdir(), 'wb native gate '));
      const fixture = path.join(scratch, 'native probe.cjs');
      const invalidExe = path.join(scratch, 'invalid native.exe');
      writeFileSync(fixture, nativeBoundaryFixture, 'utf8');
      writeFileSync(invalidExe, 'This is not an executable.', 'utf8');
      const literalArguments = [
        'C:\\path with spaces\\payload',
        'literal "double quote"',
        "apostrophe '",
        '%KeepRaw%;$();&|',
        'C:\\trailing space\\',
      ];
      const script = String.raw`$ErrorActionPreference='Stop'
$inputData=[Console]::In.ReadToEnd() | ConvertFrom-Json
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($inputData.scriptPath,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Builder parse failed.'}
foreach($name in @('Get-WBRegisteredValidationEnvironment','Invoke-WBPrerequisiteVersion','Assert-WBReleasePrerequisites','Invoke-WBReleaseNativeGate')){
    $definition=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name},$true))
    if($definition.Count -ne 1){throw ('Missing production helper: ' + $name)}
    . ([scriptblock]::Create($definition[0].Extent.Text))
}
$outer=@($ast.EndBlock.Statements | Where-Object {$_ -is [Management.Automation.Language.TryStatementAst]})[0]
$saved=@($ast.EndBlock.Statements | Where-Object {$_ -is [Management.Automation.Language.AssignmentStatementAst] -and $_.Left.VariablePath.UserPath -in @('previousValidationPath','previousValidationDotNetRoot','previousValidationModulePath')})
$refresh=@($outer.Body.Statements | Where-Object {$_ -is [Management.Automation.Language.IfStatementAst] -and $_.Clauses[0].Item1.Extent.Text -ceq '$RefreshUserEnvironment'})[0]
$restore=@($outer.Finally.Statements | Where-Object {$_ -is [Management.Automation.Language.IfStatementAst] -and $_.Clauses[0].Item1.Extent.Text -ceq '$RefreshUserEnvironment'})[0]
$saveBlock=[scriptblock]::Create(($saved | ForEach-Object {$_.Extent.Text}) -join [Environment]::NewLine)
$refreshBlock=[scriptblock]::Create($refresh.Extent.Text)
$restoreBlock=[scriptblock]::Create($restore.Extent.Text)
$beforeModule=[Environment]::GetEnvironmentVariable('PSModulePath','Process')
$beforeDotnet=[Environment]::GetEnvironmentVariable('DOTNET_ROOT','Process')
$beforePath=[Environment]::GetEnvironmentVariable('Path','Process')
function Set-ProcessValue([string]$Name, $Value){
    if($null -eq $Value){[Environment]::SetEnvironmentVariable($Name,[NullString]::Value,'Process')}
    else{[Environment]::SetEnvironmentVariable($Name,$Value,'Process')}
}
function Check-ProcessValue([string]$Name, [bool]$Present, $Value){
    if([Environment]::GetEnvironmentVariables('Process').Contains($Name) -ne $Present -or
        [Environment]::GetEnvironmentVariable($Name,'Process') -cne $Value){throw ("Wrong process presence/value: " + $Name)}
}
try {
    # Exercise real command discovery and the exact native helper, not a fake preflight.
    # Full seven-tool prerequisites are covered by bounded LEGION integration, not
    # required of every generic npm-test host (which may not install gh/Python/.NET).
    $parentHash=(Get-FileHash -LiteralPath $inputData.scriptPath -Algorithm SHA256).Hash
    if(!(Get-Command Get-FileHash).Module.Path.StartsWith($PSHOME + '\',[StringComparison]::OrdinalIgnoreCase)){throw 'Parent hashing module is not native.'}
    $nativeExecutable=(Get-Command -Name $inputData.nodeExe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    if(![Environment]::GetEnvironmentVariables('Process').Contains('PSModulePath')){throw 'Expected populated parent module path before native boundary.'}
    $parentModule=[Environment]::GetEnvironmentVariable('PSModulePath','Process')
    $code=Invoke-WBReleaseNativeGate -Executable $nativeExecutable -Arguments @($inputData.fixture,'chain',$inputData.planner) -LogPath $inputData.logPath
    Check-ProcessValue 'PSModulePath' $true $parentModule
    if($code -ne 0){throw ('Native hashing chain failed: ' + (Get-Content -LiteralPath $inputData.logPath -Raw))}
    if((Get-Content -LiteralPath $inputData.logPath -Raw) -notmatch 'CHILD_MODULE_PATH_ABSENT;CHILD_HASH_PASS'){throw 'Missing actual child environment/hash evidence.'}
    if((Get-FileHash -LiteralPath $inputData.scriptPath -Algorithm SHA256).Hash -cne $parentHash){throw 'Parent native hashing failed after gate.'}

    # Compare with the existing native binder on 5.1; PS7 also must preserve the
    # complete literal argument list, including embedded double quotes.
    $literalArguments=[string[]]@($inputData.literalArguments)
    $baselineArguments=@($inputData.fixture,'baseline') + $literalArguments
    $previousPreference=$ErrorActionPreference
    try {
        $ErrorActionPreference='Continue'
        & $nativeExecutable @baselineArguments *> $inputData.baselineLog
        if($LASTEXITCODE -ne 0){throw 'Native argv baseline failed.'}
    } finally {$ErrorActionPreference=$previousPreference}
    $code=Invoke-WBReleaseNativeGate -Executable $nativeExecutable -Arguments (@($inputData.fixture,'arguments') + $literalArguments) -LogPath $inputData.logPath
    if($code -ne 0){throw 'Isolated native argv probe failed.'}
    $baselineLine=@((Get-Content -LiteralPath $inputData.baselineLog) | Where-Object {$_.StartsWith('ARGV:')})[0]
    $isolatedLog=Get-Content -LiteralPath $inputData.logPath -Raw
    $isolatedLine=@(($isolatedLog -split '\r?\n') | Where-Object {$_.StartsWith('ARGV:')})[0]
    if($isolatedLine -cne $baselineLine -or $isolatedLog -notmatch 'NATIVE_STDERR'){throw 'Native argument binding or stderr redirection changed.'}
    if($PSVersionTable.PSVersion.Major -ge 7 -and $isolatedLine -cne ('ARGV:' + $inputData.expectedArguments)){throw 'PS7 literal arguments differ.'}

    $nativeCases=0
    foreach($moduleValue in @($beforeModule,$null,'','C:\custom-modules;%KeepRaw%;C:\custom-modules')){
        foreach($outcome in @('success','nonzero','missing','invalid')){
            Set-ProcessValue 'PSModulePath' $moduleValue
            $expectedModule=[Environment]::GetEnvironmentVariable('PSModulePath','Process')
            $expectedPresence=[Environment]::GetEnvironmentVariables('Process').Contains('PSModulePath')
            if($PSVersionTable.PSVersion -ge [version]'7.5' -and $expectedPresence -ne ($null -ne $moduleValue)){throw 'PS7 module-path fixture presence differs.'}
            $LASTEXITCODE=0
            $caught=$null; $code=$null
            try {
                $executable=$nativeExecutable
                $arguments=@($inputData.fixture,'exit','0')
                if($outcome -eq 'nonzero'){$arguments[2]='7'}
                if($outcome -eq 'missing'){$executable=$inputData.missingExe}
                if($outcome -eq 'invalid'){$executable=$inputData.invalidExe}
                $code=Invoke-WBReleaseNativeGate -Executable $executable -Arguments $arguments -LogPath $inputData.logPath
            } catch {$caught=$_.Exception.Message}
            Check-ProcessValue 'PSModulePath' $expectedPresence $expectedModule
            if($ErrorActionPreference -cne 'Stop'){throw 'Native gate changed caller error preference.'}
            if($outcome -in @('missing','invalid')){
                if(!$caught -and ($null -eq $code -or $code -eq 0)){throw 'Failed invocation reused stale success or returned no result.'}
            } else {
                $expectedCode=0
                if($outcome -eq 'nonzero'){$expectedCode=7}
                if($caught -or $code -ne $expectedCode){throw ("Wrong native gate outcome: " + $caught + " code=" + $code)}
                $log=Get-Content -LiteralPath $inputData.logPath -Raw
                if($log -notmatch 'NATIVE_STDOUT' -or $log -notmatch 'NATIVE_STDERR'){throw 'Native output was not retained in the gate log.'}
            }
            $nativeCases++
        }
    }

    # Unit failure matrix for the actual outer save/refresh/finally blocks.
    # Deliberately mutate PSModulePath during preflight, as real discovery can do.
    $script:registered=[pscustomobject]@{Path=$beforePath;DotNetRoot=$null}
    function Get-WBRegisteredValidationEnvironment {return $script:registered}
    function Assert-WBReleasePrerequisites {
        $script:preflightCount++
        [Environment]::SetEnvironmentVariable('PSModulePath','C:\preflight-rebuilt-modules','Process')
        if($script:failPreflight){throw 'synthetic preflight failure'}
    }
    $matrixCount=0
    foreach($moduleValue in @($beforeModule,$null,'','C:\custom-modules;%KeepRaw%;C:\custom-modules')){
        foreach($dotnetFixture in @(
            @{Before=$null;Registered='C:\registered-dotnet'},
            @{Before='';Registered=$null},
            @{Before='C:\caller-dotnet;%KeepRaw%';Registered=''}
        )){
            foreach($scenario in @(
                @{Enabled=$false;FailAction=$false;FailPreflight=$false},
                @{Enabled=$false;FailAction=$true;FailPreflight=$false},
                @{Enabled=$true;FailAction=$false;FailPreflight=$false},
                @{Enabled=$true;FailAction=$true;FailPreflight=$false},
                @{Enabled=$true;FailAction=$false;FailPreflight=$true}
            )){
                Set-ProcessValue 'PSModulePath' $moduleValue
                Set-ProcessValue 'DOTNET_ROOT' $dotnetFixture.Before
                $modulePresent=[Environment]::GetEnvironmentVariables('Process').Contains('PSModulePath')
                $moduleBefore=[Environment]::GetEnvironmentVariable('PSModulePath','Process')
                $dotnetPresent=[Environment]::GetEnvironmentVariables('Process').Contains('DOTNET_ROOT')
                $dotnetBefore=[Environment]::GetEnvironmentVariable('DOTNET_ROOT','Process')
                if($PSVersionTable.PSVersion -ge [version]'7.5' -and $dotnetPresent -ne ($null -ne $dotnetFixture.Before)){throw 'PS7 DOTNET_ROOT fixture presence differs.'}
                $script:registered.DotNetRoot=$dotnetFixture.Registered
                $RefreshUserEnvironment=$scenario.Enabled
                $script:failPreflight=$scenario.FailPreflight
                $script:preflightCount=0
                $caught=$null
                . $saveBlock
                try {
                    . $refreshBlock
                    if($scenario.Enabled){
                        $registeredValue=$dotnetFixture.Registered
                        if($null -ne $registeredValue){$registeredValue=[Environment]::ExpandEnvironmentVariables($registeredValue)}
                        $registeredPresent=$null -ne $registeredValue
                        if($PSVersionTable.PSVersion.Major -lt 7 -and $registeredValue -ceq ''){$registeredPresent=$false;$registeredValue=$null}
                        Check-ProcessValue 'DOTNET_ROOT' $registeredPresent $registeredValue
                        Check-ProcessValue 'PSModulePath' $true 'C:\preflight-rebuilt-modules'
                    } else {
                        Check-ProcessValue 'DOTNET_ROOT' $dotnetPresent $dotnetBefore
                        Check-ProcessValue 'PSModulePath' $modulePresent $moduleBefore
                    }
                    if($scenario.FailAction){throw 'synthetic action failure'}
                } catch {$caught=$_.Exception.Message}
                finally {. $restoreBlock}
                $expectedError=$null
                if($scenario.FailAction){$expectedError='synthetic action failure'}
                if($scenario.FailPreflight){$expectedError='synthetic preflight failure'}
                if($caught -cne $expectedError){throw ("Wrong refresh matrix outcome: " + $caught)}
                if($script:preflightCount -ne [int]$scenario.Enabled){throw 'Default environment unexpectedly ran preflight.'}
                Check-ProcessValue 'PSModulePath' $modulePresent $moduleBefore
                Check-ProcessValue 'DOTNET_ROOT' $dotnetPresent $dotnetBefore
                if([Environment]::GetEnvironmentVariable('Path','Process') -cne $beforePath){throw 'Caller PATH was not restored exactly.'}
                $matrixCount++
            }
        }
    }
    [Console]::WriteLine('CHILD_MODULE_PATH_ABSENT;CHILD_HASH_PASS')
    [Console]::WriteLine('NATIVE_BOUNDARY_PASS:' + $nativeCases)
    [Console]::WriteLine('ENVIRONMENT_MATRIX_PASS:' + $matrixCount)
} finally {
    Set-ProcessValue 'PSModulePath' $beforeModule
    Set-ProcessValue 'DOTNET_ROOT' $beforeDotnet
    Set-ProcessValue 'Path' $beforePath
}
`;
      try {
        const result = spawnSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
          cwd: root,
          input: JSON.stringify({
            scriptPath: path.join(root, 'scripts', 'New-WorkbridgeRelease.ps1'),
            nodeExe: process.execPath,
            fixture,
            planner: path.join(root, 'scripts', 'plan-scoped-git-checkpoints.mjs'),
            logPath: path.join(scratch, 'native output.log'),
            baselineLog: path.join(scratch, 'baseline output.log'),
            missingExe: path.join(scratch, 'missing native.exe'),
            invalidExe,
            literalArguments,
            expectedArguments: JSON.stringify(literalArguments),
          }),
          encoding: 'utf8',
          windowsHide: true,
          timeout: 30000,
          maxBuffer: 64 * 1024,
        });
        assert.equal(result.error, undefined, String(result.error));
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.match(result.stdout, /CHILD_MODULE_PATH_ABSENT;CHILD_HASH_PASS/);
        assert.match(result.stdout, /NATIVE_BOUNDARY_PASS:16/);
        assert.match(result.stdout, /ENVIRONMENT_MATRIX_PASS:60/);
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
    },
  );
}
