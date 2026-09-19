const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { INVENTORY_SCRIPT, buildBiosPlan, readBiosPlan } = require('../src/main/bios-guidance/index.cjs');
const { PROFILES, SOURCES } = require('../src/main/bios-guidance/catalog.cjs');
const { requireCapability, listCapabilities } = require('../src/main/capabilities/index.cjs');
const NOW = new Date('2026-08-27T12:00:00Z');

function fixture(overrides = {}) {
  return {
    cpu: [{ name: 'AMD Ryzen 7 9800X3D 8-Core Processor', manufacturer: 'AuthenticAMD', socket: 'AM5' }],
    board: [{ manufacturer: 'Micro-Star International Co., Ltd.', product: 'MAG X670E TOMAHAWK WIFI (MS-7E12)', revision: '1.0' }],
    bios: [{ version: 'fixture-1', date: '2026-08-01' }],
    system: [{ manufacturer: 'Micro-Star International Co., Ltd.', model: 'MS-7E12', pcSystemType: 1 }],
    chassis: [3],
    memory: [0, 1].map((index) => ({ partNumber: 'FIXTURE-DDR5-KIT', capacityBytes: 16 * 2 ** 30, configuredSpeed: 4800, memoryType: 34, slot: `DIMM${index}` })),
    gpus: ['NVIDIA GeForce RTX 4080'], errors: [], ...overrides,
  };
}
const build = (value) => buildBiosPlan(value, { now: NOW });
const ids = (plan) => plan.recommendations.map((item) => item.id);

test('AM5 X3D plan matches CPU + board + DDR5 + GPU without claiming BIOS settings were read', () => {
  const plan = build(fixture());
  assert.equal(plan.status, 'GUIDANCE_AVAILABLE');
  assert.equal(plan.match.platform, 'am5');
  assert.deepEqual(ids(plan), ['am5-expo', 'amd-stock-boost', 'nvidia-rebar', 'amd-curve-review', 'cooling-baseline', 'thermal-9800x3d', 'stock-scheduling', 'pcie-link-check']);
  assert.ok(plan.recommendations.every((item) => item.currentState === 'Not read from BIOS' && item.status === 'CHECK_COMPATIBILITY'));
  assert.equal(plan.recommendations.find((item) => item.id === 'amd-curve-review').advanced, true);
});

for (const [manufacturer, vendor] of [['ASUSTeK COMPUTER INC.', 'asus'], ['Micro-Star International Co., Ltd.', 'msi'], ['Gigabyte Technology Co., Ltd.', 'gigabyte'], ['ASRock', 'asrock']]) {
  test(`reviewed board vendor alias ${manufacturer} receives source-linked menu hints`, () => {
    const plan = build(fixture({ board: [{ manufacturer, product: 'B650M TEST', revision: '1.0' }] }));
    assert.equal(plan.match.vendor, vendor);
    assert.ok(plan.recommendations[0].menuHint.length > 30);
    assert.ok(plan.match.supportUrl.startsWith('https://'));
  });
}

for (const [cpu, product, platform] of [
  ['Intel(R) Core(TM) i7-12700K', 'PRO Z690-A', 'intel-12'],
  ['13th Gen Intel(R) Core(TM) i9-13900K', 'ROG STRIX Z790-E GAMING WIFI', 'intel-13'],
  ['Intel Core i7-14700KF', 'MAG B760 TOMAHAWK WIFI', 'intel-14'],
  ['Intel(R) Core(TM) Ultra 9 285K', 'Z890 Taichi', 'intel-ultra-200'],
]) {
  test(`${platform} uses XMP and only affected generations get Intel stability baseline`, () => {
    const plan = build(fixture({ cpu: [{ name: cpu }], board: [{ manufacturer: 'ASRock', product }] }));
    assert.equal(plan.match.platform, platform);
    assert.ok(ids(plan).includes('intel-xmp'));
    assert.equal(ids(plan).includes('intel-stability-baseline'), ['intel-13', 'intel-14'].includes(platform));
    assert.ok(!ids(plan).includes('am5-expo'));
  });
}

test('AM4 + DDR4 + Radeon uses AM4 memory and SAM, not AM5 EXPO', () => {
  const plan = build(fixture({ cpu: [{ name: 'AMD Ryzen 7 5800X3D' }], board: [{ manufacturer: 'ASUS', product: 'TUF GAMING B550-PLUS' }], memory: [{ memoryType: 26, partNumber: 'DDR4' }], gpus: ['AMD Radeon RX 6800 XT'] }));
  assert.deepEqual(ids(plan), ['am4-memory-profile', 'amd-stock-boost', 'amd-sam', 'amd-curve-review', 'cooling-baseline', 'stock-scheduling', 'pcie-link-check']);
});

test('SAM excludes unreviewed older chipsets and excluded 3400G CPU', () => {
  for (const [name, product] of [['AMD Ryzen 5 3400G', 'B550M TEST'], ['AMD Ryzen 7 5800X', 'B450M TEST']]) {
    const plan = build(fixture({ cpu: [{ name }], board: [{ manufacturer: 'ASUS', product }], gpus: ['AMD Radeon RX 6600'] }));
    assert.ok(!ids(plan).includes('amd-sam'));
  }
});

test('thermal specifications match exact CPU models without spreading an X3D temperature rule', () => {
  for (const [model, expected] of [['7800X3D', 89], ['9800X3D', 95], ['9850X3D', null], ['9800X3D2', null], ['7800X', null]]) {
    const plan = build(fixture({ cpu: [{ name: `AMD Ryzen 7 ${model} 8-Core Processor` }] }));
    const thermal = plan.recommendations.filter((item) => item.id.startsWith('thermal-'));
    assert.equal(thermal.length, expected === null ? 0 : 1);
    if (expected !== null) {
      assert.match(thermal[0].target, new RegExp(`${expected}°C`));
      assert.match(thermal[0].target, /not a recommended new BIOS setting/);
      assert.equal(thermal[0].currentState, 'Not read from BIOS');
    }
  }
});

for (const [name, override] of [
  ['laptop using desktop CPU name', { chassis: [10] }],
  ['unknown form factor', { system: [{}], chassis: [] }],
  ['OEM system with a retail-looking board', { system: [{ manufacturer: 'Dell Inc.', pcSystemType: 1 }] }],
  ['unknown board', { board: [{ manufacturer: 'Unknown', product: 'B650' }] }],
  ['unknown CPU', { cpu: [{ name: 'Unknown CPU' }] }],
  ['impossible AM5 CPU and AM4 board', { board: [{ manufacturer: 'ASUS', product: 'B550M TEST' }] }],
  ['mobile AMD CPU in desktop chassis', { cpu: [{ name: 'AMD Ryzen 7 7840HS' }] }],
  ['multiple CPUs', { cpu: [{ name: 'AMD Ryzen 7 9800X3D' }, { name: 'AMD Ryzen 7 9800X3D' }] }],
]) {
  test(`${name}: no retail desktop tuning preset`, () => {
    const plan = build(fixture(override));
    assert.equal(plan.status, 'NO_REVIEWED_MATCH');
    assert.equal(plan.recommendations.length, 0);
    assert.equal(plan.match.supportUrl, null);
  });
}

test('missing, wrong and inconsistent memory type never produces an inferred memory profile', () => {
  for (const memory of [[], [{}], [{ memoryType: 26 }], [{ memoryType: 34 }, { memoryType: 26 }]]) {
    const plan = build(fixture({ memory }));
    assert.ok(!ids(plan).includes('am5-expo'));
    assert.ok(plan.warnings.some((warning) => /no matching profile rule/.test(warning)));
  }
});

test('mixed / four-DIMM population is explicitly conditional, not automatically approved', () => {
  const plan = build(fixture({ memory: Array.from({ length: 4 }, (_, i) => ({ memoryType: 34, partNumber: `KIT-${i % 2}`, capacityBytes: (i % 2 + 1) * 2 ** 30 })) }));
  assert.ok(plan.warnings.some((warning) => /More than two/.test(warning)));
  assert.ok(plan.warnings.some((warning) => /differ/.test(warning)));
  assert.match(plan.recommendations[0].checks.join(' '), /module count/);
});

test('no detection of current EXPO from fast reported memory speed or unsupported GPU models', () => {
  const raw = fixture({ gpus: ['NVIDIA GeForce GTX 1080', 'Microsoft Basic Display Adapter'] });
  raw.memory.forEach((item) => { item.configuredSpeed = 6000; });
  const plan = build(raw);
  assert.ok(!ids(plan).includes('nvidia-rebar'));
  assert.equal(plan.recommendations[0].currentState, 'Not read from BIOS');
});

test('notes identity survives a speed change but resets for BIOS / hardware changes', () => {
  const first = fixture();
  const faster = fixture();
  faster.memory[0].configuredSpeed = 6000;
  assert.equal(build(first).fingerprint, build(faster).fingerprint);
  assert.notEqual(build(first).fingerprint, build(fixture({ bios: [{ version: 'fixture-2' }] })).fingerprint);
  assert.notEqual(build(first).fingerprint, build(fixture({ gpus: ['AMD Radeon RX 7900 XTX'] })).fingerprint);
});

test('overdue source review or an uncertain clock is explicit without deleting useful reference guides', () => {
  for (const now of ['2027-02-23T00:00:00Z', 'bad-date', '2025-01-01']) {
    const plan = buildBiosPlan(fixture(), { now });
    assert.equal(plan.status, 'GUIDANCE_AVAILABLE');
    assert.ok(plan.recommendations.length > 0);
    assert.notEqual(plan.reviewStatus, 'CURRENT');
    assert.match(plan.warnings.join(' '), /check current OEM documentation/);
  }
});

test('partial inventory preserves evidence and explicit unknowns without leaking serials', () => {
  const raw = fixture({ bios: [], errors: ['Win32_BIOS inventory unavailable.'] });
  raw.cpu[0].serialNumber = 'DO-NOT-RETURN';
  raw.memory[0].configuredSpeed = -1;
  const plan = build(raw);
  assert.equal(plan.hardware.memory[0].configuredSpeed, null);
  assert.ok(plan.warnings.some((warning) => /BIOS version/.test(warning)));
  assert.ok(plan.hardware.errors.length === 1);
  assert.ok(!JSON.stringify(plan).includes('DO-NOT-RETURN'));
  assert.equal(build(null).recommendations.length, 0);
});

test('read-only collector is fixed, bounded and uses no supplied execution payload', async () => {
  let calls = 0;
  const plan = await readBiosPlan({ platform: 'win32', now: NOW, run: async (script, timeout) => {
    calls += 1;
    assert.equal(script, INVENTORY_SCRIPT);
    assert.equal(timeout, 30000);
    return { stdout: JSON.stringify(fixture()) };
  } });
  assert.equal(calls, 1);
  assert.equal(plan.status, 'GUIDANCE_AVAILABLE');
  assert.doesNotMatch(INVENTORY_SCRIPT, /Set-|Remove-|Restart-|Invoke-|SerialNumber|IdentifyingNumber|SetFirmware|bcdedit|reagentc/i);
});

test('non-Windows, malformed, empty, excessive and failed reads return no recommendations', async () => {
  const nonWindows = await readBiosPlan({ platform: 'linux', now: NOW, run: () => { throw new Error('must not run'); } });
  assert.equal(nonWindows.recommendations.length, 0);
  for (const stdout of ['', 'broken', 'null', '[]', 'x'.repeat(128 * 1024 + 1)]) {
    const plan = await readBiosPlan({ platform: 'win32', now: NOW, run: async () => ({ stdout }) });
    assert.equal(plan.recommendations.length, 0);
    assert.equal(plan.hardware.errors.length, 1);
  }
  const failed = await readBiosPlan({ platform: 'win32', now: NOW, run: async () => { throw new Error('SECRET provider failure'); } });
  assert.ok(!JSON.stringify(failed).includes('SECRET'));
});

test('all recipes have first-party citations, prerequisites, tradeoffs and manual recovery', () => {
  assert.equal(new Set(PROFILES.map((profile) => profile.id)).size, PROFILES.length);
  assert.equal(PROFILES.length, 13);
  for (const profile of PROFILES) {
    for (const field of ['title', 'target', 'benefit', 'tradeoff', 'verify', 'undo']) assert.ok(profile[field].length > 12);
    assert.ok(profile.checks.length && profile.steps.length && profile.sourceIds.length);
    for (const id of profile.sourceIds) {
      assert.ok(SOURCES[id]);
      const url = new URL(SOURCES[id].url);
      assert.equal(url.protocol, 'https:');
      assert.ok(['amd.com', 'intel.com', 'asus.com', 'msi.com', 'gigabyte.com', 'asrock.com', 'nvidia.custhelp.com', 'learn.microsoft.com'].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`)));
    }
  }
});

test('all profiles retain BIOS guide; IPC cannot apply or reboot and Optimize categories remain available', () => {
  for (const profile of ['public', 'consumer-premium', 'owner']) assert.equal(requireCapability('bios:hardware-guidance', profile).safetyClass, 'S4');
  assert.equal(listCapabilities('public').length, listCapabilities('owner').length);
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  assert.match(read('electron/preload.cjs'), /readBiosPlan: \(\) => ipcRenderer.invoke\('pc-opti:read-bios-plan'\)/);
  assert.match(read('electron/main.cjs'), /assertCapabilityAvailable\('bios:hardware-guidance'\)/);
  const appSource = read('src/App.tsx');
  assert.match(appSource, /\['recommended', 'Recommended'\].*\['bios', 'BIOS'\]/s);
  assert.match(appSource, /activeTab === 'startup' && optimizeView === 'startup'.*<StartupCenter/s);
  assert.match(appSource, /activeTab === 'startup' && optimizeView === 'bios'.*<BiosGuidanceCenter/s);
  assert.doesNotMatch(read('src/components/BiosGuidanceCenter.tsx'), /executeMaintenance|executeTiming|restartComputer|applyBios/i);
});

test('local notes and portable plan retain recovery, sources and unverified status', async () => {
  const { parseBiosNotes, formatBiosPlan } = await import('../src/lib/biosPlan.js');
  const notes = parseBiosNotes(JSON.stringify({ 'am5-expo': { status: 'Tested by me', previousValue: 'Auto' }, unknown: { status: 'Already set' } }), ['am5-expo']);
  assert.deepEqual(Object.keys(notes), ['am5-expo']);
  assert.deepEqual(parseBiosNotes('broken', []), {});
  assert.equal(parseBiosNotes('{"x":{"status":"Applied automatically","previousValue":123}}', ['x']).x.status, 'Not reviewed');
  const exported = formatBiosPlan(build(fixture()), notes);
  for (const expected of ['User notes are not independently verified', 'Your previous-setting notes: Auto', 'Recovery:', 'BitLocker', 'Source (reviewed', 'Not read from BIOS']) assert.ok(exported.includes(expected));
});

test('exact model support links require the right vendor, suffix and known revision', () => {
  assert.equal(build(fixture()).match.supportMatch, 'MODEL');
  for (const revision of ['1.0', 'Rev 1.1', '1.2']) {
    const plan = build(fixture({ board: [{ manufacturer: 'Gigabyte', product: 'B650 AORUS ELITE AX', revision }] }));
    assert.equal(plan.match.supportMatch, 'MODEL');
  }
  for (const [product, revision] of [['B650 AORUS ELITE AX', '1.x'], ['B650 AORUS ELITE AX V2', '1.0']]) {
    assert.equal(build(fixture({ board: [{ manufacturer: 'Gigabyte', product, revision }] })).match.supportMatch, 'VENDOR');
  }
});

test('returned plan edits cannot change the reviewed catalog for later callers', () => {
  const plan = build(fixture());
  plan.recommendations[0].steps[0] = 'Modified caller data';
  plan.preparation[0] = 'Modified preparation';
  assert.notEqual(build(fixture()).recommendations[0].steps[0], 'Modified caller data');
  assert.notEqual(build(fixture()).preparation[0], 'Modified preparation');
  assert.ok(Object.isFrozen(PROFILES[0].steps));
});
