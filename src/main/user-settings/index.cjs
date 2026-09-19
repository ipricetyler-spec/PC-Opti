const { runPowerShell } = require('../scanner/index.cjs');

// Windows settings Dialed can turn on or off. Each is one documented DWORD. The registry
// location comes only from this fixed table — never from the renderer and never from a
// journal entry — so a tampered audit file cannot redirect a restore elsewhere.
//
// onValue / offValue: the DWORD that means on or off; null means "no value", which is how
// Windows stores some defaults (MPO is on unless OverlayTestMode = 5 is present).
// absentMeans: what Windows does when the value is missing, or null when that depends on
// the graphics driver and cannot be known from the registry alone.
const USER_SETTINGS = Object.freeze({
  'game-mode': Object.freeze({
    capabilityId: 'gaming:game-mode',
    title: 'Game Mode',
    scope: 'user',
    registryPath: 'HKCU:\\Software\\Microsoft\\GameBar',
    valueName: 'AutoGameModeEnabled',
    onValue: 1,
    offValue: 0,
    // Windows 10 1903 and later treat a missing value as on.
    absentMeans: true,
    restartRequired: false,
  }),
  'background-recording': Object.freeze({
    capabilityId: 'gaming:background-recording',
    title: 'Game Bar background recording',
    scope: 'user',
    registryPath: 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR',
    valueName: 'HistoricalCaptureEnabled',
    onValue: 1,
    offValue: 0,
    // "Record what happened" is off unless someone turned it on.
    absentMeans: false,
    restartRequired: false,
    // The documented Game DVR policy switches Game Bar capture off entirely; while it is
    // set to 0 this per-user switch has no effect, and Settings hides the option.
    blockingPolicy: Object.freeze({
      registryPath: 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\GameDVR',
      valueName: 'AllowGameDVR',
      blockedValue: 0,
      reason: 'Game Bar recording is switched off on this PC by a Windows policy (AllowGameDVR = 0), so this setting would do nothing and Windows Settings hides it. Dialed did not set that policy; another tool or an administrator did.',
    }),
  }),
  'gpu-scheduling': Object.freeze({
    capabilityId: 'graphics:hardware-gpu-scheduling',
    title: 'Hardware-accelerated GPU scheduling',
    scope: 'machine',
    registryPath: 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers',
    valueName: 'HwSchMode',
    // The values Windows Settings writes: 2 on, 1 off.
    onValue: 2,
    offValue: 1,
    // Without a value the driver decides, which differs by graphics card and Windows version.
    absentMeans: null,
    restartRequired: true,
  }),
  mpo: Object.freeze({
    capabilityId: 'graphics:multiplane-overlay',
    title: 'Multiplane overlay (MPO)',
    scope: 'machine',
    registryPath: 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\Dwm',
    valueName: 'OverlayTestMode',
    // OverlayTestMode = 5 is the documented way to turn MPO off; removing it turns MPO back on.
    onValue: null,
    offValue: 5,
    absentMeans: true,
    restartRequired: true,
  }),
  'global-timer-resolution': Object.freeze({
    capabilityId: 'timing:global-timer-resolution',
    title: 'Global timer resolution requests',
    scope: 'machine',
    registryPath: 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\kernel',
    valueName: 'GlobalTimerResolutionRequests',
    // Windows 11 lets each program keep its own timer resolution; 1 restores the older
    // system-wide behaviour, where one program's request applies to all. No value = off.
    onValue: 1,
    offValue: null,
    absentMeans: false,
    restartRequired: true,
  }),
  'block-background-apps': Object.freeze({
    capabilityId: 'policy:block-background-apps',
    title: 'Block background apps',
    scope: 'machine',
    registryPath: 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\AppPrivacy',
    valueName: 'LetAppsRunInBackground',
    // Microsoft documents this policy for Pro, Enterprise and Education; Windows Home ignores it.
    editions: Object.freeze(['pro', 'enterprise', 'education']),
    // 2 = Force Deny: Store apps may not run in the background. No value = each app decides.
    onValue: 2,
    offValue: null,
    absentMeans: false,
    restartRequired: false,
  }),
  'exclude-driver-updates': Object.freeze({
    capabilityId: 'policy:exclude-windows-update-drivers',
    title: 'Keep Windows Update from installing drivers',
    scope: 'machine',
    registryPath: 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate',
    valueName: 'ExcludeWUDriversInQualityUpdate',
    // Microsoft documents this policy for Pro, Enterprise and Education; Windows Home ignores it.
    editions: Object.freeze(['pro', 'enterprise', 'education']),
    // 1 = do not include drivers with Windows quality updates. No value = drivers are included.
    onValue: 1,
    offValue: null,
    absentMeans: false,
    restartRequired: false,
  }),
  'no-auto-restart': Object.freeze({
    capabilityId: 'policy:no-auto-restart-signed-in',
    title: 'No automatic restart while signed in',
    scope: 'machine',
    registryPath: 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate\\AU',
    valueName: 'NoAutoRebootWithLoggedOnUsers',
    // Microsoft documents this policy for Pro, Enterprise and Education; Windows Home ignores it.
    editions: Object.freeze(['pro', 'enterprise', 'education']),
    // 1 = Windows Update does not restart automatically while someone is signed in.
    onValue: 1,
    offValue: null,
    absentMeans: false,
    restartRequired: false,
  }),
});

function userSetting(settingId) {
  if (typeof settingId !== 'string' || !Object.prototype.hasOwnProperty.call(USER_SETTINGS, settingId)) {
    throw new Error('This Windows setting is not one Dialed manages.');
  }
  return USER_SETTINGS[settingId];
}

function encode(value) {
  return Buffer.from(String(value), 'utf8').toString('base64');
}

function decodeExpression(base64) {
  return `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${base64}'))`;
}

/** The value (or null for "no value") that turns the setting on or off. */
function intendedValueFor(settingId, enabled) {
  const setting = userSetting(settingId);
  return enabled ? setting.onValue : setting.offValue;
}

/** True when the read state already holds the intended value (null = absent). */
function stateHasValue(state, intendedValue) {
  if (intendedValue === null) return !state?.exists;
  return Boolean(state?.exists) && state.kind === 'DWord' && state.value === intendedValue;
}

/** The effective on/off state, or null when it cannot be told from the registry. */
function effectiveEnabled(settingId, state) {
  const setting = userSetting(settingId);
  if (!state?.exists) return setting.absentMeans;
  if (state.kind !== 'DWord' || !Number.isInteger(state.value)) return null;
  if (setting.onValue !== null && state.value === setting.onValue) return true;
  if (setting.offValue !== null && state.value === setting.offValue) return false;
  // Game Mode and recording treat any non-zero value as on, as Windows does.
  if (setting.onValue === 1 && setting.offValue === 0) return state.value !== 0;
  return null;
}

async function readUserSetting(settingId, run = runPowerShell) {
  const setting = userSetting(settingId);
  const script = `& {
    $keyPath = ${decodeExpression(encode(setting.registryPath))}
    $valueName = ${decodeExpression(encode(setting.valueName))}
    $exists = $false; $value = $null; $kind = $null
    if (Test-Path -LiteralPath $keyPath) {
      $key = Get-Item -LiteralPath $keyPath -ErrorAction Stop
      $raw = $key.GetValue($valueName, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
      if ($null -ne $raw) {
        $exists = $true
        $kind = [string]$key.GetValueKind($valueName)
        if ($kind -eq 'DWord') { $value = [int]$raw }
      }
    }
    [pscustomobject]@{ exists = [bool]$exists; value = $value; kind = $kind } | ConvertTo-Json -Compress
  }`;
  const { stdout } = await run(script);
  const parsed = JSON.parse(stdout);
  const state = {
    settingId,
    exists: Boolean(parsed.exists),
    value: parsed.exists && Number.isInteger(parsed.value) ? parsed.value : null,
    kind: parsed.exists ? String(parsed.kind || '') : null,
  };
  return { ...state, enabled: effectiveEnabled(settingId, state) };
}

async function writeUserSettingValue(settingId, value, run = runPowerShell) {
  const setting = userSetting(settingId);
  if (!Number.isInteger(value) || value < 0 || value > 0x7fffffff) throw new Error('The setting value is not valid.');
  const script = `& { $keyPath = ${decodeExpression(encode(setting.registryPath))}; $valueName = ${decodeExpression(encode(setting.valueName))}; if (-not (Test-Path -LiteralPath $keyPath)) { New-Item -Path $keyPath -Force -ErrorAction Stop | Out-Null }; New-ItemProperty -LiteralPath $keyPath -Name $valueName -PropertyType DWord -Value ${value} -Force -ErrorAction Stop | Out-Null; [pscustomobject]@{ written = $true } | ConvertTo-Json -Compress }`;
  const { stdout, stderr, exitCode } = await run(script);
  return { output: JSON.parse(stdout), stdout, stderr, exitCode };
}

async function removeUserSettingValue(settingId, run = runPowerShell) {
  const setting = userSetting(settingId);
  const script = `& { $keyPath = ${decodeExpression(encode(setting.registryPath))}; $valueName = ${decodeExpression(encode(setting.valueName))}; if (Test-Path -LiteralPath $keyPath) { Remove-ItemProperty -LiteralPath $keyPath -Name $valueName -ErrorAction Stop }; [pscustomobject]@{ removed = $true } | ConvertTo-Json -Compress }`;
  const { stdout, stderr, exitCode } = await run(script);
  return { output: JSON.parse(stdout), stdout, stderr, exitCode };
}

/** Writes the intended value, or removes the value when the intended state is "no value". */
async function applyUserSettingValue(settingId, intendedValue, adapters = {}) {
  if (intendedValue === null) return (adapters.removeUserSettingValue || removeUserSettingValue)(settingId);
  return (adapters.writeUserSettingValue || writeUserSettingValue)(settingId, intendedValue);
}

/** True when the read state is exactly the captured one: same presence, kind and value. */
function userSettingStateMatches(state, captured) {
  if (Boolean(state?.exists) !== Boolean(captured?.existed)) return false;
  return !captured?.existed || (state.kind === captured.kind && state.value === captured.value);
}

const EDITION_LABELS = Object.freeze({ home: 'Windows Home', pro: 'Windows Pro', enterprise: 'Windows Enterprise', education: 'Windows Education' });

/** Groups a Windows EditionID (for example Core, Professional, EnterpriseS) into a family. */
function editionFamily(editionId) {
  const id = String(editionId || '');
  if (/^Core/i.test(id)) return 'home';
  if (/^Professional/i.test(id)) return 'pro';
  if (/Enterprise/i.test(id)) return 'enterprise';
  if (/^Education/i.test(id)) return 'education';
  return 'unknown';
}

/**
 * Whether Microsoft documents a policy for this edition. An unknown edition is not blocked:
 * Dialed only refuses when it knows the edition is one the policy is not documented for.
 */
function editionSupport(editions, family) {
  if (!editions || family === 'unknown' || editions.includes(family)) return { supported: true, reason: null };
  const names = editions.map((edition) => EDITION_LABELS[edition].replace('Windows ', '')).join(', ');
  return { supported: false, reason: `${EDITION_LABELS[family] || 'This Windows edition'} ignores this policy. Microsoft documents it for ${names} only, so Dialed does not offer it here.` };
}

async function readWindowsEdition(run = runPowerShell) {
  const { stdout } = await run("& { [string](Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion' -Name EditionID -ErrorAction Stop).EditionID }");
  const editionId = String(stdout || '').trim().slice(0, 64);
  return { editionId, family: editionFamily(editionId) };
}

/** The reason a setting is blocked by a policy on this PC, or null. Read-only. */
async function blockingPolicyReason(settingId, run = runPowerShell) {
  const policy = userSetting(settingId).blockingPolicy;
  if (!policy) return null;
  const script = `& { $key = ${decodeExpression(encode(policy.registryPath))}; $name = ${decodeExpression(encode(policy.valueName))}; $value = $null; if (Test-Path -LiteralPath $key) { $item = Get-Item -LiteralPath $key -ErrorAction Stop; $raw = $item.GetValue($name, $null); if ($null -ne $raw -and [string]$item.GetValueKind($name) -eq 'DWord') { $value = [int]$raw } }; [pscustomobject]@{ value = $value } | ConvertTo-Json -Compress }`;
  const { stdout } = await run(script);
  const parsed = JSON.parse(stdout);
  return parsed?.value === policy.blockedValue ? policy.reason : null;
}

/** Journal action id: scope is part of the id so machine-wide changes are easy to spot. */
function userSettingActionId(settingId) {
  return `settings:${userSetting(settingId).scope}:${settingId}`;
}

module.exports = {
  USER_SETTINGS,
  applyUserSettingValue,
  blockingPolicyReason,
  editionFamily,
  editionSupport,
  readWindowsEdition,
  effectiveEnabled,
  intendedValueFor,
  readUserSetting,
  removeUserSettingValue,
  stateHasValue,
  userSetting,
  userSettingActionId,
  userSettingStateMatches,
  writeUserSettingValue,
};
