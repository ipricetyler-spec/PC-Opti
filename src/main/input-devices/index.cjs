const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { assertCurrentProcessAdministrator } = require('../capabilities/index.cjs');
const { createPreviewStore } = require('../shared/preview-store.cjs');

const UPSTREAM = 'https://github.com/LordOfMice/hidusbf';
const NOPATCH_SHA256 = '2f82cdeb36bdaa42ea1933a9b11f3b8e1bdb28e6d3e3da7e65b4631b3375412d';
const PATCHING_1K_SHA256 = '81f649b34978fe9f74ce5c7c04ba24d5238faec6c70018f14da9423a46e6e04d';
const PATCHING_2K_4K_SHA256 = 'e2c9fc626bb92d2219fbef3458014c198a3c90c563f948c9a433826e64d77e90';
const PATCHING_4K_8K_SHA256 = 'db73a8c259e16a0d02f138650497c1bdec81add66d928f3cf3ff39fad4eb421b';
const PATCHING_SHA256 = PATCHING_1K_SHA256;
const NATIVE_INPUT_SOURCE_SHA256 = 'ed7c5dd5ecd25a01402be0ebdf88e39929cca1cd4f620bed181100a4cbdcdd91';
const MAX_NATIVE_INPUT_SOURCE_BYTES = 64 * 1024;
const FULL_SPEED_RATES = Object.freeze([125, 250, 500, 1000]);
const HIGH_SPEED_RATES = Object.freeze([1000, 2000, 4000, 8000]);
const RATES = Object.freeze([...FULL_SPEED_RATES, 2000, 4000, 8000]);
const TIER_TARGET = 3;
// Exact Microsoft-signed AMD64_AS files from upstream commit 994259a8de31b35d2d44dc800368d9418dd3eb04.
const DRIVER_VARIANTS = Object.freeze({
  [NOPATCH_SHA256]: Object.freeze({ mode: 'NoPatch', tier: 'No-patch', defaultPatchUsbXhci: 0 }),
  [PATCHING_1K_SHA256]: Object.freeze({ mode: 'Patching', tier: '1 kHz patch tier', defaultPatchUsbXhci: 1 }),
  [PATCHING_2K_4K_SHA256]: Object.freeze({ mode: 'Patching', tier: '2–4 kHz patch tier', defaultPatchUsbXhci: 2 }),
  [PATCHING_4K_8K_SHA256]: Object.freeze({ mode: 'Patching', tier: '4–8 kHz patch tier', defaultPatchUsbXhci: 3 }),
});
const digest = (value) => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const short = (value, limit = 1024) => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, '').slice(0, limit) : '';
const array = (value) => Array.isArray(value) ? value : value == null ? [] : [value];
const idKey = (value) => short(value).toUpperCase();
const nativeSource = fs.readFileSync(path.join(__dirname, 'native.ps1'), 'utf8');
const nativeSourceBase64 = Buffer.from(nativeSource, 'utf8').toString('base64');
let trustedNativeInputSource = null;

function highSpeedCeiling(patchUsbXhci) {
  if (patchUsbXhci === 2) return 4000;
  if (patchUsbXhci === 3) return 8000;
  if (patchUsbXhci === 0 || patchUsbXhci === 1) return 1000;
  return null;
}

function normalizePatchLocation(value) {
  const keyExists = value?.keyExists === true;
  const valueExists = value?.valueExists === true;
  return {
    keyExists,
    valueExists,
    kind: valueExists ? short(value?.kind, 24) : '',
    value: valueExists && Number.isInteger(value?.value) ? value.value : null,
  };
}

function samePatchLocation(left, right) {
  return Boolean(left && right)
    && left.keyExists === right.keyExists
    && left.valueExists === right.valueExists
    && left.kind === right.kind
    && left.value === right.value;
}

function rateForInterval(speed, interval) {
  if (!Number.isInteger(interval)) return null;
  if (speed === 1) return ({ 1: 1000, 2: 500, 4: 250, 8: 125 })[interval] || null;
  if (speed === 2) return ({ 1: 8000, 2: 4000, 3: 2000, 4: 1000 })[interval] || null;
  return null;
}

function intervalForRate(speed, rate) {
  if (speed === 1) return ({ 125: 8, 250: 4, 500: 2, 1000: 1 })[rate] || null;
  if (speed === 2) return ({ 1000: 4, 2000: 3, 4000: 2, 8000: 1 })[rate] || null;
  return null;
}

function ratesForNode(node, driver) {
  if (node.speed === 1) return [...FULL_SPEED_RATES];
  if (node.speed !== 2 || driver.mode !== 'Patching' || !driver.maxHighSpeedHz) return [];
  return HIGH_SPEED_RATES.filter((rate) => rate <= driver.maxHighSpeedHz);
}

function loadNativeInputSource(dependencies = {}) {
  const fileSystem = dependencies.fileSystem || fs;
  const moduleDirectory = dependencies.moduleDirectory || __dirname;
  const sourcePath = path.join(moduleDirectory, 'usb-native.cs');
  if (!fileSystem.existsSync(sourcePath)) {
    throw new Error('Input Devices native support is missing from this package. Reinstall or use a freshly verified Dialed build. No setting was changed.');
  }
  const raw = fileSystem.readFileSync(sourcePath);
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  if (bytes.length === 0 || bytes.length > MAX_NATIVE_INPUT_SOURCE_BYTES) {
    throw new Error('Input Devices native support has an invalid size. Reinstall or use a freshly verified Dialed build. No setting was changed.');
  }
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== NATIVE_INPUT_SOURCE_SHA256) {
    throw new Error('Input Devices native support failed its integrity check. Reinstall or use a freshly verified Dialed build. No setting was changed.');
  }
  const source = bytes.toString('utf8');
  if (!Buffer.from(source, 'utf8').equals(bytes)) {
    throw new Error('Input Devices native support is not valid UTF-8. Reinstall or use a freshly verified Dialed build. No setting was changed.');
  }
  return { sourcePath, bytes, source, sha256 };
}

function createNativeBootstrap(mode, payload, inputSource) {
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  const inputSourceBase64 = inputSource.bytes.toString('base64');
  const bootstrap = `$DialedInputSourceBase64='${inputSourceBase64}'; $DialedInputMode='${mode}'; $DialedInputPayload='${encodedPayload}'; $DialedNativeScriptBase64='${nativeSourceBase64}'; $DialedNativeScript=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($DialedNativeScriptBase64)); & ([ScriptBlock]::Create($DialedNativeScript))`;
  if (/[^\x00-\x7f]/.test(bootstrap)) throw new Error('Input Devices native bootstrap was not ASCII-safe. No setting was changed.');
  return bootstrap;
}

// Device IDs identify controller silicon, not a physical socket or measured latency.
// Narrow family inference; unknown Intel/AMD/Thunderbolt/add-in controllers stay unknown.
// PCI ID reference: https://raw.githubusercontent.com/pciutils/pciids/master/pci.ids (reviewed 2026-08-28).
const CONTROLLERS = Object.freeze({
  '1022:15B6': ['CPU', 'AMD Raphael / Granite Ridge integrated USB'],
  '1022:15B7': ['CPU', 'AMD Raphael / Granite Ridge integrated USB'],
  '1022:15B8': ['CPU', 'AMD Raphael / Granite Ridge integrated USB'],
  '1022:149C': ['CPU', 'AMD Matisse integrated USB'],
  '1022:43F7': ['CHIPSET', 'AMD 600-series chipset USB'],
  '1022:43FC': ['CHIPSET', 'AMD 800-series chipset USB'],
  '1022:43FD': ['CHIPSET', 'AMD 800-series chipset USB'],
  '8086:7AE0': ['CHIPSET', 'Intel Alder Lake-S PCH USB'],
});

function runNative(mode, payload = {}, signal) {
  if (!['Scan', 'Change', 'TierChange', 'Test'].includes(mode)) return Promise.reject(new Error('Unsupported USB operation.'));
  if (process.platform !== 'win32') return Promise.reject(new Error('USB controls require Windows.'));
  let bootstrap;
  try {
    if (!trustedNativeInputSource) trustedNativeInputSource = loadNativeInputSource();
    bootstrap = createNativeBootstrap(mode, payload, trustedNativeInputSource);
  }
  catch (error) { return Promise.reject(error); }
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  return new Promise((resolve, reject) => {
    let stdout = '', stderr = '', finished = false;
    const environment = { ...process.env };
    // A PowerShell 7 parent can inject incompatible module paths into Windows PowerShell 5.1.
    for (const name of Object.keys(environment)) if (name.toLowerCase() === 'psmodulepath') delete environment[name];
    const child = spawn(executable, ['-NoProfile', '-NonInteractive', '-Command', '-'], { windowsHide: true, env: environment });
    const finish = (error, result) => {
      if (finished) return;
      finished = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel);
      error ? reject(error) : resolve(result);
    };
    const cancel = () => { child.kill(); finish(new Error('Input test canceled. No settings were changed.')); };
    const timer = setTimeout(() => { child.kill(); finish(new Error('USB operation timed out. Rescan and review pending changes before retrying.')); }, 45000);
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    child.stdout.on('data', (bytes) => { stdout += bytes.toString(); if (Buffer.byteLength(stdout) > 8 * 1024 * 1024) { child.kill(); finish(new Error('USB response exceeded its size limit.')); } });
    child.stderr.on('data', (bytes) => { stderr = (stderr + bytes.toString()).slice(-4000); });
    child.stdin.on('error', (error) => { if (error?.code !== 'EPIPE') finish(error); });
    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      if (code !== 0) return finish(new Error(short(stderr.trim(), 1200) || 'Windows could not complete the USB operation. No success is assumed.'));
      try { finish(null, JSON.parse(stdout.replace(/^\uFEFF/, '').trim())); } catch { finish(new Error('USB response was incomplete. Rescan and review pending changes.')); }
    });
    child.stdin.end(bootstrap, 'ascii');
  });
}

function normalizeInventory(raw) {
  if (!raw || !Array.isArray(raw.nodes) || raw.nodes.length > 4096) throw new Error('USB inventory is incomplete or too large.');
  const map = new Map();
  for (const value of raw.nodes) {
    const id = idKey(value.id);
    if (!/^(USB|HID|PCI)\\[^\r\n]{1,1000}$/.test(id) || map.has(id)) throw new Error('USB inventory contains ambiguous device identifiers.');
    map.set(id, {
      id, parent: idKey(value.parent), name: short(value.name, 180), location: short(value.location),
      inputKind: ['MOUSE', 'KEYBOARD', 'JOYSTICK', 'GAMEPAD'].includes(value.inputKind) ? value.inputKind : '',
      className: short(value.className, 80), service: short(value.service, 80),
      compatibleIds: array(value.compatibleIds).map(idKey), hardwareIds: array(value.hardwareIds).map(idKey),
      lowerFilters: array(value.lowerFilters).map((v) => short(v, 120)), problem: Number.isInteger(value.problem) ? value.problem : -1,
      present: value.present === true, speed: [0, 1, 2, 3].includes(value.speed) ? value.speed : -1,
      port: Number.isInteger(value.port) && value.port > 0 && value.port < 256 ? value.port : null,
      interval: value.interval && typeof value.interval === 'object' ? {
        key: ['Hardware', 'Parameters', 'Driver'].includes(value.interval.key) ? value.interval.key : '',
        kind: short(value.interval.kind, 20), value: Number.isInteger(value.interval.value) ? value.interval.value : null,
        readable: value.interval.readable === true, ambiguous: value.interval.ambiguous === true,
      } : null,
    });
  }
  const hash = short(raw.driver?.hash, 64).toLowerCase();
  const variant = DRIVER_VARIANTS[hash] || null;
  const hasPatchReport = Boolean(raw.driver && Object.prototype.hasOwnProperty.call(raw.driver, 'patchUsbXhci'));
  const rawPatchUsbXhci = Number.isInteger(raw.driver?.patchUsbXhci) ? raw.driver.patchUsbXhci : null;
  const patchUsbXhci = [0, 1, 2, 3].includes(rawPatchUsbXhci) ? rawPatchUsbXhci : hasPatchReport ? null : variant?.defaultPatchUsbXhci ?? null;
  const driver = {
    state: short(raw.driver?.state, 40), hash,
    signature: short(raw.driver?.signature, 40), mode: variant?.mode || 'Unknown',
    tier: variant?.tier || 'Unknown build', patchUsbXhci,
    patchSource: short(raw.driver?.patchSource, 40) || (variant ? 'Driver default' : 'Unknown'),
    maxHighSpeedHz: variant?.mode === 'Patching' ? highSpeedCeiling(patchUsbXhci) : null,
    configuredMaxHighSpeedHz: variant?.mode === 'Patching' ? highSpeedCeiling(patchUsbXhci) : null,
    activePatchUsbXhci: patchUsbXhci,
    restartState: 'NONE',
    tierHistoryId: null,
    patchLocations: {
      servicesParameters: normalizePatchLocation(raw.driver?.patchLocations?.servicesParameters),
      legacyControl: normalizePatchLocation(raw.driver?.patchLocations?.legacyControl),
    },
  };
  return {
    map,
    driver,
    elevated: raw.elevated === true,
    bootId: short(raw.bootId, 100),
    security: { memoryIntegrity: ['Enabled', 'Configured', 'Disabled'].includes(raw.security?.memoryIntegrity) ? raw.security.memoryIntegrity : 'Unknown' },
  };
}

function trace(map, start) {
  const seen = new Set(), nodes = [];
  let id = start;
  for (let depth = 0; depth < 32 && id; depth++) {
    if (seen.has(id) || !map.has(id)) return { nodes, complete: false };
    seen.add(id); const node = map.get(id); nodes.push(node);
    if (/^PCI\\/.test(id)) return { nodes, complete: true };
    id = node.parent;
  }
  return { nodes, complete: false };
}

function pollingReason(node, inventory, complete) {
  if (!complete) return 'The USB connection could not be traced completely.';
  if (!node.present || node.problem !== 0) return 'Resolve the Windows device error before changing polling.';
  if (!node.lowerFilters.some((value) => value.toLowerCase() === 'hidusbf')) return 'HIDUSBF is not configured on this device. Initial driver/filter setup is not automated in this candidate.';
  const supportedDriver = Boolean(DRIVER_VARIANTS[inventory.driver.hash]);
  if (inventory.driver.state !== 'Running' || inventory.driver.signature !== 'ValidMicrosoft' || !supportedDriver) return 'This candidate changes rates only with an exact verified, running HIDUSBF build. Unknown or modified drivers are left untouched.';
  if (![1, 2].includes(node.speed)) return 'Direct rate changes require a confirmed USB Full-Speed or High-Speed connection. Low-Speed, SuperSpeed and unknown mappings remain read-only.';
  if (inventory.driver.restartState && inventory.driver.restartState !== 'NONE') return 'Finish the pending global xHCI tier restart or recovery check before changing a device interval.';
  if (node.speed === 2 && (inventory.driver.mode !== 'Patching' || !inventory.driver.maxHighSpeedHz)) return 'High-Speed rate changes require an exact reviewed patching tier with an unambiguous xHCI capability.';
  if (!node.interval?.readable || node.interval.ambiguous || node.interval.kind !== 'DWord' || !node.interval.key || rateForInterval(node.speed, node.interval.value) === null) return 'The existing speed-specific polling override could not be identified unambiguously. No value will be guessed or created.';
  if (!node.location) return 'A stable Windows connection path is required before applying.';
  return null;
}

function buildDevices(inventory, saved = { ports: {} }) {
  const { map } = inventory;
  const inputParents = new Set();
  for (const node of map.values()) {
    if (node.inputKind || /^(XUSBClass|XboxComposite|XnaComposite)$/i.test(node.className)) {
      for (const ancestor of trace(map, node.id).nodes) if (/^USB\\VID_[0-9A-F]{4}&PID_[0-9A-F]{4}\\/.test(ancestor.id)) { inputParents.add(ancestor.id); break; }
    }
  }
  return [...inputParents].slice(0, 128).map((id) => {
    const node = map.get(id), route = trace(map, id);
    const controller = route.complete ? route.nodes.at(-1) : null;
    const hardware = controller?.id.match(/VEN_([0-9A-F]{4})&DEV_([0-9A-F]{4})/);
    const rule = hardware && CONTROLLERS[`${hardware[1]}:${hardware[2]}`];
    const hubs = route.nodes.slice(1).filter((item) => !/^USB\\ROOT_HUB/.test(item.id) && (item.compatibleIds.some((value) => /^USB\\CLASS_09/.test(value)) || /^USBHUB3?$/i.test(item.service)));
    const portId = node.location ? digest(node.location) : '';
    const reason = pollingReason(node, inventory, route.complete);
    const rates = reason ? [] : ratesForNode(node, inventory.driver);
    const related = [...map.values()].filter((item) => /^HID\\/.test(item.id) && trace(map, item.id).nodes.some((ancestor) => ancestor.id === id));
    const inputKinds = new Set(related.map((item) => item.inputKind).filter(Boolean));
    const testKinds = ['MOUSE', 'KEYBOARD', 'JOYSTICK', 'GAMEPAD'].filter((kind) => inputKinds.has(kind));
    const product = node.id.match(/VID_[0-9A-F]{4}&PID_[0-9A-F]{4}/)?.[0] || '';
    return {
      id: digest(id), product, name: node.name || related[0]?.name || 'USB input device',
      connected: node.present, problem: node.problem, portId, portLabel: saved.ports[portId]?.label || '',
      portNumber: node.port, location: node.location, routeComplete: route.complete,
      hubs: route.complete ? hubs.length : null, hubNames: hubs.map((item) => item.name || 'USB hub'),
      controller: controller?.name || 'Controller not identified', connection: rule?.[0] || 'UNKNOWN',
      connectionEvidence: rule ? `${rule[1]} — controller-ID inference, not a verified motherboard socket map.` : 'CPU/chipset attachment is unknown; the controller name alone is not proof.',
      speed: ['Low-Speed', 'Full-Speed', 'High-Speed', 'SuperSpeed'][node.speed] || 'Unknown',
      filterActive: node.lowerFilters.some((v) => v.toLowerCase() === 'hidusbf'),
      configuredHz: rateForInterval(node.speed, node.interval?.value),
      maxSupportedHz: rates.length ? rates.at(-1) : null,
      canApply: !reason && inventory.elevated, eligibilityReason: reason || (!inventory.elevated ? 'This session lacks administrator access. The packaged Dialed app requests it at launch; read-only checks remain available in this session.' : null),
      rates, canTest: node.present && testKinds.length > 0, testKinds,
      advice: !route.complete ? 'Rescan to complete this connection before comparing ports.' : hubs.length ? 'Try a motherboard port without this extra hub, then compare. Fewer hubs is not a measured latency result.' : 'No additional USB hub was detected. Keep this as a comparison point; CPU attachment alone does not prove lower latency.',
    };
  }).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

function buildFilteredDevices(inventory) {
  const inputIds = new Set(buildDevices(inventory).map((item) => item.id));
  const attachments = [...inventory.map.values()].filter((node) => node.lowerFilters.some((value) => value.toLowerCase() === 'hidusbf'));
  const groups = new Map();
  for (const attachment of attachments) {
    const physical = trace(inventory.map, attachment.id).nodes.filter((node) => /^USB\\VID_[0-9A-F]{4}&PID_[0-9A-F]{4}\\[^\\]{1,240}$/.test(node.id));
    const resolved = physical.length === 1 ? physical[0] : null;
    const key = resolved ? resolved.id : `UNRESOLVED:${attachment.id}`;
    if (!groups.has(key)) groups.set(key, { node: resolved, attachments: [] });
    groups.get(key).attachments.push(attachment);
  }
  return [...groups.values()].slice(0, 128).map(({ node, attachments: filteredAttachments }) => {
    if (!node) {
      const attachment = filteredAttachments[0];
      return {
        id: digest(`UNRESOLVED:${attachment.id}`),
        name: attachment.name || 'Unresolved HIDUSBF attachment',
        speed: 'Unknown', configuredHz: null, isInput: false,
        interfaceNames: filteredAttachments.map((item) => item.name).filter(Boolean).slice(0, 8),
        wouldExceed1k: false, uncertainImpact: true, canSetSafe1k: false,
        safetyReason: 'A HIDUSBF filter attachment could not be mapped to one physical USB device. The shared tier is blocked.',
        scopeResolved: false, filterDirect: false, attachmentCount: filteredAttachments.length,
        attachmentHash: digest(filteredAttachments.map((item) => item.id).sort()),
      };
    }
    const route = trace(inventory.map, node.id);
    const related = [...inventory.map.values()].filter((item) => item.id !== node.id && trace(inventory.map, item.id).nodes.some((ancestor) => ancestor.id === node.id));
    const interfaceNames = [...new Set([...related, ...filteredAttachments].map((item) => item.name).filter(Boolean))].slice(0, 8);
    const configuredHz = rateForInterval(node.speed, node.interval?.value);
    const filterDirect = node.lowerFilters.some((value) => value.toLowerCase() === 'hidusbf');
    const reason = filterDirect
      ? pollingReason(node, inventory, route.complete)
      : 'HIDUSBF is attached below the physical USB parent. Dialed can audit this scope but cannot safely change its interval.';
    const isInput = inputIds.has(digest(node.id));
    const uncertainImpact = !filterDirect || (node.speed !== 1 && (node.speed !== 2 || configuredHz === null));
    return {
      id: digest(node.id),
      name: node.name || 'Filtered USB device',
      speed: ['Low-Speed', 'Full-Speed', 'High-Speed', 'SuperSpeed'][node.speed] || 'Unknown',
      configuredHz,
      isInput,
      interfaceNames,
      wouldExceed1k: node.speed === 2 && configuredHz !== null && configuredHz > 1000,
      uncertainImpact,
      canSetSafe1k: node.speed === 2 && configuredHz !== null && configuredHz > 1000 && !reason && inventory.elevated,
      safetyReason: reason || (!inventory.elevated ? 'Administrator access is unavailable in this session; the packaged app requests it at launch.' : null),
      scopeResolved: true, filterDirect, attachmentCount: filteredAttachments.length,
      attachmentHash: digest(filteredAttachments.map((item) => item.id).sort()),
    };
  }).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

function filteredScopeSnapshot(inventory) {
  return buildFilteredDevices(inventory).map((item) => ({
    id: item.id, name: item.name, speed: item.speed, configuredHz: item.configuredHz,
    isInput: item.isInput, scopeResolved: item.scopeResolved, filterDirect: item.filterDirect,
    attachmentCount: item.attachmentCount, attachmentHash: item.attachmentHash,
    wouldExceed1k: item.wouldExceed1k, uncertainImpact: item.uncertainImpact,
  }));
}

function filteredScopeHash(snapshot) {
  return digest(snapshot.map(({ name: _name, ...item }) => item));
}

function describeScopeDrift(before, after) {
  const previous = new Map(array(before).map((item) => [item.id, item]));
  const current = new Map(array(after).map((item) => [item.id, item]));
  const changed = [];
  for (const [id, item] of previous) {
    const next = current.get(id);
    if (!next) changed.push(`${item.name || 'Filtered device'} was removed`);
    else if (digest({ ...item, name: '' }) !== digest({ ...next, name: '' })) changed.push(`${next.name || item.name || 'Filtered device'} changed`);
  }
  for (const [id, item] of current) if (!previous.has(id)) changed.push(`${item.name || 'Filtered device'} was added`);
  return changed.slice(0, 3).join('; ') || 'the filtered-device audit changed';
}

function emptyStore() { return { version: 1, ports: {}, history: [], tierHistory: [] }; }
function readStore(directory) {
  const file = path.join(directory, 'input-devices.json');
  if (!fs.existsSync(file)) return emptyStore();
  if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('Linked input-device storage is refused.');
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error('Input-device history is not a safe bounded file.');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (data.version !== 1 || !data.ports || typeof data.ports !== 'object' || Array.isArray(data.ports) || !Array.isArray(data.history) || data.history.length > 100 || Object.keys(data.ports).length > 128) throw new Error('Input-device history is invalid; it has not been overwritten.');
  if (data.tierHistory === undefined) data.tierHistory = [];
  if (!Array.isArray(data.tierHistory) || data.tierHistory.length > 50) throw new Error('Input-device tier history is invalid; it has not been overwritten.');
  return data;
}
function writeStore(directory, data) {
  fs.mkdirSync(directory, { recursive: true });
  if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('Linked input-device storage is refused.');
  const file = path.join(directory, 'input-devices.json');
  if (fs.existsSync(file) && (fs.lstatSync(file).isSymbolicLink() || !fs.lstatSync(file).isFile())) throw new Error('Unsafe input-device history target.');
  const bytes = JSON.stringify(data, null, 2);
  if (Buffer.byteLength(bytes) > 1024 * 1024) throw new Error('Input-device history size limit reached.');
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, file);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function publicHistory(history) {
  return history.map((item) => ({ id: item.id, deviceId: item.deviceId, name: item.name, createdAt: item.createdAt, beforeHz: item.beforeHz, afterHz: item.afterHz, beforeInterval: item.before, afterInterval: item.after, status: item.status, purpose: item.purpose || 'POLLING' }));
}
function publicTierHistory(history) {
  return history.map((item) => ({
    id: item.id, targetDeviceId: item.targetDeviceId, targetName: item.targetName,
    createdAt: item.createdAt, beforeTier: item.beforeTier, afterTier: item.afterTier,
    beforeSetting: item.beforePatch ? item.beforePatch.valueExists ? `DWORD ${item.beforePatch.value}` : 'absent' : 'unknown',
    afterSetting: item.afterPatch ? item.afterPatch.valueExists ? `DWORD ${item.afterPatch.value}` : 'absent' : 'unknown',
    status: item.status, restores: item.restores || null, scopeDrift: short(item.scopeDrift, 300) || null,
  }));
}

function projectDriverRuntime(inventory, store) {
  const driver = { ...inventory.driver };
  const pending = store.tierHistory.find((item) => ['PENDING', 'NEEDS_REVIEW', 'SCOPE_DRIFT', 'REBOOT_REQUIRED', 'RESTORE_REBOOT_REQUIRED'].includes(item.status));
  if (!pending) return driver;
  driver.tierHistoryId = pending.id;
  if (['NEEDS_REVIEW', 'SCOPE_DRIFT'].includes(pending.status) || !inventory.bootId || !pending.bootId) {
    driver.activePatchUsbXhci = null;
    driver.maxHighSpeedHz = null;
    driver.restartState = 'NEEDS_REVIEW';
    return driver;
  }
  if (inventory.bootId === pending.bootId) {
    driver.activePatchUsbXhci = pending.activeBefore;
    driver.maxHighSpeedHz = driver.mode === 'Patching' ? highSpeedCeiling(pending.activeBefore) : null;
    driver.restartState = 'REBOOT_REQUIRED';
    return driver;
  }
  driver.activePatchUsbXhci = null;
  driver.maxHighSpeedHz = null;
  driver.restartState = 'VERIFY_AFTER_REBOOT';
  return driver;
}

function tierScopeDigest(inventory) {
  return digest({
    driver: inventory.driver,
    bootId: inventory.bootId,
    security: inventory.security,
    filteredDevices: filteredScopeSnapshot(inventory),
  });
}
function summarizeTiming(raw, requestedHz = null) {
  if (!raw || !Array.isArray(raw.channels) || raw.channels.length > 32) throw new Error('Invalid input timing result.');
  let count = 0;
  return raw.channels.map((channel, index) => {
    if (channel.kind === 'KEYBOARD' && channel.messageCount !== undefined) {
      if (channel.timesMs !== undefined || channel.motionTimesMs !== undefined || !Number.isInteger(channel.messageCount) || channel.messageCount < 0 || (count += channel.messageCount) > 100000 || !Number.isFinite(channel.spanMs) || channel.spanMs < 0 || channel.spanMs > 12000) throw new Error('Invalid keyboard aggregate result.');
      return { channel: index + 1, kind: 'KEYBOARD', samples: channel.messageCount, activeDurationMs: channel.spanMs, eventHz: null, hidReports: null, reportHz: null, motionSpanMs: 0, motionHz: null, medianGapMs: null, p95GapMs: null };
    }
    const times = channel.timesMs;
    if (!Array.isArray(times) || (count += times.length) > 100000 || times.some((n, i) => !Number.isFinite(n) || n < 0 || n > 12000 || (i > 0 && n < times[i - 1]))) throw new Error('Invalid input-event timestamps.');
    const gaps = times.slice(1).map((n, i) => n - times[i]).sort((a, b) => a - b);
    const duration = times.length > 1 ? times.at(-1) - times[0] : 0;
    const kind = ['MOUSE', 'KEYBOARD', 'JOYSTICK', 'GAMEPAD'].includes(channel.kind) ? channel.kind : 'INPUT';
    const motion = channel.motionTimesMs ?? [];
    if (!Array.isArray(motion) || motion.length > times.length || motion.some((n, i) => !Number.isFinite(n) || n < 0 || n > 12000 || (i > 0 && n < motion[i - 1]))) throw new Error('Invalid pointer-motion timestamps.');
    // Motion timestamps must be a subsequence of this channel's message times.
    let cursor = 0;
    for (const ms of motion) { while (cursor < times.length && times[cursor] !== ms) cursor++; if (cursor === times.length) throw new Error('Pointer motion is not bound to its message channel.'); cursor++; }
    let motionSpanMs = 0, motionIntervals = 0;
    if (RATES.includes(requestedHz)) for (let i = 1; i < motion.length; i++) {
      const gap = motion[i] - motion[i - 1];
      if (gap >= 0 && gap <= 20) { motionSpanMs += gap; motionIntervals++; }
    }
    let hidReports = null, reportHz = null;
    if (channel.hidReports !== undefined || channel.firstHidReports !== undefined) {
      if (!Number.isInteger(channel.hidReports) || channel.hidReports < 0 || channel.hidReports > 100000 || !Number.isInteger(channel.firstHidReports) || channel.firstHidReports < 0 || channel.firstHidReports > 256 || channel.firstHidReports > channel.hidReports) throw new Error('Invalid HID report count.');
      hidReports = channel.activity?.reportErrors ? null : channel.hidReports;
      if (duration > 0 && times.length >= 30 && hidReports > 0 && !channel.activity?.reportErrors) reportHz = Math.round((hidReports - channel.firstHidReports) * 1000 / duration);
    }
    return { channel: index + 1, kind, samples: times.length, activeDurationMs: duration, eventHz: duration > 0 && times.length >= 30 ? Math.round((times.length - 1) * 1000 / duration) : null, hidReports, reportHz, motionSpanMs, motionHz: motionSpanMs >= 500 && channel.activity?.movement > 0 ? Math.round(motionIntervals * 1000 / motionSpanMs) : null, decodeErrors: channel.activity?.errors || 0, medianGapMs: gaps.length ? gaps[Math.floor(gaps.length / 2)] : null, p95GapMs: gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * 0.95))] : null };
  });
}

function summarizeActivity(raw) {
  const totals = { decoded: 0, unsupported: 0, errors: 0, buttons: 0, keys: 0, movement: 0, axes: 0, hats: 0, unstableAxes: 0, sparseAxes: 0, pendingAxes: 0, unmonitoredControls: 0 };
  if (raw.activityVersion === undefined) return { status: 'UNAVAILABLE', coverage: 'NONE', ...totals, message: 'Control activity was not measured by this capture.' };
  if (raw.activityVersion !== 1 || !Array.isArray(raw.channels) || raw.channels.length > 32) throw new Error('Invalid control activity result.');
  for (const channel of raw.channels) {
    for (const key of Object.keys(totals)) {
      const value = ['unstableAxes', 'sparseAxes', 'pendingAxes', 'unmonitoredControls'].includes(key) ? channel.activity?.[key] ?? 0 : channel.activity?.[key];
      if (!Number.isSafeInteger(value) || value < 0 || value > (key === 'unmonitoredControls' ? 512 : 100000000)) throw new Error('Invalid control activity count.');
      totals[key] += value;
    }
  }
  const changes = totals.buttons + totals.keys + totals.movement + totals.axes + totals.hats;
  if (changes && !totals.decoded) throw new Error('Control changes require decoded data.');
  if (!raw.channels.length) return { status: 'INCONCLUSIVE', coverage: 'NONE', ...totals, message: 'No input messages arrived from the selected device. An idle or change-only device may be silent; control activity was not established.' };
  const coverage = !totals.decoded ? (totals.unmonitoredControls ? 'PARTIAL' : 'NONE') : totals.errors || totals.unsupported || totals.unstableAxes || totals.sparseAxes || totals.pendingAxes || totals.unmonitoredControls ? 'PARTIAL' : 'AVAILABLE';
  const status = changes ? 'DETECTED' : coverage === 'AVAILABLE' ? 'NO_SIGNIFICANT_CHANGE' : 'INCONCLUSIVE';
  const message = changes ? 'Control activity detected on the selected device.' : coverage === 'AVAILABLE'
    ? 'No significant control changes detected. Small movement and controls held from the start may not register.'
    : 'Control activity is inconclusive because supported control data or coverage is incomplete.';
  return { status, coverage, ...totals, message: `${totals.unstableAxes && !changes ? 'Control activity is inconclusive: the axis baseline was unstable.' : message}${coverage === 'PARTIAL' ? ' Control coverage is partial.' : ''}${totals.unmonitoredControls ? ' Some declared controls are not monitored; no change does not establish inactivity for them.' : ''}${totals.unstableAxes ? ' Repeat with sticks and triggers held still briefly at the start.' : ''}${totals.sparseAxes || totals.pendingAxes ? ' Too few baseline samples or input began late; unchanged axes cannot establish inactivity.' : ''}` };
}

function assessObservedDelivery(channels, requestedHz) {
  const activityLimit = 'Message rate alone does not establish control activity.';
  const noMessages = !array(channels).some((item) => item.samples > 0);
  if (array(channels).length && channels.every(item => item.kind === 'KEYBOARD')) return { status: 'NO_REQUEST', requestedHz: RATES.includes(requestedHz) ? requestedHz : null, observedHz: null, channelAssessments: channels.map(item => ({ channel: item.channel, kind: item.kind, status: 'NO_COMPARISON', observedHz: null, message: 'Keyboard traffic reflects key changes and repeats. Polling rate cannot be inferred from typing.' })), message: `${noMessages ? 'No Windows messages were received from this device. ' : ''}Keyboard traffic reflects key changes and repeats. Polling rate cannot be inferred from typing.` };
  if (!RATES.includes(requestedHz)) return { status: 'NO_REQUEST', requestedHz: null, observedHz: null, message: `${noMessages ? 'No Windows messages were received from this device. ' : ''}No supported saved request was available for comparison. ${activityLimit}` };
  const channelAssessments = array(channels).map((item) => {
    const base = { channel: item.channel, kind: item.kind, status: 'INCONCLUSIVE', observedHz: null };
    if (item.kind === 'KEYBOARD') return { ...base, status: 'NO_COMPARISON', message: 'Keyboard traffic reflects key changes and repeats. Polling rate cannot be inferred from typing.' };
    if (item.kind === 'MOUSE' && !Number.isFinite(item.motionHz)) return { ...base, message: 'Not enough continuous movement for a mouse rate comparison (at least 500 ms of motion spans required).' };
    if (!['MOUSE', 'GAMEPAD', 'JOYSTICK'].includes(item.kind)) return { ...base, message: 'This channel has no supported rate-comparison model.' };
    const observedHz = item.kind === 'MOUSE' ? item.motionHz : item.reportHz ?? item.eventHz;
    const unit = item.kind === 'MOUSE' ? 'Windows motion messages/s' : item.reportHz != null ? 'Windows HID reports/s' : 'Windows messages/s';
    if (!Number.isFinite(observedHz) || item.samples < 30 || (item.kind !== 'MOUSE' && item.activeDurationMs < 1500)) return { ...base, message: 'Not enough sustained Windows messages were received for a rate comparison.' };
    const ratio = observedHz / requestedHz;
    const status = ratio >= 0.9 && ratio <= 1.15 ? 'CONSISTENT_WITH_REQUEST' : ratio < 0.9 ? 'BELOW_REQUEST_OBSERVED' : 'INCONCLUSIVE';
    const comparison = status === 'CONSISTENT_WITH_REQUEST' ? `for the ${requestedHz} Hz saved request` : status === 'BELOW_REQUEST_OBSERVED' ? `below the ${requestedHz} Hz saved request during this check` : `above the comparison range for the ${requestedHz} Hz saved request`;
    return { ...base, status, observedHz, message: `About ${observedHz} ${unit} ${comparison}.` };
  });
  const measured = channelAssessments.filter(item => item.observedHz !== null).sort((a, b) => b.observedHz - a.observedHz);
  const best = measured.find(item => item.status === 'BELOW_REQUEST_OBSERVED') || measured[0];
  const keyboardNote = channelAssessments.some(item => item.kind === 'KEYBOARD') ? ' Keyboard polling is not inferred from typing.' : '';
  return { status: best?.status || 'INCONCLUSIVE', requestedHz, observedHz: best?.observedHz ?? null, channelAssessments,
    message: `${noMessages ? 'No Windows messages were received from this device.' : best?.message || channelAssessments[0]?.message || 'Not enough sustained Windows messages were received for a rate comparison.'} ${activityLimit}${keyboardNote}` };
}

function createInputService(directory, adapters = {}) {
  const native = adapters.native || runNative, save = adapters.save || writeStore, now = adapters.now || Date.now;
  // Production has one authority for new writes: signed native setup. A fake
  // native adapter may explicitly enable historical-write fixtures only.
  const allowNewLegacyWrites = () => Boolean(adapters.native && adapters.allowLegacyNewWrites?.() === true);
  const restoreAuthority = () => adapters.native && adapters.legacyRestoreAuthority ? adapters.legacyRestoreAuthority() : require('./legacy-authority.cjs').legacyRestoreAuthority();
  const legacyWriteMessage = 'Use Change rate in native setup for new rate changes. Legacy controls are reserved for their own recorded recovery; unavailable or expired native policy does not enable a fallback.';
  function assertLegacyAuthority(restore) {
    if (!restore && !allowNewLegacyWrites()) throw new Error(legacyWriteMessage);
    if (restore && adapters.nativeSetupActive?.()) throw new Error('Close native setup before reviewing legacy recovery. Finish any saved native operation there first.');
    if (restore) { const authority = restoreAuthority(); if (!authority.allowed) throw new Error(authority.message); }
  }
  const previews = createPreviewStore({ now, ttlMs: 120000, makeError: () => new Error('Polling preview expired. Review the change again.') });
  const tierPreviews = createPreviewStore({ now, ttlMs: 120000, makeError: () => new Error('Tier preview expired. Review the global change again.') });
  let testController = null, mutationBusy = false, queue = Promise.resolve();
  const serialize = (operation) => { const result = queue.then(operation, operation); queue = result.catch(() => {}); return result; };
  const readInventory = async () => normalizeInventory(await native('Scan'));
  async function scan() {
    const observed = await readInventory(), store = readStore(directory);
    const inventory = { ...observed, driver: projectDriverRuntime(observed, store) };
    return {
      scannedAt: new Date(now()).toISOString(),
      devices: buildDevices(inventory, store),
      filteredDevices: buildFilteredDevices(inventory),
      driver: inventory.driver,
      security: inventory.security,
      elevated: inventory.elevated,
      history: publicHistory(store.history),
      tierHistory: publicTierHistory(store.tierHistory),
      upstream: UPSTREAM,
      legacyNewWritesAllowed: allowNewLegacyWrites(),
      legacyWriteMessage,
      legacyRestoreAuthority: restoreAuthority(),
    };
  }
  async function preview(deviceId, rate, historyId) {
    if (testController) throw new Error('Finish or cancel the input test first.');
    assertLegacyAuthority(historyId !== undefined);
    if (typeof deviceId !== 'string' || !/^[a-f0-9]{64}$/.test(deviceId)) throw new Error('Invalid input device.');
    const observed = await readInventory(), store = readStore(directory);
    const inventory = { ...observed, driver: projectDriverRuntime(observed, store) };
    const node = [...inventory.map.values()].find((item) => digest(item.id) === deviceId);
    let device = buildDevices(inventory, store).find((item) => item.id === deviceId);
    if (!device && historyId !== undefined && node) {
      const filtered = buildFilteredDevices(inventory).find((item) => item.id === deviceId);
      const reason = filtered ? pollingReason(node, inventory, trace(inventory.map, node.id).complete) : 'That filtered device is no longer connected.';
      if (filtered) device = { id: filtered.id, name: filtered.name, canApply: !reason && inventory.elevated, eligibilityReason: reason || (!inventory.elevated ? 'Administrator access is unavailable in this session; the packaged app requests it at launch.' : null), rates: [] };
    }
    if (!device || !node) throw new Error('That device is no longer connected. Rescan first.');
    if (!device.canApply) throw new Error(device.eligibilityReason);
    assertCurrentProcessAdministrator('input:polling-rate', inventory.elevated, 'This session lacks administrator access. The packaged Dialed app requests it at launch; read-only checks remain available in this session.');
    let action = 'APPLY', after, purpose = 'POLLING';
    if (historyId !== undefined) {
      const entry = store.history.find((item) => item.id === historyId && item.deviceId === deviceId);
      if (!entry || !['CONFIGURED', 'PENDING', 'NEEDS_REVIEW'].includes(entry.status) || !RATES.includes(entry.beforeHz) || rateForInterval(node.speed, entry.before) !== entry.beforeHz || digest(entry.nativeId) !== deviceId || entry.nativeId !== node.id) throw new Error('A valid unrestored change for this exact device is required.');
      if (node.interval.value !== entry.after || node.interval.key !== entry.key || node.location !== entry.location || inventory.driver.hash !== entry.driverHash || digest(node.lowerFilters) !== entry.filtersHash) throw new Error('Device configuration changed since this operation. Restore is refused rather than overwriting another change.');
      rate = entry.beforeHz; after = entry.before; action = 'RESTORE'; purpose = entry.purpose || 'POLLING';
    } else {
      if (!device.rates.includes(rate)) throw new Error(`Choose a supported polling request for this ${device.speed} device and installed driver tier.`);
      after = intervalForRate(node.speed, rate);
    }
    if (!RATES.includes(rate) || !Number.isInteger(after)) throw new Error('Choose a supported polling rate.');
    if (node.interval.value === after) throw new Error('The configured rate already matches. Nothing was changed.');
    if (action === 'APPLY' && store.history.some((item) => item.deviceId === deviceId && ['PENDING', 'NEEDS_REVIEW'].includes(item.status))) throw new Error('Review or restore the pending device change before applying another rate.');
    if (store.history.length >= 100) throw new Error('Input history limit reached. No evidence has been discarded.');
    tierPreviews.clear();
    const pending = previews.issue({ device, node, driver: inventory.driver, rate, after, action, purpose, historyId, storeHash: digest(store) });
    return { token: pending.token, deviceId, name: device.name, beforeHz: rateForInterval(node.speed, node.interval.value), afterHz: rate, action, expiresAt: new Date(pending.expiresAt).toISOString() };
  }
  async function previewIsolation(deviceId) {
    if (testController) throw new Error('Finish or cancel the input test first.');
    assertLegacyAuthority(false);
    if (typeof deviceId !== 'string' || !/^[a-f0-9]{64}$/.test(deviceId)) throw new Error('Invalid filtered device.');
    const observed = await readInventory(), store = readStore(directory);
    const inventory = { ...observed, driver: projectDriverRuntime(observed, store) };
    if (inventory.driver.restartState !== 'NONE') throw new Error('Finish the pending global xHCI tier restart or recovery check first.');
    const device = buildFilteredDevices(inventory).find((item) => item.id === deviceId);
    if (!device?.wouldExceed1k || !device.canSetSafe1k) throw new Error(device?.safetyReason || 'This device does not have an eligible higher-than-1 kHz interval to isolate.');
    const node = [...inventory.map.values()].find((item) => digest(item.id) === deviceId);
    const after = intervalForRate(node.speed, 1000);
    if (!node || !Number.isInteger(after) || node.interval.value === after) throw new Error('The filtered device already requests the reviewed 1 kHz safety interval.');
    if (store.history.some((item) => item.deviceId === deviceId && ['PENDING', 'NEEDS_REVIEW'].includes(item.status))) throw new Error('Review or restore the pending device change before isolating it again.');
    if (store.history.length >= 100) throw new Error('Input history limit reached. No evidence has been discarded.');
    tierPreviews.clear();
    const pending = previews.issue({
      device: { id: device.id, name: device.name }, node, driver: inventory.driver,
      rate: 1000, after, action: 'APPLY', historyId: undefined,
      purpose: 'TIER_ISOLATION', storeHash: digest(store),
    });
    return {
      token: pending.token, deviceId, name: device.name,
      beforeHz: rateForInterval(node.speed, node.interval.value), afterHz: 1000,
      action: 'ISOLATE', expiresAt: new Date(pending.expiresAt).toISOString(),
    };
  }
  async function apply(token) {
    return serialize(async () => {
      mutationBusy = true;
      try {
      const pending = previews.take(token).preview;
      if (testController) throw new Error('Finish or cancel the input test first.');
      assertLegacyAuthority(pending.action === 'RESTORE');
       const observed = await readInventory(), store = readStore(directory);
       const inventory = { ...observed, driver: projectDriverRuntime(observed, store) };
       const node = inventory.map.get(pending.node.id);
      assertCurrentProcessAdministrator('input:polling-rate', inventory.elevated, 'This session lacks administrator access. The packaged Dialed app requests it at launch; read-only checks remain available in this session.');
      if (!node || digest(node) !== digest(pending.node) || digest(inventory.driver) !== digest(pending.driver) || digest(store) !== pending.storeHash) throw new Error('Device, driver, or history changed after preview. Nothing was written.');
       const reason = pollingReason(node, inventory, trace(inventory.map, node.id).complete); if (reason) throw new Error(reason);
       const entry = { id: crypto.randomUUID(), deviceId: pending.device.id, name: pending.device.name, createdAt: new Date(now()).toISOString(), nativeId: node.id, location: node.location, key: node.interval.key, filtersHash: digest(node.lowerFilters), driverHash: inventory.driver.hash, before: node.interval.value, after: pending.after, beforeHz: rateForInterval(node.speed, node.interval.value), afterHz: pending.rate, status: 'PENDING', purpose: pending.purpose || 'POLLING', restores: pending.historyId || null };
      assertLegacyAuthority(pending.action === 'RESTORE');
      store.history.unshift(entry); save(directory, store); // durable evidence before the first native write
      try {
        assertLegacyAuthority(pending.action === 'RESTORE');
        await native('Change', { id: node.id, location: node.location, key: entry.key, before: entry.before, after: entry.after, rate: entry.afterHz, speed: node.speed, action: pending.action, driverHash: entry.driverHash });
        const verified = await readInventory(), after = verified.map.get(node.id);
        if (!after || after.interval?.value !== entry.after || after.interval.key !== entry.key || after.location !== node.location || digest(after.lowerFilters) !== entry.filtersHash || digest(verified.driver) !== digest(inventory.driver)) throw new Error('Configuration readback did not match. Review the retained recovery record.');
        entry.status = pending.action === 'RESTORE' ? 'RESTORED' : 'CONFIGURED';
        if (pending.historyId) store.history.find((item) => item.id === pending.historyId).status = 'RESTORED';
        save(directory, store);
         return { status: entry.status, historyId: entry.id, reconnectRequired: true, message: pending.purpose === 'TIER_ISOLATION' ? 'The 1 kHz safety interval was saved and read back. Reconnect this device, rescan, and confirm it before enabling the global 8 kHz tier.' : 'Polling override saved and read back. Reconnect this device, then test. This is not verification of USB polling or end-to-end latency.' };
      } catch (error) {
        entry.status = 'NEEDS_REVIEW';
        try { save(directory, store); } catch { /* The durable PENDING record remains the recovery boundary. */ }
        throw new Error(`Polling change needs review: ${error.message} The saved before/after record is retained; no driver was removed.`);
      }
      } finally { mutationBusy = false; }
    });
  }
  async function previewTier(deviceId, historyId) {
    if (testController) throw new Error('Finish or cancel the input test first.');
    assertLegacyAuthority(historyId !== undefined);
    if (typeof deviceId !== 'string' || !/^[a-f0-9]{64}$/.test(deviceId)) throw new Error('Select an exact connected input device for the tier review.');
    const observed = await readInventory(), store = readStore(directory);
    const inventory = { ...observed, driver: projectDriverRuntime(observed, store) };
    if (inventory.driver.restartState !== 'NONE' && (historyId === undefined || inventory.driver.tierHistoryId !== historyId)) throw new Error('Finish the pending global xHCI tier restart or recovery check first.');
    assertCurrentProcessAdministrator('input:xhci-tier', inventory.elevated, 'Administrator access is unavailable in this session; the packaged app requests it at launch.');
    if (!inventory.bootId) throw new Error('Windows boot-session evidence is unavailable. The shared tier will not be changed.');
    const variant = DRIVER_VARIANTS[inventory.driver.hash];
    const canonical = inventory.driver.patchLocations.servicesParameters;
    const legacy = inventory.driver.patchLocations.legacyControl;
    if (legacy.valueExists) throw new Error('A legacy PatchUSBXHCI override is present. Dialed will not create a second global value or guess which one should win.');
    if (canonical.valueExists && (canonical.kind !== 'DWord' || ![0, 1, 2, 3].includes(canonical.value))) throw new Error('The existing PatchUSBXHCI value is not one exact supported DWORD.');
    let action = 'ENABLE', afterPatch = { keyExists: true, valueExists: true, kind: 'DWord', value: TIER_TARGET }, restores = null;
    let beforeTier = inventory.driver.patchUsbXhci, afterTier = TIER_TARGET, targetName;
    if (historyId !== undefined) {
      const original = store.tierHistory.find((item) => item.id === historyId && item.targetDeviceId === deviceId);
      if (!original || !['PRESUMED_ACTIVE', 'SCOPE_DRIFT'].includes(original.status) || !samePatchLocation(canonical, original.afterPatch) || !samePatchLocation(legacy, original.legacyPatch) || inventory.driver.hash !== original.driverHash) throw new Error('A recoverable post-restart tier change for this exact driver and target is required before restore.');
      if (inventory.driver.signature !== 'ValidMicrosoft' || variant?.mode !== 'Patching' || ['Missing', 'Unrecognized'].includes(inventory.driver.state)) throw new Error('The exact Microsoft-valid HIDUSBF patching build is required to restore this saved tier.');
      action = 'RESTORE'; afterPatch = original.beforePatch; restores = original.id;
      afterTier = original.beforeTier; targetName = original.targetName;
    } else {
      if (inventory.security.memoryIntegrity !== 'Disabled') throw new Error(inventory.security.memoryIntegrity === 'Unknown'
        ? 'Memory Integrity status could not be verified. Dialed will not change the shared driver tier.'
        : 'Windows Memory Integrity is enabled or configured. Dialed will not weaken it or change this driver tier.');
      if (inventory.driver.state !== 'Running' || inventory.driver.signature !== 'ValidMicrosoft' || variant?.mode !== 'Patching') throw new Error('An exact reviewed, running Microsoft-valid HIDUSBF patching build is required.');
      if (inventory.driver.patchUsbXhci === TIER_TARGET) throw new Error('The configured 4–8 kHz xHCI tier is already present. No tier write is needed.');
      const target = buildDevices(inventory, store).find((item) => item.id === deviceId);
      const node = [...inventory.map.values()].find((item) => digest(item.id) === deviceId);
      if (!target || !node || target.speed !== 'High-Speed' || !target.filterActive || !target.routeComplete || target.problem !== 0 || target.configuredHz === null || !node.interval?.readable || node.interval.ambiguous || node.interval.kind !== 'DWord' || !node.location) throw new Error('Choose a healthy, directly identified High-Speed input device with an existing HIDUSBF interval.');
      const blockers = buildFilteredDevices(inventory).filter((item) => item.id !== deviceId && (item.wouldExceed1k || item.uncertainImpact));
      if (blockers.length) throw new Error(`Resolve ${blockers.length} other filtered device${blockers.length === 1 ? '' : 's'} before enabling the global 8 kHz tier. Dialed will not accelerate them silently.`);
      targetName = target.name;
    }
    if (store.tierHistory.length >= 50) throw new Error('Input tier history limit reached. No evidence has been discarded.');
    previews.clear();
    const filteredScope = filteredScopeSnapshot(inventory);
    const pending = tierPreviews.issue({
      action, afterPatch, restores, targetDeviceId: deviceId, targetName,
      beforePatch: canonical, legacyPatch: legacy, beforeTier, afterTier,
      driverHash: inventory.driver.hash, activeBefore: inventory.driver.activePatchUsbXhci,
      bootId: inventory.bootId, scopeHash: tierScopeDigest(inventory),
      filteredScope, filteredScopeHash: filteredScopeHash(filteredScope),
      storeHash: digest(store),
    });
    return {
      token: pending.token, action, targetDeviceId: deviceId, targetName,
      beforeTier, afterTier, expiresAt: new Date(pending.expiresAt).toISOString(),
      affectedDevices: buildFilteredDevices(inventory).map((item) => ({ id: item.id, name: item.name, speed: item.speed, configuredHz: item.configuredHz, isTarget: item.id === deviceId })),
    };
  }
  async function applyTier(token) {
    return serialize(async () => {
      mutationBusy = true;
      try {
        const pending = tierPreviews.take(token).preview;
        if (testController) throw new Error('Finish or cancel the input test first.');
        assertLegacyAuthority(pending.action === 'RESTORE');
        const observed = await readInventory(), store = readStore(directory);
        const inventory = { ...observed, driver: projectDriverRuntime(observed, store) };
        const restartStateAccepted = inventory.driver.restartState === 'NONE'
          || (pending.action === 'RESTORE' && inventory.driver.restartState === 'NEEDS_REVIEW' && inventory.driver.tierHistoryId === pending.restores);
        assertCurrentProcessAdministrator('input:xhci-tier', inventory.elevated, 'Administrator access is unavailable in this session; the packaged app requests it at launch.');
        if (!restartStateAccepted || digest(store) !== pending.storeHash || tierScopeDigest(inventory) !== pending.scopeHash || inventory.driver.hash !== pending.driverHash || !samePatchLocation(inventory.driver.patchLocations.servicesParameters, pending.beforePatch) || !samePatchLocation(inventory.driver.patchLocations.legacyControl, pending.legacyPatch)) throw new Error('Driver, filtered-device scope, boot session, security state, or history changed after preview. Nothing was written.');
        const entry = {
          id: crypto.randomUUID(), createdAt: new Date(now()).toISOString(), status: 'PENDING',
          action: pending.action, targetDeviceId: pending.targetDeviceId, targetName: pending.targetName,
          beforePatch: pending.beforePatch, afterPatch: pending.afterPatch, legacyPatch: pending.legacyPatch,
           beforeTier: pending.beforeTier, afterTier: pending.afterTier, activeBefore: pending.activeBefore,
           driverHash: pending.driverHash, bootId: pending.bootId, restores: pending.restores,
           filteredScope: pending.filteredScope, filteredScopeHash: pending.filteredScopeHash,
         };
        assertLegacyAuthority(pending.action === 'RESTORE');
        store.tierHistory.unshift(entry); save(directory, store);
        try {
          assertLegacyAuthority(pending.action === 'RESTORE');
          await native('TierChange', {
            action: pending.action, beforeCanonical: pending.beforePatch, afterCanonical: pending.afterPatch,
            legacyPatch: pending.legacyPatch, driverHash: pending.driverHash, expectedBootId: pending.bootId,
          });
          const verified = await readInventory();
          const verifiedState = pending.action === 'RESTORE'
            ? !['Missing', 'Unrecognized'].includes(verified.driver.state)
            : verified.driver.state === 'Running';
          if (verified.driver.hash !== pending.driverHash || !verifiedState || verified.driver.signature !== 'ValidMicrosoft' || !samePatchLocation(verified.driver.patchLocations.servicesParameters, pending.afterPatch) || !samePatchLocation(verified.driver.patchLocations.legacyControl, pending.legacyPatch)) throw new Error('Global tier readback did not match. Review the retained recovery record.');
          entry.status = pending.action === 'RESTORE' ? 'RESTORE_REBOOT_REQUIRED' : 'REBOOT_REQUIRED';
          save(directory, store);
          return {
            status: entry.status, historyId: entry.id, rebootRequired: true,
            message: pending.action === 'RESTORE'
              ? 'The prior global tier value was restored and read back. Restart Windows, then return to verify the restored driver session.'
              : 'The 4–8 kHz tier was configured and read back. Restart Windows, then return to verify the new driver session before requesting 8 kHz.',
          };
        } catch (error) {
          entry.status = 'NEEDS_REVIEW';
          try { save(directory, store); } catch { /* The durable PENDING record remains the recovery boundary. */ }
          throw new Error(`Global tier change needs review: ${error.message} The exact prior registry state is retained; no driver or filter was removed.`);
        }
      } finally { mutationBusy = false; }
    });
  }
  async function reconcileTier(historyId) {
    return serialize(async () => {
      const store = readStore(directory), entry = store.tierHistory.find((item) => item.id === historyId);
      if (!entry || !['PENDING', 'NEEDS_REVIEW', 'SCOPE_DRIFT', 'REBOOT_REQUIRED', 'RESTORE_REBOOT_REQUIRED'].includes(entry.status)) throw new Error('Choose a pending xHCI tier operation.');
      const observed = await readInventory();
      const variant = DRIVER_VARIANTS[observed.driver.hash];
      const exactDriver = observed.driver.hash === entry.driverHash
        && observed.driver.signature === 'ValidMicrosoft'
        && variant?.mode === 'Patching'
        && !['Missing', 'Unrecognized'].includes(observed.driver.state);
      if (!exactDriver || (entry.action === 'ENABLE' && observed.driver.state !== 'Running') || !samePatchLocation(observed.driver.patchLocations.legacyControl, entry.legacyPatch)) throw new Error('Driver identity, operating state, or legacy tier state changed. Automatic reconciliation is refused.');
      const current = observed.driver.patchLocations.servicesParameters;
      if (observed.bootId === entry.bootId) {
        if (samePatchLocation(current, entry.beforePatch)) entry.status = 'NOT_APPLIED';
        else if (samePatchLocation(current, entry.afterPatch)) entry.status = entry.action === 'RESTORE' ? 'RESTORE_REBOOT_REQUIRED' : 'REBOOT_REQUIRED';
        else throw new Error('An external global tier change was detected. Automatic reconciliation is refused.');
        save(directory, store);
        if (['REBOOT_REQUIRED', 'RESTORE_REBOOT_REQUIRED'].includes(entry.status)) throw new Error('The Registry value is present, but Windows has not restarted. Restart Windows before checking the presumed loaded driver tier.');
        return scan();
      }
      if (!observed.bootId || !entry.bootId) throw new Error('Windows boot-session evidence is unavailable. The presumed loaded-tier check is refused.');
      if (!samePatchLocation(current, entry.afterPatch)) throw new Error('The post-restart tier value does not match the saved operation. Automatic reconciliation is refused.');
      if (entry.action === 'ENABLE') {
        if (observed.security.memoryIntegrity !== 'Disabled') throw new Error('Memory Integrity state no longer matches the reviewed setup. Dialed will not weaken Windows security or mark the tier presumed active.');
        const inventory = { ...observed, driver: { ...observed.driver, restartState: 'NONE' } };
        const currentScope = filteredScopeSnapshot(inventory);
        if (!Array.isArray(entry.filteredScope) || !entry.filteredScopeHash || filteredScopeHash(entry.filteredScope) !== entry.filteredScopeHash) {
          entry.status = 'NEEDS_REVIEW'; save(directory, store);
          throw new Error('The saved filtered-device audit is missing or invalid. The presumed loaded-tier check is refused.');
        }
        if (filteredScopeHash(currentScope) !== entry.filteredScopeHash) {
          const detail = describeScopeDrift(entry.filteredScope, currentScope);
          entry.status = 'SCOPE_DRIFT'; entry.scopeDrift = detail; save(directory, store);
          throw new Error(`The filtered-device scope changed after restart: ${detail}. Review every affected device again.`);
        }
        const target = buildFilteredDevices(inventory).find((item) => item.id === entry.targetDeviceId);
        const blockers = buildFilteredDevices(inventory).filter((item) => item.id !== entry.targetDeviceId && (item.wouldExceed1k || item.uncertainImpact));
        if (!target || !target.isInput || target.speed !== 'High-Speed' || blockers.length) throw new Error('The post-restart filtered-device scope is not the reviewed isolated input-device state. The 8 kHz tier cannot be presumed active.');
        entry.status = 'PRESUMED_ACTIVE';
      } else {
        entry.status = 'RESTORED';
        const original = store.tierHistory.find((item) => item.id === entry.restores && item.targetDeviceId === entry.targetDeviceId);
        if (original) original.status = 'RESTORED';
      }
      save(directory, store);
      return scan();
    });
  }
  async function labelPort(deviceId, label) {
    return serialize(async () => {
      if (typeof label !== 'string' || label.length > 60 || /[\x00-\x1f\x7f]/.test(label)) throw new Error('Use a port label of at most 60 plain-text characters.');
      const inventory = await readInventory(), store = readStore(directory);
      const device = buildDevices(inventory, store).find((item) => item.id === deviceId);
      if (!device?.portId) throw new Error('Rescan a connected device with a Windows location path first.');
      if (!store.ports[device.portId] && Object.keys(store.ports).length >= 128) throw new Error('Port label limit reached.');
      store.ports[device.portId] = { label: label.trim() }; save(directory, store);
      return scan();
    });
  }
  async function test(deviceId) {
    if (adapters.nativeSetupActive?.()) throw new Error('Close native setup before starting the input check.');
    if (testController || mutationBusy) throw new Error('An input test or device change is already running.');
    const controller = new AbortController(); testController = controller;
    try {
      const inventory = await readInventory(), device = buildDevices(inventory).find((item) => item.id === deviceId);
      if (!device?.canTest) throw new Error('Connect a supported mouse, keyboard, or game controller.');
      const node = [...inventory.map.values()].find((item) => digest(item.id) === deviceId);
      const inputScope = (snapshot) => digest([...snapshot.map.values()].filter((item) => /^HID\\/.test(item.id) && trace(snapshot.map, item.id).nodes.some((ancestor) => ancestor.id === node.id)).sort((a, b) => a.id.localeCompare(b.id)));
      const beforeInputScope = inputScope(inventory);
      if (controller.signal.aborted) throw new Error('Input check canceled. Results were discarded.');
      const result = await native('Test', { id: node.id }, controller.signal);
      if (controller.signal.aborted) throw new Error('Input check canceled. Results were discarded.');
      const after = await readInventory();
      if (controller.signal.aborted) throw new Error('Input check canceled. Results were discarded.');
      if (!after.map.has(node.id) || digest(after.map.get(node.id)) !== digest(node) || inputScope(after) !== beforeInputScope) throw new Error('The device connection changed during the test. Results were discarded.');
      const channels = summarizeTiming(result, device.configuredHz);
      const controlActivity = summarizeActivity(result);
      return {
        capturedAt: new Date(now()).toISOString(), deviceId, channels,
        measurement: { unit: 'WINDOWS_RAW_INPUT_MESSAGES', controlActivity: result.activityVersion === 1 ? 'DECODED_CONTROL_CHANGES' : 'NOT_MEASURED' },
        controlActivity,
        configuredRequestHz: device.configuredHz,
        deliveryAssessment: assessObservedDelivery(channels, device.configuredHz),
        method: 'One explicit 8-second foreground Raw Input check, bound to the selected device. Focus loss, cancellation or selected-device connection change discards the result. Message cadence counts WM_INPUT messages, including idle messages and batched reports. Control activity separately decodes mouse/key transitions and standard HID buttons, axes and hats. Axes use at least 16 samples over 250 ms for a median baseline, extending to one second for sparse input. Movement must exceed the greater of 6% of the logical range or three times baseline noise across at least three reports and 20 ms; sparse input uses a fixed 6% fallback with partial coverage. Initial held states, repeated states, vendor data and small jitter do not establish activity. This is a threshold-based observation, not proof of intent, full button mapping, USB transactions or latency. Keyboard channels return counts and a total span without per-key timestamps. Only aggregates and non-keyboard message timing leave the capture process; key identities and raw reports are not saved.',
      };
    } finally { if (testController === controller) testController = null; }
  }
  async function reconcile(historyId) {
    return serialize(async () => {
      const store = readStore(directory), entry = store.history.find((item) => item.id === historyId);
      if (!entry || !['PENDING', 'NEEDS_REVIEW'].includes(entry.status)) throw new Error('Choose a pending input-device operation.');
      const inventory = await readInventory(), node = inventory.map.get(entry.nativeId);
      if (!node || digest(node.id) !== entry.deviceId || !node.present || node.problem !== 0 || node.location !== entry.location || digest(node.lowerFilters) !== entry.filtersHash || inventory.driver.hash !== entry.driverHash || !node.interval?.readable || node.interval.ambiguous || node.interval.key !== entry.key || node.interval.kind !== 'DWord') throw new Error('Device state cannot be reconciled safely. No history or device was changed.');
      if (node.interval.value === entry.before) entry.status = 'NOT_APPLIED';
      else if (node.interval.value === entry.after) {
        entry.status = entry.restores ? 'RESTORED' : 'CONFIGURED';
        if (entry.restores) { const original = store.history.find((item) => item.id === entry.restores && item.deviceId === entry.deviceId); if (original) original.status = 'RESTORED'; }
      } else throw new Error('An external polling change was detected. Automatic reconciliation is refused.');
      save(directory, store);
      return scan();
    });
  }
  return {
    scan, preview, previewIsolation, apply, previewTier, applyTier,
    labelPort, test, reconcile, reconcileTier,
    cancelTest: () => { testController?.abort(); return { canceled: Boolean(testController) }; },
    isBusy: () => mutationBusy || Boolean(testController),
  };
}

module.exports = {
  UPSTREAM, NOPATCH_SHA256, PATCHING_SHA256, PATCHING_1K_SHA256, PATCHING_2K_4K_SHA256, PATCHING_4K_8K_SHA256, NATIVE_INPUT_SOURCE_SHA256,
  RATES, FULL_SPEED_RATES, HIGH_SPEED_RATES, rateForInterval, intervalForRate,
  normalizeInventory, trace, buildDevices, buildFilteredDevices, filteredScopeSnapshot, filteredScopeHash, describeScopeDrift,
  summarizeTiming, summarizeActivity, assessObservedDelivery, readStore, writeStore, createInputService, loadNativeInputSource, createNativeBootstrap, runNative,
};
