const path = require('path');
const { runPowerShell } = require('../scanner/index.cjs');

// HKLM\SOFTWARE\Dialed records which folder is trusted and holds the protected startup
// backups, so it must be as locked as the folder. A key an elevated process creates under
// HKLM\SOFTWARE picks up a CREATOR OWNER entry, which on the owner's PC gave the signed-in
// account full control: any program running as that user could rewrite the key. This locks
// it at every start: owner Administrators, no inheritance, full control for administrators
// and SYSTEM only, read for users, and an OWNER RIGHTS entry so whoever owns a subkey gets
// read access and nothing more. The key is opened with .NET, never New-Item -Force, which
// would replace an existing key and every value in it.
const LOCK_DIALED_KEY = String.raw`
  function Test-DialedKeyLocked($acl) {
    $trustedSids = @('S-1-5-32-544', 'S-1-5-18')
    $readOnlySids = @('S-1-5-32-545', 'S-1-3-4')
    $readKey = [System.Security.AccessControl.RegistryRights]'ReadKey'
    if ($trustedSids -notcontains $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value) { return $false }
    if (-not $acl.AreAccessRulesProtected) { return $false }
    $hasOwnerRights = $false
    foreach ($rule in $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
      if ($rule.AccessControlType -ne 'Allow') { continue }
      $sid = $rule.IdentityReference.Value
      if ($trustedSids -contains $sid) { continue }
      if (($readOnlySids -contains $sid) -and (($rule.RegistryRights -band (-bnot $readKey)) -eq 0)) {
        if ($sid -eq 'S-1-3-4') { $hasOwnerRights = $true }
        continue
      }
      return $false
    }
    return $hasOwnerRights
  }
  function New-DialedKeySecurity {
    $security = New-Object System.Security.AccessControl.RegistrySecurity
    $security.SetOwner((New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-544')))
    $security.SetAccessRuleProtection($true, $false)
    $inherit = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit'
    foreach ($sid in @('S-1-5-18', 'S-1-5-32-544')) {
      $security.AddAccessRule((New-Object System.Security.AccessControl.RegistryAccessRule((New-Object System.Security.Principal.SecurityIdentifier($sid)), 'FullControl', $inherit, 'None', 'Allow')))
    }
    foreach ($sid in @('S-1-5-32-545', 'S-1-3-4')) {
      $security.AddAccessRule((New-Object System.Security.AccessControl.RegistryAccessRule((New-Object System.Security.Principal.SecurityIdentifier($sid)), 'ReadKey', $inherit, 'None', 'Allow')))
    }
    return $security
  }
  function Protect-DialedKey {
    $security = New-DialedKeySecurity
    $machine = [Microsoft.Win32.Registry]::LocalMachine
    # Creates the key already locked, or opens the existing one without touching its values.
    $created = $machine.CreateSubKey('SOFTWARE\Dialed', [Microsoft.Win32.RegistryKeyPermissionCheck]::ReadWriteSubTree, $security)
    $created.Close()
    $key = $machine.OpenSubKey('SOFTWARE\Dialed', [Microsoft.Win32.RegistryKeyPermissionCheck]::ReadWriteSubTree, [System.Security.AccessControl.RegistryRights]'ReadKey, ChangePermissions, TakeOwnership')
    try {
      if (-not (Test-DialedKeyLocked $key.GetAccessControl())) { $key.SetAccessControl($security) }
      if (-not (Test-DialedKeyLocked $key.GetAccessControl())) { throw 'Dialed could not restrict its registry key to administrators.' }
    } finally { $key.Close() }
  }
`;

// A folder only administrators and SYSTEM can open, for data an elevated Dialed acts on:
// the change log (so a program running as the user cannot forge an entry that the
// elevated app later undoes) and the updater's staging area.
//
// Any user can create folders under ProgramData, so a folder that already exists there
// is never trusted by name. A folder is trusted only if an administrator or SYSTEM owns
// it, its permissions are not inherited, they grant access to administrators and SYSTEM
// alone (plus a read-only OWNER RIGHTS entry, below), and nothing inside is a link or
// grants anyone else access. A folder Dialed did not record must also be empty.
// Otherwise Dialed creates ProgramData\Dialed-Protected (or, if that name is taken, a folder
// with a random name), locked from the moment it is created (no window in which another
// user could add files), and records that path under HKLM\SOFTWARE\Dialed, which a
// standard user cannot create or change.
const SCRIPT = String.raw`& {
  $ErrorActionPreference = 'Stop'
${LOCK_DIALED_KEY}
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
  Protect-DialedKey
  $recorded = (Get-ItemProperty -LiteralPath $registry -Name ProtectedDataRoot -ErrorAction SilentlyContinue).ProtectedDataRoot
  $pending = (Get-ItemProperty -LiteralPath $registry -Name ProtectedDataRootPending -ErrorAction SilentlyContinue).ProtectedDataRootPending
  function Test-Inside([string]$path) { return [bool]($path -and $path.StartsWith($programData + '\', [StringComparison]::OrdinalIgnoreCase)) }
  # A rename of the folder was started and not confirmed. Report both names and change
  # nothing: creating or adopting a folder now could hide the change log. Dialed decides.
  if ($pending) {
    [pscustomobject]@{
      pending = [string]$pending; pendingExists = [bool](Test-Path -LiteralPath $pending); pendingTrusted = [bool]((Test-Inside $pending) -and (Test-Trusted ([string]$pending) $false))
      recorded = [string]$recorded; recordedExists = [bool]($recorded -and (Test-Path -LiteralPath $recorded)); recordedTrusted = [bool]((Test-Inside $recorded) -and (Test-Trusted ([string]$recorded) $false))
      programData = $programData
    } | ConvertTo-Json -Compress
    return
  }
  $root = $null
  $created = $false
  if ((Test-Inside $recorded) -and (Test-Trusted $recorded $false)) { $root = [string]$recorded }
  if (-not $root) {
    # A recorded folder that is missing or fails the checks may hold the change log. It is
    # never used again, but its path is kept, so Dialed can say where the history went.
    if ($recorded) {
      $rejected = @((Get-ItemProperty -LiteralPath $registry -Name ProtectedDataRootRejected -ErrorAction SilentlyContinue).ProtectedDataRootRejected) + [string]$recorded | Where-Object { $_ } | Select-Object -Unique
      New-ItemProperty -LiteralPath $registry -Name ProtectedDataRootRejected -PropertyType MultiString -Value ([string[]]$rejected) -Force | Out-Null
    }
    # Not plain 'Dialed': the native input helper keeps its own journal in ProgramData\Dialed.
    $candidate = Join-Path $programData 'Dialed-Protected'
    if (Test-Path -LiteralPath $candidate) {
      if (Test-Trusted $candidate $true) { $root = $candidate }
      else { $candidate = Join-Path $programData ('Dialed-' + [guid]::NewGuid().ToString('N').Substring(0, 12)) }
    }
    if (-not $root) { New-LockedFolder $candidate; $created = $true; $root = $candidate }
    if (-not (Test-Trusted $root $false)) { throw 'The protected folder could not be verified after it was created.' }
    New-ItemProperty -LiteralPath $registry -Name ProtectedDataRoot -PropertyType String -Value $root -Force | Out-Null
  }
  $rejectedRoots = @((Get-ItemProperty -LiteralPath $registry -Name ProtectedDataRootRejected -ErrorAction SilentlyContinue).ProtectedDataRootRejected | Where-Object { $_ })
  [pscustomobject]@{ root = $root; programData = $programData; created = $created; rejected = [string[]]$rejectedRoots } | ConvertTo-Json -Compress
}`;

// The name for the folder. It cannot collide with Dialed's own folders: the native input
// helper uses exactly ProgramData\Dialed, and older random names are Dialed- plus twelve
// hex digits, which "Protected" can never be. Anyone can create a folder under ProgramData,
// so a squatted Dialed-Protected cannot be prevented, only refused: it fails the checks
// above and Dialed falls back to a random name.
const PROTECTED_FOLDER_NAME = 'Dialed-Protected';
const RANDOM_NAME = /^Dialed-[0-9a-f]{12}$/;

function assertTestFake(run) {
  if (run === runPowerShell && process.env.NODE_TEST_CONTEXT) throw new Error('The protected folder is not available inside the test runner; pass a fake.');
}

// Directly inside ProgramData, with a name Dialed uses, and no relative parts.
function isDialedFolder(folder, programData) {
  return typeof folder === 'string'
    && /^[A-Za-z]:\\[^\\/:*?"<>|.][^\\/:*?"<>|]*$/.test(programData)
    && path.win32.dirname(folder).toLowerCase() === programData.toLowerCase()
    && /^Dialed(-[0-9a-f]{12}|-Protected)?$/.test(path.win32.basename(folder))
    && path.win32.normalize(folder) === folder;
}

/** Runs the folder script once. Either a verified root, or an unfinished rename to settle. */
async function probeProtectedDataRoot(run = runPowerShell) {
  assertTestFake(run);
  const { stdout } = await run(SCRIPT);
  const parsed = JSON.parse(stdout);
  const programData = typeof parsed?.programData === 'string' ? parsed.programData : '';
  if (typeof parsed?.pending === 'string' && parsed.pending) {
    const recorded = typeof parsed.recorded === 'string' ? parsed.recorded : '';
    if (!isDialedFolder(parsed.pending, programData) || path.win32.basename(parsed.pending) !== PROTECTED_FOLDER_NAME || (recorded && !isDialedFolder(recorded, programData))) {
      throw new Error('Windows returned an unexpected protected folder path.');
    }
    return {
      pending: parsed.pending, recorded, programData,
      pendingExists: parsed.pendingExists === true, pendingTrusted: parsed.pendingTrusted === true,
      recordedExists: parsed.recordedExists === true, recordedTrusted: parsed.recordedTrusted === true,
    };
  }
  const root = typeof parsed?.root === 'string' ? parsed.root : '';
  if (!isDialedFolder(root, programData)) throw new Error('Windows returned an unexpected protected folder path.');
  // Only a Dialed folder path is ever shown to the reader; anything else in the registry is
  // reported without its text.
  const rejected = (Array.isArray(parsed.rejected) ? parsed.rejected : typeof parsed.rejected === 'string' ? [parsed.rejected] : [])
    .filter((folder) => typeof folder === 'string' && folder && !same(folder, root))
    .map((folder) => (isDialedFolder(folder, programData) ? folder : null));
  return { root, programData, created: Boolean(parsed.created), rejected };
}

/**
 * Returns the verified admin-only folder, creating it if needed. Needs Dialed to be
 * running as administrator; never called from the test runner without a fake.
 */
async function ensureProtectedDataRoot(run = runPowerShell) {
  const report = await probeProtectedDataRoot(run);
  if (report.pending) throw new Error('A rename of the protected folder is unfinished; settle it before using the folder.');
  return { root: report.root, created: report.created };
}

/**
 * The operations a rename needs, on the real machine. The folder is renamed in one step on
 * the same drive, so it is only ever under one name, and it keeps its own permissions. The
 * registry values sit under HKLM\SOFTWARE\Dialed, which only administrators can write.
 */
function createProtectedMoveOps(run = runPowerShell, io = require('node:fs')) {
  const quoted = (folder) => {
    if (!/^[A-Za-z]:\\[^'"`$\r\n]+$/.test(folder)) throw new Error('Refused an unexpected protected folder path.');
    return `'${folder}'`;
  };
  const registry = async (body) => { assertTestFake(run); await run(`& { $ErrorActionPreference = 'Stop'; $key = 'HKLM:\\SOFTWARE\\Dialed'; ${LOCK_DIALED_KEY}; Protect-DialedKey; ${body} }`); };
  return {
    exists: (folder) => { try { io.lstatSync(folder); return true; } catch (error) { if (error?.code === 'ENOENT') return false; throw error; } },
    rename: (from, to) => io.renameSync(from, to),
    setPending: (target) => registry(`New-ItemProperty -LiteralPath $key -Name ProtectedDataRootPending -PropertyType String -Value ${quoted(target)} -Force | Out-Null`),
    // The new root is recorded before the marker is cleared, so a stop between the two
    // leaves both naming the same folder, which the next start settles by clearing the marker.
    commit: (target) => registry(`New-ItemProperty -LiteralPath $key -Name ProtectedDataRoot -PropertyType String -Value ${quoted(target)} -Force | Out-Null; Remove-ItemProperty -LiteralPath $key -Name ProtectedDataRootPending -ErrorAction SilentlyContinue`),
    clearPending: () => registry('Remove-ItemProperty -LiteralPath $key -Name ProtectedDataRootPending -ErrorAction SilentlyContinue'),
  };
}

const same = (left, right) => typeof left === 'string' && typeof right === 'string' && left.toLowerCase() === right.toLowerCase();

// Finishes or abandons a rename that stopped part-way. The rename is a single step, so the
// real folder is under one name only. Any process can create a folder under ProgramData, so
// a name being taken proves nothing: only a folder that passes the admin-only checks counts.
async function settleUnfinishedRename(report, run, ops) {
  const { pending, recorded, pendingTrusted, recordedTrusted } = report;
  if (recordedTrusted && same(recorded, pending)) await ops.clearPending(); // recorded, marker not yet cleared
  else if (recordedTrusted && !pendingTrusted) await ops.clearPending(); // the rename never happened
  else if (pendingTrusted && !recordedTrusted) await ops.commit(pending); // renamed, not yet recorded
  else if (pendingTrusted && recordedTrusted) {
    throw new Error(`Dialed found two protected folders, ${recorded} and ${pending}, and cannot tell which copy is current, so it changed nothing.`);
  } else {
    throw new Error(`Dialed found an unfinished rename of its protected folder, and neither ${recorded || 'the recorded folder'} nor ${pending} passed its admin-only checks, so it changed nothing.`);
  }
  const settled = await probeProtectedDataRoot(run);
  if (settled.pending) throw new Error('The protected folder rename could not be settled.');
  return settled;
}

async function renameToProtectedName(report, run, ops) {
  const from = report.root;
  const target = path.win32.join(path.win32.dirname(from), PROTECTED_FOLDER_NAME);
  if (ops.exists(target)) return { ...report, renameSkipped: `${target} already exists, so the folder keeps its current name.` };
  try {
    await ops.setPending(target);
  } catch (error) {
    return { ...report, renameSkipped: `Dialed could not record the rename (${error?.message || error}); the folder keeps its current name.` };
  }
  try {
    ops.rename(from, target);
  } catch (error) {
    // Windows refuses while a file inside is open, or if the name was taken meanwhile.
    await ops.clearPending();
    return { ...(await probeProtectedDataRoot(run)), renameSkipped: `Windows did not rename the folder (${error?.message || error}); it keeps its current name.` };
  }
  const check = await probeProtectedDataRoot(run);
  // Something may have taken the vacated old name straight after the rename. It cannot pass
  // the checks, so it is ignored rather than mistaken for the change log.
  if (check.pending && check.pendingTrusted && !check.recordedTrusted) {
    try {
      await ops.commit(target);
    } catch (error) {
      // The commit may have stopped between its two writes. Follow whatever the registry now
      // records: the new name if it got that far, otherwise put the folder back.
      const after = await probeProtectedDataRoot(run);
      if (after.pending && after.recordedTrusted && same(after.recorded, target)) return { ...(await settleUnfinishedRename(after, run, ops)), renamedFrom: from };
      putBack(ops, target, from, 'Dialed could not record the new name');
      await ops.clearPending();
      return { ...(await probeProtectedDataRoot(run)), renameSkipped: `Dialed could not record the new name (${error?.message || error}), so the folder was put back.` };
    }
    const done = await probeProtectedDataRoot(run);
    if (done.pending || !same(done.root, target)) throw new Error('The renamed protected folder was not accepted.');
    return { ...done, renamedFrom: from };
  }
  // The renamed folder did not pass the admin-only checks. Put it back under its old name,
  // which the registry still records, and forget the rename.
  putBack(ops, target, from, 'The renamed folder did not pass the admin-only checks');
  await ops.clearPending();
  return { ...(await probeProtectedDataRoot(run)), renameSkipped: 'The renamed folder did not pass the admin-only checks, so it was put back under its old name.' };
}

// If the old name was taken meanwhile, the folder stays where it is and the rename marker
// stays recorded; the next start settles it by which folder passes the checks.
function putBack(ops, target, from, why) {
  try {
    ops.rename(target, from);
  } catch (error) {
    throw new Error(`${why}, and the folder could not be moved back to ${from} (${error?.message || error}). The change log is in ${target}; Dialed changed nothing more.`);
  }
}

/**
 * The protected folder for this start. Settles a rename that stopped part-way, and, when
 * asked, renames a folder with an older random name to Dialed-Protected. A folder named
 * plain Dialed is left alone: it may hold the native input helper's journal.
 */
async function openProtectedDataRoot({ run = runPowerShell, ops = createProtectedMoveOps(run), renameToTidyName = false } = {}) {
  let report = await probeProtectedDataRoot(run);
  if (report.pending) report = await settleUnfinishedRename(report, run, ops);
  if (renameToTidyName && RANDOM_NAME.test(path.win32.basename(report.root))) report = await renameToProtectedName(report, run, ops);
  return report;
}

module.exports = { SCRIPT, LOCK_DIALED_KEY, PROTECTED_FOLDER_NAME, ensureProtectedDataRoot, openProtectedDataRoot, probeProtectedDataRoot, createProtectedMoveOps };
