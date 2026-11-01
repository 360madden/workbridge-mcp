param(
    [Parameter(Mandatory = $true)][string]$EvidenceDirectory,
    [Parameter(Mandatory = $true)][string]$HelperResult
)

$ErrorActionPreference = 'Stop'
$target = [IO.Path]::GetFullPath($EvidenceDirectory)
if (Test-Path -LiteralPath $target) { throw 'Choose a new evidence directory; inspect an uncertain previous attempt before rerunning.' }
if (-not (Test-Path -LiteralPath $HelperResult -PathType Leaf)) { throw 'Helper result is missing.' }
$winget = (Get-Command winget.exe -ErrorAction Stop).Source
New-Item -ItemType Directory -Path $target | Out-Null
# Inspect and install through WinGet, using its publisher manifest and hash verification.
& $winget show --id jqlang.jq --exact --version 1.8.2 --source winget --disable-interactivity |
    Out-File -LiteralPath (Join-Path $target 'package-details.txt') -Encoding utf8
if ($LASTEXITCODE -ne 0) { throw 'Package inspection failed.' }
$existing = Get-Command jq.exe -ErrorAction SilentlyContinue
$installedNow = $false
if (-not $existing) {
    & $winget list --id jqlang.jq --exact --source winget --disable-interactivity |
        Out-File -LiteralPath (Join-Path $target 'installed-before.txt') -Encoding utf8
    $listExit = $LASTEXITCODE
    # APPINSTALLER_CLI_ERROR_NO_APPLICATIONS_FOUND; other failures must be investigated.
    if ($listExit -eq -1978335212) {
        & $winget install --id jqlang.jq --exact --version 1.8.2 --source winget --scope user --silent --disable-interactivity |
            Out-File -LiteralPath (Join-Path $target 'installation.txt') -Encoding utf8
        if ($LASTEXITCODE -ne 0) { throw ('WinGet installation failed: ' + $LASTEXITCODE) }
        $installedNow = $true
    } elseif ($listExit -ne 0) {
        throw ('WinGet installed-package inventory failed: ' + $listExit)
    }
}
# A running scheduled bridge inherits its old PATH. Use the actual package path
# immediately, rather than restarting the working tunnel just to refresh PATH.
$packageRoot = Join-Path $env:LOCALAPPDATA 'Microsoft/WinGet/Packages'
$candidates = @()
if (Test-Path -LiteralPath $packageRoot) {
    foreach ($package in @(Get-ChildItem -LiteralPath $packageRoot -Directory -Filter 'jqlang.jq_*')) {
        $candidates += @(Get-ChildItem -LiteralPath $package.FullName -File -Filter 'jq*.exe')
    }
}
$jqPath = if ($existing) { $existing.Source } elseif ($candidates.Count -eq 1) { $candidates[0].FullName } else { $null }
if (-not $jqPath) { throw 'Cannot unambiguously locate installed jq; inspect installation evidence.' }
$version = (& $jqPath --version | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw 'jq version check failed.' }
$marker = (& $jqPath -r .marker $HelperResult | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $marker -ne 'WORKBRIDGE_DOTNET10_HELPER_OK') { throw 'jq could not verify the saved helper output.' }
$hash = (Get-FileHash -LiteralPath $jqPath -Algorithm SHA256).Hash
if ($installedNow -and $hash -ne 'A6FC67FEDAF9128A3309A1E2EBB8B986AECCF70122EE46D2CB4849E423F0C627') {
    throw 'Installed executable does not match inspected package SHA256.'
}
[ordered]@{
    status = 'passed'
    packageId = 'jqlang.jq'
    source = 'winget'
    scope = if ($installedNow) { 'user' } else { 'existing installation retained' }
    installedNow = $installedNow
    executable = $jqPath
    version = $version
    sha256 = $hash
    verifiedHelperMarker = $marker
    uninstallCommand = 'winget uninstall --id jqlang.jq --exact --source winget --scope user --disable-interactivity'
    completedUtc = [DateTime]::UtcNow.ToString('o')
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $target 'acceptance.json') -Encoding UTF8
Get-Content -LiteralPath (Join-Path $target 'acceptance.json') -Raw
