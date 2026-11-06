#requires -Version 5.1
<#
  INVESTIGATION-ONLY read-only classifier for one exact DesktopProbeWatchdog
  admission+GUI orphan pair with NO quarantine sidecar.
  -Execute is intentionally DISABLED. This tool NEVER archives or moves real locks.
  No GUI/COM/input/task/service/VM/RIFT changes; no PID/age-based release.
  Native FileIdInfo and identity-pinned file reads reuse exact SHA-guarded
  C# code extracted (not executed) from Archive-DesktopQuarantine.ps1.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$EvidenceRoot,
    [Parameter(Mandatory=$true)][string]$ExpectedRunId,
    [Parameter(Mandatory=$true)][string]$ExpectedLeaseId,
    [Parameter(Mandatory=$true)][string]$ExpectedAdmissionSha256,
    [Parameter(Mandatory=$true)][string]$ExpectedGuardSha256,
    [Parameter(Mandatory=$true)][string]$ExpectedAdmissionFileId,
    [Parameter(Mandatory=$true)][string]$ExpectedGuardFileId,
    [Parameter(Mandatory=$true)][int]$ExpectedOwnerPid,
    [Parameter(Mandatory=$true)][string]$ExpectedOwnerStartUtcTicks,
    [Parameter(Mandatory=$true)][int]$ExpectedOwnerSessionId,
    [Parameter(Mandatory=$true)][string]$ExpectedJournalSha256,
    [Parameter(Mandatory=$true)][string]$OperationId,
    [switch]$SyntheticFixture,
    [switch]$Execute
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
function Refuse([string]$code){throw [InvalidOperationException]::new($code)}
if($Execute){Refuse 'EXECUTE_DISABLED_PENDING_WB001_INDEPENDENT_REVIEW'}
if($ExpectedRunId -cnotmatch '^[a-z0-9][a-z0-9-]{6,38}[a-z0-9]$' -or
   $OperationId -cnotmatch '^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$'){Refuse 'RUN_ID_OR_OPERATION_INVALID'}
if($ExpectedLeaseId -cnotmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'){
    Refuse 'LEASE_ID_INVALID'
}
foreach($h in @($ExpectedAdmissionSha256,$ExpectedGuardSha256,$ExpectedJournalSha256)){
    if($h -cnotmatch '^[0-9a-f]{64}$'){Refuse 'EXPECTED_HASH_INVALID'}
}
foreach($id in @($ExpectedAdmissionFileId,$ExpectedGuardFileId)){
    if($id -cnotmatch '^[0-9a-f]{16}:[0-9A-F]{32}\z'){Refuse 'EXPECTED_NATIVE_FILE_ID_INVALID'}
}
if($ExpectedOwnerPid -le 0 -or $ExpectedOwnerSessionId -le 0 -or
   $ExpectedOwnerStartUtcTicks -cnotmatch '^[0-9]{15,19}$'){Refuse 'EXPECTED_OWNER_IDENTITY_INVALID'}

$repo=[IO.Path]::GetFullPath([IO.Path]::Combine($PSScriptRoot,'..','..','..','..'))
$realEvidence=[IO.Path]::Combine($repo,'.tools','desktop-evidence')
$osTemp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
if($SyntheticFixture){
$workParent=[IO.Directory]::GetParent($repo).FullName.TrimEnd('\')
$normalizedTemp=$osTemp.Replace('/','\').TrimEnd('\')
$unsafeTempSegments=@('\.tools\','\.local\','\workbridge-mcp\','\rift modding\','\OneDrive\','\VMs\','\RIFT\')
$unsafeTemp=$normalizedTemp.Equals($workParent,[StringComparison]::OrdinalIgnoreCase) -or
    $normalizedTemp.StartsWith(($workParent+'\'),[StringComparison]::OrdinalIgnoreCase) -or
    $normalizedTemp.Equals([IO.Path]::GetPathRoot($normalizedTemp).TrimEnd('\'),
        [StringComparison]::OrdinalIgnoreCase) -or
    $normalizedTemp.StartsWith('\\',[StringComparison]::Ordinal)
foreach($segment in $unsafeTempSegments){
    if($normalizedTemp.IndexOf($segment,[StringComparison]::OrdinalIgnoreCase) -ge 0){
        $unsafeTemp=$true
    }
}
    if($unsafeTemp){Refuse 'SYNTHETIC_TEMP_ROOT_UNSAFE'}
}
$root=[IO.Path]::GetFullPath($EvidenceRoot).TrimEnd('\')
if($SyntheticFixture){
    # The synthetic path is never allowed to be the live Workbridge guard root.
    if(-not $root.StartsWith(($osTemp+'\wb-orphan-recovery-fixture-'),
        [StringComparison]::OrdinalIgnoreCase)){Refuse 'SYNTHETIC_ROOT_OUTSIDE_OS_TEMP'}
}else{
    if(-not $root.Equals($realEvidence,[StringComparison]::OrdinalIgnoreCase)){
        Refuse 'REAL_ROOT_MUST_BE_EXACT_WORKBRIDGE_GUI_EVIDENCE'
    }
}
function OrdinaryParents([string]$dir){
    $walker=$dir
    while($true){
        if(-not [IO.Directory]::Exists($walker)){Refuse 'PARENT_DIRECTORY_MISSING'}
        if(([IO.File]::GetAttributes($walker) -band [IO.FileAttributes]::ReparsePoint) -ne 0){
            Refuse 'PARENT_DIRECTORY_REPARSE'
        }
        $up=[IO.Directory]::GetParent($walker)
        if($null -eq $up){break}
        $walker=$up.FullName
    }
}
OrdinaryParents $root
if([IO.DriveInfo]::new([IO.Path]::GetPathRoot($root)).DriveFormat -cne 'NTFS'){
    Refuse 'NATIVE_RECOVERY_REQUIRES_NTFS'
}
$admissionPath=[IO.Path]::Combine($root,'desktop-turn-admission.lock')
$guardPath=[IO.Path]::Combine($root,'desktop-input-turn.lock')
$quarantine=@(Get-ChildItem -LiteralPath $root -Filter 'desktop-turn-quarantine-*.json' -Force -ErrorAction Stop)
if($quarantine.Count -ne 0){Refuse 'SIDECAR_PRESENT_REQUIRES_SEPARATE_PROTOCOL'}
if(-not [IO.File]::Exists($admissionPath) -or -not [IO.File]::Exists($guardPath)){
    Refuse 'ORPHAN_PAIR_INCOMPLETE_ADMISSION_ONLY_OR_GUARD_ONLY_NOT_SUPPORTED'
}
$journalPath=if($SyntheticFixture){
    [IO.Path]::Combine($root,'watchdog-'+$ExpectedRunId+'.jsonl')
}else{
    [IO.Path]::Combine($repo,'investigations','windows-desktop-automation','temp',
        'desktopprobe-'+$ExpectedRunId,'evidence','watchdog-'+$ExpectedRunId+'.jsonl')
}
OrdinaryParents ([IO.Path]::GetDirectoryName($journalPath))
$journalFile=Get-Item -LiteralPath $journalPath -Force -ErrorAction Stop
if($journalFile.PSIsContainer -or
   ($journalFile.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
   $journalFile.Length -lt 2 -or $journalFile.Length -gt 1048576){Refuse 'JOURNAL_NOT_ORDINARY_BOUNDED'}
$journalBytes=[IO.File]::ReadAllBytes($journalPath)
$sha=[Security.Cryptography.SHA256]::Create()
try{$journalSha=[BitConverter]::ToString($sha.ComputeHash($journalBytes)).Replace('-','').ToLowerInvariant()}
finally{$sha.Dispose()}
if($journalSha -cne $ExpectedJournalSha256){Refuse 'JOURNAL_SHA_CHANGED'}
# Process census BEFORE native guard pinning; repeat later to narrow time drift.
function Census([int]$ownerPid,[int[]]$knownChildren) {
    # Synthetic census is allowed only under a uniquely named OS-temp fixture;
    # real canonical Workbridge evidence ALWAYS invokes live read-only WMI/tasks.
    if($SyntheticFixture){
        $mockPath=[IO.Path]::Combine($root,'census.json')
        $mockFile=Get-Item -LiteralPath $mockPath -Force -ErrorAction Stop
        if($mockFile.PSIsContainer -or $mockFile.Length -lt 2 -or
           $mockFile.Length -gt 4096 -or
           ($mockFile.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){
            Refuse 'SYNTHETIC_CENSUS_NOT_ORDINARY'
        }
        $mock=[IO.File]::ReadAllText($mockPath)|ConvertFrom-Json
        if($mock.synthetic -cne $true -or $mock.schemaVersion -ne 1){Refuse 'SYNTHETIC_CENSUS_SCHEMA_INVALID'}
        if($mock.ownerAlive -eq $true){Refuse 'WATCHDOG_OWNER_PID_PRESENT_OR_REUSED'}
        if($mock.knownChildAlive -eq $true){Refuse 'KNOWN_CHILD_PID_PRESENT_OR_REUSED'}
        if($mock.descendantAlive -eq $true){Refuse 'POSSIBLE_WATCHDOG_DESCENDANT_STILL_PRESENT'}
        if($mock.launcherEnabled -eq $true){Refuse 'ENABLED_GUI_LAUNCH_TASK_PRESENT'}
        if($mock.unknownScriptHost -eq $true){Refuse 'UNINSPECTABLE_SCRIPT_HOST'}
        if($mock.uncoveredProducer -eq $true){Refuse 'POTENTIAL_GUI_PRODUCER_PROCESS_PRESENT'}
        return [pscustomobject]@{processCount=0;taskCount=0;guiProducerCount=0
            unknownScriptHosts=0;enabledGuiTaskCount=0;observedUtc=[DateTime]::UtcNow.ToString('o')}
    }
    $time=[DateTime]::UtcNow
    $procs=@(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,CommandLine,CreationDate,SessionId -ErrorAction Stop)
    if($procs.Count -lt 1 -or $procs.Count -gt 5000){Refuse 'PROCESS_CENSUS_INCOMPLETE'}
    $pids=@{};$risk=0;$unknown=0
    foreach($p in $procs){
        if($null -eq $p.ProcessId){Refuse 'PROCESS_ID_MISSING'}
        $id=[int]$p.ProcessId
        $name=[string]$p.Name
        # Only Win32_Process's known OS Idle sentinel may use PID 0.
        if($id -eq 0){
            if($name -notin @('System Idle Process','Idle')){Refuse 'PROCESS_ZERO_PID_UNEXPECTED_NAME'}
            continue
        }
        if($id -lt 0){Refuse 'PROCESS_ID_INVALID'}
        if($pids.ContainsKey($id)){Refuse 'PROCESS_CENSUS_DUPLICATE_PID'}
        $pids[$id]=$true
        if($id -eq $PID){continue}
        $scriptHost=$name -match '^(node|nodejs|powershell|pwsh|cmd|dotnet)\.exe$'
        if($scriptHost -and [string]::IsNullOrWhiteSpace([string]$p.CommandLine)){$unknown++;continue}
        if($name -match '^(DesktopProbeWatchdog|DesktopProbe|ChatInputProbeWatchdog|ChatInputProbe|Sbroenne\.WindowsMcp|wincli|winapp|WinAppCli|winapp-cli)\.exe$' -or
            ($scriptHost -and [string]$p.CommandLine -match '(?i)(desktop-(capture|probe-act|turn|ui)|vmware-host-capture|physical-rift-reloadui|chatinput-probe|Sbroenne|FlaUI-MCP)\.(mjs|ps1|exe)')){
            $risk++
        }
    }
    if($pids.ContainsKey($ownerPid)){Refuse 'WATCHDOG_OWNER_PID_PRESENT_OR_REUSED'}
    foreach($child in $knownChildren){
        if($pids.ContainsKey($child)){Refuse 'KNOWN_CHILD_PID_PRESENT_OR_REUSED'}
    }
    # A still-visible process whose reported parent descends from owner/known
    # child PIDs is a hard veto, even after the historical owner exited.
    # Missing parent chains remain UNKNOWN, never proof of old settlement.
    $ancestors=@{}
    $ancestors[$ownerPid]=$true
    foreach($child in $knownChildren){$ancestors[[int]$child]=$true}
    for($round=0;$round -lt 5;$round++){
        $changed=$false
        foreach($p in $procs){
            $parentPid=[int]$p.ParentProcessId
            $id=[int]$p.ProcessId
            if($ancestors.ContainsKey($parentPid) -and -not $ancestors.ContainsKey($id)){
                $ancestors[$id]=$true;$changed=$true
                Refuse 'POSSIBLE_WATCHDOG_DESCENDANT_STILL_PRESENT'
            }
        }
        if(-not $changed){break}
    }
    if($unknown -ne 0){Refuse 'UNINSPECTABLE_SCRIPT_HOST'}
    if($risk -ne 0){Refuse 'POTENTIAL_GUI_PRODUCER_PROCESS_PRESENT'}
    $tasks=@(Get-ScheduledTask -ErrorAction Stop)
    if($tasks.Count -gt 5000){Refuse 'TASK_CENSUS_INCOMPLETE'}
    $enabled=0
    foreach($t in $tasks){
        if([string]$t.State -eq 'Disabled'){continue}
        $match=[string]$t.TaskName -match '(?i)(DesktopProbe|ChatInputProbe|GUI[-_]?Launcher|WinApp|Sbroenne)'
        foreach($a in @($t.Actions)){
            if($null -eq $a){continue}
            $exeProp=$a.PSObject.Properties['Execute'];$argProp=$a.PSObject.Properties['Arguments']
            $exe=if($null -ne $exeProp){[string]$exeProp.Value}else{''}
            $args=if($null -ne $argProp){[string]$argProp.Value}else{''}
            if($exe -match '(?i)(DesktopProbe|ChatInputProbe|WinApp|Sbroenne)' -or
               $args -match '(?i)(desktop-capture|desktop-probe-act|vmware-host-capture|physical-rift-reloadui|DesktopProbe|ChatInputProbe|WinApp|Sbroenne)'){
                $match=$true
            }
        }
        if($match){$enabled++}
    }
    if($enabled -ne 0){Refuse 'ENABLED_GUI_LAUNCH_TASK_PRESENT'}
    if(([DateTime]::UtcNow-$time).TotalSeconds -gt 25){Refuse 'QUIESCENCE_CENSUS_STALE'}
    return [pscustomobject]@{processCount=$procs.Count;taskCount=$tasks.Count;guiProducerCount=$risk
        unknownScriptHosts=$unknown;enabledGuiTaskCount=$enabled;observedUtc=[DateTime]::UtcNow.ToString('o')}
}
# Only hash-pinned, source-extracted helper; do NOT execute its PowerShell body.
$archiveSource=[IO.Path]::Combine($repo,'scripts','Archive-DesktopQuarantine.ps1')
$archiveSha='5b1860ed41887c408edba9d38eb6b580483db75d5f14e641bf4cf7ccbef8eca0'
if((Get-FileHash -LiteralPath $archiveSource -Algorithm SHA256).Hash.ToLowerInvariant() -cne $archiveSha){
    Refuse 'PINNED_NATIVE_ARCHIVER_SOURCE_CHANGED'
}
if('WorkbridgeArchiveWin32' -as [type]){Refuse 'NATIVE_TYPE_ALREADY_LOADED'}
$text=[IO.File]::ReadAllText($archiveSource)
$match=[regex]::Match($text,'(?s)\$win32\s*=\s*@''\r?\n(?<native>.*?)\r?\n''@')
if(-not $match.Success){Refuse 'NATIVE_SOURCE_PARSE_FAILED'}
Add-Type -TypeDefinition $match.Groups['native'].Value -ErrorAction Stop
$adm=$null;$guard=$null
try{
    $adm=[WorkbridgeArchiveWin32+OpenFile]::OpenPinned($admissionPath)
    $guard=[WorkbridgeArchiveWin32+OpenFile]::OpenPinned($guardPath)
    if($adm.Sha256 -cne $ExpectedAdmissionSha256 -or
       $guard.Sha256 -cne $ExpectedGuardSha256 -or
       $adm.Identity -cne $ExpectedAdmissionFileId -or
       $guard.Identity -cne $ExpectedGuardFileId){Refuse 'PINNED_BYTES_OR_NATIVE_FILE_ID_DRIFT'}
    if($adm.Identity.Split(':')[0] -cne $guard.Identity.Split(':')[0]){
        Refuse 'ADMISSION_GUARD_DIFFERENT_VOLUME'
    }
    $a=[Text.UTF8Encoding]::new($false,$true).GetString($adm.Bytes)|ConvertFrom-Json
    $g=[Text.UTF8Encoding]::new($false,$true).GetString($guard.Bytes)|ConvertFrom-Json
    if($a.schemaVersion -ne 1 -or $a.kind -cne 'workbridge.gui-admission' -or
       $a.mode -cne 'producer' -or $a.producer -cne 'desktopprobe-watchdog' -or
       $a.requestId -cne $ExpectedRunId -or [int]$a.owner.pid -ne $ExpectedOwnerPid -or
       $g.schemaVersion -ne 1 -or $g.kind -cne 'workbridge.gui-turn' -or
       $g.producer -cne 'desktopprobe-watchdog' -or $g.synthetic -cne $false -or
       $g.runId -cne $ExpectedRunId -or $g.requestId -cne $ExpectedRunId -or
       $g.leaseId -cne $ExpectedLeaseId -or [int]$g.owner.pid -ne $ExpectedOwnerPid -or
       $g.owner.processStartUtcTicks -cne $ExpectedOwnerStartUtcTicks -or
       [int]$g.owner.sessionId -ne $ExpectedOwnerSessionId -or
       $g.target.kind -cne 'window' -or $g.target.process -cne 'DesktopProbe' -or
       $null -ne $g.target.pid -or $null -ne $g.target.hwnd){
        Refuse 'ORPHAN_ADMISSION_GUARD_SCHEMA_OR_OWNER_CONFLICT'
    }
    $records=@()
    foreach($line in ([Text.UTF8Encoding]::new($false,$true).GetString($journalBytes) -split '\r?\n')){
        if([string]::IsNullOrWhiteSpace($line)){continue}
        $row=$line|ConvertFrom-Json
        if($row.schemaVersion -ne 1){Refuse 'JOURNAL_ENTRY_SCHEMA_CONFLICT'}
        $runProperty=$row.PSObject.Properties['runId']
        if($null -ne $runProperty -and [string]$runProperty.Value -cne $ExpectedRunId){
            Refuse 'JOURNAL_ENTRY_IDENTITY_CONFLICT'
        }
        $records+=,$row
    }
    if($records.Count -lt 1 -or $records[0].stage -cne 'intent' -or
       $records[0].runId -cne $ExpectedRunId){Refuse 'JOURNAL_INTENT_MISSING_OR_WRONG_RUN'}
    $turns=@($records|Where-Object stage -eq 'turn-acquired')
    if($turns.Count -gt 1 -or ($turns.Count -eq 1 -and $turns[0].leaseId -cne $ExpectedLeaseId)){
        Refuse 'JOURNAL_TURN_IDENTITY_CONFLICT'
    }
    if(@($records|Where-Object stage -eq 'final').Count -ne 0){Refuse 'FINAL_JOURNAL_REQUIRES_SEPARATE_REVIEW'}
    $childPids=@($records|Where-Object stage -eq 'child-started'|ForEach-Object{[int]$_.childPid})
    if($childPids.Count -gt 1 -or @($childPids|Where-Object{$_ -le 0}).Count -gt 0){
        Refuse 'JOURNAL_CHILD_IDENTITY_CONFLICT'
    }
    $before=Census $ExpectedOwnerPid $childPids
    if($adm.FreshIdentity() -cne $ExpectedAdmissionFileId -or
       $guard.FreshIdentity() -cne $ExpectedGuardFileId){Refuse 'NATIVE_ID_DRIFT_DURING_CENSUS'}
    $after=Census $ExpectedOwnerPid $childPids
    # Exact identity and no known live producer support only OPERATOR REVIEW.
    # Historical unknown descendants and action delivery remain UNKNOWN; never
    # call this result archived, releaseEligible, or verified desktop success.
    [pscustomobject]@{
        schemaVersion=1;ok=$true;mode='read-only';shape='watchdog-admission-plus-gui-no-sidecar'
        readyForManualReview=$true;releaseEligible=$false;executeEnabled=$false;archiveCreated=$false
        priorActionOutcome='unknown_outcome';historicalTreeSettled='unverified'
        operationId=$OperationId;runId=$ExpectedRunId;leaseId=$ExpectedLeaseId
        admissionSha256=$adm.Sha256;admissionFileId=$adm.Identity
        guardSha256=$guard.Sha256;guardFileId=$guard.Identity
        journalSha256=$ExpectedJournalSha256;knownChildCount=$childPids.Count
        processCensusCount=$after.processCount;taskCensusCount=$after.taskCount
        guiProducerCount=$after.guiProducerCount;enabledGuiTaskCount=$after.enabledGuiTaskCount
        newActionPerformed=$false
    }|ConvertTo-Json -Compress -Depth 4
}finally{
    if($null -ne $guard){$guard.Dispose()}
    if($null -ne $adm){$adm.Dispose()}
}
