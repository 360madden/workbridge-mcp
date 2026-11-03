# Manual M1 Explorer notification-area acceptance: observes physical user actions.
# No mouse/keyboard synthesis, global focus changes, or Workbridge service updates.
[CmdletBinding()]
param([int]$TimeoutSeconds = 75, [switch]$ValidateOnly)
$ErrorActionPreference = 'Stop'
if ($TimeoutSeconds -lt 20 -or $TimeoutSeconds -gt 180) {
    throw 'TimeoutSeconds must be between 20 and 180.'
}
$desktop = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $desktop 'Workbridge.ControlCenter\bin\Debug\net10.0-windows\Workbridge.ControlCenter.exe'
if (!(Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'Build the WPF app first.' }
if (@(Get-Process -Name Workbridge.ControlCenter -ErrorAction SilentlyContinue).Count -ne 0) {
    throw 'Control Center is already running; refusing to interfere.'
}
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class WbPhysicalTrayObservation {
  public delegate bool WindowCallback(IntPtr hwnd, IntPtr data);
  [DllImport("user32.dll")]
  public static extern bool EnumThreadWindows(uint tid, WindowCallback callback, IntPtr data);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)]
  public static extern int GetClassName(IntPtr hwnd, StringBuilder cls, int capacity);
  [DllImport("shell32.dll")]
  public static extern int Shell_NotifyIconGetRect(ref Identifier id, out Rectangle rect);
  [StructLayout(LayoutKind.Sequential)]
  public struct Identifier { public uint cbSize; public IntPtr hWnd; public uint uID; public Guid guidItem; }
  [StructLayout(LayoutKind.Sequential)]
  public struct Rectangle { public int Left, Top, Right, Bottom; }
  public static IntPtr FindNotificationWindow(uint tid) {
      IntPtr found = IntPtr.Zero;
      EnumThreadWindows(tid, (hwnd, data) => {
          var name = new StringBuilder(200);
          GetClassName(hwnd, name, name.Capacity);
          if (name.ToString().StartsWith("WindowsForms10.Window.")) {
              found = hwnd;
              return false;
          }
          return true;
      }, IntPtr.Zero);
      return found;
  }
}
'@
$p = $null
$result = [ordered]@{
    schemaVersion = 1
    test = 'Physical Windows tray acceptance'
    validateOnly = [bool]$ValidateOnly
    iconRegistered = $false
    restoredByActualUserAction = $false
    exitedByActualUserMenuAction = $false
    cleanedUp = $false
}
try {
    $p = Start-Process -FilePath $exe -ArgumentList '--tray' -PassThru
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    $notification = [IntPtr]::Zero
    while ([DateTime]::UtcNow -lt $deadline -and $notification -eq [IntPtr]::Zero) {
        Start-Sleep -Milliseconds 150
        $p.Refresh()
        if ($p.HasExited) { throw 'Test owner exited before icon registration.' }
        foreach ($thread in $p.Threads) {
            $candidate = [WbPhysicalTrayObservation]::FindNotificationWindow([uint32]$thread.Id)
            if ($candidate -ne [IntPtr]::Zero) { $notification = $candidate; break }
        }
    }
    if ($notification -eq [IntPtr]::Zero) { throw 'Owned notification window missing.' }
    for ($attempt = 0; $attempt -lt 12 -and -not $result.iconRegistered; $attempt++) {
        for ($id = 0; $id -lt 9; $id++) {
            $identifier = New-Object WbPhysicalTrayObservation+Identifier
            $identifier.cbSize = [uint32][Runtime.InteropServices.Marshal]::SizeOf(
                [type]'WbPhysicalTrayObservation+Identifier')
            $identifier.hWnd = $notification
            $identifier.uID = [uint32]$id
            $identifier.guidItem = [Guid]::Empty
            $rect = New-Object WbPhysicalTrayObservation+Rectangle
            if ([WbPhysicalTrayObservation]::Shell_NotifyIconGetRect(
                [ref]$identifier, [ref]$rect) -eq 0) {
                $result.iconRegistered = $true
                $result.iconId = $id
                break
            }
        }
        if (-not $result.iconRegistered) { Start-Sleep -Milliseconds 150 }
    }
    if (-not $result.iconRegistered) { throw 'Explorer did not register the icon.' }
    if (-not $ValidateOnly) {
        Write-Host 'TASK 1: Double-click the Workbridge icon in the Windows notification area (or Show hidden icons).' 
        while ([DateTime]::UtcNow -lt $deadline) {
            Start-Sleep -Milliseconds 200
            $p.Refresh()
            if ($p.HasExited) { throw 'Test owner exited before restore.' }
            if ($p.MainWindowHandle -ne [IntPtr]::Zero) {
                $result.restoredByActualUserAction = $true
                break
            }
        }
        if (-not $result.restoredByActualUserAction) { throw 'No real tray restoration observed.' }
        Write-Host 'TASK 2: Right-click the Workbridge icon and choose Exit Control Center.'
        while ([DateTime]::UtcNow -lt $deadline) {
            Start-Sleep -Milliseconds 200
            $p.Refresh()
            if ($p.HasExited) {
                $result.exitedByActualUserMenuAction = $true
                break
            }
        }
        if (-not $result.exitedByActualUserMenuAction) { throw 'No actual tray Exit observed.' }
    }
}
catch {
    $result.error = $_.Exception.Message
}
finally {
    if ($null -ne $p) {
        try {
            $p.Refresh()
            if (-not $p.HasExited) { Stop-Process -Id $p.Id -ErrorAction Stop }
        }
        catch { $result.cleanupError = $_.Exception.Message }
    }
    Start-Sleep -Milliseconds 250
    $result.cleanedUp = @(Get-Process -Name Workbridge.ControlCenter -ErrorAction SilentlyContinue).Count -eq 0
    $result | ConvertTo-Json -Compress
}
if ($result.iconRegistered -and $result.cleanedUp -and
    ($ValidateOnly -or ($result.restoredByActualUserAction -and $result.exitedByActualUserMenuAction))) {
    exit 0
}
exit 2
