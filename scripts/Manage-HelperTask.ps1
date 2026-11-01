[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('Register','Start','Status','Stop','Remove')][string]$Action,
    [Parameter(Mandatory)][ValidatePattern('^[a-z0-9][a-z0-9-]{0,47}$')][string]$HelperId,
    [string]$Executable,
    [string[]]$Argument = @(),
    [string]$WorkingDirectory,
    [switch]$AtLogon
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Workbridge-Update.ps1')
Import-Module (Join-Path $env:WINDIR 'System32/WindowsPowerShell/v1.0/Modules/ScheduledTasks') -ErrorAction Stop
$repo = Split-Path -Parent $PSScriptRoot
$state = Get-WBChild $repo ('.local/helpers/' + $HelperId)
$configPath = Get-WBChild $state 'registration.json'
$taskName = 'Workbridge Helper ' + $HelperId
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value

function Join-HelperArguments([string[]]$Values) {
    # Windows native argv quoting, not shell syntax. Task Scheduler invokes the
    # explicit executable directly; arguments never become PowerShell code here.
    $parts = foreach ($value in $Values) {
        if ($null -eq $value -or $value.Contains([char]0)) { throw 'Invalid argument.' }
        $builder = New-Object Text.StringBuilder
        [void]$builder.Append('"')
        $slashes = 0
        foreach ($character in $value.ToCharArray()) {
            if ($character -eq '\') { $slashes++; continue }
            if ($character -eq '"') {
                [void]$builder.Append(('\' * (2 * $slashes + 1)))
            } else { [void]$builder.Append(('\' * $slashes)) }
            [void]$builder.Append($character)
            $slashes = 0
        }
        [void]$builder.Append(('\' * (2 * $slashes)))
        [void]$builder.Append('"')
        $builder.ToString()
    }
    $line = $parts -join ' '
    if ($line.Length -gt 16000) { throw 'Arguments exceed this helper manager limit.' }
    return $line
}

function Assert-OwnedHelperTask($Task, $Config) {
    # Task Scheduler may normalize an input SID to a local account name.
    $taskSid = if ($Task.Principal.UserId -match '^S-1-') { $Task.Principal.UserId } else {
        (New-Object Security.Principal.NTAccount($Task.Principal.UserId)).Translate([Security.Principal.SecurityIdentifier]).Value
    }
    $triggers = @($Task.Triggers | Where-Object { $null -ne $_ })
    $triggerMatches = $triggers.Count -eq [int][bool]$Config.atLogon
    if ($triggerMatches -and $Config.atLogon) {
        $trigger = $triggers[0]
        $triggerSid = if ($trigger.UserId -match '^S-1-') { $trigger.UserId } elseif ($trigger.UserId) {
            (New-Object Security.Principal.NTAccount($trigger.UserId)).Translate([Security.Principal.SecurityIdentifier]).Value
        } else { '' }
        $triggerMatches = $trigger.CimClass.CimClassName -ceq 'MSFT_TaskLogonTrigger' -and
            $trigger.Enabled -and $triggerSid -ieq $sid -and !$trigger.Delay -and
            !$trigger.StartBoundary -and !$trigger.EndBoundary -and !$trigger.Repetition.Interval
    }
    $settingsMatch = $Task.Settings.ExecutionTimeLimit -ceq 'PT0S' -and
        [int]$Task.Settings.MultipleInstances -eq 2 -and $Task.Settings.Enabled -and
        !$Task.Settings.DisallowStartIfOnBatteries -and !$Task.Settings.StopIfGoingOnBatteries -and
        $Task.Settings.RestartCount -eq 0
    if ($Task.TaskPath -cne '\' -or $Task.TaskName -cne $taskName -or
        $Task.Description -cne $Config.description -or @($Task.Actions).Count -ne 1 -or
        $Task.Actions.Execute -ine $Config.executable -or
        [string]$Task.Actions.Arguments -cne [string]$Config.arguments -or
        $Task.Actions.WorkingDirectory -ine $Config.workingDirectory -or
        $taskSid -ine $sid -or [int]$Task.Principal.RunLevel -ne 0 -or
        [int]$Task.Principal.LogonType -ne 3 -or !$triggerMatches -or !$settingsMatch) {
        $differences = [ordered]@{
            path=($Task.TaskPath -cne '\'); name=($Task.TaskName -cne $taskName)
            description=($Task.Description -cne $Config.description); actionCount=@($Task.Actions).Count
            executable=($Task.Actions.Execute -ine $Config.executable)
            arguments=([string]$Task.Actions.Arguments -cne [string]$Config.arguments)
            directory=($Task.Actions.WorkingDirectory -ine $Config.workingDirectory)
            identity=($taskSid -ine $sid); runLevel=([int]$Task.Principal.RunLevel -ne 0)
            logonType=([int]$Task.Principal.LogonType -ne 3)
            triggers=(!$triggerMatches); settings=(!$settingsMatch)
        }
        throw ('TASK_OWNERSHIP: task differs; mismatch flags: ' + ($differences | ConvertTo-Json -Compress))
    }
}

$config = if (Test-Path -LiteralPath $configPath) { Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json } else { $null }
if ($config -and ($config.schema -ne 1 -or $config.helperId -cne $HelperId -or $config.ownerSid -cne $sid -or $config.taskName -cne $taskName)) {
    throw 'Registration does not belong to this helper and Windows user.'
}
$task = Get-ScheduledTask -TaskPath '\' -TaskName $taskName -ErrorAction SilentlyContinue
if ($Action -eq 'Register') {
    if (!$Executable -or !$WorkingDirectory) { throw 'Register needs absolute Executable and WorkingDirectory.' }
    $exe = Assert-WBPath $Executable
    $cwd = Assert-WBPath $WorkingDirectory
    if (!(Test-Path -LiteralPath $exe -PathType Leaf) -or [IO.Path]::GetExtension($exe) -ine '.exe') { throw 'Use an installed native .exe, or explicitly invoke an interpreter.' }
    if (!(Test-Path -LiteralPath $cwd -PathType Container)) { throw 'WorkingDirectory must exist.' }
    if ($Argument.Count -gt 100) { throw 'Too many arguments.' }
    $line = Join-HelperArguments $Argument
    $candidate = [ordered]@{schema=1; helperId=$HelperId; ownerSid=$sid; taskName=$taskName; executable=$exe; arguments=$line; workingDirectory=$cwd; atLogon=[bool]$AtLogon}
    $bytes = [Text.Encoding]::UTF8.GetBytes(($candidate | ConvertTo-Json -Compress))
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { $digest = [BitConverter]::ToString($hasher.ComputeHash($bytes)).Replace('-','') } finally { $hasher.Dispose() }
    $candidate.description = 'Workbridge user helper; registration SHA256 ' + $digest
    if ($config -and $config.description -cne $candidate.description) { throw 'REGISTRATION_CONFLICT: remove the previous registration before changing it.' }
    if ($task -and !$config) { throw 'TASK_COLLISION: an existing task has this name; it was not modified.' }
    if ($task) { Assert-OwnedHelperTask $task $candidate }
    New-Item -ItemType Directory -Path $state -Force | Out-Null
    Write-WBJson $configPath $candidate
    $config = [pscustomobject]$candidate
    if (!$task) {
        $definition = @{
            TaskName=$taskName; TaskPath='\'
            Action=(New-ScheduledTaskAction -Execute $exe -Argument $line -WorkingDirectory $cwd)
            Principal=(New-ScheduledTaskPrincipal -UserId $sid -LogonType Interactive -RunLevel Limited)
            Settings=(New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew)
            Description=$config.description
        }
        if ($AtLogon) { $definition.Trigger = New-ScheduledTaskTrigger -AtLogOn -User $sid }
        Register-ScheduledTask @definition | Out-Null
        $task = Get-ScheduledTask -TaskPath '\' -TaskName $taskName
    }
} elseif (!$config) { throw 'Unknown helper registration.' }

if ($task) { Assert-OwnedHelperTask $task $config }
if ($Action -eq 'Start') {
    if (!$task) { throw 'Task is not registered.' }
    if ($task.State -ne 'Running') { Start-ScheduledTask -TaskPath '\' -TaskName $taskName }
}
if ($Action -in @('Stop','Remove') -and $task) {
    if ($task.State -eq 'Running') {
        Stop-ScheduledTask -TaskPath '\' -TaskName $taskName
        $deadline = [DateTime]::UtcNow.AddSeconds(15)
        do {
            Start-Sleep -Milliseconds 100
            $task = Get-ScheduledTask -TaskPath '\' -TaskName $taskName
        } while ($task.State -eq 'Running' -and [DateTime]::UtcNow -lt $deadline)
        if ($task.State -eq 'Running') { throw 'Helper is still running; registration was retained.' }
    }
    if ($Action -eq 'Remove') {
        Unregister-ScheduledTask -TaskPath '\' -TaskName $taskName -Confirm:$false
        # Retain the registration receipt and helper files for inspection/re-registration.
        $task = $null
    }
}
$task = Get-ScheduledTask -TaskPath '\' -TaskName $taskName -ErrorAction SilentlyContinue
$info = if ($task) { Get-ScheduledTaskInfo -TaskPath '\' -TaskName $taskName } else { $null }
[ordered]@{
    helperId=$HelperId; taskName=$taskName; state=$(if ($task) { [string]$task.State } else { 'NotRegistered' })
    runLevel=$(if ($task) { 'Limited' } else { $null })
    lastTaskResult=$(if ($info) { $info.LastTaskResult } else { $null })
    atLogon=$config.atLogon; registration=$configPath
    note='Task state is not application health. Inspect the helper heartbeat/output; no elevation is granted.'
} | ConvertTo-Json
