using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows.Forms;

internal sealed class SessionNotificationWindow : NativeWindow
{
    private const int WmWtsSessionChange = 0x02B1;
    private readonly SessionEventLedger ledger;

    internal SessionNotificationWindow(SessionEventLedger ledger) => this.ledger = ledger;

    internal void CreateHiddenHandle() =>
        CreateHandle(new CreateParams { Caption = "Workbridge M2 read-only session witness", Style = 0, ExStyle = 0 });

    protected override void WndProc(ref Message message)
    {
        if (message.Msg == WmWtsSessionChange)
            ledger.Record(unchecked((int)message.WParam.ToInt64()),
                unchecked((int)message.LParam.ToInt64()), DateTimeOffset.UtcNow);
        base.WndProc(ref message);
    }
}

internal static class Program
{
    private const uint WmWtsSessionChange = 0x02B1;
    [DllImport("wtsapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool WTSRegisterSessionNotification(IntPtr hwnd, uint flags);

    [DllImport("wtsapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool WTSUnRegisterSessionNotification(IntPtr hwnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowVisible(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", EntryPoint = "SendMessageW")]
    private static extern IntPtr SendMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);

    private static bool Healthy(JsonElement observation, int expectedSession)
    {
        try
        {
            return observation.GetProperty("sampleStatus").GetString() == "DEFAULT_INPUT_DESKTOP_SAMPLE"
                && observation.GetProperty("sessionConnected").GetString() == "ACTIVE"
                && observation.GetProperty("sessionLocked").GetString() == "UNLOCKED"
                && observation.GetProperty("activeConsoleSessionId").GetInt32() == expectedSession
                && observation.GetProperty("wtsResponseValid").GetBoolean()
                && observation.GetProperty("wtsLockResponseVerified").GetBoolean()
                && !observation.GetProperty("safeForInput").GetBoolean();
        }
        catch (Exception ex) when (ex is InvalidOperationException or KeyNotFoundException
            or FormatException)
        {
            return false;
        }
    }

    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "--self-test")
        {
            int cases = SessionEventLedger.SelfTest();
            Console.WriteLine(JsonSerializer.Serialize(new
            {
                schemaVersion = 1, selfTest = cases == 9 ? "PASS" : "FAIL", cases,
                safeForInput = false
            }));
            return cases == 9 ? 0 : 2;
        }

        if (args.Length != 3 || (args[0] != "--observe" && args[0] != "--synthetic-lock") ||
            !Path.IsPathFullyQualified(args[1]) || !Directory.Exists(args[1]) ||
            !int.TryParse(args[2], out int durationSeconds) || durationSeconds is < 2 or > 10 ||
            !OperatingSystem.IsWindows())
            return 2;
        var directory = Path.GetFullPath(args[1]);
        if ((File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0)
            return 2;
        string receipt = Path.Combine(directory, "witness.json");
        if (File.Exists(receipt))
            return 2;

        bool synthetic = args[0] == "--synthetic-lock";
        int result = 2;
        object report;
        try
        {
            (result, report) = RunWitness(durationSeconds, synthetic);
        }
        catch
        {
            report = new
            {
                schemaVersion = 1, status = "OBSERVER_EXCEPTION", syntheticSelfMessage = synthetic,
                safeForInput = false, intervalVerified = false, coverageVerified = false
            };
        }
        try
        {
            string temporary = Path.Combine(directory, "witness.tmp");
            File.WriteAllText(temporary, JsonSerializer.Serialize(report));
            File.Move(temporary, receipt, overwrite: false);
        }
        catch
        {
            return 2;
        }
        return result;
    }

    private static (int exitCode, object receipt) RunWitness(int durationSeconds, bool synthetic)
    {
        int session = Process.GetCurrentProcess().SessionId;
        var ledger = new SessionEventLedger(session);
        using var context = new ApplicationContext();
        using var timer = new System.Windows.Forms.Timer { Interval = 75 };
        var window = new SessionNotificationWindow(ledger);
        bool registered = false;
        bool unregistered = false;
        bool hiddenAndNotForeground = false;
        int pumpTicks = 0;
        int sampleCount = 0;
        int healthySamples = 0;
        bool syntheticPosted = false;
        var startedAt = DateTimeOffset.UtcNow;
        var stopwatch = Stopwatch.StartNew();
        try
        {
            window.CreateHiddenHandle(); // top-level handle, never shown or activated
            hiddenAndNotForeground = !IsWindowVisible(window.Handle)
                && GetForegroundWindow() != window.Handle;
            registered = WTSRegisterSessionNotification(window.Handle, 0); // THIS_SESSION
            int registrationError = registered ? 0 : Marshal.GetLastWin32Error();
            if (!registered)
            {
                return (2, new
                {
                    schemaVersion = 1, status = "SUBSCRIPTION_FAILED",
                    sessionId = session, registrationWin32Error = registrationError,
                    syntheticSelfMessage = synthetic, safeForInput = false,
                    intervalVerified = false, coverageVerified = false
                });
            }
            var initial = JsonSerializer.SerializeToElement(DesktopFacts.Sample(session));
            sampleCount++;
            if (Healthy(initial, session)) healthySamples++;

            timer.Tick += (_, _) =>
            {
                pumpTicks++;
                if (synthetic && !syntheticPosted && stopwatch.ElapsedMilliseconds >= 250)
                {
                    syntheticPosted = true;
                    // Delivers only to our own hidden HWND. Does NOT lock Windows.
                    SendMessage(window.Handle, WmWtsSessionChange, new IntPtr(7), new IntPtr(session));
                }
                hiddenAndNotForeground &= !IsWindowVisible(window.Handle)
                    && GetForegroundWindow() != window.Handle;
                var sampled = JsonSerializer.SerializeToElement(DesktopFacts.Sample(session));
                sampleCount++;
                if (Healthy(sampled, session)) healthySamples++;
                if (stopwatch.Elapsed >= TimeSpan.FromSeconds(durationSeconds))
                {
                    timer.Stop();
                    context.ExitThread();
                }
            };
            timer.Start();
            Application.Run(context);
            timer.Stop();
            var final = JsonSerializer.SerializeToElement(DesktopFacts.Sample(session));
            sampleCount++;
            if (Healthy(final, session)) healthySamples++;
            unregistered = WTSUnRegisterSessionNotification(window.Handle);
            registered = true; // registration was successful for the observed window
            string status = ledger.Classify(registered, unregistered, pumpTicks > 0,
                hiddenAndNotForeground, sampleCount == healthySamples, sampleCount);
            return (status == "NO_TRANSITION_OBSERVED" ? 0 : 2, new
            {
                schemaVersion = 1, status,
                processId = Environment.ProcessId, sessionId = session,
                startedAtUtc = startedAt, endedAtUtc = DateTimeOffset.UtcNow,
                durationMs = stopwatch.ElapsedMilliseconds,
                subscriptionRegistered = registered, subscriptionUnregistered = unregistered,
                hiddenAndNotForeground, pumpTicks,
                sampleCount, healthySamples, eventCount = ledger.TotalEvents,
                eventOverflow = ledger.Overflow, events = ledger.Events,
                initial, final, syntheticSelfMessage = synthetic,
                safeForInput = false, intervalVerified = false, coverageVerified = false
            });
        }
        finally
        {
            timer.Stop();
            if (registered && !unregistered && window.Handle != IntPtr.Zero)
                WTSUnRegisterSessionNotification(window.Handle);
            if (window.Handle != IntPtr.Zero)
                window.DestroyHandle();
        }
    }
}
