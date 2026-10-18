[CmdletBinding()]
param(
    [ValidateSet('Show','Validate','Add','Remove')][string]$Action = 'Show',
    [string]$Path,
    [string]$StateDirectory = '',
    [string]$PrimaryRoot = ''
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
$repo = Split-Path -Parent $PSScriptRoot
if (!$StateDirectory) { $StateDirectory = Join-Path $repo '.local' }
if (![IO.Path]::IsPathRooted($StateDirectory)) { throw 'StateDirectory must be absolute.' }
if (!$PrimaryRoot -and (Test-Path -LiteralPath (Join-Path $StateDirectory 'autostart.json'))) {
    $PrimaryRoot = (Get-Content -LiteralPath (Join-Path $StateDirectory 'autostart.json') -Raw | ConvertFrom-Json).root
}
if (!$PrimaryRoot) { $PrimaryRoot = $env:WORKBRIDGE_ROOT }
if (!$PrimaryRoot) { throw 'Specify -PrimaryRoot or use the installed autostart configuration.' }
$cli = Join-Path $repo 'dist\roots-cli.js'
if (!(Test-Path -LiteralPath $cli)) { throw 'Build Workbridge before using workspace configuration.' }
New-Item -ItemType Directory -Path $StateDirectory -Force | Out-Null
$lease = $null
$previousManaged = $env:WORKBRIDGE_ROOTS_MANAGED
try {
    if ($Action -in @('Add','Remove')) {
        try { $lease = [IO.File]::Open((Join-Path $StateDirectory 'workspace-config.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
        catch { throw 'Workspace configuration is busy: a command job or another configuration operation holds its Windows lock. Wait for completion or cancel the job.' }
        $env:WORKBRIDGE_ROOTS_MANAGED = '1'
    }
    $node = (Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    $previousPreference = $ErrorActionPreference
    try { $ErrorActionPreference = 'Continue'; & $node $cli $Action $StateDirectory $PrimaryRoot $Path; $code = $LASTEXITCODE }
    finally { $ErrorActionPreference = $previousPreference }
    if ($code -ne 0) { throw 'Workspace configuration failed; inspect the diagnostic above. Existing configuration was preserved.' }
} finally {
    $env:WORKBRIDGE_ROOTS_MANAGED = $previousManaged
    if ($lease) { $lease.Dispose() }
}
