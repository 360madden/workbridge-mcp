using System.Runtime.InteropServices;
using System.Text;

internal static class DesktopFacts
{
    // Read-only Win32 calls scoped to this process's own Windows session.
    private const uint DesktopReadObjects = 0x0001;
    private const int UserObjectName = 2;

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr GetProcessWindowStation();

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr GetThreadDesktop(uint threadId);

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint desiredAccess);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseDesktop(IntPtr desktop);

    [DllImport("user32.dll", EntryPoint = "GetUserObjectInformationW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetUserObjectInformation(
        IntPtr handle, int index, StringBuilder name, uint bytes, out uint needed);

    [DllImport("kernel32.dll")]
    private static extern uint WTSGetActiveConsoleSessionId();

    // Query WTSConnectState (class 8), an independent read-only session signal.
    // The buffer is a 4-byte WTS_CONNECTSTATE_CLASS and must be freed by WTSFreeMemory.
    [DllImport("wtsapi32.dll", EntryPoint = "WTSQuerySessionInformationW", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool WTSQuerySessionInformation(
        IntPtr server, uint sessionId, int infoClass, out IntPtr buffer, out uint returnedBytes);

    [DllImport("wtsapi32.dll")]
    private static extern void WTSFreeMemory(IntPtr buffer);

    internal static string ClassifyConnectionState(int? state) => state switch
    {
        0 => "ACTIVE",
        4 => "DISCONNECTED",
        _ => "UNKNOWN",
    };

    private static (int? rawState, int? win32Error, bool validResponse) ReadConnectionState(int processSessionId)
    {
        IntPtr buffer = IntPtr.Zero;
        try
        {
            bool queried = WTSQuerySessionInformation(
                IntPtr.Zero, checked((uint)processSessionId), 8, out buffer, out uint returnedBytes);
            if (!queried)
                return (null, Marshal.GetLastWin32Error(), false);
            if (buffer == IntPtr.Zero || returnedBytes != sizeof(int))
                return (null, null, false);
            int value = Marshal.ReadInt32(buffer);
            return (value, null, true);
        }
        finally
        {
            if (buffer != IntPtr.Zero)
                WTSFreeMemory(buffer);
        }
    }

    private static string? ReadName(IntPtr handle)
    {
        if (handle == IntPtr.Zero)
            return null;
        var name = new StringBuilder(256);
        return GetUserObjectInformation(handle, UserObjectName, name, (uint)(name.Capacity * sizeof(char)), out _)
            ? name.ToString()
            : null;
    }

    internal static string Classify(
        bool userInteractive, string? station, string? thread, string? input,
        int sessionId, int? activeConsoleSessionId)
    {
        if (!userInteractive || station != "WinSta0")
            return "NONINTERACTIVE_STATION";
        if (string.IsNullOrEmpty(input))
            return "INPUT_DESKTOP_UNKNOWN";
        if (input != "Default")
            return "NONDEFAULT_INPUT_DESKTOP";
        if (thread != "Default")
            return "NONDEFAULT_THREAD_DESKTOP";
        if (activeConsoleSessionId is null)
            return "CONSOLE_SESSION_UNKNOWN";
        if (sessionId != activeConsoleSessionId)
            return "NOT_ACTIVE_CONSOLE_SESSION";
        return "DEFAULT_INPUT_DESKTOP_SAMPLE";
    }

    // An instantaneous sample is never an input lease: a desktop can switch
    // between heartbeats, and disconnected RDP sessions may return a future
    // input desktop. The controller still requires independent interval proof.
    internal static object Sample(int processSessionId)
    {
        var windowStation = ReadName(GetProcessWindowStation());
        var threadDesktop = ReadName(GetThreadDesktop(GetCurrentThreadId()));
        string? inputDesktop = null;
        int? inputDesktopError = null;
        IntPtr opened = OpenInputDesktop(0, false, DesktopReadObjects);
        if (opened == IntPtr.Zero)
        {
            inputDesktopError = Marshal.GetLastWin32Error();
        }
        else
        {
            try
            {
                inputDesktop = ReadName(opened);
                if (inputDesktop is null)
                    inputDesktopError = Marshal.GetLastWin32Error();
            }
            finally
            {
                if (!CloseDesktop(opened))
                {
                    inputDesktop = null;
                    inputDesktopError = Marshal.GetLastWin32Error();
                }
            }
        }

        uint consoleId = WTSGetActiveConsoleSessionId();
        int? activeConsoleSessionId = consoleId == uint.MaxValue ? null : checked((int)consoleId);
        bool userInteractive = Environment.UserInteractive;
        var connection = ReadConnectionState(processSessionId);
        return new
        {
            observedAtUtc = DateTimeOffset.UtcNow,
            userInteractive,
            windowStation,
            threadDesktop,
            inputDesktop,
            inputDesktopWin32Error = inputDesktopError,
            activeConsoleSessionId,
            sampleStatus = Classify(
                userInteractive, windowStation, threadDesktop, inputDesktop,
                processSessionId, activeConsoleSessionId),
            sessionLocked = "UNKNOWN",
            sessionConnected = ClassifyConnectionState(connection.rawState),
            wtsConnectState = connection.rawState,
            wtsQueryWin32Error = connection.win32Error,
            wtsResponseValid = connection.validResponse,
            intervalContinuity = "UNKNOWN",
            safeForInput = false,
        };
    }

    internal static int SelfTest()
    {
        var cases = new (bool user, string? station, string? thread, string? input,
            int session, int? console, string expected)[]
        {
            (true, "WinSta0", "Default", "Default", 1, 1, "DEFAULT_INPUT_DESKTOP_SAMPLE"),
            (true, "WinSta0", "Default", "Winlogon", 1, 1, "NONDEFAULT_INPUT_DESKTOP"),
            (false, "WinSta0", "Default", "Default", 1, 1, "NONINTERACTIVE_STATION"),
            (true, "Service-0x0-3e7$", "Default", "Default", 1, 1, "NONINTERACTIVE_STATION"),
            (true, "WinSta0", "Default", null, 1, 1, "INPUT_DESKTOP_UNKNOWN"),
            (true, "WinSta0", "Private", "Default", 1, 1, "NONDEFAULT_THREAD_DESKTOP"),
            (true, "WinSta0", "Default", "Default", 2, 1, "NOT_ACTIVE_CONSOLE_SESSION"),
            (true, "WinSta0", "Default", "Default", 1, null, "CONSOLE_SESSION_UNKNOWN"),
        };
        foreach (var item in cases)
            if (Classify(item.user, item.station, item.thread, item.input,
                    item.session, item.console) != item.expected)
                return -1;
        var connectionCases = new (int? raw, string expected)[]
        {
            (0, "ACTIVE"), (4, "DISCONNECTED"),
            (1, "UNKNOWN"), (null, "UNKNOWN"),
        };
        foreach (var item in connectionCases)
            if (ClassifyConnectionState(item.raw) != item.expected)
                return -1;
        return cases.Length + connectionCases.Length;
    }
}
