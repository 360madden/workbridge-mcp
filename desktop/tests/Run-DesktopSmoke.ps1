# Repeatable, isolated smoke test for the Workbridge WPF desktop shell.
# Does not alter Workbridge, its scheduled task, or unrelated windows.
[CmdletBinding()]
param([string]$ExpectedJobId = '', [int]$TimeoutSeconds = 30)
$ErrorActionPreference = 'Stop'
if ($TimeoutSeconds -lt 5 -or $TimeoutSeconds -gt 90) {
    throw 'TimeoutSeconds must be between 5 and 90.'
}
$desktop = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $desktop 'Workbridge.ControlCenter\bin\Debug\net10.0-windows\Workbridge.ControlCenter.exe'
if (!(Test-Path -LiteralPath $exe -PathType Leaf)) { throw "Build the desktop app first: $exe" }
if (@(Get-Process -Name 'Workbridge.ControlCenter' -ErrorAction SilentlyContinue).Count -gt 0) {
    throw 'An existing Workbridge Control Center is running; smoke test refused.'
}
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class WorkbridgeDesktopSmokeWin32 {
    [DllImport("user32.dll", SetLastError=true)]
    public static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint msg, IntPtr wparam,
        IntPtr lparam, uint flags, uint timeoutMs, out IntPtr result);
}
'@

function Get-OwnWindow([System.Diagnostics.Process]$process) {
    $process.Refresh()
    if ($process.HasExited) { throw 'Owned Control Center exited unexpectedly.' }
    return $process.MainWindowHandle
}
function Get-UIElement([IntPtr]$hwnd, [string]$id) {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
    $condition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::AutomationIdProperty, $id)
    return $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
}
$owner = $null
$receipt = [ordered]@{
    schemaVersion = 1
    test = 'Workbridge WPF desktop isolated smoke'
    liveStatus = $false
    closeToTray = $false
    singleInstanceRestore = $false
    selectedJobDetails = 'not_requested'
    cleanedUp = $false
}
try {
    $owner = Start-Process -FilePath $exe -PassThru
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    $hwnd = [IntPtr]::Zero
    while ([DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 200
        $hwnd = Get-OwnWindow $owner
        if ($hwnd -ne [IntPtr]::Zero) { break }
    }
    if ($hwnd -eq [IntPtr]::Zero) { throw 'The WPF window did not become visible.' }

    while ([DateTime]::UtcNow -lt $deadline) {
        $version = Get-UIElement $hwnd 'VersionText'
        $connection = Get-UIElement $hwnd 'ConnectionText'
        if ($null -ne $version -and $null -ne $connection -and
            $version.Current.Name -match '^Version: [0-9]' -and
            $connection.Current.Name -like 'Connected*') {
            $receipt.liveStatus = $true
            $receipt.versionLabel = $version.Current.Name
            break
        }
        Start-Sleep -Milliseconds 250
    }
    if (-not $receipt.liveStatus) { throw 'Live authenticated status was not displayed.' }

    if ($ExpectedJobId) {
        if ($ExpectedJobId -notmatch '^[A-Za-z0-9_-]{1,100}$') { throw 'Invalid ExpectedJobId.' }
        $receipt.selectedJobDetails = 'waiting'
        $targetItem = $null
        while ([DateTime]::UtcNow -lt $deadline) {
            $list = Get-UIElement $hwnd 'JobList'
            if ($null -ne $list) {
                $items = $list.FindAll([System.Windows.Automation.TreeScope]::Children,
                    [System.Windows.Automation.Condition]::TrueCondition)
                foreach ($candidate in $items) {
                    if ($candidate.Current.Name.EndsWith(" | $ExpectedJobId")) {
                        $targetItem = $candidate
                        break
                    }
                }
            }
            if ($null -ne $targetItem) { break }
            Start-Sleep -Milliseconds 200
        }
        if ($null -eq $targetItem) { throw "Expected running job not found: $ExpectedJobId" }
        $selection = [System.Windows.Automation.SelectionItemPattern]$targetItem.GetCurrentPattern(
            [System.Windows.Automation.SelectionItemPattern]::Pattern)
        $selection.Select()
        $button = Get-UIElement $hwnd 'DetailsButton'
        if ($null -eq $button) { throw 'Job details button was missing.' }
        $invoke = [System.Windows.Automation.InvokePattern]$button.GetCurrentPattern(
            [System.Windows.Automation.InvokePattern]::Pattern)
        $invoke.Invoke()
        while ([DateTime]::UtcNow -lt $deadline) {
            $field = Get-UIElement $hwnd 'DetailsText'
            if ($null -ne $field) {
                $value = [System.Windows.Automation.ValuePattern]$field.GetCurrentPattern(
                    [System.Windows.Automation.ValuePattern]::Pattern)
                if ($value.Current.Value.StartsWith("Job: $ExpectedJobId")) {
                    $receipt.selectedJobDetails = 'passed'
                    break
                }
            }
            Start-Sleep -Milliseconds 200
        }
        if ($receipt.selectedJobDetails -ne 'passed') {
            throw 'Selected job details did not match the requested test job.'
        }
    }

    $sent = [IntPtr]::Zero
    $ok = [WorkbridgeDesktopSmokeWin32]::SendMessageTimeout(
        $hwnd, 0x10, [IntPtr]::Zero, [IntPtr]::Zero, 2, 2000, [ref]$sent)
    if ($ok -eq [IntPtr]::Zero) { throw 'Targeted WM_CLOSE failed.' }
    Start-Sleep -Milliseconds 650
    $hidden = (Get-OwnWindow $owner) -eq [IntPtr]::Zero
    if (-not $hidden) { throw 'The window did not hide while its process stayed alive.' }
    $receipt.closeToTray = $true

    $second = Start-Process -FilePath $exe -PassThru -Wait
    if ($second.ExitCode -ne 0) { throw 'Second instance returned an error.' }
    $restored = [IntPtr]::Zero
    $restoreDeadline = [DateTime]::UtcNow.AddSeconds(6)
    while ([DateTime]::UtcNow -lt $restoreDeadline) {
        $restored = Get-OwnWindow $owner
        if ($restored -ne [IntPtr]::Zero) { break }
        Start-Sleep -Milliseconds 150
    }
    $count = @(Get-Process -Name 'Workbridge.ControlCenter' -ErrorAction SilentlyContinue).Count
    if ($restored -eq [IntPtr]::Zero -or $count -ne 1) {
        throw "Second launch did not restore exactly one instance (count=$count)."
    }
    $receipt.singleInstanceRestore = $true
}
finally {
    if ($null -ne $owner) {
        Stop-Process -Id $owner.Id -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 500
    $receipt.cleanedUp = (@(Get-Process -Name 'Workbridge.ControlCenter' -ErrorAction SilentlyContinue).Count -eq 0)
    $receipt | ConvertTo-Json -Compress
}
if (-not ($receipt.liveStatus -and $receipt.closeToTray -and
    $receipt.singleInstanceRestore -and $receipt.cleanedUp -and
    $receipt.selectedJobDetails -notin @('waiting'))) {
    exit 2
}
