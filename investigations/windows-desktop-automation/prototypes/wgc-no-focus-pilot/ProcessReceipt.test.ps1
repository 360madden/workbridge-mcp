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

# Defensive fake processes can count/throw getter reads without launching OS processes.
function New-ObservedFakeChild {
    param(
        [bool]$HasExited,
        [AllowNull()][object]$Code,
        [bool]$ThrowExit = $false,
        [bool]$ThrowHasExited = $false
    )
    $fake = New-FakeChild -HasExited $HasExited -ExitCode $Code
    $fake | Add-Member -MemberType NoteProperty -Name ExitReadCount -Value 0
    $fake | Add-Member -MemberType NoteProperty -Name StoredExitCode -Value $Code
    $fake | Add-Member -MemberType NoteProperty -Name ThrowExitOnRead -Value $ThrowExit
    $fake | Add-Member -MemberType ScriptProperty -Name ExitCode -Value {
        $this.ExitReadCount = [int]$this.ExitReadCount + 1
        if ($this.ThrowExitOnRead) { throw [InvalidOperationException]::new('synthetic exit read failure') }
        return $this.StoredExitCode
    } -Force
    if ($ThrowHasExited) {
        $fake | Add-Member -MemberType ScriptProperty -Name HasExited -Value {
            throw [InvalidOperationException]::new('synthetic has exited read failure')
        } -Force
    }
    return $fake
}

$hasExitedFault = New-ObservedFakeChild -HasExited $true -Code 0 -ThrowHasExited $true
$r = Get-PilotProcessExitReceipt -Process $hasExitedFault -WaitFinished $true
Assert-Equal 'unknown' $r.Status 'HasExited getter throws: unknown'
# PowerShell ETS may surface a throwing ScriptProperty as null rather than a terminating error.
Assert-Equal 'has_exited_unknown' $r.Reason 'HasExited getter throws: fail-closed unknown value'
Assert-Equal 0 $hasExitedFault.ExitReadCount 'HasExited throws: ExitCode not read'
Assert-Equal $true $hasExitedFault.RefreshWasCalled 'HasExited throws: Refresh called first'

$exitFault = New-ObservedFakeChild -HasExited $true -Code 0 -ThrowExit $true
$r = Get-PilotProcessExitReceipt -Process $exitFault -WaitFinished $true
Assert-Equal 'unknown' $r.Status 'ExitCode getter throws: unknown'
Assert-Equal 'exit_code_unavailable' $r.Reason 'ExitCode getter throws: fail-closed unknown value'
Assert-Equal 1 $exitFault.ExitReadCount 'ExitCode getter throws: one bounded read'
Assert-Equal $false $r.ChildExitObserved 'ExitCode getter throws: no exit claimed'

$timedOutObserved = New-ObservedFakeChild -HasExited $true -Code 0
$r = Get-PilotProcessExitReceipt -Process $timedOutObserved -WaitFinished $false
Assert-Equal 'unknown' $r.Status 'timed out with HasExited true remains unknown'
Assert-Equal 0 $timedOutObserved.ExitReadCount 'timed out: ExitCode never read'

$runningObserved = New-ObservedFakeChild -HasExited $false -Code 12
$r = Get-PilotProcessExitReceipt -Process $runningObserved -WaitFinished $true
Assert-Equal 'unknown' $r.Status 'still running with synthetic code remains unknown'
Assert-Equal 0 $runningObserved.ExitReadCount 'still running: ExitCode never read'

$r = Resolve-PilotExitReceipt -WaitFinished $true -HasExited $true -ExitCode ([int]-7)
Assert-Equal 'failure' $r.Status 'negative Int32 classified as observed failure'
Assert-Equal -7 $r.ChildExitCode 'negative Int32 remains signed'
Assert-Equal 1 $r.WrapperExitCode 'negative Int32 wrapper failure'

$r = Resolve-PilotExitReceipt -WaitFinished $true -HasExited $true -ExitCode ([long]0)
Assert-Equal 'unknown' $r.Status 'Int64 zero rejected without narrowing'
Assert-Equal 'exit_code_unavailable' $r.Reason 'Int64 rejected as invalid type'

$r = Resolve-PilotExitReceipt -WaitFinished $true -HasExited $true -ExitCode ([decimal]0)
Assert-Equal 'unknown' $r.Status 'decimal zero rejected without coercion'
Assert-Equal 'exit_code_unavailable' $r.Reason 'decimal rejected as invalid type'

$r = Resolve-PilotExitReceipt -WaitFinished $false -HasExited $true -ExitCode ([int]0) -ObservationError 'synthetic forced error'
Assert-Equal 'unknown' $r.Status 'observation error dominates apparent success'
Assert-Equal 'observation_error' $r.Reason 'observation error precedes timeout reason'
Assert-Equal $false $r.ChildExitObserved 'observation error ignores numeric code'
Assert-Equal 3 $r.WrapperExitCode 'observation error returns unknown wrapper code'

Write-Output ("PASS ProcessReceipt synthetic tri-state checks {0}" -f $script:passes)
