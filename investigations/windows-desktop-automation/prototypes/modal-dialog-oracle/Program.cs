// Investigation-only PASSIVE native observer. NO keyboard, mouse, UIA, focus or app launch.
// Launch is forbidden until a separate, quiet-desktop/Job-supervised pilot is approved.
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Windows.Forms;

namespace Workbridge.ModalOracle;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        var config = OracleConfig.Parse(args);
        if (config is null) return 2;
        try
        {
            using var oracle = new PassiveOracle(config);
            return oracle.Run();
        }
        catch
        {
            // Deliberately avoid printing private paths, process details or window text.
            return 5;
        }
    }
}

internal sealed record OracleConfig(int Pid, long StartUtcTicks, int SessionId,
    IntPtr OwnerHwnd, string RunId, string EvidenceDirectory)
{
    internal static OracleConfig? Parse(string[] args)
    {
        if (args.Length != 12) return null;
        var fields = new Dictionary<string, string>(StringComparer.Ordinal);
        for (var i = 0; i < args.Length; i += 2)
        {
            if (!args[i].StartsWith("--", StringComparison.Ordinal) ||
                !fields.TryAdd(args[i], args[i + 1])) return null;
        }
        var keys = new[] { "--pid", "--start-utc-ticks", "--session-id",
            "--owner-hwnd", "--run-id", "--evidence-dir" };
        if (fields.Count != keys.Length || keys.Any(k => !fields.ContainsKey(k))) return null;
        if (!int.TryParse(fields["--pid"], NumberStyles.None, CultureInfo.InvariantCulture, out var pid) ||
            pid < 1 ||
            !long.TryParse(fields["--start-utc-ticks"], NumberStyles.None,
                CultureInfo.InvariantCulture, out var ticks) || ticks < 1 ||
            !int.TryParse(fields["--session-id"], NumberStyles.None,
                CultureInfo.InvariantCulture, out var session) || session < 1 ||
            !long.TryParse(fields["--owner-hwnd"], NumberStyles.None,
                CultureInfo.InvariantCulture, out var owner) || owner <= 0) return null;

        var runId = fields["--run-id"];
        if (runId.Length is < 8 or > 48 ||
            !runId.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_')) return null;
        var supplied = fields["--evidence-dir"];
        if (!Path.IsPathFullyQualified(supplied) || supplied.StartsWith(@"\\", StringComparison.Ordinal))
            return null;
        // Investigation-only exact output root: no arbitrary filesystem write target.
        var expected = Path.GetFullPath(Path.Combine(
            @"C:\work\workbridge-mcp\investigations\windows-desktop-automation\temp",
            "modal-oracle-" + runId));
        var actual = Path.GetFullPath(supplied);
        if (!string.Equals(expected, actual, StringComparison.OrdinalIgnoreCase)) return null;
        for (DirectoryInfo? parent = new(actual); parent is not null; parent = parent.Parent)
        {
            if (!parent.Exists || (parent.Attributes & FileAttributes.ReparsePoint) != 0)
                return null;
        }
        return new OracleConfig(pid, ticks, session, new IntPtr(owner), runId, actual);
    }
}

internal sealed class PassiveOracle : IDisposable
{
    private const int PollIntervalMs = 50;
    private const int DeadlineMs = 50_000;
    private readonly OracleConfig _cfg;
    private readonly OracleJournal _journal;
    private readonly ApplicationContext _context = new();
    private readonly System.Windows.Forms.Timer _poll = new() { Interval = PollIntervalMs };
    private readonly Native.WinEventProc _callback;
    private GCHandle _callbackRoot;
    private IntPtr _systemHook;
    private IntPtr _objectHook;
    private readonly long _startedTicks = Stopwatch.GetTimestamp();
    private readonly int _observerSession;
    private readonly HashSet<long> _baselineOwned = [];
    private bool _baselineChecked;
    private bool _cleanBaseline;
    private bool _ownerDisabled;
    private bool _modalSeen;
    private bool _modalGone;
    private bool _ownerRestored;
    private bool _finished;
    private bool _insideCallback;
    private IntPtr _modal;
    private int _exitCode = 3;

    internal PassiveOracle(OracleConfig config)
    {
        _cfg = config;
        using var observer = Process.GetCurrentProcess();
        _observerSession = observer.SessionId;
        _journal = new OracleJournal(config, _startedTicks);
        _callback = OnWinEvent;
        _poll.Tick += (_, _) =>
        {
            try { Scan(); }
            catch { Finish("observer_uncertain", 5); }
        };
    }

    internal int Run()
    {
        if (!TargetFresh()) { Finish("target_identity_rejected", 4); return _exitCode; }
        _callbackRoot = GCHandle.Alloc(_callback);
        _systemHook = Native.SetWinEventHook(0x0010, 0x0011, IntPtr.Zero, _callback,
            (uint)_cfg.Pid, 0, 0); // EVENT_SYSTEM_DIALOGSTART/END; optional
        _objectHook = Native.SetWinEventHook(0x8000, 0x800A, IntPtr.Zero, _callback,
            (uint)_cfg.Pid, 0, 0); // CREATE/DESTROY/SHOW/HIDE/STATECHANGE; optional
        _journal.Write("observer_attached", _cfg.OwnerHwnd, IntPtr.Zero,
            nativeEvent: _systemHook != IntPtr.Zero && _objectHook != IntPtr.Zero
                ? "hooks_ready" : "hooks_partial_or_unavailable");
        Scan(); // Require a pre-modal owner baseline before accepting a complete cycle.
        if (_finished) return _exitCode;
        _poll.Start();
        Application.Run(_context); // Message pump required for OUTOFCONTEXT WinEvents.
        return _exitCode;
    }

    private bool TargetFresh()
    {
        if (_observerSession != _cfg.SessionId ||
            !Native.IsWindow(_cfg.OwnerHwnd) ||
            Native.IsIconic(_cfg.OwnerHwnd) ||
            Native.GetAncestor(_cfg.OwnerHwnd, 2) != _cfg.OwnerHwnd)
            return false;
        _ = Native.GetWindowThreadProcessId(_cfg.OwnerHwnd, out var hwndPid);
        if (hwndPid != (uint)_cfg.Pid) return false;
        try
        {
            using var process = Process.GetProcessById(_cfg.Pid);
            return process.StartTime.ToUniversalTime().Ticks == _cfg.StartUtcTicks &&
                process.SessionId == _cfg.SessionId && !process.HasExited;
        }
        catch { return false; }
    }

    private List<(IntPtr Hwnd, bool Visible)> OwnedWindows()
    {
        var found = new List<(IntPtr, bool)>();
        Native.EnumWindowsProc scanner = (hwnd, data) =>
        {
            if (hwnd == _cfg.OwnerHwnd || Native.GetAncestor(hwnd, 2) != hwnd ||
                Native.GetOwner(hwnd) != _cfg.OwnerHwnd) return true;
            _ = Native.GetWindowThreadProcessId(hwnd, out var pid);
            if (pid == (uint)_cfg.Pid)
                found.Add((hwnd, Native.IsWindowVisible(hwnd)));
            return true;
        };
        if (!Native.EnumWindows(scanner, IntPtr.Zero))
            throw new InvalidOperationException("Native enumeration incomplete");
        return found;
    }

    private void Scan()
    {
        if (_finished) return;
        if (!TargetFresh()) { Finish("target_identity_changed_or_exited", 4); return; }
        var owned = OwnedWindows();
        var visible = owned.Where(w => w.Visible).ToArray();
        var enabled = Native.IsWindowEnabled(_cfg.OwnerHwnd);
        if (!_baselineChecked)
        {
            _baselineChecked = true;
            _cleanBaseline = enabled && visible.Length == 0;
            foreach (var w in owned) _baselineOwned.Add(w.Hwnd.ToInt64());
            _journal.Write(_cleanBaseline ? "baseline_clean" : "baseline_missed",
                _cfg.OwnerHwnd, IntPtr.Zero, ownerEnabled: enabled, visibleOwnedCount: visible.Length);
        }
        if (!enabled && !_ownerDisabled)
        {
            _ownerDisabled = true;
            _journal.Write("owner_disabled", _cfg.OwnerHwnd, IntPtr.Zero,
                ownerEnabled: false, visibleOwnedCount: visible.Length);
        }
        var newlyVisible = visible.Where(w => !_baselineOwned.Contains(w.Hwnd.ToInt64())).ToArray();
        if (!_modalSeen && newlyVisible.Length > 1)
        {
            Finish("ambiguous_new_owned_windows", 4); return;
        }
        if (!_modalSeen && _ownerDisabled && !enabled &&
            visible.Length == 1 && newlyVisible.Length == 1)
        {
            _modal = newlyVisible[0].Hwnd;
            _modalSeen = true;
            _journal.Write("owned_modal_appeared", _cfg.OwnerHwnd, _modal,
                observedOwner: Native.GetOwner(_modal),
                ownerEnabled: false, visibleOwnedCount: 1);
        }
        if (_modalSeen && !_modalGone)
        {
            // Disappearance requires the ORIGINAL HWND to cease existing, not merely hide.
            if (Native.IsWindow(_modal))
            {
                _ = Native.GetWindowThreadProcessId(_modal, out var existingPid);
                if (existingPid != (uint)_cfg.Pid ||
                    Native.GetOwner(_modal) != _cfg.OwnerHwnd)
                {
                    Finish("modal_hwnd_reused_or_owner_changed", 4); return;
                }
            }
            else
            {
                _modalGone = true;
                _journal.Write("owned_modal_destroyed", _cfg.OwnerHwnd, _modal,
                    ownerEnabled: enabled, visibleOwnedCount: visible.Length);
            }
        }
        if (_ownerDisabled && _modalGone && enabled && !_ownerRestored)
        {
            _ownerRestored = true;
            _journal.Write("owner_reenabled", _cfg.OwnerHwnd, _modal,
                ownerEnabled: true, visibleOwnedCount: visible.Length);
        }
        if (_cleanBaseline && _ownerDisabled && _modalSeen && _modalGone &&
            _ownerRestored && visible.Length == 0)
        {
            Finish("verified_owned_modal_cycle", 0);
        }
        else if (Stopwatch.GetElapsedTime(_startedTicks).TotalMilliseconds >= DeadlineMs)
        {
            Finish("incomplete_or_late_modal_deadline", 3);
        }
    }

    private void OnWinEvent(IntPtr hook, uint eventKind, IntPtr hwnd,
        int objectId, int childId, uint eventThreadId, uint eventTickMs)
    {
        if (_finished || _insideCallback || objectId != 0 ||
            childId != 0 || hwnd == IntPtr.Zero) return;
        _insideCallback = true;
        try
        {
            var observedOwner = Native.GetOwner(hwnd);
            if (hwnd != _cfg.OwnerHwnd && hwnd != _modal &&
                observedOwner != _cfg.OwnerHwnd) return;
            _ = Native.GetWindowThreadProcessId(hwnd, out var eventPid);
            if (eventPid != 0 && eventPid != (uint)_cfg.Pid) return;
            _journal.Write("native_event", _cfg.OwnerHwnd, hwnd,
                observedOwner, nativeEvent: eventKind.ToString("x4", CultureInfo.InvariantCulture),
                eventThreadId: eventThreadId, eventTickMs: eventTickMs);
        }
        catch { /* WinEvents are supplemental; polling decides completeness. */ }
        finally { _insideCallback = false; }
    }

    private void Finish(string reason, int code)
    {
        if (_finished) return;
        _finished = true;
        _exitCode = code;
        _poll.Stop();
        _journal.Write(code == 0 ? "complete" : "incomplete",
            _cfg.OwnerHwnd, _modal, nativeEvent: reason,
            ownerEnabled: Native.IsWindow(_cfg.OwnerHwnd)
                ? Native.IsWindowEnabled(_cfg.OwnerHwnd) : null);
        _context.ExitThread();
    }

    public void Dispose()
    {
        _poll.Stop();
        _poll.Dispose();
        if (_systemHook != IntPtr.Zero) Native.UnhookWinEvent(_systemHook);
        if (_objectHook != IntPtr.Zero) Native.UnhookWinEvent(_objectHook);
        if (_callbackRoot.IsAllocated) _callbackRoot.Free();
        _context.Dispose();
        _journal.Dispose();
    }
}

internal sealed class OracleJournal : IDisposable
{
    private readonly StreamWriter _writer;
    private readonly OracleConfig _cfg;
    private readonly long _start;
    private int _rows;
    internal OracleJournal(OracleConfig cfg, long start)
    {
        _cfg = cfg;
        _start = start;
        var file = Path.Combine(cfg.EvidenceDirectory,
            "modal-oracle-" + cfg.RunId + "-" + cfg.Pid.ToString(CultureInfo.InvariantCulture) + ".jsonl");
        var stream = new FileStream(file, FileMode.CreateNew, FileAccess.Write,
            FileShare.Read, 4096, FileOptions.WriteThrough);
        _writer = new StreamWriter(stream, new UTF8Encoding(false)) { AutoFlush = true };
    }

    internal void Write(string stage, IntPtr owner, IntPtr modal,
        IntPtr observedOwner = default, string? nativeEvent = null,
        bool? ownerEnabled = null, int? visibleOwnedCount = null,
        uint? eventThreadId = null, uint? eventTickMs = null)
    {
        // Reserve rows for final proof even if the target emits many WinEvents.
        if ((_rows >= 120 && stage == "native_event") || _rows >= 160) return;
        var nowTicks = Stopwatch.GetTimestamp();
        var row = new
        {
            schemaVersion = 1, runId = _cfg.RunId, sequence = ++_rows, stage,
            utc = DateTimeOffset.UtcNow.ToString("O", CultureInfo.InvariantCulture),
            observerTick = nowTicks.ToString(CultureInfo.InvariantCulture),
            observerFrequency = Stopwatch.Frequency.ToString(CultureInfo.InvariantCulture),
            elapsedMs = Math.Round(Stopwatch.GetElapsedTime(_start).TotalMilliseconds, 3),
            targetPid = _cfg.Pid, targetStartUtcTicks = _cfg.StartUtcTicks.ToString(CultureInfo.InvariantCulture),
            sessionId = _cfg.SessionId,
            ownerHwnd = owner.ToInt64().ToString(CultureInfo.InvariantCulture),
            modalHwnd = modal.ToInt64().ToString(CultureInfo.InvariantCulture),
            observedOwnerHwnd = observedOwner.ToInt64().ToString(CultureInfo.InvariantCulture),
            ownerEnabled, visibleOwnedCount, nativeEvent, eventThreadId, eventTickMs,
        };
        _writer.WriteLine(JsonSerializer.Serialize(row));
    }

    public void Dispose() => _writer.Dispose();
}

internal static class Native
{
    private const uint GwOwner = 4;
    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    internal delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr data);
    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    internal delegate void WinEventProc(IntPtr hook, uint kind, IntPtr hwnd,
        int objectId, int childId, uint threadId, uint eventTimeMs);

    [DllImport("user32.dll", SetLastError = true)]
    internal static extern bool EnumWindows(EnumWindowsProc callback, IntPtr data);
    [DllImport("user32.dll")]
    internal static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")]
    internal static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")]
    internal static extern bool IsWindowEnabled(IntPtr hwnd);
    [DllImport("user32.dll")]
    internal static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")]
    internal static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")]
    internal static extern IntPtr GetWindow(IntPtr hwnd, uint command);
    [DllImport("user32.dll")]
    internal static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll", SetLastError = true)]
    internal static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr module,
        WinEventProc callback, uint pid, uint thread, uint flags);
    [DllImport("user32.dll", SetLastError = true)]
    internal static extern bool UnhookWinEvent(IntPtr hook);
    internal static IntPtr GetOwner(IntPtr hwnd) =>
        hwnd == IntPtr.Zero ? IntPtr.Zero : GetWindow(hwnd, GwOwner);
}
