const assert = require('node:assert/strict');
const { test } = require('node:test');
const { tempDir } = require('./helpers/temp-dir.cjs');
const scheduler = require('../src/main/multimedia-scheduler/index.cjs');
const journal = require('../src/main/journal/index.cjs');
const capabilities = require('../src/main/capabilities/index.cjs');

const dword = (value) => ({ exists: true, kind: 'DWord', value });
const text = (value) => ({ exists: true, kind: 'String', value });
const defaults = () => ({
  'system-responsiveness': dword(20), 'network-throttling': dword(10), 'games-gpu-priority': dword(8),
  'games-priority': dword(2), 'games-scheduling-category': text('Medium'), 'games-sfio-priority': text('Normal'),
});
// What a common tweak script leaves behind (read on the owner's PC, 2026-10-06).
const tweaked = () => ({ ...defaults(), 'system-responsiveness': dword(10), 'network-throttling': dword(4294967295), 'games-priority': dword(6), 'games-scheduling-category': text('High'), 'games-sfio-priority': text('High') });

function fakes(values, elevated = true) {
  const state = { values: JSON.parse(JSON.stringify(values)), writes: [] };
  return {
    state,
    readMultimediaScheduler: async () => ({ values: JSON.parse(JSON.stringify(state.values)), changed: scheduler.changedValues(state.values).map((item) => item.id) }),
    writeMultimediaScheduler: async (next, ids) => { scheduler.assertRestorableValues(next); state.writes.push([...ids]); for (const id of ids) state.values[id] = { ...next[id] }; return { output: { written: true }, stdout: '', stderr: '', exitCode: 0 }; },
    isCurrentProcessElevated: async () => elevated,
  };
}

test('the Windows defaults are recognised, and a missing value counts as the default', () => {
  assert.deepEqual(scheduler.changedValues(defaults()), []);
  assert.equal(scheduler.describeChanges(defaults()), 'Windows defaults');
  const missing = { ...defaults(), 'network-throttling': { exists: false, kind: null, value: null } };
  assert.deepEqual(scheduler.changedValues(missing), []);
  assert.deepEqual(scheduler.changedValues(tweaked()).map((item) => item.id), ['system-responsiveness', 'network-throttling', 'games-priority', 'games-scheduling-category', 'games-sfio-priority']);
  assert.equal(scheduler.describeChanges(tweaked()), '5 of 6 values changed by another program or tool');
  // A number stored as text is a change, not the default.
  assert.equal(scheduler.changedValues({ ...defaults(), 'games-priority': text('2') }).length, 1);
});

test('only plain numbers and short words can be written back', () => {
  assert.doesNotThrow(() => scheduler.assertRestorableValues(tweaked()));
  assert.throws(() => scheduler.assertRestorableValues({ ...defaults(), 'games-sfio-priority': text("High'; Remove-Item") }), /not a plain word/);
  assert.throws(() => scheduler.assertRestorableValues({ ...defaults(), 'games-priority': dword(-1) }), /not a valid number/);
  assert.throws(() => scheduler.assertRestorableValues({ ...defaults(), 'games-priority': text('High') }), /not stored as expected/);
  assert.throws(() => scheduler.assertRestorableValues(null), /not valid/);
});

test('returning to defaults writes only the changed values, verifies them, and Undo restores them exactly', async () => {
  const directory = tempDir('dialed-mmcss-');
  const adapters = fakes(tweaked());
  const result = await journal.setMultimediaSchedulerDefaults(directory, adapters);
  assert.equal(result.success, true);
  assert.equal(result.entry.capabilityId, 'system:multimedia-scheduler');
  assert.equal(result.entry.title, 'Multimedia scheduler: return to Windows defaults');
  assert.deepEqual(adapters.state.writes, [['system-responsiveness', 'network-throttling', 'games-priority', 'games-scheduling-category', 'games-sfio-priority']], 'GPU Priority, already the default, is not touched');
  assert.deepEqual(adapters.state.values, defaults());
  await journal.rollbackAuditEntry(directory, result.entry.id, adapters);
  assert.deepEqual(adapters.state.values, tweaked());
});

test('Undo is refused when a value changed again after Dialed set it', async () => {
  const directory = tempDir('dialed-mmcss-');
  const adapters = fakes(tweaked());
  const result = await journal.setMultimediaSchedulerDefaults(directory, adapters);
  adapters.state.values['system-responsiveness'] = dword(0);
  await assert.rejects(() => journal.rollbackAuditEntry(directory, result.entry.id, adapters), /changed after Dialed set them\. Restore was refused/);
  assert.deepEqual(adapters.state.values['system-responsiveness'], dword(0));
});

test('nothing is written without administrator rights or when everything is already the default', async () => {
  const denied = fakes(tweaked(), false);
  await assert.rejects(() => journal.setMultimediaSchedulerDefaults(tempDir('dialed-mmcss-'), denied), /administrator/);
  assert.deepEqual(denied.state.writes, []);
  const clean = fakes(defaults());
  await assert.rejects(() => journal.setMultimediaSchedulerDefaults(tempDir('dialed-mmcss-'), clean), /already the Windows defaults\. Nothing was changed/);
  assert.deepEqual(clean.state.writes, []);
  const odd = fakes({ ...tweaked(), 'games-sfio-priority': text('Very-High!') });
  await assert.rejects(() => journal.setMultimediaSchedulerDefaults(tempDir('dialed-mmcss-'), odd), /not a plain word/);
  assert.deepEqual(odd.state.writes, []);
});

test('the change maps to its own administrator capability and claims no benefit', () => {
  const capability = capabilities.capabilityForAction('settings:machine:multimedia-scheduler');
  assert.equal(capability.id, 'system:multimedia-scheduler');
  assert.equal(capability.privilegeRequirement, 'Administrator');
  assert.match(capability.expectedBenefit, /^None claimed\./);
  assert.match(capabilities.capabilityForAction('settings:machine:processor-scheduling').expectedBenefit, /^None claimed\./);
});
