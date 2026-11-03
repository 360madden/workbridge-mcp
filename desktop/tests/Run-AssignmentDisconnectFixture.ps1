# Disposable M2 test: an in-flight assignment reply must not overwrite offline status.
# Uses isolated fake Node scripts, not the live Workbridge MCP server.
[CmdletBinding()]
param([int]$TimeoutSeconds = 35)
$ErrorActionPreference = 'Stop'
if ($TimeoutSeconds -lt 15 -or $TimeoutSeconds -gt 90) { throw 'TimeoutSeconds must be 15..90.' }
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$source = Join-Path $repo 'desktop\Workbridge.ControlCenter\bin\Debug\net10.0-windows'
$fixture = Join-Path (Join-Path $repo 'temp') "wbdesktop-assignment-race-$PID"
if (!(Test-Path -LiteralPath $source -PathType Container)) { throw 'Build Control Center first.' }
if (Test-Path -LiteralPath $fixture) { throw 'Fixture already exists; refusing overwrite.' }
if (@(Get-Process -Name Workbridge.ControlCenter -ErrorAction SilentlyContinue).Count -ne 0) {
    throw 'Control Center already running; test refused.'
}
$owner = $null
$result = [ordered]@{
    schemaVersion = 1
    healthyInitially = $false
    offlineDuringLookup = $false
    staleResponseRejected = $false
    lookupAfterReconnect = $false
    changedProjectClearsOldData = $false
    projectAbaResponseRejected = $false
    lookupAfterProjectAba = $false
    cleanup = $false
}
function UI([IntPtr]$hwnd, [string]$id) {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
    $condition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::AutomationIdProperty, $id)
    return $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
}
function ReadText([IntPtr]$hwnd, [string]$id) {
    $item = UI $hwnd $id
    if ($null -eq $item) { return '' }
    return [string]$item.Current.Name
}
function SetProject([IntPtr]$hwnd, [string]$name) {
    $entry = UI $hwnd 'AssignmentsProjectText'
    $pattern = [System.Windows.Automation.ValuePattern]$entry.GetCurrentPattern(
        [System.Windows.Automation.ValuePattern]::Pattern)
    $pattern.SetValue($name)
}
function RequestAssignments([IntPtr]$hwnd) {
    $button = UI $hwnd 'AssignmentsButton'
    if ($null -eq $button) { throw 'Assignments button missing.' }
    $pattern = [System.Windows.Automation.InvokePattern]$button.GetCurrentPattern(
        [System.Windows.Automation.InvokePattern]::Pattern)
    $pattern.Invoke()
}
try {
    New-Item -ItemType Directory -Path (Join-Path $fixture 'app') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $fixture 'scripts') -Force | Out-Null
    Copy-Item -Path (Join-Path $source '*') -Destination (Join-Path $fixture 'app') -Recurse -Force
    @{ repositoryRoot = $fixture } | ConvertTo-Json -Compress |
        Set-Content -LiteralPath (Join-Path $fixture 'app\workbridge-control-center.json') -Encoding UTF8
    $monitor = @'
import fs from 'node:fs';
process.stdin.resume();
process.stdin.once('end',()=>process.exit(0));
const offline=new URL('../offline.flag',import.meta.url);
const emit=()=> {
 const down=fs.existsSync(offline);
 process.stdout.write(JSON.stringify(down
  ? {ok:false,error:'fixture offline',sampledUtc:new Date().toISOString()}
  : {ok:true,version:'FIXTURE',tunnelReady:true,controlPlane:'ok',
     capacity:{limit:36,occupied:0,available:36,retainedResults:0},
     runningJobs:0,inventoryComplete:true,jobs:[],
     sampledUtc:new Date().toISOString()})+'\n');
};
emit();setInterval(emit,250);
'@
    $assignments = @'
await new Promise(resolve=>setTimeout(resolve,1700));
process.stdout.write(JSON.stringify({
 ok:true,project:process.argv[2]||'workbridge-mcp',revision:1,
 maxWorkers:36,running:1,available:35,coordinatorSlots:1,
 recorded:1,truncated:false,
 assignments:[{taskId:'old_task',workerId:'old_worker',state:'running',jobId:null}],
 sampledUtc:new Date().toISOString()
})+'\n');
'@
    Set-Content -LiteralPath (Join-Path $fixture 'scripts\desktop-monitor.mjs') -Value $monitor -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $fixture 'scripts\desktop-assignments.mjs') -Value $assignments -Encoding UTF8
    $owner = Start-Process -FilePath (Join-Path $fixture 'app\Workbridge.ControlCenter.exe') -PassThru
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    $hwnd = [IntPtr]::Zero
    while ([DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 150
        $owner.Refresh()
        if ($owner.HasExited) { throw 'Owned GUI exited unexpectedly.' }
        $hwnd = $owner.MainWindowHandle
        if ($hwnd -ne [IntPtr]::Zero) { break }
    }
    if ($hwnd -eq [IntPtr]::Zero) { throw 'Fixture GUI window missing.' }
    while ([DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 100
        if ((ReadText $hwnd 'VersionText') -eq 'Version: FIXTURE') {
            $result.healthyInitially = $true;break
        }
    }
    if (-not $result.healthyInitially) { throw 'Fixture did not connect.' }
    RequestAssignments $hwnd
    Start-Sleep -Milliseconds 160
    New-Item -ItemType File -Path (Join-Path $fixture 'offline.flag') | Out-Null
    while ([DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 130
        if ((ReadText $hwnd 'AssignmentsSummary') -like 'Assignments unavailable while Workbridge is offline*') {
            $result.offlineDuringLookup = $true;break
        }
    }
    if (-not $result.offlineDuringLookup) { throw 'GUI did not clear assignments during offline transition.' }
    Start-Sleep -Milliseconds 2050
    $summary = ReadText $hwnd 'AssignmentsSummary'
    $result.staleResponseRejected =
        $summary -like 'Assignments unavailable while Workbridge is offline*' -and
        $summary -notlike '*old_task*'
    if (-not $result.staleResponseRejected) {
        throw "Delayed assignment response overwrote offline UI: $summary"
    }
    Remove-Item -LiteralPath (Join-Path $fixture 'offline.flag') -Force
    while ([DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 150
        if ((ReadText $hwnd 'ConnectionText') -like 'Connected*') { break }
    }
    if ((ReadText $hwnd 'ConnectionText') -notlike 'Connected*') { throw 'Fixture did not reconnect.' }
    RequestAssignments $hwnd
    while ([DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 150
        if ((ReadText $hwnd 'AssignmentsSummary') -like 'Project: workbridge-mcp*') {
            $result.lookupAfterReconnect = $true;break
        }
    }
    if (-not $result.lookupAfterReconnect) { throw 'New post-reconnect assignment lookup failed.' }
    SetProject $hwnd 'other-repository'
    $changed = ReadText $hwnd 'AssignmentsSummary'
    $result.changedProjectClearsOldData = $changed -like 'Repository changed*'
    if (-not $result.changedProjectClearsOldData) { throw 'Old assignment data remained after editing repository.' }
    SetProject $hwnd 'workbridge-mcp'
    RequestAssignments $hwnd
    Start-Sleep -Milliseconds 175
    SetProject $hwnd 'other-repository'
    SetProject $hwnd 'workbridge-mcp'
    Start-Sleep -Milliseconds 1950
    $oldResult = ReadText $hwnd 'AssignmentsSummary'
    $result.projectAbaResponseRejected = $oldResult -like 'Repository changed*' -and
        $oldResult -notlike 'Project: workbridge-mcp*'
    if (-not $result.projectAbaResponseRejected) {
        throw "Obsolete project A -> B -> A response was accepted: $oldResult"
    }
    RequestAssignments $hwnd
    while ([DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 150
        if ((ReadText $hwnd 'AssignmentsSummary') -like 'Project: workbridge-mcp*') {
            $result.lookupAfterProjectAba = $true;break
        }
    }
    if (-not $result.lookupAfterProjectAba) { throw 'Fresh lookup after project A -> B -> A did not complete.' }
}
finally {
    if ($null -ne $owner) { Stop-Process -Id $owner.Id -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 400
    if (Test-Path -LiteralPath $fixture) { Remove-Item -LiteralPath $fixture -Recurse -Force }
    $result.cleanup = -not (Test-Path -LiteralPath $fixture) -and
        @(Get-Process -Name Workbridge.ControlCenter -ErrorAction SilentlyContinue).Count -eq 0
    $result | ConvertTo-Json -Compress
}
if (-not ($result.healthyInitially -and $result.offlineDuringLookup -and
    $result.staleResponseRejected -and $result.lookupAfterReconnect -and
    $result.changedProjectClearsOldData -and $result.projectAbaResponseRejected -and
    $result.lookupAfterProjectAba -and $result.cleanup)) {
    exit 2
}
