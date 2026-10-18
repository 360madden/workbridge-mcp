[CmdletBinding()]
param([Parameter(Mandatory)][ValidatePattern('^tunnel_(?:[a-z0-9]{4}_)?[a-z0-9]{32}$')][string]$TunnelId)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$pointer = Join-Path $repo '.local\tunnel-client-path.txt'
if (!(Test-Path -LiteralPath $pointer)) { throw 'Run .\scripts\Install-TunnelClient.ps1 first.' }
$tunnel = (Get-Content -LiteralPath $pointer -Raw).Trim()
$server = Join-Path $repo 'dist\server.js'
if (!(Test-Path -LiteralPath $server)) { throw 'Run npm ci and npm run build first.' }
$node = (Get-Command node.exe -ErrorAction Stop).Source.Replace('\', '/')
$server = $server.Replace('\', '/')
$command = '"{0}" "{1}"' -f $node, $server
& $tunnel init --sample sample_mcp_stdio_local --profile workbridge --profile-dir (Join-Path $repo '.local\profiles') --tunnel-id $TunnelId --mcp-command $command --health-listen-addr '127.0.0.1:0'
if ($LASTEXITCODE -ne 0) { throw 'Tunnel profile creation failed. Existing profiles are never overwritten automatically.' }
Write-Host 'Profile created with an environment reference for the runtime key. No key was saved.'
Write-Host 'Next: .\scripts\Start-Tunnel.ps1'
