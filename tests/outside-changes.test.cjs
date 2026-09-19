const test = require('node:test');
const { tempDir } = require('./helpers/temp-dir.cjs');
const assert = require('node:assert/strict');
const path = require('node:path');

const journal = require('../src/main/journal/index.cjs');
const timing = require('../src/main/timing/index.cjs');
const settings = require('../src/main/user-settings/index.cjs');

// Fakes only: nothing here reaches the real boot configuration or registry.
const bootState = (overrides = {}) => ({ source: 'bcdedit /enum ACTIVE', usePlatformClock: null, disableDynamicTick: null, ...overrides });
const backup = () => ({ relativePath: path.join('safety-backups', 'bcd', 'fixture.bcd'), bytes: 12, sha256: 'a'.repeat(64), createdAt: '2026-09-19T00:00:00.000Z' });

test('dynamic tick set by another tool can be returned to the Windows default, and undone', async () => {
  const directory = tempDir('dialed-outside-');
  const state = { current: bootState({ disableDynamicTick: 'YES' }) };
  const commands = [];
  const applied = await journal.executeTimingAction(directory, timing.TIMING_ACTIONS.RESTORE_DEFAULT_DYNAMIC_TICK, {
    isCurrentProcessElevated: async () => true,
    readBootTimingState: async () => state.current,
    createBcdBackup: async () => backup(),
    applyBootTimingAction: async (actionId) => { commands.push(actionId); state.current = bootState(); return { output: {}, stdout: '', stderr: '', exitCode: 0 }; },
  });
  assert.equal(applied.success, true);
  assert.deepEqual(commands, ['timing:restore-default-dynamic-tick']);
  assert.equal(applied.entry.capabilityId, 'timing:restore-default-dynamic-tick');

  let restored = null;
  const undone = await journal.rollbackAuditEntry(directory, applied.entry.id, {
    isCurrentProcessElevated: async () => true,
    readBootTimingState: async () => state.current,
    restoreBootTimingAction: async (preAction) => { restored = preAction; state.current = bootState({ disableDynamicTick: 'YES' }); return { output: {}, stdout: '', stderr: '', exitCode: 0 }; },
  });
  assert.equal(undone.success, true);
  assert.equal(restored.state.disableDynamicTick, 'YES');
});

test('returning dynamic tick to the default is refused without admin rights or when already default', async () => {
  const directory = tempDir('dialed-outside-');
  let writes = 0;
  const adapters = (elevated, current) => ({
    isCurrentProcessElevated: async () => elevated,
    readBootTimingState: async () => current,
    createBcdBackup: async () => backup(),
    applyBootTimingAction: async () => { writes += 1; },
  });
  await assert.rejects(journal.executeTimingAction(directory, timing.TIMING_ACTIONS.RESTORE_DEFAULT_DYNAMIC_TICK, adapters(false, bootState({ disableDynamicTick: 'YES' }))), /running as administrator/);
  await assert.rejects(journal.executeTimingAction(directory, timing.TIMING_ACTIONS.RESTORE_DEFAULT_DYNAMIC_TICK, adapters(true, bootState())), /already uses the Windows default/);
  assert.equal(writes, 0);
});

test('the dynamic tick card offers a return to default only when a value is present', () => {
  const tick = (state) => timing.timingExperimentsForState(state).find((item) => item.id === 'consistent-tick-experiment');
  assert.equal(tick(bootState({ disableDynamicTick: 'YES' })).restoreDefaultActionId, 'timing:restore-default-dynamic-tick');
  assert.equal(tick(bootState({ disableDynamicTick: 'NO' })).restoreDefaultActionId, 'timing:restore-default-dynamic-tick');
  assert.equal(tick(bootState()).restoreDefaultActionId, null);
});

test('a value is flagged as differing from the Windows default only when it does', () => {
  const dword = (value) => ({ exists: true, kind: 'DWord', value });
  assert.equal(settings.differsFromWindowsDefault('global-timer-resolution', dword(1)), true);
  assert.equal(settings.differsFromWindowsDefault('global-timer-resolution', { exists: false }), false);
  assert.equal(settings.differsFromWindowsDefault('mpo', dword(5)), true);
  assert.equal(settings.differsFromWindowsDefault('game-mode', dword(1)), false, 'on is already the default');
  // Hardware GPU scheduling has no single Windows default, so it is never flagged.
  assert.equal(settings.differsFromWindowsDefault('gpu-scheduling', dword(2)), false);
});

test('Windows Home gets an honest note instead of a driver-update switch', () => {
  const reason = settings.unsupportedReasonFor('exclude-driver-updates', 'home', 'Windows Home ignores this policy.');
  assert.match(reason, /has no setting Microsoft documents/);
  assert.match(reason, /Optional updates are not installed automatically/);
  assert.equal(settings.unsupportedReasonFor('no-auto-restart', 'home', 'X'), 'X');
  assert.equal(settings.unsupportedReasonFor('exclude-driver-updates', 'pro', 'X'), 'X');
});

test('a policy this edition ignores can still be removed, and the removal is recorded and undoable', async () => {
  const directory = tempDir('dialed-outside-');
  const state = { exists: true, kind: 'DWord', value: 1 };
  const adapters = {
    readUserSetting: async (settingId) => ({ settingId, ...state, value: state.exists ? state.value : null, enabled: settings.effectiveEnabled(settingId, state) }),
    writeUserSettingValue: async (_id, value) => { Object.assign(state, { exists: true, kind: 'DWord', value }); return { output: {}, stdout: '', stderr: '', exitCode: 0 }; },
    removeUserSettingValue: async () => { Object.assign(state, { exists: false, kind: null, value: null }); return { output: {}, stdout: '', stderr: '', exitCode: 0 }; },
    isCurrentProcessElevated: async () => true,
  };
  const removed = await journal.setUserSetting(directory, 'exclude-driver-updates', false, adapters);
  assert.equal(removed.success, true);
  assert.equal(state.exists, false);
  await journal.rollbackAuditEntry(directory, removed.entry.id, adapters);
  assert.deepEqual(state, { exists: true, kind: 'DWord', value: 1 });
});
