const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const journal = require('../src/main/journal/index.cjs');
const capabilities = require('../src/main/capabilities/index.cjs');
const settings = require('../src/main/user-settings/index.cjs');

function userData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dialed-user-settings-'));
}

// A fake per-user Registry for one setting, shaped like readUserSetting's result.
function fakeRegistry(settingId, initial) {
  let raw = { ...initial };
  const read = async (id) => {
    assert.equal(id, settingId);
    const state = { settingId, exists: raw.exists, value: raw.exists ? raw.value : null, kind: raw.exists ? raw.kind : null };
    return { ...state, enabled: settings.effectiveEnabled(settingId, state) };
  };
  return {
    get raw() { return raw; },
    set raw(value) { raw = value; },
    adapters: {
      readUserSetting: read,
      writeUserSettingValue: async (id, value) => { assert.equal(id, settingId); raw = { exists: true, value, kind: 'DWord' }; return { exitCode: 0, stdout: '', stderr: '', output: {} }; },
      removeUserSettingValue: async (id) => { assert.equal(id, settingId); raw = { exists: false }; return { exitCode: 0, stdout: '', stderr: '', output: {} }; },
    },
  };
}

test('only the eight allowlisted settings exist, each in the hive its scope says, mapped to its own capability', () => {
  assert.deepEqual(Object.keys(settings.USER_SETTINGS).sort(), ['background-recording', 'block-background-apps', 'exclude-driver-updates', 'game-mode', 'global-timer-resolution', 'gpu-scheduling', 'mpo', 'no-auto-restart']);
  for (const [id, setting] of Object.entries(settings.USER_SETTINGS)) {
    assert.match(setting.registryPath, setting.scope === 'user' ? /^HKCU:\\/ : /^HKLM:\\/, `${id} is in the wrong hive for its scope`);
    const capability = capabilities.capabilityForAction(settings.userSettingActionId(id));
    assert.equal(capability.id, setting.capabilityId);
    // Machine-wide settings are declared as needing administrator rights.
    assert.equal(capability.privilegeRequirement === 'Administrator', setting.scope === 'machine');
  }
  assert.throws(() => settings.userSetting('HKLM:\\SOFTWARE'), /not one Dialed manages/);
  assert.throws(() => settings.userSetting('__proto__'), /not one Dialed manages/);
});

test('a missing value means the Windows default: Game Mode on, background recording off', () => {
  assert.equal(settings.effectiveEnabled('game-mode', { exists: false }), true);
  assert.equal(settings.effectiveEnabled('background-recording', { exists: false }), false);
  assert.equal(settings.effectiveEnabled('game-mode', { exists: true, kind: 'DWord', value: 0 }), false);
  assert.equal(settings.effectiveEnabled('game-mode', { exists: true, kind: 'String', value: null }), null);
});

test('turning a setting off records, verifies and restores the exact previous state', async () => {
  {
    const directory = userData();
    const registry = fakeRegistry('background-recording', { exists: true, value: 1, kind: 'DWord' });
    const before = { ...registry.raw };
    const applied = await journal.setUserSetting(directory, 'background-recording', false, registry.adapters);
    assert.equal(applied.success, true);
    assert.equal(applied.entry.capabilityId, 'gaming:background-recording');
    assert.equal(applied.entry.rollback.kind, 'restore-user-setting');
    assert.deepEqual(registry.raw, { exists: true, value: 0, kind: 'DWord' });
    await assert.rejects(journal.setUserSetting(directory, 'background-recording', false, registry.adapters), /already off/);

    const restored = await journal.rollbackAuditEntry(directory, applied.entry.id, registry.adapters);
    assert.equal(restored.success, true);
    assert.deepEqual(registry.raw, before);
    const original = journal.readJournal(directory).find((entry) => entry.id === applied.entry.id);
    assert.equal(original.rollback.available, false);
  }
});

test('a value that was absent is removed again on undo, so Windows uses its default', async () => {
  const directory = userData();
  const registry = fakeRegistry('game-mode', { exists: false });
  const applied = await journal.setUserSetting(directory, 'game-mode', false, registry.adapters);
  assert.equal(applied.success, true);
  assert.deepEqual(registry.raw, { exists: true, value: 0, kind: 'DWord' });
  await journal.rollbackAuditEntry(directory, applied.entry.id, registry.adapters);
  assert.deepEqual(registry.raw, { exists: false });
});

test('undo is refused when the setting changed after Dialed set it', async () => {
  const directory = userData();
  const registry = fakeRegistry('game-mode', { exists: true, value: 1, kind: 'DWord' });
  const applied = await journal.setUserSetting(directory, 'game-mode', false, registry.adapters);
  registry.raw = { exists: true, value: 1, kind: 'DWord' };
  await assert.rejects(journal.rollbackAuditEntry(directory, applied.entry.id, registry.adapters), /changed after Dialed set it/);
  assert.deepEqual(registry.raw, { exists: true, value: 1, kind: 'DWord' });
});

test('a non-DWORD value is never overwritten', async () => {
  const registry = fakeRegistry('game-mode', { exists: true, value: null, kind: 'String' });
  await assert.rejects(journal.setUserSetting(userData(), 'game-mode', false, registry.adapters), /not a DWORD/);
});

test('a tampered journal entry cannot redirect or forge a restore', async () => {
  const directory = userData();
  const registry = fakeRegistry('game-mode', { exists: true, value: 1, kind: 'DWord' });
  const applied = await journal.setUserSetting(directory, 'game-mode', false, registry.adapters);
  const file = fs.readdirSync(directory).map((name) => path.join(directory, name)).find((name) => /journal/i.test(path.basename(name)) && fs.statSync(name).isFile());
  const tamper = (mutate) => {
    const entries = journal.readJournal(directory);
    const target = entries.find((entry) => entry.id === applied.entry.id);
    mutate(target);
    journal.writeJournal ? journal.writeJournal(directory, entries) : fs.writeFileSync(file, JSON.stringify(entries));
  };
  // An unknown setting id (for example a machine-wide location) is refused outright.
  tamper((entry) => { entry.preAction.settingId = 'HKLM:\\SOFTWARE\\Policies'; });
  await assert.rejects(journal.rollbackAuditEntry(directory, applied.entry.id, registry.adapters), /not one Dialed manages/);
  // A forged previous value of the wrong type is refused.
  tamper((entry) => { entry.preAction.settingId = 'game-mode'; entry.preAction.kind = 'String'; entry.preAction.value = 'x'; });
  await assert.rejects(journal.rollbackAuditEntry(directory, applied.entry.id, registry.adapters), /not a DWORD/);
  assert.deepEqual(registry.raw, { exists: true, value: 0, kind: 'DWord' });
});

test('the renderer can only send a known setting id and a boolean', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /ipcMain\.handle\('pc-opti:set-user-setting', async \(_event, settingId, enabled\) => \{[\s\S]*?hasOwnProperty\.call\(USER_SETTINGS, settingId\)[\s\S]*?typeof enabled !== 'boolean'[\s\S]*?assertCapabilityAvailable\(USER_SETTINGS\[settingId\]\.capabilityId\)[\s\S]*?serializeMutation/);
});

function admin(registry, elevated = true) {
  return { ...registry.adapters, isCurrentProcessElevated: async () => elevated };
}

test('machine-wide settings are refused without administrator rights, for apply and for undo', async () => {
  const directory = userData();
  const registry = fakeRegistry('mpo', { exists: false });
  await assert.rejects(journal.setUserSetting(directory, 'mpo', false, admin(registry, false)), /requires Dialed to be running as administrator/);
  assert.deepEqual(registry.raw, { exists: false });
  assert.deepEqual(journal.readJournal(directory), []);
  const applied = await journal.setUserSetting(directory, 'mpo', false, admin(registry));
  await assert.rejects(journal.rollbackAuditEntry(directory, applied.entry.id, admin(registry, false)), /running as administrator/);
  assert.deepEqual(registry.raw, { exists: true, value: 5, kind: 'DWord' });
});

test('MPO is turned off by adding OverlayTestMode = 5 and back on by removing it', async () => {
  const directory = userData();
  const registry = fakeRegistry('mpo', { exists: false });
  assert.equal(settings.effectiveEnabled('mpo', { exists: false }), true);
  await assert.rejects(journal.setUserSetting(directory, 'mpo', true, admin(registry)), /already on/);
  const applied = await journal.setUserSetting(directory, 'mpo', false, admin(registry));
  assert.equal(applied.success, true);
  assert.equal(applied.entry.actionId, 'settings:machine:mpo');
  assert.equal(applied.entry.resultingState.effectiveState, 'PENDING_RESTART');
  assert.deepEqual(registry.raw, { exists: true, value: 5, kind: 'DWord' });
  await journal.rollbackAuditEntry(directory, applied.entry.id, admin(registry));
  assert.deepEqual(registry.raw, { exists: false });
});

test('MPO turned off by another tool can be turned back on, and that is undoable too', async () => {
  const directory = userData();
  const registry = fakeRegistry('mpo', { exists: true, value: 5, kind: 'DWord' });
  const applied = await journal.setUserSetting(directory, 'mpo', true, admin(registry));
  assert.deepEqual(registry.raw, { exists: false });
  await journal.rollbackAuditEntry(directory, applied.entry.id, admin(registry));
  assert.deepEqual(registry.raw, { exists: true, value: 5, kind: 'DWord' });
});

test('GPU scheduling with no value is unknown, not assumed, and can be set either way', async () => {
  assert.equal(settings.effectiveEnabled('gpu-scheduling', { exists: false }), null);
  assert.equal(settings.effectiveEnabled('gpu-scheduling', { exists: true, kind: 'DWord', value: 2 }), true);
  assert.equal(settings.effectiveEnabled('gpu-scheduling', { exists: true, kind: 'DWord', value: 1 }), false);
  assert.equal(settings.effectiveEnabled('gpu-scheduling', { exists: true, kind: 'DWord', value: 7 }), null);
  const directory = userData();
  const registry = fakeRegistry('gpu-scheduling', { exists: false });
  const applied = await journal.setUserSetting(directory, 'gpu-scheduling', true, admin(registry));
  assert.deepEqual(registry.raw, { exists: true, value: 2, kind: 'DWord' });
  await journal.rollbackAuditEntry(directory, applied.entry.id, admin(registry));
  assert.deepEqual(registry.raw, { exists: false }, 'undo hands the choice back to the driver');
});

test('a write that Windows does not confirm is recorded as unverified, not as applied', async () => {
  const directory = userData();
  const registry = fakeRegistry('mpo', { exists: false });
  const failing = { ...admin(registry), writeUserSettingValue: async () => ({ exitCode: 0, stdout: '', stderr: '', output: {} }) };
  const result = await journal.setUserSetting(directory, 'mpo', false, failing);
  assert.equal(result.success, false);
  const [entry] = journal.readJournal(directory);
  assert.notEqual(entry.status, 'SUCCESS');
});

test('policies are off when no value is set, written as the documented value, and removed on undo', async () => {
  const expected = { 'block-background-apps': 2, 'exclude-driver-updates': 1, 'no-auto-restart': 1 };
  for (const [id, value] of Object.entries(expected)) {
    const directory = userData();
    const registry = fakeRegistry(id, { exists: false });
    assert.equal(settings.effectiveEnabled(id, { exists: false }), false, id);
    const applied = await journal.setUserSetting(directory, id, true, admin(registry));
    assert.equal(applied.success, true, id);
    assert.deepEqual(registry.raw, { exists: true, value, kind: 'DWord' }, id);
    await journal.rollbackAuditEntry(directory, applied.entry.id, admin(registry));
    assert.deepEqual(registry.raw, { exists: false }, id);
  }
});

test('policies are refused on editions Microsoft does not document them for, and unknown editions are not blocked', () => {
  assert.equal(settings.editionFamily('Core'), 'home');
  assert.equal(settings.editionFamily('CoreSingleLanguage'), 'home');
  assert.equal(settings.editionFamily('Professional'), 'pro');
  assert.equal(settings.editionFamily('ProfessionalWorkstation'), 'pro');
  assert.equal(settings.editionFamily('EnterpriseS'), 'enterprise');
  assert.equal(settings.editionFamily('IoTEnterprise'), 'enterprise');
  assert.equal(settings.editionFamily('Education'), 'education');
  assert.equal(settings.editionFamily(''), 'unknown');
  for (const id of ['block-background-apps', 'exclude-driver-updates', 'no-auto-restart']) {
    const { editions } = settings.USER_SETTINGS[id];
    assert.equal(settings.editionSupport(editions, 'home').supported, false, id);
    assert.match(settings.editionSupport(editions, 'home').reason, /Windows Home ignores this policy/);
    assert.equal(settings.editionSupport(editions, 'pro').supported, true, id);
    assert.equal(settings.editionSupport(editions, 'unknown').supported, true, id);
  }
  // Ordinary settings carry no edition limit.
  assert.equal(settings.USER_SETTINGS['game-mode'].editions, undefined);
  assert.equal(settings.editionSupport(undefined, 'home').supported, true);
});

test('the main process checks the edition before turning on a policy, including the older consumer policy', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /if \(enabled\) await assertEditionSupports\(USER_SETTINGS\[settingId\]\.editions\);[\s\S]{0,400}?return serializeMutation/);
  assert.equal([...main.matchAll(/assertEditionSupports\(CONSUMER_FEATURES_EDITIONS\)/g)].length, 2);
  assert.match(main, /CONSUMER_FEATURES_EDITIONS = Object\.freeze\(\['enterprise', 'education'\]\)/);
});

test('background recording is reported as blocked while the Game DVR policy switches capture off', async () => {
  const run = (value) => async () => ({ stdout: JSON.stringify({ value }), stderr: '', exitCode: 0 });
  assert.match(await settings.blockingPolicyReason('background-recording', run(0)), /AllowGameDVR = 0/);
  assert.equal(await settings.blockingPolicyReason('background-recording', run(1)), null);
  assert.equal(await settings.blockingPolicyReason('background-recording', run(null)), null);
  assert.equal(await settings.blockingPolicyReason('game-mode', async () => { throw new Error('must not run'); }), null);
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /const blocked = await blockingPolicyReason\(settingId\)\.catch\(\(\) => null\);\s*if \(blocked\) throw new Error/);
});
