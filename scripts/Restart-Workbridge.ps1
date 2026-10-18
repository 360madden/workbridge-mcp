[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$taskName = 'Workbridge MCP'
$task = Get-ScheduledTask -TaskName $taskName
if ($task.State -ne 'Ready') {
    Stop-ScheduledTask -TaskName $taskName
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    do {
        $task = Get-ScheduledTask -TaskName $taskName
        if ($task.State -eq 'Ready') { break }
        if ([DateTime]::UtcNow -ge $deadline) { throw 'Workbridge did not stop within 20 seconds. Inspect Task Scheduler and the local log before retrying.' }
        Start-Sleep -Milliseconds 250
    } while ($true)
}
# IgnoreNew is intentional, so never issue Start while the old instance is stopping.
$started = [DateTime]::UtcNow
Start-ScheduledTask -TaskName $taskName
$healthFile = Join-Path $repo '.local\health-url.txt'
$deadline = $started.AddSeconds(30)
do {
    try {
        if ((Get-Item -LiteralPath $healthFile).LastWriteTimeUtc -ge $started.AddSeconds(-1)) {
            $url = (Get-Content -LiteralPath $healthFile -Raw).Trim()
            if ($url -notmatch '^http://127\.0\.0\.1:[0-9]+$') { throw 'Unexpected health URL.' }
            $health = Invoke-RestMethod "$url/health?details=true" -TimeoutSec 2
            if ($health.ready) {
                Write-Host 'Workbridge restarted. The tunnel is ready; its MCP child may initialize on the first client request.'
                & (Join-Path $PSScriptRoot 'Show-Status.ps1')
                return
            }
        }
    } catch { # The new URL/HTTP listener may not be available yet.
    }
    if ([DateTime]::UtcNow -ge $deadline) { throw 'Task started but tunnel readiness was not confirmed within 30 seconds. Run scripts\Show-Status.ps1 and inspect .local\logs\autostart.log.' }
    Start-Sleep -Milliseconds 500
} while ($true)
