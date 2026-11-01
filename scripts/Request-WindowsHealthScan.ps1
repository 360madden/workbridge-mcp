[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('Prepare','Start','Status','Remove')][string]$Action,
    [Parameter(Mandatory)][string]$InstallDirectory,
    [Parameter(Mandatory)][ValidateSet('scan','cleanup')][string]$AdminAction,
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{32}$')][string]$ScanId,
    [Parameter(Mandatory)][ValidatePattern('^[a-z0-9][a-z0-9-]{0,38}$')][string]$OperationId
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Workbridge-Update.ps1')
$install = Assert-WBPath $InstallDirectory
$preparation = Get-Content -LiteralPath (Get-WBChild $install 'preparation.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($preparation.schema -ne 1 -or $preparation.status -cne 'prepared_not_elevated') { throw 'Unrecognized preparation receipt.' }
$bundle = Get-WBChild $install 'WindowsHealthScan'
$executable = Get-WBChild $bundle 'WindowsHealthScan.exe'
if ((Get-FileHash -LiteralPath $executable).Hash -cne $preparation.scanSha256) { throw 'Prepared executable changed. Rebuild and review before requesting UAC.' }
$helperId = 'scan-' + $OperationId
$manager = Join-Path $PSScriptRoot 'Manage-HelperTask.ps1'
$receiptPath = Get-WBChild $bundle ('operations/' + $OperationId + '/receipt.json')
$reservation = Get-WBChild $bundle ('operations/' + $OperationId + '/reserved')
$requestPath = Get-WBChild $bundle ('operations/' + $OperationId + '/request.json')
$request = [ordered]@{schema=1;scanId=$ScanId;adminAction=$AdminAction;operationId=$OperationId}
if ($Action -eq 'Prepare') {
    if (Test-Path -LiteralPath $requestPath) { throw 'Operation ID already prepared; use Status or a new ID.' }
    New-Item -ItemType Directory -Path (Split-Path -Parent $requestPath) -Force | Out-Null
    $shell = Join-Path $env:WINDIR 'System32/WindowsPowerShell/v1.0/powershell.exe'
    $worker = Get-WBChild $bundle 'Run-WindowsHealthScan.ps1'
    $arguments = @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','RemoteSigned','-WindowStyle','Hidden','-File',$worker,'-BundleDirectory',$bundle,'-ExpectedSha256',$preparation.scanSha256,'-AdminAction',$AdminAction,'-ScanId',$ScanId,'-OperationId',$OperationId)
    & $manager -Action Register -HelperId $helperId -Executable $shell -Argument $arguments -WorkingDirectory $bundle | Out-Null
    Write-WBJson $requestPath $request
} else {
    $saved = Get-Content -LiteralPath $requestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($saved.scanId -cne $ScanId -or $saved.adminAction -cne $AdminAction -or $saved.operationId -cne $OperationId) { throw 'Operation parameters differ from the prepared request.' }
    if ($Action -eq 'Start') {
        if (Test-Path -LiteralPath $reservation) { throw 'Operation already requested; inspect Status. UAC is never automatically retried.' }
        & $manager -Action Start -HelperId $helperId | Out-Null
    } elseif ($Action -eq 'Remove') {
        $current = & $manager -Action Status -HelperId $helperId | ConvertFrom-Json
        if ($current.state -in @('Running','Queued')) { throw 'The administrator action is active; wait for its terminal receipt before removal.' }
        & $manager -Action Remove -HelperId $helperId | Out-Null
    }
}
$task = & $manager -Action Status -HelperId $helperId | ConvertFrom-Json
$receipt = if (Test-Path -LiteralPath $receiptPath) { Get-Content -LiteralPath $receiptPath -Raw -Encoding UTF8 | ConvertFrom-Json } else { $null }
$reportPath = Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) ('WorkbridgePcHealth/' + $ScanId + '/report.json')
$report = if (Test-Path -LiteralPath $reportPath) { Get-Content -LiteralPath $reportPath -Raw -Encoding UTF8 | ConvertFrom-Json } else { $null }
[ordered]@{request=$request;task=$task;executable=$executable;sha256=$preparation.scanSha256;receiptPath=$receiptPath;receipt=$receipt;reportPath=$reportPath;report=$report;
    operatorAction='Start requests Windows UAC. A person at this PC approves or cancels locally. A scan may take several minutes. No repair/restart is requested.'} | ConvertTo-Json -Depth 10
