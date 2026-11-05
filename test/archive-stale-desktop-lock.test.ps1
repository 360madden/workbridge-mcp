#requires -Version 5.1
# Disposable synthetic fixture only. Never targets the production GUI lock.
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$helper=[IO.Path]::GetFullPath([IO.Path]::Combine($PSScriptRoot,'..','scripts','Archive-StaleDesktopLock.ps1'))
$root=[IO.Path]::Combine([IO.Path]::GetTempPath(),'wb-stale-lock-fixture-'+[Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($root)|Out-Null
$leaseId=[Guid]::NewGuid().ToString('D')
$requestId='synthetic_chatinput_20261105a'
$oldPid=99999991
$oldTargetPid=99999992
$hwnd=[int64]1234567
$stamp=[ordered]@{
  schemaVersion=1;kind='workbridge.gui-turn';leaseId=$leaseId;
  producer='chatinput-probe-test';requestId=$requestId;
  owner=@{pid=$oldPid};
  target=@{kind='window';pid=$oldTargetPid;hwnd=$hwnd;process='ChatInputProbe'};
  acquiredUtc=[DateTime]::UtcNow.ToString('o')
}
$lockPath=[IO.Path]::Combine($root,'desktop-input-turn.lock')
[IO.File]::WriteAllText($lockPath,($stamp|ConvertTo-Json -Depth 5 -Compress)+[Environment]::NewLine,[Text.UTF8Encoding]::new($false))
$sha=(Get-FileHash -LiteralPath $lockPath -Algorithm SHA256).Hash.ToLowerInvariant()
function Assert([bool]$condition,[string]$message){if(-not $condition){throw ('SYNTHETIC_ASSERTION_FAILED '+$message)}}
$negative=$false
try{
  $wrong=($sha.Substring(0,63)+$(if($sha[63] -eq 'a'){'b'}else{'a'}))
  & $helper -EvidenceRoot $root -ExpectedLockSha256 $wrong -ExpectedLeaseId $leaseId -ExpectedRequestId $requestId -ExpectedOwnerPid $oldPid -ExpectedTargetPid $oldTargetPid -ExpectedTargetHwnd $hwnd -OperationId 'synthetic_lock_archive_20261105a' -SyntheticFixture |Out-Null
}catch{
  $negative=($_.Exception.Message -match 'LOCK_HASH_DRIFT')
}
Assert $negative 'Pinned bad SHA must be rejected'
Assert ([IO.File]::Exists($lockPath)) 'Wrong-hash attempt must not move fixture lock'
$preflight=& $helper -EvidenceRoot $root -ExpectedLockSha256 $sha -ExpectedLeaseId $leaseId -ExpectedRequestId $requestId -ExpectedOwnerPid $oldPid -ExpectedTargetPid $oldTargetPid -ExpectedTargetHwnd $hwnd -OperationId 'synthetic_lock_archive_20261105a' -SyntheticFixture
$pre=$preflight|ConvertFrom-Json
Assert ($pre.ok -eq $true -and $pre.mode -eq 'read-only') 'Read-only preflight must succeed'
Assert ([IO.File]::Exists($lockPath)) 'Read-only preflight must preserve guard'
$run=& $helper -EvidenceRoot $root -ExpectedLockSha256 $sha -ExpectedLeaseId $leaseId -ExpectedRequestId $requestId -ExpectedOwnerPid $oldPid -ExpectedTargetPid $oldTargetPid -ExpectedTargetHwnd $hwnd -OperationId 'synthetic_lock_archive_20261105a' -SyntheticFixture -Execute
$result=$run|ConvertFrom-Json
Assert ($result.ok -eq $true -and $result.mode -eq 'archived') 'Execution must archive fixture lock'
$archive=[IO.Path]::Combine($root,'recovery-archives','synthetic_lock_archive_20261105a')
$backup=[IO.Path]::Combine($archive,'backup','desktop-input-turn.lock')
$moved=[IO.Path]::Combine($archive,'relocated','desktop-input-turn.lock')
Assert (-not [IO.File]::Exists($lockPath)) 'Original guard must be absent'
Assert (-not [IO.File]::Exists([IO.Path]::Combine($root,'desktop-turn-admission.lock'))) 'Maintenance gate must be absent'
Assert ([IO.File]::Exists($backup) -and [IO.File]::Exists($moved)) 'Both backup and archive must exist'
Assert (((Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash.ToLowerInvariant()) -ceq $sha) 'Backup SHA must match'
Assert (((Get-FileHash -LiteralPath $moved -Algorithm SHA256).Hash.ToLowerInvariant()) -ceq $sha) 'Relocated SHA must match'
Assert ([IO.File]::Exists([IO.Path]::Combine($archive,'completed.json'))) 'Completion receipt must exist'
[pscustomobject]@{ok=$true;synthetic=$true;fixtureRoot=$root;readOnlyPassed=$true;
  archived=$true;noInput=$true;backupVerified=$true;relocatedVerified=$true;
  expectedSha=$sha}|ConvertTo-Json -Compress
