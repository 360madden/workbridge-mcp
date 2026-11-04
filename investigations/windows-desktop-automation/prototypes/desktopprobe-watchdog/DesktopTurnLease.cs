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
    private bool _disposed;

    public string LeaseId { get; }
    public string StampSha256 { get; }
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

    private DesktopTurnLease(string path, FileStream stream, string leaseId, byte[] stampBytes)
    {
        _path = path;
        _stream = stream;
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

        var stream = new FileStream(handle, FileAccess.ReadWrite);
        try
        {
            stream.Write(bytes);
            stream.Flush(true);
            return new DesktopTurnLease(path, stream, leaseId, bytes);
        }
        catch
        {
            // Never remove a partially written owner stamp after uncertainty.
            stream.Dispose();
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
            _disposed = true;
            throw new InvalidOperationException("UI_TURN_RECOVERY_REQUIRED");
        }

        _stream.Dispose();
        _disposed = true;
        Released = true;
        if (File.Exists(_path))
            throw new InvalidOperationException("UI_TURN_DELETION_NOT_OBSERVED");
        return true;
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
        _disposed = true;
    }
}