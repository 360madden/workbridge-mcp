#requires -Version 5.1
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidateSet('Inspect','Lease')][string]$Mode,
  [Parameter(Mandatory=$true)][string]$InstallRoot,
  [Parameter(Mandatory=$true)][string]$OperationId,
  [Parameter(Mandatory=$true)][string]$UpdaterOperationId,
  [Parameter(Mandatory=$true)][ValidateSet('candidate','displaced')][string]$Kind,
  [string]$DisplacedId,
  [ValidateRange(1,1800)][int]$TimeoutSeconds=120,
  [switch]$MaintenanceConfirmed
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$WarningPreference='SilentlyContinue'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;
public static class RetentionMaintenanceNative {
  const uint ATTR=0x80, DELETE=0x10000, READ=0x80000000, WRITE=0x40000000;
  const uint SHARE_READ=1, SHARE_WRITE=2, SHARE_DELETE=4, CREATE_NEW=1, EXISTING=3, OPEN_ALWAYS=4;
  const uint OPEN_REPARSE=0x200000, BACKUP=0x2000000, REPARSE=0x400, DIRECTORY=0x10;
  const int StandardInfo=1, TagInfo=9, IdInfo=18, RenameInfo=10;
  [StructLayout(LayoutKind.Sequential)] struct IoStatus { public IntPtr Status; public IntPtr Information; }
  [StructLayout(LayoutKind.Sequential)] struct FileStandard { public long AllocationSize,EndOfFile; public uint NumberOfLinks; public byte DeletePending,Directory; }
  [StructLayout(LayoutKind.Sequential)] struct FileTag { public uint Attributes, Tag; }
  [StructLayout(LayoutKind.Sequential)] struct FileId { public ulong Volume; [MarshalAs(UnmanagedType.ByValArray,SizeConst=16)] public byte[] Id; }
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct RenameHeader { public byte Replace; public IntPtr Root; public uint Length; public char Name; }
  [DllImport("kernel32.dll",EntryPoint="CreateFileW",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle Open(string path,uint access,uint share,IntPtr sec,uint disposition,uint flags,IntPtr template);
  [DllImport("kernel32.dll",EntryPoint="GetFileInformationByHandleEx",SetLastError=true)] static extern bool GetStandard(SafeFileHandle h,int kind,out FileStandard data,uint size);
  [DllImport("kernel32.dll",EntryPoint="GetFileInformationByHandleEx",SetLastError=true)] static extern bool GetTag(SafeFileHandle h,int kind,out FileTag data,uint size);
  [DllImport("kernel32.dll",EntryPoint="GetFileInformationByHandleEx",SetLastError=true)] static extern bool GetId(SafeFileHandle h,int kind,out FileId data,uint size);
  [DllImport("ntdll.dll")] static extern int NtSetInformationFile(SafeFileHandle h,out IoStatus status,IntPtr data,uint size,int kind);
  static IOException Error(string code) { return new IOException(code+" WIN32="+Marshal.GetLastWin32Error()); }
  public static string ReadLineWithTimeout(int timeoutMs) {
    var task=System.Threading.Tasks.Task.Run(() => Console.In.ReadLine());
    if(!task.Wait(timeoutMs))return null;
    return task.Result;
  }
  public sealed class Identity { public string volume {get;set;} public string id {get;set;} }
  public sealed class Observation { public bool exists {get;set;} public Identity identity {get;set;} }
  public sealed class Locations { public Observation source {get;set;} public Observation destination {get;set;} public bool sameVolume {get;set;} }
  static Identity GetIdentity(SafeFileHandle h,bool dir) {
    FileTag tag; FileId id;
    if(!GetTag(h,TagInfo,out tag,(uint)Marshal.SizeOf(typeof(FileTag))) || !GetId(h,IdInfo,out id,(uint)Marshal.SizeOf(typeof(FileId))))throw Error("IDENTITY_UNAVAILABLE");
    if((tag.Attributes&REPARSE)!=0)throw new IOException("REPARSE_POINT_REFUSED");
    if(((tag.Attributes&DIRECTORY)!=0)!=dir)throw new IOException("WRONG_FILE_TYPE");
    bool zero=true; foreach(byte b in id.Id)if(b!=0)zero=false;
    if(zero)throw new IOException("IDENTITY_UNRELIABLE");
    return new Identity { volume=id.Volume.ToString("X16"), id=BitConverter.ToString(id.Id).Replace("-","") };
  }
  static bool Equal(Identity a,Identity b) { return a!=null && b!=null && String.Equals(a.volume,b.volume,StringComparison.OrdinalIgnoreCase) && String.Equals(a.id,b.id,StringComparison.OrdinalIgnoreCase); }
  static SafeFileHandle OpenDir(string path,uint access,bool allowDelete,bool optional) {
    var h=Open(path,access,SHARE_READ|SHARE_WRITE|(allowDelete?SHARE_DELETE:0),IntPtr.Zero,EXISTING,OPEN_REPARSE|BACKUP,IntPtr.Zero);
    if(h.IsInvalid) { int code=Marshal.GetLastWin32Error();h.Dispose();if(optional&&(code==2||code==3))return null;throw new IOException("DIRECTORY_OPEN_FAILED WIN32="+code); }
    try { GetIdentity(h,true);return h; } catch { h.Dispose();throw; }
  }
  public sealed class Lease : IDisposable {
    readonly List<SafeFileHandle> pins=new List<SafeFileHandle>();
    readonly string source,destination,sourceName,volume,operationDirectory,operationId;
    readonly SafeFileHandle sourceParent,destinationParent;
    SafeFileHandle updater; bool disposed;
    SafeFileHandle PinTree(string path,bool optional) {
      string absolute=Path.GetFullPath(path),root=Path.GetPathRoot(absolute),cursor=root;
      SafeFileHandle current=OpenDir(root,ATTR,false,false);pins.Add(current);
      if(!String.Equals(GetIdentity(current,true).volume,volume,StringComparison.OrdinalIgnoreCase))throw new IOException("CROSS_VOLUME");
      foreach(string component in absolute.Substring(root.Length).Split(new char[]{'\\'},StringSplitOptions.RemoveEmptyEntries)) {
        cursor=Path.Combine(cursor,component);current=OpenDir(cursor,ATTR,false,optional);
        if(current==null)return null;
        pins.Add(current);
        if(!String.Equals(GetIdentity(current,true).volume,volume,StringComparison.OrdinalIgnoreCase))throw new IOException("CROSS_VOLUME");
      }
      return current;
    }
    public Lease(string installRoot,string operationId,string updaterId,string kind,string displacedId,bool takeLock) {
      sourceName=kind=="candidate"?"candidate":displacedId;
      string op=Path.Combine(installRoot,".local","update-operations",updaterId);
      source=kind=="candidate"?Path.Combine(op,"candidate"):Path.Combine(op,"displaced",displacedId);
      string destDir=Path.Combine(installRoot,".local","storage-quarantine",operationId);
      operationDirectory=destDir;this.operationId=operationId;
      destination=Path.Combine(destDir,"payload");
      using(var h=OpenDir(installRoot,ATTR,false,false))volume=GetIdentity(h,true).volume;
      try {
        if(takeLock) {
          // Pin the lock parent first, then acquire the updater's own exclusive
          // lock before pinning any operation-specific directories.
          PinTree(Path.Combine(installRoot,".local"),false);
          updater=Open(Path.Combine(installRoot,".local","updater.lock"),READ|WRITE,0,IntPtr.Zero,OPEN_ALWAYS,OPEN_REPARSE,IntPtr.Zero);
          if(updater.IsInvalid){int code=Marshal.GetLastWin32Error();updater.Dispose();updater=null;throw new IOException("UPDATER_LOCK_BUSY WIN32="+code);}
          GetIdentity(updater,false);
        }
        sourceParent=PinTree(Path.GetDirectoryName(source),false);
        destinationParent=PinTree(destDir,!takeLock);
      } catch { Dispose();throw; }
    }
    Observation InspectOne(string path) {
      using(var h=OpenDir(path,ATTR,true,true)) {
        if(h==null)return new Observation { exists=false };
        var id=GetIdentity(h,true);
        if(!String.Equals(id.volume,volume,StringComparison.OrdinalIgnoreCase))throw new IOException("CROSS_VOLUME");
        return new Observation { exists=true,identity=id };
      }
    }
    public Locations Inspect() { if(disposed)throw new IOException("LEASE_CLOSED");return new Locations { source=InspectOne(source),destination=destinationParent==null?new Observation {exists=false}:InspectOne(destination),sameVolume=true }; }
    public Locations Move(string from,Identity expected) {
      if(disposed)throw new IOException("LEASE_CLOSED");if(updater==null)throw new IOException("LEASE_REQUIRED");
      if(from!="source"&&from!="destination")throw new IOException("INVALID_DIRECTION");if(expected==null)throw new IOException("IDENTITY_REQUIRED");
      var sourceParentId=GetIdentity(sourceParent,true);var destinationParentId=GetIdentity(destinationParent,true);
      if(!String.Equals(sourceParentId.volume,volume,StringComparison.OrdinalIgnoreCase) ||
         !String.Equals(destinationParentId.volume,volume,StringComparison.OrdinalIgnoreCase))throw new IOException("CROSS_VOLUME");
      string origin=from=="source"?source:destination,name=from=="source"?"payload":sourceName;
      SafeFileHandle parent=from=="source"?destinationParent:sourceParent;
      using(var h=OpenDir(origin,ATTR|DELETE,false,false)) {
        var actual=GetIdentity(h,true);if(!Equal(actual,expected))throw new IOException("SOURCE_IDENTITY_CHANGED");
        if(!String.Equals(actual.volume,volume,StringComparison.OrdinalIgnoreCase))throw new IOException("CROSS_VOLUME");
        RenameRelative(h,parent,name);
        if(!Equal(GetIdentity(h,true),actual))throw new IOException("RENAMED_IDENTITY_CHANGED");
      }
      return Inspect();
    }
    static void RenameRelative(SafeFileHandle h,SafeFileHandle parent,string name) {
      byte[] bytes=Encoding.Unicode.GetBytes(name);int offset=(int)Marshal.OffsetOf(typeof(RenameHeader),"Name");
      IntPtr buffer=Marshal.AllocHGlobal(offset+bytes.Length+2);
      try {
        for(int i=0;i<offset+bytes.Length+2;i++)Marshal.WriteByte(buffer,i,0);
        Marshal.WriteByte(buffer,0,0);Marshal.WriteIntPtr(buffer,(int)Marshal.OffsetOf(typeof(RenameHeader),"Root"),parent.DangerousGetHandle());
        Marshal.WriteInt32(buffer,(int)Marshal.OffsetOf(typeof(RenameHeader),"Length"),bytes.Length);Marshal.Copy(bytes,0,IntPtr.Add(buffer,offset),bytes.Length);
        IoStatus status; int result=NtSetInformationFile(h,out status,buffer,(uint)(offset+bytes.Length+2),RenameInfo);
        if(result!=0)throw new IOException("RENAME_NO_REPLACE_FAILED_OR_PENDING NTSTATUS="+result.ToString("X8"));
      } finally { Marshal.FreeHGlobal(buffer); }
    }
    static void CheckOrdinarySingleLink(SafeFileHandle h) {
      FileStandard standard;
      if(!GetStandard(h,StandardInfo,out standard,(uint)Marshal.SizeOf(typeof(FileStandard))))throw Error("FILE_STANDARD_UNAVAILABLE");
      if(standard.Directory!=0 || standard.DeletePending!=0 || standard.NumberOfLinks!=1)throw new IOException("PHASE_FILE_UNSAFE");
    }
    public Locations PublishPhase(string phase,string planSha256) {
      if(disposed)throw new IOException("LEASE_CLOSED");
      if(updater==null)throw new IOException("LEASE_REQUIRED");
      if(phase!="quarantined" && phase!="restoring" && phase!="restored")throw new IOException("INVALID_PHASE");
      if(planSha256==null || planSha256.Length!=64)throw new IOException("INVALID_PLAN_SHA256");
      foreach(char c in planSha256)if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')))throw new IOException("INVALID_PLAN_SHA256");
      if(!String.Equals(GetIdentity(destinationParent,true).volume,volume,StringComparison.OrdinalIgnoreCase))throw new IOException("CROSS_VOLUME");
      string temporary=Path.Combine(operationDirectory,".phase-"+Guid.NewGuid().ToString("N")+".tmp");
      var h=Open(temporary,READ|WRITE|DELETE,SHARE_READ,IntPtr.Zero,CREATE_NEW,OPEN_REPARSE,IntPtr.Zero);
      if(h.IsInvalid){h.Dispose();throw Error("PHASE_TEMP_CREATE_FAILED");}
      using(var stream=new FileStream(h,FileAccess.ReadWrite,4096,false)) {
        var initial=GetIdentity(h,false); CheckOrdinarySingleLink(h);
        if(!String.Equals(initial.volume,volume,StringComparison.OrdinalIgnoreCase))throw new IOException("CROSS_VOLUME");
        string json="{\"schema\":\"workbridge-retention-phase/1\",\"operationId\":\""+operationId+
          "\",\"planSha256\":\""+planSha256+"\",\"phase\":\""+phase+"\"}";
        byte[] content=new UTF8Encoding(false).GetBytes(json);
        stream.Write(content,0,content.Length);stream.Flush(true);
        if(!Equal(initial,GetIdentity(h,false)))throw new IOException("PHASE_IDENTITY_CHANGED");
        CheckOrdinarySingleLink(h);
        RenameRelative(h,destinationParent,phase+".json");
        if(!Equal(initial,GetIdentity(h,false)))throw new IOException("PHASE_IDENTITY_CHANGED");
        CheckOrdinarySingleLink(h);
        using(var published=Open(Path.Combine(operationDirectory,phase+".json"),ATTR,SHARE_READ|SHARE_WRITE|SHARE_DELETE,IntPtr.Zero,EXISTING,OPEN_REPARSE,IntPtr.Zero)) {
          if(published.IsInvalid)throw Error("PHASE_PUBLISHED_ID_UNAVAILABLE");
          if(!Equal(initial,GetIdentity(published,false)))throw new IOException("PHASE_PUBLISHED_ID_CHANGED");
          CheckOrdinarySingleLink(published);
        }
      }
      return Inspect();
    }
    public void Dispose() { if(disposed)return;disposed=true;if(updater!=null)updater.Dispose();for(int i=pins.Count-1;i>=0;i--)pins[i].Dispose(); }
  }
}
'@
function Emit($object) { [Console]::Out.WriteLine(($object|ConvertTo-Json -Compress -Depth 8)) }
$lease=$null
try {
  if($Mode -eq 'Lease' -and -not $MaintenanceConfirmed) { throw 'MAINTENANCE_REQUIRED' }
  if($InstallRoot -notmatch '^[A-Za-z]:\\') { throw 'ABSOLUTE_LOCAL_ROOT_REQUIRED' }
  $root=[IO.Path]::GetFullPath($InstallRoot)
  if($OperationId -notmatch '\A[A-Za-z0-9][A-Za-z0-9_-]{0,63}\z' -or $UpdaterOperationId -notmatch '\A[A-Za-z0-9][A-Za-z0-9_-]{0,63}\z' -or $OperationId -match '\A(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])\z' -or $UpdaterOperationId -match '\A(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])\z') { throw 'INVALID_OPERATION_ID' }
  if($Kind -eq 'displaced' -and $DisplacedId -notmatch '\A[A-Fa-f0-9]{32}\z') { throw 'INVALID_DISPLACED_ID' }
  if($Kind -eq 'candidate' -and -not [string]::IsNullOrEmpty($DisplacedId)) { throw 'UNEXPECTED_DISPLACED_ID' }
  $lease=[RetentionMaintenanceNative+Lease]::new($root,$OperationId,$UpdaterOperationId,$Kind,$DisplacedId,($Mode -eq 'Lease'))
  $state=$lease.Inspect()
  Emit @{status='ready';source=$state.source;destination=$state.destination;sameVolume=$state.sameVolume}
  if($Mode -eq 'Inspect') { exit 0 }
  while($true) {
    $line=[RetentionMaintenanceNative]::ReadLineWithTimeout($TimeoutSeconds*1000)
    if($null -eq $line) { break }
    try {
      if($line.Length -gt 4096) { throw 'COMMAND_TOO_LARGE' }
      $command=ConvertFrom-Json -InputObject $line
      if($command.command -eq 'inspect') { $state=$lease.Inspect() }
      elseif($command.command -eq 'phase') {
        $state=$lease.PublishPhase([string]$command.phase,[string]$command.planSha256)
      }
      elseif($command.command -eq 'move') {
        $expected=[RetentionMaintenanceNative+Identity]::new()
        $expected.volume=[string]$command.expectedIdentity.volume;$expected.id=[string]$command.expectedIdentity.id
        if($expected.volume -notmatch '\A[A-Fa-f0-9]{16}\z' -or $expected.id -notmatch '\A[A-Fa-f0-9]{32}\z') { throw 'INVALID_IDENTITY' }
        $state=$lease.Move([string]$command.from,$expected)
      } else { throw 'INVALID_COMMAND' }
      Emit @{status='ok';source=$state.source;destination=$state.destination;sameVolume=$state.sameVolume}
    } catch { Emit @{status='error';code=$_.Exception.GetBaseException().Message} }
  }
} catch { Emit @{status='error';code=$_.Exception.GetBaseException().Message};exit 1 }
finally { if($null -ne $lease) { $lease.Dispose() } }
