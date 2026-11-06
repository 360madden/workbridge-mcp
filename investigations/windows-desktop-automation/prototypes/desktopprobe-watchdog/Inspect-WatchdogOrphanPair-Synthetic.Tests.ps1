#requires -Version 5.1
<#
INVESTIGATION-ONLY offline fixture contract tests for Inspect-WatchdogOrphanPair.ps1.
Creates exclusively OS-temp GUID roots, invokes only -SyntheticFixture (or
hard-disabled -Execute), and NEVER reads live desktop evidence or GUI process data.
No live locks, GUI/COM/input, VM/RIFT, service, Task Scheduler or archive actions.
On any failure, retain private fixture roots for independent review.
#>
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$repo=[IO.Path]::GetFullPath([IO.Path]::Combine($PSScriptRoot,'..','..','..','..'))
$inspector=[IO.Path]::Combine($PSScriptRoot,'Inspect-WatchdogOrphanPair.ps1')
$source=[IO.Path]::Combine($repo,'scripts','Archive-DesktopQuarantine.ps1')
$sourceSha='5b1860ed41887c408edba9d38eb6b580483db75d5f14e641bf4cf7ccbef8eca0'
if((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -cne $sourceSha){
    throw 'PINNED_NATIVE_SOURCE_CHANGED'
}
if(-not [IO.File]::Exists($inspector)){throw 'INSPECTOR_SOURCE_MISSING'}
$inspectorSourceSha='2703a06c062936cba47456515af316f35c1b28c85c7cee49d1ebaca08a3cc703'
if((Get-FileHash -LiteralPath $inspector -Algorithm SHA256).Hash.ToLowerInvariant() -cne $inspectorSourceSha){
    throw 'INSPECTOR_SOURCE_HASH_CHANGED'
}
if('WorkbridgeArchiveWin32' -as [type]){throw 'NATIVE_TYPE_PRELOADED'}
$archiveText=[IO.File]::ReadAllText($source)
$m=[regex]::Match($archiveText,'(?s)\$win32\s*=\s*@''\r?\n(?<native>.*?)\r?\n''@')
if(-not $m.Success){throw 'PINNED_NATIVE_SOURCE_PARSE_FAILED'}
Add-Type -TypeDefinition $m.Groups['native'].Value -ErrorAction Stop
$osTemp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
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
if($unsafeTemp){throw 'SYNTHETIC_TEMP_ROOT_UNSAFE'}
if([IO.DriveInfo]::new([IO.Path]::GetPathRoot($osTemp)).DriveFormat -cne 'NTFS'){
    throw 'SYNTHETIC_TEST_REQUIRES_OS_TEMP_NTFS'
}
$walk=$osTemp
while($true){
    if(([IO.File]::GetAttributes($walk) -band [IO.FileAttributes]::ReparsePoint) -ne 0){
        throw 'OS_TEMP_PARENT_REPARSE'
    }
    $up=[IO.Directory]::GetParent($walk)
    if($null -eq $up){break}
    $walk=$up.FullName
}
$ownerPid=9940001
$ownerTicks='638663831240000000'
$ownerSession=2
$runPrefix='orphan'
$roots=New-Object System.Collections.Generic.List[string]
$passes=New-Object System.Collections.Generic.List[string]
$testClock=[Diagnostics.Stopwatch]::StartNew()
$testExe=[IO.Path]::Combine($PSHOME,'powershell.exe')
if(-not [IO.File]::Exists($testExe)){throw 'FRESH_POWERSHELL_EXE_MISSING'}
function Assert([bool]$passed,[string]$reason){if(-not $passed){throw $reason}}
function NewBytes([string]$file,[byte[]]$bytes){
    $s=[IO.FileStream]::new($file,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
    try{$s.Write($bytes,0,$bytes.Length);$s.Flush($true)}finally{$s.Dispose()}
}
function NewUtf8([string]$file,[string]$value){
    NewBytes $file ([Text.UTF8Encoding]::new($false).GetBytes($value))
}
function Fixture([string]$variant){
    $id=[Guid]::NewGuid().ToString('N')
    $root=[IO.Path]::Combine($osTemp,'wb-orphan-recovery-fixture-'+$id)
    [WorkbridgeArchiveWin32]::CreateDirectoryExclusive($root)
    $script:roots.Add($root)
    Assert ($root.StartsWith(($osTemp+'\wb-orphan-recovery-fixture-'),
        [StringComparison]::OrdinalIgnoreCase)) 'FIXTURE_OUTSIDE_OS_TEMP'
    Assert (-not $root.Contains('\.tools\')) 'LIVE_GUARD_DIRECTORY_FORBIDDEN'
    $runId=$runPrefix+$id.Substring(0,12)
    $lease=[Guid]::NewGuid().ToString('D')
    $admission=[IO.Path]::Combine($root,'desktop-turn-admission.lock')
    $guard=[IO.Path]::Combine($root,'desktop-input-turn.lock')
    $journal=[IO.Path]::Combine($root,'watchdog-'+$runId+'.jsonl')
    $census=[IO.Path]::Combine($root,'census.json')
    $aStamp=([ordered]@{schemaVersion=1;kind='workbridge.gui-admission'
        admissionId=[Guid]::NewGuid().ToString('D');mode='producer'
        producer='desktopprobe-watchdog';requestId=$runId
        owner=@{pid=$ownerPid};acquiredUtc=[DateTime]::UtcNow.ToString('o')
    }|ConvertTo-Json -Depth 5 -Compress)
    $producer=if($variant -ceq 'foreign_producer'){'foreign-producer'}else{'desktopprobe-watchdog'}
    $gStamp=([ordered]@{schemaVersion=1;kind='workbridge.gui-turn'
        producer=$producer;runId=$runId;requestId=$runId;leaseId=$lease
        owner=@{pid=$ownerPid;processStartUtcTicks=$ownerTicks;sessionId=$ownerSession}
        target=@{kind='window';pid=$null;hwnd=$null;process='DesktopProbe'}
        acquiredUtc=[DateTime]::UtcNow.ToString('o');synthetic=$false
    }|ConvertTo-Json -Depth 6 -Compress)
    $owner=[WorkbridgeArchiveWin32+Admission]::Acquire($admission,$aStamp)
    try{
        $turn=[WorkbridgeArchiveWin32+Admission]::Acquire($guard,$gStamp)
        try{}finally{$turn.Dispose()}
    }finally{$owner.Dispose()}
    $lines=@(
        ([ordered]@{schemaVersion=1;stage='intent';runId=$runId;synthetic=$false}|ConvertTo-Json -Compress),
        ([ordered]@{schemaVersion=1;stage='turn-acquired';runId=$runId;leaseId=$lease}|ConvertTo-Json -Compress),
        ([ordered]@{schemaVersion=1;stage='child-started';childPid=9940002}|ConvertTo-Json -Compress)
    ) -join [Environment]::NewLine
    NewUtf8 $journal ($lines+[Environment]::NewLine)
    $mock=[ordered]@{schemaVersion=1;synthetic=$true;ownerAlive=($variant -ceq 'owner_alive')
        knownChildAlive=($variant -ceq 'child_alive')
        descendantAlive=($variant -ceq 'descendant_alive')
        launcherEnabled=($variant -ceq 'enabled_launcher')
        unknownScriptHost=$false;uncoveredProducer=$false
    }
    NewUtf8 $census (($mock|ConvertTo-Json -Compress)+[Environment]::NewLine)
    if($variant -ceq 'admission_only'){[IO.File]::Delete($guard)}
    if($variant -ceq 'guard_only'){[IO.File]::Delete($admission)}
    if($variant -ceq 'sidecar_present'){
        NewUtf8 ([IO.Path]::Combine($root,'desktop-turn-quarantine-'+$runId+'.json')) '{"synthetic":true}'
    }
    $aHash=if([IO.File]::Exists($admission)){
        (Get-FileHash -LiteralPath $admission -Algorithm SHA256).Hash.ToLowerInvariant()
    }else{'0'*64}
    $gHash=if([IO.File]::Exists($guard)){
        (Get-FileHash -LiteralPath $guard -Algorithm SHA256).Hash.ToLowerInvariant()
    }else{'0'*64}
    $aId='0'*16+':'+('0'*32)
    $gId=$aId
    if([IO.File]::Exists($admission)){
        $ap=[WorkbridgeArchiveWin32+OpenFile]::OpenPinned($admission)
        try{$aId=$ap.Identity}finally{$ap.Dispose()}
    }
    if([IO.File]::Exists($guard)){
        $gp=[WorkbridgeArchiveWin32+OpenFile]::OpenPinned($guard)
        try{$gId=$gp.Identity}finally{$gp.Dispose()}
    }
    $journalHash=(Get-FileHash -LiteralPath $journal -Algorithm SHA256).Hash.ToLowerInvariant()
    return [pscustomobject]@{Root=$root;RunId=$runId;Lease=$lease;Admission=$admission
        Guard=$guard;Journal=$journal;AdmissionSha=$aHash;GuardSha=$gHash
        AdmissionId=$aId;GuardId=$gId;JournalSha=$journalHash;Variant=$variant}
}
function RunClassifier($fixture,[bool]$execute){
    # Re-pin exact reviewed source before EACH fresh child launch.
    if((Get-FileHash -LiteralPath $inspector -Algorithm SHA256).Hash.ToLowerInvariant() -cne $inspectorSourceSha){
        throw 'INSPECTOR_SOURCE_HASH_CHANGED_BEFORE_CHILD'
    }
    $args=@('-NoProfile','-NonInteractive','-File',$inspector,
        '-EvidenceRoot',$fixture.Root,'-ExpectedRunId',$fixture.RunId,
        '-ExpectedLeaseId',$fixture.Lease,'-ExpectedAdmissionSha256',$fixture.AdmissionSha,
        '-ExpectedGuardSha256',$fixture.GuardSha,'-ExpectedAdmissionFileId',$fixture.AdmissionId,
        '-ExpectedGuardFileId',$fixture.GuardId,'-ExpectedOwnerPid',[string]$ownerPid,
        '-ExpectedOwnerStartUtcTicks',$ownerTicks,'-ExpectedOwnerSessionId',[string]$ownerSession,
        '-ExpectedJournalSha256',$fixture.JournalSha,
        '-OperationId',('inspector_'+$fixture.RunId),'-SyntheticFixture')
    if($execute){$args+=,'-Execute'}
    foreach($arg in $args){if($arg.Contains([char]34)){throw 'CHILD_ARG_QUOTE_REJECTED'}}
    $psi=[Diagnostics.ProcessStartInfo]::new()
    $psi.FileName=$testExe
    $psi.Arguments=($args|ForEach-Object{'"'+$_+'"'}) -join ' '
    $psi.UseShellExecute=$false
    $psi.CreateNoWindow=$true
    $psi.RedirectStandardOutput=$true
    $psi.RedirectStandardError=$true
    $p=[Diagnostics.Process]::new()
    try{
        $p.StartInfo=$psi
        if(-not $p.Start()){throw 'CHILD_PROCESS_START_FAILED'}
        $childPid=$p.Id
        $outTask=$p.StandardOutput.ReadToEndAsync()
        $errTask=$p.StandardError.ReadToEndAsync()
        if(-not $p.WaitForExit(4500)){
            $p.Kill()
            if(-not $p.WaitForExit(1500)){throw ('SYNTHETIC_CHILD_UNSETTLED_PID_'+$childPid)}
            throw ('SYNTHETIC_CHILD_TIMEOUT_PID_'+$childPid)
        }
        $p.WaitForExit()
        return [pscustomobject]@{ExitCode=$p.ExitCode;Stdout=$outTask.GetAwaiter().GetResult()
            Stderr=$errTask.GetAwaiter().GetResult();Pid=$childPid}
    }finally{$p.Dispose()}
}
function Case([string]$name,[string]$variant,[string]$expectedFailure,[bool]$execute){
    if($testClock.ElapsedMilliseconds -gt 55000){throw 'SYNTHETIC_GLOBAL_DEADLINE_EXCEEDED'}
    $f=Fixture $variant
    $aBefore=if([IO.File]::Exists($f.Admission)) {
        (Get-FileHash -LiteralPath $f.Admission -Algorithm SHA256).Hash.ToLowerInvariant()
    }else{$null}
    $gBefore=if([IO.File]::Exists($f.Guard)){
        (Get-FileHash -LiteralPath $f.Guard -Algorithm SHA256).Hash.ToLowerInvariant()
    }else{$null}
    if($variant -ceq 'sha_drift'){$f.AdmissionSha=('f'*64)}
    if($variant -ceq 'dashed_fileid'){
        # Negative compatibility regression: the native helper emits compact
        # 32-character FILE_ID; a visually similar dashed string must REFUSE.
        $parts=$f.AdmissionId.Split(':')
        $bytes=@()
        for($bi=0;$bi -lt 32;$bi+=2){$bytes+=,$parts[1].Substring($bi,2)}
        $f.AdmissionId=$parts[0]+':'+($bytes -join '-')
    }
    $result=RunClassifier $f $execute
    if([string]::IsNullOrEmpty($expectedFailure)){
        Assert ($result.ExitCode -eq 0) ('EXPECTED_PASS_EXIT_FAILED_'+$name+'_EXIT_'+$result.ExitCode+'_'+$result.Stderr)
        $body=$result.Stdout.Trim()|ConvertFrom-Json
        Assert ($body.ok -eq $true -and $body.readyForManualReview -eq $true) ('EXPECTED_READONLY_SUCCESS_'+$name)
        Assert ($body.releaseEligible -eq $false -and $body.executeEnabled -eq $false -and
            $body.archiveCreated -eq $false -and $body.newActionPerformed -eq $false) 'UNSAFE_RELEASABLE_SUCCESS_CLAIM'
        Assert ($body.priorActionOutcome -ceq 'unknown_outcome' -and
            $body.historicalTreeSettled -ceq 'unverified') 'UNVERIFIED_HISTORY_MISLABELED'
        Assert ($body.admissionFileId -ceq $f.AdmissionId -and
            $body.guardFileId -ceq $f.GuardId) 'NATIVE_ID_BINDING_MISMATCH'
    }else{
        Assert ($result.ExitCode -ne 0) ('EXPECTED_REFUSAL_WENT_GREEN_'+$name)
        Assert ($result.Stderr.Contains($expectedFailure)) ('UNEXPECTED_REFUSAL_'+$name+'_EXIT_'+$result.ExitCode+'_'+$result.Stderr)
        Assert (-not $result.Stdout.Contains('"readyForManualReview":true')) 'REFUSAL_CLAIMED_READINESS'
    }
    $aAfter=if([IO.File]::Exists($f.Admission)){
        (Get-FileHash -LiteralPath $f.Admission -Algorithm SHA256).Hash.ToLowerInvariant()
    }else{$null}
    $gAfter=if([IO.File]::Exists($f.Guard)){
        (Get-FileHash -LiteralPath $f.Guard -Algorithm SHA256).Hash.ToLowerInvariant()
    }else{$null}
    Assert (($aBefore -ceq $aAfter) -and ($gBefore -ceq $gAfter)) ('SOURCE_BYTES_MUTATED_'+$name)
    Assert (-not [IO.Directory]::Exists([IO.Path]::Combine($f.Root,'recovery-archives'))) 'ARCHIVE_CREATED'
    $script:passes.Add($name)
}
Case 'I01_exact_pair_classified_review_only' 'valid' '' $false
Case 'I02_missing_guard_admission_only_rejected' 'admission_only' 'ORPHAN_PAIR_INCOMPLETE' $false
Case 'I03_missing_admission_guard_only_rejected' 'guard_only' 'ORPHAN_PAIR_INCOMPLETE' $false
Case 'I04_expected_sha_drift_rejected' 'sha_drift' 'PINNED_BYTES_OR_NATIVE_FILE_ID_DRIFT' $false
Case 'I05_owner_alive_rejected' 'owner_alive' 'WATCHDOG_OWNER_PID_PRESENT_OR_REUSED' $false
Case 'I06_known_child_alive_rejected' 'child_alive' 'KNOWN_CHILD_PID_PRESENT_OR_REUSED' $false
Case 'I07_sidecar_present_rejected' 'sidecar_present' 'SIDECAR_PRESENT_REQUIRES_SEPARATE_PROTOCOL' $false
Case 'I08_foreign_producer_rejected' 'foreign_producer' 'ORPHAN_ADMISSION_GUARD_SCHEMA_OR_OWNER_CONFLICT' $false
Case 'I09_enabled_launcher_rejected' 'enabled_launcher' 'ENABLED_GUI_LAUNCH_TASK_PRESENT' $false
Case 'I10_descendant_alive_rejected' 'descendant_alive' 'POSSIBLE_WATCHDOG_DESCENDANT_STILL_PRESENT' $false
Case 'I11_execute_flag_always_disabled' 'valid' 'EXECUTE_DISABLED_PENDING_WB001_INDEPENDENT_REVIEW' $true
Case 'I12_dashed_native_file_id_rejected' 'dashed_fileid' 'EXPECTED_NATIVE_FILE_ID_INVALID' $false
# Cleanup only exact uniquely owned OS-temp roots after ALL cases pass.
$cleaned=0
foreach($root in $roots){
    Assert ($root.StartsWith(($osTemp+'\wb-orphan-recovery-fixture-'),
        [StringComparison]::OrdinalIgnoreCase)) 'CLEANUP_UNOWNED_PATH'
    Assert (-not $root.Contains('\.tools\')) 'CLEANUP_LIVE_PATH_FORBIDDEN'
    Assert (([IO.File]::GetAttributes($root) -band [IO.FileAttributes]::ReparsePoint) -eq 0) 'CLEANUP_REPARSE_REFUSED'
    [IO.Directory]::Delete($root,$true)
    Assert (-not [IO.Directory]::Exists($root)) 'CLEANUP_NOT_COMPLETE'
    $cleaned++
}
[pscustomobject]@{
    schemaVersion=1;synthetic=$true;passed=$passes.Count;failed=0;cases=@($passes)
    runtimeMs=$testClock.ElapsedMilliseconds;syntheticGlobalDeadlineMs=65000
    fixtureCount=$roots.Count;cleanedFixtureCount=$cleaned
    executeDisabled=$true;liveLocksRead=$false;liveLocksModified=$false
    guiLaunched=$false;vmTouched=$false;serviceTouched=$false
    priorActionOutcome='unknown_outcome';archiveSourceSha256=$sourceSha
}|ConvertTo-Json -Compress -Depth 5
