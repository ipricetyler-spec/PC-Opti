const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const journal = require('../src/main/journal/index.cjs');
const capabilities = require('../src/main/capabilities/index.cjs');
const powerPlans = require('../src/main/power-plans/index.cjs');
const gpu = require('../src/main/gpu-preference/index.cjs');
const maintenance = require('../src/main/maintenance/index.cjs');
const displayModes = require('../src/main/display-modes/index.cjs');
const wifi = require('../src/main/wifi-status/index.cjs');

const BALANCED = '381b4222-f694-41f0-9685-ff5bb260df2e';
const HIGH = '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c';

function userData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dialed-improvements-'));
}

function planState(activeGuid, extra = []) {
  const items = [{ guid: BALANCED, name: 'Balanced' }, { guid: HIGH, name: 'High performance' }, ...extra].map((item) => ({ ...item, active: item.guid === activeGuid }));
  return { items, activeGuid };
}

test('power plan list parsing keeps only GUID, name and active marker from localized output', () => {
  const items = powerPlans.parsePowerPlanList([
    'Existing Power Schemes (* Active)',
    '-----------------------------------',
    `Power Scheme GUID: ${BALANCED}  (Balanced) *`,
    `GUID du mode de gestion de l’alimentation : ${HIGH}  (Performances élevées)`,
  ].join('\r\n'));
  assert.deepEqual(items, [
    { guid: BALANCED, name: 'Balanced', active: true },
    { guid: HIGH, name: 'Performances élevées', active: false },
  ]);
  assert.throws(() => powerPlans.assertPowerPlanGuid('381b4222; Remove-Item C:\\'), /not valid/);
  assert.throws(() => powerPlans.parsePowerPlanList(`${BALANCED} (A) *\n${HIGH} (B) *`), /more than one active/);
});

test('power plan switch records the exact previous plan and restores it only when unchanged', async () => {
  const directory = userData();
  let active = BALANCED;
  const adapters = {
    listPowerPlans: async () => planState(active),
    setActivePowerPlan: async (guid) => { active = guid; return { exitCode: 0, stdout: '', stderr: '', output: {} }; },
  };
  await assert.rejects(journal.activatePowerPlan(directory, BALANCED, adapters), /already the active/);
  await assert.rejects(journal.activatePowerPlan(directory, '00000000-0000-0000-0000-000000000000', adapters), /no longer listed/);
  assert.deepEqual(journal.readJournal(directory), []);

  const applied = await journal.activatePowerPlan(directory, HIGH, adapters);
  assert.equal(applied.success, true);
  assert.equal(applied.entry.capabilityId, 'power:switch-plan');
  assert.deepEqual(applied.entry.preAction, { previousGuid: BALANCED, previousName: 'Balanced', targetGuid: HIGH, targetName: 'High performance' });
  assert.equal(applied.entry.rollback.kind, 'restore-power-plan');

  active = BALANCED;
  await assert.rejects(journal.rollbackAuditEntry(directory, applied.entry.id, adapters), /different power plan is active/);
  active = HIGH;
  const restored = await journal.rollbackAuditEntry(directory, applied.entry.id, adapters);
  assert.equal(restored.success, true);
  assert.equal(active, BALANCED);
  assert.equal(journal.readJournal(directory).find((entry) => entry.id === applied.entry.id).rollback.available, false);
});

test('power plan switch that Windows does not verify is marked for review without rollback', async () => {
  const directory = userData();
  const result = await journal.activatePowerPlan(directory, HIGH, {
    listPowerPlans: async () => planState(BALANCED),
    setActivePowerPlan: async () => ({ exitCode: 0, stdout: '', stderr: '', output: {} }),
  });
  assert.equal(result.success, false);
  assert.equal(result.entry.status, 'NEEDS_REVIEW');
  assert.equal(result.entry.rollback.available, false);
});

test('GPU preference formatting preserves other keys and rejects invalid paths or values', () => {
  assert.equal(gpu.formatGpuPreference(null, 2), 'GpuPreference=2;');
  assert.equal(gpu.formatGpuPreference('SwapEffectUpgradeEnable=1;GpuPreference=1;', 2), 'SwapEffectUpgradeEnable=1;GpuPreference=2;');
  assert.equal(gpu.parseGpuPreference('SwapEffectUpgradeEnable=1;GpuPreference=2;'), 2);
  assert.equal(gpu.parseGpuPreference('GpuPreference=9;'), null);
  assert.throws(() => gpu.formatGpuPreference('', 3), /must be 0, 1 or 2/);
  assert.equal(gpu.assertExecutablePath('C:\\Games\\Game\\game.exe'), 'C:\\Games\\Game\\game.exe');
  for (const bad of ['game.exe', '\\\\server\\share\\game.exe', 'C:\\Games\\game.bat', 'C:\\Games\\"quoted".exe']) assert.throws(() => gpu.assertExecutablePath(bad));
});

test('GPU preference change keeps exact prior text and restores or removes it after a conflict check', async () => {
  const exePath = 'C:\\Games\\Fixture\\fixture.exe';
  for (const initial of [{ exists: false, data: null, kind: null }, { exists: true, data: 'SwapEffectUpgradeEnable=1;', kind: 'String' }]) {
    const directory = userData();
    let state = { exePath, ...initial };
    const adapters = {
      readGpuPreference: async () => ({ ...state }),
      writeGpuPreferenceData: async (_path, data) => { state = { exePath, exists: true, data, kind: 'String' }; return { exitCode: 0, stdout: '', stderr: '', output: {} }; },
      removeGpuPreferenceValue: async () => { state = { exePath, exists: false, data: null, kind: null }; return { exitCode: 0, stdout: '', stderr: '', output: {} }; },
    };
    const applied = await journal.setGpuPreference(directory, exePath, 2, adapters);
    assert.equal(applied.success, true);
    assert.equal(applied.entry.capabilityId, 'graphics:per-app-gpu-preference');
    assert.equal(state.data, initial.exists ? 'SwapEffectUpgradeEnable=1;GpuPreference=2;' : 'GpuPreference=2;');
    await assert.rejects(journal.setGpuPreference(directory, exePath, 2, adapters), /already set/);

    const saved = state;
    state = { ...saved, data: 'GpuPreference=1;' };
    await assert.rejects(journal.rollbackAuditEntry(directory, applied.entry.id, adapters), /changed after Dialed wrote it/);
    state = saved;
    const restored = await journal.rollbackAuditEntry(directory, applied.entry.id, adapters);
    assert.equal(restored.success, true);
    assert.deepEqual({ exists: state.exists, data: state.data }, { exists: initial.exists, data: initial.data });
  }
});

test('GPU preference refuses to overwrite a non-text value', async () => {
  await assert.rejects(journal.setGpuPreference(userData(), 'C:\\Games\\x.exe', 2, {
    readGpuPreference: async () => ({ exists: true, data: '2', kind: 'DWord' }),
  }), /not stored as text/);
});

test('cache cleanup scripts use fixed roots, skip missing vendor folders and keep the temp script unchanged', () => {
  const shader = maintenance.createCacheCleanupPowerShellScript('clear-shader-caches', true);
  assert.match(shader, /D3DSCache/);
  assert.match(shader, /NVIDIA\\DXCache/);
  assert.match(shader, /AMD\\VkCache/);
  assert.match(shader, /\$skipMissingRoots = \$true/);
  assert.match(shader, /AddDays\(-1\)/);
  assert.doesNotMatch(shader, /Remove-Item[^\n]*-Recurse/);
  assert.match(maintenance.createCacheCleanupPowerShellScript('clear-crash-dumps'), /CrashDumps[\s\S]*\$deleteEligible = \$false|\$deleteEligible = \$false[\s\S]*CrashDumps/);
  assert.throws(() => maintenance.createCacheCleanupPowerShellScript('C:\\Windows'), /not recognized/);
  const temp = maintenance.createTempMaintenancePowerShellScript(false);
  assert.match(temp, /\$skipMissingRoots = \$false/);
  assert.match(temp, /@\(\$env:TEMP, \(Join-Path \$env:WINDIR 'Temp'\)\)/);
});

test('cache cleanup maintenance refuses an empty fresh inventory and records irreversible deletions', async () => {
  const directory = userData();
  await assert.rejects(journal.executeMaintenanceAction(directory, 'clear-shader-caches', {
    inspectCacheCleanup: async () => ({ pathCount: 0, totalSizeBytes: 0, paths: [] }),
  }), /No eligible cache files/);
  assert.deepEqual(journal.readJournal(directory), []);
  const result = await journal.executeMaintenanceAction(directory, 'clear-crash-dumps', {
    inspectCacheCleanup: async () => ({ pathCount: 2, totalSizeBytes: 10, paths: ['C:\\Users\\x\\AppData\\Local\\CrashDumps'] }),
    runCacheCleanup: async () => ({ exitCode: 0, stdout: '{}', stderr: '', output: { deletedFileCount: 2, reclaimedBytes: 10 } }),
  });
  assert.equal(result.success, true);
  assert.equal(result.entry.capabilityId, 'maintenance:clear-crash-dumps');
  assert.equal(result.entry.rollback.available, false);
  assert.equal(result.result.byteAccounting, 'SUM_OF_REMOVED_FILE_LENGTHS');
});

test('refresh-rate check flags only a meaningfully higher rate at the same resolution', () => {
  const [low, fine, unknown] = displayModes.classifyDisplayModes([
    { adapter: 'GPU', currentWidth: 2560, currentHeight: 1440, currentHz: 60, modes: [{ width: 2560, height: 1440, hz: 60 }, { width: 2560, height: 1440, hz: 144 }, { width: 1920, height: 1080, hz: 240 }] },
    { adapter: 'GPU', currentWidth: 1920, currentHeight: 1080, currentHz: 143, modes: [{ width: 1920, height: 1080, hz: 144 }] },
    { adapter: 'GPU', currentWidth: 1920, currentHeight: 1080, currentHz: 1, modes: [] },
  ]);
  assert.equal(low.status, 'HIGHER_RATE_AVAILABLE');
  assert.equal(low.maxHzAtCurrentResolution, 144);
  assert.equal(low.maxHzAnyResolution, 240);
  assert.equal(fine.status, 'AT_HIGHEST_OFFERED');
  assert.equal(unknown.status, 'UNKNOWN');
  assert.doesNotMatch(displayModes.DISPLAY_MODES_SCRIPT, /ChangeDisplaySettings/);
});

test('Wi-Fi parser reads link fields without network names and leaves unknown values unknown', () => {
  const items = wifi.parseWifiInterfaces([
    'There is 1 interface on the system:',
    '',
    '    Name                   : Wi-Fi',
    '    State                  : connected',
    '    SSID                   : Home Network',
    '    BSSID                  : aa:bb:cc:dd:ee:ff',
    '    Radio type             : 802.11ax',
    '    Band                   : 5 GHz',
    '    Channel                : 36',
    '    Receive rate (Mbps)    : 1201',
    '    Transmit rate (Mbps)   : 960',
    '    Signal                 : 72%',
  ].join('\r\n'));
  assert.equal(items.length, 1);
  assert.deepEqual(items[0], { name: 'Wi-Fi', state: 'connected', radioType: '802.11ax', band: '5 GHz', channel: 36, receiveRateMbps: 1201, transmitRateMbps: 960, signalPercent: 72 });
  assert.equal(JSON.stringify(items).includes('Home Network'), false);
  assert.equal(wifi.classifySignal(72), 'GOOD');
  assert.equal(wifi.classifySignal(null), 'UNKNOWN');
});

test('new capabilities are registered, public and mapped to their journal action ids', () => {
  const publicIds = new Set(capabilities.listCapabilities('public').map((item) => item.id));
  for (const id of ['maintenance:clear-shader-caches', 'maintenance:clear-crash-dumps', 'power:switch-plan', 'graphics:per-app-gpu-preference', 'diagnostic:display-modes', 'diagnostic:wifi-link']) assert.ok(publicIds.has(id), id);
  assert.equal(capabilities.capabilityForAction('clear-shader-caches').id, 'maintenance:clear-shader-caches');
  assert.equal(capabilities.capabilityForAction(`power:activate-plan:${HIGH}`).id, 'power:switch-plan');
  assert.equal(capabilities.capabilityForAction(`graphics:gpu-preference:${'a'.repeat(24)}`).id, 'graphics:per-app-gpu-preference');
  assert.equal(capabilities.capabilityForAction('power:activate-plan:../../x'), null);
});

test('main process exposes the new actions only through validated handlers', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.cjs'), 'utf8');
  for (const channel of ['inspect-maintenance-caches', 'list-power-plans', 'activate-power-plan', 'list-gpu-preferences', 'choose-gpu-preference-app', 'set-gpu-preference', 'read-display-modes', 'read-wifi-status']) {
    assert.match(main, new RegExp(`ipcMain\\.handle\\('pc-opti:${channel}'`), channel);
    assert.match(preload, new RegExp(`'pc-opti:${channel}'`), channel);
  }
  assert.match(main, /latestGpuPreferenceTargets\.get\(targetId\)/);
  assert.match(main, /dialog\.showOpenDialog\(mainWindow, \{ title: 'Choose a game or app'/);
  assert.doesNotMatch(preload, /setGpuPreference: \(exePath/);
});

test('the per-program graphics list leaves out Windows global settings, which are not programs', async () => {
  // Seen on a real PC: the UserGpuPreferences key also holds DirectXUserGlobalSettings.
  const valorant = String.raw`C:\Games\Valorant\VALORANT-Win64-Shipping.exe`;
  const fakeRun = async () => ({ stdout: JSON.stringify([
    { exePath: 'DirectXUserGlobalSettings', data: 'SwapEffectUpgradeEnable=1;', kind: 'String' },
    { exePath: valorant, data: 'GpuPreference=2;', kind: 'String' },
  ]), stderr: '', exitCode: 0 });
  const items = await gpu.listGpuPreferences(fakeRun);
  assert.deepEqual(items.map((item) => item.exePath), [valorant]);
  assert.equal(items[0].preference, 2);
});
