// Read-only native release-policy scope collection. This invokes only the pinned
// Input Devices Scan path plus read-only OS/Code Integrity/driver observations.
// It never launches the broker/host or performs a device, Registry or service write.
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runNative, NATIVE_INPUT_SOURCE_SHA256 } = require('../src/main/input-devices/index.cjs');

const ROOT = path.resolve(__dirname, '..');
const DIGEST = /^[a-f0-9]{64}$/;
const PRODUCT = /^[0-9A-F]{4}:[0-9A-F]{4}$/;
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
// Match System.Text.Json's default JavaScriptEncoder for the ASCII Windows identity
// preimages used by LifecycleSession.Digest. Hex escapes are uppercase by contract.
function systemTextJson(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(systemTextJson).join(',')}]`;
  if (typeof value === 'object') return `{${Object.entries(value).map(([key, child]) => `${systemTextJson(key)}:${systemTextJson(child)}`).join(',')}}`;
  if (typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value);
  if (typeof value !== 'string') throw new Error('Unsupported native digest preimage value.');
  let encoded = '"';
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index), character = value[index];
    if (character === '"') encoded += '\\u0022';
    else if (character === '\\') encoded += '\\\\';
    else if (character === '\b') encoded += '\\b';
    else if (character === '\t') encoded += '\\t';
    else if (character === '\n') encoded += '\\n';
    else if (character === '\f') encoded += '\\f';
    else if (character === '\r') encoded += '\\r';
    else if (code < 0x20 || code > 0x7e || "&'+<>`".includes(character)) encoded += `\\u${code.toString(16).toUpperCase().padStart(4, '0')}`;
    else encoded += character;
  }
  return `${encoded}"`;
}
const digest = (value) => sha256(Buffer.from(systemTextJson(value), 'utf8'));

function parseArguments(argv) {
  const options = { devices: [] };
  for (let index = 0; index < argv.length; index++) {
    const name = argv[index];
    const value = argv[++index];
    if (!value || !['--machine', '--device', '--output'].includes(name)) throw new Error('Use --machine, repeated --device VID:PID, and --output.');
    if (name === '--device') options.devices.push(value.toUpperCase());
    else if (options[name.slice(2)]) throw new Error('Duplicate scope option refused.');
    else options[name.slice(2)] = value;
  }
  if (!options.machine || !options.output || options.devices.length < 1 || options.devices.length > 16) throw new Error('Machine, one or more selected devices, and output are required.');
  if (!options.devices.every((value) => PRODUCT.test(value)) || new Set(options.devices).size !== options.devices.length) throw new Error('Selected devices must be distinct exact uppercase VID:PID identities.');
  if (!path.isAbsolute(options.output) || fs.existsSync(options.output) || !fs.statSync(path.dirname(options.output)).isDirectory()) throw new Error('Output must be a new absolute file with an existing parent.');
  return options;
}

function readPlatformInfo() {
  const source = String.raw`
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DialedReadOnlyCodeIntegrity {
  [StructLayout(LayoutKind.Sequential)] public struct CiInformation { public uint Length; public uint Options; }
  [DllImport("ntdll.dll")] static extern int NtQuerySystemInformation(int information, ref CiInformation value, int size, out int returned);
  public static uint ReadOptions() {
    var value = new CiInformation { Length = 8 };
    int returned;
    if (NtQuerySystemInformation(103, ref value, 8, out returned) != 0 || returned != 8) throw new InvalidOperationException("Code Integrity state unavailable.");
    return value.Options;
  }
}
'@
$secureKey=[Microsoft.Win32.Registry]::LocalMachine.OpenSubKey('SYSTEM\CurrentControlSet\Control\SecureBoot\State',$false)
try { $secure=$secureKey.GetValue('UEFISecureBootEnabled',$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } finally { if($secureKey){$secureKey.Dispose()} }
function Hash-SystemDriver([string]$name) {
  $file=[IO.Path]::Combine([Environment]::GetFolderPath([Environment+SpecialFolder]::Windows),'System32\drivers',$name)
  if(-not [IO.File]::Exists($file)){ return $null }
  if((Get-Item -LiteralPath $file).Attributes -band [IO.FileAttributes]::ReparsePoint){ throw 'Linked system driver refused.' }
  $stream=[IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
  $hasher=[Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($hasher.ComputeHash($stream))).Replace('-','').ToLowerInvariant() }
  finally { $hasher.Dispose(); $stream.Dispose() }
}
[pscustomobject]@{
  machine=[Environment]::MachineName
  os=[Environment]::OSVersion.Version.ToString()
  codeIntegrityOptions=[DialedReadOnlyCodeIntegrity]::ReadOptions()
  secureBoot=$secure
  usbXhci=(Hash-SystemDriver 'USBXHCI.SYS')
  usbPort=(Hash-SystemDriver 'USBPORT.SYS')
} | ConvertTo-Json -Compress
`;
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const encoded = Buffer.from(source, 'utf16le').toString('base64');
  const result = childProcess.spawnSync(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    encoding: 'utf8', windowsHide: true, timeout: 30000,
  });
  if (result.error || result.status !== 0) throw new Error(`Read-only platform observation failed (${result.status ?? 'start'}): ${String(result.stderr || result.error?.message || '').replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 800)}`);
  const value = JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim());
  if (!value || typeof value.machine !== 'string' || typeof value.os !== 'string' || !Number.isInteger(value.codeIntegrityOptions) ||
      ![0, 1].includes(value.secureBoot) || !DIGEST.test(value.usbXhci) || (value.usbPort !== null && !DIGEST.test(value.usbPort))) {
    throw new Error('Read-only platform observation was incomplete.');
  }
  return value;
}

function descendants(nodes, rootId, inputMembersOnly = false) {
  const scope = new Set([rootId.toUpperCase()]);
  for (let pass = 0; pass < nodes.length; pass++) {
    const children = nodes.filter((node) => scope.has(node.parent.toUpperCase()) && !scope.has(node.id.toUpperCase()) &&
      (!inputMembersOnly || !(/^USB\\VID_/i.test(node.id) && !/&MI_/i.test(node.id))));
    if (!children.length) break;
    for (const child of children) scope.add(child.id.toUpperCase());
  }
  return scope;
}

function buildScopeEvidence(scan, platform, selectedProducts) {
  if (!scan || !Array.isArray(scan.nodes) || scan.nodes.length < 1 || scan.nodes.length > 4096) throw new Error('Input inventory is incomplete.');
  const nodes = scan.nodes.map((node) => ({ ...node, id: String(node.id || ''), parent: String(node.parent || ''), location: String(node.location || ''), name: String(node.name || '') }));
  const byId = new Map();
  for (const node of nodes) {
    if (!/^(?:USB|HID|PCI)\\/.test(node.id) || byId.has(node.id.toUpperCase())) throw new Error('Input inventory contains an ambiguous identity.');
    byId.set(node.id.toUpperCase(), node);
  }
  const scopes = [];
  for (const node of nodes) {
    const product = node.id.match(/^USB\\VID_([0-9A-F]{4})&PID_([0-9A-F]{4})(?:&[^\\]*)?\\/i);
    if (!product || /&MI_/i.test(node.id)) continue;
    const memberIds = descendants(nodes, node.id);
    const inputMemberIds = descendants(nodes, node.id, true);
    const inputKinds = [...new Set(nodes.filter((entry) => inputMemberIds.has(entry.id.toUpperCase())).map((entry) => entry.inputKind).filter((kind) => ['MOUSE', 'GAMEPAD', 'JOYSTICK', 'KEYBOARD'].includes(kind)))].sort();
    const speed = node.speed === 1 ? 'FULL' : node.speed === 2 ? 'HIGH' : 'UNKNOWN';
    const preimage = {
      Device: node.id.toUpperCase(),
      Parent: node.parent,
      Location: node.location,
      Speed: speed,
      Children: [...memberIds].map((value) => value.toUpperCase()).sort(),
    };
    const productId = `${product[1].toUpperCase()}:${product[2].toUpperCase()}`;
    const eligible = node.present === true && node.problem === 0 && ['FULL', 'HIGH'].includes(speed) && inputKinds.length > 0;
    scopes.push({
      productId, name: node.name || 'USB scope', instanceId: node.id, parent: node.parent,
      location: node.location, speed, present: node.present === true, problem: node.problem,
      inputKinds, eligible, selected: selectedProducts.includes(productId),
      deviceIdDigest: digest(node.id.toUpperCase()), interfaceDigest: digest(preimage), preimage,
    });
  }
  scopes.sort((left, right) => left.productId.localeCompare(right.productId) || left.instanceId.localeCompare(right.instanceId));
  const selected = scopes.filter((scope) => scope.selected);
  for (const productId of selectedProducts) {
    const matches = selected.filter((scope) => scope.productId === productId);
    if (matches.length !== 1) throw new Error(`Selected ${productId} must resolve to exactly one physical USB scope.`);
    if (!matches[0].eligible) throw new Error(`Selected ${productId} is not an eligible present Full/High-Speed input scope.`);
  }
  const eligible = scopes.filter((scope) => scope.eligible);
  const platformPreimage = {
    Os: platform.os,
    Options: platform.codeIntegrityOptions,
    SecureBoot: platform.secureBoot,
    UsbXhci: platform.usbXhci,
    UsbPort: platform.usbPort,
    Scopes: eligible.map((scope) => scope.interfaceDigest).sort(),
  };
  return {
    machine: platform.machine,
    platformDigest: digest(platformPreimage),
    platformPreimage,
    selectedDevices: selected,
    authorizedDeviceDigests: selected.map((scope) => scope.interfaceDigest).sort(),
    eligibleInputScopes: eligible.map((scope) => ({
      productId: scope.productId, name: scope.name, instanceId: scope.instanceId, speed: scope.speed,
      inputKinds: scope.inputKinds, selected: scope.selected, interfaceDigest: scope.interfaceDigest,
      preimage: scope.preimage,
    })),
  };
}

function stableContract(value) {
  return JSON.stringify({
    machine: value.machine,
    platformDigest: value.platformDigest,
    platformPreimage: value.platformPreimage,
    selected: value.selectedDevices.map((device) => ({ productId: device.productId, instanceId: device.instanceId, interfaceDigest: device.interfaceDigest, preimage: device.preimage })),
    authorizedDeviceDigests: value.authorizedDeviceDigests,
    eligibleInputScopes: value.eligibleInputScopes,
  });
}

async function collect(options, dependencies = {}) {
  const scan = dependencies.scan || (() => runNative('Scan'));
  const platform = dependencies.platform || readPlatformInfo;
  const first = buildScopeEvidence(await scan(), platform(), options.devices);
  const second = buildScopeEvidence(await scan(), platform(), options.devices);
  if (first.machine.toUpperCase() !== options.machine.toUpperCase() || second.machine.toUpperCase() !== options.machine.toUpperCase()) throw new Error('Observed machine does not match the selected validation PC.');
  if (stableContract(first) !== stableContract(second)) throw new Error('Platform or device scope changed between read-only observations.');
  return {
    schemaVersion: 1,
    status: 'READ_ONLY_VALIDATION_SCOPE_REVIEWED',
    observedAt: new Date().toISOString(),
    machine: first.machine,
    selectedProducts: [...options.devices],
    platformDigest: first.platformDigest,
    acceptedPlatformDigests: [first.platformDigest],
    authorizedDeviceDigests: first.authorizedDeviceDigests,
    platformPreimage: first.platformPreimage,
    selectedDevices: first.selectedDevices,
    eligibleInputScopes: first.eligibleInputScopes,
    observationCount: 2,
    nativeInputSourceSha256: NATIVE_INPUT_SOURCE_SHA256,
    collectorSha256: sha256(fs.readFileSync(__filename)),
    readOnly: true,
    deviceOperationsAuthorized: false,
    physicalAcceptance: false,
    compatibilityClaim: 'This scope is limited to the selected validation round and is not a general supported-device list.',
  };
}

async function main(argv) {
  const options = parseArguments(argv);
  const evidence = await collect(options);
  fs.writeFileSync(options.output, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ status: evidence.status, machine: evidence.machine, platformDigest: evidence.platformDigest, authorizedDeviceDigests: evidence.authorizedDeviceDigests, selectedProducts: evidence.selectedProducts, output: options.output }));
}

if (require.main === module) main(process.argv.slice(2)).catch(() => {
  console.error('Native policy scope collection refused. No device or Windows setting was changed.');
  process.exitCode = 1;
});

module.exports = { buildScopeEvidence, collect, parseArguments, readPlatformInfo, stableContract, systemTextJson };
