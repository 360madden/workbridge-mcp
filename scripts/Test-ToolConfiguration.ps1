param([Parameter(Mandatory = $true)][string]$OutputDirectory)

$ErrorActionPreference = 'Stop'
$target = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $target) { throw 'Choose a new directory; existing repositories are never modified.' }
$git = (Get-Command git.exe -ErrorAction Stop).Source
New-Item -ItemType Directory -Path $target | Out-Null
$previousEncoding = [Console]::OutputEncoding
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
Push-Location -LiteralPath $target
try {
    & $git init --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Git initialization failed.' }
    $config = Join-Path $target '.git/config'
    $backup = Join-Path $target 'git-config.backup'
    Copy-Item -LiteralPath $config -Destination $backup
    $before = (Get-FileHash -LiteralPath $config -Algorithm SHA256).Hash
    $filename = 'caf' + [char]0xE9 + '.txt'
    'configuration behavior probe' | Set-Content -LiteralPath $filename -Encoding UTF8
    try {
        & $git config --local core.quotePath true
        if ($LASTEXITCODE -ne 0) { throw 'Setting quotePath=true failed.' }
        $quoted = (& $git -c core.fsmonitor=false status --porcelain -- $filename | Out-String).Trim()
        if ($LASTEXITCODE -ne 0) { throw 'First Git status failed.' }
        & $git config --local core.quotePath false
        if ($LASTEXITCODE -ne 0) { throw 'Setting quotePath=false failed.' }
        $unquoted = (& $git -c core.fsmonitor=false status --porcelain -- $filename | Out-String).Trim()
        if ($LASTEXITCODE -ne 0) { throw 'Second Git status failed.' }
        if ($quoted -eq $unquoted -or -not $unquoted.Contains($filename)) {
            throw 'Git output did not demonstrate the config behavior change.'
        }
    } finally {
        Copy-Item -LiteralPath $backup -Destination $config -Force
    }
    $after = (Get-FileHash -LiteralPath $config -Algorithm SHA256).Hash
    if ($before -ne $after) { throw 'Original Git config was not restored byte-for-byte.' }
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    [ordered]@{
        status = 'passed'
        application = $git
        setting = 'local core.quotePath'
        quotedStatus = $quoted
        unquotedStatus = $unquoted
        originalConfigSha256 = $before
        restoredConfigSha256 = $after
        restoredByteExact = $true
        elevatedAdministrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
        elevationAttempted = $false
        outputDirectory = $target
        completedUtc = [DateTime]::UtcNow.ToString('o')
    } | ConvertTo-Json | Set-Content -LiteralPath acceptance.json -Encoding UTF8
    Get-Content -LiteralPath acceptance.json -Raw
} finally {
    Pop-Location
    [Console]::OutputEncoding = $previousEncoding
}
