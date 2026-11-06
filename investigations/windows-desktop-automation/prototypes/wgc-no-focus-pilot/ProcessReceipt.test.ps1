$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot 'ProcessReceipt.psm1') -Force

$script:passes = 0
function Assert-Equal {
    param($Expected,$Actual,[string]$Label)
    if ($Expected -cne $Actual) {
        throw ("FAIL {0}: expected '{1}', actual '{2}'" -f $Label,$Expected,$Actual)
    }
    $script:passes++
}

function New-FakeChild {
    param([bool]$HasExited,[AllowNull()][object]$ExitCode,[bool]$ThrowRefresh = $false)
    $fake = [pscustomobject]@{
        HasExited = $HasExited
        ExitCode = $ExitCode
        RefreshWasCalled = $false
        ThrowRefresh = $ThrowRefresh
    }
    $fake | Add-Member -MemberType ScriptMethod -Name Refresh -Value {
        $this.RefreshWasCalled = $true
        if ($this.ThrowRefresh) { throw [InvalidOperationException]::new('synthetic refresh failure') }
    } -Force
    return $fake
}

$zero = New-FakeChild -HasExited $true -ExitCode 0
$r = Get-PilotProcessExitReceipt -Process $zero -WaitFinished $true
Assert-Equal 'success' $r.Status 'numeric zero reports success'
Assert-Equal 0 $r.WrapperExitCode 'success wrapper code'
Assert-Equal 0 $r.ChildExitCode 'numeric zero preserved'
Assert-Equal $true $r.ChildExitObserved 'zero exit observed'
Assert-Equal $true $zero.RefreshWasCalled 'refresh before exit code'

$nonzero = New-FakeChild -HasExited $true -ExitCode 37
$r = Get-PilotProcessExitReceipt -Process $nonzero -WaitFinished $true
Assert-Equal 'failure' $r.Status 'nonzero exit failure'
Assert-Equal 37 $r.ChildExitCode 'nonzero child code retained'
Assert-Equal 1 $r.WrapperExitCode 'failure wrapper code'

$nullExit = New-FakeChild -HasExited $true -ExitCode $null
$r = Get-PilotProcessExitReceipt -Process $nullExit -WaitFinished $true
Assert-Equal 'unknown' $r.Status 'null ExitCode unknown, not failure'
Assert-Equal 'exit_code_unavailable' $r.Reason 'null reason preserved'
Assert-Equal 3 $r.WrapperExitCode 'unknown wrapper code distinct'
Assert-Equal $false $r.ChildExitObserved 'null exit not claimed'

$stillRunning = New-FakeChild -HasExited $false -ExitCode $null
$r = Get-PilotProcessExitReceipt -Process $stillRunning -WaitFinished $true
Assert-Equal 'unknown' $r.Status 'contradictory finished/still-running'
Assert-Equal 'process_still_running' $r.Reason 'still running reason'

$timedOut = New-FakeChild -HasExited $true -ExitCode 0
$r = Get-PilotProcessExitReceipt -Process $timedOut -WaitFinished $false
Assert-Equal 'unknown' $r.Status 'uncompleted wait never assumed success'
Assert-Equal 'wait_not_finished' $r.Reason 'bounded wait reason'

$refreshFault = New-FakeChild -HasExited $true -ExitCode 0 -ThrowRefresh $true
$r = Get-PilotProcessExitReceipt -Process $refreshFault -WaitFinished $true
Assert-Equal 'unknown' $r.Status 'failed refresh cannot trust exit cache'
Assert-Equal 'observation_error' $r.Reason 'refresh error reason'
Assert-Equal $true $refreshFault.RefreshWasCalled 'fault path refresh attempted'

$r = Get-PilotProcessExitReceipt -Process $null -WaitFinished $true
Assert-Equal 'unknown' $r.Status 'missing child object unknown'
Assert-Equal 'observation_error' $r.Reason 'missing object reason'

$r = Resolve-PilotExitReceipt -WaitFinished $true -HasExited $true -ExitCode '0'
Assert-Equal 'unknown' $r.Status 'string exit code not accepted as numeric'
Assert-Equal 'exit_code_unavailable' $r.Reason 'string not silently coerced'

$r = Resolve-PilotExitReceipt -WaitFinished $true -HasExited $null -ExitCode 0
Assert-Equal 'unknown' $r.Status 'unknown HasExited cannot imply success'

Write-Output ("PASS ProcessReceipt synthetic tri-state checks {0}" -f $script:passes)
