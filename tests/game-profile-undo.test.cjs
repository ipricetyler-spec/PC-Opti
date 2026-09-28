const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tempDir } = require('./helpers/temp-dir.cjs');
const profiles = require('../src/main/game-profiles/index.cjs');

const fortnite = 'fortnite-low-effects-v1';
const original = '; header\r\n[ScalabilityGroups]\r\nsg.ShadowQuality = 3  ; shadows\r\nsg.PostProcessQuality=2\r\nsg.EffectsQuality=1\r\nsg.TextureQuality=3\r\n[Other]\r\nResX=1920\r\n';
const closed = { listProcessNames: async () => ['System', 'explorer'] };

function fixture() {
  const root = tempDir('dialed-profile-undo-');
  const roots = { localAppData: path.join(root, 'Local'), documents: path.join(root, 'Documents') };
  const source = path.join(roots.localAppData, 'FortniteGame', 'Saved', 'Config', 'WindowsClient', 'GameUserSettings.ini');
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, original);
  return { roots, source, userData: path.join(root, 'user-data') };
}

async function applied(f) {
  const preview = await profiles.previewGameProfile(fortnite, f.roots, closed);
  return profiles.applyGameProfile(f.userData, preview, f.roots, closed);
}

test('undo puts back only the profile keys and keeps what the game wrote since', async () => {
  const f = fixture();
  const result = await applied(f);
  // The game rewrote the file on exit with other settings changed.
  const afterGame = fs.readFileSync(f.source, 'utf8').replace('sg.TextureQuality=3', 'sg.TextureQuality=1').replace('ResX=1920', 'ResX=2560');
  fs.writeFileSync(f.source, afterGame);

  const preview = await profiles.previewGameProfileUndo(f.userData, result.backup.backupId, f.roots, closed);
  assert.deepEqual(preview.changes.map((change) => [change.key, change.before, change.after]), [
    ['sg.ShadowQuality', '0', '3'], ['sg.PostProcessQuality', '0', '2'], ['sg.EffectsQuality', '0', '1'],
  ]);
  const undone = await profiles.applyGameProfileUndo(f.userData, preview, f.roots, closed);
  assert.equal(undone.changedCount, 3);
  const expected = original.replace('sg.TextureQuality=3', 'sg.TextureQuality=1').replace('ResX=1920', 'ResX=2560');
  assert.equal(fs.readFileSync(f.source, 'utf8'), expected, 'profile keys restored; the game\'s own changes kept byte for byte');
  await assert.rejects(profiles.previewGameProfileUndo(f.userData, result.backup.backupId, f.roots, closed), /already undone/);
});

test('a profile key changed since the apply is not overwritten, and nothing is written', async () => {
  const f = fixture();
  const result = await applied(f);
  const changed = fs.readFileSync(f.source, 'utf8').replace('sg.ShadowQuality = 0', 'sg.ShadowQuality = 2');
  fs.writeFileSync(f.source, changed);
  await assert.rejects(profiles.previewGameProfileUndo(f.userData, result.backup.backupId, f.roots, closed), /sg\.ShadowQuality changed to 2\. Dialed will not overwrite that/);
  assert.equal(fs.readFileSync(f.source, 'utf8'), changed);
});

test('the closed-game check recognises the processes the games really run as', async () => {
  const running = (names) => ({ listProcessNames: async () => ['explorer', ...names] });
  await assert.rejects(profiles.assertGameClosed('valorant-pc-performance-review', running(['VALORANT-Win64-Shipping.exe'])), /Close the game/);
  await assert.rejects(profiles.assertGameClosed('arc-raiders-pc-performance-review', running(['PioneerGame'])), /Close the game/);
  await assert.rejects(profiles.assertGameClosed('fortnite-pc-performance-review', running(['FortniteClient-Win64-Shipping'])), /Close the game/);
  await assert.doesNotReject(profiles.assertGameClosed('valorant-pc-performance-review', running(['ValorantTracker'])));
});

test('undo refuses while the game runs, after the file changed since preview, and for backups not made by a profile', async () => {
  const f = fixture();
  const result = await applied(f);
  await assert.rejects(profiles.previewGameProfileUndo(f.userData, result.backup.backupId, f.roots, { listProcessNames: async () => ['FortniteClient-Win64-Shipping'] }), /Close the game/);
  const preview = await profiles.previewGameProfileUndo(f.userData, result.backup.backupId, f.roots, closed);
  fs.appendFileSync(f.source, '; edited\r\n');
  await assert.rejects(profiles.applyGameProfileUndo(f.userData, preview, f.roots, closed), /changed after preview/);
  assert.equal(profiles.readProfileRecord(f.userData, '00000000-0000-4000-8000-000000000000'), null);
  await assert.rejects(profiles.previewGameProfileUndo(f.userData, '00000000-0000-4000-8000-000000000000', f.roots, closed), /not made by a game profile/);
});
