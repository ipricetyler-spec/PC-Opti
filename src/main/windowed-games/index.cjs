const { runPowerShell } = require('../scanner/index.cjs');

// Windows 11 Settings › System › Display › Graphics › "Optimizations for windowed games"
// stores its choice as SwapEffectUpgradeEnable=1 (on) or =0 (off) inside one current-user
// text value. The same value holds other Windows graphics switches (for example
// VRROptimizeEnable=1;), which are preserved exactly. With no SwapEffectUpgradeEnable
// entry, Windows uses its own default, which differs between Windows 11 versions.
const KEY = 'HKCU:\\Software\\Microsoft\\DirectX\\UserGpuPreferences';
const VALUE_NAME = 'DirectXUserGlobalSettings';
const SETTING = 'SwapEffectUpgradeEnable';
// The switch first shipped in Windows 11 version 22H2 (build 22621).
const MINIMUM_BUILD = 22621;

function encode(value) {
  return Buffer.from(String(value), 'utf8').toString('base64');
}

function decodeExpression(base64) {
  return `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${base64}'))`;
}

/** true / false from the text, or null when the entry is missing or not 0/1. */
function parseWindowedOptimizations(data) {
  const match = new RegExp(`(?:^|;)\\s*${SETTING}=(\\d+)\\s*(?:;|$)`, 'i').exec(String(data || ''));
  if (!match) return null;
  if (match[1] === '1') return true;
  if (match[1] === '0') return false;
  return null;
}

/** The text with only SwapEffectUpgradeEnable set; every other entry is kept in order. */
function formatWindowedOptimizations(existingData, enabled) {
  if (typeof enabled !== 'boolean') throw new Error('Choose on or off.');
  const parts = String(existingData || '').split(';').map((part) => part.trim()).filter(Boolean);
  const pattern = new RegExp(`^${SETTING}=`, 'i');
  const entry = `${SETTING}=${enabled ? 1 : 0}`;
  const index = parts.findIndex((part) => pattern.test(part));
  // Keeps the entry where it was (the first one, if Windows ever wrote two).
  const next = parts.filter((part) => !pattern.test(part));
  next.splice(index === -1 ? next.length : index, 0, entry);
  return `${next.join(';')};`;
}

async function readWindowedGameSetting(run = runPowerShell) {
  const script = `& {
    $keyPath = ${decodeExpression(encode(KEY))}
    $valueName = ${decodeExpression(encode(VALUE_NAME))}
    $exists = $false; $data = $null; $kind = $null
    if (Test-Path -LiteralPath $keyPath) {
      $key = Get-Item -LiteralPath $keyPath -ErrorAction Stop
      $raw = $key.GetValue($valueName, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
      if ($null -ne $raw) { $exists = $true; $data = [string]$raw; $kind = [string]$key.GetValueKind($valueName) }
    }
    $build = [int](Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion' -Name CurrentBuild -ErrorAction Stop).CurrentBuild
    [pscustomobject]@{ exists = [bool]$exists; data = $data; kind = $kind; build = $build } | ConvertTo-Json -Compress
  }`;
  const { stdout } = await run(script);
  const parsed = JSON.parse(stdout);
  const exists = Boolean(parsed.exists);
  const kind = exists ? String(parsed.kind || '') : null;
  const data = exists ? String(parsed.data ?? '') : null;
  return {
    exists,
    kind,
    data,
    build: Number.isInteger(parsed.build) ? parsed.build : null,
    enabled: kind === 'String' ? parseWindowedOptimizations(data) : null,
  };
}

/** A reason Dialed will not offer the switch on this PC, or null. */
function unsupportedReason(state) {
  if (!Number.isInteger(state?.build)) return 'Windows did not report its version, so Dialed does not offer this setting.';
  if (state.build < MINIMUM_BUILD) return 'This setting needs Windows 11 version 22H2 or later.';
  if (state.exists && state.kind !== 'String') return 'The existing Windows value is not stored as text. Dialed will not overwrite it.';
  return null;
}

async function writeWindowedGameData(data, run = runPowerShell) {
  if (typeof data !== 'string' || data.length > 512 || /[\x00-\x1f]/.test(data)) throw new Error('The setting text is not valid.');
  const script = `& { $keyPath = ${decodeExpression(encode(KEY))}; $valueName = ${decodeExpression(encode(VALUE_NAME))}; $data = ${decodeExpression(encode(data))}; if (-not (Test-Path -LiteralPath $keyPath)) { New-Item -Path $keyPath -Force -ErrorAction Stop | Out-Null }; New-ItemProperty -LiteralPath $keyPath -Name $valueName -PropertyType String -Value $data -Force -ErrorAction Stop | Out-Null; [pscustomobject]@{ written = $true } | ConvertTo-Json -Compress }`;
  const { stdout, stderr, exitCode } = await run(script);
  return { output: JSON.parse(stdout), stdout, stderr, exitCode };
}

async function removeWindowedGameValue(run = runPowerShell) {
  const script = `& { $keyPath = ${decodeExpression(encode(KEY))}; $valueName = ${decodeExpression(encode(VALUE_NAME))}; if (Test-Path -LiteralPath $keyPath) { Remove-ItemProperty -LiteralPath $keyPath -Name $valueName -ErrorAction Stop }; [pscustomobject]@{ removed = $true } | ConvertTo-Json -Compress }`;
  const { stdout, stderr, exitCode } = await run(script);
  return { output: JSON.parse(stdout), stdout, stderr, exitCode };
}

module.exports = {
  MINIMUM_BUILD,
  formatWindowedOptimizations,
  parseWindowedOptimizations,
  readWindowedGameSetting,
  removeWindowedGameValue,
  unsupportedReason,
  writeWindowedGameData,
};
