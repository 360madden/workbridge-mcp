[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('Launch','Observe','Cleanup')][string]$Action,
    [Parameter(Mandatory)][string]$PrototypeDirectory,
    [Parameter(Mandatory)][string]$HelperId
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Workbridge-Update.ps1')
$prototype = Assert-WBPath $PrototypeDirectory
$manager = Join-Path $PSScriptRoot 'Manage-HelperTask.ps1'
$data = Get-WBChild $prototype 'persistent-heartbeat'
$heartbeat = Get-WBChild $data 'heartbeat.json'
$evidence = Get-WBChild $prototype 'persistence.json'
if ($Action -eq 'Launch') {
    New-Item -ItemType Directory -Path $data -Force | Out-Null
    & $manager -Action Register -HelperId $HelperId -Executable (Get-WBChild $prototype 'HeartbeatProbe/HeartbeatProbe.exe') -Argument @($data) -WorkingDirectory $prototype | Out-Null
    & $manager -Action Start -HelperId $HelperId
    Write-WBJson $evidence ([ordered]@{helperId=$HelperId; state='dispatched'; dataDirectory=$data; dispatchedUtc=[DateTime]::UtcNow.ToString('o')})
} elseif ($Action -eq 'Observe') {
    $first = Get-Content -LiteralPath $heartbeat -Raw -Encoding UTF8 | ConvertFrom-Json
    Start-Sleep -Milliseconds 1400
    $second = Get-Content -LiteralPath $heartbeat -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($first.instance -cne $second.instance -or $second.sequence -le $first.sequence -or $second.elevated) { throw 'No continuing normal-privilege heartbeat.' }
    $result = [ordered]@{helperId=$HelperId; state='heartbeat_advancing'; instance=$second.instance; pid=$second.pid; firstSequence=$first.sequence; secondSequence=$second.sequence; elevated=$second.elevated; observedUtc=[DateTime]::UtcNow.ToString('o'); note='Compare with the original Workbridge command status to establish survival after job exit/timeout.'}
    Write-WBJson $evidence $result
    $result | ConvertTo-Json
} else {
    & $manager -Action Remove -HelperId $HelperId
    $first = Get-Content -LiteralPath $heartbeat -Raw -Encoding UTF8 | ConvertFrom-Json
    Start-Sleep -Milliseconds 1400
    $second = Get-Content -LiteralPath $heartbeat -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($first.instance -cne $second.instance -or $first.sequence -ne $second.sequence) { throw 'Heartbeat still advancing after removal.' }
    $record = Get-Content -LiteralPath $evidence -Raw -Encoding UTF8 | ConvertFrom-Json
    $record | Add-Member -NotePropertyName cleanup -NotePropertyValue 'task_removed_and_heartbeat_stopped' -Force
    Write-WBJson $evidence $record
}
