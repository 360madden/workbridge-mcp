[CmdletBinding()]
param([Parameter(Mandatory)][string]$InstallDirectory)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Workbridge-Update.ps1')
$install = Assert-WBPath $InstallDirectory
if (Test-Path -LiteralPath $install) { throw 'Choose a new directory; existing files will not be overwritten.' }
New-Item -ItemType Directory -Path $install | Out-Null
$repo = Split-Path -Parent $PSScriptRoot
foreach ($name in @('PcHealth','WindowsHealthScan')) {
    $project = Join-Path $PSScriptRoot ('helpers/' + $name + '/' + $name + '.csproj')
    $output = Get-WBChild $install $name
    & dotnet publish $project -c Release -r win-x64 --self-contained false -p:PublishSingleFile=true --artifacts-path (Get-WBChild $install ('build/' + $name)) -o $output | Out-Host
    if ($LASTEXITCODE -ne 0) { throw ('dotnet publish failed: ' + $name) }
}
$bundle = Get-WBChild $install 'WindowsHealthScan'
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Run-WindowsHealthScan.ps1') -Destination $bundle
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Workbridge-Update.ps1') -Destination $bundle
New-Item -ItemType Directory -Path (Get-WBChild $install 'data') | Out-Null
$receipt = [ordered]@{schema=1; status='prepared_not_elevated'; repo=$repo; createdUtc=[DateTime]::UtcNow.ToString('o');
    healthSha256=(Get-FileHash -LiteralPath (Get-WBChild $install 'PcHealth/PcHealth.exe')).Hash;
    scanSha256=(Get-FileHash -LiteralPath (Get-WBChild $bundle 'WindowsHealthScan.exe')).Hash;
    sourceSha256=@(Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'helpers/PcHealth'),(Join-Path $PSScriptRoot 'helpers/WindowsHealthScan') -File | ForEach-Object { @{path=$_.FullName;sha256=(Get-FileHash -LiteralPath $_.FullName).Hash} })}
Write-WBJson (Get-WBChild $install 'preparation.json') $receipt
$receipt | ConvertTo-Json -Depth 5
