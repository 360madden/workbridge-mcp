[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('Own', 'CheckOwned', 'Protect', 'Unprotect', 'ReadOwned')][string]$Action,
    [string]$Directory = ''
)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security') -ErrorAction Stop

function Write-StandardOutput([string]$Value) {
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes($Value)
    $output = [Console]::OpenStandardOutput()
    $output.Write($bytes, 0, $bytes.Length)
    $output.Flush()
}

if ($Action -eq 'Protect') {
    $plain = [Console]::In.ReadToEnd()
    if (!$plain) { throw 'Descriptor input is empty.' }
    $secret = ConvertTo-SecureString -String $plain -AsPlainText -Force
    try { Write-StandardOutput ($secret | ConvertFrom-SecureString -ErrorAction Stop) }
    finally { $secret.Dispose() }
    exit 0
}

if ($Action -eq 'Unprotect') {
    $ciphertext = [Console]::In.ReadToEnd().Trim()
    if (!$ciphertext) { throw 'Protected descriptor input is empty.' }
    $secret = ConvertTo-SecureString -String $ciphertext -ErrorAction Stop
    try {
        $credential = [Net.NetworkCredential]::new('', $secret)
        Write-StandardOutput $credential.Password
    } finally {
        if ($secret) { $secret.Dispose() }
    }
    exit 0
}

if (!$Directory -or ![IO.Path]::IsPathRooted($Directory)) {
    throw "$Action requires an absolute descriptor directory."
}
if ($Action -eq 'Own') {
    New-Item -ItemType Directory -Path $Directory -Force -ErrorAction Stop | Out-Null
} elseif (!(Test-Path -LiteralPath $Directory -PathType Container)) {
    throw 'The local-service descriptor directory does not exist.'
}
$directoryInfo = Get-Item -LiteralPath $Directory -Force -ErrorAction Stop
if (!$directoryInfo.PSIsContainer -or ($directoryInfo.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'The local-service descriptor directory must be a normal directory.'
}

# Keep endpoint metadata and its DPAPI ciphertext private to this Windows user.
# SYSTEM retains access so normal Windows servicing and recovery still work.
$lockPath = Join-Path $Directory 'owner.lock'
if ($Action -eq 'Own') {
    $acl = [Security.AccessControl.DirectorySecurity]::new(
        $Directory,
        [Security.AccessControl.AccessControlSections]::Access
    )
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($rule in $acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier])) {
        $acl.RemoveAccessRuleSpecific($rule)
    }
    $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $systemSid = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
    foreach ($sid in @($currentSid, $systemSid)) {
        $rule = [Security.AccessControl.FileSystemAccessRule]::new(
            $sid,
            'FullControl',
            'ContainerInherit,ObjectInherit',
            'None',
            'Allow'
        )
        $acl.AddAccessRule($rule)
    }
    if ($PSVersionTable.PSEdition -eq 'Desktop') {
        [IO.Directory]::SetAccessControl($Directory, $acl)
    } else {
        [IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo]::new($Directory), $acl)
    }
}
if (Test-Path -LiteralPath $lockPath) {
    $lockInfo = Get-Item -LiteralPath $lockPath -Force -ErrorAction Stop
    if ($lockInfo.PSIsContainer -or ($lockInfo.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'The local-service owner lock must be a normal file.'
    }
}
$lock = $null
if ($Action -in @('CheckOwned', 'ReadOwned')) {
    try {
        $lock = [IO.File]::Open($lockPath, 'Open', 'ReadWrite', 'None')
        if ($Action -eq 'CheckOwned') { Write-StandardOutput "NOT_OWNED`n" }
        exit 2
    } catch [IO.IOException] {
        # ERROR_SHARING_VIOLATION (32) or ERROR_LOCK_VIOLATION (33) proves a
        # live process still owns the non-shared handle. Other I/O failures do not.
        $code = $_.Exception.HResult -band 0xffff
        if ($code -notin @(32, 33)) { throw }
        if ($Action -eq 'CheckOwned') {
            Write-StandardOutput "OWNED`n"
        } else {
            $ciphertext = [Console]::In.ReadToEnd().Trim()
            if (!$ciphertext) { throw 'Protected descriptor input is empty.' }
            $secret = ConvertTo-SecureString -String $ciphertext -ErrorAction Stop
            try {
                $credential = [Net.NetworkCredential]::new('', $secret)
                Write-StandardOutput $credential.Password
            } finally {
                if ($secret) { $secret.Dispose() }
            }
        }
        exit 0
    } finally {
        if ($lock) { $lock.Dispose() }
    }
}
$lock = $null
try {
    # FileShare.None is the owner boundary. The helper inherits an anonymous
    # stdin pipe, so a crashed parent releases both the pipe and this lock.
    $lock = [IO.File]::Open($lockPath, 'OpenOrCreate', 'ReadWrite', 'None')
    Write-StandardOutput "READY`n"
    [Console]::In.ReadToEnd() | Out-Null
} finally {
    if ($lock) { $lock.Dispose() }
}
