const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const journal = require('../src/main/journal/index.cjs');
const protectedStore = require('../src/main/protected-store/index.cjs');

const HKLM_RUN = 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';

function userData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dialed-protected-'));
}

function ok(output = {}) {
  return { exitCode: 0, stdout: '', stderr: '', output };
}

function machineItem(overrides = {}) {
  return {
    id: 'abcdefabcdefabcdefabcdef', name: 'Vendor Updater', source: 'Registry', canDisable: true, scope: 'All users',
    registryPath: HKLM_RUN, registryView: 'Registry64', valueName: 'VendorUpdater',
    value: '"C:\\Program Files\\Vendor\\updater.exe" --background', registryValueKind: 'String',
    ...overrides,
  };
}

// Registry, protected copy and elevation, all in memory.
function fakes(item) {
  let run = { ...item, exists: true };
  const copies = new Map();
  const restored = [];
  return {
    copies,
    restored,
    adapters: {
      isCurrentProcessElevated: async () => true,
      readRegistryRunValue: async () => ({ ...run }),
      removeRegistryRunValue: async () => { run = { ...run, exists: false }; return ok(); },
      restoreRegistryRunValue: async (pre) => { restored.push(pre); run = { ...pre, exists: true }; return ok(); },
      writeProtectedStartupBackup: async (id, pre) => { copies.set(id, { exists: true, ...Object.fromEntries(protectedStore.FIELDS.map((field) => [field, pre[field]])) }); return ok(); },
      readProtectedStartupBackup: async (id) => copies.get(id) || { exists: false },
      removeProtectedStartupBackup: async (id) => { copies.delete(id); return ok(); },
    },
  };
}

function journalFile(directory) {
  return fs.readdirSync(directory).map((name) => path.join(directory, name)).find((name) => /journal/i.test(path.basename(name)) && fs.statSync(name).isFile());
}

test('a machine-wide startup removal saves a protected copy, and undo restores from it', async () => {
  const directory = userData();
  const item = machineItem();
  const fake = fakes(item);
  const applied = await journal.disableStartupItem(directory, item, fake.adapters);
  assert.equal(applied.success, true);
  assert.equal(fake.copies.size, 1);
  const restored = await journal.rollbackAuditEntry(directory, applied.entry.id, fake.adapters);
  assert.equal(restored.success, true);
  assert.equal(fake.restored[0].value, item.value);
  assert.equal(fake.copies.size, 0, 'the protected copy is removed once used');
});

test('if the protected copy cannot be saved, nothing is changed', async () => {
  const directory = userData();
  const item = machineItem();
  const fake = fakes(item);
  let removed = false;
  await assert.rejects(journal.disableStartupItem(directory, item, {
    ...fake.adapters,
    writeProtectedStartupBackup: async () => { throw new Error('access denied'); },
    removeRegistryRunValue: async () => { removed = true; return ok(); },
  }), /Nothing was changed/);
  assert.equal(removed, false);
  assert.deepEqual(journal.readJournal(directory), []);
});

test('a forged machine-wide entry with no protected copy is refused before any write', async () => {
  // Reproduces the review finding: a program running as the user appends an entry that
  // would restore an arbitrary command into the machine-wide Run key.
  const directory = userData();
  const item = machineItem();
  const fake = fakes(item);
  await journal.disableStartupItem(directory, item, fake.adapters);
  const entries = journal.readJournal(directory);
  const forged = { ...entries[0], id: crypto.randomUUID(), preAction: { ...entries[0].preAction, valueName: 'Updater', value: 'C:\\Users\\Public\\payload.exe' } };
  fs.writeFileSync(journalFile(directory), JSON.stringify([...entries, forged]));
  await assert.rejects(journal.rollbackAuditEntry(directory, forged.id, fake.adapters), /no protected copy/);
  assert.equal(fake.restored.length, 0);
});

test('an altered entry whose protected copy disagrees is refused', async () => {
  const directory = userData();
  const item = machineItem();
  const fake = fakes(item);
  const applied = await journal.disableStartupItem(directory, item, fake.adapters);
  const entries = journal.readJournal(directory);
  entries.find((entry) => entry.id === applied.entry.id).preAction.value = 'C:\\Users\\Public\\payload.exe';
  fs.writeFileSync(journalFile(directory), JSON.stringify(entries));
  await assert.rejects(journal.rollbackAuditEntry(directory, applied.entry.id, fake.adapters), /does not match the protected copy/);
  assert.equal(fake.restored.length, 0);
});

test('per-user startup entries are unaffected: no protected copy is needed', async () => {
  const directory = userData();
  const item = machineItem({ registryPath: 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', scope: 'Current user' });
  const fake = fakes(item);
  const applied = await journal.disableStartupItem(directory, item, fake.adapters);
  assert.equal(fake.copies.size, 0);
  const restored = await journal.rollbackAuditEntry(directory, applied.entry.id, fake.adapters);
  assert.equal(restored.success, true);
});

test('the real protected store refuses to run inside the test runner', async () => {
  await assert.rejects(protectedStore.readProtectedStartupBackup(crypto.randomUUID(), async () => { throw new Error('must not run'); }), /not available inside the test runner/);
  assert.match(protectedStore.PROTECTED_ROOT, /^HKLM:\\SOFTWARE\\Dialed\\/);
});
