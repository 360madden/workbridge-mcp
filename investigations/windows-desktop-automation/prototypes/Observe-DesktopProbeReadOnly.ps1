# Investigation-only native observer for the *owned disposable* DesktopProbe process.
# Read-only: no SetForegroundWindow, keyboard/mouse, screenshot, window mutation or daemon.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateRange(1, 2147483647)][int]$TargetPid,
    [Parameter(Mandatory)][string]$TargetHwnd,
    [Parameter(Mandatory)][string]$StartTicks,
    [Parameter(Mandatory)][ValidateRange(1, 2147483647)][int]$TargetSession,
    [Parameter(Mandatory)][string]$ExePath,
    [Parameter(Mandatory)][string]$ExeSha256,
    [Parameter(Mandatory)][string]$OwnerSid,
    [Parameter(Mandatory)][string]$ClassName,
    [Parameter(Mandatory)][string]$ForegroundHwnd,
    [Parameter(Mandatory)][string]$EvidenceDir
)
$ErrorActionPreference = 'Stop'
function Deny([string]$code) { throw [System.InvalidOperationException]::new($code) }

try {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { Deny 'WINDOWS_REQUIRED' }
    if ($TargetHwnd -notmatch '^[1-9][0-9]{0,17}$' -or
        $ForegroundHwnd -notmatch '^[1-9][0-9]{0,17}$' -or
        $StartTicks -notmatch '^[1-9][0-9]{16,18}$' -or
        $ExeSha256 -notmatch '^[a-fA-F0-9]{64}$' -or
        $OwnerSid -notmatch '^S-[0-9]+-[0-9]+(-[0-9]+)+$' -or
        $ClassName.Length -lt 1 -or $ClassName.Length -gt 240) {
        Deny 'INVALID_IDENTITY'
    }
    $targetNativeHwnd = [long]::Parse($TargetHwnd, [Globalization.CultureInfo]::InvariantCulture)
    $expectedForeground = [long]::Parse($ForegroundHwnd, [Globalization.CultureInfo]::InvariantCulture)
    $approvedExe = [IO.Path]::GetFullPath($ExePath)
    if (-not [IO.Path]::IsPathRooted($ExePath) -or
        [IO.Path]::GetFileName($approvedExe) -ine 'DesktopProbe.exe') {
        Deny 'INVALID_EXECUTABLE_PATH'
    }
    $evidence = [IO.Path]::GetFullPath($EvidenceDir)
    $runDir = [IO.Path]::GetDirectoryName($evidence)
    $privateRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\temp'))
    if ([IO.Path]::GetFileName($evidence) -ine 'evidence' -or
        [IO.Path]::GetDirectoryName($runDir).TrimEnd('\') -ine $privateRoot.TrimEnd('\') -or
        [IO.Path]::GetFileName($runDir) -notmatch '^desktopprobe-[a-z0-9][a-z0-9-]{5,50}$') {
        Deny 'UNTRUSTED_EVIDENCE_DIRECTORY'
    }
    foreach ($folder in @($evidence, $runDir)) {
        $dir = Get-Item -LiteralPath $folder -ErrorAction Stop
        if (-not $dir.PSIsContainer -or ($dir.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            Deny 'EVIDENCE_DIRECTORY_REPARSE'
        }
    }

    Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class DesktopProbeReadOnlyWin32 {
    [StructLayout(LayoutKind.Sequential)]
    public struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] [return:MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsWindow(IntPtr hWnd);
    [DllImport("user32.dll")] [return:MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] [return:MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hWnd, uint flags);
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint command);
    [DllImport("user32.dll")] public static extern IntPtr GetThreadDesktop(uint threadId);
    [DllImport("user32.dll")] public static extern IntPtr GetProcessWindowStation();
    [DllImport("user32.dll", CharSet=CharSet.Unicode)]
    [return:MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetUserObjectInformation(IntPtr handle, int index, StringBuilder name, uint bytes, out uint needed);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder className, int max);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder title, int max);
    [DllImport("user32.dll")] [return:MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetWindowRect(IntPtr hWnd, out Rect rectangle);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint flags);
    [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("advapi32.dll", SetLastError=true)]
    [return:MarshalAs(UnmanagedType.Bool)]
    public static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("kernel32.dll", SetLastError=true)]
    [return:MarshalAs(UnmanagedType.Bool)]
    public static extern bool CloseHandle(IntPtr handle);
}
'@ -ErrorAction Stop

    function ReadUserObjectName([IntPtr]$handle) {
        if ($handle -eq [IntPtr]::Zero) { Deny 'DESKTOP_HANDLE_UNAVAILABLE' }
        $name = [Text.StringBuilder]::new(256)
        [uint32]$needed = 0
        if (-not [DesktopProbeReadOnlyWin32]::GetUserObjectInformation(
            $handle, 2, $name, [uint32]($name.Capacity * 2), [ref]$needed)) {
            Deny 'DESKTOP_NAME_UNAVAILABLE'
        }
        return $name.ToString()
    }

    $proc = [Diagnostics.Process]::GetProcessById($TargetPid)
    if ($proc.HasExited -or $proc.ProcessName -cne 'DesktopProbe') { Deny 'WRONG_OR_EXITED_PROCESS' }
    $observedTicks = $proc.StartTime.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture)
    if ($observedTicks -cne $StartTicks) { Deny 'STALE_PROCESS_START' }
    if ($proc.SessionId -ne $TargetSession) { Deny 'SESSION_CHANGED' }
    $actualExe = [IO.Path]::GetFullPath($proc.MainModule.FileName)
    if (-not $actualExe.Equals($approvedExe, [StringComparison]::OrdinalIgnoreCase)) {
        Deny 'EXECUTABLE_CHANGED'
    }
    $exeItem = Get-Item -LiteralPath $actualExe
    if (($exeItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
        (Get-FileHash -LiteralPath $actualExe -Algorithm SHA256).Hash -ine $ExeSha256) {
        Deny 'EXECUTABLE_HASH_CHANGED'
    }
    $processHandle = [DesktopProbeReadOnlyWin32]::OpenProcess(0x1000, $false, [uint32]$TargetPid)
    if ($processHandle -eq [IntPtr]::Zero) { Deny 'OWNER_PROCESS_UNAVAILABLE' }
    $tokenHandle = [IntPtr]::Zero
    try {
        if (-not [DesktopProbeReadOnlyWin32]::OpenProcessToken($processHandle, 0x0008, [ref]$tokenHandle) -or
            $tokenHandle -eq [IntPtr]::Zero) { Deny 'OWNER_TOKEN_UNAVAILABLE' }
        $identity = [Security.Principal.WindowsIdentity]::new($tokenHandle)
        try { $actualSid = $identity.User.Value }
        finally { $identity.Dispose() }
    } finally {
        if ($tokenHandle -ne [IntPtr]::Zero) {
            [void][DesktopProbeReadOnlyWin32]::CloseHandle($tokenHandle)
        }
        [void][DesktopProbeReadOnlyWin32]::CloseHandle($processHandle)
    }
    if ($actualSid -cne $OwnerSid) { Deny 'OWNER_SID_CHANGED' }
    if ([Diagnostics.Process]::GetCurrentProcess().SessionId -ne $TargetSession -or
        [Security.Principal.WindowsIdentity]::GetCurrent().User.Value -cne $OwnerSid) {
        Deny 'OBSERVER_SESSION_OR_USER_MISMATCH'
    }
    $hwnd = [IntPtr]::new($targetNativeHwnd)
    if (-not [DesktopProbeReadOnlyWin32]::IsWindow($hwnd)) { Deny 'HWND_NOT_FOUND' }
    [uint32]$windowPid = 0
    $windowThread = [DesktopProbeReadOnlyWin32]::GetWindowThreadProcessId($hwnd, [ref]$windowPid)
    if ($windowPid -ne $TargetPid) { Deny 'HWND_WRONG_PROCESS' }
    $rootHwnd = [DesktopProbeReadOnlyWin32]::GetAncestor($hwnd, 2).ToInt64()
    $ownerHwnd = [DesktopProbeReadOnlyWin32]::GetWindow($hwnd, 4).ToInt64()
    if ($rootHwnd -ne $targetNativeHwnd -or $ownerHwnd -ne 0) { Deny 'WINDOW_NOT_ROOT_UNOWNED' }
    $stationName = ReadUserObjectName ([DesktopProbeReadOnlyWin32]::GetProcessWindowStation())
    $desktopName = ReadUserObjectName ([DesktopProbeReadOnlyWin32]::GetThreadDesktop($windowThread))
    if ($stationName -ine 'WinSta0' -or $desktopName -ine 'Default') { Deny 'WRONG_INTERACTIVE_DESKTOP' }
    $nativeClass = [Text.StringBuilder]::new(256)
    if ([DesktopProbeReadOnlyWin32]::GetClassName($hwnd, $nativeClass, $nativeClass.Capacity) -le 0 -or
        $nativeClass.ToString() -cne $ClassName) { Deny 'WINDOW_CLASS_CHANGED' }
    $nativeTitle = [Text.StringBuilder]::new(256)
    [void][DesktopProbeReadOnlyWin32]::GetWindowText($hwnd, $nativeTitle, $nativeTitle.Capacity)
    if ($nativeTitle.ToString() -cne 'Workbridge GUI-004 Native Input Probe') {
        Deny 'WINDOW_TITLE_CHANGED'
    }
    if (-not [DesktopProbeReadOnlyWin32]::IsWindowVisible($hwnd) -or
        [DesktopProbeReadOnlyWin32]::IsIconic($hwnd)) { Deny 'WINDOW_NOT_VISIBLE' }
    $rect = New-Object DesktopProbeReadOnlyWin32+Rect
    if (-not [DesktopProbeReadOnlyWin32]::GetWindowRect($hwnd, [ref]$rect)) {
        Deny 'WINDOW_RECT_UNAVAILABLE'
    }
    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top
    if ($width -lt 300 -or $height -lt 200 -or
        [Math]::Abs([long]$rect.Left) -gt 20000 -or [Math]::Abs([long]$rect.Top) -gt 20000 -or
        [DesktopProbeReadOnlyWin32]::MonitorFromWindow($hwnd, 0) -eq [IntPtr]::Zero) {
        Deny 'WINDOW_GEOMETRY_INVALID'
    }
    $foreground = [DesktopProbeReadOnlyWin32]::GetForegroundWindow().ToInt64()
    if ($foreground -ne $expectedForeground) { Deny 'FOREGROUND_CHANGED' }

    $journalPath = [IO.Path]::Combine($evidence, ('native-probe-' + $TargetPid + '.jsonl'))
    $itemBefore = Get-Item -LiteralPath $journalPath -ErrorAction Stop
    if ($itemBefore.PSIsContainer -or ($itemBefore.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
        $itemBefore.Length -lt 16 -or $itemBefore.Length -gt 65536) { Deny 'INVALID_JOURNAL' }
    $lines = @(Get-Content -LiteralPath $journalPath -ErrorAction Stop)
    if ($lines.Count -ne 2) { Deny 'JOURNAL_EVENT_COUNT_CHANGED' }
    $events = @($lines | ForEach-Object { $_ | ConvertFrom-Json -ErrorAction Stop })
    if ($events[0].stage -cne 'starting' -or $events[1].stage -cne 'shown') {
        Deny 'JOURNAL_SEQUENCE_CHANGED'
    }
    foreach ($event in $events) {
        if ($event.pid -ne $TargetPid -or $event.sessionId -ne $TargetSession -or
            $event.counter -ne 0 -or
            $event.title -cne 'Workbridge GUI-004 Native Input Probe' -or
            $null -ne $event.error) { Deny 'JOURNAL_IDENTITY_CHANGED' }
    }
    if ([long]$events[0].hwnd -ne 0 -or [long]$events[1].hwnd -ne $targetNativeHwnd) {
        Deny 'JOURNAL_HWND_CHANGED'
    }
    $journalHash = (Get-FileHash -LiteralPath $journalPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $itemAfter = Get-Item -LiteralPath $journalPath
    if ($itemAfter.Length -ne $itemBefore.Length -or
        $itemAfter.LastWriteTimeUtc.Ticks -ne $itemBefore.LastWriteTimeUtc.Ticks) {
        Deny 'JOURNAL_CHANGED_DURING_READ'
    }
    $proc.Refresh()
    if ($proc.HasExited) { Deny 'PROCESS_EXITED_DURING_OBSERVER' }
    $processAgain = [Diagnostics.Process]::GetProcessById($TargetPid)
    if ($processAgain.StartTime.ToUniversalTime().Ticks.ToString(
        [Globalization.CultureInfo]::InvariantCulture) -cne $StartTicks -or
        $processAgain.SessionId -ne $TargetSession) { Deny 'PROCESS_ID_REUSED_DURING_OBSERVER' }
    [pscustomobject]@{
        schemaVersion = 1
        verified = $true
        pid = $TargetPid
        startedAtUtcTicks = $observedTicks
        sessionId = $TargetSession
        ownerSidVerified = $true
        hwnd = $TargetHwnd
        rootHwnd = $rootHwnd.ToString([Globalization.CultureInfo]::InvariantCulture)
        ownerHwnd = $ownerHwnd.ToString([Globalization.CultureInfo]::InvariantCulture)
        windowStation = $stationName
        desktopName = $desktopName
        className = $nativeClass.ToString()
        rect = [pscustomobject]@{
            left = $rect.Left; top = $rect.Top; right = $rect.Right; bottom = $rect.Bottom
            width = $width; height = $height
        }
        foregroundHwnd = $foreground.ToString([Globalization.CultureInfo]::InvariantCulture)
        journal = [pscustomobject]@{
            eventCount = 2; shown = $true; counter = 0; unexpectedInputEvents = 0
            sha256 = $journalHash
        }
    } | ConvertTo-Json -Compress -Depth 5
    exit 0
} catch {
    $code = [string]$_.Exception.Message
    if ($code -notmatch '^[A-Z][A-Z_]{2,60}$') { $code = 'OBSERVER_EXCEPTION' }
    [pscustomobject]@{ schemaVersion = 1; verified = $false; errorCode = $code } |
        ConvertTo-Json -Compress
    exit 2
}
