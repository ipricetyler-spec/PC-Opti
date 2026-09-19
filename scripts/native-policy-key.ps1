# Owner-invoked local key custody. Never exports plaintext private material.
# Create requires explicit owner authorization; Inspect is the default.
param(
  [ValidateSet('Create','Inspect','Sign')][string]$Action = 'Inspect',
  [Parameter(Mandatory)][string]$KeyDirectory,
  [string]$PolicyPath,
  [string]$SignaturePath,
  [string]$PublicFingerprint
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$privateBytes = $null
$rsa = $null
try {
  if (-not $IsWindows -or $PSVersionTable.PSVersion.Major -lt 7) { throw 'Windows PowerShell 7 is required.' }
  function Check-Path([string]$File, [bool]$MayBeMissing = $false) {
    if (-not [IO.Path]::IsPathFullyQualified($File)) { throw 'Absolute path required.' }
    $resolved = [IO.Path]::GetFullPath($File)
    for ($part = $resolved; $part; $part = [IO.Path]::GetDirectoryName($part)) {
      if (Test-Path -LiteralPath $part) {
        if (((Get-Item -LiteralPath $part -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Linked path refused.' }
      } elseif (-not $MayBeMissing) { throw 'Missing input.' }
    }
    return $resolved
  }
  function Read-Bounded([string]$File, [int]$Limit) {
    $null = Check-Path $File
    $stream = [IO.FileStream]::new($File, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try {
      if ($stream.Length -lt 1 -or $stream.Length -gt $Limit) { throw 'Input bounds refused.' }
      $bytes = [byte[]]::new([int]$stream.Length)
      $stream.ReadExactly($bytes)
      return ,$bytes
    } finally { $stream.Dispose() }
  }
  function Write-New([string]$File, [byte[]]$Bytes) {
    $null = Check-Path $File $true
    $stream = [IO.FileStream]::new($File, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $stream.Write($Bytes); $stream.Flush($true) } finally { $stream.Dispose() }
  }
  $directory = Check-Path $KeyDirectory $true
  $repository = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
  if ($directory.Equals($repository, [StringComparison]::OrdinalIgnoreCase) -or $directory.StartsWith($repository + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Key custody must be outside the workspace.' }
  $ownerSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $systemSid = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
  if ($Action -eq 'Create') {
    if (Test-Path -LiteralPath $directory) { throw 'Creation never replaces an existing custody directory.' }
    $null = New-Item -ItemType Directory -Path $directory
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    $acl.SetOwner($ownerSid)
    foreach ($sid in @($ownerSid, $systemSid)) {
      $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
    }
    Set-Acl -LiteralPath $directory -AclObject $acl
  }
  $null = Check-Path $directory
  $acl = Get-Acl -LiteralPath $directory
  if (-not $acl.AreAccessRulesProtected -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $ownerSid.Value) { throw 'Custody owner or inheritance refused.' }
  foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin @($ownerSid.Value, $systemSid.Value)) { throw 'Custody permissions are too broad.' }
  }
  $privateFile = Join-Path $directory 'release-policy-private.dpapi'
  $publicFile = Join-Path $directory 'release-policy-public.pem'
  $rsa = [Security.Cryptography.RSA]::Create()
  if ($Action -eq 'Create') {
    $rsa.KeySize = 3072
    $privateBytes = $rsa.ExportPkcs8PrivateKey()
    $protected = [Security.Cryptography.ProtectedData]::Protect($privateBytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    Write-New $privateFile $protected
    Write-New $publicFile ([Text.Encoding]::ASCII.GetBytes($rsa.ExportSubjectPublicKeyInfoPem() + "`n"))
    [Array]::Clear($privateBytes, 0, $privateBytes.Length)
    $privateBytes = $null
  }
  # Reopen only the encrypted file and prove that it matches the public identity.
  $privateBytes = [Security.Cryptography.ProtectedData]::Unprotect((Read-Bounded $privateFile 32768), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  $consumed = 0
  $rsa.ImportPkcs8PrivateKey($privateBytes, [ref]$consumed)
  if ($consumed -ne $privateBytes.Length -or $rsa.KeySize -ne 3072) { throw 'Unexpected key type or size.' }
  $publicPem = $rsa.ExportSubjectPublicKeyInfoPem() + "`n"
  if ([Text.Encoding]::ASCII.GetString((Read-Bounded $publicFile 16384)) -ne $publicPem) { throw 'Public identity mismatch.' }
  $fingerprint = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($rsa.ExportSubjectPublicKeyInfo())).ToLowerInvariant()
  if ($PublicFingerprint -and $PublicFingerprint -cne $fingerprint) { throw 'Reviewed fingerprint mismatch.' }
  $challenge = [Text.Encoding]::UTF8.GetBytes('Dialed local policy custody verification v1')
  $proof = $rsa.SignData($challenge, [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pss)
  if (-not $rsa.VerifyData($challenge, $proof, [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pss)) { throw 'Key verification failed.' }
  if ($Action -eq 'Sign') {
    if (-not $PublicFingerprint) { throw 'Reviewed fingerprint required.' }
    $policyFile = Check-Path $PolicyPath
    $signatureFile = Check-Path $SignaturePath $true
    if (Test-Path -LiteralPath $signatureFile) { throw 'Signature output already exists.' }
    $bytes = Read-Bounded $policyFile 65536
    # Validation uses the shared strict parser before any policy signature is made.
    # Only the public policy path is passed to Bun; private material stays here.
    $validator = "try{const fs=require('node:fs');const {parsePolicy}=require(process.argv[1]);const p=parsePolicy(fs.readFileSync(process.argv[2]));if(p.Purpose!=='VALIDATION_ONLY'||Date.parse(p.ExpiresAt)>Date.now()+7*86400000)process.exit(1);process.exit(0);}catch{process.exit(1);}"
    & bun -e $validator (Join-Path $repository 'src/main/input-driver-lifecycle/release-policy-contract.cjs') $policyFile *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Policy contract refused.' }
    if ([Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)) -cne [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData((Read-Bounded $policyFile 65536)))) { throw 'Policy changed during validation.' }
    $signature = $rsa.SignData($bytes, [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pss)
    Write-New $signatureFile $signature
  }
  [ordered]@{ action = $Action; keyDirectory = $directory; privateFormat = 'DPAPI_CURRENT_USER_PKCS8'; rsaBits = $rsa.KeySize; publicKeyPath = $publicFile; publicKeySpkiSha256 = $fingerprint; accountRestricted = $true; reopenedAndVerified = $true; plaintextPrivateFileWritten = $false } | ConvertTo-Json -Compress
} catch {
  [Console]::Error.WriteLine('Protected policy key operation refused; no private material is reported.')
  exit 1
} finally {
  if ($null -ne $privateBytes) { [Array]::Clear($privateBytes, 0, $privateBytes.Length) }
  if ($null -ne $rsa) { $rsa.Dispose() }
}
