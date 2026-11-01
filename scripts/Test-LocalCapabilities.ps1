param(
    [Parameter(Mandatory = $true)][string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
$target = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $target) { throw 'Choose a new output directory; existing files are never overwritten.' }
$dotnet = (Get-Command dotnet.exe -ErrorAction Stop).Source
$sdk = @(& $dotnet --list-sdks)
if ($LASTEXITCODE -ne 0) { throw 'SDK inventory failed.' }
if (-not ($sdk -match '^10\.')) { throw '.NET 10 SDK is required.' }
New-Item -ItemType Directory -Path $target | Out-Null
Push-Location -LiteralPath $target
try {
    # These fixtures belong exclusively to this run. No real application config is edited.
    @'
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>
</Project>
'@ | Set-Content -LiteralPath HelperProbe.csproj -Encoding UTF8
    @'
using System.Text.Json;
using System.Runtime.InteropServices;
var destination = Path.GetFullPath(args[0]);
File.WriteAllText(destination, JsonSerializer.Serialize(new {
    marker = "WORKBRIDGE_DOTNET10_HELPER_OK",
    runtime = RuntimeInformation.FrameworkDescription,
    architecture = RuntimeInformation.ProcessArchitecture.ToString(),
    createdUtc = DateTimeOffset.UtcNow
}));
Console.WriteLine(File.ReadAllText(destination));
'@ | Set-Content -LiteralPath Program.cs -Encoding UTF8
    & $dotnet build HelperProbe.csproj --configuration Release --nologo
    if ($LASTEXITCODE -ne 0) { throw 'Helper build failed.' }
    & $dotnet (Join-Path $target 'bin/Release/net10.0/HelperProbe.dll') (Join-Path $target 'helper-result.json')
    if ($LASTEXITCODE -ne 0) { throw 'Helper execution failed.' }
    $result = Get-Content -LiteralPath helper-result.json -Raw | ConvertFrom-Json
    if ($result.marker -ne 'WORKBRIDGE_DOTNET10_HELPER_OK' -or $result.runtime -notmatch '^\.NET 10\.') {
        throw 'Helper result did not confirm .NET 10 execution.'
    }
    '{"enabled":false,"label":"disposable fixture"}' | Set-Content -LiteralPath fixture-config.json -Encoding UTF8
    Copy-Item -LiteralPath fixture-config.json -Destination fixture-config.backup.json
    $before = (Get-FileHash -LiteralPath fixture-config.json -Algorithm SHA256).Hash
    $config = Get-Content -LiteralPath fixture-config.json -Raw | ConvertFrom-Json
    $config.enabled = $true
    $config | ConvertTo-Json | Set-Content -LiteralPath fixture-config.json -Encoding UTF8
    if (-not (Get-Content -LiteralPath fixture-config.json -Raw | ConvertFrom-Json).enabled) { throw 'Config edit failed.' }
    Copy-Item -LiteralPath fixture-config.backup.json -Destination fixture-config.json -Force
    if ((Get-FileHash -LiteralPath fixture-config.json -Algorithm SHA256).Hash -ne $before) { throw 'Config restoration failed.' }
    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
    $wingetVersion = $null
    if ($winget) {
        $wingetVersion = (& $winget.Source --version | Out-String).Trim()
        if ($LASTEXITCODE -ne 0) { throw 'WinGet inventory failed.' }
    }
    [ordered]@{
        status = 'passed'
        powershell = $PSVersionTable.PSVersion.ToString()
        sdkInventory = $sdk
        helperRuntime = $result.runtime
        helperMarker = $result.marker
        configEditAndByteExactRestore = $true
        wingetVersion = $wingetVersion
        installationTested = $false
        outputDirectory = $target
        completedUtc = [DateTime]::UtcNow.ToString('o')
    } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath acceptance.json -Encoding UTF8
    Get-Content -LiteralPath acceptance.json -Raw
} finally {
    Pop-Location
}
