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
if ($ReleaseId -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$') { throw 'Invalid release ID.' }
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
            @{name='acceptance'; args=@('run','acceptance:release')}
        )
        foreach ($command in $commands) {
            $arguments = $command.args
            # Windows PowerShell wraps native stderr (including npm notices)
            # as ErrorRecords. The native exit code determines success.
            $previousPreference = $ErrorActionPreference
            try {
                $ErrorActionPreference = 'Continue'
                & npm @arguments *> (Join-Path $release ($command.name + '.log'))
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
