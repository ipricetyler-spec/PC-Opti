const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { assertCurrentProcessAdministrator, capabilityForAction, listCapabilities } = require('../capabilities/index.cjs');
const { CACHE_CLEANUP_KINDS, createCacheCleanupPowerShellScript, createTempMaintenancePowerShellScript } = require('../maintenance/index.cjs');
const { listPowerPlans, setActivePowerPlan, assertPowerPlanGuid } = require('../power-plans/index.cjs');
const {
  assertExecutablePath,
  formatGpuPreference,
  gpuPreferenceTargetId,
  readGpuPreference,
  removeGpuPreferenceValue,
  writeGpuPreferenceData,
} = require('../gpu-preference/index.cjs');
const {
  applyUserSettingValue,
  intendedValueFor,
  readUserSetting,
  stateHasValue,
  userSetting,
  userSettingActionId,
  userSettingStateMatches,
} = require('../user-settings/index.cjs');
const mouse = require('../mouse-acceleration/index.cjs');
const powerTweaks = require('../power-tweaks/index.cjs');
const protectedStore = require('../protected-store/index.cjs');
const { queryCurrentProcessElevation } = require('../shared/windows-elevation.cjs');
const {
  listCurrentUserPackages,
  listOptionalAppCandidates,
  previewMatchesCandidate,
  removeOptionalAppPackage,
} = require('../optional-apps/index.cjs');
const {
  TIMING_ACTIONS,
  applyBootTimingAction,
  assertTimingActionApplicable,
  createBcdBackup,
  readBootTimingState,
  restoreBootTimingAction,
  timingActionReachedIntendedState,
  timingTargetStateEquals,
} = require('../timing/index.cjs');
const {
  ANTI_CHEAT_PROCESS_NAMES_BY_PRODUCT,
  MANAGEABLE_STARTUP_REGISTRY_PATHS,
  STARTUP_REGISTRY_VIEWS,
  createEcoQosPowerShellScript,
  detectInstalledAntiCheats,
  isManageableProcess,
  listStorageVolumes,
  runPowerShell,
} = require('../scanner/index.cjs');

const CONSUMER_FEATURES_POLICY = {
  registryPath: 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\CloudContent',
  valueName: 'DisableWindowsConsumerFeatures',
};
const MAX_JOURNAL_BYTES = 5 * 1024 * 1024;
const MAX_RECOVERABLE_JOURNAL_BYTES = 64 * 1024 * 1024;
const MAX_JOURNAL_ENTRIES = 1_000;
const MAX_AUDIT_EXPORT_BYTES = 2 * 1024 * 1024;
const MAX_STARTUP_VALUE_NAME_LENGTH = 255;
const MAX_STARTUP_VALUE_LENGTH = 8 * 1024;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const JOURNAL_RECOVERY_PENDING_PATTERN = /^\.journal-recovery\.([0-9TZ-]{20,40})\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.pending$/i;
const JOURNAL_DELETION_MODES = Object.freeze({
  COMPLETED_30_DAYS: 30,
  COMPLETED_90_DAYS: 90,
  ALL_DELETABLE: null,
});
const KNOWN_CAPABILITY_IDS = new Set(listCapabilities().map((capability) => capability.id));
const SAFE_JOURNAL_CATEGORIES = new Set(['Targeted maintenance', 'Startup management', 'Dynamic process balancing', 'Safe OS policy', 'Timing experiment', 'Power plan', 'Graphics preference', 'Windows gaming setting']);
const SAFE_JOURNAL_STATUSES = new Set(['PENDING', 'SUCCESS', 'FAILED', 'NEEDS_REVIEW']);
const SAFE_ROLLBACK_KINDS = new Set(['restore-registry-run-value', 'disable-process-ecoqos', 'restore-consumer-features-policy', 'restore-boot-timing-setting', 'restore-power-plan', 'restore-gpu-preference', 'restore-user-setting', 'restore-mouse-acceleration', 'remove-power-plan', 'restore-cpu-minimum-state']);
const SAFE_RECONCILIATION_CLASSES = new Set(['INTENDED_STATE', 'PRE_ACTION_STATE', 'DIVERGED', 'TARGET_CHANGED', 'UNKNOWN', 'UNAVAILABLE']);

function journalPath(userDataPath) {
  return path.join(userDataPath, 'journal.json');
}

function recoveryFileNames(timestamp, nonce) {
  return {
    pendingFileName: `.journal-recovery.${timestamp}.${nonce}.pending`,
    preservedFileName: `journal.corrupt.${timestamp}.${nonce}.json`,
  };
}

function listPendingRecoveryFiles(userDataPath) {
  let entries;
  try {
    entries = fs.readdirSync(userDataPath, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw new Error(`Windows could not inspect pending audit recovery state: ${error.message}`);
  }
  return entries
    .filter((entry) => JOURNAL_RECOVERY_PENDING_PATTERN.test(entry.name))
    .map((entry) => ({ fileName: entry.name, filePath: path.join(userDataPath, entry.name), match: entry.name.match(JOURNAL_RECOVERY_PENDING_PATTERN) }));
}

function inspectJournalFile(filePath) {
  let stats;
  try {
    stats = fs.lstatSync(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return { state: 'MISSING', code: 'MISSING', reason: 'The local audit journal does not exist.' };
    return { state: 'INACCESSIBLE', code: 'STAT_FAILED', reason: `Windows could not inspect the local audit journal: ${error.message}` };
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    return { state: 'INACCESSIBLE', code: 'UNSAFE_PATH', reason: 'The local audit journal is not a regular app-owned file.' };
  }
  if (stats.size > MAX_RECOVERABLE_JOURNAL_BYTES) {
    return { state: 'INACCESSIBLE', code: 'RECOVERY_LIMIT', reason: 'The local audit journal exceeds the 64 MB preservation safety limit.' };
  }
  if (stats.size > MAX_JOURNAL_BYTES) {
    return { state: 'RECOVERABLE', code: 'OVERSIZED', reason: 'The journal exceeds the supported 5 MB reading limit.', bytes: stats.size };
  }
  let bytes;
  try {
    bytes = fs.readFileSync(filePath);
  } catch (error) {
    return { state: 'INACCESSIBLE', code: 'READ_FAILED', reason: `Windows could not read the local audit journal: ${error.message}` };
  }
  if (bytes.length !== stats.size) {
    return { state: 'INACCESSIBLE', code: 'CHANGED_DURING_READ', reason: 'The local audit journal changed while it was being read.' };
  }
  const source = bytes.toString('utf8');
  if (!Buffer.from(source, 'utf8').equals(bytes)) {
    return { state: 'RECOVERABLE', code: 'INVALID_UTF8', reason: 'The journal is not valid UTF-8.', bytes: bytes.length };
  }
  let content;
  try {
    content = JSON.parse(source);
  } catch (error) {
    return { state: 'RECOVERABLE', code: 'INVALID_JSON', reason: `The journal is not valid JSON: ${error.message}`, bytes: bytes.length };
  }
  if (!Array.isArray(content)) {
    return { state: 'RECOVERABLE', code: 'INVALID_ROOT', reason: 'The journal root is not an array.', bytes: bytes.length };
  }
  if (content.length > MAX_JOURNAL_ENTRIES) {
    return { state: 'RECOVERABLE', code: 'TOO_MANY_ENTRIES', reason: `The journal exceeds the supported ${MAX_JOURNAL_ENTRIES.toLocaleString('en-US')} entry limit.`, bytes: bytes.length };
  }
  return { state: 'VALID', code: 'VALID', reason: '', bytes: bytes.length, entries: content };
}

function readJournal(userDataPath) {
  const pending = inspectPendingRecovery(userDataPath);
  if (pending) throw new Error(`Could not read the local audit journal: ${pending.reason}`);
  const inspection = inspectJournalFile(journalPath(userDataPath));
  if (inspection.state === 'MISSING') return [];
  if (inspection.state === 'VALID') return inspection.entries;
  throw new Error(`Could not read the local audit journal: ${inspection.reason}`);
}

function inspectJournalRecovery(userDataPath) {
  const pending = inspectPendingRecovery(userDataPath);
  if (pending) {
    return {
      entries: pending.activeInspection?.state === 'VALID' ? pending.activeInspection.entries : [],
      recovery: {
        kind: pending.recoverable ? 'CORRUPT' : 'INACCESSIBLE',
        pendingCount: null,
        reason: pending.reason,
        recoverable: pending.recoverable,
        issueCode: pending.code,
      },
    };
  }
  const inspection = inspectJournalFile(journalPath(userDataPath));
  if (inspection.state === 'MISSING') return { entries: [], recovery: null };
  if (inspection.state === 'VALID') {
    const entries = inspection.entries;
    const pendingCount = entries.filter((entry) => entry?.status === 'PENDING').length;
    return {
      entries,
      recovery: pendingCount > 0
        ? { kind: 'INTERRUPTED', pendingCount, reason: '', recoverable: false, issueCode: 'INTERRUPTED' }
        : null,
    };
  }
  return {
    entries: [],
    recovery: {
      kind: inspection.state === 'RECOVERABLE' ? 'CORRUPT' : 'INACCESSIBLE',
      pendingCount: null,
      reason: `Could not read the local audit journal: ${inspection.reason}`,
      recoverable: inspection.state === 'RECOVERABLE',
      issueCode: inspection.code,
    },
  };
}

function writeJournal(userDataPath, entries) {
  fs.mkdirSync(userDataPath, { recursive: true });
  const target = journalPath(userDataPath);
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(entries, null, 2), 'utf8');
  fs.renameSync(temporary, target);
}

function snapshotRegularFile(filePath) {
  const stats = fs.lstatSync(filePath);
  if (stats.isSymbolicLink() || !stats.isFile()) throw new Error('The journal recovery target is not a regular file.');
  if (stats.size > MAX_RECOVERABLE_JOURNAL_BYTES) throw new Error('The journal recovery target exceeds the preservation safety limit.');
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(filePath, 'r');
  let total = 0;
  try {
    const buffer = Buffer.allocUnsafe(64 * 1024);
    while (true) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
      total += count;
    }
    const after = fs.fstatSync(descriptor);
    if (!after.isFile() || after.size !== stats.size || total !== stats.size) throw new Error('The journal recovery target changed while it was being preserved.');
  } finally {
    fs.closeSync(descriptor);
  }
  return { bytes: total, sha256: hash.digest('hex') };
}

function fsyncDirectoryIfSupported(directoryPath) {
  let descriptor;
  try {
    descriptor = fs.openSync(directoryPath, 'r');
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (!['EINVAL', 'EPERM', 'ENOTSUP', 'EISDIR'].includes(error?.code)) throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function fsyncRegularFile(filePath) {
  // Windows FlushFileBuffers requires a write-capable handle even though no bytes change here.
  const descriptor = fs.openSync(filePath, 'r+');
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function writeExclusiveEmptyJournal(filePath) {
  let descriptor;
  let created = false;
  let complete = false;
  try {
    descriptor = fs.openSync(filePath, 'wx', 0o600);
    created = true;
    fs.writeFileSync(descriptor, '[]\n', 'utf8');
    fs.fsyncSync(descriptor);
    complete = true;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (created && !complete) {
      try { fs.unlinkSync(filePath); } catch {}
    }
  }
  fsyncDirectoryIfSupported(path.dirname(filePath));
}

function snapshotsEqual(left, right) {
  return Boolean(left && right) && left.bytes === right.bytes && left.sha256 === right.sha256;
}

function inspectPendingRecovery(userDataPath) {
  let pendingFiles;
  try {
    pendingFiles = listPendingRecoveryFiles(userDataPath);
  } catch (error) {
    return { code: 'RECOVERY_SCAN_FAILED', reason: error.message, recoverable: false, activeInspection: null };
  }
  if (pendingFiles.length === 0) return null;
  if (pendingFiles.length !== 1) {
    return {
      code: 'MULTIPLE_PENDING_RECOVERIES',
      reason: 'Multiple interrupted audit recovery records exist. Dialed will not choose between them automatically.',
      recoverable: false,
      activeInspection: inspectJournalFile(journalPath(userDataPath)),
    };
  }

  const pending = pendingFiles[0];
  const timestamp = pending.match[1];
  const nonce = pending.match[2];
  const { preservedFileName } = recoveryFileNames(timestamp, nonce);
  const preservedPath = path.join(userDataPath, preservedFileName);
  const pendingInspection = inspectJournalFile(pending.filePath);
  const activeInspection = inspectJournalFile(journalPath(userDataPath));
  if (pendingInspection.state !== 'RECOVERABLE') {
    return {
      code: 'UNSAFE_PENDING_RECOVERY',
      reason: 'The interrupted audit recovery record is not a bounded structurally corrupt app-owned file. Dialed will not change it.',
      recoverable: false,
      activeInspection,
    };
  }

  let preservedSnapshot = null;
  if (fs.existsSync(preservedPath)) {
    const preservedInspection = inspectJournalFile(preservedPath);
    if (preservedInspection.state !== 'RECOVERABLE' || preservedInspection.code !== pendingInspection.code) {
      return {
        code: 'PRESERVED_COPY_CONFLICT',
        reason: 'The preserved audit recovery file conflicts with the pending original. Dialed will not overwrite either file.',
        recoverable: false,
        activeInspection,
      };
    }
    try {
      const pendingSnapshot = snapshotRegularFile(pending.filePath);
      preservedSnapshot = snapshotRegularFile(preservedPath);
      if (!snapshotsEqual(pendingSnapshot, preservedSnapshot)) {
        return {
          code: 'PRESERVED_COPY_CONFLICT',
          reason: 'The preserved audit recovery file does not exactly match the pending original. Dialed will not overwrite either file.',
          recoverable: false,
          activeInspection,
        };
      }
    } catch (error) {
      return { code: 'RECOVERY_READ_FAILED', reason: error.message, recoverable: false, activeInspection };
    }
  }

  const activeIsSafe = activeInspection.state === 'MISSING'
    || (activeInspection.state === 'VALID' && activeInspection.entries.length === 0);
  return {
    code: activeIsSafe ? 'RECOVERY_INCOMPLETE' : 'RECOVERY_TARGET_CONFLICT',
    reason: activeIsSafe
      ? 'A preserve-and-start-fresh operation was interrupted. The original remains in an app-owned pending record and can be completed safely.'
      : 'New or inaccessible audit history appeared while a recovery was pending. Dialed will not replace it; the original remains preserved.',
    recoverable: activeIsSafe,
    activeInspection,
    pendingPath: pending.filePath,
    pendingInspection,
    preservedFileName,
    preservedPath,
    preservedSnapshot,
  };
}

function ensureDurablePreservedCopy(pendingState, expectedSnapshot) {
  if (!fs.existsSync(pendingState.preservedPath)) {
    fs.copyFileSync(pendingState.pendingPath, pendingState.preservedPath, fs.constants.COPYFILE_EXCL);
  }
  const inspection = inspectJournalFile(pendingState.preservedPath);
  if (inspection.state !== 'RECOVERABLE' || inspection.code !== pendingState.pendingInspection.code) {
    throw new Error('The preserved audit journal does not match the pending corrupt state. The active journal was not reset.');
  }
  const beforeFlush = snapshotRegularFile(pendingState.preservedPath);
  if (!snapshotsEqual(expectedSnapshot, beforeFlush)) {
    throw new Error('The preserved audit journal is not an exact copy of the pending original. The active journal was not reset.');
  }
  fsyncRegularFile(pendingState.preservedPath);
  fsyncDirectoryIfSupported(path.dirname(pendingState.preservedPath));
  const afterFlush = snapshotRegularFile(pendingState.preservedPath);
  if (!snapshotsEqual(expectedSnapshot, afterFlush)) {
    throw new Error('The preserved audit journal changed while it was being committed. The active journal was not reset.');
  }
  return afterFlush;
}

function completePendingRecovery(userDataPath, pendingState) {
  if (!pendingState?.recoverable || !pendingState.pendingPath) {
    throw new Error('The interrupted audit recovery cannot be completed safely. No file was changed.');
  }
  const expectedSnapshot = snapshotRegularFile(pendingState.pendingPath);
  const preservedSnapshot = ensureDurablePreservedCopy(pendingState, expectedSnapshot);
  const active = inspectJournalFile(journalPath(userDataPath));
  if (active.state === 'MISSING') writeExclusiveEmptyJournal(journalPath(userDataPath));
  else if (active.state !== 'VALID' || active.entries.length !== 0) {
    throw new Error('New or inaccessible audit history appeared during recovery. Dialed preserved both states and did not overwrite the active journal.');
  }
  const verifiedActive = inspectJournalFile(journalPath(userDataPath));
  if (verifiedActive.state !== 'VALID' || verifiedActive.entries.length !== 0) {
    throw new Error('The replacement audit journal could not be verified. The original remains preserved.');
  }
  if (!snapshotsEqual(expectedSnapshot, snapshotRegularFile(pendingState.pendingPath))) {
    throw new Error('The pending audit journal changed during recovery. Both copies remain preserved for review.');
  }
  fs.unlinkSync(pendingState.pendingPath);
  fsyncDirectoryIfSupported(userDataPath);
  const current = inspectJournalRecovery(userDataPath);
  if (current.recovery) throw new Error('Audit recovery could not be finalized. The original remains preserved.');
  return {
    ...current,
    quarantine: {
      fileName: pendingState.preservedFileName,
      bytes: preservedSnapshot.bytes,
      sha256: preservedSnapshot.sha256,
    },
  };
}

function recoverCorruptJournal(userDataPath) {
  const existingPending = inspectPendingRecovery(userDataPath);
  if (existingPending) return completePendingRecovery(userDataPath, existingPending);

  const target = journalPath(userDataPath);
  const initial = inspectJournalFile(target);
  if (initial.state !== 'RECOVERABLE') {
    throw new Error('Only a structurally corrupt or bounded-overflow journal can be preserved and reset. Valid, interrupted, missing, linked, or inaccessible history was not changed.');
  }

  fs.mkdirSync(userDataPath, { recursive: true });
  const nonce = crypto.randomUUID();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const { pendingFileName } = recoveryFileNames(timestamp, nonce);
  const pendingPath = path.join(userDataPath, pendingFileName);
  try {
    fs.renameSync(target, pendingPath);
    fsyncDirectoryIfSupported(userDataPath);
  } catch (error) {
    throw new Error(`The corrupt audit journal could not be claimed without overwriting another file: ${error.message}`);
  }

  const claimedInspection = inspectJournalFile(pendingPath);
  if (claimedInspection.state !== 'RECOVERABLE' || claimedInspection.code !== initial.code) {
    const activeAfterClaim = inspectJournalFile(target);
    if (activeAfterClaim.state === 'MISSING') {
      fs.renameSync(pendingPath, target);
      fsyncDirectoryIfSupported(userDataPath);
    }
    throw new Error('The audit journal changed before recovery could claim its exact corrupt state. No active history was overwritten.');
  }

  const pendingState = inspectPendingRecovery(userDataPath);
  return completePendingRecovery(userDataPath, pendingState);
}

function journalFingerprint(entries) {
  return crypto.createHash('sha256').update(JSON.stringify(entries), 'utf8').digest('hex');
}

function normalizedActionFamily(actionId) {
  const id = String(actionId || 'unknown');
  if (id.startsWith('startup:disable-machine:')) return 'startup:disable-machine';
  if (id.startsWith('startup:disable:')) return 'startup:disable';
  if (id.startsWith('startup:restore:')) return 'startup:restore';
  if (id.startsWith('process:enable-ecoqos:')) return 'process:enable-ecoqos';
  if (id.startsWith('process:disable-ecoqos:')) return 'process:disable-ecoqos';
  if (id.startsWith('policy:restore-consumer-features:')) return 'policy:restore-consumer-features';
  if (id.startsWith('timing:restore:')) return 'timing:restore';
  if (id === TIMING_ACTIONS.RESTORE_AUTOMATIC_CLOCK_SOURCE) return id;
  if (id === TIMING_ACTIONS.DISABLE_DYNAMIC_TICK) return id;
  if (/^retrim-drive:[A-Z]$/i.test(id)) return 'maintenance:retrim-drive';
  if (id === 'clear-temp-files') return 'maintenance:clear-temp-files';
  if (id === 'policy:disable-windows-consumer-features') return id;
  if (/^settings:(user|machine):(game-mode|background-recording|gpu-scheduling|mpo|global-timer-resolution|mouse-acceleration|block-background-apps|exclude-driver-updates|no-auto-restart)$/.test(id)) return id;
  if (id.startsWith('settings:restore-user:')) return 'settings:restore-user';
  if (id === 'power:add-ultimate-plan') return id;
  if (id.startsWith('power:cpu-minimum-state:')) return 'power:cpu-minimum-state';
  return 'unknown';
}

function safeIsoTimestamp(value) {
  if (typeof value !== 'string') return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function redactedExportEntry(entry) {
  return {
    timestamp: safeIsoTimestamp(entry?.timestamp),
    updatedAt: safeIsoTimestamp(entry?.updatedAt),
    actionFamily: normalizedActionFamily(entry?.actionId),
    capabilityId: KNOWN_CAPABILITY_IDS.has(entry?.capabilityId) ? entry.capabilityId : null,
    category: SAFE_JOURNAL_CATEGORIES.has(entry?.category) ? entry.category : 'Unclassified',
    safetyClass: /^S[0-5]$/.test(entry?.safetyClass) ? entry.safetyClass : null,
    riskLevel: ['Low', 'Medium', 'High'].includes(entry?.riskLevel) ? entry.riskLevel : null,
    status: SAFE_JOURNAL_STATUSES.has(entry?.status) ? entry.status : 'UNKNOWN',
    exitCode: Number.isInteger(entry?.exitCode) ? entry.exitCode : null,
    rollback: {
      available: Boolean(entry?.rollback?.available),
      kind: SAFE_ROLLBACK_KINDS.has(entry?.rollback?.kind) ? entry.rollback.kind : null,
      completed: Boolean(entry?.rollback?.completedAt),
    },
    reconciliationClassification: SAFE_RECONCILIATION_CLASSES.has(entry?.reconciliation?.classification)
      ? entry.reconciliation.classification
      : null,
    errorEvidencePresent: Boolean(entry?.stderr || entry?.reconciliation?.message),
  };
}

function createAuditExportPreview(entries, createdAt = new Date().toISOString()) {
  if (!Array.isArray(entries)) throw new Error('Audit export requires a journal array.');
  const payload = {
    schemaVersion: '1.0.0-redacted-audit-export',
    createdAt,
    entryCount: entries.length,
    entries: entries.map(redactedExportEntry),
  };
  return {
    sourceFingerprint: journalFingerprint(entries),
    payload,
    omittedFields: [
      'journal entry IDs and action-specific identifiers',
      'entry titles and selected startup/process names',
      'Registry paths, value names, commands, and captured pre-action state',
      'drive letters, file-system paths, and machine-specific targets',
      'raw resulting state, stdout, stderr, and reconciliation messages',
    ],
  };
}

function assertValidAuditExport(payload) {
  if (!payload || payload.schemaVersion !== '1.0.0-redacted-audit-export' || !Array.isArray(payload.entries)) {
    throw new Error('The redacted audit export schema is not valid.');
  }
  if (payload.entries.length > MAX_JOURNAL_ENTRIES || payload.entryCount !== payload.entries.length) {
    throw new Error('The redacted audit export entry count is not valid.');
  }
  const forbiddenKeys = new Set(['id', 'actionId', 'title', 'preAction', 'resultingState', 'stdout', 'stderr', 'message', 'registryPath', 'valueName', 'path', 'pid', 'name']);
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value)) {
      if (forbiddenKeys.has(key)) throw new Error(`The redacted audit export contains forbidden field '${key}'.`);
      visit(nested);
    }
  };
  visit(payload);
  const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  if (bytes > MAX_AUDIT_EXPORT_BYTES) throw new Error('The redacted audit export exceeds the 2 MB limit.');
  return true;
}

function writeAuditExport(filePath, payload) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || path.extname(filePath).toLowerCase() !== '.json') {
    throw new Error('Audit export requires an absolute .json file selected by the main process.');
  }
  if (filePath.includes('\0')) throw new Error('The audit export path is not valid.');
  if (!fs.existsSync(path.dirname(filePath))) throw new Error('The selected audit export directory does not exist.');
  if (fs.existsSync(filePath)) throw new Error('The selected audit export file already exists. Choose a new file name.');
  assertValidAuditExport(payload);
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temporary, filePath);
  } catch (error) {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
    throw error;
  }
  return { fileName: path.basename(filePath), entryCount: payload.entries.length };
}

function deletionProtectionReason(entry) {
  if (!entry || typeof entry.id !== 'string' || !entry.id) return 'INVALID_ENTRY';
  if (entry.status === 'PENDING' || entry.status === 'NEEDS_REVIEW') return 'UNRESOLVED';
  if (entry.rollback?.available) return 'ROLLBACK_AVAILABLE';
  if (!['SUCCESS', 'FAILED'].includes(entry.status)) return 'UNCLASSIFIED_STATUS';
  return null;
}

function createJournalDeletionPreview(entries, mode, now = Date.now()) {
  if (!Array.isArray(entries)) throw new Error('Journal deletion preview requires an array.');
  if (!Object.prototype.hasOwnProperty.call(JOURNAL_DELETION_MODES, mode)) throw new Error('Journal deletion mode is not supported.');
  const days = JOURNAL_DELETION_MODES[mode];
  const cutoffTimestamp = days === null ? null : new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
  const duplicateIds = new Set();
  const seenIds = new Set();
  for (const entry of entries) {
    if (seenIds.has(entry?.id)) duplicateIds.add(entry.id);
    seenIds.add(entry?.id);
  }
  const deletableEntryIds = [];
  const previewEntries = [];
  const protectedCounts = { unresolved: 0, rollbackAvailable: 0, invalidOrUnclassified: 0 };
  for (const entry of entries) {
    let protection = deletionProtectionReason(entry);
    if (duplicateIds.has(entry?.id)) protection = 'INVALID_ENTRY';
    if (protection) {
      if (protection === 'UNRESOLVED') protectedCounts.unresolved += 1;
      else if (protection === 'ROLLBACK_AVAILABLE') protectedCounts.rollbackAvailable += 1;
      else protectedCounts.invalidOrUnclassified += 1;
      continue;
    }
    const timestamp = Date.parse(entry.timestamp);
    const oldEnough = days === null || (Number.isFinite(timestamp) && timestamp <= Date.parse(cutoffTimestamp));
    if (!oldEnough) continue;
    deletableEntryIds.push(entry.id);
    previewEntries.push({
      timestamp: safeIsoTimestamp(entry.timestamp),
      actionFamily: normalizedActionFamily(entry.actionId),
      category: SAFE_JOURNAL_CATEGORIES.has(entry.category) ? entry.category : 'Unclassified',
      status: entry.status,
    });
  }
  return {
    sourceFingerprint: journalFingerprint(entries),
    mode,
    cutoffTimestamp,
    deletableEntryIds,
    previewEntries,
    deleteCount: deletableEntryIds.length,
    retainCount: entries.length - deletableEntryIds.length,
    protectedCounts,
  };
}

function applyJournalDeletion(userDataPath, preview) {
  if (!preview || !Array.isArray(preview.deletableEntryIds) || typeof preview.sourceFingerprint !== 'string') {
    throw new Error('A valid journal deletion preview is required.');
  }
  const current = readJournal(userDataPath);
  if (journalFingerprint(current) !== preview.sourceFingerprint) {
    throw new Error('Local Audit History changed after preview. Refresh and review deletion again.');
  }
  const selected = new Set(preview.deletableEntryIds);
  for (const entry of current) {
    if (selected.has(entry.id) && deletionProtectionReason(entry)) {
      throw new Error('Protected audit evidence cannot be deleted. Refresh and review the history.');
    }
  }
  const retained = current.filter((entry) => !selected.has(entry.id));
  if (retained.length + selected.size !== current.length) throw new Error('Journal deletion selection is not valid.');
  writeJournal(userDataPath, retained);
  return { deletedCount: selected.size, retainedCount: retained.length, entries: retained };
}

function appendEntry(userDataPath, entry) {
  const entries = readJournal(userDataPath);
  entries.unshift(entry);
  writeJournal(userDataPath, entries);
}

function replaceEntry(userDataPath, entry) {
  entry.updatedAt = new Date().toISOString();
  const entries = readJournal(userDataPath).map((existing) => (existing.id === entry.id ? entry : existing));
  writeJournal(userDataPath, entries);
}

function markUnverifiedMutation(entry, error) {
  entry.status = 'NEEDS_REVIEW';
  entry.exitCode = error && Number.isInteger(error.exitCode) ? error.exitCode : null;
  entry.stdout = error?.stdout || '';
  entry.stderr = error?.stderr || (error instanceof Error ? error.message : String(error));
  entry.rollback = {
    ...(entry.rollback || {}),
    available: false,
    reason: 'The action did not reach a verified final state. Refresh authoritative Windows state before taking another action.',
  };
}

function createEntry(actionId, title, preAction, options = {}) {
  const capability = capabilityForAction(actionId);
  return {
    schemaVersion: '1.1.0',
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    actionId,
    capabilityId: capability?.id || null,
    safetyClass: capability?.safetyClass || null,
    riskLevel: capability?.riskLevel || null,
    title,
    category: options.category || 'Targeted maintenance',
    preAction,
    resultingState: null,
    status: 'PENDING',
    exitCode: null,
    stdout: '',
    stderr: '',
    rollback: options.rollback || {
      available: false,
      reason: 'Nothing to undo: this task does not change any setting.',
    },
  };
}

function encodePowerShellValue(value) {
  return Buffer.from(String(value), 'utf8').toString('base64');
}

function decodeInPowerShell(base64) {
  return `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${base64}'))`;
}

function assertManageableStartupItem(item) {
  if (!item || item.source !== 'Registry' || !item.canDisable) {
    throw new Error('Only supported Registry Run entries can be changed by Dialed; scheduled tasks stay read-only.');
  }
  if (!MANAGEABLE_STARTUP_REGISTRY_PATHS.has(item.registryPath)) {
    throw new Error('This startup entry is outside Dialed’s supported Registry scope.');
  }
  if (!item.valueName || typeof item.value !== 'string') {
    throw new Error('This startup entry does not contain a restorable Registry value.');
  }
  if (!['String', 'ExpandString'].includes(item.registryValueKind)) {
    throw new Error(`Registry value type '${item.registryValueKind}' is not supported for reversible startup management.`);
  }
  startupRegistryTarget(item);
}

function isMachineWideStartupItem(item) {
  return String(item?.registryPath || '').startsWith('HKLM:\\');
}

// The journal lives in the per-user app data directory, so a process running as the
// same user without elevation can edit it. Everything that reaches a privileged write
// during rollback is therefore treated as untrusted input and re-validated here, even
// though the same shape was already validated when the entry was first written.
function assertRestorableStartupPreAction(preAction) {
  // Deliberately not assertManageableStartupItem: that helper describes a live scan
  // result and requires canDisable, which a stored preAction never carries. The same
  // scope, view and value-kind constraints are applied here against the stored shape.
  if (!preAction || preAction.source !== 'Registry') {
    throw new Error('Only supported Registry Run entries can be restored by Dialed; scheduled tasks stay read-only.');
  }
  if (!MANAGEABLE_STARTUP_REGISTRY_PATHS.has(preAction.registryPath)) {
    throw new Error('This audit entry is outside Dialed’s supported Registry scope.');
  }
  if (!['String', 'ExpandString'].includes(preAction.registryValueKind)) {
    throw new Error(`Registry value type '${preAction.registryValueKind}' is not supported for reversible startup management.`);
  }
  startupRegistryTarget(preAction);
  const valueName = preAction.valueName;
  if (typeof valueName !== 'string' || valueName.length === 0 || valueName.length > MAX_STARTUP_VALUE_NAME_LENGTH) {
    throw new Error('This audit entry does not record a restorable startup value name.');
  }
  if (CONTROL_CHARACTER_PATTERN.test(valueName)) {
    throw new Error('This audit entry records a startup value name containing control characters. Rollback was refused.');
  }
  const value = preAction.value;
  if (typeof value !== 'string' || value.length > MAX_STARTUP_VALUE_LENGTH) {
    throw new Error('This audit entry does not record a restorable startup command.');
  }
  if (CONTROL_CHARACTER_PATTERN.test(value)) {
    throw new Error('This audit entry records a startup command containing control characters. Rollback was refused.');
  }
}

// SAFE_JOURNAL_STATUSES, SAFE_ROLLBACK_KINDS and SAFE_JOURNAL_CATEGORIES describe the
// only shapes Dialed itself ever writes. They were previously applied only when
// redacting an export; applying them before a rollback means a journal entry that
// Dialed could not have produced cannot drive a privileged restore.
function assertRollbackEligible(entry) {
  if (!entry || entry.status !== 'SUCCESS' || !entry.rollback?.available) {
    throw new Error('This audit entry does not have an available deterministic rollback.');
  }
  if (!SAFE_ROLLBACK_KINDS.has(entry.rollback.kind)) {
    throw new Error('This audit entry does not have a supported deterministic rollback.');
  }
  // Deliberately not checked here: category and capabilityId. Both are attacker-supplied
  // in the threat model this guards against, so requiring them adds no protection, and
  // entries written by earlier versions do not always carry them. The capability is
  // separately checked against the active runtime profile in the IPC handler.
}

function startupRegistryTarget(item) {
  const registryPath = String(item?.registryPath || '');
  const isMachineWide = registryPath === 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
  const isCurrentUser = registryPath === 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
  if (!isMachineWide && !isCurrentUser) {
    throw new Error('This startup entry is outside Dialed’s supported Registry scope.');
  }
  const requestedView = String(item?.registryView || '');
  const registryView = requestedView || (isCurrentUser ? 'Default' : '');
  if (registryView !== 'Default' && !STARTUP_REGISTRY_VIEWS.has(registryView)) {
    throw new Error('This startup entry does not identify a supported Windows Registry view.');
  }
  if (isMachineWide && registryView === 'Default') {
    throw new Error('Machine-wide startup entries require an explicit Windows Registry view.');
  }
  return {
    registryPath,
    registryView,
    hive: isMachineWide ? 'LocalMachine' : 'CurrentUser',
    subKeyPath: 'Software\\Microsoft\\Windows\\CurrentVersion\\Run',
  };
}

function registryTargetPowerShell(item) {
  const target = startupRegistryTarget(item);
  return {
    ...target,
    setup: `$registryPath = ${decodeInPowerShell(encodePowerShellValue(target.registryPath))}
    $registryView = [Microsoft.Win32.RegistryView]::${target.registryView}
    $baseKey = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::${target.hive}, $registryView)
    $subKeyPath = ${decodeInPowerShell(encodePowerShellValue(target.subKeyPath))}`,
  };
}

async function readRegistryRunValue(item) {
  const target = registryTargetPowerShell(item);
  const name = encodePowerShellValue(item.valueName);
  const script = `& {
    ${target.setup}
    $valueName = ${decodeInPowerShell(name)}
    $exists = $false
    $value = $null
    $valueKind = $null
    $registryKey = $null
    try {
      $registryKey = $baseKey.OpenSubKey($subKeyPath, $false)
      if ($null -ne $registryKey) {
        $rawValue = $registryKey.GetValue($valueName, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        if ($registryKey.GetValueNames() -contains $valueName) {
          $exists = $true
          $value = [string]$rawValue
          $valueKind = [string]$registryKey.GetValueKind($valueName)
        }
      }
    } finally {
      if ($null -ne $registryKey) { $registryKey.Dispose() }
      $baseKey.Dispose()
    }
    [pscustomobject]@{ registryPath = $registryPath; registryView = [string]$registryView; valueName = $valueName; exists = [bool]$exists; value = $value; registryValueKind = $valueKind } | ConvertTo-Json -Compress
  }`;
  const { stdout } = await runPowerShell(script);
  return JSON.parse(stdout);
}

function registryValueMatches(state, expected) {
  let actualTarget;
  let expectedTarget;
  try {
    actualTarget = startupRegistryTarget(state);
    expectedTarget = startupRegistryTarget(expected);
  } catch {
    return false;
  }
  return Boolean(state?.exists) &&
    actualTarget.registryPath === expectedTarget.registryPath &&
    actualTarget.registryView === expectedTarget.registryView &&
    state.valueName === expected.valueName &&
    state.value === expected.value &&
    state.registryValueKind === expected.registryValueKind;
}

async function removeRegistryRunValue(item) {
  const target = registryTargetPowerShell(item);
  const name = encodePowerShellValue(item.valueName);
  const script = `& {
    ${target.setup}
    $valueName = ${decodeInPowerShell(name)}
    $registryKey = $null
    try {
      $registryKey = $baseKey.OpenSubKey($subKeyPath, $true)
      if ($null -eq $registryKey) { throw 'The Registry Run key no longer exists.' }
      $registryKey.DeleteValue($valueName, $true)
    } finally {
      if ($null -ne $registryKey) { $registryKey.Dispose() }
      $baseKey.Dispose()
    }
    [pscustomobject]@{ registryPath = $registryPath; registryView = [string]$registryView; valueName = $valueName; enabled = $false } | ConvertTo-Json -Compress
  }`;
  const { stdout, stderr, exitCode } = await runPowerShell(script);
  return { output: JSON.parse(stdout), stdout, stderr, exitCode };
}

async function restoreRegistryRunValue(preAction) {
  const current = await readRegistryRunValue(preAction);
  if (current.exists) {
    throw new Error('A Registry value now occupies the original startup name. Refresh and review it; Dialed will not overwrite it.');
  }
  const target = registryTargetPowerShell(preAction);
  const name = encodePowerShellValue(preAction.valueName);
  const value = encodePowerShellValue(preAction.value);
  const type = preAction.registryValueKind === 'ExpandString' ? 'ExpandString' : 'String';
  const script = `& {
    ${target.setup}
    $valueName = ${decodeInPowerShell(name)}
    $value = ${decodeInPowerShell(value)}
    $registryKey = $null
    try {
      $registryKey = $baseKey.OpenSubKey($subKeyPath, $true)
      if ($null -eq $registryKey) { throw 'The original Registry Run key no longer exists.' }
      $registryKey.SetValue($valueName, $value, [Microsoft.Win32.RegistryValueKind]::${type})
    } finally {
      if ($null -ne $registryKey) { $registryKey.Dispose() }
      $baseKey.Dispose()
    }
    [pscustomobject]@{ registryPath = $registryPath; registryView = [string]$registryView; valueName = $valueName; enabled = $true } | ConvertTo-Json -Compress
  }`;
  const { stdout, stderr, exitCode } = await runPowerShell(script);
  const verified = await readRegistryRunValue(preAction);
  if (!registryValueMatches(verified, preAction)) {
    throw new Error('Windows did not report the exact captured startup value after rollback.');
  }
  return { output: { ...JSON.parse(stdout), verified }, stdout, stderr, exitCode };
}

function startupPreActionFromItem(item) {
  const target = startupRegistryTarget(item);
  return {
    source: 'Registry',
    registryPath: target.registryPath,
    registryView: target.registryView,
    scope: isMachineWideStartupItem(item) ? 'machine' : 'current-user',
    requiresElevation: isMachineWideStartupItem(item),
    valueName: item.valueName,
    value: item.value,
    registryValueKind: item.registryValueKind,
    enabled: true,
  };
}

async function disableStartupItem(userDataPath, item, adapters = {}) {
  const readRegistry = adapters.readRegistryRunValue || readRegistryRunValue;
  const removeRegistry = adapters.removeRegistryRunValue || removeRegistryRunValue;
  const readElevation = adapters.isCurrentProcessElevated || isCurrentProcessElevated;
  assertManageableStartupItem(item);
  const machineWide = isMachineWideStartupItem(item);
  if (machineWide) assertCurrentProcessAdministrator(
    'startup:disable-machine-run',
    await readElevation(),
    'Machine-wide startup changes require Dialed to be running as administrator. Nothing was changed; restart Dialed and accept the administrator prompt.'
  );
  const freshState = await readRegistry(item);
  if (!registryValueMatches(freshState, item)) {
    throw new Error('The startup value changed after inventory. Refresh the startup list before trying again.');
  }
  const entry = createEntry(
    `${machineWide ? 'startup:disable-machine' : 'startup:disable'}:${item.id}`,
    `Disable startup item: ${item.name}`,
    startupPreActionFromItem(item),
    {
      category: 'Startup management',
      rollback: {
        available: true,
        kind: 'restore-registry-run-value',
        reason: 'Restores the exact Registry Run value captured before this change.',
      },
    }
  );
  if (machineWide) {
    // The undo for a machine-wide entry restores from this administrator-only copy, never
    // from the per-user journal. If the copy cannot be written, nothing is changed.
    const writeProtected = adapters.writeProtectedStartupBackup || protectedStore.writeProtectedStartupBackup;
    try {
      await writeProtected(entry.id, entry.preAction);
    } catch (error) {
      throw new Error(`Nothing was changed: Dialed could not save the protected copy it needs to undo this later (${error instanceof Error ? error.message : String(error)}).`);
    }
  }
  appendEntry(userDataPath, entry);

  try {
    const result = await removeRegistry(item);
    const verified = await readRegistry(item);
    if (verified.exists) throw new Error('Windows still reports the startup value after the removal command.');
    entry.status = 'SUCCESS';
    entry.exitCode = result.exitCode;
    entry.stdout = result.stdout;
    entry.stderr = result.stderr;
    entry.resultingState = { ...result.output, verified };
    replaceEntry(userDataPath, entry);
    return { success: true, entry, result: result.output };
  } catch (error) {
    markUnverifiedMutation(entry, error);
    replaceEntry(userDataPath, entry);
    return { success: false, entry, error: entry.stderr };
  }
}

function normalizedProcessName(value) {
  return String(value || '').trim().toLowerCase().replace(/\.exe$/i, '');
}

function knownAntiCheatProduct(processName, products = Object.keys(ANTI_CHEAT_PROCESS_NAMES_BY_PRODUCT)) {
  const normalizedName = normalizedProcessName(processName);
  for (const product of products) {
    const names = ANTI_CHEAT_PROCESS_NAMES_BY_PRODUCT[product] || [];
    if (names.some((name) => normalizedName === name || normalizedName.startsWith(`${name}_`))) {
      return product;
    }
  }
  return null;
}

function detectedAntiCheatProduct(processName, detections) {
  const normalizedName = normalizedProcessName(processName);
  for (const detection of detections) {
    const product = String(detection?.product || '');
    if (knownAntiCheatProduct(normalizedName, [product])) return product;
    const serviceName = normalizedProcessName(detection?.serviceName);
    if (serviceName && (normalizedName === serviceName || normalizedName.startsWith(`${serviceName}_`))) {
      return product || 'an installed anti-cheat';
    }
  }
  return null;
}

function assertManageableProcess(process) {
  const antiCheatProduct = knownAntiCheatProduct(process?.name);
  if (antiCheatProduct) {
    throw new Error(`Dialed refused this process action because ${String(process.name)} is part of ${antiCheatProduct} anti-cheat.`);
  }
  if (!isManageableProcess(process)) {
    throw new Error('This process is outside Dialed’s protected process-management scope.');
  }
}

async function readRunningProcess(processId) {
  const pid = Number(processId);
  if (!Number.isInteger(pid) || pid <= 4) throw new Error('The process identifier is not valid.');
  const { stdout } = await runPowerShell(
    `$process = Get-Process -Id ${pid} -ErrorAction Stop; $cimProcess = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction Stop; $parentPid = [int]$cimProcess.ParentProcessId; $parent = if ($parentPid -gt 0) { Get-Process -Id $parentPid -ErrorAction SilentlyContinue } else { $null }; [pscustomobject]@{ pid = [int]$process.Id; name = [string]$process.ProcessName; creationTime = [string]$process.StartTime.ToUniversalTime().ToFileTimeUtc(); parentPid = $parentPid; parentName = if ($parent) { [string]$parent.ProcessName } else { '' } } | ConvertTo-Json -Compress`
  );
  return JSON.parse(stdout);
}

async function assertAntiCheatSafeProcess(process, readProcess, readDetections) {
  let detections;
  try {
    detections = await readDetections();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Dialed could not complete the read-only anti-cheat safety check. EcoQoS was not changed: ${message}`);
  }
  if (!Array.isArray(detections)) {
    throw new Error('Dialed could not complete the read-only anti-cheat safety check. EcoQoS was not changed: the detector returned invalid data.');
  }

  const directProduct = detectedAntiCheatProduct(process.name, detections);
  if (directProduct) {
    throw new Error(`Dialed refused this process action because ${process.name} belongs to detected ${directProduct} anti-cheat.`);
  }

  const parentPid = Number(process.parentPid);
  let parentName = normalizedProcessName(process.parentName);
  if (!parentName && Number.isInteger(parentPid) && parentPid > 4) {
    try {
      parentName = normalizedProcessName((await readProcess(parentPid)).name);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Dialed could not verify the selected process parent while anti-cheat is installed. EcoQoS was not changed: ${message}`);
    }
  }
  const parentProduct = detectedAntiCheatProduct(parentName, detections);
  if (parentProduct) {
    throw new Error(`Dialed refused this process action because its parent process ${parentName} belongs to detected ${parentProduct} anti-cheat.`);
  }
}

function processLifetime(value) {
  if (!/^[1-9][0-9]{0,18}$/.test(String(value || ''))) throw new Error('The selected process lifetime is unavailable. Refresh the process inventory.');
  return String(value);
}

function sameProcessLifetime(current, expected) {
  return current.name.toLowerCase() === String(expected.name).toLowerCase()
    && processLifetime(current.creationTime) === processLifetime(expected.creationTime);
}

async function getProcessEcoQos(processId, creationTime) {
  const pid = Number(processId);
  const { stdout } = await runPowerShell(createEcoQosPowerShellScript(
    `[pscustomobject]@{ pid = ${pid}; efficiencyMode = [bool][PCOptiEcoQos]::IsEcoQosEnabled(${pid}, ${processLifetime(creationTime)}) } | ConvertTo-Json -Compress`
  ));
  return JSON.parse(stdout);
}

async function setProcessEcoQos(processId, enabled, creationTime) {
  const pid = Number(processId);
  const { stdout, stderr, exitCode } = await runPowerShell(createEcoQosPowerShellScript(
    `$verified = [PCOptiEcoQos]::SetEcoQos(${pid}, $${enabled ? 'true' : 'false'}, ${processLifetime(creationTime)}); [pscustomobject]@{ pid = ${pid}; efficiencyMode = [bool]$verified } | ConvertTo-Json -Compress`
  ));
  return { output: JSON.parse(stdout), stdout, stderr, exitCode };
}

async function enableProcessEcoQos(userDataPath, process, adapters = {}) {
  const readProcess = adapters.readRunningProcess || readRunningProcess;
  const readEcoQos = adapters.getProcessEcoQos || getProcessEcoQos;
  const writeEcoQos = adapters.setProcessEcoQos || setProcessEcoQos;
  const readDetections = adapters.detectInstalledAntiCheats || (() => detectInstalledAntiCheats(adapters));
  assertManageableProcess(process);
  const current = await readProcess(process.pid);
  if (!sameProcessLifetime(current, process)) {
    throw new Error('The selected process ended or its process identifier was reused. Refresh the process inventory.');
  }
  await assertAntiCheatSafeProcess(current, readProcess, readDetections);
  const initialState = await readEcoQos(process.pid, process.creationTime);
  if (initialState.efficiencyMode) {
    throw new Error('Efficiency Mode is already enabled for this process. Dialed will not overwrite an existing QoS state.');
  }

  const entry = createEntry(
    `process:enable-ecoqos:${process.pid}`,
    `Enable EcoQoS: ${current.name} (PID ${process.pid})`,
    {
      pid: process.pid,
      name: current.name,
      creationTime: processLifetime(process.creationTime),
      parentPid: Number.isInteger(Number(current.parentPid)) ? Number(current.parentPid) : 0,
      parentName: String(current.parentName || ''),
      efficiencyMode: false,
    },
    {
      category: 'Dynamic process balancing',
      rollback: {
        available: true,
        kind: 'disable-process-ecoqos',
        reason: 'Returns this still-running process to its pre-action EcoQoS state. No process is terminated.',
      },
    }
  );
  appendEntry(userDataPath, entry);

  try {
    const result = await writeEcoQos(process.pid, true, process.creationTime);
    const verified = await readEcoQos(process.pid, process.creationTime);
    if (!verified.efficiencyMode) throw new Error('Windows did not report EcoQoS enabled after the action.');
    entry.status = 'SUCCESS';
    entry.exitCode = result.exitCode;
    entry.stdout = result.stdout;
    entry.stderr = result.stderr;
    entry.resultingState = { ...result.output, verified };
    replaceEntry(userDataPath, entry);
    return { success: true, entry, result: result.output };
  } catch (error) {
    markUnverifiedMutation(entry, error);
    replaceEntry(userDataPath, entry);
    return { success: false, entry, error: entry.stderr };
  }
}

async function readConsumerFeaturesPolicy() {
  const { registryPath, valueName } = CONSUMER_FEATURES_POLICY;
  const key = encodePowerShellValue(registryPath);
  const name = encodePowerShellValue(valueName);
  const script = `& {
    $keyPath = ${decodeInPowerShell(key)}
    $valueName = ${decodeInPowerShell(name)}
    $keyExists = Test-Path -LiteralPath $keyPath
    $valueExists = $false
    $value = $null
    $valueKind = $null
    if ($keyExists) {
      $registryKey = Get-Item -LiteralPath $keyPath -ErrorAction Stop
      try {
        $rawValue = $registryKey.GetValue($valueName, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        if ($null -ne $rawValue) {
          $valueExists = $true
          $value = [int]$rawValue
          $valueKind = [string]$registryKey.GetValueKind($valueName)
        }
      } catch {}
    }
    [pscustomobject]@{ registryPath = $keyPath; valueName = $valueName; keyExists = [bool]$keyExists; valueExists = [bool]$valueExists; value = $value; valueKind = $valueKind } | ConvertTo-Json -Compress
  }`;
  const { stdout } = await runPowerShell(script);
  return JSON.parse(stdout);
}

async function isCurrentProcessElevated() {
  return queryCurrentProcessElevation(runPowerShell);
}

function policyStateMatches(state, expected) {
  if (Boolean(state?.valueExists) !== Boolean(expected?.valueExists)) return false;
  if (!expected?.valueExists) return true;
  return state.value === expected.value && state.valueKind === expected.valueKind;
}

function assertManageableConsumerFeaturesPolicy(state) {
  if (!state || state.registryPath !== CONSUMER_FEATURES_POLICY.registryPath || state.valueName !== CONSUMER_FEATURES_POLICY.valueName) {
    throw new Error('The consumer content policy state is not valid.');
  }
  if (state.valueExists && state.valueKind !== 'DWord') {
    throw new Error(`The existing ${CONSUMER_FEATURES_POLICY.valueName} value is not a DWORD. Dialed will not overwrite it.`);
  }
}

function createSafetyCheckpointPowerShellScript() {
  const description = encodePowerShellValue('Dialed pre-policy safety state');
  // Microsoft documents the one-checkpoint-per-day limit and Get-ComputerRestorePoint
  // readback. Dialed reports that limit instead of changing its Registry frequency:
  // https://learn.microsoft.com/powershell/module/microsoft.powershell.management/checkpoint-computer
  // https://learn.microsoft.com/powershell/module/microsoft.powershell.management/get-computerrestorepoint
  return `& {
    $description = ${decodeInPowerShell(description)}
    $before = @(Get-ComputerRestorePoint -ErrorAction Stop)
    $beforeSequences = @{}
    foreach ($point in $before) { $beforeSequences[[int]$point.SequenceNumber] = $true }
    $checkpointError = ''
    try {
      Checkpoint-Computer -Description $description -RestorePointType MODIFY_SETTINGS -ErrorAction Stop
    } catch {
      $checkpointError = [string]$_.Exception.Message
    }
    $after = @(Get-ComputerRestorePoint -ErrorAction Stop)
    $created = @($after | Where-Object {
      [string]$_.Description -eq $description -and -not $beforeSequences.ContainsKey([int]$_.SequenceNumber)
    } | Sort-Object -Property SequenceNumber -Descending | Select-Object -First 1)
    if ($created.Count -eq 1) {
      [pscustomobject]@{
        status = 'VERIFIED'
        description = [string]$created[0].Description
        sequenceNumber = [int]$created[0].SequenceNumber
        creationTime = [string]$created[0].CreationTime
        message = 'Windows reported the new restore point through Get-ComputerRestorePoint.'
      } | ConvertTo-Json -Compress
      return
    }
    $latest = @($after | Sort-Object -Property SequenceNumber -Descending | Select-Object -First 1)
    $latestIsRecent = $false
    if ($latest.Count -eq 1) {
      try {
        $latestTime = [Management.ManagementDateTimeConverter]::ToDateTime([string]$latest[0].CreationTime).ToUniversalTime()
        $latestIsRecent = ((Get-Date).ToUniversalTime() - $latestTime).TotalHours -lt 24
      } catch {}
    }
    if ($checkpointError -match '24 hours|1440 minutes|already been created within' -or (-not $checkpointError -and $latestIsRecent)) {
      [pscustomobject]@{
        status = 'THROTTLED'
        description = $description
        sequenceNumber = if ($latest.Count -eq 1) { [int]$latest[0].SequenceNumber } else { $null }
        creationTime = if ($latest.Count -eq 1) { [string]$latest[0].CreationTime } else { '' }
        message = 'Windows did not create a new restore point because another restore point was created within the past 24 hours.'
      } | ConvertTo-Json -Compress
      return
    }
    if ($checkpointError) { throw $checkpointError }
    throw 'Windows did not report a new restore point through Get-ComputerRestorePoint.'
  }`;
}

async function createSafetyCheckpoint() {
  const script = createSafetyCheckpointPowerShellScript();
  const { stdout, stderr, exitCode } = await runPowerShell(script, 90_000);
  const output = JSON.parse(stdout);
  if (!['VERIFIED', 'THROTTLED'].includes(output?.status)) {
    throw new Error('Windows returned an invalid System Restore checkpoint result.');
  }
  return { output, stdout, stderr, exitCode };
}

async function writeConsumerFeaturesPolicy() {
  const { registryPath, valueName } = CONSUMER_FEATURES_POLICY;
  const key = encodePowerShellValue(registryPath);
  const name = encodePowerShellValue(valueName);
  const script = `& { $keyPath = ${decodeInPowerShell(key)}; $valueName = ${decodeInPowerShell(name)}; New-Item -Path $keyPath -Force -ErrorAction Stop | Out-Null; New-ItemProperty -LiteralPath $keyPath -Name $valueName -PropertyType DWord -Value 1 -Force -ErrorAction Stop | Out-Null; [pscustomobject]@{ registryPath = $keyPath; valueName = $valueName; value = 1; enabled = $true } | ConvertTo-Json -Compress }`;
  const { stdout, stderr, exitCode } = await runPowerShell(script);
  return { output: JSON.parse(stdout), stdout, stderr, exitCode };
}

async function restoreConsumerFeaturesPolicy(preAction) {
  assertManageableConsumerFeaturesPolicy(preAction);
  const current = await readConsumerFeaturesPolicy();
  if (!current.valueExists || current.value !== 1 || current.valueKind !== 'DWord') {
    throw new Error('The policy no longer matches the state Dialed applied. Refresh and review it; rollback was not attempted.');
  }
  const key = encodePowerShellValue(preAction.registryPath);
  const name = encodePowerShellValue(preAction.valueName);
  const script = preAction.valueExists
    ? `& { $keyPath = ${decodeInPowerShell(key)}; $valueName = ${decodeInPowerShell(name)}; New-Item -Path $keyPath -Force -ErrorAction Stop | Out-Null; New-ItemProperty -LiteralPath $keyPath -Name $valueName -PropertyType DWord -Value ${Number(preAction.value)} -Force -ErrorAction Stop | Out-Null; [pscustomobject]@{ registryPath = $keyPath; valueName = $valueName; value = ${Number(preAction.value)}; restored = $true } | ConvertTo-Json -Compress }`
    : `& { $keyPath = ${decodeInPowerShell(key)}; $valueName = ${decodeInPowerShell(name)}; if (Test-Path -LiteralPath $keyPath) { Remove-ItemProperty -LiteralPath $keyPath -Name $valueName -ErrorAction SilentlyContinue }; [pscustomobject]@{ registryPath = $keyPath; valueName = $valueName; value = $null; restored = $true } | ConvertTo-Json -Compress }`;
  const { stdout, stderr, exitCode } = await runPowerShell(script);
  const verified = await readConsumerFeaturesPolicy();
  if (!policyStateMatches(verified, preAction)) {
    throw new Error('Windows did not report the exact captured policy state after rollback.');
  }
  return { output: { ...JSON.parse(stdout), verified }, stdout, stderr, exitCode };
}

async function enableConsumerFeaturesPolicy(userDataPath, adapters = {}, options = {}) {
  const readElevation = adapters.isCurrentProcessElevated || isCurrentProcessElevated;
  const readPolicy = adapters.readConsumerFeaturesPolicy || readConsumerFeaturesPolicy;
  const createCheckpoint = adapters.createSafetyCheckpoint || createSafetyCheckpoint;
  const writePolicy = adapters.writeConsumerFeaturesPolicy || writeConsumerFeaturesPolicy;
  assertCurrentProcessAdministrator(
    'policy:disable-windows-consumer-features',
    await readElevation(),
    'This machine-wide policy requires Dialed to be running as administrator. Nothing was changed; restart Dialed and accept the administrator prompt.'
  );
  const preAction = await readPolicy();
  assertManageableConsumerFeaturesPolicy(preAction);
  if (preAction.valueExists && preAction.value === 1) {
    throw new Error('Consumer content suggestions are already disabled. Dialed will not overwrite the existing policy.');
  }

  let checkpointResult;
  try {
    checkpointResult = await createCheckpoint();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `The policy was not changed because a System Restore checkpoint could not be created and verified: ${message}` };
  }
  const checkpoint = checkpointResult?.output;
  if (!checkpoint || !['VERIFIED', 'THROTTLED'].includes(checkpoint.status)) {
    return { success: false, error: 'The policy was not changed because System Restore returned an invalid checkpoint result.' };
  }
  if (checkpoint.status === 'THROTTLED' && !options.allowThrottledCheckpoint) {
    return {
      success: false,
      requiresThrottleConfirmation: true,
      checkpoint,
      error: checkpoint.message,
    };
  }

  const entry = createEntry(
    'policy:disable-windows-consumer-features',
    'Disable Windows consumer content suggestions',
    {
      ...preAction,
      safetyCheckpoint: {
        ...checkpoint,
        proceededAfterThrottle: checkpoint.status === 'THROTTLED',
      },
    },
    {
      category: 'Safe OS policy',
      rollback: {
        available: true,
        kind: 'restore-consumer-features-policy',
        reason: 'Restores the exact policy-value state captured before this change.',
      },
    }
  );
  appendEntry(userDataPath, entry);

  try {
    const result = await writePolicy();
    const verified = await readPolicy();
    if (!verified.valueExists || verified.value !== 1 || verified.valueKind !== 'DWord') {
      throw new Error('Windows did not report the intended policy value after the write.');
    }
    entry.status = 'SUCCESS';
    entry.exitCode = result.exitCode;
    entry.stdout = result.stdout;
    entry.stderr = result.stderr;
    entry.resultingState = { ...result.output, verified, safetyCheckpoint: entry.preAction.safetyCheckpoint };
    replaceEntry(userDataPath, entry);
    return { success: true, entry, result: entry.resultingState };
  } catch (error) {
    markUnverifiedMutation(entry, error);
    replaceEntry(userDataPath, entry);
    return { success: false, entry, error: entry.stderr };
  }
}

async function executeTimingAction(userDataPath, actionId, adapters = {}) {
  if (!Object.values(TIMING_ACTIONS).includes(actionId)) {
    throw new Error('This timing experiment action is not recognized.');
  }
  const readElevation = adapters.isCurrentProcessElevated || isCurrentProcessElevated;
  const readState = adapters.readBootTimingState || readBootTimingState;
  const makeBackup = adapters.createBcdBackup || (() => createBcdBackup(userDataPath, actionId));
  const applyAction = adapters.applyBootTimingAction || applyBootTimingAction;

  assertCurrentProcessAdministrator(
    actionId === TIMING_ACTIONS.RESTORE_AUTOMATIC_CLOCK_SOURCE ? 'timing:restore-automatic-clock-source' : 'timing:disable-dynamic-tick',
    await readElevation(),
    'Boot timing experiments require Dialed to be running as administrator. Nothing was changed; restart Dialed and accept the administrator prompt.'
  );
  const state = await readState();
  assertTimingActionApplicable(actionId, state);
  const backup = await makeBackup();
  if (!backup || typeof backup.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(backup.sha256) || !Number.isInteger(backup.bytes) || backup.bytes < 1) {
    throw new Error('The BCD backup evidence is not complete; the boot setting was not changed.');
  }

  const title = actionId === TIMING_ACTIONS.RESTORE_AUTOMATIC_CLOCK_SOURCE
    ? 'Restore automatic clock-source selection'
    : 'Configure consistent tick experiment';
  const entry = createEntry(
    actionId,
    title,
    { actionId, state, bcdBackup: backup },
    {
      category: 'Timing experiment',
      rollback: {
        available: true,
        kind: 'restore-boot-timing-setting',
        reason: 'Restores the exact captured current-entry value after refusing external state conflicts.',
      },
    }
  );
  appendEntry(userDataPath, entry);

  try {
    const result = await applyAction(actionId);
    const verified = await readState();
    if (!timingActionReachedIntendedState(actionId, verified)) {
      throw new Error('Windows did not report the intended boot timing value after the write.');
    }
    entry.status = 'SUCCESS';
    entry.exitCode = result.exitCode;
    entry.stdout = result.stdout;
    entry.stderr = result.stderr;
    entry.resultingState = {
      configuredState: verified,
      effectiveState: 'PENDING_REBOOT',
      performanceOutcome: 'UNVERIFIED',
      message: 'The configured BCD value was verified. Reboot and repeated workload testing are still required.',
    };
    replaceEntry(userDataPath, entry);
    return { success: true, entry, result: entry.resultingState };
  } catch (error) {
    markUnverifiedMutation(entry, error);
    replaceEntry(userDataPath, entry);
    return { success: false, entry, error: entry.stderr };
  }
}

function setReconciliation(entry, status, classification, message, actualState, rollbackAvailable) {
  entry.status = status;
  entry.resultingState = actualState || null;
  entry.reconciliation = {
    checkedAt: new Date().toISOString(),
    classification,
    message,
  };
  if (typeof rollbackAvailable === 'boolean') {
    entry.rollback = {
      ...(entry.rollback || {}),
      available: rollbackAvailable,
      reason: rollbackAvailable
        ? entry.rollback?.reason || 'The verified intended state can be rolled back.'
        : message,
    };
  }
  entry.updatedAt = new Date().toISOString();
}

async function reconcilePendingEntries(userDataPath, adapters = {}) {
  const readRegistry = adapters.readRegistryRunValue || readRegistryRunValue;
  const readProcess = adapters.readRunningProcess || readRunningProcess;
  const readEcoQos = adapters.getProcessEcoQos || getProcessEcoQos;
  const readPolicy = adapters.readConsumerFeaturesPolicy || readConsumerFeaturesPolicy;
  const readTiming = adapters.readBootTimingState || readBootTimingState;
  const readPackages = adapters.listCurrentUserPackages || listCurrentUserPackages;
  const readPlans = adapters.listPowerPlans || listPowerPlans;
  const readGpuValue = adapters.readGpuPreference || readGpuPreference;
  const readSetting = adapters.readUserSetting || readUserSetting;
  const readMouse = adapters.readMouseAcceleration || mouse.readMouseAcceleration;
  const readCpu = adapters.readCpuMinimumState || powerTweaks.readCpuMinimumState;
  const entries = readJournal(userDataPath);
  const pending = entries.filter((entry) => entry?.status === 'PENDING');
  if (!pending.length) return { reconciled: 0, entries };

  for (const entry of pending) {
    try {
      if (String(entry.actionId).startsWith('startup:disable:') || String(entry.actionId).startsWith('startup:disable-machine:')) {
        const actual = await readRegistry(entry.preAction);
        if (!actual.exists) {
          setReconciliation(entry, 'SUCCESS', 'INTENDED_STATE', 'The startup value is absent, matching the intended state.', { verified: actual, recoveredAfterInterruption: true }, true);
        } else if (registryValueMatches(actual, entry.preAction)) {
          setReconciliation(entry, 'FAILED', 'PRE_ACTION_STATE', 'The original startup value is still present; the interrupted action did not take effect.', { verified: actual }, false);
        } else {
          setReconciliation(entry, 'NEEDS_REVIEW', 'DIVERGED', 'The startup value differs from both the captured and intended states. Dialed will not overwrite it.', { verified: actual }, false);
        }
        continue;
      }

      if (String(entry.actionId).startsWith('process:enable-ecoqos:')) {
        const current = await readProcess(entry.preAction?.pid);
        if (!sameProcessLifetime(current, entry.preAction)) {
          setReconciliation(entry, 'NEEDS_REVIEW', 'TARGET_CHANGED', 'The original process identity is no longer present. No automatic recovery was attempted.', { process: current }, false);
          continue;
        }
        const actual = await readEcoQos(entry.preAction.pid, entry.preAction.creationTime);
        if (actual.efficiencyMode) {
          setReconciliation(entry, 'SUCCESS', 'INTENDED_STATE', 'Windows reports EcoQoS enabled for the same process identity.', { verified: actual, recoveredAfterInterruption: true }, true);
        } else {
          setReconciliation(entry, 'FAILED', 'PRE_ACTION_STATE', 'Windows reports the original EcoQoS state; the interrupted action did not take effect.', { verified: actual }, false);
        }
        continue;
      }

      if (entry.actionId === 'policy:disable-windows-consumer-features') {
        const actual = await readPolicy();
        if (actual.valueExists && actual.value === 1 && actual.valueKind === 'DWord') {
          setReconciliation(entry, 'SUCCESS', 'INTENDED_STATE', 'Windows reports the intended policy state after the interruption.', { verified: actual, recoveredAfterInterruption: true }, true);
        } else if (policyStateMatches(actual, entry.preAction)) {
          setReconciliation(entry, 'FAILED', 'PRE_ACTION_STATE', 'Windows reports the captured pre-action policy state; the interrupted action did not take effect.', { verified: actual }, false);
        } else {
          setReconciliation(entry, 'NEEDS_REVIEW', 'DIVERGED', 'The policy differs from both the captured and intended states. Dialed will not overwrite it.', { verified: actual }, false);
        }
        continue;
      }

      if (entry.actionId === TIMING_ACTIONS.RESTORE_AUTOMATIC_CLOCK_SOURCE || entry.actionId === TIMING_ACTIONS.DISABLE_DYNAMIC_TICK) {
        const actual = await readTiming();
        if (timingActionReachedIntendedState(entry.actionId, actual)) {
          setReconciliation(
            entry,
            'SUCCESS',
            'INTENDED_STATE',
            'Windows reports the intended configured BCD value after the interruption. Reboot and performance testing remain unverified.',
            { configuredState: actual, effectiveState: 'PENDING_REBOOT', performanceOutcome: 'UNVERIFIED', recoveredAfterInterruption: true },
            true
          );
        } else if (timingTargetStateEquals(entry.actionId, actual, entry.preAction?.state)) {
          setReconciliation(entry, 'FAILED', 'PRE_ACTION_STATE', 'Windows reports the captured boot timing state; the interrupted action did not take effect.', { configuredState: actual }, false);
        } else {
          setReconciliation(entry, 'NEEDS_REVIEW', 'DIVERGED', 'The current boot timing state differs from both the captured and intended states. Dialed will not overwrite it.', { configuredState: actual }, false);
        }
        continue;
      }

      if (String(entry.actionId).startsWith('power:activate-plan:')) {
        const { activeGuid } = await readPlans();
        if (activeGuid === entry.preAction?.targetGuid) {
          setReconciliation(entry, 'SUCCESS', 'INTENDED_STATE', 'Windows reports the requested power plan as active after the interruption.', { activeGuid, recoveredAfterInterruption: true }, true);
        } else if (activeGuid === entry.preAction?.previousGuid) {
          setReconciliation(entry, 'FAILED', 'PRE_ACTION_STATE', 'The previous power plan is still active; the interrupted switch did not take effect.', { activeGuid }, false);
        } else {
          setReconciliation(entry, 'NEEDS_REVIEW', 'DIVERGED', 'A different power plan is active. Dialed will not change it.', { activeGuid }, false);
        }
        continue;
      }

      if (String(entry.actionId).startsWith('power:cpu-minimum-state:')) {
        const actual = await readCpu(entry.preAction?.schemeGuid);
        if (actual.ac === 100) {
          setReconciliation(entry, 'SUCCESS', 'INTENDED_STATE', 'The plan reports a 100% minimum processor state after the interruption.', { verified: actual, recoveredAfterInterruption: true }, true);
        } else if (actual.ac === entry.preAction?.ac) {
          setReconciliation(entry, 'FAILED', 'PRE_ACTION_STATE', 'The plan still reports its previous minimum processor state; the interrupted change did not take effect.', { verified: actual }, false);
        } else {
          setReconciliation(entry, 'NEEDS_REVIEW', 'DIVERGED', 'The minimum processor state differs from both the captured and intended values. Dialed will not change it.', { verified: actual }, false);
        }
        continue;
      }

      if (entry.actionId === 'settings:user:mouse-acceleration') {
        const actual = await readMouse();
        const intended = mouse.targetValues(entry.preAction?.intended === 'on' ? 'on' : 'off');
        if (mouse.sameValues(actual.values, intended)) {
          setReconciliation(entry, 'SUCCESS', 'INTENDED_STATE', 'The mouse settings match the intended values after the interruption.', { verified: actual, recoveredAfterInterruption: true }, true);
        } else if (mouse.sameValues(actual.values, entry.preAction?.values)) {
          setReconciliation(entry, 'FAILED', 'PRE_ACTION_STATE', 'The previous mouse settings are still present; the interrupted change did not take effect.', { verified: actual }, false);
        } else {
          setReconciliation(entry, 'NEEDS_REVIEW', 'DIVERGED', 'The mouse settings differ from both the captured and intended values. Dialed will not overwrite them.', { verified: actual }, false);
        }
        continue;
      }

      if (/^settings:(user|machine):/.test(String(entry.actionId))) {
        const actual = await readSetting(entry.preAction?.settingId);
        if (stateHasValue(actual, entry.preAction?.intendedValue ?? null)) {
          setReconciliation(entry, 'SUCCESS', 'INTENDED_STATE', 'The Windows setting matches the intended value after the interruption.', { verified: actual, recoveredAfterInterruption: true }, true);
        } else if (userSettingStateMatches(actual, entry.preAction)) {
          setReconciliation(entry, 'FAILED', 'PRE_ACTION_STATE', 'The previous setting value is still present; the interrupted change did not take effect.', { verified: actual }, false);
        } else {
          setReconciliation(entry, 'NEEDS_REVIEW', 'DIVERGED', 'The setting differs from both the captured and intended values. Dialed will not overwrite it.', { verified: actual }, false);
        }
        continue;
      }

      if (String(entry.actionId).startsWith('graphics:gpu-preference:')) {
        const actual = await readGpuValue(entry.preAction?.exePath);
        if (actual.exists && actual.data === entry.preAction?.intendedData) {
          setReconciliation(entry, 'SUCCESS', 'INTENDED_STATE', 'The graphics preference matches the intended value after the interruption.', { verified: actual, recoveredAfterInterruption: true }, true);
        } else if (gpuStateMatches(actual, entry.preAction)) {
          setReconciliation(entry, 'FAILED', 'PRE_ACTION_STATE', 'The previous graphics preference is still present; the interrupted change did not take effect.', { verified: actual }, false);
        } else {
          setReconciliation(entry, 'NEEDS_REVIEW', 'DIVERGED', 'The graphics preference differs from both the captured and intended values. Dialed will not overwrite it.', { verified: actual }, false);
        }
        continue;
      }

      if (String(entry.actionId).startsWith('optional-app:remove:')) {
        const packages = await readPackages(adapters);
        const sameIdentity = packages.find((item) => item.packageFullName === entry.preAction?.packageFullName);
        const sameName = packages.find((item) => item.name === entry.preAction?.name);
        if (!sameName) {
          setReconciliation(entry, 'SUCCESS', 'INTENDED_STATE', 'The exact reviewed current-user package is absent after the interrupted operation.', { verifiedAbsent: true, recoveredAfterInterruption: true, performanceOutcome: 'UNVERIFIED' }, false);
        } else if (sameIdentity) {
          setReconciliation(entry, 'FAILED', 'PRE_ACTION_STATE', 'The exact reviewed package remains installed; the interrupted removal did not take effect.', { verified: sameIdentity }, false);
        } else {
          setReconciliation(entry, 'NEEDS_REVIEW', 'DIVERGED', 'A different version or identity of the reviewed package is installed. Dialed will not remove it without a fresh preview.', { verified: sameName }, false);
        }
        continue;
      }

      setReconciliation(entry, 'NEEDS_REVIEW', 'UNKNOWN', 'This interrupted operation cannot be reconstructed safely from current state. Review the retained evidence.', null, false);
    } catch (error) {
      setReconciliation(
        entry,
        'NEEDS_REVIEW',
        'UNAVAILABLE',
        `Current state could not be read safely: ${error instanceof Error ? error.message : String(error)}`,
        null,
        false
      );
    }
  }

  writeJournal(userDataPath, entries);
  return { reconciled: pending.length, entries };
}

async function rollbackAuditEntry(userDataPath, entryId, adapters = {}) {
  const readProcess = adapters.readRunningProcess || readRunningProcess;
  const readEcoQos = adapters.getProcessEcoQos || getProcessEcoQos;
  const writeEcoQos = adapters.setProcessEcoQos || setProcessEcoQos;
  const readDetections = adapters.detectInstalledAntiCheats || (() => detectInstalledAntiCheats(adapters));
  const restorePolicy = adapters.restoreConsumerFeaturesPolicy || restoreConsumerFeaturesPolicy;
  const restoreStartup = adapters.restoreRegistryRunValue || restoreRegistryRunValue;
  const readTiming = adapters.readBootTimingState || readBootTimingState;
  const restoreTiming = adapters.restoreBootTimingAction || restoreBootTimingAction;
  const readElevation = adapters.isCurrentProcessElevated || isCurrentProcessElevated;
  const original = readJournal(userDataPath).find((entry) => entry.id === entryId);
  assertRollbackEligible(original);

  if (original.rollback.kind === 'restore-boot-timing-setting') {
    if (!Object.values(TIMING_ACTIONS).includes(original.actionId)) {
      throw new Error('This audit entry does not identify a supported timing experiment.');
    }
    assertCurrentProcessAdministrator(
      original.actionId === TIMING_ACTIONS.RESTORE_AUTOMATIC_CLOCK_SOURCE ? 'timing:restore-automatic-clock-source' : 'timing:disable-dynamic-tick',
      await readElevation(),
      'Boot timing restore requires Dialed to be running as administrator. Nothing was changed; restart Dialed and accept the administrator prompt.'
    );
    const current = await readTiming();
    if (!timingActionReachedIntendedState(original.actionId, current)) {
      throw new Error('The current boot timing state no longer matches the state Dialed applied. Rollback was refused to avoid overwriting an external change.');
    }
    const entry = createEntry(
      `timing:restore:${original.id}`,
      `Restore boot timing state: ${original.title}`,
      { originalAuditEntryId: original.id, restoring: original.preAction },
      { category: 'Timing experiment' }
    );
    appendEntry(userDataPath, entry);
    try {
      const result = await restoreTiming(original.preAction);
      const verified = await readTiming();
      if (!timingTargetStateEquals(original.actionId, verified, original.preAction.state)) {
        throw new Error('Windows did not report the exact captured boot timing state after rollback.');
      }
      entry.status = 'SUCCESS';
      entry.exitCode = result.exitCode;
      entry.stdout = result.stdout;
      entry.stderr = result.stderr;
      entry.resultingState = {
        configuredState: verified,
        effectiveState: 'PENDING_REBOOT',
        performanceOutcome: 'UNVERIFIED',
        message: 'The captured BCD value was restored. Reboot is still required for the effective runtime state.',
      };
      replaceEntry(userDataPath, entry);
      original.rollback = {
        available: false,
        reason: `Restored by audit entry ${entry.id}.`,
        completedAt: new Date().toISOString(),
      };
      replaceEntry(userDataPath, original);
      return { success: true, entry, result: entry.resultingState };
    } catch (error) {
      entry.status = 'FAILED';
      entry.exitCode = error && Number.isInteger(error.exitCode) ? error.exitCode : null;
      entry.stdout = error?.stdout || '';
      entry.stderr = error?.stderr || (error instanceof Error ? error.message : String(error));
      replaceEntry(userDataPath, entry);
      return { success: false, entry, error: entry.stderr };
    }
  }

  if (original.rollback.kind === 'disable-process-ecoqos') {
    assertManageableProcess(original.preAction);
    const current = await readProcess(original.preAction.pid);
    if (!sameProcessLifetime(current, original.preAction)) {
      throw new Error('The managed process ended or its process identifier was reused. EcoQoS was not changed.');
    }
    await assertAntiCheatSafeProcess(current, readProcess, readDetections);
    if (original.resultingState?.verified?.efficiencyMode !== true) {
      throw new Error('This audit entry does not contain a verified EcoQoS applied state. Rollback was refused.');
    }
    const currentEcoQos = await readEcoQos(original.preAction.pid, original.preAction.creationTime);
    if (Number(currentEcoQos?.pid) !== Number(original.preAction.pid) || currentEcoQos?.efficiencyMode !== true) {
      throw new Error('The current EcoQoS state no longer matches the state Dialed applied. Rollback was refused to avoid overwriting an external change.');
    }
    const entry = createEntry(
      `process:disable-ecoqos:${original.id}`,
      `Restore EcoQoS state: ${current.name} (PID ${current.pid})`,
      { originalAuditEntryId: original.id, restoring: original.preAction },
      { category: 'Dynamic process balancing' }
    );
    appendEntry(userDataPath, entry);
    try {
      const result = await writeEcoQos(original.preAction.pid, false, original.preAction.creationTime);
      const verified = await readEcoQos(original.preAction.pid, original.preAction.creationTime);
      if (verified.efficiencyMode) throw new Error('Windows still reports EcoQoS enabled after rollback.');
      entry.status = 'SUCCESS';
      entry.exitCode = result.exitCode;
      entry.stdout = result.stdout;
      entry.stderr = result.stderr;
      entry.resultingState = { ...result.output, verified };
      replaceEntry(userDataPath, entry);
      original.rollback = {
        available: false,
        reason: `Restored by audit entry ${entry.id}.`,
        completedAt: new Date().toISOString(),
      };
      replaceEntry(userDataPath, original);
      return { success: true, entry, result: result.output };
    } catch (error) {
      entry.status = 'FAILED';
      entry.exitCode = error && Number.isInteger(error.exitCode) ? error.exitCode : null;
      entry.stdout = error?.stdout || '';
      entry.stderr = error?.stderr || (error instanceof Error ? error.message : String(error));
      replaceEntry(userDataPath, entry);
      return { success: false, entry, error: entry.stderr };
    }
  }

  if (original.rollback.kind === 'restore-consumer-features-policy') {
    assertCurrentProcessAdministrator(
      'policy:disable-windows-consumer-features',
      await readElevation(),
      'Consumer policy restore requires Dialed to be running as administrator. Nothing was changed; restart Dialed and accept the administrator prompt.'
    );
    const entry = createEntry(
      `policy:restore-consumer-features:${original.id}`,
      'Restore Windows consumer content policy',
      { originalAuditEntryId: original.id, restoring: original.preAction },
      { category: 'Safe OS policy' }
    );
    appendEntry(userDataPath, entry);
    try {
      const result = await restorePolicy(original.preAction);
      entry.status = 'SUCCESS';
      entry.exitCode = result.exitCode;
      entry.stdout = result.stdout;
      entry.stderr = result.stderr;
      entry.resultingState = result.output;
      replaceEntry(userDataPath, entry);
      original.rollback = {
        available: false,
        reason: `Restored by audit entry ${entry.id}.`,
        completedAt: new Date().toISOString(),
      };
      replaceEntry(userDataPath, original);
      return { success: true, entry, result: result.output };
    } catch (error) {
      entry.status = 'FAILED';
      entry.exitCode = error && Number.isInteger(error.exitCode) ? error.exitCode : null;
      entry.stdout = error?.stdout || '';
      entry.stderr = error?.stderr || (error instanceof Error ? error.message : String(error));
      replaceEntry(userDataPath, entry);
      return { success: false, entry, error: entry.stderr };
    }
  }

  if (original.rollback.kind === 'restore-power-plan') {
    const readPlans = adapters.listPowerPlans || listPowerPlans;
    const setPlan = adapters.setActivePowerPlan || setActivePowerPlan;
    const previousGuid = assertPowerPlanGuid(original.preAction?.previousGuid);
    const targetGuid = assertPowerPlanGuid(original.preAction?.targetGuid);
    const current = await readPlans();
    if (current.activeGuid !== targetGuid) {
      throw new Error('A different power plan is active now. Restore was refused to avoid overwriting that change.');
    }
    if (!current.items.some((item) => item.guid === previousGuid)) {
      throw new Error('The previous power plan no longer exists. Choose a plan in Windows Settings instead.');
    }
    return runRestore(userDataPath, original, {
      actionId: `power:restore-plan:${original.id}`,
      title: `Restore power plan: ${original.preAction.previousName || previousGuid}`,
      category: 'Power plan',
      restore: async () => {
        const result = await setPlan(previousGuid);
        const verified = await readPlans();
        if (verified.activeGuid !== previousGuid) throw new Error('Windows did not report the previous power plan as active after restore.');
        return { ...result, output: { activeGuid: verified.activeGuid } };
      },
    });
  }

  if (original.rollback.kind === 'restore-gpu-preference') {
    const readGpuValue = adapters.readGpuPreference || readGpuPreference;
    const writeGpuValue = adapters.writeGpuPreferenceData || writeGpuPreferenceData;
    const removeGpuValue = adapters.removeGpuPreferenceValue || removeGpuPreferenceValue;
    const exePath = assertExecutablePath(original.preAction?.exePath);
    const current = await readGpuValue(exePath);
    if (!current.exists || current.data !== original.preAction.intendedData) {
      throw new Error('The graphics preference changed after Dialed wrote it. Restore was refused to avoid overwriting that change.');
    }
    return runRestore(userDataPath, original, {
      actionId: `graphics:restore-gpu-preference:${original.id}`,
      title: `Restore graphics preference: ${path.win32.basename(exePath)}`,
      category: 'Graphics preference',
      restore: async () => {
        const result = original.preAction.existed ? await writeGpuValue(exePath, original.preAction.data) : await removeGpuValue(exePath);
        const verified = await readGpuValue(exePath);
        if (!gpuStateMatches(verified, original.preAction)) throw new Error('Windows did not report the exact previous graphics preference after restore.');
        return { ...result, output: { verified } };
      },
    });
  }

  if (original.rollback.kind === 'remove-power-plan') {
    const readPlans = adapters.listPowerPlans || listPowerPlans;
    const deletePlan = adapters.deletePowerPlan || powerTweaks.deletePowerPlan;
    const guid = assertPowerPlanGuid(original.resultingState?.createdGuid);
    if (guid === powerTweaks.ULTIMATE_SOURCE_GUID) throw new Error('The built-in source scheme is never deleted.');
    if (Array.isArray(original.preAction?.beforeGuids) && original.preAction.beforeGuids.includes(guid)) throw new Error('That plan existed before Dialed added one. Restore was refused.');
    const current = await readPlans();
    const plan = current.items.find((item) => item.guid === guid);
    if (!plan) throw new Error('The plan Dialed added is no longer in the list. Nothing to remove.');
    // Only a copy that still carries the Ultimate Performance name is removed; a renamed or
    // repurposed plan is left alone.
    if (!/ultimate performance/i.test(plan.name)) throw new Error('That plan has been renamed since Dialed added it. Remove it in Windows yourself if you no longer want it.');
    if (current.activeGuid === guid) throw new Error('The Ultimate Performance plan is active. Switch to another plan first, then undo.');
    return runRestore(userDataPath, original, {
      actionId: `power:remove-ultimate-plan:${original.id}`,
      title: 'Remove the Ultimate Performance plan Dialed added',
      category: 'Power plan',
      restore: async () => {
        const result = await deletePlan(guid);
        const verified = await readPlans();
        if (verified.items.some((item) => item.guid === guid)) throw new Error('Windows still lists the plan after removal.');
        return { ...result, output: { removedGuid: guid } };
      },
    });
  }

  if (original.rollback.kind === 'restore-cpu-minimum-state') {
    const readCpu = adapters.readCpuMinimumState || powerTweaks.readCpuMinimumState;
    const writeCpu = adapters.writeCpuMinimumAc || powerTweaks.writeCpuMinimumAc;
    const guid = assertPowerPlanGuid(original.preAction?.schemeGuid);
    const previous = original.preAction?.ac;
    if (!Number.isInteger(previous) || previous < 0 || previous > 100) throw new Error('The recorded previous value is not a percentage. Restore was refused.');
    const current = await readCpu(guid);
    if (current.ac !== 100) throw new Error('The minimum processor state changed after Dialed set it. Restore was refused to avoid overwriting that change.');
    return runRestore(userDataPath, original, {
      actionId: `power:restore-cpu-minimum-state:${original.id}`,
      title: `Restore minimum processor state to ${previous}%`,
      category: 'Power plan',
      restore: async () => {
        const result = await writeCpu(guid, previous);
        const verified = await readCpu(guid);
        if (verified.ac !== previous) throw new Error('Windows did not report the previous minimum processor state after restore.');
        return { ...result, output: { verified } };
      },
    });
  }

  if (original.rollback.kind === 'restore-mouse-acceleration') {
    const readMouse = adapters.readMouseAcceleration || mouse.readMouseAcceleration;
    const writeMouse = adapters.writeMouseValues || mouse.writeMouseValues;
    // Only digits-only text values can be restored; names and location are fixed.
    mouse.assertCapturedValues(original.preAction?.values);
    if (!['on', 'off'].includes(original.preAction?.intended)) throw new Error('The recorded change is not valid. Restore was refused.');
    const current = await readMouse();
    if (!mouse.sameValues(current.values, mouse.targetValues(original.preAction.intended))) {
      throw new Error('The mouse settings changed after Dialed set them. Restore was refused to avoid overwriting that change.');
    }
    return runRestore(userDataPath, original, {
      actionId: `settings:restore-mouse:${original.id}`,
      title: 'Restore mouse acceleration',
      category: 'Windows gaming setting',
      restore: async () => {
        const result = await writeMouse(original.preAction.values);
        const verified = await readMouse();
        if (!mouse.sameValues(verified.values, original.preAction.values)) throw new Error('Windows did not report the exact previous mouse settings after restore.');
        return { ...result, output: { verified, appliedToSession: result.output?.appliedToSession === true } };
      },
    });
  }

  if (original.rollback.kind === 'restore-user-setting') {
    const readSetting = adapters.readUserSetting || readUserSetting;
    // The setting id must be one Dialed manages; its registry location, scope and
    // administrator requirement come from that fixed table, never from the journal entry.
    const setting = userSetting(original.preAction?.settingId);
    const captured = original.preAction;
    if (captured.existed && (captured.kind !== 'DWord' || !Number.isInteger(captured.value) || captured.value < 0 || captured.value > 0x7fffffff)) {
      throw new Error('The recorded previous value is not a DWORD. Restore was refused.');
    }
    if (captured.intendedValue !== null && !Number.isInteger(captured.intendedValue)) throw new Error('The recorded change is not valid. Restore was refused.');
    if (setting.scope === 'machine') {
      assertCurrentProcessAdministrator(
        setting.capabilityId,
        await readElevation(),
        `Restoring ${setting.title} requires Dialed to be running as administrator. Nothing was changed; restart Dialed and accept the administrator prompt.`
      );
    }
    const current = await readSetting(captured.settingId);
    if (!stateHasValue(current, captured.intendedValue)) {
      throw new Error(`${setting.title} changed after Dialed set it. Restore was refused to avoid overwriting that change.`);
    }
    return runRestore(userDataPath, original, {
      actionId: `settings:restore-user:${original.id}`,
      title: `Restore ${setting.title}`,
      category: 'Windows gaming setting',
      restore: async () => {
        const result = await applyUserSettingValue(captured.settingId, captured.existed ? captured.value : null, adapters);
        const verified = await readSetting(captured.settingId);
        if (!userSettingStateMatches(verified, captured)) throw new Error(`Windows did not report the exact previous ${setting.title} value after restore.`);
        return { ...result, output: { verified, restartRequired: setting.restartRequired } };
      },
    });
  }

  if (original.rollback.kind !== 'restore-registry-run-value') {
    throw new Error('This audit entry does not have a supported deterministic rollback.');
  }
  assertRestorableStartupPreAction(original.preAction);
  const machineWideRestore = isMachineWideStartupItem(original.preAction);
  if (machineWideRestore) assertCurrentProcessAdministrator(
    'startup:disable-machine-run',
    await readElevation(),
    'Machine-wide startup restore requires Dialed to be running as administrator. Nothing was changed; restart Dialed and accept the administrator prompt.'
  );
  let restorePreAction = original.preAction;
  if (machineWideRestore) {
    // The journal can be edited by any program running as this user, so a machine-wide
    // restore uses only the administrator-only copy saved when the entry was removed.
    const readProtected = adapters.readProtectedStartupBackup || protectedStore.readProtectedStartupBackup;
    const copy = await readProtected(original.id);
    if (!copy.exists) {
      throw new Error('Dialed has no protected copy of this machine-wide startup entry, so it will not restore it from its history file alone. Changes recorded before this protection existed cannot be undone here; reinstall the program or re-enable it in its own settings.');
    }
    if (!protectedStore.matchesProtectedCopy(original.preAction, copy)) {
      throw new Error('The history entry does not match the protected copy Dialed saved. It may have been altered, so the restore was refused.');
    }
    restorePreAction = { ...original.preAction, ...Object.fromEntries(protectedStore.FIELDS.map((field) => [field, copy[field]])) };
    assertRestorableStartupPreAction(restorePreAction);
  }

  const entry = createEntry(
    `startup:restore:${original.id}`,
    `Restore startup item: ${original.preAction.valueName}`,
    { originalAuditEntryId: original.id, restoring: original.preAction },
    { category: 'Startup management' }
  );
  appendEntry(userDataPath, entry);

  try {
    const result = await restoreStartup(restorePreAction);
    if (machineWideRestore) {
      const removeProtected = adapters.removeProtectedStartupBackup || protectedStore.removeProtectedStartupBackup;
      try { await removeProtected(original.id); } catch { /* A leftover copy is harmless: the entry is marked restored below. */ }
    }
    entry.status = 'SUCCESS';
    entry.exitCode = result.exitCode;
    entry.stdout = result.stdout;
    entry.stderr = result.stderr;
    entry.resultingState = result.output;
    replaceEntry(userDataPath, entry);
    original.rollback = {
      available: false,
      reason: `Restored by audit entry ${entry.id}.`,
      completedAt: new Date().toISOString(),
    };
    replaceEntry(userDataPath, original);
    return { success: true, entry, result: result.output };
  } catch (error) {
    entry.status = 'FAILED';
    entry.exitCode = error && Number.isInteger(error.exitCode) ? error.exitCode : null;
    entry.stdout = error?.stdout || '';
    entry.stderr = error?.stderr || (error instanceof Error ? error.message : String(error));
    replaceEntry(userDataPath, entry);
    return { success: false, entry, error: entry.stderr };
  }
}

async function runRestore(userDataPath, original, { actionId, title, category, restore }) {
  const entry = createEntry(actionId, title, { originalAuditEntryId: original.id, restoring: original.preAction }, { category });
  appendEntry(userDataPath, entry);
  try {
    const result = await restore();
    entry.status = 'SUCCESS';
    entry.exitCode = result.exitCode ?? 0;
    entry.stdout = result.stdout || '';
    entry.stderr = result.stderr || '';
    entry.resultingState = result.output;
    replaceEntry(userDataPath, entry);
    original.rollback = { available: false, reason: `Restored by audit entry ${entry.id}.`, completedAt: new Date().toISOString() };
    replaceEntry(userDataPath, original);
    return { success: true, entry, result: result.output };
  } catch (error) {
    entry.status = 'FAILED';
    entry.exitCode = error && Number.isInteger(error.exitCode) ? error.exitCode : null;
    entry.stdout = error?.stdout || '';
    entry.stderr = error?.stderr || (error instanceof Error ? error.message : String(error));
    replaceEntry(userDataPath, entry);
    return { success: false, entry, error: entry.stderr };
  }
}

function gpuStateMatches(state, expected) {
  if (Boolean(state?.exists) !== Boolean(expected?.existed)) return false;
  return !expected?.existed || state.data === expected.data;
}

async function activatePowerPlan(userDataPath, guid, adapters = {}) {
  const readPlans = adapters.listPowerPlans || listPowerPlans;
  const setPlan = adapters.setActivePowerPlan || setActivePowerPlan;
  const targetGuid = assertPowerPlanGuid(guid);
  const before = await readPlans();
  const target = before.items.find((item) => item.guid === targetGuid);
  if (!target) throw new Error('That power plan is no longer listed by Windows. Refresh and choose again.');
  if (before.activeGuid === targetGuid) throw new Error(`${target.name} is already the active power plan.`);
  if (!before.activeGuid) throw new Error('Windows did not report the current active plan, so an exact restore could not be recorded. Nothing was changed.');
  const previous = before.items.find((item) => item.guid === before.activeGuid);
  const entry = createEntry(
    `power:activate-plan:${targetGuid}`,
    `Switch power plan: ${target.name}`,
    { previousGuid: before.activeGuid, previousName: previous?.name || '', targetGuid, targetName: target.name },
    { category: 'Power plan', rollback: { available: true, kind: 'restore-power-plan', reason: `Reactivates ${previous?.name || 'the previous plan'} if ${target.name} is still active.` } }
  );
  appendEntry(userDataPath, entry);
  try {
    const result = await setPlan(targetGuid);
    const verified = await readPlans();
    if (verified.activeGuid !== targetGuid) throw new Error('Windows did not report the requested power plan as active after the switch.');
    entry.status = 'SUCCESS';
    entry.exitCode = result.exitCode ?? 0;
    entry.stdout = result.stdout || '';
    entry.stderr = result.stderr || '';
    entry.resultingState = { activeGuid: verified.activeGuid, performanceOutcome: 'UNVERIFIED' };
    replaceEntry(userDataPath, entry);
    return { success: true, entry, result: entry.resultingState };
  } catch (error) {
    markUnverifiedMutation(entry, error);
    replaceEntry(userDataPath, entry);
    return { success: false, entry, error: entry.stderr };
  }
}

async function setGpuPreference(userDataPath, exePath, preference, adapters = {}) {
  const readGpuValue = adapters.readGpuPreference || readGpuPreference;
  const writeGpuValue = adapters.writeGpuPreferenceData || writeGpuPreferenceData;
  const safePath = assertExecutablePath(exePath);
  if (![0, 1, 2].includes(preference)) throw new Error('Graphics preference must be Let Windows decide, Power saving or High performance.');
  const before = await readGpuValue(safePath);
  if (before.exists && before.kind !== 'String') throw new Error('The existing graphics preference is not stored as text. Dialed will not overwrite it.');
  const intendedData = formatGpuPreference(before.data, preference);
  if (before.exists && before.data === intendedData) throw new Error('That graphics preference is already set for this app.');
  const entry = createEntry(
    `graphics:gpu-preference:${gpuPreferenceTargetId(safePath)}`,
    `Graphics preference: ${path.win32.basename(safePath)}`,
    { exePath: safePath, existed: before.exists, data: before.data, kind: before.kind, intendedData, preference },
    { category: 'Graphics preference', rollback: { available: true, kind: 'restore-gpu-preference', reason: before.exists ? 'Restores the exact previous preference text.' : 'Removes the preference so Windows decides again.' } }
  );
  appendEntry(userDataPath, entry);
  try {
    const result = await writeGpuValue(safePath, intendedData);
    const verified = await readGpuValue(safePath);
    if (!verified.exists || verified.data !== intendedData) throw new Error('Windows did not report the intended graphics preference after the write.');
    entry.status = 'SUCCESS';
    entry.exitCode = result.exitCode ?? 0;
    entry.stdout = result.stdout || '';
    entry.stderr = result.stderr || '';
    entry.resultingState = { verified, restartRequired: true, performanceOutcome: 'UNVERIFIED' };
    replaceEntry(userDataPath, entry);
    return { success: true, entry, result: entry.resultingState };
  } catch (error) {
    markUnverifiedMutation(entry, error);
    replaceEntry(userDataPath, entry);
    return { success: false, entry, error: entry.stderr };
  }
}

async function addUltimatePlan(userDataPath, adapters = {}) {
  const duplicate = adapters.duplicateUltimatePlan || powerTweaks.duplicateUltimatePlan;
  const readPlans = adapters.listPowerPlans || listPowerPlans;
  const before = await powerTweaks.ultimatePlanState({ listPowerPlans: readPlans });
  if (before.present) throw new Error('An Ultimate Performance plan is already in your plan list. Choose it under Power plan.');
  const beforeGuids = before.inventory.items.map((item) => item.guid);
  const entry = createEntry(
    'power:add-ultimate-plan',
    'Add the Ultimate Performance power plan',
    { beforeGuids, sourceGuid: powerTweaks.ULTIMATE_SOURCE_GUID },
    { category: 'Power plan', rollback: { available: true, kind: 'remove-power-plan', reason: 'Removes the plan Dialed added, if it is not the active plan.' } }
  );
  appendEntry(userDataPath, entry);
  try {
    const result = await duplicate();
    const after = await readPlans();
    const added = after.items.filter((item) => !beforeGuids.includes(item.guid));
    if (added.length !== 1) throw new Error('Windows did not report exactly one new power plan after adding Ultimate Performance.');
    entry.status = 'SUCCESS';
    entry.exitCode = result.exitCode ?? 0;
    entry.stdout = result.stdout || '';
    entry.stderr = result.stderr || '';
    entry.resultingState = { createdGuid: added[0].guid, name: added[0].name, activated: false, performanceOutcome: 'UNVERIFIED' };
    replaceEntry(userDataPath, entry);
    return { success: true, entry, result: entry.resultingState };
  } catch (error) {
    markUnverifiedMutation(entry, error);
    replaceEntry(userDataPath, entry);
    return { success: false, entry, error: entry.stderr };
  }
}

async function setCpuMinimumState(userDataPath, adapters = {}) {
  const readPlans = adapters.listPowerPlans || listPowerPlans;
  const readCpu = adapters.readCpuMinimumState || powerTweaks.readCpuMinimumState;
  const writeCpu = adapters.writeCpuMinimumAc || powerTweaks.writeCpuMinimumAc;
  const plans = await readPlans();
  if (!plans.activeGuid) throw new Error('Windows did not report the active power plan, so an exact undo could not be recorded. Nothing was changed.');
  const plan = plans.items.find((item) => item.guid === plans.activeGuid);
  const before = await readCpu(plans.activeGuid);
  if (before.ac === 100) throw new Error(`Minimum processor state is already 100% on ${plan?.name || 'the active plan'} when plugged in.`);
  const entry = createEntry(
    `power:cpu-minimum-state:${plans.activeGuid}`,
    `Minimum processor state 100% (plugged in): ${plan?.name || 'active plan'}`,
    { schemeGuid: plans.activeGuid, schemeName: plan?.name || '', ac: before.ac, dc: before.dc },
    { category: 'Power plan', rollback: { available: true, kind: 'restore-cpu-minimum-state', reason: `Sets the plugged-in minimum processor state back to ${before.ac}%.` } }
  );
  appendEntry(userDataPath, entry);
  try {
    const result = await writeCpu(plans.activeGuid, 100);
    const verified = await readCpu(plans.activeGuid);
    if (verified.ac !== 100 || verified.dc !== before.dc) throw new Error('Windows did not report the intended minimum processor state after the write.');
    entry.status = 'SUCCESS';
    entry.exitCode = result.exitCode ?? 0;
    entry.stdout = result.stdout || '';
    entry.stderr = result.stderr || '';
    entry.resultingState = { verified, performanceOutcome: 'UNVERIFIED' };
    replaceEntry(userDataPath, entry);
    return { success: true, entry, result: entry.resultingState };
  } catch (error) {
    markUnverifiedMutation(entry, error);
    replaceEntry(userDataPath, entry);
    return { success: false, entry, error: entry.stderr };
  }
}

async function setMouseAcceleration(userDataPath, enabled, adapters = {}) {
  const readMouse = adapters.readMouseAcceleration || mouse.readMouseAcceleration;
  const writeMouse = adapters.writeMouseValues || mouse.writeMouseValues;
  if (typeof enabled !== 'boolean') throw new Error('Choose on or off.');
  const before = await readMouse();
  if (mouse.VALUE_NAMES.some((name) => before.values[name].exists && before.values[name].kind !== 'String')) throw new Error('The existing mouse settings are not stored as text. Dialed will not overwrite them.');
  // Only exact captured values can be restored, so unusual existing values are refused.
  mouse.assertCapturedValues(before.values);
  if (before.enabled === enabled) throw new Error(`Mouse acceleration is already ${enabled ? 'on' : 'off'}.`);
  const intended = enabled ? 'on' : 'off';
  const entry = createEntry(
    'settings:user:mouse-acceleration',
    `Mouse acceleration: turn ${intended}`,
    { values: before.values, intended },
    { category: 'Windows gaming setting', rollback: { available: true, kind: 'restore-mouse-acceleration', reason: 'Restores the exact previous mouse speed and threshold values.' } }
  );
  appendEntry(userDataPath, entry);
  try {
    const result = await writeMouse(mouse.targetValues(intended));
    const verified = await readMouse();
    if (!mouse.sameValues(verified.values, mouse.targetValues(intended))) throw new Error('Windows did not report the intended mouse settings after the write.');
    entry.status = 'SUCCESS';
    entry.exitCode = result.exitCode ?? 0;
    entry.stdout = result.stdout || '';
    entry.stderr = result.stderr || '';
    entry.resultingState = { verified, appliedToSession: result.output?.appliedToSession === true, performanceOutcome: 'UNVERIFIED' };
    replaceEntry(userDataPath, entry);
    return { success: true, entry, result: entry.resultingState };
  } catch (error) {
    markUnverifiedMutation(entry, error);
    replaceEntry(userDataPath, entry);
    return { success: false, entry, error: entry.stderr };
  }
}

async function setUserSetting(userDataPath, settingId, enabled, adapters = {}) {
  const readSetting = adapters.readUserSetting || readUserSetting;
  const readElevation = adapters.isCurrentProcessElevated || isCurrentProcessElevated;
  const setting = userSetting(settingId);
  if (typeof enabled !== 'boolean') throw new Error('Choose on or off.');
  if (setting.scope === 'machine') {
    assertCurrentProcessAdministrator(
      setting.capabilityId,
      await readElevation(),
      `${setting.title} is a machine-wide setting and requires Dialed to be running as administrator. Nothing was changed; restart Dialed and accept the administrator prompt.`
    );
  }
  const before = await readSetting(settingId);
  if (before.exists && before.kind !== 'DWord') throw new Error(`The existing ${setting.title} value is not a DWORD. Dialed will not overwrite it.`);
  const intendedValue = intendedValueFor(settingId, enabled);
  if (stateHasValue(before, intendedValue) || before.enabled === enabled) throw new Error(`${setting.title} is already ${enabled ? 'on' : 'off'}.`);
  const entry = createEntry(
    userSettingActionId(settingId),
    `${setting.title}: turn ${enabled ? 'on' : 'off'}`,
    { settingId, existed: before.exists, value: before.value, kind: before.kind, intendedValue },
    { category: 'Windows gaming setting', rollback: { available: true, kind: 'restore-user-setting', reason: before.exists ? `Restores the exact previous ${setting.title} value.` : `Removes the value so Windows uses its default for ${setting.title} again.` } }
  );
  appendEntry(userDataPath, entry);
  try {
    const result = await applyUserSettingValue(settingId, intendedValue, adapters);
    const verified = await readSetting(settingId);
    if (!stateHasValue(verified, intendedValue)) throw new Error(`Windows did not report the intended ${setting.title} value after the write.`);
    entry.status = 'SUCCESS';
    entry.exitCode = result.exitCode ?? 0;
    entry.stdout = result.stdout || '';
    entry.stderr = result.stderr || '';
    entry.resultingState = { verified, restartRequired: setting.restartRequired, effectiveState: setting.restartRequired ? 'PENDING_RESTART' : 'APPLIED', performanceOutcome: 'UNVERIFIED' };
    replaceEntry(userDataPath, entry);
    return { success: true, entry, result: entry.resultingState };
  } catch (error) {
    markUnverifiedMutation(entry, error);
    replaceEntry(userDataPath, entry);
    return { success: false, entry, error: entry.stderr };
  }
}

async function prepareTempState() {
  const { stdout } = await runPowerShell(createTempMaintenancePowerShellScript(false));
  return JSON.parse(stdout);
}

async function clearTempFiles() {
  const { stdout, stderr, exitCode } = await runPowerShell(createTempMaintenancePowerShellScript(true));
  return { output: JSON.parse(stdout), stdout, stderr, exitCode };
}

async function inspectCacheCleanup(kind) {
  const { stdout } = await runPowerShell(createCacheCleanupPowerShellScript(kind, false));
  return JSON.parse(stdout);
}

async function runCacheCleanup(kind) {
  const { stdout, stderr, exitCode } = await runPowerShell(createCacheCleanupPowerShellScript(kind, true));
  return { output: JSON.parse(stdout), stdout, stderr, exitCode };
}

async function inspectCacheCleanups(adapters = {}) {
  const inspect = adapters.inspectCacheCleanup || inspectCacheCleanup;
  const items = {};
  const errors = [];
  for (const kind of Object.keys(CACHE_CLEANUP_KINDS)) {
    try {
      const state = await inspect(kind);
      items[kind] = { totalSizeBytes: Number(state.totalSizeBytes) || 0, pathCount: Number(state.pathCount) || 0, paths: Array.isArray(state.paths) ? state.paths.map(String) : [] };
    } catch (error) {
      errors.push({ component: CACHE_CLEANUP_KINDS[kind].title, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { scannedAt: new Date().toISOString(), items, errors };
}

async function retrimDrive(driveLetter) {
  // Microsoft documents -ReTrim as issuing TRIM/Unmap hints for unused sectors:
  // https://learn.microsoft.com/powershell/module/storage/optimize-volume
  const { stdout, stderr, exitCode } = await runPowerShell(
    `Optimize-Volume -DriveLetter '${driveLetter}' -ReTrim -Verbose -ErrorAction Stop | Out-String`
  );
  return { output: { driveLetter, message: stdout || 'Windows completed the ReTRIM request; device effect and performance were not measured.' }, stdout, stderr, exitCode };
}

async function executeMaintenanceAction(userDataPath, actionId, adapters = {}) {
  const readTempState = adapters.prepareTempState || prepareTempState;
  const deleteTempFiles = adapters.clearTempFiles || clearTempFiles;
  const readStorageVolumes = adapters.listStorageVolumes || listStorageVolumes;
  const runRetrim = adapters.retrimDrive || retrimDrive;
  let title;
  let preAction;
  let execute;

  if (actionId === 'clear-temp-files') {
    title = 'Clear temporary files';
    preAction = await readTempState();
    execute = deleteTempFiles;
  } else if (CACHE_CLEANUP_KINDS[actionId]) {
    title = CACHE_CLEANUP_KINDS[actionId].title;
    preAction = await (adapters.inspectCacheCleanup || inspectCacheCleanup)(actionId);
    if (!preAction || !Number.isInteger(preAction.pathCount) || preAction.pathCount < 1) {
      throw new Error('No eligible cache files were found in a fresh inventory. Nothing was deleted and Local Audit History was not changed.');
    }
    execute = () => (adapters.runCacheCleanup || runCacheCleanup)(actionId);
  } else {
    const match = /^retrim-drive:([A-Z])$/i.exec(actionId);
    if (!match) throw new Error('This maintenance action is not recognized.');
    const readElevation = adapters.isCurrentProcessElevated || isCurrentProcessElevated;
    const elevated = await readElevation();
    if (elevated !== true) {
      throw new Error('ReTRIM requires Dialed to be running as administrator. No disk operation was started and Local Audit History was not changed.');
    }
    const driveLetter = match[1].toUpperCase();
    const inventory = await readStorageVolumes();
    if (inventory.errors.length) {
      throw new Error(`The target volume could not be revalidated: ${inventory.errors.map((error) => error.message).join('; ')}`);
    }
    const drive = inventory.items.find((item) => item.driveLetter === driveLetter);
    if (!drive || !drive.isSSD || !drive.trimEnabled) {
      throw new Error('The target is no longer an observed SSD volume with TRIM enabled. Run a new scan.');
    }
    title = `ReTRIM ${driveLetter}:`;
    preAction = { ...drive, operation: 'Optimize-Volume -ReTrim' };
    execute = () => runRetrim(driveLetter);
  }

  const entry = createEntry(actionId, title, preAction);
  appendEntry(userDataPath, entry);

  try {
    const result = await execute();
    if (result.exitCode !== 0) throw Object.assign(new Error(result.stderr || 'Maintenance command did not report successful completion.'), { exitCode: result.exitCode });
    result.output = {
      ...result.output,
      commandStatus: 'COMPLETED',
      performanceEffect: 'UNMEASURED',
      ...(actionId === 'clear-temp-files' || CACHE_CLEANUP_KINDS[actionId] ? {
        byteAccounting: 'SUM_OF_REMOVED_FILE_LENGTHS',
        observedFreeSpaceChangeBytes: null,
        limitations: 'Removed file lengths do not establish actual free-space change. Skipped files may be locked, changed or inaccessible.',
      } : {
        deviceEffect: 'UNVERIFIED',
        limitations: 'Command completion confirms Windows accepted the request, not physical reclamation or faster storage.',
      }),
    };
    entry.status = 'SUCCESS';
    entry.exitCode = result.exitCode;
    entry.stdout = result.stdout;
    entry.stderr = result.stderr;
    entry.resultingState = result.output;
    replaceEntry(userDataPath, entry);
    return { success: true, entry, result: result.output };
  } catch (error) {
    entry.status = 'FAILED';
    entry.exitCode = error && Number.isInteger(error.exitCode) ? error.exitCode : null;
    entry.stderr = error instanceof Error ? error.message : String(error);
    replaceEntry(userDataPath, entry);
    return { success: false, entry, error: entry.stderr };
  }
}

async function executeOptionalAppRemoval(userDataPath, preview, adapters = {}) {
  const listCandidates = adapters.listOptionalAppCandidates || listOptionalAppCandidates;
  const removePackage = adapters.removeOptionalAppPackage || removeOptionalAppPackage;
  const inventory = await listCandidates(adapters);
  const current = inventory.items.find((item) => item.id === preview?.id);
  if (!previewMatchesCandidate(preview, current)) {
    throw new Error('The optional-app package changed after preview. Refresh and review the exact package again.');
  }
  const entry = createEntry(
    `optional-app:remove:${preview.id}`,
    `Remove optional app: ${preview.title}`,
    {
      id: preview.id,
      name: preview.name,
      packageFullName: preview.packageFullName,
      packageFamilyName: preview.packageFamilyName,
      version: preview.version,
      publisher: preview.publisher,
      fingerprint: preview.fingerprint,
      scope: 'CURRENT_USER',
      consequence: preview.consequence,
      recovery: preview.recovery,
    },
    {
      category: 'Selective optional-app cleanup',
      rollback: {
        available: false,
        reason: 'Exact rollback is unavailable. Microsoft Store Library may offer reinstallation, but package availability, prior data, and preferences are not guaranteed.',
      },
    }
  );
  appendEntry(userDataPath, entry);

  try {
    const result = await removePackage(preview, adapters);
    const packages = await (adapters.listCurrentUserPackages || listCurrentUserPackages)(adapters);
    if (packages.some((item) => item.packageFullName === preview.packageFullName)) {
      throw new Error('Windows still reports the exact package after Remove-AppxPackage completed.');
    }
    entry.status = 'SUCCESS';
    entry.exitCode = result.exitCode;
    entry.stdout = result.stdout;
    entry.stderr = result.stderr;
    entry.resultingState = {
      ...result.output,
      verifiedAbsent: true,
      performanceOutcome: 'UNVERIFIED',
      recovery: preview.recovery,
    };
    replaceEntry(userDataPath, entry);
    return { success: true, entry, result: entry.resultingState };
  } catch (error) {
    markUnverifiedMutation(entry, error);
    replaceEntry(userDataPath, entry);
    return { success: false, entry, error: entry.stderr };
  }
}

module.exports = {
  JOURNAL_DELETION_MODES,
  activatePowerPlan,
  applyJournalDeletion,
  inspectCacheCleanups,
  setGpuPreference,
  addUltimatePlan,
  setCpuMinimumState,
  setMouseAcceleration,
  setUserSetting,
  assertValidAuditExport,
  createAuditExportPreview,
  createJournalDeletionPreview,
  createSafetyCheckpointPowerShellScript,
  disableStartupItem,
  enableConsumerFeaturesPolicy,
  enableProcessEcoQos,
  executeMaintenanceAction,
  executeOptionalAppRemoval,
  executeTimingAction,
  inspectJournalRecovery,
  recoverCorruptJournal,
  readJournal,
  reconcilePendingEntries,
  rollbackAuditEntry,
  writeAuditExport,
};
