# Shared local update helpers. Compatible with Windows PowerShell 5.1.
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility') -ErrorAction Stop
$script:WBRuntimeNames = @('dist', 'node_modules', 'package.json', 'package-lock.json')
$script:WBSourceNames = @('.gitattributes', '.gitignore', '.prettierrc.json', 'README.md', 'Workbridge Status.cmd', 'package.json', 'package-lock.json', 'tsconfig.json', 'src', 'scripts', 'test', 'docs')

function Assert-WBPath([string]$Path) {
    if (![IO.Path]::IsPathRooted($Path)) { throw 'An absolute path is required.' }
    $full = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    $parent = $full
    while ($parent) {
        if (Test-Path -LiteralPath $parent) {
            if ((Get-Item -LiteralPath $parent -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Update paths cannot contain links or junctions.' }
        }
        $parent = Split-Path -Parent $parent
    }
    return $full
}

function Get-WBChild([string]$Root, [string]$Relative) {
    $rootPath = Assert-WBPath $Root
    if ([IO.Path]::IsPathRooted($Relative)) { throw 'Expected a relative update path.' }
    $child = Assert-WBPath (Join-Path $rootPath $Relative)
    if (!$child.StartsWith($rootPath + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Update path escapes its expected directory.' }
    return $child
}

function Get-WBFiles([string]$Root) {
    $rootPath = Assert-WBPath $Root
    $pending = [Collections.Generic.Stack[string]]::new()
    $pending.Push($rootPath)
    while ($pending.Count) {
        foreach ($item in Get-ChildItem -LiteralPath ($pending.Pop()) -Force) {
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Release trees cannot contain links or junctions.' }
            if ($item.PSIsContainer) { $pending.Push($item.FullName) } else { $item }
        }
    }
}

function Copy-WBTree([string]$Source, [string]$Destination) {
    $sourcePath = Assert-WBPath $Source
    $destinationPath = Assert-WBPath $Destination
    $item = Get-Item -LiteralPath $sourcePath -Force
    if ($item.PSIsContainer) { @(Get-WBFiles $sourcePath) | Out-Null }
    if (Test-Path -LiteralPath $destinationPath) { throw "Copy destination already exists: $destinationPath" }
    Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Recurse -Force
}

function Write-WBJson([string]$Path, $Value) {
    $target = Assert-WBPath $Path
    $temporary = $target + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
    $json = ConvertTo-Json -InputObject $Value -Depth 20
    [IO.File]::WriteAllText($temporary, $json, [Text.UTF8Encoding]::new($false))
    # Windows scanners can briefly hold a just-read journal without delete
    # sharing. Retry the atomic rename; never fall back to truncate/write.
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        try {
            if (Test-Path -LiteralPath $target) { [IO.File]::Replace($temporary, $target, [NullString]::Value) }
            else { [IO.File]::Move($temporary, $target) }
            return
        } catch {
            if ($attempt -eq 19) { throw }
            Start-Sleep -Milliseconds 100
        }
    }
}

function Read-WBJson([string]$Path) {
    # Allow the journal writer to atomically replace a file while Status reads
    # the previous complete snapshot. Get-Content's default sharing can block
    # Windows rename/delete and briefly race the replacement.
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        $stream = $null
        $reader = $null
        try {
            $stream = [IO.File]::Open($Path, 'Open', 'Read', ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
            $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::UTF8, $true)
            return ($reader.ReadToEnd() | ConvertFrom-Json)
        } catch {
            if ($attempt -eq 19) { throw }
            Start-Sleep -Milliseconds 100
        } finally {
            if ($reader) { $reader.Dispose() }
            elseif ($stream) { $stream.Dispose() }
        }
    }
}

function Get-WBManifest([string]$Root) {
    $rootPath = Assert-WBPath $Root
    foreach ($item in @(Get-WBFiles $rootPath | Sort-Object FullName)) {
        [pscustomobject]@{path=$item.FullName.Substring($rootPath.Length + 1); bytes=$item.Length; sha256=(Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash}
    }
}

function Test-WBManifest([string]$Root, $Files) {
    $rootPath = Assert-WBPath $Root
    $actual = @(Get-WBManifest $Root)
    if ($actual.Count -ne @($Files).Count) { throw 'Release file count differs from its manifest.' }
    $expected = @{}
    foreach ($entry in @($Files)) {
        # Actual files/ancestors were checked for reparse points during tree
        # enumeration. Manifest entries need only a lexical containment check;
        # no filesystem read is made using an unverified manifest path here.
        if ([IO.Path]::IsPathRooted($entry.path) -or ![IO.Path]::GetFullPath((Join-Path $rootPath $entry.path)).StartsWith($rootPath + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Manifest path escapes its release.' }
        if ($expected.ContainsKey($entry.path)) { throw 'Duplicate manifest path.' }
        $expected[$entry.path] = $entry
    }
    foreach ($entry in $actual) {
        $saved = $expected[$entry.path]
        if (!$saved -or $saved.sha256 -cne $entry.sha256 -or $saved.bytes -ne $entry.bytes) { throw "Release checksum differs: $($entry.path)" }
    }
}

function Get-WBInstallation([string]$Root, [bool]$AllowDamaged = $false) {
    $rootPath = Assert-WBPath $Root
    if (!(Test-Path -LiteralPath (Join-Path $rootPath 'scripts\Start-BackgroundTunnel.ps1'))) { throw 'Expected a Workbridge installation with its startup launcher.' }
    if (!$AllowDamaged) {
        $package = Get-Content -LiteralPath (Join-Path $rootPath 'package.json') -Raw | ConvertFrom-Json
        if ($package.name -cne 'workbridge-mcp') { throw 'Expected the Workbridge package.' }
    }
    return $rootPath
}

function Test-WBRuntime([string]$Root, $Files) {
    $count = 0
    foreach ($name in $script:WBRuntimeNames) {
        $item = Get-Item -LiteralPath (Get-WBChild $Root $name)
        if ($item.PSIsContainer) { $count += @(Get-WBFiles $item.FullName).Count } else { $count++ }
    }
    if ($count -ne @($Files).Count) { throw 'Installed runtime file count differs.' }
    foreach ($entry in @($Files)) {
        if (($entry.path -split '[\\/]')[0] -notin $script:WBRuntimeNames) { throw 'Unexpected runtime manifest path.' }
        $rootPath = [IO.Path]::GetFullPath($Root).TrimEnd('\')
        $filePath = [IO.Path]::GetFullPath((Join-Path $rootPath $entry.path))
        if ([IO.Path]::IsPathRooted($entry.path) -or !$filePath.StartsWith($rootPath + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Runtime path escapes its installation.' }
        $file = Get-Item -LiteralPath $filePath
        if ($file.Length -ne $entry.bytes -or (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash -cne $entry.sha256) { throw "Installed runtime checksum differs: $($entry.path)" }
    }
}

function Get-WBRelease([string]$Path) {
    $release = Assert-WBPath $Path
    $receipt = Get-Content -LiteralPath (Join-Path $release 'validated.json') -Raw | ConvertFrom-Json
    $manifestFile = Join-Path $release 'manifest.json'
    if ($receipt.schema -ne 1 -or $receipt.result -cne 'passed' -or $receipt.manifestSha256 -cne (Get-FileHash -LiteralPath $manifestFile -Algorithm SHA256).Hash) { throw 'Release does not have a matching successful validation receipt.' }
    foreach ($check in @('install', 'tests', 'startup', 'updater', 'format', 'acceptance')) {
        if ($null -eq $receipt.checks.$check -or $receipt.checks.$check -ne 0) { throw "Release validation is missing or failed: $check" }
    }
    $manifest = Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json
    $payload = Get-WBChild $release 'payload'
    Test-WBManifest $payload $manifest.files
    # GUI-006 requires its desktop runtime closure and gate receipts even on a
    # manually supplied release. Legacy releases retain their original contract.
    if ($manifest.version -ceq '0.16.4-dev') {
        foreach ($check in @('generic', 'desktop-stage', 'desktop-closure')) {
            $value = $receipt.checks.$check
            if (($value -isnot [int] -and $value -isnot [long]) -or $value -ne 0) {
                throw "GUI release validation is missing or failed: $check"
            }
        }
        $desktopNames = @('desktop-ui.mjs', 'desktop-capture.mjs', 'vmware-host-capture.mjs', 'desktop-probe-act.mjs', 'Check-DesktopWindowHandle.ps1')
        $desktopDist = Get-WBChild $payload 'dist'
        foreach ($item in @(Get-ChildItem -LiteralPath $desktopDist -Force)) {
            if ($item.Name -ceq '.desktop-runtime-stage.lock' -or $item.Name.StartsWith('.desktop-stage-', [StringComparison]::Ordinal)) {
                throw 'GUI desktop runtime staging requires recovery.'
            }
        }
        $desktopManifestPath = Get-WBChild $payload 'dist\desktop-runtime-manifest.json'
        $desktopManifestItem = Get-Item -LiteralPath $desktopManifestPath -Force
        if ($desktopManifestItem.PSIsContainer -or ($desktopManifestItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $desktopManifestItem.Length -gt 65536) {
            throw 'GUI desktop runtime manifest is unsafe.'
        }
        $desktop = Get-Content -LiteralPath $desktopManifestPath -Raw | ConvertFrom-Json
        if ($desktop.schemaVersion -ne 1 -or @($desktop.files).Count -ne $desktopNames.Count) {
            throw 'GUI desktop runtime manifest has invalid shape.'
        }
        for ($i = 0; $i -lt $desktopNames.Count; $i++) {
            $name = $desktopNames[$i]
            $entry = $desktop.files[$i]
            if ($entry.name -cne $name -or $entry.sizeBytes -is [string] -or
                $entry.sizeBytes -le 0 -or $entry.sizeBytes -gt 1048576 -or
                $entry.sha256 -cnotmatch ('^[0-9a-f]{64}' + [char]36)) {
                throw "GUI desktop runtime entry is invalid: $name"
            }
            foreach ($relative in @("scripts\$name", "dist\$name")) {
                $item = Get-Item -LiteralPath (Get-WBChild $payload $relative) -Force
                if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
                    $item.Length -ne $entry.sizeBytes -or
                    (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant() -cne $entry.sha256) {
                    throw "GUI desktop runtime checksum differs: $relative"
                }
            }
        }
    }
    $package = Get-Content -LiteralPath (Join-Path $payload 'package.json') -Raw | ConvertFrom-Json
    if ($package.name -cne 'workbridge-mcp' -or $package.version -cne $manifest.version -or $receipt.version -cne $manifest.version) { throw 'Release package version differs from its validation receipt.' }
    foreach ($name in $script:WBRuntimeNames) {
        if (!(Test-Path -LiteralPath (Join-Path $payload $name))) { throw "Release lacks $name" }
    }
    return [pscustomobject]@{path=$release; payload=$payload; manifest=$manifest; digest=$receipt.manifestSha256; version=$manifest.version}
}

function Set-WBPhase($Record, [string]$Journal, [string]$Phase) {
    $Record.phase = $Phase
    $Record.updatedUtc = [DateTime]::UtcNow.ToString('o')
    $Record.events = @($Record.events) + @([pscustomobject]@{phase=$Phase; utc=$Record.updatedUtc})
    Write-WBJson $Journal $Record
}

function Set-WBRuntime([string]$InstallRoot, [string]$Payload, [string]$Operation) {
    # Every move has a fixed, verified absolute target inside this installation.
    # Displaced files are retained; this updater never recursively deletes data.
    $displaced = Get-WBChild $Operation ('displaced\' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $displaced -Force | Out-Null
    foreach ($name in $script:WBRuntimeNames) {
        $target = Get-WBChild $InstallRoot $name
        $source = Get-WBChild $Payload $name
        if (!(Test-Path -LiteralPath $source)) { throw "Runtime payload lacks $name" }
        if (Test-Path -LiteralPath $target) {
            if ((Get-Item -LiteralPath $target).PSIsContainer) { @(Get-WBFiles $target) | Out-Null }
            Move-Item -LiteralPath $target -Destination (Get-WBChild $displaced $name)
        }
        Copy-WBTree $source $target
    }
}

function Invoke-WBDeployment {
    param([string]$InstallRoot, [string]$OperationId, [string]$ReleasePath, [string]$ExpectedReleaseDigest = '', [string]$CurrentVersion = '', [ValidateSet('Apply','Recover','Rollback')][string]$Action = 'Apply', [scriptblock]$StopService, [scriptblock]$StartService, [scriptblock]$TestService)
    $install = Get-WBInstallation $InstallRoot ($Action -ne 'Apply')
    if ($OperationId -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$') { throw 'Invalid update operation ID.' }
    $operations = Get-WBChild $install '.local\update-operations'
    New-Item -ItemType Directory -Path $operations -Force | Out-Null
    $operation = Get-WBChild $operations $OperationId
    New-Item -ItemType Directory -Path $operation -Force | Out-Null
    $lock = $null
    try {
        try { $lock = [IO.File]::Open((Get-WBChild $install '.local\updater.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
        catch { throw 'Another Workbridge updater owns the installation lock.' }
        $journal = Get-WBChild $operation 'journal.json'
        $record = $null
        if (Test-Path -LiteralPath $journal) {
            $record = Read-WBJson $journal
            if ($record.installRoot -cne $install -or $record.operationId -cne $OperationId) { throw 'Update journal belongs to another operation or installation.' }
            if ($Action -eq 'Apply') {
                $release = Get-WBRelease $ReleasePath
                if ($ExpectedReleaseDigest -and $release.digest -cne $ExpectedReleaseDigest) { throw 'Release changed after update dispatch.' }
                if ($record.releaseDigest -cne $release.digest) { throw 'Operation ID was already used for a different release.' }
                if ($record.phase -in @('completed','rolled_back','failed_rolled_back','preflight_failed')) { return $record }
                throw 'An interrupted update exists. Use Recover with the SAME operation ID before another update.'
            }
        } elseif ($Action -ne 'Apply') { throw 'No update journal exists for recovery.' }
        if ($Action -eq 'Apply') {
            # Refuse a second operation while an earlier journal still needs recovery.
            foreach ($other in Get-ChildItem -LiteralPath $operations -Directory) {
                $otherJournal = Get-WBChild $other.FullName 'journal.json'
                if ($other.FullName -ne $operation -and (Test-Path -LiteralPath $otherJournal)) {
                    $otherRecord = Read-WBJson $otherJournal
                    if ($otherRecord.phase -notin @('completed','rolled_back','failed_rolled_back','preflight_failed')) { throw "Recover operation $($other.Name) before starting another update." }
                }
            }
            $release = Get-WBRelease $ReleasePath
            if ($ExpectedReleaseDigest -and $release.digest -cne $ExpectedReleaseDigest) { throw 'Release changed after update dispatch.' }
            $previousRelease = $null
            $marker = Get-WBChild $install '.local\installed-release.json'
            if (Test-Path -LiteralPath $marker) { $previousRelease = Read-WBJson $marker }
            if (!$CurrentVersion) { $CurrentVersion = (Get-Content -LiteralPath (Join-Path $install 'package.json') -Raw | ConvertFrom-Json).version }
            $record = [pscustomobject]@{schema=1; operationId=$OperationId; installRoot=$install; releaseDigest=$release.digest; version=$release.version; previousVersion=$CurrentVersion; previousRelease=$previousRelease; phase='preparing'; updatedUtc=''; events=@(); error=$null; recoveryError=$null; hostedVerified=$false}
            Set-WBPhase $record $journal 'preparing'
            try {
                $candidate = Get-WBChild $operation 'candidate'
                New-Item -ItemType Directory -Path $candidate | Out-Null
                foreach ($name in $script:WBRuntimeNames) { Copy-WBTree (Join-Path $release.payload $name) (Join-Path $candidate $name) }
                $runtimeFiles = @($release.manifest.files | Where-Object { ($_.path -split '[\\/]')[0] -in $script:WBRuntimeNames })
                Test-WBManifest $candidate $runtimeFiles
                $backup = Get-WBChild $operation 'backup'
                $backupRuntime = Get-WBChild $backup 'runtime'
                New-Item -ItemType Directory -Path $backupRuntime -Force | Out-Null
                foreach ($name in $script:WBRuntimeNames) { Copy-WBTree (Join-Path $install $name) (Join-Path $backupRuntime $name) }
                $backupSource = Get-WBChild $backup 'source'
                New-Item -ItemType Directory -Path $backupSource | Out-Null
                foreach ($name in @($script:WBSourceNames) + @('.git')) {
                    $source = Get-WBChild $install $name
                    if (Test-Path -LiteralPath $source) { Copy-WBTree $source (Join-Path $backupSource $name) }
                }
                $configuration = Get-WBChild $backup 'configuration'
                New-Item -ItemType Directory -Path $configuration | Out-Null
                foreach ($name in @('autostart.json','commands.json','settings.json','workspace-roots.json','profiles','tunnel-client-path.txt')) {
                    $source = Get-WBChild $install ('.local\' + $name)
                    if (Test-Path -LiteralPath $source) { Copy-WBTree $source (Join-Path $configuration $name) }
                }
                # No keys are decrypted or copied. The launcher keeps its existing credential reference.
                if (Test-Path -LiteralPath (Join-Path $operation 'service-task.xml')) { Copy-WBTree (Join-Path $operation 'service-task.xml') (Join-Path $configuration 'service-task.xml') }
                $backupFiles = @(Get-WBManifest $backupRuntime)
                Write-WBJson (Join-Path $operation 'backup-manifest.json') ([pscustomobject]@{schema=1; version=$record.previousVersion; createdUtc=[DateTime]::UtcNow.ToString('o'); files=$backupFiles; preservedFiles=@(Get-WBManifest $backup)})
                Test-WBManifest $backupRuntime $backupFiles
                Test-WBRuntime $install $backupFiles
                if (!(& $TestService $record.previousVersion $false)) { throw 'Current installation failed the pre-update health check.' }
                Set-WBPhase $record $journal 'prepared'
            } catch {
                $record.error = $_.Exception.Message
                Set-WBPhase $record $journal 'preflight_failed'
                return $record
            }
            try {
                Set-WBPhase $record $journal 'stopping'
                & $StopService
                Set-WBPhase $record $journal 'installing'
                Set-WBRuntime $install $candidate $operation
                Test-WBRuntime $install $runtimeFiles
            } catch {
                $record.error = $_.Exception.Message
            }
            if (!$record.error) {
                try {
                    Set-WBPhase $record $journal 'starting'
                    & $StartService
                    Set-WBPhase $record $journal 'verifying'
                    if (!(& $TestService $record.version $true)) { throw 'Updated service failed readiness or version verification.' }
                    Write-WBJson (Get-WBChild $install '.local\installed-release.json') ([pscustomobject]@{schema=1; operationId=$OperationId; version=$record.version; releaseDigest=$record.releaseDigest})
                    Set-WBPhase $record $journal 'completed'
                    return $record
                } catch { $record.error = $_.Exception.Message }
            }
        } elseif ($record.phase -in @('rolled_back','failed_rolled_back','preflight_failed')) { return $record }
        elseif ($record.phase -eq 'preparing') {
            # No stop/install occurs before the prepared journal is durable.
            Set-WBPhase $record $journal 'preflight_failed'
            return $record
        } elseif ($record.phase -eq 'completed') {
            $installed = Read-WBJson (Get-WBChild $install '.local\installed-release.json')
            if ($installed.operationId -cne $OperationId) { throw 'A later release is installed. Roll back the latest operation first.' }
        }
        try {
            $backupRuntime = Get-WBChild $operation 'backup\runtime'
            $backupManifest = Get-Content -LiteralPath (Join-Path $operation 'backup-manifest.json') -Raw | ConvertFrom-Json
            if ($backupManifest.version -cne $record.previousVersion) { throw 'Backup version does not match this operation.' }
            Test-WBManifest $backupRuntime $backupManifest.files
            Set-WBPhase $record $journal 'rolling_back'
            & $StopService
            Set-WBRuntime $install $backupRuntime $operation
            Test-WBRuntime $install $backupManifest.files
            Set-WBPhase $record $journal 'restarting_previous'
            & $StartService
            if (!(& $TestService $record.previousVersion $true)) { throw 'Previous service failed readiness after restoration.' }
            $previousMarker = $record.previousRelease
            if (!$previousMarker) { $previousMarker = [pscustomobject]@{schema=1; operationId=$null; version=$record.previousVersion; releaseDigest=$null} }
            Write-WBJson (Get-WBChild $install '.local\installed-release.json') $previousMarker
            $record.recoveryError = $null
            Set-WBPhase $record $journal $(if ($Action -eq 'Apply') { 'failed_rolled_back' } else { 'rolled_back' })
        } catch {
            $record.recoveryError = $_.Exception.Message
            Set-WBPhase $record $journal 'recovery_required'
        }
        return $record
    } finally { if ($lock) { $lock.Dispose() } }
}
