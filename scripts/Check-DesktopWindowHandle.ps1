[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateRange(1, [long]::MaxValue)][long]$ParentHwnd,
    [Parameter(Mandatory)][ValidateRange(1, [long]::MaxValue)][long]$ReportedHwnd,
    [Parameter(Mandatory)][ValidateRange(1, [int]::MaxValue)][int]$ExpectedPid
)
$ErrorActionPreference = 'Stop'

# Read-only Win32 identity check. The HWND returned by WinApp send-keys may be the
# focused child control, not the top-level window passed to --window.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class WorkbridgeWindowHandleIdentity {
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
}
'@ -ErrorAction Stop

$parent = [IntPtr]$ParentHwnd
$reported = [IntPtr]$ReportedHwnd
$parentExists = [WorkbridgeWindowHandleIdentity]::IsWindow($parent)
$reportedExists = [WorkbridgeWindowHandleIdentity]::IsWindow($reported)
[uint32]$parentPid = 0
[uint32]$reportedPid = 0
if ($parentExists) { [void][WorkbridgeWindowHandleIdentity]::GetWindowThreadProcessId($parent, [ref]$parentPid) }
if ($reportedExists) { [void][WorkbridgeWindowHandleIdentity]::GetWindowThreadProcessId($reported, [ref]$reportedPid) }
$ancestor = if ($reportedExists) {
    [WorkbridgeWindowHandleIdentity]::GetAncestor($reported, 2).ToInt64()
} else { 0 }
$valid = $parentExists -and $reportedExists -and
    ($ancestor -eq $ParentHwnd) -and
    ($parentPid -eq $ExpectedPid) -and ($reportedPid -eq $ExpectedPid)
[ordered]@{
    schemaVersion = 1
    parentHwnd = $ParentHwnd
    reportedHwnd = $ReportedHwnd
    ancestorHwnd = $ancestor
    parentPid = [int]$parentPid
    reportedPid = [int]$reportedPid
    belongsToTarget = [bool]$valid
} | ConvertTo-Json -Compress
