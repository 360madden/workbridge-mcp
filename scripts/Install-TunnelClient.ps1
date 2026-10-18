[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
if ($arch -eq 'x64') { $arch = 'amd64' }
if ($arch -notin @('amd64', 'arm64')) { throw "Unsupported Windows architecture: $arch" }
$release = Invoke-RestMethod 'https://api.github.com/repos/openai/tunnel-client/releases/latest'
$asset = $release.assets | Where-Object name -EQ "tunnel-client-$($release.tag_name)-windows-$arch.zip"
$checksums = $release.assets | Where-Object name -EQ 'SHA256SUMS.txt'
if (!$asset -or !$checksums) { throw 'Official Windows archive/checksums were not found in latest release.' }
$destination = Join-Path $repo ".tools\$($release.tag_name)"
New-Item -ItemType Directory -Path $destination -Force | Out-Null
$archive = Join-Path $destination $asset.name
Invoke-WebRequest $asset.browser_download_url -OutFile $archive
$content = (Invoke-WebRequest $checksums.browser_download_url).Content
$sums = if ($content -is [byte[]]) { [Text.Encoding]::UTF8.GetString($content) } else { [string]$content }
$expected = ($sums -split "`n" | Where-Object { $_.TrimEnd().EndsWith($asset.name) }) -split '\s+'
if (!$expected -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ine $expected[0]) {
    throw 'Archive SHA256 does not match the official release checksum.'
}
Expand-Archive -LiteralPath $archive -DestinationPath $destination -Force
$binary = @(Get-ChildItem -LiteralPath $destination -Recurse -File -Filter tunnel-client.exe)
if ($binary.Count -ne 1) { throw 'Expected exactly one tunnel-client.exe in the archive.' }
New-Item -ItemType Directory -Path (Join-Path $repo '.local') -Force | Out-Null
Set-Content -LiteralPath (Join-Path $repo '.local\tunnel-client-path.txt') -Value $binary[0].FullName -Encoding utf8
Write-Host "Installed $($release.tag_name), verified SHA256."
& $binary[0].FullName help quickstart
if ($LASTEXITCODE -ne 0) { throw 'tunnel-client help failed.' }
