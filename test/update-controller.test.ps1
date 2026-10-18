# Optional end-to-end Windows controller test. Uses real scheduled tasks and an
# isolated fake health service, never the production Workbridge service/tunnel.
[CmdletBinding()]
param([Parameter(Mandatory)][string]$ReleasePath, [string]$BaselineReleasePath)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $repo 'scripts\Workbridge-Update.ps1')
Import-Module (Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\Modules\ScheduledTasks') -ErrorAction Stop
$release = Get-WBRelease $ReleasePath
$baseline = if ($BaselineReleasePath) { Get-WBRelease $BaselineReleasePath } else { $release }
$id = [guid]::NewGuid().ToString('N')
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('workbridge-controller-test-' + $id)
$install = Join-Path $fixture 'installation with spaces'
$serviceName = 'Workbridge Service Fixture ' + $id
$operations = @(('success-' + $id), ('failure-' + $id))
$shell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$passed = $false
function Wait-WBFixture([string]$Operation, [string]$Expected) {
    $journal = Join-Path $install ('.local\update-operations\' + $Operation + '\journal.json')
    $deadline = [DateTime]::UtcNow.AddSeconds(300)
    $state = $null
    do {
        if (Test-Path -LiteralPath $journal) {
            $state = Read-WBJson $journal
            if ([DateTime]::Parse($state.updatedUtc).ToUniversalTime() -ge $script:fixtureDispatchTime -and $state.phase -in @('completed','failed_rolled_back','rolled_back','preflight_failed','recovery_required')) {
                if ($state.phase -ne $Expected) { throw "Controller ended in $($state.phase): $($state.error) / $($state.recoveryError)" }
                # Wait until the controller task finishes before dispatching it again.
                while ((Get-ScheduledTask -TaskName ('Workbridge Update ' + $Operation)).State -eq 'Running' -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
                return $state
            }
        }
        $earlyError = Join-Path $install ('.local\update-operations\' + $Operation + '\controller-error.json')
        if (Test-Path -LiteralPath $earlyError) { throw (Get-Content -LiteralPath $earlyError -Raw) }
        Start-Sleep -Milliseconds 200
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "Controller did not complete: $($state | ConvertTo-Json -Depth 8)"
}
try {
    Copy-WBTree $baseline.payload $install
    foreach ($name in @('Workbridge-Update.ps1','Update-Workbridge.ps1','Invoke-WorkbridgeUpdate.ps1','release-acceptance.mjs')) {
        Copy-Item -LiteralPath (Join-Path $repo ('scripts\' + $name)) -Destination (Join-Path $install ('scripts\' + $name)) -Force
    }
    New-Item -ItemType Directory -Path (Join-Path $install '.local') -Force | Out-Null
    Write-WBJson (Join-Path $install '.local\autostart.json') ([pscustomobject]@{root=$fixture; credentialPath='fixture-no-credential'})
    @'
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root = process.argv[2];
const compiled = fs.readFileSync(path.join(root, 'dist', 'server.js'), 'utf8');
const version = /const version = ['"]([^'"]+)['"]/.exec(compiled)?.[1];
if (!version) throw new Error('Compiled version missing');
const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ready:true,components:{mcp:{details:{initialize:{server_version:version}}}}}));
});
server.listen(0,'127.0.0.1',()=>fs.writeFileSync(path.join(root,'.local','health-url.txt'),`http://127.0.0.1:${server.address().port}`));
'@ | Set-Content -LiteralPath (Join-Path $install '.local\fixture-health.mjs') -Encoding UTF8
    @'
param([string]$Root,[string]$Node)
$ErrorActionPreference = 'Stop'
$install = Split-Path -Parent $PSScriptRoot
$log = Join-Path $install '.local\fixture-service.log'
try {
    Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility') -ErrorAction Stop
    'Starting fixture service' | Add-Content -LiteralPath $log
    Add-Type -Path (Join-Path $PSScriptRoot 'Tunnel-ProcessLifetime.cs')
    [Workbridge.ProcessLifetime]::Attach()
    $fail = Join-Path $install '.local\fail-next-start'
    if (Test-Path -LiteralPath $fail) { Move-Item -LiteralPath $fail -Destination ($fail + '.consumed'); exit 31 }
    $ErrorActionPreference = 'Continue'
    & $Node (Join-Path $install '.local\fixture-health.mjs') $install *>> $log
    "Node exit: $LASTEXITCODE" | Add-Content -LiteralPath $log
} catch { $_.Exception.Message | Add-Content -LiteralPath $log; exit 1 }
'@ | Set-Content -LiteralPath (Join-Path $install 'scripts\Start-BackgroundTunnel.ps1') -Encoding UTF8
    $node = (Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    $taskAction = New-ScheduledTaskAction -Execute $shell -Argument "-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy RemoteSigned -File `"$(Join-Path $install 'scripts\Start-BackgroundTunnel.ps1')`" -Root `"$fixture`" -Node `"$node`"" -WorkingDirectory $install
    $principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().User.Value) -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $serviceName -Action $taskAction -Principal $principal -Settings $settings | Out-Null
    Start-ScheduledTask -TaskName $serviceName
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    while (!(Test-Path -LiteralPath (Join-Path $install '.local\health-url.txt')) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
    if (!(Test-Path -LiteralPath (Join-Path $install '.local\health-url.txt'))) { throw "Fixture service failed to start: $(Get-Content -LiteralPath (Join-Path $install '.local\fixture-service.log') -Raw -ErrorAction SilentlyContinue)" }
    $editedPackage = Read-WBJson (Join-Path $install 'package.json')
    $editedPackage.version = '9.9.9-source-edit'
    Write-WBJson (Join-Path $install 'package.json') $editedPackage
    $script:fixtureDispatchTime = [DateTime]::UtcNow
    & (Join-Path $install 'scripts\Update-Workbridge.ps1') -Action Apply -InstallRoot $install -ReleasePath $release.path -OperationId $operations[0] -ServiceTaskName $serviceName -ReadinessTimeoutSeconds 5
    $applied = Wait-WBFixture $operations[0] 'completed'
    if ((Read-WBJson (Join-Path $install 'package.json')).version -cne $release.version) { throw 'Applied package version does not match candidate.' }
    Write-Output 'PASS: real dispatcher/controller installs a validated release and checks fresh service readiness.'
    Set-Content -LiteralPath (Join-Path $install '.local\fail-next-start') -Value 'fixture'
    $script:fixtureDispatchTime = [DateTime]::UtcNow
    & (Join-Path $install 'scripts\Update-Workbridge.ps1') -Action Apply -InstallRoot $install -ReleasePath $release.path -OperationId $operations[1] -ServiceTaskName $serviceName -ReadinessTimeoutSeconds 5
    $null = Wait-WBFixture $operations[1] 'failed_rolled_back'
    Write-Output 'PASS: real controller detects broken startup, restores its backup, and restarts the fixture service.'
    $script:fixtureDispatchTime = [DateTime]::UtcNow
    & (Join-Path $install 'scripts\Update-Workbridge.ps1') -Action Rollback -InstallRoot $install -OperationId $operations[0]
    $null = Wait-WBFixture $operations[0] 'rolled_back'
    if ((Read-WBJson (Join-Path $install 'package.json')).version -cne '9.9.9-source-edit') { throw 'Manual rollback did not preserve the pending source package edit.' }
    Write-Output 'PASS: real dispatcher reuses the retained independent controller for manual rollback.'
    Write-Output 'PASS: observed compiled version remains authoritative while pending source package edits survive rollback.'
    $passed = $true
} finally {
    foreach ($name in @($serviceName) + @($operations | ForEach-Object { 'Workbridge Update ' + $_ })) {
        $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
        if ($task) {
            Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
            $deadline = [DateTime]::UtcNow.AddSeconds(10)
            while ((Get-ScheduledTask -TaskName $name).State -eq 'Running' -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
            Unregister-ScheduledTask -TaskName $name -Confirm:$false
        }
    }
    if ($passed) {
        $resolved = [IO.Path]::GetFullPath($fixture)
        $prefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
        if (!$resolved.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $resolved) -notmatch '^workbridge-controller-test-[0-9a-f]{32}$') { throw 'Unexpected controller fixture cleanup path.' }
        Remove-Item -LiteralPath $resolved -Recurse -Force
    } else { Write-Output "Controller fixture retained: $fixture" }
}
