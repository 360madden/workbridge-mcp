# Synthetic, PID-targeted NotifyIcon callback test.
# It does not click the shared taskbar, move the mouse, or modify Workbridge.
[CmdletBinding()]
param([int]$TimeoutSeconds = 20)
$ErrorActionPreference = 'Stop'
if ($TimeoutSeconds -lt 5 -or $TimeoutSeconds -gt 60) { throw 'TimeoutSeconds must be 5..60.' }
$desktop = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $desktop 'Workbridge.ControlCenter\bin\Debug\net10.0-windows\Workbridge.ControlCenter.exe'
if (!(Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'Build Workbridge Control Center before this test.' }
if (@(Get-Process -Name 'Workbridge.ControlCenter' -ErrorAction SilentlyContinue).Count -ne 0) {
    throw 'Another Control Center instance is running; test refused.'
}
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class WbTrayCallbackTest {
    public delegate bool WindowCallback(IntPtr hwnd, IntPtr userData);
    [DllImport("user32.dll")]
    public static extern bool EnumThreadWindows(uint threadId, WindowCallback callback, IntPtr userData);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)]
    public static extern int GetClassName(IntPtr hwnd, StringBuilder name, int capacity);
    [DllImport("user32.dll", SetLastError=true)]
    public static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wparam, IntPtr lparam);
    [DllImport("user32.dll", SetLastError=true)]
    public static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint message, IntPtr wparam,
        IntPtr lparam, uint flags, uint timeoutMs, out IntPtr result);
    public static IntPtr[] Enumerate(uint threadId) {
        var windows = new List<IntPtr>();
        EnumThreadWindows(threadId, (hwnd, _) => { windows.Add(hwnd); return true; }, IntPtr.Zero);
        return windows.ToArray();
    }
    public static string WindowClass(IntPtr hwnd) {
        var name = new StringBuilder(200);
        GetClassName(hwnd, name, name.Capacity);
        return name.ToString();
    }
}
'@
function Own-Windows([System.Diagnostics.Process]$process) {
    $process.Refresh()
    if ($process.HasExited) { return @() }
    $handles = @()
    foreach ($thread in $process.Threads) {
        foreach ($hwnd in [WbTrayCallbackTest]::Enumerate([uint32]$thread.Id)) {
            $handles += $hwnd
        }
    }
    return $handles
}
$owner = $null
$receipt = [ordered]@{
    schemaVersion = 1
    syntheticEvent = $true
    targetRestrictedToOwnPid = $true
    initiallyHidden = $false
    doubleClickRestored = $false
    closeToTrayWorked = $false
    menuExitFound = $false
    menuExitInvoked = $false
    guiExitedViaMenu = $false
    cleanedUp = $false
}
try {
    $owner = Start-Process -FilePath $exe -ArgumentList '--tray' -PassThru
    Start-Sleep -Milliseconds 800
    $owner.Refresh()
    if ($owner.HasExited) { throw 'Owned GUI exited before testing.' }
    $receipt.initiallyHidden = $owner.MainWindowHandle -eq [IntPtr]::Zero

    $notify = [IntPtr]::Zero
    $until = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $until -and $notify -eq [IntPtr]::Zero) {
        foreach ($hwnd in (Own-Windows $owner)) {
            if ([WbTrayCallbackTest]::WindowClass($hwnd) -like 'WindowsForms10.Window.*') {
                $notify = $hwnd
                break
            }
        }
        if ($notify -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 150 }
    }
    if ($notify -eq [IntPtr]::Zero) { throw 'Owned WinForms notification window unavailable.' }

    # WinForms notification callback: WM_USER + 1024, WM_LBUTTONDBLCLK.
    if (![WbTrayCallbackTest]::PostMessage($notify, 0x800, [IntPtr]1, [IntPtr]0x203)) {
        throw 'Could not post synthetic double-click to owned window.'
    }
    $main = [IntPtr]::Zero
    while ([DateTime]::UtcNow -lt $until) {
        Start-Sleep -Milliseconds 120
        $owner.Refresh()
        if ($owner.HasExited) { throw 'Owned GUI exited during restore.' }
        $main = $owner.MainWindowHandle
        if ($main -ne [IntPtr]::Zero) { break }
    }
    $receipt.doubleClickRestored = $main -ne [IntPtr]::Zero
    if (-not $receipt.doubleClickRestored) { throw 'Synthetic double-click did not restore.' }

    $response = [IntPtr]::Zero
    $sent = [WbTrayCallbackTest]::SendMessageTimeout($main, 0x10, [IntPtr]::Zero,
        [IntPtr]::Zero, 2, 2000, [ref]$response)
    if ($sent -eq [IntPtr]::Zero) { throw 'Targeted WM_CLOSE failed.' }
    Start-Sleep -Milliseconds 400
    $owner.Refresh()
    $receipt.closeToTrayWorked = -not $owner.HasExited -and $owner.MainWindowHandle -eq [IntPtr]::Zero
    if (-not $receipt.closeToTrayWorked) { throw 'Window did not hide without exiting.' }

    # WM_RBUTTONUP is sent only to the WinForms hidden notification window.
    if (![WbTrayCallbackTest]::PostMessage($notify, 0x800, [IntPtr]1, [IntPtr]0x205)) {
        throw 'Could not post synthetic context-menu event.'
    }
    $nameCondition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::NameProperty, 'Exit Control Center')
    $menu = $null
    while ([DateTime]::UtcNow -lt $until -and $null -eq $menu) {
        Start-Sleep -Milliseconds 120
        foreach ($hwnd in (Own-Windows $owner)) {
            try {
                $root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
                if ($null -eq $root) { continue }
                $candidate = $root.FindFirst(
                    [System.Windows.Automation.TreeScope]::Descendants, $nameCondition)
                if ($null -ne $candidate) { $menu = $candidate; break }
            }
            catch { }
        }
    }
    $receipt.menuExitFound = $null -ne $menu
    if (-not $receipt.menuExitFound) { throw 'The owned notification menu was not exposed to UIA.' }
    $pattern = [System.Windows.Automation.InvokePattern]$menu.GetCurrentPattern(
        [System.Windows.Automation.InvokePattern]::Pattern)
    $pattern.Invoke()
    $receipt.menuExitInvoked = $true

    $untilExit = [DateTime]::UtcNow.AddSeconds(5)
    while ([DateTime]::UtcNow -lt $untilExit) {
        Start-Sleep -Milliseconds 100
        $owner.Refresh()
        if ($owner.HasExited) { $receipt.guiExitedViaMenu = $true; break }
    }
    if (-not $receipt.guiExitedViaMenu) { throw 'Menu Exit did not terminate GUI.' }
}
catch {
    $receipt.error = $_.Exception.Message
}
finally {
    if ($null -ne $owner) {
        try {
            $owner.Refresh()
            if (-not $owner.HasExited) { Stop-Process -Id $owner.Id -ErrorAction Stop }
        }
        catch { $receipt.cleanupError = $_.Exception.Message }
    }
    Start-Sleep -Milliseconds 250
    $receipt.cleanedUp =
        @(Get-Process -Name 'Workbridge.ControlCenter' -ErrorAction SilentlyContinue).Count -eq 0
    $receipt | ConvertTo-Json -Compress
}
if ($receipt.initiallyHidden -and $receipt.doubleClickRestored -and
    $receipt.closeToTrayWorked -and $receipt.menuExitFound -and
    $receipt.menuExitInvoked -and $receipt.guiExitedViaMenu -and $receipt.cleanedUp) {
    exit 0
}
exit 2
