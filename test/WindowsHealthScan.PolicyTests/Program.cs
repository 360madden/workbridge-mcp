using System.Security.AccessControl;
using System.Security.Principal;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

int assertions = 0;
foreach (bool directory in new[] { true, false })
{
    StoragePolicy.AssertSecurity(StoragePolicy.Security(directory), directory); assertions++;
    Reject(directory, s => s.SetOwner(WindowsIdentity.GetCurrent().User!));
    Reject(directory, s => s.SetAccessRuleProtection(false, true));
    Reject(directory, s => s.AddAccessRule(new FileSystemAccessRule(WindowsIdentity.GetCurrent().User!, FileSystemRights.Write, AccessControlType.Allow)));
    Reject(directory, s => s.RemoveAccessRuleAll(new FileSystemAccessRule(StoragePolicy.Admins, FileSystemRights.FullControl, AccessControlType.Allow)));
    Reject(directory, s => s.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.AuthenticatedUserSid, null), FileSystemRights.Modify, AccessControlType.Allow)));
    Reject(directory, s => s.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.AuthenticatedUserSid, null), FileSystemRights.Read, AccessControlType.Deny)));
}
Console.WriteLine($"PASS: {assertions} storage policy assertions, including owner, inheritance, extra writer, missing admin, broad write, and deny mutations.");
if (args.Length > 0)
{
    if (args.Length != 1 || !Guid.TryParseExact(args[0], "N", out var id)) return 2;
    if (new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator)) return 5;
    string root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "WorkbridgePcHealth");
    string scan = Path.Combine(root, id.ToString("N"));
    var paths = new[] { (root, true), (scan, true), (Path.Combine(root, "owner.txt"), false),
        (Path.Combine(root, "scan.lock"), false), (Path.Combine(root, "latest.json"), false),
        (Path.Combine(scan, "report.json"), false), (Path.Combine(scan, "stdout.json"), false), (Path.Combine(scan, "stderr.txt"), false) };
    foreach (var (path, directory) in paths)
    {
        StoragePolicy.AssertPath(path, directory);
        if (!directory) _ = File.ReadAllText(path);
        // Request handles only; never change data or security descriptors.
        foreach (uint right in new uint[] { 0x0002, 0x00040000 }) // write/add-file and WRITE_DAC
        {
            using var handle = CreateFile(path, right, 7, IntPtr.Zero, 3, directory ? 0x02000000u : 0u, IntPtr.Zero);
            int error = Marshal.GetLastWin32Error();
            if (!handle.IsInvalid || error != 5) throw new Exception($"Expected AccessDenied for {path}, access {right:X}, error {error}.");
        }
    }
    Console.WriteLine($"PASS: all {paths.Length} real storage paths have expected ownership/ACLs; normal user can read files but cannot write data or change DACLs.");
}
return 0;

void Reject(bool directory, Action<FileSystemSecurity> mutate)
{
    var s = StoragePolicy.Security(directory);
    mutate(s);
    try { StoragePolicy.AssertSecurity(s, directory); }
    catch (UnauthorizedAccessException) { assertions++; return; }
    throw new Exception("Unsafe storage descriptor was accepted.");
}

[DllImport("kernel32.dll", EntryPoint = "CreateFileW", CharSet = CharSet.Unicode, SetLastError = true)]
static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
