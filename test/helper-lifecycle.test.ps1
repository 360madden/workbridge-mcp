[CmdletBinding()]
param([Parameter(Mandatory)][string]$PrototypeDirectory)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$manager = Join-Path $repo 'scripts/Manage-HelperTask.ps1'
$id = 'test-' + [guid]::NewGuid().ToString('N').Substring(0,16)
$foreignId = $id + '-foreign'
$logonId = $id + '-logon'
$foreignName = 'Workbridge Helper ' + $foreignId
$data = Join-Path $PrototypeDirectory ('heartbeat data ' + [char]0xFC + ' ' + $id)
New-Item -ItemType Directory -Path $data | Out-Null
$exe = Join-Path $PrototypeDirectory 'HeartbeatProbe/HeartbeatProbe.exe'
$checks = @()
function Assert-Helper($Condition, [string]$Message) { if (!$Condition) { throw $Message } }
function Read-Heartbeat { Get-Content -LiteralPath (Join-Path $data 'heartbeat.json') -Raw | ConvertFrom-Json }
function Wait-Heartbeat([string]$PreviousInstance = '') {
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    do {
        if (Test-Path -LiteralPath (Join-Path $data 'heartbeat.json')) {
            $value = Read-Heartbeat
            if (!$PreviousInstance -or $value.instance -cne $PreviousInstance) { return $value }
        }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)
    throw 'No fresh heartbeat.'
}
try {
    $registration = & $manager -Action Register -HelperId $id -Executable $exe -Argument @($data) -WorkingDirectory $PrototypeDirectory | ConvertFrom-Json
    Assert-Helper ($registration.runLevel -eq 'Limited' -and !$registration.atLogon) 'Expected an on-demand Limited task.'
    $repeat = & $manager -Action Register -HelperId $id -Executable $exe -Argument @($data) -WorkingDirectory $PrototypeDirectory | ConvertFrom-Json
    $checks += 'idempotent registration; Limited/Interactive; no default startup trigger'
    & $manager -Action Start -HelperId $id | Out-Null
    $first = Wait-Heartbeat
    Assert-Helper (!$first.elevated -and $first.marker -ceq 'WORKBRIDGE_PERSISTENT_HELPER_OK') 'Unexpected helper token/marker.'
    & $manager -Action Start -HelperId $id | Out-Null
    Start-Sleep -Milliseconds 1400
    $second = Read-Heartbeat
    Assert-Helper ($first.instance -ceq $second.instance -and $second.sequence -gt $first.sequence) 'Duplicate start changed instance or heartbeat stopped.'
    $checks += 'space/Unicode argv; live heartbeat; duplicate Start does not create another instance'
    $task = Get-ScheduledTask -TaskPath '\' -TaskName $registration.taskName
    $originalAction = $task.Actions
    try {
        $changed = New-ScheduledTaskAction -Execute $exe -Argument 'changed-without-running' -WorkingDirectory $PrototypeDirectory
        Set-ScheduledTask -TaskPath '\' -TaskName $registration.taskName -Action $changed | Out-Null
        $rejected = $false
        try { & $manager -Action Stop -HelperId $id | Out-Null } catch { $rejected = $_.Exception.Message -like '*TASK_OWNERSHIP*' }
        Assert-Helper $rejected 'Modified task was not rejected.'
    } finally {
        Set-ScheduledTask -TaskPath '\' -TaskName $registration.taskName -Action $originalAction | Out-Null
    }
    $checks += 'changed task definition rejected before Stop'
    & $manager -Action Stop -HelperId $id | Out-Null
    $stopped = Read-Heartbeat
    Start-Sleep -Milliseconds 1400
    Assert-Helper ((Read-Heartbeat).sequence -eq $stopped.sequence) 'Heartbeat advanced after Stop.'
    & $manager -Action Start -HelperId $id | Out-Null
    $restarted = Wait-Heartbeat $stopped.instance
    $checks += 'Stop halts writes; restart produces a new instance'

    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $principal = New-ScheduledTaskPrincipal -UserId $sid -LogonType Interactive -RunLevel Limited
    $foreignAction = New-ScheduledTaskAction -Execute $exe -Argument 'never-run' -WorkingDirectory $PrototypeDirectory
    Register-ScheduledTask -TaskPath '\' -TaskName $foreignName -Action $foreignAction -Principal $principal -Description ('Foreign fixture ' + $id) | Out-Null
    $collisionRejected = $false
    try { & $manager -Action Register -HelperId $foreignId -Executable $exe -Argument @($data) -WorkingDirectory $PrototypeDirectory | Out-Null } catch { $collisionRejected = $_.Exception.Message -like '*TASK_COLLISION*' }
    Assert-Helper $collisionRejected 'Foreign task collision was not rejected.'
    Assert-Helper ((Get-ScheduledTask -TaskPath '\' -TaskName $foreignName).Description -ceq ('Foreign fixture ' + $id)) 'Foreign task changed.'
    $checks += 'unrelated same-name task preserved'

    $logon = & $manager -Action Register -HelperId $logonId -Executable $exe -Argument @($data) -WorkingDirectory $PrototypeDirectory -AtLogon | ConvertFrom-Json
    Assert-Helper (@((Get-ScheduledTask -TaskPath '\' -TaskName $logon.taskName).Triggers).Count -eq 1) 'Explicit sign-in trigger missing.'
    $originalTrigger = (Get-ScheduledTask -TaskPath '\' -TaskName $logon.taskName).Triggers
    try {
        $delayed = New-ScheduledTaskTrigger -AtLogOn -User $sid
        $delayed.Delay = 'PT5S'
        Set-ScheduledTask -TaskPath '\' -TaskName $logon.taskName -Trigger $delayed | Out-Null
        $triggerRejected = $false
        try { & $manager -Action Start -HelperId $logonId | Out-Null } catch { $triggerRejected = $_.Exception.Message -like '*TASK_OWNERSHIP*' }
        Assert-Helper $triggerRejected 'Modified sign-in trigger was not rejected before Start.'
    } finally { Set-ScheduledTask -TaskPath '\' -TaskName $logon.taskName -Trigger $originalTrigger | Out-Null }
    & $manager -Action Remove -HelperId $logonId | Out-Null
    $checks += 'explicit AtLogon registration; changed trigger rejected before Start; removal (actual sign-out/reboot not tested)'

    $dotnet = (Get-Command dotnet.exe).Source
    $adminDll = Join-Path $PrototypeDirectory 'build-artifacts/bin/AdminProbe/release_win-x64/AdminProbe.dll'
    & $dotnet $adminDll
    Assert-Helper ($LASTEXITCODE -eq 5) 'Normal token incorrectly reported elevation.'
    & $dotnet $adminDll 'unexpected-command'
    Assert-Helper ($LASTEXITCODE -eq 2) 'Admin probe accepted unexpected arguments.'
    $checks += 'fixed admin probe returns not-elevated and rejects all arguments without UAC'
    $adminBundle = Join-Path $PrototypeDirectory 'AdminProbe'
    $worker = Join-Path $adminBundle 'Run-AdminProbe.ps1'
    # Child process lets us assert the wrapper failure exit without terminating this test.
    & powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File $worker -BundleDirectory $adminBundle -ExpectedSha256 ('0' * 64) -OperationId $id | Out-Null
    Assert-Helper ($LASTEXITCODE -eq 1) 'Changed payload was not rejected.'
    $rejection = Get-Content -LiteralPath (Join-Path $adminBundle ('operations/' + $id + '/receipt.json')) -Raw | ConvertFrom-Json
    Assert-Helper ($rejection.state -eq 'failed' -and $rejection.error -like '*PAYLOAD_CHANGED*') 'Unexpected preflight result.'
    $checks += 'payload drift rejected before UAC'
} finally {
    foreach ($ownedId in @($id,$logonId)) {
        if (Test-Path -LiteralPath (Join-Path $repo ('.local/helpers/' + $ownedId + '/registration.json'))) {
            & $manager -Action Remove -HelperId $ownedId | Out-Null
        }
    }
    $foreign = Get-ScheduledTask -TaskPath '\' -TaskName $foreignName -ErrorAction SilentlyContinue
    if ($foreign -and $foreign.Description -ceq ('Foreign fixture ' + $id)) {
        Unregister-ScheduledTask -TaskPath '\' -TaskName $foreignName -Confirm:$false
    }
}
$checks += 'test task registrations removed; retained source, receipts, and heartbeat artifacts'
$result = [ordered]@{status='passed'; checks=$checks; prototypeDirectory=$PrototypeDirectory; actualUacTested=$false; rebootTested=$false; completedUtc=[DateTime]::UtcNow.ToString('o')}
$result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $PrototypeDirectory 'lifecycle-tests.json') -Encoding utf8
$result | ConvertTo-Json -Depth 5
