#requires -Version 5.1
<#
.SYNOPSIS
Preview or apply verified developer-tool paths for the current Windows user.
.DESCRIPTION
Only Path, DOTNET_ROOT and WORKBRIDGE_WINAPP_EXE are changed. Existing unrelated
PATH entries and registry value types are preserved. Apply requires an explicit
switch and writes a before/after backup first. No service or application restarts.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)][string]$ExpectedComputerName,
    [Parameter(Mandatory = $true)][string]$PythonRoot,
    [Parameter(Mandatory = $true)][string]$DotNetRoot,
    [Parameter(Mandatory = $true)][string]$WinAppExe,
    [string]$PythonLauncherRoot = '',
    [string]$BackupDirectory = (Join-Path (Split-Path -Parent $PSScriptRoot) '.local\environment-backups'),
    [switch]$Apply
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'Windows is required.' }
if ([Environment]::MachineName -ine $ExpectedComputerName) { throw 'Machine identity mismatch; no changes made.' }

function Get-PathIdentity([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) { return '' }
    $expanded = [Environment]::ExpandEnvironmentVariables($Value.Trim().Trim('"'))
    try { return [IO.Path]::GetFullPath($expanded).TrimEnd('\').ToUpperInvariant() }
    catch { return $expanded.TrimEnd('\').ToUpperInvariant() }
}
function Read-RegistryValue($Key, [string]$Name) {
    $exists = $Key.GetValueNames() -contains $Name
    return [ordered]@{
        name = $Name
        exists = $exists
        kind = $(if ($exists) { [string]$Key.GetValueKind($Name) } else { $null })
        value = $(if ($exists) { $Key.GetValue($Name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } else { $null })
    }
}
$PythonRoot = [IO.Path]::GetFullPath($PythonRoot).TrimEnd('\')
$DotNetRoot = [IO.Path]::GetFullPath($DotNetRoot).TrimEnd('\')
$WinAppExe = [IO.Path]::GetFullPath($WinAppExe)
$pythonScripts = Join-Path $PythonRoot 'Scripts'
$launcherPaths = @()
if (-not [string]::IsNullOrWhiteSpace($PythonLauncherRoot)) {
    $PythonLauncherRoot = [IO.Path]::GetFullPath($PythonLauncherRoot).TrimEnd('\')
    if (-not (Test-Path -LiteralPath (Join-Path $PythonLauncherRoot 'py.exe') -PathType Leaf)) { throw 'Python launcher executable missing.' }
    $launcherPaths = @($PythonLauncherRoot)
}
foreach ($file in @((Join-Path $PythonRoot 'python.exe'), (Join-Path $pythonScripts 'pip.exe'), (Join-Path $DotNetRoot 'dotnet.exe'), $WinAppExe)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Required executable missing: $file" }
}
$preferred = @($PythonRoot, $pythonScripts) + $launcherPaths + @($DotNetRoot, (Split-Path -Parent $WinAppExe))
$preferredIds = @($preferred | ForEach-Object { Get-PathIdentity $_ })
$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $false)
if ($null -eq $key) { throw 'Current-user Environment registry key is unavailable.' }
try {
    $before = @('Path', 'DOTNET_ROOT', 'WORKBRIDGE_WINAPP_EXE') | ForEach-Object { Read-RegistryValue $key $_ }
} finally { $key.Dispose() }
foreach ($item in $before) {
    if ($item.exists -and $item.kind -notin @('String', 'ExpandString')) { throw "Unsupported registry type for $($item.name); no changes made." }
}
$existing = if ($before[0].exists -and $before[0].value.Length -gt 0) { @($before[0].value -split ';') } else { @() }
# Remove only old copies of the explicitly managed paths. Preserve all other entries.
$remaining = @($existing | Where-Object { (Get-PathIdentity $_) -notin $preferredIds })
$desired = [ordered]@{
    Path = (@($preferred) + @($remaining)) -join ';'
    DOTNET_ROOT = $DotNetRoot
    WORKBRIDGE_WINAPP_EXE = $WinAppExe
}
if ($desired.Path.Length -gt 32766) { throw 'Resulting user PATH exceeds the Windows environment limit.' }
$changes = @($before | Where-Object { -not $_.exists -or $_.value -cne $desired[$_.name] })
$report = [ordered]@{
    schemaVersion = 1
    machine = [Environment]::MachineName
    mode = 'preview'
    changedNames = @($changes | ForEach-Object { $_.name })
    preferredPaths = $preferred
    backup = $null
    notification = 'not-sent'
    restartRequired = $false
    existingProcessesKeepInheritedEnvironment = $true
}
if ($Apply -and $changes.Count -gt 0 -and $PSCmdlet.ShouldProcess('HKCU\Environment', 'Back up and configure developer tool paths')) {
    $BackupDirectory = [IO.Path]::GetFullPath($BackupDirectory)
    [IO.Directory]::CreateDirectory($BackupDirectory) | Out-Null
    $backupPath = Join-Path $BackupDirectory ("developer-paths-{0}-{1}.json" -f [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ'), [Guid]::NewGuid().ToString('N').Substring(0, 8))
    $backup = [ordered]@{ schemaVersion = 1; machine = [Environment]::MachineName; createdUtc = [DateTime]::UtcNow.ToString('o'); before = $before; after = $desired }
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($backup | ConvertTo-Json -Depth 8))
    $stream = [IO.File]::Open($backupPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
    $report.backup = $backupPath
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
    $written = [Collections.Generic.List[object]]::new()
    try {
        # Refuse stale plans instead of overwriting a concurrent environment edit.
        foreach ($item in $before) {
            $current = Read-RegistryValue $key $item.name
            if ($current.exists -ne $item.exists -or $current.kind -cne $item.kind -or $current.value -cne $item.value) { throw "Environment changed concurrently: $($item.name)" }
        }
        foreach ($item in $changes) {
            $kind = if ($item.exists) { [Microsoft.Win32.RegistryValueKind]([Enum]::Parse([Microsoft.Win32.RegistryValueKind], $item.kind)) } else { [Microsoft.Win32.RegistryValueKind]::String }
            $key.SetValue($item.name, [string]$desired[$item.name], $kind)
            $written.Add($item)
        }
        $key.Flush()
        foreach ($item in $changes) {
            $current = Read-RegistryValue $key $item.name
            $expectedKind = if ($item.exists) { $item.kind } else { 'String' }
            if (-not $current.exists -or $current.kind -cne $expectedKind -or $current.value -cne $desired[$item.name]) { throw "Environment verification failed: $($item.name)" }
        }
    } catch {
        $failure = $_
        foreach ($item in $written) {
            # Never roll back over a newer value written by another application.
            $current = Read-RegistryValue $key $item.name
            $expectedKind = if ($item.exists) { $item.kind } else { 'String' }
            if ($current.exists -and $current.kind -ceq $expectedKind -and $current.value -ceq $desired[$item.name]) {
                if ($item.exists) { $key.SetValue($item.name, $item.value, [Microsoft.Win32.RegistryValueKind]([Enum]::Parse([Microsoft.Win32.RegistryValueKind], $item.kind))) }
                else { $key.DeleteValue($item.name, $false) }
            }
        }
        throw "Configuration failed; prior values restored where safe. Backup: $backupPath. $failure"
    } finally { if ($null -ne $key) { $key.Dispose() } }
    $report.mode = 'applied'
    # Notify Explorer/new applications. Existing shells and Workbridge still keep their own environment.
    try {
        if (-not ('Workbridge.DeveloperEnvironmentNotify' -as [type])) {
            Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace Workbridge {
    public static class DeveloperEnvironmentNotify {
        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern IntPtr SendMessageTimeout(IntPtr window, uint message, UIntPtr wParam, string text, uint flags, uint timeout, out UIntPtr result);
    }
}
'@
        }
        $result = [UIntPtr]::Zero
        $sent = [Workbridge.DeveloperEnvironmentNotify]::SendMessageTimeout([IntPtr]0xffff, 0x001a, [UIntPtr]::Zero, 'Environment', 2, 2000, [ref]$result)
        $report.notification = if ($sent -ne [IntPtr]::Zero) { 'sent' } else { 'timed-out-or-failed' }
    } catch { $report.notification = 'failed' }
} elseif ($Apply -and $changes.Count -eq 0) {
    $report.mode = 'unchanged'
}
$report | ConvertTo-Json -Depth 6
