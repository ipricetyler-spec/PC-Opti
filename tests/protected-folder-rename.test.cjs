const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tempDir } = require('./helpers/temp-dir.cjs');

const protectedData = require('../src/main/protected-data/index.cjs');

const PROGRAM_DATA = 'C:\\ProgramData';
const OLD = 'C:\\ProgramData\\Dialed-ad0f83361119';
const NEW = 'C:\\ProgramData\\Dialed-Protected';
const JOURNAL = JSON.stringify(Array.from({ length: 50 }, (_, index) => ({ id: `entry-${index}`, status: 'SUCCESS' })));

class PowerLoss extends Error {}

/**
 * A fake machine: folders (with the change log inside), HKLM\SOFTWARE\Dialed, and a stand-in
 * for the folder script that follows its rules. `crashBeforeWrite` cuts the power before the
 * Nth write (registry or rename); after that, nothing else runs, as after a real power loss.
 */
function machine({ root = OLD, extraFolders = [], untrusted = [] } = {}) {
  const state = {
    folders: new Map([[root.toLowerCase(), { path: root, journal: JOURNAL }]]),
    registry: { root, pending: null, rejected: [] },
    untrusted: new Set(untrusted.map((item) => item.toLowerCase())),
    createdFresh: false,
    writes: 0,
    crashBeforeWrite: Infinity,
    dead: false,
  };
  for (const folder of extraFolders) state.folders.set(folder.toLowerCase(), { path: folder, journal: null });
  const has = (folder) => Boolean(folder) && state.folders.has(folder.toLowerCase());
  const trusted = (folder) => has(folder) && !state.untrusted.has(folder.toLowerCase());
  const write = (apply) => {
    if (state.dead) throw new PowerLoss('already off');
    state.writes += 1;
    if (state.writes >= state.crashBeforeWrite) { state.dead = true; throw new PowerLoss('power lost'); }
    apply();
  };
  const run = async (script) => {
    if (state.dead) throw new PowerLoss('already off');
    assert.equal(script, protectedData.SCRIPT);
    const { root: recorded, pending } = state.registry;
    if (pending) {
      return { stdout: JSON.stringify({ pending, pendingExists: has(pending), pendingTrusted: trusted(pending), recorded, recordedExists: has(recorded), recordedTrusted: trusted(recorded), programData: PROGRAM_DATA }) };
    }
    if (trusted(recorded)) return { stdout: JSON.stringify({ root: recorded, programData: PROGRAM_DATA, created: false, rejected: state.registry.rejected }) };
    // The real script would now create a fresh, empty folder, keeping the rejected path on record.
    state.createdFresh = true;
    if (recorded) state.registry.rejected = [...new Set([...state.registry.rejected, recorded])];
    const fresh = has(NEW) ? 'C:\\ProgramData\\Dialed-0123456789ab' : NEW;
    state.folders.set(fresh.toLowerCase(), { path: fresh, journal: null });
    state.registry.root = fresh;
    return { stdout: JSON.stringify({ root: fresh, programData: PROGRAM_DATA, created: true, rejected: state.registry.rejected }) };
  };
  const ops = {
    exists: (folder) => has(folder),
    rename: (from, to) => write(() => {
      if (!has(from)) throw Object.assign(new Error('source missing'), { code: 'ENOENT' });
      if (has(to)) throw Object.assign(new Error('target exists'), { code: 'EPERM' });
      const entry = state.folders.get(from.toLowerCase());
      state.folders.delete(from.toLowerCase());
      state.folders.set(to.toLowerCase(), { ...entry, path: to });
    }),
    setPending: async (target) => write(() => { state.registry.pending = target; }),
    // Two separate registry writes, as on the real machine.
    commit: async (target) => {
      write(() => { state.registry.root = target; });
      write(() => { state.registry.pending = null; });
    },
    clearPending: async () => write(() => { state.registry.pending = null; }),
  };
  const folderWithLog = () => [...state.folders.values()].filter((entry) => entry.journal !== null);
  return { state, run, ops, folderWithLog };
}

function assertSettled(fake, expectedRoot) {
  const { state } = fake;
  assert.equal(state.registry.pending, null, 'no unfinished rename is left recorded');
  assert.equal(state.createdFresh, false, 'no empty folder replaced the change log');
  const withLog = fake.folderWithLog();
  assert.equal(withLog.length, 1, 'exactly one folder holds the change log');
  assert.equal(withLog[0].journal, JOURNAL, 'the change log is unchanged');
  assert.equal(state.registry.root.toLowerCase(), withLog[0].path.toLowerCase(), 'the registry names the folder that holds it');
  if (expectedRoot) assert.equal(withLog[0].path, expectedRoot);
}

test('the protected folder is renamed to Dialed-Protected and keeps its change log', async () => {
  const fake = machine();
  const result = await protectedData.openProtectedDataRoot({ run: fake.run, ops: fake.ops, renameToTidyName: true });
  assert.equal(result.root, NEW);
  assert.equal(result.renamedFrom, OLD);
  assertSettled(fake, NEW);
  assert.equal(fake.state.folders.has(OLD.toLowerCase()), false);

  // A later start finds it already tidy and does nothing more.
  const writes = fake.state.writes;
  assert.equal((await protectedData.openProtectedDataRoot({ run: fake.run, ops: fake.ops, renameToTidyName: true })).root, NEW);
  assert.equal(fake.state.writes, writes);
});

test('a rename interrupted at any point leaves one intact folder, and the next start settles it', async () => {
  // Writes in a full rename: record intent, rename, record new root, clear intent.
  for (let crashAt = 1; crashAt <= 4; crashAt += 1) {
    const fake = machine();
    fake.state.crashBeforeWrite = crashAt;
    // A real power loss has no return value; whatever this call does afterwards is moot.
    await protectedData.openProtectedDataRoot({ run: fake.run, ops: fake.ops, renameToTidyName: true }).catch(() => {});
    assert.equal(fake.state.dead, true, `the power was cut before write ${crashAt}`);

    // Straight after the interruption: never half of each.
    const withLog = fake.folderWithLog();
    assert.equal(withLog.length, 1, `write ${crashAt}: exactly one folder holds the log`);
    assert.equal(withLog[0].journal, JOURNAL, `write ${crashAt}: the log is intact`);

    // Power back on. The next start settles without being asked to rename again.
    fake.state.dead = false;
    fake.state.crashBeforeWrite = Infinity;
    const result = await protectedData.openProtectedDataRoot({ run: fake.run, ops: fake.ops });
    assertSettled(fake);
    assert.equal(result.root, withLog[0].path, `write ${crashAt}: Dialed uses the folder that holds the log`);
  }
});

test('the rename is off unless asked for, and a folder named plain Dialed is never moved', async () => {
  const off = machine();
  assert.equal((await protectedData.openProtectedDataRoot({ run: off.run, ops: off.ops })).root, OLD);
  assert.equal(off.state.writes, 0);

  // Plain Dialed may hold the native input helper's journal, so it stays where it is.
  const plain = machine({ root: 'C:\\ProgramData\\Dialed' });
  assert.equal((await protectedData.openProtectedDataRoot({ run: plain.run, ops: plain.ops, renameToTidyName: true })).root, 'C:\\ProgramData\\Dialed');
  assert.equal(plain.state.writes, 0);
});

test('an existing Dialed-Protected folder is never replaced', async () => {
  const fake = machine({ extraFolders: [NEW] });
  const result = await protectedData.openProtectedDataRoot({ run: fake.run, ops: fake.ops, renameToTidyName: true });
  assert.equal(result.root, OLD);
  assert.match(result.renameSkipped, /already exists/);
  assert.equal(fake.state.writes, 0, 'nothing was recorded or moved');
  assertSettled(fake, OLD);
});

test('when Windows refuses the rename, the folder keeps its name and the intent is cleared', async () => {
  const fake = machine();
  fake.ops.rename = () => { throw Object.assign(new Error('a file inside is open'), { code: 'EPERM' }); };
  const result = await protectedData.openProtectedDataRoot({ run: fake.run, ops: fake.ops, renameToTidyName: true });
  assert.equal(result.root, OLD);
  assert.match(result.renameSkipped, /did not rename/);
  assertSettled(fake, OLD);
});

test('a renamed folder that fails the admin-only checks is put back under its old name', async () => {
  const fake = machine({ untrusted: [NEW] });
  const result = await protectedData.openProtectedDataRoot({ run: fake.run, ops: fake.ops, renameToTidyName: true });
  assert.equal(result.root, OLD);
  assert.match(result.renameSkipped, /put back/);
  assertSettled(fake, OLD);
});

test('if recording the new name fails, Dialed follows whatever the registry now says', async () => {
  // Fails before either write: the folder goes back under the recorded old name.
  const early = machine();
  early.ops.commit = async () => { throw new Error('registry unavailable'); };
  assert.equal((await protectedData.openProtectedDataRoot({ run: early.run, ops: early.ops, renameToTidyName: true })).root, OLD);
  assertSettled(early, OLD);

  // Fails between the two writes: the new name is recorded, so it is kept.
  const late = machine();
  late.ops.commit = async (target) => { late.state.registry.root = target; throw new Error('registry unavailable'); };
  const result = await protectedData.openProtectedDataRoot({ run: late.run, ops: late.ops, renameToTidyName: true });
  assert.equal(result.root, NEW);
  assertSettled(late, NEW);
});

test('a failure to record the intent skips the rename without losing the folder for this start', async () => {
  const fake = machine();
  fake.ops.setPending = async () => { throw new Error('registry unavailable'); };
  const result = await protectedData.openProtectedDataRoot({ run: fake.run, ops: fake.ops, renameToTidyName: true });
  assert.equal(result.root, OLD);
  assert.match(result.renameSkipped, /could not record the rename/);
  assertSettled(fake, OLD);
});

test('an unfinished rename that cannot be told apart is refused, and nothing is changed', async () => {
  // Both names exist: something other than Dialed made one of them.
  const both = machine({ extraFolders: [NEW] });
  both.state.registry.pending = NEW;
  await assert.rejects(protectedData.openProtectedDataRoot({ run: both.run, ops: both.ops }), /cannot tell which copy is current/);
  assert.equal(both.state.writes, 0);
  assert.equal(both.state.createdFresh, false);

  // The renamed folder exists but fails the checks, and the old one is gone.
  const tampered = machine({ untrusted: [NEW] });
  tampered.state.registry.pending = NEW;
  tampered.ops.rename(OLD, NEW);
  const writes = tampered.state.writes;
  await assert.rejects(protectedData.openProtectedDataRoot({ run: tampered.run, ops: tampered.ops }), /neither C:\\ProgramData\\Dialed-ad0f83361119 nor C:\\ProgramData\\Dialed-Protected passed its admin-only checks/);
  assert.equal(tampered.state.writes, writes);
  assert.equal(tampered.state.createdFresh, false);
});

test('reports of an unfinished rename are only accepted for Dialed-Protected in ProgramData', async () => {
  const report = (fields) => async () => ({ stdout: JSON.stringify({ programData: PROGRAM_DATA, recorded: OLD, pendingExists: true, pendingTrusted: true, recordedExists: false, ...fields }) });
  for (const pending of ['C:\\ProgramData\\Other', 'C:\\Users\\Public\\Dialed-Protected', 'C:\\ProgramData\\Dialed-0123456789ab', 'C:\\ProgramData\\Dialed-Protected\\..\\Evil']) {
    await assert.rejects(protectedData.probeProtectedDataRoot(report({ pending })), /unexpected protected folder path/, pending);
  }
  await assert.rejects(protectedData.probeProtectedDataRoot(report({ pending: NEW, recorded: 'D:\\Elsewhere\\Dialed' })), /unexpected protected folder path/);
  // Callers that do not settle renames are never handed a folder while one is unfinished.
  await assert.rejects(protectedData.ensureProtectedDataRoot(report({ pending: NEW })), /unfinished/);
  assert.equal((await protectedData.ensureProtectedDataRoot(async () => ({ stdout: JSON.stringify({ root: NEW, programData: PROGRAM_DATA, created: false }) }))).root, NEW);
});

test('the folder script settles nothing itself and names new folders Dialed-Protected', () => {
  const script = protectedData.SCRIPT;
  const pendingBranch = script.indexOf('if ($pending) {');
  assert.ok(pendingBranch > 0);
  assert.ok(pendingBranch < script.indexOf('New-LockedFolder $candidate'), 'an unfinished rename is reported before any folder could be created');
  assert.ok(pendingBranch < script.indexOf('New-ItemProperty'), 'and before the registry could be changed');
  assert.match(script.slice(pendingBranch, script.indexOf('$root = $null')), /return\s*\n\s*\}/, 'the branch returns without changing anything');
  assert.match(script, /Join-Path \$programData 'Dialed-Protected'/);
  assert.doesNotMatch(script, /Join-Path \$programData 'Dialed'/, 'plain Dialed belongs to the native input helper');
});

test('the real rename operations quote only safe paths and write only under HKLM\\SOFTWARE\\Dialed', async () => {
  const scripts = [];
  const ops = protectedData.createProtectedMoveOps(async (script) => { scripts.push(script); return { stdout: '' }; }, fs);
  await ops.setPending(NEW);
  await ops.commit(NEW);
  await ops.clearPending();
  assert.equal(scripts.length, 3);
  for (const script of scripts) assert.match(script, /\$key = 'HKLM:\\SOFTWARE\\Dialed'/);
  assert.match(scripts[0], /-Name ProtectedDataRootPending -PropertyType String -Value 'C:\\ProgramData\\Dialed-Protected'/);
  assert.ok(scripts[1].indexOf('-Name ProtectedDataRoot ') < scripts[1].indexOf('Remove-ItemProperty'), 'the new root is recorded before the intent is cleared');
  for (const bad of ["C:\\ProgramData\\Dialed'; Remove-Item C:\\", 'C:\\ProgramData\\$(evil)', 'relative\\path']) {
    assert.throws(() => ops.setPending(bad), /Refused an unexpected protected folder path/, bad);
  }
  assert.equal(scripts.length, 3, 'a refused path never reaches PowerShell');
  await assert.rejects(protectedData.createProtectedMoveOps().setPending(NEW), /not available inside the test runner/);
});

test('on the real file system the rename moves the whole folder and never replaces one', () => {
  const base = tempDir('dialed-rename-');
  const from = path.join(base, 'Dialed-0123456789ab');
  const to = path.join(base, 'Dialed-Protected');
  fs.mkdirSync(path.join(from, 'Journal'), { recursive: true });
  fs.writeFileSync(path.join(from, 'Journal', 'journal.json'), JOURNAL);
  const ops = protectedData.createProtectedMoveOps(async () => ({ stdout: '' }), fs);

  fs.mkdirSync(to);
  assert.throws(() => ops.rename(from, to), 'an existing folder, even an empty one, is not replaced');
  assert.equal(fs.readFileSync(path.join(from, 'Journal', 'journal.json'), 'utf8'), JOURNAL);
  fs.rmdirSync(to);

  assert.equal(ops.exists(to), false);
  ops.rename(from, to);
  assert.equal(ops.exists(from), false);
  assert.equal(fs.readFileSync(path.join(to, 'Journal', 'journal.json'), 'utf8'), JOURNAL);
});

test('startup settles unfinished renames but does not rename until the owner turns it on', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /const RENAME_PROTECTED_FOLDER = false;/);
  assert.match(main, /openProtectedDataRoot\(\{ renameToTidyName: RENAME_PROTECTED_FOLDER \}\)/);
});

test('a folder another program puts at the vacated old name does not stop the rename', async () => {
  // Straight after the rename, before the check: the old name is taken by a folder Dialed did not make.
  const fake = machine();
  const rename = fake.ops.rename;
  fake.ops.rename = (from, to) => {
    rename(from, to);
    if (from === OLD) { fake.state.folders.set(OLD.toLowerCase(), { path: OLD, journal: null }); fake.state.untrusted.add(OLD.toLowerCase()); }
  };
  const result = await protectedData.openProtectedDataRoot({ run: fake.run, ops: fake.ops, renameToTidyName: true });
  assert.equal(result.root, NEW);
  assert.equal(fake.state.registry.pending, null, 'no rename marker is left behind');
  assert.equal(fake.state.createdFresh, false);

  // The same squat after a crash between the rename and recording it: the next start commits.
  const crashed = machine();
  crashed.state.registry.pending = NEW;
  crashed.ops.rename(OLD, NEW);
  crashed.state.folders.set(OLD.toLowerCase(), { path: OLD, journal: null });
  crashed.state.untrusted.add(OLD.toLowerCase());
  assert.equal((await protectedData.openProtectedDataRoot({ run: crashed.run, ops: crashed.ops })).root, NEW);
  assert.equal(crashed.state.registry.pending, null);

  // A forged marker naming a folder that fails the checks is cleared; the real folder is kept.
  const forged = machine({ extraFolders: [NEW], untrusted: [NEW] });
  forged.state.registry.pending = NEW;
  assert.equal((await protectedData.openProtectedDataRoot({ run: forged.run, ops: forged.ops })).root, OLD);
  assert.equal(forged.state.registry.pending, null);
});

test('a folder that cannot be put back is reported where it is, not lost', async () => {
  const fake = machine({ untrusted: [NEW] });
  const rename = fake.ops.rename;
  fake.ops.rename = (from, to) => {
    rename(from, to);
    if (from === OLD) fake.state.folders.set(OLD.toLowerCase(), { path: OLD, journal: null });
  };
  await assert.rejects(protectedData.openProtectedDataRoot({ run: fake.run, ops: fake.ops, renameToTidyName: true }), /could not be moved back.*The change log is in C:\\ProgramData\\Dialed-Protected/);
  assert.equal(fake.state.createdFresh, false);
});

test('a recorded folder that fails the checks is replaced, and its path is kept and reported', async () => {
  const fake = machine({ untrusted: [OLD] });
  const first = await protectedData.openProtectedDataRoot({ run: fake.run, ops: fake.ops });
  assert.equal(first.root, NEW);
  assert.deepEqual(first.rejected, [OLD]);
  // Every later start still reports it.
  assert.deepEqual((await protectedData.openProtectedDataRoot({ run: fake.run, ops: fake.ops })).rejected, [OLD]);
  // A value that is not a Dialed folder is reported without its text.
  const odd = async () => ({ stdout: JSON.stringify({ root: NEW, programData: PROGRAM_DATA, created: false, rejected: ['C:\\Users\\Public\\Fake', OLD] }) });
  assert.deepEqual((await protectedData.probeProtectedDataRoot(odd)).rejected, [null, OLD]);
});

test('the folder script locks HKLM\\SOFTWARE\\Dialed first and never recreates it with New-Item -Force', () => {
  const script = protectedData.SCRIPT;
  const lockCall = script.indexOf('\n  Protect-DialedKey\n');
  assert.ok(lockCall > 0 && lockCall < script.indexOf('ProtectedDataRoot -ErrorAction'), 'the key is locked before any value is read');
  assert.doesNotMatch(script, /New-Item -Path \$registry/);
  assert.ok(protectedData.LOCK_DIALED_KEY.includes("CreateSubKey('SOFTWARE\\Dialed', [Microsoft.Win32.RegistryKeyPermissionCheck]::ReadWriteSubTree, $security)"));
  assert.match(protectedData.LOCK_DIALED_KEY, /S-1-3-4/, 'owner rights limit whoever owns a subkey');
  const storeSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'protected-store', 'index.cjs'), 'utf8');
  assert.ok(storeSource.includes('${LOCK_DIALED_KEY}; Protect-DialedKey;'), 'startup backups lock the key before writing under it');
});
