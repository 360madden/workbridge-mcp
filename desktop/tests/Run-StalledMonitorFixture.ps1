# Disposable fixture: a connected GUI monitor sends one sample then hangs forever.
# WPF should mark it offline after heartbeat timeout, kill the owned child,
# and recover when a newly launched fixture monitor starts sending samples.
[CmdletBinding()]
param([int]$TimeoutSeconds = 55)
$ErrorActionPreference = 'Stop'
if ($TimeoutSeconds -lt 35 -or $TimeoutSeconds -gt 90) { throw 'TimeoutSeconds must be 35..90' }
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$source = Join-Path $repo 'desktop\Workbridge.ControlCenter\bin\Debug\net10.0-windows'
$fixture = Join-Path (Join-Path $repo 'temp') "wbdesktop-heartbeat-$PID"
if (!(Test-Path -LiteralPath $source -PathType Container)) { throw 'Build the desktop app first.' }
if (Test-Path -LiteralPath $fixture) { throw 'Fixture exists; refusing overwrite.' }
if (@(Get-Process -Name Workbridge.ControlCenter -ErrorAction SilentlyContinue).Count -ne 0) {
    throw 'A Control Center instance exists; fixture refused.'
}
$owner = $null
$result = [ordered]@{
    schemaVersion = 1
    initialSample = $false
    stalledChildMarkedOffline = $false
    recoveredAfterRestart = $false
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
const recovery = new URL('../recover.flag', import.meta.url);
const emit = version => process.stdout.write(JSON.stringify({
    ok: true, version, tunnelReady: true, controlPlane: 'ok',
    capacity: { limit: 36, occupied: 0, available: 36, retainedResults: 0 },
    runningJobs: 0, inventoryComplete: true, jobs: [],
    sampledUtc: new Date().toISOString()
}) + '\n');
if (fs.existsSync(recovery)) {
    emit('RECOVERED');
    setInterval(() => emit('RECOVERED'), 500);
} else {
    emit('STALLING');
    // Keep process and pipe open but never emit another heartbeat.
    setInterval(() => {}, 1000);
}
'@
    Set-Content -LiteralPath (Join-Path $fixture 'scripts\desktop-monitor.mjs') -Value $fake -Encoding UTF8
    $owner = Start-Process -FilePath (Join-Path $fixture 'app\Workbridge.ControlCenter.exe') -PassThru
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    $hwnd = [IntPtr]::Zero
    while ([DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 200
        $owner.Refresh()
        if ($owner.HasExited) { throw 'Fixture GUI exited unexpectedly.' }
        $hwnd = $owner.MainWindowHandle
        if ($hwnd -ne [IntPtr]::Zero) { break }
    }
    if ($hwnd -eq [IntPtr]::Zero) { throw 'Fixture GUI window missing.' }
    while ([DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 200
        if ((Read-Label $hwnd 'VersionText') -eq 'Version: STALLING') {
            $result.initialSample = $true
            break
        }
    }
    if (-not $result.initialSample) { throw 'Initial sample not observed.' }
    while ([DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 250
        if ((Read-Label $hwnd 'ConnectionText') -like 'Disconnected*') {
            $result.stalledChildMarkedOffline = $true
            break
        }
    }
    if (-not $result.stalledChildMarkedOffline) {
        throw 'GUI remained incorrectly connected after stalled heartbeat.'
    }
    New-Item -ItemType File -Path (Join-Path $fixture 'recover.flag') | Out-Null
    while ([DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 200
        if ((Read-Label $hwnd 'VersionText') -eq 'Version: RECOVERED' -and
            (Read-Label $hwnd 'ConnectionText') -like 'Connected*') {
            $result.recoveredAfterRestart = $true
            break
        }
    }
    if (-not $result.recoveredAfterRestart) { throw 'GUI did not recover after child restart.' }
}
finally {
    if ($null -ne $owner) { Stop-Process -Id $owner.Id -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 400
    $result.testOwnerStopped =
        (@(Get-Process -Name Workbridge.ControlCenter -ErrorAction SilentlyContinue).Count -eq 0)
    if (Test-Path -LiteralPath $fixture) { Remove-Item -LiteralPath $fixture -Recurse -Force }
    $result.fixtureRemoved = -not (Test-Path -LiteralPath $fixture)
    $result | ConvertTo-Json -Compress
}
if (-not ($result.initialSample -and $result.stalledChildMarkedOffline -and
    $result.recoveredAfterRestart -and $result.testOwnerStopped -and $result.fixtureRemoved)) {
    exit 2
}
