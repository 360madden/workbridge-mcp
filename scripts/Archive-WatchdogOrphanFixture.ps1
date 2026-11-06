#requires -Version 5.1
<#
 M2 SYNTHETIC ONLY: watchdog crash-orphan archival (no GUI operations).
 Never use this script on .tools/desktop-evidence or any real desktop lock.
 Read-only by default. -Execute acts only in unique direct OS-temp fixtures.
#>
[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][string]$EvidenceRoot,
 [Parameter(Mandatory=$true)][ValidateSet('dual','admission-only')][string]$Mode,
 [Parameter(Mandatory=$true)][string]$ExpectedAdmissionSha256,
 [string]$ExpectedGuardSha256,
 [string]$ExpectedLeaseId,
 [Parameter(Mandatory=$true)][string]$ExpectedRequestId,
 [Parameter(Mandatory=$true)][int]$ExpectedOwnerPid,
 [Parameter(Mandatory=$true)][string]$OperationId,
 [switch]$Execute
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
function Reject([string]$s){throw [InvalidOperationException]::new($s)}
function New-Bytes([string]$path,[byte[]]$bytes){
 $f=[IO.FileStream]::new($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
 try{$f.Write($bytes,0,$bytes.Length);$f.Flush($true)}finally{$f.Dispose()}
}
function Assert-Ordinary([string]$path){
 $p=[IO.Path]::GetFullPath($path)
 while($true){
  if(-not [IO.Directory]::Exists($p)){Reject 'DIRECTORY_MISSING'}
  if(((Get-Item -LiteralPath $p -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){Reject 'REPARSE_PARENT'}
  $parent=[IO.Directory]::GetParent($p);if($null -eq $parent){break};$p=$parent.FullName
 }
}
function Assert-SafePopulation {
 if(@(Get-ChildItem -LiteralPath $root -Filter 'desktop-turn-quarantine-*.json' -Force).Count -ne 0){Reject 'SIDECAR_PRESENT'}
 if($Mode -eq 'admission-only' -and [IO.File]::Exists($guardPath)){Reject 'UNEXPECTED_GUI_GUARD'}
}
function Assert-Idle {
 $procs=@(Get-CimInstance Win32_Process -Property ProcessId,Name,CommandLine -ErrorAction Stop)
 if($procs.Count -lt 1 -or $procs.Count -gt 5000){Reject 'PROCESS_CENSUS_INCOMPLETE'}
 foreach($proc in $procs){
  if([int]$proc.ProcessId -eq $ExpectedOwnerPid){Reject 'OWNER_PID_LIVE_OR_REUSED'}
  $name=[string]$proc.Name
  if($name -match '^(DesktopProbe|DesktopProbeWatchdog|ChatInputProbe|ChatInputProbeWatchdog|winapp|WinAppCli|winapp-cli)\.exe$'){Reject 'GUI_PRODUCER_PRESENT'}
  if($name -match '^(node|nodejs|powershell|pwsh|cmd|dotnet)\.exe$'){
   if([string]::IsNullOrWhiteSpace([string]$proc.CommandLine)){Reject 'UNINSPECTABLE_SCRIPT_HOST'}
   if([string]$proc.CommandLine -match '(?i)(desktop-probe-act|desktop-capture|physical-rift-reloadui)\.(mjs|ps1)'){Reject 'GUI_SCRIPT_PRESENT'}
  }
 }
 $tasks=@(Get-ScheduledTask -ErrorAction Stop)
 if($tasks.Count -gt 5000){Reject 'TASK_CENSUS_INCOMPLETE'}
 foreach($task in $tasks){
  if([string]$task.State -eq 'Disabled'){continue}
  if([string]$task.TaskName -match '(?i)(DesktopProbe|ChatInputProbe|GUI[-_]?Launcher)'){Reject 'GUI_TASK_PRESENT'}
  foreach($action in @($task.Actions)){
   if($null -eq $action){continue}
   $ep=$action.PSObject.Properties['Execute'];$ap=$action.PSObject.Properties['Arguments']
   $exe='';$arg=''
   if($null -ne $ep){$exe=[string]$ep.Value};if($null -ne $ap){$arg=[string]$ap.Value}
   if($exe -match '(?i)(DesktopProbe|ChatInputProbe)(Watchdog)?\.exe$' -or
      $arg -match '(?i)(DesktopProbe|ChatInputProbe)(Watchdog)?'){Reject 'GUI_TASK_PRESENT'}
  }
 }
}
if($ExpectedAdmissionSha256 -cnotmatch '^[a-fA-F0-9]{64}$'){Reject 'ADMISSION_PIN_INVALID'}
if($ExpectedRequestId -cnotmatch '^[a-z0-9][a-z0-9-]{6,38}[a-z0-9]$' -or
 $OperationId -cnotmatch '^[a-zA-Z0-9][a-zA-Z0-9_-]{7,63}$' -or $ExpectedOwnerPid -le 0){Reject 'IDENTITY_PIN_INVALID'}
if($Mode -eq 'dual'){
 if($ExpectedGuardSha256 -cnotmatch '^[a-fA-F0-9]{64}$' -or
 $ExpectedLeaseId -cnotmatch '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'){Reject 'GUARD_PIN_INVALID'}
}else{
 if($ExpectedGuardSha256 -or $ExpectedLeaseId){Reject 'ADMISSION_ONLY_GUARD_PIN'}
}
$root=[IO.Path]::GetFullPath($EvidenceRoot).TrimEnd('\')
$temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
if(-not [IO.Path]::GetDirectoryName($root).Equals($temp,[StringComparison]::OrdinalIgnoreCase) -or
 [IO.Path]::GetFileName($root) -cnotmatch '^wb-watchdog-orphan-fixture-[a-f0-9]{12,32}$'){
 Reject 'ONLY_DIRECT_OS_TEMP_FIXTURE_ALLOWED'
}
Assert-Ordinary $root
$nativeSource=[IO.Path]::Combine($PSScriptRoot,'Archive-DesktopQuarantine.ps1')
if((Get-FileHash -LiteralPath $nativeSource -Algorithm SHA256).Hash.ToLowerInvariant() -cne
 '5b1860ed41887c408edba9d38eb6b580483db75d5f14e641bf4cf7ccbef8eca0'){Reject 'PINNED_NATIVE_SOURCE_DRIFT'}
$match=[regex]::Match([IO.File]::ReadAllText($nativeSource),'(?s)\$win32\s*=\s*@''\r?\n(?<code>.*?)\r?\n''@')
if(-not $match.Success){Reject 'NATIVE_SOURCE_NOT_FOUND'}
if(-not ('WorkbridgeArchiveWin32' -as [type])){Add-Type -TypeDefinition $match.Groups['code'].Value -ErrorAction Stop}
$admissionPath=[IO.Path]::Combine($root,'desktop-turn-admission.lock')
$guardPath=[IO.Path]::Combine($root,'desktop-input-turn.lock')
$admission=$null;$guard=$null
try{
 $admission=[WorkbridgeArchiveWin32+OpenFile]::OpenPinned($admissionPath)
 if($admission.Sha256 -cne $ExpectedAdmissionSha256.ToLowerInvariant()){Reject 'ADMISSION_SHA_DRIFT'}
 $a=[Text.UTF8Encoding]::new($false,$true).GetString($admission.Bytes)|ConvertFrom-Json
 if($a.schemaVersion -ne 1 -or $a.kind -cne 'workbridge.gui-admission' -or
 $a.mode -cne 'producer' -or $a.producer -cne 'desktopprobe-watchdog' -or
 $a.requestId -cne $ExpectedRequestId -or [int]$a.owner.pid -ne $ExpectedOwnerPid -or
 [string]$a.admissionId -cnotmatch '^[a-f0-9-]{36}$'){Reject 'ADMISSION_STAMP_MISMATCH'}
 if($Mode -eq 'dual'){
  $guard=[WorkbridgeArchiveWin32+OpenFile]::OpenPinned($guardPath)
  if($guard.Sha256 -cne $ExpectedGuardSha256.ToLowerInvariant()){Reject 'GUARD_SHA_DRIFT'}
  $g=[Text.UTF8Encoding]::new($false,$true).GetString($guard.Bytes)|ConvertFrom-Json
  if($g.schemaVersion -ne 1 -or $g.kind -cne 'workbridge.gui-turn' -or
  $g.producer -cne 'desktopprobe-watchdog' -or $g.synthetic -cne $true -or
  $g.runId -cne $ExpectedRequestId -or $g.requestId -cne $ExpectedRequestId -or
  $g.leaseId -cne $ExpectedLeaseId -or [int]$g.owner.pid -ne $ExpectedOwnerPid -or
  $g.target.kind -cne 'window' -or $g.target.process -cne 'DesktopProbe' -or
  $null -ne $g.target.pid -or $null -ne $g.target.hwnd){Reject 'GUARD_STAMP_MISMATCH'}
 }
 Assert-SafePopulation
 Assert-Idle
 if(-not $Execute){
  [pscustomobject]@{ok=$true;mode='read-only';case=$Mode;syntheticOnly=$true;
   admissionSha256=$admission.Sha256;admissionFileId=$admission.Identity;
   guardSha256=$(if($null -ne $guard){$guard.Sha256}else{$null});
   guardFileId=$(if($null -ne $guard){$guard.Identity}else{$null});
   liveRecoveryEligible=$false;archiveCreated=$false;newInputPerformed=$false;
   priorActionOutcome='unknown_outcome'}|ConvertTo-Json -Compress
  return
 }
 $parent=[IO.Path]::Combine($root,'recovery-archives')
 if(-not [IO.Directory]::Exists($parent)){[WorkbridgeArchiveWin32]::CreateDirectoryExclusive($parent)}
 else{Assert-Ordinary $parent}
 $archive=[IO.Path]::Combine($parent,$OperationId)
 [WorkbridgeArchiveWin32]::CreateDirectoryExclusive($archive)
 $backup=[IO.Path]::Combine($archive,'backup')
 $moved=[IO.Path]::Combine($archive,'relocated')
 [WorkbridgeArchiveWin32]::CreateDirectoryExclusive($backup)
 [WorkbridgeArchiveWin32]::CreateDirectoryExclusive($moved)
 New-Bytes ([IO.Path]::Combine($backup,'desktop-turn-admission.lock')) $admission.Bytes
 if($null -ne $guard){New-Bytes ([IO.Path]::Combine($backup,'desktop-input-turn.lock')) $guard.Bytes}
 $manifest=[ordered]@{schemaVersion=1;kind='workbridge.watchdog-orphan-fixture-archive';
  operationId=$OperationId;case=$Mode;syntheticOnly=$true;liveRecoveryEligible=$false;
  historicalTreeSettled='unverified';priorActionOutcome='unknown_outcome';newInputPerformed=$false;
  admission=@{sha256=$admission.Sha256;fileId=$admission.Identity};
  guard=$(if($null -ne $guard){@{sha256=$guard.Sha256;fileId=$guard.Identity}}else{$null})}
 New-Bytes ([IO.Path]::Combine($archive,'manifest.json')) ([Text.UTF8Encoding]::new($false).GetBytes(($manifest|ConvertTo-Json -Depth 5)+[Environment]::NewLine))
 Assert-SafePopulation
 Assert-Idle
 if($null -ne $guard){
  $guard.RenameNoReplace([IO.Path]::Combine($moved,'desktop-input-turn.lock'))
  if(-not [WorkbridgeArchiveWin32]::DefinitelyAbsent($guardPath) -or $guard.FreshIdentity() -cne $guard.Identity){Reject 'GUARD_MOVE_UNPROVED'}
 }
 # Admission is renamed LAST; until then the original producer gate stays closed.
 $admission.RenameNoReplace([IO.Path]::Combine($moved,'desktop-turn-admission.lock'))
 if(-not [WorkbridgeArchiveWin32]::DefinitelyAbsent($admissionPath) -or $admission.FreshIdentity() -cne $admission.Identity){Reject 'ADMISSION_MOVE_UNPROVED'}
 $admission.Dispose();$admission=$null
 if($null -ne $guard){$guard.Dispose();$guard=$null}
 $test=[WorkbridgeArchiveWin32+OpenFile]::OpenPinned([IO.Path]::Combine($moved,'desktop-turn-admission.lock'))
 try{if($test.Sha256 -cne $manifest.admission.sha256 -or $test.Identity -cne $manifest.admission.fileId){Reject 'ARCHIVED_ADMISSION_DRIFT'}}finally{$test.Dispose()}
 if($Mode -eq 'dual'){
  $test=[WorkbridgeArchiveWin32+OpenFile]::OpenPinned([IO.Path]::Combine($moved,'desktop-input-turn.lock'))
  try{if($test.Sha256 -cne $manifest.guard.sha256 -or $test.Identity -cne $manifest.guard.fileId){Reject 'ARCHIVED_GUARD_DRIFT'}}finally{$test.Dispose()}
 }
 Assert-SafePopulation
 Assert-Idle
 New-Bytes ([IO.Path]::Combine($archive,'completed.json')) ([Text.UTF8Encoding]::new($false).GetBytes((@{operationId=$OperationId;syntheticOnly=$true;newInputPerformed=$false}|ConvertTo-Json -Compress)+[Environment]::NewLine))
 [pscustomobject]@{ok=$true;mode='archived';case=$Mode;archive=$archive;syntheticOnly=$true;liveRecoveryEligible=$false;newInputPerformed=$false}|ConvertTo-Json -Compress
}finally{
 if($null -ne $guard){$guard.Dispose()}
 if($null -ne $admission){$admission.Dispose()}
}
