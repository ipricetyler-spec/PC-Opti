const crypto = require('crypto');
const { runPowerShell } = require('../scanner/index.cjs');
const { REVIEWED_AT, REVIEW_AFTER, SOURCES, BOARDS, BOARD_MODELS, PROFILES } = require('./catalog.cjs');

// Fixed read-only query: no serials, identifiers, firmware API, SPD writes or reboot.
// CIM field definitions: https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-physicalmemory
const INVENTORY_SCRIPT = `
$ErrorActionPreference = 'Stop'
$errors = [System.Collections.Generic.List[string]]::new()
function Read-Cim($class) {
  try { @(Get-CimInstance -ClassName $class -OperationTimeoutSec 3 -ErrorAction Stop) }
  catch { $errors.Add($class + ' inventory unavailable.'); @() }
}
$cpu = @(Read-Cim 'Win32_Processor' | Select-Object -First 2 | ForEach-Object {
  @{ name = [string]$_.Name; manufacturer = [string]$_.Manufacturer; socket = [string]$_.SocketDesignation }
})
$board = @(Read-Cim 'Win32_BaseBoard' | Select-Object -First 1 | ForEach-Object {
  @{ manufacturer = [string]$_.Manufacturer; product = [string]$_.Product; revision = [string]$_.Version }
})
$bios = @(Read-Cim 'Win32_BIOS' | Select-Object -First 1 | ForEach-Object {
  @{ manufacturer = [string]$_.Manufacturer; version = [string]$_.SMBIOSBIOSVersion; date = if ($_.ReleaseDate) { $_.ReleaseDate.ToString('yyyy-MM-dd') } else { '' } }
})
$system = @((Read-Cim 'Win32_ComputerSystem') | Select-Object -First 1 | ForEach-Object {
  @{ manufacturer = [string]$_.Manufacturer; model = [string]$_.Model; pcSystemType = [int]$_.PCSystemType }
})
$chassis = @((Read-Cim 'Win32_SystemEnclosure') | ForEach-Object { $_.ChassisTypes })
$memory = @(((Read-Cim 'Win32_PhysicalMemory') | Select-Object -First 32) | ForEach-Object {
  @{ manufacturer = [string]$_.Manufacturer; partNumber = [string]$_.PartNumber; capacityBytes = [double]$_.Capacity; configuredSpeed = [int]$_.ConfiguredClockSpeed; memoryType = [int]$_.SMBIOSMemoryType; slot = [string]$_.DeviceLocator }
})
$gpus = @((Read-Cim 'Win32_VideoController') | Select-Object -First 8 | ForEach-Object { [string]$_.Name })
@{ cpu = $cpu; board = $board; bios = $bios; system = $system; chassis = $chassis; memory = $memory; gpus = $gpus; errors = @($errors) } | ConvertTo-Json -Depth 6 -Compress
`;

const list = (value) => Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : [];
const text = (value) => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 160) : '';
const known = (value) => {
  const result = text(value);
  return /^(unknown|default string|to be filled by o\.?e\.?m\.?|system product name|not applicable|n\/a|none)$/i.test(result) ? '' : result;
};
const number = (value, max) => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= max ? value : null;

function normalizeInventory(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) raw = {};
  const cpu = list(raw.cpu)[0] || {};
  const board = list(raw.board)[0] || {};
  const bios = list(raw.bios)[0] || {};
  const system = list(raw.system)[0] || {};
  return {
    cpu: { name: known(cpu.name), manufacturer: known(cpu.manufacturer), socket: known(cpu.socket), count: list(raw.cpu).length },
    board: { manufacturer: known(board.manufacturer), product: known(board.product), revision: known(board.revision) },
    bios: { manufacturer: known(bios.manufacturer), version: known(bios.version), date: known(bios.date) },
    system: { manufacturer: known(system.manufacturer), model: known(system.model), pcSystemType: number(system.pcSystemType, 8) },
    chassis: list(raw.chassis).filter((entry) => Number.isInteger(entry)).slice(0, 8),
    memory: list(raw.memory).slice(0, 32).filter((item) => item && typeof item === 'object').map((item) => ({
      manufacturer: known(item.manufacturer), partNumber: known(item.partNumber), slot: known(item.slot),
      capacityBytes: number(item.capacityBytes, 2 ** 50), configuredSpeed: number(item.configuredSpeed, 30000), memoryType: number(item.memoryType, 100),
    })),
    gpus: list(raw.gpus).map(known).filter(Boolean).slice(0, 8),
    errors: list(raw.errors).map(text).filter(Boolean).slice(0, 16),
  };
}

function boardVendor(manufacturer) {
  if (/\basus\b|asustek/i.test(manufacturer)) return 'asus';
  if (/\bmsi\b|micro-star/i.test(manufacturer)) return 'msi';
  if (/gigabyte/i.test(manufacturer)) return 'gigabyte';
  if (/asrock/i.test(manufacturer)) return 'asrock';
  return null;
}

function classifyHardware(hardware) {
  const cpu = hardware.cpu.name.replace(/\((?:R|TM)\)/gi, '');
  const board = hardware.board.product;
  const vendor = boardVendor(hardware.board.manufacturer);
  const mobile = hardware.system.pcSystemType === 2 || hardware.chassis.some((type) => [8, 9, 10, 11, 14, 30, 31, 32].includes(type))
    || /laptop|notebook|mobile|mini pc|NUC/i.test(`${hardware.system.model} ${cpu}`);
  const oem = /dell|alienware|hewlett|\bhp\b|lenovo|acer|microsoft|samsung|fujitsu|panasonic/i.test(hardware.system.manufacturer);
  const desktop = hardware.system.pcSystemType === 1 && !mobile && hardware.cpu.count === 1;
  let platform = null;
  // Both CPU family AND motherboard chipset must match. Unsupported/new names fail closed.
  if (/AMD Ryzen [3579] [35]\d{3}(?:X3D|XT|X|G|GT|GE|F)?\b/i.test(cpu) && /\b(?:A320|B350|X370|B450|X470|A520|B550|X570)(?:[MEI-]|\b)/i.test(board)) platform = 'am4';
  if (/AMD Ryzen [3579] [789]\d{3}(?:X3D|X|G|GE|F)?\b/i.test(cpu) && /\b(?:A620|B650|X670|B840|B850|X870)(?:[MEI-]|\b)/i.test(board)) platform = 'am5';
  const intel = cpu.match(/Intel\s+Core\s+i[3579][ -]+(12|13|14)\d{3}(?:K|KF|KS|F|T)?\b/i);
  if (intel && /\b(?:B660|B760|H670|H770|Z690|Z790)(?:[MEI-]|\b)/i.test(board)) platform = `intel-${intel[1]}`;
  if (/Intel\s+Core\s+Ultra\s+[579]\s+2\d{2}(?:K|KF|F|T)?\b/i.test(cpu) && /\b(?:B860|Z890)(?:[MEI-]|\b)/i.test(board)) platform = 'intel-ultra-200';
  // A desktop CPU inside a laptop/OEM enclosure is not a retail desktop board.
  const supported = desktop && !oem && vendor !== null && platform !== null;
  return { vendor, platform: supported ? platform : null, supported, reason: mobile ? 'Laptop / mobile firmware: use the system manufacturer’s model-specific guide.' : oem ? 'OEM system: retail motherboard tuning instructions are not assumed compatible.' : !desktop ? 'Desktop form factor or single-CPU inventory is unconfirmed.' : !vendor ? 'This motherboard vendor has no reviewed menu guidance yet.' : !platform ? 'This CPU and motherboard combination is outside the reviewed platform rules.' : 'CPU and board family matched. Exact board revision, firmware and kit compatibility still require confirmation.' };
}

const PREPARATION = [
  'Back up important files. If device encryption / BitLocker is enabled, make sure its recovery key is accessible on another device. Never paste that key into Dialed.',
  'Photograph current BIOS settings, including boot order and storage mode, and locate the exact board revision’s recovery instructions. A Windows restore point does not restore BIOS settings.',
  'Save this plan before rebooting. Change one recommendation at a time; keep Secure Boot, TPM, thermal protections and security features intact.',
];

function buildBiosPlan(raw, { now = new Date() } = {}) {
  const hardware = normalizeInventory(raw);
  const match = classifyHardware(hardware);
  const date = new Date(now);
  const catalogCurrent = Number.isFinite(date.getTime()) && date >= new Date(`${REVIEWED_AT}T00:00:00Z`) && date < new Date(`${REVIEW_AFTER}T00:00:00Z`);
  const reviewStatus = catalogCurrent ? 'CURRENT' : !Number.isFinite(date.getTime()) || date < new Date(`${REVIEWED_AT}T00:00:00Z`) ? 'CLOCK_UNCERTAIN' : 'REVIEW_DUE';
  // Keep notes across a profile/speed change; reset them for hardware or BIOS changes.
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
    cpu: hardware.cpu, board: hardware.board, bios: hardware.bios, system: hardware.system,
    memory: hardware.memory.map(({ configuredSpeed, ...identity }) => identity).sort((a, b) => `${a.slot}:${a.partNumber}`.localeCompare(`${b.slot}:${b.partNumber}`)),
    gpus: [...hardware.gpus].sort(),
  })).digest('hex').slice(0, 24);
  const board = match.supported ? BOARDS[match.vendor] : null;
  const model = board ? BOARD_MODELS.find((entry) => entry.vendor === match.vendor
    && entry.names.includes(hardware.board.product.toUpperCase().replace(/\s+/g, ' '))
    && (!entry.revisions || entry.revisions.includes(hardware.board.revision.replace(/^rev\.?\s*/i, '')))) : null;
  const warnings = [];
  if (!catalogCurrent) warnings.push('The catalog review is due or the system date is uncertain. These reference guides remain available; check current OEM documentation before making changes.');
  if (!hardware.bios.version) warnings.push('BIOS version is unavailable. Confirm it in firmware before following any recommendation.');
  if (hardware.memory.length > 2) warnings.push('More than two memory modules detected. Do not assume a two-DIMM profile is stable with this population.');
  if (new Set(hardware.memory.map((item) => `${item.partNumber}:${item.capacityBytes}`)).size > 1) warnings.push('Memory modules differ in part number or capacity. Confirm kit compatibility before memory overclocking.');
  if (hardware.memory.some((item) => !item.partNumber)) warnings.push('One or more RAM part numbers are unknown; compatibility cannot be established from memory speed.');

  const recommendations = !match.supported ? [] : PROFILES.filter((profile) => {
    if (!profile.platforms.includes(match.platform)) return false;
    if (profile.cpuModel && !new RegExp(`\\bAMD Ryzen 7 ${profile.cpuModel}\\b`, 'i').test(hardware.cpu.name.replace(/\((?:R|TM)\)/gi, ''))) return false;
    if (profile.kind === 'memory') return hardware.memory.length > 0 && hardware.memory.every((item) => profile.memoryType === 'ddr4-or-ddr5' ? [26, 34].includes(item.memoryType) : item.memoryType === profile.memoryType);
    if (profile.gpuVendor === 'nvidia') return hardware.gpus.some((gpu) => /\b(?:GeForce\s+)?RTX\s*[345]0\d{2}\b/i.test(gpu) && !/laptop/i.test(gpu));
    if (profile.gpuVendor === 'amd') return hardware.gpus.some((gpu) => /\bRadeon\s+RX\s*[5679]\d{3}\b/i.test(gpu)) && (match.platform === 'am5' || /\b(?:A520|B550|X570)(?:[MEI-]|\b)/i.test(hardware.board.product)) && !/\b(?:3200G|3400G)\b/i.test(hardware.cpu.name);
    if (profile.kind === 'advanced-cpu' && match.platform === 'am4') return /Ryzen [3579] 5\d{3}/i.test(hardware.cpu.name);
    return true;
  }).map((profile) => ({
    id: profile.id, title: profile.title, risk: profile.risk, advanced: profile.advanced,
    status: 'CHECK_COMPATIBILITY', currentState: 'Not read from BIOS',
    matchReason: `${hardware.cpu.name} + ${hardware.board.product}${profile.kind === 'memory' ? ` + ${hardware.memory.length} detected DDR${hardware.memory[0].memoryType === 34 ? '5' : '4'} module(s)` : profile.gpuVendor ? ` + ${profile.gpuVendor === 'nvidia' ? 'GeForce RTX' : 'Radeon RX'} GPU candidate` : ''}. This is family-level guidance, not a tested exact-combination preset.`,
    target: profile.target, benefit: profile.benefit, tradeoff: profile.tradeoff,
    checks: [...profile.checks, 'Confirm all control names and prerequisites in the exact model / revision manual before changing a setting.'],
    steps: [...profile.steps], verify: profile.verify, undo: profile.undo,
    menuHint: profile.kind === 'memory' ? board.memoryMenu : 'Locate these controls in the exact board manual; their position can change with BIOS version.',
    sources: [...new Set([...profile.sourceIds, ...(profile.kind === 'memory' ? board.sourceIds : [])])].map((id) => ({ ...SOURCES[id], reviewedAt: SOURCES[id].reviewedAt || REVIEWED_AT })).concat(model ? [{ title: model.title, url: model.url, reviewedAt: REVIEWED_AT }] : []),
  }));
  if (match.supported && !recommendations.some((item) => /memory|expo|xmp/.test(item.id))) warnings.push('Memory type or module inventory has no matching profile rule; no memory setting is inferred.');
  return {
    schemaVersion: '1.0.0', catalogVersion: '2026.09.05', reviewedAt: REVIEWED_AT, reviewAfter: REVIEW_AFTER,
    generatedAt: Number.isFinite(date.getTime()) ? date.toISOString() : null, fingerprint,
    hardware, match: { ...match, boardName: board?.name || null, supportUrl: model?.url || board?.supportUrl || null, supportMatch: model ? 'MODEL' : board ? 'VENDOR' : null },
    status: !match.supported ? 'NO_REVIEWED_MATCH' : 'GUIDANCE_AVAILABLE', reviewStatus,
    preparation: [...PREPARATION], preparationSources: [{ ...SOURCES.recovery, reviewedAt: REVIEWED_AT }], warnings,
    limitations: 'Local inventory does not read active EXPO/XMP, CPU offsets, Resizable BAR, boot mode, encryption status or cooling limits. Recommendations are manual candidates, not a diagnosis or proof that a change is needed. No hardware data is sent to an AI service.',
    recommendations,
  };
}

async function readBiosPlan({ platform = process.platform, run = runPowerShell, now } = {}) {
  if (platform !== 'win32') return buildBiosPlan({ errors: ['Native Windows inventory is unavailable on this platform.'] }, { now });
  try {
    const { stdout } = await run(INVENTORY_SCRIPT, 30000);
    if (typeof stdout !== 'string' || stdout.length > 128 * 1024) throw new Error('Inventory response is invalid.');
    const raw = JSON.parse(stdout.replace(/^\uFEFF/, ''));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Inventory response is invalid.');
    return buildBiosPlan(raw, { now });
  } catch {
    return buildBiosPlan({ errors: ['Hardware inventory failed or timed out. Retry the read-only scan; no BIOS settings were changed.'] }, { now });
  }
}

module.exports = { INVENTORY_SCRIPT, normalizeInventory, classifyHardware, buildBiosPlan, readBiosPlan };
