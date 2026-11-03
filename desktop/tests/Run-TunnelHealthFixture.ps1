# Isolated WPF test: distinguish reachable-but-degraded tunnel from healthy.
# Never modifies the live Workbridge server or the scheduled task.
[CmdletBinding()]
param([int]$TimeoutSeconds = 30)
$ErrorActionPreference = 'Stop'
if ($TimeoutSeconds -lt 12 -or $TimeoutSeconds -gt 70) { throw 'TimeoutSeconds must be 12..70.' }
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$source = Join-Path $repo 'desktop\Workbridge.ControlCenter\bin\Debug\net10.0-windows'
$fixture = Join-Path (Join-Path $repo 'temp') "wbdesktop-tunnel-health-$PID"
if (!(Test-Path -LiteralPath $source -PathType Container)) { throw 'Build Control Center first.' }
if (Test-Path -LiteralPath $fixture) { throw 'Fixture already exists; do not overwrite.' }
if (@(Get-Process -Name Workbridge.ControlCenter -ErrorAction SilentlyContinue).Count -gt 0) {
    throw 'Control Center already running; refusing test.'
}
$result = [ordered]@{
    schemaVersion = 1
    initiallyHealthy = $false
    degradedReported = $false
    recovered = $false
    unknownCountersHandled = $false
    recoveredFromUnknownCounters = $false
    cleanedUp = $false
}
$p = $null
function Read-UI([IntPtr]$hwnd, [string]$id) {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
    $condition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::AutomationIdProperty, $id)
    $element = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
    if ($null -eq $element) { return '' }
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
const degraded = new URL('../degraded.flag', import.meta.url);
const missing = new URL('../unknown-counters.flag', import.meta.url);
const emit = () => {
    const down = fs.existsSync(degraded);
    const unknown = fs.existsSync(missing);
    process.stdout.write(JSON.stringify({
        ok: true, version: 'FIXTURE', tunnelReady: !down,
        controlPlane: down ? 'unavailable' : 'ok',
        capacity: { limit: unknown ? null : 36, occupied: unknown ? null : 0,
                    available: unknown ? null : 36, retainedResults: 0 },
        runningJobs: unknown ? null : 0, inventoryComplete: !unknown, jobs: [],
        sampledUtc: new Date().toISOString()
    }) + '\n');
};
emit();
setInterval(emit, 350);
'@
    Set-Content -LiteralPath (Join-Path $fixture 'scripts\desktop-monitor.mjs') -Value $fake -Encoding UTF8
    $p = Start-Process -FilePath (Join-Path $fixture 'app\Workbridge.ControlCenter.exe') -PassThru
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    $hwnd = [IntPtr]::Zero
    while ([DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 150
        $p.Refresh()
        if ($p.HasExited) { throw 'Fixture GUI unexpectedly exited.' }
        $hwnd = $p.MainWindowHandle
        if ($hwnd -ne [IntPtr]::Zero) { break }
    }
    if ($hwnd -eq [IntPtr]::Zero) { throw 'Fixture window was not created.' }
    while ([DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 150
        if ((Read-UI $hwnd 'ConnectionText') -like 'Connected*' -and
            (Read-UI $hwnd 'ControlPlaneText') -eq 'Control plane: ok') {
            $result.initiallyHealthy = $true; break
        }
    }
    if (-not $result.initiallyHealthy) { throw 'Initial healthy state was not displayed.' }
    New-Item -ItemType File -Path (Join-Path $fixture 'degraded.flag') | Out-Null
    while ([DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 150
        $label = Read-UI $hwnd 'ConnectionText'
        if ($label -like 'Engine reachable*degraded*' -and
            (Read-UI $hwnd 'ControlPlaneText') -eq 'Control plane: unavailable') {
            $result.degradedReported = $true; break
        }
    }
    if (-not $result.degradedReported) { throw 'Degraded state incorrectly displayed as connected.' }
    Remove-Item -LiteralPath (Join-Path $fixture 'degraded.flag') -Force
    while ([DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 150
        if ((Read-UI $hwnd 'ConnectionText') -like 'Connected*' -and
            (Read-UI $hwnd 'ControlPlaneText') -eq 'Control plane: ok') {
            $result.recovered = $true; break
        }
    }
    if (-not $result.recovered) { throw 'Healthy status did not recover.' }
    # The real monitor intentionally reports null when counters are missing.
    # Unknown counters must not turn a reachable healthy service into offline.
    New-Item -ItemType File -Path (Join-Path $fixture 'unknown-counters.flag') | Out-Null
    while ([DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 150
        if ((Read-UI $hwnd 'ConnectionText') -like 'Connected*' -and
            (Read-UI $hwnd 'CapacityText') -eq 'Slots: unavailable' -and
            (Read-UI $hwnd 'JobsText') -eq 'Running jobs: unavailable' -and
            (Read-UI $hwnd 'InventoryText') -like 'Inventory: partial*') {
            $result.unknownCountersHandled = $true; break
        }
    }
    if (-not $result.unknownCountersHandled) {
        throw 'Null counters incorrectly disconnected the GUI or displayed fabricated values.'
    }
    Remove-Item -LiteralPath (Join-Path $fixture 'unknown-counters.flag') -Force
    while ([DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 150
        if ((Read-UI $hwnd 'ConnectionText') -like 'Connected*' -and
            (Read-UI $hwnd 'CapacityText') -eq 'Slots: 0 / 36 occupied' -and
            (Read-UI $hwnd 'JobsText') -eq 'Running jobs: 0') {
            $result.recoveredFromUnknownCounters = $true; break
        }
    }
    if (-not $result.recoveredFromUnknownCounters) { throw 'Dashboard did not recover numeric counters.' }
}
finally {
    if ($null -ne $p) { Stop-Process -Id $p.Id -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 400
    if (Test-Path -LiteralPath $fixture) { Remove-Item -LiteralPath $fixture -Recurse -Force }
    $result.cleanedUp =
        (-not (Test-Path -LiteralPath $fixture) -and
        @(Get-Process -Name Workbridge.ControlCenter -ErrorAction SilentlyContinue).Count -eq 0)
    $result | ConvertTo-Json -Compress
}
if (-not ($result.initiallyHealthy -and $result.degradedReported -and $result.recovered -and
    $result.unknownCountersHandled -and $result.recoveredFromUnknownCounters -and $result.cleanedUp)) { exit 2 }
