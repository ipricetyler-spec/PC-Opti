const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, afterEach } = require('node:test');

const input = require('../src/main/input-devices/index.cjs');

const roots = [];
afterEach(() => { while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true }); });
const clone = (value) => JSON.parse(JSON.stringify(value));

function node(id, parent, overrides = {}) {
  return {
    id, parent, name: overrides.name || id.split('\\')[0], service: '', className: '', location: '',
    compatibleIds: [], hardwareIds: [], lowerFilters: [], problem: 0, present: true,
    interval: null, speed: -1, port: -1, inputKind: '', ...overrides,
  };
}

function inventory(overrides = {}) {
  const pci = 'PCI\\VEN_1022&DEV_15B6&SUBSYS_00000000\\ROOT';
  const hub = 'USB\\ROOT_HUB30\\HUB';
  const physical = overrides.physicalId || 'USB\\VID_1234&PID_5678\\ONE';
  const hid = overrides.hidId || 'HID\\VID_1234&PID_5678\\INPUT';
  const nodes = [
    node(pci, '', { name: 'AMD integrated USB controller' }),
    node(hub, pci, { name: 'USB Root Hub', service: 'USBHUB3', compatibleIds: ['USB\\CLASS_09'] }),
    node(physical, hub, {
      name: overrides.name || 'Fixture Mouse', location: overrides.location || 'PCIROOT(0)#USBROOT(1)#USB(2)',
      lowerFilters: overrides.filtered === false ? [] : ['hidusbf'], speed: overrides.speed ?? 1, port: 2,
      interval: overrides.interval || { key: 'Driver', kind: 'DWord', value: overrides.value ?? 8, readable: true, ambiguous: false },
    }),
    node(hid, physical, { name: overrides.name || 'Fixture Mouse', className: 'Mouse', service: 'mouhid', inputKind: overrides.inputKind || 'MOUSE' }),
  ];
  const driver = clone(overrides.driver || { state: 'Running', hash: input.NOPATCH_SHA256, signature: 'ValidMicrosoft', mode: 'NoPatch' });
  driver.patchLocations ||= {
    servicesParameters: { keyExists: false, valueExists: false, kind: '', value: null },
    legacyControl: { keyExists: false, valueExists: false, kind: '', value: null },
  };
  return {
    nodes: overrides.nodes || nodes,
    driver,
    elevated: overrides.elevated ?? true,
    bootId: overrides.bootId || '2026-08-30T12:00:00.0000000Z',
    security: { memoryIntegrity: overrides.memoryIntegrity || 'Disabled' },
  };
}

function harness(options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dialed-input-fixture-'));
  roots.push(directory);
  let current = inventory(options), changes = 0, tierChanges = 0, heldTest;
  const native = async (mode, payload, signal) => {
    if (mode === 'Scan') return clone(current);
    if (mode === 'Change') {
      changes += 1;
      if (options.failBefore) throw new Error('fixture write refused');
      const target = current.nodes.find((item) => item.id === payload.id);
      assert.equal(target.interval.value, payload.before);
      target.interval.value = payload.after;
      if (options.failAfter) throw new Error('fixture readback interrupted');
      return { status: 'CONFIGURED' };
    }
    if (mode === 'TierChange') {
      tierChanges += 1;
      if (options.failTierBefore) throw new Error('fixture tier write refused');
      assert.equal(payload.expectedBootId, current.bootId);
      assert.deepEqual(current.driver.patchLocations.servicesParameters, payload.beforeCanonical);
      assert.deepEqual(current.driver.patchLocations.legacyControl, payload.legacyPatch);
      current.driver.patchLocations.servicesParameters = clone(payload.afterCanonical);
      const defaults = {
        [input.PATCHING_1K_SHA256]: 1,
        [input.PATCHING_2K_4K_SHA256]: 2,
        [input.PATCHING_4K_8K_SHA256]: 3,
      };
      current.driver.patchUsbXhci = payload.afterCanonical.valueExists ? payload.afterCanonical.value : defaults[current.driver.hash];
      current.driver.patchSource = payload.afterCanonical.valueExists ? 'Registry override' : 'Driver default';
      if (options.failTierAfter) throw new Error('fixture tier readback interrupted');
      return { status: 'CONFIGURED', rebootRequired: true };
    }
    if (mode === 'Test') {
      if (options.holdTest) return new Promise((resolve, reject) => {
        heldTest = { resolve, reject };
        signal.addEventListener('abort', () => reject(new Error('Input test canceled. No settings were changed.')), { once: true });
      });
      return options.testResult || { channels: [{ timesMs: Array.from({ length: 50 }, (_, i) => i * 2) }] };
    }
    throw new Error('unexpected fixture mode');
  };
  const service = input.createInputService(directory, { native, now: options.now, save: options.save, allowLegacyNewWrites: () => options.allowLegacyNewWrites !== false, nativeSetupActive: () => options.nativeSetupActive === true, legacyRestoreAuthority: () => options.nativeHistory ? { allowed: false, message: 'Native machine history blocks legacy restore.' } : { allowed: true, message: '' } });
  return { directory, service, current, get changes() { return changes; }, get tierChanges() { return tierChanges; }, get heldTest() { return heldTest; } };
}

test('native source loader accepts only the pinned ASAR or development bytes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dialed-input-source-'));
  roots.push(root);
  const moduleDirectory = path.join(root, 'module');
  fs.mkdirSync(moduleDirectory, { recursive: true });
  const sourcePath = path.join(moduleDirectory, 'usb-native.cs');
  const trustedBytes = fs.readFileSync(path.join(__dirname, '../src/main/input-devices/usb-native.cs'));
  fs.writeFileSync(sourcePath, trustedBytes);
  const loaded = input.loadNativeInputSource({ moduleDirectory });
  assert.equal(loaded.sourcePath, sourcePath);
  assert.equal(loaded.sha256, input.NATIVE_INPUT_SOURCE_SHA256);
  assert.deepEqual(loaded.bytes, trustedBytes);
  fs.appendFileSync(sourcePath, '\n// tampered', 'utf8');
  assert.throws(() => input.loadNativeInputSource({ moduleDirectory }), /failed its integrity check/);
  fs.rmSync(sourcePath);
  assert.throws(() => input.loadNativeInputSource({ moduleDirectory }), /missing from this package/);
});

test('native bootstrap uses ASCII stdin instead of command arguments, paths, or environment payloads', () => {
  const inputSource = input.loadNativeInputSource();
  const bootstrap = input.createNativeBootstrap('TierChange', { scope: 'x'.repeat(32_768) }, inputSource);
  assert.ok(bootstrap.length > 32_768);
  assert.doesNotMatch(bootstrap, /[^\x00-\x7f]/);
  assert.doesNotMatch(bootstrap, /usb-native\.cs|DialedInputSource='|Add-Type -Path/);
  assert.match(bootstrap, /DialedInputSourceBase64/);
  assert.match(bootstrap, /DialedNativeScriptBase64/);
});

test('topology groups only real Raw Input parents and keeps identical physical instances separate', () => {
  const one = inventory();
  const physical2 = 'USB\\VID_1234&PID_5678\\TWO';
  one.nodes.push(
    node(physical2, 'USB\\ROOT_HUB30\\HUB', { name: 'Fixture Mouse', location: 'PCIROOT(0)#USBROOT(1)#USB(3)', speed: 1, port: 3, lowerFilters: ['hidusbf'], interval: { key: 'Driver', kind: 'DWord', value: 8, readable: true, ambiguous: false } }),
    node('HID\\VID_1234&PID_5678\\INPUT2', physical2, { name: 'Fixture Mouse', className: 'Mouse', inputKind: 'MOUSE' }),
    node('USB\\VID_0B05&PID_19AF\\LIGHTS', 'USB\\ROOT_HUB30\\HUB', { name: 'LED Controller', location: 'PCIROOT(0)#USBROOT(1)#USB(4)', speed: 1 }),
    node('HID\\VID_0B05&PID_19AF\\VENDOR', 'USB\\VID_0B05&PID_19AF\\LIGHTS', { name: 'vendor-defined device', className: 'HIDClass' }),
  );
  const devices = input.buildDevices(input.normalizeInventory(one));
  assert.equal(devices.length, 2);
  assert.equal(new Set(devices.map((item) => item.id)).size, 2);
  assert.equal(devices.every((item) => item.name === 'Fixture Mouse'), true);
  assert.equal(devices.every((item) => item.hubs === 0 && item.connection === 'CPU'), true);
  assert.equal(devices.every((item) => item.canTest && item.testKinds.join(',') === 'MOUSE'), true);
});

test('keyboard channels are testable without confusing a composite keyboard for movement-only input', () => {
  const raw = inventory();
  const physical = raw.nodes.find((item) => item.id.startsWith('USB\\VID_'));
  physical.name = 'Fixture TKL Keyboard';
  raw.nodes.push(node('HID\\VID_1234&PID_5678\\KEYBOARD', physical.id, {
    name: 'Fixture TKL Keyboard', className: 'Keyboard', service: 'kbdhid', inputKind: 'KEYBOARD',
  }));
  const device = input.buildDevices(input.normalizeInventory(raw))[0];
  assert.equal(device.canTest, true);
  assert.deepEqual(device.testKinds, ['MOUSE', 'KEYBOARD']);
});

test('unknown and incomplete controller routes remain honest', () => {
  const raw = inventory();
  const physical = raw.nodes.find((item) => item.id.startsWith('USB\\VID_'));
  physical.parent = 'USB\\MISSING\\PARENT';
  let device = input.buildDevices(input.normalizeInventory(raw))[0];
  assert.equal(device.routeComplete, false);
  assert.equal(device.hubs, null);
  assert.equal(device.connection, 'UNKNOWN');
  assert.match(device.eligibilityReason, /could not be traced/);

  const cyclic = inventory();
  cyclic.nodes.find((item) => item.id.startsWith('USB\\ROOT_HUB')).parent = cyclic.nodes.find((item) => item.id.startsWith('USB\\ROOT_HUB')).id;
  device = input.buildDevices(input.normalizeInventory(cyclic))[0];
  assert.equal(device.routeComplete, false);
});

test('polling eligibility accepts reviewed patching build and refuses unknown driver, speed, ambiguity, filter and standard user', () => {
  const reviewedPatching = inventory({ driver: { state: 'Running', hash: input.PATCHING_SHA256, signature: 'ValidMicrosoft', mode: 'Patching' } });
  assert.equal(input.buildDevices(input.normalizeInventory(reviewedPatching))[0].canApply, true);
  const cases = [
    [inventory({ driver: { state: 'Running', hash: '81f649b3'.padEnd(64, '0'), signature: 'ValidMicrosoft', mode: 'Unknown' } }), /exact verified, running HIDUSBF/],
    [inventory({ speed: -1 }), /confirmed USB Full-Speed or High-Speed/],
    [inventory({ interval: { key: 'Driver', kind: 'DWord', value: 8, readable: true, ambiguous: true } }), /unambiguously/],
    [inventory({ filtered: false }), /not configured/],
    [inventory({ elevated: false }), /administrator/],
  ];
  for (const [raw, expected] of cases) {
    const device = input.buildDevices(input.normalizeInventory(raw))[0];
    assert.equal(device.canApply, false);
    assert.match(device.eligibilityReason, expected);
  }
});

test('speed-specific interval mapping and exact signed patch tiers gate High-Speed requests', async () => {
  assert.equal(input.rateForInterval(1, 1), 1000);
  assert.equal(input.rateForInterval(2, 1), 8000);
  assert.equal(input.intervalForRate(1, 1000), 1);
  assert.equal(input.intervalForRate(2, 8000), 1);
  assert.equal(input.intervalForRate(1, 8000), null);

  const oneKilohertz = harness({
    speed: 2,
    value: 1,
    driver: { state: 'Running', hash: input.PATCHING_1K_SHA256, signature: 'ValidMicrosoft', mode: 'Patching' },
  });
  let scan = await oneKilohertz.service.scan();
  let device = scan.devices[0];
  assert.equal(device.speed, 'High-Speed');
  assert.equal(device.configuredHz, 8000);
  assert.equal(device.maxSupportedHz, 1000);
  assert.deepEqual(device.rates, [1000]);
  await assert.rejects(oneKilohertz.service.preview(device.id, 8000), /installed driver tier/);
  const reduce = await oneKilohertz.service.preview(device.id, 1000);
  assert.equal(reduce.beforeHz, 8000);
  await oneKilohertz.service.apply(reduce.token);
  assert.equal(oneKilohertz.current.nodes.find((item) => item.id.startsWith('USB\\VID_')).interval.value, 4);
  scan = await oneKilohertz.service.scan();
  const restore = await oneKilohertz.service.preview(device.id, 1000, scan.history[0].id);
  assert.equal(restore.action, 'RESTORE');
  assert.equal(restore.afterHz, 8000);
  await oneKilohertz.service.apply(restore.token);
  assert.equal(oneKilohertz.current.nodes.find((item) => item.id.startsWith('USB\\VID_')).interval.value, 1);

  const eightKilohertz = harness({
    speed: 2,
    value: 4,
    driver: { state: 'Running', hash: input.PATCHING_4K_8K_SHA256, signature: 'ValidMicrosoft', mode: 'Patching' },
  });
  scan = await eightKilohertz.service.scan();
  device = scan.devices[0];
  assert.equal(scan.driver.tier, '4–8 kHz patch tier');
  assert.equal(scan.driver.maxHighSpeedHz, 8000);
  assert.deepEqual(device.rates, [1000, 2000, 4000, 8000]);
  const raise = await eightKilohertz.service.preview(device.id, 8000);
  await eightKilohertz.service.apply(raise.token);
  assert.equal(eightKilohertz.current.nodes.find((item) => item.id.startsWith('USB\\VID_')).interval.value, 1);

  const registryOverride = inventory({
    speed: 2,
    value: 4,
    driver: { state: 'Running', hash: input.PATCHING_1K_SHA256, signature: 'ValidMicrosoft', mode: 'Patching', patchUsbXhci: 3, patchSource: 'Registry override' },
  });
  assert.deepEqual(input.buildDevices(input.normalizeInventory(registryOverride))[0].rates, [1000, 2000, 4000, 8000]);
  const ambiguousOverride = inventory({
    speed: 2,
    value: 4,
    driver: { state: 'Running', hash: input.PATCHING_4K_8K_SHA256, signature: 'ValidMicrosoft', mode: 'Patching', patchUsbXhci: -1, patchSource: 'Ambiguous registry override' },
  });
  assert.match(input.buildDevices(input.normalizeInventory(ambiguousOverride))[0].eligibilityReason, /unambiguous xHCI capability/);
});

test('apply records recovery before write, verifies readback, and restores the exact prior value', async () => {
  const h = harness();
  let scan = await h.service.scan();
  const device = scan.devices[0];
  const preview = await h.service.preview(device.id, 1000);
  assert.equal(preview.beforeHz, 125);
  const applied = await h.service.apply(preview.token);
  assert.equal(applied.status, 'CONFIGURED');
  assert.equal(h.current.nodes.find((item) => item.id.startsWith('USB\\VID_')).interval.value, 1);
  scan = await h.service.scan();
  assert.equal(scan.history[0].status, 'CONFIGURED');

  const restore = await h.service.preview(device.id, 125, scan.history[0].id);
  assert.equal(restore.action, 'RESTORE');
  assert.equal((await h.service.apply(restore.token)).status, 'RESTORED');
  assert.equal(h.current.nodes.find((item) => item.id.startsWith('USB\\VID_')).interval.value, 8);
  assert.equal((await h.service.scan()).history.every((item) => item.status === 'RESTORED'), true);
});

test('preview tokens are single-use, expire, and refuse state drift', async () => {
  let now = 1_000;
  const h = harness({ now: () => now });
  const device = (await h.service.scan()).devices[0];
  const expired = await h.service.preview(device.id, 1000);
  now += 120_001;
  await assert.rejects(h.service.apply(expired.token), /expired/);
  assert.equal(h.changes, 0);

  const fresh = await h.service.preview(device.id, 1000);
  h.current.nodes.find((item) => item.id.startsWith('USB\\VID_')).location += '#MOVED';
  await assert.rejects(h.service.apply(fresh.token), /changed after preview/);
  await assert.rejects(h.service.apply(fresh.token), /expired/);
  assert.equal(h.changes, 0);
});

test('a failed pre-write metadata save prevents the native write', async () => {
  const h = harness({ save: () => { throw new Error('disk unavailable'); } });
  const device = (await h.service.scan()).devices[0];
  const preview = await h.service.preview(device.id, 1000);
  await assert.rejects(h.service.apply(preview.token), /disk unavailable/);
  assert.equal(h.changes, 0);
});

for (const [label, options, expected] of [
  ['before a write', { failBefore: true }, 'NOT_APPLIED'],
  ['after a write', { failAfter: true }, 'CONFIGURED'],
]) test(`interrupted operation ${label} retains evidence and reconciles observed state`, async () => {
  const h = harness(options);
  const device = (await h.service.scan()).devices[0];
  const preview = await h.service.preview(device.id, 1000);
  await assert.rejects(h.service.apply(preview.token), /needs review/);
  let history = (await h.service.scan()).history;
  assert.equal(history[0].status, 'NEEDS_REVIEW');
  await h.service.reconcile(history[0].id);
  history = (await h.service.scan()).history;
  assert.equal(history[0].status, expected);
});

test('reconciliation refuses an unrelated external interval', async () => {
  const h = harness({ failBefore: true });
  const device = (await h.service.scan()).devices[0];
  const preview = await h.service.preview(device.id, 1000);
  await assert.rejects(h.service.apply(preview.token));
  const pending = (await h.service.scan()).history[0];
  h.current.nodes.find((item) => item.id.startsWith('USB\\VID_')).interval.value = 4;
  await assert.rejects(h.service.reconcile(pending.id), /external polling change/);
  assert.equal((await h.service.scan()).history[0].status, 'NEEDS_REVIEW');
});

test('global 8 kHz tier audit includes non-input filtered devices and requires 1 kHz isolation first', async () => {
  const h = harness({
    speed: 2,
    value: 1,
    driver: { state: 'Running', hash: input.PATCHING_1K_SHA256, signature: 'ValidMicrosoft', mode: 'Patching' },
  });
  const hub = 'USB\\ROOT_HUB30\\HUB';
  const headsetId = 'USB\\VID_9999&PID_0001\\HEADSET';
  h.current.nodes.push(node(headsetId, hub, {
    name: 'Fixture Composite Headset', location: 'PCIROOT(0)#USBROOT(1)#USB(5)',
    lowerFilters: ['hidusbf'], speed: 2, port: 5,
    interval: { key: 'Driver', kind: 'DWord', value: 1, readable: true, ambiguous: false },
  }));
  let scan = await h.service.scan();
  const target = scan.devices[0];
  const headset = scan.filteredDevices.find((item) => item.name === 'Fixture Composite Headset');
  assert.equal(scan.filteredDevices.length, 2);
  assert.equal(headset.isInput, false);
  assert.equal(headset.wouldExceed1k, true);
  await assert.rejects(h.service.previewTier(target.id), /Resolve 1 other filtered device/);

  const isolation = await h.service.previewIsolation(headset.id);
  assert.equal(isolation.action, 'ISOLATE');
  assert.equal(isolation.afterHz, 1000);
  await h.service.apply(isolation.token);
  assert.equal(h.current.nodes.find((item) => item.id === headsetId).interval.value, 4);
  scan = await h.service.scan();
  assert.equal(scan.filteredDevices.find((item) => item.id === headset.id).wouldExceed1k, false);
  const tier = await h.service.previewTier(target.id);
  assert.equal(tier.action, 'ENABLE');
  assert.equal(tier.affectedDevices.length, 2);
});

test('global tier audit resolves child/interface filter attachments and blocks an unmapped attachment', () => {
  const raw = inventory({
    filtered: false, speed: 2, value: 4,
    driver: { state: 'Running', hash: input.PATCHING_1K_SHA256, signature: 'ValidMicrosoft', mode: 'Patching' },
  });
  const physical = raw.nodes.find((item) => /^USB\\VID_/.test(item.id));
  const hid = raw.nodes.find((item) => /^HID\\/.test(item.id));
  hid.lowerFilters = ['hidusbf'];
  raw.nodes.push(node('HID\\VID_9999&PID_0001\\ORPHAN', 'USB\\MISSING\\PARENT', { name: 'Unmapped filter attachment', lowerFilters: ['hidusbf'], inputKind: '' }));
  const filtered = input.buildFilteredDevices(input.normalizeInventory(raw));
  const resolved = filtered.find((item) => item.id === input.buildDevices(input.normalizeInventory(raw))[0].id);
  assert.equal(resolved.scopeResolved, true);
  assert.equal(resolved.filterDirect, false);
  assert.equal(resolved.attachmentCount, 1);
  assert.equal(resolved.uncertainImpact, true);
  assert.match(resolved.safetyReason, /attached below/);
  const unresolved = filtered.find((item) => item.name === 'Unmapped filter attachment');
  assert.equal(unresolved.scopeResolved, false);
  assert.equal(unresolved.uncertainImpact, true);
  assert.match(unresolved.safetyReason, /could not be mapped/);
  assert.equal(physical.lowerFilters.length, 0);
});

test('global tier apply separates configured and presumed-loaded state across reboot, then restores exact absence', async () => {
  const options = {
    speed: 2,
    value: 1,
    driver: { state: 'Running', hash: input.PATCHING_1K_SHA256, signature: 'ValidMicrosoft', mode: 'Patching' },
  };
  const h = harness(options);
  let scan = await h.service.scan();
  const target = scan.devices[0];
  const preview = await h.service.previewTier(target.id);
  assert.equal(preview.beforeTier, 1);
  assert.equal(preview.afterTier, 3);
  const applied = await h.service.applyTier(preview.token);
  assert.equal(applied.status, 'REBOOT_REQUIRED');
  assert.equal(h.tierChanges, 1);
  scan = await h.service.scan();
  assert.equal(scan.driver.patchUsbXhci, 3);
  assert.equal(scan.driver.activePatchUsbXhci, 1);
  assert.equal(scan.driver.maxHighSpeedHz, 1000);
  assert.equal(scan.driver.restartState, 'REBOOT_REQUIRED');
  await assert.rejects(h.service.reconcileTier(applied.historyId), /has not restarted/);

  h.current.bootId = '2026-08-30T13:00:00.0000000Z';
  await h.service.reconcileTier(applied.historyId);
  scan = await h.service.scan();
  assert.equal(scan.driver.activePatchUsbXhci, 3);
  assert.equal(scan.driver.maxHighSpeedHz, 8000);
  assert.equal(scan.tierHistory.find((item) => item.id === applied.historyId).status, 'PRESUMED_ACTIVE');

  h.current.security.memoryIntegrity = 'Enabled';
  h.current.driver.state = 'Stopped';
  const restore = await h.service.previewTier(target.id, applied.historyId);
  assert.equal(restore.action, 'RESTORE');
  options.nativeHistory = true;
  await assert.rejects(h.service.applyTier(restore.token), /Native machine history/);
  assert.equal(h.tierChanges, 1);
  options.nativeHistory = false;
  const restoring = await h.service.applyTier((await h.service.previewTier(target.id, applied.historyId)).token);
  assert.equal(restoring.status, 'RESTORE_REBOOT_REQUIRED');
  scan = await h.service.scan();
  assert.equal(scan.driver.patchUsbXhci, 1);
  assert.equal(scan.driver.activePatchUsbXhci, 3);
  assert.equal(h.current.driver.patchLocations.servicesParameters.valueExists, false);

  h.current.bootId = '2026-08-30T14:00:00.0000000Z';
  await h.service.reconcileTier(restoring.historyId);
  scan = await h.service.scan();
  assert.equal(scan.driver.activePatchUsbXhci, 1);
  assert.equal(scan.tierHistory.every((item) => item.status === 'RESTORED'), true);
});

test('post-restart tier verification refuses and records filtered-scope drift', async () => {
  const h = harness({
    speed: 2,
    value: 1,
    driver: { state: 'Running', hash: input.PATCHING_1K_SHA256, signature: 'ValidMicrosoft', mode: 'Patching' },
  });
  const target = (await h.service.scan()).devices[0];
  const preview = await h.service.previewTier(target.id);
  const applied = await h.service.applyTier(preview.token);
  h.current.bootId = '2026-08-30T13:30:00.0000000Z';
  h.current.nodes = h.current.nodes.filter((item) => !item.id.startsWith('HID\\'));
  await assert.rejects(h.service.reconcileTier(applied.historyId), /filtered-device scope changed/);
  const drifted = (await h.service.scan()).tierHistory[0];
  assert.equal(drifted.status, 'SCOPE_DRIFT');
  assert.match(drifted.scopeDrift, /changed/);
});

test('scope drift after restart remains exactly recoverable instead of stranding the global tier', async () => {
  const h = harness({
    speed: 2, value: 1,
    driver: { state: 'Running', hash: input.PATCHING_1K_SHA256, signature: 'ValidMicrosoft', mode: 'Patching' },
  });
  const target = (await h.service.scan()).devices[0];
  const preview = await h.service.previewTier(target.id);
  const applied = await h.service.applyTier(preview.token);
  h.current.bootId = '2026-08-30T13:45:00.0000000Z';
  h.current.nodes.push(node('USB\\VID_9999&PID_0002\\ADDED', 'USB\\ROOT_HUB30\\HUB', {
    name: 'New filtered device', location: 'PCIROOT(0)#USBROOT(1)#USB(7)',
    lowerFilters: ['hidusbf'], speed: 1, port: 7,
    interval: { key: 'Driver', kind: 'DWord', value: 1, readable: true, ambiguous: false },
  }));
  await assert.rejects(h.service.reconcileTier(applied.historyId), /was added/);
  let scan = await h.service.scan();
  assert.equal(scan.tierHistory.find((item) => item.id === applied.historyId).status, 'SCOPE_DRIFT');
  const restore = await h.service.previewTier(target.id, applied.historyId);
  const restoring = await h.service.applyTier(restore.token);
  assert.equal(restoring.status, 'RESTORE_REBOOT_REQUIRED');
  h.current.bootId = '2026-08-30T14:45:00.0000000Z';
  await h.service.reconcileTier(restoring.historyId);
  scan = await h.service.scan();
  assert.equal(scan.tierHistory.every((item) => item.status === 'RESTORED'), true);
});

test('global tier setup fails closed on Windows protection, legacy override and scope drift', async () => {
  const protectedHost = harness({
    speed: 2, value: 4, memoryIntegrity: 'Enabled',
    driver: { state: 'Running', hash: input.PATCHING_1K_SHA256, signature: 'ValidMicrosoft', mode: 'Patching' },
  });
  let target = (await protectedHost.service.scan()).devices[0];
  await assert.rejects(protectedHost.service.previewTier(target.id), /will not weaken/);
  assert.equal(protectedHost.tierChanges, 0);

  const legacyHost = harness({
    speed: 2, value: 4,
    driver: {
      state: 'Running', hash: input.PATCHING_1K_SHA256, signature: 'ValidMicrosoft', mode: 'Patching',
      patchUsbXhci: 1, patchSource: 'Registry override',
      patchLocations: {
        servicesParameters: { keyExists: false, valueExists: false, kind: '', value: null },
        legacyControl: { keyExists: true, valueExists: true, kind: 'DWord', value: 1 },
      },
    },
  });
  target = (await legacyHost.service.scan()).devices[0];
  await assert.rejects(legacyHost.service.previewTier(target.id), /legacy PatchUSBXHCI/);

  const drift = harness({
    speed: 2, value: 4,
    driver: { state: 'Running', hash: input.PATCHING_1K_SHA256, signature: 'ValidMicrosoft', mode: 'Patching' },
  });
  target = (await drift.service.scan()).devices[0];
  const preview = await drift.service.previewTier(target.id);
  drift.current.nodes.find((item) => item.id.startsWith('USB\\VID_')).name = 'Changed device scope';
  await assert.rejects(drift.service.applyTier(preview.token), /changed after preview/);
  assert.equal(drift.tierChanges, 0);
});

test('timing summary validates bounds, separates channels, and requires enough messages', () => {
  const summary = input.summarizeTiming({ channels: [
    { kind: 'MOUSE', timesMs: Array.from({ length: 50 }, (_, i) => i * 2) },
    { kind: 'KEYBOARD', timesMs: [0, 8, 16] },
  ] });
  assert.equal(summary[0].eventHz, 500);
  assert.equal(summary[0].activeDurationMs, 98);
  assert.equal(summary[0].medianGapMs, 2);
  assert.equal(summary[0].kind, 'MOUSE');
  assert.equal(summary[1].kind, 'KEYBOARD');
  assert.equal(summary[1].eventHz, null);
  assert.throws(() => input.summarizeTiming({ channels: [{ timesMs: [2, 1] }] }), /timestamps/);
  assert.throws(() => input.summarizeTiming({ channels: Array.from({ length: 33 }, () => ({ timesMs: [] })) }), /Invalid/);
});

test('Windows message assessment compares cadence without claiming physical activity or USB proof', () => {
  const consistent = input.assessObservedDelivery([{ kind: 'GAMEPAD', samples: 8001, activeDurationMs: 1000, eventHz: 8000 }], 8000);
  assert.equal(consistent.status, 'INCONCLUSIVE');
  const sustained = input.assessObservedDelivery([{ kind: 'GAMEPAD', samples: 16001, activeDurationMs: 2000, eventHz: 8000 }], 8000);
  assert.equal(sustained.status, 'CONSISTENT_WITH_REQUEST');
  assert.match(sustained.message, /Windows messages\/s/);
  const below = input.assessObservedDelivery([{ kind: 'GAMEPAD', samples: 2001, activeDurationMs: 2000, eventHz: 1000 }], 8000);
  assert.equal(below.status, 'BELOW_REQUEST_OBSERVED');
  assert.equal(input.assessObservedDelivery([], 8000).status, 'INCONCLUSIVE');
  assert.equal(input.assessObservedDelivery([], null).status, 'NO_REQUEST');
});

test('an uninterrupted 4 kHz message stream cannot establish whether the controller was touched', async () => {
  // Timestamp-only data is identical whether the controller is idle or being used.
  // Do not invent an idle/moving label from this stream.
  const h = harness({
    speed: 2, value: 2, inputKind: 'GAMEPAD',
    testResult: { channels: [{ kind: 'GAMEPAD', timesMs: Array.from({ length: 32040 }, (_, i) => i * 1000 / 4005) }] },
  });
  const device = (await h.service.scan()).devices[0];
  const result = await h.service.test(device.id);
  assert.equal(result.configuredRequestHz, 4000);
  assert.equal(result.deliveryAssessment.observedHz, 4005);
  assert.equal(result.deliveryAssessment.status, 'CONSISTENT_WITH_REQUEST');
  assert.deepEqual(result.measurement, { unit: 'WINDOWS_RAW_INPUT_MESSAGES', controlActivity: 'NOT_MEASURED' });
  assert.match(result.controlActivity.message, /Control activity was not measured/);
  assert.doesNotMatch(result.deliveryAssessment.message, /activity (?:detected|observed)|verified|passed/i);
  assert.equal(h.changes + h.tierChanges, 0);
  assert.deepEqual(fs.readdirSync(h.directory), [], 'Read-only captures do not persist reports or histories.');
});

test('each capture is fresh: a stream followed by silence does not reuse the previous rate', async () => {
  const data = { channels: [{ kind: 'GAMEPAD', timesMs: Array.from({ length: 8001 }, (_, i) => i / 4) }] };
  const h = harness({ speed: 2, value: 2, inputKind: 'GAMEPAD', testResult: data });
  const device = (await h.service.scan()).devices[0];
  assert.equal((await h.service.test(device.id)).deliveryAssessment.observedHz, 4000);
  data.channels = [];
  const silent = await h.service.test(device.id);
  assert.equal(silent.deliveryAssessment.observedHz, null);
  assert.equal(silent.deliveryAssessment.status, 'INCONCLUSIVE');
  assert.match(silent.deliveryAssessment.message, /No Windows messages were received from this device/);
  assert.equal(silent.measurement.controlActivity, 'NOT_MEASURED');
});

test('silence, short bursts and an unknown request never establish physical inactivity', () => {
  for (const request of [null, 4000]) {
    const result = input.assessObservedDelivery([{ samples: 0, activeDurationMs: 0, eventHz: null }], request);
    assert.match(result.message, /No Windows messages were received from this device/);
    assert.doesNotMatch(result.message, /no input|inactive|not touched/i);
  }
  const short = input.assessObservedDelivery([{ kind: 'GAMEPAD', samples: 4000, activeDurationMs: 999.75, eventHz: 4000 }], 4000);
  assert.equal(short.status, 'INCONCLUSIVE');
  assert.equal(short.observedHz, null);
  assert.match(short.message, /Not enough sustained Windows messages/);
});

test('production legacy path refuses new requests, isolation, tier enable and stale preview tokens', async () => {
  const options = { allowLegacyNewWrites: false };
  const h = harness(options); const device = (await h.service.scan()).devices[0];
  for (const operation of [() => h.service.preview(device.id, 1000), () => h.service.previewIsolation(device.id), () => h.service.previewTier(device.id)]) await assert.rejects(operation(), /Use Change rate/);
  assert.equal((await h.service.scan()).legacyNewWritesAllowed, false);
  options.allowLegacyNewWrites = true;
  const preview = await h.service.preview(device.id, 1000);
  options.allowLegacyNewWrites = false;
  await assert.rejects(h.service.apply(preview.token), /Use Change rate/);
  assert.equal(h.changes, 0); assert.deepEqual(fs.readdirSync(h.directory), []);
});

test('legacy own-record restore remains possible but refuses while this app native setup is open', async () => {
  const options = {};
  const h = harness(options); const device = (await h.service.scan()).devices[0];
  const change = await h.service.apply((await h.service.preview(device.id, 1000)).token);
  options.allowLegacyNewWrites = false; options.nativeSetupActive = true;
  await assert.rejects(h.service.test(device.id), /Close native setup/);
  assert.equal(h.service.isBusy(), false);
  await assert.rejects(h.service.preview(device.id, 125, change.historyId), /Close native setup/);
  options.nativeSetupActive = false;
  const restore = await h.service.preview(device.id, 125, change.historyId);
  options.nativeSetupActive = true;
  await assert.rejects(h.service.apply(restore.token), /Close native setup/);
  assert.equal(h.changes, 1);
  options.nativeSetupActive = false;
  const result = await h.service.apply((await h.service.preview(device.id, 125, change.historyId)).token);
  assert.equal(result.status, 'RESTORED'); assert.equal(h.changes, 2);
});

test('keyboard traffic cannot produce a below-request verdict, including mixed collections', () => {
  const keyboard = { channel: 1, kind: 'KEYBOARD', samples: 100, activeDurationMs: 4000, eventHz: 25 };
  const result = input.assessObservedDelivery([keyboard], 1000);
  assert.equal(result.observedHz, null); assert.equal(result.channelAssessments[0].status, 'NO_COMPARISON');
  assert.match(result.message, /cannot be inferred from typing/);
  const mixed = input.assessObservedDelivery([keyboard, { channel: 2, kind: 'GAMEPAD', samples: 8011, activeDurationMs: 2000, eventHz: 4005 }], 4000);
  assert.equal(mixed.status, 'CONSISTENT_WITH_REQUEST'); assert.equal(mixed.channelAssessments[0].observedHz, null);
  assert.equal(input.assessObservedDelivery([{ kind: 'GAMEPAD', samples: 11001, activeDurationMs: 2000, eventHz: 5500 }], 4000).status, 'INCONCLUSIVE');
});

test('mouse comparison requires bound motion timestamps and at least 500 ms of continuous spans', () => {
  const channel = { kind: 'MOUSE', timesMs: Array.from({ length: 600 }, (_, i) => i), activity: activityFixture({ movement: 50 }) };
  let raw = { channels: [{ ...channel, motionTimesMs: channel.timesMs.slice(0, 30) }] };
  assert.equal(input.assessObservedDelivery(input.summarizeTiming(raw, 1000), 1000).observedHz, null);
  raw.channels[0].motionTimesMs = channel.timesMs;
  assert.equal(input.assessObservedDelivery(input.summarizeTiming(raw, 1000), 1000).observedHz, 1000);
  raw.channels[0].motionTimesMs = [0, 999];
  assert.throws(() => input.summarizeTiming(raw, 1000), /bound to its message/);
});

test('batched HID reports have a separate rate from Windows messages', () => {
  const channels = input.summarizeTiming({ channels: [{ kind: 'GAMEPAD', timesMs: Array.from({ length: 2001 }, (_, i) => i), hidReports: 8004, firstHidReports: 4 }] }, 4000);
  assert.equal(channels[0].eventHz, 1000); assert.equal(channels[0].reportHz, 4000);
  const result = input.assessObservedDelivery(channels, 4000);
  assert.equal(result.status, 'CONSISTENT_WITH_REQUEST'); assert.match(result.message, /4000 Windows HID reports\/s/);
  assert.throws(() => input.summarizeTiming({ channels: [{ timesMs: [0], hidReports: 1, firstHidReports: 2 }] }), /Invalid HID/);
});

test('payload errors do not erase valid cadence; incomplete report batches fall back to message rate', () => {
  const channel = { kind: 'GAMEPAD', timesMs: Array.from({length:8011},(_,i)=>i*2000/8010), activity: activityFixture({ errors: 8000 }) };
  const check = input.assessObservedDelivery(input.summarizeTiming({channels:[channel]},4000),4000);
  assert.equal(check.status,'CONSISTENT_WITH_REQUEST'); assert.equal(check.observedHz,4005);
  const broken = input.summarizeTiming({channels:[{...channel,hidReports:200,firstHidReports:1,activity:{...channel.activity,reportErrors:1}}]},4000);
  assert.equal(broken[0].reportHz,null); assert.equal(input.assessObservedDelivery(broken,4000).observedHz,4005);
});

test('continuous under-delivering mouse is below request and pauses remain excluded', () => {
  const timesMs = Array.from({length:1001},(_,i)=>i*2);
  const channel = {kind:'MOUSE',timesMs,motionTimesMs:timesMs,activity:activityFixture({movement:300})};
  assert.equal(input.assessObservedDelivery(input.summarizeTiming({channels:[channel]},1000),1000).status,'BELOW_REQUEST_OBSERVED');
  const stopped = Array.from({length:30},(_,i)=>i*100);
  assert.equal(input.summarizeTiming({channels:[{...channel,timesMs:stopped,motionTimesMs:stopped}]},1000)[0].motionHz,null);
  const mixed = [{channel:1,kind:'GAMEPAD',samples:4001,activeDurationMs:2000,eventHz:4000},{channel:2,kind:'MOUSE',samples:1001,activeDurationMs:2000,motionHz:500}];
  assert.equal(input.assessObservedDelivery(mixed,4000).status,'BELOW_REQUEST_OBSERVED');
});

test('keyboard aggregate schema excludes timestamps and sparse/silent activity stays inconclusive', () => {
  const keyboard={kind:'KEYBOARD',messageCount:20,spanMs:1500,activity:activityFixture({keys:10})};
  const result=input.summarizeTiming({channels:[keyboard]},1000);
  assert.equal(result[0].eventHz,null); assert.equal(result[0].samples,20);
  assert.throws(()=>input.summarizeTiming({channels:[{...keyboard,timesMs:[]}]}),/keyboard aggregate/);
  assert.throws(()=>input.summarizeTiming({channels:[{...keyboard,messageCount:100001}]}),/keyboard aggregate/);
  assert.match(input.summarizeActivity({activityVersion:1,channels:[]}).message,/No input messages arrived/);
  for(const field of ['sparseAxes','pendingAxes']) {
    const activity=input.summarizeActivity({activityVersion:1,channels:[{activity:activityFixture({[field]:1})}]});
    assert.equal(activity.status,'INCONCLUSIVE'); assert.equal(activity.coverage,'PARTIAL');
  }
});

test('native machine history refuses own-record restore and stale polling and tier tokens', async () => {
  const options={}; const h=harness(options); const device=(await h.service.scan()).devices[0];
  const change=await h.service.apply((await h.service.preview(device.id,1000)).token);
  const restore=await h.service.preview(device.id,125,change.historyId);
  options.nativeHistory=true;
  const before=fs.readFileSync(path.join(h.directory,'input-devices.json'));
  await assert.rejects(h.service.preview(device.id,125,change.historyId),/Native machine history/);
  await assert.rejects(h.service.apply(restore.token),/Native machine history/);
  await assert.rejects(h.service.previewTier(device.id,'any-record'),/Native machine history/);
  assert.deepEqual(fs.readFileSync(path.join(h.directory,'input-devices.json')),before); assert.equal(h.changes,1);
  const scan=await h.service.scan(); assert.equal(scan.legacyRestoreAuthority.allowed,false);
  assert.equal(scan.history[0].beforeInterval,8); assert.equal(scan.history[0].afterInterval,1);
});

test('unmonitored declarations disclose partial coverage without erasing supported changes or cadence', () => {
  for(const decoded of [0,32000]) {
    const result=input.summarizeActivity({activityVersion:1,channels:[{activity:activityFixture({decoded,unmonitoredControls:2})}]});
    assert.equal(result.coverage,'PARTIAL'); assert.equal(result.status,'INCONCLUSIVE');
    assert.match(result.message,/Some declared controls are not monitored/);
  }
  const result=input.summarizeActivity({activityVersion:1,channels:[{activity:activityFixture({buttons:1,unmonitoredControls:2})}]});
  assert.equal(result.status,'DETECTED'); assert.equal(result.coverage,'PARTIAL');
  const raw={activityVersion:1,channels:[{kind:'GAMEPAD',timesMs:Array.from({length:8001},(_,i)=>i/4),activity:activityFixture({unmonitoredControls:1})}]};
  assert.equal(input.assessObservedDelivery(input.summarizeTiming(raw,4000),4000).status,'CONSISTENT_WITH_REQUEST');
  for(const count of [-1,0.5,100001,'2']) assert.throws(()=>input.summarizeActivity({activityVersion:1,channels:[{activity:activityFixture({unmonitoredControls:count})}]}),/activity/i);
});

test('native authority path guard allows absence but refuses journal reservation, links and unreadable paths', () => {
  const {legacyRestoreAuthority}=require('../src/main/input-devices/legacy-authority.cjs');
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'dialed-authority-')); roots.push(base);
  assert.equal(legacyRestoreAuthority(base).allowed,true);
  const nativePath=path.join(base,'Dialed','HidusbfLifecycle'); fs.mkdirSync(nativePath,{recursive:true});
  assert.equal(legacyRestoreAuthority(base).allowed,false); // Even incomplete native initialization reserves authority.
  fs.writeFileSync(path.join(nativePath,'journal.bin'),'not parsed'); assert.equal(legacyRestoreAuthority(base).allowed,false);
  assert.equal(legacyRestoreAuthority('relative').allowed,false);
  assert.equal(legacyRestoreAuthority(base,{lstatSync(){throw Object.assign(new Error('Denied'),{code:'EACCES'});}}).allowed,false);
  assert.match(legacyRestoreAuthority(base,{lstatSync(){return {isSymbolicLink:()=>true,isDirectory:()=>true};}}).message,/linked/);
});

test('input test excludes concurrent preview, can be canceled, and stores no button values', async () => {
  const h = harness({ holdTest: true });
  const device = (await h.service.scan()).devices[0];
  const pending = h.service.test(device.id);
  await assert.rejects(h.service.preview(device.id, 1000), /Finish or cancel/);
  assert.deepEqual(h.service.cancelTest(), { canceled: true });
  await assert.rejects(pending, /canceled/);
  assert.equal(JSON.stringify(input.summarizeTiming({ channels: [] })).includes('button'), false);
});

test('input-device IPC validates every renderer value before it reaches the service', () => {
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
  assert.match(main, /labelPort\(assertInputDeviceDigest\(deviceId\), assertInputPortLabel\(label\)\)/);
  assert.match(main, /preview\(assertInputDeviceDigest\(deviceId\), assertInputPollingRate\(rate\), assertInputHistoryId\(historyId, true\)\)/);
  assert.match(main, /previewIsolation\(assertInputDeviceDigest\(deviceId\)\)/);
  assert.match(main, /apply\(assertInputOperationToken\(token\)\)/);
  assert.match(main, /previewTier\(assertInputDeviceDigest\(deviceId\), assertInputHistoryId\(historyId, true\)\)/);
  assert.match(main, /applyTier\(assertInputOperationToken\(token\)\)/);
  assert.match(main, /test\(assertInputDeviceDigest\(deviceId\)\)/);
  assert.match(main, /reconcile\(assertInputHistoryId\(historyId\)\)/);
  assert.match(main, /reconcileTier\(assertInputHistoryId\(historyId\)\)/);
  assert.match(main, /\^\[a-f0-9\]\{64\}\$/);
  assert.match(main, /\^\[0-9a-f-\]\{36\}\$\/i/);
  assert.match(main, /value\.length > 60 \|\| \/\[\\x00-\\x1f\\x7f\]\//);
});

test('source guard keeps driver/filter/security changes out and gates payloads behind selected-device headers', () => {
  const native = fs.readFileSync(path.join(__dirname, '../src/main/input-devices/native.ps1'), 'utf8');
  const cs = fs.readFileSync(path.join(__dirname, '../src/main/input-devices/usb-native.cs'), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
  assert.doesNotMatch(native, /pnputil|sc\.exe|bcdedit/i);
  assert.match(native, /Add-Type -TypeDefinition \$DialedInputSource/);
  assert.doesNotMatch(native, /Add-Type -Path/);
  assert.match(native, /FromBase64String\(\[string\]\$DialedInputSourceBase64\)/);
  assert.doesNotMatch(cs, /SetValue\(['"]LowerFilters|CreateSubKey/);
  assert.match(cs, /new ushort\[\]\{2,4,5,6\}/);
  assert.match(cs, /GetRawInputData\(m\.LParam,0x10000005/);
  assert.match(cs, /if\(allowed.Contains\(id\)\)[\s\S]*ReadControls\(m.LParam,device,size,ms,tracker\)/);
  assert.match(cs, /GetRawInputData\(input,0x10000003/);
  assert.match(cs, /EXISTING DWORD/);
  assert.match(native, /Services\\HIDUSBF\\Parameters/);
  assert.match(native, /PatchUSBXHCI/);
  assert.match(native, /Get-CimInstance[^\n]+Win32_DeviceGuard/);
  assert.match(native, /expectedBootId/);
  assert.match(native, /action -eq 'ENABLE'[^\n]+DialedMemoryIntegrity -ne 'Disabled'/);
  assert.doesNotMatch(native, /Set-CimInstance|Set-MpPreference|bcdedit|shutdown\.exe|Restart-Computer|Disable-WindowsOptionalFeature/i);
  assert.equal(JSON.stringify(packageJson.build.extraResources).includes('usb-native.cs'), false);
});

const activityFixture = (overrides = {}) => ({ decoded: 32000, unsupported: 0, errors: 0, buttons: 0, keys: 0, movement: 0, axes: 0, hats: 0, ...overrides });
test('decoded idle reports remain distinct from cadence and a following active capture', async () => {
  const data = { activityVersion: 1, channels: [{ kind: 'GAMEPAD', timesMs: Array.from({length: 8001}, (_, i) => i / 4), activity: activityFixture() }] };
  const h = harness({ speed: 2, value: 2, inputKind: 'GAMEPAD', testResult: data });
  const device = (await h.service.scan()).devices[0];
  const idle = await h.service.test(device.id);
  assert.equal(idle.controlActivity.status, 'NO_SIGNIFICANT_CHANGE');
  assert.equal(idle.deliveryAssessment.observedHz, 4000);
  data.channels[0].activity = activityFixture({ buttons: 2, axes: 3, hats: 2 });
  const active = await h.service.test(device.id);
  assert.equal(active.controlActivity.status, 'DETECTED');
  assert.equal(active.controlActivity.buttons, 2);
  assert.equal(active.deliveryAssessment.observedHz, 4000);
  assert.equal(active.measurement.controlActivity, 'DECODED_CONTROL_CHANGES');
  data.channels = [];
  const silent = await h.service.test(device.id);
  assert.equal(silent.controlActivity.status, 'INCONCLUSIVE');
  assert.equal(silent.controlActivity.buttons, 0);
  assert.equal(silent.deliveryAssessment.observedHz, null);
  assert.deepEqual(fs.readdirSync(h.directory), []);
  assert.equal(h.changes + h.tierChanges, 0);
});

test('unsupported and failed decoding cannot establish idle, with partial positive observations preserved', () => {
  const summary = (activity) => input.summarizeActivity({ activityVersion: 1, channels: [{ activity }] });
  for (const activity of [activityFixture({ decoded: 0, unsupported: 10 }), activityFixture({ errors: 1 }), activityFixture({ unsupported: 1 })]) {
    assert.equal(summary(activity).status, 'INCONCLUSIVE');
  }
  const partial = summary(activityFixture({ axes: 2, errors: 1 }));
  assert.equal(partial.status, 'DETECTED'); assert.equal(partial.coverage, 'PARTIAL');
  assert.match(partial.message, /partial/);
  const unstable = summary(activityFixture({ unstableAxes: 1 }));
  assert.equal(unstable.status, 'INCONCLUSIVE'); assert.equal(unstable.errors, 0);
  assert.equal(unstable.coverage, 'PARTIAL'); assert.match(unstable.message, /baseline was unstable/);
  assert.equal(input.summarizeActivity({ channels: [] }).status, 'UNAVAILABLE');
});

test('activity output validates counts and exposes no report or key identity fields', () => {
  const raw = { activityVersion: 1, channels: [{ activity: activityFixture({ buttons: 4, rawReport: 'private', keyCodes: [42] }) }] };
  const summary = input.summarizeActivity(raw);
  assert.equal('rawReport' in summary, false); assert.equal('keyCodes' in summary, false);
  for (const value of [-1, NaN, Infinity, 0.5, 100000001, '1', undefined]) {
    raw.channels[0].activity.buttons = value;
    assert.throws(() => input.summarizeActivity(raw), /Invalid control activity/);
  }
  assert.throws(() => input.summarizeActivity({ activityVersion: 2, channels: [] }), /Invalid/);
  assert.throws(() => input.summarizeActivity({ activityVersion: 1, channels: [{ activity: activityFixture({ decoded: 0, axes: 1 }) }] }), /require decoded/);
});

test('a HID collection change discards a completed capture even when the physical USB node is unchanged', async () => {
  const h = harness({ holdTest: true });
  const device = (await h.service.scan()).devices[0];
  const pending = h.service.test(device.id);
  while (!h.heldTest) await new Promise(resolve => setImmediate(resolve));
  h.current.nodes.at(-1).parent = 'USB\\DIFFERENT';
  h.heldTest.resolve({ activityVersion: 1, channels: [] });
  await assert.rejects(pending, /connection changed/);
});
