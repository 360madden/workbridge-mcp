[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$healthFile = Join-Path $repo '.local\health-url.txt'
if (!(Test-Path -LiteralPath $healthFile)) { throw 'Start the tunnel first. Health URL is written after the listener starts.' }
$url = (Get-Content -LiteralPath $healthFile -Raw).Trim()
if ($url -notmatch '^http://127\.0\.0\.1:[0-9]+$') { throw 'Unexpected local health URL.' }
Write-Host "Admin UI: $url/ui"
foreach ($endpoint in @('healthz', 'readyz', 'health/mcp')) {
    Write-Host "--- $endpoint ---"
    Invoke-RestMethod "$url/$endpoint" -TimeoutSec 5 | ConvertTo-Json -Depth 12
}
