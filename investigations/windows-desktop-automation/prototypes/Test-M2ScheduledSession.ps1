# M2 acceptance: a disposable headless helper launched by the existing Task Scheduler
# manager must actually run in the pinned interactive session and stop on removal.
# No GUI, input, screenshot, RIFT/VM access, service update or task logon trigger.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^[a-z0-9][a-z0-9-]{6,20}[a-z0-9]$')][string]$ProbeId,
    [Parameter(Mandatory)][ValidateRange(1, 2147483647)][int]$ExpectedSessionId
)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$bundle = Join-Path $repo ('.tools\m2-task-session-' + $ProbeId)
$exe = Join-Path $bundle 'HeartbeatProbe\HeartbeatProbe.exe'
$data = Join-Path $bundle 'data'
$manager = Join-Path $repo 'scripts\Manage-HelperTask.ps1'
$helperId = 'm2-session-' + $ProbeId
$taskName = 'Workbridge Helper ' + $helperId
$config = Join-Path $repo ('.local\helpers\' + $helperId + '\registration.json')
$failure = $null
$cleanupFailure = $null
$verified = $false
$processId = $null
$processBirthTicks = $null
$exeHash = $null
$firstSequence = $null
$secondSequence = $null
$firstDesktopStatus = $null
$secondDesktopStatus = $null
$firstConnectionState = $null
$secondConnectionState = $null
$firstLockSample = $null
$secondLockSample = $null
$taskRemoved = $false
$processStopped = $false

function Require([bool]$condition, [string]$code) {
    if (-not $condition) { throw [InvalidOperationException]::new($code) }
}
function ReadHeartbeat([string]$path) {
    $item = Get-Item -LiteralPath $path -ErrorAction Stop
    Require (-not $item.PSIsContainer -and $item.Length -gt 40 -and $item.Length -lt 8192 -and
        -not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) 'INVALID_HEARTBEAT'
    Get-Content -LiteralPath $path -Raw -Encoding UTF8 -ErrorAction Stop |
        ConvertFrom-Json -ErrorAction Stop
}

try {
    Require ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) 'WINDOWS_REQUIRED'
    Require ([Diagnostics.Process]::GetCurrentProcess().SessionId -eq $ExpectedSessionId) 'OBSERVER_SESSION_MISMATCH'
    Require (-not (Test-Path -LiteralPath $config)) 'PROBE_ID_ALREADY_USED'
    Require ($null -eq (Get-ScheduledTask -TaskPath '\' -TaskName $taskName -ErrorAction SilentlyContinue)) 'TASK_ALREADY_EXISTS'
    foreach ($entry in @($bundle, (Join-Path $bundle 'HeartbeatProbe'))) {
        $item = Get-Item -LiteralPath $entry -ErrorAction Stop
        Require ($item.PSIsContainer -and -not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) 'BUNDLE_DIRECTORY_UNTRUSTED'
    }
    $file = Get-Item -LiteralPath $exe -ErrorAction Stop
    Require (-not $file.PSIsContainer -and -not ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) 'PROBE_EXECUTABLE_UNTRUSTED'
    $exeHash = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
    New-Item -ItemType Directory -Path $data -ErrorAction Stop | Out-Null
    $receipt = & $manager -Action Register -HelperId $helperId -Executable $exe -Argument @($data) -WorkingDirectory $bundle |
        ConvertFrom-Json -ErrorAction Stop
    Require ($receipt.taskName -ceq $taskName -and $receipt.atLogon -eq $false) 'INVALID_REGISTRATION'
    $task = Get-ScheduledTask -TaskPath '\' -TaskName $taskName -ErrorAction Stop
    Require ([int]$task.Principal.LogonType -eq 3 -and [int]$task.Principal.RunLevel -eq 0 -and
        @($task.Triggers | Where-Object { $null -ne $_ }).Count -eq 0 -and @($task.Actions).Count -eq 1) 'INVALID_TASK_PRINCIPAL'
    & $manager -Action Start -HelperId $helperId | Out-Null
    $heartbeatPath = Join-Path $data 'heartbeat.json'
    $deadline = [DateTime]::UtcNow.AddSeconds(12)
    $first = $null
    while ([DateTime]::UtcNow -lt $deadline) {
        if (Test-Path -LiteralPath $heartbeatPath) {
            try {
                $sample = ReadHeartbeat $heartbeatPath
                if ($sample.marker -ceq 'WORKBRIDGE_PERSISTENT_HELPER_OK' -and
                    $sample.sequence -ge 1) { $first = $sample; break }
            } catch [IO.IOException] { }
        }
        Start-Sleep -Milliseconds 120
    }
    Require ($null -ne $first) 'HEARTBEAT_TIMEOUT'
    Require ($first.sessionId -eq $ExpectedSessionId -and !$first.elevated -and
        $first.pid -gt 0 -and $first.schema -eq 1) 'HEARTBEAT_SESSION_OR_TOKEN_MISMATCH'
    # These are two child-owned instantaneous observations, NOT an input authorization.
    Require ($null -ne $first.desktop -and $first.desktop.sampleStatus -ceq 'DEFAULT_INPUT_DESKTOP_SAMPLE' -and
        $first.desktop.userInteractive -eq $true -and $first.desktop.windowStation -ceq 'WinSta0' -and
        $first.desktop.threadDesktop -ceq 'Default' -and $first.desktop.inputDesktop -ceq 'Default' -and
        $first.desktop.activeConsoleSessionId -eq $ExpectedSessionId -and
        $first.desktop.safeForInput -eq $false -and $first.desktop.sessionLocked -ceq 'UNLOCKED' -and
        $first.desktop.wtsLockFlags -eq 1 -and $first.desktop.wtsLockResponseVerified -eq $true -and
        $first.desktop.sessionConnected -ceq 'ACTIVE' -and $first.desktop.wtsConnectState -eq 0 -and
        $first.desktop.wtsResponseValid -eq $true -and
        $first.desktop.intervalContinuity -ceq 'UNKNOWN') 'FIRST_DESKTOP_SAMPLE_MISMATCH'
    $firstDesktopStatus = [string]$first.desktop.sampleStatus
    $firstConnectionState = [string]$first.desktop.sessionConnected
    $firstLockSample = [string]$first.desktop.sessionLocked
    $processId = [int]$first.pid
    $proc = [Diagnostics.Process]::GetProcessById($processId)
    Require (-not $proc.HasExited -and $proc.ProcessName -ceq 'HeartbeatProbe' -and
        $proc.SessionId -eq $ExpectedSessionId) 'INDEPENDENT_PROCESS_MISMATCH'
    $processBirthTicks = $proc.StartTime.ToUniversalTime().Ticks
    $actualExe = [IO.Path]::GetFullPath($proc.MainModule.FileName)
    Require ($actualExe.Equals([IO.Path]::GetFullPath($exe), [StringComparison]::OrdinalIgnoreCase) -and
        (Get-FileHash -LiteralPath $actualExe -Algorithm SHA256).Hash -ieq $exeHash) 'INDEPENDENT_EXECUTABLE_MISMATCH'
    $firstSequence = [long]$first.sequence
    Start-Sleep -Milliseconds 1200
    $second = ReadHeartbeat $heartbeatPath
    Require ($first.instance -ceq $second.instance -and $second.pid -eq $processId -and
        [long]$second.sequence -gt $firstSequence -and $second.sessionId -eq $ExpectedSessionId) 'HEARTBEAT_NOT_CONTINUOUS'
    Require ($null -ne $second.desktop -and $second.desktop.sampleStatus -ceq 'DEFAULT_INPUT_DESKTOP_SAMPLE' -and
        $second.desktop.userInteractive -eq $true -and $second.desktop.windowStation -ceq 'WinSta0' -and
        $second.desktop.threadDesktop -ceq 'Default' -and $second.desktop.inputDesktop -ceq 'Default' -and
        $second.desktop.activeConsoleSessionId -eq $ExpectedSessionId -and
        $second.desktop.safeForInput -eq $false -and $second.desktop.sessionLocked -ceq 'UNLOCKED' -and
        $second.desktop.wtsLockFlags -eq 1 -and $second.desktop.wtsLockResponseVerified -eq $true -and
        $second.desktop.sessionConnected -ceq 'ACTIVE' -and $second.desktop.wtsConnectState -eq 0 -and
        $second.desktop.wtsResponseValid -eq $true -and
        $second.desktop.intervalContinuity -ceq 'UNKNOWN') 'SECOND_DESKTOP_SAMPLE_MISMATCH'
    Require ([DateTimeOffset]$second.desktop.observedAtUtc -gt [DateTimeOffset]$first.desktop.observedAtUtc) 'DESKTOP_SAMPLE_TIME_NOT_ADVANCING'
    $secondDesktopStatus = [string]$second.desktop.sampleStatus
    $secondConnectionState = [string]$second.desktop.sessionConnected
    $secondLockSample = [string]$second.desktop.sessionLocked
    $secondSequence = [long]$second.sequence
    $verified = $true
} catch {
    $failure = [string]$_.Exception.Message
} finally {
    # The existing manager validates task SID, action, arguments and receipt before removal.
    # Never remove a collision or an unknown task and never delete receipts/artifacts.
    if (Test-Path -LiteralPath $config) {
        try { & $manager -Action Remove -HelperId $helperId | Out-Null }
        catch { $cleanupFailure = [string]$_.Exception.Message }
    }
    $taskRemoved = $null -eq (Get-ScheduledTask -TaskPath '\' -TaskName $taskName -ErrorAction SilentlyContinue)
    if ($null -ne $processId) {
        try {
            $after = [Diagnostics.Process]::GetProcessById($processId)
            $processStopped = $after.WaitForExit(3000)
        } catch [ArgumentException] { $processStopped = $true }
    }
}
$passed = $verified -and $taskRemoved -and $processStopped -and $null -eq $failure -and $null -eq $cleanupFailure
$reason = if ($failure -and $failure -match '^[A-Z][A-Z_]{2,65}$') { $failure } elseif ($failure) {
    'PROBE_EXCEPTION'
} elseif ($cleanupFailure) { 'TASK_CLEANUP_FAILED' } elseif (-not $taskRemoved) {
    'TASK_NOT_REMOVED'
} elseif (-not $processStopped) { 'PROBE_PROCESS_NOT_STOPPED' } elseif (-not $verified) {
    'PROBE_NOT_VERIFIED'
} else { $null }
[pscustomobject]@{
    schemaVersion=1
    probeId=$ProbeId
    pass=$passed
    readOnlyDesktop=$true
    temporaryTaskRegistrationCreated=(Test-Path -LiteralPath $config)
    taskAbsentAfterRun=$taskRemoved
    noGuiInput=$true
    sessionId=$ExpectedSessionId
    childPid=$processId
    childStartedAtUtcTicks=$processBirthTicks
    executableSha256=$exeHash
    initialSequence=$firstSequence
    finalSequence=$secondSequence
    heartbeatStopped=$processStopped
    firstDesktopStatus=$firstDesktopStatus
    secondDesktopStatus=$secondDesktopStatus
    firstConnectionState=$firstConnectionState
    secondConnectionState=$secondConnectionState
    firstLockSample=$firstLockSample
    secondLockSample=$secondLockSample
    desktopSamplesAuthorizeInput=$false
    sessionLockVerified=$false
    intervalVerified=$false
    errorCode=$reason
    remainingTaskMayRequireReview=(-not $taskRemoved)
} | ConvertTo-Json -Compress -Depth 3
if ($passed) { exit 0 } else { exit 2 }
