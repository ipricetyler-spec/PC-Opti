const crypto = require('crypto');
const path = require('path');
const { runPowerShell } = require('../scanner/index.cjs');

// Windows Settings > System > Display > Graphics stores its per-app choice as a
// REG_SZ under this current-user key, named by the full executable path, with data
// such as "GpuPreference=2;". Other semicolon-separated keys may share the value and
// are preserved exactly.
const GPU_PREFERENCE_KEY = 'HKCU:\\Software\\Microsoft\\DirectX\\UserGpuPreferences';
const GPU_PREFERENCES = Object.freeze({ 0: 'Let Windows decide', 1: 'Power saving', 2: 'High performance' });

function encode(value) {
  return Buffer.from(String(value), 'utf8').toString('base64');
}

function decodeExpression(base64) {
  return `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${base64}'))`;
}

function assertExecutablePath(value) {
  const candidate = String(value || '');
  if (candidate.length < 4 || candidate.length > 260 || /[\x00-\x1f"<>|?*]/.test(candidate)) throw new Error('The selected application path is not valid.');
  if (!path.win32.isAbsolute(candidate) || !/^[A-Za-z]:\\/.test(candidate) || !/\.exe$/i.test(candidate)) throw new Error('Choose an installed .exe file on a local drive.');
  return path.win32.normalize(candidate);
}

function gpuPreferenceTargetId(exePath) {
  return crypto.createHash('sha256').update(String(exePath).toLowerCase()).digest('hex').slice(0, 24);
}

function parseGpuPreference(data) {
  const match = /(?:^|;)\s*GpuPreference=(\d+)\s*(?:;|$)/i.exec(String(data || ''));
  if (!match) return null;
  const value = Number(match[1]);
  return Object.prototype.hasOwnProperty.call(GPU_PREFERENCES, value) ? value : null;
}

function formatGpuPreference(existingData, preference) {
  if (!Object.prototype.hasOwnProperty.call(GPU_PREFERENCES, preference)) throw new Error('GPU preference must be 0, 1 or 2.');
  const parts = String(existingData || '').split(';').map((part) => part.trim()).filter(Boolean).filter((part) => !/^GpuPreference=/i.test(part));
  return `${[...parts, `GpuPreference=${preference}`].join(';')};`;
}

async function listGpuPreferences(run = runPowerShell) {
  const script = `& {
    $keyPath = ${decodeExpression(encode(GPU_PREFERENCE_KEY))}
    $items = @()
    if (Test-Path -LiteralPath $keyPath) {
      $key = Get-Item -LiteralPath $keyPath -ErrorAction Stop
      foreach ($name in $key.GetValueNames()) {
        if (-not $name) { continue }
        $items += [pscustomobject]@{ exePath = [string]$name; data = [string]$key.GetValue($name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames); kind = [string]$key.GetValueKind($name) }
      }
    }
    ConvertTo-Json -InputObject @($items) -Compress
  }`;
  const { stdout } = await run(script);
  const parsed = JSON.parse(stdout || '[]');
  // The same registry key also holds Windows' own DirectXUserGlobalSettings value, which is
  // not a program. Only entries that are real executable paths are listed.
  const isProgram = (value) => { try { assertExecutablePath(value); return true; } catch { return false; } };
  return (Array.isArray(parsed) ? parsed : [parsed]).filter((item) => item && typeof item.exePath === 'string' && isProgram(item.exePath)).map((item) => ({
    id: gpuPreferenceTargetId(item.exePath),
    exePath: item.exePath,
    kind: item.kind,
    data: item.kind === 'String' ? item.data : null,
    preference: item.kind === 'String' ? parseGpuPreference(item.data) : null,
  }));
}

async function readGpuPreference(exePath, run = runPowerShell) {
  const safePath = assertExecutablePath(exePath);
  const script = `& {
    $keyPath = ${decodeExpression(encode(GPU_PREFERENCE_KEY))}
    $valueName = ${decodeExpression(encode(safePath))}
    $exists = $false; $data = $null; $kind = $null
    if (Test-Path -LiteralPath $keyPath) {
      $key = Get-Item -LiteralPath $keyPath -ErrorAction Stop
      $raw = $key.GetValue($valueName, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
      if ($null -ne $raw) { $exists = $true; $data = [string]$raw; $kind = [string]$key.GetValueKind($valueName) }
    }
    [pscustomobject]@{ exePath = $valueName; exists = [bool]$exists; data = $data; kind = $kind } | ConvertTo-Json -Compress
  }`;
  const { stdout } = await run(script);
  const state = JSON.parse(stdout);
  return { exePath: safePath, exists: Boolean(state.exists), data: state.exists ? String(state.data ?? '') : null, kind: state.exists ? String(state.kind) : null };
}

async function writeGpuPreferenceData(exePath, data, run = runPowerShell) {
  const safePath = assertExecutablePath(exePath);
  if (typeof data !== 'string' || data.length > 512 || /[\x00-\x1f]/.test(data)) throw new Error('GPU preference data is not valid.');
  const script = `& { $keyPath = ${decodeExpression(encode(GPU_PREFERENCE_KEY))}; $valueName = ${decodeExpression(encode(safePath))}; $data = ${decodeExpression(encode(data))}; if (-not (Test-Path -LiteralPath $keyPath)) { New-Item -Path $keyPath -Force -ErrorAction Stop | Out-Null }; New-ItemProperty -LiteralPath $keyPath -Name $valueName -PropertyType String -Value $data -Force -ErrorAction Stop | Out-Null; [pscustomobject]@{ written = $true } | ConvertTo-Json -Compress }`;
  const { stdout, stderr, exitCode } = await run(script);
  return { output: JSON.parse(stdout), stdout, stderr, exitCode };
}

async function removeGpuPreferenceValue(exePath, run = runPowerShell) {
  const safePath = assertExecutablePath(exePath);
  const script = `& { $keyPath = ${decodeExpression(encode(GPU_PREFERENCE_KEY))}; $valueName = ${decodeExpression(encode(safePath))}; if (Test-Path -LiteralPath $keyPath) { Remove-ItemProperty -LiteralPath $keyPath -Name $valueName -ErrorAction Stop }; [pscustomobject]@{ removed = $true } | ConvertTo-Json -Compress }`;
  const { stdout, stderr, exitCode } = await run(script);
  return { output: JSON.parse(stdout), stdout, stderr, exitCode };
}

module.exports = {
  GPU_PREFERENCES,
  GPU_PREFERENCE_KEY,
  assertExecutablePath,
  formatGpuPreference,
  gpuPreferenceTargetId,
  listGpuPreferences,
  parseGpuPreference,
  readGpuPreference,
  removeGpuPreferenceValue,
  writeGpuPreferenceData,
};
