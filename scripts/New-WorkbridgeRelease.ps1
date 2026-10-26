[CmdletBinding()]
param(
    [string]$SourceRoot = '',
    [string]$ReleaseId = ('release-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')),
    [string]$WorkspaceRoot = 'C:\work'
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Workbridge-Update.ps1')
if (!$SourceRoot) { $SourceRoot = Split-Path -Parent $PSScriptRoot }
$source = Get-WBInstallation $SourceRoot
$sourcePackage = Get-Content -LiteralPath (Get-WBChild $source 'package.json') -Raw | ConvertFrom-Json
$sourceVersion = ($sourcePackage.version -split '-', 2)[0]
$requiresDesktopRuntime = ([version]$sourceVersion -ge [version]'0.16.4')
if ($ReleaseId -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$') { throw 'Invalid release ID.' }
# Pure metadata preflight: avoid PowerShell's numeric coercion accepting quoted sizes.
# Also used by isolated Windows PowerShell 5.1 synthetic tests without building a release.
function Assert-WBDesktopManifestMetadata {
    param([object]$Manifest, [string[]]$ExpectedNames)
    if ($Manifest -isnot [pscustomobject] -or
        ($Manifest.schemaVersion -isnot [int] -and $Manifest.schemaVersion -isnot [long]) -or
        $Manifest.schemaVersion -ne 1 -or
        $Manifest.files -isnot [array] -or
        @($Manifest.files).Count -ne $ExpectedNames.Count) {
        throw 'Desktop runtime manifest has an invalid schema or file count.'
    }
    for ($index = 0; $index -lt $ExpectedNames.Count; $index++) {
        $name = $ExpectedNames[$index]
        $entry = $Manifest.files[$index]
        if ($entry -isnot [pscustomobject] -or
            $entry.name -isnot [string] -or $entry.name -cne $name -or
            ($entry.sizeBytes -isnot [int] -and $entry.sizeBytes -isnot [long]) -or
            $entry.sizeBytes -le 0 -or $entry.sizeBytes -gt 1048576 -or
            $entry.sha256 -isnot [string] -or
            $entry.sha256 -cnotmatch ('^[0-9a-f]{64}' + [char]36)) {
            throw "Invalid desktop runtime manifest entry: $name"
        }
    }
}
$release = Get-WBChild $source ('.local\releases\' + $ReleaseId)
if (Test-Path -LiteralPath $release) { throw 'Release already exists. Use a new release ID; existing evidence is retained.' }
$payload = Get-WBChild $release 'payload'
New-Item -ItemType Directory -Path $payload -Force | Out-Null
foreach ($name in $script:WBSourceNames) {
    $path = Get-WBChild $source $name
    if (Test-Path -LiteralPath $path) { Copy-WBTree $path (Join-Path $payload $name) }
}
$checks = [ordered]@{}
$previousKey = $env:CONTROL_PLANE_API_KEY
$previousRoot = $env:WORKBRIDGE_ROOT
$previousState = $env:WORKBRIDGE_STATE_DIR
try {
    $env:CONTROL_PLANE_API_KEY = $null
    $env:WORKBRIDGE_ROOT = (Assert-WBPath $WorkspaceRoot)
    $env:WORKBRIDGE_STATE_DIR = Join-Path $release 'validation-state'
    Push-Location $payload
    try {
        $commands = @(
            @{name='install'; args=@('ci','--no-audit','--no-fund')},
            @{name='tests'; args=@('test')},
            @{name='startup'; args=@('run','test:startup')},
            @{name='updater'; args=@('run','test:updater')},
            @{name='format'; args=@('run','format:check')},
            @{name='generic'; args=@('run','acceptance')}
        )
        if ($requiresDesktopRuntime) { $commands += @{name='desktop-stage'; args=@('scripts/stage-desktop-runtime.mjs','--repo-root',$payload)} }
        $commands += @{name='acceptance'; args=@('run','acceptance:release')}
        foreach ($command in $commands) {
            $arguments = $command.args
            # Windows PowerShell wraps native stderr (including npm notices)
            # as ErrorRecords. The native exit code determines success.
            $previousPreference = $ErrorActionPreference
            try {
                $ErrorActionPreference = 'Continue'
                if ($command.name -eq 'desktop-stage') {
                    & node @arguments *> (Join-Path $release ($command.name + '.log'))
                } else {
                    & npm @arguments *> (Join-Path $release ($command.name + '.log'))
                }
                $code = $LASTEXITCODE
            } finally { $ErrorActionPreference = $previousPreference }
            $checks[$command.name] = $code
            Write-Host "$($command.name): exit $code"
            if ($code -ne 0) { throw "Release $($command.name) failed. Inspect its local log; no validation receipt was issued." }
        }
    } finally { Pop-Location }
    # The probe writes local evidence outside the sealed payload.
    $probe = Get-Content -LiteralPath (Join-Path $release 'validation-state\release-probe.json') -Raw | ConvertFrom-Json
    $package = Get-Content -LiteralPath (Join-Path $payload 'package.json') -Raw | ConvertFrom-Json
    if ($probe.version -cne $package.version) { throw 'Built MCP server version differs from the package version.' }
    if ($requiresDesktopRuntime) {
    # Validate the desktop closure from the final payload, after all build-producing checks.
    $desktopNames = @('desktop-ui.mjs', 'desktop-capture.mjs', 'vmware-host-capture.mjs', 'desktop-probe-act.mjs', 'Check-DesktopWindowHandle.ps1')
    $desktopDist = Get-WBChild $payload 'dist'
    foreach ($item in @(Get-ChildItem -LiteralPath $desktopDist -Force)) {
        if ($item.Name -ceq '.desktop-runtime-stage.lock' -or $item.Name.StartsWith('.desktop-stage-', [StringComparison]::Ordinal)) {
            throw 'Desktop runtime stage is incomplete; recovery required.'
        }
    }
    $desktopManifestPath = Get-WBChild $desktopDist 'desktop-runtime-manifest.json'
    $desktopManifestItem = Get-Item -LiteralPath $desktopManifestPath -Force
    if ($desktopManifestItem.PSIsContainer -or ($desktopManifestItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $desktopManifestItem.Length -gt 65536) {
        throw 'Desktop runtime manifest is unsafe.'
    }
    $desktopManifest = Get-Content -LiteralPath $desktopManifestPath -Raw | ConvertFrom-Json
    Assert-WBDesktopManifestMetadata -Manifest $desktopManifest -ExpectedNames $desktopNames
    for ($i = 0; $i -lt $desktopNames.Count; $i++) {
        $name = $desktopNames[$i]
        $entry = $desktopManifest.files[$i]
        foreach ($relative in @("scripts\$name", "dist\$name")) {
            $filePath = Get-WBChild $payload $relative
            $item = Get-Item -LiteralPath $filePath -Force
            if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
                $item.Length -ne $entry.sizeBytes -or
                (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $entry.sha256) {
                throw "Desktop runtime closure checksum differs: $relative"
            }
        }
    }
    $checks['desktop-closure'] = 0
    }
    $files = @(Get-WBManifest $payload)
    $manifest = [pscustomobject]@{schema=1; releaseId=$ReleaseId; version=$package.version; createdUtc=[DateTime]::UtcNow.ToString('o'); files=$files}
    Write-WBJson (Join-Path $release 'manifest.json') $manifest
    Write-WBJson (Join-Path $release 'validated.json') ([pscustomobject]@{schema=1; version=$package.version; result='passed'; checks=$checks; manifestSha256=(Get-FileHash -LiteralPath (Join-Path $release 'manifest.json') -Algorithm SHA256).Hash; probe=$probe; hostedVerified=$false})
    $null = Get-WBRelease $release
    Write-Host "Validated release: $release"
    Write-Host 'No service was stopped or deployed. Keep this directory unchanged.'
} finally {
    $env:CONTROL_PLANE_API_KEY = $previousKey
    $env:WORKBRIDGE_ROOT = $previousRoot
    $env:WORKBRIDGE_STATE_DIR = $previousState
}
