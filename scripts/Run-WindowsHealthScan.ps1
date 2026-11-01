[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$BundleDirectory,
    [Parameter(Mandatory)][ValidatePattern('^[A-Fa-f0-9]{64}$')][string]$ExpectedSha256,
    [Parameter(Mandatory)][ValidateSet('scan','cleanup')][string]$AdminAction,
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{32}$')][string]$ScanId,
    [Parameter(Mandatory)][ValidatePattern('^[a-z0-9][a-z0-9-]{0,47}$')][string]$OperationId
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Workbridge-Update.ps1')
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if ((New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'The UAC launcher must start with a normal user token.'
}
$bundle = Assert-WBPath $BundleDirectory
$executable = Get-WBChild $bundle 'WindowsHealthScan.exe'
$operation = Get-WBChild $bundle ('operations/' + $OperationId)
New-Item -ItemType Directory -Path $operation -Force | Out-Null
$reservation = Get-WBChild $operation 'reserved'
# A lost response or a repeated task start must never silently repeat UAC.
$reserved = [IO.File]::Open($reservation, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
$reserved.Dispose()
$receiptPath = Get-WBChild $operation 'receipt.json'
$receipt = [ordered]@{schema=1; operationId=$OperationId; adminAction=$AdminAction; scanId=$ScanId; purpose='Fixed Windows component-store diagnostic or report cleanup'; state='preflight'; requestedUtc=[DateTime]::UtcNow.ToString('o'); executable=$executable; expectedSha256=$ExpectedSha256.ToUpperInvariant(); exitCode=$null; error=$null; updatedUtc=[DateTime]::UtcNow.ToString('o')}
$lease = $null
try {
    # Framework-dependent single-file payload: hold the reviewed binary read-only
    # while hashing, showing UAC, and running; no loose application DLLs/config.
    $lease = [IO.File]::Open($executable, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { $actual = [BitConverter]::ToString($hasher.ComputeHash($lease)).Replace('-','') } finally { $hasher.Dispose() }
    if ($actual -ine $ExpectedSha256) { throw 'PAYLOAD_CHANGED: rebuild/review the diagnostic; no UAC prompt was requested.' }
    # Remove CLR startup/profiler overrides before ShellExecute inherits this
    # process environment. No user/machine environment settings are changed.
    foreach ($entry in @(Get-ChildItem Env:)) {
        if ($entry.Name -match '^(DOTNET_|CORECLR_|COMPLUS_|COR_|WORKBRIDGE_|GIT_|CONTROL_PLANE_API_KEY$)') {
            [Environment]::SetEnvironmentVariable($entry.Name, $null, 'Process')
        }
    }
    $runtime = Assert-WBPath (Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'dotnet')
    if (!(Test-Path -LiteralPath (Join-Path $runtime 'dotnet.exe'))) { throw 'Expected the machine-installed .NET runtime.' }
    $env:DOTNET_ROOT = $runtime
    $env:DOTNET_ROOT_X64 = $runtime
    $receipt.state = 'awaiting_windows_uac'
    Write-WBJson $receiptPath $receipt
    # Task Scheduler runs THIS launcher at Limited privilege, outside bridge job
    # ownership. Windows alone handles consent/credentials on the secure desktop.
    # Windows PowerShell Start-Process discards the original Win32Exception in
    # some error paths. The native .NET API retains cancellation code 1223.
    $startInfo = New-Object Diagnostics.ProcessStartInfo
    $startInfo.FileName = $executable
    $startInfo.Arguments = $AdminAction + ' ' + $ScanId
    $startInfo.UseShellExecute = $true
    $startInfo.Verb = 'runas'
    $startInfo.WorkingDirectory = $runtime
    $startInfo.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
    $child = [Diagnostics.Process]::Start($startInfo)
    try {
        $child.WaitForExit()
        $receipt.exitCode = $child.ExitCode
        $receipt.state = if ($child.ExitCode -eq 0) { 'action_completed' } else { 'action_failed' }
    } finally { if ($child) { $child.Dispose() } }
} catch {
    $native = $_.Exception
    while ($native.InnerException -and $native -isnot [ComponentModel.Win32Exception]) { $native = $native.InnerException }
    $receipt.state = if ($native -is [ComponentModel.Win32Exception] -and $native.NativeErrorCode -eq 1223) { 'uac_cancelled' } else { 'failed' }
    $receipt.error = $_.Exception.Message
} finally {
    if ($lease) { $lease.Dispose() }
    $receipt.updatedUtc = [DateTime]::UtcNow.ToString('o')
    Write-WBJson $receiptPath $receipt
}
$receipt | ConvertTo-Json
if ($receipt.state -notin @('action_completed','uac_cancelled')) { exit 1 }
