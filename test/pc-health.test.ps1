[CmdletBinding()]
param([Parameter(Mandatory)][string]$InstallDirectory)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $repo 'scripts/Workbridge-Update.ps1')
$manager = Join-Path $repo 'scripts/Manage-HelperTask.ps1'
$id = 'health-test-' + [guid]::NewGuid().ToString('N').Substring(0,12)
$fixture = Get-WBChild $InstallDirectory ('tests/' + $id)
$data = Get-WBChild $fixture 'data'
$fakeRepo = Get-WBChild $fixture 'repo'
New-Item -ItemType Directory -Path $data,(Get-WBChild $fakeRepo '.local') | Out-Null
[IO.File]::WriteAllText((Get-WBChild $fakeRepo '.local/health-url.txt'),'https://example.invalid')
[IO.File]::WriteAllText((Get-WBChild $data 'transitions.jsonl'),('x' * 1048577))
$exe = Get-WBChild $InstallDirectory 'PcHealth/PcHealth.exe'
$status = Get-WBChild $data 'status.json'
function Assert-Health($value,[string]$message) { if (!$value) { throw $message } }
try {
    & $manager -Action Register -HelperId $id -Executable $exe -Argument @($data,$fakeRepo,'2') -WorkingDirectory $fixture | Out-Null
    & $manager -Action Start -HelperId $id | Out-Null
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    while (!(Test-Path -LiteralPath $status) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
    $first = Get-Content -LiteralPath $status -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-Health (!$first.elevated -and !$first.bridge.available -and $first.condition -eq 'warning') 'Expected normal user and invalid-endpoint warning.'
    Assert-Health (Test-Path -LiteralPath (Get-WBChild $data 'transitions.jsonl.previous')) 'Bounded log rotation did not run.'
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $exe
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.Arguments = '"' + $data + '" "' + $fakeRepo + '" 2'
    $duplicate = [Diagnostics.Process]::Start($start)
    try { if (!$duplicate.WaitForExit(5000)) { throw 'Duplicate recorder did not exit.' }; Assert-Health ($duplicate.ExitCode -eq 3) 'Duplicate recorder acquired the report lock.' } finally { $duplicate.Dispose() }
    Start-Sleep -Seconds 3
    $second = Get-Content -LiteralPath $status -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-Health ($second.instance -ceq $first.instance -and $second.sequence -gt $first.sequence) 'Recorder stopped or changed instance.'
    $transitions = @(Get-Content -LiteralPath (Get-WBChild $data 'transitions.jsonl'))
    Assert-Health ($transitions.Count -eq 1) 'Unchanged warning produced repeated transition events.'
    $worker = Get-WBChild $InstallDirectory 'WindowsHealthScan/Run-WindowsHealthScan.ps1'
    & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File $worker -BundleDirectory (Get-WBChild $InstallDirectory 'WindowsHealthScan') -ExpectedSha256 ('0' * 64) -AdminAction scan -ScanId ('a' * 32) -OperationId $id | Out-Null
    Assert-Health ($LASTEXITCODE -eq 1) 'Payload drift not rejected.'
    $receipt = Get-Content -LiteralPath (Get-WBChild $InstallDirectory ('WindowsHealthScan/operations/' + $id + '/receipt.json')) -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-Health ($receipt.state -eq 'failed' -and $receipt.error -like '*PAYLOAD_CHANGED*') 'Unexpected hash preflight result.'
    $result = @{status='passed';normalToken=$true;invalidEndpointRejected=$true;logRotation=$true;unchangedConditionNotRepeated=$true;singleInstanceLock=$true;advancingSamples=$true;payloadDriftRejectedBeforeUac=$true;completedUtc=[DateTime]::UtcNow.ToString('o')}
    Write-WBJson (Get-WBChild $InstallDirectory 'tests/acceptance.json') $result
    $result | ConvertTo-Json
} finally { & $manager -Action Remove -HelperId $id | Out-Null }
