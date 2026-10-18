# Execute the real restart script against a deterministic scheduler-transition
# fixture. No real scheduled task or tunnel is stopped or started by this test.
$ErrorActionPreference = 'Stop'
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('workbridge-restart-test-' + [guid]::NewGuid().ToString('N'))
$repo = Split-Path -Parent $PSScriptRoot
try {
    New-Item -ItemType Directory -Path (Join-Path $fixture 'scripts'),(Join-Path $fixture '.local') -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $repo 'scripts\Restart-Workbridge.ps1') -Destination (Join-Path $fixture 'scripts\Restart-Workbridge.ps1')
    Set-Content -LiteralPath (Join-Path $fixture 'scripts\Show-Status.ps1') -Value "Write-Output 'Fixture status verified'"
    foreach ($lostFirstStart in @($false,$true)) {
        & {
            param($fixturePath,$loseFirst)
            $global:WBTestRestartFixture = $fixturePath
            $global:WBTestRestartStarts = 0
            $global:WBTestRestartReady = $false
            $global:WBTestRestartLoseFirst = $loseFirst
            function Get-ScheduledTask { param($TaskName) [pscustomobject]@{State=$(if ($global:WBTestRestartReady) {'Running'} else {'Ready'})} }
            function Get-ScheduledTaskInfo { param($TaskName) [pscustomobject]@{LastTaskResult=0} }
            function Start-ScheduledTask {
                param($TaskName)
                $global:WBTestRestartStarts++
                if (!$global:WBTestRestartLoseFirst -or $global:WBTestRestartStarts -gt 1) {
                    $global:WBTestRestartReady = $true
                    Set-Content -LiteralPath (Join-Path $global:WBTestRestartFixture '.local\health-url.txt') -Value 'http://127.0.0.1:12345'
                }
            }
            function Invoke-RestMethod { param($Uri,$TimeoutSec) [pscustomobject]@{ready=$global:WBTestRestartReady} }
            & (Join-Path $fixturePath 'scripts\Restart-Workbridge.ps1')
            $expected = if ($loseFirst) {2} else {1}
            if ($global:WBTestRestartStarts -ne $expected -or !$global:WBTestRestartReady) { throw 'Restart did not recover the expected scheduler transition.' }
        } $fixture $lostFirstStart
    }
    Write-Output 'PASS: restart starts once normally and retries a lost zero-result scheduler start exactly once.'
} finally {
    $resolved = [IO.Path]::GetFullPath($fixture)
    $prefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (!$resolved.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $resolved) -notmatch '^workbridge-restart-test-[0-9a-f]{32}$') { throw 'Unexpected restart fixture cleanup path.' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
    foreach ($name in @('WBTestRestartFixture','WBTestRestartStarts','WBTestRestartReady','WBTestRestartLoseFirst')) { Remove-Variable -Name $name -Scope Global -ErrorAction SilentlyContinue }
}
