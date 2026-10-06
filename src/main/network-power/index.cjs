const { runPowerShell } = require('../scanner/index.cjs');

// Power-saving features on wired network adapters. Energy-Efficient Ethernet (*EEE) is the
// standardized keyword Microsoft documents for NDIS drivers; the others are the common vendor
// names for the same idea. They can let the link nap between packets, which adds small, uneven
// delays. Only on/off (0/1) properties are touched, only on wired (802.3) adapters, and only to
// turn them off; the keywords are fixed here and nothing comes from the renderer.
const KEYWORDS = Object.freeze([
  Object.freeze({ keyword: '*EEE', label: 'Energy-Efficient Ethernet' }),
  Object.freeze({ keyword: 'AdvancedEEE', label: 'Advanced EEE' }),
  Object.freeze({ keyword: 'EnableGreenEthernet', label: 'Green Ethernet' }),
  Object.freeze({ keyword: 'PowerSavingMode', label: 'Power Saving Mode' }),
  Object.freeze({ keyword: 'GigaLite', label: 'Gigabit Lite' }),
]);
const GUID = /^\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}$/i;

/** One entry per wired adapter that has at least one of these properties as a plain on/off. */
function normalizeAdapters(raw) {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.flatMap((adapter) => {
    const guid = String(adapter?.guid || '');
    if (!GUID.test(guid)) return [];
    const settings = (Array.isArray(adapter.settings) ? adapter.settings : adapter.settings ? [adapter.settings] : [])
      .filter((item) => KEYWORDS.some((known) => known.keyword === item?.keyword))
      .filter((item) => Array.isArray(item.valid) && item.valid.length === 2 && item.valid.includes('0') && item.valid.includes('1') && ['0', '1'].includes(String(item.value)))
      .map((item) => ({ keyword: item.keyword, label: KEYWORDS.find((known) => known.keyword === item.keyword).label, value: String(item.value) }));
    return settings.length ? [{ guid: guid.toUpperCase(), name: String(adapter.name || '').slice(0, 80), description: String(adapter.description || '').slice(0, 120), settings }] : [];
  });
}

function onSettings(adapters) {
  return adapters.flatMap((adapter) => adapter.settings.filter((item) => item.value === '1').map((item) => ({ guid: adapter.guid, keyword: item.keyword, label: item.label, adapter: adapter.name })));
}

/** Plain words for the card. */
function describeAdapters(adapters) {
  if (!adapters.length) return 'No wired adapter with power-saving settings';
  const on = onSettings(adapters);
  if (!on.length) return `Off on ${adapters.map((adapter) => adapter.name).join(', ')}`;
  return `On: ${[...new Set(on.map((item) => item.label))].join(', ')}`;
}

async function readNetworkPower(run = runPowerShell) {
  const keywords = KEYWORDS.map((item) => `'${item.keyword}'`).join(', ');
  const script = `& {
    $keywords = @(${keywords})
    $result = foreach ($adapter in @(Get-NetAdapter -Physical -ErrorAction Stop | Where-Object { $_.MediaType -eq '802.3' })) {
      $settings = foreach ($property in @(Get-NetAdapterAdvancedProperty -Name $adapter.Name -AllProperties -ErrorAction SilentlyContinue | Where-Object { $keywords -contains $_.RegistryKeyword })) {
        [pscustomobject]@{ keyword = [string]$property.RegistryKeyword; value = [string](@($property.RegistryValue)[0]); valid = @($property.ValidRegistryValues | ForEach-Object { [string]$_ }) }
      }
      [pscustomobject]@{ guid = [string]$adapter.InterfaceGuid; name = [string]$adapter.Name; description = [string]$adapter.InterfaceDescription; settings = @($settings) }
    }
    ConvertTo-Json -InputObject @($result) -Depth 5 -Compress
  }`;
  const { stdout } = await run(script);
  const adapters = normalizeAdapters(JSON.parse(stdout || '[]'));
  return { adapters, on: onSettings(adapters) };
}

/** The listed adapter settings set to the given values. The adapter is found by its GUID. */
async function writeNetworkPower(changes, run = runPowerShell) {
  for (const change of changes) {
    if (!GUID.test(change.guid) || !KEYWORDS.some((known) => known.keyword === change.keyword) || !['0', '1'].includes(change.value)) throw new Error('The network adapter change is not valid. Nothing was changed.');
  }
  const steps = changes.map((change) => `
    $adapter = @(Get-NetAdapter -Physical -ErrorAction Stop | Where-Object { ([string]$_.InterfaceGuid).ToUpper() -eq '${change.guid.toUpperCase()}' })
    if ($adapter.Count -ne 1) { throw 'The network adapter was not found.' }
    Set-NetAdapterAdvancedProperty -Name $adapter[0].Name -RegistryKeyword '${change.keyword}' -RegistryValue '${change.value}' -NoRestart:$false -ErrorAction Stop`).join('\n');
  const script = `& {${steps}\n    [pscustomobject]@{ written = $true } | ConvertTo-Json -Compress\n  }`;
  const { stdout, stderr, exitCode } = await run(script);
  return { output: JSON.parse(stdout), stdout, stderr, exitCode };
}

/** The value now set for each listed change, or null where it can no longer be read. */
function currentValues(adapters, changes) {
  return changes.map((change) => adapters.find((adapter) => adapter.guid === change.guid.toUpperCase())?.settings.find((item) => item.keyword === change.keyword)?.value ?? null);
}

module.exports = { KEYWORDS, currentValues, describeAdapters, normalizeAdapters, onSettings, readNetworkPower, writeNetworkPower };
