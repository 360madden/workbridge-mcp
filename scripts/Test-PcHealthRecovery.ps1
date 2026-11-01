[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('Rehearse','Arm','Verify','Status')][string]$Action,
    [Parameter(Mandatory)][string]$InstallDirectory,
    [Parameter(Mandatory)][ValidatePattern('^[a-z0-9][a-z0-9-]{0,38}$')][string]$TestId,
    [ValidateSet('SignIn','Reboot')][string]$TransitionKind = 'SignIn'
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Workbridge-Update.ps1')
. (Join-Path $PSScriptRoot 'Recovery-Policy.ps1')
if ($Action -ne 'Arm' -and $PSBoundParameters.ContainsKey('TransitionKind')) { throw 'TransitionKind is set only when arming; Verify uses the saved checkpoint.' }
$install = Assert-WBPath $InstallDirectory
$healthManager = Join-Path $PSScriptRoot 'Manage-PcHealth.ps1'
$directory = Get-WBChild $install ('recovery/' + $TestId)
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$checkpointPath = Get-WBChild $directory 'checkpoint.json'
$resultPath = Get-WBChild $directory 'result.json'

function Get-RecoveryContext {
    if (!('WBRecoveryToken' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;
public static class WBRecoveryToken {
    [StructLayout(LayoutKind.Sequential)] struct Luid { public uint Low; public int High; }
    [StructLayout(LayoutKind.Sequential)] struct Statistics {
        public Luid TokenId, AuthenticationId;
        public long ExpirationTime;
        public int TokenType, ImpersonationLevel;
        public uint DynamicCharged, DynamicAvailable, GroupCount, PrivilegeCount;
        public Luid ModifiedId;
    }
    [DllImport("advapi32.dll", SetLastError=true)]
    static extern bool GetTokenInformation(IntPtr token, int kind, out Statistics statistics, int length, out int returned);
    public static string AuthenticationId() {
        using (var identity = WindowsIdentity.GetCurrent()) {
            Statistics s; int returned;
            if (!GetTokenInformation(identity.Token, 10, out s, Marshal.SizeOf(typeof(Statistics)), out returned))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            return s.AuthenticationId.High.ToString("X8") + ":" + s.AuthenticationId.Low.ToString("X8");
        }
    }
}
'@
    }
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    if ((New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run recovery verification with a normal token.' }
    $boot = (Get-CimInstance Win32_OperatingSystem -Property LastBootUpTime).LastBootUpTime
    [ordered]@{userSid=$identity.User.Value;logonId=[WBRecoveryToken]::AuthenticationId();bootUtc=([DateTimeOffset]$boot).ToUniversalTime().ToString('o');sessionId=[Diagnostics.Process]::GetCurrentProcess().SessionId}
}
function Read-Health { & $healthManager -Action Status -InstallDirectory $install | ConvertFrom-Json }
function Wait-FreshHealth([string]$Previous, [long]$Sequence = -1) {
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds(55)
    do {
        $value = Read-Health
        if ($value.report -and !$value.stale -and $value.task.state -eq 'Running' -and !$value.report.elevated -and
            (($Sequence -eq -1 -and $value.report.instance -cne $Previous) -or
             ($Sequence -ge 0 -and $value.report.instance -ceq $Previous -and $value.report.sequence -gt $Sequence))) { return $value }
        Start-Sleep -Milliseconds 500
    } while ([DateTimeOffset]::UtcNow -lt $deadline)
    throw 'No qualifying fresh report within 55 seconds. No automatic retry or recovery claim.'
}
if ($Action -eq 'Rehearse') {
    if (Test-Path -LiteralPath $checkpointPath) { throw 'Checkpoint already armed; use another TestId for rehearsal.' }
    $before = Read-Health
    if ($before.stale -or $before.task.state -ne 'Running') { throw 'Recorder must be running with a fresh report before rehearsal.' }
    & $healthManager -Action Stop -InstallDirectory $install | Out-Null
    try {
        $stopped = Read-Health
        Start-Sleep -Seconds 2
        $still = Read-Health
        if ($still.task.state -eq 'Running' -or $still.report.sequence -ne $stopped.report.sequence) { throw 'Recorder kept writing after Stop.' }
    } finally { & $healthManager -Action Start -InstallDirectory $install | Out-Null }
    $restarted = Wait-FreshHealth $before.report.instance
    $advancing = Wait-FreshHealth $restarted.report.instance $restarted.report.sequence
    $rehearsal = [ordered]@{status='passed';kind='manual_stop_start_only';beforeInstance=$before.report.instance;afterInstance=$advancing.report.instance;sequence=$advancing.report.sequence;elevated=$advancing.report.elevated;atLogon=$advancing.task.atLogon;actualSignInTested=$false;completedUtc=[DateTimeOffset]::UtcNow.ToString('o')}
    Write-WBJson (Get-WBChild $directory 'rehearsal.json') $rehearsal
    $rehearsal | ConvertTo-Json
} elseif ($Action -eq 'Arm') {
    if (Test-Path -LiteralPath $checkpointPath) { throw 'Checkpoint already exists; it will not be replaced.' }
    $health = Read-Health
    if ($health.stale -or $health.task.state -ne 'Running' -or !$health.task.atLogon -or $health.report.elevated) { throw 'Fresh normal-user recorder and validated sign-in task required.' }
    $context = Get-RecoveryContext
    $checkpoint = [ordered]@{schema=1;testId=$TestId;expectedTransition=$TransitionKind;armedUtc=[DateTimeOffset]::UtcNow.ToString('o');context=$context;instance=$health.report.instance;sequence=$health.report.sequence;recorderStartedUtc=$health.report.startedUtc;note='No sign-out/reboot performed. Verify is read-only; do not manually start the recorder after signing in.'}
    Write-WBJson $checkpointPath $checkpoint
    $checkpoint | ConvertTo-Json -Depth 5
} elseif ($Action -eq 'Verify') {
    $checkpoint = Get-Content -LiteralPath $checkpointPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($checkpoint.schema -ne 1 -or $checkpoint.testId -cne $TestId) { throw 'Invalid checkpoint.' }
    $context = Get-RecoveryContext
    if ($context.userSid -cne $checkpoint.context.userSid) { throw 'Different Windows user.' }
    $health = Read-Health
    $decision = Get-WBRecoveryDecision $checkpoint $context $health
    $status = $decision.status
    $sequenceBeforeAdvancement = $health.report.sequence
    if ($decision.canVerifyAdvancement) { $health = Wait-FreshHealth $health.report.instance $health.report.sequence; $status = 'passed' }
    $result = [ordered]@{schema=1;status=$status;expectedTransition=$decision.expectedTransition;newBoot=$decision.newBoot;newLogon=$decision.newLogon;transitionObserved=$decision.transitionObserved;context=$context;previousInstance=$checkpoint.instance;instance=$health.report.instance;sequenceBeforeAdvancement=$sequenceBeforeAdvancement;sequence=$health.report.sequence;taskState=$health.task.state;atLogon=$health.task.atLogon;stale=$health.stale;bridgeReady=$health.report.bridge.ready;verifiedUtc=[DateTimeOffset]::UtcNow.ToString('o');note='Verification never starts the recorder. A pass assumes no manual helper Start after sign-in; bridge readiness is reported separately.'}
    # Preserve an already successful result against accidental later rechecks.
    if (Test-Path -LiteralPath $resultPath) {
        $prior = Get-Content -LiteralPath $resultPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($prior.status -eq 'passed') { throw 'Successful result already retained; inspect Status.' }
    }
    Write-WBJson $resultPath $result
    $result | ConvertTo-Json -Depth 5
} else {
    [ordered]@{checkpoint=$(if (Test-Path -LiteralPath $checkpointPath) { Get-Content -LiteralPath $checkpointPath -Raw -Encoding UTF8 | ConvertFrom-Json });result=$(if (Test-Path -LiteralPath $resultPath) { Get-Content -LiteralPath $resultPath -Raw -Encoding UTF8 | ConvertFrom-Json });health=(Read-Health)} | ConvertTo-Json -Depth 12
}
