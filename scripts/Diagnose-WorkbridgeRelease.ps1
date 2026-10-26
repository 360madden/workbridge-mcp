# Read-only release identity diagnosis; Windows PowerShell 5.1 or newer.
# No runtime imports, process launches, task changes, credential reads or writes.
# Exit 0: observed identities agree; 1: mismatch/incomplete evidence; 2: invalid root.
# Version agreement is not a release integrity check or deployment acceptance.
# Usage: powershell.exe -NoProfile -NonInteractive -File scripts/Diagnose-WorkbridgeRelease.ps1 -InstallRoot C:\path\to\workbridge
# Opt in to a single loopback health GET with -LiveHealth; select retained
# operation metadata with -OperationId ID (otherwise uses the installed marker).
[CmdletBinding()]
param(
    [string]$InstallRoot = '',
    [switch]$LiveHealth,
    [string]$OperationId = ''
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility') -ErrorAction Stop
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$findings = [Collections.Generic.List[string]]::new()

function Assert-PlainPath([string]$Path) {
    if (![IO.Path]::IsPathRooted($Path) -or $Path -match '^[\\/]{2}' -or $Path.Substring(2).Contains(':')) { throw 'INVALID_PATH' }
    $full = [IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
    $ancestor = $full
    while ($ancestor) {
        if (Test-Path -LiteralPath $ancestor) {
            if ((Get-Item -LiteralPath $ancestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'LINK_PATH' }
        }
        $ancestor = Split-Path -Parent $ancestor
    }
    return $full
}
function Get-SafePath([string]$Relative) {
    $path = Assert-PlainPath (Join-Path $install $Relative)
    if (!$path.StartsWith($install + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'PATH_ESCAPE' }
    return $path
}
function Read-BoundedText([string]$Relative, [int]$Limit = 64KB, [switch]$WithHash) {
    $stream = $null
    $reader = $null
    try {
        $stream = [IO.File]::Open((Get-SafePath $Relative), 'Open', 'Read', ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
        if ($stream.Length -gt $Limit) { throw 'FILE_TOO_LARGE' }
        $bytes = New-Object byte[] ($Limit + 1)
        $count = 0
        while ($count -lt $bytes.Length) {
            $read = $stream.Read($bytes, $count, $bytes.Length - $count)
            if (!$read) { break }
            $count += $read
        }
        if ($count -gt $Limit) { throw 'FILE_TOO_LARGE' }
        $memory = [IO.MemoryStream]::new($bytes, 0, $count, $false)
        $reader = [IO.StreamReader]::new($memory, [Text.Encoding]::UTF8, $true)
        $text = $reader.ReadToEnd()
        if (!$WithHash) { return $text }
        $hash = [Security.Cryptography.SHA256]::Create()
        try { return [pscustomobject]@{text=$text; sha256=([BitConverter]::ToString($hash.ComputeHash($bytes, 0, $count))).Replace('-', '')} }
        finally { $hash.Dispose() }
    } finally {
        if ($reader) { $reader.Dispose() }
        if ($stream) { $stream.Dispose() }
    }
}
function Read-Object([string]$Relative) {
    $value = (Read-BoundedText $Relative) | ConvertFrom-Json
    if ($value -isnot [pscustomobject] -or $value -is [array]) { throw 'INVALID_JSON' }
    return $value
}
function Safe-Version($Value) {
    if ($Value -is [string] -and $Value -cmatch '^\d{1,6}\.\d{1,6}\.\d{1,6}(?:-[A-Za-z0-9.-]{1,80})?(?:\+[A-Za-z0-9.-]{1,80})?$') { return $Value }
    return $null
}
function Safe-Id($Value) {
    if ($Value -is [string] -and $Value -cmatch '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$') { return $Value }
    return $null
}
function Compare-Version([string]$Left, [string]$Right, [string]$Code) {
    if (!$Left -or !$Right) { return 'unknown' }
    if ($Left -ceq $Right) { return 'match' }
    $findings.Add($Code)
    return 'mismatch'
}
function Read-LiveHealth {
    $result = [ordered]@{status='not_requested'; version=$null; ready=$null}
    if (!$LiveHealth) { return [pscustomobject]$result }
    $response = $null
    $reader = $null
    $request = $null
    try {
        $url = (Read-BoundedText '.local\health-url.txt' 256).Trim()
        if ($url -cnotmatch '^http://127\.0\.0\.1:([0-9]{1,5})$' -or [int]$Matches[1] -lt 1 -or [int]$Matches[1] -gt 65535) { throw 'INVALID_HEALTH_URL' }
        # Only this unauthenticated loopback GET is allowed. Never read bearer
        # descriptors, use credentials, follow redirects or use a proxy.
        $request = [Net.HttpWebRequest]::Create($url + '/health?details=true')
        $request.Method = 'GET'
        $request.Proxy = $null
        $request.AllowAutoRedirect = $false
        $request.UseDefaultCredentials = $false
        $request.Timeout = 2000
        $request.ReadWriteTimeout = 2000
        $response = $request.GetResponse()
        if ([int]$response.StatusCode -ne 200 -or $response.ContentLength -gt 64KB) { throw 'INVALID_HEALTH_RESPONSE' }
        $reader = [IO.StreamReader]::new($response.GetResponseStream())
        $chars = New-Object char[] (64KB + 1)
        $read = $reader.ReadBlockAsync($chars, 0, $chars.Length)
        if (!$read.Wait(2000)) { throw 'HEALTH_TIMEOUT' }
        $count = $read.Result
        if ($count -gt 64KB) { throw 'HEALTH_LIMIT' }
        $health = ([string]::new($chars, 0, $count)) | ConvertFrom-Json
        $version = Safe-Version $health.components.mcp.details.initialize.server_version
        if (!$version -or $health.ready -isnot [bool]) { throw 'INVALID_HEALTH_IDENTITY' }
        $result.status = 'observed'
        $result.version = $version
        $result.ready = $health.ready
        if (!$health.ready) { $findings.Add('LIVE_NOT_READY') }
    } catch {
        $result.status = 'unavailable_or_invalid'
        $findings.Add('LIVE_HEALTH_UNVERIFIED')
    } finally {
        if ($request) { $request.Abort() }
        if ($reader) { $reader.Dispose() }
        if ($response) { $response.Dispose() }
    }
    return [pscustomobject]$result
}

$report = [ordered]@{
    schemaVersion=1; readOnly=$true; ok=$false; hostedVerified=$false; integrityVerified=$false
    disk=[ordered]@{packageVersion=$null; builtVersion=$null; serverSha256=$null}
    installed=[ordered]@{status='missing'; version=$null; operationId=$null; releaseDigest=$null}
    live=$null
    comparisons=[ordered]@{packageToBuild='unknown'; installedToBuild='unknown'; liveToBuild='unknown'; liveToInstalled='unknown'}
    operation=[ordered]@{status='not_selected'; operationId=$null; journalPresent=$false; controllerErrorPresent=$false; phase=$null; errorPresent=$false; recoveryErrorPresent=$false}
    findings=@()
    recovery=[ordered]@{code='REVIEW_WB001_PLAN'; automatic=$false; guidance=@()}
}
try {
    if (!$InstallRoot) { $InstallRoot = Split-Path -Parent $PSScriptRoot }
    $install = Assert-PlainPath $InstallRoot
    if (!(Test-Path -LiteralPath $install -PathType Container)) { throw 'INVALID_ROOT' }
} catch {
    $report.findings = @('INSTALL_ROOT_INVALID')
    $report.recovery.code = 'INSPECT_INSTALL_ROOT'
    $report.recovery.guidance = @('Select an existing local installation without symlinks or junctions.')
    $report | ConvertTo-Json -Depth 8 -Compress
    exit 2
}
try {
    $package = Read-Object 'package.json'
    $version = Safe-Version $package.version
    if ($package.name -cne 'workbridge-mcp' -or !$version) { throw 'INVALID_PACKAGE' }
    $report.disk.packageVersion = $version
} catch { $findings.Add('PACKAGE_IDENTITY_UNVERIFIED') }
try {
    # Hash and parse the same bounded snapshot; never import or launch server.js.
    $snapshot = Read-BoundedText 'dist\server.js' 4MB -WithHash
    $matches = [regex]::Matches($snapshot.text, '(?m)^\s*const version = [''"]([^''"\r\n]+)[''"];?\s*$')
    if ($matches.Count -ne 1) { throw 'INVALID_BUILD_VERSION' }
    $version = Safe-Version $matches[0].Groups[1].Value
    if (!$version) { throw 'INVALID_BUILD_VERSION' }
    $report.disk.builtVersion = $version
    $report.disk.serverSha256 = $snapshot.sha256
} catch { $findings.Add('BUILT_IDENTITY_UNVERIFIED') }
try {
    if (Test-Path -LiteralPath (Get-SafePath '.local\installed-release.json')) {
        $report.installed.status = 'invalid'
        $marker = Read-Object '.local\installed-release.json'
        $version = Safe-Version $marker.version
        $id = Safe-Id $marker.operationId
        if ($marker.schema -ne 1 -or !$version -or ($null -ne $marker.operationId -and !$id) -or ($null -ne $marker.releaseDigest -and ($marker.releaseDigest -isnot [string] -or $marker.releaseDigest -notmatch '^[A-Fa-f0-9]{64}$'))) { throw 'INVALID_MARKER' }
        $report.installed.status = 'observed'
        $report.installed.version = $version
        $report.installed.operationId = $id
        $report.installed.releaseDigest = $marker.releaseDigest
    } else { $findings.Add('INSTALLED_MARKER_MISSING') }
} catch { $report.installed.status = 'invalid'; $findings.Add('INSTALLED_MARKER_INVALID') }
$selectedId = if ($OperationId) { Safe-Id $OperationId } else { $report.installed.operationId }
if ($OperationId -and !$selectedId) { $findings.Add('OPERATION_ID_INVALID'); $report.operation.status = 'invalid' }
elseif ($selectedId) {
    $report.operation.operationId = $selectedId
    $report.operation.status = 'observed'
    try {
        $relative = '.local\update-operations\' + $selectedId + '\'
        $report.operation.controllerErrorPresent = Test-Path -LiteralPath (Get-SafePath ($relative + 'controller-error.json')) -PathType Leaf
        $report.operation.journalPresent = Test-Path -LiteralPath (Get-SafePath ($relative + 'journal.json')) -PathType Leaf
        if ($report.operation.journalPresent) {
            $journal = Read-Object ($relative + 'journal.json')
            if ($journal.operationId -cne $selectedId -or $journal.installRoot -ine $install -or $journal.phase -cnotin @('preparing','prepared','stopping','installing','starting','verifying','completed','rolling_back','restarting_previous','rolled_back','failed_rolled_back','preflight_failed','recovery_required')) { throw 'INVALID_JOURNAL' }
            $report.operation.phase = $journal.phase
            $report.operation.errorPresent = [bool]$journal.error
            $report.operation.recoveryErrorPresent = [bool]$journal.recoveryError
            if ($journal.phase -cnotin @('completed','rolled_back') -or $journal.error -or $journal.recoveryError) { $findings.Add('OPERATION_NEEDS_REVIEW') }
        } else { $findings.Add('OPERATION_JOURNAL_MISSING') }
        if ($report.operation.controllerErrorPresent) { $findings.Add('OPERATION_CONTROLLER_ERROR') }
    } catch { $report.operation.status = 'invalid'; $findings.Add('OPERATION_METADATA_INVALID') }
}
$report.live = Read-LiveHealth
$report.comparisons.packageToBuild = Compare-Version $report.disk.packageVersion $report.disk.builtVersion 'PACKAGE_BUILD_MISMATCH'
$report.comparisons.installedToBuild = Compare-Version $report.installed.version $report.disk.builtVersion 'INSTALLED_BUILD_MISMATCH'
$report.comparisons.liveToBuild = Compare-Version $report.live.version $report.disk.builtVersion 'LIVE_BUILD_MISMATCH'
$report.comparisons.liveToInstalled = Compare-Version $report.live.version $report.installed.version 'LIVE_INSTALLED_MISMATCH'
$report.findings = @($findings.ToArray())
if (@($report.findings | Where-Object { $_ -like '*MISMATCH' }).Count) {
    $report.recovery.code = 'PRESERVE_OWNER_VERIFY_BASELINE'
    $report.recovery.guidance = @('Preserve the current owner, dirty source and retained WB-001 operation IDs. Do not rebuild or force-restart the service.', 'Independently verify the last installed baseline, sealed candidate and rollback backups before planning WB-001 restoration or cutover.')
} elseif (@($report.findings | Where-Object { $_ -like 'OPERATION_*' }).Count) {
    $report.recovery.code = 'REVIEW_RETAINED_OPERATION'
} elseif ($report.findings.Count) {
    $report.recovery.code = 'COMPLETE_IDENTITY_EVIDENCE'
} elseif (!$LiveHealth) {
    $report.recovery.code = 'OPT_IN_LIVE_HEALTH'
    $report.recovery.guidance += 'Rerun with -LiveHealth to observe the loaded owner through unauthenticated loopback health.'
}
$report.recovery.guidance += @('Inspect retained operation evidence with the same ID before any action; an absent journal does not establish a supported Recover action. Do not blindly retry Apply.', 'Version agreement does not verify runtime bytes, rollback readiness, fresh tool availability or hosted deployment acceptance. Follow WB-001 staged validation and rollback for changes.')
$report.ok = $report.findings.Count -eq 0
$report | ConvertTo-Json -Depth 8 -Compress
if (!$report.ok) { exit 1 }
exit 0
