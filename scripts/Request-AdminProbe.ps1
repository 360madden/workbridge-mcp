[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('Prepare','Start','Status','Remove')][string]$Action,
    [Parameter(Mandatory)][string]$PrototypeDirectory,
    [Parameter(Mandatory)][ValidatePattern('^[a-z0-9][a-z0-9-]{0,38}$')][string]$OperationId
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Workbridge-Update.ps1')
$prototype = Assert-WBPath $PrototypeDirectory
$preparation = Get-Content -LiteralPath (Get-WBChild $prototype 'preparation.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($preparation.schema -ne 1 -or $preparation.status -cne 'prepared_not_elevated') { throw 'Unrecognized prototype preparation receipt.' }
$bundle = Get-WBChild $prototype 'AdminProbe'
$executable = Get-WBChild $bundle 'AdminProbe.exe'
if ((Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash -cne $preparation.adminSha256) { throw 'Prepared executable changed. Rebuild and review before requesting UAC.' }
$helperId = 'uac-' + $OperationId
$manager = Join-Path $PSScriptRoot 'Manage-HelperTask.ps1'
$receiptPath = Get-WBChild $bundle ('operations/' + $OperationId + '/receipt.json')
$reservation = Get-WBChild $bundle ('operations/' + $OperationId + '/reserved')
if ($Action -eq 'Prepare') {
    $shell = Join-Path $env:WINDIR 'System32/WindowsPowerShell/v1.0/powershell.exe'
    $worker = Get-WBChild $bundle 'Run-AdminProbe.ps1'
    $arguments = @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','RemoteSigned','-WindowStyle','Hidden','-File',$worker,'-BundleDirectory',$bundle,'-ExpectedSha256',$preparation.adminSha256,'-OperationId',$OperationId)
    & $manager -Action Register -HelperId $helperId -Executable $shell -Argument $arguments -WorkingDirectory $bundle | Out-Null
} elseif ($Action -eq 'Start') {
    if (Test-Path -LiteralPath $reservation) { throw 'Operation was already requested. Inspect Status; a new deliberate UAC test needs a new OperationId.' }
    & $manager -Action Start -HelperId $helperId | Out-Null
} elseif ($Action -eq 'Remove') {
    $current = & $manager -Action Status -HelperId $helperId | ConvertFrom-Json
    if ($current.state -in @('Running','Queued')) { throw 'The UAC launcher is active. Respond to Windows and wait for its terminal receipt before removal.' }
    & $manager -Action Remove -HelperId $helperId | Out-Null
}
$task = & $manager -Action Status -HelperId $helperId | ConvertFrom-Json
$receipt = if (Test-Path -LiteralPath $receiptPath) { Get-Content -LiteralPath $receiptPath -Raw -Encoding UTF8 | ConvertFrom-Json } else { $null }
[ordered]@{
    operationId=$OperationId; task=$task; executable=$executable; sha256=$preparation.adminSha256
    purpose='Fixed read-only token check; no command arguments or system changes.'
    receiptPath=$receiptPath; receipt=$receipt
    operatorAction='Start requests Windows UAC. A person at this PC must approve or cancel on the Windows secure desktop. No credentials go into chat.'
} | ConvertTo-Json -Depth 8
