using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Windows.Forms;

namespace Workbridge.ModalDialogProbe;

// Disposable, independently journaled UIA fixture. This program is NOT a desktop controller.
// Launching it is a separate supervised GUI trial; compiling it never opens a window.
internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length != 2 ||
            !Path.IsPathFullyQualified(args[0]) ||
            args[0].StartsWith(@"\\", StringComparison.Ordinal) ||
            args[1].Length is < 4 or > 64 ||
            !args[1].All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_'))
        {
            return 2;
        }

        try
        {
            using var journal = new EvidenceJournal(Path.GetFullPath(args[0]), args[1]);
            journal.Write("process_start");
            Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
            Application.EnableVisualStyles();
            using var owner = new OwnerForm(journal);
            Application.Run(owner);
            journal.Write("process_done", owner.RecordedHandle, owner.RecordedModalHandle);
            return 0;
        }
        catch
        {
            // No arbitrary exception text or private window contents are logged.
            return 1;
        }
    }
}

internal sealed class EvidenceJournal : IDisposable
{
    private readonly StreamWriter _writer;
    private readonly string _runId;
    private readonly string _processStartUtcTicks;
    private readonly long _clockStart = Stopwatch.GetTimestamp();
    private readonly object _gate = new();
    private int _sequence;
    private bool _disposed;

    internal EvidenceJournal(string directory, string runId)
    {
        Directory.CreateDirectory(directory);
        _runId = runId;
        using var process = Process.GetCurrentProcess();
        _processStartUtcTicks = process.StartTime.ToUniversalTime().Ticks.ToString(CultureInfo.InvariantCulture);
        string path = Path.Combine(directory, $"modal-probe-{runId}-{Environment.ProcessId}.jsonl");
        var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.Read,
            bufferSize: 4096, FileOptions.WriteThrough);
        _writer = new StreamWriter(stream, new UTF8Encoding(false)) { AutoFlush = true };
    }

    internal void Write(string stage, IntPtr owner = default, IntPtr modal = default,
        IntPtr observedOwner = default, string? nativeEvent = null,
        uint? eventThreadId = null, uint? eventTickMs = null)
    {
        lock (_gate)
        {
            if (_disposed || _sequence >= 64) return;
            var row = new
            {
                schemaVersion = 1,
                sequence = ++_sequence,
                runId = _runId,
                utc = DateTimeOffset.UtcNow.ToString("O", CultureInfo.InvariantCulture),
                elapsedMs = (long)Stopwatch.GetElapsedTime(_clockStart).TotalMilliseconds,
                pid = Environment.ProcessId,
                sessionId = Process.GetCurrentProcess().SessionId,
                processStartUtcTicks = _processStartUtcTicks,
                stage,
                ownerHwnd = Handle(owner),
                modalHwnd = Handle(modal),
                observedOwnerHwnd = Handle(observedOwner),
                nativeEvent,
                eventThreadId,
                eventTickMs,
            };
            _writer.WriteLine(JsonSerializer.Serialize(row));
        }
    }

    private static string Handle(IntPtr value) => value.ToInt64().ToString(CultureInfo.InvariantCulture);

    public void Dispose()
    {
        lock (_gate)
        {
            if (_disposed) return;
            _disposed = true;
            _writer.Dispose();
        }
    }
}

internal sealed class OwnerForm : Form
{
    private readonly EvidenceJournal _journal;
    private readonly System.Windows.Forms.Timer _openTimer = new() { Interval = 5_000 };
    private readonly System.Windows.Forms.Timer _deadlineTimer = new() { Interval = 75_000 };
    private readonly System.Windows.Forms.Timer _afterTimer = new() { Interval = 6_000 };
    private readonly Label _status;
    private readonly Button _openButton;
    private NativeModalEvents? _nativeEvents;
    private bool _modalStarted;

    internal IntPtr RecordedHandle { get; private set; }
    internal IntPtr RecordedModalHandle { get; private set; }

    internal OwnerForm(EvidenceJournal journal)
    {
        _journal = journal;
        Name = "ModalProbeOwner";
        AccessibleName = "Workbridge Modal Probe Owner";
        Text = "Workbridge M4 Disposable Modal Probe";
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(600, 270);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;

        Controls.Add(new Label
        {
            Name = "OwnerHeading",
            AccessibleName = "Modal Probe Heading",
            Text = "Workbridge modal-dialog benchmark fixture",
            Location = new Point(24, 25),
            AutoSize = true,
            Font = new Font("Segoe UI", 15, FontStyle.Bold),
        });

        _status = new Label
        {
            Name = "OwnerStatus",
            AccessibleName = "Modal Probe Owner Status",
            Text = "Owner Ready",
            Location = new Point(26, 97),
            AutoSize = true,
        };
        Controls.Add(_status);

        _openButton = new Button
        {
            Name = "OpenModalButton",
            AccessibleName = "Open Owned Modal Dialog",
            Text = "Open disposable modal",
            Location = new Point(26, 144),
            Size = new Size(215, 45),
        };
        _openButton.Click += (_, _) => ShowOwnedModal();
        Controls.Add(_openButton);

        Controls.Add(new Label
        {
            Text = "Auto-opens after 5s; modal self-closes after 30s; owner then closes.",
            Location = new Point(26, 223),
            AutoSize = true,
        });

        _openTimer.Tick += (_, _) => ShowOwnedModal();
        _afterTimer.Tick += (_, _) => { _afterTimer.Stop(); Close(); };
        _deadlineTimer.Tick += (_, _) =>
        {
            _deadlineTimer.Stop();
            _journal.Write("owner_deadline", RecordedHandle, RecordedModalHandle);
            Close();
        };
        Shown += (_, _) =>
        {
            RecordedHandle = Handle;
            _journal.Write("owner_shown", RecordedHandle);
            _nativeEvents = new NativeModalEvents(_journal,
                () => (RecordedHandle, RecordedModalHandle));
            _nativeEvents.Start();
            _openTimer.Start();
            _deadlineTimer.Start();
        };
        FormClosed += (_, _) =>
        {
            _openTimer.Stop();
            _afterTimer.Stop();
            _deadlineTimer.Stop();
            _journal.Write("owner_closed", RecordedHandle, RecordedModalHandle);
            _nativeEvents?.Dispose();
        };
    }

    private void ShowOwnedModal()
    {
        if (_modalStarted || IsDisposed || RecordedHandle == IntPtr.Zero) return;
        _modalStarted = true;
        _openTimer.Stop();
        _openButton.Enabled = false;
        _status.Text = "Opening Owned Modal";
        _journal.Write("modal_intent", RecordedHandle);

        using var dialog = new OwnedDialog(OnDialogShown, OnAutoDismiss);
        try
        {
            dialog.ShowDialog(this); // Explicit Win32 owner; intentionally blocks the invoking UIA action.
        }
        finally
        {
            _status.Text = "Modal Closed";
            _journal.Write("modal_returned", RecordedHandle, RecordedModalHandle,
                NativeMethods.GetOwner(RecordedModalHandle));
            _afterTimer.Start();
        }
    }

    private void OnDialogShown(IntPtr modalHwnd)
    {
        RecordedModalHandle = modalHwnd;
        IntPtr nativeOwner = NativeMethods.GetOwner(modalHwnd);
        _status.Text = "Modal Open";
        _journal.Write(nativeOwner == RecordedHandle ? "modal_shown" : "modal_owner_mismatch",
            RecordedHandle, modalHwnd, nativeOwner);
    }

    private void OnAutoDismiss()
    {
        _journal.Write("modal_timer_dismiss", RecordedHandle, RecordedModalHandle,
            NativeMethods.GetOwner(RecordedModalHandle));
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _openTimer.Dispose();
            _afterTimer.Dispose();
            _deadlineTimer.Dispose();
            _nativeEvents?.Dispose();
        }
        base.Dispose(disposing);
    }
}

internal sealed class OwnedDialog : Form
{
    private readonly Action<IntPtr> _onShown;
    private readonly Action _onAutoDismiss;
    private readonly System.Windows.Forms.Timer _dismissTimer = new() { Interval = 30_000 };

    internal OwnedDialog(Action<IntPtr> onShown, Action onAutoDismiss)
    {
        _onShown = onShown;
        _onAutoDismiss = onAutoDismiss;
        Name = "ModalProbeDialog";
        AccessibleName = "Workbridge Owned Modal Dialog";
        Text = "Workbridge M4 Owned Modal";
        StartPosition = FormStartPosition.CenterParent;
        ClientSize = new Size(425, 185);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;

        Controls.Add(new Label
        {
            Name = "ModalStatus",
            AccessibleName = "Modal Probe Dialog Status",
            Text = "Modal Open",
            Location = new Point(24, 35),
            AutoSize = true,
            Font = new Font("Segoe UI", 14),
        });

        var dismissButton = new Button
        {
            Name = "DismissModalButton",
            AccessibleName = "Dismiss Probe Modal",
            Text = "Dismiss",
            Location = new Point(24, 101),
            Size = new Size(150, 43),
            DialogResult = DialogResult.OK,
        };
        Controls.Add(dismissButton);
        AcceptButton = dismissButton;

        _dismissTimer.Tick += (_, _) =>
        {
            _dismissTimer.Stop();
            _onAutoDismiss();
            DialogResult = DialogResult.Cancel;
            Close();
        };
        Shown += (_, _) =>
        {
            _onShown(Handle);
            _dismissTimer.Start();
        };
        FormClosed += (_, _) => _dismissTimer.Stop();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) _dismissTimer.Dispose();
        base.Dispose(disposing);
    }
}

internal sealed class NativeModalEvents : IDisposable
{
    private readonly EvidenceJournal _journal;
    private readonly Func<(IntPtr Owner, IntPtr Modal)> _identity;
    private readonly NativeMethods.WinEventProc _callback;
    private GCHandle _callbackRoot;
    private IntPtr _dialogHook;
    private IntPtr _objectHook;
    private bool _disposed;

    internal NativeModalEvents(EvidenceJournal journal,
        Func<(IntPtr Owner, IntPtr Modal)> identity)
    {
        _journal = journal;
        _identity = identity;
        _callback = OnWinEvent;
    }

    internal void Start()
    {
        _callbackRoot = GCHandle.Alloc(_callback);
        _dialogHook = NativeMethods.SetWinEventHook(0x0010, 0x0011, IntPtr.Zero,
            _callback, (uint)Environment.ProcessId, 0, 0); // SYSTEM_DIALOGSTART/END
        _objectHook = NativeMethods.SetWinEventHook(0x8001, 0x8003, IntPtr.Zero,
            _callback, (uint)Environment.ProcessId, 0, 0); // OBJECT_DESTROY/SHOW/HIDE
        var (owner, modal) = _identity();
        if (_dialogHook == IntPtr.Zero || _objectHook == IntPtr.Zero)
        {
            _journal.Write("hook_unavailable", owner, modal);
            Dispose();
        }
        else
        {
            _journal.Write("hook_ready", owner, modal);
        }
    }

    private void OnWinEvent(IntPtr hook, uint eventType, IntPtr hwnd,
        int objectId, int childId, uint threadId, uint eventTimeMs)
    {
        if (_disposed || objectId != 0 || childId != 0 || hwnd == IntPtr.Zero) return;
        var (owner, modal) = _identity();
        if (owner == IntPtr.Zero) return;
        var nativeOwner = NativeMethods.GetOwner(hwnd);
        if (hwnd != owner && hwnd != modal && nativeOwner != owner) return;

        _ = NativeMethods.GetWindowThreadProcessId(hwnd, out var eventPid);
        if (eventPid != 0 && eventPid != Environment.ProcessId) return;
        var kind = eventType switch
        {
            0x0010 => "system_dialog_start",
            0x0011 => "system_dialog_end",
            0x8001 => "object_destroy",
            0x8002 => "object_show",
            0x8003 => "object_hide",
            _ => null,
        };
        if (kind is null) return;
        _journal.Write("native_event", owner, hwnd, nativeOwner, kind, threadId, eventTimeMs);
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        if (_dialogHook != IntPtr.Zero)
        {
            NativeMethods.UnhookWinEvent(_dialogHook);
            _dialogHook = IntPtr.Zero;
        }
        if (_objectHook != IntPtr.Zero)
        {
            NativeMethods.UnhookWinEvent(_objectHook);
            _objectHook = IntPtr.Zero;
        }
        if (_callbackRoot.IsAllocated) _callbackRoot.Free();
    }
}

internal static class NativeMethods
{
    private const uint GwOwner = 4;

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    internal delegate void WinEventProc(IntPtr hook, uint eventType, IntPtr hwnd,
        int objectId, int childId, uint threadId, uint eventTimeMs);

    [DllImport("user32.dll", SetLastError = true)]
    internal static extern IntPtr SetWinEventHook(uint eventMin, uint eventMax,
        IntPtr module, WinEventProc callback, uint processId, uint threadId, uint flags);

    [DllImport("user32.dll", SetLastError = true)]
    internal static extern bool UnhookWinEvent(IntPtr hook);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr GetWindow(IntPtr hwnd, uint command);

    [DllImport("user32.dll", SetLastError = true)]
    internal static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);

    internal static IntPtr GetOwner(IntPtr hwnd) =>
        hwnd == IntPtr.Zero ? IntPtr.Zero : GetWindow(hwnd, GwOwner);
}
