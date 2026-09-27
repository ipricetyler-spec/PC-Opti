const test = require('node:test');
const { tempDir } = require('./helpers/temp-dir.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const journal = require('../src/main/journal/index.cjs');
const protectedData = require('../src/main/protected-data/index.cjs');

test('the change log moves once into the protected folder and is used from there', () => {
  const userData = tempDir('dialed-user-');
  const locked = path.join(tempDir('dialed-protected-'), 'Journal');
  const entries = [{ id: '00000000-0000-4000-8000-000000000001', actionId: 'fixture', status: 'SUCCESS', rollback: { available: false, reason: '' } }];
  fs.writeFileSync(path.join(userData, 'journal.json'), JSON.stringify(entries));

  assert.deepEqual(journal.useProtectedJournalDirectory(userData, locked), { migrated: true });
  assert.deepEqual(journal.readJournal(userData), entries, 'reads through the same user-data path');
  assert.ok(fs.existsSync(path.join(locked, 'journal.json')));
  assert.ok(!fs.existsSync(path.join(userData, 'journal.json')), 'the old copy is no longer the active log');
  assert.ok(fs.readdirSync(userData).some((name) => name.startsWith('journal.moved-to-protected-folder.')), 'the old copy is kept, renamed');

  // A forged per-user journal written afterwards is never read.
  fs.writeFileSync(path.join(userData, 'journal.json'), JSON.stringify([{ id: 'forged' }]));
  assert.deepEqual(journal.readJournal(userData), entries);
  assert.deepEqual(journal.useProtectedJournalDirectory(userData, locked), { migrated: false }, 'an existing protected log is never overwritten');
  assert.deepEqual(journal.readJournal(userData), entries);
});

test('a change log with an unfinished recovery is not moved', () => {
  const userData = tempDir('dialed-user-');
  fs.writeFileSync(path.join(userData, 'journal.json'), '[]');
  fs.writeFileSync(path.join(userData, '.journal-recovery.2026-09-19T00-00-00-000Z.01234567-89ab-4cde-8f01-23456789abcd.pending'), '{');
  assert.throws(() => journal.useProtectedJournalDirectory(userData, path.join(tempDir('dialed-protected-'), 'Journal')), /unfinished recovery/);
});

test('the protected folder is only accepted at a ProgramData path Dialed chose', async () => {
  const fake = (root) => async () => ({ stdout: JSON.stringify({ root, programData: 'C:\\ProgramData', created: true }) });
  assert.deepEqual(await protectedData.ensureProtectedDataRoot(fake('C:\\ProgramData\\Dialed')), { root: 'C:\\ProgramData\\Dialed', created: true });
  assert.equal((await protectedData.ensureProtectedDataRoot(fake('C:\\ProgramData\\Dialed-0123456789ab'))).root, 'C:\\ProgramData\\Dialed-0123456789ab');
  for (const bad of ['C:\\Users\\Public\\Dialed', 'C:\\ProgramData\\Other', '\\\\server\\share\\Dialed', 'C:\\ProgramData\\Dialed\\..\\Evil']) {
    await assert.rejects(protectedData.ensureProtectedDataRoot(fake(bad)), /unexpected protected folder path/, bad);
  }
  await assert.rejects(protectedData.ensureProtectedDataRoot(), /not available inside the test runner/);
});

test('the protected-folder script never trusts a folder by name alone', () => {
  const script = protectedData.SCRIPT;
  assert.match(script, /GetFolderPath\(\[Environment\+SpecialFolder\]::CommonApplicationData\)/, 'not the overridable environment variable');
  assert.match(script, /AreAccessRulesProtected/);
  assert.match(script, /ReparsePoint/);
  assert.match(script, /\[System\.IO\.Directory\]::CreateDirectory\(\$path, \$security\)/, 'created already locked');
  assert.match(script, /S-1-5-32-544/);
  assert.match(script, /S-1-5-18/);
});

test('files written into the protected folder cannot be unlocked by their owner', () => {
  // Elevated writes are owned by the signed-in user; OWNER RIGHTS removes the owner's
  // implicit right to change permissions. Verified live from a non-elevated process.
  assert.match(protectedData.SCRIPT, /S-1-3-4/);
  assert.match(protectedData.SCRIPT, /\$ownerRightsAllowed = \[System\.Security\.AccessControl\.FileSystemRights\]'ReadAttributes, Synchronize'/);
});

test('the packaged app enables Electron integrity fuses', () => {
  const fuses = require('../package.json').build.electronFuses;
  assert.deepEqual(fuses, {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
  });
});

// Each start of Dialed is a new process, so these load the journal module fresh.
function freshJournal() {
  delete require.cache[require.resolve('../src/main/journal/index.cjs')];
  return require('../src/main/journal/index.cjs');
}

test('once the change log has been protected, a start that cannot open the folder pauses changes', () => {
  const userData = tempDir('dialed-user-');
  const locked = path.join(tempDir('dialed-protected-'), 'Journal');
  const entries = [{ id: '00000000-0000-4000-8000-000000000001', actionId: 'fixture', status: 'SUCCESS', rollback: { available: false, reason: '' } }];
  fs.writeFileSync(path.join(userData, 'journal.json'), JSON.stringify(entries));
  freshJournal().useProtectedJournalDirectory(userData, locked);

  const failedStart = freshJournal();
  assert.equal(failedStart.pauseJournalIfProtectedBefore(userData), true);
  assert.throws(() => failedStart.readJournal(userData), /changes and undo are paused/);
  const state = failedStart.inspectJournalRecovery(userData);
  assert.equal(state.recovery.issueCode, 'PROTECTED_UNAVAILABLE');
  assert.match(state.recovery.reason, /Restart Dialed/);
  assert.ok(!fs.existsSync(path.join(userData, 'journal.json')), 'nothing was recorded in per-user data');

  // A first start that never had a protected log keeps using per-user data, as before.
  const neverProtected = tempDir('dialed-user-');
  const firstStart = freshJournal();
  assert.equal(firstStart.pauseJournalIfProtectedBefore(neverProtected), false);
  assert.deepEqual(firstStart.readJournal(neverProtected), []);

  // The next normal start reads the protected log again.
  const normal = freshJournal();
  normal.useProtectedJournalDirectory(userData, locked);
  assert.deepEqual(normal.readJournal(userData), entries);
});

test('a per-user log written while the folder was unavailable is kept aside and reported, never undone from', () => {
  const userData = tempDir('dialed-user-');
  const locked = path.join(tempDir('dialed-protected-'), 'Journal');
  const kept = [{ id: '00000000-0000-4000-8000-000000000001', actionId: 'fixture', status: 'SUCCESS', rollback: { available: true, reason: '' } }];
  fs.writeFileSync(path.join(userData, 'journal.json'), JSON.stringify(kept));
  freshJournal().useProtectedJournalDirectory(userData, locked);

  // As an older build did during a failed start.
  const written = [{ id: '00000000-0000-4000-8000-000000000002', actionId: 'fixture', status: 'SUCCESS', rollback: { available: true, reason: '' } }];
  fs.writeFileSync(path.join(userData, 'journal.json'), JSON.stringify(written));

  const next = freshJournal();
  next.useProtectedJournalDirectory(userData, locked);
  assert.deepEqual(next.readJournal(userData), kept, 'the protected log is the one used');
  assert.ok(!fs.existsSync(path.join(userData, 'journal.json')));
  const aside = next.listUnprotectedJournals(userData);
  assert.equal(aside.length, 1);
  assert.equal(aside[0].count, 1);
  assert.match(path.basename(aside[0].filePath), /^journal\.recorded-while-unprotected\.\d+\.json$/);
  assert.deepEqual(JSON.parse(fs.readFileSync(aside[0].filePath, 'utf8')), written, 'kept exactly as written');
});
