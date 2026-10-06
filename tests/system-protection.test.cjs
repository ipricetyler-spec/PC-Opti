const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const protection = require('../src/main/system-protection/index.cjs');

const answer = (stdout) => async () => ({ stdout });
const failing = async () => { throw new Error('fixture: command unavailable'); };

test('BitLocker status reads protection of the Windows drive, and unknown is never reported as off', async () => {
  assert.equal(await protection.readBitLockerStatus(answer('1\r\n')), 'ON');
  assert.equal(await protection.readBitLockerStatus(answer('0')), 'OFF');
  assert.equal(await protection.readBitLockerStatus(answer('NONE')), 'OFF');
  assert.equal(await protection.readBitLockerStatus(answer('2')), 'UNKNOWN');
  assert.equal(await protection.readBitLockerStatus(failing), 'UNKNOWN');
  assert.match(protection.bitLockerBootNotice('ON'), /may make Windows ask for your BitLocker recovery key/);
  assert.match(protection.bitLockerBootNotice('UNKNOWN'), /could not tell whether BitLocker is on/);
  for (const status of ['ON', 'UNKNOWN']) assert.match(protection.bitLockerBootNotice(status), /never asks for or stores that key/);
  assert.equal(protection.bitLockerBootNotice('OFF'), null);
});

test('Controlled folder access warns only for a blocked write into a protected folder by a writer not allowed', async () => {
  const documents = path.resolve('C:/Users/fixture/Documents');
  const writer = path.resolve('C:/Program Files/Dialed/Dialed.exe');
  const inDocuments = path.join(documents, 'My Games', 'Rocket League', 'TAGame.ini');
  const state = await protection.readControlledFolderAccess(answer(JSON.stringify({ mode: 1, folders: [], allowed: ['C:/Other/app.exe'] })));
  assert.deepEqual(state, { mode: 1, folders: [], allowed: ['C:/Other/app.exe'] });
  const options = { defaultFolders: [documents], writer };
  assert.match(protection.controlledFolderNotice(state, [inDocuments], options), /Windows may block Dialed from saving it\. Dialed does not change that setting/);
  // Outside protected folders, allowed, audit-only, off or unreadable: nothing to say.
  assert.equal(protection.controlledFolderNotice(state, [path.resolve('C:/Users/fixture/AppData/Local/VALORANT/x.ini')], options), null);
  assert.equal(protection.controlledFolderNotice({ ...state, allowed: [writer.toUpperCase()] }, [inDocuments], options), null);
  // A protected folder written with an environment variable still counts.
  const previous = process.env.DIALED_FIXTURE_HOME; process.env.DIALED_FIXTURE_HOME = path.resolve('C:/Users/fixture');
  try {
    const saved = path.resolve('C:/Users/fixture/Saved Games/Game/settings.ini');
    assert.equal(protection.controlledFolderNotice(state, [saved], options), null);
    assert.match(protection.controlledFolderNotice({ ...state, folders: ['%DIALED_FIXTURE_HOME%\\Saved Games'] }, [saved], options), /protected folder/);
  } finally { if (previous === undefined) delete process.env.DIALED_FIXTURE_HOME; else process.env.DIALED_FIXTURE_HOME = previous; }
  assert.equal(protection.controlledFolderNotice({ ...state, mode: 2 }, [inDocuments], options), null);
  assert.equal(protection.controlledFolderNotice({ ...state, mode: 0 }, [inDocuments], options), null);
  assert.equal(protection.controlledFolderNotice(null, [inDocuments], options), null);
  assert.equal(await protection.readControlledFolderAccess(failing), null);
  // A folder added in Windows Security counts, and a folder's own name is not inside it.
  const custom = path.resolve('D:/Games');
  assert.ok(protection.controlledFolderNotice({ ...state, folders: [custom] }, [path.join(custom, 'cfg.ini')], { writer }));
  assert.equal(protection.controlledFolderNotice({ ...state, folders: [custom] }, [path.resolve('D:/Games2/cfg.ini')], { writer }), null);
  // One protected path among several is enough.
  assert.ok(protection.controlledFolderNotice(state, [path.resolve('C:/elsewhere/a.ini'), inDocuments], options));
  const single = await protection.readControlledFolderAccess(answer(JSON.stringify({ mode: 1, folders: 'D:/One', allowed: null })));
  assert.deepEqual(single, { mode: 1, folders: ['D:/One'], allowed: [] });
});

test('Modern Standby is read from power capabilities and explained with Microsoft\'s rule', async () => {
  assert.equal(await protection.readModernStandby(answer('MODERN_STANDBY\r\n')), 'MODERN_STANDBY');
  assert.equal(await protection.readModernStandby(answer('CLASSIC')), 'CLASSIC');
  assert.equal(await protection.readModernStandby(answer('garbage')), 'UNKNOWN');
  assert.equal(await protection.readModernStandby(failing), 'UNKNOWN');
  assert.match(protection.modernStandbyPlanNotice('MODERN_STANDBY'), /only allow the Balanced plan or plans based on it/);
  assert.equal(protection.modernStandbyPlanNotice('CLASSIC'), null);
  assert.equal(protection.modernStandbyPlanNotice('UNKNOWN'), null);
  // AoAc is byte 20 of SYSTEM_POWER_CAPABILITIES (76 bytes), requested with level 4.
  assert.match(protection.MODERN_STANDBY_SCRIPT, /CallNtPowerInformation\(4,/);
  assert.match(protection.MODERN_STANDBY_SCRIPT, /new byte\[76\]/);
  assert.match(protection.MODERN_STANDBY_SCRIPT, /buffer\[20\] != 0/);
});

test('every protection check only reads, and never changes a security setting', () => {
  const scripts = [protection.BITLOCKER_SCRIPT, protection.CONTROLLED_FOLDER_SCRIPT, protection.MODERN_STANDBY_SCRIPT].join('\n');
  assert.doesNotMatch(scripts, /Set-MpPreference|Add-MpPreference|manage-bde|Suspend-BitLocker|Disable-BitLocker|powercfg|Invoke-CimMethod|Set-ItemProperty|New-ItemProperty|reg(\.exe)? add/i);
});

test('the notices reach the boot, game-file and power plan confirmations', () => {
  const fs = require('node:fs');
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
  assert.match(main, /ipcMain\.handle\('pc-opti:read-boot-notice', async \(\) => bitLockerBootNotice\(await readBitLockerStatus\(\)\)\)/);
  assert.equal([...main.matchAll(/protectionNotice: await gameWriteNotice\(/g)].length, 3, 'profile, profile undo and config restore previews');
  assert.match(main, /planNotice: modernStandbyPlanNotice\(standby\)/);
  const app = fs.readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf8');
  // Every path that writes boot settings reads BitLocker fresh first: a single change, a Restore of a
  // boot entry, Undo all and Undo this run.
  assert.match(app, /const timingBootNotice = await readBootNotice\(\);/);
  assert.match(app, /const bootNotice = isBootEntry\(entry\) \? await readBootNotice\(\) : null;/);
  assert.match(app, /const undoAllBootNotice = restorable\.some\(isBootEntry\) \? await readBootNotice\(\) : null;/);
  assert.match(app, /const runBootNotice = undoable\.some\(isBootEntry\) \? await readBootNotice\(\) : null;/);
  // Each notice is passed as the dialog's separate warning callout, not folded into the small print.
  assert.equal([...app.matchAll(/warning: (timingBootNotice|bootNotice|undoAllBootNotice|runBootNotice) \?\? null/g)].length, 4);
  assert.match(app, /const isBootEntry = \(entry: AuditJournalEntry\) => entry\.actionId\.startsWith\('timing:'\);/);
  assert.equal([...app.matchAll(/warning: preview\.protectionNotice \?\? null/g)].length, 2);
  assert.match(app, /warning: planNotice \?\? null/);
  const dialog = fs.readFileSync(path.join(__dirname, '../src/components/ActionPreviewDialog.tsx'), 'utf8');
  assert.match(dialog, /request\.warning \? <p id="action-preview-warning" role="note"/);
  assert.match(app, /const planNotice = settingId === 'ultimate-plan' \?/);
  assert.match(fs.readFileSync(path.join(__dirname, '../src/components/GameOptimizationCenter.tsx'), 'utf8'), /preview\.protectionNotice \?/);
  assert.match(fs.readFileSync(path.join(__dirname, '../src/components/PowerPlanCard.tsx'), 'utf8'), /inventory\?\.planNotice \?/);
});
