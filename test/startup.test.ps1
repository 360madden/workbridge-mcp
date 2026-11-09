[CmdletBinding()]
param([switch]$ChildCheck)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security') -ErrorAction Stop
$repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $repo 'scripts\Tunnel-Credential.ps1')
$fixtureValue = 'sk-workbridge-test-fixture-not-an-api-key'
if ($ChildCheck) {
    $secret = Read-TunnelCredential
    try {
        if ([System.Net.NetworkCredential]::new('', $secret).Password -cne $fixtureValue) { throw 'Child decrypt mismatch.' }
    } finally { if ($secret) { $secret.Dispose() } }
    # Exercise the actual save entry point, with hidden input replaced only in
    # this fixture process. A previously approved destination needs no re-prompt.
    function Read-Host {
        param([string]$Prompt, [switch]$AsSecureString)
        if (!$AsSecureString) { throw 'Unexpected confirmation/input prompt.' }
        ConvertTo-SecureString $fixtureValue -AsPlainText -Force
    }
    & (Join-Path $repo 'scripts\Save-TunnelCredential.ps1') -DestinationConfirmed
    Write-Output 'PASS: Windows PowerShell child decrypts the fixture.'
    exit 0
}
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('workbridge-startup-test-' + [guid]::NewGuid().ToString('N'))
$previousLocalAppData = $env:LOCALAPPDATA
$previousKey = $env:CONTROL_PLANE_API_KEY
New-Item -ItemType Directory -Path $fixtureRoot | Out-Null
try {
    $env:LOCALAPPDATA = $fixtureRoot
    $env:CONTROL_PLANE_API_KEY = $null
    if ($null -ne (Read-TunnelCredential)) { throw 'Missing credential should return null.' }
    $secret = ConvertTo-SecureString $fixtureValue -AsPlainText -Force
    try { Write-TunnelCredential $secret } finally { $secret.Dispose() }
    $ciphertext = Get-Content -LiteralPath (Get-TunnelCredentialPath) -Raw
    if ($ciphertext.Contains($fixtureValue)) { throw 'Credential must not be saved as plaintext.' }
    $shell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
    & $shell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File $PSCommandPath -ChildCheck
    if ($LASTEXITCODE -ne 0) { throw 'Windows PowerShell child verification failed.' }
    $acl = Get-Acl -LiteralPath (Split-Path -Parent (Get-TunnelCredentialPath))
    if (!$acl.AreAccessRulesProtected) { throw 'Credential directory must not inherit broad ACLs.' }
    Set-Content -LiteralPath (Get-TunnelCredentialPath) -Value 'invalid-ciphertext'
    $failed = $false
    try { Read-TunnelCredential | Out-Null } catch { $failed = $_.Exception.Message -like 'Cannot decrypt*' }
    if (!$failed) { throw 'Corrupt credentials must fail with a clear error.' }
    Remove-Item -LiteralPath (Get-TunnelCredentialPath)
    $launcherFixture = Join-Path $fixtureRoot 'launcher'
    $fixtureScripts = Join-Path $launcherFixture 'scripts'
    New-Item -ItemType Directory -Path $fixtureScripts -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $launcherFixture '.local\profiles') -Force | Out-Null
    foreach ($name in @('Start-Tunnel.ps1', 'Tunnel-Credential.ps1')) {
        Copy-Item -LiteralPath (Join-Path $repo "scripts\$name") -Destination (Join-Path $fixtureScripts $name)
    }
    Set-Content -LiteralPath (Join-Path $launcherFixture '.local\tunnel-client-path.txt') -Value 'not-executed'
    Set-Content -LiteralPath (Join-Path $launcherFixture '.local\profiles\workbridge.yaml') -Value 'fixture'
    # Mirror production's identity prerequisite only in this GUID-scoped fixture.
    $fixtureIdentity = Join-Path $launcherFixture '.local\settings.json'
    foreach ($case in @(
        @{ Name = 'missing'; Json = $null; Code = 'MACHINE_IDENTITY_MISSING' }
        @{ Name = 'malformed'; Json = '{'; Code = 'MACHINE_IDENTITY_INVALID' }
        @{ Name = 'blank'; Json = '{"expectedHostname":" "}'; Code = 'MACHINE_IDENTITY_MISSING' }
        @{ Name = 'mismatched'; Json = (@{ expectedHostname = ([Environment]::MachineName + '-fixture-mismatch') } | ConvertTo-Json -Compress); Code = 'MACHINE_IDENTITY_MISMATCH' }
    )) {
        if ($null -ne $case.Json) {
            Set-Content -LiteralPath $fixtureIdentity -Value $case.Json -Encoding UTF8
        }
        $failed = $false
        try { & (Join-Path $fixtureScripts 'Start-Tunnel.ps1') -Root $fixtureRoot -NonInteractive }
        catch { $failed = $_.Exception.Message -like ($case.Code + ':*') }
        if (!$failed) { throw "Launcher must reject $($case.Name) identity before credentials or connecting." }
    }
    @{ expectedHostname = [Environment]::MachineName } | ConvertTo-Json -Compress | Set-Content -LiteralPath $fixtureIdentity -Encoding UTF8
    $failed = $false
    try { & (Join-Path $fixtureScripts 'Start-Tunnel.ps1') -Root $fixtureRoot -NonInteractive } catch { $failed = $_.Exception.Message -like 'No saved Workbridge runtime key*' }
    if (!$failed) { throw 'Unattended launcher must fail before prompting or connecting when no key is saved.' }
    $lock = [IO.File]::Open((Join-Path $launcherFixture '.local\tunnel.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
    try {
        $failed = $false
        try { & (Join-Path $fixtureScripts 'Start-Tunnel.ps1') -Root $fixtureRoot -NonInteractive } catch { $failed = $_.Exception.Message -like 'Another Workbridge launcher*' }
        if (!$failed) { throw 'A second launcher must not start another tunnel.' }
    } finally { $lock.Dispose() }
    foreach ($script in Get-ChildItem -LiteralPath (Join-Path $repo 'scripts') -Filter '*.ps1') {
        $parseErrors = $null
        [System.Management.Automation.Language.Parser]::ParseFile($script.FullName, [ref]$null, [ref]$parseErrors) | Out-Null
        if ($parseErrors.Count) { throw "PowerShell parse error: $($script.Name)" }
    }
    $probe = Join-Path $fixtureRoot 'lifetime-probe.ps1'
    $probePid = Join-Path $fixtureRoot 'probe-child.pid'
    @'
param($Helper, $PidFile)
$ErrorActionPreference = 'Stop'
Add-Type -Path $Helper
[Workbridge.ProcessLifetime]::Attach()
$shell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$child = Start-Process $shell -ArgumentList '-NoLogo -NoProfile -NonInteractive -Command "Start-Sleep -Seconds 60"' -WindowStyle Hidden -PassThru
$child.Id | Set-Content -LiteralPath $PidFile -Encoding ASCII
Start-Sleep -Seconds 60
'@ | Set-Content -LiteralPath $probe -Encoding UTF8
    $probeProcess = Start-Process $shell -ArgumentList "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File `"$probe`" -Helper `"$(Join-Path $repo 'scripts\Tunnel-ProcessLifetime.cs')`" -PidFile `"$probePid`"" -WindowStyle Hidden -PassThru
    $probeChild = $null
    try {
        for ($attempt = 0; $attempt -lt 100 -and !(Test-Path -LiteralPath $probePid); $attempt++) { Start-Sleep -Milliseconds 100 }
        if (!(Test-Path -LiteralPath $probePid)) { throw 'Process-lifetime probe did not start.' }
        $probeChild = Get-Process -Id ([int](Get-Content -LiteralPath $probePid)) -ErrorAction Stop
        Stop-Process -Id $probeProcess.Id
        for ($attempt = 0; $attempt -lt 30 -and !$probeChild.HasExited; $attempt++) { Start-Sleep -Milliseconds 100; $probeChild.Refresh() }
        if (!$probeChild.HasExited) { throw 'Stopping the wrapper must terminate its native child.' }
    } finally {
        if (!$probeProcess.HasExited) { Stop-Process -Id $probeProcess.Id }
        if ($probeChild -and !$probeChild.HasExited) { Stop-Process -Id $probeChild.Id }
    }
    & (Join-Path $PSScriptRoot 'restart.test.ps1')
    Write-Output 'PASS: DPAPI roundtrip, protected ACL, corrupt/missing credentials, unattended fail-fast, duplicate launchers, process-tree cleanup, and script syntax.'
} finally {
    $env:LOCALAPPDATA = $previousLocalAppData
    $env:CONTROL_PLANE_API_KEY = $previousKey
    # Remove only the exact GUID-named fixture beneath the verified temp folder.
    $resolvedFixture = [IO.Path]::GetFullPath($fixtureRoot)
    $tempPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if ($resolvedFixture.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $resolvedFixture) -match '^workbridge-startup-test-[0-9a-f]{32}$') {
        Remove-Item -LiteralPath $resolvedFixture -Recurse -Force
    } else { throw 'Refusing to remove an unexpected test fixture path.' }
}
