[CmdletBinding()]
param([string]$Root = 'C:\work', [string]$CredentialPath = '')
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Tunnel-Credential.ps1')
$stateFile = Join-Path $repo '.local\autostart.json'
if (!$CredentialPath -and (Test-Path -LiteralPath $stateFile)) {
    $CredentialPath = (Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json).credentialPath
}
if (!$CredentialPath) { $CredentialPath = Get-TunnelCredentialPath }
$taskName = 'Workbridge MCP'
$script = Join-Path $PSScriptRoot 'Start-BackgroundTunnel.ps1'
$shell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
if (!(Test-Path -LiteralPath $Root -PathType Container)) { throw "Workspace directory does not exist: $Root" }
if ($Root.Contains('"') -or $script.Contains('"') -or $CredentialPath.Contains('"')) { throw 'Paths cannot contain quotes.' }
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and ($existing.Actions.Execute -ne $shell -or $existing.Actions.Arguments -notlike "*`"$script`"*")) {
    throw "A different task named '$taskName' already exists. Inspect it before replacing it."
}
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$action = New-ScheduledTaskAction -Execute $shell -Argument "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -WindowStyle Hidden -File `"$script`" -Root `"$Root`" -CredentialPath `"$CredentialPath`"" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $sid
$trigger.Delay = 'PT20S'
$principal = New-ScheduledTaskPrincipal -UserId $sid -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Workbridge MCP coding/snapshot tunnel; starts silently at user sign-in. Key is protected by Windows DPAPI.' -Force | Out-Null
New-Item -ItemType Directory -Path (Split-Path -Parent $stateFile) -Force | Out-Null
[pscustomobject]@{ taskName = $taskName; root = $Root; credentialPath = $CredentialPath } | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8
Write-Host "Installed '$taskName' for this Windows user's sign-in. No administrator rights or Windows password required."
Write-Host "Logs: $(Join-Path $repo '.local\logs\autostart.log')"
