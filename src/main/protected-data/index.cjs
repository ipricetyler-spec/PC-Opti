const path = require('path');
const { runPowerShell } = require('../scanner/index.cjs');

// A folder only administrators and SYSTEM can open, for data an elevated Dialed acts on:
// the change log (so a program running as the user cannot forge an entry that the
// elevated app later undoes) and the updater's staging area.
//
// Any user can create folders under ProgramData, so a folder that already exists there
// is never trusted by name. A folder is trusted only if an administrator or SYSTEM owns
// it, its permissions are not inherited, they grant access to administrators and SYSTEM
// alone (plus a read-only OWNER RIGHTS entry, below), and nothing inside is a link or
// grants anyone else access. A folder Dialed did not record must also be empty.
// Otherwise Dialed creates a new folder with a random name, locked from the moment it
// is created (no window in which another user could add files), and records that path
// under HKLM\SOFTWARE\Dialed, which a standard user cannot create or change.
const SCRIPT = String.raw`& {
  $ErrorActionPreference = 'Stop'
  $admins = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-544')
  $system = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')
  # Files an elevated process writes are owned by the signed-in user, and an owner may
  # always change a file's permissions. An OWNER RIGHTS entry replaces those implicit
  # owner permissions with read-attributes only, so a non-elevated program running as
  # the same user can neither write the files nor unlock them.
  $ownerRights = New-Object System.Security.Principal.SecurityIdentifier('S-1-3-4')
  $ownerRightsAllowed = [System.Security.AccessControl.FileSystemRights]'ReadAttributes, Synchronize'
  $trusted = @($admins.Value, $system.Value)
  function Test-SafeRules($acl) {
    foreach ($rule in $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
      if ($rule.AccessControlType -ne 'Allow') { continue }
      $sid = $rule.IdentityReference.Value
      if ($trusted -contains $sid) { continue }
      if ($sid -eq $ownerRights.Value -and (($rule.FileSystemRights -band (-bnot $ownerRightsAllowed)) -eq 0)) { continue }
      return $false
    }
    $hasOwnerRights = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | Where-Object { $_.IdentityReference.Value -eq $ownerRights.Value }).Count -gt 0
    return $hasOwnerRights
  }
  # $requireEmpty: a folder Dialed did not record is trusted only while it holds nothing.
  function Test-Trusted([string]$path, [bool]$requireEmpty) {
    if (-not (Test-Path -LiteralPath $path -PathType Container)) { return $false }
    $item = Get-Item -LiteralPath $path -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return $false }
    $acl = Get-Acl -LiteralPath $path
    if ($trusted -notcontains $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value) { return $false }
    if (-not $acl.AreAccessRulesProtected -or -not (Test-SafeRules $acl)) { return $false }
    $children = @(Get-ChildItem -LiteralPath $path -Force -Recurse -ErrorAction Stop)
    if ($requireEmpty -and $children.Count -gt 0) { return $false }
    foreach ($child in $children) {
      if (($child.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return $false }
      if (-not (Test-SafeRules (Get-Acl -LiteralPath $child.FullName))) { return $false }
    }
    return $true
  }
  function New-LockedFolder([string]$path) {
    $security = New-Object System.Security.AccessControl.DirectorySecurity
    $security.SetOwner($admins)
    $security.SetAccessRuleProtection($true, $false)
    $inherit = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
    foreach ($sid in @($system, $admins)) {
      $security.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', $inherit, 'None', 'Allow')))
    }
    $security.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($ownerRights, $ownerRightsAllowed, $inherit, 'None', 'Allow')))
    [void][System.IO.Directory]::CreateDirectory($path, $security)
  }
  # The known-folder path, not the ProgramData environment variable a user can override.
  $programData = [Environment]::GetFolderPath([Environment+SpecialFolder]::CommonApplicationData)
  $registry = 'HKLM:\SOFTWARE\Dialed'
  $recorded = $null
  if (Test-Path -LiteralPath $registry) { $recorded = (Get-ItemProperty -LiteralPath $registry -Name ProtectedDataRoot -ErrorAction SilentlyContinue).ProtectedDataRoot }
  $root = $null
  $created = $false
  if ($recorded -and ([string]$recorded).StartsWith($programData + '\', [StringComparison]::OrdinalIgnoreCase) -and (Test-Trusted $recorded $false)) { $root = [string]$recorded }
  if (-not $root) {
    $candidate = Join-Path $programData 'Dialed'
    if (Test-Path -LiteralPath $candidate) {
      if (Test-Trusted $candidate $true) { $root = $candidate }
      else { $candidate = Join-Path $programData ('Dialed-' + [guid]::NewGuid().ToString('N').Substring(0, 12)) }
    }
    if (-not $root) { New-LockedFolder $candidate; $created = $true; $root = $candidate }
    if (-not (Test-Trusted $root $false)) { throw 'The protected folder could not be verified after it was created.' }
    if (-not (Test-Path -LiteralPath $registry)) { New-Item -Path $registry -Force | Out-Null }
    New-ItemProperty -LiteralPath $registry -Name ProtectedDataRoot -PropertyType String -Value $root -Force | Out-Null
  }
  [pscustomobject]@{ root = $root; programData = $programData; created = $created } | ConvertTo-Json -Compress
}`;

/**
 * Returns the verified admin-only folder, creating it if needed. Needs Dialed to be
 * running as administrator; never called from the test runner without a fake.
 */
async function ensureProtectedDataRoot(run = runPowerShell) {
  if (run === runPowerShell && process.env.NODE_TEST_CONTEXT) throw new Error('The protected folder is not available inside the test runner; pass a fake.');
  const { stdout } = await run(SCRIPT);
  const parsed = JSON.parse(stdout);
  const root = typeof parsed?.root === 'string' ? parsed.root : '';
  const programData = typeof parsed?.programData === 'string' ? parsed.programData : '';
  // Directly inside ProgramData, named Dialed or Dialed-<12 hex>, with no relative parts.
  const valid = /^[A-Za-z]:\\[^\\/:*?"<>|.][^\\/:*?"<>|]*$/.test(programData)
    && path.win32.dirname(root).toLowerCase() === programData.toLowerCase()
    && /^Dialed(-[0-9a-f]{12})?$/.test(path.win32.basename(root))
    && path.win32.normalize(root) === root;
  if (!valid) throw new Error('Windows returned an unexpected protected folder path.');
  return { root, created: Boolean(parsed.created) };
}

module.exports = { SCRIPT, ensureProtectedDataRoot };
