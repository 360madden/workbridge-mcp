// Disposable FlaUI click harness. All default/synthetic modes are no-GUI and no-input.
// ONLY --dummy-live-once with its exact confirmation may open a self-owned WinForms target
// and invoke FlaUI.Core.Input.Mouse.LeftClick on that target. Never targets RIFT.
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
                if (Interlocked.CompareExchange(ref _liveCalls, 1, 0) != 0)
                    throw new InvalidOperationException("One click already attempted");
                // The only input call in this entire program; its point is derived from
                // the one self-created button, never supplied by external CLI arguments.
                Mouse.LeftClick(virtualScreenPoint);
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
