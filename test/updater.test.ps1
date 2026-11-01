[CmdletBinding()]
param([switch]$SchedulerSmoke)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $repo 'scripts\Workbridge-Update.ps1')
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('workbridge-updater-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
$results = [Collections.Generic.List[object]]::new()
function Assert-WB($Condition, [string]$Message) { if (!$Condition) { throw $Message } }
function Assert-WBThrows([scriptblock]$Code, [string]$Pattern) {
    $message = ''
    try { & $Code | Out-Null } catch { $message = $_.Exception.Message }
    Assert-WB ($message -like $Pattern) "Expected '$Pattern', got '$message'"
}
function New-WBFixture([string]$Path, [string]$Version = '1.0.0') {
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
    foreach ($name in @('dist','node_modules','scripts','src','.local\profiles','.git')) { New-Item -ItemType Directory -Path (Join-Path $Path $name) -Force | Out-Null }
    Write-WBJson (Join-Path $Path 'package.json') ([pscustomobject]@{name='workbridge-mcp'; version=$Version; type='module'})
    Set-Content -LiteralPath (Join-Path $Path 'package-lock.json') -Value "lock-$Version"
    Set-Content -LiteralPath (Join-Path $Path 'dist\server.js') -Value "runtime-$Version"
    Set-Content -LiteralPath (Join-Path $Path 'node_modules\fixture.txt') -Value "dependency-$Version"
    Set-Content -LiteralPath (Join-Path $Path 'scripts\Start-BackgroundTunnel.ps1') -Value '# Fixture launcher, never executed.'
    Set-Content -LiteralPath (Join-Path $Path 'src\keep.txt') -Value 'unrelated source'
    Set-Content -LiteralPath (Join-Path $Path '.git\index') -Value 'unrelated staged bytes'
    Set-Content -LiteralPath (Join-Path $Path '.local\profiles\workbridge.yaml') -Value 'api_key: env:CONTROL_PLANE_API_KEY'
    return $Path
}
function New-WBFixtureRelease([string]$Path, [string]$Version = '2.0.0') {
    $payload = New-WBFixture (Join-Path $Path 'payload') $Version
    Write-WBJson (Join-Path $Path 'manifest.json') ([pscustomobject]@{schema=1; version=$Version; files=@(Get-WBManifest $payload)})
    Write-WBJson (Join-Path $Path 'validated.json') ([pscustomobject]@{schema=1; result='passed'; version=$Version; checks=@{install=0; tests=0; startup=0; updater=0; format=0; acceptance=0}; manifestSha256=(Get-FileHash -LiteralPath (Join-Path $Path 'manifest.json')).Hash})
    return $Path
}
function New-WBCase([string]$Name, [scriptblock]$Code) {
    $caseRoot = Join-Path $fixture $Name
    New-Item -ItemType Directory -Path $caseRoot | Out-Null
    $install = New-WBFixture (Join-Path $caseRoot 'install with spaces')
    $release = New-WBFixtureRelease (Join-Path $caseRoot 'release with spaces')
    $service = [pscustomobject]@{stops=0; starts=0; probes=0; failStarts=0; unhealthy=$null}
    $stop = { $service.stops++ }.GetNewClosure()
    $start = { $service.starts++; if ($service.starts -le $service.failStarts) { throw 'Fixture startup failed.' } }.GetNewClosure()
    $probe = { param($version,$fresh); $service.probes++; if ($version -ceq $service.unhealthy) { return $false }; return ((Get-Content -LiteralPath (Join-Path $install 'dist\server.js') -Raw).Trim() -ceq ('runtime-' + $version)) }.GetNewClosure()
    $arguments = @{InstallRoot=$install; OperationId='update-1'; ReleasePath=$release; StopService=$stop; StartService=$start; TestService=$probe; CheckIdle={ return $true }}
    try {
        & $Code
        $results.Add([pscustomobject]@{name=$Name; passed=$true})
        Write-Output "PASS: $Name"
    } catch {
        $results.Add([pscustomobject]@{name=$Name; passed=$false; error=$_.Exception.Message})
        Write-Output "FAIL: $Name - $($_.Exception.Message)"
    }
}
function Set-WBGuiFixtureRelease([string]$ReleasePath) {
    $payload = Join-Path $ReleasePath 'payload'
    Write-WBJson (Join-Path $payload 'package.json') ([pscustomobject]@{name='workbridge-mcp'; version='0.16.4-dev'; type='module'})
    $names = @('desktop-ui.mjs', 'desktop-capture.mjs', 'vmware-host-capture.mjs', 'desktop-probe-act.mjs', 'Check-DesktopWindowHandle.ps1')
    $entries = @()
    foreach ($name in $names) {
        $content = "fixture desktop runtime: $name"
        Set-Content -LiteralPath (Join-Path $payload "scripts\$name") -Value $content
        $runtimePath = Join-Path $payload "dist\$name"
        Set-Content -LiteralPath $runtimePath -Value $content
        $item = Get-Item -LiteralPath $runtimePath
        $entries += [pscustomobject]@{name=$name; sizeBytes=$item.Length; sha256=(Get-FileHash -LiteralPath $runtimePath -Algorithm SHA256).Hash.ToLowerInvariant()}
    }
    Write-WBJson (Join-Path $payload 'dist\desktop-runtime-manifest.json') ([pscustomobject]@{schemaVersion=1; files=$entries})
    Set-WBGuiFixtureSeal $ReleasePath
}
function Set-WBGuiFixtureSeal([string]$ReleasePath) {
    $payload = Join-Path $ReleasePath 'payload'
    Write-WBJson (Join-Path $ReleasePath 'manifest.json') ([pscustomobject]@{schema=1; version='0.16.4-dev'; files=@(Get-WBManifest $payload)})
    $receiptPath = Join-Path $ReleasePath 'validated.json'
    $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
    $receipt.version = '0.16.4-dev'
    if (!$receipt.checks.PSObject.Properties['generic']) {
        Add-Member -InputObject $receipt.checks -MemberType NoteProperty -Name generic -Value 0
        Add-Member -InputObject $receipt.checks -MemberType NoteProperty -Name 'desktop-stage' -Value 0
        Add-Member -InputObject $receipt.checks -MemberType NoteProperty -Name 'desktop-closure' -Value 0
    }
    $receipt.manifestSha256 = (Get-FileHash -LiteralPath (Join-Path $ReleasePath 'manifest.json')).Hash
    Write-WBJson $receiptPath $receipt
}
try {
    New-WBCase 'success-idempotence-and-manual-rollback' {
        $rootsFile = Join-Path $install '.local\workspace-roots.json'
        Write-WBJson $rootsFile ([pscustomobject]@{additionalRoots=@('C:\fixture-root')})
        $rootsHash = (Get-FileHash -LiteralPath $rootsFile).Hash
        $index = (Get-FileHash -LiteralPath (Join-Path $install '.git\index')).Hash
        $result = Invoke-WBDeployment @arguments
        Assert-WB ($result.phase -eq 'completed') 'Update must complete.'
        Assert-WB ($service.stops -eq 1 -and $service.starts -eq 1) 'One stop/start required.'
        Assert-WB (!$result.hostedVerified) 'Local readiness must not claim hosted acceptance.'
        Assert-WB ((Get-FileHash -LiteralPath $rootsFile).Hash -ceq $rootsHash) 'Root configuration must remain unchanged.'
        $backedUpRoots = Join-Path $install '.local\update-operations\update-1\backup\configuration\workspace-roots.json'
        Assert-WB ((Get-FileHash -LiteralPath $backedUpRoots).Hash -ceq $rootsHash) 'Root configuration must be included in recovery evidence.'
        $again = Invoke-WBDeployment @arguments
        Assert-WB ($again.phase -eq 'completed' -and $service.stops -eq 1) 'Replay must not reapply.'
        $arguments.Action = 'Rollback'
        $rollback = Invoke-WBDeployment @arguments
        Assert-WB ($rollback.phase -eq 'rolled_back') 'Manual rollback must succeed.'
        Assert-WB ((Get-Content -LiteralPath (Join-Path $install 'package.json') -Raw | ConvertFrom-Json).version -eq '1.0.0') 'Previous version must be restored.'
        Assert-WB ((Get-FileHash -LiteralPath (Join-Path $install '.git\index')).Hash -ceq $index) 'Git staging must not change.'
        Assert-WB ((Get-Content -LiteralPath (Join-Path $install 'src\keep.txt')).Trim() -ceq 'unrelated source') 'Source must not change.'
    }
    New-WBCase 'startup-failure-auto-rollback' {
        $service.failStarts = 1
        $result = Invoke-WBDeployment @arguments
        Assert-WB ($result.phase -eq 'failed_rolled_back' -and $service.starts -eq 2) 'Broken startup must restore/restart previous runtime.'
        $again = Invoke-WBDeployment @arguments
        Assert-WB ($again.phase -eq 'failed_rolled_back' -and $service.starts -eq 2) 'Failed update replay must be inert.'
    }
    New-WBCase 'readiness-failure-auto-rollback' {
        $service.unhealthy = '2.0.0'
        $result = Invoke-WBDeployment @arguments
        Assert-WB ($result.phase -eq 'failed_rolled_back') 'Bad readiness must roll back.'
    }
    New-WBCase 'busy-command-capacity-does-not-stop' {
        $arguments.CheckIdle = { return $false }
        $result = Invoke-WBDeployment @arguments
        Assert-WB ($result.phase -eq 'preflight_failed' -and $service.stops -eq 0 -and $service.starts -eq 0) 'Busy command capacity must prevent stop and restart.'
        Assert-WB ($result.error -like '*not verified idle*') 'Busy rejection must name the quiescence gate.'
        Assert-WB (@($result.events | Where-Object { $_.phase -eq 'stopping' }).Count -eq 0) 'Busy preflight must never enter stopping phase.'
    }
    New-WBCase 'idle-diagnostic-error-does-not-stop' {
        $arguments.CheckIdle = { throw 'Disposable fixture diagnostics unavailable' }
        $result = Invoke-WBDeployment @arguments
        Assert-WB ($result.phase -eq 'preflight_failed' -and $service.stops -eq 0) 'Unknown live command capacity must prevent stop.'
        Assert-WB ($result.error -like '*diagnostics unavailable*') 'Diagnostic failure must be journaled.'
    }
    New-WBCase 'missing-quiescence-gate-does-not-stop' {
        $arguments.Remove('CheckIdle')
        $result = Invoke-WBDeployment @arguments
        Assert-WB ($result.phase -eq 'preflight_failed' -and $service.stops -eq 0) 'Missing idle guard must prevent stop.'
        Assert-WB ($result.error -like '*requires a live command-quiescence check*') 'Mandatory guard absence must be explicit.'
    }
    New-WBCase 'unhealthy-baseline-does-not-stop' {
        $service.unhealthy = '1.0.0'
        $result = Invoke-WBDeployment @arguments
        Assert-WB ($result.phase -eq 'preflight_failed' -and $service.stops -eq 0) 'Failed preflight must leave the service alone.'
    }
    New-WBCase 'disk-ahead-of-live-refuses-before-stop' {
        $marker = Join-Path $install '.local\installed-release.json'
        Write-WBJson $marker ([pscustomobject]@{schema=1; operationId='previous-fixture'; version='1.0.0'; releaseDigest='fixture'})
        $markerHash = (Get-FileHash -LiteralPath $marker).Hash
        $packagePath = Join-Path $install 'package.json'
        Write-WBJson $packagePath ([pscustomobject]@{name='workbridge-mcp'; version='1.1.0'; type='module'})
        $packageHash = (Get-FileHash -LiteralPath $packagePath).Hash
        $runtimePath = Join-Path $install 'dist\server.js'
        Set-Content -LiteralPath $runtimePath -Value 'runtime-1.1.0'
        $runtimeHash = (Get-FileHash -LiteralPath $runtimePath).Hash
        $arguments.CurrentVersion = '1.0.0'
        $result = Invoke-WBDeployment @arguments
        Assert-WB ($result.phase -eq 'preflight_failed') 'A disk-ahead-of-live baseline must fail preflight.'
        Assert-WB ($result.error -like '*pre-update health check*') 'Expected live-version health mismatch refusal.'
        Assert-WB ($service.stops -eq 0 -and $service.starts -eq 0) 'Mismatch must not stop or restart service.'
        Assert-WB ((Get-FileHash -LiteralPath $marker).Hash -ceq $markerHash) 'Installed marker must remain unchanged.'
        Assert-WB ((Get-FileHash -LiteralPath $packagePath).Hash -ceq $packageHash) 'On-disk version metadata must remain unchanged.'
        Assert-WB ((Get-FileHash -LiteralPath $runtimePath).Hash -ceq $runtimeHash) 'On-disk runtime must remain unchanged.'
        Assert-WB (@($result.events | Where-Object { $_.phase -in @('stopping','installing','starting','verifying','completed') }).Count -eq 0) 'No installation phase may begin.'
    }
    New-WBCase 'gui-006-valid-closure-accepted' {
        Set-WBGuiFixtureRelease $release
        $verified = Get-WBRelease $release
        Assert-WB ($verified.version -ceq '0.16.4-dev') 'Complete GUI closure should verify.'
    }
    New-WBCase 'gui-006-missing-stage-receipt-refused' {
        Set-WBGuiFixtureRelease $release
        $receiptPath = Join-Path $release 'validated.json'
        $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
        $receipt.checks.PSObject.Properties.Remove('desktop-stage')
        Write-WBJson $receiptPath $receipt
        Assert-WBThrows { Get-WBRelease $release } '*GUI release validation is missing or failed*'
    }
    New-WBCase 'gui-006-string-closure-receipt-refused' {
        Set-WBGuiFixtureRelease $release
        $receiptPath = Join-Path $release 'validated.json'
        $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
        $receipt.checks.'desktop-closure' = '0'
        Write-WBJson $receiptPath $receipt
        Assert-WBThrows { Get-WBRelease $release } '*GUI release validation is missing or failed*'
    }
    New-WBCase 'gui-006-array-stage-receipt-refused' {
        Set-WBGuiFixtureRelease $release
        $receiptPath = Join-Path $release 'validated.json'
        $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
        $receipt.checks.'desktop-stage' = @(0)
        Write-WBJson $receiptPath $receipt
        Assert-WBThrows { Get-WBRelease $release } '*GUI release validation is missing or failed*'
    }
    New-WBCase 'gui-006-boolean-closure-receipt-refused' {
        Set-WBGuiFixtureRelease $release
        $receiptPath = Join-Path $release 'validated.json'
        $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
        $receipt.checks.'desktop-closure' = $false
        Write-WBJson $receiptPath $receipt
        Assert-WBThrows { Get-WBRelease $release } '*GUI release validation is missing or failed*'
    }
    New-WBCase 'gui-006-string-legacy-test-receipt-refused' {
        Set-WBGuiFixtureRelease $release
        $receiptPath = Join-Path $release 'validated.json'
        $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
        $receipt.checks.tests = '0'
        Write-WBJson $receiptPath $receipt
        Assert-WBThrows { Get-WBRelease $release } '*GUI release validation is missing or failed: tests*'
    }
    New-WBCase 'gui-006-string-schema-version-refused' {
        Set-WBGuiFixtureRelease $release
        $desktopPath = Join-Path $release 'payload\dist\desktop-runtime-manifest.json'
        $desktop = Get-Content -LiteralPath $desktopPath -Raw | ConvertFrom-Json
        $desktop.schemaVersion = '1'
        Write-WBJson $desktopPath $desktop
        Set-WBGuiFixtureSeal $release
        Assert-WBThrows { Get-WBRelease $release } '*GUI desktop runtime manifest has invalid shape*'
    }
    New-WBCase 'gui-006-boolean-schema-version-refused' {
        Set-WBGuiFixtureRelease $release
        $desktopPath = Join-Path $release 'payload\dist\desktop-runtime-manifest.json'
        $desktop = Get-Content -LiteralPath $desktopPath -Raw | ConvertFrom-Json
        $desktop.schemaVersion = $true
        Write-WBJson $desktopPath $desktop
        Set-WBGuiFixtureSeal $release
        Assert-WBThrows { Get-WBRelease $release } '*GUI desktop runtime manifest has invalid shape*'
    }
    New-WBCase 'gui-006-decimal-size-even-if-numerically-equal-refused' {
        Set-WBGuiFixtureRelease $release
        $desktopPath = Join-Path $release 'payload\dist\desktop-runtime-manifest.json'
        $raw = Get-Content -LiteralPath $desktopPath -Raw
        $modified = $raw -replace '("sizeBytes"\s*:\s*)([0-9]+)', '${1}${2}.0'
        Assert-WB ($modified -cne $raw) 'Synthetic decimal-size fixture must change the manifest.'
        Set-Content -LiteralPath $desktopPath -Value $modified -Encoding UTF8
        Set-WBGuiFixtureSeal $release
        Assert-WBThrows { Get-WBRelease $release } '*GUI desktop runtime entry is invalid*'
    }
    New-WBCase 'gui-006-stage-orphan-refused-after-reseal' {
        Set-WBGuiFixtureRelease $release
        $payload = Join-Path $release 'payload'
        Set-Content -LiteralPath (Join-Path $payload 'dist\.desktop-runtime-stage.lock') -Value 'simulated interrupted stage'
        Set-WBGuiFixtureSeal $release
        Assert-WBThrows { Get-WBRelease $release } '*staging requires recovery*'
    }
    New-WBCase 'legacy-0163-six-gate-receipt-accepted' {
        $legacy = New-WBFixtureRelease (Join-Path $caseRoot 'legacy sealed') '0.16.3-dev'
        $verified = Get-WBRelease $legacy
        Assert-WB ($verified.version -ceq '0.16.3-dev') 'Prior production release contract remains valid.'
    }
    New-WBCase 'gui-006-missing-sealed-helper-refused' {
        Set-WBGuiFixtureRelease $release
        $payload = Join-Path $release 'payload'
        Move-Item -LiteralPath (Join-Path $payload 'dist\Check-DesktopWindowHandle.ps1') -Destination (Join-Path $payload 'dist\withheld-helper.txt')
        Set-WBGuiFixtureSeal $release
        Assert-WBThrows { Get-WBRelease $release } '*Check-DesktopWindowHandle.ps1*'
    }
    New-WBCase 'tampered-candidate-rejected' {
        Add-Content -LiteralPath (Join-Path $release 'payload\dist\server.js') -Value 'tampered'
        Assert-WBThrows { Invoke-WBDeployment @arguments } '*checksum differs*'
        Assert-WB ($service.stops -eq 0) 'Tampered release must not stop service.'
    }
    New-WBCase 'missing-receipt-rejected' {
        Move-Item -LiteralPath (Join-Path $release 'validated.json') -Destination (Join-Path $release 'withheld.json')
        Assert-WBThrows { Invoke-WBDeployment @arguments } '*validated.json*'
        Assert-WB ($service.stops -eq 0) 'Unvalidated release must not stop service.'
    }
    New-WBCase 'failed-test-receipt-rejected' {
        $receipt = Get-Content -LiteralPath (Join-Path $release 'validated.json') -Raw | ConvertFrom-Json
        $receipt.checks.tests = 1
        Write-WBJson (Join-Path $release 'validated.json') $receipt
        Assert-WBThrows { Invoke-WBDeployment @arguments } '*validation is missing or failed*'
    }
    New-WBCase 'concurrent-updater-rejected' {
        $lock = [IO.File]::Open((Join-Path $install '.local\updater.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
        try { Assert-WBThrows { Invoke-WBDeployment @arguments } '*owns the installation lock*' } finally { $lock.Dispose() }
        Assert-WB ($service.stops -eq 0) 'Concurrent updater must not stop service.'
    }
    New-WBCase 'atomic-journal-with-concurrent-status-reader' {
        $statusFile = Join-Path $caseRoot 'status.json'
        Write-WBJson $statusFile ([pscustomobject]@{value=0})
        $readerScript = Join-Path $caseRoot 'status-reader.ps1'
        $ready = Join-Path $caseRoot 'reader-ready'
        @'
param($Library,$StatusFile,$Ready)
$ErrorActionPreference = 'Stop'
. $Library
Set-Content -LiteralPath $Ready -Value ready
for ($index=0; $index -lt 250; $index++) {
    $status = Read-WBJson $StatusFile
    if ($null -eq $status.value -or $status.value -lt 0) { throw 'Reader observed an incomplete journal.' }
}
'@ | Set-Content -LiteralPath $readerScript -Encoding UTF8
        $shell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $process = Start-Process $shell -ArgumentList "-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy RemoteSigned -File `"$readerScript`" -Library `"$(Join-Path $repo 'scripts\Workbridge-Update.ps1')`" -StatusFile `"$statusFile`" -Ready `"$ready`"" -WindowStyle Hidden -PassThru
        try {
            $deadline = [DateTime]::UtcNow.AddSeconds(10)
            while (!(Test-Path -LiteralPath $ready) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 50 }
            Assert-WB (Test-Path -LiteralPath $ready) 'Concurrent reader did not start.'
            for ($index=1; $index -le 50; $index++) { Write-WBJson $statusFile ([pscustomobject]@{value=$index}) }
            Assert-WB ($process.WaitForExit(15000)) 'Concurrent reader did not finish.'
            Assert-WB ($process.ExitCode -eq 0) 'Concurrent status reads must observe complete snapshots.'
        } finally { if (!$process.HasExited) { Stop-Process -Id $process.Id } }
    }
    New-WBCase 'partial-install-auto-rollback' {
        $state = [pscustomobject]@{lock=$null; calls=0}
        $arguments.StopService = {
            $state.calls++
            if ($state.calls -eq 1) { $state.lock = [IO.File]::Open((Join-Path $install '.local\update-operations\update-1\candidate\dist\server.js'), 'Open', 'ReadWrite', 'None') }
            elseif ($state.lock) { $state.lock.Dispose(); $state.lock = $null }
        }.GetNewClosure()
        try {
            $result = Invoke-WBDeployment @arguments
            Assert-WB ($result.phase -eq 'failed_rolled_back') 'An install failure after displacement must restore the old runtime.'
        } finally { if ($state.lock) { $state.lock.Dispose() } }
    }
    New-WBCase 'interrupted-install-recovery-with-missing-package' {
        $result = Invoke-WBDeployment @arguments
        $operation = Join-Path $install '.local\update-operations\update-1'
        $result.phase = 'installing'
        Write-WBJson (Join-Path $operation 'journal.json') $result
        Move-Item -LiteralPath (Join-Path $install 'package.json') -Destination (Join-Path $operation 'interrupted-package.json')
        $arguments.Action = 'Recover'
        $result = Invoke-WBDeployment @arguments
        Assert-WB ($result.phase -eq 'rolled_back') 'Interrupted install must recover even when package.json is missing.'
    }
    New-WBCase 'actual-controller-process-death-recovery' {
        $crashScript = Join-Path $caseRoot 'crash-controller.ps1'
        @'
param($Library,$Install,$Release)
$ErrorActionPreference = 'Stop'
. $Library
Invoke-WBDeployment -InstallRoot $Install -ReleasePath $Release -OperationId update-1 -StopService {} -StartService { [Environment]::Exit(23) } -TestService { param($version,$fresh); $true } -CheckIdle { $true }
'@ | Set-Content -LiteralPath $crashScript -Encoding UTF8
        $shell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
        & $shell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File $crashScript -Library (Join-Path $repo 'scripts\Workbridge-Update.ps1') -Install $install -Release $release
        Assert-WB ($LASTEXITCODE -eq 23) 'Controller must actually terminate during startup.'
        $journal = Get-Content -LiteralPath (Join-Path $install '.local\update-operations\update-1\journal.json') -Raw | ConvertFrom-Json
        Assert-WB ($journal.phase -eq 'starting') 'Abrupt process death must leave a durable startup journal.'
        $arguments.Action = 'Recover'
        $result = Invoke-WBDeployment @arguments
        Assert-WB ($result.phase -eq 'rolled_back') 'Recovery after actual process death must restore the original runtime.'
    }
    New-WBCase 'failed-preparation-issues-no-receipt' {
        $shell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $oldPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            & $shell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File (Join-Path $repo 'scripts\New-WorkbridgeRelease.ps1') -SourceRoot $install -ReleaseId invalid-stage -WorkspaceRoot $caseRoot *> (Join-Path $caseRoot 'failed-stage.log')
            $stageExit = $LASTEXITCODE
        } finally { $ErrorActionPreference = $oldPreference }
        Assert-WB ($stageExit -ne 0) 'Invalid fixture lockfile must fail release preparation.'
        Assert-WB (!(Test-Path -LiteralPath (Join-Path $install '.local\releases\invalid-stage\validated.json'))) 'Failed preparation must not issue a validation receipt.'
        Assert-WB ($service.stops -eq 0) 'Preparation failure must leave service untouched.'
    }
    New-WBCase 'corrupt-backup-refuses-restoration' {
        $result = Invoke-WBDeployment @arguments
        Add-Content -LiteralPath (Join-Path $install '.local\update-operations\update-1\backup\runtime\dist\server.js') -Value 'corrupt'
        $arguments.Action = 'Rollback'
        $result = Invoke-WBDeployment @arguments
        Assert-WB ($result.phase -eq 'recovery_required' -and $service.stops -eq 1) 'Corrupt backup must be detected before stopping the active version.'
    }
    New-WBCase 'operation-id-cannot-change-release' {
        $null = Invoke-WBDeployment @arguments
        $arguments.ReleasePath = New-WBFixtureRelease (Join-Path $caseRoot 'another release') '3.0.0'
        Assert-WBThrows { Invoke-WBDeployment @arguments } '*different release*'
    }
    New-WBCase 'dispatch-bound-release-digest' {
        $arguments.ExpectedReleaseDigest = ('0' * 64)
        Assert-WBThrows { Invoke-WBDeployment @arguments } '*changed after update dispatch*'
        Assert-WB ($service.stops -eq 0) 'A changed dispatched release must not stop service.'
    }
    New-WBCase 'pending-source-version-preserved-through-recovery' {
        Write-WBJson (Join-Path $install 'package.json') ([pscustomobject]@{name='workbridge-mcp';version='9.0.0';type='module'})
        $arguments.CurrentVersion = '1.0.0'
        $result = Invoke-WBDeployment @arguments
        Assert-WB ($result.phase -eq 'completed' -and $result.previousVersion -eq '1.0.0') 'Observed installed version must take precedence over an edited source package.'
        $arguments.Action = 'Rollback'
        $result = Invoke-WBDeployment @arguments
        Assert-WB ($result.phase -eq 'rolled_back') 'Rollback must verify the previous compiled runtime version.'
        Assert-WB ((Read-WBJson (Join-Path $install 'package.json')).version -eq '9.0.0') 'Rollback must preserve the original pending package edit.'
    }
    New-WBCase 'stale-rollback-cannot-overwrite-later-release' {
        $null = Invoke-WBDeployment @arguments
        $second = $arguments.Clone()
        $second.OperationId = 'update-2'
        $second.ReleasePath = New-WBFixtureRelease (Join-Path $caseRoot 'next release') '3.0.0'
        $next = Invoke-WBDeployment @second
        Assert-WB ($next.phase -eq 'completed') 'Second update must complete.'
        $arguments.Action = 'Rollback'
        Assert-WBThrows { Invoke-WBDeployment @arguments } '*later release is installed*'
    }
    New-WBCase 'unrecovered-journal-blocks-new-operation' {
        $result = Invoke-WBDeployment @arguments
        $result.phase = 'installing'
        Write-WBJson (Join-Path $install '.local\update-operations\update-1\journal.json') $result
        $arguments.OperationId = 'update-2'
        Assert-WBThrows { Invoke-WBDeployment @arguments } '*Recover operation update-1*'
    }
    New-WBCase 'path-escape-and-junction-rejected' {
        Assert-WBThrows { Get-WBChild $install '..\outside' } '*escapes*'
        $link = Join-Path $install 'linked'
        New-Item -ItemType Junction -Path $link -Target $release | Out-Null
        try { Assert-WBThrows { Get-WBFiles $install | Out-Null } '*links or junctions*' }
        finally { [IO.Directory]::Delete($link) }
    }
    New-WBCase 'rollback-failure-retains-manual-recovery' {
        $service.failStarts = 2
        $result = Invoke-WBDeployment @arguments
        Assert-WB ($result.phase -eq 'recovery_required') 'Failed rollback startup must require recovery.'
        $arguments.Action = 'Recover'
        $result = Invoke-WBDeployment @arguments
        Assert-WB ($result.phase -eq 'rolled_back') 'Same operation must recover after the transient failure clears.'
    }
    foreach ($script in Get-ChildItem -LiteralPath (Join-Path $repo 'scripts') -Filter '*.ps1') {
        $errors = $null
        [Management.Automation.Language.Parser]::ParseFile($script.FullName, [ref]$null, [ref]$errors) | Out-Null
        Assert-WB (!$errors.Count) "Parse errors in $($script.Name): $errors"
    }
    if ($SchedulerSmoke) {
        Import-Module (Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\Modules\ScheduledTasks') -ErrorAction Stop
        # A real one-shot task must survive termination of the Job Object owner
        # that dispatched it. No production Workbridge task is stopped/changed.
        $taskName = 'Workbridge Updater Fixture ' + [guid]::NewGuid().ToString('N')
        $shell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $marker = Join-Path $fixture 'independent-complete.txt'
        $sent = Join-Path $fixture 'dispatch-sent.txt'
        $worker = Join-Path $fixture 'worker.ps1'
        $dispatcher = Join-Path $fixture 'dispatcher.ps1'
        'param($Marker); Start-Sleep -Seconds 3; Set-Content -LiteralPath $Marker -Value complete' | Set-Content -LiteralPath $worker
        @'
param($Helper,$TaskName,$Sent)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\Modules\ScheduledTasks') -ErrorAction Stop
Add-Type -Path $Helper
[Workbridge.ProcessLifetime]::Attach()
Start-ScheduledTask -TaskName $TaskName
Set-Content -LiteralPath $Sent -Value dispatched
Start-Sleep -Seconds 30
'@ | Set-Content -LiteralPath $dispatcher
        $taskAction = New-ScheduledTaskAction -Execute $shell -Argument "-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy RemoteSigned -File `"$worker`" -Marker `"$marker`""
        $principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().User.Value) -LogonType Interactive -RunLevel Limited
        $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 1)
        $process = $null
        try {
            Register-ScheduledTask -TaskName $taskName -Action $taskAction -Principal $principal -Settings $settings | Out-Null
            $process = Start-Process $shell -ArgumentList "-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy RemoteSigned -File `"$dispatcher`" -Helper `"$(Join-Path $repo 'scripts\Tunnel-ProcessLifetime.cs')`" -TaskName `"$taskName`" -Sent `"$sent`"" -WindowStyle Hidden -PassThru
            $deadline = [DateTime]::UtcNow.AddSeconds(20)
            while (!(Test-Path -LiteralPath $sent) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
            Assert-WB (Test-Path -LiteralPath $sent) 'Fixture dispatcher did not start its task.'
            Stop-Process -Id $process.Id
            while (!(Test-Path -LiteralPath $marker) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
            Assert-WB (Test-Path -LiteralPath $marker) 'Independent task did not survive its dispatcher.'
            Write-Output 'PASS: real scheduled updater survives its dispatching Job Object owner.'
        } finally {
            if ($process -and !$process.HasExited) { Stop-Process -Id $process.Id }
            Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
            Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
        }
    }
    $failed = @($results | Where-Object { !$_.passed })
    if ($failed.Count) { throw "$($failed.Count) of $($results.Count) updater cases failed. Fixture retained at $fixture" }
    Write-Output "PASS: all $($results.Count) updater cases, Windows PowerShell syntax$(if ($SchedulerSmoke) { ', and independent Task Scheduler smoke test' })."
} finally {
    if (@($results | Where-Object { !$_.passed }).Count -eq 0) {
        $resolved = [IO.Path]::GetFullPath($fixture)
        $prefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
        if (!$resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $resolved) -notmatch '^workbridge-updater-test-[0-9a-f]{32}$') { throw 'Unexpected fixture cleanup path.' }
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
