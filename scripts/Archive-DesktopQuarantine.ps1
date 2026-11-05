#requires -Version 5.1
<#
  Workbridge manual desktop-turn quarantine archival.
  Without -Execute this is STRICTLY read-only. With -Execute it creates a separate
  cross-producer maintenance admission, pins two existing file handles, saves
  immutable copies, and renames the sidecar FIRST and GUI guard LAST.
  Never decides that the historic GUI operation succeeded or replays it.
  Designed for a single, operator-reviewed one-shot execution on Windows NTFS.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$EvidenceRoot,
    [Parameter(Mandatory=$true)][string]$ExpectedLockSha256,
    [Parameter(Mandatory=$true)][string]$ExpectedSidecarSha256,
    [Parameter(Mandatory=$true)][string]$ExpectedLeaseId,
    [Parameter(Mandatory=$true)][string]$ExpectedRequestId,
    [Parameter(Mandatory=$true)][string]$OperationId,
    [switch]$Execute,
    # Only accepted against a disposable fixture under the OS temp directory.
    [ValidateSet('none','before-sidecar','after-sidecar','after-guard')]
    [string]$TestStopStage='none',
    [switch]$TestSidecarTargetCollision,
    [string]$TestCensusJson
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# This intentionally does not alter the shared scripts/desktop-turn-admission.mjs.
# It acquires the same exclusive Win32 CREATE_NEW pathname and writes an
# interoperable workbridge.gui-admission maintenance stamp. The handle is held
# until success; any crash/error leaves the separate admission file blocking.
$win32 = @'
using System;
using System.IO;
using System.Text;
using System.Security.Cryptography;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public static class WorkbridgeArchiveWin32 {
  const uint GENERIC_READ=0x80000000, GENERIC_WRITE=0x40000000, DELETE=0x10000;
  const uint FILE_SHARE_READ=1, CREATE_NEW=1, OPEN_EXISTING=3;
  const uint FILE_ATTRIBUTE_NORMAL=0x80, FILE_FLAG_OPEN_REPARSE_POINT=0x200000;
  const uint FILE_ATTRIBUTE_REPARSE_POINT=0x400;
  const int FileRenameInfo=3, FileDispositionInfo=4, FileStandardInfo=1, FileAttributeTagInfo=9, FileIdInfo=18;

  [StructLayout(LayoutKind.Sequential)] struct FileStandard {
    public long AllocationSize, EndOfFile;
    public uint NumberOfLinks;
    public byte DeletePending; // native BOOLEAN: one byte, not 4-byte BOOL
    public byte Directory;
  }
  [StructLayout(LayoutKind.Sequential)] struct FileTag {
    public uint FileAttributes, ReparseTag;
  }
  [StructLayout(LayoutKind.Sequential)] struct FileId {
    public ulong VolumeSerialNumber;
    [MarshalAs(UnmanagedType.ByValArray, SizeConst=16)] public byte[] Identifier;
  }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct RenameHeader {
    public byte ReplaceIfExists;
    public IntPtr RootDirectory;
    public uint FileNameLength;
    public char FileName;
  }
  [StructLayout(LayoutKind.Sequential)] struct Disposition {
    [MarshalAs(UnmanagedType.Bool)] public bool DeleteFile;
  }
  [DllImport("kernel32.dll", EntryPoint="CreateFileW", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security,
    uint disposition, uint attributes, IntPtr template);
  [DllImport("kernel32.dll", EntryPoint="GetFileInformationByHandleEx", SetLastError=true)]
  static extern bool GetStandard(SafeFileHandle h, int infoClass, out FileStandard info, uint cb);
  [DllImport("kernel32.dll", EntryPoint="GetFileInformationByHandleEx", SetLastError=true)]
  static extern bool GetTag(SafeFileHandle h, int infoClass, out FileTag info, uint cb);
  [DllImport("kernel32.dll", EntryPoint="GetFileInformationByHandleEx", SetLastError=true)]
  static extern bool GetId(SafeFileHandle h, int infoClass, out FileId info, uint cb);
  [DllImport("kernel32.dll", EntryPoint="SetFileInformationByHandle", SetLastError=true)]
  static extern bool SetInfo(SafeFileHandle h, int infoClass, IntPtr buffer, uint cb);
  [DllImport("kernel32.dll", EntryPoint="SetFileInformationByHandle", SetLastError=true)]
  static extern bool SetDisposition(SafeFileHandle h, int infoClass, ref Disposition info, uint cb);
  [DllImport("kernel32.dll", EntryPoint="CreateDirectoryW", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool CreateDirectory(string path, IntPtr security);
  [DllImport("kernel32.dll", EntryPoint="GetFileAttributesW", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern uint GetFileAttributes(string path);

  static Exception Error(string label) { return new IOException(label+" WIN32="+Marshal.GetLastWin32Error()); }
  public static void CreateDirectoryExclusive(string path) {
    if(!CreateDirectory(path,IntPtr.Zero)) throw Error("ARCHIVE_DIRECTORY_NOT_EXCLUSIVE");
  }
  public static bool DefinitelyAbsent(string path) {
    uint attrs=GetFileAttributes(path);
    if(attrs!=0xffffffff)return false;
    int error=Marshal.GetLastWin32Error();
    if(error!=2 && error!=3)throw Error("ORIGINAL_ABSENCE_UNPROVED");
    return true;
  }
  public static string Fingerprint(byte[] bytes) {
    using(var sha=SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-","").ToLowerInvariant();
  }
  public sealed class OpenFile : IDisposable {
    public readonly string OriginalPath;
    public readonly string Identity;
    public readonly byte[] Bytes;
    public readonly string Sha256;
    private readonly FileStream _stream;
    private bool _disposed;
    private OpenFile(string path, FileStream stream, string id, byte[] bytes) {
      OriginalPath=path;_stream=stream;Identity=id;Bytes=bytes;Sha256=Fingerprint(bytes);
    }
    public static OpenFile OpenPinned(string path) {
      SafeFileHandle h=CreateFile(path,GENERIC_READ|DELETE,FILE_SHARE_READ,IntPtr.Zero,
        OPEN_EXISTING,FILE_ATTRIBUTE_NORMAL|FILE_FLAG_OPEN_REPARSE_POINT,IntPtr.Zero);
      if(h.IsInvalid) { h.Dispose(); throw Error("SOURCE_OPEN_REFUSED"); }
      FileStream stream=null;
      try {
        FileStandard std; FileTag tag; FileId id;
        if(!GetStandard(h,FileStandardInfo,out std,(uint)Marshal.SizeOf(typeof(FileStandard))) ||
           !GetTag(h,FileAttributeTagInfo,out tag,(uint)Marshal.SizeOf(typeof(FileTag))) ||
           !GetId(h,FileIdInfo,out id,(uint)Marshal.SizeOf(typeof(FileId)))) throw Error("FILE_ID_UNAVAILABLE");
        if(std.Directory!=0 || std.DeletePending!=0 || std.NumberOfLinks!=1 ||
           (tag.FileAttributes&FILE_ATTRIBUTE_REPARSE_POINT)!=0 || std.EndOfFile<2 || std.EndOfFile>4096)
          throw new IOException("SOURCE_NOT_ORDINARY_UNLINKED_OR_OVERSIZE");
        if(id.Identifier==null || id.Identifier.Length!=16 || ZeroId(id.Identifier))
          throw new IOException("SOURCE_ID_UNRELIABLE");
        stream=new FileStream(h,FileAccess.Read,4096,false);
        byte[] bytes=new byte[(int)std.EndOfFile];
        int count=0;
        while(count<bytes.Length){int n=stream.Read(bytes,count,bytes.Length-count);if(n==0)break;count+=n;}
        if(count!=bytes.Length || stream.Length!=bytes.Length)throw new IOException("SOURCE_BYTES_CHANGED");
        string identity=id.VolumeSerialNumber.ToString("x16")+":"+BitConverter.ToString(id.Identifier).Replace("-","");
        return new OpenFile(path,stream,identity,bytes);
      } catch {if(stream!=null)stream.Dispose();else h.Dispose();throw;}
    }
    static bool ZeroId(byte[] b) {foreach(byte x in b)if(x!=0)return false;return true;}
    public string FreshIdentity(){
      FileId id;
      if(!GetId(_stream.SafeFileHandle,FileIdInfo,out id,(uint)Marshal.SizeOf(typeof(FileId))))
        throw Error("SOURCE_ID_LOST");
      return id.VolumeSerialNumber.ToString("x16")+":"+BitConverter.ToString(id.Identifier).Replace("-","");
    }
    public void RenameNoReplace(string destination) {
      if(_disposed || FreshIdentity()!=Identity)throw new IOException("SOURCE_HANDLE_ID_CHANGED");
      if(!Path.IsPathRooted(destination))throw new IOException("DESTINATION_NOT_ABSOLUTE");
      byte[] name=Encoding.Unicode.GetBytes(destination);
      int offset=(int)Marshal.OffsetOf(typeof(RenameHeader),"FileName");
      IntPtr buffer=Marshal.AllocHGlobal(offset+name.Length+2);
      try {
        for(int i=0;i<offset+name.Length+2;i++)Marshal.WriteByte(buffer,i,0);
        Marshal.WriteByte(buffer,0,0); // ReplaceIfExists=false; never overwrite.
        Marshal.WriteIntPtr(buffer,(int)Marshal.OffsetOf(typeof(RenameHeader),"RootDirectory"),IntPtr.Zero);
        Marshal.WriteInt32(buffer,(int)Marshal.OffsetOf(typeof(RenameHeader),"FileNameLength"),name.Length);
        Marshal.Copy(name,0,IntPtr.Add(buffer,offset),name.Length);
        if(!SetInfo(_stream.SafeFileHandle,FileRenameInfo,buffer,(uint)(offset+name.Length+2)))
          throw Error("HANDLE_RENAME_NO_REPLACE_FAILED");
      } finally {Marshal.FreeHGlobal(buffer);}
      if(FreshIdentity()!=Identity)throw new IOException("RENAMED_HANDLE_ID_CHANGED");
    }
    public void Dispose(){if(!_disposed){_stream.Dispose();_disposed=true;}}
  }

  public sealed class Admission : IDisposable {
    public readonly string Pathname;
    private readonly FileStream _stream;
    private readonly byte[] _bytes;
    bool _closed;
    private Admission(string path,FileStream stream,byte[] bytes){Pathname=path;_stream=stream;_bytes=bytes;}
    public static Admission Acquire(string path,string stamp){
      byte[] bytes=Encoding.UTF8.GetBytes(stamp+"\n");
      if(bytes.Length>4096)throw new IOException("ADMISSION_TOO_LARGE");
      var h=CreateFile(path,GENERIC_READ|GENERIC_WRITE|DELETE,FILE_SHARE_READ,IntPtr.Zero,
        CREATE_NEW,FILE_ATTRIBUTE_NORMAL,IntPtr.Zero);
      if(h.IsInvalid){h.Dispose();throw Error("UI_TURN_BUSY_OR_ADMISSION_CREATE_FAILED");}
      FileStream stream=new FileStream(h,FileAccess.ReadWrite,4096,false);
      try {stream.Write(bytes,0,bytes.Length);stream.Flush(true);return new Admission(path,stream,bytes);}
      catch{stream.Dispose();throw;} // The created stamp remains blocking.
    }
    public void ReleaseOwned(){
      if(_closed)throw new IOException("ADMISSION_ALREADY_CLOSED");
      _stream.Position=0;byte[] found=new byte[_bytes.Length];int read=0;
      while(read<found.Length){int n=_stream.Read(found,read,found.Length-read);if(n<=0)break;read+=n;}
      if(read!=found.Length || _stream.Length!=_bytes.Length || !SameBytes(found,_bytes))
        throw new IOException("ADMISSION_STAMP_CHANGED");
      var disposition=new Disposition{DeleteFile=true};
      if(!SetDisposition(_stream.SafeFileHandle,FileDispositionInfo,ref disposition,
        (uint)Marshal.SizeOf(typeof(Disposition))))throw Error("ADMISSION_HANDLE_DELETE_REFUSED");
      _stream.Dispose();_closed=true;
      if(File.Exists(Pathname))throw new IOException("ADMISSION_NAME_REMAINS");
    }
    static bool SameBytes(byte[] a,byte[] b) {
      if(a.Length!=b.Length)return false;
      for(int i=0;i<a.Length;i++)if(a[i]!=b[i])return false;
      return true;
    }
    public void Dispose(){if(!_closed){_stream.Dispose();_closed=true;}} // crash/error => retained pathname
  }
}
'@

function Reject([string]$code) { throw [InvalidOperationException]::new($code) }
function Hash([byte[]]$bytes) { return [WorkbridgeArchiveWin32]::Fingerprint($bytes) }
function Write-NewBytes([string]$path,[byte[]]$bytes) {
    $f=[IO.FileStream]::new($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
    try { $f.Write($bytes,0,$bytes.Length);$f.Flush($true) }finally{$f.Dispose()}
}
function Write-Journal([string]$path,[string]$stage,[string]$detail='') {
    $record=[ordered]@{ utc=[DateTime]::UtcNow.ToString('o'); stage=$stage; detail=$detail }
    $bytes=[Text.UTF8Encoding]::new($false).GetBytes(($record|ConvertTo-Json -Compress)+"`n")
    $f=[IO.FileStream]::new($path,[IO.FileMode]::Append,[IO.FileAccess]::Write,[IO.FileShare]::Read)
    try{$f.Write($bytes,0,$bytes.Length);$f.Flush($true)}finally{$f.Dispose()}
}
function Assert-DirectoryTreeOrdinary([string]$path) {
    $cursor=[IO.Path]::GetFullPath($path)
    while($true){
        if(-not [IO.Directory]::Exists($cursor)){Reject 'DIRECTORY_MISSING'}
        $item=Get-Item -LiteralPath $cursor -Force
        if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){Reject 'DIRECTORY_REPARSE'}
        $parent=[IO.Directory]::GetParent($cursor)
        if($null -eq $parent){break}
        $cursor=$parent.FullName
    }
}
function Assert-DesktopQuiescent {
    # Only sanitized counts enter errors or returned evidence. Raw process
    # CommandLine and scheduled-task action arguments are never printed/logged.
    if(-not [string]::IsNullOrEmpty($TestCensusJson)){
        $snapshot=[IO.File]::ReadAllText($TestCensusJson)|ConvertFrom-Json
        if($snapshot.synthetic -cne $true -or $snapshot.schemaVersion -ne 1){Reject 'TEST_CENSUS_INVALID'}
        [int]$processCandidates=$snapshot.guiProcessCount
        [int]$taskCandidates=$snapshot.enabledGuiTaskCount
        [int]$uninspectableCli=$snapshot.uninspectableProcessCount
    }else{
        $start=[DateTime]::UtcNow
        $procs=@(Get-CimInstance Win32_Process -Property ProcessId,Name,CommandLine,CreationDate,SessionId -ErrorAction Stop)
        if($procs.Count -lt 1 -or $procs.Count -gt 5000){Reject 'GUI_PROCESS_CENSUS_INCOMPLETE'}
        [int]$processCandidates=0
        [int]$uninspectableCli=0
        foreach($p in $procs){
            if([int]$p.ProcessId -eq $PID){continue}
            $name=[string]$p.Name
            $isScriptHost=($name -match '^(node|nodejs|powershell|pwsh|cmd|dotnet)\.exe$')
            if($isScriptHost -and [string]::IsNullOrWhiteSpace([string]$p.CommandLine)){
                $uninspectableCli++
                continue
            }
            if($name -match '^(DesktopProbeWatchdog|DesktopProbe|winapp|WinAppCli|winapp-cli)\.exe$' -or
               ($isScriptHost -and
                [string]$p.CommandLine -match '(?i)(desktop-capture|desktop-probe-act|vmware-host-capture)\.mjs')){
                $processCandidates++
            }
        }
        if(([DateTime]::UtcNow - $start).TotalSeconds -gt 20){Reject 'GUI_PROCESS_CENSUS_TIMEOUT'}
        $tasks=@(Get-ScheduledTask -ErrorAction Stop)
        if($tasks.Count -gt 5000){Reject 'GUI_TASK_CENSUS_INCOMPLETE'}
        [int]$taskCandidates=0
        foreach($task in $tasks){
            if([string]$task.State -eq 'Disabled'){continue}
            $named=[string]$task.TaskName -match '(?i)DesktopProbe(Watchdog)?|GUI[-_]?Launcher'
            $actionMatch=$false
            foreach($action in @($task.Actions)){
                # COM and handler actions lack Execute/Arguments; safe metadata
                # property access must not throw under StrictMode.
                $exe='';$args=''
                if($null -ne $action){
                    $exeProperty=$action.PSObject.Properties['Execute']
                    $argsProperty=$action.PSObject.Properties['Arguments']
                    if($null -ne $exeProperty){$exe=[string]$exeProperty.Value}
                    if($null -ne $argsProperty){$args=[string]$argsProperty.Value}
                }
                if($exe -match '(?i)(DesktopProbeWatchdog|DesktopProbe)\.exe$' -or
                   $args -match '(?i)(desktop-capture|desktop-probe-act|vmware-host-capture)\.mjs|DesktopProbeWatchdog'){
                    $actionMatch=$true
                }
            }
            if($named -or $actionMatch){$taskCandidates++}
        }
        if(([DateTime]::UtcNow - $start).TotalSeconds -gt 30){Reject 'GUI_CENSUS_TIMEOUT'}
    }
    if($processCandidates -lt 0 -or $taskCandidates -lt 0 -or $uninspectableCli -lt 0){Reject 'GUI_CENSUS_INVALID_COUNTS'}
    if($processCandidates -ne 0){Reject ('GUI_PRODUCER_PRESENT_COUNT_'+$processCandidates)}
    if($taskCandidates -ne 0){Reject ('ENABLED_GUI_LAUNCHER_COUNT_'+$taskCandidates)}
    if($uninspectableCli -ne 0){Reject ('GUI_POSSIBLE_PRODUCER_UNINSPECTABLE_COUNT_'+$uninspectableCli)}
}

if($ExpectedLockSha256 -cnotmatch '^[a-fA-F0-9]{64}$' -or
   $ExpectedSidecarSha256 -cnotmatch '^[a-fA-F0-9]{64}$'){Reject 'PIN_INVALID'}
if($ExpectedLeaseId -cnotmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') {Reject 'LEASE_INVALID'}
if($ExpectedRequestId -cnotmatch '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$' -or
   $OperationId -cnotmatch '^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$') {Reject 'REQUEST_OR_OPERATION_INVALID'}
$root=[IO.Path]::GetFullPath($EvidenceRoot)
if(-not [IO.Path]::IsPathRooted($EvidenceRoot)) {Reject 'ROOT_NOT_ABSOLUTE'}
Assert-DirectoryTreeOrdinary $root
if($TestStopStage -ne 'none' -or $TestSidecarTargetCollision -or $TestCensusJson){
    $syntheticParent=[IO.Path]::GetDirectoryName($root)
    $temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
    if(-not $syntheticParent.StartsWith(($temp+'\wb-archive-fixtures-'),[StringComparison]::OrdinalIgnoreCase)){
        Reject 'TEST_HOOK_NOT_DISPOSABLE'
    }
}
if(-not ('WorkbridgeArchiveWin32' -as [type])){
    Add-Type -TypeDefinition $win32 -ErrorAction Stop
}
$guardPath=[IO.Path]::Combine($root,'desktop-input-turn.lock')
$sideName='desktop-turn-quarantine-'+$ExpectedLeaseId+'.json'
$sidePath=[IO.Path]::Combine($root,$sideName)
$admissionPath=[IO.Path]::Combine($root,'desktop-turn-admission.lock')
$archiveParent=[IO.Path]::Combine($root,'recovery-archives')
$archiveDir=[IO.Path]::Combine($archiveParent,$OperationId)
$expectedLock=$ExpectedLockSha256.ToLowerInvariant()
$expectedSide=$ExpectedSidecarSha256.ToLowerInvariant()
$maintenance=$null
$lock=$null
$side=$null
$journal=$null
$archivingStarted=$false
$completed=$false
try {
    if($Execute){
        $admissionStamp=([ordered]@{
          schemaVersion=1;kind='workbridge.gui-admission';admissionId=[Guid]::NewGuid().ToString('D');
          mode='maintenance';producer='desktop-maintenance';requestId=$OperationId;
          owner=@{pid=$PID};acquiredUtc=[DateTime]::UtcNow.ToString('o')
        }|ConvertTo-Json -Compress -Depth 4)
        $maintenance=[WorkbridgeArchiveWin32+Admission]::Acquire($admissionPath,$admissionStamp)
    }
    $lock=[WorkbridgeArchiveWin32+OpenFile]::OpenPinned($guardPath)
    $side=[WorkbridgeArchiveWin32+OpenFile]::OpenPinned($sidePath)
    if($lock.Sha256 -cne $expectedLock -or $side.Sha256 -cne $expectedSide){Reject 'EVIDENCE_SHA_DRIFT'}
    $legacy=$([Text.UTF8Encoding]::new($false,$true).GetString($lock.Bytes)|ConvertFrom-Json)
    $q=$([Text.UTF8Encoding]::new($false,$true).GetString($side.Bytes)|ConvertFrom-Json)
    if($legacy.kind -cne 'workbridge.gui-turn' -or $legacy.schemaVersion -ne 1 -or
       $legacy.leaseId -cne $ExpectedLeaseId -or $legacy.requestId -cne $ExpectedRequestId -or
       $q.kind -cne 'workbridge.gui-turn-quarantine' -or $q.schemaVersion -ne 1 -or
       $q.leaseId -cne $ExpectedLeaseId -or $q.requestId -cne $ExpectedRequestId -or
       $q.ownerStampSha256 -cne $lock.Sha256 -or $q.automaticRetryAllowed -cne $false -or
       $q.reasonCode -cne 'DESKTOP_TREE_UNSETTLED' -or $q.processTreeSettlement -cne 'unknown'){
        Reject 'LEASE_SIDECAR_IDENTITY_CONFLICT'
    }
    if($null -ne $q.intentSha256){Reject 'INTENT_RECEIPT_NOT_INSPECTED'}
    $orphans=@(Get-ChildItem -LiteralPath $root -Filter 'desktop-turn-quarantine-*.json' -Force)
    if($orphans.Count -ne 1 -or $orphans[0].Name -cne $sideName){Reject 'UNEXPECTED_QUARANTINE_POPULATION'}
    # A fresh old PID is a stop condition, never proof of historical settlement.
    if([int]$legacy.owner.pid -le 0){Reject 'OLD_OWNER_PID_INVALID'}
    $oldOwner=Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$legacy.owner.pid) -ErrorAction Stop
    if($null -ne $oldOwner){Reject 'HISTORICAL_OWNER_PID_PRESENT'}
    Assert-DesktopQuiescent
    if(-not $Execute){
        [pscustomobject]@{ok=$true;mode='read-only';readyForManualReview=$true;
            guardSha256=$lock.Sha256;sidecarSha256=$side.Sha256;leaseId=$ExpectedLeaseId;
            requestId=$ExpectedRequestId;priorActionOutcome='unknown_outcome';
            releaseEligible=$false;archiveCreated=$false}|ConvertTo-Json -Compress
        return
    }
    if(-not [IO.Directory]::Exists($archiveParent)){
        [WorkbridgeArchiveWin32]::CreateDirectoryExclusive($archiveParent)
    }else{Assert-DirectoryTreeOrdinary $archiveParent}
    [WorkbridgeArchiveWin32]::CreateDirectoryExclusive($archiveDir)
    $backup=[IO.Path]::Combine($archiveDir,'backup')
    $relocated=[IO.Path]::Combine($archiveDir,'relocated')
    [WorkbridgeArchiveWin32]::CreateDirectoryExclusive($backup)
    [WorkbridgeArchiveWin32]::CreateDirectoryExclusive($relocated)
    $journal=[IO.Path]::Combine($archiveDir,'journal.jsonl')
    Write-Journal $journal 'maintenance-admission-held' $OperationId
    $backupGuard=[IO.Path]::Combine($backup,'desktop-input-turn.lock')
    $backupSide=[IO.Path]::Combine($backup,$sideName)
    Write-NewBytes $backupGuard $lock.Bytes
    Write-NewBytes $backupSide $side.Bytes
    if((Hash ([IO.File]::ReadAllBytes($backupGuard))) -cne $expectedLock -or
       (Hash ([IO.File]::ReadAllBytes($backupSide))) -cne $expectedSide){Reject 'BACKUP_HASH_MISMATCH'}
    Write-Journal $journal 'backups-durable'
    $manifest=[ordered]@{
        schemaVersion=1;kind='workbridge.gui-turn-manual-archive';operationId=$OperationId;
        approvalScope='operator-approved-exact-legacy-lease';createdUtc=[DateTime]::UtcNow.ToString('o');
        leaseId=$ExpectedLeaseId;requestId=$ExpectedRequestId;
        priorActionOutcome='unknown_outcome';historicalTreeSettled='unverified';
        automaticRetryAllowed=$false;newActionPerformed=$false;
        guard=@{sha256=$expectedLock;length=$lock.Bytes.Length;fileId=$lock.Identity;name='desktop-input-turn.lock'};
        sidecar=@{sha256=$expectedSide;length=$side.Bytes.Length;fileId=$side.Identity;name=$sideName}
    }
    Write-NewBytes ([IO.Path]::Combine($archiveDir,'manifest.json')) ([Text.UTF8Encoding]::new($false).GetBytes(($manifest|ConvertTo-Json -Depth 7)+"`n"))
    Write-Journal $journal 'manifest-durable'
    $archivingStarted=$true
    if($TestStopStage -eq 'before-sidecar'){Reject 'TEST_STOP_BEFORE_SIDECAR'}
    # Pinned-by-handle, no-replace same-volume sidecar rename. Old guard remains.
    $sideDestination=[IO.Path]::Combine($relocated,$sideName)
    if($TestSidecarTargetCollision){Write-NewBytes $sideDestination ([Text.Encoding]::UTF8.GetBytes('occupied'))}
    $side.RenameNoReplace($sideDestination)
    Write-Journal $journal 'sidecar-relocated'
    if($TestStopStage -eq 'after-sidecar'){Reject 'TEST_STOP_AFTER_SIDECAR'}
    if([IO.File]::Exists($sidePath) -or -not [IO.File]::Exists($guardPath)){Reject 'SIDECAR_STAGE_MISMATCH'}
    if($side.FreshIdentity() -cne $side.Identity -or $lock.FreshIdentity() -cne $lock.Identity){Reject 'SIDE_STAGE_ID_CHANGED'}
    if(-not [IO.File]::Exists($sideDestination)){Reject 'SIDE_STAGE_DESTINATION_MISSING'}
    # The original DELETE-access handle remains open. Opening a second pathname
    # reader without FILE_SHARE_DELETE could fail even though the rename succeeded.
    # Inspect the held handle now, then reopen the archive after both handles close.
    # Final commit point: do not move the guard until the archived sidecar is verified.
    Assert-DesktopQuiescent
    $lockDestination=[IO.Path]::Combine($relocated,'desktop-input-turn.lock')
    $lock.RenameNoReplace($lockDestination)
    Write-Journal $journal 'guard-relocated-commit'
    if($TestStopStage -eq 'after-guard'){Reject 'TEST_STOP_AFTER_GUARD'}
    if(-not [WorkbridgeArchiveWin32]::DefinitelyAbsent($guardPath) -or
       -not [WorkbridgeArchiveWin32]::DefinitelyAbsent($sidePath)){Reject 'ORIGINAL_NAME_STILL_PRESENT'}
    if($lock.FreshIdentity() -cne $lock.Identity -or $side.FreshIdentity() -cne $side.Identity){Reject 'RELOCATED_FILE_ID_CHANGED'}
    $side.Dispose();$side=$null
    $lock.Dispose();$lock=$null
    $verifiedSide=[WorkbridgeArchiveWin32+OpenFile]::OpenPinned($sideDestination)
    try {
        if($verifiedSide.Identity -cne $manifest.sidecar.fileId -or $verifiedSide.Sha256 -cne $expectedSide){
            Reject 'SIDE_ARCHIVE_IDENTITY_OR_SHA_MISMATCH'
        }
    }finally{$verifiedSide.Dispose()}
    $verifiedLock=[WorkbridgeArchiveWin32+OpenFile]::OpenPinned($lockDestination)
    try {
        if($verifiedLock.Identity -cne $manifest.guard.fileId -or $verifiedLock.Sha256 -cne $expectedLock){
            Reject 'GUARD_ARCHIVE_IDENTITY_OR_SHA_MISMATCH'
        }
    }finally{$verifiedLock.Dispose()}
    $newOrphans=@(Get-ChildItem -LiteralPath $root -Filter 'desktop-turn-quarantine-*.json' -Force)
    if($newOrphans.Count -ne 0){Reject 'NEW_UNEXPECTED_QUARANTINE'}
    Write-NewBytes ([IO.Path]::Combine($archiveDir,'completed.json')) ([Text.UTF8Encoding]::new($false).GetBytes((@{
        operationId=$OperationId;completedUtc=[DateTime]::UtcNow.ToString('o');
        originalActionOutcome='unknown_outcome';newActionPerformed=$false
    }|ConvertTo-Json -Compress)+"`n"))
    Write-Journal $journal 'postchecks-completed'
    # One last fresh quiescence and absence barrier under the still-held gate.
    # This also refuses an unexpected legacy entrant since the two renames.
    Assert-DesktopQuiescent
    if(-not [WorkbridgeArchiveWin32]::DefinitelyAbsent($guardPath) -or
       -not [WorkbridgeArchiveWin32]::DefinitelyAbsent($sidePath)){Reject 'ORIGINAL_NAME_REAPPEARED'}
    # The append-only 'postchecks-completed' stage is already durable. Any
    # logging failure AFTER gate release must not falsely report a failed
    # archival transaction and invite an unsafe replay.
    $maintenance.ReleaseOwned()
    $completed=$true
    [pscustomobject]@{ok=$true;mode='archived';archive=$archiveDir;
        guardSha256=$expectedLock;sidecarSha256=$expectedSide;
        priorActionOutcome='unknown_outcome';newActionPerformed=$false}|ConvertTo-Json -Compress
}catch{
    # If anything is ambiguous, preserve the maintenance admission; an operator
    # must inspect the append-only journal and archive. No rollback/retry/replay.
    if($null -ne $journal){try{Write-Journal $journal 'failed-manual-reconciliation' $_.Exception.Message}catch{}}
    throw
}finally{
    if($null -ne $side){$side.Dispose()}
    if($null -ne $lock){$lock.Dispose()}
    if($null -ne $maintenance){$maintenance.Dispose()}
}
