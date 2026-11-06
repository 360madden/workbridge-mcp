# M2 read-only Windows input desktop sample. No window creation, focus, input, hooks,
# screenshot, service management, scheduled tasks or implicit input authorization.
# The reported active desktop is scoped to THIS process's Windows session.
[CmdletBinding()]
param(
    [ValidateRange(0, 2147483647)][int]$ExpectedSessionId = 0,
    [switch]$SelfTest
)
$ErrorActionPreference = 'Stop'

function ClassifyInputDesktopSample(
    [bool]$userInteractive,
    [string]$station,
    [string]$threadDesktop,
    [string]$inputDesktop,
    [int]$sessionId,
    [int]$consoleSessionId
) {
    if (-not $userInteractive -or $station -cne 'WinSta0') { return 'NONINTERACTIVE_STATION' }
    if ([string]::IsNullOrEmpty($inputDesktop)) { return 'INPUT_DESKTOP_UNKNOWN' }
    if ($inputDesktop -cne 'Default') { return 'NONDEFAULT_INPUT_DESKTOP' }
    if ($threadDesktop -cne 'Default') { return 'NONDEFAULT_THREAD_DESKTOP' }
    if ($consoleSessionId -lt 0) { return 'CONSOLE_SESSION_UNKNOWN' }
    if ($sessionId -ne $consoleSessionId) { return 'NOT_ACTIVE_CONSOLE_SESSION' }
    return 'DEFAULT_INPUT_DESKTOP_SAMPLE'
}

if ($SelfTest) {
    # Pure classifier checks: no Add-Type, P/Invoke or Windows calls.
    $cases = @(
        @{ name='sample'; u=$true; station='WinSta0'; thread='Default'; input='Default'; sid=1; console=1; want='DEFAULT_INPUT_DESKTOP_SAMPLE' },
        @{ name='locked'; u=$true; station='WinSta0'; thread='Default'; input='Winlogon'; sid=1; console=1; want='NONDEFAULT_INPUT_DESKTOP' },
        @{ name='noninteractive'; u=$false; station='WinSta0'; thread='Default'; input='Default'; sid=1; console=1; want='NONINTERACTIVE_STATION' },
        @{ name='service'; u=$true; station='Service-0x0-3e7$'; thread='Default'; input='Default'; sid=1; console=1; want='NONINTERACTIVE_STATION' },
        @{ name='inaccessible'; u=$true; station='WinSta0'; thread='Default'; input=$null; sid=1; console=1; want='INPUT_DESKTOP_UNKNOWN' },
        @{ name='other-thread-desktop'; u=$true; station='WinSta0'; thread='Private'; input='Default'; sid=1; console=1; want='NONDEFAULT_THREAD_DESKTOP' },
        @{ name='disconnected-or-rdp'; u=$true; station='WinSta0'; thread='Default'; input='Default'; sid=2; console=1; want='NOT_ACTIVE_CONSOLE_SESSION' },
        @{ name='console-transition'; u=$true; station='WinSta0'; thread='Default'; input='Default'; sid=1; console=-1; want='CONSOLE_SESSION_UNKNOWN' }
    )
    foreach ($case in $cases) {
        $actual = ClassifyInputDesktopSample $case.u $case.station $case.thread $case.input $case.sid $case.console
        if ($actual -cne $case.want) {
            throw "SELF_TEST_FAILED_$($case.name)"
        }
    }
    [pscustomobject]@{ schemaVersion=1; readOnly=$true; selfTest='PASS'; cases=$cases.Count; safeForInput=$false } |
        ConvertTo-Json -Compress
    exit 0
}

try {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
        throw 'WINDOWS_REQUIRED'
    }
    $observer = [Diagnostics.Process]::GetCurrentProcess()
    $sessionId = $observer.SessionId
    if ($ExpectedSessionId -gt 0 -and $sessionId -ne $ExpectedSessionId) {
        throw 'EXPECTED_SESSION_MISMATCH'
    }

    # Existing DesktopProbe observers use GetProcessWindowStation,
    # GetThreadDesktop and GetUserObjectInformation(UOI_NAME=2).
    # Unlike those window-thread checks, OpenInputDesktop observes the
    # input desktop at this instant. Never call SwitchDesktop.
    Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class M2InputDesktopReadOnly {
    [DllImport("user32.dll", SetLastError=true)]
    public static extern IntPtr GetProcessWindowStation();
    [DllImport("user32.dll", SetLastError=true)]
    public static extern IntPtr GetThreadDesktop(uint threadId);
    [DllImport("kernel32.dll")]
    public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll", SetLastError=true)]
    public static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint desiredAccess);
    [DllImport("user32.dll", SetLastError=true)]
    [return:MarshalAs(UnmanagedType.Bool)]
    public static extern bool CloseDesktop(IntPtr desktop);
    [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    [return:MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetUserObjectInformation(IntPtr handle, int index, StringBuilder name, uint bytes, out uint needed);
    [DllImport("kernel32.dll")]
    public static extern uint WTSGetActiveConsoleSessionId();
}
'@ -ErrorAction Stop

    function ReadNativeName([IntPtr]$handle) {
        if ($handle -eq [IntPtr]::Zero) { throw 'NATIVE_HANDLE_UNAVAILABLE' }
        $name = [Text.StringBuilder]::new(256)
        [uint32]$needed = 0
        if (-not [M2InputDesktopReadOnly]::GetUserObjectInformation(
            $handle, 2, $name, [uint32]($name.Capacity * 2), [ref]$needed)) {
            throw 'NATIVE_OBJECT_NAME_UNAVAILABLE'
        }
        return $name.ToString()
    }

    $station = ReadNativeName ([M2InputDesktopReadOnly]::GetProcessWindowStation())
    $threadDesktop = ReadNativeName ([M2InputDesktopReadOnly]::GetThreadDesktop(
        [M2InputDesktopReadOnly]::GetCurrentThreadId()))
    $inputDesktop = $null
    $inputDesktopError = $null
    # DESKTOP_READOBJECTS=0x0001. Zero flags and non-inheritable handle;
    # no write/hook/switch rights requested. Close only this opened handle.
    $inputHandle = [M2InputDesktopReadOnly]::OpenInputDesktop(0, $false, 0x0001)
    if ($inputHandle -eq [IntPtr]::Zero) {
        $inputDesktopError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    } else {
        try { $inputDesktop = ReadNativeName $inputHandle }
        finally {
            if (-not [M2InputDesktopReadOnly]::CloseDesktop($inputHandle)) {
                throw 'INPUT_DESKTOP_HANDLE_CLOSE_FAILED'
            }
        }
    }
    $consoleIdNative = [M2InputDesktopReadOnly]::WTSGetActiveConsoleSessionId()
    $consoleSessionId = if ($consoleIdNative -eq [uint32]::MaxValue) { -1 } else { [int]$consoleIdNative }
    $sample = ClassifyInputDesktopSample ([Environment]::UserInteractive) $station $threadDesktop $inputDesktop $sessionId $consoleSessionId
    [pscustomobject]@{
        schemaVersion=1
        readOnly=$true
        observedAtUtc=[DateTime]::UtcNow.ToString('o')
        observerPid=$observer.Id
        observerSessionId=$sessionId
        expectedSessionId=if ($ExpectedSessionId -gt 0) { $ExpectedSessionId } else { $null }
        userInteractive=[Environment]::UserInteractive
        windowStation=$station
        threadDesktop=$threadDesktop
        inputDesktop=$inputDesktop
        inputDesktopWin32Error=$inputDesktopError
        activeConsoleSessionId=if ($consoleSessionId -ge 0) { $consoleSessionId } else { $null }
        sampleStatus=$sample
        sessionLocked='UNKNOWN'
        sessionConnected='UNKNOWN'
        taskSchedulerInteractiveToken='UNKNOWN'
        intervalContinuity='UNKNOWN'
        safeForInput=$false
    } | ConvertTo-Json -Compress -Depth 3
    exit 0
} catch {
    $code = [string]$_.Exception.Message
    if ($code -notmatch '^[A-Z][A-Z_]{2,70}$') { $code = 'OBSERVER_EXCEPTION' }
    [pscustomobject]@{ schemaVersion=1; readOnly=$true; observed=$false; safeForInput=$false; errorCode=$code } |
        ConvertTo-Json -Compress
    exit 2
}
