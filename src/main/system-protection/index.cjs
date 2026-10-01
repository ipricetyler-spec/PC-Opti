// Read-only checks for Windows protections that can affect a change Dialed is about to make.
// None of them changes a setting. Each reports what it read, or says it could not tell.
const path = require('node:path');
const { runPowerShell } = require('../scanner/index.cjs');

// Win32_EncryptableVolume.ProtectionStatus: 0 off, 1 on, 2 unknown (for example, locked).
// https://learn.microsoft.com/windows/win32/secprov/getprotectionstatus-win32-encryptablevolume
const BITLOCKER_SCRIPT = `
$volume = Get-CimInstance -Namespace 'root/cimv2/Security/MicrosoftVolumeEncryption' -ClassName Win32_EncryptableVolume -Filter ("DriveLetter='" + $env:SystemDrive + "'") -ErrorAction Stop
if ($null -eq $volume) { 'NONE' } else { [string]$volume.ProtectionStatus }
`;

async function readBitLockerStatus(run = runPowerShell) {
  try {
    const value = String((await run(BITLOCKER_SCRIPT)).stdout || '').trim();
    return value === '1' ? 'ON' : value === '0' || value === 'NONE' ? 'OFF' : 'UNKNOWN';
  } catch { return 'UNKNOWN'; }
}

// Microsoft lists boot configuration changes among the causes of a BitLocker recovery prompt,
// without saying which values are checked, so this says "may".
// https://learn.microsoft.com/windows/security/operating-system-security/data-protection/bitlocker/recovery-overview
function bitLockerBootNotice(status) {
  if (status === 'ON') return 'BitLocker protects your Windows drive. Changing boot settings may make Windows ask for your BitLocker recovery key at the next start, so make sure you can get to it first (for a Microsoft account it is at aka.ms/myrecoverykey). Dialed never asks for or stores that key.';
  if (status === 'UNKNOWN') return 'Dialed could not tell whether BitLocker is on. If it is, Windows may ask for your BitLocker recovery key at the next start, so make sure you can get to it first. Dialed never asks for or stores that key.';
  return null;
}

// EnableControlledFolderAccess: 0 off, 1 block, 2 audit, 3 block disk changes only, 4 audit disk changes.
// https://learn.microsoft.com/defender-endpoint/controlled-folders
const CONTROLLED_FOLDER_SCRIPT = `
$preference = Get-MpPreference -ErrorAction Stop
[pscustomobject]@{
  mode = [int]$preference.EnableControlledFolderAccess
  folders = @($preference.ControlledFolderAccessProtectedFolders | Where-Object { $_ })
  allowed = @($preference.ControlledFolderAccessAllowedApplications | Where-Object { $_ })
} | ConvertTo-Json -Compress
`;

async function readControlledFolderAccess(run = runPowerShell) {
  try {
    const parsed = JSON.parse(String((await run(CONTROLLED_FOLDER_SCRIPT)).stdout || '').trim());
    const list = (value) => (Array.isArray(value) ? value : value ? [value] : []).filter((item) => typeof item === 'string');
    return { mode: Number.isInteger(parsed.mode) ? parsed.mode : null, folders: list(parsed.folders), allowed: list(parsed.allowed) };
  } catch { return null; }
}

const within = (file, folder) => {
  const relative = path.relative(path.resolve(folder), path.resolve(file));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};

// Windows protects the user's Documents, Pictures, Videos, Music, Desktop and Favorites (and the
// Public ones) by default, plus any folder added in Windows Security. Dialed itself writes the file.
function controlledFolderNotice(state, filePaths, { defaultFolders = [], writer = process.execPath } = {}) {
  if (!state || state.mode !== 1) return null;
  // Windows Security accepts folders written with environment variables, such as %USERPROFILE%\Saved Games.
  const expand = (folder) => folder.replace(/%([^%]+)%/g, (whole, name) => process.env[name] ?? whole);
  const folders = [...defaultFolders, ...state.folders].filter(Boolean).map(expand);
  const protectedFile = filePaths.some((file) => folders.some((folder) => within(file, folder)));
  const allowed = state.allowed.some((app) => path.resolve(app).toLowerCase() === path.resolve(writer).toLowerCase());
  if (!protectedFile || allowed) return null;
  return 'Controlled folder access is on in Windows Security, and this file is in a protected folder, so Windows may block Dialed from saving it. Dialed does not change that setting. If the change is refused, you can allow Dialed under Windows Security › Virus & threat protection › Ransomware protection › Allow an app through Controlled folder access, or leave it as it is.';
}

// SYSTEM_POWER_CAPABILITIES from CallNtPowerInformation(SystemPowerCapabilities): AoAc (byte 20)
// is Modern Standby, SystemS3 (byte 5) classic sleep. Read this way because powercfg /a is translated.
// https://learn.microsoft.com/windows/win32/api/winnt/ns-winnt-system_power_capabilities
const MODERN_STANDBY_SCRIPT = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DialedPowerCapabilities {
  [DllImport("powrprof.dll")] static extern uint CallNtPowerInformation(int level, IntPtr input, uint inputLength, byte[] output, uint outputLength);
  public static string Read() {
    var buffer = new byte[76];
    uint status = CallNtPowerInformation(4, IntPtr.Zero, 0, buffer, (uint)buffer.Length);
    if (status != 0) return "UNKNOWN";
    return buffer[20] != 0 ? "MODERN_STANDBY" : "CLASSIC";
  }
}
'@
[DialedPowerCapabilities]::Read()
`;

async function readModernStandby(run = runPowerShell) {
  try {
    const value = String((await run(MODERN_STANDBY_SCRIPT)).stdout || '').trim();
    return value === 'MODERN_STANDBY' || value === 'CLASSIC' ? value : 'UNKNOWN';
  } catch { return 'UNKNOWN'; }
}

// "Devices that support Modern Standby mode only allow the Balanced power plan, or power plans
// derived from Balanced." https://learn.microsoft.com/windows/win32/power/power-policy-settings
function modernStandbyPlanNotice(status) {
  return status === 'MODERN_STANDBY'
    ? 'This PC uses Modern Standby. Microsoft documents that such PCs only allow the Balanced plan or plans based on it, so High performance and Ultimate Performance may not be available or may not take effect here.'
    : null;
}

module.exports = {
  BITLOCKER_SCRIPT, CONTROLLED_FOLDER_SCRIPT, MODERN_STANDBY_SCRIPT,
  readBitLockerStatus, bitLockerBootNotice,
  readControlledFolderAccess, controlledFolderNotice,
  readModernStandby, modernStandbyPlanNotice,
};
