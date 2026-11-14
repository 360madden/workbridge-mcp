#requires -Version 5.1
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidateSet('Inspect','Inventory','Lease','Prepare')][string]$Mode,
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
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Diagnostics;
using System.Globalization;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;
public static class RetentionMaintenanceNative {
  const uint ATTR=0x80, DELETE=0x10000, READ=0x80000000, WRITE=0x40000000;
  const uint SHARE_READ=1, SHARE_WRITE=2, SHARE_DELETE=4, CREATE_NEW=1, EXISTING=3, OPEN_ALWAYS=4;
  const uint OPEN_REPARSE=0x200000, BACKUP=0x2000000, REPARSE=0x400, DIRECTORY=0x10;
  const int BasicInfo=0, StandardInfo=1, StreamInfo=7, TagInfo=9, IdInfo=18, RenameInfo=10;
  [StructLayout(LayoutKind.Sequential)] struct IoStatus { public IntPtr Status; public IntPtr Information; }
  [StructLayout(LayoutKind.Sequential)] struct FileStandard { public long AllocationSize,EndOfFile; public uint NumberOfLinks; public byte DeletePending,Directory; }
  [StructLayout(LayoutKind.Sequential)] struct FileBasic { public long CreationTime,LastAccessTime,LastWriteTime,ChangeTime; public uint Attributes; }
  [StructLayout(LayoutKind.Sequential)] struct FileTag { public uint Attributes, Tag; }
  [StructLayout(LayoutKind.Sequential)] struct FileId { public ulong Volume; [MarshalAs(UnmanagedType.ByValArray,SizeConst=16)] public byte[] Id; }
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct RenameHeader { public byte Replace; public IntPtr Root; public uint Length; public char Name; }
  [DllImport("kernel32.dll",EntryPoint="CreateFileW",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle Open(string path,uint access,uint share,IntPtr sec,uint disposition,uint flags,IntPtr template);
  [DllImport("kernel32.dll",EntryPoint="GetFileInformationByHandleEx",SetLastError=true)] static extern bool GetStandard(SafeFileHandle h,int kind,out FileStandard data,uint size);
  [DllImport("kernel32.dll",EntryPoint="GetFileInformationByHandleEx",SetLastError=true)] static extern bool GetBasic(SafeFileHandle h,int kind,out FileBasic data,uint size);
  [DllImport("kernel32.dll",EntryPoint="GetFileInformationByHandleEx",SetLastError=true)] static extern bool GetStreams(SafeFileHandle h,int kind,IntPtr data,uint size);
  [DllImport("kernel32.dll",EntryPoint="GetFileInformationByHandleEx",SetLastError=true)] static extern bool GetTag(SafeFileHandle h,int kind,out FileTag data,uint size);
  [DllImport("kernel32.dll",EntryPoint="GetFileInformationByHandleEx",SetLastError=true)] static extern bool GetId(SafeFileHandle h,int kind,out FileId data,uint size);
  [DllImport("ntdll.dll")] static extern int NtSetInformationFile(SafeFileHandle h,out IoStatus status,IntPtr data,uint size,int kind);
  static IOException Error(string code) { return new IOException(code+" WIN32="+Marshal.GetLastWin32Error()); }
  public static string ReadLineWithTimeout(int timeoutMs) {
    var task=System.Threading.Tasks.Task.Run(() => Console.In.ReadLine());
    if(!task.Wait(timeoutMs))return null;
    return task.Result;
  }
  public static string QuoteJson(string value) {
    if(value==null)return "null";
    var text=new StringBuilder("\"");
    foreach(char c in value) {
      switch(c) {
        case '"': text.Append("\\\"");break;
        case '\\': text.Append("\\\\");break;
        case '\b': text.Append("\\b");break;
        case '\f': text.Append("\\f");break;
        case '\n': text.Append("\\n");break;
        case '\r': text.Append("\\r");break;
        case '\t': text.Append("\\t");break;
        default: if(c<32)text.Append("\\u"+((int)c).ToString("x4"));else text.Append(c);break;
      }
    }
    return text.Append('"').ToString();
  }
  public static void StrictJsonKeys(string text) {
    var stack=new Stack<HashSet<string>>();
    for(int i=0;i<text.Length;i++) {
      char c=text[i];
      if(c=='{' )stack.Push(new HashSet<string>(StringComparer.OrdinalIgnoreCase));
      else if(c=='[')stack.Push(null);
      else if(c=='}'||c==']') {if(stack.Count==0)throw new IOException("INVALID_JSON");stack.Pop();}
      else if(c=='\"') {
        int start=++i;bool escaped=false;
        while(i<text.Length) {if(text[i]=='\\'){escaped=true;i+=2;continue;}if(text[i]=='\"')break;i++;}
        if(i>=text.Length)throw new IOException("INVALID_JSON");
        int next=i+1;while(next<text.Length && Char.IsWhiteSpace(text[next]))next++;
        if(next<text.Length && text[next]==':') {
          if(stack.Count==0 || stack.Peek()==null || escaped)throw new IOException("INVALID_JSON_KEY");
          string key=text.Substring(start,i-start);
          if(!Regex.IsMatch(key,@"\A[A-Za-z][A-Za-z0-9]*\z",RegexOptions.CultureInvariant) || !stack.Peek().Add(key))throw new IOException("DUPLICATE_OR_INVALID_JSON_KEY");
        }
      }
    }
    if(stack.Count!=0)throw new IOException("INVALID_JSON");
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
    readonly List<FileStream> preparationPins=new List<FileStream>();
    readonly Dictionary<string,byte[]> preparationCache=new Dictionary<string,byte[]>(StringComparer.Ordinal);
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
        string timestamp=DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'",CultureInfo.InvariantCulture);
        string json="{\"schema\":\"workbridge-retention-phase/2\",\"operationId\":\""+operationId+
          "\",\"planSha256\":\""+planSha256+"\",\"phase\":\""+phase+"\",\"publishedAtUtc\":\""+timestamp+"\"}";
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
    public sealed class InventoryEntry {
      public string path {get;set;} public string type {get;set;} public Identity identity {get;set;}
      public long size {get;set;} public uint nlink {get;set;} public string sha256 {get;set;}
    }
    public sealed class InventoryReceipt {
      public string schema {get;set;} public bool complete {get;set;} public bool nonAtomic {get;set;}
      public int namedStreams {get;set;} public long totalBytes {get;set;} public InventoryEntry[] entries {get;set;}
    }
    sealed class InventoryBudget {
      public readonly Stopwatch clock=Stopwatch.StartNew(); public long bytes; public long outputEstimate;
      public readonly List<InventoryEntry> entries=new List<InventoryEntry>();
      public readonly HashSet<string> names=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
      public void Time() { if(clock.ElapsedMilliseconds>=60000)throw new IOException("INVENTORY_TIME_LIMIT"); }
      public void Add(InventoryEntry entry) {
        Time();if(entries.Count>=20000)throw new IOException("INVENTORY_ENTRY_LIMIT");
        if(!names.Add(entry.path))throw new IOException("INVENTORY_CASE_COLLISION");
        outputEstimate+=400L+entry.path.Length*6L;
        if(outputEstimate>7L*1024*1024)throw new IOException("INVENTORY_OUTPUT_LIMIT");
        entries.Add(entry);
      }
    }
    static FileBasic ReadBasic(SafeFileHandle h) {
      FileBasic basic;if(!GetBasic(h,BasicInfo,out basic,(uint)Marshal.SizeOf(typeof(FileBasic))))throw Error("BASIC_INFO_UNAVAILABLE");
      if((basic.Attributes & (0x200u|0x1000u|0x4000u|0x40000u|0x400000u))!=0)throw new IOException("UNSUPPORTED_ATTRIBUTES");
      return basic;
    }
    static FileStandard ReadStandard(SafeFileHandle h) {
      FileStandard standard;if(!GetStandard(h,StandardInfo,out standard,(uint)Marshal.SizeOf(typeof(FileStandard))))throw Error("FILE_STANDARD_UNAVAILABLE");
      if(standard.DeletePending!=0 || standard.EndOfFile<0)throw new IOException("INVENTORY_OBJECT_UNAVAILABLE");
      return standard;
    }
    static void CheckNoNamedStreams(SafeFileHandle h,bool directory) {
      const int capacity=65536;IntPtr buffer=Marshal.AllocHGlobal(capacity);
      try {
        if(!GetStreams(h,StreamInfo,buffer,capacity)) {
          int code=Marshal.GetLastWin32Error();
          if(code==38 && directory)return;
          throw new IOException("STREAM_ENUMERATION_UNAVAILABLE WIN32="+code);
        }
        int offset=0,count=0;bool defaultFound=false;
        while(true) {
          if(offset<0 || offset>capacity-24 || ++count>1024)throw new IOException("STREAM_ENUMERATION_INVALID");
          int next=Marshal.ReadInt32(buffer,offset),length=Marshal.ReadInt32(buffer,offset+4);
          if(length<0 || (length&1)!=0 || length>capacity-offset-24)throw new IOException("STREAM_ENUMERATION_INVALID");
          string name=Marshal.PtrToStringUni(IntPtr.Add(buffer,offset+24),length/2);
          if(directory || name!="::$DATA" || defaultFound)throw new IOException("NAMED_STREAM_REFUSED");
          defaultFound=true;if(next==0)break;
          if(next<24+length || (next&7)!=0 || next>capacity-offset-24)throw new IOException("STREAM_ENUMERATION_INVALID");
          offset+=next;
        }
        if(!directory && !defaultFound)throw new IOException("STREAM_ENUMERATION_INVALID");
      } finally { Marshal.FreeHGlobal(buffer); }
    }
    static bool SameBasic(FileBasic a,FileBasic b) {
      return a.CreationTime==b.CreationTime && a.LastWriteTime==b.LastWriteTime && a.ChangeTime==b.ChangeTime && a.Attributes==b.Attributes;
    }
    static bool SafeInventoryName(string name) {
      if(String.IsNullOrEmpty(name) || name=="." || name==".." || name.EndsWith(".") || name.EndsWith(" "))return false;
      foreach(char c in name)if(Char.IsControl(c) || "<>:\"/\\|?*".IndexOf(c)>=0)return false;
      return !System.Text.RegularExpressions.Regex.IsMatch(name,
        @"\A(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9\u00B9\u00B2\u00B3]|LPT[1-9\u00B9\u00B2\u00B3])(?:\..*)?\z",
        System.Text.RegularExpressions.RegexOptions.IgnoreCase|System.Text.RegularExpressions.RegexOptions.CultureInvariant);
    }
    void InventoryWalk(string file,string relative,int depth,InventoryBudget budget) {
      budget.Time();if(depth>128 || relative.Length>4096)throw new IOException("INVENTORY_DEPTH_OR_PATH_LIMIT");
      // This object's share lock does not freeze the directory namespace.
      var handle=Open(file,READ,SHARE_READ,IntPtr.Zero,EXISTING,OPEN_REPARSE|BACKUP,IntPtr.Zero);
      if(handle.IsInvalid){handle.Dispose();throw Error("INVENTORY_OPEN_FAILED");}
      using(handle) {
        FileTag tag;if(!GetTag(handle,TagInfo,out tag,(uint)Marshal.SizeOf(typeof(FileTag))))throw Error("IDENTITY_UNAVAILABLE");
        bool directory=(tag.Attributes&DIRECTORY)!=0;
        var id=GetIdentity(handle,directory);var before=ReadBasic(handle);var standard=ReadStandard(handle);
        if(!String.Equals(id.volume,volume,StringComparison.OrdinalIgnoreCase))throw new IOException("CROSS_VOLUME");
        if(!directory && (standard.Directory!=0 || standard.NumberOfLinks!=1))throw new IOException("HARDLINK_REFUSED");
        CheckNoNamedStreams(handle,directory);
        var entry=new InventoryEntry { path=relative,type=directory?"directory":"file",identity=id,
          size=directory?0:standard.EndOfFile,nlink=standard.NumberOfLinks,sha256=null };
        budget.Add(entry);
        if(directory) {
          foreach(string child in System.IO.Directory.EnumerateFileSystemEntries(file)) {
            budget.Time();string name=Path.GetFileName(child);
            if(!Equal(id,GetIdentity(handle,true)))throw new IOException("INVENTORY_DIRECTORY_CHANGED");
            if(!SafeInventoryName(name))throw new IOException("INVALID_ENTRY_NAME");
            InventoryWalk(child,relative.Length==0?name:relative+"/"+name,depth+1,budget);
          }
        } else {
          if(standard.EndOfFile>512L*1024*1024-budget.bytes)throw new IOException("INVENTORY_BYTE_LIMIT");
          using(var stream=new FileStream(handle,FileAccess.Read,65536,false))
          using(var sha=SHA256.Create()) {
            byte[] buffer=new byte[65536];int n;long read=0;
            while((n=stream.Read(buffer,0,buffer.Length))>0) {
              budget.Time();read+=n;budget.bytes+=n;
              if(budget.bytes>512L*1024*1024 || read>standard.EndOfFile)throw new IOException("INVENTORY_BYTE_LIMIT");
              sha.TransformBlock(buffer,0,n,buffer,0);
            }
            sha.TransformFinalBlock(new byte[0],0,0);
            if(read!=standard.EndOfFile)throw new IOException("INVENTORY_FILE_CHANGED");
            entry.sha256=BitConverter.ToString(sha.Hash).Replace("-","").ToLowerInvariant();
            var after=ReadBasic(handle);var afterStandard=ReadStandard(handle);
            if(!Equal(id,GetIdentity(handle,false)) || !SameBasic(before,after) || afterStandard.EndOfFile!=standard.EndOfFile || afterStandard.NumberOfLinks!=1)throw new IOException("INVENTORY_FILE_CHANGED");
            CheckNoNamedStreams(handle,false);
          }
          return;
        }
        var end=ReadBasic(handle);
        if(!Equal(id,GetIdentity(handle,true)) || !SameBasic(before,end))throw new IOException("INVENTORY_DIRECTORY_CHANGED");
        CheckNoNamedStreams(handle,true);
      }
    }
    public InventoryReceipt Inventory() {
      if(disposed)throw new IOException("LEASE_CLOSED");
      if(destinationParent==null)throw new IOException("PAYLOAD_UNAVAILABLE");
      if(!String.Equals(GetIdentity(destinationParent,true).volume,volume,StringComparison.OrdinalIgnoreCase))throw new IOException("CROSS_VOLUME");
      var budget=new InventoryBudget();InventoryWalk(destination,"",0,budget);budget.Time();
      return new InventoryReceipt { schema="workbridge-retention-inventory/1",complete=true,nonAtomic=true,
        namedStreams=0,totalBytes=budget.bytes,entries=budget.entries.ToArray() };
    }
    public byte[] ReadPreparationFile(string name,int maxBytes) {
      if(disposed || updater==null)throw new IOException("LEASE_REQUIRED");
      if(!Regex.IsMatch(name,@"\A(?:intent|quarantined|restoring|restored|purge-manifest|purge-approval)\.json\z",RegexOptions.CultureInvariant) || maxBytes<1 || maxBytes>8*1024*1024)throw new IOException("INVALID_PREPARATION_FILE");
      byte[] cached;if(preparationCache.TryGetValue(name,out cached))return cached;
      var h=Open(Path.Combine(operationDirectory,name),READ,SHARE_READ,IntPtr.Zero,EXISTING,OPEN_REPARSE,IntPtr.Zero);
      if(h.IsInvalid){int code=Marshal.GetLastWin32Error();h.Dispose();if(code==2 || code==3)return null;throw new IOException("PREPARATION_FILE_OPEN_FAILED WIN32="+code);}
      FileStream stream=null;
      try {
        var id=GetIdentity(h,false);var before=ReadBasic(h);var info=ReadStandard(h);
        if(info.NumberOfLinks!=1 || info.EndOfFile>maxBytes)throw new IOException("PREPARATION_FILE_UNSAFE");
        CheckNoNamedStreams(h,false);stream=new FileStream(h,FileAccess.Read,65536,false);
        byte[] bytes=new byte[(int)info.EndOfFile];int offset=0;
        while(offset<bytes.Length){int n=stream.Read(bytes,offset,bytes.Length-offset);if(n==0)throw new IOException("PREPARATION_FILE_CHANGED");offset+=n;}
        if(stream.ReadByte()!=-1 || !Equal(id,GetIdentity(h,false)) || !SameBasic(before,ReadBasic(h)))throw new IOException("PREPARATION_FILE_CHANGED");
        preparationPins.Add(stream);preparationCache.Add(name,bytes);stream=null;return bytes;
      } finally {if(stream!=null)stream.Dispose();else if(!preparationPins.Exists(x=>x.SafeFileHandle==h))h.Dispose();}
    }
    public void AssertPreparationNamespace() {
      if(disposed || updater==null)throw new IOException("LEASE_REQUIRED");
      var id=GetIdentity(destinationParent,true);var before=ReadBasic(destinationParent);int count=0;var clock=Stopwatch.StartNew();
      foreach(string file in Directory.EnumerateFileSystemEntries(operationDirectory)) {
        if(++count>20000 || clock.ElapsedMilliseconds>=60000)throw new IOException("PREPARATION_NAMESPACE_LIMIT");
        string name=Path.GetFileName(file);
        foreach(string fixedName in new string[]{"intent.json","quarantined.json","purge-manifest.json","purge-approval.json"})
          if(String.Equals(name,fixedName,StringComparison.OrdinalIgnoreCase) && name!=fixedName)throw new IOException("PREPARATION_NAMESPACE_CONFLICT");
        if(String.Equals(name,"restoring.json",StringComparison.OrdinalIgnoreCase) || String.Equals(name,"restored.json",StringComparison.OrdinalIgnoreCase))throw new IOException("RESTORE_IN_PROGRESS_OR_COMPLETE");
        if(name.StartsWith("purge",StringComparison.OrdinalIgnoreCase) || name.StartsWith("purging",StringComparison.OrdinalIgnoreCase)) {
          if(name!="purge-manifest.json" && name!="purge-approval.json")throw new IOException("PURGE_PREPARATION_CONFLICT");
        }
      }
      if(!Equal(id,GetIdentity(destinationParent,true)) || !SameBasic(before,ReadBasic(destinationParent)))throw new IOException("PREPARATION_NAMESPACE_CHANGED");
    }
    public void PublishPreparationFile(string name,byte[] content) {
      if(disposed || updater==null)throw new IOException("LEASE_REQUIRED");
      if(name!="purge-manifest.json" && name!="purge-approval.json")throw new IOException("INVALID_PREPARATION_FILE");
      if(content==null || content.Length<1 || content.Length>(name=="purge-manifest.json"?8*1024*1024:65536))throw new IOException("PREPARATION_FILE_SIZE");
      if(!String.Equals(GetIdentity(destinationParent,true).volume,volume,StringComparison.OrdinalIgnoreCase))throw new IOException("CROSS_VOLUME");
      string temporary=Path.Combine(operationDirectory,".prepare-"+Guid.NewGuid().ToString("N")+".tmp");
      var h=Open(temporary,READ|WRITE|DELETE,SHARE_READ,IntPtr.Zero,CREATE_NEW,OPEN_REPARSE,IntPtr.Zero);
      if(h.IsInvalid){h.Dispose();throw Error("PREPARATION_TEMP_CREATE_FAILED");}
      FileStream stream=null;
      try {
        var initial=GetIdentity(h,false);CheckOrdinarySingleLink(h);CheckNoNamedStreams(h,false);
        if(!String.Equals(initial.volume,volume,StringComparison.OrdinalIgnoreCase))throw new IOException("CROSS_VOLUME");
        stream=new FileStream(h,FileAccess.ReadWrite,65536,false);stream.Write(content,0,content.Length);stream.Flush(true);
        if(!Equal(initial,GetIdentity(h,false)))throw new IOException("PREPARATION_FILE_CHANGED");
        CheckOrdinarySingleLink(h);RenameRelative(h,destinationParent,name);
        if(!Equal(initial,GetIdentity(h,false)))throw new IOException("PREPARATION_FILE_CHANGED");
        using(var published=Open(Path.Combine(operationDirectory,name),ATTR,SHARE_READ|SHARE_WRITE|SHARE_DELETE,IntPtr.Zero,EXISTING,OPEN_REPARSE,IntPtr.Zero)) {
          if(published.IsInvalid)throw Error("PREPARATION_PUBLISHED_ID_UNAVAILABLE");
          if(!Equal(initial,GetIdentity(published,false)))throw new IOException("PREPARATION_PUBLISHED_ID_CHANGED");CheckOrdinarySingleLink(published);
        }
        preparationPins.Add(stream);preparationCache.Add(name,content);stream=null;
      } finally {if(stream!=null)stream.Dispose();else if(!preparationPins.Exists(x=>x.SafeFileHandle==h))h.Dispose();}
    }
    public static byte[] ManifestBytes(InventoryReceipt inventory,Identity expectedRoot,string op,string plan,string quarantine) {
      if(inventory==null || inventory.entries==null || inventory.entries.Length<1 || inventory.entries.Length>20000)throw new IOException("INVALID_INVENTORY");
      var entries=(InventoryEntry[])inventory.entries.Clone();Array.Sort(entries,(a,b)=>StringComparer.Ordinal.Compare(a.path,b.path));
      if(entries[0].path!="" || entries[0].type!="directory")throw new IOException("INVALID_INVENTORY_ROOT");
      var builder=new StringBuilder("{\"entries\":[");
      for(int i=0;i<entries.Length;i++) {
        var e=entries[i];if(i>0)builder.Append(',');
        builder.Append("{\"identity\":{\"id\":").Append(QuoteJson(e.identity.id.ToLowerInvariant())).Append(",\"volume\":").Append(QuoteJson(e.identity.volume.ToLowerInvariant())).Append("},\"nlink\":").Append(e.nlink.ToString(CultureInfo.InvariantCulture)).Append(",\"path\":").Append(QuoteJson(e.path)).Append(",\"sha256\":").Append(QuoteJson(e.sha256)).Append(",\"size\":").Append(e.size.ToString(CultureInfo.InvariantCulture)).Append(",\"type\":").Append(QuoteJson(e.type)).Append('}');
      }
      builder.Append("],\"expectedRoot\":{\"id\":").Append(QuoteJson(expectedRoot.id)).Append(",\"volume\":").Append(QuoteJson(expectedRoot.volume)).Append("},\"operationId\":").Append(QuoteJson(op)).Append(",\"planSha256\":").Append(QuoteJson(plan)).Append(",\"quarantineReceiptSha256\":").Append(QuoteJson(quarantine)).Append(",\"schema\":\"workbridge-purge-manifest/1\"}\n");
      byte[] result=new UTF8Encoding(false,true).GetBytes(builder.ToString());if(result.Length>8*1024*1024)throw new IOException("PREPARATION_FILE_SIZE");return result;
    }
    public static byte[] ApprovalBytes(string op,string plan,string quarantine,string manifest,string references,string retained) {
      string json="{\"manifestSha256\":"+QuoteJson(manifest)+",\"operationId\":"+QuoteJson(op)+",\"planSha256\":"+QuoteJson(plan)+",\"quarantineReceiptSha256\":"+QuoteJson(quarantine)+",\"referencesSha256\":"+QuoteJson(references)+",\"retainedProofSha256\":"+QuoteJson(retained)+",\"schema\":\"workbridge-purge-approval/1\"}\n";
      return new UTF8Encoding(false,true).GetBytes(json);
    }
    public static string Sha256(byte[] bytes) { using(var h=SHA256.Create())return BitConverter.ToString(h.ComputeHash(bytes)).Replace("-","").ToLowerInvariant(); }
    public static bool SameBytes(byte[] a,byte[] b) {
      if(a==null || b==null || a.Length!=b.Length)return false;
      for(int i=0;i<a.Length;i++)if(a[i]!=b[i])return false;
      return true;
    }
    public void Dispose() { if(disposed)return;disposed=true;for(int i=preparationPins.Count-1;i>=0;i--)preparationPins[i].Dispose();if(updater!=null)updater.Dispose();for(int i=pins.Count-1;i>=0;i--)pins[i].Dispose(); }
  }
}
'@
function Emit($object) { [Console]::Out.WriteLine(($object|ConvertTo-Json -Compress -Depth 8)) }
function Emit-Inventory($state,$inventory,$status,$clock) {
  $json=@{status=$status;source=$state.source;destination=$state.destination;sameVolume=$state.sameVolume;inventory=$inventory}|ConvertTo-Json -Compress -Depth 8
  if($clock.ElapsedMilliseconds -ge 60000) { throw 'INVENTORY_TIME_LIMIT' }
  if([Text.Encoding]::UTF8.GetByteCount($json) -gt 8*1024*1024) { throw 'INVENTORY_OUTPUT_LIMIT' }
  [Console]::Out.WriteLine($json)
}
function Assert-PreparationKeys($value,[string[]]$expected) {
  if($null -eq $value -or $value -is [array] -or $value -isnot [pscustomobject]) { throw 'INVALID_PREPARATION_DOCUMENT' }
  $actual=[string[]]@($value.PSObject.Properties.Name);$wanted=[string[]]@($expected)
  [Array]::Sort($actual,[StringComparer]::Ordinal);[Array]::Sort($wanted,[StringComparer]::Ordinal)
  if([string]::Join('|',$actual) -cne [string]::Join('|',$wanted)) { throw 'INVALID_PREPARATION_FIELDS' }
}
function Preparation-Document([string]$name) {
  $bytes=$lease.ReadPreparationFile($name,65536)
  if($null -eq $bytes -or $bytes.Length -eq 0) { throw 'PREPARATION_DOCUMENT_MISSING' }
  if($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) { throw 'DOCUMENT_BOM_REFUSED' }
  $text=[Text.UTF8Encoding]::new($false,$true).GetString($bytes)
  [RetentionMaintenanceNative]::StrictJsonKeys($text)
  return @{ value=(ConvertFrom-Json -InputObject $text);sha256=[RetentionMaintenanceNative+Lease]::Sha256($bytes) }
}
function Preparation-Canonical($value) {
  if($null -eq $value) { return 'null' }
  if($value -is [string]) { return [RetentionMaintenanceNative]::QuoteJson($value) }
  if($value -isnot [pscustomobject]) { throw 'INVALID_PLAN_VALUE' }
  $keys=[string[]]@($value.PSObject.Properties.Name);[Array]::Sort($keys,[StringComparer]::Ordinal)
  $parts=[Collections.Generic.List[string]]::new()
  foreach($key in $keys) { $parts.Add(([RetentionMaintenanceNative]::QuoteJson($key)+':'+(Preparation-Canonical $value.$key))) }
  return '{'+[string]::Join(',',$parts)+'}'
}
function Prepare-Purge($command) {
  Assert-PreparationKeys $command @('command','planSha256','quarantineReceiptSha256','manifestSha256','referencesSha256','retainedProofSha256','expectedPurgeSha256')
  foreach($key in @('planSha256','quarantineReceiptSha256','manifestSha256','referencesSha256','retainedProofSha256','expectedPurgeSha256')) {
    if($command.$key -isnot [string] -or $command.$key -cnotmatch '\A[a-f0-9]{64}\z') { throw 'INVALID_PREPARATION_PROOF' }
  }
  $clock=[Diagnostics.Stopwatch]::StartNew()
  $lease.AssertPreparationNamespace()
  $state=$lease.Inspect()
  if($state.source.exists -or -not $state.destination.exists -or -not $state.sameVolume) { throw 'PREPARATION_LOCATION_CONFLICT' }
  $intent=(Preparation-Document 'intent.json').value
  Assert-PreparationKeys $intent @('schema','operationId','planSha256','plan')
  Assert-PreparationKeys $intent.plan @('schema','host','installRoot','updaterOperationId','kind','displacedId','sourceIdentity','manifestSha256','retainedBindingSha256','metadataSha256','referencesSha256','sourceTreeSha256')
  Assert-PreparationKeys $intent.plan.sourceIdentity @('volume','id')
  $canonical=[Text.UTF8Encoding]::new($false,$true).GetBytes((Preparation-Canonical $intent.plan))
  if($intent.schema -cne 'workbridge-retention-intent/1' -or $intent.operationId -cne $OperationId -or
     $intent.planSha256 -cne $command.planSha256 -or [RetentionMaintenanceNative+Lease]::Sha256($canonical) -cne $command.planSha256 -or
     $intent.plan.schema -cne 'workbridge-retention-plan/1' -or $intent.plan.host -ine [Environment]::MachineName -or
     [IO.Path]::GetFullPath([string]$intent.plan.installRoot) -ine $root -or $intent.plan.updaterOperationId -cne $UpdaterOperationId -or
     $intent.plan.kind -cne $Kind -or $intent.plan.sourceIdentity.volume -ine $state.destination.identity.volume -or
     $intent.plan.sourceIdentity.id -ine $state.destination.identity.id) { throw 'PREPARATION_PLAN_MISMATCH' }
  if(($Kind -eq 'candidate' -and $null -ne $intent.plan.displacedId) -or ($Kind -eq 'displaced' -and $intent.plan.displacedId -cne $DisplacedId)) { throw 'PREPARATION_PLAN_MISMATCH' }
  foreach($key in @('manifestSha256','retainedBindingSha256','metadataSha256','referencesSha256','sourceTreeSha256')) {
    if($intent.plan.$key -isnot [string] -or $intent.plan.$key -cnotmatch '\A[a-f0-9]{64}\z') { throw 'PREPARATION_PLAN_MISMATCH' }
  }
  $quarantine=Preparation-Document 'quarantined.json'
  $receipt=$quarantine.value
  Assert-PreparationKeys $receipt @('schema','operationId','planSha256','phase','publishedAtUtc')
  if($receipt.schema -cne 'workbridge-retention-phase/2' -or $receipt.operationId -cne $OperationId -or
     $receipt.planSha256 -cne $command.planSha256 -or $receipt.phase -cne 'quarantined' -or
     $quarantine.sha256 -cne $command.quarantineReceiptSha256 -or $receipt.publishedAtUtc -isnot [string] -or
     $receipt.publishedAtUtc -cnotmatch '\A[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z\z') { throw 'PREPARATION_RECEIPT_MISMATCH' }
  try { $when=[DateTimeOffset]::ParseExact($receipt.publishedAtUtc,"yyyy-MM-dd'T'HH:mm:ss.fff'Z'",[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal) }
  catch { throw 'PREPARATION_RECEIPT_MISMATCH' }
  $age=[DateTimeOffset]::UtcNow-$when
  if($age -lt [TimeSpan]::Zero -or $age -lt [TimeSpan]::FromDays(7)) { throw 'QUARANTINE_GRACE_NOT_ELAPSED' }
  $inventory=$lease.Inventory()
  $inventoryRoot=@($inventory.entries|Where-Object { $_.path -ceq '' })
  if($inventoryRoot.Count -ne 1 -or $inventoryRoot[0].identity.volume -ine $intent.plan.sourceIdentity.volume -or
     $inventoryRoot[0].identity.id -ine $intent.plan.sourceIdentity.id) { throw 'PREPARATION_LOCATION_CONFLICT' }
  $expectedRoot=[RetentionMaintenanceNative+Identity]::new();$expectedRoot.volume=[string]$intent.plan.sourceIdentity.volume;$expectedRoot.id=[string]$intent.plan.sourceIdentity.id
  $manifest=[RetentionMaintenanceNative+Lease]::ManifestBytes($inventory,$expectedRoot,$OperationId,$command.planSha256,$command.quarantineReceiptSha256)
  if([RetentionMaintenanceNative+Lease]::Sha256($manifest) -cne $command.manifestSha256) { throw 'PREPARATION_INVENTORY_CHANGED' }
  $approval=[RetentionMaintenanceNative+Lease]::ApprovalBytes($OperationId,$command.planSha256,$command.quarantineReceiptSha256,$command.manifestSha256,$command.referencesSha256,$command.retainedProofSha256)
  if([RetentionMaintenanceNative+Lease]::Sha256($approval) -cne $command.expectedPurgeSha256) { throw 'PREPARATION_APPROVAL_MISMATCH' }
  $lease.AssertPreparationNamespace()
  $existingManifest=$lease.ReadPreparationFile('purge-manifest.json',8*1024*1024)
  $existingApproval=$lease.ReadPreparationFile('purge-approval.json',65536)
  if($null -ne $existingApproval -and $null -eq $existingManifest) { throw 'PREPARATION_APPROVAL_WITHOUT_MANIFEST' }
  if(($null -ne $existingManifest -and -not [RetentionMaintenanceNative+Lease]::SameBytes($existingManifest,$manifest)) -or
     ($null -ne $existingApproval -and -not [RetentionMaintenanceNative+Lease]::SameBytes($existingApproval,$approval))) { throw 'PREPARATION_RECORD_CONFLICT' }
  if($clock.ElapsedMilliseconds -ge 60000) { throw 'PREPARATION_TIME_LIMIT' }
  $alreadyPrepared=$null -ne $existingManifest -and $null -ne $existingApproval
  if($null -eq $existingManifest) { $lease.PublishPreparationFile('purge-manifest.json',$manifest) }
  if($null -eq $existingApproval) { $lease.PublishPreparationFile('purge-approval.json',$approval) }
  $lease.AssertPreparationNamespace()
  $state=$lease.Inspect()
  if($state.source.exists -or -not $state.destination.exists -or
     $state.destination.identity.volume -ine $intent.plan.sourceIdentity.volume -or
     $state.destination.identity.id -ine $intent.plan.sourceIdentity.id) { throw 'PREPARATION_LOCATION_CONFLICT' }
  return @{status='ok';operationId=$OperationId;planSha256=$command.planSha256;quarantineReceiptSha256=$command.quarantineReceiptSha256;
    manifestSha256=$command.manifestSha256;purgeSha256=$command.expectedPurgeSha256;alreadyPrepared=$alreadyPrepared;
    source=$state.source;destination=$state.destination;sameVolume=$state.sameVolume}
}
$lease=$null
try {
  if($Mode -in @('Lease','Prepare') -and -not $MaintenanceConfirmed) { throw 'MAINTENANCE_REQUIRED' }
  if($InstallRoot -notmatch '^[A-Za-z]:\\') { throw 'ABSOLUTE_LOCAL_ROOT_REQUIRED' }
  $root=[IO.Path]::GetFullPath($InstallRoot)
  if($OperationId -notmatch '\A[A-Za-z0-9][A-Za-z0-9_-]{0,63}\z' -or $UpdaterOperationId -notmatch '\A[A-Za-z0-9][A-Za-z0-9_-]{0,63}\z' -or $OperationId -match '\A(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])\z' -or $UpdaterOperationId -match '\A(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])\z') { throw 'INVALID_OPERATION_ID' }
  if($Kind -eq 'displaced' -and $DisplacedId -notmatch '\A[A-Fa-f0-9]{32}\z') { throw 'INVALID_DISPLACED_ID' }
  if($Kind -eq 'candidate' -and -not [string]::IsNullOrEmpty($DisplacedId)) { throw 'UNEXPECTED_DISPLACED_ID' }
  $lease=[RetentionMaintenanceNative+Lease]::new($root,$OperationId,$UpdaterOperationId,$Kind,$DisplacedId,($Mode -in @('Lease','Prepare')))
  $state=$lease.Inspect()
  if($Mode -eq 'Inventory') { $clock=[Diagnostics.Stopwatch]::StartNew();Emit-Inventory $state ($lease.Inventory()) 'ready' $clock;exit 0 }
  Emit @{status='ready';source=$state.source;destination=$state.destination;sameVolume=$state.sameVolume}
  if($Mode -eq 'Inspect') { exit 0 }
  while($true) {
    $line=[RetentionMaintenanceNative]::ReadLineWithTimeout($TimeoutSeconds*1000)
    if($null -eq $line) { break }
    try {
      if($line.Length -gt 4096) { throw 'COMMAND_TOO_LARGE' }
      if($Mode -eq 'Prepare') { [RetentionMaintenanceNative]::StrictJsonKeys($line) }
      $command=ConvertFrom-Json -InputObject $line
      if($Mode -eq 'Prepare' -and $command.command -cnotin @('inspect','inventory','prepare')) { throw 'INVALID_COMMAND' }
      if($Mode -ne 'Prepare' -and $command.command -ceq 'prepare') { throw 'INVALID_COMMAND' }
      if($command.command -eq 'inspect') { $state=$lease.Inspect() }
      elseif($command.command -eq 'inventory') {
        $clock=[Diagnostics.Stopwatch]::StartNew()
        Emit-Inventory ($lease.Inspect()) ($lease.Inventory()) 'ok' $clock
        continue
      }
      elseif($command.command -eq 'prepare') {
        Emit (Prepare-Purge $command)
        continue
      }
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
