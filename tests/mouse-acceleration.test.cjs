const test = require('node:test');
const { tempDir } = require('./helpers/temp-dir.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const journal = require('../src/main/journal/index.cjs');
const capabilities = require('../src/main/capabilities/index.cjs');
const mouse = require('../src/main/mouse-acceleration/index.cjs');

function userData() {
  return tempDir('dialed-mouse-');
}

function values(speed, t1, t2) {
  return { MouseSpeed: { exists: true, kind: 'String', value: speed }, MouseThreshold1: { exists: true, kind: 'String', value: t1 }, MouseThreshold2: { exists: true, kind: 'String', value: t2 } };
}

function fakeMouse(initial) {
  const state = { values: JSON.parse(JSON.stringify(initial)) };
  return {
    state,
    adapters: {
      readMouseAcceleration: async () => ({ values: JSON.parse(JSON.stringify(state.values)), enabled: mouse.accelerationEnabled(state.values) }),
      writeMouseValues: async (next) => {
        mouse.assertCapturedValues(next);
        state.values = JSON.parse(JSON.stringify(next));
        return { exitCode: 0, stdout: '', stderr: '', output: { written: true, appliedToSession: true } };
      },
    },
  };
}

test('on, off and custom states are read the way Windows treats them', () => {
  assert.equal(mouse.accelerationEnabled(values('1', '6', '10')), true);
  assert.equal(mouse.accelerationEnabled(values('0', '0', '0')), false);
  assert.equal(mouse.accelerationEnabled(values('2', '4', '12')), true, 'any non-zero speed is on');
  assert.equal(mouse.accelerationEnabled({ ...values('1', '6', '10'), MouseSpeed: { exists: false, kind: null, value: null } }), null);
  assert.equal(capabilities.capabilityForAction('settings:user:mouse-acceleration').id, 'input:mouse-acceleration');
});

test('turning acceleration off writes 0/0/0, and undo restores the exact previous values', async () => {
  const directory = userData();
  const fake = fakeMouse(values('1', '6', '10'));
  const applied = await journal.setMouseAcceleration(directory, false, fake.adapters);
  assert.equal(applied.success, true);
  assert.equal(applied.entry.rollback.kind, 'restore-mouse-acceleration');
  assert.deepEqual(fake.state.values, values('0', '0', '0'));
  await assert.rejects(journal.setMouseAcceleration(directory, false, fake.adapters), /already off/);
  const restored = await journal.rollbackAuditEntry(directory, applied.entry.id, fake.adapters);
  assert.equal(restored.success, true);
  assert.deepEqual(fake.state.values, values('1', '6', '10'));
});

test('custom thresholds are captured and put back exactly', async () => {
  const directory = userData();
  const fake = fakeMouse(values('2', '4', '12'));
  const applied = await journal.setMouseAcceleration(directory, false, fake.adapters);
  await journal.rollbackAuditEntry(directory, applied.entry.id, fake.adapters);
  assert.deepEqual(fake.state.values, values('2', '4', '12'));
});

test('undo is refused when the mouse settings changed after Dialed set them', async () => {
  const directory = userData();
  const fake = fakeMouse(values('1', '6', '10'));
  const applied = await journal.setMouseAcceleration(directory, false, fake.adapters);
  fake.state.values = values('1', '6', '10');
  await assert.rejects(journal.rollbackAuditEntry(directory, applied.entry.id, fake.adapters), /changed after Dialed set them/);
});

test('values that are not plain numbers are never written or restored', async () => {
  const fake = fakeMouse({ ...values('1', '6', '10'), MouseSpeed: { exists: true, kind: 'String', value: "1'; Remove-Item C:\\ -Recurse; '" } });
  await assert.rejects(journal.setMouseAcceleration(userData(), false, fake.adapters), /not plain numbers/);
  assert.throws(() => mouse.assertCapturedValues(values('1', '6', '1e9')), /not plain numbers/);
  assert.throws(() => mouse.assertCapturedValues({ MouseSpeed: { exists: true, kind: 'DWord', value: '1' } }), /not/);
  // The real writer checks too, before any script is built.
  await assert.rejects(mouse.writeMouseValues(values("0'", '0', '0'), async () => { throw new Error('script must not run'); }), /not plain numbers/);
});

test('a tampered journal entry cannot restore arbitrary text', async () => {
  const directory = userData();
  const fake = fakeMouse(values('1', '6', '10'));
  const applied = await journal.setMouseAcceleration(directory, false, fake.adapters);
  const file = fs.readdirSync(directory).map((name) => path.join(directory, name)).find((name) => /journal/i.test(path.basename(name)) && fs.statSync(name).isFile());
  const entries = journal.readJournal(directory);
  entries.find((entry) => entry.id === applied.entry.id).preAction.values.MouseSpeed.value = '$(calc)';
  fs.writeFileSync(file, JSON.stringify(entries));
  await assert.rejects(journal.rollbackAuditEntry(directory, applied.entry.id, fake.adapters), /not plain numbers/);
  assert.deepEqual(fake.state.values, values('0', '0', '0'));
});

test('the live update passes thresholds then speed, as SPI_SETMOUSE expects', async () => {
  let script = '';
  await mouse.writeMouseValues(values('1', '6', '10'), async (text) => { script = text; return { stdout: '{"written":true,"appliedToSession":true}', stderr: '', exitCode: 0 }; });
  assert.match(script, /SystemParametersInfo\(4, 0, \[int\[\]\]@\(6, 10, 1\), 2\)/);
  assert.match(script, /-Name 'MouseSpeed' -PropertyType String -Value '1'/);
});

test('a full change history refuses a new change before Windows is touched, and still leaves room to undo', async () => {
  const directory = userData();
  const fake = fakeMouse(values('1', '6', '10'));
  const applied = await journal.setMouseAcceleration(directory, false, fake.adapters);
  const journalFile = path.join(directory, 'journal.json');
  const padTo = (count) => {
    const entries = JSON.parse(fs.readFileSync(journalFile, 'utf8'));
    while (entries.length < count) entries.push({ id: `filler-${entries.length}`, actionId: 'fixture', status: 'SUCCESS', rollback: { available: false, reason: '' } });
    fs.writeFileSync(journalFile, JSON.stringify(entries));
  };
  padTo(950);

  const other = fakeMouse(values('1', '6', '10'));
  await assert.rejects(journal.setMouseAcceleration(directory, false, other.adapters), /change history is full/);
  assert.deepEqual(other.state.values, values('1', '6', '10'), 'nothing was written');
  assert.equal(journal.readJournal(directory).length, 950, 'the log is unchanged and still readable');

  const restored = await journal.rollbackAuditEntry(directory, applied.entry.id, fake.adapters);
  assert.equal(restored.success, true, 'undo still has room');
  assert.equal(journal.readJournal(directory).length, 951);

  padTo(1000);
  const again = await journal.setMouseAcceleration(userData(), false, fakeMouse(values('1', '6', '10')).adapters);
  assert.equal(again.success, true, 'an ordinary log is unaffected');
  assert.equal(journal.readJournal(directory).length, 1000, 'a log at the reading limit is still readable');
});
