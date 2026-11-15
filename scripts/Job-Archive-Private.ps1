[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Directory)
$ErrorActionPreference='Stop'
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class ArchivePrivateDirectory {
 [StructLayout(LayoutKind.Sequential)] struct SecurityAttributes { public int Length; public IntPtr Descriptor; public bool Inherit; }
 [DllImport("kernel32.dll",EntryPoint="CreateFileW",CharSet=CharSet.Unicode,SetLastError=true)]
 static extern SafeFileHandle Open(string path,uint access,uint share,IntPtr security,uint disposition,uint flags,IntPtr template);
 [DllImport("kernel32.dll",EntryPoint="CreateDirectoryW",CharSet=CharSet.Unicode,SetLastError=true)]
 static extern bool CreateDirectory(string path,ref SecurityAttributes security);
 public static SafeFileHandle Pin(string path) {
   SafeFileHandle handle=Open(path,0x80,3,IntPtr.Zero,3,0x02200000,IntPtr.Zero);
   if(handle.IsInvalid) throw new System.IO.IOException("PRIVATE_DIRECTORY_PIN_FAILED");
   return handle;
 }
 public static void Create(string path,byte[] descriptor) {
   GCHandle pinned=GCHandle.Alloc(descriptor,GCHandleType.Pinned);
   try {
     var security=new SecurityAttributes {Length=Marshal.SizeOf(typeof(SecurityAttributes)),Descriptor=pinned.AddrOfPinnedObject(),Inherit=false};
     if(!CreateDirectory(path,ref security)) throw new System.IO.IOException("PRIVATE_DIRECTORY_CREATE_FAILED");
   } finally {pinned.Free();}
 }
}
'@
$parentPin=$null;$pin=$null
try {
 if(-not [IO.Path]::IsPathRooted($Directory)) { throw 'INVALID_DIRECTORY' }
 $parent=[IO.Path]::GetDirectoryName($Directory)
 $parentItem=Get-Item -LiteralPath $parent -Force
 if(-not $parentItem.PSIsContainer -or ($parentItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'INVALID_PARENT' }
 $parentPin=[ArchivePrivateDirectory]::Pin($parent)
 $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
 $system=[Security.Principal.SecurityIdentifier]::new('S-1-5-18')
 $acl=[Security.AccessControl.DirectorySecurity]::new()
 $acl.SetOwner($sid);$acl.SetAccessRuleProtection($true,$false)
 foreach($who in @($sid,$system)) {
   $rule=[Security.AccessControl.FileSystemAccessRule]::new($who,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
   $acl.AddAccessRule($rule)
 }
 [ArchivePrivateDirectory]::Create($Directory,$acl.GetSecurityDescriptorBinaryForm())
 $pin=[ArchivePrivateDirectory]::Pin($Directory)
 function Assert-Private([string]$Path,[bool]$IsDirectory) {
   $item=Get-Item -LiteralPath $Path -Force
   if($item.PSIsContainer -ne $IsDirectory -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'INVALID_PRIVATE_ITEM' }
   $sections=[Security.AccessControl.AccessControlSections]::Access -bor [Security.AccessControl.AccessControlSections]::Owner
   if($IsDirectory) {$current=[IO.Directory]::GetAccessControl($Path,$sections)} else {$current=[IO.File]::GetAccessControl($Path,$sections)}
   if($IsDirectory -and -not $current.AreAccessRulesProtected) { throw 'PRIVATE_ACL_INVALID' }
   if($current.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'PRIVATE_OWNER_INVALID' }
   $rules=@($current.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
   if($rules.Count -ne 2) { throw 'PRIVATE_ACL_INVALID' }
   $seen=@{}
   foreach($rule in $rules) {
     if($rule.AccessControlType -ne 'Allow' -or $rule.IdentityReference.Value -notin @($sid.Value,$system.Value) -or
        $rule.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl -or
        ($IsDirectory -and ($rule.IsInherited -or $rule.PropagationFlags -ne [Security.AccessControl.PropagationFlags]::None -or
        $rule.InheritanceFlags -ne ([Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit)))) { throw 'PRIVATE_ACL_INVALID' }
     $seen[$rule.IdentityReference.Value]=$true
   }
   if(-not $seen.ContainsKey($sid.Value) -or -not $seen.ContainsKey($system.Value)) { throw 'PRIVATE_ACL_INVALID' }
 }
 Assert-Private $Directory $true
 [Console]::Out.WriteLine('READY');[Console]::Out.Flush()
 while($null -ne ($line=[Console]::In.ReadLine())) {
   if($line -cnotin @('VERIFY original.json.gz','VERIFY proposal.json')) { throw 'INVALID_COMMAND' }
   $name=$line.Substring(7);Assert-Private ([IO.Path]::Combine($Directory,$name)) $false
   [Console]::Out.WriteLine('VERIFIED');[Console]::Out.Flush()
 }
} catch { [Console]::Error.WriteLine('PRIVATE_DIRECTORY_FAILED');exit 1 }
finally { if($null -ne $pin) { $pin.Dispose() };if($null -ne $parentPin) { $parentPin.Dispose() } }
