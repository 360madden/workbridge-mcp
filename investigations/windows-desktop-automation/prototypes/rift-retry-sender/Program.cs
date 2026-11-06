// P2 OFFLINE-ONLY physical-RIFT Retry sender prototype.
// It accepts no live-input option. Its --dry-run path only reads a caller-frozen
// witness envelope, screenshot bytes and current Windows window/process metadata.
// The private FlaUI transport is not reachable from Main or any CLI flag.
using System.Buffers.Binary;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using FlaUI.Core.Input;

namespace RiftRetrySender;

internal readonly record struct PixelPoint(int X, int Y);
internal readonly record struct PixelRect(int X, int Y, int Width, int Height)
{
    public bool Contains(PixelPoint point) =>
        point.X >= X && point.Y >= Y &&
        (long)point.X < (long)X + Width && (long)point.Y < (long)Y + Height;

    public bool Near(PixelRect other, int tolerance = 0) =>
        Math.Abs((long)X - other.X) <= tolerance &&
        Math.Abs((long)Y - other.Y) <= tolerance &&
        Math.Abs((long)Width - other.Width) <= tolerance &&
        Math.Abs((long)Height - other.Height) <= tolerance;
}
internal sealed record ValidatedIntent(
    int Pid, long Hwnd, DateTimeOffset StartedUtc, int SessionId,
    string CaptureRequestId, string CaptureSha256,
    PixelRect OuterWindow, PixelRect DwmFrame, PixelRect ClientScreen,
    int Dpi, PixelRect ScreenshotRoi, PixelPoint ClickPoint,
    DateTimeOffset CapturedUtc);

internal sealed class GuardFailure(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}

internal static class Witness
{
    private const string ProcessName = "rift_x64";
    private const string WindowClass = "TWNClientFramework";
    private const string WindowTitle = "RIFT";
    private const string RetryAttestation = "rrecollector-0.4.11-retry-button-visible";
    private const string MappingMode = "dwm-extended-frame-physical";
    private const string PlanKind = "physical-rift-retry-DWM-OFFLINE-PLAN";
    private static readonly Regex IsoUtc = new(
        @"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?Z$",
        RegexOptions.CultureInvariant | RegexOptions.Compiled);
    private static readonly Regex RequestId = new(
        @"^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$", RegexOptions.CultureInvariant | RegexOptions.Compiled);
    private static readonly Regex Sha256 = new(@"^[0-9a-f]{64}$",
        RegexOptions.CultureInvariant | RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static void Demand(bool condition, string code, string description)
    {
        if (!condition) throw new GuardFailure(code, description);
    }
    private static JsonElement Field(JsonElement value, string name)
    {
        Demand(value.ValueKind == JsonValueKind.Object && value.TryGetProperty(name, out _),
            "MISSING_FIELD", $"Missing required field {name}");
        return value.GetProperty(name);
    }
    private static string Text(JsonElement value, string name)
    {
        JsonElement field = Field(value, name);
        Demand(field.ValueKind == JsonValueKind.String, "INVALID_STRING", name);
        return field.GetString() ?? "";
    }
    private static bool Flag(JsonElement value, string name)
    {
        JsonElement field = Field(value, name);
        Demand(field.ValueKind is JsonValueKind.True or JsonValueKind.False, "INVALID_BOOLEAN", name);
        return field.GetBoolean();
    }
    private static long Number(JsonElement value, string name)
    {
        JsonElement field = Field(value, name);
        Demand(field.ValueKind == JsonValueKind.Number && field.TryGetInt64(out _),
            "INVALID_INTEGER", name);
        return field.GetInt64();
    }
    private static int Number32(JsonElement value, string name)
    {
        long number = Number(value, name);
        Demand(number >= int.MinValue && number <= int.MaxValue, "INVALID_INTEGER", name);
        return (int)number;
    }
    private static PixelRect Rect(JsonElement value)
    {
        var rect = new PixelRect(Number32(value, "x"), Number32(value, "y"),
            Number32(value, "width"), Number32(value, "height"));
        Demand(rect.Width > 0 && rect.Height > 0 &&
            (long)rect.X + rect.Width <= int.MaxValue &&
            (long)rect.Y + rect.Height <= int.MaxValue &&
            (long)rect.X + rect.Width >= int.MinValue &&
            (long)rect.Y + rect.Height >= int.MinValue,
            "INVALID_RECT", "Rectangle must fit 32-bit virtual-screen arithmetic");
        return rect;
    }
    private static DateTimeOffset Utc(JsonElement value, string name)
    {
        string raw = Text(value, name);
        Demand(IsoUtc.IsMatch(raw) &&
            DateTimeOffset.TryParse(raw, CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out _),
            "INVALID_UTC", name);
        return DateTimeOffset.Parse(raw, CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal);
    }
    private static void SameTarget(JsonElement value, int pid, long hwnd, DateTimeOffset startedUtc, int session,
        bool includeWindow)
    {
        Demand(Number32(value, "pid") == pid, "PID_CHANGED", "Pinned PID differs");
        Demand(Number32(value, "sessionId") == session, "SESSION_CHANGED", "Pinned Windows session differs");
        Demand(Math.Abs((Utc(value, "startedUtc") - startedUtc).TotalMilliseconds) <= 1.0,
            "PROCESS_START_CHANGED", "Process start time differs");
        if (includeWindow)
            Demand(Number(value, "hwnd") == hwnd, "HWND_CHANGED", "Pinned HWND differs");
    }
    private static void SameWindow(JsonElement window, int pid, long hwnd)
    {
        Demand(Number32(window, "pid") == pid && Number(window, "hwnd") == hwnd,
            "WINDOW_IDENTITY_CHANGED", "Window PID or HWND differs");
        Demand(Text(window, "process") == ProcessName &&
            Text(window, "className") == WindowClass &&
            Text(window, "title") == WindowTitle &&
            Number(window, "ownerHwnd") == 0,
            "WINDOW_CLASS_TITLE_CHANGED", "Not exact unowned physical Rift window");
    }
    private static PixelRect WindowRect(JsonElement window) =>
        new(Number32(window, "x"), Number32(window, "y"),
            Number32(window, "width"), Number32(window, "height"));

    internal static ValidatedIntent Validate(JsonElement root, byte[] image, DateTimeOffset currentUtc)
    {
        // This contract deliberately rejects the older outer-window-relative plan:
        // DWM extended bounds, not GetWindowRect bounds, match screenshot pixels.
        JsonElement target = Field(root, "target");
        int pid = Number32(target, "pid");
        long hwnd = Number(target, "hwnd");
        int sessionId = Number32(target, "sessionId");
        var startedUtc = Utc(target, "startedUtc");
        Demand(pid > 0 && hwnd > 0 && sessionId >= 0, "INVALID_TARGET", "Exact positive PID/HWND/session required");
        SameTarget(Field(root, "processBefore"), pid, hwnd, startedUtc, sessionId, false);
        SameTarget(Field(root, "processAfter"), pid, hwnd, startedUtc, sessionId, false);

        JsonElement before = Field(root, "windowBefore");
        JsonElement after = Field(root, "windowAfter");
        SameWindow(before, pid, hwnd);
        SameWindow(after, pid, hwnd);
        Demand(Flag(after, "isVisible") && Flag(after, "isForeground"),
            "WINDOW_NOT_FOREGROUND", "RIFT must be visible and foreground after screenshot");
        PixelRect outerBefore = Rect(before);
        PixelRect outerAfter = Rect(after);
        Demand(outerAfter.Width >= 700 && outerAfter.Height >= 500 &&
            outerBefore.Near(outerAfter, 1), "WINDOW_GEOMETRY_CHANGED", "Outer bounds changed");

        JsonElement uia = Field(root, "uiaRootAfter");
        Demand(Number(uia, "hwnd") == hwnd &&
            Text(uia, "className") == WindowClass &&
            Flag(uia, "isEnabled") && !Flag(uia, "isOffscreen") &&
            Rect(uia).Near(outerAfter, 1), "UIA_ROOT_CHANGED", "UIA top-level witness does not match outer HWND");

        JsonElement desktop = Field(root, "desktop");
        Demand(Text(root, "dpiAwareness") == "per-monitor-v2" &&
            Text(desktop, "coordinateSpace") == "physical-virtual-screen-pixels" &&
            Flag(desktop, "pointerPositionVerified") &&
            Flag(desktop, "windowFramePixelsVerified"), "DPI_COORDINATE_UNVERIFIED",
            "Per-monitor-v2 physical pixel mapping required");

        JsonElement mapping = Field(root, "coordinateMapping");
        Demand(Text(mapping, "mode") == MappingMode &&
            Text(mapping, "source") == "win32-DwmGetWindowAttribute-DWMWA_EXTENDED_FRAME_BOUNDS" &&
            Text(mapping, "dpiAwareness") == "per-monitor-v2",
            "DWM_MAPPING_REQUIRED", "Outer-window-relative or client-relative screenshot mapping is forbidden");
        DateTimeOffset geometryObservedUtc = Utc(mapping, "observedUtc");
        PixelRect dwm = Rect(Field(mapping, "dwmFrame"));
        PixelRect outerFromMap = Rect(Field(mapping, "outerWindow"));
        JsonElement clientOrigin = Field(mapping, "clientOrigin");
        JsonElement clientSize = Field(mapping, "clientSize");
        var client = new PixelRect(Number32(clientOrigin, "x"), Number32(clientOrigin, "y"),
            Number32(clientSize, "width"), Number32(clientSize, "height"));
        int dpi = Number32(mapping, "dpi");
        Demand(dpi >= 96 && dpi <= 768 && client.Width > 0 && client.Height > 0 &&
            outerFromMap.Near(outerAfter), "DWM_MAPPING_MISMATCH", "Frame/outer/client/DPI metadata invalid");
        Demand(dwm.Width <= outerAfter.Width && dwm.Height <= outerAfter.Height &&
            dwm.X >= outerAfter.X && dwm.Y >= outerAfter.Y &&
            (long)dwm.X + dwm.Width <= (long)outerAfter.X + outerAfter.Width &&
            (long)dwm.Y + dwm.Height <= (long)outerAfter.Y + outerAfter.Height,
            "DWM_FRAME_OUTSIDE_WINDOW", "DWM frame not wholly inside outer HWND");
        Demand(client.X >= outerAfter.X && client.Y >= outerAfter.Y &&
            (long)client.X + client.Width <= (long)outerAfter.X + outerAfter.Width &&
            (long)client.Y + client.Height <= (long)outerAfter.Y + outerAfter.Height,
            "CLIENT_OUTSIDE_WINDOW", "Client-screen bounds not within outer HWND");

        JsonElement capture = Field(root, "capture");
        Demand(Number32(capture, "pid") == pid && Number(capture, "hwnd") == hwnd &&
            Text(capture, "process") == ProcessName &&
            Text(capture, "expectedClass") == WindowClass &&
            Text(capture, "title") == WindowTitle &&
            !Flag(capture, "inputInjected") &&
            Flag(capture, "imageBytesVerified") &&
            Flag(capture, "imageSha256Verified") &&
            Flag(capture, "imageDimensionsVerified"),
            "CAPTURE_IDENTITY_UNVERIFIED", "WinApp PNG receipt identity/proof mismatched");
        string requestId = Text(capture, "requestId");
        string captureSha = Text(capture, "sha256").ToLowerInvariant();
        DateTimeOffset capturedUtc = Utc(capture, "capturedUtc");
        Demand(geometryObservedUtc >= capturedUtc.AddSeconds(-1) &&
            geometryObservedUtc <= currentUtc.AddSeconds(1),
            "DWM_GEOMETRY_STALE", "DWM geometry evidence must be captured at or after PNG time");
        Demand(RequestId.IsMatch(requestId) && Sha256.IsMatch(captureSha),
            "CAPTURE_RECEIPT_INVALID", "Bounded receipt ID and SHA256 required");
        Demand(Number32(capture, "width") == dwm.Width &&
            Number32(capture, "height") == dwm.Height,
            "CAPTURE_DWM_DIMENSIONS_MISMATCH", "Screenshot PNG must match DWM extended frame EXACTLY");
        var pngSize = PngHeader.Size(image);
        Demand(pngSize.Width == dwm.Width && pngSize.Height == dwm.Height,
            "IMAGE_DWM_DIMENSIONS_MISMATCH", "Actual PNG IHDR differs from DWM frame");
        string actualSha = Convert.ToHexString(SHA256.HashData(image)).ToLowerInvariant();
        Demand(actualSha == captureSha, "SCREENSHOT_HASH_MISMATCH", "Actual PNG bytes differ from capture receipt");
        Demand(capturedUtc >= startedUtc &&
            (currentUtc - capturedUtc).TotalSeconds <= 30 &&
            (currentUtc - capturedUtc).TotalSeconds >= -1,
            "CAPTURE_STALE", "Screenshot must be fresh, post-process-start and not future");
        DateTimeOffset plannedUtc = Utc(root, "nowUtc");
        Demand(Math.Abs((plannedUtc - currentUtc).TotalSeconds) <= 30,
            "PLAN_STALE", "Planner timestamp does not match present");
        
        JsonElement visual = Field(root, "visual");
        Demand(Text(visual, "captureRequestId") == requestId &&
            Text(visual, "captureSha256").Equals(captureSha, StringComparison.OrdinalIgnoreCase) &&
            Text(visual, "attestation") == RetryAttestation,
            "VISUAL_ATTESTATION_REQUIRED", "Human Retry ROI must bind exact PNG request/hash");
        JsonElement roi = Field(visual, "rect");
        int left = Number32(roi, "left"), top = Number32(roi, "top");
        int right = Number32(roi, "right"), bottom = Number32(roi, "bottom");
        var screenshotRoi = new PixelRect(left, top, right - left, bottom - top);
        Demand(left >= 10 && top >= 32 && right <= dwm.Width - 10 &&
            bottom <= dwm.Height - 10 && screenshotRoi.Width >= 35 &&
            screenshotRoi.Width <= 120 && screenshotRoi.Height >= 18 &&
            screenshotRoi.Height <= 50,
            "UNSAFE_RETRY_ROI", "Visual Retry ROI is not a bounded on-screen toolbar button");
        // Only screenshot ROI midpoint is permitted. Coordinates, including negative
        // virtual-screen X/Y, are never supplied as independent CLI arguments.
        long clickX = (long)dwm.X + left + (screenshotRoi.Width / 2);
        long clickY = (long)dwm.Y + top + (screenshotRoi.Height / 2);
        Demand(clickX >= int.MinValue && clickX <= int.MaxValue &&
            clickY >= int.MinValue && clickY <= int.MaxValue,
            "CLICK_OVERFLOW", "Computed signed physical virtual coordinate overflow");
        var click = new PixelPoint((int)clickX, (int)clickY);
        Demand(dwm.Contains(click) && outerAfter.Contains(click),
            "CLICK_OUTSIDE_TARGET", "Retry point not in verified RIFT frame and window");

        JsonElement plan = Field(root, "plan");
        Demand(Text(plan, "kind") == PlanKind &&
            !Flag(plan, "executable") && !Flag(plan, "liveAuthorized"),
            "INVALID_PLAN", "Only non-executable DWM-frame plan is accepted");
        SameTarget(Field(plan, "target"), pid, hwnd, startedUtc, sessionId, true);
        Demand(Text(plan, "captureRequestId") == requestId &&
            Text(plan, "captureSha256").Equals(captureSha, StringComparison.OrdinalIgnoreCase) &&
            Rect(Field(plan, "sourceDwmRect")).Near(dwm) &&
            Text(plan, "proposedTransport") == "FlaUI.Core.Input.Mouse.Click(Point)" &&
            Text(plan, "requiredNextGate") == "P3 independent review and target-specific Joey approval",
            "PLAN_PROOF_MISMATCH", "Plan does not match exact DWM frame, capture or transport");
        JsonElement planPoint = Field(plan, "virtualScreenPoint");
        Demand(Number32(planPoint, "x") == click.X &&
            Number32(planPoint, "y") == click.Y, "PLAN_POINT_MISMATCH",
            "Requested point differs from DWM-plus-attested-ROI midpoint");
        return new ValidatedIntent(pid, hwnd, startedUtc, sessionId,
            requestId, captureSha, outerAfter, dwm, client, dpi,
            screenshotRoi, click, capturedUtc);
    }
}

internal static class PngHeader
{
    internal static (int Width, int Height) Size(byte[] image)
    {
        ReadOnlySpan<byte> sig = [137, 80, 78, 71, 13, 10, 26, 10];
        if (image.Length < 33 || !image.AsSpan(0, 8).SequenceEqual(sig) ||
            BinaryPrimitives.ReadInt32BigEndian(image.AsSpan(8, 4)) != 13 ||
            !image.AsSpan(12, 4).SequenceEqual("IHDR"u8))
            throw new GuardFailure("INVALID_PNG", "Screenshot bytes lack standard PNG IHDR");
        int width = BinaryPrimitives.ReadInt32BigEndian(image.AsSpan(16, 4));
        int height = BinaryPrimitives.ReadInt32BigEndian(image.AsSpan(20, 4));
        if (width < 1 || height < 1 || width > 16384 || height > 16384)
            throw new GuardFailure("INVALID_PNG_DIMENSIONS", "PNG dimensions invalid");
        return (width, height);
    }
}

internal readonly record struct NativeWitness(
    int Pid, long Hwnd, DateTimeOffset StartedUtc, int SessionId,
    string ProcessName, string Title, string ClassName, long OwnerHwnd,
    bool Visible, long ForegroundHwnd, long WindowFromPointRoot,
    PixelRect Outer, PixelRect DwmFrame, PixelRect ClientScreen,
    PixelRect VirtualScreen, int Dpi, bool ThreadPerMonitorV2);

internal static class NativeProbe
{
    private const int GaRoot = 2;
    private const int GwOwner = 4;
    private const int DwmwaExtendedFrameBounds = 9;
    private const int SmXVirtualScreen = 76;
    private const int SmYVirtualScreen = 77;
    private const int SmCxVirtualScreen = 78;
    private const int SmCyVirtualScreen = 79;
    [StructLayout(LayoutKind.Sequential)]
    private struct NativeRect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)]
    private struct NativePoint { public int X, Y; }
    [DllImport("user32.dll")] private static extern bool IsWindow(nint hWnd);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(nint hWnd);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(nint hWnd, out NativeRect rect);
    [DllImport("user32.dll")] private static extern bool GetClientRect(nint hWnd, out NativeRect rect);
    [DllImport("user32.dll")] private static extern bool ClientToScreen(nint hWnd, ref NativePoint point);
    [DllImport("user32.dll")] private static extern nint GetWindow(nint hWnd, uint command);
    [DllImport("user32.dll")] private static extern nint GetForegroundWindow();
    [DllImport("user32.dll")] private static extern nint WindowFromPoint(NativePoint point);
    [DllImport("user32.dll")] private static extern nint GetAncestor(nint hWnd, uint flags);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(nint hWnd, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "GetWindowTextW")]
    private static extern int GetWindowText(nint hWnd, StringBuilder title, int capacity);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "GetClassNameW")]
    private static extern int GetClassName(nint hWnd, StringBuilder title, int capacity);
    [DllImport("user32.dll")] private static extern uint GetDpiForWindow(nint hWnd);
    [DllImport("user32.dll")] private static extern nint GetThreadDpiAwarenessContext();
    [DllImport("user32.dll")] private static extern bool AreDpiAwarenessContextsEqual(nint a, nint b);
    [DllImport("user32.dll")] private static extern bool SetProcessDpiAwarenessContext(nint context);
    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
    [DllImport("dwmapi.dll", PreserveSig = true)]
    private static extern int DwmGetWindowAttribute(nint hWnd, uint attribute, out NativeRect rect, uint size);

    private static PixelRect Rect(NativeRect rect) =>
        new(rect.Left, rect.Top, checked(rect.Right - rect.Left), checked(rect.Bottom - rect.Top));

    internal static NativeWitness Capture(ValidatedIntent intent)
    {
        // Never create/focus a window. Set awareness before querying any geometry.
        _ = SetProcessDpiAwarenessContext(new nint(-4)); // May be already fixed by manifest.
        bool pmv2 = AreDpiAwarenessContextsEqual(
            GetThreadDpiAwarenessContext(), new nint(-4));
        nint hwnd = checked((nint)intent.Hwnd);
        if (!IsWindow(hwnd) || !GetWindowRect(hwnd, out NativeRect outer) ||
            !GetClientRect(hwnd, out NativeRect client) ||
            DwmGetWindowAttribute(hwnd, DwmwaExtendedFrameBounds,
                out NativeRect dwm, (uint)Marshal.SizeOf<NativeRect>()) != 0)
            throw new GuardFailure("NATIVE_WINDOW_UNAVAILABLE",
                "Win32/DWM exact target geometry unavailable");

        var clientOrigin = new NativePoint();
        if (!ClientToScreen(hwnd, ref clientOrigin))
            throw new GuardFailure("NATIVE_CLIENT_ORIGIN_UNAVAILABLE", "ClientToScreen failed");
        _ = GetWindowThreadProcessId(hwnd, out uint actualPid);
        var className = new StringBuilder(256);
        var title = new StringBuilder(512);
        _ = GetClassName(hwnd, className, className.Capacity);
        _ = GetWindowText(hwnd, title, title.Capacity);
        var point = new NativePoint { X = intent.ClickPoint.X, Y = intent.ClickPoint.Y };
        nint hitHwnd = WindowFromPoint(point);
        nint root = hitHwnd == nint.Zero ? nint.Zero : GetAncestor(hitHwnd, GaRoot);
        using Process process = Process.GetProcessById(intent.Pid);
        var screenshotClient = new PixelRect(clientOrigin.X, clientOrigin.Y,
            checked(client.Right - client.Left), checked(client.Bottom - client.Top));
        var virtualScreen = new PixelRect(GetSystemMetrics(SmXVirtualScreen),
            GetSystemMetrics(SmYVirtualScreen),
            GetSystemMetrics(SmCxVirtualScreen), GetSystemMetrics(SmCyVirtualScreen));
        return new NativeWitness((int)actualPid, intent.Hwnd, process.StartTime.ToUniversalTime(),
            process.SessionId, process.ProcessName, title.ToString(), className.ToString(),
            GetWindow(hwnd, GwOwner).ToInt64(), IsWindowVisible(hwnd),
            GetForegroundWindow().ToInt64(), root.ToInt64(),
            Rect(outer), Rect(dwm), screenshotClient, virtualScreen,
            checked((int)GetDpiForWindow(hwnd)), pmv2);
    }

    internal static void RequireExact(NativeWitness n, ValidatedIntent i)
    {
        if (n.Pid != i.Pid || n.Hwnd != i.Hwnd || n.SessionId != i.SessionId ||
            Math.Abs((n.StartedUtc - i.StartedUtc).TotalMilliseconds) > 1)
            throw new GuardFailure("NATIVE_PROCESS_IDENTITY_CHANGED", "PID/HWND/start/session not exact");
        if (n.ProcessName != "rift_x64" || n.ClassName != "TWNClientFramework" ||
            n.Title != "RIFT" || n.OwnerHwnd != 0 || !n.Visible)
            throw new GuardFailure("NATIVE_WINDOW_IDENTITY_CHANGED", "Class/title/owner/visibility not exact");
        if (n.ForegroundHwnd != i.Hwnd || n.WindowFromPointRoot != i.Hwnd)
            throw new GuardFailure("NATIVE_POINT_OCCLUDED", "Foreground/WindowFromPoint root not exact target");
        if (!n.ThreadPerMonitorV2 || n.Dpi != i.Dpi ||
            !n.Outer.Near(i.OuterWindow) || !n.DwmFrame.Near(i.DwmFrame) ||
            !n.ClientScreen.Near(i.ClientScreen))
            throw new GuardFailure("NATIVE_DPI_FRAME_CHANGED",
                "DPI, DWM frame, outer or client geometry changed");
        if (!n.VirtualScreen.Contains(i.ClickPoint) ||
            !n.DwmFrame.Contains(i.ClickPoint) ||
            !n.Outer.Contains(i.ClickPoint))
            throw new GuardFailure("NATIVE_CLICK_OUTSIDE", "Point outside native screen/RIFT DWM bounds");
    }
}

internal static class UnreachableFlaUiTransport
{
    // P2 source implementation only. No command branch, delegate, or public API calls it.
    // P3 must independently review and explicitly authorize enabling one-shot input
    // UNDER A WORKBRIDGE LEASE + FSYNCED INTENT + QUARANTINE, before this can be wired.
    private static readonly bool BuildTimeLiveGate = false;
    private static void FutureSingleClick(ValidatedIntent intent)
    {
        if (!BuildTimeLiveGate)
            throw new GuardFailure("LIVE_DISABLED_PENDING_P3",
                "P2 has no reachable live-click path");
        NativeProbe.RequireExact(NativeProbe.Capture(intent), intent);
        var desired = new Point(intent.ClickPoint.X, intent.ClickPoint.Y);
        Mouse.Position = desired; // Proven disposable WinForms transport; no input occurs in P2.
        if (Mouse.Position != desired)
            throw new GuardFailure("POINTER_DID_NOT_MOVE", "FlaUI physical pointer mismatch");
        // Last-moment hit test after movement protects against menus/overlays.
        NativeProbe.RequireExact(NativeProbe.Capture(intent), intent);
        Mouse.LeftClick();
    }
}

internal static class Program
{
    private static int Reject(string code, string message, int exitCode = 2)
    {
        Console.WriteLine(JsonSerializer.Serialize(new
        {
            status = "REJECTED", code, message, inputInjected = false,
            liveInputAllowed = false
        }));
        return exitCode;
    }

    private static int Main(string[] args)
    {
        // The default and every unknown/unapproved flag reject before reading files.
        if (args.Length == 1 && args[0] == "--self-test")
            return SyntheticTests.Run();
        bool contractOnly = args.Length == 2 && args[0] == "--contract-check";
        bool nativeDryRun = args.Length == 2 && args[0] == "--dry-run";
        if (!contractOnly && !nativeDryRun)
            return Reject("LIVE_DISABLED_PENDING_P3",
                "P2 supports --self-test, --contract-check or --dry-run; live RIFT input is disabled");

        try
        {
            string envelopePath = args[1];
            if (!Path.IsPathFullyQualified(envelopePath) || !File.Exists(envelopePath))
                return Reject("MISSING_ENVELOPE", "Absolute existing witness-envelope path required");
            var envelope = new FileInfo(envelopePath);
            if (envelope.Length is <= 0 or > 2_097_152)
                return Reject("ENVELOPE_SIZE", "Envelope must be nonempty and <=2 MiB");
            using var json = JsonDocument.Parse(File.ReadAllText(envelopePath),
                new JsonDocumentOptions { MaxDepth = 24 });
            JsonElement fileField = json.RootElement.GetProperty("screenshotPngPath");
            string pngPath = fileField.GetString() ?? "";
            if (!Path.IsPathFullyQualified(pngPath) || !File.Exists(pngPath))
                return Reject("MISSING_PNG", "Absolute existing screenshot PNG required");
            var file = new FileInfo(pngPath);
            if (file.Length is < 33 or > 33_554_432)
                return Reject("PNG_SIZE", "PNG must be between 33 bytes and 32 MiB");
            byte[] png = File.ReadAllBytes(pngPath);
            var validated = Witness.Validate(json.RootElement, png, DateTimeOffset.UtcNow);
            if (contractOnly)
            {
                // Cross-language offline contract test: no NativeProbe/Win32.
                Console.WriteLine(JsonSerializer.Serialize(new
                {
                    status = "CONTRACT_ONLY_OK_NATIVE_NOT_CHECKED",
                    nativeVerified = false, inputInjected = false,
                    liveInputAllowed = false,
                    target = new { validated.Pid, validated.Hwnd, validated.StartedUtc, validated.SessionId },
                    capture = new { validated.CaptureRequestId, validated.CaptureSha256 },
                    coordinateMapping = "dwm-extended-frame-physical",
                    validated.DwmFrame, validated.ScreenshotRoi, validated.ClickPoint
                }));
                return 0;
            }
            var native = NativeProbe.Capture(validated);
            NativeProbe.RequireExact(native, validated);
            Console.WriteLine(JsonSerializer.Serialize(new
            {
                status = "DRY_RUN_OK",
                liveInputAllowed = false,
                inputInjected = false,
                target = new { validated.Pid, validated.Hwnd, validated.StartedUtc, validated.SessionId },
                capture = new { validated.CaptureRequestId, validated.CaptureSha256, validated.CapturedUtc },
                coordinateMapping = "dwm-extended-frame-physical",
                validated.OuterWindow,
                validated.DwmFrame,
                validated.ClientScreen,
                validated.Dpi,
                validated.ScreenshotRoi,
                validated.ClickPoint,
                nativeForegroundHwnd = native.ForegroundHwnd,
                nativeHitRootHwnd = native.WindowFromPointRoot,
                p3Gate = "Independent review and target-specific operator approval REQUIRED"
            }));
            return 0;
        }
        catch (GuardFailure e) { return Reject(e.Code, e.Message, 3); }
        catch (Exception e) when (e is JsonException or IOException or UnauthorizedAccessException
            or ArgumentException or InvalidOperationException or OverflowException
            or System.ComponentModel.Win32Exception)
        {
            return Reject("PREFLIGHT_FAILED", e.GetType().Name, 3);
        }
    }
}
