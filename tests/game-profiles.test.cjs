const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, afterEach } = require('node:test');
const profiles = require('../src/main/game-profiles/index.cjs');
const configs = require('../src/main/game-config/index.cjs');
const { createPreviewStore } = require('../src/main/shared/preview-store.cjs');
const dirs = [];
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });
const fortnite = 'fortnite-low-effects-v1';
const rocket = 'rocket-league-clear-effects-v1';
const valorant = 'valorant-low-effects-v1';
const arc = 'arc-raiders-low-effects-v1';
const original = '; header\r\n[ScalabilityGroups]\r\nsg.ShadowQuality = 3  ; shadows\r\nsg.PostProcessQuality=2\r\nsg.EffectsQuality=1\r\nsg.TextureQuality=3\r\n[Other]\r\nUnicode=日本語\r\n';
const valorantOriginal = '[ScalabilityGroups]\nsg.ViewDistanceQuality=3\nsg.AntiAliasingQuality=3\nsg.ShadowQuality=3\nsg.PostProcessQuality=3\nsg.TextureQuality=1\nsg.EffectsQuality=3\nsg.FoliageQuality=3\nsg.ShadingQuality=3\n';
const arcOriginal = '[ScalabilityGroups]\nsg.ResolutionQuality=100\nsg.ViewDistanceQuality=2\nsg.AntiAliasingQuality=2\nsg.ShadowQuality=1\nsg.PostProcessQuality=0\nsg.TextureQuality=2\nsg.EffectsQuality=0\nsg.FoliageQuality=2\nsg.ShadingQuality=2\n';
const closed = { listProcessNames: async () => ['System', 'explorer'] };
function fixture(id = fortnite) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dialed-profile-fixture-'));
  dirs.push(root);
  const roots = { localAppData: path.join(root, 'Local'), documents: path.join(root, 'RedirectedDocuments') };
  const source = id === fortnite
    ? path.join(roots.localAppData, 'FortniteGame/Saved/Config/WindowsClient/GameUserSettings.ini')
    : id === rocket
      ? path.join(roots.documents, 'My Games/Rocket League/TAGame/Config/TASystemSettings.ini')
      : id === valorant
        ? path.join(roots.localAppData, 'VALORANT/Saved/Config/fixture-account-na/WindowsClient/GameUserSettings.ini')
        : path.join(roots.localAppData, 'PioneerGame/Saved/Config/WindowsClient/GameUserSettings.ini');
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, id === fortnite ? original : id === rocket ? '[SystemSettings]\nMotionBlur=True\nDynamicShadows=True\nResX=1920\n' : id === valorant ? valorantOriginal : arcOriginal);
  return { root, roots, source, userData: path.join(root, 'user-data') };
}

test('profiles keep explicit candidate evidence and expose no raw editable recipe to renderer', () => {
  const list = profiles.listGameProfiles();
  assert.equal(list.length, 4);
  for (const profile of list) {
    assert.equal(profile.validation, 'MANUAL_ACCEPTANCE_PENDING');
    assert.match(profile.sourceUrl, /^https:\/\/(?:www|dev)\.epicgames\.com\/|^https:\/\/playvalorant\.com\//);
    assert.equal(profile.keys, undefined);
  }
  assert.match(list[1].evidence, /not these exact key values/);
  assert.match(list[2].evidence, /current local fixture/);
  assert.equal(list[2].reviewedAt, '2026-08-29');
  assert.match(list[3].evidence, /current local ARC Raiders installation/);
  assert.equal(list[3].reviewedAt, '2026-08-29');
  list[0].id = 'tampered';
  assert.equal(profiles.listGameProfiles()[0].id, fortnite);
});

for (const [label, encoding, bom] of [['UTF8', 'utf8', []], ['UTF8 BOM', 'utf8', [239, 187, 191]], ['UTF16LE BOM', 'utf16le', [255, 254]]]) {
  test(`INI patch preserves ${label}, comments, whitespace and unrelated keys byte-for-byte`, () => {
    const before = Buffer.concat([Buffer.from(bom), Buffer.from(original, encoding)]);
    const patched = profiles.patchIni(before, fortnite);
    const expected = original.replace('sg.ShadowQuality = 3', 'sg.ShadowQuality = 0').replace('sg.PostProcessQuality=2', 'sg.PostProcessQuality=0').replace('sg.EffectsQuality=1', 'sg.EffectsQuality=0');
    assert.deepEqual(patched.after, Buffer.concat([Buffer.from(bom), Buffer.from(expected, encoding)]));
    assert.equal(patched.changes.length, 3);
    assert.equal(profiles.patchIni(patched.after, fortnite).changes.length, 0);
  });
}

test('Rocket League changes only two existing Boolean keys and preserves frame and resolution settings', () => {
  const before = Buffer.from('[SystemSettings]\nMotionBlur=TRUE\nDynamicShadows=False\nResX=1920\nMaxSmoothedFrameRate=144');
  const result = profiles.patchIni(before, rocket);
  assert.equal(result.changes.length, 1);
  assert.equal(result.after.toString(), before.toString().replace('MotionBlur=TRUE', 'MotionBlur=False'));
});

test('VALORANT changes only three observed engine groups and preserves resolution, textures and anti-aliasing', () => {
  const result = profiles.patchIni(Buffer.from(valorantOriginal), valorant);
  assert.equal(result.changes.length, 3);
  assert.match(result.after.toString(), /sg\.ShadowQuality=0/);
  assert.match(result.after.toString(), /sg\.PostProcessQuality=0/);
  assert.match(result.after.toString(), /sg\.EffectsQuality=0/);
  for (const setting of ['sg.ViewDistanceQuality=3', 'sg.AntiAliasingQuality=3', 'sg.TextureQuality=1', 'sg.FoliageQuality=3', 'sg.ShadingQuality=3']) assert.ok(result.after.toString().includes(setting));
});

test('ARC Raiders changes only the remaining reviewed engine group and preserves resolution, textures, view distance and anti-aliasing', () => {
  const result = profiles.patchIni(Buffer.from(arcOriginal), arc);
  assert.equal(result.changes.length, 1);
  assert.match(result.after.toString(), /sg\.ShadowQuality=0/);
  assert.match(result.after.toString(), /sg\.PostProcessQuality=0/);
  assert.match(result.after.toString(), /sg\.EffectsQuality=0/);
  for (const setting of ['sg.ResolutionQuality=100', 'sg.ViewDistanceQuality=2', 'sg.AntiAliasingQuality=2', 'sg.TextureQuality=2', 'sg.FoliageQuality=2', 'sg.ShadingQuality=2']) assert.ok(result.after.toString().includes(setting));
});

test('VALORANT discovery selects one account config and refuses any second account', async () => {
  const f = fixture(valorant);
  const preview = await profiles.previewGameProfile(valorant, f.roots, closed);
  assert.equal(preview.sourcePath, f.source);
  const unrelated = path.join(f.roots.localAppData, 'VALORANT/Saved/Config/other-account-na/WindowsClient/GameUserSettings.ini');
  fs.mkdirSync(path.dirname(unrelated), { recursive: true });
  fs.writeFileSync(unrelated, '[Unrelated]\nSetting=True\n');
  await assert.rejects(profiles.previewGameProfile(valorant, f.roots, closed), /Multiple VALORANT account/);
});

test('VALORANT discovery fails closed when its account config is missing and when Riot Client is running', async () => {
  const f = fixture(valorant);
  fs.rmSync(f.source);
  await assert.rejects(profiles.previewGameProfile(valorant, f.roots, closed), /No account-scoped/);
  fs.writeFileSync(f.source, valorantOriginal);
  await assert.rejects(profiles.previewGameProfile(valorant, f.roots, { listProcessNames: async () => ['RiotClientServices.exe'] }), /Close the game/);
});

for (const [label, input] of [
  ['missing key', original.replace('sg.EffectsQuality=1', 'Unknown=1')],
  ['duplicate key', original.replace('sg.EffectsQuality=1', 'sg.EffectsQuality=1\r\nsg.effectsquality=2')],
  ['duplicate section', `${original}[ScalabilityGroups]\r\n`],
  ['unknown value', original.replace('sg.EffectsQuality=1', 'sg.EffectsQuality=99')],
  ['missing section', original.replace('[ScalabilityGroups]', '[Unknown]')],
  ['malformed section', original.replace('[Other]', '[Other] invalid')],
  ['invalid UTF8', Buffer.from([255, 251, 25])],
  ['binary NUL', `${original}\u0000`],
]) test(`INI parser refuses ${label}`, () => assert.throws(() => profiles.patchIni(Buffer.from(input), fortnite)));

test('preview does not write files, create backups or invoke Windows with fixture adapters', async () => {
  const f = fixture();
  const preview = await profiles.previewGameProfile(fortnite, f.roots, closed);
  assert.equal(preview.changes.length, 3);
  assert.equal(fs.existsSync(f.userData), false);
  assert.equal(fs.readFileSync(f.source, 'utf8'), original);
  await assert.rejects(profiles.previewGameProfile('unknown-profile', f.roots, closed), /not registered/);
});

for (const id of [fortnite, rocket, valorant, arc]) test(`${id}: apply creates an exact backup; restore returns original bytes`, async () => {
  const f = fixture(id);
  const before = fs.readFileSync(f.source);
  const preview = await profiles.previewGameProfile(id, f.roots, closed);
  const result = await profiles.applyGameProfile(f.userData, preview, f.roots, closed);
  assert.equal(result.status, 'FILE_VERIFIED');
  assert.equal(result.gameEffect, 'UNVERIFIED');
  assert.equal(result.backup.files[0].sha256, configs.sha256(before));
  assert.equal(configs.sha256(fs.readFileSync(f.source)), preview.afterSha256);
  assert.equal(JSON.parse(fs.readFileSync(path.join(result.recoveryPath, 'transaction.json'))).status, 'VERIFIED');
  const restorePreview = configs.createGameConfigRestorePreview(f.userData, result.backup.backupId);
  configs.applyGameConfigRestore(f.userData, restorePreview);
  assert.deepEqual(fs.readFileSync(f.source), before);
});

test('unknown, unavailable and running process state fail closed', async () => {
  for (const names of [null, [], [''], ['FortniteClient-Win64-Shipping.exe'], ['FortniteLauncher']]) {
    await assert.rejects(profiles.assertGameClosed('fortnite-pc-performance-review', { listProcessNames: async () => names }), /No file was changed/);
  }
  await assert.rejects(profiles.assertGameClosed('fortnite-pc-performance-review', { listProcessNames: async () => { throw new Error('timeout'); } }), /Cannot verify/);
  await assert.rejects(profiles.assertGameClosed('arc-raiders-pc-performance-review', { listProcessNames: async () => ['PioneerGame.exe'] }), /No file was changed/);
  await assert.rejects(profiles.assertGameClosed('call-of-duty-black-ops-7-performance-review', { listProcessNames: async () => ['cod.exe'] }), /Close the game/);
  await assert.doesNotReject(profiles.assertGameClosed('call-of-duty-black-ops-7-performance-review', { listProcessNames: async () => ['code.exe'] }));
  await assert.rejects(profiles.assertGameClosed('unknown', closed), /No reviewed process/);
});

test('apply rechecks running-game state and file drift without creating a backup or writing a target', async () => {
  const f = fixture();
  const preview = await profiles.previewGameProfile(fortnite, f.roots, closed);
  await assert.rejects(profiles.applyGameProfile(f.userData, preview, f.roots, { listProcessNames: async () => ['FortniteClient-Win64-Shipping'] }), /Close the game/);
  fs.appendFileSync(f.source, '; external edit');
  await assert.rejects(profiles.applyGameProfile(f.userData, preview, f.roots, closed), /changed after preview/);
  assert.equal(fs.existsSync(f.userData), false);
  assert.equal(fs.readFileSync(f.source, 'utf8'), `${original}; external edit`);
});

test('no-op profiles do not create a backup or pretend to apply', async () => {
  const f = fixture();
  fs.writeFileSync(f.source, profiles.patchIni(Buffer.from(original), fortnite).after);
  const preview = await profiles.previewGameProfile(fortnite, f.roots, closed);
  assert.deepEqual(preview.changes, []);
  await assert.rejects(profiles.applyGameProfile(f.userData, preview, f.roots, closed), /already match/);
  assert.equal(fs.existsSync(f.userData), false);
});

test('preview tokens expire, are single-use, and recheck expiration after queuing', () => {
  let clock = 0;
  const store = createPreviewStore(() => clock);
  const first = store.issue({ profileId: fortnite });
  assert.equal(store.take(first.token).preview.profileId, fortnite);
  assert.throws(() => store.take(first.token), /already used/);
  const second = store.issue({ profileId: rocket });
  clock += 300001;
  assert.throws(() => store.take(second.token), /expired/);
  const third = store.issue({ profileId: fortnite });
  const pending = store.take(third.token);
  clock += 300001;
  assert.throws(() => store.assertFresh(pending), /queued/);
  const old = store.issue({});
  store.issue({});
  assert.throws(() => store.take(old.token), /missing/);
});

for (const phase of ['stage-write', 'rename-after-success', 'result-write', 'final-record-write']) test(`restore transaction recovers the current target on ${phase} failure`, () => {
  const f = fixture();
  const backup = configs.createGameConfigBackup(f.userData, 'fortnite-pc-performance-review', [f.source]);
  const edited = 'changed before restore';
  fs.writeFileSync(f.source, edited);
  const preview = configs.createGameConfigRestorePreview(f.userData, backup.backupId);
  let failed = false;
  const fileSystem = {
    ...fs,
    writeFileSync(target, bytes, options) {
      const fail = !failed && ((phase === 'stage-write' && target.includes('.dialed-')) || (phase === 'result-write' && target.includes('restore-result.json')) || (phase === 'final-record-write' && target.includes('transaction.json') && String(bytes).includes('VERIFIED')));
      if (fail) { failed = true; throw new Error(`fixture ${phase}`); }
      return fs.writeFileSync(target, bytes, options);
    },
    renameSync(source, target) {
      fs.renameSync(source, target);
      if (!failed && phase === 'rename-after-success' && target === f.source) { failed = true; throw new Error('fixture rename-after-success'); }
    },
  };
  assert.throws(() => configs.applyGameConfigRestore(f.userData, preview, { fileSystem }), /No changes retained/);
  assert.equal(failed, true);
  assert.equal(fs.readFileSync(f.source, 'utf8'), edited);
  const base = path.join(f.userData, 'game-config-backups', backup.backupId, 'restore-recovery');
  const record = JSON.parse(fs.readFileSync(path.join(base, fs.readdirSync(base)[0], 'transaction.json')));
  assert.equal(record.status, 'ROLLED_BACK');
});

test('multi-file restore rolls back previous files when a later target fails', () => {
  const f = fixture();
  const second = path.join(f.root, 'second.ini');
  fs.writeFileSync(second, 'second original');
  const backup = configs.createGameConfigBackup(f.userData, 'fortnite-pc-performance-review', [f.source, second]);
  fs.writeFileSync(f.source, 'first changed');
  fs.writeFileSync(second, 'second changed');
  const preview = configs.createGameConfigRestorePreview(f.userData, backup.backupId);
  const fileSystem = { ...fs, renameSync(source, target) { if (target === second) throw new Error('fixture later failure'); fs.renameSync(source, target); } };
  assert.throws(() => configs.applyGameConfigRestore(f.userData, preview, { fileSystem }), /No changes retained/);
  assert.equal(fs.readFileSync(f.source, 'utf8'), 'first changed');
  assert.equal(fs.readFileSync(second, 'utf8'), 'second changed');
});

test('tampered manifest paths and stored-name traversal are refused', () => {
  const f = fixture();
  const backup = configs.createGameConfigBackup(f.userData, 'fortnite-pc-performance-review', [f.source]);
  const preview = configs.createGameConfigRestorePreview(f.userData, backup.backupId);
  const manifestPath = path.join(f.userData, 'game-config-backups', backup.backupId, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  manifest.files[0].storedName = '../elsewhere.ini';
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(() => configs.applyGameConfigRestore(f.userData, preview), /invalid file/);
  manifest.files[0].storedName = '01-GameUserSettings.ini';
  manifest.gameId = 'rocket-league-pc-performance-review';
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(() => configs.applyGameConfigRestore(f.userData, preview), /backup changed/);
  assert.equal(fs.readFileSync(f.source, 'utf8'), original);
});

test('linked ancestor and read-only targets are refused without bypassing attributes', async () => {
  const f = fixture();
  const linkedFs = { ...fs, lstatSync(target) { const stat = fs.lstatSync(target); return target === path.dirname(f.source) ? { ...stat, isSymbolicLink: () => true } : stat; } };
  await assert.rejects(profiles.previewGameProfile(fortnite, f.roots, { ...closed, fileSystem: linkedFs }), /unsafe link/);
  const preview = await profiles.previewGameProfile(fortnite, f.roots, closed);
  const readonlyFs = { ...fs, statSync(target) { const stat = fs.statSync(target); return target === f.source ? { ...stat, mode: stat.mode & ~0o222 } : stat; } };
  await assert.rejects(profiles.applyGameProfile(f.userData, preview, f.roots, { ...closed, fileSystem: readonlyFs }), /read-only/);
  assert.equal(fs.readFileSync(f.source, 'utf8'), original);
});

test('main-owned IPC keeps profile paths and settings out of renderer payloads and shares capability across tiers', () => {
  const root = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'electron/preload.cjs'), 'utf8');
  assert.match(main, /gameProfilePreviews.take\(token\)/);
  assert.match(main, /serializeMutation\(\(\) => \{\s+gameProfilePreviews.assertFresh/);
  assert.match(main, /documents: app.getPath\('documents'\)/);
  assert.match(preload, /applyGameProfile: \(token\) => ipcRenderer.invoke\('pc-opti:apply-game-profile', token\)/);
  const capabilities = require('../src/main/capabilities/index.cjs');
  for (const tier of ['public', 'consumer-premium', 'owner']) assert.equal(capabilities.requireCapability('game:reviewed-profile', tier).id, 'game:reviewed-profile');
});

test('unresolved or corrupt recovery records remain visible after restart', () => {
  const f = fixture();
  const backup = configs.createGameConfigBackup(f.userData, 'fortnite-pc-performance-review', [f.source]);
  const directory = path.join(f.userData, 'game-config-backups', backup.backupId, 'restore-recovery', 'fixture-interrupted');
  fs.mkdirSync(directory, { recursive: true });
  for (const content of [JSON.stringify({ status: 'PENDING' }), JSON.stringify({ status: 'NEEDS_REVIEW' }), 'corrupt']) {
    fs.writeFileSync(path.join(directory, 'transaction.json'), content);
    fs.writeFileSync(path.join(directory, 'restore-result.json'), '{}');
    assert.equal(configs.listGameConfigBackups(f.userData)[0].recoveryWarnings.length, 1);
  }
});

test('unrelated content introduced during staging is preserved and flagged for review', () => {
  const f = fixture();
  const backup = configs.createGameConfigBackup(f.userData, 'fortnite-pc-performance-review', [f.source]);
  fs.writeFileSync(f.source, 'before restore');
  const preview = configs.createGameConfigRestorePreview(f.userData, backup.backupId);
  let injected = false;
  const fileSystem = { ...fs, writeFileSync(target, bytes, options) {
    fs.writeFileSync(target, bytes, options);
    if (!injected && target.includes('.dialed-')) { injected = true; fs.writeFileSync(f.source, 'external concurrent content'); }
  } };
  assert.throws(() => configs.applyGameConfigRestore(f.userData, preview, { fileSystem }), /manual review/);
  assert.equal(fs.readFileSync(f.source, 'utf8'), 'external concurrent content');
  assert.equal(configs.listGameConfigBackups(f.userData)[0].recoveryWarnings.length, 1);
});
