const assert = require('node:assert/strict');
const { tempDir } = require('./helpers/temp-dir.cjs');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const gameConfig = require('../src/main/game-config/index.cjs');

const temporaryDirectories = [];

function temporaryDirectory() {
  const directory = tempDir('dialed-game-config-test-');
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  while (temporaryDirectories.length) fs.rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
});

test('installed-game discovery is read-only, guide-linked, and explicit about missing candidates', async () => {
  const userRoot = temporaryDirectory();
  const fortniteConfig = path.join(userRoot, 'FortniteGame', 'Saved', 'Config', 'WindowsClient');
  fs.mkdirSync(fortniteConfig, { recursive: true });
  fs.writeFileSync(path.join(fortniteConfig, 'GameUserSettings.ini'), 'fixture=true', 'utf8');

  const result = await gameConfig.discoverInstalledGames({
    environment: { LOCALAPPDATA: userRoot, USERPROFILE: userRoot },
    listInstalledApplications: async () => [
      { displayName: 'Fortnite', publisher: 'Epic Games', installLocation: 'D:\\Games\\Fortnite' },
      { displayName: 'VALORANT', publisher: 'Riot Games', installLocation: '' },
      { displayName: 'Call of Duty', publisher: 'Blizzard Entertainment', installLocation: 'E:\\Call of Duty' },
      { displayName: 'Unrelated Fixture', publisher: 'Fixture', installLocation: '' },
    ],
  });

  assert.deepEqual(result.games.map((game) => game.guideId), ['fortnite-pc-performance-review', 'valorant-pc-performance-review', 'call-of-duty-black-ops-7-performance-review']);
  assert.equal(result.games[0].evidence, 'REGISTERED_APPLICATION');
  assert.equal(result.games[0].configHints[0].state, 'EXISTING_FILE');
  assert.equal(result.games[1].configHints[0].state, 'NOT_FOUND');
  assert.equal(result.games[2].detectedDisplayName, 'Call of Duty');
  assert.deepEqual(result.games[2].configHints, []);
  assert.match(result.limitations, /may be absent/);
});

test('Call of Duty discovery is exact enough to avoid unrelated registered applications', async () => {
  const result = await gameConfig.discoverInstalledGames({
    listInstalledApplications: async () => [
      { displayName: 'Call of Duty Companion', publisher: 'Fixture', installLocation: '' },
      { displayName: 'Call of Duty: Modern Warfare', publisher: 'Fixture', installLocation: '' },
    ],
  });
  assert.equal(result.games.some((game) => game.guideId === 'call-of-duty-black-ops-7-performance-review'), false);
});

test('Call of Duty backups have an exact executable guard so restore is not permanently unavailable', async () => {
  const profilesSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'game-profiles', 'index.cjs'), 'utf8');
  assert.match(profilesSource, /'call-of-duty-black-ops-7-performance-review': \/\^cod\$\/i/);
});

test('installed-app inventory normalization is deterministic, deduplicated, and size-aware', () => {
  const result = gameConfig.normalizeInstalledApplications([
    { displayName: ' Fixture App ', publisher: ' Vendor ', displayVersion: ' 1.2 ', installLocation: ' C:\\Fixture ', estimatedSizeKb: 2048 },
    { displayName: 'Fixture App', publisher: 'Vendor', displayVersion: '1.2', installLocation: 'D:\\Duplicate', estimatedSizeKb: 4096 },
    { displayName: 'Another App', publisher: '', displayVersion: '', installLocation: '', estimatedSizeKb: null },
    { displayName: '', publisher: 'Ignored' },
  ]);
  assert.deepEqual(result.map((item) => item.displayName), ['Another App', 'Fixture App']);
  assert.equal(result[1].estimatedSizeBytes, 2 * 1024 * 1024);
  assert.equal(result[1].installLocation, 'C:\\Fixture');
  assert.equal(result[0].estimatedSizeBytes, null);
});

test('game-config backup records exact source bytes and hashes in a versioned bounded manifest', () => {
  const userData = temporaryDirectory();
  const sourceRoot = temporaryDirectory();
  const sourcePath = path.join(sourceRoot, 'GameUserSettings.ini');
  const contents = Buffer.from('[Video]\nVSync=False\n', 'utf8');
  fs.writeFileSync(sourcePath, contents);

  const backup = gameConfig.createGameConfigBackup(userData, 'fortnite-pc-performance-review', [sourcePath], {
    now: () => '2026-08-26T12:00:00.000Z',
    randomUuid: () => '11111111-1111-4111-8111-111111111111',
  });

  assert.equal(backup.schemaVersion, '1.0.0');
  assert.equal(backup.totalBytes, contents.length);
  assert.equal(backup.files[0].sourcePath, sourcePath);
  assert.equal(backup.files[0].sha256, crypto.createHash('sha256').update(contents).digest('hex'));
  assert.deepEqual(gameConfig.listGameConfigBackups(userData), [backup]);

  const manifest = JSON.parse(fs.readFileSync(path.join(userData, 'game-config-backups', backup.backupId, 'manifest.json'), 'utf8'));
  assert.equal(manifest.files[0].storedName, '01-GameUserSettings.ini');
  assert.deepEqual(fs.readFileSync(path.join(userData, 'game-config-backups', backup.backupId, manifest.files[0].storedName)), contents);
});

test('backup staging failure cleans only its own files and never publishes incomplete history', () => {
  const root = temporaryDirectory();
  const source = path.join(root, 'fixture.ini');
  fs.writeFileSync(source, 'original');
  const fileSystem = Object.create(fs);
  fileSystem.renameSync = (from, to) => {
    if (path.basename(to) === 'manifest.json') throw new Error('fixture interruption');
    return fs.renameSync(from, to);
  };
  assert.throws(() => gameConfig.createGameConfigBackup(root, 'fortnite-pc-performance-review', [source], { fileSystem }), /fixture interruption/);
  assert.deepEqual(fs.readdirSync(path.join(root, 'game-config-backups')), []);
  assert.equal(fs.readFileSync(source, 'utf8'), 'original');
  assert.deepEqual(gameConfig.listGameConfigBackups(root), []);
});

test('backup history selects newest valid manifests beyond the first hundred directories', () => {
  const root = temporaryDirectory();
  const source = path.join(root, 'fixture.ini');
  fs.writeFileSync(source, 'original');
  for (let index = 0; index < 103; index += 1) {
    gameConfig.createGameConfigBackup(root, 'fortnite-pc-performance-review', [source], {
      randomUuid: () => `${String(index).padStart(8, '0')}-1111-4111-8111-111111111111`,
      now: () => new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString(),
    });
  }
  // A crash-only staging directory must never be offered as a backup.
  fs.mkdirSync(path.join(root, 'game-config-backups', '.pending-crash'));
  const result = gameConfig.listGameConfigBackups(root);
  assert.equal(result.length, 100);
  assert.equal(result[0].backupId, '00000102-1111-4111-8111-111111111111');
  assert.equal(result.at(-1).backupId, '00000003-1111-4111-8111-111111111111');
});

test('backup publication failure reports preserved staging evidence if cleanup cannot complete', () => {
  const root = temporaryDirectory();
  const source = path.join(root, 'fixture.ini');
  fs.writeFileSync(source, 'original');
  const fileSystem = Object.create(fs);
  fileSystem.renameSync = (from, to) => {
    if (path.basename(from).startsWith('.pending-')) throw new Error('fixture publish interruption');
    return fs.renameSync(from, to);
  };
  fileSystem.unlinkSync = () => { throw new Error('fixture locked file'); };
  assert.throws(() => gameConfig.createGameConfigBackup(root, 'fortnite-pc-performance-review', [source], { fileSystem }), /Incomplete backup evidence remains at/);
  const entries = fs.readdirSync(path.join(root, 'game-config-backups'));
  assert.equal(entries.length, 1);
  assert.match(entries[0], /^\.pending-/);
  assert.deepEqual(gameConfig.listGameConfigBackups(root), []);
  assert.equal(fs.readFileSync(source, 'utf8'), 'original');
});

test('oversized backup inventory fails explicitly instead of returning arbitrary history', () => {
  const fileSystem = Object.create(fs);
  fileSystem.readdirSync = () => Array.from({ length: 10001 }, (_, index) => ({ name: `${String(index).padStart(8, '0')}-1111-4111-8111-111111111111`, isDirectory: () => true }));
  assert.throws(() => gameConfig.listGameConfigBackups('fixture', { fileSystem }), /10,000-directory scan limit/);
});

test('owner-observed ARC Raiders PioneerGame.exe blocks changes without widening the process guard', async () => {
  const { assertGameClosed } = require('../src/main/game-profiles/index.cjs');
  await assert.rejects(assertGameClosed('arc-raiders-pc-performance-review', { listProcessNames: async () => ['PioneerGame.exe'] }), /Close the game/);
});

test('restore preview identifies changed files and restore preserves recovery evidence', () => {
  const userData = temporaryDirectory();
  const sourceRoot = temporaryDirectory();
  const sourcePath = path.join(sourceRoot, 'videoconfig.txt');
  fs.writeFileSync(sourcePath, 'original config', 'utf8');
  const backup = gameConfig.createGameConfigBackup(userData, 'apex-legends-pc-performance-review', [sourcePath], {
    randomUuid: () => '22222222-2222-4222-8222-222222222222',
  });

  fs.writeFileSync(sourcePath, 'changed after backup', 'utf8');
  const preview = gameConfig.createGameConfigRestorePreview(userData, backup.backupId);
  const publicPreview = gameConfig.publicRestorePreview(preview, '33333333-3333-4333-8333-333333333333');
  assert.equal(publicPreview.files[0].willOverwriteChangedFile, true);
  assert.equal(publicPreview.files[0].currentState, 'FILE');

  const result = gameConfig.applyGameConfigRestore(userData, preview);
  assert.equal(result.restoredCount, 1);
  assert.equal(fs.readFileSync(sourcePath, 'utf8'), 'original config');
  assert.equal(fs.readFileSync(path.join(result.recoveryPath, '1.current'), 'utf8'), 'changed after backup');
  assert.equal(JSON.parse(fs.readFileSync(path.join(result.recoveryPath, 'restore-result.json'), 'utf8')).backupId, backup.backupId);
});

test('restore refuses target drift after preview and backup tampering before any source write', () => {
  for (const mode of ['target-drift', 'backup-tamper']) {
    const userData = temporaryDirectory();
    const sourceRoot = temporaryDirectory();
    const sourcePath = path.join(sourceRoot, 'settings.cfg');
    fs.writeFileSync(sourcePath, 'original', 'utf8');
    const backupId = mode === 'target-drift' ? '44444444-4444-4444-8444-444444444444' : '55555555-5555-4555-8555-555555555555';
    const backup = gameConfig.createGameConfigBackup(userData, 'counter-strike-2-display-review', [sourcePath], { randomUuid: () => backupId });
    fs.writeFileSync(sourcePath, 'candidate', 'utf8');
    const preview = gameConfig.createGameConfigRestorePreview(userData, backup.backupId);

    if (mode === 'target-drift') fs.writeFileSync(sourcePath, 'changed after preview', 'utf8');
    else {
      const manifest = JSON.parse(fs.readFileSync(path.join(userData, 'game-config-backups', backup.backupId, 'manifest.json'), 'utf8'));
      fs.writeFileSync(path.join(userData, 'game-config-backups', backup.backupId, manifest.files[0].storedName), 'tampered backup', 'utf8');
    }

    assert.throws(
      () => gameConfig.applyGameConfigRestore(userData, preview),
      mode === 'target-drift' ? /changed after preview/ : /integrity verification failed/
    );
    assert.equal(fs.readFileSync(sourcePath, 'utf8'), mode === 'target-drift' ? 'changed after preview' : 'candidate');
  }
});

test('backup refuses duplicate, unsupported, oversized, and directory selections', () => {
  const userData = temporaryDirectory();
  const sourceRoot = temporaryDirectory();
  const supported = path.join(sourceRoot, 'settings.ini');
  fs.writeFileSync(supported, 'ok', 'utf8');
  assert.throws(() => gameConfig.createGameConfigBackup(userData, 'fortnite-pc-performance-review', [supported, supported]), /Duplicate/);

  const unsupported = path.join(sourceRoot, 'settings.exe');
  fs.writeFileSync(unsupported, 'no', 'utf8');
  assert.throws(() => gameConfig.createGameConfigBackup(userData, 'fortnite-pc-performance-review', [unsupported]), /Unsupported/);
  assert.throws(() => gameConfig.createGameConfigBackup(userData, 'fortnite-pc-performance-review', [sourceRoot]), /Unsupported|regular files/);

  const oversized = path.join(sourceRoot, 'oversized.cfg');
  fs.writeFileSync(oversized, Buffer.alloc(gameConfig.MAX_FILE_BYTES + 1));
  assert.throws(() => gameConfig.createGameConfigBackup(userData, 'fortnite-pc-performance-review', [oversized]), /exceeds/);
});

test('game-config IPC keeps filesystem selection and restore authority in the main process', () => {
  const root = path.join(__dirname, '..');
  const mainSource = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
  const preloadSource = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
  const capabilities = require('../src/main/capabilities/index.cjs');

  for (const capabilityId of ['game:installed-discovery', 'game:config-backup', 'game:config-restore']) {
    assert.equal(capabilities.requireCapability(capabilityId, 'public').id, capabilityId);
  }
  assert.match(mainSource, /showOpenDialog\(mainWindow/);
  assert.match(mainSource, /createGameConfigBackup\(app\.getPath\('userData'\), gameId, selection\.filePaths\)/);
  assert.match(mainSource, /serializeMutation\(async \(\) => \{[^}]*await assertGameClosed\(pending.preview.gameId\);\s+return applyGameConfigRestore/);
  assert.match(mainSource, /const pending = gameConfigRestorePreviews\.take\(token\)/);
  assert.match(mainSource, /gameConfigRestorePreviews\.assertFresh\(pending\)/);
  assert.match(preloadSource, /createGameConfigBackup: \(gameId\) => ipcRenderer\.invoke\('pc-opti:create-game-config-backup', gameId\)/);
  assert.doesNotMatch(preloadSource, /filePaths|sourcePath|readFile|writeFile/);
});

test('game-config restores are confined to the signed-in account own profile', () => {
  // The manifest is read from per-user app data, which a same-user process without
  // elevation can write. Dialed runs elevated, so a forged manifest must not be able
  // to name a destination the person could not already write themselves.
  const environment = {
    LOCALAPPDATA: String.raw`C:\Users\tester\AppData\Local`,
    APPDATA: String.raw`C:\Users\tester\AppData\Roaming`,
    USERPROFILE: String.raw`C:\Users\tester`,
  };
  const allowed = [
    String.raw`C:\Users\tester\AppData\Local\FortniteGame\Saved\Config\WindowsClient\GameUserSettings.ini`,
    String.raw`C:\Users\tester\Saved Games\Respawn\Apex\local\videoconfig.txt`,
    String.raw`C:\Users\tester\Documents\My Games\Rocket League\TAGame\Config\TASystemSettings.ini`,
    String.raw`c:\users\TESTER\Documents\mixed-case.ini`,
  ];
  for (const candidate of allowed) {
    assert.doesNotThrow(() => gameConfig.assertRestorableConfigPath(candidate, environment), `expected ${candidate} to be allowed`);
  }

  const refused = [
    String.raw`C:\Program Files\Vendor\settings.ini`,
    String.raw`C:\Windows\System32\drivers\etc\hosts.txt`,
    String.raw`C:\ProgramData\Vendor\config.json`,
    String.raw`C:\Users\other-account\Documents\settings.ini`,
    String.raw`C:\Users\tester\..\other-account\settings.ini`,
  ];
  for (const candidate of refused) {
    assert.throws(() => gameConfig.assertRestorableConfigPath(candidate, environment), /inside your own user profile/, `expected ${candidate} to be refused`);
  }

  assert.throws(() => gameConfig.assertRestorableConfigPath(String.raw`C:\Users\tester\ok.ini`, {}), /profile folders/);
});
