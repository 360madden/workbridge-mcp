# Read-only WB-001 preflight. Never starts a server, updater, task or payload.
# Compatible with Windows PowerShell 5.1. Exit 0 = no observed errors (not
# deployment approval); exit 1 = blocking findings; exit 2 = invalid root.
[CmdletBinding()]
param(
    [string]$InstallRoot = '',
    [string]$CandidateRelease = '',
    [switch]$LiveHealth
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility') -ErrorAction Stop
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$issues = [Collections.Generic.List[object]]::new()
# This is the current WB-001 copy boundary, not a proposed updater change.
$runtimeNames = @('dist', 'node_modules', 'package.json', 'package-lock.json')
$launcherScripts = @('Start-BackgroundTunnel.ps1', 'Start-Tunnel.ps1', 'Tunnel-Credential.ps1', 'Tunnel-ProcessLifetime.cs')
$desktopScripts = @('desktop-ui.mjs', 'desktop-capture.mjs', 'vmware-host-capture.mjs', 'desktop-probe-act.mjs', 'desktop-turn-admission.mjs', 'Check-DesktopWindowHandle.ps1')

function Add-Finding([string]$Code, [string]$Severity = 'error') {
    if (!@($issues | Where-Object { $_.code -ceq $Code }).Count) {
        $issues.Add([pscustomobject]@{code=$Code; severity=$Severity})
    }
}
function Assert-PlainPath([string]$Path) {
    if (![IO.Path]::IsPathRooted($Path)) { throw 'PATH_INVALID' }
    $full = [IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
    $parent = $full
    while ($parent) {
        if (Test-Path -LiteralPath $parent) {
            if ((Get-Item -LiteralPath $parent -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'PATH_LINK' }
        }
        $parent = Split-Path -Parent $parent
    }
    return $full
}
function Get-ChildPath([string]$Root, [string]$Relative) {
    if ([IO.Path]::IsPathRooted($Relative)) { throw 'PATH_INVALID' }
    $full = Assert-PlainPath (Join-Path $Root $Relative)
    if (!$full.StartsWith($Root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'PATH_ESCAPE' }
    return $full
}
function Read-Text([string]$Path, [long]$Limit = 1MB) {
    $null = Assert-PlainPath $Path
    $stream = $null
    $reader = $null
    try {
        $stream = [IO.File]::Open($Path, 'Open', 'Read', ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
        if ($stream.Length -gt $Limit) { throw 'FILE_LIMIT' }
        $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::UTF8, $true)
        # Bound reads even when a concurrent writer grows a file after opening.
        $chars = New-Object char[] ($Limit + 1)
        $count = $reader.ReadBlock($chars, 0, $chars.Length)
        if ($count -gt $Limit) { throw 'FILE_LIMIT' }
        return [string]::new($chars, 0, $count)
    } finally {
        if ($reader) { $reader.Dispose() } elseif ($stream) { $stream.Dispose() }
    }
}
function Read-Json([string]$Path, [long]$Limit = 1MB) {
    $value = (Read-Text $Path $Limit) | ConvertFrom-Json
    if (!$value -or $value -is [array] -or $value -isnot [pscustomobject]) { throw 'JSON_INVALID' }
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
function Safe-Digest($Value) {
    if ($Value -is [string] -and $Value -match '^[0-9a-fA-F]{64}$') { return $Value.ToUpperInvariant() }
    return $null
}
function Get-PackageVersion([string]$Root) {
    $package = Read-Json (Get-ChildPath $Root 'package.json')
    $version = Safe-Version $package.version
    if ($package.name -cne 'workbridge-mcp' -or !$version) { throw 'PACKAGE_INVALID' }
    return $version
}
function Get-BuiltVersion([string]$Root) {
    # Inspect the literal, never import/execute the possibly mismatched server.
    $source = Read-Text (Get-ChildPath $Root 'dist\server.js') 4MB
    $matches = [regex]::Matches($source, '(?m)^\s*const version = [''"]([^''"\r\n]+)[''"];?\s*$')
    if ($matches.Count -ne 1) { throw 'BUILT_VERSION_INVALID' }
    $version = Safe-Version $matches[0].Groups[1].Value
    if (!$version) { throw 'BUILT_VERSION_INVALID' }
    return $version
}
function Get-PlainFiles([string]$Root) {
    $pending = [Collections.Generic.Stack[string]]::new()
    $pending.Push((Assert-PlainPath $Root))
    $count = 0
    while ($pending.Count) {
        foreach ($item in Get-ChildItem -LiteralPath ($pending.Pop()) -Force) {
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'PATH_LINK' }
            if ($item.PSIsContainer) { $pending.Push($item.FullName) }
            else {
                if (++$count -gt 50000) { throw 'FILE_COUNT_LIMIT' }
                $item
            }
        }
    }
}
function Inspect-Release([string]$Path) {
    $result = [ordered]@{requested=$true; sealed=$false; version=$null; builtVersion=$null; manifestSha256=$null; fileCount=0; checksPassed=$false; scripts=@(); scriptsOmittedByUpdater=@(); scriptGaps=@()}
    try {
        $root = Assert-PlainPath $Path
        $receipt = Read-Json (Get-ChildPath $root 'validated.json')
        $manifestPath = Get-ChildPath $root 'manifest.json'
        $digest = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash
        if ($receipt.schema -ne 1 -or $receipt.result -cne 'passed' -or (Safe-Digest $receipt.manifestSha256) -cne $digest) { throw 'SEAL_INVALID' }
        foreach ($check in @('install','tests','startup','updater','format','generic','acceptance')) {
            if ($null -eq $receipt.checks.$check -or $receipt.checks.$check -is [string] -or $receipt.checks.$check -ne 0) { throw 'CHECK_INVALID' }
        }
        $result.checksPassed = $true
        $manifest = Read-Json $manifestPath 16MB
        $result.version = Safe-Version $manifest.version
        if ($manifest.schema -ne 1 -or !$result.version -or $receipt.version -cne $result.version -or $manifest.files -isnot [array] -or !$manifest.files.Count -or $manifest.files.Count -gt 50000) { throw 'MANIFEST_INVALID' }
        $payload = Get-ChildPath $root 'payload'
        $expected = @{}
        foreach ($entry in $manifest.files) {
            # Accept WB-001 Windows separators and portable slash manifests.
            # Reject ADS, traversal, aliases and duplicate case variants before reading.
            if ($entry.path -isnot [string] -or $entry.path.Length -gt 1024 -or $entry.path -match '[:\x00-\x1f]' -or $entry.path -match '^[\\/]' -or $entry.path -match '[ .]([\\/]|$)') { throw 'MANIFEST_PATH_INVALID' }
            $parts = @($entry.path -split '[\\/]')
            if (@($parts | Where-Object { !$_ -or $_ -in @('.','..') }).Count) { throw 'MANIFEST_PATH_INVALID' }
            $relative = $parts -join '\'
            if ($expected.ContainsKey($relative) -or !(Safe-Digest $entry.sha256) -or $entry.bytes -is [string] -or $null -eq $entry.bytes -or $entry.bytes -lt 0 -or [decimal]$entry.bytes % 1 -ne 0) { throw 'MANIFEST_ENTRY_INVALID' }
            $expected[$relative] = $entry
        }
        $actual = @(Get-PlainFiles $payload)
        if ($actual.Count -ne $expected.Count) { throw 'MANIFEST_COUNT_INVALID' }
        foreach ($file in $actual) {
            $relative = $file.FullName.Substring($payload.Length + 1).Replace('/', '\')
            $saved = $expected[$relative]
            if (!$saved -or $file.Length -ne $saved.bytes -or (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash -cne (Safe-Digest $saved.sha256)) { throw 'MANIFEST_HASH_INVALID' }
        }
        if ((Get-PackageVersion $payload) -cne $result.version) { throw 'PACKAGE_VERSION_INVALID' }
        $result.builtVersion = Get-BuiltVersion $payload
        if ($result.builtVersion -cne $result.version) { throw 'BUILT_VERSION_INVALID' }
        foreach ($name in $runtimeNames) {
            $kind = if ($name -in @('dist','node_modules')) { 'Container' } else { 'Leaf' }
            if (!(Test-Path -LiteralPath (Get-ChildPath $payload $name) -PathType $kind)) { throw 'RUNTIME_MISSING' }
        }
        $required = @($launcherScripts)
        if (Test-Path -LiteralPath (Get-ChildPath $payload 'dist\desktop-cli-runner.js')) { $required += $desktopScripts }
        foreach ($name in $required) {
            if (!$expected.ContainsKey('scripts\' + $name)) { throw 'SCRIPT_MISSING' }
        }
        $scriptPaths = @($expected.Keys | Where-Object { $_.StartsWith('scripts\', [StringComparison]::OrdinalIgnoreCase) } | Sort-Object)
        # Do not echo arbitrary manifest paths. Counts include all scripts; the
        # allowlisted runtime dependencies below are the useful actionable rows.
        $result.scriptsOmittedByUpdater = @($required | ForEach-Object { 'scripts/' + $_ })
        foreach ($name in $required) {
            $relative = 'scripts\' + $name
            $status = 'missing'
            $installed = Get-ChildPath $install $relative
            if (Test-Path -LiteralPath $installed -PathType Leaf) {
                $status = if ((Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash -ceq (Safe-Digest $expected[$relative].sha256)) { 'matching' } else { 'different' }
            }
            $row = [pscustomobject]@{path=('scripts/' + $name); installed=$status; copiedByWB001=$false}
            $result.scripts += $row
            if ($status -ne 'matching') { $result.scriptGaps += $row }
        }
        $result.fileCount = $actual.Count
        $result.manifestSha256 = $digest
        $result.sealed = $true
        if ($result.scriptGaps.Count) { Add-Finding 'CANDIDATE_SCRIPTS_NOT_INSTALLED_BY_WB001' }
        elseif ($scriptPaths.Count) { Add-Finding 'WB001_RETAINS_EXISTING_SCRIPTS' 'warning' }
    } catch { Add-Finding 'CANDIDATE_RELEASE_INVALID' }
    return [pscustomobject]$result
}
function Inspect-Health([string]$Root) {
    $result = [ordered]@{requested=[bool]$LiveHealth; status='not_requested'; ready=$null; version=$null; matchesDisk=$null}
    if (!$LiveHealth) { return [pscustomobject]$result }
    $response = $null
    $reader = $null
    try {
        $url = (Read-Text (Get-ChildPath $Root '.local\health-url.txt') 256).Trim()
        if ($url -cnotmatch '^http://127\.0\.0\.1:([0-9]{1,5})$' -or [int]$Matches[1] -lt 1 -or [int]$Matches[1] -gt 65535) { throw 'HEALTH_URL_INVALID' }
        # No redirects, proxies, cookies, default credentials or bearer descriptor.
        $request = [Net.HttpWebRequest]::Create($url + '/health?details=true')
        $request.Method = 'GET'
        $request.Proxy = $null
        $request.AllowAutoRedirect = $false
        $request.UseDefaultCredentials = $false
        $request.Timeout = 2500
        $request.ReadWriteTimeout = 2500
        $response = $request.GetResponse()
        if ([int]$response.StatusCode -ne 200 -or $response.ContentLength -gt 64KB) { throw 'HEALTH_RESPONSE_INVALID' }
        $reader = [IO.StreamReader]::new($response.GetResponseStream())
        $chars = New-Object char[] (64KB + 1)
        # A per-read timeout alone permits an endless slow-drip response.
        $read = $reader.ReadBlockAsync($chars, 0, $chars.Length)
        if (!$read.Wait(2500)) { throw 'HEALTH_RESPONSE_TIMEOUT' }
        $count = $read.Result
        if ($count -gt 64KB) { throw 'HEALTH_RESPONSE_LIMIT' }
        $health = ([string]::new($chars, 0, $count)) | ConvertFrom-Json
        $version = Safe-Version $health.components.mcp.details.initialize.server_version
        if ($health.ready -isnot [bool] -or !$version) { throw 'HEALTH_RESPONSE_INVALID' }
        $result.status = 'observed'
        $result.ready = $health.ready
        $result.version = $version
        if (!$health.ready) { Add-Finding 'LIVE_NOT_READY' }
    } catch {
        $result.status = 'unavailable_or_invalid'
        Add-Finding 'LIVE_HEALTH_UNVERIFIED'
    } finally {
        if ($reader) { $reader.Dispose() }
        if ($response) { $response.Dispose() }
    }
    return [pscustomobject]$result
}

$report = [ordered]@{
    schemaVersion=1; readOnly=$true; hostedVerified=$false
    installation=[ordered]@{packageVersion=$null; builtVersion=$null; serverSha256=$null; missingRuntime=@(); missingScripts=@()}
    marker=[ordered]@{present=$false; valid=$false; version=$null; operationId=$null; releaseDigest=$null; matchesDisk=$null}
    candidate=[pscustomobject]@{requested=$false; sealed=$false}
    live=$null; operations=@(); issues=@(); ok=$false
    nextAction=[ordered]@{code='INSPECT_INSTALLATION'; automatic=$false; message='Review the installation findings before planning any WB-001 change.'}
}
try {
    if (!$InstallRoot) { $InstallRoot = Split-Path -Parent $PSScriptRoot }
    $install = Assert-PlainPath $InstallRoot
    if (!(Test-Path -LiteralPath $install -PathType Container)) { throw 'INSTALL_ROOT_INVALID' }
} catch {
    Add-Finding 'INSTALL_ROOT_INVALID'
    $report.issues = @($issues.ToArray())
    $report | ConvertTo-Json -Depth 12 -Compress
    exit 2
}
try { $report.installation.packageVersion = Get-PackageVersion $install } catch { Add-Finding 'INSTALLED_PACKAGE_INVALID' }
try {
    $report.installation.builtVersion = Get-BuiltVersion $install
    $report.installation.serverSha256 = (Get-FileHash -LiteralPath (Get-ChildPath $install 'dist\server.js') -Algorithm SHA256).Hash
} catch { Add-Finding 'INSTALLED_BUILD_INVALID' }
if ($report.installation.packageVersion -and $report.installation.builtVersion -and $report.installation.packageVersion -cne $report.installation.builtVersion) { Add-Finding 'PACKAGE_BUILD_VERSION_MISMATCH' }
foreach ($name in $runtimeNames) {
    try {
        $path = Get-ChildPath $install $name
        $kind = if ($name -in @('dist','node_modules')) { 'Container' } else { 'Leaf' }
        if (!(Test-Path -LiteralPath $path -PathType $kind)) { throw 'MISSING' }
    } catch { $report.installation.missingRuntime += $name; Add-Finding 'INSTALLED_RUNTIME_MISSING' }
}
$required = @($launcherScripts)
try {
    if (Test-Path -LiteralPath (Get-ChildPath $install 'dist\desktop-cli-runner.js')) { $required += $desktopScripts }
    foreach ($name in $required) {
        if (!(Test-Path -LiteralPath (Get-ChildPath $install ('scripts\' + $name)) -PathType Leaf)) { $report.installation.missingScripts += ('scripts/' + $name) }
    }
    if ($report.installation.missingScripts.Count) { Add-Finding 'INSTALLED_SCRIPT_DEPENDENCY_MISSING' }
} catch { Add-Finding 'INSTALLED_SCRIPTS_UNVERIFIED' }
try {
    $markerPath = Get-ChildPath $install '.local\installed-release.json'
    if (Test-Path -LiteralPath $markerPath) {
        $report.marker.present = $true
        $marker = Read-Json $markerPath
        $report.marker.version = Safe-Version $marker.version
        $report.marker.operationId = Safe-Id $marker.operationId
        $report.marker.releaseDigest = Safe-Digest $marker.releaseDigest
        # WB-001 rollback can legitimately write null operation/digest.
        if ($marker.schema -ne 1 -or !$report.marker.version -or ($null -ne $marker.operationId -and !$report.marker.operationId) -or ($null -ne $marker.releaseDigest -and !$report.marker.releaseDigest)) { throw 'MARKER_INVALID' }
        $report.marker.valid = $true
        if ($report.installation.builtVersion) {
            $report.marker.matchesDisk = $report.marker.version -ceq $report.installation.builtVersion
            if (!$report.marker.matchesDisk) { Add-Finding 'MARKER_BUILD_VERSION_MISMATCH' }
        }
    } else { Add-Finding 'INSTALLED_MARKER_MISSING' 'warning' }
} catch { Add-Finding 'INSTALLED_MARKER_INVALID' }
try {
    $operations = Get-ChildPath $install '.local\update-operations'
    if (Test-Path -LiteralPath $operations) {
        $directories = @(Get-ChildItem -LiteralPath $operations -Directory -Force | Sort-Object Name | Select-Object -First 101)
        if ($directories.Count -gt 100) { Add-Finding 'OPERATION_INVENTORY_TRUNCATED'; $directories = @($directories | Select-Object -First 100) }
        foreach ($directory in $directories) {
            $id = Safe-Id $directory.Name
            if (!$id) { Add-Finding 'OPERATION_METADATA_INVALID'; continue }
            $row = [ordered]@{operationId=$id; journalPresent=$false; phase=$null; errorPresent=$false; recoveryErrorPresent=$false; controllerErrorPresent=$false}
            $operation = Get-ChildPath $operations $directory.Name
            $journalPath = Get-ChildPath $operation 'journal.json'
            if (Test-Path -LiteralPath $journalPath) {
                $row.journalPresent = $true
                $record = Read-Json $journalPath
                if ($record.operationId -cne $id -or $record.installRoot -cne $install -or $record.phase -notin @('preparing','prepared','stopping','installing','starting','verifying','completed','rolling_back','restarting_previous','rolled_back','failed_rolled_back','preflight_failed','recovery_required')) { throw 'JOURNAL_INVALID' }
                $row.phase = $record.phase
                $row.errorPresent = [bool]$record.error
                $row.recoveryErrorPresent = [bool]$record.recoveryError
                if ($record.phase -notin @('completed','rolled_back','failed_rolled_back','preflight_failed') -or $row.recoveryErrorPresent) { Add-Finding 'UPDATE_OPERATION_NEEDS_REVIEW' }
                elseif ($row.errorPresent -or $record.phase -in @('failed_rolled_back','preflight_failed')) { Add-Finding 'PRIOR_UPDATE_ERROR' 'warning' }
            }
            $row.controllerErrorPresent = Test-Path -LiteralPath (Get-ChildPath $operation 'controller-error.json') -PathType Leaf
            if ($row.controllerErrorPresent) { Add-Finding 'UPDATE_CONTROLLER_ERROR' }
            if (!$row.journalPresent -and !$row.controllerErrorPresent) { Add-Finding 'UPDATE_OPERATION_WITHOUT_JOURNAL' }
            $report.operations += [pscustomobject]$row
        }
    }
} catch { Add-Finding 'OPERATION_METADATA_INVALID' }
if ($CandidateRelease) { $report.candidate = Inspect-Release $CandidateRelease }
$report.live = Inspect-Health $install
if ($report.live.status -ceq 'observed' -and $report.installation.builtVersion) {
    $report.live.matchesDisk = $report.live.version -ceq $report.installation.builtVersion
    if (!$report.live.matchesDisk) { Add-Finding 'DISK_LIVE_VERSION_MISMATCH' }
}
$codes = @($issues | ForEach-Object { $_.code })
if ('DISK_LIVE_VERSION_MISMATCH' -in $codes) {
    $report.nextAction.code = 'RESOLVE_DISK_LIVE_MISMATCH'
    $report.nextAction.message = 'Preserve the running owner and retained operation IDs; verify the previous baseline and rollback evidence before planning WB-001 recovery. Do not rebuild, force-restart or retry Apply.'
} elseif (@($codes | Where-Object { $_ -in @('UPDATE_CONTROLLER_ERROR','UPDATE_OPERATION_NEEDS_REVIEW','UPDATE_OPERATION_WITHOUT_JOURNAL','OPERATION_METADATA_INVALID','OPERATION_INVENTORY_TRUNCATED') }).Count) {
    $report.nextAction.code = 'REVIEW_EXISTING_OPERATION'
    $report.nextAction.message = 'Inspect retained WB-001 operation evidence with the same IDs. An absent journal does not establish a supported Recover action. Do not dispatch another Apply.'
} elseif ('CANDIDATE_RELEASE_INVALID' -in $codes) {
    $report.nextAction.code = 'VALIDATE_CANDIDATE'
    $report.nextAction.message = 'Use an unchanged sealed candidate with matching manifest, payload and successful validation checks before planning an update.'
} elseif ('CANDIDATE_SCRIPTS_NOT_INSTALLED_BY_WB001' -in $codes -or 'INSTALLED_SCRIPT_DEPENDENCY_MISSING' -in $codes) {
    $report.nextAction.code = 'REVIEW_SCRIPT_PACKAGING'
    $report.nextAction.message = 'WB-001 copies dist, node_modules and package files only. Plan and test a guarded script dependency rollout; this inspector changes nothing.'
} elseif (!@($issues | Where-Object { $_.severity -ceq 'error' }).Count) {
    if (!$LiveHealth) {
        $report.nextAction.code = 'OPT_IN_LIVE_HEALTH'
        $report.nextAction.message = 'Disk inspection cannot establish the loaded service version. Opt in to read-only loopback health before reviewing a WB-001 plan.'
    } else {
        $report.nextAction.code = 'REVIEW_WB001_PLAN'
        $report.nextAction.message = 'Review the staged WB-001 validation and rollback plan. Matching versions and a seal do not prove deployment, tool availability or hosted acceptance.'
    }
}
$report.issues = @($issues.ToArray())
$report.ok = !@($issues | Where-Object { $_.severity -ceq 'error' }).Count
$report | ConvertTo-Json -Depth 12 -Compress
if (!$report.ok) { exit 1 }
exit 0
