[CmdletBinding()]
param([Parameter(Mandatory)][string]$InstallDirectory)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $repo 'scripts/Workbridge-Update.ps1')
$install = Assert-WBPath $InstallDirectory
$archive = Get-WBChild $install 'cleanup-evidence-20261018-01'
$before = Get-Content -LiteralPath (Get-WBChild $archive 'before.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$root = Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'WorkbridgePcHealth'
$request = Join-Path $repo 'scripts/Request-WindowsHealthScan.ps1'
$parameters = @{InstallDirectory=$install;AdminAction='cleanup';ScanId=$before.scanId;OperationId='cleanup-20261018-01'}
function Assert-Cleanup($Condition,[string]$Message) { if (!$Condition) { throw $Message } }
$status = & $request -Action Status @parameters | ConvertFrom-Json
Assert-Cleanup ($status.receipt.state -eq 'action_completed' -and $status.receipt.exitCode -eq 0) 'Cleanup did not complete successfully.'
Assert-Cleanup (!(Test-Path -LiteralPath (Join-Path $root $before.scanId))) 'Selected scan directory remains.'
Assert-Cleanup (!(Test-Path -LiteralPath (Join-Path $root 'latest.json'))) 'Selected latest pointer remains.'
$expected = @($before.rootEntries | Where-Object { $_ -cne $before.scanId -and $_ -cne 'latest.json' } | Sort-Object)
$actual = @(Get-ChildItem -LiteralPath $root -Force | ForEach-Object {$_.Name} | Sort-Object)
Assert-Cleanup (!(Compare-Object $expected $actual)) 'Unrelated root contents changed.'
Assert-Cleanup ((Get-FileHash -LiteralPath (Join-Path $root 'owner.txt')).Hash -ceq $before.markerSha256) 'Storage marker changed.'
foreach ($entry in $before.scanFiles) {
    Assert-Cleanup ((Get-FileHash -LiteralPath (Get-WBChild $archive $entry.name)).Hash -ceq $entry.sha256) 'Audit archive hash mismatch.'
}
foreach ($path in @($root,(Join-Path $root 'owner.txt'),(Join-Path $root 'scan.lock'))) {
    $acl = Get-Acl -LiteralPath $path
    Assert-Cleanup ($acl.AreAccessRulesProtected -and $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ceq 'S-1-5-32-544') 'Retained storage security changed.'
}
$denied = $false
try { $handle = [IO.File]::Open((Join-Path $root 'owner.txt'),'Open','Write','ReadWrite'); $handle.Dispose() } catch {
    $inner = $_.Exception; while ($inner.InnerException) { $inner = $inner.InnerException }; $denied = $inner -is [UnauthorizedAccessException]
}
Assert-Cleanup $denied 'Normal-user marker write was not denied.'
$receiptBefore = Get-Content -LiteralPath $status.receiptPath -Raw -Encoding UTF8
$replayRejected = $false
try { & $request -Action Start @parameters | Out-Null } catch { $replayRejected = $_.Exception.Message -like '*already requested*' }
Assert-Cleanup $replayRejected 'Cleanup replay was not blocked.'
Assert-Cleanup ((Get-Content -LiteralPath $status.receiptPath -Raw -Encoding UTF8) -ceq $receiptBefore) 'Replay changed the terminal receipt.'
$removed = & $request -Action Remove @parameters | ConvertFrom-Json
Assert-Cleanup ($removed.task.state -eq 'NotRegistered') 'Cleanup launcher remains registered.'
$health = & (Join-Path $repo 'scripts/Manage-PcHealth.ps1') -Action Status -InstallDirectory $install | ConvertFrom-Json
Assert-Cleanup ($health.task.state -eq 'Running' -and !$health.stale -and !$health.report.elevated -and $null -eq $health.report.latestScan) 'Recorder has not refreshed after cleanup.'
$result = [ordered]@{schema=1;status='passed';scanId=$before.scanId;cleanupExitCode=$status.receipt.exitCode;selectedReportsRemoved=$true;latestPointerRemoved=$true;otherRootContentsPreserved=$true;auditHashesMatched=$true;retainedStorageProtected=$true;normalUserWriteDenied=$true;replayBlocked=$true;launcherRemoved=$true;recorderRunning=$true;recorderInstance=$health.report.instance;latestScanCleared=$true;completedUtc=[DateTimeOffset]::UtcNow.ToString('o')}
Write-WBJson (Get-WBChild $archive 'acceptance.json') $result
$result | ConvertTo-Json
