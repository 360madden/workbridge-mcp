[CmdletBinding()]
param([ValidateSet('RIFT-Lab-1','RIFT-Lab-2')][Parameter(Mandatory)][string]$Lab)
$ErrorActionPreference = 'Stop'
if ($env:COMPUTERNAME -ine 'AMD-DESKTOP') { throw "HOST_MISMATCH: expected AMD-DESKTOP, got $env:COMPUTERNAME" }
$known = @{
  'RIFT-Lab-1' = @{ vmx='C:\rift modding\VMs\RIFT-Lab-1\RIFT-Lab.vmx'; uuid='56 4d c7 a3 99 ee e3 57-3d 9d 93 5b 4b f5 d8 56' }
  'RIFT-Lab-2' = @{ vmx='C:\rift modding\VMs\RIFT-Lab-2\RIFT-Lab.vmx'; uuid='56 4d 48 19 3d e6 d1 b9-b4 e8 4a 94 7e 47 0c c2' }
}
$entry = $known[$Lab]
$vmrun = 'C:\Program Files\VMware\VMware Workstation\vmrun.exe'
if (!(Test-Path -LiteralPath $vmrun -PathType Leaf)) { throw 'VMRUN_MISSING' }
if (!(Test-Path -LiteralPath $entry.vmx -PathType Leaf)) { throw 'VMX_MISSING' }
$uuidLine = Get-Content -LiteralPath $entry.vmx | Where-Object { $_ -match '^uuid\.bios\s*=' } | Select-Object -First 1
if (!$uuidLine -or $uuidLine -notmatch '^uuid\.bios\s*=\s*"([^"]+)"\s*$' -or $Matches[1] -ine $entry.uuid) { throw 'VM_UUID_MISMATCH' }
$running = @(& $vmrun list)
if ($LASTEXITCODE -ne 0 -or !($running -contains $entry.vmx)) { throw 'VM_NOT_CONFIRMED_RUNNING' }
[pscustomobject]@{host=$env:COMPUTERNAME;lab=$Lab;vmx=$entry.vmx;biosUuid=$entry.uuid;hostVmVerified=$true;guestHostnameVerified=$false;guestOperationsAllowed=$false;nextAction='Verify guest hostname using an authorized guest channel'} | ConvertTo-Json -Compress