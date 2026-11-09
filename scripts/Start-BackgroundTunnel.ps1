[CmdletBinding()]
param([string]$Root = 'C:\work', [string]$CredentialPath = '')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$PSDefaultParameterValues['Out-File:Encoding'] = 'utf8'
$repo = Split-Path -Parent $PSScriptRoot
$logDirectory = Join-Path $repo '.local\logs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$log = Join-Path $logDirectory 'autostart.log'
# Retain one previous log once it exceeds 5 MiB; rotate only at startup.
if ((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -gt 5MB) {
    Move-Item -LiteralPath $log -Destination "$log.previous" -Force
}
# Task Scheduler can retain an older environment after developer tools are installed.
# Refresh only this dedicated background process; interactive Start-Tunnel is unchanged.
function Read-WBBackgroundEnvironmentValue {
    param(
        [ValidateSet('Path', 'DOTNET_ROOT')][string]$Name,
        [ValidateSet('Machine', 'User')][string]$Scope
    )
    $hive = [Microsoft.Win32.Registry]::CurrentUser
    $keyPath = 'Environment'
    if ($Scope -eq 'Machine') {
        $hive = [Microsoft.Win32.Registry]::LocalMachine
        $keyPath = 'SYSTEM\CurrentControlSet\Control\Session Manager\Environment'
    }
    $key = $hive.OpenSubKey($keyPath, $false)
    try {
        if ($null -eq $key) { return $null }
        $value = $key.GetValue($Name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        if ($null -ne $value -and $value -isnot [string]) { throw "BACKGROUND_ENVIRONMENT_INVALID: registered $Scope $Name must be a string." }
        return $value
    } finally { if ($null -ne $key) { $key.Dispose() } }
}
function Set-WBBackgroundDeveloperEnvironment {
    param(
        [AllowNull()][AllowEmptyString()][string]$MachinePath = (Read-WBBackgroundEnvironmentValue -Name Path -Scope Machine),
        [AllowNull()][AllowEmptyString()][string]$UserPath = (Read-WBBackgroundEnvironmentValue -Name Path -Scope User),
        [AllowNull()][AllowEmptyString()][string]$MachineDotNetRoot = (Read-WBBackgroundEnvironmentValue -Name DOTNET_ROOT -Scope Machine),
        [AllowNull()][AllowEmptyString()][string]$UserDotNetRoot = (Read-WBBackgroundEnvironmentValue -Name DOTNET_ROOT -Scope User)
    )
    $registeredPaths = @(@($MachinePath, $UserPath) | Where-Object { ![string]::IsNullOrWhiteSpace($_) })
    if ($registeredPaths.Count -eq 0) { throw 'BACKGROUND_ENVIRONMENT_MISSING: no registered machine or user PATH.' }
    $registeredDotNetRoot = $MachineDotNetRoot
    if (![string]::IsNullOrWhiteSpace($UserDotNetRoot)) { $registeredDotNetRoot = $UserDotNetRoot }
    $freshDotNetRoot = $null
    if (![string]::IsNullOrWhiteSpace($registeredDotNetRoot)) {
        $freshDotNetRoot = [Environment]::ExpandEnvironmentVariables($registeredDotNetRoot)
    }
    $env:DOTNET_ROOT = $freshDotNetRoot
    # Expand PATH only after refreshing variables it can reference.
    $env:Path = [Environment]::ExpandEnvironmentVariables(($registeredPaths -join ';'))
}
try {
    Set-WBBackgroundDeveloperEnvironment
    Add-Type -Path (Join-Path $PSScriptRoot 'Tunnel-ProcessLifetime.cs')
    [Workbridge.ProcessLifetime]::Attach()
    "$(Get-Date -Format o) Workbridge background start" | Add-Content -LiteralPath $log -Encoding UTF8
    & (Join-Path $PSScriptRoot 'Start-Tunnel.ps1') -Root $Root -NonInteractive -CredentialPath $CredentialPath *>> $log
    "$(Get-Date -Format o) Tunnel stopped unexpectedly" | Add-Content -LiteralPath $log -Encoding UTF8
} catch {
    "$(Get-Date -Format o) $($_.Exception.Message)" | Add-Content -LiteralPath $log -Encoding UTF8
}
# A long-running task ending is unexpected; let Task Scheduler retry it.
exit 1
