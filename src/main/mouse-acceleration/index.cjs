const { runPowerShell } = require('../scanner/index.cjs');

// Windows "Enhance pointer precision" is three linked per-user text values. Windows
// Settings writes 1/6/10 when it is on and 0/0/0 when it is off. The values are applied
// to the running session with SystemParametersInfo(SPI_SETMOUSE), so no sign-out is
// needed. Locations and names are fixed here; nothing comes from the renderer.
const MOUSE_KEY = 'HKCU:\\Control Panel\\Mouse';
const VALUE_NAMES = Object.freeze(['MouseSpeed', 'MouseThreshold1', 'MouseThreshold2']);
const STATES = Object.freeze({
  on: Object.freeze({ MouseSpeed: '1', MouseThreshold1: '6', MouseThreshold2: '10' }),
  off: Object.freeze({ MouseSpeed: '0', MouseThreshold1: '0', MouseThreshold2: '0' }),
});
const VALUE_PATTERN = /^\d{1,3}$/;

function encode(value) {
  return Buffer.from(String(value), 'utf8').toString('base64');
}

function decodeExpression(base64) {
  return `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${base64}'))`;
}

/** On, off, or null when the values are missing, not text, or a custom combination. */
function accelerationEnabled(values) {
  if (!values || VALUE_NAMES.some((name) => !values[name]?.exists || values[name].kind !== 'String')) return null;
  const matches = (target) => VALUE_NAMES.every((name) => values[name].value === STATES[target][name]);
  if (matches('on')) return true;
  if (matches('off')) return false;
  // Windows treats any non-zero speed as on; custom thresholds are left as they are.
  return values.MouseSpeed.value === '0' ? false : VALUE_PATTERN.test(values.MouseSpeed.value) ? true : null;
}

function assertCapturedValues(values) {
  if (!values || typeof values !== 'object') throw new Error('The recorded mouse settings are not valid. Restore was refused.');
  for (const name of VALUE_NAMES) {
    const item = values[name];
    if (!item || typeof item.exists !== 'boolean') throw new Error('The recorded mouse settings are not valid. Restore was refused.');
    if (item.exists && (item.kind !== 'String' || typeof item.value !== 'string' || !VALUE_PATTERN.test(item.value))) {
      throw new Error('The recorded mouse settings are not plain numbers. Restore was refused.');
    }
  }
}

function sameValues(actual, expected) {
  return VALUE_NAMES.every((name) => Boolean(actual?.[name]?.exists) === Boolean(expected?.[name]?.exists)
    && (!expected[name].exists || (actual[name].kind === expected[name].kind && actual[name].value === expected[name].value)));
}

function targetValues(target) {
  return Object.fromEntries(VALUE_NAMES.map((name) => [name, { exists: true, kind: 'String', value: STATES[target][name] }]));
}

async function readMouseAcceleration(run = runPowerShell) {
  const script = `& {
    $keyPath = ${decodeExpression(encode(MOUSE_KEY))}
    $result = @{}
    foreach ($name in @('MouseSpeed', 'MouseThreshold1', 'MouseThreshold2')) {
      $exists = $false; $value = $null; $kind = $null
      if (Test-Path -LiteralPath $keyPath) {
        $key = Get-Item -LiteralPath $keyPath -ErrorAction Stop
        $raw = $key.GetValue($name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        if ($null -ne $raw) { $exists = $true; $kind = [string]$key.GetValueKind($name); if ($kind -eq 'String') { $value = [string]$raw } }
      }
      $result[$name] = [pscustomobject]@{ exists = [bool]$exists; value = $value; kind = $kind }
    }
    [pscustomobject]$result | ConvertTo-Json -Compress
  }`;
  const { stdout } = await run(script);
  const parsed = JSON.parse(stdout);
  const values = Object.fromEntries(VALUE_NAMES.map((name) => {
    const item = parsed?.[name] || {};
    return [name, { exists: Boolean(item.exists), kind: item.exists ? String(item.kind || '') : null, value: item.exists && typeof item.value === 'string' ? item.value : null }];
  }));
  return { values, enabled: accelerationEnabled(values) };
}

/**
 * Writes the given values (removing any marked as absent) and applies them to the running
 * session. Values are checked against a digits-only pattern before they reach the script.
 */
async function writeMouseValues(values, run = runPowerShell) {
  assertCapturedValues(values);
  const writes = VALUE_NAMES.map((name) => values[name].exists
    ? `New-ItemProperty -LiteralPath $keyPath -Name '${name}' -PropertyType String -Value '${values[name].value}' -Force -ErrorAction Stop | Out-Null`
    : `Remove-ItemProperty -LiteralPath $keyPath -Name '${name}' -ErrorAction SilentlyContinue`).join('; ');
  const live = VALUE_NAMES.every((name) => values[name].exists);
  const apply = live ? `
    Add-Type -Namespace DialedMouse -Name Native -MemberDefinition '[DllImport("user32.dll", SetLastError = true)] public static extern bool SystemParametersInfo(uint action, uint param, int[] values, uint winIni);'
    $applied = [DialedMouse.Native]::SystemParametersInfo(4, 0, [int[]]@(${Number(values.MouseThreshold1.value)}, ${Number(values.MouseThreshold2.value)}, ${Number(values.MouseSpeed.value)}), 2)` : '$applied = $false';
  const script = `& {
    $keyPath = ${decodeExpression(encode(MOUSE_KEY))}
    if (-not (Test-Path -LiteralPath $keyPath)) { New-Item -Path $keyPath -Force -ErrorAction Stop | Out-Null }
    ${writes}
    ${apply}
    [pscustomobject]@{ written = $true; appliedToSession = [bool]$applied } | ConvertTo-Json -Compress
  }`;
  const { stdout, stderr, exitCode } = await run(script);
  return { output: JSON.parse(stdout), stdout, stderr, exitCode };
}

module.exports = {
  MOUSE_KEY,
  STATES,
  VALUE_NAMES,
  accelerationEnabled,
  assertCapturedValues,
  readMouseAcceleration,
  sameValues,
  targetValues,
  writeMouseValues,
};
