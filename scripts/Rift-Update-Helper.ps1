# Read-only RIFT update baseline / after-update comparison launcher.
# Evidence is written only to this repository's ignored .tools/rift-update.
[CmdletBinding()]
param(
    [ValidateSet('Before', 'After', 'Compare')]
    [string]$Action = 'Before',
    [string]$GameDir = 'C:\Program Files (x86)\Glyph\Games\RIFT\Live',
    [string]$AddonsDir = "$env:USERPROFILE\OneDrive\Documents\RIFT\Interface\AddOns",
    [switch]$NoAddons,
    [string]$BeforeManifest,
    [string]$AfterManifest
)
$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot 'rift-update-contingency.mjs'
$node = Get-Command node.exe -ErrorAction Stop
$helperArgs = @($scriptPath)
if ($Action -eq 'Compare') {
    if (-not $BeforeManifest -or -not $AfterManifest) {
        throw 'Compare requires -BeforeManifest and -AfterManifest.'
    }
    $helperArgs += @('compare', '--before', $BeforeManifest, '--after', $AfterManifest)
} else {
    $helperArgs += $Action.ToLowerInvariant()
    $helperArgs += @('--game-dir', $GameDir)
    if ($NoAddons) {
        $helperArgs += '--no-addons'
    } else {
        $helperArgs += @('--addons-dir', $AddonsDir)
    }
}
& $node.Source @helperArgs
exit $LASTEXITCODE
