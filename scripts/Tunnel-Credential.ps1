# Windows DPAPI binds the ciphertext to this Windows user on this computer.
# Resolve the module belonging to this host, even with an inherited PSModulePath.
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security') -ErrorAction Stop
function Get-TunnelCredentialPath {
    if (!$env:LOCALAPPDATA) { throw 'LOCALAPPDATA is unavailable.' }
    Join-Path $env:LOCALAPPDATA 'Workbridge\runtime-key.dpapi'
}

function Read-TunnelCredential([string]$CredentialPath = '') {
    if (!$CredentialPath) { $CredentialPath = Get-TunnelCredentialPath }
    if (!(Test-Path -LiteralPath $credentialPath -PathType Leaf)) { return $null }
    try {
        $encrypted = (Get-Content -LiteralPath $credentialPath -Raw -ErrorAction Stop).Trim()
        ConvertTo-SecureString -String $encrypted -ErrorAction Stop
    } catch {
        throw 'Cannot decrypt the saved Workbridge key. Run Save-TunnelCredential.ps1 again under this Windows account.'
    }
}

function Write-TunnelCredential([System.Security.SecureString]$Secret, [string]$CredentialPath = '') {
    if (!$Secret -or $Secret.Length -eq 0) { throw 'Runtime API key cannot be empty.' }
    if (!$CredentialPath) { $CredentialPath = Get-TunnelCredentialPath }
    $credentialDirectory = Split-Path -Parent $credentialPath
    New-Item -ItemType Directory -Path $credentialDirectory -Force -ErrorAction Stop | Out-Null
    if ((Get-Item -LiteralPath $credentialDirectory).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw 'The credential directory must not be a link or junction.'
    }
    if ((Test-Path -LiteralPath $credentialPath) -and ((Get-Item -LiteralPath $credentialPath).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'The credential file must not be a link.'
    }
    # Load/update only the DACL. Setting an owner or an audit descriptor can
    # require privileges absent from an ordinary sign-in session.
    $acl = [System.Security.AccessControl.DirectorySecurity]::new($credentialDirectory, [System.Security.AccessControl.AccessControlSections]::Access)
    $acl.SetAccessRuleProtection($true, $false)
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    foreach ($existingRule in $acl.GetAccessRules($true, $false, [System.Security.Principal.SecurityIdentifier])) {
        $acl.RemoveAccessRuleSpecific($existingRule)
    }
    foreach ($sid in @($identity, [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
        $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $acl.AddAccessRule($rule)
    }
    # Persist only modified access rules through .NET. Windows PowerShell's
    # Set-Acl can also request audit-policy privileges when replacing a DACL.
    if ($PSVersionTable.PSEdition -eq 'Desktop') {
        [IO.Directory]::SetAccessControl($credentialDirectory, $acl)
    } else {
        [IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo]::new($credentialDirectory), $acl)
    }
    $Secret | ConvertFrom-SecureString -ErrorAction Stop | Set-Content -LiteralPath $credentialPath -Encoding ASCII -ErrorAction Stop
    # Verify decryptability without displaying or returning plaintext.
    $check = Read-TunnelCredential -CredentialPath $CredentialPath
    try { if ($check.Length -ne $Secret.Length) { throw 'Saved-key verification failed.' } }
    finally { if ($check) { $check.Dispose() } }
}
