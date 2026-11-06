# M2 read-only hidden session-notification witness; disposable on-demand task only.
# No visible window, input, screenshot, focus change, RIFT/VM access or service update.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^[a-z0-9][a-z0-9-]{6,20}[a-z0-9]$')][string]$ProbeId,
    [Parameter(Mandatory)][ValidateRange(1, 2147483647)][int]$ExpectedSessionId,
    [ValidateRange(2, 10)][int]$DurationSeconds = 3
)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$bundle = Join-Path $repo ('.tools\m2-interval-witness-' + $ProbeId)
$exe = Join-Path $bundle 'M2IntervalWitness.exe'
$data = Join-Path $bundle 'data'
$manager = Join-Path $repo 'scripts\Manage-HelperTask.ps1'
$helperId = 'm2-witness-' + $ProbeId
$taskName = 'Workbridge Helper ' + $helperId
$config = Join-Path $repo ('.local\helpers\' + $helperId + '\registration.json')
$failure = $null
$cleanupFailure = $null
$verified = $false
$processId = $null
$exeHash = $null
$receiptStatus = $null
$sampleCount = $null
$eventCount = $null
$taskRemoved = $false
$processStopped = $false

function Require([bool]$condition, [string]$code) {
    if (-not $condition) { throw [InvalidOperationException]::new($code) }
}

try {
    Require ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) 'WINDOWS_REQUIRED'
    Require ([Diagnostics.Process]::GetCurrentProcess().SessionId -eq $ExpectedSessionId) 'OBSERVER_SESSION_MISMATCH'
    Require (-not (Test-Path -LiteralPath $config)) 'PROBE_ID_ALREADY_USED'
    Require ($null -eq (Get-ScheduledTask -TaskPath '\' -TaskName $taskName -ErrorAction SilentlyContinue)) 'TASK_ALREADY_EXISTS'
    $folder = Get-Item -LiteralPath $bundle -ErrorAction Stop
    Require ($folder.PSIsContainer -and -not ($folder.Attributes -band [IO.FileAttributes]::ReparsePoint)) 'UNTRUSTED_BUNDLE'
    $file = Get-Item -LiteralPath $exe -ErrorAction Stop
    Require (-not $file.PSIsContainer -and -not ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) 'UNTRUSTED_EXECUTABLE'
    $exeHash = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
    New-Item -ItemType Directory -Path $data -ErrorAction Stop | Out-Null
    $registration = & $manager -Action Register -HelperId $helperId -Executable $exe -Argument @('--observe',$data,[string]$DurationSeconds) -WorkingDirectory $bundle |
        ConvertFrom-Json -ErrorAction Stop
    Require ($registration.taskName -ceq $taskName -and $registration.atLogon -eq $false) 'INVALID_REGISTRATION'
    $task = Get-ScheduledTask -TaskPath '\' -TaskName $taskName -ErrorAction Stop
    Require ([int]$task.Principal.LogonType -eq 3 -and [int]$task.Principal.RunLevel -eq 0 -and
        @($task.Triggers | Where-Object { $null -ne $_ }).Count -eq 0 -and @($task.Actions).Count -eq 1) 'INVALID_TASK_PRINCIPAL'
    & $manager -Action Start -HelperId $helperId | Out-Null
    $receiptPath = Join-Path $data 'witness.json'
    $deadline = [DateTime]::UtcNow.AddSeconds($DurationSeconds + 12)
    $report = $null
    while ([DateTime]::UtcNow -lt $deadline) {
        if (Test-Path -LiteralPath $receiptPath) {
            try {
                $item = Get-Item -LiteralPath $receiptPath -ErrorAction Stop
                Require (-not $item.PSIsContainer -and $item.Length -gt 150 -and $item.Length -lt 16000 -and
                    -not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) 'INVALID_WITNESS_RECEIPT'
                $report = Get-Content -LiteralPath $receiptPath -Raw -Encoding UTF8 -ErrorAction Stop |
                    ConvertFrom-Json -ErrorAction Stop
                break
            } catch [IO.IOException] { }
        }
        Start-Sleep -Milliseconds 100
    }
    Require ($null -ne $report) 'WITNESS_TIMEOUT'
    $processId = [int]$report.processId
    $receiptStatus = [string]$report.status
    $sampleCount = [int]$report.sampleCount
    $eventCount = [int]$report.eventCount
    Require ($report.schemaVersion -eq 1 -and $receiptStatus -ceq 'NO_TRANSITION_OBSERVED' -and
        $report.sessionId -eq $ExpectedSessionId -and $processId -gt 0 -and
        $report.subscriptionRegistered -eq $true -and $report.subscriptionUnregistered -eq $true -and
        $report.hiddenAndNotForeground -eq $true -and
        $report.pumpTicks -gt 0 -and $sampleCount -ge 2 -and
        $report.healthySamples -eq $sampleCount -and $eventCount -eq 0 -and
        $report.eventOverflow -eq $false -and
        $report.syntheticSelfMessage -eq $false -and $report.safeForInput -eq $false -and
        $report.intervalVerified -eq $false -and $report.coverageVerified -eq $false -and
        $report.durationMs -ge ($DurationSeconds * 1000)) 'WITNESS_RECEIPT_REJECTED'
    Require ($report.initial.sampleStatus -ceq 'DEFAULT_INPUT_DESKTOP_SAMPLE' -and
        $report.final.sampleStatus -ceq 'DEFAULT_INPUT_DESKTOP_SAMPLE' -and
        $report.initial.sessionConnected -ceq 'ACTIVE' -and $report.final.sessionConnected -ceq 'ACTIVE' -and
        $report.initial.sessionLocked -ceq 'UNLOCKED' -and $report.final.sessionLocked -ceq 'UNLOCKED') 'DESKTOP_SAMPLES_REJECTED'
    $verified = $true
} catch {
    $failure = [string]$_.Exception.Message
} finally {
    # The existing manager checks this task's SID, executable and registration receipt.
    if (Test-Path -LiteralPath $config) {
        try { & $manager -Action Remove -HelperId $helperId | Out-Null }
        catch { $cleanupFailure = [string]$_.Exception.Message }
    }
    $taskRemoved = $null -eq (Get-ScheduledTask -TaskPath '\' -TaskName $taskName -ErrorAction SilentlyContinue)
    if ($null -ne $processId) {
        try {
            $proc = [Diagnostics.Process]::GetProcessById($processId)
            $processStopped = $proc.WaitForExit(3000)
        } catch [ArgumentException] { $processStopped = $true }
    }
}
$passed = $verified -and $taskRemoved -and $processStopped -and $null -eq $failure -and $null -eq $cleanupFailure
$reason = if ($failure -and $failure -match '^[A-Z][A-Z_]{2,65}$') { $failure } elseif ($failure) {
    'PROBE_EXCEPTION'
} elseif ($cleanupFailure) { 'TASK_CLEANUP_FAILED' } elseif (-not $taskRemoved) {
    'TASK_NOT_REMOVED'
} elseif (-not $processStopped) { 'WITNESS_PROCESS_NOT_STOPPED' } else { $null }
[pscustomobject]@{
    schemaVersion=1
    probeId=$ProbeId
    pass=$passed
    readOnly=$true
    noGuiInput=$true
    executableSha256=$exeHash
    expectedSessionId=$ExpectedSessionId
    childPid=$processId
    witnessStatus=$receiptStatus
    sampleCount=$sampleCount
    eventCount=$eventCount
    temporaryTaskRegistrationCreated=(Test-Path -LiteralPath $config)
    taskAbsentAfterRun=$taskRemoved
    childStopped=$processStopped
    intervalVerified=$false
    safeForInput=$false
    errorCode=$reason
    remainingTaskMayRequireReview=(-not $taskRemoved)
} | ConvertTo-Json -Compress -Depth 3
if ($passed) { exit 0 } else { exit 2 }
