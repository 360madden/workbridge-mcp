#requires -Version 5.1
# Synthetic-only regression tests. Creates/cleans its own unique TEMP fixture;
# never reads the live Workbridge .tools quarantine and never queries live processes.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$targetScript = Join-Path $PSScriptRoot 'gui-turn-reconcile-readonly.ps1'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('workbridge-gui-turn-fixture-' + [Guid]::NewGuid().ToString('N'))
$leaseId = '8aed4916-1cf3-4100-bc1b-d56f2308585f'
$requestId = 'synthetic-request-readonly-test'
$acquired = '2026-11-02T20:46:12.574Z'
$ownerStart = '2026-11-01T09:00:00.000Z'
$utf8 = [Text.UTF8Encoding]::new($false)
function Json([object]$Value) { return ConvertTo-Json -InputObject $Value -Depth 12 -Compress }
function Sha([string]$Value) {
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($hasher.ComputeHash($utf8.GetBytes($Value))).Replace('-', '').ToLowerInvariant() }
    finally { $hasher.Dispose() }
}
function FileWrite([string]$Path, [string]$Value) { [IO.File]::WriteAllText($Path, $Value, $utf8) }
function Fixture([string]$Name) {
    $dir = Join-Path $testRoot $Name
    [IO.Directory]::CreateDirectory($dir) | Out-Null
    $lock = [ordered]@{
        schemaVersion = 1; kind = 'workbridge.gui-turn'; leaseId = $leaseId
        producer = 'desktop-capture-window'; requestId = $requestId
        owner = [ordered]@{ pid = 1000; processStartUtc = $null; sessionId = $null }
        target = [ordered]@{ kind = 'window'; pid = 17412; hwnd = 1382178; process = 'synthetic' }
        acquiredUtc = $acquired
    }
    $q = [ordered]@{
        schemaVersion = 1; kind = 'workbridge.gui-turn-quarantine'; leaseId = $leaseId
        requestId = $requestId; ownerStampSha256 = ''; intentSha256 = $null
        reasonCode = 'DESKTOP_TREE_UNSETTLED'; processTreeSettlement = 'unknown'
        automaticRetryAllowed = $false; createdUtc = '2026-11-02T20:46:28.188Z'
    }
    $now = [DateTime]::UtcNow
    $snapshot = [ordered]@{
        synthetic = $true; capturedAtUtc = $now.ToString('o'); probePid = 2000
        processes = @(
            [ordered]@{ pid = 1000; parentPid = 100; startUtc = $ownerStart; sessionId = 1 }
            [ordered]@{ pid = 1001; parentPid = 1000; startUtc = '2026-11-01T10:00:00Z'; sessionId = 1 }
            [ordered]@{ pid = 2000; parentPid = 1000; startUtc = $now.AddSeconds(-2).ToString('o'); sessionId = 1 }
        )
    }
    return @{ dir = $dir; lock = $lock; quarantine = $q; snapshot = $snapshot }
}
function Execute([string]$Name, [string]$ExpectedState, [scriptblock]$Mutate) {
    $case = Fixture $Name
    & $Mutate $case
    $lockPath = Join-Path $case.dir 'desktop-input-turn.lock'
    $sidePath = Join-Path $case.dir ('desktop-turn-quarantine-' + $leaseId + '.json')
    $inventoryPath = Join-Path $case.dir 'synthetic-inventory.json'
    $rawLock = Json $case.lock
    $case.quarantine.ownerStampSha256 = Sha $rawLock
    if ($Name -eq 'owner_stamp_hash_mismatch') { $case.quarantine.ownerStampSha256 = ('0' * 64) }
    FileWrite $lockPath $rawLock
    if ($Name -ne 'missing_sidecar') { FileWrite $sidePath (Json $case.quarantine) }
    FileWrite $inventoryPath (Json $case.snapshot)
    $beforeLock = (Get-FileHash -LiteralPath $lockPath -Algorithm SHA256).Hash
    $beforeSide = if (Test-Path -LiteralPath $sidePath) { (Get-FileHash -LiteralPath $sidePath -Algorithm SHA256).Hash } else { $null }
    $output = @(& $targetScript -LockPath $lockPath -QuarantinePath $sidePath -InventoryJson $inventoryPath -ExpectedLockSha256 (Sha $rawLock) -ExpectedLeaseId $leaseId -ExpectedRequestId $requestId)
    if ($output.Count -ne 1) { throw "${Name}: expected one output line, received $($output.Count)" }
    $result = ConvertFrom-Json -InputObject $output[0]
    if ($result.state -cne $ExpectedState) { throw "${Name}: expected $ExpectedState, got $($result.state) / $($result.reasonCode)" }
    if ($result.releaseEligible -ne $false -or $result.automaticRetryAllowed -ne $false -or
        $result.priorActionOutcome -cne 'unknown' -or $result.synthetic -ne $true -or
        $result.manualArchiveDecisionRequired -ne $true) { throw "${Name}: safety invariant violation" }
    if ((Get-FileHash -LiteralPath $lockPath -Algorithm SHA256).Hash -cne $beforeLock) { throw "${Name}: lock mutated" }
    $afterSide = if (Test-Path -LiteralPath $sidePath) { (Get-FileHash -LiteralPath $sidePath -Algorithm SHA256).Hash } else { $null }
    if ($afterSide -cne $beforeSide) { throw "${Name}: quarantine mutated" }
    Write-Output ([ordered]@{ case = $Name; state = $result.state; reason = $result.reasonCode })
}
$cases = @()
try {
    [IO.Directory]::CreateDirectory($testRoot) | Out-Null
    $cases += Execute 'clean_no_postlease' 'quarantined_no_present_descendant' { param($c) }
    $cases += Execute 'system_idle_pid_zero' 'quarantined_no_present_descendant' {
        param($c)
        $c.snapshot.processes += [ordered]@{ pid = 0; parentPid = 0; startUtc = $null; sessionId = 0 }
    }
    $cases += Execute 'candidate_descendant' 'quarantined_candidate_descendant_present' {
        param($c)
        $c.snapshot.processes += [ordered]@{ pid = 3000; parentPid = 1000
            startUtc = ([DateTime]::UtcNow.AddSeconds(-10)).ToString('o'); sessionId = 1 }
    }
    $cases += Execute 'owner_stamp_hash_mismatch' 'conflict' { param($c) }
    $cases += Execute 'owner_pid_reused' 'conflict' {
        param($c)
        $c.snapshot.processes[0].startUtc = '2026-11-03T09:00:00Z'
    }
    $cases += Execute 'stale_inventory' 'unknown' {
        param($c)
        $c.snapshot.capturedAtUtc = ([DateTime]::UtcNow.AddMinutes(-2)).ToString('o')
    }
    $cases += Execute 'quarantine_lease_mismatch' 'conflict' {
        param($c)
        $c.quarantine.leaseId = 'd521f371-2d35-4d2a-844f-90f9f7c71ff5'
    }
    $cases += Execute 'missing_sidecar' 'unknown' { param($c) }
    $cases += Execute 'owner_missing' 'unknown' {
        param($c)
        $c.snapshot.processes = @($c.snapshot.processes | Where-Object { $_.pid -ne 1000 })
    }
    $cases += Execute 'owner_start_matched' 'quarantined_no_present_descendant' {
        param($c)
        $c.lock.owner.processStartUtc = $ownerStart
        $c.lock.owner.sessionId = 1
    }
    Write-Output (Json ([ordered]@{ result = 'synthetic_pass'; count = $cases.Count; cases = $cases }))
} catch {
    Write-Error ("synthetic_fixture_failed: " + $_.Exception.Message)
    exit 1
} finally {
    # Only remove exactly the unique fixture we created under OS TEMP.
    if ($testRoot.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()), [StringComparison]::OrdinalIgnoreCase) -and
        [IO.Path]::GetFileName($testRoot) -like 'workbridge-gui-turn-fixture-*' -and
        [IO.Directory]::Exists($testRoot)) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}
