const { runPowerShell } = require('../scanner/index.cjs');

// The Multimedia Class Scheduler (MMCSS) values that gaming tweak lists change. Windows ships each
// with the default below, and MMCSS uses the same default when a value is missing. They only affect
// programs that ask MMCSS for scheduling (mostly audio and video playback; few games do), so Dialed
// claims no benefit for any value: it shows when another tool changed them and offers the way back.
// Locations, names and the only values ever written are fixed here; nothing comes from the renderer.
const SYSTEM_PROFILE = 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile';
const GAMES_TASK = `${SYSTEM_PROFILE}\\Tasks\\Games`;
const VALUES = Object.freeze([
  Object.freeze({ id: 'system-responsiveness', path: SYSTEM_PROFILE, name: 'SystemResponsiveness', kind: 'DWord', default: 20, label: 'Share kept for background tasks' }),
  Object.freeze({ id: 'network-throttling', path: SYSTEM_PROFILE, name: 'NetworkThrottlingIndex', kind: 'DWord', default: 10, label: 'Network throttling during playback' }),
  Object.freeze({ id: 'games-gpu-priority', path: GAMES_TASK, name: 'GPU Priority', kind: 'DWord', default: 8, label: 'Games task: GPU priority' }),
  Object.freeze({ id: 'games-priority', path: GAMES_TASK, name: 'Priority', kind: 'DWord', default: 2, label: 'Games task: priority' }),
  Object.freeze({ id: 'games-scheduling-category', path: GAMES_TASK, name: 'Scheduling Category', kind: 'String', default: 'Medium', label: 'Games task: scheduling category' }),
  Object.freeze({ id: 'games-sfio-priority', path: GAMES_TASK, name: 'SFIO Priority', kind: 'String', default: 'Normal', label: 'Games task: storage I/O priority' }),
]);
const TEXT_PATTERN = /^[A-Za-z]{1,16}$/;

function encode(value) {
  return Buffer.from(String(value), 'utf8').toString('base64');
}

function decodeExpression(base64) {
  return `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${base64}'))`;
}

function isDefault(definition, item) {
  // Missing means MMCSS uses its own default, which is the same value.
  if (!item?.exists) return true;
  return item.kind === definition.kind && item.value === definition.default;
}

/** The values that differ from the Windows defaults, in the fixed order. */
function changedValues(values) {
  return VALUES.filter((definition) => !isDefault(definition, values?.[definition.id]));
}

/** Plain words for the card, or null when every value is the Windows default. */
function describeChanges(values) {
  const changed = changedValues(values);
  if (!changed.length) return 'Windows defaults';
  return `${changed.length} of ${VALUES.length} values changed by another program or tool`;
}

/** Only plain numbers and short words can be written back; anything else is refused. */
function assertRestorableValues(values) {
  if (!values || typeof values !== 'object') throw new Error('The recorded scheduler values are not valid. Restore was refused.');
  for (const definition of VALUES) {
    const item = values[definition.id];
    if (!item || typeof item.exists !== 'boolean') throw new Error('The recorded scheduler values are not valid. Restore was refused.');
    if (!item.exists) continue;
    if (item.kind !== definition.kind) throw new Error(`${definition.label} was not stored as expected. Restore was refused.`);
    if (definition.kind === 'DWord' && (!Number.isInteger(item.value) || item.value < 0 || item.value > 0xffffffff)) throw new Error(`${definition.label} is not a valid number. Restore was refused.`);
    if (definition.kind === 'String' && (typeof item.value !== 'string' || !TEXT_PATTERN.test(item.value))) throw new Error(`${definition.label} is not a plain word. Restore was refused.`);
  }
}

function sameValues(actual, expected, ids = VALUES.map((definition) => definition.id)) {
  return ids.every((id) => Boolean(actual?.[id]?.exists) === Boolean(expected?.[id]?.exists)
    && (!expected[id].exists || (actual[id].kind === expected[id].kind && actual[id].value === expected[id].value)));
}

/** The values with every changed one set to its default; the rest exactly as read. */
function defaultsFor(values) {
  const result = {};
  for (const definition of VALUES) {
    result[definition.id] = isDefault(definition, values?.[definition.id])
      ? values[definition.id]
      : { exists: true, kind: definition.kind, value: definition.default };
  }
  return result;
}

async function readMultimediaScheduler(run = runPowerShell) {
  const reads = VALUES.map((definition) => `
    $exists = $false; $value = $null; $kind = $null
    $keyPath = ${decodeExpression(encode(definition.path))}
    $name = ${decodeExpression(encode(definition.name))}
    if (Test-Path -LiteralPath $keyPath) {
      $key = Get-Item -LiteralPath $keyPath -ErrorAction Stop
      $raw = $key.GetValue($name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
      if ($null -ne $raw) { $exists = $true; $kind = [string]$key.GetValueKind($name); if ($kind -eq 'DWord') { $value = [int64]$raw -band 4294967295 } elseif ($kind -eq 'String') { $value = [string]$raw } }
    }
    $result['${definition.id}'] = [pscustomobject]@{ exists = [bool]$exists; value = $value; kind = $kind }`).join('\n');
  const script = `& {\n    $result = @{}\n${reads}\n    [pscustomobject]$result | ConvertTo-Json -Compress\n  }`;
  const { stdout } = await run(script);
  const parsed = JSON.parse(stdout);
  const values = Object.fromEntries(VALUES.map((definition) => {
    const item = parsed?.[definition.id] || {};
    const value = !item.exists ? null : definition.kind === 'DWord' ? (Number.isInteger(item.value) ? item.value : null) : (typeof item.value === 'string' ? item.value : null);
    return [definition.id, { exists: Boolean(item.exists), kind: item.exists ? String(item.kind || '') : null, value }];
  }));
  return { values, changed: changedValues(values).map((definition) => definition.id) };
}

/** Writes exactly the given values for the listed ids. Every value is validated first. */
async function writeMultimediaScheduler(values, ids, run = runPowerShell) {
  assertRestorableValues(values);
  const writes = VALUES.filter((definition) => ids.includes(definition.id)).map((definition) => {
    const item = values[definition.id];
    const target = `$keyPath = ${decodeExpression(encode(definition.path))}; $name = ${decodeExpression(encode(definition.name))}`;
    if (!item.exists) return `${target}; Remove-ItemProperty -LiteralPath $keyPath -Name $name -ErrorAction SilentlyContinue`;
    // A DWORD is written as int32; 4294967295 (a common "throttling off" value) must keep its bits,
    // which a plain [int32] cast refuses as too large.
    const data = definition.kind === 'DWord' ? `([BitConverter]::ToInt32([BitConverter]::GetBytes([uint32]${item.value}), 0))` : `(${decodeExpression(encode(item.value))})`;
    return `${target}; if (-not (Test-Path -LiteralPath $keyPath)) { New-Item -Path $keyPath -Force -ErrorAction Stop | Out-Null }; New-ItemProperty -LiteralPath $keyPath -Name $name -PropertyType ${definition.kind} -Value ${data} -Force -ErrorAction Stop | Out-Null`;
  });
  const script = `& {\n    ${writes.join('\n    ')}\n    [pscustomobject]@{ written = $true } | ConvertTo-Json -Compress\n  }`;
  const { stdout, stderr, exitCode } = await run(script);
  return { output: JSON.parse(stdout), stdout, stderr, exitCode };
}

module.exports = {
  VALUES,
  assertRestorableValues,
  changedValues,
  defaultsFor,
  describeChanges,
  readMultimediaScheduler,
  sameValues,
  writeMultimediaScheduler,
};
