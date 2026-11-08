[CmdletBinding()]
param([string]$Root = 'C:\work', [switch]$NonInteractive, [string]$CredentialPath = '')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Tunnel-Credential.ps1')
$repo = Split-Path -Parent $PSScriptRoot
$identitySettings = Join-Path $repo '.local\settings.json'
if (!(Test-Path -LiteralPath $identitySettings -PathType Leaf)) { throw 'MACHINE_IDENTITY_MISSING: configure .local/settings.json expectedHostname before starting Workbridge.' }
try { $expectedHost = (Get-Content -LiteralPath $identitySettings -Raw | ConvertFrom-Json).expectedHostname }
catch { throw 'MACHINE_IDENTITY_INVALID: cannot parse Workbridge identity settings.' }
if ([string]::IsNullOrWhiteSpace($expectedHost)) { throw 'MACHINE_IDENTITY_MISSING: expectedHostname must be configured.' }
if ($expectedHost -ine $env:COMPUTERNAME) { throw "MACHINE_IDENTITY_MISMATCH: expected $expectedHost but running on $env:COMPUTERNAME." }
$pointer = Join-Path $repo '.local\tunnel-client-path.txt'
$profiles = Join-Path $repo '.local\profiles'
if (!(Test-Path -LiteralPath $pointer)) { throw 'Run .\scripts\Install-TunnelClient.ps1 first.' }
if (!(Test-Path -LiteralPath (Join-Path $profiles 'workbridge.yaml'))) { throw 'Run .\scripts\Configure-Tunnel.ps1 -TunnelId <your ID> first.' }
if (!(Test-Path -LiteralPath $Root -PathType Container)) { throw "Workspace directory does not exist: $Root" }
$tunnel = (Get-Content -LiteralPath $pointer -Raw).Trim()
$previousRoot = $env:WORKBRIDGE_ROOT
$previousKey = $env:CONTROL_PLANE_API_KEY
$previousLocalCli = $env:WORKBRIDGE_LOCAL_CLI
$healthFile = Join-Path $repo '.local\health-url.txt'
$runLock = $null
try {
    try { $runLock = [IO.File]::Open((Join-Path $repo '.local\tunnel.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
    catch { throw 'Another Workbridge launcher is already running, or its lock file is inaccessible.' }
    $env:WORKBRIDGE_ROOT = (Resolve-Path -LiteralPath $Root).Path
    # The stdio child remains the owner; local CLI clients attach to its authenticated endpoint.
    $env:WORKBRIDGE_LOCAL_CLI = '1'
    if (!$env:CONTROL_PLANE_API_KEY) {
        $secret = Read-TunnelCredential -CredentialPath $CredentialPath
        if (!$secret -and $NonInteractive) { throw 'No saved Workbridge runtime key. Run Save-TunnelCredential.ps1 once.' }
        if (!$secret) { $secret = Read-Host 'Tunnel runtime API key (hidden; kept only for this run)' -AsSecureString }
        try { $env:CONTROL_PLANE_API_KEY = [System.Net.NetworkCredential]::new('', $secret).Password }
        finally { if ($secret) { $secret.Dispose() } }
        if (!$env:CONTROL_PLANE_API_KEY) { throw 'Runtime API key cannot be empty.' }
    }
    # Windows PowerShell 5.1 wraps native stderr as ErrorRecords. Keep normal
    # diagnostic output from terminating the launcher; check native exit codes.
    $ErrorActionPreference = 'Continue'
    & $tunnel doctor --profile workbridge --profile-dir $profiles --explain 2>&1 | ForEach-Object { $_.ToString() }
    if ($LASTEXITCODE -ne 0) { throw 'Tunnel doctor failed. Resolve the reported checks before connecting ChatGPT.' }
    Write-Host 'Keep this terminal running. Press Ctrl+C to stop.'
    Write-Host "In another terminal: .\scripts\Get-TunnelHealth.ps1"
    & $tunnel run --profile workbridge --profile-dir $profiles --health.url-file $healthFile --mcp.stdio-send-initialized-notification 2>&1 | ForEach-Object { $_.ToString() }
    if ($LASTEXITCODE -ne 0) { throw "Tunnel exited with code $LASTEXITCODE." }
} finally {
    $env:WORKBRIDGE_ROOT = $previousRoot
    $env:CONTROL_PLANE_API_KEY = $previousKey
    $env:WORKBRIDGE_LOCAL_CLI = $previousLocalCli
    if ($runLock) { $runLock.Dispose() }
}
