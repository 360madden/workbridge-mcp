using System.Security.AccessControl;
using System.Security.Principal;

// Fixed storage only. Do not introduce a caller-supplied privileged root.
internal static class StoragePolicy
{
    internal static readonly SecurityIdentifier Admins = new(WellKnownSidType.BuiltinAdministratorsSid, null);
    static readonly SecurityIdentifier SystemSid = new(WellKnownSidType.LocalSystemSid, null);
    static readonly SecurityIdentifier Readers = new(WellKnownSidType.AuthenticatedUserSid, null);
    internal static FileSystemSecurity Security(bool directory)
    {
        FileSystemSecurity security = directory ? new DirectorySecurity() : new FileSecurity();
        security.SetOwner(Admins);
        security.SetAccessRuleProtection(true, false);
        var inheritance = directory ? InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit : InheritanceFlags.None;
        foreach (var pair in new[] { (Admins, FileSystemRights.FullControl), (SystemSid, FileSystemRights.FullControl),
            (Readers, directory ? FileSystemRights.ReadAndExecute : FileSystemRights.Read) })
            security.AddAccessRule(new FileSystemAccessRule(pair.Item1, pair.Item2, inheritance,
                PropagationFlags.None, AccessControlType.Allow));
        return security;
    }
    internal static void AssertSecurity(FileSystemSecurity security, bool directory)
    {
        var expected = Security(directory);
        if (!security.AreAccessRulesProtected || !Admins.Equals(security.GetOwner(typeof(SecurityIdentifier))))
            throw new UnauthorizedAccessException("Unexpected report owner or inherited permissions.");
        static string Key(FileSystemAccessRule r) => $"{r.IdentityReference.Value}:{(int)r.FileSystemRights}:{(int)r.InheritanceFlags}:{(int)r.PropagationFlags}:{r.AccessControlType}:{r.IsInherited}";
        var actualRules = security.GetAccessRules(true, true, typeof(SecurityIdentifier)).Cast<FileSystemAccessRule>().Select(Key).Order().ToArray();
        var expectedRules = expected.GetAccessRules(true, true, typeof(SecurityIdentifier)).Cast<FileSystemAccessRule>().Select(Key).Order().ToArray();
        if (!actualRules.SequenceEqual(expectedRules)) throw new UnauthorizedAccessException("Unexpected report permissions.");
    }
    internal static void NoLinks(string path)
    {
        for (string? current = Path.GetFullPath(path); current != null; current = Path.GetDirectoryName(current))
            if ((File.Exists(current) || Directory.Exists(current)) &&
                (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
                throw new IOException("Report paths cannot contain links.");
    }
    internal static void AssertPath(string path, bool directory)
    {
        NoLinks(path);
        AssertSecurity(directory ? new DirectoryInfo(path).GetAccessControl(AccessControlSections.Access | AccessControlSections.Owner)
            : new FileInfo(path).GetAccessControl(AccessControlSections.Access | AccessControlSections.Owner), directory);
    }
    internal static void CreateDirectory(string path)
    {
        NoLinks(path);
        new DirectoryInfo(path).Create((DirectorySecurity)Security(true));
        AssertPath(path, true);
    }
    internal static FileStream CreateFile(string path)
    {
        NoLinks(path);
        return new FileInfo(path).Create(FileMode.CreateNew, FileSystemRights.FullControl, FileShare.Read,
            4096, FileOptions.None, (FileSecurity)Security(false));
    }
    internal static void WriteNew(string path, string text)
    {
        using var stream = CreateFile(path);
        using var writer = new StreamWriter(stream);
        writer.Write(text);
    }
}
