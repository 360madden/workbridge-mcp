#requires -Version 5.1
# SYNTHETIC ONLY: no parameters or external root; unique OS-temp NTFS fixtures.
# No GUI, VM, game, input, Task Scheduler, service, or live Workbridge locks.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$repo=[IO.Path]::GetFullPath([IO.Path]::Combine($PSScriptRoot,'..','..','..','..'))
$source=[IO.Path]::Combine($repo,'scripts','Archive-DesktopQuarantine.ps1')
$sourceHash='5b1860ed41887c408edba9d38eb6b580483db75d5f14e641bf4cf7ccbef8eca0'
if((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -cne $sourceHash){
    throw 'PINNED_NATIVE_SOURCE_CHANGED'
}
$sourceText=[IO.File]::ReadAllText($source)
$m=[regex]::Match($sourceText,'(?s)\$win32\s*=\s*@''\r?\n(?<native>.*?)\r?\n''@')
if(-not $m.Success){throw 'PINNED_NATIVE_IMPLEMENTATION_NOT_FOUND'}
if('WorkbridgeArchiveWin32' -as [type]){throw 'NATIVE_TYPE_PRELOADED_IN_PROCESS'}
Add-Type -TypeDefinition $m.Groups['native'].Value -ErrorAction Stop
$osTemp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$volume=[IO.DriveInfo]::new([IO.Path]::GetPathRoot($osTemp))
if($volume.DriveFormat -cne 'NTFS'){throw 'NATIVE_TEST_REQUIRES_NTFS'}
$walk=$osTemp
while($true){
    if(([IO.File]::GetAttributes($walk) -band [IO.FileAttributes]::ReparsePoint) -ne 0){
        throw 'OS_TEMP_ANCESTOR_REPARSE_POINT_REFUSED'
    }
    $higher=[IO.Directory]::GetParent($walk)
    if($null -eq $higher){break}
    $walk=$higher.FullName
}
$roots=New-Object System.Collections.Generic.List[string]
$passes=New-Object System.Collections.Generic.List[string]
$fixtureCount=0
function Assert([bool]$ok,[string]$code){if(-not $ok){throw $code}}
function Hash([byte[]]$b){return [WorkbridgeArchiveWin32]::Fingerprint($b)}
function NewBytes([string]$name,[byte[]]$b){
    $s=[IO.FileStream]::new($name,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
    try{$s.Write($b,0,$b.Length);$s.Flush($true)}finally{$s.Dispose()}
}
function Fixture {
    $id=[Guid]::NewGuid().ToString('N')
    $root=[IO.Path]::Combine($osTemp,'wb-native-handoff-fixture-'+$id)
    [WorkbridgeArchiveWin32]::CreateDirectoryExclusive($root)
    $script:roots.Add($root)
    Assert ($root.StartsWith(($osTemp+'\wb-native-handoff-fixture-'),
        [StringComparison]::OrdinalIgnoreCase)) 'FIXTURE_OUTSIDE_OS_TEMP'
    Assert (-not $root.Contains('\.tools\')) 'LIVE_TOOLS_FORBIDDEN'
    $script:fixtureCount++
    $admission=[IO.Path]::Combine($root,'desktop-turn-admission.lock')
    $guard=[IO.Path]::Combine($root,'desktop-input-turn.lock')
    $runId='native'+$id.Substring(0,13)
    $admissionStamp=([ordered]@{
        schemaVersion=1;kind='workbridge.gui-admission';admissionId=[Guid]::NewGuid().ToString('D')
        mode='producer';producer='desktopprobe-watchdog';requestId=$runId
        owner=@{pid=450001};acquiredUtc=[DateTime]::UtcNow.ToString('o')
    }|ConvertTo-Json -Depth 4 -Compress)
    $guardStamp=([ordered]@{
        schemaVersion=1;kind='workbridge.gui-turn';producer='desktopprobe-watchdog'
        runId=$runId;requestId=$runId;leaseId=[Guid]::NewGuid().ToString('D')
        owner=@{pid=450001;processStartUtcTicks='638663831240000000';sessionId=1}
        target=@{kind='window';pid=$null;hwnd=$null;process='DesktopProbe'}
        acquiredUtc=[DateTime]::UtcNow.ToString('o');synthetic=$false
    }|ConvertTo-Json -Depth 5 -Compress)
    $a=[WorkbridgeArchiveWin32+Admission]::Acquire($admission,$admissionStamp)
    try{
        $g=[WorkbridgeArchiveWin32+Admission]::Acquire($guard,$guardStamp)
        $g.Dispose()
    }finally{$a.Dispose()}
    return [pscustomobject]@{Root=$root;Admission=$admission;Guard=$guard;RunId=$runId}
}
function PinPair($f){
    $a=[WorkbridgeArchiveWin32+OpenFile]::OpenPinned($f.Admission)
    try{
        $g=[WorkbridgeArchiveWin32+OpenFile]::OpenPinned($f.Guard)
        return [pscustomobject]@{Admission=$a;Guard=$g}
    }catch{$a.Dispose();throw}
}
function ArchiveStage($f,$p){
    $r=[IO.Path]::Combine($f.Root,'recovery-archives')
    [WorkbridgeArchiveWin32]::CreateDirectoryExclusive($r)
    $run=[IO.Path]::Combine($r,'native-'+$f.RunId)
    [WorkbridgeArchiveWin32]::CreateDirectoryExclusive($run)
    $back=[IO.Path]::Combine($run,'backup')
    $moved=[IO.Path]::Combine($run,'relocated')
    [WorkbridgeArchiveWin32]::CreateDirectoryExclusive($back)
    [WorkbridgeArchiveWin32]::CreateDirectoryExclusive($moved)
    $ba=[IO.Path]::Combine($back,'desktop-turn-admission.lock')
    $bg=[IO.Path]::Combine($back,'desktop-input-turn.lock')
    NewBytes $ba $p.Admission.Bytes
    NewBytes $bg $p.Guard.Bytes
    Assert ((Hash ([IO.File]::ReadAllBytes($ba))) -ceq $p.Admission.Sha256) 'ADMISSION_BACKUP_HASH_BAD'
    Assert ((Hash ([IO.File]::ReadAllBytes($bg))) -ceq $p.Guard.Sha256) 'GUARD_BACKUP_HASH_BAD'
    $receipt=[ordered]@{
        schemaVersion=1;synthetic=$true;originalActionOutcome='unknown_outcome'
        newActionPerformed=$false;admissionFileId=$p.Admission.Identity
        guardFileId=$p.Guard.Identity;admissionSha=$p.Admission.Sha256;guardSha=$p.Guard.Sha256
    }
    NewBytes ([IO.Path]::Combine($run,'manifest.json')) ([Text.Encoding]::UTF8.GetBytes(
        ($receipt|ConvertTo-Json -Compress)+[Environment]::NewLine))
    return [pscustomobject]@{Root=$run;Moved=$moved;Back=$back}
}
function Case([string]$name,[scriptblock]$body){
    & $body
    $script:passes.Add($name)
}
Case 'N01_handle_fileids_preserved_while_admission_then_guard_move' {
    $f=Fixture;$p=PinPair $f;$maint=$null
    try{
        $oldA=$p.Admission.Identity;$oldG=$p.Guard.Identity
        $archive=ArchiveStage $f $p
        $adest=[IO.Path]::Combine($archive.Moved,'desktop-turn-admission.lock')
        $gdest=[IO.Path]::Combine($archive.Moved,'desktop-input-turn.lock')
        $p.Admission.RenameNoReplace($adest)
        Assert ($p.Admission.FreshIdentity() -ceq $oldA) 'ADMISSION_FILEID_CHANGED'
        Assert ([IO.File]::Exists($f.Guard)) 'GUARD_NOT_COVERING_ADMISSION_GAP'
        $stamp=([ordered]@{schemaVersion=1;kind='workbridge.gui-admission'
            admissionId=[Guid]::NewGuid().ToString('D');mode='maintenance'
            producer='desktop-maintenance';requestId='native-'+$f.RunId
            owner=@{pid=$PID};acquiredUtc=[DateTime]::UtcNow.ToString('o')
        }|ConvertTo-Json -Compress)
        $maint=[WorkbridgeArchiveWin32+Admission]::Acquire($f.Admission,$stamp)
        Assert ([IO.File]::Exists($f.Guard)) 'GUARD_LOST_BEFORE_MAINTENANCE'
        $p.Guard.RenameNoReplace($gdest)
        Assert ($p.Guard.FreshIdentity() -ceq $oldG) 'GUARD_FILEID_CHANGED'
        $p.Guard.Dispose();$p.Admission.Dispose();$p=$null
        $a=[WorkbridgeArchiveWin32+OpenFile]::OpenPinned($adest)
        $g=[WorkbridgeArchiveWin32+OpenFile]::OpenPinned($gdest)
        try{
            Assert ($a.Identity -ceq $oldA) 'ARCHIVED_ADMISSION_FILEID_CHANGED'
            Assert ($g.Identity -ceq $oldG) 'ARCHIVED_GUARD_FILEID_CHANGED'
        }finally{$a.Dispose();$g.Dispose()}
        NewBytes ([IO.Path]::Combine($archive.Root,'completed.json')) ([Text.Encoding]::UTF8.GetBytes(
            '{"synthetic":true,"originalActionOutcome":"unknown_outcome","newActionPerformed":false}'+[Environment]::NewLine))
        $maint.ReleaseOwned();$maint=$null
        Assert (-not [IO.File]::Exists($f.Admission)) 'MAINTENANCE_NOT_RELEASED'
        Assert (-not [IO.File]::Exists($f.Guard)) 'ORIGINAL_GUARD_NOT_MOVED'
    }finally{
        if($null -ne $p){$p.Guard.Dispose();$p.Admission.Dispose()}
        if($null -ne $maint){$maint.Dispose()}
    }
}
Case 'N02_contender_wins_atomic_gate_old_guard_still_blocks' {
    $f=Fixture;$p=PinPair $f;$racer=$null
    try{
        $archive=ArchiveStage $f $p
        $p.Admission.RenameNoReplace([IO.Path]::Combine($archive.Moved,'desktop-turn-admission.lock'))
        Assert ([IO.File]::Exists($f.Guard)) 'OLD_GUARD_LOST_IN_GAP'
        $racer=[WorkbridgeArchiveWin32+Admission]::Acquire($f.Admission,'{"producer":"racer"}')
        $maintenanceBlocked=$false
        try{
            $m2=[WorkbridgeArchiveWin32+Admission]::Acquire($f.Admission,'{"mode":"maintenance"}')
            $m2.Dispose()
        }catch{
            if([string]$_.Exception.ToString() -match 'UI_TURN_BUSY_OR_ADMISSION_CREATE_FAILED WIN32=(80|183)'){$maintenanceBlocked=$true}
            else{throw}
        }
        Assert $maintenanceBlocked 'MAINTENANCE_NOT_BLOCKED_BY_CONTENDER'
        $guardBlocked=$false
        try{
            $gui=[WorkbridgeArchiveWin32+Admission]::Acquire($f.Guard,'{"producer":"racer"}')
            $gui.Dispose()
        }catch{
            if([string]$_.Exception.ToString() -match 'UI_TURN_BUSY_OR_ADMISSION_CREATE_FAILED WIN32=(80|183)'){$guardBlocked=$true}
            else{throw}
        }
        Assert $guardBlocked 'RACER_ACQUIRED_OLD_GUI_GUARD'
        Assert ($p.Guard.FreshIdentity() -ceq $p.Guard.Identity) 'OLD_GUARD_FILEID_CHANGED'
        Assert ([IO.File]::Exists($f.Admission)) 'RACER_GATE_WAS_REMOVED'
        # Close our synthetic contender's own native handle before reading its
        # immutable stamp: live FILE_SHARE_READ intentionally denies a second
        # File.ReadAllText opener with incompatible share mode.
        $racer.Dispose();$racer=$null
        Assert (([IO.File]::ReadAllText($f.Admission)) -match '"racer"') 'RACER_GATE_OVERWRITTEN'
    }finally{
        if($null -ne $racer){$racer.Dispose()}
        $p.Guard.Dispose();$p.Admission.Dispose()
    }
}
Case 'N03_live_native_owner_share_mode_refuses_archiver_PIN' {
    $f=Fixture
    $livePath=[IO.Path]::Combine($f.Root,'live-held-admission.lock')
    $live=[WorkbridgeArchiveWin32+Admission]::Acquire($livePath,'{"synthetic":true}')
    try{
        $blocked=$false
        try{
            $a=[WorkbridgeArchiveWin32+OpenFile]::OpenPinned($livePath)
            $a.Dispose()
        }catch{
            if([string]$_.Exception.ToString() -match 'SOURCE_OPEN_REFUSED WIN32=32'){$blocked=$true}
            else{throw}
        }
        Assert $blocked 'LIVE_OWNER_SHARING_VIOLATION_NOT_ENFORCED'
        Assert ([IO.File]::Exists($livePath)) 'LIVE_OWNER_GATE_MISSING'
        Assert ([IO.File]::Exists($f.Admission) -and [IO.File]::Exists($f.Guard)) 'ORPHAN_PAIR_DISTURBED'
    }finally{$live.Dispose()}
}
Case 'N04_no_replace_rename_collision_preserves_sources' {
    $f=Fixture;$p=PinPair $f
    try{
        $archive=ArchiveStage $f $p
        $dest=[IO.Path]::Combine($archive.Moved,'desktop-turn-admission.lock')
        NewBytes $dest ([Text.Encoding]::UTF8.GetBytes('occupied'+[Environment]::NewLine))
        $blocked=$false
        try{$p.Admission.RenameNoReplace($dest)}catch{
            if([string]$_.Exception.ToString() -match 'HANDLE_RENAME_NO_REPLACE_FAILED WIN32=(80|183)'){$blocked=$true}
            else{throw}
        }
        Assert $blocked 'NO_REPLACE_RENAME_OVERWROTE_DESTINATION'
        Assert ([IO.File]::Exists($f.Admission) -and [IO.File]::Exists($f.Guard)) 'COLLISION_REMOVED_ORIGINAL'
        Assert (([IO.File]::ReadAllText($dest)) -ceq ('occupied'+[Environment]::NewLine)) 'DESTINATION_CHANGED'
        Assert ($p.Admission.FreshIdentity() -ceq $p.Admission.Identity) 'ADMISSION_FILEID_CHANGED_ON_COLLISION'
    }finally{$p.Guard.Dispose();$p.Admission.Dispose()}
}
Case 'N05_stop_between_original_admission_rename_and_maintenance' {
    $f=Fixture;$p=PinPair $f
    try{
        $archive=ArchiveStage $f $p
        $p.Admission.RenameNoReplace([IO.Path]::Combine($archive.Moved,'desktop-turn-admission.lock'))
        Assert (-not [IO.File]::Exists($f.Admission)) 'ADMISSION_OLD_NAME_PRESENT'
        Assert ([IO.File]::Exists($f.Guard)) 'OLD_GUARD_NOT_PRESENT'
        Assert ($p.Guard.FreshIdentity() -ceq $p.Guard.Identity) 'OLD_GUARD_FILEID_CHANGED'
        Assert ($p.Admission.FreshIdentity() -ceq $p.Admission.Identity) 'ARCHIVED_ADMISSION_FILEID_CHANGED'
    }finally{$p.Guard.Dispose();$p.Admission.Dispose()}
}
Case 'N06_closed_handle_pathname_swap_risk_vs_native_held_handle' {
    $f=Fixture
    # SINGLE-PROCESS deterministic INTERLEAVING MODEL ONLY: this is not a
    # two-process exploit or an observed production race. Node-style
    # lstat/read/lstat checks finish before pathname unlink, then we replace.
    $before=[IO.File]::ReadAllBytes($f.Admission)
    $originalPin=[WorkbridgeArchiveWin32+OpenFile]::OpenPinned($f.Admission)
    try{
        $originalFileId=$originalPin.Identity
        $verifiedHash=$originalPin.Sha256
    }finally{$originalPin.Dispose()}
    Assert ($verifiedHash -ceq (Hash $before)) 'BEFORE_SHA_PROOF_DRIFT'
    Assert ($verifiedHash.Length -eq 64) 'ORIGINAL_SHA_PROOF_UNAVAILABLE'
    $moved=[IO.Path]::Combine($f.Root,'old-admission-preserved.lock')
    [IO.File]::Move($f.Admission,$moved)
    $foreign=[Text.Encoding]::UTF8.GetBytes('{"kind":"workbridge.gui-admission","producer":"fresh-foreign-owner","owner":{"pid":450002}}'+[Environment]::NewLine)
    NewBytes $f.Admission $foreign
    $foreignPin=[WorkbridgeArchiveWin32+OpenFile]::OpenPinned($f.Admission)
    try{
        Assert ($foreignPin.Identity -cne $originalFileId) 'FOREIGN_GATE_FILEID_NOT_DISTINCT'
        Assert ($foreignPin.Sha256 -cne $verifiedHash) 'FOREIGN_GATE_SHA_NOT_DISTINCT'
    }finally{$foreignPin.Dispose()}
    # ONLY this private temp fixture receives the deliberately vulnerable
    # pathname delete; prove it WOULD remove the new foreign owner's gate.
    [IO.File]::Delete($f.Admission)
    Assert (-not [IO.File]::Exists($f.Admission)) 'PATHNAME_SWAP_VULNERABILITY_NOT_REPRODUCED'
    Assert ([IO.File]::Exists($moved)) 'ORIGINAL_ADMISSION_NOT_PRESERVED'
    # Contrast a native held owner handle: FILE_SHARE_READ denies external
    # delete/rename while ownership persists; owner then deletes by handle.
    $nativePath=[IO.Path]::Combine($f.Root,'native-held-gate.lock')
    $nativeOwner=[WorkbridgeArchiveWin32+Admission]::Acquire($nativePath,'{"synthetic":true}')
    try{
        $blocked=$false
        try{
            [IO.File]::Move($nativePath,[IO.Path]::Combine($f.Root,'blocked-swap.lock'))
        }catch{
            # Windows PowerShell wraps a .NET File.Move IOException inside a
            # MethodInvocationException. Require the EXACT sharing violation
            # Win32 low-word 32 on a bounded IOException cause; never green
            # an unrelated invocation/parse/permission failure.
            $cause=$_.Exception
            for($depth=0;$null -ne $cause -and $depth -lt 4;$depth++){
                if(($cause -is [IO.IOException]) -and
                    (($cause.HResult -band 65535) -eq 32)){
                    $blocked=$true
                    break
                }
                $cause=$cause.InnerException
            }
            if(-not $blocked){throw}
        }
        Assert $blocked 'NATIVE_HELD_HANDLE_ALLOWED_PATH_SWAP'
        Assert ([IO.File]::Exists($nativePath)) 'NATIVE_GATE_DISAPPEARED'
        $nativeOwner.ReleaseOwned();$nativeOwner=$null
        Assert (-not [IO.File]::Exists($nativePath)) 'NATIVE_HANDLE_RELEASE_NOT_PROVEN'
    }finally{if($null -ne $nativeOwner){$nativeOwner.Dispose()}}
}
# Remove ONLY private fixture roots freshly created by this exact invocation.
# Failed cases throw before this block and intentionally retain evidence for review.
$cleaned=0
foreach($fixtureRoot in $roots){
    Assert ($fixtureRoot.StartsWith(($osTemp+'\wb-native-handoff-fixture-'),
        [StringComparison]::OrdinalIgnoreCase)) 'CLEANUP_SCOPE_INVALID'
    Assert (-not $fixtureRoot.Contains('\.tools\')) 'CLEANUP_LIVE_TOOLS_FORBIDDEN'
    Assert (([IO.File]::GetAttributes($fixtureRoot) -band [IO.FileAttributes]::ReparsePoint) -eq 0) 'CLEANUP_REPARSE_REFUSED'
    [IO.Directory]::Delete($fixtureRoot,$true)
    $cleaned++
}
[pscustomobject]@{
    schemaVersion=1;synthetic=$true;nativeFileIdHandoff=$true;passed=$passes.Count;failed=0
    cases=@($passes);fixtureCount=$fixtureCount;cleanedFixtureCount=$cleaned;archiveSourceSha256=$sourceHash
    liveDesktopTouched=$false;guiLaunched=$false;priorActionOutcome='unknown_outcome'
}|ConvertTo-Json -Compress -Depth 5
