[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('Install','Start','Status','Stop','Remove')][string]$Action,
    [Parameter(Mandatory)][string]$InstallDirectory,
    [ValidateRange(2,3600)][int]$IntervalSeconds = 30
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Workbridge-Update.ps1')
$install = Assert-WBPath $InstallDirectory
$prepared = Get-Content -LiteralPath (Get-WBChild $install 'preparation.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($prepared.schema -ne 1 -or $prepared.status -cne 'prepared_not_elevated' -or $prepared.repo -ine (Split-Path -Parent $PSScriptRoot)) { throw 'Unrecognized preparation receipt.' }
$manager = Join-Path $PSScriptRoot 'Manage-HelperTask.ps1'
$exe = Get-WBChild $install 'PcHealth/PcHealth.exe'
if ($Action -in @('Install','Start') -and (Get-FileHash -LiteralPath $exe).Hash -cne $prepared.healthSha256) { throw 'Recorder changed; review and prepare a fresh bundle.' }
if ($Action -eq 'Install') {
    & $manager -Action Register -HelperId 'pc-health' -Executable $exe -Argument @((Get-WBChild $install 'data'),$prepared.repo,[string]$IntervalSeconds) -WorkingDirectory $install -AtLogon | Out-Null
    & $manager -Action Start -HelperId 'pc-health' | Out-Null
} elseif ($Action -ne 'Status') {
    & $manager -Action $Action -HelperId 'pc-health' | Out-Null
}
$task = & $manager -Action Status -HelperId 'pc-health' | ConvertFrom-Json
$reportPath = Get-WBChild $install 'data/status.json'
$report = if (Test-Path -LiteralPath $reportPath) { Get-Content -LiteralPath $reportPath -Raw -Encoding UTF8 | ConvertFrom-Json } else { $null }
$age = if ($report) { [Math]::Max(0,([DateTimeOffset]::UtcNow - [DateTimeOffset]$report.updatedUtc).TotalSeconds) } else { $null }
[ordered]@{task=$task;reportPath=$reportPath;reportAgeSeconds=$age;stale=(!$report -or $age -gt [Math]::Max(90,3 * $report.intervalSeconds));report=$report;removal='Remove unregisters the helper and retains its reports and application files.'} | ConvertTo-Json -Depth 10
