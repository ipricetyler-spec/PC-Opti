const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tempDir } = require('./helpers/temp-dir.cjs');
const journal = require('../src/main/journal/index.cjs');

test('the change log reaches the disk before it replaces the old one', async (t) => {
  const directory = tempDir('dialed-durable-');
  const calls = [];
  for (const name of ['fsyncSync', 'renameSync']) {
    const original = fs[name];
    t.mock.method(fs, name, (...args) => { calls.push(name); return original(...args); });
  }
  // Any journal write will do; a refused-by-limit append writes nothing, so use an apply.
  const fake = { values: { MouseSpeed: { exists: true, kind: 'String', value: '1' }, MouseThreshold1: { exists: true, kind: 'String', value: '6' }, MouseThreshold2: { exists: true, kind: 'String', value: '10' } } };
  const mouse = require('../src/main/mouse-acceleration/index.cjs');
  await journal.setMouseAcceleration(directory, false, {
    readMouseAcceleration: async () => ({ values: JSON.parse(JSON.stringify(fake.values)), enabled: mouse.accelerationEnabled(fake.values) }),
    writeMouseValues: async (next) => { fake.values = JSON.parse(JSON.stringify(next)); return { exitCode: 0, stdout: '', stderr: '', output: { written: true, appliedToSession: true } }; },
  });
  assert.ok(calls.length >= 2);
  for (let index = 0; index < calls.length; index += 1) {
    if (calls[index] === 'renameSync') assert.equal(calls[index - 1], 'fsyncSync', 'every rename follows a flush');
  }
  assert.deepEqual(fs.readdirSync(directory).filter((name) => name.endsWith('.tmp')), [], 'no temporary file is left');
});

test('a write that fails leaves the previous log and no temporary file', (t) => {
  const directory = tempDir('dialed-durable-');
  const entries = [{ id: '00000000-0000-4000-8000-000000000001', actionId: 'fixture', status: 'SUCCESS', rollback: { available: false, reason: '' } }];
  fs.writeFileSync(path.join(directory, 'journal.json'), JSON.stringify(entries));
  t.mock.method(fs, 'fsyncSync', () => { throw Object.assign(new Error('EIO: i/o error, fsync'), { code: 'EIO' }); });
  const preview = journal.createJournalDeletionPreview(journal.readJournal(directory), 'ALL_DELETABLE');
  assert.throws(() => journal.applyJournalDeletion(directory, preview), /EIO|i\/o error/);
  t.mock.restoreAll();
  assert.deepEqual(journal.readJournal(directory), entries, 'the old log is untouched');
  assert.deepEqual(fs.readdirSync(directory).filter((name) => name.endsWith('.tmp')), []);
});
