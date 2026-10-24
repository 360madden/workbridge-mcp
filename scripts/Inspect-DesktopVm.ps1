#requires -Version 5.1
<#
.SYNOPSIS
  Read-only inventory of the Windows interactive session and VMware Workstation.
.DESCRIPTION
  Emits one compact JSON document. Does not focus windows, inject input, capture
  pixels, change VM power, or read VM guest credentials.
#>
[CmdletBinding()]
param(
    [switch] $IncludeRunningVMs
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Find-Program {
    param(
        [Parameter(Mandatory = $true)][string] $Name,
        [string[]] $KnownPaths = @()
    )
    foreach ($candidate in $KnownPaths) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return $candidate
        }
    }
    $command = Get-Command -Name $Name -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandType -eq 'Application' } |
        Select-Object -First 1
    if ($null -ne $command) {
        return $command.Source
    }
    return $null
}

$sessionId = [System.Diagnostics.Process]::GetCurrentProcess().SessionId
$screenCount = $null
$screenError = $null
try {
    Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
    $screenCount = [System.Windows.Forms.Screen]::AllScreens.Count
} catch {
    $screenError = $_.Exception.GetType().Name
}

$vmrun = Find-Program -Name 'vmrun.exe' -KnownPaths @(
    'C:\Program Files\VMware\VMware Workstation\vmrun.exe',
    'C:\Program Files (x86)\VMware\VMware Workstation\vmrun.exe'
)
$winapp = Find-Program -Name 'winapp.exe'
$vmwareProcesses = @(
    Get-Process -Name 'vmware', 'vmware-vmx' -ErrorAction SilentlyContinue |
        Sort-Object ProcessName, Id |
        ForEach-Object {
            [pscustomobject]@{
                name = $_.ProcessName
                pid = [int]$_.Id
                sessionId = [int]$_.SessionId
            }
        }
)
$vmPaths = @()
$vmrunExitCode = $null
$vmrunError = $null
if ($IncludeRunningVMs) {
    if ($null -eq $vmrun) {
        $vmrunError = 'VMRUN_NOT_INSTALLED'
    } else {
        try {
            $lines = @(& $vmrun -T ws list 2>&1)
            $vmrunExitCode = [int]$LASTEXITCODE
            if ($vmrunExitCode -eq 0) {
                $vmPaths = @($lines | ForEach-Object { [string]$_ } |
                    Where-Object { $_ -match '(?i)\.vmx$' })
            } else {
                $vmrunError = 'VMRUN_LIST_FAILED'
            }
        } catch {
            $vmrunError = 'VMRUN_LAUNCH_FAILED'
        }
    }
}

$result = [ordered]@{
    schemaVersion = 1
    readOnly = $true
    inspectedUtc = (Get-Date).ToUniversalTime().ToString('o')
    session = [ordered]@{
        id = [int]$sessionId
        userInteractive = [bool][Environment]::UserInteractive
        screens = $screenCount
        screenError = $screenError
    }
    vmware = [ordered]@{
        vmrunPath = $vmrun
        processes = $vmwareProcesses
        sameSession = [bool](@($vmwareProcesses | Where-Object {
            $_.sessionId -eq $sessionId
        }).Count -gt 0)
        inventoryRequested = [bool]$IncludeRunningVMs
        runningVmPaths = $vmPaths
        vmrunExitCode = $vmrunExitCode
        vmrunError = $vmrunError
    }
    winapp = [ordered]@{
        executable = $winapp
        available = [bool]($null -ne $winapp)
    }
    inputTested = $false
    captureTested = $false
}
$result | ConvertTo-Json -Depth 8 -Compress
