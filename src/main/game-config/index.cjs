const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { runPowerShell } = require('../scanner/index.cjs');

const MANIFEST_SCHEMA_VERSION = '1.0.0';
const MAX_FILES_PER_BACKUP = 20;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['.cfg', '.conf', '.ini', '.json', '.txt', '.xml']);

const INSTALLED_APPLICATIONS_SCRIPT = `
$roots = @(
  'Registry::HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'Registry::HKEY_LOCAL_MACHINE\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'Registry::HKEY_LOCAL_MACHINE\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
)
$items = foreach ($root in $roots) {
  Get-ItemProperty -Path $root -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName } | ForEach-Object {
    [pscustomobject]@{
      displayName = [string]$_.DisplayName
      publisher = [string]$_.Publisher
      installLocation = [string]$_.InstallLocation
      displayVersion = [string]$_.DisplayVersion
      estimatedSizeKb = if ($_.EstimatedSize -ne $null) { [long]$_.EstimatedSize } else { $null }
    }
  }
}
@($items | Sort-Object DisplayName -Unique) | ConvertTo-Json -Compress
`;

const GAME_DISCOVERY_DEFINITIONS = Object.freeze([
  Object.freeze({
    guideId: 'fortnite-pc-performance-review',
    game: 'Fortnite',
    aliases: Object.freeze([/^fortnite$/i]),
    configHints: Object.freeze([['LOCALAPPDATA', 'FortniteGame', 'Saved', 'Config', 'WindowsClient', 'GameUserSettings.ini']]),
  }),
  Object.freeze({
    guideId: 'apex-legends-pc-performance-review',
    game: 'Apex Legends',
    aliases: Object.freeze([/^apex legends$/i]),
    configHints: Object.freeze([['USERPROFILE', 'Saved Games', 'Respawn', 'Apex', 'local', 'videoconfig.txt']]),
  }),
  Object.freeze({
    guideId: 'counter-strike-2-display-review',
    game: 'Counter-Strike 2',
    aliases: Object.freeze([/^counter-strike 2$/i]),
    configHints: Object.freeze([]),
  }),
  Object.freeze({
    guideId: 'valorant-pc-performance-review',
    game: 'VALORANT',
    aliases: Object.freeze([/^valorant$/i]),
    configHints: Object.freeze([['LOCALAPPDATA', 'VALORANT', 'Saved', 'Config']]),
  }),
  Object.freeze({
    guideId: 'battlefield-6-pc-performance-review',
    game: 'Battlefield 6',
    aliases: Object.freeze([/^battlefield\s*6$/i]),
    configHints: Object.freeze([['USERPROFILE', 'Documents', 'Battlefield 6', 'settings']]),
  }),
  Object.freeze({
    guideId: 'rocket-league-pc-performance-review',
    game: 'Rocket League',
    aliases: Object.freeze([/^rocket league$/i]),
    configHints: Object.freeze([['USERPROFILE', 'Documents', 'My Games', 'Rocket League', 'TAGame', 'Config', 'TASystemSettings.ini']]),
  }),
  Object.freeze({
    guideId: 'league-of-legends-pc-performance-review',
    game: 'League of Legends',
    aliases: Object.freeze([/^league of legends$/i]),
    configHints: Object.freeze([]),
  }),
  Object.freeze({
    guideId: 'overwatch-2-pc-performance-review',
    game: 'Overwatch 2',
    aliases: Object.freeze([/^overwatch(?: 2)?$/i]),
    configHints: Object.freeze([]),
  }),
  Object.freeze({
    guideId: 'call-of-duty-black-ops-7-performance-review',
    game: 'Call of Duty: Black Ops 7',
    aliases: Object.freeze([/^call of duty$/i, /^call of duty(?:®)?:?\s*black ops 7$/i]),
    configHints: Object.freeze([]),
  }),
]);

function parseJsonArray(text) {
  if (!text) return [];
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function listWindowsInstalledApplications() {
  const result = await runPowerShell(INSTALLED_APPLICATIONS_SCRIPT);
  return normalizeInstalledApplications(parseJsonArray(result.stdout));
}

function normalizeInstalledApplications(items) {
  const normalized = items.map((item) => ({
    displayName: String(item?.displayName || '').trim(),
    publisher: String(item?.publisher || '').trim(),
    installLocation: String(item?.installLocation || '').trim(),
    displayVersion: String(item?.displayVersion || '').trim(),
    estimatedSizeBytes: item?.estimatedSizeKb !== null && item?.estimatedSizeKb !== undefined && item?.estimatedSizeKb !== '' && Number.isFinite(Number(item.estimatedSizeKb)) && Number(item.estimatedSizeKb) >= 0 ? Math.round(Number(item.estimatedSizeKb) * 1024) : null,
  })).filter((item) => item.displayName);
  const unique = new Map();
  for (const item of normalized) {
    const key = `${item.displayName.toLowerCase()}\u0000${item.displayVersion.toLowerCase()}\u0000${item.publisher.toLowerCase()}`;
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()].sort((left, right) => left.displayName.localeCompare(right.displayName));
}

function resolveHint(parts, environment, fileSystem) {
  const [environmentName, ...segments] = parts;
  const root = String(environment[environmentName] || '').trim();
  if (!root) return null;
  const candidatePath = path.resolve(root, ...segments);
  try {
    const stat = fileSystem.lstatSync(candidatePath);
    if (stat.isSymbolicLink()) return { path: candidatePath, state: 'UNSUPPORTED_LINK' };
    if (stat.isFile()) return { path: candidatePath, state: 'EXISTING_FILE' };
    if (stat.isDirectory()) return { path: candidatePath, state: 'EXISTING_DIRECTORY' };
    return { path: candidatePath, state: 'UNSUPPORTED_TYPE' };
  } catch (error) {
    if (error?.code === 'ENOENT') return { path: candidatePath, state: 'NOT_FOUND' };
    return { path: candidatePath, state: 'UNAVAILABLE' };
  }
}

async function discoverInstalledGames(dependencies = {}) {
  const listInstalledApplications = dependencies.listInstalledApplications || listWindowsInstalledApplications;
  const environment = dependencies.environment || process.env;
  const fileSystem = dependencies.fileSystem || fs;
  const applications = await listInstalledApplications();
  const games = [];

  for (const definition of GAME_DISCOVERY_DEFINITIONS) {
    const match = applications.find((application) => definition.aliases.some((alias) => alias.test(String(application.displayName || '').trim())));
    if (!match) continue;
    games.push({
      guideId: definition.guideId,
      game: definition.game,
      detectedDisplayName: String(match.displayName || definition.game),
      publisher: String(match.publisher || ''),
      evidence: 'REGISTERED_APPLICATION',
      installLocation: String(match.installLocation || ''),
      configHints: definition.configHints.map((hint) => resolveHint(hint, environment, fileSystem)).filter(Boolean),
    });
  }

  return {
    scannedAt: new Date().toISOString(),
    games,
    limitations: 'Detection matches reviewed game names in Windows installed-application metadata. Launcher-only, portable, renamed, or per-library installs may be absent. Config hints are read-only candidates, not proof that a file should be edited.',
  };
}

function backupRoot(userDataPath) {
  return path.join(userDataPath, 'game-config-backups');
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function assertBackupId(backupId) {
  if (typeof backupId !== 'string' || !/^[0-9a-f-]{36}$/i.test(backupId)) throw new Error('Game-config backup id is not valid.');
  return backupId;
}

// A backup manifest is read from per-user app data, which a process running as the same
// user without elevation can write. Dialed runs elevated, so an unconstrained sourcePath
// would let a forged manifest turn a user-writable file into an administrator write.
// Restores are therefore confined to the user's own profile, which is where every game
// guide's config hints point and where the person could already write unaided.
function restorableConfigRoots(environment = process.env) {
  return ['LOCALAPPDATA', 'APPDATA', 'USERPROFILE']
    .map((name) => environment[name])
    .filter((value) => typeof value === 'string' && value.length > 0)
    .map((value) => path.resolve(value));
}

function isInsideRoot(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function assertRestorableConfigPath(sourcePath, environment = process.env) {
  const roots = restorableConfigRoots(environment);
  if (!roots.length) throw new Error('Dialed could not determine this account’s profile folders, so the restore was refused.');
  const candidate = path.resolve(sourcePath);
  // Windows paths are case-insensitive; compare the same way Windows resolves them.
  const normalized = candidate.toLowerCase();
  if (!roots.some((root) => isInsideRoot(normalized, root.toLowerCase()))) {
    throw new Error('Game-config backups can only restore files inside your own user profile. This backup points somewhere else and was refused.');
  }
  return candidate;
}

function assertGuideId(gameId) {
  if (typeof gameId !== 'string' || !/^[a-z0-9][a-z0-9-]{1,79}$/.test(gameId)) throw new Error('Game guide id is not valid.');
  return gameId;
}

function atomicWriteJson(filePath, value, fileSystem = fs) {
  const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  fileSystem.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), { encoding: 'utf8', flag: 'wx' });
  fileSystem.renameSync(temporaryPath, filePath);
}

function readManifest(userDataPath, backupId, fileSystem = fs) {
  const safeId = assertBackupId(backupId);
  const manifestPath = path.join(backupRoot(userDataPath), safeId, 'manifest.json');
  const manifest = JSON.parse(readConfigFile(manifestPath, fileSystem).toString('utf8'));
  if (manifest?.schemaVersion !== MANIFEST_SCHEMA_VERSION || manifest.backupId !== safeId || !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > MAX_FILES_PER_BACKUP) throw new Error('Game-config backup manifest is not valid.');
  assertGuideId(manifest.gameId);
  const paths = new Set();
  let total = 0;
  for (const file of manifest.files) {
    if (typeof file.sourcePath !== 'string' || !path.isAbsolute(file.sourcePath) || path.resolve(file.sourcePath) !== file.sourcePath || !ALLOWED_EXTENSIONS.has(path.extname(file.sourcePath).toLowerCase()) || file.name !== path.basename(file.sourcePath) || typeof file.storedName !== 'string' || file.storedName !== path.basename(file.storedName) || !/^\d{2}-[^/\\:]+$/.test(file.storedName) || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isInteger(file.bytes) || file.bytes < 0 || file.bytes > MAX_FILE_BYTES || paths.has(file.sourcePath.toLowerCase())) throw new Error('Game-config backup manifest contains an invalid file.');
    assertRestorableConfigPath(file.sourcePath);
    paths.add(file.sourcePath.toLowerCase());
    total += file.bytes;
  }
  if (total > MAX_TOTAL_BYTES || total !== manifest.totalBytes || !Number.isFinite(Date.parse(manifest.createdAt))) throw new Error('Game-config backup manifest totals or date are invalid.');
  return manifest;
}

// Reject links/junctions in every existing path component, not just the leaf.
function assertSafePath(filePath, fileSystem = fs, allowMissingLeaf = false) {
  let current = path.resolve(filePath);
  let leaf = true;
  while (true) {
    try {
      const stat = fileSystem.lstatSync(current);
      if (stat.isSymbolicLink() || (!leaf && !stat.isDirectory())) throw new Error('Configuration path contains an unsafe link or non-directory.');
    } catch (error) {
      if (!(leaf && allowMissingLeaf && error.code === 'ENOENT')) throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
    leaf = false;
  }
}

function readConfigFile(filePath, fileSystem = fs) {
  assertSafePath(filePath, fileSystem);
  const stat = fileSystem.lstatSync(filePath);
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error('Configuration must be a bounded regular file.');
  const bytes = fileSystem.readFileSync(filePath);
  if (bytes.length > MAX_FILE_BYTES) throw new Error('Configuration exceeds the byte limit.');
  return bytes;
}

function atomicReplace(filePath, bytes, fileSystem = fs, expectedHash) {
  assertSafePath(filePath, fileSystem, true);
  const temp = `${filePath}.dialed-${crypto.randomUUID()}.tmp`;
  try {
    fileSystem.writeFileSync(temp, bytes, { flag: 'wx' });
    if (sha256(readConfigFile(temp, fileSystem)) !== sha256(bytes)) throw new Error('Staged configuration verification failed.');
    if (expectedHash !== undefined) {
      const current = currentFileState(filePath, fileSystem);
      if (current.sha256 !== expectedHash || current.state !== (expectedHash === null ? 'MISSING' : 'FILE')) throw new Error('Configuration changed during staging.');
    }
    fileSystem.renameSync(temp, filePath);
  } finally {
    // This exact temporary path belongs to this attempt, never to a game.
    try { fileSystem.unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

// Durable recovery metadata is written BEFORE any target changes. A failed
// result write is part of the transaction, and also rolls the targets back.
function replaceConfigFiles(userDataPath, backupId, files, kind, dependencies = {}) {
  const fileSystem = dependencies.fileSystem || fs;
  const recoveryPath = path.join(backupRoot(userDataPath), assertBackupId(backupId), 'restore-recovery', crypto.randomUUID());
  fileSystem.mkdirSync(recoveryPath, { recursive: true });
  assertSafePath(recoveryPath, fileSystem);
  const record = { status: 'PENDING', kind, backupId, createdAt: new Date().toISOString(), files: [] };
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    assertSafePath(file.sourcePath, fileSystem, true);
    if (file.before !== null) {
      const stat = fileSystem.statSync(file.sourcePath);
      if (!(stat.mode & 0o200)) throw new Error('Configuration is read-only. Change it manually before retrying.');
      fileSystem.accessSync(file.sourcePath, fs.constants.W_OK);
      fileSystem.writeFileSync(path.join(recoveryPath, `${index + 1}.current`), file.before, { flag: 'wx' });
      if (sha256(readConfigFile(path.join(recoveryPath, `${index + 1}.current`), fileSystem)) !== sha256(file.before)) throw new Error('Recovery copy verification failed. No file was changed.');
    }
    record.files.push({ sourcePath: file.sourcePath, recoveryFile: file.before === null ? null : `${index + 1}.current`, beforeSha256: file.before === null ? null : sha256(file.before), afterSha256: sha256(file.after) });
  }
  const recordPath = path.join(recoveryPath, 'transaction.json');
  atomicWriteJson(recordPath, record, fileSystem);
  const attempted = [];
  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const current = currentFileState(file.sourcePath, fileSystem);
      if (current.state !== (file.before === null ? 'MISSING' : 'FILE') || current.sha256 !== record.files[index].beforeSha256) throw new Error('Configuration changed after preview; request a fresh preview.');
      // Include the current target before replacement/verification can fail.
      attempted.push(index);
      atomicReplace(file.sourcePath, file.after, fileSystem, record.files[index].beforeSha256);
      if (sha256(readConfigFile(file.sourcePath, fileSystem)) !== record.files[index].afterSha256) throw new Error('Configuration output verification failed.');
    }
    const result = { restoredAt: new Date().toISOString(), backupId, restoredCount: files.length, recoveryPath };
    atomicWriteJson(path.join(recoveryPath, 'restore-result.json'), result, fileSystem);
    atomicWriteJson(recordPath, { ...record, status: 'VERIFIED' }, fileSystem);
    return result;
  } catch (error) {
    const failures = [];
    for (const index of attempted.reverse()) {
      const file = files[index];
      try {
        const current = currentFileState(file.sourcePath, fileSystem);
        if (current.sha256 === record.files[index].beforeSha256 && current.state === (file.before === null ? 'MISSING' : 'FILE')) continue;
        // Never overwrite unrelated content introduced by another writer.
        if (current.state !== 'FILE' || current.sha256 !== record.files[index].afterSha256) throw new Error('Unexpected concurrent content; manual recovery required.');
        assertSafePath(file.sourcePath, fileSystem);
        if (file.before === null) fileSystem.unlinkSync(file.sourcePath);
        else atomicReplace(file.sourcePath, file.before, fileSystem, record.files[index].afterSha256);
        const restored = currentFileState(file.sourcePath, fileSystem);
        if (restored.sha256 !== record.files[index].beforeSha256) throw new Error('Recovery verification failed.');
      } catch { failures.push(file.sourcePath); }
    }
    try { atomicWriteJson(recordPath, { ...record, status: failures.length ? 'NEEDS_REVIEW' : 'ROLLED_BACK', failures }, fileSystem); } catch { /* PENDING remains durable evidence. */ }
    throw new Error(`${error.message} ${failures.length ? 'Recovery needs manual review.' : 'No changes retained by this transaction.'} Recovery evidence: ${recoveryPath}`);
  }
}

function publicBackup(manifest) {
  return {
    schemaVersion: manifest.schemaVersion,
    backupId: manifest.backupId,
    gameId: manifest.gameId,
    createdAt: manifest.createdAt,
    totalBytes: manifest.totalBytes,
    files: manifest.files.map((file) => ({
      name: file.name,
      sourcePath: file.sourcePath,
      bytes: file.bytes,
      sha256: file.sha256,
    })),
  };
}

function createGameConfigBackup(userDataPath, gameId, filePaths, dependencies = {}) {
  const fileSystem = dependencies.fileSystem || fs;
  const now = dependencies.now || (() => new Date().toISOString());
  const randomUuid = dependencies.randomUuid || crypto.randomUUID;
  assertGuideId(gameId);
  if (!Array.isArray(filePaths) || filePaths.length === 0 || filePaths.length > MAX_FILES_PER_BACKUP) throw new Error(`Select between 1 and ${MAX_FILES_PER_BACKUP} game configuration files.`);

  const uniquePaths = [...new Set(filePaths.map((filePath) => path.resolve(String(filePath))))];
  if (uniquePaths.length !== filePaths.length) throw new Error('Duplicate game configuration files are not allowed.');

  const prepared = [];
  let totalBytes = 0;
  for (const sourcePath of uniquePaths) {
    const extension = path.extname(sourcePath).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension)) throw new Error(`Unsupported game configuration extension: ${extension || '(none)'}.`);
    // Restores are limited to your own profile folders, so a backup of a file elsewhere
    // could never be restored. Refuse it now rather than create one that stays hidden.
    try {
      assertRestorableConfigPath(sourcePath, dependencies.environment || process.env);
    } catch {
      throw new Error(`Dialed can only back up game settings files inside your own user folder (for example Documents or AppData), because those are the only places it will restore to. ${path.basename(sourcePath)} is outside it, so no backup was made.`);
    }
    const stat = fileSystem.lstatSync(sourcePath);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Game configuration backups accept regular files only; links and directories are refused.');
    if (stat.size > MAX_FILE_BYTES) throw new Error(`Game configuration file exceeds the ${MAX_FILE_BYTES} byte limit.`);
    const contents = readConfigFile(sourcePath, fileSystem);
    totalBytes += contents.length;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error(`Selected game configuration files exceed the ${MAX_TOTAL_BYTES} byte total limit.`);
    prepared.push({ sourcePath, contents, bytes: contents.length, sha256: sha256(contents) });
  }

  const backupId = randomUuid();
  assertBackupId(backupId);
  const directory = path.join(backupRoot(userDataPath), backupId);
  const root = backupRoot(userDataPath);
  fileSystem.mkdirSync(root, { recursive: true });
  assertSafePath(root, fileSystem);
  // Publish only a complete backup. A process crash leaves a visibly separate
  // staging directory, never a valid-looking restore candidate. Preserve such
  // evidence rather than deleting directories from a different invocation.
  const staging = path.join(root, `.pending-${backupId}-${crypto.randomUUID()}`);
  fileSystem.mkdirSync(staging);
  assertSafePath(staging, fileSystem);
  try {
    const files = prepared.map((file, index) => {
      const storedName = `${String(index + 1).padStart(2, '0')}-${path.basename(file.sourcePath)}`;
      fileSystem.writeFileSync(path.join(staging, storedName), file.contents, { flag: 'wx' });
      if (sha256(readConfigFile(path.join(staging, storedName), fileSystem)) !== file.sha256) throw new Error('Backup verification failed. No game file was changed.');
      return { name: path.basename(file.sourcePath), sourcePath: file.sourcePath, storedName, bytes: file.bytes, sha256: file.sha256 };
    });
    const manifest = { schemaVersion: MANIFEST_SCHEMA_VERSION, backupId, gameId, createdAt: now(), totalBytes, files };
    atomicWriteJson(path.join(staging, 'manifest.json'), manifest, fileSystem);
    if (fileSystem.existsSync(directory)) throw new Error('Backup id already exists. Existing backup was preserved.');
    fileSystem.renameSync(staging, directory);
    return publicBackup(manifest);
  } catch (error) {
    // Nonrecursive cleanup is restricted to this invocation's regular staging
    // files. If cleanup fails, leave the evidence and report its exact location.
    try {
      assertSafePath(staging, fileSystem);
      for (const entry of fileSystem.readdirSync(staging, { withFileTypes: true })) {
        if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('Unexpected staging entry.');
        fileSystem.unlinkSync(path.join(staging, entry.name));
      }
      fileSystem.rmdirSync(staging);
    } catch { error.message += ` Incomplete backup evidence remains at ${staging}.`; }
    throw error;
  }
}

function listGameConfigBackups(userDataPath, dependencies = {}) {
  const fileSystem = dependencies.fileSystem || fs;
  const root = backupRoot(userDataPath);
  try {
    const entries = fileSystem.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^[0-9a-f-]{36}$/i.test(entry.name));
    // Refuse an oversized inventory instead of silently calling an arbitrary
    // directory-order subset the newest history. Each manifest is size-bounded.
    if (entries.length > 10000) throw new Error('Backup history exceeds the 10,000-directory scan limit. Review local backup storage.');
    return entries
      .map((entry) => {
        try {
          const backup = publicBackup(readManifest(userDataPath, entry.name, fileSystem));
          const recoveryWarnings = readRecoveryWarnings(userDataPath, entry.name, fileSystem);
          return recoveryWarnings.length ? { ...backup, recoveryWarnings } : backup;
        } catch { return null; }
      })
      .filter(Boolean)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt) || left.backupId.localeCompare(right.backupId))
      .slice(0, 100);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

function readRecoveryWarnings(userDataPath, backupId, fileSystem = fs) {
  const root = path.join(backupRoot(userDataPath), backupId, 'restore-recovery');
  try {
    assertSafePath(root, fileSystem);
    return fileSystem.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).slice(0, 100).flatMap((entry) => {
      const directory = path.join(root, entry.name);
      try {
        const record = JSON.parse(readConfigFile(path.join(directory, 'transaction.json'), fileSystem));
        return ['VERIFIED', 'ROLLED_BACK'].includes(record.status) ? [] : [`Unresolved configuration operation; inspect recovery evidence: ${directory}`];
      } catch (error) {
        // Older completed restores had only restore-result.json.
        if (error.code === 'ENOENT') {
          try { JSON.parse(readConfigFile(path.join(directory, 'restore-result.json'), fileSystem)); return []; } catch { /* Missing legacy result remains explicit. */ }
        }
        return [`Incomplete recovery evidence; inspect before further changes: ${directory}`];
      }
    });
  } catch (error) {
    return error.code === 'ENOENT' ? [] : ['Recovery evidence could not be read. Inspect local backups before further changes.'];
  }
}

function currentFileState(sourcePath, fileSystem = fs) {
  try {
    const stat = fileSystem.lstatSync(sourcePath);
    if (stat.isSymbolicLink()) return { state: 'UNSUPPORTED_LINK', sha256: null };
    if (!stat.isFile()) return { state: 'UNSUPPORTED_TYPE', sha256: null };
    const contents = readConfigFile(sourcePath, fileSystem);
    return { state: 'FILE', sha256: sha256(contents), bytes: contents.length };
  } catch (error) {
    if (error?.code === 'ENOENT') return { state: 'MISSING', sha256: null, bytes: 0 };
    return { state: 'UNAVAILABLE', sha256: null, bytes: 0 };
  }
}

function createGameConfigRestorePreview(userDataPath, backupId, dependencies = {}) {
  const fileSystem = dependencies.fileSystem || fs;
  const manifest = readManifest(userDataPath, backupId, fileSystem);
  const files = manifest.files.map((file) => ({ ...file, current: currentFileState(file.sourcePath, fileSystem) }));
  if (files.some((file) => ['UNSUPPORTED_LINK', 'UNSUPPORTED_TYPE', 'UNAVAILABLE'].includes(file.current.state))) throw new Error('One or more restore targets are links, unsupported, or unavailable. No file was changed.');
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    backupId: manifest.backupId,
    gameId: manifest.gameId,
    createdAt: manifest.createdAt,
    previewedAt: new Date().toISOString(),
    files,
  };
}

function publicRestorePreview(preview, token) {
  return {
    token,
    backupId: preview.backupId,
    gameId: preview.gameId,
    createdAt: preview.createdAt,
    files: preview.files.map((file) => ({
      name: file.name,
      sourcePath: file.sourcePath,
      backupSha256: file.sha256,
      currentState: file.current.state,
      currentSha256: file.current.sha256,
      willOverwriteChangedFile: file.current.state === 'FILE' && file.current.sha256 !== file.sha256,
    })),
  };
}

function applyGameConfigRestore(userDataPath, preview, dependencies = {}) {
  const fileSystem = dependencies.fileSystem || fs;
  const manifest = readManifest(userDataPath, preview.backupId, fileSystem);
  if (manifest.gameId !== preview.gameId || JSON.stringify(manifest.files) !== JSON.stringify(preview.files.map(({ current, ...file }) => file))) throw new Error('The backup changed after preview. No file was changed.');

  const replacements = [];
  for (const file of preview.files) {
    const current = currentFileState(file.sourcePath, fileSystem);
    if (current.state !== file.current.state || current.sha256 !== file.current.sha256) throw new Error(`Restore target changed after preview: ${file.name}. No file was changed.`);
    const backupContents = readConfigFile(path.join(backupRoot(userDataPath), manifest.backupId, file.storedName), fileSystem);
    if (sha256(backupContents) !== file.sha256) throw new Error(`Backup integrity verification failed for ${file.name}. No file was changed.`);
    const parent = path.dirname(file.sourcePath);
    const parentStat = fileSystem.lstatSync(parent);
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) throw new Error(`Restore parent is unavailable or unsafe for ${file.name}. No file was changed.`);
    assertSafePath(file.sourcePath, fileSystem, true);
    const before = current.state === 'FILE' ? readConfigFile(file.sourcePath, fileSystem) : null;
    if (before !== null && sha256(before) !== file.current.sha256) throw new Error('Restore target changed after preview. No file was changed.');
    replacements.push({ sourcePath: file.sourcePath, before, after: backupContents });
  }
  return { ...replaceConfigFiles(userDataPath, manifest.backupId, replacements, 'RESTORE', dependencies), gameId: manifest.gameId };
}

module.exports = {
  ALLOWED_EXTENSIONS,
  GAME_DISCOVERY_DEFINITIONS,
  MANIFEST_SCHEMA_VERSION,
  MAX_FILE_BYTES,
  MAX_FILES_PER_BACKUP,
  MAX_TOTAL_BYTES,
  applyGameConfigRestore,
  createGameConfigBackup,
  createGameConfigRestorePreview,
  discoverInstalledGames,
  listGameConfigBackups,
  listWindowsInstalledApplications,
  normalizeInstalledApplications,
  publicRestorePreview,
  readConfigFile,
  assertSafePath,
  assertRestorableConfigPath,
  replaceConfigFiles,
  sha256,
};
