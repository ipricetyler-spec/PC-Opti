const fs = require('fs');
const path = require('path');
const { runPowerShell } = require('../scanner/index.cjs');
const { createGameConfigBackup, readConfigFile, replaceConfigFiles, sha256 } = require('../game-config/index.cjs');

const PROFILES = [
  {
    id: 'fortnite-low-effects-v1', gameId: 'fortnite-pc-performance-review', game: 'Fortnite', title: 'Lower effects load',
    description: 'Set shadows, post-processing and effects to Low. Keeps resolution, textures, view distance and rendering mode unchanged.',
    evidence: 'Epic documents these engine quality keys. Current Fortnite in-game acceptance and performance remain unverified.',
    sourceUrl: 'https://dev.epicgames.com/documentation/en-us/unreal-engine/scalability-reference-for-unreal-engine',
    pathSourceUrl: 'https://www.epicgames.com/help/c-1/a202300000017401?lang=en-US',
    section: 'ScalabilityGroups',
    keys: ['sg.ShadowQuality', 'sg.PostProcessQuality', 'sg.EffectsQuality'], value: '0', valid: /^[0-4]$/,
    root: 'localAppData', segments: ['FortniteGame', 'Saved', 'Config', 'WindowsClient', 'GameUserSettings.ini'],
    fileHint: '%LOCALAPPDATA%/FortniteGame/Saved/Config/WindowsClient/GameUserSettings.ini',
    reviewedAt: '2026-08-27',
  },
  {
    id: 'rocket-league-clear-effects-v1', gameId: 'rocket-league-pc-performance-review', game: 'Rocket League', title: 'Reduce blur and dynamic shadows',
    description: 'Turn off existing motion-blur and dynamic-shadow keys. Keeps resolution, frame cap, textures and controls unchanged.',
    evidence: 'Candidate mapping of existing UE3-style keys; Epic confirms the config location, not these exact key values. Manual in-game acceptance is required before public release.',
    sourceUrl: 'https://www.epicgames.com/help/c-202300000001748/a202300000010466?lang=en-US',
    pathSourceUrl: 'https://www.epicgames.com/help/c-202300000001622/c-202300000001679/a202300000082700',
    section: 'SystemSettings', keys: ['MotionBlur', 'DynamicShadows'], value: 'False', valid: /^(true|false)$/i,
    root: 'documents', segments: ['My Games', 'Rocket League', 'TAGame', 'Config', 'TASystemSettings.ini'],
    fileHint: 'Windows Documents/My Games/Rocket League/TAGame/Config/TASystemSettings.ini',
    reviewedAt: '2026-08-27',
  },
  {
    id: 'valorant-low-effects-v1', gameId: 'valorant-pc-performance-review', game: 'VALORANT', title: 'Lower engine effects load',
    description: 'Set existing shadow, post-processing and effects groups to Low. Keeps resolution, textures, anti-aliasing, controls and network settings unchanged.',
    evidence: 'Riot recommends lowering graphics quality for low client FPS. The exact keys and account-scoped WindowsClient location were observed in a current local fixture; current-game acceptance and performance remain unverified.',
    sourceUrl: 'https://playvalorant.com/en-us/news/game-updates/valorant-game-and-network-instability-basics/',
    pathSourceUrl: 'https://support-valorant.riotgames.com/hc/ja/articles/45508835861779',
    section: 'ScalabilityGroups',
    keys: ['sg.ShadowQuality', 'sg.PostProcessQuality', 'sg.EffectsQuality'], value: '0', valid: /^[0-4]$/,
    root: 'localAppData', discovery: 'valorantAccountWindowsClient',
    fileHint: '%LOCALAPPDATA%/VALORANT/Saved/Config/<account>/WindowsClient/GameUserSettings.ini; exactly one account file is required',
    reviewedAt: '2026-08-29',
  },
  {
    id: 'arc-raiders-low-effects-v1', gameId: 'arc-raiders-pc-performance-review', game: 'ARC Raiders', title: 'Lower effects load',
    description: 'Set shadows, post-processing and effects to Low. Keeps resolution, textures, view distance, anti-aliasing, upscaling, controls, networking and anti-cheat state unchanged.',
    evidence: 'Embark publishes a Low graphics performance target. Epic documents these engine quality groups, and the exact WindowsClient path and keys were observed read-only in a current local ARC Raiders installation. Current-game acceptance and performance remain unverified.',
    sourceUrl: 'https://dev.epicgames.com/documentation/en-us/unreal-engine/scalability-reference-for-unreal-engine',
    pathSourceUrl: 'https://id.embark.games/arc-raiders/support/faq/154-pc-system-requirements-1759329994',
    section: 'ScalabilityGroups',
    keys: ['sg.ShadowQuality', 'sg.PostProcessQuality', 'sg.EffectsQuality'], value: '0', valid: /^[0-4]$/,
    root: 'localAppData', segments: ['PioneerGame', 'Saved', 'Config', 'WindowsClient', 'GameUserSettings.ini'],
    fileHint: '%LOCALAPPDATA%/PioneerGame/Saved/Config/WindowsClient/GameUserSettings.ini',
    reviewedAt: '2026-08-29',
  },
];

const GAME_PROCESSES = {
  'fortnite-pc-performance-review': /^(fortnite|fortnitelauncher)/i,
  'rocket-league-pc-performance-review': /^rocketleague$/i,
  'apex-legends-pc-performance-review': /^(r5apex|r5apex_dx12)$/i,
  'counter-strike-2-display-review': /^cs2$/i,
  // The game itself runs as VALORANT-Win64-Shipping; VALORANT.exe is only its launcher.
  'valorant-pc-performance-review': /^(valorant|valorant-win64-shipping|riotclientservices|riotclientux|riotclientuxrender)$/i,
  // Both the launcher stub and Binaries\Win64 are PioneerGame.exe (read on the owner's PC).
  'arc-raiders-pc-performance-review': /^pioneergame$/i,
  'battlefield-6-pc-performance-review': /^(bf6|battlefield6)$/i,
  'league-of-legends-pc-performance-review': /^(league of legends|leagueclient|leagueclientux)$/i,
  'overwatch-2-pc-performance-review': /^overwatch$/i,
  'call-of-duty-black-ops-7-performance-review': /^cod$/i,
};

async function listProcessNames() {
  const result = await runPowerShell("$ErrorActionPreference = 'Stop'; $names = @(Get-Process -ErrorAction Stop | Select-Object -ExpandProperty ProcessName); ConvertTo-Json -InputObject $names -Compress");
  return JSON.parse(result.stdout);
}

async function assertGameClosed(gameId, dependencies = {}) {
  const pattern = GAME_PROCESSES[gameId];
  if (!pattern) throw new Error('No reviewed process check exists for this game. No file was changed.');
  let names;
  try { names = await (dependencies.listProcessNames || listProcessNames)(); }
  catch { throw new Error('Cannot verify whether the game is closed. No file was changed.'); }
  if (!Array.isArray(names) || !names.length || names.some((name) => typeof name !== 'string' || !name.trim())) throw new Error('Process inventory is unavailable. No file was changed.');
  if (names.some((name) => pattern.test(name.replace(/\.exe$/i, '')))) throw new Error('Close the game before preview, apply or restore. No file was changed.');
}

function profileById(id) {
  const profile = PROFILES.find((item) => item.id === id);
  if (!profile) throw new Error('Game profile is not registered.');
  return profile;
}

function listGameProfiles() {
  return PROFILES.map(({ id, gameId, game, title, description, evidence, sourceUrl, pathSourceUrl, fileHint, reviewedAt }) => ({ id, gameId, game, title, description, evidence, sourceUrl, pathSourceUrl, fileHint, validation: 'MANUAL_ACCEPTANCE_PENDING', reviewedAt }));
}

// Preserve BOM, encoding, comments, whitespace, line endings and unrelated keys.
// Refuse new, missing, duplicate or unexpected values instead of guessing schemas.
function patchIni(bytes, profileId) {
  const profile = profileById(profileId);
  return editIni(bytes, profile, () => profile.value);
}

/**
 * Rewrites only the profile's keys in its one section. valueFor(key, before) returns the value
 * to write, or null to leave that key as it is. Everything else in the file is kept byte for byte.
 */
function editIni(bytes, profile, valueFor) {
  let encoding = 'utf8';
  let bom = Buffer.alloc(0);
  let body = bytes;
  if (bytes.subarray(0, 2).equals(Buffer.from([0xff, 0xfe]))) { encoding = 'utf16le'; bom = bytes.subarray(0, 2); body = bytes.subarray(2); }
  else if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) { bom = bytes.subarray(0, 3); body = bytes.subarray(3); }
  const text = body.toString(encoding);
  if (!Buffer.from(text, encoding).equals(body) || text.includes('\u0000') || text.includes('\ufffd')) throw new Error('Unsupported or invalid configuration encoding. No file was changed.');
  const lines = text.split(/(\r\n|\n|\r)/);
  let section = '';
  let sectionCount = 0;
  const changes = [];
  const found = new Set();
  for (let index = 0; index < lines.length; index += 2) {
    const header = lines[index].match(/^\s*\[([^\]]+)\]\s*(?:[;#].*)?$/);
    if (header) {
      section = header[1].trim().toLowerCase();
      if (section === profile.section.toLowerCase()) sectionCount += 1;
      continue;
    }
    if (/^\s*\[/.test(lines[index])) throw new Error('Unrecognized INI section syntax. No file was changed.');
    if (section !== profile.section.toLowerCase()) continue;
    const assignment = lines[index].match(/^(\s*([^=;#]+?)\s*=\s*)([^;#]*?)(\s*(?:[;#].*)?)$/);
    if (!assignment) continue;
    const key = profile.keys.find((key) => key.toLowerCase() === assignment[2].trim().toLowerCase());
    if (!key) continue;
    if (found.has(key)) throw new Error(`Duplicate setting ${key}. No file was changed.`);
    found.add(key);
    const before = assignment[3].trim();
    if (!profile.valid.test(before)) throw new Error(`Unrecognized value for ${key}. No file was changed.`);
    const target = valueFor(key, before);
    if (target === null || before.toLowerCase() === target.toLowerCase()) continue;
    if (!profile.valid.test(target)) throw new Error(`Refused to write an unexpected value for ${key}. No file was changed.`);
    lines[index] = `${assignment[1]}${target}${assignment[4]}`;
    changes.push({ section: profile.section, key, before, after: target });
  }
  if (sectionCount !== 1 || found.size !== profile.keys.length) throw new Error('Expected config section or keys are missing or ambiguous. Launch the game once, then close it, or use its in-game controls. No file was changed.');
  return { after: Buffer.concat([bom, Buffer.from(lines.join(''), encoding)]), changes };
}

function fixedProfilePath(profile, roots) {
  const root = roots?.[profile.root];
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('The Windows configuration folder is unavailable.');
  return path.join(root, ...profile.segments);
}

function valorantProfilePath(profile, roots, fileSystem = fs) {
  const localAppData = roots?.localAppData;
  if (typeof localAppData !== 'string' || !path.isAbsolute(localAppData)) throw new Error('The Windows configuration folder is unavailable.');
  const configRoot = path.join(localAppData, 'VALORANT', 'Saved', 'Config');
  let accountDirectories;
  try {
    accountDirectories = fileSystem.readdirSync(configRoot, { withFileTypes: true });
  } catch (error) {
    throw new Error(`Cannot inspect the supported VALORANT configuration folder: ${error.code || error.message}. No file was changed.`);
  }
  if (!Array.isArray(accountDirectories) || accountDirectories.length > 128) throw new Error('The VALORANT configuration folder is unavailable or unexpectedly large. No file was changed.');
  const candidates = accountDirectories
    .filter((entry) => entry && typeof entry.name === 'string' && entry.name === path.basename(entry.name) && entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => path.join(configRoot, entry.name, 'WindowsClient', 'GameUserSettings.ini'))
    .filter((candidate) => {
      try { return fileSystem.lstatSync(candidate).isFile(); }
      catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
    });
  if (!candidates.length) throw new Error('No account-scoped VALORANT WindowsClient configuration was found. Launch the game once, then close it. No file was changed.');
  if (candidates.length !== 1) throw new Error('Multiple VALORANT account configurations were found. Select the active account in-game before using this profile. No file was changed.');
  return candidates[0];
}

function profilePath(profile, roots, fileSystem = fs) {
  if (profile.discovery === 'valorantAccountWindowsClient') return valorantProfilePath(profile, roots, fileSystem);
  return fixedProfilePath(profile, roots);
}

async function previewGameProfile(profileId, roots, dependencies = {}) {
  const profile = profileById(profileId);
  await assertGameClosed(profile.gameId, dependencies);
  const fileSystem = dependencies.fileSystem || fs;
  const sourcePath = profilePath(profile, roots, fileSystem);
  let before;
  try { before = readConfigFile(sourcePath, fileSystem); }
  catch (error) { throw new Error(`Cannot read the supported configuration: ${error.code || error.message}. No file was changed.`); }
  const { after, changes } = patchIni(before, profileId);
  return { profileId, gameId: profile.gameId, sourcePath, beforeSha256: sha256(before), afterSha256: sha256(after), changes, previewedAt: new Date().toISOString() };
}

async function applyGameProfile(userDataPath, preview, roots, dependencies = {}) {
  const fileSystem = dependencies.fileSystem || fs;
  const fresh = await previewGameProfile(preview.profileId, roots, dependencies);
  if (fresh.sourcePath !== preview.sourcePath || fresh.beforeSha256 !== preview.beforeSha256 || fresh.afterSha256 !== preview.afterSha256) throw new Error('Configuration changed after preview. No file was changed. Request a new preview.');
  if (!fresh.changes.length) throw new Error('These settings already match. No file was changed.');
  const before = readConfigFile(fresh.sourcePath, fileSystem);
  if (sha256(before) !== preview.beforeSha256) throw new Error('Configuration changed after preview. No file was changed.');
  const { after } = patchIni(before, preview.profileId);
  const backup = createGameConfigBackup(userDataPath, preview.gameId, [fresh.sourcePath], dependencies);
  if (backup.files[0].sha256 !== preview.beforeSha256) throw new Error('Configuration changed while backing up. No file was changed.');
  // Verify the durable backup itself before mutation, not just its manifest.
  const backupBytes = readConfigFile(path.join(userDataPath, 'game-config-backups', backup.backupId, `01-${path.basename(fresh.sourcePath)}`), fileSystem);
  if (sha256(backupBytes) !== preview.beforeSha256) throw new Error('Backup verification failed. No file was changed.');
  // What this apply changes, key by key, so undo can put back only these keys later instead of
  // the whole file (the game rewrites the file on every exit).
  fileSystem.writeFileSync(profileRecordPath(userDataPath, backup.backupId), JSON.stringify({ schemaVersion: 1, profileId: preview.profileId, sourcePath: fresh.sourcePath, changes: fresh.changes, afterSha256: fresh.afterSha256 }, null, 2), { encoding: 'utf8', flag: 'wx' });
  const result = replaceConfigFiles(userDataPath, backup.backupId, [{ sourcePath: fresh.sourcePath, before, after }], 'PROFILE_APPLY', dependencies);
  return { profileId: preview.profileId, backup, appliedAt: result.restoredAt, afterSha256: fresh.afterSha256, changedCount: fresh.changes.length, recoveryPath: result.recoveryPath, status: 'FILE_VERIFIED', gameEffect: 'UNVERIFIED', log: ['Game closed check passed.', 'Current configuration matches preview.', 'Exact backup saved and hash-verified.', `${fresh.changes.length} settings written and file hash verified.`, 'In-game acceptance and performance have not been tested.'] };
}

const BACKUP_ID = /^[0-9a-f-]{36}$/i;

function profileRecordPath(userDataPath, backupId) {
  if (typeof backupId !== 'string' || !BACKUP_ID.test(backupId)) throw new Error('Game-config backup id is invalid.');
  return path.join(userDataPath, 'game-config-backups', backupId, 'profile-apply.json');
}

/** The key changes a profile apply recorded with its backup, or null when there are none. */
function readProfileRecord(userDataPath, backupId, fileSystem = fs) {
  const recordPath = profileRecordPath(userDataPath, backupId);
  let bytes;
  try { bytes = readConfigFile(recordPath, fileSystem); } catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
  const record = JSON.parse(bytes.toString('utf8'));
  const profile = PROFILES.find((item) => item.id === record?.profileId);
  if (record?.schemaVersion !== 1 || !profile || typeof record.sourcePath !== 'string' || !Array.isArray(record.changes) || !record.changes.length) throw new Error('The saved profile record is not valid.');
  for (const change of record.changes) {
    if (!profile.keys.includes(change?.key) || !profile.valid.test(String(change.before)) || !profile.valid.test(String(change.after))) throw new Error('The saved profile record is not valid.');
  }
  const undone = fileSystem.existsSync(path.join(path.dirname(recordPath), 'profile-undo.json'));
  return { ...record, profile, undone };
}

/**
 * Undo that puts back only the keys the profile changed, and only while each still holds the
 * value Dialed wrote. A key changed since (in the game, or anywhere) is not overwritten.
 */
async function previewGameProfileUndo(userDataPath, backupId, roots, dependencies = {}) {
  const fileSystem = dependencies.fileSystem || fs;
  const record = readProfileRecord(userDataPath, backupId, fileSystem);
  if (!record) throw new Error('This backup was not made by a game profile, so there is nothing to undo key by key. Nothing was changed.');
  if (record.undone) throw new Error('This profile was already undone. Nothing was changed.');
  const { profile } = record;
  await assertGameClosed(profile.gameId, dependencies);
  const sourcePath = profilePath(profile, roots, fileSystem);
  if (sourcePath.toLowerCase() !== record.sourcePath.toLowerCase()) throw new Error('The game now keeps its settings in a different file. Nothing was changed.');
  let current;
  try { current = readConfigFile(sourcePath, fileSystem); }
  catch (error) { throw new Error(`Cannot read the game's settings: ${error.code || error.message}. Nothing was changed.`); }
  const now = {};
  editIni(current, profile, (key, before) => { now[key] = before; return null; });
  const changedSince = record.changes.filter((change) => String(now[change.key]).toLowerCase() !== String(change.after).toLowerCase());
  if (changedSince.length) {
    throw new Error(`Since the profile was applied, ${changedSince.map((change) => `${change.key} changed to ${now[change.key]}`).join(', ')}. Dialed will not overwrite ${changedSince.length === 1 ? 'that' : 'those'}. Change ${changedSince.length === 1 ? 'it' : 'them'} in the game, or restore the whole file from this backup. Nothing was changed.`);
  }
  const restoreTo = Object.fromEntries(record.changes.map((change) => [change.key, String(change.before)]));
  const { after, changes } = editIni(current, profile, (key) => restoreTo[key] ?? null);
  return { backupId, profileId: profile.id, game: profile.game, sourcePath, beforeSha256: sha256(current), afterSha256: sha256(after), changes };
}

async function applyGameProfileUndo(userDataPath, preview, roots, dependencies = {}) {
  const fileSystem = dependencies.fileSystem || fs;
  const fresh = await previewGameProfileUndo(userDataPath, preview.backupId, roots, dependencies);
  if (fresh.sourcePath !== preview.sourcePath || fresh.beforeSha256 !== preview.beforeSha256 || fresh.afterSha256 !== preview.afterSha256) throw new Error('The settings file changed after preview. Nothing was changed. Request a new preview.');
  const before = readConfigFile(fresh.sourcePath, fileSystem);
  if (sha256(before) !== preview.beforeSha256) throw new Error('The settings file changed after preview. Nothing was changed.');
  const { after } = editIni(before, profileById(preview.profileId), (key) => Object.fromEntries(fresh.changes.map((change) => [change.key, change.after]))[key] ?? null);
  const result = replaceConfigFiles(userDataPath, preview.backupId, [{ sourcePath: fresh.sourcePath, before, after }], 'PROFILE_UNDO', dependencies);
  fileSystem.writeFileSync(path.join(path.dirname(profileRecordPath(userDataPath, preview.backupId)), 'profile-undo.json'), JSON.stringify({ undoneAt: result.restoredAt, afterSha256: fresh.afterSha256 }, null, 2), { encoding: 'utf8', flag: 'wx' });
  return { backupId: preview.backupId, undoneAt: result.restoredAt, changedCount: fresh.changes.length, status: 'FILE_VERIFIED' };
}

module.exports = { listGameProfiles, patchIni, assertGameClosed, previewGameProfile, applyGameProfile, readProfileRecord, previewGameProfileUndo, applyGameProfileUndo };
