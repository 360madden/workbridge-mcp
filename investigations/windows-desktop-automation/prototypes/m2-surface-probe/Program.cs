// M2 source-only native surface observer candidate. No input, hooks, capture, app launch or filesystem writes.
// --snapshot is restricted to Joey's disposable GUI-004 DesktopProbe, NOT physical RIFT or VMware.
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Workbridge.M2SurfaceProbe;

internal readonly record struct PinnedTarget(int Pid, long Hwnd, int SessionId, long StartUtcTicks);
internal readonly record struct PixelRect(int X, int Y, int Width, int Height)
{
    [JsonIgnore]
    public bool Valid =>
        Width > 0 && Height > 0 &&
        (long)X + Width <= int.MaxValue && (long)X + Width >= int.MinValue &&
        (long)Y + Height <= int.MaxValue && (long)Y + Height >= int.MinValue;
}
internal sealed class ProbeUnknown(string code) : Exception(code)
{
    internal string Code { get; } = code;
}

internal static class Program
{
    private const string Title = "Workbridge GUI-004 Native Input Probe";
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "--self-test")
            return SelfTest();
        if (args.Length == 1 && args[0] == "--contract-fixture")
            return ContractFixture();
        if (!TryParse(args, out var target))
            return Unknown("INVALID_OR_UNAPPROVED_ARGUMENTS", 2);

        try
        {
            var observed = Native.Sample(target);
            EmitSnapshot(target, observed);
            return 0;
        }
        catch (ProbeUnknown error) { return Unknown(error.Code, 3); }
        catch { return Unknown("NATIVE_OBSERVATION_FAILED", 3); }
    }

    private static void EmitSnapshot(PinnedTarget target, object observed)
    {
        Console.WriteLine(JsonSerializer.Serialize(new
        {
            schemaVersion = 1,
            kind = "desktopprobe-native-surface-snapshot",
            status = "OBSERVED_NOT_VERIFIED",
            target = new
            {
                pid = target.Pid,
                hwnd = target.Hwnd,
                sessionId = target.SessionId,
                processStartedAt = new DateTime(target.StartUtcTicks, DateTimeKind.Utc).ToString("O", CultureInfo.InvariantCulture)
            },
            sample = observed,
            // A point-in-time Win32 read cannot prove no transient modal/occlusion.
            modalCoverage = "unknown",
            occlusion = "unknown",
            actionAuthorized = false,
            inputInjected = false
        }, JsonOptions));
    }

    private static int ContractFixture()
    {
        // Purely synthetic. Shares the native JSON emitter but never calls Native.Sample.
        var start = new DateTime(2026, 11, 6, 10, 0, 0, DateTimeKind.Utc);
        var target = new PinnedTarget(100, 123456, 2, start.Ticks);
        EmitSnapshot(target, new
        {
            observedAtUtc = new DateTime(2026, 11, 6, 10, 1, 0, DateTimeKind.Utc)
                .ToString("O", CultureInfo.InvariantCulture),
            observerTick = "146001230",
            observerFrequency = "10000000",
            outerRect = new PixelRect(-300, 100, 720, 460),
            clientRect = new PixelRect(-290, 140, 700, 410),
            windowDpi = 144,
            monitorDpi = 144,
            monitorHandle = "9876",
            isWindowVisible = true,
            isMinimized = false,
            isEnabled = true,
            cloaked = false,
            foregroundHwnd = "123456",
            isForeground = true,
            centerHitRootHwnd = "123456",
            visibleOwnedTopLevelCount = 0
        });
        return 0;
    }

    private static int Unknown(string code, int exitCode)
    {
        Console.WriteLine(JsonSerializer.Serialize(new
        {
            schemaVersion = 1, kind = "desktopprobe-native-surface-snapshot",
            status = "UNKNOWN", code, actionAuthorized = false, inputInjected = false
        }, JsonOptions));
        return exitCode;
    }

    private static bool TryParse(string[] args, out PinnedTarget target)
    {
        target = default;
        // An exact, positional CLI avoids accidentally interpreting unknown flags.
        if (args.Length != 9 || args[0] != "--snapshot" || args[1] != "--pid" ||
            args[3] != "--hwnd" || args[5] != "--session-id" ||
            args[7] != "--start-utc-ticks")
            return false;
        if (!int.TryParse(args[2], NumberStyles.None, CultureInfo.InvariantCulture, out var pid) ||
            !long.TryParse(args[4], NumberStyles.None, CultureInfo.InvariantCulture, out var hwnd) ||
            !int.TryParse(args[6], NumberStyles.None, CultureInfo.InvariantCulture, out var sessionId) ||
            !long.TryParse(args[8], NumberStyles.None, CultureInfo.InvariantCulture, out var ticks) ||
            pid <= 0 || hwnd <= 0 || sessionId <= 0 || ticks < DateTime.MinValue.Ticks ||
            ticks > DateTime.MaxValue.Ticks)
            return false;
        target = new PinnedTarget(pid, hwnd, sessionId, ticks);
        return true;
    }

    private static int SelfTest()
    {
        // No Win32 calls, process lookups or filesystem I/O in this branch.
        string[] good = ["--snapshot", "--pid", "100", "--hwnd", "123456",
            "--session-id", "1", "--start-utc-ticks", "638900000000000000"];
        bool ok = TryParse(good, out var parsed) && parsed.Pid == 100 &&
            parsed.Hwnd == 123456 && parsed.SessionId == 1 &&
            parsed.StartUtcTicks == 638900000000000000L &&
            !TryParse(["--snapshot", "--pid", "0", "--hwnd", "123456",
                "--session-id", "1", "--start-utc-ticks", "638900000000000000"], out _) &&
            !TryParse(["--snapshot", "--pid", "100", "--hwnd", "-1",
                "--session-id", "1", "--start-utc-ticks", "638900000000000000"], out _) &&
            !TryParse(["--snapshot", "--pid", "100", "--hwnd", "123456",
                "--session-id", "1", "--start-utc-ticks", "638900000000000000", "--click"], out _) &&
            !TryParse(["--snapshot", "--pid", "100", "--hwnd", "123456",
                "--session-id", "1", "--start-utc-ticks", "9999999999999999999"], out _) &&
            new PixelRect(-100, -200, 700, 410).Valid &&
            !new PixelRect(0, 0, 0, 410).Valid &&
            !new PixelRect(int.MaxValue - 1, 0, 700, 410).Valid;
        Console.WriteLine(JsonSerializer.Serialize(new
        {
            status = ok ? "PASS" : "FAIL",
            kind = "m2-surface-probe-offline-selftest",
            noNativeCall = true,
            inputInjected = false
        }, JsonOptions));
        return ok ? 0 : 1;
    }

    private static class Native
    {
        private const uint GwOwner = 4;
        private const uint GaRoot = 2;
        private const uint MonitorDefaultToNearest = 2;
        private const uint MdtEffectiveDpi = 0;
        private const uint DwmwaCloaked = 14;
        private static readonly nint Pmv2 = new(-4);

        [StructLayout(LayoutKind.Sequential)]
        private struct Rect { public int Left, Top, Right, Bottom; }
        [StructLayout(LayoutKind.Sequential)]
        private struct Point { public int X, Y; }

        [UnmanagedFunctionPointer(CallingConvention.Winapi)]
        private delegate bool EnumWindowsProc(nint hwnd, nint data);

        [DllImport("user32.dll")] private static extern bool IsWindow(nint hwnd);
        [DllImport("user32.dll")] private static extern bool IsWindowVisible(nint hwnd);
        [DllImport("user32.dll")] private static extern bool IsWindowEnabled(nint hwnd);
        [DllImport("user32.dll")] private static extern bool IsIconic(nint hwnd);
        [DllImport("user32.dll")] private static extern bool GetWindowRect(nint hwnd, out Rect result);
        [DllImport("user32.dll")] private static extern bool GetClientRect(nint hwnd, out Rect result);
        [DllImport("user32.dll")] private static extern bool ClientToScreen(nint hwnd, ref Point point);
        [DllImport("user32.dll")] private static extern nint GetWindow(nint hwnd, uint command);
        [DllImport("user32.dll")] private static extern nint GetAncestor(nint hwnd, uint flags);
        [DllImport("user32.dll")] private static extern nint GetForegroundWindow();
        [DllImport("user32.dll")] private static extern nint WindowFromPoint(Point point);
        [DllImport("user32.dll")] private static extern nint MonitorFromWindow(nint hwnd, uint flags);
        [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(nint hwnd, out uint pid);
        [DllImport("user32.dll")] private static extern uint GetDpiForWindow(nint hwnd);
        [DllImport("user32.dll")] private static extern nint GetThreadDpiAwarenessContext();
        [DllImport("user32.dll")] private static extern bool AreDpiAwarenessContextsEqual(nint a, nint b);
        [DllImport("user32.dll")] private static extern bool SetProcessDpiAwarenessContext(nint context);
        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool EnumWindows(EnumWindowsProc callback, nint data);
        [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "GetWindowTextW")]
        private static extern int GetWindowText(nint hwnd, StringBuilder buffer, int count);
        [DllImport("shcore.dll")] private static extern int GetDpiForMonitor(nint monitor, uint type,
            out uint dpiX, out uint dpiY);
        [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(nint hwnd, uint attribute,
            out int value, uint size);

        private static PixelRect Convert(Rect rect) =>
            new(rect.Left, rect.Top, checked(rect.Right - rect.Left), checked(rect.Bottom - rect.Top));

        private static void Demand(bool valid, string code)
        {
            if (!valid) throw new ProbeUnknown(code);
        }

        internal static object Sample(PinnedTarget target)
        {
            // Changes DPI awareness of THIS observer process only, not the target or OS.
            _ = SetProcessDpiAwarenessContext(Pmv2);
            Demand(AreDpiAwarenessContextsEqual(GetThreadDpiAwarenessContext(), Pmv2),
                "OBSERVER_DPI_AWARENESS_UNCERTAIN");
            nint hwnd = checked((nint)target.Hwnd);
            using var process = Process.GetProcessById(target.Pid);
            using var observer = Process.GetCurrentProcess();
            Demand(process.ProcessName == "DesktopProbe" &&
                process.StartTime.ToUniversalTime().Ticks == target.StartUtcTicks &&
                process.SessionId == target.SessionId && observer.SessionId == target.SessionId &&
                !process.HasExited, "TARGET_PROCESS_IDENTITY_CHANGED");
            Demand(IsWindow(hwnd) && GetAncestor(hwnd, GaRoot) == hwnd &&
                GetWindow(hwnd, GwOwner) == nint.Zero, "TARGET_HWND_UNAVAILABLE_OR_OWNED");
            _ = GetWindowThreadProcessId(hwnd, out uint actualPid);
            Demand(actualPid == (uint)target.Pid, "TARGET_HWND_PID_CHANGED");
            var title = new StringBuilder(256);
            Demand(GetWindowText(hwnd, title, title.Capacity) > 0 &&
                string.Equals(title.ToString(), Title, StringComparison.Ordinal),
                "NOT_DESKTOPPROBE_FIXTURE");

            Demand(GetWindowRect(hwnd, out var outer), "NATIVE_OUTER_GEOMETRY_UNAVAILABLE");
            Demand(GetClientRect(hwnd, out var client), "NATIVE_CLIENT_GEOMETRY_UNAVAILABLE");
            var origin = new Point();
            Demand(ClientToScreen(hwnd, ref origin), "CLIENT_ORIGIN_UNAVAILABLE");
            var outerRect = Convert(outer);
            var clientRect = new PixelRect(origin.X, origin.Y,
                checked(client.Right - client.Left), checked(client.Bottom - client.Top));
            Demand(outerRect.Valid && clientRect.Valid, "INVALID_GEOMETRY");
            uint windowDpi = GetDpiForWindow(hwnd);
            nint monitor = MonitorFromWindow(hwnd, MonitorDefaultToNearest);
            Demand(monitor != nint.Zero, "MONITOR_UNAVAILABLE");
            int dpiStatus = GetDpiForMonitor(monitor, MdtEffectiveDpi,
                out uint monitorDpiX, out uint monitorDpiY);
            Demand(dpiStatus == 0 && windowDpi is >= 48 and <= 960 &&
                monitorDpiX is >= 48 and <= 960 && monitorDpiX == monitorDpiY,
                "DPI_UNCERTAIN");
            Demand(DwmGetWindowAttribute(hwnd, DwmwaCloaked, out int cloaked,
                sizeof(int)) == 0, "DWM_CLOAK_UNAVAILABLE");

            // Visible owned top-level windows are POSSIBLE modal windows, not proof
            // of a modal lifecycle or complete no-modal interval coverage.
            int ownedVisible = 0;
            EnumWindowsProc scanner = (candidate, unused) =>
            {
                if (candidate == hwnd || GetAncestor(candidate, GaRoot) != candidate ||
                    GetWindow(candidate, GwOwner) != hwnd) return true;
                _ = GetWindowThreadProcessId(candidate, out uint pid);
                if (pid == (uint)target.Pid && IsWindowVisible(candidate))
                    ownedVisible++;
                return ownedVisible <= 64;
            };
            Demand(EnumWindows(scanner, nint.Zero), "OWNED_WINDOW_ENUMERATION_INCOMPLETE");

            var center = new Point
            {
                X = checked(clientRect.X + clientRect.Width / 2),
                Y = checked(clientRect.Y + clientRect.Height / 2)
            };
            nint topAtCenter = WindowFromPoint(center);
            nint rootAtCenter = topAtCenter == nint.Zero ? nint.Zero :
                GetAncestor(topAtCenter, GaRoot);
            nint foreground = GetForegroundWindow();
            Demand(IsWindow(hwnd) && !process.HasExited, "TARGET_DISAPPEARED_DURING_SAMPLE");
            _ = GetWindowThreadProcessId(hwnd, out uint latePid);
            Demand(latePid == (uint)target.Pid &&
                process.StartTime.ToUniversalTime().Ticks == target.StartUtcTicks,
                "TARGET_CHANGED_DURING_SAMPLE");

            return new
            {
                observedAtUtc = DateTimeOffset.UtcNow.ToString("O", CultureInfo.InvariantCulture),
                observerTick = Stopwatch.GetTimestamp().ToString(CultureInfo.InvariantCulture),
                observerFrequency = Stopwatch.Frequency.ToString(CultureInfo.InvariantCulture),
                outerRect,
                clientRect,
                windowDpi,
                monitorDpi = monitorDpiX,
                monitorHandle = monitor.ToInt64().ToString(CultureInfo.InvariantCulture),
                isWindowVisible = IsWindowVisible(hwnd),
                isMinimized = IsIconic(hwnd),
                isEnabled = IsWindowEnabled(hwnd),
                cloaked = cloaked != 0,
                foregroundHwnd = foreground.ToInt64().ToString(CultureInfo.InvariantCulture),
                isForeground = foreground == hwnd,
                centerHitRootHwnd = rootAtCenter.ToInt64().ToString(CultureInfo.InvariantCulture),
                visibleOwnedTopLevelCount = ownedVisible
            };
        }
    }
}
