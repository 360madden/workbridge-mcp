$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts/Recovery-Policy.ps1')
$checks = @()
function New-Fixture {
    @{ checkpoint=[pscustomobject]@{expectedTransition='Reboot';armedUtc='2026-10-18T12:00:00Z';instance='old';context=[pscustomobject]@{bootUtc='2026-10-18T00:00:00Z';logonId='old-login';userSid='same-user'}};
       context=[pscustomobject]@{bootUtc='2026-10-18T13:00:00Z';logonId='new-login';userSid='same-user'};
       health=[pscustomobject]@{task=[pscustomobject]@{state='Running';atLogon=$true};stale=$false;report=[pscustomobject]@{elevated=$false;instance='new';startedUtc='2026-10-18T13:01:00Z';bridge=[pscustomobject]@{ready=$true}}} }
}
function Assert-Policy($Fixture,[bool]$Eligible,[string]$Status,[string]$Name) {
    $decision=Get-WBRecoveryDecision $Fixture.checkpoint $Fixture.context $Fixture.health
    if ($decision.canVerifyAdvancement -ne $Eligible -or $decision.status -cne $Status) { throw ('Failed: '+$Name+'; '+($decision|ConvertTo-Json -Compress)) }
    $script:checks += $Name
}
$f=New-Fixture; Assert-Policy $f $true 'recovery_not_confirmed' 'New boot allows live advancement check, not immediate success'
$f=New-Fixture; $f.context.bootUtc=$f.checkpoint.context.bootUtc; Assert-Policy $f $false 'awaiting_full_reboot' 'Changed login alone cannot satisfy reboot'
$f=New-Fixture; $f.context.bootUtc='2026-10-18T11:00:00Z'; Assert-Policy $f $false 'awaiting_full_reboot' 'Changed boot predating checkpoint cannot satisfy reboot'
foreach ($case in @('stale','elevated','old-instance','stopped','missing-trigger','wrong-user','before-checkpoint','before-boot','missing-report')) {
    $f=New-Fixture
    switch ($case) {
        'stale' {$f.health.stale=$true}
        'elevated' {$f.health.report.elevated=$true}
        'old-instance' {$f.health.report.instance='old'}
        'stopped' {$f.health.task.state='Ready'}
        'missing-trigger' {$f.health.task.atLogon=$false}
        'wrong-user' {$f.context.userSid='other-user'}
        'before-checkpoint' {$f.health.report.startedUtc='2026-10-18T11:30:00Z'}
        'before-boot' {$f.health.report.startedUtc='2026-10-18T12:30:00Z'}
        'missing-report' {$f.health.report=$null}
    }
    Assert-Policy $f $false 'recovery_not_confirmed' ('Reject '+$case)
}
$f=New-Fixture; $f.health.report.bridge.ready=$false; Assert-Policy $f $true 'recovery_not_confirmed' 'Bridge readiness is a separate observation'
$f=New-Fixture; $f.checkpoint.PSObject.Properties.Remove('expectedTransition'); $f.context.bootUtc=$f.checkpoint.context.bootUtc; Assert-Policy $f $true 'recovery_not_confirmed' 'Legacy sign-in checkpoint remains supported'
$f=New-Fixture; $f.checkpoint.expectedTransition='SignIn'; $f.context.bootUtc=$f.checkpoint.context.bootUtc; $f.context.logonId=$f.checkpoint.context.logonId; Assert-Policy $f $false 'awaiting_real_signin' 'Unchanged login cannot satisfy sign-in'
$f=New-Fixture; $f.checkpoint.expectedTransition='Unknown'; $rejected=$false
try { Get-WBRecoveryDecision $f.checkpoint $f.context $f.health|Out-Null } catch { $rejected=$_.Exception.Message -like '*Unrecognized*' }
if (!$rejected) {throw 'Unknown transition accepted'}; $checks+='Unknown transition rejected'
[ordered]@{status='passed';assertions=$checks.Count;checks=$checks;actualRebootTested=$false}|ConvertTo-Json -Depth 4
