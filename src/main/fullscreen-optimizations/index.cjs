const { runPowerShell } = require('../scanner/index.cjs');
const { assertExecutablePath, gpuPreferenceTargetId } = require('../gpu-preference/index.cjs');

// The Compatibility tab's "Disable fullscreen optimizations" box for one program stores
// the DISABLEDXMAXIMIZEDWINDOWEDMODE flag in a current-user text value named by the full
// executable path, e.g. "~ DISABLEDXMAXIMIZEDWINDOWEDMODE". The same value can carry other
// compatibility flags (run as administrator, DPI settings); those are preserved exactly.
// Only the current-user key is changed. A copy of the flag set for all users (HKLM) is
// reported but never edited.
const USER_KEY = 'HKCU:\\Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers';
const MACHINE_KEY = 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers';
const FLAG = 'DISABLEDXMAXIMIZEDWINDOWEDMODE';

function encode(value) {
  return Buffer.from(String(value), 'utf8').toString('base64');
}

function decodeExpression(base64) {
  return `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${base64}'))`;
}

const targetId = gpuPreferenceTargetId;

function hasFlag(data) {
  return String(data || '').split(/\s+/).some((token) => token.toUpperCase() === FLAG);
}

/**
 * The value text with the flag added or removed; other flags keep their order. Returns
 * null when no flags would remain, meaning the value should be removed.
 */
function formatCompatibilityFlags(existingData, disableOptimizations) {
  if (typeof disableOptimizations !== 'boolean') throw new Error('Choose on or off.');
  const tokens = String(existingData || '').trim().split(/\s+/).filter(Boolean);
  const leading = tokens[0] === '~' ? ['~'] : [];
  const flags = tokens.slice(leading.length).filter((token) => token.toUpperCase() !== FLAG);
  if (disableOptimizations) flags.push(FLAG);
  if (!flags.length) return null;
  // Windows writes "~ " in front of flags set from the Compatibility tab.
  return [...(leading.length ? leading : ['~']), ...flags].join(' ');
}

const READ_SCRIPT_BODY = `
    $user = $null; $userKind = $null; $machine = $null
    if (Test-Path -LiteralPath $userKey) {
      $key = Get-Item -LiteralPath $userKey -ErrorAction Stop
      $raw = $key.GetValue($valueName, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
      if ($null -ne $raw) { $user = [string]$raw; $userKind = [string]$key.GetValueKind($valueName) }
    }
    if (Test-Path -LiteralPath $machineKey) {
      $raw = (Get-Item -LiteralPath $machineKey -ErrorAction Stop).GetValue($valueName, $null)
      if ($null -ne $raw) { $machine = [string]$raw }
    }`;

function stateFrom(exePath, parsed) {
  const exists = parsed.user !== null && parsed.user !== undefined;
  const kind = exists ? String(parsed.userKind || '') : null;
  const data = exists ? String(parsed.user) : null;
  const machineData = parsed.machine === null || parsed.machine === undefined ? null : String(parsed.machine);
  return {
    id: targetId(exePath),
    exePath,
    exists,
    kind,
    data,
    // Fullscreen optimizations are off for this program for the current user.
    disabled: kind === 'String' && hasFlag(data),
    // Set for all users, which Dialed does not change.
    disabledForAllUsers: hasFlag(machineData),
  };
}

async function readFullscreenOptimizations(exePath, run = runPowerShell) {
  const safePath = assertExecutablePath(exePath);
  const script = `& {
    $userKey = ${decodeExpression(encode(USER_KEY))}
    $machineKey = ${decodeExpression(encode(MACHINE_KEY))}
    $valueName = ${decodeExpression(encode(safePath))}
    ${READ_SCRIPT_BODY}
    [pscustomobject]@{ user = $user; userKind = $userKind; machine = $machine } | ConvertTo-Json -Compress
  }`;
  const { stdout } = await run(script);
  return stateFrom(safePath, JSON.parse(stdout));
}

/** Programs that have the flag set for the current user. */
async function listFullscreenOptimizations(run = runPowerShell) {
  const script = `& {
    $userKey = ${decodeExpression(encode(USER_KEY))}
    $machineKey = ${decodeExpression(encode(MACHINE_KEY))}
    $items = @()
    if (Test-Path -LiteralPath $userKey) {
      foreach ($valueName in (Get-Item -LiteralPath $userKey -ErrorAction Stop).GetValueNames()) {
        if (-not $valueName) { continue }
        ${READ_SCRIPT_BODY}
        $items += [pscustomobject]@{ exePath = [string]$valueName; user = $user; userKind = $userKind; machine = $machine }
      }
    }
    ConvertTo-Json -InputObject @($items) -Compress
  }`;
  const { stdout } = await run(script);
  const parsed = JSON.parse(stdout || '[]');
  const isProgram = (value) => { try { assertExecutablePath(value); return true; } catch { return false; } };
  return (Array.isArray(parsed) ? parsed : [parsed])
    .filter((item) => item && typeof item.exePath === 'string' && isProgram(item.exePath))
    .map((item) => stateFrom(assertExecutablePath(item.exePath), item))
    .filter((item) => item.disabled);
}

async function writeCompatibilityFlags(exePath, data, run = runPowerShell) {
  const safePath = assertExecutablePath(exePath);
  if (typeof data !== 'string' || !data.trim() || data.length > 512 || /[\x00-\x1f]/.test(data)) throw new Error('The compatibility setting text is not valid.');
  const script = `& { $keyPath = ${decodeExpression(encode(USER_KEY))}; $valueName = ${decodeExpression(encode(safePath))}; $data = ${decodeExpression(encode(data))}; if (-not (Test-Path -LiteralPath $keyPath)) { New-Item -Path $keyPath -Force -ErrorAction Stop | Out-Null }; New-ItemProperty -LiteralPath $keyPath -Name $valueName -PropertyType String -Value $data -Force -ErrorAction Stop | Out-Null; [pscustomobject]@{ written = $true } | ConvertTo-Json -Compress }`;
  const { stdout, stderr, exitCode } = await run(script);
  return { output: JSON.parse(stdout), stdout, stderr, exitCode };
}

async function removeCompatibilityFlags(exePath, run = runPowerShell) {
  const safePath = assertExecutablePath(exePath);
  const script = `& { $keyPath = ${decodeExpression(encode(USER_KEY))}; $valueName = ${decodeExpression(encode(safePath))}; if (Test-Path -LiteralPath $keyPath) { Remove-ItemProperty -LiteralPath $keyPath -Name $valueName -ErrorAction Stop }; [pscustomobject]@{ removed = $true } | ConvertTo-Json -Compress }`;
  const { stdout, stderr, exitCode } = await run(script);
  return { output: JSON.parse(stdout), stdout, stderr, exitCode };
}

module.exports = {
  FLAG,
  formatCompatibilityFlags,
  hasFlag,
  listFullscreenOptimizations,
  readFullscreenOptimizations,
  removeCompatibilityFlags,
  targetId,
  writeCompatibilityFlags,
};
