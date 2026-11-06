# Passive M2 Lab 1/2 readiness only. Does not start controllers, access guest credentials,
# send VMware guest commands, lock Windows, focus windows, or touch RIFT.
# Historical Lab2 filename retained for existing callers; -Lab selects either lab.
[CmdletBinding()]
param([ValidateSet('lab1','lab2')][string]$Lab = 'lab2')
$ErrorActionPreference = 'Stop'

$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$configPath = [IO.Path]::GetFullPath((Join-Path $repo ('..\RiftReader2\artifacts\control-fleet-live\' + $Lab + '\host.json')))
$labNumber = if ($Lab -ceq 'lab1') { '1' } else { '2' }
$expectedVmx = 'C:\rift modding\VMs\RIFT-Lab-' + $labNumber + '\RIFT-Lab.vmx'
$expectedVmrun = 'C:\Program Files\VMware\VMware Workstation\vmrun.exe'
$taskName = 'Workbridge Helper rr2-controller-' + $Lab
$report = [ordered]@{
    schemaVersion = 1
    lab = $Lab
    readOnly = $true
    vmxIdentityMatches = $false
    vmxRunning = $false
    controllerTaskState = 'UNKNOWN'
    controllerPortListening = $false
    guestSessionVerified = $false
    eventDeliveryVerified = $false
    readyForGuestLockTest = $false
    status = 'BLOCKED'
    blocker = 'PREFLIGHT_INCOMPLETE'
}

try {
    $file = Get-Item -LiteralPath $configPath -ErrorAction Stop
    if ($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'INVALID_CONFIG_PATH'
    }
    $cfg = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
    $vmx = [IO.Path]::GetFullPath([string]$cfg.vmx)
    $vmrun = [IO.Path]::GetFullPath([string]$cfg.vmrun)
    $port = [int]$cfg.uiPort
    if ($vmx -ine $expectedVmx -or $vmrun -ine $expectedVmrun -or $port -lt 1 -or $port -gt 65535) {
        throw 'LAB2_CONFIG_MISMATCH'
    }
    foreach ($target in @($vmx, $vmrun)) {
        $item = Get-Item -LiteralPath $target -ErrorAction Stop
        if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'TARGET_PATH_UNTRUSTED'
        }
    }
    $report.vmxIdentityMatches = $true

    # Run only the unauthenticated vmrun inventory verb; bounded child lifetime.
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $vmrun
    $start.Arguments = '-T ws list'
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $proc = [Diagnostics.Process]::Start($start)
    if ($null -eq $proc) { throw 'VMRUN_START_FAILED' }
    try {
        if (-not $proc.WaitForExit(10000)) {
            $proc.Kill()
            [void]$proc.WaitForExit(2000)
            throw 'VMRUN_TIMEOUT'
        }
        if ($proc.ExitCode -ne 0) { throw 'VMRUN_LIST_FAILED' }
        $lines = @($proc.StandardOutput.ReadToEnd() -split '\r?\n' | Where-Object { $_ })
    } finally {
        $proc.Dispose()
    }
    $matches = @($lines | Where-Object { $_.Trim() -ieq $expectedVmx })
    if ($matches.Count -ne 1) { throw 'LAB2_VMX_NOT_RUNNING_OR_AMBIGUOUS' }
    $report.vmxRunning = $true

    $task = Get-ScheduledTask -TaskPath '\' -TaskName $taskName -ErrorAction SilentlyContinue
    if ($null -eq $task) { throw 'CONTROLLER_TASK_MISSING' }
    $report.controllerTaskState = [string]$task.State
    $listeners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        Where-Object { $null -ne $_ })
    $report.controllerPortListening = $listeners.Count -gt 0
    if ($task.State -ne 'Running') { throw 'CONTROLLER_NOT_RUNNING' }
    if (-not $report.controllerPortListening) { throw 'CONTROLLER_NOT_LISTENING' }

    # A listener is only host transport evidence, never Windows guest-session proof.
    $report.status = 'HOST_TRANSPORT_PRESENT_GUEST_UNVERIFIED'
    $report.blocker = 'GUEST_IDENTITY_PROOF_REQUIRED'
} catch {
    $reason = [string]$_.Exception.Message
    $report.blocker = if ($reason -match '^[A-Z][A-Z_]{2,64}$') { $reason } else { 'PREFLIGHT_EXCEPTION' }
}
[pscustomobject]$report | ConvertTo-Json -Compress -Depth 3
# No exit 0: this intentionally cannot grant a guest lock or desktop input.
exit 2
