# Synthetic integration test for oversized monitoring output and GUI recovery.
# All files and processes remain inside one newly created disposable fixture.
[CmdletBinding()]
param([int]$TimeoutSeconds = 35)
$ErrorActionPreference = 'Stop'
if ($TimeoutSeconds -lt 10 -or $TimeoutSeconds -gt 90) { throw 'TimeoutSeconds must be 10..90' }
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$source = Join-Path $repo 'desktop\Workbridge.ControlCenter\bin\Debug\net10.0-windows'
$parent = Join-Path $repo 'temp'
$fixture = Join-Path $parent "wbdesktop-oversize-fixture-$PID"
if (!(Test-Path -LiteralPath $source -PathType Container)) { throw 'Build the desktop app first.' }
if (!(Test-Path -LiteralPath $parent -PathType Container)) { throw 'Expected project temp directory missing.' }
if (Test-Path -LiteralPath $fixture) { throw 'Fixture exists; refusing overwrite.' }
if (@(Get-Process -Name 'Workbridge.ControlCenter' -ErrorAction SilentlyContinue).Count -gt 0) {
    throw 'Control Center already running; fixture test refused.'
}
$owner = $null
$result = [ordered]@{
    schemaVersion = 1
    test = 'Workbridge desktop oversized monitor fixture'
    oversizedRejected = $false
    recovered = $false
    offlineAgain = $false
    testOwnerStopped = $false
    fixtureRemoved = $false
}
function Read-Label([IntPtr]$hwnd, [string]$id) {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
    $condition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::AutomationIdProperty, $id)
    $element = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
    if ($null -eq $element) { return $null }
    return [string]$element.Current.Name
}
try {
    New-Item -ItemType Directory -Path (Join-Path $fixture 'app') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $fixture 'scripts') -Force | Out-Null
    Copy-Item -Path (Join-Path $source '*') -Destination (Join-Path $fixture 'app') -Recurse -Force
    @{ repositoryRoot = $fixture } | ConvertTo-Json -Compress |
        Set-Content -LiteralPath (Join-Path $fixture 'app\workbridge-control-center.json') -Encoding UTF8
    $fake = @'
import fs from 'node:fs';
process.stdin.resume();
process.stdin.once('end', () => process.exit(0));
const ready = new URL('../ready.flag', import.meta.url);
if (!fs.existsSync(ready)) {
    process.stdout.write('x'.repeat(2_000_000) + '\n');
} else {
    const sample = () => process.stdout.write(JSON.stringify({
        ok: true, version: 'FIXTURE', tunnelReady: true, controlPlane: 'ok',
        capacity: { limit: 36, occupied: 0, available: 36, retainedResults: 0 },
        runningJobs: 0, inventoryComplete: true, jobs: [],
        sampledUtc: new Date().toISOString()
    }) + '\n');
    sample();
    setInterval(sample, 500);
}
'@
    Set-Content -LiteralPath (Join-Path $fixture 'scripts\desktop-monitor.mjs') -Value $fake -Encoding UTF8
    $owner = Start-Process -FilePath (Join-Path $fixture 'app\Workbridge.ControlCenter.exe') -PassThru
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    $hwnd = [IntPtr]::Zero
    while ([DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 200
        $owner.Refresh()
        if ($owner.HasExited) { throw 'Fixture application exited unexpectedly.' }
        if ($owner.MainWindowHandle -ne [IntPtr]::Zero) {
            $hwnd = $owner.MainWindowHandle
            break
        }
    }
    if ($hwnd -eq [IntPtr]::Zero) { throw 'Fixture window never appeared.' }

    while ([DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 200
        if ((Read-Label $hwnd 'ConnectionText') -like 'Disconnected*') {
            $result.oversizedRejected = $true
            break
        }
    }
    if (-not $result.oversizedRejected) { throw 'Oversized output did not produce an offline state.' }

    New-Item -ItemType File -Path (Join-Path $fixture 'ready.flag') | Out-Null
    while ([DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 200
        if ((Read-Label $hwnd 'VersionText') -eq 'Version: FIXTURE' -and
            (Read-Label $hwnd 'ConnectionText') -like 'Connected*') {
            $result.recovered = $true
            break
        }
    }
    if (-not $result.recovered) { throw 'Monitor did not reconnect after replacing oversize output.' }
    Remove-Item -LiteralPath (Join-Path $fixture 'ready.flag') -Force
    # The current long-running child remains connected; force only this fixture child
    # to exit by its exact fixture-script command line, never an unrelated node.exe.
    $ownedMonitors = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
        Where-Object { $_.CommandLine -like "*$fixture*" -and $_.CommandLine -like '*desktop-monitor.mjs*' })
    foreach ($m in $ownedMonitors) { Stop-Process -Id $m.ProcessId -ErrorAction SilentlyContinue }
    while ([DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 200
        if ((Read-Label $hwnd 'ConnectionText') -like 'Disconnected*') {
            $result.offlineAgain = $true
            break
        }
    }
    if (-not $result.offlineAgain) { throw 'Monitor failure did not produce offline state.' }
}
finally {
    if ($null -ne $owner) { Stop-Process -Id $owner.Id -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 400
    $result.testOwnerStopped =
        (@(Get-Process -Name 'Workbridge.ControlCenter' -ErrorAction SilentlyContinue).Count -eq 0)
    if (Test-Path -LiteralPath $fixture) {
        Remove-Item -LiteralPath $fixture -Recurse -Force
    }
    $result.fixtureRemoved = -not (Test-Path -LiteralPath $fixture)
    $result | ConvertTo-Json -Compress
}
if (-not ($result.oversizedRejected -and $result.recovered -and
    $result.offlineAgain -and $result.testOwnerStopped -and $result.fixtureRemoved)) {
    exit 2
}
