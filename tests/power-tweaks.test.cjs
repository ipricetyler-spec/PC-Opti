const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const journal = require('../src/main/journal/index.cjs');
const power = require('../src/main/power-tweaks/index.cjs');

const BALANCED = '381b4222-f694-41f0-9685-ff5bb260df2e';
const HIGH = '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c';
const NEW = '0f3c2a44-1111-4a2b-9c3d-123456789abc';

function userData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dialed-power-'));
}

function fakePlans(items, activeGuid = BALANCED) {
  const state = { items: items.map((item) => ({ ...item })), activeGuid, cpu: { [BALANCED]: { ac: 5, dc: 5 }, [HIGH]: { ac: 100, dc: 5 } } };
  return {
    state,
    adapters: {
      listPowerPlans: async () => ({ items: state.items.map((item) => ({ ...item, active: item.guid === state.activeGuid })), activeGuid: state.activeGuid }),
      duplicateUltimatePlan: async () => { state.items.push({ guid: NEW, name: 'Ultimate Performance' }); return { exitCode: 0, stdout: '', stderr: '', output: {} }; },
      deletePowerPlan: async (guid) => { state.items = state.items.filter((item) => item.guid !== guid); return { exitCode: 0, stdout: '', stderr: '', output: {} }; },
      readCpuMinimumState: async (guid) => ({ schemeGuid: guid, ...state.cpu[guid] }),
      writeCpuMinimumAc: async (guid, percent) => { state.cpu[guid] = { ...state.cpu[guid], ac: percent }; return { exitCode: 0, stdout: '', stderr: '', output: {} }; },
    },
  };
}

const PLANS = [{ guid: BALANCED, name: 'Balanced' }, { guid: HIGH, name: 'High performance' }];

test('powercfg query output is read by its last two hex values, in any language', () => {
  const english = 'Power Setting GUID: 893dee8e (Minimum processor state)\n  Minimum Possible Setting: 0x00000000\n  Maximum Possible Setting: 0x00000064\n  Possible Settings increment: 0x00000001\n  Current AC Power Setting Index: 0x00000005\n  Current DC Power Setting Index: 0x0000000a';
  assert.deepEqual(power.parseSettingIndexes(english), { ac: 5, dc: 10 });
  const german = 'Mindestwert: 0x00000000\nHöchstwert: 0x00000064\nSchritt: 0x00000001\nAktueller Wechselstrom-Index: 0x00000064\nAktueller Gleichstrom-Index: 0x00000005';
  assert.deepEqual(power.parseSettingIndexes(german), { ac: 100, dc: 5 });
  assert.throws(() => power.parseSettingIndexes('0x000000ff\n0x00000005'), /outside 0–100%/);
  assert.throws(() => power.parseSettingIndexes('nothing here'), /did not report/);
});

test('the Ultimate plan is added without being activated, and undo removes only that copy', async () => {
  const directory = userData();
  const fake = fakePlans(PLANS);
  const applied = await journal.addUltimatePlan(directory, fake.adapters);
  assert.equal(applied.success, true);
  assert.equal(applied.entry.resultingState.createdGuid, NEW);
  assert.equal(fake.state.activeGuid, BALANCED, 'adding a plan never switches to it');
  await assert.rejects(journal.addUltimatePlan(directory, fake.adapters), /already in your plan list/);
  const restored = await journal.rollbackAuditEntry(directory, applied.entry.id, fake.adapters);
  assert.equal(restored.success, true);
  assert.deepEqual(fake.state.items.map((item) => item.guid), [BALANCED, HIGH]);
});

test('undo will not delete the Ultimate plan while it is active, or after it was renamed', async () => {
  const directory = userData();
  const fake = fakePlans(PLANS);
  const applied = await journal.addUltimatePlan(directory, fake.adapters);
  fake.state.activeGuid = NEW;
  await assert.rejects(journal.rollbackAuditEntry(directory, applied.entry.id, fake.adapters), /is active/);
  fake.state.activeGuid = BALANCED;
  fake.state.items.find((item) => item.guid === NEW).name = 'My tuned plan';
  await assert.rejects(journal.rollbackAuditEntry(directory, applied.entry.id, fake.adapters), /renamed/);
  assert.ok(fake.state.items.some((item) => item.guid === NEW));
});

test('a tampered entry cannot point undo at a plan that existed before', async () => {
  const directory = userData();
  const fake = fakePlans(PLANS);
  const applied = await journal.addUltimatePlan(directory, fake.adapters);
  const file = fs.readdirSync(directory).map((name) => path.join(directory, name)).find((name) => /journal/i.test(path.basename(name)) && fs.statSync(name).isFile());
  const entries = journal.readJournal(directory);
  entries.find((entry) => entry.id === applied.entry.id).resultingState.createdGuid = HIGH;
  fs.writeFileSync(file, JSON.stringify(entries));
  await assert.rejects(journal.rollbackAuditEntry(directory, applied.entry.id, fake.adapters), /existed before/);
  assert.ok(fake.state.items.some((item) => item.guid === HIGH));
  await assert.rejects(power.deletePowerPlan(power.ULTIMATE_SOURCE_GUID, async () => { throw new Error('must not run'); }), /never deleted/);
});

test('CPU minimum state is set to 100% on the active plan when plugged in, and restored exactly', async () => {
  const directory = userData();
  const fake = fakePlans(PLANS);
  const applied = await journal.setCpuMinimumState(directory, fake.adapters);
  assert.equal(applied.success, true);
  assert.deepEqual(fake.state.cpu[BALANCED], { ac: 100, dc: 5 }, 'battery value unchanged');
  await assert.rejects(journal.setCpuMinimumState(directory, fake.adapters), /already 100%/);
  await journal.rollbackAuditEntry(directory, applied.entry.id, fake.adapters);
  assert.deepEqual(fake.state.cpu[BALANCED], { ac: 5, dc: 5 });
});

test('CPU minimum state undo is refused if the value changed since', async () => {
  const directory = userData();
  const fake = fakePlans(PLANS);
  const applied = await journal.setCpuMinimumState(directory, fake.adapters);
  fake.state.cpu[BALANCED].ac = 50;
  await assert.rejects(journal.rollbackAuditEntry(directory, applied.entry.id, fake.adapters), /changed after Dialed set it/);
  assert.equal(fake.state.cpu[BALANCED].ac, 50);
});

test('powercfg commands only ever carry fixed GUIDs and a checked percentage', async () => {
  const scripts = [];
  const run = async (script) => { scripts.push(script); return { stdout: 'Current AC Power Setting Index: 0x00000005\nCurrent DC Power Setting Index: 0x00000005', stderr: '', exitCode: 0 }; };
  await power.writeCpuMinimumAc(BALANCED, 100, run);
  await assert.rejects(power.writeCpuMinimumAc(BALANCED, 101, run), /0–100%/);
  await assert.rejects(power.readCpuMinimumState('x; Remove-Item C:', run), /not valid/);
  assert.match(scripts[0], new RegExp(`/setacvalueindex ${BALANCED} ${power.SUB_PROCESSOR} ${power.PROCTHROTTLEMIN} 100`));
  assert.doesNotMatch(scripts[0], /setdcvalueindex/);
});
