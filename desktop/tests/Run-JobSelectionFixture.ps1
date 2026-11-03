# Disposable WPF regression: job output must not follow a different selection.
[CmdletBinding()]
param([int]$TimeoutSeconds = 30)
$ErrorActionPreference = 'Stop'
if ($TimeoutSeconds -lt 12 -or $TimeoutSeconds -gt 90) { throw 'TimeoutSeconds must be between 12 and 90.' }
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$source = Join-Path $repo 'desktop\Workbridge.ControlCenter\bin\Debug\net10.0-windows'
$fixture = Join-Path (Join-Path $repo 'temp') "wbdesktop-selection-$PID"
if (!(Test-Path -LiteralPath $source -PathType Container)) { throw 'Build app first.' }
if (Test-Path -LiteralPath $fixture) { throw 'Fixture exists.' }
if (@(Get-Process -Name Workbridge.ControlCenter -ErrorAction SilentlyContinue).Count -ne 0) {
    throw 'Control Center already running; test refused.'
}
$owner = $null
$receipt = [ordered]@{
    schemaVersion = 1
    jobADetailsDisplayed = $false
    sameJobSurvivesRefresh = $false
    staleDetailsClearedOnSelection = $false
    jobBDetailsDisplayed = $false
    staleAbaResponseRejected = $false
    cleanedUp = $false
}
function UIElement([IntPtr]$hwnd, [string]$id) {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
    $condition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::AutomationIdProperty, $id)
    return $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
}
function SelectJob([IntPtr]$hwnd, [string]$id) {
    $list = UIElement $hwnd 'JobList'
    $all = $list.FindAll([System.Windows.Automation.TreeScope]::Children,
        [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($item in $all) {
        if ($item.Current.Name.EndsWith(" | $id")) {
            $select = [System.Windows.Automation.SelectionItemPattern]$item.GetCurrentPattern(
                [System.Windows.Automation.SelectionItemPattern]::Pattern)
            $select.Select()
            return
        }
    }
    throw "Job not found: $id"
}
function Details([IntPtr]$hwnd) {
    $field = UIElement $hwnd 'DetailsText'
    $pattern = [System.Windows.Automation.ValuePattern]$field.GetCurrentPattern(
        [System.Windows.Automation.ValuePattern]::Pattern)
    return [string]$pattern.Current.Value
}
function InvokeDetails([IntPtr]$hwnd) {
    $button = UIElement $hwnd 'DetailsButton'
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
    $fakeMonitor = @'
process.stdin.resume();
process.stdin.once('end', () => process.exit(0));
const emit = () => process.stdout.write(JSON.stringify({
 ok:true,version:'FIXTURE',tunnelReady:true,controlPlane:'ok',
 capacity:{limit:36,occupied:2,available:34,retainedResults:0},
 runningJobs:2,inventoryComplete:true,
 jobs:[
 {id:'fixture_job_a',project:'workbridge-mcp',status:'running',kind:'in_progress'},
 {id:'fixture_job_b',project:'workbridge-mcp',status:'running',kind:'in_progress'}
 ],
 sampledUtc:new Date().toISOString()
})+'\n');
emit();
setInterval(emit,350);
'@
    $fakeDetails = @'
import fs from 'node:fs';
const id=process.argv[2];
if (id==='fixture_job_a' && fs.existsSync(new URL('../delay-A.flag', import.meta.url))) {
    await new Promise(resolve => setTimeout(resolve, 1800));
}
process.stdout.write(JSON.stringify({
 ok:true,status:'running',exitCode:null,outputTruncated:false,
 log:id==='fixture_job_a'?'CONFIDENTIAL_A_ONLY':'JOB_B_OUTPUT'
})+'\n');
'@
    Set-Content -LiteralPath (Join-Path $fixture 'scripts\desktop-monitor.mjs') -Value $fakeMonitor -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $fixture 'scripts\desktop-job-detail.mjs') -Value $fakeDetails -Encoding UTF8
    $owner = Start-Process -FilePath (Join-Path $fixture 'app\Workbridge.ControlCenter.exe') -PassThru
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    $hwnd = [IntPtr]::Zero
    while ([DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 150
        $owner.Refresh()
        if ($owner.HasExited) { throw 'Owned GUI exited.' }
        if ($owner.MainWindowHandle -ne [IntPtr]::Zero) { $hwnd = $owner.MainWindowHandle; break }
    }
    if ($hwnd -eq [IntPtr]::Zero) { throw 'Fixture window missing.' }
    while ([DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 150
        if ((UIElement $hwnd 'JobList').Current.Name -ne $null) {
            try { SelectJob $hwnd 'fixture_job_a'; break } catch { }
        }
    }
    SelectJob $hwnd 'fixture_job_a'
    InvokeDetails $hwnd
    while ([DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 150
        if ((Details $hwnd) -like '*CONFIDENTIAL_A_ONLY*') {
            $receipt.jobADetailsDisplayed = $true; break
        }
    }
    if (-not $receipt.jobADetailsDisplayed) { throw 'Job A details never displayed.' }
    Start-Sleep -Milliseconds 800
    $receipt.sameJobSurvivesRefresh = (Details $hwnd) -like '*CONFIDENTIAL_A_ONLY*'
    if (-not $receipt.sameJobSurvivesRefresh) { throw 'Same job details cleared during refresh.' }
    SelectJob $hwnd 'fixture_job_b'
    $detailsB = Details $hwnd
    $receipt.staleDetailsClearedOnSelection = $detailsB -notlike '*CONFIDENTIAL_A_ONLY*' -and
        $detailsB -like 'Selection changed*'
    if (-not $receipt.staleDetailsClearedOnSelection) { throw 'Old job output remained after selecting job B.' }
    InvokeDetails $hwnd
    while ([DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 150
        if ((Details $hwnd) -like '*JOB_B_OUTPUT*') {
            $receipt.jobBDetailsDisplayed = $true; break
        }
    }
    if (-not $receipt.jobBDetailsDisplayed) { throw 'Job B details not displayed.' }
    # Reproduce the A -> B -> A race with a deliberately delayed A result.
    # The original ID-only guard would accept that stale A response.
    New-Item -ItemType File -Path (Join-Path $fixture 'delay-A.flag') | Out-Null
    SelectJob $hwnd 'fixture_job_a'
    InvokeDetails $hwnd
    SelectJob $hwnd 'fixture_job_b'
    SelectJob $hwnd 'fixture_job_a'
    Start-Sleep -Milliseconds 2500
    $abaResult = Details $hwnd
    $receipt.staleAbaResponseRejected = $abaResult -notlike '*CONFIDENTIAL_A_ONLY*' -and
        $abaResult -like 'Selection changed*'
    if (-not $receipt.staleAbaResponseRejected) {
        throw 'Outdated A response appeared after A -> B -> A selection cycle.'
    }
}
finally {
    if ($null -ne $owner) { Stop-Process -Id $owner.Id -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 400
    if (Test-Path -LiteralPath $fixture) { Remove-Item -LiteralPath $fixture -Recurse -Force }
    $receipt.cleanedUp =
        (-not (Test-Path -LiteralPath $fixture) -and
        @(Get-Process -Name Workbridge.ControlCenter -ErrorAction SilentlyContinue).Count -eq 0)
    $receipt | ConvertTo-Json -Compress
}
if (-not ($receipt.jobADetailsDisplayed -and $receipt.sameJobSurvivesRefresh -and
    $receipt.staleDetailsClearedOnSelection -and $receipt.jobBDetailsDisplayed -and
    $receipt.staleAbaResponseRejected -and $receipt.cleanedUp)) {
    exit 2
}
