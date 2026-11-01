[CmdletBinding()]
param([Parameter(Mandatory)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Workbridge-Update.ps1')
$target = Assert-WBPath $OutputDirectory
if (Test-Path -LiteralPath $target) { throw 'Use a new output directory; existing builds are retained.' }
$repo = Split-Path -Parent $PSScriptRoot
$dotnet = (Get-Command dotnet.exe -ErrorAction Stop).Source
$artifacts = Get-WBChild $target 'build-artifacts'
New-Item -ItemType Directory -Path $target | Out-Null
foreach ($name in @('HeartbeatProbe','AdminProbe')) {
    $project = Join-Path $PSScriptRoot ('helpers/' + $name + '/' + $name + '.csproj')
    $output = Get-WBChild $target $name
    & $dotnet publish $project --configuration Release --output $output --artifacts-path $artifacts --nologo
    if ($LASTEXITCODE -ne 0) { throw "Publishing $name failed: $LASTEXITCODE" }
}
$admin = Get-WBChild $target 'AdminProbe'
foreach ($name in @('Run-AdminProbe.ps1','Workbridge-Update.ps1')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $admin $name)
}
$adminExe = Get-WBChild $admin 'AdminProbe.exe'
$sourceFiles = @('helpers/AdminProbe/Program.cs','helpers/AdminProbe/AdminProbe.csproj','helpers/AdminProbe/app.manifest','Run-AdminProbe.ps1')
$sources = foreach ($relative in $sourceFiles) {
    [ordered]@{path=(Join-Path $PSScriptRoot $relative); sha256=(Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $relative) -Algorithm SHA256).Hash}
}
$receipt = [ordered]@{
    schema=1; status='prepared_not_elevated'; outputDirectory=$target
    heartbeatExecutable=(Get-WBChild $target 'HeartbeatProbe/HeartbeatProbe.exe')
    adminExecutable=$adminExe
    adminSha256=(Get-FileHash -LiteralPath $adminExe -Algorithm SHA256).Hash
    adminPurpose='No arguments; read-only Windows administrator token check. Exit 0 elevated, 5 normal token, 2 unexpected arguments.'
    administratorPromptRequested=$false; sources=@($sources)
    preparedUtc=[DateTime]::UtcNow.ToString('o')
}
Write-WBJson (Get-WBChild $target 'preparation.json') $receipt
$receipt | ConvertTo-Json -Depth 5
