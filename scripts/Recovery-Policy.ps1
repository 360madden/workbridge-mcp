# Pure acceptance policy, shared with tests; no task or OS mutations.
function Get-WBRecoveryDecision($Checkpoint, $Context, $Health) {
    $expected = if ($Checkpoint.expectedTransition) { [string]$Checkpoint.expectedTransition } else { 'SignIn' }
    if ($expected -cnotin @('SignIn','Reboot')) { throw 'Unrecognized checkpoint transition.' }
    $newBoot = ([DateTimeOffset]$Context.bootUtc) -ne ([DateTimeOffset]$Checkpoint.context.bootUtc)
    $newLogon = $Context.logonId -cne $Checkpoint.context.logonId
    $bootAfterCheckpoint = ([DateTimeOffset]$Context.bootUtc) -gt ([DateTimeOffset]$Checkpoint.armedUtc)
    $observed = if ($expected -ceq 'Reboot') { $newBoot -and $bootAfterCheckpoint } else { $newBoot -or $newLogon }
    $startedAfterCheckpoint = $Health.report -and ([DateTimeOffset]$Health.report.startedUtc) -gt ([DateTimeOffset]$Checkpoint.armedUtc)
    $startedAfterBoot = $Health.report -and ([DateTimeOffset]$Health.report.startedUtc) -ge ([DateTimeOffset]$Context.bootUtc)
    $candidate = $observed -and $Context.userSid -ceq $Checkpoint.context.userSid -and
        $Health.task.state -eq 'Running' -and $Health.task.atLogon -and !$Health.stale -and
        $Health.report -and !$Health.report.elevated -and $Health.report.instance -cne $Checkpoint.instance -and
        $startedAfterCheckpoint -and $startedAfterBoot
    $status = if ($observed) { 'recovery_not_confirmed' } elseif ($expected -ceq 'Reboot') { 'awaiting_full_reboot' } else { 'awaiting_real_signin' }
    [pscustomobject]@{expectedTransition=$expected;newBoot=$newBoot;newLogon=$newLogon;transitionObserved=[bool]$observed;canVerifyAdvancement=[bool]$candidate;status=$status}
}
