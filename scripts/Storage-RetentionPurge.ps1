#requires -Version 5.1
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$InstallRoot,
  [Parameter(Mandatory=$true)][string]$OperationId,
  [Parameter(Mandatory=$true)][string]$UpdaterOperationId,
  [Parameter(Mandatory=$true)][ValidateSet('candidate','displaced')][string]$Kind,
  [string]$DisplacedId,
  [Parameter(Mandatory=$true)][string]$ExpectedPurgeSha256,
  [Parameter(Mandatory=$true)][string]$ExpectedManifestSha256,
  [Parameter(Mandatory=$true)][string]$ConfirmPermanentlyDelete,
  [switch]$MaintenanceConfirmed,
  [ValidateRange(1,1800)][int]$TimeoutSeconds=120
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$WarningPreference='SilentlyContinue'
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using System.IO;
using System.Diagnostics;
using System.Globalization;
using System.Security.Cryptography;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;
public static class RetentionPurgeNative {
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
  [StructLayout(LayoutKind.Sequential)] struct UnicodeString { public ushort Length,MaximumLength; public IntPtr Buffer; }
  [StructLayout(LayoutKind.Sequential)] struct ObjectAttributes { public int Length; public IntPtr RootDirectory,ObjectName; public uint Attributes; public IntPtr SecurityDescriptor,SecurityQualityOfService; }
  [DllImport("ntdll.dll")] static extern int NtCreateFile(out SafeFileHandle handle,uint access,ref ObjectAttributes attributes,out IoStatus status,IntPtr allocationSize,uint fileAttributes,uint share,uint disposition,uint options,IntPtr eaBuffer,uint eaLength);
  [DllImport("kernel32.dll",EntryPoint="SetFileInformationByHandle",SetLastError=true)] static extern bool SetDisposition(SafeFileHandle h,int kind,byte[] value,uint size);
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
    readonly List<FileStream> journalPins=new List<FileStream>();
    readonly Dictionary<string,byte[]> journalCache=new Dictionary<string,byte[]>(StringComparer.Ordinal);
    sealed class JournalStamp { public Identity id; public FileBasic basic; public FileStream stream; }
    readonly Dictionary<string,JournalStamp> journalStamps=new Dictionary<string,JournalStamp>(StringComparer.Ordinal);
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
    static SafeFileHandle OpenRelative(SafeFileHandle parent,string name,bool directory,bool forDelete) {
      if(!SafeInventoryName(name))throw new IOException("INVALID_ENTRY_NAME");
      IntPtr nameBuffer=Marshal.StringToHGlobalUni(name);IntPtr nameStruct=IntPtr.Zero;
      try {
        var unicode=new UnicodeString { Length=checked((ushort)(name.Length*2)), MaximumLength=checked((ushort)(name.Length*2+2)), Buffer=nameBuffer };
        nameStruct=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(UnicodeString)));Marshal.StructureToPtr(unicode,nameStruct,false);
        var attributes=new ObjectAttributes { Length=Marshal.SizeOf(typeof(ObjectAttributes)),RootDirectory=parent.DangerousGetHandle(),ObjectName=nameStruct,Attributes=0x40 };
        IoStatus status;SafeFileHandle h;
        uint access=READ|0x100000u|(forDelete?DELETE:0u), options=0x200000u|0x20u|(directory?1u:0x40u);
        int result=NtCreateFile(out h,access,ref attributes,out status,IntPtr.Zero,0,SHARE_READ,1,options,IntPtr.Zero,0);
        if(result!=0){if(h!=null)h.Dispose();throw new IOException("RELATIVE_OPEN_FAILED NTSTATUS="+result.ToString("X8"));}
        try { GetIdentity(h,directory);return h; } catch {h.Dispose();throw;}
      } finally {if(nameStruct!=IntPtr.Zero)Marshal.FreeHGlobal(nameStruct);Marshal.FreeHGlobal(nameBuffer);}
    }
    public byte[] ReadJournal(string name,int maxBytes) {
      if(disposed || updater==null)throw new IOException("LEASE_REQUIRED");
      if(!Regex.IsMatch(name,@"\A(?:intent|quarantined|restoring|restored|purge-manifest|purge-approval|purging|purged|purge-batch-[0-9]{5}\.(?:intent|done))\.json\z",RegexOptions.CultureInvariant))throw new IOException("INVALID_JOURNAL_NAME");
      if(maxBytes<1 || maxBytes>8*1024*1024)throw new IOException("INVALID_JOURNAL_BOUND");
      byte[] cached;
      if(journalCache.TryGetValue(name,out cached)) {
        if(cached.Length>maxBytes)throw new IOException("JOURNAL_UNSAFE");
        return cached;
      }
      var h=OpenRelative(destinationParent,name,false,false);FileStream stream=null;
      try {
        var id=GetIdentity(h,false);var before=ReadBasic(h);var info=ReadStandard(h);
        if(info.NumberOfLinks!=1 || info.EndOfFile>maxBytes)throw new IOException("JOURNAL_UNSAFE");
        CheckNoNamedStreams(h,false);stream=new FileStream(h,FileAccess.Read,65536,false);
        byte[] bytes=new byte[(int)info.EndOfFile];int used=0;
        while(used<bytes.Length) {int n=stream.Read(bytes,used,bytes.Length-used);if(n==0)throw new IOException("JOURNAL_CHANGED");used+=n;}
        if(stream.ReadByte()!=-1 || !Equal(id,GetIdentity(h,false)) || !SameBasic(before,ReadBasic(h)))throw new IOException("JOURNAL_CHANGED");
        journalPins.Add(stream);journalCache.Add(name,bytes);
        journalStamps.Add(name,new JournalStamp {id=id,basic=ReadBasic(h),stream=stream});
        stream=null;return bytes;
      } finally {if(stream!=null)stream.Dispose();else if(!journalPins.Exists(x=>x.SafeFileHandle==h))h.Dispose();}
    }
    public bool JournalExists(string name) {
      try {ReadJournal(name,8*1024*1024);return true;}
      catch(IOException error) {if(error.Message=="RELATIVE_OPEN_FAILED NTSTATUS=C0000034")return false;throw;}
    }
    void AssertPinnedJournals() {
      foreach(var stamp in journalStamps.Values) {
        var handle=stamp.stream.SafeFileHandle;
        if(!Equal(stamp.id,GetIdentity(handle,false)) || !SameBasic(stamp.basic,ReadBasic(handle)) ||
           ReadStandard(handle).NumberOfLinks!=1)throw new IOException("JOURNAL_CHANGED");
        CheckNoNamedStreams(handle,false);
      }
    }
    public Dictionary<string,string> ReadPurgeJournals() {
      if(disposed || updater==null)throw new IOException("LEASE_REQUIRED");
      AssertPinnedJournals();
      var result=new Dictionary<string,string>(StringComparer.Ordinal);long total=0;int count=0;
      var clock=Stopwatch.StartNew();
      var parentId=GetIdentity(destinationParent,true);var parentBefore=ReadBasic(destinationParent);
      foreach(string file in Directory.EnumerateFileSystemEntries(operationDirectory)) {
        if(clock.ElapsedMilliseconds>=60000)throw new IOException("JOURNAL_TIME_LIMIT");
        string name=Path.GetFileName(file);
        if(!name.StartsWith("purge",StringComparison.OrdinalIgnoreCase) &&
           !name.StartsWith("purging",StringComparison.OrdinalIgnoreCase) &&
           !String.Equals(name,"restoring.json",StringComparison.OrdinalIgnoreCase) &&
           !String.Equals(name,"restored.json",StringComparison.OrdinalIgnoreCase))continue;
        if(++count>2048)throw new IOException("JOURNAL_ENTRY_LIMIT");
        byte[] bytes=ReadJournal(name,name=="purge-manifest.json"?8*1024*1024:65536);
        total+=bytes.Length;if(total>9L*1024*1024)throw new IOException("JOURNAL_BYTE_LIMIT");
        if(bytes.Length>=3 && bytes[0]==0xEF && bytes[1]==0xBB && bytes[2]==0xBF)throw new IOException("DOCUMENT_BOM_REFUSED");
        result.Add(name,new UTF8Encoding(false,true).GetString(bytes));
      }
      if(!Equal(parentId,GetIdentity(destinationParent,true)) || !SameBasic(parentBefore,ReadBasic(destinationParent)))throw new IOException("JOURNAL_DIRECTORY_CHANGED");
      return result;
    }
    public void PublishJournal(string name,byte[] content) {
      if(disposed || updater==null)throw new IOException("LEASE_REQUIRED");
      AssertPinnedJournals();
      if(!Regex.IsMatch(name,@"\A(?:purging|purged|purge-batch-[0-9]{5}\.(?:intent|done))\.json\z",RegexOptions.CultureInvariant))throw new IOException("INVALID_JOURNAL_NAME");
      if(content==null || content.Length<1 || content.Length>65536)throw new IOException("INVALID_JOURNAL_BOUND");
      if(!String.Equals(GetIdentity(destinationParent,true).volume,volume,StringComparison.OrdinalIgnoreCase))throw new IOException("CROSS_VOLUME");
      string temporary=Path.Combine(operationDirectory,".purge-"+Guid.NewGuid().ToString("N")+".tmp");
      var h=Open(temporary,READ|WRITE|DELETE,SHARE_READ,IntPtr.Zero,CREATE_NEW,OPEN_REPARSE,IntPtr.Zero);
      if(h.IsInvalid){h.Dispose();throw Error("JOURNAL_TEMP_CREATE_FAILED");}
      FileStream stream=null;
      try {
        var initial=GetIdentity(h,false);var standard=ReadStandard(h);
        if(standard.NumberOfLinks!=1 || !String.Equals(initial.volume,volume,StringComparison.OrdinalIgnoreCase))throw new IOException("JOURNAL_UNSAFE");
        CheckNoNamedStreams(h,false);stream=new FileStream(h,FileAccess.ReadWrite,4096,false);
        stream.Write(content,0,content.Length);stream.Flush(true);
        if(!Equal(initial,GetIdentity(h,false)) || ReadStandard(h).NumberOfLinks!=1)throw new IOException("JOURNAL_CHANGED");
        byte[] bytes=Encoding.Unicode.GetBytes(name);int offset=(int)Marshal.OffsetOf(typeof(RenameHeader),"Name");
        IntPtr buffer=Marshal.AllocHGlobal(offset+bytes.Length+2);
        try {
          for(int i=0;i<offset+bytes.Length+2;i++)Marshal.WriteByte(buffer,i,0);
          Marshal.WriteIntPtr(buffer,(int)Marshal.OffsetOf(typeof(RenameHeader),"Root"),destinationParent.DangerousGetHandle());
          Marshal.WriteInt32(buffer,(int)Marshal.OffsetOf(typeof(RenameHeader),"Length"),bytes.Length);Marshal.Copy(bytes,0,IntPtr.Add(buffer,offset),bytes.Length);
          IoStatus status;int code=NtSetInformationFile(h,out status,buffer,(uint)(offset+bytes.Length+2),RenameInfo);
          if(code!=0)throw new IOException("JOURNAL_PUBLISH_FAILED_OR_PENDING NTSTATUS="+code.ToString("X8"));
        } finally {Marshal.FreeHGlobal(buffer);}
        if(!Equal(initial,GetIdentity(h,false)) || ReadStandard(h).NumberOfLinks!=1)throw new IOException("JOURNAL_CHANGED");
        using(var published=Open(Path.Combine(operationDirectory,name),ATTR,SHARE_READ|SHARE_WRITE|SHARE_DELETE,IntPtr.Zero,EXISTING,OPEN_REPARSE,IntPtr.Zero)) {
          if(published.IsInvalid)throw Error("JOURNAL_PUBLISHED_ID_UNAVAILABLE");
          if(!Equal(initial,GetIdentity(published,false)) || ReadStandard(published).NumberOfLinks!=1)throw new IOException("JOURNAL_PUBLISHED_ID_CHANGED");
        }
        journalPins.Add(stream);journalCache.Add(name,content);
        journalStamps.Add(name,new JournalStamp {id=initial,basic=ReadBasic(h),stream=stream});stream=null;
      } finally {if(stream!=null)stream.Dispose();else if(!journalPins.Exists(x=>x.SafeFileHandle==h))h.Dispose();}
    }
    public void ValidateManifest(InventoryEntry[] entries,Identity expectedRoot) {
      if(entries==null || entries.Length<1 || entries.Length>20000 || expectedRoot==null)throw new IOException("INVALID_MANIFEST");
      var paths=new Dictionary<string,InventoryEntry>(StringComparer.OrdinalIgnoreCase);var ids=new HashSet<string>(StringComparer.OrdinalIgnoreCase);long bytes=0;
      for(int i=0;i<entries.Length;i++) {
        var item=entries[i];if(item==null || item.path==null || item.path.Length>4096 || item.identity==null ||
          !Regex.IsMatch(item.identity.volume??"",@"\A[0-9A-Fa-f]{16}\z") || !Regex.IsMatch(item.identity.id??"",@"\A[0-9A-Fa-f]{32}\z") ||
          !String.Equals(item.identity.volume,volume,StringComparison.OrdinalIgnoreCase) || item.nlink<1 || item.size<0)throw new IOException("INVALID_MANIFEST");
        if(i>0 && StringComparer.Ordinal.Compare(entries[i-1].path,item.path)>=0)throw new IOException("INVALID_MANIFEST_ORDER");
        if(item.path.Length>0)foreach(var part in item.path.Split('/'))if(!SafeInventoryName(part))throw new IOException("INVALID_ENTRY_NAME");
        if(paths.ContainsKey(item.path) || !ids.Add(item.identity.volume+":"+item.identity.id))throw new IOException("MANIFEST_COLLISION");
        if(item.type=="file") {
          if(item.nlink!=1 || !Regex.IsMatch(item.sha256??"",@"\A[0-9a-f]{64}\z"))throw new IOException("INVALID_MANIFEST_FILE");
          bytes=checked(bytes+item.size);if(bytes>512L*1024*1024)throw new IOException("INVENTORY_BYTE_LIMIT");
        } else if(item.type!="directory" || item.size!=0 || item.sha256!=null)throw new IOException("INVALID_MANIFEST_DIRECTORY");
        paths.Add(item.path,item);
      }
      if(entries[0].path!="" || entries[0].type!="directory" || !Equal(entries[0].identity,expectedRoot))throw new IOException("ROOT_IDENTITY_MISMATCH");
      foreach(var item in entries)if(item.path.Length>0) {
        int slash=item.path.LastIndexOf('/');string parent=slash<0?"":item.path.Substring(0,slash);InventoryEntry found;
        if(!paths.TryGetValue(parent,out found) || found.type!="directory")throw new IOException("MANIFEST_PARENT_MISSING");
      }
    }
    public sealed class RemainingResult {
      public int committedPrefix {get;set;} public int observedAbsentPrefix {get;set;} public int entryCount {get;set;}
      public bool rootPresent {get;set;} public bool sourcePresent {get;set;} public bool complete {get;set;}
    }
    static bool SameEntry(InventoryEntry a,InventoryEntry b) {
      return a.path==b.path && a.type==b.type && Equal(a.identity,b.identity) && a.size==b.size &&
        a.nlink==b.nlink && String.Equals(a.sha256,b.sha256,StringComparison.OrdinalIgnoreCase);
    }
    public RemainingResult InspectRemaining(InventoryEntry[] ascending,int committedPrefix,int inflightEnd) {
      if(disposed || updater==null)throw new IOException("LEASE_REQUIRED");
      AssertPinnedJournals();
      if(ascending==null || ascending.Length<1 || ascending.Length>20000 || committedPrefix<0 || committedPrefix>ascending.Length ||
        inflightEnd<committedPrefix || inflightEnd>Math.Min(ascending.Length,committedPrefix+32))throw new IOException("INVALID_RANGE");
      var locations=Inspect();if(locations.source.exists)throw new IOException("SOURCE_PRESENT");
      var actual=new Dictionary<string,InventoryEntry>(StringComparer.Ordinal);
      if(locations.destination.exists)foreach(var item in Inventory().entries)if(actual.ContainsKey(item.path))throw new IOException("DUPLICATE_PATH");else actual.Add(item.path,item);
      int absent=0;bool seenPresent=false;
      for(int i=0;i<ascending.Length;i++) {
        var expected=ascending[ascending.Length-1-i]; InventoryEntry found;
        if(actual.TryGetValue(expected.path,out found)) {seenPresent=true;if(!SameEntry(found,expected))throw new IOException("ENTRY_CHANGED");actual.Remove(expected.path);}
        else {if(seenPresent)throw new IOException("NONCONTIGUOUS_MISSING");absent++;}
      }
      if(actual.Count!=0 || absent<committedPrefix || absent>inflightEnd)throw new IOException("REMAINING_CONFLICT");
      if(!locations.destination.exists && absent!=ascending.Length)throw new IOException("ROOT_MISSING");
      return new RemainingResult {committedPrefix=committedPrefix,observedAbsentPrefix=absent,entryCount=ascending.Length,rootPresent=locations.destination.exists,sourcePresent=false,complete=true};
    }
    void DeleteExact(InventoryEntry expected,Dictionary<string,InventoryEntry> manifest,Stopwatch batchClock) {
      if(batchClock.ElapsedMilliseconds>=60000)throw new IOException("PURGE_TIME_LIMIT");
      var pinsForItem=new List<SafeFileHandle>();
      try {
        SafeFileHandle parent=destinationParent;string[] parts=expected.path.Length==0?new string[]{"payload"}:expected.path.Split('/');
        if(expected.path.Length>0) {
          parent=OpenRelative(destinationParent,"payload",true,false);pinsForItem.Add(parent);
          if(!Equal(GetIdentity(parent,true),manifest[""].identity))throw new IOException("ANCESTOR_IDENTITY_CHANGED");
          CheckNoNamedStreams(parent,true);ReadBasic(parent);
          string parentPath="";
          for(int i=0;i<parts.Length-1;i++) {
            parent=OpenRelative(parent,parts[i],true,false);pinsForItem.Add(parent);
            parentPath=parentPath.Length==0?parts[i]:parentPath+"/"+parts[i];
            InventoryEntry expectedParent;
            if(!manifest.TryGetValue(parentPath,out expectedParent) || expectedParent.type!="directory" || !Equal(GetIdentity(parent,true),expectedParent.identity))throw new IOException("ANCESTOR_IDENTITY_CHANGED");
            CheckNoNamedStreams(parent,true);ReadBasic(parent);
          }
        }
        using(var h=OpenRelative(parent,parts[parts.Length-1],expected.type=="directory",true)) {
          var id=GetIdentity(h,expected.type=="directory");var basic=ReadBasic(h);var standard=ReadStandard(h);
          if(!Equal(id,expected.identity) || !String.Equals(id.volume,volume,StringComparison.OrdinalIgnoreCase))throw new IOException("ENTRY_IDENTITY_CHANGED");
          if(expected.type=="file") {
            if(standard.NumberOfLinks!=1 || standard.EndOfFile!=expected.size)throw new IOException("ENTRY_CHANGED");
            CheckNoNamedStreams(h,false);
            using(var stream=new FileStream(h,FileAccess.Read,65536,false))
            using(var sha=SHA256.Create()) {
              byte[] buffer=new byte[65536];int n;long read=0;
              while((n=stream.Read(buffer,0,buffer.Length))>0) {read+=n;if(read>expected.size || batchClock.ElapsedMilliseconds>=60000)throw new IOException("ENTRY_READ_LIMIT");sha.TransformBlock(buffer,0,n,buffer,0);}
              sha.TransformFinalBlock(new byte[0],0,0);
              if(read!=expected.size || !String.Equals(BitConverter.ToString(sha.Hash).Replace("-","").ToLowerInvariant(),expected.sha256,StringComparison.Ordinal) ||
                 !Equal(id,GetIdentity(h,false)) || !SameBasic(basic,ReadBasic(h)) || ReadStandard(h).NumberOfLinks!=1)throw new IOException("ENTRY_CHANGED");
              CheckNoNamedStreams(h,false);
              if(!SetDisposition(h,4,new byte[]{1},1))throw Error("DISPOSITION_FAILED");
            }
          } else {
            CheckNoNamedStreams(h,true);
            if(!Equal(id,GetIdentity(h,true)) || !SameBasic(basic,ReadBasic(h)))throw new IOException("ENTRY_CHANGED");
            if(!SetDisposition(h,4,new byte[]{1},1))throw Error("DISPOSITION_FAILED");
          }
        }
      } finally {for(int i=pinsForItem.Count-1;i>=0;i--)pinsForItem[i].Dispose();}
    }
    public int DeleteBatch(InventoryEntry[] ascending,int start,int end) {
      var batchClock=Stopwatch.StartNew();var remaining=InspectRemaining(ascending,start,end);int removed=0;
      if(batchClock.ElapsedMilliseconds>=60000)throw new IOException("PURGE_TIME_LIMIT");
      var manifest=new Dictionary<string,InventoryEntry>(StringComparer.Ordinal);
      foreach(var entry in ascending)manifest.Add(entry.path,entry);
      for(int i=remaining.observedAbsentPrefix;i<end;i++) {
        if(Inspect().source.exists)throw new IOException("SOURCE_PRESENT");
        DeleteExact(ascending[ascending.Length-1-i],manifest,batchClock);removed++;
      }
      if(Inspect().source.exists)throw new IOException("SOURCE_PRESENT");
      if(batchClock.ElapsedMilliseconds>=60000)throw new IOException("PURGE_TIME_LIMIT");
      InspectRemaining(ascending,end,end);
      if(batchClock.ElapsedMilliseconds>=60000)throw new IOException("PURGE_TIME_LIMIT");
      return removed;
    }
    public void Dispose() { if(disposed)return;disposed=true;for(int i=journalPins.Count-1;i>=0;i--)journalPins[i].Dispose();if(updater!=null)updater.Dispose();for(int i=pins.Count-1;i>=0;i--)pins[i].Dispose(); }
  }
}
'@
function Emit($object) { [Console]::Out.WriteLine(($object|ConvertTo-Json -Compress -Depth 8)) }
$script:documentCache=@{}
function Assert-Keys($value,[string[]]$expected) {
  if($null -eq $value -or $value -is [array] -or $value -isnot [pscustomobject]) { throw 'INVALID_DOCUMENT' }
  $actual=[string[]]@($value.PSObject.Properties.Name)
  $wanted=[string[]]@($expected)
  [Array]::Sort($actual,[StringComparer]::Ordinal);[Array]::Sort($wanted,[StringComparer]::Ordinal)
  if([string]::Join('|',$actual) -cne [string]::Join('|',$wanted)) { throw 'INVALID_DOCUMENT_FIELDS' }
}
function Doc([string]$name,[int]$maximum=65536) {
  if($script:documentCache.ContainsKey($name)) { return $script:documentCache[$name] }
  $bytes=$lease.ReadJournal($name,$maximum)
  $sha=[Security.Cryptography.SHA256]::Create()
  try { $digest=[BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
  if($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) { throw 'DOCUMENT_BOM_REFUSED' }
  $text=[Text.UTF8Encoding]::new($false,$true).GetString($bytes)
  [RetentionPurgeNative]::StrictJsonKeys($text)
  $doc=@{value=(ConvertFrom-Json -InputObject $text);sha256=$digest}
  $script:documentCache[$name]=$doc
  return $doc
}
function Is-Hash($value) { return $value -is [string] -and $value -cmatch '\A[0-9a-f]{64}\z' }
function Canonical($value) {
  if($null -eq $value) { return 'null' }
  if($value -is [string]) { return [RetentionPurgeNative]::QuoteJson($value) }
  if($value -is [int] -or $value -is [long]) { return $value.ToString([Globalization.CultureInfo]::InvariantCulture) }
  if($value -isnot [pscustomobject]) { throw 'INVALID_PLAN_VALUE' }
  $keys=[string[]]@($value.PSObject.Properties.Name);[Array]::Sort($keys,[StringComparer]::Ordinal)
  $parts=[Collections.Generic.List[string]]::new()
  foreach($key in $keys) { $parts.Add(([RetentionPurgeNative]::QuoteJson($key)+':'+(Canonical $value.$key))) }
  return '{'+[string]::Join(',',$parts)+'}'
}
function Same-Identity($a,$b) {
  return $null -ne $a -and $null -ne $b -and [string]$a.volume -ieq [string]$b.volume -and [string]$a.id -ieq [string]$b.id
}
function Assert-QuarantineGrace {
  $age=[DateTimeOffset]::UtcNow-$quarantinedAt
  if($age -lt [TimeSpan]::Zero) { throw 'QUARANTINE_IN_FUTURE' }
  if($age -lt [TimeSpan]::FromDays(7)) { throw 'QUARANTINE_GRACE_NOT_ELAPSED' }
}
function Assert-Purging {
  $doc=(Doc 'purging.json').value
  Assert-Keys $doc @('schema','operationId','planSha256','purgeSha256','manifestSha256','entryCount','batchLimit')
  if($doc.schema -cne 'workbridge-purging/1' -or $doc.operationId -cne $OperationId -or $doc.planSha256 -cne $planHash -or
     $doc.purgeSha256 -cne $ExpectedPurgeSha256 -or $doc.manifestSha256 -cne $ExpectedManifestSha256 -or
     $doc.entryCount -ne $entries.Length -or $doc.batchLimit -ne 32) { throw 'PURGING_BINDING_MISMATCH' }
}
function Get-Batch([int]$start,[bool]$done) {
  $kind=if($done){'done'}else{'intent'}
  $name='purge-batch-'+$start.ToString('D5')+'.'+$kind+'.json'
  $doc=(Doc $name).value
  if($done) { Assert-Keys $doc @('schema','operationId','purgeSha256','manifestSha256','start','end','priorAbsent','observedRemoved') }
  else { Assert-Keys $doc @('schema','operationId','purgeSha256','manifestSha256','start','end') }
  $expectedSchema=if($done){'workbridge-purge-batch-done/1'}else{'workbridge-purge-batch/1'}
  if($doc.schema -cne $expectedSchema -or $doc.operationId -cne $OperationId -or
     $doc.purgeSha256 -cne $ExpectedPurgeSha256 -or $doc.manifestSha256 -cne $ExpectedManifestSha256 -or
     $doc.start -isnot [int] -or $doc.end -isnot [int] -or $doc.start -ne $start -or
     $doc.end -le $start -or $doc.end -gt [Math]::Min($entries.Length,$start+32)) { throw 'BATCH_BINDING_MISMATCH' }
  if($done -and ($doc.priorAbsent -isnot [int] -or $doc.observedRemoved -isnot [int] -or
    $doc.priorAbsent -lt 0 -or $doc.observedRemoved -lt 0 -or $doc.priorAbsent+$doc.observedRemoved -ne $doc.end-$doc.start)) { throw 'BATCH_DONE_INVALID' }
  return $doc
}
function Assert-Prefix([int]$prefix) {
  if($prefix -lt 0 -or $prefix -gt $entries.Length) { throw 'INVALID_RANGE' }
  $script:knownBatchNames=@{}
  $cursor=0
  while($cursor -lt $prefix) {
    $intent=Get-Batch $cursor $false;$done=Get-Batch $cursor $true
    if($intent.end -ne $done.end -or $done.end -gt $prefix) { throw 'BATCH_CHAIN_CONFLICT' }
    $stem='purge-batch-'+$cursor.ToString('D5')
    $script:knownBatchNames[$stem+'.intent.json']=$true;$script:knownBatchNames[$stem+'.done.json']=$true
    $cursor=$done.end
  }
}
function Assert-NoExtraBatches([int]$current,[bool]$allowIntent) {
  $files=$lease.ReadPurgeJournals()
  $currentName='purge-batch-'+$current.ToString('D5')+'.intent.json'
  foreach($name in $files.Keys) {
    if($name.StartsWith('purge-batch-',[StringComparison]::Ordinal) -and -not $script:knownBatchNames.ContainsKey($name) -and
       -not ($allowIntent -and $name -ceq $currentName)) { throw 'BATCH_CHAIN_CONFLICT' }
  }
}
function Publish-Fixed([string]$name,$expected,$provided) {
  if((Canonical $provided) -cne (Canonical $expected)) { throw 'PUBLISH_RECORD_MISMATCH' }
  $content=[Text.UTF8Encoding]::new($false,$true).GetBytes((Canonical $expected)+"`n")
  $lease.PublishJournal($name,$content)
}
$lease=$null
try {
  if(-not $MaintenanceConfirmed -or $ConfirmPermanentlyDelete -cne $OperationId) { throw 'EXPLICIT_CONFIRMATION_REQUIRED' }
  if($InstallRoot -notmatch '\A[A-Za-z]:\\' -or $OperationId -notmatch '\A[A-Za-z0-9][A-Za-z0-9_-]{0,63}\z' -or
     $UpdaterOperationId -notmatch '\A[A-Za-z0-9][A-Za-z0-9_-]{0,63}\z' -or
     $OperationId -match '\A(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])\z' -or $UpdaterOperationId -match '\A(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])\z') { throw 'INVALID_ARGUMENT' }
  if($Kind -eq 'displaced' -and $DisplacedId -notmatch '\A[a-fA-F0-9]{32}\z') { throw 'INVALID_DISPLACED_ID' }
  if($Kind -eq 'candidate' -and -not [string]::IsNullOrEmpty($DisplacedId)) { throw 'INVALID_DISPLACED_ID' }
  if(-not (Is-Hash $ExpectedPurgeSha256) -or -not (Is-Hash $ExpectedManifestSha256)) { throw 'INVALID_DIGEST' }
  $root=[IO.Path]::GetFullPath($InstallRoot)
  $lease=[RetentionPurgeNative+Lease]::new($root,$OperationId,$UpdaterOperationId,$Kind,$DisplacedId,$true)
  if($lease.Inspect().source.exists) { throw 'SOURCE_PRESENT' }
  $manifest=Doc 'purge-manifest.json' (8*1024*1024)
  if($manifest.sha256 -cne $ExpectedManifestSha256) { throw 'MANIFEST_HASH_MISMATCH' }
  $m=$manifest.value
  Assert-Keys $m @('schema','operationId','planSha256','quarantineReceiptSha256','expectedRoot','entries')
  Assert-Keys $m.expectedRoot @('volume','id')
  if($m.schema -cne 'workbridge-purge-manifest/1' -or $m.operationId -cne $OperationId -or
     -not (Is-Hash $m.planSha256) -or -not (Is-Hash $m.quarantineReceiptSha256) -or $m.entries -isnot [array] -or
     $m.expectedRoot.volume -isnot [string] -or $m.expectedRoot.id -isnot [string] -or
     $m.entries.Count -lt 1 -or $m.entries.Count -gt 20000) { throw 'INVALID_MANIFEST' }
  $planHash=[string]$m.planSha256
  $approval=Doc 'purge-approval.json'
  if($approval.sha256 -cne $ExpectedPurgeSha256) { throw 'APPROVAL_HASH_MISMATCH' }
  $a=$approval.value
  Assert-Keys $a @('schema','operationId','planSha256','quarantineReceiptSha256','manifestSha256','referencesSha256','retainedProofSha256')
  if($a.schema -cne 'workbridge-purge-approval/1' -or $a.operationId -cne $OperationId -or $a.planSha256 -cne $planHash -or
     $a.quarantineReceiptSha256 -cne $m.quarantineReceiptSha256 -or $a.manifestSha256 -cne $ExpectedManifestSha256 -or
     -not (Is-Hash $a.referencesSha256) -or -not (Is-Hash $a.retainedProofSha256)) { throw 'APPROVAL_BINDING_MISMATCH' }
  $original=(Doc 'intent.json').value
  Assert-Keys $original @('schema','operationId','planSha256','plan')
  Assert-Keys $original.plan @('schema','host','installRoot','updaterOperationId','kind','displacedId','sourceIdentity','manifestSha256','retainedBindingSha256','metadataSha256','referencesSha256','sourceTreeSha256')
  Assert-Keys $original.plan.sourceIdentity @('volume','id')
  $planBytes=[Text.UTF8Encoding]::new($false,$true).GetBytes((Canonical $original.plan))
  $planHasher=[Security.Cryptography.SHA256]::Create()
  try { $actualPlanHash=[BitConverter]::ToString($planHasher.ComputeHash($planBytes)).Replace('-','').ToLowerInvariant() } finally { $planHasher.Dispose() }
  if($original.schema -cne 'workbridge-retention-intent/1' -or $original.operationId -cne $OperationId -or
     $original.planSha256 -cne $planHash -or $actualPlanHash -cne $planHash -or
     $original.plan.schema -cne 'workbridge-retention-plan/1' -or $original.plan.host -ine [Environment]::MachineName -or
     $original.plan.updaterOperationId -cne $UpdaterOperationId -or
     $original.plan.kind -cne $Kind -or [IO.Path]::GetFullPath([string]$original.plan.installRoot) -ine $root -or
     -not (Same-Identity $original.plan.sourceIdentity $m.expectedRoot)) { throw 'QUARANTINE_PLAN_MISMATCH' }
  foreach($key in @('manifestSha256','retainedBindingSha256','metadataSha256','referencesSha256','sourceTreeSha256')) {
    if(-not (Is-Hash $original.plan.$key)) { throw 'QUARANTINE_PLAN_MISMATCH' }
  }
  if($Kind -eq 'displaced' -and $original.plan.displacedId -cne $DisplacedId) { throw 'QUARANTINE_PLAN_MISMATCH' }
  if($Kind -eq 'candidate' -and $null -ne $original.plan.displacedId) { throw 'QUARANTINE_PLAN_MISMATCH' }
  $quarantine=Doc 'quarantined.json'
  if($quarantine.sha256 -cne $m.quarantineReceiptSha256 -or $quarantine.value.operationId -cne $OperationId -or
     $quarantine.value.planSha256 -cne $planHash -or $quarantine.value.phase -cne 'quarantined' -or
     $quarantine.value.schema -cnotin @('workbridge-retention-phase/1','workbridge-retention-phase/2')) { throw 'QUARANTINE_RECEIPT_MISMATCH' }
  if($quarantine.value.schema -ceq 'workbridge-retention-phase/1') { throw 'QUARANTINE_LEGACY_NO_TIME' }
  Assert-Keys $quarantine.value @('schema','operationId','planSha256','phase','publishedAtUtc')
  if($quarantine.value.publishedAtUtc -isnot [string] -or $quarantine.value.publishedAtUtc -cnotmatch '\A[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z\z') { throw 'QUARANTINE_RECEIPT_MISMATCH' }
  try { $quarantinedAt=[DateTimeOffset]::ParseExact($quarantine.value.publishedAtUtc,"yyyy-MM-dd'T'HH:mm:ss.fff'Z'",[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal) }
  catch { throw 'QUARANTINE_RECEIPT_MISMATCH' }
  Assert-QuarantineGrace
  if($lease.JournalExists('restoring.json') -or $lease.JournalExists('restored.json')) { throw 'RESTORE_IN_PROGRESS_OR_COMPLETE' }
  $expectedRoot=[RetentionPurgeNative+Identity]::new();$expectedRoot.volume=[string]$m.expectedRoot.volume;$expectedRoot.id=[string]$m.expectedRoot.id
  $entries=[RetentionPurgeNative+Lease+InventoryEntry[]]::new($m.entries.Count)
  for($i=0;$i -lt $m.entries.Count;$i++) {
    $entry=$m.entries[$i];Assert-Keys $entry @('path','type','identity','size','nlink','sha256');Assert-Keys $entry.identity @('volume','id')
    if($entry.path -isnot [string] -or $entry.type -isnot [string] -or $entry.size -isnot [int] -and $entry.size -isnot [long] -or
       $entry.nlink -isnot [int] -and $entry.nlink -isnot [long] -or $entry.identity.volume -isnot [string] -or
       $entry.identity.id -isnot [string] -or ($null -ne $entry.sha256 -and $entry.sha256 -isnot [string])) { throw 'INVALID_MANIFEST_ENTRY' }
    $item=[RetentionPurgeNative+Lease+InventoryEntry]::new();$item.path=$entry.path;$item.type=$entry.type;$item.size=[long]$entry.size;$item.nlink=[uint32]$entry.nlink
    $item.identity=[RetentionPurgeNative+Identity]::new();$item.identity.volume=[string]$entry.identity.volume;$item.identity.id=[string]$entry.identity.id
    if($null -ne $entry.sha256){$item.sha256=[string]$entry.sha256};$entries[$i]=$item
  }
  $lease.ValidateManifest($entries,$expectedRoot)
  [long]$logicalBytes=0;foreach($entry in $entries){if($entry.type -ceq 'file'){$logicalBytes+=$entry.size}}
  $lastBatch=$null
  Emit @{status='ready';operationId=$OperationId;manifestSha256=$ExpectedManifestSha256;entryCount=$entries.Length}
  while($true) {
    $line=[RetentionPurgeNative]::ReadLineWithTimeout($TimeoutSeconds*1000);if($null -eq $line){break}
    try {
      if($line.Length -gt 4096){throw 'COMMAND_TOO_LARGE'}
      [RetentionPurgeNative]::StrictJsonKeys($line);$command=ConvertFrom-Json -InputObject $line
      if($command.command -ceq 'readJournals') {
        Assert-Keys $command @('command')
        $json=@{status='ok';files=$lease.ReadPurgeJournals()}|ConvertTo-Json -Compress -Depth 8
        if([Text.Encoding]::UTF8.GetByteCount($json) -gt 16*1024*1024){throw 'JOURNAL_OUTPUT_LIMIT'}
        [Console]::Out.WriteLine($json)
      } elseif($command.command -ceq 'publish') {
        Assert-Keys $command @('command','kind','record')
        if($lease.JournalExists('restoring.json') -or $lease.JournalExists('restored.json') -or $lease.JournalExists('purged.json')){throw 'TERMINAL_JOURNAL_CONFLICT'}
        $base=@{operationId=$OperationId;purgeSha256=$ExpectedPurgeSha256;manifestSha256=$ExpectedManifestSha256}
        if($command.kind -ceq 'purging') {
          Assert-Keys $command.record @('schema','operationId','planSha256','purgeSha256','manifestSha256','entryCount','batchLimit')
          Assert-Prefix 0;Assert-NoExtraBatches 0 $false
          [void]$lease.InspectRemaining($entries,0,0)
          $expected=[pscustomobject]@{schema='workbridge-purging/1';operationId=$OperationId;planSha256=$planHash;purgeSha256=$ExpectedPurgeSha256;manifestSha256=$ExpectedManifestSha256;entryCount=$entries.Length;batchLimit=32}
          Publish-Fixed 'purging.json' $expected $command.record
        } elseif($command.kind -ceq 'intent' -or $command.kind -ceq 'done') {
          if($command.kind -ceq 'intent'){Assert-Keys $command.record @('schema','operationId','purgeSha256','manifestSha256','start','end')}
          else {Assert-Keys $command.record @('schema','operationId','purgeSha256','manifestSha256','start','end','priorAbsent','observedRemoved')}
          if($command.record.start -isnot [int] -or $command.record.end -isnot [int]){throw 'INVALID_RANGE'}
          $start=[int]$command.record.start;$end=[int]$command.record.end
          if($start -lt 0 -or $start -ge $entries.Length -or $end -le $start -or $end -gt [Math]::Min($entries.Length,$start+32)){throw 'INVALID_RANGE'}
          Assert-Purging;Assert-Prefix $start
          $stem='purge-batch-'+$start.ToString('D5')
          if($command.kind -ceq 'intent') {
            Assert-NoExtraBatches $start $false
            [void]$lease.InspectRemaining($entries,$start,$start)
            $expected=[pscustomobject]@{schema='workbridge-purge-batch/1';operationId=$OperationId;purgeSha256=$ExpectedPurgeSha256;manifestSha256=$ExpectedManifestSha256;start=$start;end=$end}
            Publish-Fixed ($stem+'.intent.json') $expected $command.record
          } else {
            Assert-NoExtraBatches $start $true
            $intent=Get-Batch $start $false;if($intent.end -ne $end){throw 'BATCH_BINDING_MISMATCH'}
            if($null -eq $lastBatch -or $lastBatch.start -ne $start -or $lastBatch.end -ne $end){throw 'BATCH_RESULT_MISSING'}
            [void]$lease.InspectRemaining($entries,$end,$end)
            $expected=[pscustomobject]@{schema='workbridge-purge-batch-done/1';operationId=$OperationId;purgeSha256=$ExpectedPurgeSha256;manifestSha256=$ExpectedManifestSha256;start=$start;end=$end;priorAbsent=$lastBatch.first-$start;observedRemoved=$lastBatch.removed}
            Publish-Fixed ($stem+'.done.json') $expected $command.record
          }
        } elseif($command.kind -ceq 'purged') {
          Assert-Keys $command.record @('schema','operationId','planSha256','purgeSha256','manifestSha256','entryCount','logicalBytesRemoved')
          Assert-Purging;Assert-Prefix $entries.Length;Assert-NoExtraBatches $entries.Length $false
          [void]$lease.InspectRemaining($entries,$entries.Length,$entries.Length)
          $expected=[pscustomobject]@{schema='workbridge-purged/1';operationId=$OperationId;planSha256=$planHash;purgeSha256=$ExpectedPurgeSha256;manifestSha256=$ExpectedManifestSha256;entryCount=$entries.Length;logicalBytesRemoved=$logicalBytes}
          Publish-Fixed 'purged.json' $expected $command.record
        } else {throw 'INVALID_PUBLISH_KIND'}
        Emit @{status='ok'}
      } elseif($command.command -ceq 'inspectRemaining') {
        Assert-Keys $command @('command','committedPrefix','inflightEnd')
        if($command.committedPrefix -isnot [int] -or ($null -ne $command.inflightEnd -and $command.inflightEnd -isnot [int])){throw 'INVALID_RANGE'}
        $start=[int]$command.committedPrefix;$end=if($null -eq $command.inflightEnd){$start}else{[int]$command.inflightEnd}
        if($start -gt 0 -or $end -gt $start){Assert-Purging};Assert-Prefix $start
        Assert-NoExtraBatches $start ($end -gt $start)
        if($end -gt $start) { $batch=Get-Batch $start $false;if($batch.end -ne $end){throw 'BATCH_BINDING_MISMATCH'} }
        $remaining=$lease.InspectRemaining($entries,$start,$end)
        Emit @{status='ok';remaining=$remaining}
      } elseif($command.command -ceq 'deleteBatch') {
        Assert-Keys $command @('command','start','end')
        Assert-QuarantineGrace
        if($command.start -isnot [int] -or $command.end -isnot [int]){throw 'INVALID_RANGE'}
        $start=[int]$command.start;$end=[int]$command.end;Assert-Purging;Assert-Prefix $start
        Assert-NoExtraBatches $start $true
        if($lease.JournalExists('restoring.json') -or $lease.JournalExists('restored.json')) { throw 'RESTORE_IN_PROGRESS_OR_COMPLETE' }
        $batch=Get-Batch $start $false
        if($batch.end -ne $end){throw 'BATCH_BINDING_MISMATCH'}
        $done='purge-batch-'+$start.ToString('D5')+'.done.json'
        if($lease.JournalExists($done) -or $lease.JournalExists('purged.json')){throw 'BATCH_ALREADY_DONE'}
        $before=$lease.InspectRemaining($entries,$start,$end)
        $removed=$lease.DeleteBatch($entries,$start,$end)
        $lastBatch=@{start=$start;end=$end;first=$before.observedAbsentPrefix;removed=$removed}
        Emit @{status='ok';firstIndex=$before.observedAbsentPrefix;nextIndex=$end;removedCount=$removed}
      } else { throw 'INVALID_COMMAND' }
    } catch { Emit @{status='error';code=$_.Exception.GetBaseException().Message} }
  }
} catch { Emit @{status='error';code=$_.Exception.GetBaseException().Message};exit 1 }
finally { if($null -ne $lease) { $lease.Dispose() } }
