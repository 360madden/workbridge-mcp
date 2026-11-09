#Requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$SourceRoot,
    [Parameter(Mandatory)][string]$EvidenceDirectory,
    [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$')][string]$ReleaseId,
    [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$ExpectedHostname,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{40}$')][string]$SourceCommit,
    [Parameter(Mandatory)][string]$ProvenancePath,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{64}$')][string]$ExpectedProvenanceSha256,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{64}$')][string]$ExpectedBuilderSha256,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{64}$')][string]$ExpectedLifetimeSha256,
    [string]$WorkspaceRoot = 'C:\work',
    [ValidateRange(1, 1140)][int]$TimeoutSeconds = 1140
)
$ErrorActionPreference = 'Stop'
$clock = [Diagnostics.Stopwatch]::StartNew()
# This dedicated process does not need the caller's tunnel credential.
$env:CONTROL_PLANE_API_KEY = $null

function Get-WBValidationPath([string]$Path) {
    if (![IO.Path]::IsPathFullyQualified($Path)) { throw 'Validation paths must be absolute.' }
    $full = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    $ancestor = $full
    while ($ancestor) {
        if ((Test-Path -LiteralPath $ancestor) -and
            ((Get-Item -LiteralPath $ancestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'Validation paths cannot contain links or junctions.'
        }
        $ancestor = Split-Path -Parent $ancestor
    }
    return $full
}

function Write-WBValidationJson([string]$Path, [object]$Value) {
    # Immutable event files: never truncate or replace an earlier run receipt.
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes((ConvertTo-Json -InputObject $Value -Depth 12))
    $stream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
    try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
}

if (![OperatingSystem]::IsWindows()) { throw 'Bounded release validation requires Windows.' }
if (![string]::Equals([Environment]::MachineName, $ExpectedHostname, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Validation machine identity mismatch.'
}
$workspace = Get-WBValidationPath $WorkspaceRoot
$source = Get-WBValidationPath $SourceRoot
$evidence = Get-WBValidationPath $EvidenceDirectory
$provenance = Get-WBValidationPath $ProvenancePath
foreach ($path in @($source, $evidence, $provenance)) {
    if (!$path.StartsWith($workspace + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Validation paths must be strictly inside the selected workspace.'
    }
}
if ($source -eq $evidence -or $evidence.StartsWith($source + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Validation evidence must be outside the source snapshot.'
}
if (Test-Path -LiteralPath $evidence) { throw 'Validation evidence already exists; inspect the original run instead of replaying.' }
if (!(Test-Path -LiteralPath (Split-Path -Parent $evidence) -PathType Container)) { throw 'Validation evidence parent must exist.' }
if (!(Test-Path -LiteralPath $source -PathType Container) -or
    (Test-Path -LiteralPath (Join-Path $source '.git')) -or
    (Test-Path -LiteralPath (Join-Path $source '.local'))) {
    throw 'Validation requires a fresh source archive, not a live checkout or an earlier release.'
}
if ((Get-FileHash -LiteralPath $provenance -Algorithm SHA256).Hash.ToLowerInvariant() -cne $ExpectedProvenanceSha256) {
    throw 'Validation provenance hash mismatch.'
}
$origin = Get-Content -LiteralPath $provenance -Raw | ConvertFrom-Json
if ($origin.sourceCommit -cne $SourceCommit -or $origin.sourceRoot -cne $source) {
    throw 'Validation provenance does not match the selected source commit and directory.'
}
$builder = Get-WBValidationPath (Join-Path $source 'scripts\New-WorkbridgeRelease.ps1')
$lifetime = Get-WBValidationPath (Join-Path $source 'scripts\Desktop-JobLifetime.cs')
if ((Get-FileHash -LiteralPath $builder -Algorithm SHA256).Hash.ToLowerInvariant() -cne $ExpectedBuilderSha256) {
    throw 'Validation builder hash mismatch.'
}
$lifetimeHash = $ExpectedLifetimeSha256
if ((Get-FileHash -LiteralPath $lifetime -Algorithm SHA256).Hash.ToLowerInvariant() -cne $lifetimeHash) {
    throw 'Validation process-lifetime helper hash mismatch.'
}
Add-Type -Path $lifetime
# Attach this wrapper before creating any validation child. A hard task stop or
# wrapper crash closes the private non-inherited handle and kills its descendants.
[Workbridge.DesktopJobLifetime]::Attach()
if ([Workbridge.DesktopJobLifetime]::ActiveProcesses() -ne 1) { throw 'Validation process-tree assignment is not exclusive.' }

Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Threading.Tasks;
namespace Workbridge {
    public sealed class ValidationPumpResult {
        public long Bytes;
        public bool Truncated;
    }
    public static class ValidationOutput {
        public static async Task<ValidationPumpResult> Pump(Stream input, string path, long limit) {
            var result = new ValidationPumpResult();
            var buffer = new byte[8192];
            using (var output = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.Read)) {
                int count;
                while ((count = await input.ReadAsync(buffer, 0, buffer.Length).ConfigureAwait(false)) != 0) {
                    int keep = (int)Math.Min(count, Math.Max(0, limit - result.Bytes));
                    if (keep > 0) await output.WriteAsync(buffer, 0, keep).ConfigureAwait(false);
                    result.Bytes += keep;
                    if (keep != count) result.Truncated = true;
                }
                output.Flush(true);
            }
            return result;
        }
    }
}
'@

$null = [IO.Directory]::CreateDirectory($evidence)
$release = Join-Path $source ('.local\releases\' + $ReleaseId)
$receiptPath = Join-Path $release 'validated.json'
$process = [Diagnostics.Process]::new()
$startedUtc = [DateTime]::UtcNow.ToString('o')
$record = [ordered]@{
    schemaVersion = 1; result = 'running'; machine = [Environment]::MachineName
    sourceCommit = $SourceCommit; sourceRoot = $source; releaseId = $ReleaseId; releasePath = $release
    provenanceSha256 = $ExpectedProvenanceSha256; builderSha256 = $ExpectedBuilderSha256; lifetimeSha256 = $lifetimeHash
    wrapperPid = $PID; wrapperStartedUtc = [Diagnostics.Process]::GetCurrentProcess().StartTime.ToUniversalTime().ToString('o')
    startedUtc = $startedUtc; timeoutSeconds = $TimeoutSeconds; taskHardLimitSeconds = 1200
    outputLimitBytesPerStream = 4194304; childPid = $null; childExitCode = $null
    activeProcesses = $null; error = $null; receiptSha256 = $null; elapsedSeconds = 0
}
$exitCode = 1
try {
    Write-WBValidationJson (Join-Path $evidence 'started.json') $record
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = [Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
    $info.WorkingDirectory = $source
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.Environment.Remove('CONTROL_PLANE_API_KEY') | Out-Null
    foreach ($argument in @('-NoLogo', '-NoProfile', '-NonInteractive', '-File', $builder,
        '-SourceRoot', $source, '-ReleaseId', $ReleaseId, '-WorkspaceRoot', $workspace,
        '-RefreshUserEnvironment', '-SerialTests')) { $info.ArgumentList.Add($argument) }
    $process.StartInfo = $info
    if (!$process.Start()) { throw 'Validation builder could not start.' }
    $record.childPid = $process.Id
    Write-WBValidationJson (Join-Path $evidence 'child.json') ([ordered]@{
        pid = $process.Id; startedUtc = $process.StartTime.ToUniversalTime().ToString('o'); executable = $info.FileName
    })
    $stdout = [Workbridge.ValidationOutput]::Pump($process.StandardOutput.BaseStream, (Join-Path $evidence 'stdout.log'), 4194304)
    $stderr = [Workbridge.ValidationOutput]::Pump($process.StandardError.BaseStream, (Join-Path $evidence 'stderr.log'), 4194304)
    while (!$process.WaitForExit(250)) {
        if ($clock.Elapsed.TotalSeconds -ge $TimeoutSeconds) {
            $exitCode = 124
            throw 'Validation soft deadline exceeded.'
        }
    }
    $record.childExitCode = $process.ExitCode
    if ($clock.Elapsed.TotalSeconds -ge $TimeoutSeconds) {
        $exitCode = 124
        throw 'Validation completed after its soft deadline.'
    }
    if (![Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]@($stdout, $stderr), 5000)) {
        throw 'Validation output streams did not settle.'
    }
    if ($stdout.Result.Truncated -or $stderr.Result.Truncated) { throw 'Validation output exceeded its bounded capture; success is not accepted.' }
    if ($process.ExitCode -ne 0) { throw "Validation builder exited $($process.ExitCode); inspect its retained gate logs." }
    $settleClock = [Diagnostics.Stopwatch]::StartNew()
    do {
        $record.activeProcesses = [Workbridge.DesktopJobLifetime]::ActiveProcesses()
        if ($record.activeProcesses -eq 1) { break }
        Start-Sleep -Milliseconds 100
    } while ($settleClock.Elapsed.TotalSeconds -lt 5 -and $clock.Elapsed.TotalSeconds -lt $TimeoutSeconds)
    if ($record.activeProcesses -ne 1) { throw 'Validation descendants remain; success is not accepted.' }
    $receipt = Get-Content -LiteralPath (Get-WBValidationPath $receiptPath) -Raw | ConvertFrom-Json
    if ($receipt.result -cne 'passed' -or $receipt.testProfile.name -cne 'serial-files' -or $receipt.testProfile.fileConcurrency -ne 1) {
        throw 'Validation receipt is absent or does not certify the complete serial profile.'
    }
    $record.receiptSha256 = (Get-FileHash -LiteralPath $receiptPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $record.result = 'passed'
    $exitCode = 0
} catch {
    $record.result = if ($exitCode -eq 124) { 'timed_out' } else { 'failed' }
    $record.error = $_.Exception.Message
    if ($record.error.Length -gt 2000) { $record.error = $record.error.Substring(0, 2000) }
} finally {
    if ($null -ne $record.childPid -and !$process.HasExited) {
        try { $process.Kill($true); $null = $process.WaitForExit(5000) }
        catch { $record.result = 'failed'; $record.error = 'Validation child cleanup failed; the private Job will terminate descendants on wrapper exit.'; $exitCode = 1 }
    }
    try { $record.activeProcesses = [Workbridge.DesktopJobLifetime]::ActiveProcesses() }
    catch { $record.result = 'failed'; $record.error = 'Validation process-tree accounting failed.'; $exitCode = 1 }
    if ($record.result -eq 'passed' -and $record.activeProcesses -ne 1) {
        $record.result = 'failed'; $record.error = 'Validation descendants remain at completion.'; $exitCode = 1
    }
    if ($record.result -eq 'passed' -and $clock.Elapsed.TotalSeconds -ge $TimeoutSeconds) {
        $record.result = 'timed_out'; $record.error = 'Validation exceeded its soft deadline before completion.'; $exitCode = 124
    }
    if ($record.result -ne 'passed' -and (Test-Path -LiteralPath $receiptPath -PathType Leaf)) {
        # Retain but disqualify any builder receipt created before a wrapper-level
        # failure. Root must require this runner's completed.json as well.
        Move-Item -LiteralPath $receiptPath -Destination (Join-Path $release 'validated.runner-blocked.json') -ErrorAction Stop
    }
    $record.elapsedSeconds = [math]::Round($clock.Elapsed.TotalSeconds, 3)
    $record.endedUtc = [DateTime]::UtcNow.ToString('o')
    Write-WBValidationJson (Join-Path $evidence 'completed.json') $record
    $process.Dispose()
}
[Console]::WriteLine((ConvertTo-Json -InputObject $record -Depth 12 -Compress))
exit $exitCode
