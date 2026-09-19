const test = require('node:test');
const { tempDir } = require('./helpers/temp-dir.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const journal = require('../src/main/journal/index.cjs');
const power = require('../src/main/power-tweaks/index.cjs');
const windowed = require('../src/main/windowed-games/index.cjs');
const fullscreen = require('../src/main/fullscreen-optimizations/index.cjs');
const { capabilityForAction } = require('../src/main/capabilities/index.cjs');

// Every test uses fakes: the shell running these tests is elevated, so nothing here may
// reach the real registry or power plans.
const BALANCED = '381b4222-f694-41f0-9685-ff5bb260df2e';
const GAME = 'D:\\Games\\Example\\game.exe';
const ok = { exitCode: 0, stdout: '', stderr: '', output: {} };

function userData() {
  return tempDir('dialed-new-tweaks-');
}

function fakeWindowed(initial = { exists: true, data: 'VRROptimizeEnable=1;' }, build = 26200) {
  const state = { exists: initial.exists, data: initial.data, kind: initial.exists ? 'String' : null };
  const read = async () => ({ exists: state.exists, kind: state.kind, data: state.data, build, enabled: state.kind === 'String' ? windowed.parseWindowedOptimizations(state.data) : null });
  return {
    state,
    adapters: {
      readWindowedGameSetting: read,
      writeWindowedGameData: async (data) => { Object.assign(state, { exists: true, kind: 'String', data }); return ok; },
      removeWindowedGameValue: async () => { Object.assign(state, { exists: false, kind: null, data: null }); return ok; },
    },
  };
}

function fakeFullscreen(initial = null, machine = null) {
  const state = { data: initial };
  const read = async (exePath) => ({
    id: fullscreen.targetId(exePath), exePath, exists: state.data !== null, kind: state.data !== null ? 'String' : null, data: state.data,
    disabled: fullscreen.hasFlag(state.data), disabledForAllUsers: fullscreen.hasFlag(machine),
  });
  return {
    state,
    adapters: {
      readFullscreenOptimizations: read,
      writeCompatibilityFlags: async (_exePath, data) => { state.data = data; return ok; },
      removeCompatibilityFlags: async () => { state.data = null; return ok; },
    },
  };
}

function fakeUsb(ac = 1, dc = 1) {
  const state = { ac, dc };
  return {
    state,
    adapters: {
      listPowerPlans: async () => ({ items: [{ guid: BALANCED, name: 'Balanced', active: true }], activeGuid: BALANCED }),
      readUsbSelectiveSuspend: async (guid) => ({ schemeGuid: guid, ...state }),
      writeUsbSelectiveSuspendAc: async (_guid, value) => { state.ac = value; return ok; },
    },
  };
}

// Optimizations for windowed games

test('the windowed-games switch is set without disturbing other Windows graphics entries', () => {
  assert.equal(windowed.formatWindowedOptimizations('VRROptimizeEnable=1;', true), 'VRROptimizeEnable=1;SwapEffectUpgradeEnable=1;');
  assert.equal(windowed.formatWindowedOptimizations('SwapEffectUpgradeEnable=1;VRROptimizeEnable=1;', false), 'SwapEffectUpgradeEnable=0;VRROptimizeEnable=1;');
  assert.equal(windowed.formatWindowedOptimizations(null, true), 'SwapEffectUpgradeEnable=1;');
  assert.equal(windowed.formatWindowedOptimizations('SwapEffectUpgradeEnable=0;A=1;SwapEffectUpgradeEnable=1;', true), 'SwapEffectUpgradeEnable=1;A=1;');
  assert.equal(windowed.parseWindowedOptimizations('VRROptimizeEnable=1;'), null);
  assert.equal(windowed.parseWindowedOptimizations('SwapEffectUpgradeEnable=1;'), true);
  assert.equal(windowed.parseWindowedOptimizations('SwapEffectUpgradeEnable=7;'), null);
  assert.throws(() => windowed.formatWindowedOptimizations('', 'yes'), /on or off/);
});

test('the windowed-games switch is only offered on Windows 11 22H2 or later, and never over a non-text value', () => {
  assert.equal(windowed.unsupportedReason({ build: 26200, exists: true, kind: 'String' }), null);
  assert.match(windowed.unsupportedReason({ build: 22000, exists: false, kind: null }), /22H2/);
  assert.match(windowed.unsupportedReason({ build: null }), /did not report its version/);
  assert.match(windowed.unsupportedReason({ build: 26200, exists: true, kind: 'DWord' }), /not stored as text/);
});

test('turning on optimizations for windowed games is recorded, verified and undone to the exact text', async () => {
  const directory = userData();
  const fake = fakeWindowed();
  const applied = await journal.setWindowedGameOptimizations(directory, true, fake.adapters);
  assert.equal(applied.success, true);
  assert.equal(fake.state.data, 'VRROptimizeEnable=1;SwapEffectUpgradeEnable=1;');
  assert.equal(applied.entry.capabilityId, 'graphics:windowed-game-optimizations');
  await assert.rejects(journal.setWindowedGameOptimizations(directory, true, fake.adapters), /already on/);
  const undone = await journal.rollbackAuditEntry(directory, applied.entry.id, fake.adapters);
  assert.equal(undone.success, true);
  assert.equal(fake.state.data, 'VRROptimizeEnable=1;');
});

test('undo removes the value again when Windows had none', async () => {
  const directory = userData();
  const fake = fakeWindowed({ exists: false, data: null });
  const applied = await journal.setWindowedGameOptimizations(directory, false, fake.adapters);
  assert.equal(fake.state.data, 'SwapEffectUpgradeEnable=0;');
  await journal.rollbackAuditEntry(directory, applied.entry.id, fake.adapters);
  assert.equal(fake.state.exists, false);
});

test('windowed-games undo is refused if the value changed since, and older Windows is refused', async () => {
  const directory = userData();
  const fake = fakeWindowed();
  const applied = await journal.setWindowedGameOptimizations(directory, true, fake.adapters);
  fake.state.data = 'SwapEffectUpgradeEnable=0;';
  await assert.rejects(journal.rollbackAuditEntry(directory, applied.entry.id, fake.adapters), /changed after Dialed wrote it/);
  assert.equal(fake.state.data, 'SwapEffectUpgradeEnable=0;');
  const old = fakeWindowed(undefined, 19045);
  await assert.rejects(journal.setWindowedGameOptimizations(userData(), true, old.adapters), /22H2 or later\. Nothing was changed/);
});

// Fullscreen optimizations per game

test('the fullscreen flag is added or removed without touching other compatibility flags', () => {
  assert.equal(fullscreen.formatCompatibilityFlags(null, true), '~ DISABLEDXMAXIMIZEDWINDOWEDMODE');
  assert.equal(fullscreen.formatCompatibilityFlags('~ RUNASADMIN HIGHDPIAWARE', true), '~ RUNASADMIN HIGHDPIAWARE DISABLEDXMAXIMIZEDWINDOWEDMODE');
  assert.equal(fullscreen.formatCompatibilityFlags('~ RUNASADMIN DISABLEDXMAXIMIZEDWINDOWEDMODE', false), '~ RUNASADMIN');
  assert.equal(fullscreen.formatCompatibilityFlags('~ DISABLEDXMAXIMIZEDWINDOWEDMODE', false), null);
  assert.equal(fullscreen.formatCompatibilityFlags('~ disabledxmaximizedwindowedmode', true), '~ DISABLEDXMAXIMIZEDWINDOWEDMODE');
});

test('turning off fullscreen optimizations for one game is recorded and undone exactly', async () => {
  const directory = userData();
  const fake = fakeFullscreen('~ RUNASADMIN');
  const applied = await journal.setFullscreenOptimizations(directory, GAME, true, fake.adapters);
  assert.equal(applied.success, true);
  assert.equal(fake.state.data, '~ RUNASADMIN DISABLEDXMAXIMIZEDWINDOWEDMODE');
  assert.match(applied.entry.actionId, /^graphics:fullscreen-optimizations:[a-f0-9]{24}$/);
  assert.equal(applied.entry.capabilityId, 'graphics:fullscreen-optimizations');
  await assert.rejects(journal.setFullscreenOptimizations(directory, GAME, true, fake.adapters), /already off/);
  await journal.rollbackAuditEntry(directory, applied.entry.id, fake.adapters);
  assert.equal(fake.state.data, '~ RUNASADMIN');
});

test('turning them back on removes the value when it held only this flag, and undo puts it back', async () => {
  const directory = userData();
  const fake = fakeFullscreen('~ DISABLEDXMAXIMIZEDWINDOWEDMODE');
  const applied = await journal.setFullscreenOptimizations(directory, GAME, false, fake.adapters);
  assert.equal(fake.state.data, null);
  await journal.rollbackAuditEntry(directory, applied.entry.id, fake.adapters);
  assert.equal(fake.state.data, '~ DISABLEDXMAXIMIZEDWINDOWEDMODE');
});

test('fullscreen undo is refused after an outside change, and only local .exe paths are accepted', async () => {
  const directory = userData();
  const fake = fakeFullscreen(null);
  const applied = await journal.setFullscreenOptimizations(directory, GAME, true, fake.adapters);
  fake.state.data = '~ RUNASADMIN';
  await assert.rejects(journal.rollbackAuditEntry(directory, applied.entry.id, fake.adapters), /changed after Dialed wrote it/);
  assert.equal(fake.state.data, '~ RUNASADMIN');
  for (const bad of ['\\\\server\\share\\game.exe', 'D:\\Games\\notes.txt', 'game.exe']) {
    await assert.rejects(journal.setFullscreenOptimizations(userData(), bad, true, fake.adapters), /not valid|local drive/);
  }
});

test('the fullscreen scripts only ever write the current-user key', async () => {
  const scripts = [];
  const run = async (script) => { scripts.push(script); return { stdout: '{"written":true,"removed":true}', stderr: '', exitCode: 0 }; };
  await fullscreen.writeCompatibilityFlags(GAME, '~ DISABLEDXMAXIMIZEDWINDOWEDMODE', run);
  await fullscreen.removeCompatibilityFlags(GAME, run);
  const decoded = scripts.map((script) => [...script.matchAll(/FromBase64String\('([^']+)'\)/g)].map((match) => Buffer.from(match[1], 'base64').toString('utf8')));
  for (const values of decoded) {
    assert.ok(values.includes('HKCU:\\Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers'));
    assert.ok(!values.some((value) => value.startsWith('HKLM')));
  }
});

// USB selective suspend

test('USB selective suspend is turned off when plugged in only, and undo turns it back on', async () => {
  const directory = userData();
  const fake = fakeUsb(1, 1);
  const applied = await journal.setUsbSelectiveSuspendOff(directory, fake.adapters);
  assert.equal(applied.success, true);
  assert.deepEqual(fake.state, { ac: 0, dc: 1 }, 'battery value unchanged');
  assert.equal(applied.entry.capabilityId, 'power:usb-selective-suspend');
  await assert.rejects(journal.setUsbSelectiveSuspendOff(directory, fake.adapters), /already off/);
  await journal.rollbackAuditEntry(directory, applied.entry.id, fake.adapters);
  assert.deepEqual(fake.state, { ac: 1, dc: 1 });
});

test('USB undo is refused if the setting changed since', async () => {
  const directory = userData();
  const fake = fakeUsb(1, 1);
  const applied = await journal.setUsbSelectiveSuspendOff(directory, fake.adapters);
  fake.state.ac = 1;
  await assert.rejects(journal.rollbackAuditEntry(directory, applied.entry.id, fake.adapters), /changed after Dialed set it/);
});

test('the USB powercfg command carries only fixed GUIDs and 0 or 1', async () => {
  const scripts = [];
  const run = async (script) => { scripts.push(script); return { stdout: 'Current AC Power Setting Index: 0x00000001\nCurrent DC Power Setting Index: 0x00000001', stderr: '', exitCode: 0 }; };
  await power.writeUsbSelectiveSuspendAc(BALANCED, 0, run);
  await assert.rejects(power.writeUsbSelectiveSuspendAc(BALANCED, 2, run), /Disabled \(0\) or Enabled \(1\)/);
  await assert.rejects(power.readUsbSelectiveSuspend('x; Remove-Item C:', run), /not valid/);
  assert.match(scripts[0], new RegExp(`/setacvalueindex ${BALANCED} ${power.SUB_USB} ${power.USBSELECTIVESUSPEND} 0`));
  assert.doesNotMatch(scripts[0], /setdcvalueindex/);
  assert.deepEqual(await power.readUsbSelectiveSuspend(BALANCED, run), { schemeGuid: BALANCED, ac: 1, dc: 1 });
  const odd = async () => ({ stdout: '0x00000003 0x00000001', stderr: '', exitCode: 0 });
  await assert.rejects(power.readUsbSelectiveSuspend(BALANCED, odd), /other than Disabled or Enabled/);
});

// Shared

test('an interrupted windowed-games change is settled from what Windows reports', async () => {
  const directory = userData();
  const fake = fakeWindowed();
  const failing = { ...fake.adapters, writeWindowedGameData: async (data) => { fake.state.data = data; throw new Error('lost'); } };
  const applied = await journal.setWindowedGameOptimizations(directory, true, failing);
  assert.equal(applied.success, false);
  const entries = journal.readJournal(directory);
  entries[0].status = 'PENDING';
  fs.writeFileSync(path.join(directory, 'journal.json'), JSON.stringify(entries));
  await journal.reconcilePendingEntries(directory, fake.adapters);
  const settled = journal.readJournal(directory)[0];
  assert.equal(settled.status, 'SUCCESS');
  assert.equal(settled.rollback.available, true);
});

test('each new action id maps to its capability, and nothing else does', () => {
  assert.equal(capabilityForAction('graphics:windowed-game-optimizations')?.id, 'graphics:windowed-game-optimizations');
  assert.equal(capabilityForAction(`graphics:fullscreen-optimizations:${'a'.repeat(24)}`)?.id, 'graphics:fullscreen-optimizations');
  assert.equal(capabilityForAction(`power:usb-selective-suspend:${BALANCED}`)?.id, 'power:usb-selective-suspend');
  assert.equal(capabilityForAction('graphics:fullscreen-optimizations:../../x'), null);
  assert.equal(capabilityForAction('power:usb-selective-suspend:not-a-guid'), null);
});
