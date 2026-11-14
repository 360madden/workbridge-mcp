#requires -Version 5.1
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public static class NativePurgeFixtureApi {
  [DllImport("kernel32.dll",EntryPoint="DeleteFileW",CharSet=CharSet.Unicode,SetLastError=true)]
  public static extern bool Delete(string path);
}
'@
$helper=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\scripts\Storage-RetentionPurge.ps1'))
$maintenance=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\scripts\Storage-RetentionMaintenance.ps1'))
$root=Join-Path ([IO.Path]::GetTempPath()) ('wb-native-purge-fixture-'+[Guid]::NewGuid().ToString('N'))
$children=[Collections.Generic.List[Diagnostics.Process]]::new()
function Check($condition,[string]$message) { if(-not $condition) { throw $message } }
function Save-Json([string]$path,$value) {
  $text=($value|ConvertTo-Json -Compress -Depth 12)+"`n"
  [IO.File]::WriteAllText($path,$text,[Text.UTF8Encoding]::new($false))
  $sha=[Security.Cryptography.SHA256]::Create()
  try {return [BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($path))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
}
function Start-Worker([string]$script,[string]$arguments) {
  $info=[Diagnostics.ProcessStartInfo]::new();$info.FileName=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $info.Arguments='-NoLogo -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File "'+$script+'" '+$arguments
  $info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
  $info.StandardOutputEncoding=[Text.UTF8Encoding]::new($false)
  $p=[Diagnostics.Process]::Start($info);$children.Add($p);return $p
}
function Receive($p) {
  $task=$p.StandardOutput.ReadLineAsync();if(-not $task.Wait(15000)){throw 'worker timeout'}
  if($null -eq $task.Result){throw ('worker closed: '+$p.StandardError.ReadToEnd())};return $task.Result|ConvertFrom-Json
}
function Send($p,$value) { $p.StandardInput.WriteLine(($value|ConvertTo-Json -Compress -Depth 8));$p.StandardInput.Flush();return Receive $p }
try {
  $operationDir=Join-Path $root '.local\storage-quarantine\gc1'
  $payload=Join-Path $operationDir 'payload';$sourceParent=Join-Path $root '.local\update-operations\up1'
  [IO.Directory]::CreateDirectory((Join-Path $payload 'dir'))|Out-Null
  [IO.Directory]::CreateDirectory($sourceParent)|Out-Null
  [IO.File]::WriteAllText((Join-Path $payload 'a.txt'),'alpha')
  [IO.File]::WriteAllText((Join-Path $payload 'dir\b.txt'),'bravo')
  $baseArgs='-InstallRoot "'+$root+'" -OperationId gc1 -UpdaterOperationId up1 -Kind candidate'
  $inventoryWorker=Start-Worker $maintenance ('-Mode Inventory '+$baseArgs)
  $snapshot=Receive $inventoryWorker;Check ($snapshot.status -eq 'ready') ('inventory failed: '+($snapshot|ConvertTo-Json -Compress -Depth 8))
  $inventoryWorker.WaitForExit();$expectedRoot=$snapshot.destination.identity
  $entries=@($snapshot.inventory.entries|Sort-Object -Property path)
  $plan=[ordered]@{schema='workbridge-retention-plan/1';host=[Environment]::MachineName;installRoot=$root;updaterOperationId='up1';kind='candidate';displacedId=$null;sourceIdentity=$expectedRoot;manifestSha256=('a'*64);retainedBindingSha256=('b'*64);metadataSha256=('c'*64);referencesSha256=('d'*64);sourceTreeSha256=('e'*64)}
  $sortedPlan=[ordered]@{displacedId=$plan.displacedId;host=$plan.host;installRoot=$plan.installRoot;kind=$plan.kind;manifestSha256=$plan.manifestSha256;metadataSha256=$plan.metadataSha256;referencesSha256=$plan.referencesSha256;retainedBindingSha256=$plan.retainedBindingSha256;schema=$plan.schema;sourceIdentity=[ordered]@{id=$expectedRoot.id;volume=$expectedRoot.volume};sourceTreeSha256=$plan.sourceTreeSha256;updaterOperationId=$plan.updaterOperationId}
  $hasher=[Security.Cryptography.SHA256]::Create()
  try { $planHash=[BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes(($sortedPlan|ConvertTo-Json -Compress -Depth 8)))).Replace('-','').ToLowerInvariant() } finally { $hasher.Dispose() }
  [void](Save-Json (Join-Path $operationDir 'intent.json') ([ordered]@{schema='workbridge-retention-intent/1';operationId='gc1';planSha256=$planHash;plan=$plan}))
  $quarantineHash=Save-Json (Join-Path $operationDir 'quarantined.json') ([ordered]@{schema='workbridge-retention-phase/2';operationId='gc1';planSha256=$planHash;phase='quarantined';publishedAtUtc='2020-01-01T00:00:00.000Z'})
  $manifestHash=Save-Json (Join-Path $operationDir 'purge-manifest.json') ([ordered]@{schema='workbridge-purge-manifest/1';operationId='gc1';planSha256=$planHash;quarantineReceiptSha256=$quarantineHash;expectedRoot=$expectedRoot;entries=$entries})
  $purgeHash=Save-Json (Join-Path $operationDir 'purge-approval.json') ([ordered]@{schema='workbridge-purge-approval/1';operationId='gc1';planSha256=$planHash;quarantineReceiptSha256=$quarantineHash;manifestSha256=$manifestHash;referencesSha256=('d'*64);retainedProofSha256=('e'*64)})
  $purging=[ordered]@{schema='workbridge-purging/1';operationId='gc1';planSha256=$planHash;purgeSha256=$purgeHash;manifestSha256=$manifestHash;entryCount=$entries.Count;batchLimit=32}
  $batchIntent=[ordered]@{schema='workbridge-purge-batch/1';operationId='gc1';purgeSha256=$purgeHash;manifestSha256=$manifestHash;start=0;end=$entries.Count}
  $adapterCheck=Join-Path $root 'adapter-check.mjs'
  $probe=@'
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [repo, root, approval, manifest] = process.argv.slice(2);
const helper = path.join(repo,'scripts','Storage-RetentionPurge.ps1');
const expectedHelperSha256 = createHash('sha256').update(await readFile(helper)).digest('hex');
const { createPurgeProvider } = await import(pathToFileURL(path.join(repo,'scripts','storage-retention-purge-provider.mjs')));
const provider = createPurgeProvider();
const ctx = {installRoot:root,operationId:'gc1',plan:{updaterOperationId:'up1',kind:'candidate'},maintenanceConfirmed:true,confirmPermanentlyDelete:'gc1',expectedPurgeSha256:approval,expectedManifestSha256:manifest,expectedHelperSha256};
await provider.withPurgeLease(ctx, async guard => {
  const files=await guard.readJournals();
  if (!files['purge-manifest.json'] || !files['purge-approval.json']) throw Error('missing pinned journals');
  const result=await guard.inspectRemaining({committedPrefix:0,inflightEnd:null});
  if (result.status!=='ok' || result.remaining.observedAbsentPrefix!==0) throw Error('initial inspection failed');
});
'@
  [IO.File]::WriteAllText($adapterCheck,$probe,[Text.UTF8Encoding]::new($false))
  & node $adapterCheck (Split-Path $PSScriptRoot -Parent) $root $purgeHash $manifestHash
  Check ($LASTEXITCODE -eq 0) 'Node provider integration failed'
  $purgeArgs=$baseArgs+' -ExpectedPurgeSha256 '+$purgeHash+' -ExpectedManifestSha256 '+$manifestHash+' -ConfirmPermanentlyDelete gc1 -MaintenanceConfirmed'
  $worker=Start-Worker $helper $purgeArgs;$ready=Receive $worker
  Check ($ready.status -eq 'ready') ('purge helper failed: '+($ready|ConvertTo-Json -Compress -Depth 8))
  $unknownJournal=Join-Path $operationDir 'purging-v2.json'
  [IO.File]::WriteAllText($unknownJournal,'{}')
  $unknownReply=Send $worker @{command='readJournals'}
  Check ($unknownReply.status -eq 'error') 'unknown purge namespace record was hidden'
  [IO.File]::Delete($unknownJournal)
  $initialDocs=Send $worker @{command='readJournals'}
  Check ($initialDocs.status -eq 'ok' -and $initialDocs.files.'purge-manifest.json' -ceq [IO.File]::ReadAllText((Join-Path $operationDir 'purge-manifest.json'))) 'journal read did not preserve manifest bytes'
  $withoutIntent=Send $worker @{command='deleteBatch';start=0;end=$entries.Count}
  Check ($withoutIntent.status -eq 'error' -and [IO.File]::Exists((Join-Path $payload 'a.txt'))) 'purge proceeded before durable intent'
  $published=Send $worker @{command='publish';kind='purging';record=$purging}
  Check ($published.status -eq 'ok') ('purging publish failed: '+($published|ConvertTo-Json -Compress))
  $duplicate=Send $worker @{command='publish';kind='purging';record=$purging}
  Check ($duplicate.status -eq 'error') 'duplicate purging marker overwrote existing marker'
  $published=Send $worker @{command='publish';kind='intent';record=$batchIntent}
  Check ($published.status -eq 'ok') ('batch publish failed: '+($published|ConvertTo-Json -Compress))
  $initial=Send $worker @{command='inspectRemaining';committedPrefix=0;inflightEnd=$entries.Count}
  Check ($initial.status -eq 'ok' -and $initial.remaining.observedAbsentPrefix -eq 0) ('initial inspect failed: '+($initial|ConvertTo-Json -Compress -Depth 8))
  $range=Send $worker @{command='deleteBatch';start=0;end=($entries.Count-1)}
  Check ($range.status -eq 'error') 'unbound batch range accepted'
  $extra=Join-Path $payload 'unexpected.txt';[IO.File]::WriteAllText($extra,'unknown')
  $extraResult=Send $worker @{command='deleteBatch';start=0;end=$entries.Count}
  Check ($extraResult.status -eq 'error') 'unexpected entry did not refuse'
  Check ([IO.File]::Exists((Join-Path $payload 'a.txt')) -and [IO.File]::Exists((Join-Path $payload 'dir\b.txt'))) 'extra entry caused partial deletion'
  [IO.File]::Delete($extra)
  $junction=Join-Path $payload 'junction';$outside=Join-Path $root 'outside';[IO.Directory]::CreateDirectory($outside)|Out-Null
  New-Item -ItemType Junction -Path $junction -Target $outside|Out-Null
  $linkResult=Send $worker @{command='deleteBatch';start=0;end=$entries.Count}
  Check ($linkResult.status -eq 'error' -and [IO.File]::Exists((Join-Path $payload 'a.txt'))) 'junction did not refuse'
  [IO.Directory]::Delete($junction)
  $hard=Join-Path $payload 'hardlink';New-Item -ItemType HardLink -Path $hard -Target (Join-Path $payload 'a.txt')|Out-Null
  $hardResult=Send $worker @{command='deleteBatch';start=0;end=$entries.Count}
  Check ($hardResult.status -eq 'error' -and [IO.File]::Exists((Join-Path $payload 'a.txt'))) 'hardlink did not refuse'
  [IO.File]::Delete($hard)
  Set-Content -LiteralPath $payload -Stream 'unlisted' -Value 'unique stream'
  $streamResult=Send $worker @{command='deleteBatch';start=0;end=$entries.Count}
  Check ($streamResult.status -eq 'error' -and [IO.File]::Exists((Join-Path $payload 'a.txt'))) 'directory stream did not refuse'
  Check ([NativePurgeFixtureApi]::Delete($payload+':unlisted')) 'fixture stream cleanup failed'
  [IO.File]::WriteAllText((Join-Path $payload 'a.txt'),'wrong')
  $changed=Send $worker @{command='deleteBatch';start=0;end=$entries.Count}
  Check ($changed.status -eq 'error') 'changed file did not refuse'
  Check ([IO.File]::Exists((Join-Path $payload 'dir\b.txt'))) 'changed file caused partial deletion'
  [IO.File]::WriteAllText((Join-Path $payload 'a.txt'),'alpha')
  $originalSource=Join-Path $sourceParent 'candidate';[IO.Directory]::CreateDirectory($originalSource)|Out-Null
  $sourceResult=Send $worker @{command='deleteBatch';start=0;end=$entries.Count}
  Check ($sourceResult.status -eq 'error' -and $sourceResult.code -match 'SOURCE_PRESENT') 'original source did not block purge'
  [IO.Directory]::Delete($originalSource)
  $writeBlocked=$false
  try {[IO.File]::WriteAllText((Join-Path $operationDir 'purge-manifest.json'),'changed')}catch{$writeBlocked=$true}
  Check $writeBlocked 'manifest was not pinned against mutation'
  $outOfOrder=Join-Path $root 'held-a.txt'
  [IO.File]::Move((Join-Path $payload 'a.txt'),$outOfOrder)
  $badCut=Send $worker @{command='inspectRemaining';committedPrefix=0;inflightEnd=$entries.Count}
  Check ($badCut.status -eq 'error') 'noncontiguous missing item was accepted'
  [IO.File]::Move($outOfOrder,(Join-Path $payload 'a.txt'))
  $firstRemoved=Join-Path $root 'held-b.txt'
  [IO.File]::Move((Join-Path $payload 'dir\b.txt'),$firstRemoved)
  $resume=Send $worker @{command='inspectRemaining';committedPrefix=0;inflightEnd=$entries.Count}
  Check ($resume.status -eq 'ok' -and $resume.remaining.observedAbsentPrefix -eq 1) ('interrupted batch not reconciled: '+($resume|ConvertTo-Json -Compress -Depth 8))
  $result=Send $worker @{command='deleteBatch';start=0;end=$entries.Count}
  Check ($result.status -eq 'ok' -and $result.firstIndex -eq 1 -and $result.removedCount -eq ($entries.Count-1)) ('resume batch failed: '+($result|ConvertTo-Json -Compress -Depth 8))
  Check (-not [IO.Directory]::Exists($payload)) 'payload still present after purge'
  Check ([IO.File]::Exists((Join-Path $operationDir 'purge-manifest.json'))) 'journal was deleted'
  $done=[ordered]@{schema='workbridge-purge-batch-done/1';operationId='gc1';purgeSha256=$purgeHash;manifestSha256=$manifestHash;start=0;end=$entries.Count;priorAbsent=1;observedRemoved=($entries.Count-1)}
  $doneResult=Send $worker @{command='publish';kind='done';record=$done}
  Check ($doneResult.status -eq 'ok') ('done publish failed: '+($doneResult|ConvertTo-Json -Compress))
  $final=[ordered]@{schema='workbridge-purged/1';operationId='gc1';planSha256=$planHash;purgeSha256=$purgeHash;manifestSha256=$manifestHash;entryCount=$entries.Count;logicalBytesRemoved=10}
  $finalResult=Send $worker @{command='publish';kind='purged';record=$final}
  Check ($finalResult.status -eq 'ok') ('purged publish failed: '+($finalResult|ConvertTo-Json -Compress))
  $docs=Send $worker @{command='readJournals'}
  Check ($docs.status -eq 'ok' -and $docs.files.'purged.json'.EndsWith("`n")) 'published ledger missing or newline absent'
  $worker.StandardInput.Close();$worker.WaitForExit()
  Write-Output 'PASS disposable native purge postorder and fixed journal binding'
} finally {
  foreach($p in $children){if(-not $p.HasExited){$p.Kill();$p.WaitForExit()};$p.Dispose()}
  if([IO.Directory]::Exists($root)){Remove-Item -LiteralPath $root -Recurse -Force}
}
