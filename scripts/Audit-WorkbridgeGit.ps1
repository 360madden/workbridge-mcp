#requires -Version 5.1
<#
.SYNOPSIS
  Audit a Git baseline and suggest small review groups without changing it.
.DESCRIPTION
  Emits JSON only. Reuses plan-scoped-git-checkpoints.mjs for NUL-delimited
  Git status parsing and candidate grouping. Reads Git identity and index
  hashes, never source contents, recovery-file contents, or the live service.
  Exit 0: completed inventory (including dirty/recovery states); 1: failed or
  changing inventory. Candidates are suggestions, never staging instructions.
.EXAMPLE
  powershell.exe -NoProfile -File scripts/Audit-WorkbridgeGit.ps1 -RepositoryPath C:\work\workbridge-mcp
#>
[CmdletBinding()]
param(
    [string] $RepositoryPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function ConvertTo-NativeArgument {
    param([string] $Value)
    # Windows CommandLineToArgvW quoting, including trailing backslashes.
    return '"' + ([regex]::Replace(
        [regex]::Replace($Value, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1')) + '"'
}

function Invoke-AuditProcess {
    param(
        [string] $Executable,
        [string[]] $ArgumentList,
        [int] $TimeoutMs = 10000,
        [int] $MaxChars = 8388608
    )
    $info = [System.Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $Executable
    $info.Arguments = (($ArgumentList | ForEach-Object { ConvertTo-NativeArgument $_ }) -join ' ')
    $info.WorkingDirectory = $script:repository
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.StandardOutputEncoding = [System.Text.UTF8Encoding]::new($false, $true)
    $info.StandardErrorEncoding = [System.Text.UTF8Encoding]::new($false, $true)
    # Windows permits inherited Path/PATH duplicates; .NET Framework's lazy
    # StringDictionary initialization throws on those. Rebuild it case-insensitively.
    try { $childEnvironment = $info.get_EnvironmentVariables() } catch [System.ArgumentException] {
        $childEnvironment = $info.get_EnvironmentVariables()
    }
    $childEnvironment.Clear()
    # Do not inherit alternate repositories/indexes or tracing output files.
    # Preserve caller Git configuration (including sandbox safe.directory grants);
    # per-command flags still disable fsmonitor, optional locks and external diffs.
    # Changes apply only to these child processes.
    foreach ($entry in [Environment]::GetEnvironmentVariables().GetEnumerator()) {
        if ([string]$entry.Key -notlike 'GIT_*' -or [string]$entry.Key -like 'GIT_CONFIG*') {
            $childEnvironment[[string]$entry.Key] = [string]$entry.Value
        }
    }
    $childEnvironment['GIT_OPTIONAL_LOCKS'] = '0'
    $childEnvironment['GIT_TERMINAL_PROMPT'] = '0'
    $childEnvironment['GIT_NO_LAZY_FETCH'] = '1'
    $childEnvironment['GIT_NO_REPLACE_OBJECTS'] = '1'
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $info
    $started = $false
    try {
        if (-not $process.Start()) { throw 'PROCESS_START_FAILED' }
        $started = $true
        $clock = [System.Diagnostics.Stopwatch]::StartNew()
        $output = [System.Text.StringBuilder]::new()
        $outBuffer = [char[]]::new(4096)
        $errBuffer = [char[]]::new(4096)
        $outRead = $process.StandardOutput.ReadAsync($outBuffer, 0, $outBuffer.Length)
        $errRead = $process.StandardError.ReadAsync($errBuffer, 0, $errBuffer.Length)
        $outDone = $false
        $errDone = $false
        $errChars = 0
        while (-not ($outDone -and $errDone -and $process.HasExited)) {
            if ($clock.ElapsedMilliseconds -gt $TimeoutMs) { throw 'PROCESS_TIMEOUT' }
            if (-not $outDone -and $outRead.IsCompleted) {
                $count = $outRead.GetAwaiter().GetResult()
                if ($count -eq 0) { $outDone = $true } else {
                    if ($output.Length + $count -gt $MaxChars) { throw 'PROCESS_OUTPUT_LIMIT' }
                    [void]$output.Append($outBuffer, 0, $count)
                    $outRead = $process.StandardOutput.ReadAsync($outBuffer, 0, $outBuffer.Length)
                }
            }
            if (-not $errDone -and $errRead.IsCompleted) {
                $count = $errRead.GetAwaiter().GetResult()
                if ($count -eq 0) { $errDone = $true } else {
                    $errChars += $count
                    if ($errChars -gt $MaxChars) { throw 'PROCESS_OUTPUT_LIMIT' }
                    $errRead = $process.StandardError.ReadAsync($errBuffer, 0, $errBuffer.Length)
                }
            }
            if (-not ($outDone -and $errDone -and $process.HasExited)) { Start-Sleep -Milliseconds 5 }
        }
        $process.WaitForExit()
        return [pscustomobject]@{ exitCode = $process.ExitCode; output = $output.ToString() }
    } finally {
        if ($started -and -not $process.HasExited) {
            $process.Kill()
            [void]$process.WaitForExit(1000)
        }
        $process.Dispose()
    }
}

function Invoke-AuditGit {
    param([string[]] $GitArguments, [int[]] $AllowedExitCodes = @(0))
    $prefix = @('--no-optional-locks', '--no-pager', '-c', 'core.fsmonitor=false',
        '-c', 'core.untrackedCache=false', '-C', $script:repository)
    $result = Invoke-AuditProcess -Executable $script:git -ArgumentList ($prefix + $GitArguments)
    if ($result.exitCode -notin $AllowedExitCodes) { throw 'GIT_READ_FAILED' }
    return $result
}

function Get-AuditBaseline {
    $headResult = Invoke-AuditGit -GitArguments @('rev-parse', '--verify', '--quiet', 'HEAD^{commit}') -AllowedExitCodes @(0, 1)
    $head = $null
    if ($headResult.exitCode -eq 0) {
        $head = $headResult.output.Trim()
        if ($head -notmatch '^(?:[a-f0-9]{40}|[a-f0-9]{64})$') { throw 'INVALID_GIT_IDENTITY' }
    }
    $branchResult = Invoke-AuditGit -GitArguments @('symbolic-ref', '--quiet', 'HEAD') -AllowedExitCodes @(0, 1)
    $branch = $null
    if ($branchResult.exitCode -eq 0) { $branch = $branchResult.output.TrimEnd([char[]]"`r`n") }
    if ($null -eq $head -and $null -eq $branch) { throw 'INVALID_GIT_IDENTITY' }
    $markers = @($script:recoveryNames | Where-Object {
        Test-Path -LiteralPath $script:gitPaths[$_] -ErrorAction Stop
    })
    $indexExists = Test-Path -LiteralPath $script:gitPaths['index'] -PathType Leaf
    $indexHash = $null
    if ($indexExists) {
        $indexHash = (Get-FileHash -LiteralPath $script:gitPaths['index'] -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    return [ordered]@{
        head = $head
        headRef = $branch
        detached = ($null -eq $branch)
        unborn = ($null -eq $head)
        indexExists = [bool]$indexExists
        indexSha256 = $indexHash
        recoveryMarkers = $markers
    }
}

try {
    if (-not $PSBoundParameters.ContainsKey('RepositoryPath')) {
        $RepositoryPath = Split-Path -Parent $PSScriptRoot
    }
    if ([string]::IsNullOrWhiteSpace($RepositoryPath)) { throw 'INVALID_REPOSITORY' }
    $resolved = Resolve-Path -LiteralPath $RepositoryPath -ErrorAction Stop
    if ($resolved.Provider.Name -ne 'FileSystem' -or -not [System.IO.Directory]::Exists($resolved.ProviderPath)) {
        throw 'INVALID_REPOSITORY'
    }
    $script:repository = $resolved.ProviderPath
    $gitCommand = Get-Command -Name git -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    $nodeCommand = Get-Command -Name node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $gitCommand) { throw 'GIT_NOT_AVAILABLE' }
    if ($null -eq $nodeCommand) { throw 'NODE_NOT_AVAILABLE' }
    $script:git = $gitCommand.Source
    $planner = Join-Path $PSScriptRoot 'plan-scoped-git-checkpoints.mjs'
    if (-not (Test-Path -LiteralPath $planner -PathType Leaf)) { throw 'CHECKPOINT_PLANNER_NOT_AVAILABLE' }
    $plannerHash = (Get-FileHash -LiteralPath $planner -Algorithm SHA256).Hash.ToLowerInvariant()
    $rootResult = Invoke-AuditGit -GitArguments @('rev-parse', '--show-toplevel')
    $script:repository = $rootResult.output.TrimEnd([char[]]"`r`n")
    if (-not [System.IO.Directory]::Exists($script:repository)) { throw 'INVALID_REPOSITORY' }
    # --git-path handles linked worktrees rather than assuming .git is a directory.
    $script:recoveryNames = @('index.lock', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD',
        'rebase-apply', 'rebase-merge', 'sequencer', 'BISECT_LOG')
    $names = @('index') + $script:recoveryNames
    $pathArgs = @('rev-parse', '--path-format=absolute')
    foreach ($name in $names) { $pathArgs += @('--git-path', $name) }
    $pathResult = Invoke-AuditGit -GitArguments $pathArgs
    $paths = $pathResult.output.TrimEnd([char[]]"`r`n") -split "`r?`n"
    if ($paths.Count -ne $names.Count) { throw 'INVALID_GIT_IDENTITY' }
    $script:gitPaths = @{}
    for ($i = 0; $i -lt $names.Count; $i++) { $script:gitPaths[$names[$i]] = $paths[$i] }
    $before = Get-AuditBaseline
    # Use the existing parser/grouping library, not its diff runner. Git diff can
    # refresh an index even with optional locks disabled; conflict numstat may
    # also repeat paths. This audit needs metadata only, so never invokes diff.
    $adapter = @'
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
(async () => {
  // The first -e argument is deliberately NOT the imported module path:
  // its CLI entrypoint would otherwise run during import and set process.exitCode.
  const { buildCheckpointPlan, serializePlan, plannerLimits } = await import(pathToFileURL(process.argv[2]).href);
  const args = ['--no-optional-locks', '--no-pager', '-c', 'core.fsmonitor=false',
    '-c', 'core.untrackedCache=false', '-c', 'diff.autoRefreshIndex=false',
    'status', '--porcelain=v1', '-uall', '-z', '--ignore-submodules=all'];
  const read = () => execFileSync(process.argv[4], args, {
    cwd: process.argv[3], timeout: plannerLimits.timeoutMs, maxBuffer: plannerLimits.maxBytes,
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
  });
  const before = read();
  const plan = buildCheckpointPlan({ status: before });
  if (!before.equals(read())) throw Error('STATUS_CHANGED_DURING_AUDIT');
  process.stdout.write(serializePlan(plan));
})().catch(() => { process.exitCode = 1; });
'@
    $planResult = Invoke-AuditProcess -Executable $nodeCommand.Source -ArgumentList @('-e', $adapter,
        'audit-internal-wrapper', $planner, $script:repository, $script:git) -TimeoutMs 30000
    if ($planResult.exitCode -ne 0) { throw 'CHECKPOINT_PLAN_FAILED' }
    $plan = $planResult.output | ConvertFrom-Json
    if ($plan.schemaVersion -ne 1 -or $plan.mode -ne 'read-only-checkpoint-plan' -or
        -not $plan.complete -or -not $plan.readOnly -or $plan.indexWrites -or $plan.actionableGroups -ne 0) {
        throw 'INVALID_CHECKPOINT_PLAN'
    }
    $after = Get-AuditBaseline
    if (($before | ConvertTo-Json -Compress) -cne ($after | ConvertTo-Json -Compress)) {
        throw 'BASELINE_CHANGED_DURING_AUDIT'
    }
    if ($plannerHash -cne (Get-FileHash -LiteralPath $planner -Algorithm SHA256).Hash.ToLowerInvariant()) {
        throw 'PLANNER_CHANGED_DURING_AUDIT'
    }
    $entries = @(@($plan.candidateGroups | ForEach-Object { $_.files }) +
        @($plan.unreviewedFiles) + @($plan.excludedFiles) | Sort-Object -Property path)
    $tracked = @($entries | Where-Object { -not $_.untracked })
    $untracked = @($entries | Where-Object { $_.untracked })
    if ($entries.Count -ne $plan.counts.statusEntries) { throw 'INVALID_CHECKPOINT_PLAN' }
    $candidates = @($plan.candidateGroups)
    $warnings = @($plan.warnings) + @([pscustomobject]@{
        code = 'BASELINE_HASH_LIMITS'
        message = 'HEAD, index hash and recovery-marker presence agreed before/after. This is not an atomic snapshot or a backup; shared-index contents and source hashes are not inventoried.'
    }, [pscustomobject]@{
        code = 'STATUS_METADATA_ONLY'
        message = 'Only status metadata is grouped. No Git diff or numstat was requested; line-count arrays are empty. Ownership, dependencies, contents and recovery correctness require separate review.'
    })
    if ($before.recoveryMarkers.Count -gt 0) {
        $candidates = @()
        $warnings += [pscustomobject]@{
            code = 'RECOVERY_STATE_REQUIRES_REVIEW'
            message = 'Recovery markers or index.lock exist. All commit candidates are withheld; no recovery or lock removal was attempted.'
        }
    }
    [ordered]@{
        schemaVersion = 1
        mode = 'read-only-git-baseline-audit'
        ok = $true
        complete = $true
        readOnly = $true
        indexWrites = $false
        inspectedUtc = [DateTime]::UtcNow.ToString('o')
        repository = $script:repository
        baseline = $before
        baselineAgreedBeforeAfter = $true
        checkpointPlannerSha256 = $plannerHash
        counts = [ordered]@{
            tracked = $tracked.Count
            untracked = $untracked.Count
            staged = $plan.counts.stagedEntries
            candidateCommits = $candidates.Count
            excluded = $plan.counts.excludedEntries
            unreviewed = $plan.counts.unreviewedEntries
        }
        groups = [ordered]@{ tracked = $tracked; untracked = $untracked }
        candidateCommits = $candidates
        warnings = $warnings
    } | ConvertTo-Json -Depth 30
    exit 0
} catch {
    $code = $_.Exception.Message
    $safeCodes = @('INVALID_REPOSITORY', 'GIT_NOT_AVAILABLE', 'NODE_NOT_AVAILABLE',
        'CHECKPOINT_PLANNER_NOT_AVAILABLE', 'PROCESS_START_FAILED', 'PROCESS_TIMEOUT',
        'PROCESS_OUTPUT_LIMIT', 'GIT_READ_FAILED', 'INVALID_GIT_IDENTITY',
        'CHECKPOINT_PLAN_FAILED', 'INVALID_CHECKPOINT_PLAN', 'BASELINE_CHANGED_DURING_AUDIT',
        'PLANNER_CHANGED_DURING_AUDIT')
    if ($code -notin $safeCodes) { $code = 'AUDIT_FAILED' }
    [ordered]@{
        schemaVersion = 1; ok = $false; complete = $false; readOnly = $true
        indexWrites = $false; candidateCommits = @(); error = $code
    } | ConvertTo-Json -Compress
    exit 1
}
