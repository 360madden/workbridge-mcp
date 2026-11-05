// Investigation-only Windows NTFS synthetic helper. NEVER accepts a filesystem path.
// Exactly two verbs: create and release of one GUID-named OS-temp fixture.
// No shared Workbridge .tools/desktop-evidence or game/VM/OneDrive path is reachable by CLI.
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;

internal static class Program
{
    private const string FixturePrefix = "workbridge-fileid-r0-";
    private const string LockName = "synthetic-fileid-lease.lock";
    private const int MaxStampBytes = 4096;
    private const uint GenericRead = 0x80000000;
    private const uint GenericWrite = 0x40000000;
    private const uint DeleteAccess = 0x00010000;
    private const uint FileShareRead = 1;
    private const uint CreateNew = 1;
    private const uint OpenExisting = 3;
    private const uint FileAttributeNormal = 0x80;
    private const uint FileFlagOpenReparsePoint = 0x00200000;
    private const uint FileAttributeReparsePoint = 0x00000400;
    private const int FileStandardInfoClass = 1;
    private const int FileDispositionInfoClass = 4;
    private const int FileAttributeTagInfoClass = 9;
    private const int FileIdInfoClass = 18;

    [StructLayout(LayoutKind.Sequential)]
    private struct FileStandardInfo
    {
        public long AllocationSize;
        public long EndOfFile;
        public uint NumberOfLinks;
        public byte DeletePending; // Native BOOLEAN is one byte.
        public byte Directory;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct FileAttributeTagInfo
    {
        public uint FileAttributes;
        public uint ReparseTag;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct FileIdInfo
    {
        public ulong VolumeSerialNumber;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 16)]
        public byte[] Identifier;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct FileDispositionInfo
    {
        public byte DeleteFile; // FILE_DISPOSITION_INFO uses 1-byte BOOLEAN, NOT 4-byte BOOL.
    }

    [DllImport("kernel32.dll", EntryPoint = "CreateFileW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(
        string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);

    [DllImport("kernel32.dll", EntryPoint = "GetFileInformationByHandleEx", SetLastError = true)]
    private static extern bool GetStandardInfo(SafeFileHandle handle, int kind, out FileStandardInfo info, uint count);

    [DllImport("kernel32.dll", EntryPoint = "GetFileInformationByHandleEx", SetLastError = true)]
    private static extern bool GetTagInfo(SafeFileHandle handle, int kind, out FileAttributeTagInfo info, uint count);

    [DllImport("kernel32.dll", EntryPoint = "GetFileInformationByHandleEx", SetLastError = true)]
    private static extern bool GetIdInfo(SafeFileHandle handle, int kind, out FileIdInfo info, uint count);

    [DllImport("kernel32.dll", EntryPoint = "SetFileInformationByHandle", SetLastError = true)]
    private static extern bool SetDisposition(SafeFileHandle handle, int kind, ref FileDispositionInfo disposition, uint count);

    [DllImport("kernel32.dll", EntryPoint = "CreateDirectoryW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateDirectoryExclusive(string directory, IntPtr securityAttributes);

    [DllImport("kernel32.dll", EntryPoint = "GetFileAttributesW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFileAttributes(string path);

    private sealed class Rejected(string code, int exitCode = 4) : Exception(code)
    {
        public string Code { get; } = code;
        public int ExitCode { get; } = exitCode;
    }

    private static int Main(string[] args)
    {
        if (!OperatingSystem.IsWindows()) return Fail("WINDOWS_ONLY", 4);
        try
        {
            if (args.Length == 0 || args[0] is not ("create" or "release"))
                throw new Rejected("INVALID_MODE", 4);
            var verb = args[0];
            var options = ParseOptions(args, verb);
            var fixtureId = ParseGuid(GetRequired(options, "--fixture-id"));
            var folder = GetFixtureFolder(fixtureId);
            var file = Path.Combine(folder, LockName);

            if (verb == "create")
            {
                Create(fixtureId, folder, file,
                    options.ContainsKey("--existing-root"),
                    options.ContainsKey("--abort-after-fsync"));
            }
            else
            {
                Release(fixtureId, folder, file,
                    GetHex(options, "--volume", 16),
                    GetHex(options, "--file-id", 32),
                    GetHex(options, "--sha256", 64),
                    ParseGuid(GetRequired(options, "--lease-id")));
            }
            return 0;
        }
        catch (Rejected error)
        {
            return Fail(error.Code, error.ExitCode);
        }
        catch
        {
            // Deliberately suppress raw paths, private command data and stack traces.
            return Fail("NATIVE_UNKNOWN_OR_UNCERTAIN", 4);
        }
    }

    private static Dictionary<string, string?> ParseOptions(string[] args, string verb)
    {
        var options = new Dictionary<string, string?>(StringComparer.Ordinal);
        for (var i = 1; i < args.Length; i++)
        {
            var key = args[i];
            var flag = key is "--existing-root" or "--abort-after-fsync";
            var allowed = key == "--fixture-id" ||
                (verb == "create" && flag) ||
                (verb == "release" && key is "--volume" or "--file-id" or "--sha256" or "--lease-id");
            if (!allowed || options.ContainsKey(key)) throw new Rejected("INVALID_ARGUMENTS");
            if (flag)
            {
                options.Add(key, null);
            }
            else
            {
                if (++i >= args.Length) throw new Rejected("INVALID_ARGUMENTS");
                options.Add(key, args[i]);
            }
        }
        if (verb == "create" && options.Count > 3) throw new Rejected("INVALID_ARGUMENTS");
        if (verb == "release" && options.Count != 5) throw new Rejected("INVALID_ARGUMENTS");
        return options;
    }

    private static string GetRequired(Dictionary<string, string?> options, string key)
    {
        if (!options.TryGetValue(key, out var value) || string.IsNullOrWhiteSpace(value))
            throw new Rejected("INVALID_ARGUMENTS");
        return value;
    }

    private static string ParseGuid(string value)
    {
        if (value.Length != 32 || !Guid.TryParseExact(value, "N", out var parsed))
            throw new Rejected("INVALID_GUID");
        return parsed.ToString("N");
    }

    private static string GetHex(Dictionary<string, string?> options, string key, int length)
    {
        var value = GetRequired(options, key);
        if (value.Length != length || !value.All(Uri.IsHexDigit))
            throw new Rejected("INVALID_IDENTITY_TOKEN");
        return value.ToLowerInvariant();
    }

    private static string GetFixtureFolder(string fixtureId)
    {
        var temp = Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar);
        var normalizedTemp = temp.Replace('/', '\\') + "\\";
        var volumeRoot = Path.GetPathRoot(temp)?.TrimEnd(Path.DirectorySeparatorChar);
        if (!Path.IsPathFullyQualified(temp) || string.IsNullOrEmpty(temp) ||
            string.Equals(temp, volumeRoot, StringComparison.OrdinalIgnoreCase) ||
            normalizedTemp.Contains("\\.tools\\", StringComparison.OrdinalIgnoreCase) ||
            normalizedTemp.Contains("\\.local\\", StringComparison.OrdinalIgnoreCase) ||
            normalizedTemp.Contains("\\workbridge-mcp\\", StringComparison.OrdinalIgnoreCase) ||
            normalizedTemp.Contains("\\rift modding\\", StringComparison.OrdinalIgnoreCase) ||
            normalizedTemp.StartsWith("C:\\work\\", StringComparison.OrdinalIgnoreCase))
            throw new Rejected("UNSAFE_TEMP_ROOT");
        var folder = Path.GetFullPath(Path.Combine(temp, FixturePrefix + fixtureId));
        if (!folder.StartsWith(temp + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) ||
            Path.GetFileName(folder) != FixturePrefix + fixtureId)
            throw new Rejected("UNSAFE_FIXTURE_ROOT");
        EnsureOrdinaryDirectories(temp);
        return folder;
    }

    private static void EnsureOrdinaryDirectories(string directory)
    {
        var current = new DirectoryInfo(directory);
        while (current != null)
        {
            if (!current.Exists || (current.Attributes & FileAttributes.ReparsePoint) != 0)
                throw new Rejected("UNSAFE_DIRECTORY_COMPONENT");
            current = current.Parent;
        }
    }

    private static void Create(string fixtureId, string folder, string file, bool existingRoot, bool abortAfterSync)
    {
        if (!existingRoot)
        {
            if (!CreateDirectoryExclusive(folder, IntPtr.Zero))
                throw new Rejected(Marshal.GetLastWin32Error() is 80 or 183 ? "FIXTURE_EXISTS" : "FIXTURE_CREATE_REFUSED", 2);
        }
        EnsureOrdinaryDirectories(folder);
        var leaseId = Guid.NewGuid().ToString("N");
        var stamp = new
        {
            schemaVersion = 1, kind = "workbridge.synthetic-fileid-r0",
            fixtureId, leaseId, ownerPid = Environment.ProcessId,
            acquiredUtc = DateTimeOffset.UtcNow
        };
        var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(stamp) + "\n");
        if (bytes.Length < 2 || bytes.Length > MaxStampBytes) throw new Rejected("STAMP_BOUNDS");
        using var handle = CreateFile(file, GenericRead | GenericWrite | DeleteAccess, FileShareRead,
            IntPtr.Zero, CreateNew, FileAttributeNormal, IntPtr.Zero);
        if (handle.IsInvalid)
            throw new Rejected(Marshal.GetLastWin32Error() is 80 or 183 ? "LOCK_EXISTS" : "LOCK_CREATE_REFUSED", 2);
        using var stream = new FileStream(handle, FileAccess.ReadWrite);
        stream.Write(bytes);
        stream.Flush(true);
        // Synthetic owner process exits after a fsynced create, before publishing a token.
        // The OS closes the handle but there is no delete-on-close and no lock cleanup.
        if (abortAfterSync) Environment.Exit(91);
        var nativeId = ReadId(handle);
        var std = ReadStandard(handle);
        if (std.EndOfFile != bytes.Length || std.NumberOfLinks != 1 || std.DeletePending != 0 ||
            std.Directory != 0) throw new Rejected("CREATED_FILE_UNSAFE");
        Emit(new
        {
            ok = true, mode = "create", fixtureId, leaseId,
            volume = nativeId.VolumeSerialNumber.ToString("x16"),
            fileId = Convert.ToHexString(nativeId.Identifier).ToLowerInvariant(),
            sha256 = Hash(bytes), byteLength = bytes.Length,
            tempRootSha256 = Hash(Encoding.UTF8.GetBytes(
                Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar)
                    .Replace('/', '\\').ToLowerInvariant()))
        });
    }

    private static void Release(
        string fixtureId, string folder, string file,
        string expectedVolume, string expectedFileId, string expectedHash, string expectedLeaseId)
    {
        EnsureOrdinaryDirectories(folder);
        using var handle = CreateFile(file, GenericRead | DeleteAccess, FileShareRead,
            IntPtr.Zero, OpenExisting, FileAttributeNormal | FileFlagOpenReparsePoint, IntPtr.Zero);
        if (handle.IsInvalid) throw new Rejected("SOURCE_OPEN_REFUSED", 3);

        var originalId = ReadId(handle);
        var volume = originalId.VolumeSerialNumber.ToString("x16");
        var fileId = Convert.ToHexString(originalId.Identifier).ToLowerInvariant();
        if (!string.Equals(volume, expectedVolume, StringComparison.Ordinal) ||
            !string.Equals(fileId, expectedFileId, StringComparison.Ordinal))
            throw new Rejected("IDENTITY_MISMATCH", 3);

        var std = ReadStandard(handle);
        var tag = ReadTag(handle);
        if (std.Directory != 0 || std.DeletePending != 0 || std.NumberOfLinks != 1 ||
            std.EndOfFile < 2 || std.EndOfFile > MaxStampBytes ||
            (tag.FileAttributes & FileAttributeReparsePoint) != 0)
            throw new Rejected("SOURCE_UNSAFE", 3);

        using (var stream = new FileStream(handle, FileAccess.Read))
        {
            var bytes = new byte[(int)std.EndOfFile];
            stream.ReadExactly(bytes);
            if (stream.Length != bytes.Length || Hash(bytes) != expectedHash)
                throw new Rejected("STAMP_MISMATCH", 3);
            using (var parsed = JsonDocument.Parse(bytes))
            {
                var root = parsed.RootElement;
                if (root.GetProperty("schemaVersion").GetInt32() != 1 ||
                    root.GetProperty("kind").GetString() != "workbridge.synthetic-fileid-r0" ||
                    root.GetProperty("fixtureId").GetString() != fixtureId ||
                    root.GetProperty("leaseId").GetString() != expectedLeaseId ||
                    root.GetProperty("ownerPid").GetInt32() <= 0)
                    throw new Rejected("STAMP_MISMATCH", 3);
            }
            var afterId = ReadId(handle);
            var after = ReadStandard(handle);
            if (afterId.VolumeSerialNumber != originalId.VolumeSerialNumber ||
                !afterId.Identifier.SequenceEqual(originalId.Identifier) ||
                after.EndOfFile != bytes.Length || after.NumberOfLinks != 1 || after.DeletePending != 0)
                throw new Rejected("SOURCE_CHANGED", 3);
            // Held-handle operation: no path unlink, no checked-pathname removal.
            if (Marshal.SizeOf<FileDispositionInfo>() != 1)
                throw new Rejected("INVALID_NATIVE_LAYOUT");
            var disposition = new FileDispositionInfo { DeleteFile = 1 };
            if (!SetDisposition(handle, FileDispositionInfoClass, ref disposition,
                (uint)Marshal.SizeOf<FileDispositionInfo>()))
                throw new Rejected("HANDLE_DELETE_REFUSED", 4);
        }
        if (!DefinitelyAbsent(file)) throw new Rejected("RELEASE_OUTCOME_UNPROVED", 4);
        Emit(new { ok = true, mode = "release", fixtureId, leaseId = expectedLeaseId, releasedOriginalId = fileId });
    }

    private static FileIdInfo ReadId(SafeFileHandle handle)
    {
        if (!GetIdInfo(handle, FileIdInfoClass, out var id, (uint)Marshal.SizeOf<FileIdInfo>()) ||
            id.Identifier == null || id.Identifier.Length != 16 ||
            id.Identifier.All(x => x == 0)) throw new Rejected("FILE_ID_UNAVAILABLE");
        return id;
    }

    private static FileStandardInfo ReadStandard(SafeFileHandle handle)
    {
        if (!GetStandardInfo(handle, FileStandardInfoClass, out var info,
            (uint)Marshal.SizeOf<FileStandardInfo>())) throw new Rejected("FILE_STANDARD_UNAVAILABLE");
        return info;
    }

    private static FileAttributeTagInfo ReadTag(SafeFileHandle handle)
    {
        if (!GetTagInfo(handle, FileAttributeTagInfoClass, out var info,
            (uint)Marshal.SizeOf<FileAttributeTagInfo>())) throw new Rejected("FILE_TAG_UNAVAILABLE");
        return info;
    }

    private static bool DefinitelyAbsent(string file)
    {
        var attributes = GetFileAttributes(file);
        if (attributes != uint.MaxValue) return false;
        return Marshal.GetLastWin32Error() is 2 or 3;
    }

    private static string Hash(byte[] bytes) =>
        Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();

    private static void Emit(object result) => Console.Out.WriteLine(JsonSerializer.Serialize(result));

    private static int Fail(string code, int exitCode)
    {
        Emit(new { ok = false, code });
        return exitCode;
    }
}
