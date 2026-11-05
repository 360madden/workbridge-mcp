#requires -Version 5.1
# Disposable synthetic-only tests. Never targets Workbridge's real evidence root.
[CmdletBinding()]
param([string]$ArchiveScript)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if([string]::IsNullOrWhiteSpace($ArchiveScript)){
    $ArchiveScript=Join-Path $PSScriptRoot '..\scripts\Archive-DesktopQuarantine.ps1'
}
$script:Passed=0
$script:Failed=0
$script:Skipped=0
$script:Root=Join-Path ([IO.Path]::GetTempPath()) ('wb-archive-fixtures-'+[Guid]::NewGuid().ToString('N'))
$script:LeaseId='8aed4916-1cf3-4100-bc1b-d56f2308585f'
$script:RequestId='rc18-physical-rift-screenshot-20261102-postinstall-b1'
$script:Runner=[IO.Path]::GetFullPath($ArchiveScript)
if(-not [IO.File]::Exists($script:Runner)){throw "Archive helper missing: $script:Runner"}
New-Item -ItemType Directory -Path $script:Root -ErrorAction Stop | Out-Null

function Sha([byte[]]$bytes){
    $hasher=[Security.Cryptography.SHA256]::Create()
    try{return [BitConverter]::ToString($hasher.ComputeHash($bytes)).Replace('-','').ToLowerInvariant()}
    finally{$hasher.Dispose()}
}
function Save-New([string]$path,[byte[]]$bytes){
    $f=[IO.FileStream]::new($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
    try{$f.Write($bytes,0,$bytes.Length);$f.Flush($true)}finally{$f.Dispose()}
}
function Fixture([string]$name){
    $path=Join-Path $script:Root $name
    New-Item -ItemType Directory -Path $path -ErrorAction Stop | Out-Null
    $guard=[IO.Path]::Combine($path,'desktop-input-turn.lock')
    $side=[IO.Path]::Combine($path,('desktop-turn-quarantine-'+$script:LeaseId+'.json'))
    $legacy=[ordered]@{
       schemaVersion=1;kind='workbridge.gui-turn';leaseId=$script:LeaseId;requestId=$script:RequestId;
       owner=@{pid=2147483000;processStartUtc=$null;sessionId=$null};target=@{kind='window';pid=99999};
       acquiredUtc='2026-11-02T15:00:00Z'
    }
    $legacyBytes=[Text.UTF8Encoding]::new($false).GetBytes(($legacy|ConvertTo-Json -Depth 6 -Compress)+"`n")
    Save-New $guard $legacyBytes
    $q=[ordered]@{
       schemaVersion=1;kind='workbridge.gui-turn-quarantine';leaseId=$script:LeaseId;
       requestId=$script:RequestId;ownerStampSha256=(Sha $legacyBytes);
       reasonCode='DESKTOP_TREE_UNSETTLED';processTreeSettlement='unknown';
       automaticRetryAllowed=$false;intentSha256=$null;createdUtc='2026-11-02T15:00:02Z'
    }
    $sideBytes=[Text.UTF8Encoding]::new($false).GetBytes(($q|ConvertTo-Json -Depth 5 -Compress)+"`n")
    Save-New $side $sideBytes
    $census=[IO.Path]::Combine($path,'synthetic-census.json')
    Save-New $census ([Text.UTF8Encoding]::new($false).GetBytes('{"schemaVersion":1,"synthetic":true,"guiProcessCount":0,"enabledGuiTaskCount":0,"uninspectableProcessCount":0}'))
    return [pscustomobject]@{
       root=$path;guard=$guard;sidecar=$side;sideName=[IO.Path]::GetFileName($side);
       lockHash=(Sha $legacyBytes);sideHash=(Sha $sideBytes);
       operationId=('wb_arch_'+$name+'_20261105');leaseId=$script:LeaseId;requestId=$script:RequestId;
       census=$census
    }
}
function Invoke-Archive($f,[switch]$execute,[string]$stopStage='none',[switch]$collision){
    $args=@{
        EvidenceRoot=$f.root;ExpectedLockSha256=$f.lockHash;ExpectedSidecarSha256=$f.sideHash;
        ExpectedLeaseId=$f.leaseId;ExpectedRequestId=$f.requestId;OperationId=$f.operationId;
        TestCensusJson=$f.census;TestStopStage=$stopStage
    }
    if($execute){$args.Execute=$true}
    if($collision){$args.TestSidecarTargetCollision=$true}
    & $script:Runner @args
}
function Check([string]$name,[scriptblock]$body){
    try{& $body;$script:Passed++;Write-Output "PASS $name"}
    catch{
        if($_.Exception.Message -like '*SKIP_TEST:*'){
            $script:Skipped++;Write-Output "SKIP $name :: $($_.Exception.Message)"
        }else{$script:Failed++;Write-Output "FAIL $name :: $($_.Exception.Message)"}
    }
}
function Expect-Failure([scriptblock]$body,[string]$contains){
    $message=$null
    try{$null=& $body}catch{$message=$_.Exception.Message}
    if($null -eq $message -or $message -notlike ('*'+$contains+'*')){throw "Expected failure containing '$contains', observed '$message'"}
}
try{
    Check 'dry-run is read-only and leaves original guard and sidecar' {
        $f=Fixture 'dryrun'
        $report=Invoke-Archive $f|ConvertFrom-Json
        if($report.mode -ne 'read-only' -or $report.archiveCreated -ne $false){throw 'Dry run result invalid'}
        if(-not (Test-Path -LiteralPath $f.guard) -or -not (Test-Path -LiteralPath $f.sidecar)){throw 'Dry run moved original'}
        if(Test-Path -LiteralPath ([IO.Path]::Combine($f.root,'desktop-turn-admission.lock'))){throw 'Dry run created admission'}
    }
    Check 'two-file archival succeeds with exact SHA, archive IDs and original outcome UNKNOWN' {
        $f=Fixture 'success'
        $result=Invoke-Archive $f -execute|ConvertFrom-Json
        if($result.mode -ne 'archived' -or $result.priorActionOutcome -ne 'unknown_outcome'){throw 'Result incorrect'}
        $archive=[IO.Path]::Combine($f.root,'recovery-archives',$f.operationId)
        if((Test-Path -LiteralPath $f.guard) -or (Test-Path -LiteralPath $f.sidecar)){throw 'Original path survived'}
        foreach($sub in @('backup','relocated')){
            $g=[IO.Path]::Combine($archive,$sub,'desktop-input-turn.lock')
            $s=[IO.Path]::Combine($archive,$sub,$f.sideName)
            if((Sha ([IO.File]::ReadAllBytes($g))) -ne $f.lockHash -or (Sha ([IO.File]::ReadAllBytes($s))) -ne $f.sideHash){
                throw "Archived hash mismatch in $sub"
            }
        }
        if(Test-Path -LiteralPath ([IO.Path]::Combine($f.root,'desktop-turn-admission.lock'))){throw 'Maintenance admission remained'}
        $manifest=[IO.File]::ReadAllText([IO.Path]::Combine($archive,'manifest.json'))|ConvertFrom-Json
        if($manifest.newActionPerformed -ne $false -or $manifest.automaticRetryAllowed -ne $false){throw 'Manifest allows replay'}
        if($manifest.guard.fileId -eq $manifest.sidecar.fileId){throw 'Distinct originals share ID'}
        $journal=[IO.File]::ReadAllText([IO.Path]::Combine($archive,'journal.jsonl'))
        if($journal.IndexOf('sidecar-relocated') -gt $journal.IndexOf('guard-relocated-commit')){throw 'Unsafe ordering'}
    }
    Check 'pinned guard hash drift stops without moving evidence' {
        $f=Fixture 'drift'
        $f.lockHash='0000000000000000000000000000000000000000000000000000000000000000'
        Expect-Failure {Invoke-Archive $f -execute} 'EVIDENCE_SHA_DRIFT'
        if(-not (Test-Path -LiteralPath $f.guard) -or -not (Test-Path -LiteralPath $f.sidecar)){throw 'Original changed'}
        if(-not (Test-Path -LiteralPath ([IO.Path]::Combine($f.root,'desktop-turn-admission.lock')))){throw 'Preflight failure must preserve admission'}
    }
    Check 'foreign admission conflicts before any changes' {
        $f=Fixture 'busy'
        Save-New ([IO.Path]::Combine($f.root,'desktop-turn-admission.lock')) ([Text.Encoding]::UTF8.GetBytes('foreign'))
        Expect-Failure {Invoke-Archive $f -execute} 'UI_TURN_BUSY'
        if(-not (Test-Path -LiteralPath $f.guard) -or -not (Test-Path -LiteralPath $f.sidecar)){throw 'Original changed'}
    }
    Check 'unexpected orphan sidecar is a hard veto' {
        $f=Fixture 'orphan'
        Save-New ([IO.Path]::Combine($f.root,'desktop-turn-quarantine-unexpected.json')) ([Text.Encoding]::UTF8.GetBytes('{}'))
        Expect-Failure {Invoke-Archive $f -execute} 'UNEXPECTED_QUARANTINE_POPULATION'
        if(-not (Test-Path -LiteralPath $f.guard)){throw 'Guard moved'}
    }
    Check 'archive destination collision blocks without overwrite' {
        $f=Fixture 'collision'
        $parent=[IO.Path]::Combine($f.root,'recovery-archives')
        [IO.Directory]::CreateDirectory($parent)|Out-Null
        [IO.Directory]::CreateDirectory([IO.Path]::Combine($parent,$f.operationId))|Out-Null
        Expect-Failure {Invoke-Archive $f -execute} 'ARCHIVE_DIRECTORY_NOT_EXCLUSIVE'
        if(-not (Test-Path -LiteralPath $f.guard) -or -not (Test-Path -LiteralPath $f.sidecar)){throw 'Original changed'}
    }
    Check 'sidecar identity mismatch blocks relocation' {
        $f=Fixture 'linkage'
        # Deliberately provide a different pinned request, which must not alter originals.
        $f.requestId='synthetic_wrong_request_20261105'
        Expect-Failure {Invoke-Archive $f -execute} 'LEASE_SIDECAR_IDENTITY_CONFLICT'
        if(-not (Test-Path -LiteralPath $f.guard)){throw 'Guard moved'}
    }
    Check 'process census candidate refuses before archive' {
        $f=Fixture 'procblock'
        [IO.File]::WriteAllText($f.census,'{"schemaVersion":1,"synthetic":true,"guiProcessCount":1,"enabledGuiTaskCount":0,"uninspectableProcessCount":0}')
        Expect-Failure {Invoke-Archive $f -execute} 'GUI_PRODUCER_PRESENT_COUNT_1'
        if(-not (Test-Path -LiteralPath $f.guard)){throw 'Guard moved'}
    }
    Check 'enabled desktop-launcher task refuses before archive' {
        $f=Fixture 'taskblock'
        [IO.File]::WriteAllText($f.census,'{"schemaVersion":1,"synthetic":true,"guiProcessCount":0,"enabledGuiTaskCount":1,"uninspectableProcessCount":0}')
        Expect-Failure {Invoke-Archive $f -execute} 'ENABLED_GUI_LAUNCHER_COUNT_1'
        if(-not (Test-Path -LiteralPath $f.guard)){throw 'Guard moved'}
    }
    Check 'uninspectable script host fails closed' {
        $f=Fixture 'cliunknown'
        [IO.File]::WriteAllText($f.census,'{"schemaVersion":1,"synthetic":true,"guiProcessCount":0,"enabledGuiTaskCount":0,"uninspectableProcessCount":1}')
        Expect-Failure {Invoke-Archive $f -execute} 'GUI_POSSIBLE_PRODUCER_UNINSPECTABLE_COUNT_1'
        if(-not (Test-Path -LiteralPath $f.guard)){throw 'Guard moved'}
    }
    Check 'blocked file-sharing handle prevents archival' {
        $f=Fixture 'shareblock'
        $held=[IO.FileStream]::new($f.sidecar,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
        try{Expect-Failure {Invoke-Archive $f -execute} 'SOURCE_OPEN_REFUSED'}
        finally{$held.Dispose()}
        if(-not (Test-Path -LiteralPath $f.guard) -or -not (Test-Path -LiteralPath $f.sidecar)){throw 'File moved despite blocker'}
    }
    Check 'no-replace destination collision blocks sidecar rename' {
        $f=Fixture 'sidecollision'
        Expect-Failure {Invoke-Archive $f -execute -collision} 'HANDLE_RENAME_NO_REPLACE_FAILED'
        $dst=[IO.Path]::Combine($f.root,'recovery-archives',$f.operationId,'relocated',$f.sideName)
        if([IO.File]::ReadAllText($dst) -cne 'occupied'){throw 'Destination overwritten'}
        if(-not (Test-Path -LiteralPath $f.guard) -or -not (Test-Path -LiteralPath $f.sidecar)){throw 'Original moved despite collision'}
    }
    Check 'staged failure before rename retains both originals and admission' {
        $f=Fixture 'beforestop'
        Expect-Failure {Invoke-Archive $f -execute -stopStage 'before-sidecar'} 'TEST_STOP_BEFORE_SIDECAR'
        if(-not (Test-Path -LiteralPath $f.guard) -or -not (Test-Path -LiteralPath $f.sidecar)){throw 'Original moved'}
        if(-not (Test-Path -LiteralPath ([IO.Path]::Combine($f.root,'desktop-turn-admission.lock')))){throw 'Admission lost'}
    }
    Check 'interrupted after sidecar retains original guard and maintenance' {
        $f=Fixture 'sidestop'
        Expect-Failure {Invoke-Archive $f -execute -stopStage 'after-sidecar'} 'TEST_STOP_AFTER_SIDECAR'
        $archivedSide=[IO.Path]::Combine($f.root,'recovery-archives',$f.operationId,'relocated',$f.sideName)
        if(-not (Test-Path -LiteralPath $f.guard) -or (Test-Path -LiteralPath $f.sidecar) -or
           (Sha ([IO.File]::ReadAllBytes($archivedSide))) -ne $f.sideHash){throw 'Sidecar stop not fail-closed'}
        if(-not (Test-Path -LiteralPath ([IO.Path]::Combine($f.root,'desktop-turn-admission.lock')))){throw 'Admission lost'}
    }
    Check 'interrupted after guard commit retains maintenance and blocks contender' {
        $f=Fixture 'guardstop'
        Expect-Failure {Invoke-Archive $f -execute -stopStage 'after-guard'} 'TEST_STOP_AFTER_GUARD'
        if((Test-Path -LiteralPath $f.guard) -or (Test-Path -LiteralPath $f.sidecar)){throw 'Original names still present'}
        $admission=[IO.Path]::Combine($f.root,'desktop-turn-admission.lock')
        if(-not (Test-Path -LiteralPath $admission)){throw 'Admission lost'}
        $contenderSucceeded=$false
        try{
            $c=[IO.FileStream]::new($admission,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
            $contenderSucceeded=$true;$c.Dispose()
        }catch [IO.IOException]{}
        if($contenderSucceeded){throw 'Competing producer bypassed maintenance gate'}
    }
    Check 'reparse-point evidence is rejected' {
        $f=Fixture 'symlink'
        $target=$f.guard+'.target'
        [IO.File]::Move($f.guard,$target)
        $linkCreated=$true
        try {New-Item -ItemType SymbolicLink -Path $f.guard -Target $target -ErrorAction Stop|Out-Null}
        catch {$linkCreated=$false}
        if(-not $linkCreated){throw 'SKIP_TEST: symbolic link creation needs privilege'}
        Expect-Failure {Invoke-Archive $f -execute} 'SOURCE_NOT_ORDINARY_UNLINKED_OR_OVERSIZE'
        if(-not (Test-Path -LiteralPath $target)){throw 'Symlink target moved'}
    }
    Check 'hard-linked guard cannot be archived' {
        $f=Fixture 'hardlink'
        $alias=$f.guard+'.link'
        $created=$true
        try{New-Item -ItemType HardLink -Path $alias -Target $f.guard -ErrorAction Stop|Out-Null}
        catch{$created=$false}
        if(-not $created){throw 'SKIP_TEST: hard links unsupported on filesystem'}
        Expect-Failure {Invoke-Archive $f -execute} 'SOURCE_NOT_ORDINARY_UNLINKED_OR_OVERSIZE'
        if(-not (Test-Path -LiteralPath $alias) -or -not (Test-Path -LiteralPath $f.guard)){throw 'Hardlink evidence altered'}
    }
    [pscustomobject]@{passed=$script:Passed;failed=$script:Failed;skipped=$script:Skipped;syntheticRoot=$script:Root;liveEvidenceTouched=$false}|ConvertTo-Json -Compress
    if($script:Failed -gt 0){exit 1}
}finally{
    # Isolated generated fixture only. Never derive a deletion target from user input.
    if($script:Root -like ([IO.Path]::GetTempPath().TrimEnd('\')+'\wb-archive-fixtures-*')){
        Remove-Item -LiteralPath $script:Root -Recurse -Force -ErrorAction SilentlyContinue
    }
}
