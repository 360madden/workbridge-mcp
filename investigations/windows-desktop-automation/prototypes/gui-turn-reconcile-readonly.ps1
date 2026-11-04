#requires -Version 5.1
<#
Read-only classifier for Workbridge desktop-input-turn quarantine.
It NEVER deletes, moves, rewrites, unlocks, resumes a process, performs UI input,
or claims success/settlement of the historical capture.

Optional -InventoryJson is for synthetic, isolated fixtures only. Its result is
clearly marked synthetic and must never be used to support a live recovery.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$LockPath,
    [Parameter(Mandatory = $true)][string]$QuarantinePath,
    [string]$ExpectedLockSha256,
    [string]$ExpectedLeaseId,
    [string]$ExpectedRequestId,
    [string]$InventoryJson
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Fail([string]$Code) { throw [System.InvalidOperationException]::new($Code) }
function Utc([object]$Value) {
    if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) { Fail 'TIME_MISSING' }
    try {
        return [DateTimeOffset]::Parse([string]$Value,
            [Globalization.CultureInfo]::InvariantCulture,
            [Globalization.DateTimeStyles]::RoundtripKind).UtcDateTime
    } catch { Fail 'TIME_INVALID' }
}
function FileEvidence([string]$Path, [int]$MaximumBytes = 4096) {
    if (-not [IO.File]::Exists($Path)) { Fail 'EVIDENCE_MISSING' }
    $item = Get-Item -LiteralPath $Path -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
        ($item.Attributes -band [IO.FileAttributes]::Directory) -ne 0) { Fail 'EVIDENCE_NOT_REGULAR' }
    if ($item.Length -lt 2 -or $item.Length -gt $MaximumBytes) { Fail 'EVIDENCE_SIZE' }
    $bytes = [IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -ne $item.Length) { Fail 'EVIDENCE_CHANGED' }
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { $sha = [BitConverter]::ToString($hasher.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant() }
    finally { $hasher.Dispose() }
    try {
        $utf8 = [Text.UTF8Encoding]::new($false, $true)
        $parsed = ConvertFrom-Json -InputObject ($utf8.GetString($bytes)) -ErrorAction Stop
    } catch { Fail 'EVIDENCE_JSON_INVALID' }
    if ($null -eq $parsed -or $parsed -isnot [pscustomobject]) { Fail 'EVIDENCE_JSON_SHAPE' }
    $after = Get-Item -LiteralPath $Path -Force
    if ($after.Length -ne $item.Length -or $after.LastWriteTimeUtc -ne $item.LastWriteTimeUtc) { Fail 'EVIDENCE_CHANGED' }
    return @{ sha = $sha; value = $parsed }
}
function Number([object]$Value) {
    [long]$n = 0
    if ($null -eq $Value -or -not [long]::TryParse([string]$Value, [ref]$n) -or $n -lt 0 -or $n -gt 2147483647) {
        Fail 'INVENTORY_PID_INVALID'
    }
    return [int]$n
}
function Snapshot {
    if (-not [string]::IsNullOrEmpty($InventoryJson)) {
        $item = FileEvidence $InventoryJson 262144
        $snapshot = $item.value
        if ($snapshot.synthetic -ne $true) { Fail 'FIXTURE_FLAG_REQUIRED' }
        return $snapshot
    }
    $start = [DateTime]::UtcNow
    $observed = @(Get-CimInstance -ClassName Win32_Process -Property ProcessId,ParentProcessId,CreationDate,SessionId,Name -ErrorAction Stop)
    $end = [DateTime]::UtcNow
    if (($end - $start).TotalSeconds -gt 15 -or $observed.Count -lt 1) { Fail 'INVENTORY_SLOW_OR_EMPTY' }
    $rows = @(
        foreach ($process in $observed) {
            if ([int]$process.ProcessId -eq 0) { continue } # Windows System Idle sentinel, not a live child.
            if ($null -eq $process.CreationDate) { Fail 'INVENTORY_CREATION_MISSING' }
            @{
                pid = [int]$process.ProcessId
                parentPid = [int]$process.ParentProcessId
                startUtc = ([DateTimeOffset]$process.CreationDate).UtcDateTime.ToString('o')
                sessionId = [int]$process.SessionId
            }
        }
    )
    return @{ synthetic = $false; capturedAtUtc = $end.ToString('o'); probePid = [int]$PID; processes = $rows }
}

$report = [ordered]@{
    schemaVersion = 1
    kind = 'workbridge.gui-turn-readonly-reconcile'
    state = 'unknown'
    reasonCode = 'NOT_CLASSIFIED'
    synthetic = (-not [string]::IsNullOrEmpty($InventoryJson))
    checkedAtUtc = [DateTime]::UtcNow.ToString('o')
    leaseId = $null
    requestId = $null
    ownerPid = $null
    ownerIdentity = 'unverified'
    capturedAtUtc = $null
    baselineDescendantCount = $null
    postLeaseCandidateCount = $null
    ownProbeBranchExcludedCount = $null
    releaseEligible = $false
    automaticRetryAllowed = $false
    priorActionOutcome = 'unknown'
    historicalTreeSettled = 'unverified'
    manualArchiveDecisionRequired = $true
}
try {
    if ([IO.Path]::GetFileName($LockPath) -cne 'desktop-input-turn.lock') { Fail 'LOCK_NAME_INVALID' }
    $lockDir = [IO.Path]::GetFullPath([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($LockPath)))
    $sideDir = [IO.Path]::GetFullPath([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($QuarantinePath)))
    if (-not $lockDir.Equals($sideDir, [StringComparison]::OrdinalIgnoreCase)) { Fail 'EVIDENCE_DIRECTORY_MISMATCH' }

    $lock = FileEvidence $LockPath
    $lease = $lock.value
    if ($lease.schemaVersion -ne 1 -or $lease.kind -cne 'workbridge.gui-turn' -or
        [string]$lease.leaseId -cnotmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' -or
        [string]::IsNullOrWhiteSpace([string]$lease.requestId) -or
        $null -eq $lease.owner -or $null -eq $lease.target) { Fail 'LOCK_SCHEMA_INVALID' }
    $ownerPid = Number $lease.owner.pid
    if ($ownerPid -le 0) { Fail 'LOCK_OWNER_PID_INVALID' }
    $acquired = Utc $lease.acquiredUtc
    $report.leaseId = [string]$lease.leaseId
    $report.requestId = [string]$lease.requestId
    $report.ownerPid = $ownerPid
    if ($ExpectedLockSha256 -and $lock.sha -cne $ExpectedLockSha256.ToLowerInvariant()) { Fail 'LOCK_PIN_CONFLICT' }
    if ($ExpectedLeaseId -and $ExpectedLeaseId -cne $lease.leaseId) { Fail 'LEASE_PIN_CONFLICT' }
    if ($ExpectedRequestId -and $ExpectedRequestId -cne $lease.requestId) { Fail 'REQUEST_PIN_CONFLICT' }

    $expectedQuarantineName = 'desktop-turn-quarantine-' + $lease.leaseId + '.json'
    if ([IO.Path]::GetFileName($QuarantinePath) -cne $expectedQuarantineName) { Fail 'QUARANTINE_NAME_CONFLICT' }
    $side = FileEvidence $QuarantinePath
    $q = $side.value
    if ($q.schemaVersion -ne 1 -or $q.kind -cne 'workbridge.gui-turn-quarantine' -or
        $q.leaseId -cne $lease.leaseId -or $q.requestId -cne $lease.requestId -or
        $q.ownerStampSha256 -cne $lock.sha -or $q.automaticRetryAllowed -cne $false -or
        $q.processTreeSettlement -cne 'unknown' -or $q.reasonCode -cne 'DESKTOP_TREE_UNSETTLED') {
        Fail 'QUARANTINE_IDENTITY_CONFLICT'
    }
    if ($null -ne $q.intentSha256) { Fail 'INTENT_RECEIPT_NOT_INSPECTED' }
    $created = Utc $q.createdUtc
    if ($created -lt $acquired.AddSeconds(-2)) { Fail 'QUARANTINE_TIME_CONFLICT' }

    $snapshot = Snapshot
    $captured = Utc $snapshot.capturedAtUtc
    $now = [DateTime]::UtcNow
    if ($captured -lt $now.AddSeconds(-30) -or $captured -gt $now.AddSeconds(5)) { Fail 'INVENTORY_NOT_FRESH' }
    $report.capturedAtUtc = $captured.ToString('o')
    if ($null -eq $snapshot.processes) { Fail 'INVENTORY_MISSING' }
    $byId = @{}
    foreach ($item in @($snapshot.processes)) {
        if ($null -eq $item) { Fail 'INVENTORY_NULL_ENTRY' }
        $id = Number $item.pid
        $parent = Number $item.parentPid
        if ($id -eq 0) { continue } # Also tolerate explicit PID-0 synthetic rows.
        if ($byId.ContainsKey($id)) { Fail 'INVENTORY_DUPLICATE_PID' }
        $started = Utc $item.startUtc
        if ($started -gt $captured.AddSeconds(5)) { Fail 'INVENTORY_FUTURE_PROCESS' }
        $byId[$id] = @{
            pid = $id; parentPid = $parent; start = $started; sessionId = Number $item.sessionId
        }
    }
    if (-not $byId.ContainsKey($ownerPid)) { Fail 'OWNER_PID_NOT_PRESENT' }
    $owner = $byId[$ownerPid]
    if ($owner.start -gt $acquired.AddSeconds(2)) { Fail 'OWNER_PID_REUSED' }
    if ($null -ne $lease.owner.processStartUtc) {
        $stamped = Utc $lease.owner.processStartUtc
        if ([Math]::Abs(($owner.start - $stamped).TotalSeconds) -gt 2) { Fail 'OWNER_START_CONFLICT' }
        $report.ownerIdentity = 'pid_start_matched'
    } else { $report.ownerIdentity = 'pid_only_start_unpinned' }
    if ($null -ne $lease.owner.sessionId -and (Number $lease.owner.sessionId) -ne $owner.sessionId) {
        Fail 'OWNER_SESSION_CONFLICT'
    }

    # The inspecting pwsh/Workbridge command is itself a recent owner descendant.
    # Exclude exactly its ancestor chain to owner and children of the probe,
    # never unrelated sibling process branches.
    $probePid = Number $snapshot.probePid
    $probeAncestors = [Collections.Generic.HashSet[int]]::new()
    $cursor = $probePid
    $probeIsDescendant = $false
    for ($depth = 0; $depth -lt 80; $depth++) {
        if (-not $byId.ContainsKey($cursor)) { break }
        if (-not $probeAncestors.Add($cursor)) { Fail 'INVENTORY_PARENT_CYCLE' }
        if ($cursor -eq $ownerPid) { $probeIsDescendant = $true; break }
        $cursor = $byId[$cursor].parentPid
        if ($cursor -eq 0) { break }
    }
    if ($probeIsDescendant) { [void]$probeAncestors.Remove($ownerPid) }
    else { $probeAncestors.Clear() }
    $report.ownProbeBranchExcludedCount = $probeAncestors.Count

    $allOwnerDescendants = [Collections.Generic.HashSet[int]]::new()
    $frontier = [Collections.Generic.Queue[int]]::new()
    $frontier.Enqueue($ownerPid)
    while ($frontier.Count -gt 0) {
        $parent = $frontier.Dequeue()
        foreach ($entry in $byId.Values) {
            if ($entry.pid -eq $ownerPid -or $allOwnerDescendants.Contains($entry.pid)) { continue }
            if ($entry.parentPid -eq $parent) {
                [void]$allOwnerDescendants.Add($entry.pid)
                $frontier.Enqueue($entry.pid)
            }
        }
    }
    # Any child of the currently inspecting process is also probe-owned.
    $probeChildren = [Collections.Generic.HashSet[int]]::new()
    $frontier = [Collections.Generic.Queue[int]]::new()
    $frontier.Enqueue($probePid)
    while ($frontier.Count -gt 0) {
        $parent = $frontier.Dequeue()
        foreach ($entry in $byId.Values) {
            if ($entry.pid -eq $probePid -or $probeChildren.Contains($entry.pid)) { continue }
            if ($entry.parentPid -eq $parent) {
                [void]$probeChildren.Add($entry.pid)
                $frontier.Enqueue($entry.pid)
            }
        }
    }
    $baseline = 0
    $candidates = 0
    foreach ($id in $allOwnerDescendants) {
        if ($probeAncestors.Contains($id) -or $probeChildren.Contains($id)) { continue }
        $entry = $byId[$id]
        if ($entry.start -lt $owner.start.AddSeconds(-2)) { Fail 'INVENTORY_PARENT_CREATION_CONFLICT' }
        if ($entry.start -lt $acquired.AddSeconds(-2)) { $baseline++ } else { $candidates++ }
    }
    $report.baselineDescendantCount = $baseline
    $report.postLeaseCandidateCount = $candidates

    # Double-read SHA at end so an evidence race cannot silently look settled.
    if ((FileEvidence $LockPath).sha -cne $lock.sha -or
        (FileEvidence $QuarantinePath).sha -cne $side.sha) { Fail 'EVIDENCE_CHANGED_DURING_INSPECTION' }
    if ($candidates -eq 0) {
        $report.state = 'quarantined_no_present_descendant'
        $report.reasonCode = 'NO_POSTLEASE_CANDIDATE_IN_FRESH_ROSTER'
    } else {
        $report.state = 'quarantined_candidate_descendant_present'
        $report.reasonCode = 'POSTLEASE_DESCENDANT_UNATTRIBUTED'
    }
} catch {
    $code = $_.Exception.Message
    if ($code -cnotmatch '^[A-Z][A-Z0-9_]{2,70}$') { $code = 'INSPECTION_EXCEPTION' }
    $report.state = if ($code -match 'CONFLICT|REUSED|CHANGED|MISMATCH|DUPLICATE') { 'conflict' } else { 'unknown' }
    $report.reasonCode = $code
}
Write-Output ($report | ConvertTo-Json -Compress -Depth 6)
# A syntactically completed inspection is not a lease release. Machine callers
# must evaluate state AND releaseEligible=false; exit 0 is not capture success.
