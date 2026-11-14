#requires -Version 5.1
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class RetentionFixtureNative {
  [DllImport("kernel32.dll",EntryPoint="DeleteFileW",CharSet=CharSet.Unicode,SetLastError=true)]
  public static extern bool Delete(string path);
  [DllImport("kernel32.dll",SetLastError=true)]
  public static extern bool DeviceIoControl(SafeFileHandle h,uint code,System.IntPtr input,uint inputSize,System.IntPtr output,uint outputSize,out uint bytes,System.IntPtr overlapped);
}
'@
$script:helper=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\scripts\Storage-RetentionMaintenance.ps1'))
$root=Join-Path ([IO.Path]::GetTempPath()) ('wb-retention-maintenance-'+[Guid]::NewGuid().ToString('N'))
$script:children=[Collections.Generic.List[Diagnostics.Process]]::new()
function Assert($condition,[string]$message) { if(-not $condition) { throw $message } }
function Start-Helper([string]$mode,[string]$gc='gc1',[string]$updater='up1',[string]$kind='candidate',[int]$timeout=30) {
  $info=[Diagnostics.ProcessStartInfo]::new()
  $info.FileName=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $info.Arguments='-NoLogo -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File "'+$script:helper+'" -Mode '+$mode+' -InstallRoot "'+$root+'" -OperationId '+$gc+' -UpdaterOperationId '+$updater+' -Kind '+$kind+' -TimeoutSeconds '+$timeout
  if($kind -eq 'displaced') { $info.Arguments += ' -DisplacedId '+('a'*32) }
  if($mode -eq 'Lease') { $info.Arguments += ' -MaintenanceConfirmed' }
  $info.UseShellExecute=$false;$info.CreateNoWindow=$true
  $info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
  $info.StandardOutputEncoding=[Text.UTF8Encoding]::new($false)
  $p=[Diagnostics.Process]::Start($info);$script:children.Add($p);return $p
}
function Read-Reply($process) {
  $task=$process.StandardOutput.ReadLineAsync()
  if(-not $task.Wait(15000)) { throw 'helper timeout' }
  if($null -eq $task.Result) { throw ('helper closed: '+$process.StandardError.ReadToEnd()) }
  if(-not $task.Result.StartsWith('{')) { throw ('unexpected helper output: '+$task.Result+' STDERR: '+$process.StandardError.ReadToEnd()) }
  return $task.Result|ConvertFrom-Json
}
function Send($process,$value) { $process.StandardInput.WriteLine(($value|ConvertTo-Json -Compress -Depth 6));$process.StandardInput.Flush();return Read-Reply $process }
function Stop-Helper($process) { if(-not $process.HasExited) { $process.StandardInput.Close();if(-not $process.WaitForExit(5000)) { $process.Kill();$process.WaitForExit() } } }
try {
  $source=Join-Path $root '.local\update-operations\up1\candidate'
  $dest=Join-Path $root '.local\storage-quarantine\gc1\payload'
  [IO.Directory]::CreateDirectory($source)|Out-Null
  [IO.File]::WriteAllText((Join-Path $source 'marker'),'original')
  $reserved=Start-Helper 'Inspect' 'CON';$reservedReply=Read-Reply $reserved
  Assert ($reservedReply.status -eq 'error' -and $reservedReply.code -match 'INVALID_OPERATION_ID') 'reserved Windows name accepted'
  Stop-Helper $reserved
  $probe=Start-Helper 'Inspect'
  $p=Read-Reply $probe
  Assert ($p.status -eq 'ready' -and $p.source.exists -and -not $p.destination.exists -and $p.sameVolume) 'read-only missing destination inspection failed'
  Stop-Helper $probe
  Assert (-not [IO.File]::Exists((Join-Path $root '.local\updater.lock'))) 'inspect wrote lock'
  Assert (-not [IO.Directory]::Exists((Join-Path $root '.local\storage-quarantine'))) 'inspect created destination'
  [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($dest))|Out-Null
  $lease=Start-Helper 'Lease';$ready=Read-Reply $lease
  Assert ($ready.status -eq 'ready' -and $ready.source.exists) 'lease not ready'
  $orphan=Join-Path ([IO.Path]::GetDirectoryName($dest)) '.phase-11111111111111111111111111111111.tmp'
  [IO.File]::WriteAllText($orphan,'uncommitted fixture')
  $badPhase=Send $lease @{command='phase';phase='../outside';planSha256=('a'*64)}
  Assert ($badPhase.status -eq 'error' -and $badPhase.code -match 'INVALID_PHASE') 'invalid phase accepted'
  $badDigest=Send $lease @{command='phase';phase='quarantined';planSha256=('A'*64)}
  Assert ($badDigest.status -eq 'error' -and $badDigest.code -match 'INVALID_PLAN_SHA256') 'uppercase digest accepted'
  $phase=Send $lease @{command='phase';phase='quarantined';planSha256=('a'*64)}
  Assert ($phase.status -eq 'ok') ('phase publish failed: '+($phase|ConvertTo-Json -Compress))
  $phasePath=Join-Path ([IO.Path]::GetDirectoryName($dest)) 'quarantined.json'
  $receiptText=[IO.File]::ReadAllText($phasePath)
  $receipt=$receiptText|ConvertFrom-Json
  Assert ($receipt.schema -eq 'workbridge-retention-phase/2' -and $receipt.publishedAtUtc -cmatch '\A[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z\z' -and $receipt.operationId -eq 'gc1' -and $receipt.planSha256 -ceq ('a'*64) -and $receipt.phase -ceq 'quarantined') 'phase fields invalid'
  $again=Send $lease @{command='phase';phase='quarantined';planSha256=('b'*64)}
  Assert ($again.status -eq 'error' -and $again.code -match 'RENAME_NO_REPLACE_FAILED') 'duplicate phase did not fail'
  Assert ([IO.File]::ReadAllText($phasePath) -ceq $receiptText) 'duplicate phase overwrote original'
  Assert ([IO.File]::ReadAllText($orphan) -eq 'uncommitted fixture') 'orphan temporary evidence changed'
  $temporaries=@([IO.Directory]::GetFiles([IO.Path]::GetDirectoryName($dest),'.phase-*.tmp'))
  Assert ($temporaries.Count -ge 2) 'collision did not preserve the flushed unpublished temporary'
  foreach($name in @('restoring','restored')) {
    $otherPhase=Send $lease @{command='phase';phase=$name;planSha256=('a'*64)}
    Assert ($otherPhase.status -eq 'ok' -and [IO.File]::Exists((Join-Path ([IO.Path]::GetDirectoryName($dest)) ($name+'.json')))) 'phase missing'
  }
  $contender=Start-Helper 'Lease';$busy=Read-Reply $contender
  Assert ($busy.status -eq 'error' -and $busy.code -match 'UPDATER_LOCK_BUSY') 'second lease did not conflict'
  Stop-Helper $contender
  $wrong=Send $lease @{command='move';from='source';expectedIdentity=@{volume=$ready.source.identity.volume;id=('0'*32)}}
  Assert ($wrong.status -eq 'error' -and $wrong.code -match 'SOURCE_IDENTITY_CHANGED') 'wrong identity accepted'
  [IO.Directory]::CreateDirectory($dest)|Out-Null
  [IO.File]::WriteAllText((Join-Path $dest 'marker'),'occupied')
  $collision=Send $lease @{command='move';from='source';expectedIdentity=$ready.source.identity}
  Assert ($collision.status -eq 'error' -and $collision.code -match 'RENAME_NO_REPLACE_FAILED') 'collision did not fail'
  Assert ([IO.File]::ReadAllText((Join-Path $dest 'marker')) -eq 'occupied') 'destination overwritten'
  Assert ([IO.File]::ReadAllText((Join-Path $source 'marker')) -eq 'original') 'source overwritten'
  [IO.Directory]::Delete($dest,$true)
  $moved=Send $lease @{command='move';from='source';expectedIdentity=$ready.source.identity}
  Assert ($moved.status -eq 'ok' -and -not $moved.source.exists -and $moved.destination.exists) ('move failed: '+($moved|ConvertTo-Json -Compress -Depth 6))
  Assert ($moved.destination.identity.id -eq $ready.source.identity.id) 'move changed identity'
  $inventory=Send $lease @{command='inventory'}
  Assert ($inventory.status -eq 'ok' -and $inventory.inventory.complete -and $inventory.inventory.nonAtomic) ('inventory failed: '+($inventory|ConvertTo-Json -Compress -Depth 8))
  Assert (@($inventory.inventory.entries).Count -eq 2 -and $inventory.inventory.totalBytes -eq 8) 'inventory counts invalid'
  $item=@($inventory.inventory.entries|Where-Object {$_.path -eq 'marker'})[0]
  Assert ($item.sha256 -eq '0682c5f2076f099c34cfdd15a9e063849ed437a49677e6fcc5b4198c76575be5') 'inventory hash invalid'
  $unicodeName=([string][char]0x03C0)+'.txt'
  [IO.File]::WriteAllText((Join-Path $dest $unicodeName),'unicode')
  $unicodeInventory=Send $lease @{command='inventory'}
  Assert ($unicodeInventory.status -eq 'ok' -and @($unicodeInventory.inventory.entries|Where-Object {$_.path -ceq $unicodeName}).Count -eq 1) 'unicode path was not preserved'
  [IO.File]::Delete((Join-Path $dest $unicodeName))
  $readOnly=Start-Helper 'Inventory';$readOnlyResult=Read-Reply $readOnly
  Assert ($readOnlyResult.status -eq 'ready' -and $readOnlyResult.inventory.complete) 'read-only inventory failed'
  Stop-Helper $readOnly
  $nested=Join-Path $dest 'nested';[IO.Directory]::CreateDirectory($nested)|Out-Null
  foreach($streamObject in @((Join-Path $dest 'marker'),$nested,$dest)) {
    Set-Content -LiteralPath $streamObject -Stream 'wbprobe' -Value 'private stream'
    $streamResult=Send $lease @{command='inventory'}
    Assert ($streamResult.status -eq 'error' -and $streamResult.code -match 'NAMED_STREAM_REFUSED') ('named stream accepted: '+$streamObject+' '+($streamResult|ConvertTo-Json -Compress))
    if(-not [RetentionFixtureNative]::Delete($streamObject+':wbprobe')) { throw 'stream cleanup failed' }
  }
  [IO.Directory]::Delete($nested)
  $hardlink=Join-Path $dest 'hardlink'
  New-Item -ItemType HardLink -Path $hardlink -Target (Join-Path $dest 'marker')|Out-Null
  $hardResult=Send $lease @{command='inventory'}
  Assert ($hardResult.status -eq 'error' -and $hardResult.code -match 'HARDLINK_REFUSED') ('hardlink accepted: '+($hardResult|ConvertTo-Json -Compress))
  [IO.File]::Delete($hardlink)
  $insideJunction=Join-Path $dest 'junction'
  $external=Join-Path $root 'inventory-outside';[IO.Directory]::CreateDirectory($external)|Out-Null
  New-Item -ItemType Junction -Path $insideJunction -Target $external|Out-Null
  $junctionResult=Send $lease @{command='inventory'}
  Assert ($junctionResult.status -eq 'error' -and $junctionResult.code -match 'REPARSE_POINT_REFUSED') ('junction accepted: '+($junctionResult|ConvertTo-Json -Compress))
  [IO.Directory]::Delete($insideJunction)
  $sparse=Join-Path $dest 'sparse'
  $sparseFile=[IO.File]::Open($sparse,[IO.FileMode]::CreateNew,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
  try {
    [uint32]$returned=0
    if(-not [RetentionFixtureNative]::DeviceIoControl($sparseFile.SafeFileHandle,0x900C4,[IntPtr]::Zero,0,[IntPtr]::Zero,0,[ref]$returned,[IntPtr]::Zero)) { throw 'fixture sparse flag unavailable' }
  } finally { $sparseFile.Dispose() }
  try {
    $sparseResult=Send $lease @{command='inventory'}
    Assert ($sparseResult.status -eq 'error' -and $sparseResult.code -match 'UNSUPPORTED_ATTRIBUTES') ('sparse accepted: '+($sparseResult|ConvertTo-Json -Compress))
  } finally { [IO.File]::Delete($sparse) }
  $large=Join-Path $dest 'oversized'
  $largeFile=[IO.File]::Open($large,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try { $largeFile.SetLength(512L*1024*1024+1) } finally { $largeFile.Dispose() }
  try {
    $limitResult=Send $lease @{command='inventory'}
    Assert ($limitResult.status -eq 'error' -and $limitResult.code -match 'INVENTORY_BYTE_LIMIT') ('oversize accepted: '+($limitResult|ConvertTo-Json -Compress))
  } finally { [IO.File]::Delete($large) }
  [IO.Directory]::CreateDirectory($source)|Out-Null
  [IO.File]::WriteAllText((Join-Path $source 'marker'),'replacement')
  $restoreCollision=Send $lease @{command='move';from='destination';expectedIdentity=$moved.destination.identity}
  Assert ($restoreCollision.status -eq 'error' -and $restoreCollision.code -match 'RENAME_NO_REPLACE_FAILED') 'restore collision did not fail'
  Assert ([IO.File]::ReadAllText((Join-Path $source 'marker')) -eq 'replacement') 'restore overwrote source'
  Assert ([IO.File]::ReadAllText((Join-Path $dest 'marker')) -eq 'original') 'restore damaged quarantined tree'
  [IO.Directory]::Delete($source,$true)
  $back=Send $lease @{command='move';from='destination';expectedIdentity=$moved.destination.identity}
  Assert ($back.status -eq 'ok' -and $back.source.exists -and -not $back.destination.exists) 'restore failed'
  Assert ([IO.File]::ReadAllText((Join-Path $source 'marker')) -eq 'original') 'restored bytes changed'
  Stop-Helper $lease
  $short=Start-Helper 'Lease' 'gc1' 'up1' 'candidate' 1
  $shortReady=Read-Reply $short;Assert ($shortReady.status -eq 'ready') 'timeout lease did not start'
  Assert ($short.WaitForExit(8000)) 'timeout did not terminate helper'
  $afterTimeout=Start-Helper 'Lease';$afterReady=Read-Reply $afterTimeout
  Assert ($afterReady.status -eq 'ready') 'timeout did not release updater lock'
  Stop-Helper $afterTimeout
  $displaced=Join-Path $root ('.local\update-operations\up1\displaced\'+('a'*32))
  [IO.Directory]::CreateDirectory($displaced)|Out-Null
  [IO.File]::WriteAllText((Join-Path $displaced 'marker'),'displaced')
  [IO.Directory]::CreateDirectory((Join-Path $root '.local\storage-quarantine\gc2'))|Out-Null
  $displacedLease=Start-Helper 'Lease' 'gc2' 'up1' 'displaced';$d=Read-Reply $displacedLease
  Assert ($d.status -eq 'ready' -and $d.source.exists) 'displaced lease not ready'
  $dm=Send $displacedLease @{command='move';from='source';expectedIdentity=$d.source.identity}
  Assert ($dm.status -eq 'ok' -and $dm.destination.exists) 'displaced move failed'
  $dr=Send $displacedLease @{command='move';from='destination';expectedIdentity=$dm.destination.identity}
  Assert ($dr.status -eq 'ok' -and $dr.source.exists) 'displaced restore failed'
  Assert ([IO.File]::ReadAllText((Join-Path $displaced 'marker')) -eq 'displaced') 'displaced bytes changed'
  Stop-Helper $displacedLease
  $other=Join-Path $root 'elsewhere';[IO.Directory]::CreateDirectory($other)|Out-Null
  $junction=Join-Path $root '.local\update-operations\up2'
  New-Item -ItemType Junction -Path $junction -Target $other|Out-Null
  $linked=Start-Helper 'Inspect' 'gc1' 'up2';$bad=Read-Reply $linked
  Assert ($bad.status -eq 'error' -and $bad.code -match 'REPARSE_POINT_REFUSED') 'linked ancestor accepted'
  Stop-Helper $linked
  Write-Output 'PASS disposable native lease, collision, move, restore, lock, reparse and read-only inspect'
} finally {
  foreach($child in $script:children) { if(-not $child.HasExited) { $child.Kill();$child.WaitForExit() };$child.Dispose() }
  $cleanupTarget=[IO.Path]::GetFullPath($root)
  $cleanupParent=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
  if(-not $cleanupTarget.StartsWith($cleanupParent,[StringComparison]::OrdinalIgnoreCase) -or
     [IO.Path]::GetFileName($cleanupTarget) -notmatch '^wb-retention-maintenance-[a-f0-9]{32}$') { throw 'Unsafe fixture cleanup target' }
  if([IO.Directory]::Exists($cleanupTarget)) { Remove-Item -LiteralPath $cleanupTarget -Recurse -Force }
}
