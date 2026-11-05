// Disposable FlaUI click harness. All default/synthetic modes are no-GUI and no-input.
// ONLY --dummy-live-once with its exact confirmation may open a self-owned WinForms target
// and invoke FlaUI.Core.Input.Mouse.LeftClick on that target. Never targets RIFT.
using System.Diagnostics;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows.Forms;
using FlaUI.Core.Input;

namespace FlaUIDummyClick;

internal static class Program
{
    private const string LiveConfirmation = "disposable-window-only";
    private static int _liveCalls;

    [DllImport("user32.dll", ExactSpelling = true)]
    private static extern nint GetForegroundWindow();

    [DllImport("user32.dll", ExactSpelling = true)]
    private static extern uint GetWindowThreadProcessId(nint hWnd, out uint processId);

    [DllImport("user32.dll", ExactSpelling = true)]
    private static extern nint WindowFromPoint(NativePoint point);

    [DllImport("user32.dll", ExactSpelling = true)]
    private static extern nint GetAncestor(nint hWnd, uint flags);

    [DllImport("user32.dll", ExactSpelling = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsChild(nint parent, nint child);

    [DllImport("user32.dll", ExactSpelling = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindow(nint hWnd);

    private const uint GaRoot = 2;

    [StructLayout(LayoutKind.Sequential)]
    private readonly struct NativePoint(Point point)
    {
        public readonly int X = point.X;
        public readonly int Y = point.Y;
    }

    [STAThread]
    private static int Main(string[] args)
    {
        // The default mode cannot construct a Form, move a cursor or send any input.
        if (args.Length == 0 || args.SequenceEqual(new[] { "--dry-run" }))
        {
            Print(new { ok = true, mode = "dry-run", executable = false,
                liveInputInvoked = false, target = "self-owned disposable WinForms button only" });
            return 0;
        }
        if (args.SequenceEqual(new[] { "--self-test" }))
            return RunPureTests();
        if (args.SequenceEqual(new[] { "--dummy-live-once", "--confirm", LiveConfirmation }))
            return RunExplicitDummyOnly();
        Print(new { ok = false, code = "INVALID_ARGUMENTS",
            message = "Only --dry-run, --self-test or exact dummy-only confirmation are supported.",
            liveInputInvoked = false });
        return 2;
    }

    // Pure geometry evidence, accepts neither a PID nor an arbitrary mouse destination.
    // Returned point is virtual-screen physical pixels, including possible negative X.
    internal static bool TryPlanOwnButton(Rectangle window, Rectangle button, out Point point)
    {
        point = default;
        if (window.Width < 200 || window.Height < 120 ||
            button.Width < 40 || button.Height < 20 ||
            button.Left < window.Left || button.Top < window.Top ||
            button.Right > window.Right || button.Bottom > window.Bottom)
            return false;
        point = new Point(button.Left + button.Width / 2, button.Top + button.Height / 2);
        return window.Contains(point) && button.Contains(point);
    }

    // This predicate is deliberately pure so foreign HWND, foreground and session
    // rejection can be verified without opening a window or injecting desktop input.
    private static bool OwnButtonWitness(nint hit, nint root, nint expectedForm,
        nint expectedButton, nint foreground, uint hitPid, int ownPid,
        int hitSessionId, int ownSessionId, bool isButtonDescendant)
    {
        return hit != nint.Zero && expectedForm != nint.Zero && expectedButton != nint.Zero &&
            root == expectedForm && foreground == expectedForm &&
            hitPid == (uint)ownPid && hitSessionId == ownSessionId &&
            (hit == expectedButton || isButtonDescendant);
    }

    // Read-only native witness. Require the precise point to be our Button or its
    // descendant, with the same top-level root, foreground, PID and Windows session.
    private static void AssertOwnButtonAt(DummyTargetForm form, Point point)
    {
        var hit = WindowFromPoint(new NativePoint(point));
        if (hit == nint.Zero || !IsWindow(hit))
            throw new InvalidOperationException("No native window at dummy button center");
        var root = GetAncestor(hit, GaRoot);
        if (GetWindowThreadProcessId(hit, out var hitPid) == 0 ||
            hitPid > int.MaxValue)
            throw new InvalidOperationException("Native dummy point owner unavailable");
        using var ownProcess = Process.GetCurrentProcess();
        using var hitProcess = Process.GetProcessById((int)hitPid);
        if (!OwnButtonWitness(hit, root, form.Handle, form.TargetButton.Handle,
            GetForegroundWindow(), hitPid, ownProcess.Id, hitProcess.SessionId,
            ownProcess.SessionId, IsChild(form.TargetButton.Handle, hit)))
            throw new InvalidOperationException("Native point is not the owned, foreground dummy button");
    }

    private static int RunPureTests()
    {
        var checks = new[]
        {
            TryPlanOwnButton(new Rectangle(-1928, -2, 960, 640),
                new Rectangle(-1600, 210, 120, 38), out var negative) && negative.X < 0,
            TryPlanOwnButton(new Rectangle(0, 0, 800, 600),
                new Rectangle(100, 100, 120, 40), out var normal) && normal == new Point(160, 120),
            !TryPlanOwnButton(new Rectangle(0, 0, 800, 600),
                new Rectangle(900, 100, 120, 40), out _),
            !TryPlanOwnButton(new Rectangle(0, 0, 800, 600),
                new Rectangle(100, 100, 0, 40), out _),
            !TryPlanOwnButton(new Rectangle(0, 0, 100, 50),
                new Rectangle(10, 10, 40, 20), out _),
            Volatile.Read(ref _liveCalls) == 0,
            OwnButtonWitness((nint)21, (nint)10, (nint)10, (nint)21,
                (nint)10, 42, 42, 1, 1, false),
            OwnButtonWitness((nint)22, (nint)10, (nint)10, (nint)21,
                (nint)10, 42, 42, 1, 1, true),
            !OwnButtonWitness((nint)22, (nint)11, (nint)10, (nint)21,
                (nint)10, 42, 42, 1, 1, true),
            !OwnButtonWitness((nint)22, (nint)10, (nint)10, (nint)21,
                (nint)99, 42, 42, 1, 1, true),
            !OwnButtonWitness((nint)22, (nint)10, (nint)10, (nint)21,
                (nint)10, 99, 42, 1, 1, true),
            !OwnButtonWitness((nint)22, (nint)10, (nint)10, (nint)21,
                (nint)10, 42, 42, 2, 1, true),
            !OwnButtonWitness((nint)22, (nint)10, (nint)10, (nint)21,
                (nint)10, 42, 42, 1, 1, false),
        };
        var passed = checks.Count(v => v);
        Print(new { ok = passed == checks.Length, mode = "pure-self-test",
            passed, total = checks.Length, liveInputInvoked = false });
        return passed == checks.Length ? 0 : 1;
    }

    private static int RunExplicitDummyOnly()
    {
        // Only reachable by two exact operator arguments; no arbitrary window ID or coordinates.
        // This branch must not be run until a separate GUI-focus test is approved.
        if (!OperatingSystem.IsWindows() || !Environment.UserInteractive)
        {
            Print(new { ok = false, code = "INTERACTIVE_WINDOWS_REQUIRED" });
            return 3;
        }
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        ApplicationConfiguration.Initialize();
        using var form = new DummyTargetForm();
        var result = 4;
        form.Shown += async (_, _) =>
        {
            try
            {
                await Task.Delay(250).ConfigureAwait(true);
                if (!form.Visible || !form.TargetButton.Visible || !form.TargetButton.Enabled ||
                    form.ClickCount != 0 ||
                    GetForegroundWindow() != form.Handle ||
                    GetWindowThreadProcessId(form.Handle, out var pid) == 0 ||
                    pid != Environment.ProcessId)
                    throw new InvalidOperationException("Dummy button is not the owned, foreground target");

                var buttonBounds = form.TargetButton.RectangleToScreen(form.TargetButton.ClientRectangle);
                var windowBounds = form.Bounds;
                if (!TryPlanOwnButton(windowBounds, buttonBounds, out var virtualScreenPoint))
                    throw new InvalidOperationException("Dummy button geometry outside its window");
                AssertOwnButtonAt(form, virtualScreenPoint);
                if (Interlocked.CompareExchange(ref _liveCalls, 1, 0) != 0)
                    throw new InvalidOperationException("One click already attempted");
                // Use FlaUI's proven negative-monitor positioning, then check the
                // actual cursor and native hit-test AFTER movement and IMMEDIATELY
                // before clicking. There is no await, focus call or screenshot between.
                Mouse.Position = virtualScreenPoint;
                if (Mouse.Position != virtualScreenPoint)
                    throw new InvalidOperationException("FlaUI cursor position mismatch");
                AssertOwnButtonAt(form, virtualScreenPoint);
                // Exact one vendor click of the currently verified, self-owned button.
                // No arbitrary externally supplied PID/HWND or coordinate is accepted.
                Mouse.LeftClick();
                await Task.Delay(180).ConfigureAwait(true);
                if (form.ClickCount != 1)
                    throw new InvalidOperationException("Native dummy button did not record exactly one click");
                result = 0;
                Print(new { ok = true, mode = "dummy-live-once", count = form.ClickCount,
                    inputAttempted = true, target = "self-owned disposable button" });
            }
            catch (Exception e)
            {
                result = 4;
                Print(new { ok = false, mode = "dummy-live-once", count = form.ClickCount,
                    inputAttempted = Volatile.Read(ref _liveCalls) != 0,
                    code = "DUMMY_EVIDENCE_FAILED", message = e.GetType().Name });
            }
            finally
            {
                if (!form.IsDisposed) form.BeginInvoke(form.Close);
            }
        };
        Application.Run(form);
        return result;
    }

    private static void Print(object value) => Console.WriteLine(JsonSerializer.Serialize(value));

    private sealed class DummyTargetForm : Form
    {
        internal Button TargetButton { get; }
        internal int ClickCount { get; private set; }

        internal DummyTargetForm()
        {
            Text = "FlaUI Disposable Click Target - No RIFT";
            Width = 560;
            Height = 360;
            StartPosition = FormStartPosition.CenterScreen;
            AutoScaleMode = AutoScaleMode.Dpi;
            TopMost = false;
            TargetButton = new Button { Name = "DummyClickCounter",
                Text = "Increment dummy counter", Left = 150, Top = 125,
                Width = 240, Height = 55, TabStop = true };
            var counter = new Label { Text = "Clicks: 0", Left = 170,
                Top = 205, Width = 170, Height = 40 };
            TargetButton.Click += (_, _) =>
            {
                ClickCount++;
                counter.Text = "Clicks: " + ClickCount;
            };
            Controls.Add(TargetButton);
            Controls.Add(counter);
        }
    }
}
