const { runPowerShell } = require('../scanner/index.cjs');

// Read-only. netsh labels are localized; unmatched output is reported as
// unavailable rather than guessed. SSID and BSSID are intentionally not returned.
const WIFI_STATUS_SCRIPT = `
$output = (& netsh.exe wlan show interfaces 2>&1 | Out-String)
$output
`;

const FIELD_PATTERNS = {
  name: /^Name$/i,
  state: /^State$/i,
  radioType: /^Radio type$/i,
  band: /^Band$/i,
  channel: /^Channel$/i,
  receiveRateMbps: /^Receive rate \(Mbps\)$/i,
  transmitRateMbps: /^Transmit rate \(Mbps\)$/i,
  signalPercent: /^Signal$/i,
};

function parseWifiInterfaces(stdout) {
  const interfaces = [];
  let current = null;
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const match = /^\s{2,}([^:]+?)\s*:\s(.*)$/.exec(line);
    if (!match) continue;
    const label = match[1].trim();
    const value = match[2].trim();
    const field = Object.keys(FIELD_PATTERNS).find((key) => FIELD_PATTERNS[key].test(label));
    if (!field) continue;
    if (field === 'name') {
      current = { name: value.slice(0, 120), state: null, radioType: null, band: null, channel: null, receiveRateMbps: null, transmitRateMbps: null, signalPercent: null };
      interfaces.push(current);
      continue;
    }
    if (!current) continue;
    if (field === 'signalPercent') {
      const percent = Number(value.replace('%', ''));
      current.signalPercent = Number.isFinite(percent) && percent >= 0 && percent <= 100 ? percent : null;
    } else if (field === 'channel' || field === 'receiveRateMbps' || field === 'transmitRateMbps') {
      const number = Number(value);
      current[field] = Number.isFinite(number) && number >= 0 ? number : null;
    } else {
      current[field] = value.slice(0, 60);
    }
  }
  return interfaces;
}

function classifySignal(percent) {
  if (percent === null || percent === undefined) return 'UNKNOWN';
  if (percent >= 80) return 'STRONG';
  if (percent >= 60) return 'GOOD';
  if (percent >= 40) return 'FAIR';
  return 'WEAK';
}

async function readWifiStatus(run = runPowerShell) {
  let stdout = '';
  try {
    ({ stdout } = await run(WIFI_STATUS_SCRIPT));
  } catch (error) {
    return { collectedAt: new Date().toISOString(), status: 'UNAVAILABLE', reason: error instanceof Error ? error.message.slice(0, 240) : 'Wi-Fi status could not be read.', interfaces: [] };
  }
  const interfaces = parseWifiInterfaces(stdout).map((item) => ({ ...item, signalQuality: classifySignal(item.signalPercent) }));
  if (interfaces.length === 0) {
    return { collectedAt: new Date().toISOString(), status: 'NO_WIFI', reason: 'Windows reported no Wi-Fi interface, or its output is in a language Dialed cannot read yet.', interfaces: [] };
  }
  return { collectedAt: new Date().toISOString(), status: 'AVAILABLE', reason: null, interfaces };
}

module.exports = { WIFI_STATUS_SCRIPT, classifySignal, parseWifiInterfaces, readWifiStatus };
