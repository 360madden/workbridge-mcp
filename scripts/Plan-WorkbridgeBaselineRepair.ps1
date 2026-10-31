# Read-only WB-001 planning. No Apply/Recover invocation, file writes, runtime
# imports, credentials, scheduled tasks or service control. Exit 0: reviewable
# plan; 1: blocked evidence; 2: invalid arguments/installation path.
# Manifest pins must come from independently retained last-good/candidate evidence.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$InstallRoot,
    [Parameter(Mandatory)][string]$LastGoodReleasePath,
    [Parameter(Mandatory)][string]$LastGoodVersion,
    [Parameter(Mandatory)][string]$LastGoodManifestSha256,
    [Parameter(Mandatory)][string]$CandidateReleasePath,
    [Parameter(Mandatory)][string]$CandidateVersion,
    [Parameter(Mandatory)][string]$CandidateManifestSha256,
    [switch]$LiveHealth,
    [string]$OperationId = ''
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Workbridge-Update.ps1')
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$blockers = [Collections.Generic.List[string]]::new()
$report = [ordered]@{
    schemaVersion=1; readOnly=$true; ok=$false; automatic=$false
    productionRepairAuthorized=$false; hostedVerified=$false
    baseline=$null; candidate=$null; diagnosis=$null; repairRequired=$null
    blockers=@(); proposedSteps=@()
    caveats=@('This immutable proposal grants no repair authority and executes no changes.',
        'Sealed hashes prove consistency with explicit pins, not provenance of those pins.',
        'Live health proves version/readiness only, not loaded runtime bytes or hosted acceptance.',
        'Input trees must be quiescent during inspection; this proposal holds no execution lock.',
        'Disk runtime integrity and rollback readiness still require WB-001 preflight; revalidate all evidence immediately before any separately authorized action.')
}
function Assert-LocalPlainPath([string]$Path) {
    # Reject UNC, device namespaces, drive-relative paths, alternate streams and
    # lexical traversal even when normalization would land inside the tree.
    if ($Path -cnotmatch '^[A-Za-z]:[\\/]' -or $Path.Substring(2).Contains(':') -or $Path -match '[*?"<>|]' -or $Path -match '(^|[\\/])\.{1,2}([\\/]|$)') { throw 'PATH_INVALID' }
    foreach ($part in ($Path.Substring(3) -split '[\\/]')) {
        if ($part -and ($part.EndsWith('.') -or $part.EndsWith(' ') -or $part -match '^(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)')) { throw 'PATH_INVALID' }
    }
    return (Assert-WBPath $Path)
}
function Read-PlanObject([string]$Path, [long]$Limit) {
    $plain = Assert-LocalPlainPath $Path
    $stream = [IO.File]::Open($plain, 'Open', 'Read', 'Read')
    $reader = $null
    try {
        if ($stream.Length -gt $Limit) { throw 'METADATA_LIMIT' }
        $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::UTF8, $true)
        $value = $reader.ReadToEnd() | ConvertFrom-Json
        if ($value -isnot [pscustomobject]) { throw 'METADATA_INVALID' }
        $stream.Position = 0
        $hash = [Security.Cryptography.SHA256]::Create()
        try { $sha = ([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-', '') }
        finally { $hash.Dispose() }
        return [pscustomobject]@{value=$value; sha256=$sha}
    } finally { if ($reader) { $reader.Dispose() } else { $stream.Dispose() } }
}
function Test-Version([string]$Version) {
    return $Version -cmatch '^\d{1,6}\.\d{1,6}\.\d{1,6}(?:-[A-Za-z0-9.-]{1,80})?(?:\+[A-Za-z0-9.-]{1,80})?$'
}
function Get-PlanRelease([string]$Path, [string]$Version, [string]$Pin) {
    $root = Assert-LocalPlainPath $Path
    $manifestPath = Join-Path $root 'manifest.json'
    $receiptSnapshot = Read-PlanObject (Join-Path $root 'validated.json') 256KB
    $manifestSnapshot = Read-PlanObject $manifestPath 16MB
    $receipt = $receiptSnapshot.value
    $manifest = $manifestSnapshot.value
    if ($manifest.schema -isnot [int] -or $manifest.schema -ne 1 -or $receipt.schema -isnot [int] -or $receipt.schema -ne 1 -or $manifest.version -cne $Version -or $receipt.version -cne $Version) { throw 'VERSION_INVALID' }
    if ($manifestSnapshot.sha256 -ine $Pin -or $receipt.manifestSha256 -ine $Pin) { throw 'PIN_INVALID' }
    # Current sealing has seven gates; reject old/incomplete or coercible receipts.
    foreach ($check in @('install','tests','startup','updater','format','generic','acceptance')) {
        $code = $receipt.checks.$check
        if (($code -isnot [int] -and $code -isnot [long]) -or $code -ne 0) { throw 'CHECK_INVALID' }
    }
    $payload = Assert-LocalPlainPath (Join-Path $root 'payload')
    $files = @($manifest.files)
    if (!$files.Count -or $files.Count -gt 50000) { throw 'MANIFEST_LIMIT' }
    foreach ($entry in $files) {
        if ($entry.path -isnot [string] -or !$entry.path -or $entry.path -match '(^|[\\/])\.{1,2}([\\/]|$)' -or $entry.path -match '[:*?"<>|]' -or [IO.Path]::IsPathRooted($entry.path) -or $entry.sha256 -isnot [string] -or $entry.sha256 -cnotmatch '^[A-F0-9]{64}$' -or ($entry.bytes -isnot [int] -and $entry.bytes -isnot [long]) -or $entry.bytes -lt 0 -or $entry.bytes -gt 256MB) { throw 'MANIFEST_INVALID' }
        $null = Assert-LocalPlainPath (Get-WBChild $payload $entry.path)
    }
    # Bound actual enumeration before the existing WB-001 checksum validator.
    $pending = [Collections.Generic.Stack[string]]::new()
    $pending.Push($payload)
    $count = 0; $total = 0L; $items = 0
    while ($pending.Count) {
        foreach ($item in Get-ChildItem -LiteralPath $pending.Pop() -Force) {
            $items++
            if ($items -gt 100000 -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'TREE_INVALID' }
            if ($item.PSIsContainer) { $pending.Push($item.FullName) }
            else {
                $count++; $total += $item.Length
                if ($count -gt 50000 -or $total -gt 2GB -or $item.Length -gt 256MB) { throw 'TREE_LIMIT' }
            }
        }
    }
    $release = Get-WBRelease $root
    # Verify the built identity from the same existing read-only diagnostic;
    # missing installed marker is expected for a sealed payload.
    $built = (& (Join-Path $PSScriptRoot 'Diagnose-WorkbridgeRelease.ps1') -InstallRoot $payload) | ConvertFrom-Json
    if ($built.disk.packageVersion -cne $Version -or $built.disk.builtVersion -cne $Version -or !$built.disk.serverSha256) { throw 'BUILD_INVALID' }
    $serverEntries = @($files | Where-Object { $_.path.Replace('/', '\') -ieq 'dist\server.js' })
    if ($serverEntries.Count -ne 1 -or $built.disk.serverSha256 -cne $serverEntries[0].sha256) { throw 'BUILD_HASH_INVALID' }
    if ((Read-PlanObject $manifestPath 16MB).sha256 -cne $manifestSnapshot.sha256 -or (Read-PlanObject (Join-Path $root 'validated.json') 256KB).sha256 -cne $receiptSnapshot.sha256) { throw 'METADATA_CHANGED' }
    return [pscustomobject]@{path=$release.path; version=$release.version; manifestSha256=$release.digest; receiptSha256=$receiptSnapshot.sha256; serverSha256=$built.disk.serverSha256; sealedVerified=$true; fileCount=$count}
}
try {
    $install = Assert-LocalPlainPath $InstallRoot
    if (!(Test-Path -LiteralPath $install -PathType Container) -or !(Test-Version $LastGoodVersion) -or !(Test-Version $CandidateVersion) -or $LastGoodManifestSha256 -notmatch '^[A-Fa-f0-9]{64}$' -or $CandidateManifestSha256 -notmatch '^[A-Fa-f0-9]{64}$' -or ($OperationId -and $OperationId -cnotmatch '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$')) { throw 'ARGUMENT_INVALID' }
} catch {
    $report.blockers = @('INVALID_ARGUMENT_OR_INSTALL_ROOT')
    $report | ConvertTo-Json -Depth 12 -Compress
    exit 2
}
try { $report.baseline = Get-PlanRelease $LastGoodReleasePath $LastGoodVersion $LastGoodManifestSha256 }
catch { $blockers.Add('LAST_GOOD_SEAL_UNVERIFIED') }
try { $report.candidate = Get-PlanRelease $CandidateReleasePath $CandidateVersion $CandidateManifestSha256 }
catch { $blockers.Add('CANDIDATE_SEAL_UNVERIFIED') }
try {
    $diagnosis = (& (Join-Path $PSScriptRoot 'Diagnose-WorkbridgeRelease.ps1') -InstallRoot $install -LiveHealth:$LiveHealth -OperationId $OperationId) | ConvertFrom-Json
    $report.diagnosis = $diagnosis
    if ($diagnosis.live.status -cne 'observed' -or $diagnosis.live.ready -ne $true) { $blockers.Add('LIVE_BASELINE_UNVERIFIED') }
    elseif ($diagnosis.live.version -cne $LastGoodVersion) { $blockers.Add('LIVE_BASELINE_VERSION_MISMATCH') }
    if ($diagnosis.installed.status -cne 'observed' -or $diagnosis.installed.version -cne $LastGoodVersion -or $diagnosis.installed.releaseDigest -ine $LastGoodManifestSha256) { $blockers.Add('INSTALLED_BASELINE_MARKER_MISMATCH') }
    foreach ($finding in $diagnosis.findings) {
        if ($finding -cnotin @('INSTALLED_BUILD_MISMATCH','LIVE_BUILD_MISMATCH')) { $blockers.Add('DIAGNOSIS_' + $finding) }
    }
    if ($diagnosis.disk.packageVersion -ceq $LastGoodVersion -and $diagnosis.disk.builtVersion -ceq $LastGoodVersion) {
        $report.repairRequired = $false
        if (!$report.baseline -or $diagnosis.disk.serverSha256 -cne $report.baseline.serverSha256) { $blockers.Add('DISK_SERVER_HASH_MISMATCH') }
    } elseif ($diagnosis.disk.packageVersion -ceq $CandidateVersion -and $diagnosis.disk.builtVersion -ceq $CandidateVersion -and $CandidateVersion -cne $LastGoodVersion) {
        $report.repairRequired = $true
        if (!$report.candidate -or $diagnosis.disk.serverSha256 -cne $report.candidate.serverSha256) { $blockers.Add('DISK_SERVER_HASH_MISMATCH') }
    } else { $blockers.Add('DISK_IDENTITY_UNRECOGNIZED') }
} catch { $blockers.Add('DIAGNOSIS_UNVERIFIED') }
$report.blockers = @($blockers.ToArray() | Select-Object -Unique)
$report.ok = $report.blockers.Count -eq 0
if ($report.ok) {
    $report.proposedSteps = @(
        [pscustomobject]@{order=1; code='PRESERVE_OWNER_AND_EVIDENCE'; automatic=$false; description='Preserve the running owner, dirty source, sealed releases and retained operation evidence.'},
        [pscustomobject]@{order=2; code='REVALIDATE_WB001_PREFLIGHT'; automatic=$false; description='Independently verify complete disk runtime, explicit manifest pins, current health and rollback backups under WB-001; any changed evidence invalidates this proposal.'}
    )
    if ($report.repairRequired) {
        $report.proposedSteps += [pscustomobject]@{order=3; code='REVIEW_BASELINE_RESTORATION'; automatic=$false; description='Review a separately authorized WB-001 baseline restoration with retained displaced files and independently validated rollback. The ordinary Apply healthy-installation gate must not be bypassed.'}
    } else {
        $report.proposedSteps += [pscustomobject]@{order=3; code='NO_BASELINE_REPAIR_PROPOSED'; automatic=$false; description='Observed baseline versions and server hash agree; continue staged candidate review only after full WB-001 preflight.'}
    }
}
$report | ConvertTo-Json -Depth 12 -Compress
if (!$report.ok) { exit 1 }
exit 0
