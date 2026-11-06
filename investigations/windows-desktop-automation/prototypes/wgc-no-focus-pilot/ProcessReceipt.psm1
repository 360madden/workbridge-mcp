Set-StrictMode -Version Latest

# Read-only classification of a process object supplied by the caller.
# This module never starts/stops a process, accesses GUI, or captures a frame.
function Resolve-PilotExitReceipt {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][bool]$WaitFinished,
        [AllowNull()][object]$HasExited,
        [AllowNull()][object]$ExitCode,
        [AllowNull()][string]$ObservationError
    )

    $status = 'unknown'
    $reason = 'completion_unobserved'
    $wrapperExit = 3
    $observedExitCode = $null

    if (-not [string]::IsNullOrWhiteSpace($ObservationError)) {
        $reason = 'observation_error'
    }
    elseif (-not $WaitFinished) {
        $reason = 'wait_not_finished'
    }
    elseif ($HasExited -isnot [bool]) {
        $reason = 'has_exited_unknown'
    }
    elseif (-not $HasExited) {
        $reason = 'process_still_running'
    }
    elseif ($ExitCode -isnot [int]) {
        $reason = 'exit_code_unavailable'
    }
    else {
        $observedExitCode = [int]$ExitCode
        if ($observedExitCode -eq 0) {
            $status = 'success'
            $reason = 'observed_zero_exit'
            $wrapperExit = 0
        }
        else {
            $status = 'failure'
            $reason = 'observed_nonzero_exit'
            $wrapperExit = 1
        }
    }

    [pscustomobject]@{
        Status = $status
        Reason = $reason
        WrapperExitCode = [int]$wrapperExit
        ChildExitCode = $observedExitCode
        ChildExitObserved = ($null -ne $observedExitCode)
        WaitFinished = [bool]$WaitFinished
        HasExited = $HasExited
        ObservationError = $ObservationError
    }
}

# Run only after a caller's separately authorized bounded wait on its exact
# child object. Refresh before reading exit status; null remains UNKNOWN.
function Get-PilotProcessExitReceipt {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][AllowNull()][object]$Process,
        [Parameter(Mandatory = $true)][bool]$WaitFinished
    )

    if ($null -eq $Process) {
        return Resolve-PilotExitReceipt -WaitFinished $WaitFinished -HasExited $null -ExitCode $null -ObservationError 'process_object_missing'
    }

    try {
        $Process.Refresh()
    }
    catch {
        return Resolve-PilotExitReceipt -WaitFinished $WaitFinished -HasExited $null -ExitCode $null -ObservationError ('refresh_failed: ' + $_.Exception.GetType().Name)
    }

    $hasExited = $null
    try {
        $rawHasExited = $Process.HasExited
        if ($rawHasExited -is [bool]) { $hasExited = $rawHasExited }
    }
    catch {
        return Resolve-PilotExitReceipt -WaitFinished $WaitFinished -HasExited $null -ExitCode $null -ObservationError ('has_exited_read_failed: ' + $_.Exception.GetType().Name)
    }

    $exitCode = $null
    if ($WaitFinished -and $hasExited -eq $true) {
        try {
            $exitCode = $Process.ExitCode
        }
        catch {
            return Resolve-PilotExitReceipt -WaitFinished $WaitFinished -HasExited $hasExited -ExitCode $null -ObservationError ('exit_code_read_failed: ' + $_.Exception.GetType().Name)
        }
    }

    return Resolve-PilotExitReceipt -WaitFinished $WaitFinished -HasExited $hasExited -ExitCode $exitCode -ObservationError $null
}

Export-ModuleMember -Function Resolve-PilotExitReceipt, Get-PilotProcessExitReceipt
