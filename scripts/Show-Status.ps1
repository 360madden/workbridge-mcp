[CmdletBinding()]
param([switch]$Pause)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
try {
    $task = Get-ScheduledTask -TaskName 'Workbridge MCP' -ErrorAction SilentlyContinue
    Write-Host "Workbridge task: $(if ($task) { $task.State } else { 'Not installed' })"
    $healthFile = Join-Path $repo '.local\health-url.txt'
    $url = (Get-Content -LiteralPath $healthFile -Raw).Trim()
    if ($url -notmatch '^http://127\.0\.0\.1:[0-9]+$') { throw 'Unexpected health URL.' }
    $health = Invoke-RestMethod "$url/health?details=true" -TimeoutSec 5
    Write-Host "Tunnel ready: $($health.ready)"
    $serverVersion = $health.components.mcp.details.initialize.server_version
    Write-Host "Server version: $(if ($serverVersion) { $serverVersion } else { 'Not initialized yet; waiting for the first client request' })"
    $catalog = $health.components.mcp.details.tools_list
    Write-Host "Discovered tools: $(if ($catalog.ok) { $catalog.retained_count } else { 'Not requested this run; ChatGPT may use its saved catalog' })"
    Write-Host "Polling failures: $($health.components.'control-plane'.details.consecutive_failures)"
    Write-Host "Dispatcher failures: $($health.components.dispatcher.details.failures)"
    Write-Host "Local admin UI: $url/ui"
    Write-Host "Log: $(Join-Path $repo '.local\logs\autostart.log')"
} catch {
    Write-Host "Health check: $($_.Exception.Message)"
    Write-Host "To start: Start-ScheduledTask -TaskName 'Workbridge MCP'"
    Write-Host "Log: $(Join-Path $repo '.local\logs\autostart.log')"
}
if ($Pause) { Read-Host 'Press Enter to close' | Out-Null }
