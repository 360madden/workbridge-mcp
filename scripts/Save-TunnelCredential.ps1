[CmdletBinding()]
param([switch]$DestinationConfirmed, [string]$CredentialPath = '')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Tunnel-Credential.ps1')
if (!$CredentialPath) { $CredentialPath = Get-TunnelCredentialPath }
Write-Host "Save the EXISTING Workbridge runtime API key encrypted for $([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)."
Write-Host "Destination: $credentialPath"
Write-Host 'This allows Workbridge to connect automatically whenever you sign in.'
if (!$DestinationConfirmed -and (Read-Host 'Save to this location? Type YES to continue') -cne 'YES') { throw 'Key storage canceled; no key was saved.' }
$secret = Read-Host 'Paste the SAME Workbridge runtime API key (hidden), then press Enter' -AsSecureString
try {
    $credential = [System.Net.NetworkCredential]::new('', $secret)
    if (!$credential.Password.StartsWith('sk-') -or $credential.Password -match '\s') {
        throw 'That does not look like an API key. Nothing was saved. Run this script again with the Workbridge runtime key.'
    }
    Write-TunnelCredential -Secret $secret -CredentialPath $CredentialPath
}
finally { if ($secret) { $secret.Dispose() } }
Write-Host 'Workbridge runtime key saved and verified. You may close this window.'
