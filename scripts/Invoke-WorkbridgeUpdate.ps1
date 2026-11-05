[CmdletBinding()]
param([Parameter(Mandatory)][string]$InstallRoot, [Parameter(Mandatory)][string]$OperationId)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Workbridge-Update.ps1')
Import-Module (Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\Modules\ScheduledTasks') -ErrorAction Stop
$operation = $null
try {
    $install = Get-WBInstallation $InstallRoot $true
    if ($OperationId -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$') { throw 'Invalid operation ID.' }
    $operation = Get-WBChild $install ('.local\update-operations\' + $OperationId)
    $request = Get-Content -LiteralPath (Join-Path $operation 'request.json') -Raw | ConvertFrom-Json
    if ($request.installRoot -cne $install -or $request.operationId -cne $OperationId -or $request.action -notin @('Apply','Recover','Rollback')) { throw 'Update request does not match this controller.' }
    $taskName = $request.serviceTaskName
    if (!$taskName -or $request.readinessTimeoutSeconds -lt 3 -or $request.readinessTimeoutSeconds -gt 120) { throw 'Invalid service task or readiness timeout in request.' }
    $task = Get-ScheduledTask -TaskName $taskName
    $launcher = Join-Path $install 'scripts\Start-BackgroundTunnel.ps1'
    if (@($task.Actions).Count -ne 1 -or !$task.Actions.Arguments.Contains('"' + $launcher + '"') -or $task.Actions.WorkingDirectory -ine $install) { throw 'Scheduled task does not launch this Workbridge installation.' }
    if (!$task.Settings.Enabled) { throw 'The Workbridge service task is disabled.' }
    Export-ScheduledTask -TaskName $taskName | Set-Content -LiteralPath (Join-Path $operation 'service-task.xml') -Encoding UTF8
    $script:WBStartTime = [DateTime]::MinValue
    $probeScript = Join-Path $PSScriptRoot 'release-acceptance.mjs'
    $stop = {
        $current = Get-ScheduledTask -TaskName $taskName
        if ($current.State -ne 'Ready') { Stop-ScheduledTask -TaskName $taskName }
        $deadline = [DateTime]::UtcNow.AddSeconds(20)
        do {
            if ((Get-ScheduledTask -TaskName $taskName).State -eq 'Ready') { return }
            if ([DateTime]::UtcNow -ge $deadline) { throw 'Workbridge task did not stop within 20 seconds.' }
            Start-Sleep -Milliseconds 250
        } while ($true)
    }
    $start = {
        $script:WBStartTime = [DateTime]::UtcNow
        Start-ScheduledTask -TaskName $taskName
    }
    $probe = {
        param($ExpectedVersion, $Fresh)
        $previousKey = $env:CONTROL_PLANE_API_KEY
        $previousState = $env:WORKBRIDGE_STATE_DIR
        $previousRoot = $env:WORKBRIDGE_ROOT
        try {
            $env:CONTROL_PLANE_API_KEY = $null
            $env:WORKBRIDGE_STATE_DIR = Join-Path $operation 'probe-state'
            $startup = Get-Content -LiteralPath (Join-Path $install '.local\autostart.json') -Raw | ConvertFrom-Json
            $env:WORKBRIDGE_ROOT = $startup.root
            Push-Location $install
            try {
                $node = Assert-WBPath $request.nodePath
                if (!(Test-Path -LiteralPath $node -PathType Leaf)) { throw 'The recorded Node executable is unavailable.' }
                [string[]]$versionArguments = if ($ExpectedVersion) { @('--expected-version', $ExpectedVersion) } else { @('--observe-version') }
                $oldPreference = $ErrorActionPreference
                try {
                    $ErrorActionPreference = 'Continue'
                    & $node $probeScript @versionArguments *> (Join-Path $operation 'probe.log')
                    $probeExit = $LASTEXITCODE
                } finally { $ErrorActionPreference = $oldPreference }
                if ($probeExit -ne 0) { return $false }
            } finally { Pop-Location }
            $observed = Get-Content -LiteralPath (Join-Path $operation 'probe-state\release-probe.json') -Raw | ConvertFrom-Json
            if ($ExpectedVersion -and $observed.version -cne $ExpectedVersion) { return $false }
            $effectiveVersion = $observed.version
        } finally {
            $env:CONTROL_PLANE_API_KEY = $previousKey
            $env:WORKBRIDGE_STATE_DIR = $previousState
            $env:WORKBRIDGE_ROOT = $previousRoot
        }
        $deadline = [DateTime]::UtcNow.AddSeconds($request.readinessTimeoutSeconds)
        do {
            try {
                $healthFile = Get-Item -LiteralPath (Join-Path $install '.local\health-url.txt')
                if (!$Fresh -or $healthFile.LastWriteTimeUtc -ge $script:WBStartTime) {
                    $url = (Get-Content -LiteralPath $healthFile.FullName -Raw).Trim()
                    if ($url -notmatch '^http://127\.0\.0\.1:[0-9]+$') { throw 'Unexpected local health URL.' }
                    $health = Invoke-RestMethod "$url/health?details=true" -TimeoutSec 2
                    $version = $health.components.mcp.details.initialize.server_version
                    if ($health.ready -and (!$version -or $version -ceq $effectiveVersion) -and (Get-ScheduledTask -TaskName $taskName).State -eq 'Running') { return $true }
                }
            } catch { # A fresh listener may still be starting.
            }
            if (!$Fresh -or [DateTime]::UtcNow -ge $deadline) { return $false }
            Start-Sleep -Milliseconds 500
        } while ($true)
    }
    $checkIdle = {
        # This query is read-only and does not consume a command slot. The
        # updater's exclusive .local/updater.lock prevents fresh admissions.
        $node = Assert-WBPath $request.nodePath
        $cli = Get-WBChild $install 'scripts\workbridge-cli.mjs'
        if (!(Test-Path -LiteralPath $node -PathType Leaf) -or !(Test-Path -LiteralPath $cli -PathType Leaf)) {
            throw 'The local runtime diagnostics client is unavailable; refusing to stop Workbridge.'
        }
        $query = Get-WBChild $operation 'job-idle-query.json'
        $output = Get-WBChild $operation 'job-idle-result.jsonl'
        $errors = Get-WBChild $operation 'job-idle-stderr.log'
        Write-WBJson $query @([pscustomobject]@{tool='diagnostics'; arguments=[pscustomobject]@{}})
        $oldPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            & $node $cli --service-state (Get-WBChild $install '.local') --input $query --timeout 15 --json 1> $output 2> $errors
            $exitCode = $LASTEXITCODE
        } finally { $ErrorActionPreference = $oldPreference }
        if ($exitCode -ne 0) { throw 'Live command diagnostics failed; inspect job-idle-stderr.log before retrying.' }
        $report = Get-Content -LiteralPath $output -Raw | ConvertFrom-Json
        if (!$report -or $report.schemaVersion -ne 1 -or $report.index -ne 0 -or $report.tool -cne 'diagnostics' -or $report.ok -cne $true) {
            throw 'Live command diagnostics returned an unexpected result; refusing to stop Workbridge.'
        }
        $census = $null
        if ($report.result.jobs.inventory.complete -cne $true) {
            $census = Get-WBHistoricalJobCensus (Get-WBChild $install '.local')
        }
        $assessment = Assert-WBIdleDiagnostics $report.result.jobs $census
        if ($assessment.historicalInventoryLimitReached) {
            # The old owner may not honor updater.lock. Recheck its live map
            # and ensure the full historical census stayed unchanged.
            $recheckOutput = Get-WBChild $operation 'job-idle-recheck.jsonl'
            $recheckErrors = Get-WBChild $operation 'job-idle-recheck-stderr.log'
            $oldPreference = $ErrorActionPreference
            try {
                $ErrorActionPreference = 'Continue'
                & $node $cli --service-state (Get-WBChild $install '.local') --input $query --timeout 15 --json 1> $recheckOutput 2> $recheckErrors
                $recheckCode = $LASTEXITCODE
            } finally { $ErrorActionPreference = $oldPreference }
            if ($recheckCode -ne 0) { throw 'Live command diagnostics recheck failed; refusing to stop Workbridge.' }
            $again = Get-Content -LiteralPath $recheckOutput -Raw | ConvertFrom-Json
            if (!$report.result.localCli -or $report.result.localCli.instanceId -isnot [string] -or
                [string]::IsNullOrWhiteSpace($report.result.localCli.instanceId) -or
                !$again -or $again.schemaVersion -ne 1 -or $again.index -ne 0 -or $again.tool -cne 'diagnostics' -or $again.ok -cne $true -or
                $again.result.localCli.instanceId -cne $report.result.localCli.instanceId) {
                throw 'Live command diagnostics owner identity changed; refusing to stop Workbridge.'
            }
            $censusAgain = Get-WBHistoricalJobCensus (Get-WBChild $install '.local')
            if ($censusAgain.entries -ne $census.entries -or $censusAgain.records -ne $census.records -or
                $censusAgain.resultFiles -ne $census.resultFiles) {
                throw 'Historical job catalog changed during preflight; refusing to stop Workbridge.'
            }
            $assessment = Assert-WBIdleDiagnostics $again.result.jobs $censusAgain
        }
        Write-WBJson (Get-WBChild $operation 'job-idle-assessment.json') $assessment
        return $true
    }
    $currentVersion = ''
    if ($request.action -eq 'Apply' -and !(Test-Path -LiteralPath (Join-Path $operation 'journal.json'))) {
        if (!(& $probe '' $false)) { throw 'Cannot establish a healthy installed runtime version before update. Inspect probe.log and the service status.' }
        $currentVersion = (Read-WBJson (Join-Path $operation 'probe-state\release-probe.json')).version
    }
    $result = Invoke-WBDeployment -InstallRoot $install -OperationId $OperationId -ReleasePath $request.releasePath -ExpectedReleaseDigest $request.releaseDigest -CurrentVersion $currentVersion -Action $request.action -StopService $stop -StartService $start -TestService $probe -CheckIdle $checkIdle
    $result | ConvertTo-Json -Depth 12 | Write-Output
    if ($result.phase -notin @('completed','rolled_back')) { exit 1 }
} catch {
    if ($operation -and (Test-Path -LiteralPath $operation -PathType Container)) {
        Write-WBJson (Join-Path $operation 'controller-error.json') ([pscustomobject]@{utc=[DateTime]::UtcNow.ToString('o'); error=$_.Exception.Message})
    }
    Write-Error $_.Exception.Message
    exit 1
}
