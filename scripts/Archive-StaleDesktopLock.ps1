#requires -Version 5.1
<#
  Narrow one-time reconciliation of the orphaned *lock-only* ChatInputProbe
  desktop-input lease from November 5, 2026. This never sends GUI input.
  Without -Execute it is strictly read-only.
  The Win32 atomic admission / file-ID / no-replace rename implementation
  comes from the pinned, independently reviewed Archive-DesktopQuarantine.ps1.
  Never blindly replay a command whose delivery was uncertain.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$EvidenceRoot,
    [Parameter(Mandatory=$true)][string]$ExpectedLockSha256,
    [Parameter(Mandatory=$true)][string]$ExpectedLeaseId,
    [Parameter(Mandatory=$true)][string]$ExpectedRequestId,
    [Parameter(Mandatory=$true)][int]$ExpectedOwnerPid,
    [Parameter(Mandatory=$true)][int]$ExpectedTargetPid,
    [Parameter(Mandatory=$true)][int64]$ExpectedTargetHwnd,
    [Parameter(Mandatory=$true)][string]$OperationId,
    [switch]$Execute,
    [switch]$SyntheticFixture
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
function Reject([string]$code) { throw [InvalidOperationException]::new($code) }
function Hash([byte[]]$bytes) { return [WorkbridgeArchiveWin32]::Fingerprint($bytes) }
function Write-NewBytes([string]$path,[byte[]]$bytes) {
    $f=[IO.FileStream]::new($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
    try{$f.Write($bytes,0,$bytes.Length);$f.Flush($true)}finally{$f.Dispose()}
}
function Write-Journal([string]$path,[string]$stage,[string]$detail='') {
    $record=[ordered]@{utc=[DateTime]::UtcNow.ToString('o');stage=$stage;detail=$detail}
    $bytes=[Text.UTF8Encoding]::new($false).GetBytes(($record|ConvertTo-Json -Compress)+[Environment]::NewLine)
    $f=[IO.FileStream]::new($path,[IO.FileMode]::Append,[IO.FileAccess]::Write,[IO.FileShare]::Read)
    try{$f.Write($bytes,0,$bytes.Length);$f.Flush($true)}finally{$f.Dispose()}
}
function Assert-OrdinaryParents([string]$path) {
    $cursor=[IO.Path]::GetFullPath($path)
    while($true) {
        if(-not [IO.Directory]::Exists($cursor)){Reject 'DIRECTORY_MISSING'}
        $item=Get-Item -LiteralPath $cursor -Force
        if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){Reject 'DIRECTORY_REPARSE'}
        $parent=[IO.Directory]::GetParent($cursor)
        if($null -eq $parent){break}
        $cursor=$parent.FullName
    }
}
function Assert-Quiescent {
    # Read CommandLine only to classify suspicious GUI producers; never serialize it.
    $procs=@(Get-CimInstance Win32_Process -Property ProcessId,Name,CommandLine,SessionId -ErrorAction Stop)
    if($procs.Count -lt 1 -or $procs.Count -gt 5000){Reject 'PROCESS_CENSUS_INCOMPLETE'}
    $candidates=0
    $unknown=0
    foreach($p in $procs){
        if([int]$p.ProcessId -eq $PID){continue}
        $name=[string]$p.Name
        $scriptHost=($name -match '^(node|nodejs|powershell|pwsh|cmd|dotnet)\.exe$')
        if($scriptHost -and [string]::IsNullOrWhiteSpace([string]$p.CommandLine)){$unknown++;continue}
        if($name -match '^(ChatInputProbe|DesktopProbe|ChatInputProbeWatchdog|DesktopProbeWatchdog|winapp|WinAppCli|winapp-cli)\.exe$' -or
           ($scriptHost -and [string]$p.CommandLine -match '(?i)(chatinput-probe|desktop-probe-act|physical-rift-reloadui)\.(mjs|ps1)')){
            $candidates++
        }
    }
    $tasks=@(Get-ScheduledTask -ErrorAction Stop)
    if($tasks.Count -gt 5000){Reject 'TASK_CENSUS_INCOMPLETE'}
    $launchers=0
    foreach($t in $tasks){
        if([string]$t.State -eq 'Disabled'){continue}
        $candidate=([string]$t.TaskName -match '(?i)(chatinputprobe|DesktopProbe|GUI[-_]?Launcher)')
        foreach($a in @($t.Actions)){
            $exe='';$arguments=''
            if($null -ne $a){
                $ep=$a.PSObject.Properties['Execute'];$ap=$a.PSObject.Properties['Arguments']
                if($null -ne $ep){$exe=[string]$ep.Value}
                if($null -ne $ap){$arguments=[string]$ap.Value}
            }
            if($exe -match '(?i)(ChatInputProbe|DesktopProbe)(Watchdog)?\.exe$' -or
               $arguments -match '(?i)(ChatInputProbe|DesktopProbe)(Watchdog)?'){$candidate=$true}
        }
        if($candidate){$launchers++}
    }
    if($candidates -ne 0){Reject ('GUI_PRODUCER_PRESENT_'+$candidates)}
    if($launchers -ne 0){Reject ('GUI_LAUNCHER_PRESENT_'+$launchers)}
    if($unknown -ne 0){Reject ('UNINSPECTABLE_SCRIPT_HOST_'+$unknown)}
    if($null -ne (Get-CimInstance Win32_Process -Filter ('ProcessId='+$ExpectedOwnerPid) -ErrorAction Stop)){
        Reject 'ORIGINAL_GUI_LEASE_OWNER_STILL_PRESENT'
    }
    if($null -ne (Get-CimInstance Win32_Process -Filter ('ProcessId='+$ExpectedTargetPid) -ErrorAction Stop)){
        Reject 'DISPOSABLE_GUI_TARGET_STILL_PRESENT'
    }
}
if($ExpectedLockSha256 -cnotmatch '^[0-9a-fA-F]{64}$'){Reject 'INVALID_LOCK_HASH'}
if($ExpectedLeaseId -cnotmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'){Reject 'INVALID_LEASE'}
if($ExpectedRequestId -cnotmatch '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$' -or
   $OperationId -cnotmatch '^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$'){Reject 'INVALID_REQUEST_OR_OPERATION'}
if($ExpectedOwnerPid -lt 1 -or $ExpectedTargetPid -lt 1 -or $ExpectedTargetHwnd -lt 1){Reject 'INVALID_PROCESS_OR_WINDOW'}
$root=[IO.Path]::GetFullPath($EvidenceRoot)
$repo=[IO.Path]::GetFullPath([IO.Path]::Combine($PSScriptRoot,'..'))
$realRoot=[IO.Path]::Combine($repo,'.tools','desktop-evidence')
$fixturePrefix=[IO.Path]::Combine([IO.Path]::GetFullPath([IO.Path]::GetTempPath()),'wb-stale-lock-fixture-')
if($SyntheticFixture){
    if(-not $root.StartsWith($fixturePrefix,[StringComparison]::OrdinalIgnoreCase)){Reject 'FIXTURE_ROOT_INVALID'}
}else{
    if(-not $root.Equals($realRoot,[StringComparison]::OrdinalIgnoreCase)){Reject 'UNEXPECTED_EVIDENCE_ROOT'}
}
Assert-OrdinaryParents $root
# Load only the exact independently audited native implementation; any drift is a stop.
$source=[IO.Path]::Combine($PSScriptRoot,'Archive-DesktopQuarantine.ps1')
$sourceHash=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
if($sourceHash -cne '5b1860ed41887c408edba9d38eb6b580483db75d5f14e641bf4cf7ccbef8eca0'){Reject 'PINNED_NATIVE_SOURCE_CHANGED'}
$sourceText=[IO.File]::ReadAllText($source)
$m=[regex]::Match($sourceText,'(?s)\$win32\s*=\s*@''\r?\n(?<native>.*?)\r?\n''@')
if(-not $m.Success){Reject 'NATIVE_IMPLEMENTATION_NOT_FOUND'}
if(-not ('WorkbridgeArchiveWin32' -as [type])){Add-Type -TypeDefinition $m.Groups['native'].Value -ErrorAction Stop}
$guardPath=[IO.Path]::Combine($root,'desktop-input-turn.lock')
$admissionPath=[IO.Path]::Combine($root,'desktop-turn-admission.lock')
$archiveParent=[IO.Path]::Combine($root,'recovery-archives')
$archiveDir=[IO.Path]::Combine($archiveParent,$OperationId)
$expected=$ExpectedLockSha256.ToLowerInvariant()
$maintenance=$null
$lock=$null
$journal=$null
try {
    if($Execute){
        $stamp=([ordered]@{schemaVersion=1;kind='workbridge.gui-admission';
            admissionId=[Guid]::NewGuid().ToString('D');mode='maintenance';
            producer='desktop-maintenance';requestId=$OperationId;
            owner=@{pid=$PID};acquiredUtc=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json -Depth 4 -Compress)
        $maintenance=[WorkbridgeArchiveWin32+Admission]::Acquire($admissionPath,$stamp)
    }else{
        if([IO.File]::Exists($admissionPath)){Reject 'SHARED_MAINTENANCE_ADMISSION_PRESENT'}
    }
    $lock=[WorkbridgeArchiveWin32+OpenFile]::OpenPinned($guardPath)
    if($lock.Sha256 -cne $expected){Reject 'LOCK_HASH_DRIFT'}
    $s=[Text.UTF8Encoding]::new($false,$true).GetString($lock.Bytes)|ConvertFrom-Json
    if($s.schemaVersion -ne 1 -or $s.kind -cne 'workbridge.gui-turn' -or
       $s.producer -cne 'chatinput-probe-test' -or
       $s.leaseId -cne $ExpectedLeaseId -or
       $s.requestId -cne $ExpectedRequestId -or
       [int]$s.owner.pid -ne $ExpectedOwnerPid -or
       $s.target.kind -cne 'window' -or $s.target.process -cne 'ChatInputProbe' -or
       [int]$s.target.pid -ne $ExpectedTargetPid -or
       [int64]$s.target.hwnd -ne $ExpectedTargetHwnd){
        Reject 'LOCK_IDENTITY_MISMATCH'
    }
    $sidecars=@(Get-ChildItem -LiteralPath $root -Filter 'desktop-turn-quarantine-*.json' -Force)
    if($sidecars.Count -ne 0){Reject 'QUARANTINE_SIDE_CAR_PRESENT'}
    Assert-Quiescent
    if(-not $Execute){
        [pscustomobject]@{ok=$true;mode='read-only';readyForManualReview=$true;
            guardSha256=$lock.Sha256;guardFileId=$lock.Identity;
            leaseId=$ExpectedLeaseId;requestId=$ExpectedRequestId;
            priorTestOutcome='first-enter-and-text-observed-third-enter-not-sent';
            newActionPerformed=$false;archiveCreated=$false}|ConvertTo-Json -Compress
        return
    }
    if(-not [IO.Directory]::Exists($archiveParent)){
        [WorkbridgeArchiveWin32]::CreateDirectoryExclusive($archiveParent)
    }else{Assert-OrdinaryParents $archiveParent}
    [WorkbridgeArchiveWin32]::CreateDirectoryExclusive($archiveDir)
    $backup=[IO.Path]::Combine($archiveDir,'backup')
    $relocated=[IO.Path]::Combine($archiveDir,'relocated')
    [WorkbridgeArchiveWin32]::CreateDirectoryExclusive($backup)
    [WorkbridgeArchiveWin32]::CreateDirectoryExclusive($relocated)
    $journal=[IO.Path]::Combine($archiveDir,'journal.jsonl')
    Write-Journal $journal 'maintenance-admission-held' $OperationId
    $backupGuard=[IO.Path]::Combine($backup,'desktop-input-turn.lock')
    Write-NewBytes $backupGuard $lock.Bytes
    if((Hash ([IO.File]::ReadAllBytes($backupGuard))) -cne $expected){Reject 'BACKUP_HASH_MISMATCH'}
    Write-Journal $journal 'guard-backup-durable'
    $manifest=[ordered]@{schemaVersion=1;kind='workbridge.gui-turn-lock-only-manual-archive';
        operationId=$OperationId;approvalScope='operator-authorized-disposable-test-lock';
        createdUtc=[DateTime]::UtcNow.ToString('o');
        leaseId=$ExpectedLeaseId;requestId=$ExpectedRequestId;
        priorTestOutcome='first-enter-and-text-observed-third-enter-not-sent';
        historicalTreeSettled='post-watchdog-census-observed';
        automaticRetryAllowed=$false;newActionPerformed=$false;
        guard=@{sha256=$expected;length=$lock.Bytes.Length;fileId=$lock.Identity;name='desktop-input-turn.lock'}}
    Write-NewBytes ([IO.Path]::Combine($archiveDir,'manifest.json')) ([Text.UTF8Encoding]::new($false).GetBytes(($manifest|ConvertTo-Json -Depth 7)+[Environment]::NewLine))
    Write-Journal $journal 'manifest-durable'
    Assert-Quiescent
    $dest=[IO.Path]::Combine($relocated,'desktop-input-turn.lock')
    $lock.RenameNoReplace($dest)
    Write-Journal $journal 'guard-relocated-commit'
    if(-not [WorkbridgeArchiveWin32]::DefinitelyAbsent($guardPath) -or
       $lock.FreshIdentity() -cne $lock.Identity){Reject 'ORIGINAL_NAME_OR_FILE_ID_MISMATCH'}
    $lock.Dispose();$lock=$null
    $verified=[WorkbridgeArchiveWin32+OpenFile]::OpenPinned($dest)
    try{
        if($verified.Sha256 -cne $expected -or $verified.Identity -cne $manifest.guard.fileId){Reject 'RELOCATED_GUARD_MISMATCH'}
    }finally{$verified.Dispose()}
    if(@(Get-ChildItem -LiteralPath $root -Filter 'desktop-turn-quarantine-*.json' -Force).Count -ne 0){Reject 'NEW_QUARANTINE_SIDECAR'}
    Write-NewBytes ([IO.Path]::Combine($archiveDir,'completed.json')) ([Text.UTF8Encoding]::new($false).GetBytes((@{
        operationId=$OperationId;completedUtc=[DateTime]::UtcNow.ToString('o');
        newActionPerformed=$false;priorTestOutcome='first-enter-and-text-observed-third-enter-not-sent'
    }|ConvertTo-Json -Compress)+[Environment]::NewLine))
    Write-Journal $journal 'postchecks-completed'
    Assert-Quiescent
    if(-not [WorkbridgeArchiveWin32]::DefinitelyAbsent($guardPath)){Reject 'ORIGINAL_GUARD_REAPPEARED'}
    $maintenance.ReleaseOwned()
    [pscustomobject]@{ok=$true;mode='archived';archive=$archiveDir;guardSha256=$expected;
        newActionPerformed=$false}|ConvertTo-Json -Compress
}catch{
    if($null -ne $journal){try{Write-Journal $journal 'failed-manual-reconciliation' $_.Exception.Message}catch{}}
    throw
}finally{
    if($null -ne $lock){$lock.Dispose()}
    if($null -ne $maintenance){$maintenance.Dispose()}
}
