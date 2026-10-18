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
try {
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
