# Disposable M2 synthetic-WTS matrix. Every message is posted to the child witness's
# own hidden HWND. Never locks/disconnects Windows or interacts with RIFT/VM input.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^[a-z0-9][a-z0-9-]{6,20}[a-z0-9]$')][string]$RunId,
    [Parameter(Mandatory)][string]$Executable,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-fA-F]{64}$')][string]$ExpectedSha256
)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$tools = [IO.Path]::GetFullPath((Join-Path $repo '.tools'))
$root = Join-Path $tools ('m2-wts-synthetic-' + $RunId)
$results = @()
$errorCode = $null
$session = [Diagnostics.Process]::GetCurrentProcess().SessionId
$cases = @(
    [pscustomobject]@{ mode = '--synthetic-lock'; code = 7; offset = 0; label = 'lock' }
    [pscustomobject]@{ mode = '--synthetic-disconnect'; code = 4; offset = 0; label = 'disconnect' }
    [pscustomobject]@{ mode = '--synthetic-mismatch'; code = 7; offset = 1; label = 'mismatch' }
)
function Require([bool]$condition, [string]$reason) {
    if (-not $condition) { throw [InvalidOperationException]::new($reason) }
}
try {
    Require ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) 'WINDOWS_REQUIRED'
    $exePath = [IO.Path]::GetFullPath($Executable)
    Require ($exePath.StartsWith($tools + [IO.Path]::DirectorySeparatorChar,
        [StringComparison]::OrdinalIgnoreCase) -and
        [IO.Path]::GetFileName($exePath) -ceq 'M2IntervalWitness.exe') 'UNTRUSTED_EXECUTABLE_PATH'
    $exe = Get-Item -LiteralPath $exePath -ErrorAction Stop
    Require (-not $exe.PSIsContainer -and
        -not ($exe.Attributes -band [IO.FileAttributes]::ReparsePoint)) 'UNTRUSTED_EXECUTABLE'
    $actualHash = (Get-FileHash -LiteralPath $exePath -Algorithm SHA256).Hash.ToLowerInvariant()
    Require ($actualHash -ceq $ExpectedSha256.ToLowerInvariant()) 'EXECUTABLE_HASH_MISMATCH'
    Require (-not (Test-Path -LiteralPath $root)) 'RUN_ID_ALREADY_USED'
    [void](New-Item -ItemType Directory -Path $root -ErrorAction Stop)
    foreach ($case in $cases) {
        $data = Join-Path $root $case.label
        [void](New-Item -ItemType Directory -Path $data -ErrorAction Stop)
        $start = [Diagnostics.ProcessStartInfo]::new()
        $start.FileName = $exePath
        $start.UseShellExecute = $false
        $start.CreateNoWindow = $true
        # Windows PowerShell 5.1's .NET Framework lacks ProcessStartInfo.ArgumentList.
        Require (-not $data.Contains('"') -and -not $data.Contains("`r") -and
            -not $data.Contains("`n")) 'UNTRUSTED_FIXTURE_PATH'
        $start.Arguments = '{0} "{1}" 2' -f $case.mode, $data
        $child = [Diagnostics.Process]::Start($start)
        Require ($null -ne $child) 'WITNESS_START_FAILED'
        try {
            if (-not $child.WaitForExit(12000)) {
                $child.Kill()
                [void]$child.WaitForExit(2000)
                throw 'WITNESS_TIMEOUT'
            }
            $exitCode = $child.ExitCode
        } finally {
            $child.Dispose()
        }
        Require ($exitCode -eq 2) 'UNEXPECTED_WITNESS_EXIT'
        $receiptPath = Join-Path $data 'witness.json'
        $item = Get-Item -LiteralPath $receiptPath -ErrorAction Stop
        Require (-not $item.PSIsContainer -and $item.Length -gt 150 -and
            $item.Length -lt 16000 -and
            -not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) 'INVALID_RECEIPT'
        $receipt = Get-Content -LiteralPath $receiptPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $targetSession = $session + $case.offset
        $matching = @($receipt.events | Where-Object {
            $_.Code -eq $case.code -and $_.SessionId -eq $targetSession
        })
        Require ($receipt.schemaVersion -eq 1 -and
            $receipt.status -ceq 'TRANSITION_OBSERVED' -and
            $receipt.sessionId -eq $session -and
            $receipt.syntheticSelfMessage -eq $true -and
            $receipt.syntheticEventCode -eq $case.code -and
            $receipt.syntheticEventSessionId -eq $targetSession -and
            $receipt.syntheticNotificationPosted -eq $true -and
            $receipt.syntheticPostSucceeded -eq $true -and
            $receipt.eventCount -ge 1 -and $matching.Count -ge 1 -and
            $receipt.eventOverflow -eq $false -and
            $receipt.subscriptionRegistered -eq $true -and
            $receipt.subscriptionUnregistered -eq $true -and
            $receipt.hiddenAndNotForeground -eq $true -and
            $receipt.sampleTimingInvalid -eq $false -and
            $receipt.safeForInput -eq $false -and
            $receipt.intervalVerified -eq $false -and
            $receipt.coverageVerified -eq $false) 'SYNTHETIC_RECEIPT_REJECTED'
        $results += [pscustomobject]@{
            mode = $case.mode; pass = $true; eventCode = $case.code
            eventSessionId = $targetSession; observedEvents = $receipt.eventCount
            status = $receipt.status
        }
    }
} catch {
    $reason = [string]$_.Exception.Message
    $errorCode = if ($reason -match '^[A-Z][A-Z_]{2,65}$') { $reason } else { 'MATRIX_EXCEPTION' }
}
$pass = $null -eq $errorCode -and $results.Count -eq $cases.Count
[pscustomobject]@{
    schemaVersion = 1; pass = $pass; syntheticOnly = $true; safeForInput = $false
    runId = $RunId; expectedSessionId = $session
    completedCases = $results.Count; cases = $results; errorCode = $errorCode
    evidenceDirectory = $root
} | ConvertTo-Json -Compress -Depth 5
if ($pass) { exit 0 } else { exit 2 }
