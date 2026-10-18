[CmdletBinding()]
param(
    [ValidateSet('Apply','Status','Recover','Rollback')][string]$Action = 'Status',
    [string]$InstallRoot = '',
    [Parameter(Mandatory)][string]$OperationId,
    [string]$ReleasePath = '',
    [string]$ServiceTaskName = 'Workbridge MCP',
    [ValidateRange(3,120)][int]$ReadinessTimeoutSeconds = 45
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Workbridge-Update.ps1')
Import-Module (Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\Modules\ScheduledTasks') -ErrorAction Stop
if (!$InstallRoot) { $InstallRoot = Split-Path -Parent $PSScriptRoot }
$install = Get-WBInstallation $InstallRoot ($Action -ne 'Apply')
if ($OperationId -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$') { throw 'Invalid update operation ID.' }
$operation = Get-WBChild $install ('.local\update-operations\' + $OperationId)
$journal = Get-WBChild $operation 'journal.json'
$taskName = 'Workbridge Update ' + $OperationId
if ($Action -eq 'Status') {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    $record = if (Test-Path -LiteralPath $journal) { Read-WBJson $journal } else { $null }
    $controllerError = if (Test-Path -LiteralPath (Join-Path $operation 'controller-error.json')) { Read-WBJson (Join-Path $operation 'controller-error.json') } else { $null }
    [pscustomobject]@{operationId=$OperationId; taskState=$(if ($task) { [string]$task.State } else { 'Not registered' }); journal=$record; controllerError=$controllerError; recoveryCommand=".\scripts\Update-Workbridge.ps1 -Action Recover -OperationId $OperationId"} | ConvertTo-Json -Depth 12
    return
}
$requestFile = Get-WBChild $operation 'request.json'
if ($Action -eq 'Apply') {
    if (!$ReleasePath) { throw 'Apply requires a validated release path.' }
    $release = Get-WBRelease $ReleasePath
    if ($release.path.Contains('"') -or $install.Contains('"')) { throw 'Update paths cannot contain quotes.' }
} elseif (!(Test-Path -LiteralPath $journal)) { throw 'Recovery requires an existing operation journal.' }
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task -and $task.State -eq 'Running') { throw 'This operation is already running. Inspect Status; do not change its request.' }
New-Item -ItemType Directory -Path $operation -Force | Out-Null
if (Test-Path -LiteralPath $requestFile) {
    $request = Read-WBJson $requestFile
    if ($request.installRoot -cne $install -or $request.operationId -cne $OperationId) { throw 'Operation belongs to another installation.' }
    if ($Action -eq 'Apply' -and $request.releaseDigest -cne $release.digest) { throw 'Operation ID is already bound to a different release.' }
    if ($Action -eq 'Apply' -and (Test-Path -LiteralPath $journal)) {
        $record = Read-WBJson $journal
        if ($record.phase -in @('completed','rolled_back','failed_rolled_back','preflight_failed')) { $record | ConvertTo-Json -Depth 12; return }
        throw 'Interrupted operation: use Recover with the same operation ID.'
    }
    $request.action = $Action
} else {
    if ($Action -ne 'Apply') { throw 'Original operation request is missing; inspect the retained journal locally.' }
    $nodePath = (Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    $request = [pscustomobject]@{schema=1; action=$Action; installRoot=$install; operationId=$OperationId; releasePath=$release.path; releaseDigest=$release.digest; nodePath=$nodePath; serviceTaskName=$ServiceTaskName; readinessTimeoutSeconds=$ReadinessTimeoutSeconds}
}
$controller = Get-WBChild $operation 'controller'
if (!(Test-Path -LiteralPath $controller)) {
    New-Item -ItemType Directory -Path $controller | Out-Null
    foreach ($name in @('Workbridge-Update.ps1','Invoke-WorkbridgeUpdate.ps1','release-acceptance.mjs')) { Copy-WBTree (Join-Path $PSScriptRoot $name) (Join-Path $controller $name) }
}
Write-WBJson $requestFile $request
$earlyError = Get-WBChild $operation 'controller-error.json'
if (Test-Path -LiteralPath $earlyError) {
    Move-Item -LiteralPath $earlyError -Destination (Get-WBChild $operation ('controller-error.previous-' + [guid]::NewGuid().ToString('N') + '.json'))
}
$shell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$worker = Join-Path $controller 'Invoke-WorkbridgeUpdate.ps1'
$arguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -WindowStyle Hidden -File `"$worker`" -InstallRoot `"$install`" -OperationId `"$OperationId`""
if ($task -and (@($task.Actions).Count -ne 1 -or $task.Actions.Execute -ine $shell -or $task.Actions.Arguments -cne $arguments)) { throw 'An unrelated scheduled task uses this operation name.' }
if (!$task) {
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $taskAction = New-ScheduledTaskAction -Execute $shell -Argument $arguments -WorkingDirectory $controller
    $principal = New-ScheduledTaskPrincipal -UserId $sid -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $taskName -Action $taskAction -Principal $principal -Settings $settings -Description 'Independent Workbridge runtime update/recovery; retained journal and backups.' | Out-Null
}
# Task Scheduler creates this process independently of the tunnel's Job Object.
Start-ScheduledTask -TaskName $taskName
Write-Host "Dispatched $Action as '$taskName'. The updater survives the Workbridge connection closing."
Write-Host "Inspect: .\scripts\Update-Workbridge.ps1 -Action Status -OperationId $OperationId"
Write-Host "Journal: $journal"
