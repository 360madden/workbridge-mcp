using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;

namespace Workbridge.Investigations.DesktopProbeWatchdog;

// Owns the same single Windows GUI turn used by Workbridge capture. The lock is
// created exclusively BEFORE any fixture process is spawned. A crash retains
// the lock for human reconciliation; successful settlement removes only the
// exact file opened by this owner through its own OS handle.
internal sealed class DesktopTurnLease : IDisposable
{
    private const uint GenericRead = 0x80000000;
    private const uint GenericWrite = 0x40000000;
    private const uint DeleteAccess = 0x00010000;
    private const uint FileShareRead = 0x00000001;
    private const uint CreateNew = 1;
    private const uint FileAttributeNormal = 0x00000080;
    private const int FileDispositionInfoClass = 4;
    private readonly FileStream _stream;
    private readonly string _path;
    private readonly byte[] _stampBytes;
    private readonly DesktopAdmissionLease _admission;
    private bool _disposed;

    public string LeaseId { get; }
    public string StampSha256 { get; }
    public bool Released { get; private set; }
    public bool AdmissionReleased => _admission.Released;
    public string AdmissionPath => _admission.Path;

    [StructLayout(LayoutKind.Sequential)]
    private struct FileDispositionInfo
    {
        [MarshalAs(UnmanagedType.Bool)]
        public bool DeleteFile;
    }

    [DllImport("kernel32.dll", EntryPoint = "CreateFileW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(
        string fileName, uint desiredAccess, uint shareMode, IntPtr securityAttributes,
        uint creationDisposition, uint flagsAndAttributes, IntPtr templateFile);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetFileInformationByHandle(
        SafeFileHandle handle, int fileInformationClass, ref FileDispositionInfo info, uint bufferSize);

    private DesktopTurnLease(string path, FileStream stream, string leaseId, byte[] stampBytes,
        DesktopAdmissionLease admission)
    {
        _path = path;
        _stream = stream;
        _admission = admission;
        LeaseId = leaseId;
        _stampBytes = stampBytes;
        StampSha256 = Convert.ToHexString(SHA256.HashData(stampBytes)).ToLowerInvariant();
    }

    public static DesktopTurnLease Acquire(
        string path, string runId, int watchdogPid, string watchdogStartTicks, int sessionId,
        bool synthetic)
    {
        var directory = Path.GetDirectoryName(path) ?? throw new InvalidOperationException("UI_TURN_PATH_INVALID");
        if (!Directory.Exists(directory))
            throw new InvalidOperationException("UI_TURN_DIRECTORY_MISSING");
        var attrs = File.GetAttributes(directory);
        if ((attrs & FileAttributes.ReparsePoint) != 0)
            throw new InvalidOperationException("UI_TURN_DIRECTORY_REPARSE");

        // Admission is an independent atomic mutex. Maintenance and all GUI producers
        // must acquire it BEFORE the older GUI-turn lock; never merely pre-check a flag.
        var admission = DesktopAdmissionLease.Acquire(path, runId, watchdogPid, synthetic);
        var guiCreated = false;
        try
        {
            // The quarantine sidecar remains an independent veto if its guard is lost.
            // Repeat the check after admission, before any child can be launched.
            if (!synthetic && Directory.EnumerateFiles(directory,
                    "desktop-turn-quarantine-*.json", SearchOption.TopDirectoryOnly).Any())
                throw new InvalidOperationException("DESKTOP_INPUT_TURN_ORPHAN_QUARANTINE");

        var leaseId = Guid.NewGuid().ToString("D");
        var stamp = new
        {
            schemaVersion = 1,
            kind = "workbridge.gui-turn",
            producer = "desktopprobe-watchdog",
            runId,
            requestId = runId,
            leaseId,
            owner = new { pid = watchdogPid, processStartUtcTicks = watchdogStartTicks, sessionId },
            target = new { kind = "window", pid = (int?)null, hwnd = (long?)null, process = "DesktopProbe" },
            acquiredUtc = DateTimeOffset.UtcNow,
            synthetic,
        };
        var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(stamp) + "\n");
        if (bytes.Length > 4096) throw new InvalidOperationException("UI_TURN_STAMP_TOO_LARGE");
        var handle = CreateFile(path, GenericRead | GenericWrite | DeleteAccess, FileShareRead,
            IntPtr.Zero, CreateNew, FileAttributeNormal, IntPtr.Zero);
        if (handle.IsInvalid)
        {
            var code = Marshal.GetLastWin32Error();
            handle.Dispose();
            throw new InvalidOperationException(code is 80 or 183 ? "UI_TURN_BUSY" : "UI_TURN_CREATE_FAILED");
        }

        guiCreated = true;
        var stream = new FileStream(handle, FileAccess.ReadWrite);
        try
        {
            stream.Write(bytes);
            stream.Flush(true);
            return new DesktopTurnLease(path, stream, leaseId, bytes, admission);
        }
        catch
        {
            // Never remove a partially written owner stamp after uncertainty.
            stream.Dispose();
            throw;
        }
        }
        catch
        {
            // If no GUI turn was created, a verified admission-only release is safe.
            // Otherwise, preserve BOTH guards for manual review of an uncertain turn.
            if (guiCreated) admission.Dispose();
            else admission.Release();
            throw;
        }
    }

    public bool Complete(bool processTreeSettled)
    {
        if (_disposed) throw new InvalidOperationException("UI_TURN_ALREADY_CLOSED");
        if (!processTreeSettled)
        {
            WriteQuarantine("DESKTOP_TREE_UNSETTLED");
            _stream.Dispose();
            _disposed = true;
            // This guard and its linked quarantine block new input. Once their
            // exact ownership is proven, release admission so a separately approved
            // maintenance operator can freeze and reconcile them safely.
            if (!VerifyRetainedGuardAndQuarantine())
            {
                _admission.Dispose(); // Preserve admission if the independent veto is unproved.
                throw new InvalidOperationException("UI_TURN_ADMISSION_RECOVERY_REQUIRED");
            }
            _admission.Release();
            return false;
        }

        _stream.Flush(true);
        _stream.Position = 0;
        var observed = new byte[_stampBytes.Length];
        var read = 0;
        while (read < observed.Length)
        {
            var count = _stream.Read(observed, read, observed.Length - read);
            if (count <= 0) break;
            read += count;
        }
        if (read != observed.Length || _stream.Length != _stampBytes.Length ||
            !CryptographicOperations.FixedTimeEquals(observed, _stampBytes))
        {
            WriteQuarantine("UI_TURN_STAMP_CHANGED");
            _stream.Dispose();
            _admission.Dispose();
            _disposed = true;
            throw new InvalidOperationException("UI_TURN_RECOVERY_REQUIRED");
        }

        // Mark THIS opened file object for deletion by OS handle. Never unlink
        // a pathname based on PID or elapsed time; a swapped file stays intact.
        var disposition = new FileDispositionInfo { DeleteFile = true };
        if (!SetFileInformationByHandle(_stream.SafeFileHandle, FileDispositionInfoClass,
            ref disposition, (uint)Marshal.SizeOf<FileDispositionInfo>()))
        {
            WriteQuarantine("UI_TURN_HANDLE_DELETE_FAILED");
            _stream.Dispose();
            _admission.Dispose();
            _disposed = true;
            throw new InvalidOperationException("UI_TURN_RECOVERY_REQUIRED");
        }

        _stream.Dispose();
        _disposed = true;
        Released = true;
        if (File.Exists(_path))
        {
            _admission.Dispose();
            throw new InvalidOperationException("UI_TURN_DELETION_NOT_OBSERVED");
        }
        _admission.Release();
        return true;
    }

    private bool VerifyRetainedGuardAndQuarantine()
    {
        try
        {
            if ((File.GetAttributes(_path) & FileAttributes.ReparsePoint) != 0 ||
                !CryptographicOperations.FixedTimeEquals(File.ReadAllBytes(_path), _stampBytes))
                return false;
            var sidecarPath = Path.Combine(Path.GetDirectoryName(_path)!,
                "desktop-turn-quarantine-" + LeaseId + ".json");
            if ((File.GetAttributes(sidecarPath) & FileAttributes.ReparsePoint) != 0) return false;
            using var record = JsonDocument.Parse(File.ReadAllBytes(sidecarPath));
            var root = record.RootElement;
            return root.GetProperty("kind").GetString() == "workbridge.gui-turn-quarantine" &&
                root.GetProperty("leaseId").GetString() == LeaseId &&
                root.GetProperty("ownerStampSha256").GetString() == StampSha256 &&
                root.GetProperty("automaticRetryAllowed").GetBoolean() == false;
        }
        catch
        {
            return false;
        }
    }

    private void WriteQuarantine(string reasonCode)
    {
        var quarantine = Path.Combine(Path.GetDirectoryName(_path)!,
            "desktop-turn-quarantine-" + LeaseId + ".json");
        var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new
        {
            schemaVersion = 1,
            kind = "workbridge.gui-turn-quarantine",
            producer = "desktopprobe-watchdog",
            leaseId = LeaseId,
            ownerStampSha256 = StampSha256,
            reasonCode,
            processTreeSettlement = "unknown",
            automaticRetryAllowed = false,
            createdUtc = DateTimeOffset.UtcNow,
        }) + "\n");
        using var file = new FileStream(quarantine, FileMode.CreateNew, FileAccess.Write, FileShare.Read);
        file.Write(bytes);
        file.Flush(true);
    }

    public void Dispose()
    {
        if (_disposed) return;
        // On exception/crash before verified settlement, retain on-disk lock.
        _stream.Dispose();
        // Incomplete process-tree settlement: retain on-disk admission as well.
        _admission.Dispose();
        _disposed = true;
    }
}

/// <summary>
/// Cross-language admission lease matching scripts/desktop-turn-admission.mjs.
/// Unlike the older GUI lock, it is also acquired by maintenance to freeze new GUI work.
/// A crashed/abandoned owner leaves this file in place; there is no TTL or PID-based steal.
/// </summary>
internal sealed class DesktopAdmissionLease : IDisposable
{
    private const uint GenericRead = 0x80000000;
    private const uint GenericWrite = 0x40000000;
    private const uint DeleteAccess = 0x00010000;
    private const uint FileShareRead = 1;
    private const uint CreateNew = 1;
    private const uint FileAttributeNormal = 0x80;
    private const int FileDispositionInfoClass = 4;
    private readonly FileStream _stream;
    private readonly string _path;
    private readonly byte[] _stampBytes;
    private bool _disposed;

    public string Path => _path;
    public bool Released { get; private set; }

    [StructLayout(LayoutKind.Sequential)]
    private struct FileDispositionInfo
    {
        [MarshalAs(UnmanagedType.Bool)]
        public bool DeleteFile;
    }

    [DllImport("kernel32.dll", EntryPoint = "CreateFileW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(
        string fileName, uint desiredAccess, uint shareMode, IntPtr securityAttributes,
        uint creationDisposition, uint flagsAndAttributes, IntPtr templateFile);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetFileInformationByHandle(
        SafeFileHandle handle, int fileInformationClass, ref FileDispositionInfo info, uint bufferSize);

    private DesktopAdmissionLease(string path, FileStream stream, byte[] stampBytes)
    {
        _path = path;
        _stream = stream;
        _stampBytes = stampBytes;
    }

    public static DesktopAdmissionLease Acquire(string guiPath, string runId, int watchdogPid, bool synthetic)
    {
        var directory = System.IO.Path.GetDirectoryName(guiPath)!;
        var admissionPath = System.IO.Path.Combine(directory,
            synthetic ? "desktop-turn-admission.mock.lock" : "desktop-turn-admission.lock");
        var stamp = new
        {
            schemaVersion = 1,
            kind = "workbridge.gui-admission",
            admissionId = Guid.NewGuid().ToString("D"),
            mode = "producer",
            producer = "desktopprobe-watchdog",
            requestId = runId,
            owner = new { pid = watchdogPid },
            acquiredUtc = DateTimeOffset.UtcNow,
        };
        var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(stamp) + "\n");
        if (bytes.Length > 4096) throw new InvalidOperationException("UI_TURN_ADMISSION_STAMP_TOO_LARGE");
        var handle = CreateFile(admissionPath, GenericRead | GenericWrite | DeleteAccess,
            FileShareRead, IntPtr.Zero, CreateNew, FileAttributeNormal, IntPtr.Zero);
        if (handle.IsInvalid)
        {
            var code = Marshal.GetLastWin32Error();
            handle.Dispose();
            throw new InvalidOperationException(code is 80 or 183
                ? "UI_TURN_BUSY" : "UI_TURN_ADMISSION_CREATE_FAILED");
        }
        var stream = new FileStream(handle, FileAccess.ReadWrite);
        try
        {
            stream.Write(bytes);
            stream.Flush(true);
            return new DesktopAdmissionLease(admissionPath, stream, bytes);
        }
        catch
        {
            // Partially stamped admission remains blocking after a crash or uncertain write.
            stream.Dispose();
            throw;
        }
    }

    public void Release()
    {
        if (_disposed) throw new InvalidOperationException("UI_TURN_ADMISSION_ALREADY_CLOSED");
        try
        {
            _stream.Flush(true);
            _stream.Position = 0;
            var observed = new byte[_stampBytes.Length];
            var read = 0;
            while (read < observed.Length)
            {
                var count = _stream.Read(observed, read, observed.Length - read);
                if (count <= 0) break;
                read += count;
            }
            if (read != observed.Length || _stream.Length != _stampBytes.Length ||
                !CryptographicOperations.FixedTimeEquals(observed, _stampBytes))
                throw new InvalidOperationException("UI_TURN_ADMISSION_RECOVERY_REQUIRED");
            // Delete by THIS exact creation handle, never by an unvalidated pathname.
            var disposition = new FileDispositionInfo { DeleteFile = true };
            if (!SetFileInformationByHandle(_stream.SafeFileHandle, FileDispositionInfoClass,
                ref disposition, (uint)Marshal.SizeOf<FileDispositionInfo>()))
                throw new InvalidOperationException("UI_TURN_ADMISSION_RECOVERY_REQUIRED");
        }
        finally
        {
            _stream.Dispose();
            _disposed = true;
        }
        if (File.Exists(_path)) throw new InvalidOperationException("UI_TURN_ADMISSION_RECOVERY_REQUIRED");
        Released = true;
    }

    public void Dispose()
    {
        if (_disposed) return;
        // Before independently proven settlement, leave the admission pathname blocking.
        _stream.Dispose();
        _disposed = true;
    }
}