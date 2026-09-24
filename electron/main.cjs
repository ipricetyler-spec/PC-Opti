const { app, BrowserWindow, dialog, ipcMain, shell, screen } = require('electron');
const crypto = require('crypto');
const path = require('path');
const { pathToFileURL } = require('url');
const packageJson = require('../package.json');
const { configureAcceptanceUserDataPath } = require('../src/main/acceptance-user-data/index.cjs');
const { createSystemScanSnapshot, listManageableProcesses, listSafePolicies, listStartupItems } = require('../src/main/scanner/index.cjs');
const {
  capabilityForAction,
  isCapabilityAvailable,
  listCapabilities,
  requireCapability,
  resolveRuntimeProfile,
} = require('../src/main/capabilities/index.cjs');
const { buildLocalRecommendations } = require('../src/main/recommendations/index.cjs');
const { buildDriftReport, setDriftBaseline } = require('../src/main/drift/index.cjs');
const { listGameSettingsGuides } = require('../src/main/game-settings/index.cjs');
const { readBiosPlan } = require('../src/main/bios-guidance/index.cjs');
const { createInputService } = require('../src/main/input-devices/index.cjs');
const { createInputDriverLifecycleService } = require('../src/main/input-driver-lifecycle/index.cjs');
const { readBundledStatus } = require('../src/main/input-driver-lifecycle/bundled-status.cjs');
const { readNativeBrokerStatus, createNativeBrokerLauncher } = require('../src/main/input-driver-lifecycle/native-broker.cjs');
const { isAllowedAppNavigation, normalizeExternalTarget } = require('../src/main/navigation/index.cjs');
const { createPreviewStore } = require('../src/main/shared/preview-store.cjs');
const { listGameProfiles, previewGameProfile, applyGameProfile, assertGameClosed } = require('../src/main/game-profiles/index.cjs');
const {
  applyGameConfigRestore,
  createGameConfigBackup,
  createGameConfigRestorePreview,
  discoverInstalledGames,
  listGameConfigBackups,
  listWindowsInstalledApplications,
  publicRestorePreview,
} = require('../src/main/game-config/index.cjs');
const { listTimingExperiments } = require('../src/main/timing/index.cjs');
const { listOptionalAppCandidates, previewOptionalAppRemoval } = require('../src/main/optional-apps/index.cjs');
const {
  NETWORK_PROBE_ENDPOINTS,
  appendNetworkQualityHistory,
  readNetworkQualityHistory,
  runNetworkQualityProbe,
} = require('../src/main/network-probe/index.cjs');
const { readReleaseStatus } = require('../src/main/release-status/index.cjs');
const { createUpdaterService, normalizeUpdateTrust, publicConfiguration } = require('../src/main/updater/index.cjs');
const { createPresentMonService } = require('../src/main/presentmon/index.cjs');
const {
  applyImport: applyBenchmarkImport,
  createBenchmarkDeletionPreview,
  createImportPreview: createBenchmarkImportPreview,
  createPresentMonRecords,
  deleteBenchmarkExperiment,
  listBenchmarkEvidence,
  parseBenchmarkSource,
  readBenchmarks,
} = require('../src/main/benchmarks/index.cjs');
const { listPowerPlans } = require('../src/main/power-plans/index.cjs');
const { USER_SETTINGS, blockingPolicyReason, differsFromWindowsDefault, editionSupport, readUserSetting, readWindowsEdition, unsupportedReasonFor } = require('../src/main/user-settings/index.cjs');

// Microsoft documents the consumer-experience policy for Enterprise and Education only.
const CONSUMER_FEATURES_EDITIONS = Object.freeze(['enterprise', 'education']);
let windowsEditionPromise = null;
function windowsEdition() {
  // Read once per run; a failed read is treated as unknown, which never blocks.
  windowsEditionPromise ||= readWindowsEdition().catch(() => ({ editionId: '', family: 'unknown' }));
  return windowsEditionPromise;
}
async function assertEditionSupports(editions) {
  const { family } = await windowsEdition();
  const support = editionSupport(editions, family);
  if (!support.supported) throw new Error(`${support.reason} Nothing was changed.`);
}
const { readMouseAcceleration } = require('../src/main/mouse-acceleration/index.cjs');
const powerTweaks = require('../src/main/power-tweaks/index.cjs');
const windowedGames = require('../src/main/windowed-games/index.cjs');
const { ensureProtectedDataRoot } = require('../src/main/protected-data/index.cjs');
const fullscreenOptimizations = require('../src/main/fullscreen-optimizations/index.cjs');
const { assertExecutablePath, gpuPreferenceTargetId, listGpuPreferences, parseGpuPreference, readGpuPreference } = require('../src/main/gpu-preference/index.cjs');
const { readDisplayModes } = require('../src/main/display-modes/index.cjs');
const { readWifiStatus } = require('../src/main/wifi-status/index.cjs');
const { readLiveHardware } = require('../src/main/telemetry/index.cjs');
const {
  activatePowerPlan,
  inspectCacheCleanups,
  setGpuPreference,
  addUltimatePlan,
  setCpuMinimumState,
  setFullscreenOptimizations,
  setUsbSelectiveSuspendOff,
  setWindowedGameOptimizations,
  useProtectedJournalDirectory,
  setMouseAcceleration,
  setUserSetting,
  applyJournalDeletion,
  createAuditExportPreview,
  createJournalDeletionPreview,
  disableStartupItem,
  enableConsumerFeaturesPolicy,
  enableProcessEcoQos,
  executeMaintenanceAction,
  executeOptionalAppRemoval,
  executeTimingAction,
  inspectJournalRecovery,
  readJournal,
  recoverCorruptJournal,
  reconcilePendingEntries,
  rollbackAuditEntry,
  writeAuditExport,
} = require('../src/main/journal/index.cjs');

let mainWindow;
let latestVerifiedSnapshot = null;
let latestStartupItems = new Map();
let latestManageableProcesses = new Map();
let latestGpuPreferenceTargets = new Map();
let latestFullscreenTargets = new Map();
function createMainPreviewStore(message, ttlMs = null, queuedMessage = message) {
  return createPreviewStore({ ttlMs, makeError: (reason) => new Error(reason === 'EXPIRED_WHILE_QUEUED' ? queuedMessage : message) });
}
const auditExportPreviews = createMainPreviewStore('Preview the redacted audit export before choosing a file.');
const journalDeletionPreviews = createMainPreviewStore('The audit deletion preview expired. Refresh and review deletion again.');
const benchmarkImportPreviews = createMainPreviewStore('The benchmark import preview expired. Select and review the file again.');
const presentMonImportDrafts = createMainPreviewStore('The PresentMon import preview expired. Select both captures again.');
const benchmarkDeletionPreviews = createMainPreviewStore('The benchmark deletion preview expired. Refresh and review deletion again.');
const policyThrottleContinuations = createMainPreviewStore('The restore-point throttle confirmation expired. Review the policy again.', 5 * 60 * 1000);
const gameConfigRestorePreviews = createMainPreviewStore('Game-config restore preview is missing, expired, or already used. No file was changed.', 10 * 60 * 1000, 'Restore preview expired while queued. No file was changed.');
const optionalAppRemovalPreviews = createMainPreviewStore('The optional-app preview is missing, expired, or already used. Refresh and review again.', 10 * 60 * 1000);
const presentMonDeletionPreviews = createMainPreviewStore('The capture deletion preview is missing, expired, or already used. Refresh and review again.', 10 * 60 * 1000);
const networkProbeConsentPreviews = createMainPreviewStore('The connection-test consent expired. Review the privacy notice and try again.', 5 * 60 * 1000, 'The connection-test consent expired before the sample started. Review it again.');
const presentMonCaptureConsentPreviews = createMainPreviewStore('The PresentMon capture consent expired. Review the exact target and duration again.', 5 * 60 * 1000, 'The PresentMon capture consent expired before recording started. Review it again.');
let activeNetworkProbeController = null;
let activeNetworkProbeProgress = null;
let activeBiosPlanRead = null;
let inputDeviceService;
let inputDriverLifecycleService;
let presentMonCaptureService;
let verifiedUpdaterService;
function inputDevices() {
  if (!inputDeviceService) inputDeviceService = createInputService(app.getPath('userData'), { nativeSetupActive: () => launchBundledBroker?.isRunning() === true });
  return inputDeviceService;
}
function inputDriverLifecycle() {
  if (!inputDriverLifecycleService) {
    inputDriverLifecycleService = createInputDriverLifecycleService({
      configuration: packageJson.dialed?.inputDriver,
      appRoot: process.resourcesPath,
    });
  }
  return inputDriverLifecycleService;
}
function presentMonCaptures() {
  if (!presentMonCaptureService) {
    presentMonCaptureService = createPresentMonService({
      userDataPath: app.getPath('userData'),
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appRoot: app.getAppPath(),
    });
  }
  return presentMonCaptureService;
}
// The admin-only folder for the change log and update staging. Null when Dialed is not
// running as administrator or the folder could not be verified; then the previous
// per-user locations are used, as before.
let protectedDataRoot = null;
async function prepareProtectedData() {
  if (process.platform !== 'win32') return;
  try {
    const { root } = await ensureProtectedDataRoot();
    const { migrated } = useProtectedJournalDirectory(app.getPath('userData'), path.join(root, 'Journal'));
    protectedDataRoot = root;
    console.info(`Change log is in the protected folder${migrated ? ' (moved there now)' : ''}.`);
  } catch (error) {
    console.warn(`Protected folder unavailable, using per-user data: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function verifiedUpdater() {
  if (!verifiedUpdaterService) {
    verifiedUpdaterService = createUpdaterService({
      // Update files are staged where only administrators can change them, when available.
      userDataPath: protectedDataRoot || app.getPath('userData'),
      // Without the protected folder, staging would be writable by ordinary processes, so the
      // updater refuses to run rather than stage an installer an elevated Dialed will launch.
      stagingProtected: Boolean(protectedDataRoot),
      currentVersion: app.getVersion(),
      isPackaged: app.isPackaged,
      runningExecutablePath: process.execPath,
      trust: packageJson.dialed?.update,
      openInstaller: (filePath) => shell.openPath(filePath),
    });
  }
  return verifiedUpdaterService;
}
const gameProfilePreviews = createPreviewStore();
ipcMain.handle('pc-opti:scan-input-devices', () => {
  assertCapabilityAvailable('input:usb-advisor');
  return inputDevices().scan();
});
ipcMain.handle('pc-opti:get-input-driver-lifecycle-status', (_event, deviceDigest) => {
  assertCapabilityAvailable('input:usb-advisor');
  return inputDriverLifecycle().status(assertInputDriverDeviceDigest(deviceDigest, true));
});
ipcMain.handle('pc-opti:get-bundled-input-status', () => {
  assertCapabilityAvailable('input:usb-advisor');
  const nativeBroker = readNativeBrokerStatus(app.isPackaged ? path.join(process.resourcesPath, 'hidusbf-native') : path.join(app.getAppPath(), 'output', 'hidusbf-native'));
  return readBundledStatus(app.isPackaged ? path.join(process.resourcesPath, 'hidusbf') : path.join(app.getAppPath(), 'vendor', 'hidusbf'), { packaged: app.isPackaged, nativeBroker });
});
let launchBundledBroker;
ipcMain.handle('pc-opti:open-bundled-input-setup', (event, ...args) => {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) throw new Error('Driver setup must be opened from the main Dialed window.');
  if (args.length !== 1) throw new Error('Select exactly one input device for setup.');
  assertCapabilityAvailable('input:usb-advisor');
  const directory = app.isPackaged ? path.join(process.resourcesPath, 'hidusbf-native') : path.join(app.getAppPath(), 'output', 'hidusbf-native');
  if (inputDevices().isBusy()) throw new Error('Finish the input check or legacy recovery before opening native setup.');
  launchBundledBroker ||= createNativeBrokerLauncher(directory, () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('pc-opti:bundled-input-setup-closed');
  });
  return launchBundledBroker(args[0]);
});
ipcMain.handle('pc-opti:preview-input-driver-install', (_event, deviceDigest, requestedHz) => {
  assertCapabilityAvailable('input:driver-lifecycle');
  return inputDriverLifecycle().previewInstall(assertInputDriverDeviceDigest(deviceDigest), assertInputDriverRate(requestedHz));
});
ipcMain.handle('pc-opti:preview-input-driver-adoption', (_event, deviceDigest, requestedHz) => {
  assertCapabilityAvailable('input:driver-lifecycle');
  return inputDriverLifecycle().previewAdoption(assertInputDriverDeviceDigest(deviceDigest), assertInputDriverRate(requestedHz));
});
ipcMain.handle('pc-opti:preview-input-driver-repair', (_event, deviceDigest) => {
  assertCapabilityAvailable('input:driver-lifecycle');
  return inputDriverLifecycle().previewRepair(assertInputDriverDeviceDigest(deviceDigest));
});
ipcMain.handle('pc-opti:preview-input-driver-upgrade', () => {
  assertCapabilityAvailable('input:driver-lifecycle');
  return inputDriverLifecycle().previewUpgrade();
});
ipcMain.handle('pc-opti:preview-input-driver-detach', (_event, deviceDigest) => {
  assertCapabilityAvailable('input:driver-lifecycle');
  return inputDriverLifecycle().previewDetach(assertInputDriverDeviceDigest(deviceDigest));
});
ipcMain.handle('pc-opti:preview-input-driver-package-removal', () => {
  assertCapabilityAvailable('input:driver-lifecycle');
  return inputDriverLifecycle().previewRemovePackage();
});
ipcMain.handle('pc-opti:apply-input-driver-lifecycle', (_event, token) => {
  assertCapabilityAvailable('input:driver-lifecycle');
  return serializeMutation(() => inputDriverLifecycle().apply(assertInputDriverOperationId(token, 'Driver preview token')));
});
ipcMain.handle('pc-opti:reconcile-input-driver-lifecycle', (_event, operationId) => {
  assertCapabilityAvailable('input:driver-lifecycle');
  return serializeMutation(() => inputDriverLifecycle().reconcile(assertInputDriverOperationId(operationId, 'Driver operation identifier')));
});
ipcMain.handle('pc-opti:label-input-port', (_event, deviceId, label) => {
  assertCapabilityAvailable('input:usb-advisor');
  return serializeMutation(() => inputDevices().labelPort(assertInputDeviceDigest(deviceId), assertInputPortLabel(label)));
});
ipcMain.handle('pc-opti:preview-input-polling', (_event, deviceId, rate, historyId) => {
  assertCapabilityAvailable('input:polling-rate');
  return inputDevices().preview(assertInputDeviceDigest(deviceId), assertInputPollingRate(rate), assertInputHistoryId(historyId, true));
});
ipcMain.handle('pc-opti:preview-input-isolation', (_event, deviceId) => {
  assertCapabilityAvailable('input:xhci-tier');
  return inputDevices().previewIsolation(assertInputDeviceDigest(deviceId));
});
ipcMain.handle('pc-opti:apply-input-polling', (_event, token) => {
  assertCapabilityAvailable('input:polling-rate');
  return serializeMutation(() => inputDevices().apply(assertInputOperationToken(token)));
});
ipcMain.handle('pc-opti:preview-input-tier', (_event, deviceId, historyId) => {
  assertCapabilityAvailable('input:xhci-tier');
  return inputDevices().previewTier(assertInputDeviceDigest(deviceId), assertInputHistoryId(historyId, true));
});
ipcMain.handle('pc-opti:apply-input-tier', (_event, token) => {
  assertCapabilityAvailable('input:xhci-tier');
  return serializeMutation(() => inputDevices().applyTier(assertInputOperationToken(token)));
});
ipcMain.handle('pc-opti:test-input-device', async (_event, deviceId) => {
  assertCapabilityAvailable('input:usb-advisor');
  // The check needs its own window to hold the foreground for the full eight seconds, and
  // Dialed's window is normally maximised behind it. Left clickable, it takes the foreground
  // back on the reader's first click and the check is cancelled before it can measure
  // anything. Disabled, a stray click cannot reach it. Always re-enabled, including on error.
  const disabled = mainWindow && !mainWindow.isDestroyed();
  if (disabled) mainWindow.setEnabled(false);
  try {
    return await inputDevices().test(assertInputDeviceDigest(deviceId));
  } finally {
    if (disabled && !mainWindow.isDestroyed()) {
      mainWindow.setEnabled(true);
      mainWindow.focus();
    }
  }
});
ipcMain.handle('pc-opti:cancel-input-test', () => {
  assertCapabilityAvailable('input:usb-advisor');
  return inputDevices().cancelTest();
});
ipcMain.handle('pc-opti:reconcile-input-change', (_event, historyId) => {
  assertCapabilityAvailable('input:polling-rate');
  return serializeMutation(() => inputDevices().reconcile(assertInputHistoryId(historyId)));
});
ipcMain.handle('pc-opti:reconcile-input-tier', (_event, historyId) => {
  assertCapabilityAvailable('input:xhci-tier');
  return serializeMutation(() => inputDevices().reconcileTier(assertInputHistoryId(historyId)));
});
let gameProfilePreviewGeneration = 0;

const WINDOWS_SETTINGS_PAGES = Object.freeze({
  'game-mode': 'ms-settings:gaming-gamemode',
  'game-bar': 'ms-settings:gaming-gamebar',
  captures: 'ms-settings:gaming-gamedvr',
  graphics: 'ms-settings:display-advancedgraphics',
  'installed-apps': 'ms-settings:appsfeatures',
  'startup-apps': 'ms-settings:startupapps',
  // Windows Security › Device security › Core isolation. Opened so the person can change
  // Memory Integrity themselves; Dialed never changes it.
  'core-isolation': 'windowsdefender://coreisolation',
});

function gameProfileRoots() {
  return { localAppData: process.env.LOCALAPPDATA, documents: app.getPath('documents') };
}

configureAcceptanceUserDataPath(app, {
  argv: process.argv,
  environment: process.env,
});

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

function resolveRuntimeProfileForApp() {
  return resolveRuntimeProfile({
    packageDefault: packageJson.dialed?.defaultProfile,
    environmentOverride: process.env.DIALED_RUNTIME_PROFILE || process.env.PC_OPTI_RUNTIME_PROFILE,
    isPackaged: app.isPackaged,
  });
}

function assertCapabilityAvailable(capabilityId) {
  return requireCapability(capabilityId, resolveRuntimeProfileForApp());
}

function runtimeProfileState() {
  const profile = resolveRuntimeProfileForApp();
  return {
    profile,
    capabilities: listCapabilities(profile),
  };
}

function journalForRenderer(entries, activeProfile = resolveRuntimeProfileForApp()) {
  return entries.map((entry) => {
    if (!entry.rollback?.available) return entry;
    try {
      requireCapability(entry.capabilityId, activeProfile);
      return entry;
    } catch {
      // Keep the evidence visible while removing an unavailable profile's execution affordance.
    }
    return {
      ...entry,
      rollback: {
        ...entry.rollback,
        available: false,
        reason: `Rollback is unavailable in the ${activeProfile} runtime profile.`,
      },
    };
  });
}

function journalStateForRenderer(state) {
  return { ...state, entries: journalForRenderer(state.entries) };
}

function currentBenchmarkEvidence() {
  return listBenchmarkEvidence(app.getPath('userData'), readJournal(app.getPath('userData')));
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

let mutationQueue = Promise.resolve();

function serializeMutation(operation) {
  const result = mutationQueue.then(operation, operation);
  mutationQueue = result.catch(() => undefined);
  return result;
}

function assertShortString(value, label, pattern) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128 || (pattern && !pattern.test(value))) {
    throw new Error(`${label} is not valid.`);
  }
  return value;
}

const INPUT_DRIVER_RATES = Object.freeze([125, 250, 500, 1000, 2000, 4000, 8000]);

function assertInputDriverDeviceDigest(value, optional = false) {
  if (optional && value === undefined) return undefined;
  return assertShortString(value, 'Input device digest', /^[a-f0-9]{64}$/);
}

function assertInputDriverRate(value) {
  if (!Number.isSafeInteger(value) || !INPUT_DRIVER_RATES.includes(value)) throw new Error('Input driver polling request is not valid.');
  return value;
}

function assertInputDriverOperationId(value, label) {
  if (typeof value !== 'string' || value.length < 20 || value.length > 80 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`${label} is not valid.`);
  return value;
}

function assertInputDeviceDigest(value) {
  return assertShortString(value, 'Input device id', /^[a-f0-9]{64}$/);
}

function assertInputPollingRate(value) {
  if (!Number.isSafeInteger(value) || !INPUT_DRIVER_RATES.includes(value)) throw new Error('Input polling request is not valid.');
  return value;
}

function assertInputHistoryId(value, optional = false) {
  if (optional && value === undefined) return undefined;
  return assertShortString(value, 'Input history id', /^[0-9a-f-]{36}$/i);
}

function assertInputOperationToken(value) {
  return assertShortString(value, 'Input preview token', /^[0-9a-f-]{36}$/i);
}

function assertInputPortLabel(value) {
  if (typeof value !== 'string' || value.length > 60 || /[\x00-\x1f\x7f]/.test(value)) throw new Error('Input port label is not valid.');
  return value;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 650,
    title: 'Dialed — Windows Performance Optimizer',
    backgroundColor: '#0a0b0d',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  const developmentEntry = process.env.VITE_DEV_SERVER_URL;
  const packagedEntry = path.join(__dirname, '../dist/index.html');
  const trustedEntry = developmentEntry || pathToFileURL(packagedEntry).toString();
  if (developmentEntry) {
    mainWindow.loadURL(developmentEntry);
  } else {
    mainWindow.loadFile(packagedEntry);
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try { void shell.openExternal(normalizeExternalTarget(url)); } catch { /* The requested target stays closed. */ }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedAppNavigation(url, trustedEntry)) event.preventDefault();
  });
}

ipcMain.handle('pc-opti:get-runtime-profile', async () => runtimeProfileState());

ipcMain.handle('pc-opti:list-capabilities', async () => runtimeProfileState().capabilities);

ipcMain.handle('pc-opti:scan-system', async () => {
  assertCapabilityAvailable('diagnostic:system-scan');
  latestVerifiedSnapshot = deepFreeze(await createSystemScanSnapshot());
  return latestVerifiedSnapshot;
});

ipcMain.handle('pc-opti:list-installed-applications', async () => {
  assertCapabilityAvailable('diagnostic:installed-app-inventory');
  return {
    scannedAt: new Date().toISOString(),
    items: await listWindowsInstalledApplications(),
    limitations: 'Windows installed-application metadata can omit portable apps, Microsoft Store details, exact disk use, or publisher/version fields. Missing estimated size is reported as unknown, never zero.',
  };
});

ipcMain.handle('pc-opti:list-optional-app-candidates', async () => {
  assertCapabilityAvailable('windows:optional-app-remove-current-user');
  return listOptionalAppCandidates();
});

ipcMain.handle('pc-opti:preview-optional-app-removal', async (_event, appId) => {
  assertCapabilityAvailable('windows:optional-app-remove-current-user');
  assertShortString(appId, 'Optional app id', /^[a-z0-9-]{2,64}$/);
  const preview = await previewOptionalAppRemoval(appId);
  const pending = optionalAppRemovalPreviews.issue(preview);
  return { token: pending.token, ...preview };
});

ipcMain.handle('pc-opti:apply-optional-app-removal', async (_event, token) => {
  assertCapabilityAvailable('windows:optional-app-remove-current-user');
  assertShortString(token, 'Optional app preview token', /^[0-9a-f-]{36}$/i);
  const pending = optionalAppRemovalPreviews.take(token);
  return serializeMutation(() => {
    optionalAppRemovalPreviews.assertFresh(pending);
    return executeOptionalAppRemoval(app.getPath('userData'), pending.preview);
  });
});

ipcMain.handle('pc-opti:open-windows-settings', async (_event, pageId) => {
  assertCapabilityAvailable('windows:settings-navigation');
  assertShortString(pageId, 'Windows Settings page id', /^[a-z0-9-]{2,64}$/);
  const uri = WINDOWS_SETTINGS_PAGES[pageId];
  if (!uri) throw new Error('This Windows Settings page is not in Dialed’s allowlist.');
  await shell.openExternal(uri);
  return { opened: true, pageId };
});

// Read-only: when Windows last started, so a test can tell whether a restart-required
// change is active yet. No input is accepted.
ipcMain.handle('pc-opti:get-boot-time', () => new Date(Date.now() - require('node:os').uptime() * 1000).toISOString());

ipcMain.handle('pc-opti:get-release-status', async () => {
  assertCapabilityAvailable('diagnostic:release-status');
  // The card must not offer a check that assertOperational would refuse, so it is told whether
  // staging is protected on this PC as well as whether release trust is configured.
  const updateConfiguration = publicConfiguration(normalizeUpdateTrust(packageJson.dialed?.update), Boolean(protectedDataRoot));
  return readReleaseStatus({ version: app.getVersion(), isPackaged: app.isPackaged, executablePath: process.execPath, updateConfiguration });
});

ipcMain.handle('pc-opti:check-for-updates', async () => {
  assertCapabilityAvailable('update:verified-release');
  return verifiedUpdater().checkForUpdates();
});

ipcMain.handle('pc-opti:download-update', async (_event, token) => {
  assertCapabilityAvailable('update:verified-release');
  assertShortString(token, 'Update download token', /^[0-9a-f-]{36}$/i);
  return verifiedUpdater().downloadUpdate(token);
});

ipcMain.handle('pc-opti:launch-update-installer', async (_event, token) => {
  assertCapabilityAvailable('update:verified-release');
  assertShortString(token, 'Verified installer token', /^[0-9a-f-]{36}$/i);
  return serializeMutation(() => verifiedUpdater().launchInstaller(token));
});

ipcMain.handle('pc-opti:get-local-recommendations', async () => {
  const activeProfile = resolveRuntimeProfileForApp();
  assertCapabilityAvailable('guidance:observed-system-state');
  if (!latestVerifiedSnapshot) {
    throw new Error('Run a verified system scan before requesting local recommendations.');
  }
  return buildLocalRecommendations(latestVerifiedSnapshot, activeProfile);
});

ipcMain.handle('pc-opti:get-drift-report', async () => {
  assertCapabilityAvailable('drift:manual-baseline');
  if (!latestVerifiedSnapshot) throw new Error('Run a verified system scan before comparing drift.');
  return buildDriftReport(app.getPath('userData'), latestVerifiedSnapshot);
});

ipcMain.handle('pc-opti:set-drift-baseline', async () => {
  assertCapabilityAvailable('drift:manual-baseline');
  if (!latestVerifiedSnapshot) throw new Error('Run a verified system scan before saving a drift baseline.');
  return setDriftBaseline(app.getPath('userData'), latestVerifiedSnapshot);
});

ipcMain.handle('pc-opti:list-startup-items', async () => {
  assertCapabilityAvailable('startup:disable-current-user-run');
  const inventory = await listStartupItems();
  latestStartupItems = new Map(inventory.items.map((item) => [item.id, item]));
  return {
    items: inventory.items.map((item) => {
      const machineWide = String(item.registryPath || '').startsWith('HKLM:\\');
      const capabilityId = machineWide ? 'startup:disable-machine-run' : 'startup:disable-current-user-run';
  const canDisable = item.canDisable && isCapabilityAvailable(capabilityId, resolveRuntimeProfileForApp());
      return {
        id: item.id,
        name: item.name,
        path: item.path,
        source: item.source,
        enabled: item.enabled,
        scope: item.scope,
        canDisable,
        managementNote: item.source === 'TaskScheduler'
          ? 'Read-only in Dialed. Manage this task in Windows Task Scheduler.'
          : machineWide && !canDisable
            ? 'Read-only in this session. Machine-wide entries need Dialed running as administrator.'
            : machineWide
              ? 'Machine-wide entry. Dialed can disable it (administrator session) and keep an exact restore record.'
              : 'Dialed can disable this current-user Registry Run entry and record a deterministic rollback.',
      };
    }),
    errors: inventory.errors,
  };
});

ipcMain.handle('pc-opti:disable-startup-item', async (_event, itemId) => {
  assertShortString(itemId, 'Startup item id', /^[a-f0-9]{24}$/);
  const item = latestStartupItems.get(itemId);
  if (!item) throw new Error('Startup inventory changed. Refresh the list before changing an item.');
  const capabilityId = String(item.registryPath || '').startsWith('HKLM:\\')
    ? 'startup:disable-machine-run'
    : 'startup:disable-current-user-run';
  assertCapabilityAvailable(capabilityId);
  const result = await serializeMutation(() => disableStartupItem(app.getPath('userData'), item));
  if (result.success) latestStartupItems.delete(itemId);
  return result;
});

ipcMain.handle('pc-opti:list-manageable-processes', async () => {
  assertCapabilityAvailable('process:enable-ecoqos');
  const inventory = await listManageableProcesses();
  latestManageableProcesses = new Map(inventory.items.map((item) => [item.pid, item]));
  return inventory;
});

ipcMain.handle('pc-opti:enable-process-ecoqos', async (_event, processId, creationTime) => {
  assertCapabilityAvailable('process:enable-ecoqos');
  const pid = Number(processId);
  if (!Number.isInteger(pid)) throw new Error('Process identifier must be an integer.');
  const process = latestManageableProcesses.get(pid);
  if (!process || typeof creationTime !== 'string' || !/^[0-9]{1,20}$/.test(creationTime) || process.creationTime !== creationTime) throw new Error('Process inventory changed. Refresh the Background apps list before changing a process.');
  return serializeMutation(() => enableProcessEcoQos(app.getPath('userData'), process));
});

ipcMain.handle('pc-opti:list-safe-policies', async () => {
  assertCapabilityAvailable('policy:disable-windows-consumer-features');
  return listSafePolicies();
});

ipcMain.handle('pc-opti:enable-consumer-features-policy', async () => {
  assertCapabilityAvailable('policy:disable-windows-consumer-features');
  await assertEditionSupports(CONSUMER_FEATURES_EDITIONS);
  policyThrottleContinuations.clear();
  const result = await serializeMutation(() => enableConsumerFeaturesPolicy(app.getPath('userData')));
  if (!result.requiresThrottleConfirmation) return result;
  const pending = policyThrottleContinuations.issue({});
  return { ...result, throttleToken: pending.token };
});

ipcMain.handle('pc-opti:confirm-consumer-features-policy', async (_event, throttleToken) => {
  assertCapabilityAvailable('policy:disable-windows-consumer-features');
  await assertEditionSupports(CONSUMER_FEATURES_EDITIONS);
  assertShortString(throttleToken, 'Policy throttle continuation token', /^[0-9a-f-]{36}$/i);
  const continuation = policyThrottleContinuations.take(throttleToken);
  return serializeMutation(() => {
    policyThrottleContinuations.assertFresh(continuation);
    return enableConsumerFeaturesPolicy(app.getPath('userData'), {}, { allowThrottledCheckpoint: true });
  });
});

ipcMain.handle('pc-opti:open-external-link', async (_event, url) => {
  const safeUrl = normalizeExternalTarget(url);
  await shell.openExternal(safeUrl);
  return { opened: true };
});

ipcMain.handle('pc-opti:list-timing-experiments', async () => {
  assertCapabilityAvailable('timing:view-performance-lab');
  return listTimingExperiments();
});

ipcMain.handle('pc-opti:execute-timing-experiment', async (_event, actionId) => {
  assertShortString(actionId, 'Timing experiment action id', /^timing:(restore-automatic-clock-source|disable-dynamic-tick|restore-default-dynamic-tick)$/);
  const capability = capabilityForAction(actionId);
  if (!capability) throw new Error('Timing experiment action is not registered.');
  assertCapabilityAvailable(capability.id);
  return serializeMutation(() => executeTimingAction(app.getPath('userData'), actionId));
});

// Read only and requested explicitly by the display guide; never runs at startup.
ipcMain.handle('pc-opti:read-display-inventory', () => {
  const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
  const displays = screen.getAllDisplays();
  const primaryId = typeof screen.getPrimaryDisplay === 'function' ? screen.getPrimaryDisplay()?.id ?? null : null;
  return {
    collectedAt: new Date().toISOString(),
    displays: displays.map((display, index) => ({
      id: Number.isFinite(display.id) ? display.id : null,
      label: typeof display.label === 'string' && display.label.trim() ? display.label.trim().slice(0, 160) : `Display ${index + 1}`,
      refreshRateHz: positive(display.displayFrequency),
      logicalWidth: positive(display.bounds?.width),
      logicalHeight: positive(display.bounds?.height),
      scaleFactor: positive(display.scaleFactor),
      primary: primaryId !== null && display.id === primaryId,
    })),
  };
});

ipcMain.handle('pc-opti:list-game-settings-guides', async () => {
  assertCapabilityAvailable('game:settings-guidance');
  return listGameSettingsGuides();
});

ipcMain.handle('pc-opti:read-bios-plan', async () => {
  assertCapabilityAvailable('bios:hardware-guidance');
  // Coalesce renderer refreshes; accept no script, model override or firmware payload.
  if (!activeBiosPlanRead) activeBiosPlanRead = readBiosPlan().finally(() => { activeBiosPlanRead = null; });
  return activeBiosPlanRead;
});

ipcMain.handle('pc-opti:discover-installed-games', async () => {
  assertCapabilityAvailable('game:installed-discovery');
  return discoverInstalledGames();
});

ipcMain.handle('pc-opti:list-game-profiles', () => {
  assertCapabilityAvailable('game:reviewed-profile');
  return listGameProfiles();
});

ipcMain.handle('pc-opti:preview-game-profile', async (_event, profileId) => {
  assertCapabilityAvailable('game:reviewed-profile');
  assertShortString(profileId, 'Game profile id', /^[a-z0-9-]{1,80}$/);
  const generation = ++gameProfilePreviewGeneration;
  gameProfilePreviews.clear();
  const preview = await previewGameProfile(profileId, gameProfileRoots());
  if (generation !== gameProfilePreviewGeneration) throw new Error('A newer preview request replaced this one.');
  const pending = gameProfilePreviews.issue(preview);
  return { ...preview, token: pending.token };
});

ipcMain.handle('pc-opti:apply-game-profile', async (_event, token) => {
  assertCapabilityAvailable('game:reviewed-profile');
  assertShortString(token, 'Game profile token', /^[0-9a-f-]{36}$/i);
  const pending = gameProfilePreviews.take(token);
  return serializeMutation(() => {
    gameProfilePreviews.assertFresh(pending);
    return applyGameProfile(app.getPath('userData'), pending.preview, gameProfileRoots());
  });
});

ipcMain.handle('pc-opti:list-game-config-backups', async () => {
  assertCapabilityAvailable('game:config-backup');
  return listGameConfigBackups(app.getPath('userData'));
});

ipcMain.handle('pc-opti:create-game-config-backup', async (_event, gameId) => {
  assertCapabilityAvailable('game:config-backup');
  assertShortString(gameId, 'Game guide id', /^[a-z0-9][a-z0-9-]{1,79}$/);
  if (!listGameSettingsGuides().some((guide) => guide.id === gameId)) throw new Error('Game guide id is not registered.');
  const selection = await dialog.showOpenDialog(mainWindow, {
    title: 'Select game configuration files to back up',
    buttonLabel: 'Back up selected files',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Game configuration files', extensions: ['cfg', 'conf', 'ini', 'json', 'txt', 'xml'] }],
  });
  if (selection.canceled || selection.filePaths.length === 0) return { canceled: true };
  const backup = createGameConfigBackup(app.getPath('userData'), gameId, selection.filePaths);
  return { canceled: false, backup };
});

ipcMain.handle('pc-opti:preview-game-config-restore', async (_event, backupId) => {
  assertCapabilityAvailable('game:config-restore');
  assertShortString(backupId, 'Game-config backup id', /^[0-9a-f-]{36}$/i);
  const preview = createGameConfigRestorePreview(app.getPath('userData'), backupId);
  await assertGameClosed(preview.gameId);
  const pending = gameConfigRestorePreviews.issue(preview);
  return publicRestorePreview(preview, pending.token);
});

ipcMain.handle('pc-opti:apply-game-config-restore', async (_event, token) => {
  assertCapabilityAvailable('game:config-restore');
  assertShortString(token, 'Game-config restore token', /^[0-9a-f-]{36}$/i);
  const pending = gameConfigRestorePreviews.take(token);
  return serializeMutation(async () => {
    gameConfigRestorePreviews.assertFresh(pending);
    await assertGameClosed(pending.preview.gameId);
    return applyGameConfigRestore(app.getPath('userData'), pending.preview);
  });
});

ipcMain.handle('pc-opti:get-network-probe-info', async () => {
  assertCapabilityAvailable('network:bounded-quality-probe');
  return Object.values(NETWORK_PROBE_ENDPOINTS);
});

ipcMain.handle('pc-opti:list-network-quality-history', async () => {
  assertCapabilityAvailable('network:bounded-quality-probe');
  return readNetworkQualityHistory(app.getPath('userData'));
});

ipcMain.handle('pc-opti:preview-network-quality-probe', async (_event, mode) => {
  assertCapabilityAvailable('network:bounded-quality-probe');
  if (!['quick', 'full'].includes(mode)) throw new Error('Choose a supported connection-test mode.');
  if (activeNetworkProbeController) throw new Error('A network quality probe is already running.');
  const endpoint = NETWORK_PROBE_ENDPOINTS[mode];
  const preview = {
    endpoint,
    mode,
    consequence: `Starts one bounded foreground HTTPS ${mode === 'full' ? 'full-speed test' : 'quick connection check'} with a hard ${(endpoint.maximumTotalBytes / (1024 * 1024)).toFixed(1)} MiB traffic limit. Cloudflare receives the public IP address and ordinary HTTPS request metadata; Dialed sends no hardware inventory, account data, filenames, or Windows configuration.`,
  };
  const pending = networkProbeConsentPreviews.issue(preview);
  return { ...preview, token: pending.token };
});

ipcMain.handle('pc-opti:run-network-quality-probe', async (_event, token) => {
  assertCapabilityAvailable('network:bounded-quality-probe');
  assertShortString(token, 'Network probe consent token', /^[0-9a-f-]{36}$/i);
  if (activeNetworkProbeController) throw new Error('A network quality probe is already running.');
  const pending = networkProbeConsentPreviews.take(token);
  networkProbeConsentPreviews.assertFresh(pending);
  const controller = new AbortController();
  activeNetworkProbeController = controller;
  activeNetworkProbeProgress = { phase: 'QUEUED', completedSteps: 0, totalSteps: 6, message: 'The user-approved test is starting.', bytesTransferred: 0, maximumTotalBytes: pending.preview.endpoint.maximumTotalBytes };
  try {
    const result = await runNetworkQualityProbe({ signal: controller.signal, mode: pending.preview.mode, onProgress: (value) => { activeNetworkProbeProgress = value; } });
    if (result.status === 'CANCELED') return { ...result, persistence: { saved: false, reason: 'Canceled samples are not saved.' } };
    try {
      const history = appendNetworkQualityHistory(app.getPath('userData'), result);
      return { ...result, persistence: { saved: true }, history };
    } catch (error) {
      return {
        ...result,
        persistence: {
          saved: false,
          reason: error instanceof Error ? error.message : 'The sample completed but local history could not be updated.',
        },
      };
    }
  } finally {
    if (activeNetworkProbeController === controller) activeNetworkProbeController = null;
  }
});

ipcMain.handle('pc-opti:get-network-probe-progress', async () => {
  assertCapabilityAvailable('network:bounded-quality-probe');
  return activeNetworkProbeProgress;
});

ipcMain.handle('pc-opti:cancel-network-quality-probe', async () => {
  assertCapabilityAvailable('network:bounded-quality-probe');
  if (!activeNetworkProbeController) return { canceled: false };
  activeNetworkProbeController.abort();
  return { canceled: true };
});

ipcMain.handle('pc-opti:execute-maintenance', async (_event, actionId) => {
  assertShortString(actionId, 'Maintenance action id', /^(clear-temp-files|clear-shader-caches|clear-crash-dumps|retrim-drive:[A-Z])$/);
  const capability = capabilityForAction(actionId);
  if (!capability) throw new Error('Maintenance action is not registered.');
  assertCapabilityAvailable(capability.id);
  return serializeMutation(() => executeMaintenanceAction(app.getPath('userData'), actionId));
});

// Dry-run inventory only; deletion still requires execute-maintenance with a fresh re-inventory.
ipcMain.handle('pc-opti:inspect-maintenance-caches', async () => {
  assertCapabilityAvailable('maintenance:clear-shader-caches');
  assertCapabilityAvailable('maintenance:clear-crash-dumps');
  return inspectCacheCleanups();
});

ipcMain.handle('pc-opti:list-power-plans', async () => {
  assertCapabilityAvailable('power:switch-plan');
  return listPowerPlans();
});

ipcMain.handle('pc-opti:activate-power-plan', async (_event, guid) => {
  assertCapabilityAvailable('power:switch-plan');
  assertShortString(guid, 'Power plan id', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  return serializeMutation(() => activatePowerPlan(app.getPath('userData'), guid));
});

// Reads the on/off state of the per-user gaming settings this profile can manage.
ipcMain.handle('pc-opti:read-user-settings', async () => {
  const states = {};
  const { family } = await windowsEdition();
  const consumerSupport = editionSupport(CONSUMER_FEATURES_EDITIONS, family);
  if (!consumerSupport.supported) states['consumer-features'] = { enabled: null, manageable: false, unsupported: consumerSupport.reason };
  for (const [settingId, setting] of Object.entries(USER_SETTINGS)) {
    if (!isCapabilityAvailable(setting.capabilityId, resolveRuntimeProfileForApp())) continue;
    const support = editionSupport(setting.editions, family);
    // Remove-only entries report state only as a leftover on an edition that ignores them.
    if (setting.removeOnly && support.supported) continue;
    if (!support.supported) {
      // A value this edition ignores may still be present (set by another tool); it can be removed.
      const leftover = await readUserSetting(settingId).then((state) => state.exists && (state.kind === 'DWord')).catch(() => false);
      states[settingId] = { enabled: null, manageable: false, unsupported: unsupportedReasonFor(settingId, family, support.reason), leftover };
      continue;
    }
    const blocked = await blockingPolicyReason(settingId).catch(() => null);
    if (blocked) { states[settingId] = { enabled: null, manageable: false, unsupported: blocked }; continue; }
    try {
      const state = await readUserSetting(settingId);
      states[settingId] = { enabled: state.enabled, manageable: !state.exists || state.kind === 'DWord', windowsDefault: setting.absentMeans, differsFromDefault: differsFromWindowsDefault(settingId, state) };
    } catch {
      states[settingId] = { enabled: null, manageable: false };
    }
  }
  if (isCapabilityAvailable('power:ultimate-plan', resolveRuntimeProfileForApp())) {
    try {
      const state = await powerTweaks.ultimatePlanState();
      states['ultimate-plan'] = { enabled: state.present, manageable: true, detail: state.present ? `In your plan list (${state.plans[0].name})` : 'Not in your plan list' };
    } catch {
      states['ultimate-plan'] = { enabled: null, manageable: false };
    }
  }
  if (isCapabilityAvailable('power:cpu-minimum-state', resolveRuntimeProfileForApp())) {
    try {
      const plans = await listPowerPlans();
      const plan = plans.items.find((item) => item.guid === plans.activeGuid);
      const state = await powerTweaks.readCpuMinimumState(plans.activeGuid);
      states['cpu-minimum-state'] = { enabled: state.ac === 100, manageable: true, detail: `${state.ac}% when plugged in (${plan?.name || 'active plan'})` };
    } catch {
      states['cpu-minimum-state'] = { enabled: null, manageable: false };
    }
  }
  if (isCapabilityAvailable('power:usb-selective-suspend', resolveRuntimeProfileForApp())) {
    try {
      const plans = await listPowerPlans();
      const plan = plans.items.find((item) => item.guid === plans.activeGuid);
      const state = await powerTweaks.readUsbSelectiveSuspend(plans.activeGuid);
      // The card turns suspend off, so "on" here means Dialed's change is in place.
      states['usb-selective-suspend'] = { enabled: state.ac === 0, manageable: true, detail: `${state.ac === 0 ? 'Off' : 'On'} when plugged in (${plan?.name || 'active plan'})` };
    } catch {
      states['usb-selective-suspend'] = { enabled: null, manageable: false };
    }
  }
  if (isCapabilityAvailable('graphics:windowed-game-optimizations', resolveRuntimeProfileForApp())) {
    try {
      const state = await windowedGames.readWindowedGameSetting();
      const unsupported = windowedGames.unsupportedReason(state);
      states['windowed-games'] = unsupported
        ? { enabled: null, manageable: false, unsupported }
        : { enabled: state.enabled, manageable: true, detail: state.enabled === null ? 'Windows default' : undefined };
    } catch {
      states['windowed-games'] = { enabled: null, manageable: false };
    }
  }
  if (isCapabilityAvailable('input:mouse-acceleration', resolveRuntimeProfileForApp())) {
    try {
      const state = await readMouseAcceleration();
      const plainText = Object.values(state.values).every((item) => !item.exists || (item.kind === 'String' && /^\d{1,3}$/.test(item.value || '')));
      states['mouse-acceleration'] = { enabled: state.enabled, manageable: plainText };
    } catch {
      states['mouse-acceleration'] = { enabled: null, manageable: false };
    }
  }
  return states;
});

ipcMain.handle('pc-opti:set-user-setting', async (_event, settingId, enabled) => {
  assertShortString(settingId, 'Setting', /^[a-z-]{3,40}$/);
  // One-way power changes: the card only adds or sets them; undo reverses them.
  if (settingId === 'ultimate-plan' || settingId === 'cpu-minimum-state') {
    if (enabled !== true) throw new Error('Use Undo to reverse this change.');
    assertCapabilityAvailable(settingId === 'ultimate-plan' ? 'power:ultimate-plan' : 'power:cpu-minimum-state');
    return serializeMutation(() => (settingId === 'ultimate-plan' ? addUltimatePlan(app.getPath('userData')) : setCpuMinimumState(app.getPath('userData'))));
  }
  if (settingId === 'usb-selective-suspend') {
    if (enabled !== true) throw new Error('Use Undo to reverse this change.');
    assertCapabilityAvailable('power:usb-selective-suspend');
    return serializeMutation(() => setUsbSelectiveSuspendOff(app.getPath('userData')));
  }
  if (settingId === 'windowed-games') {
    if (typeof enabled !== 'boolean') throw new Error('Choose on or off.');
    assertCapabilityAvailable('graphics:windowed-game-optimizations');
    return serializeMutation(() => setWindowedGameOptimizations(app.getPath('userData'), enabled));
  }
  if (settingId === 'mouse-acceleration') {
    if (typeof enabled !== 'boolean') throw new Error('Choose on or off.');
    assertCapabilityAvailable('input:mouse-acceleration');
    return serializeMutation(() => setMouseAcceleration(app.getPath('userData'), enabled));
  }
  if (!Object.prototype.hasOwnProperty.call(USER_SETTINGS, settingId)) throw new Error('This Windows setting is not one Dialed manages.');
  if (typeof enabled !== 'boolean') throw new Error('Choose on or off.');
  if (USER_SETTINGS[settingId].removeOnly && enabled) throw new Error('Turn this policy on from its own page, which creates a restore point first. Nothing was changed.');
  assertCapabilityAvailable(USER_SETTINGS[settingId].capabilityId);
  // Enabling a policy this edition ignores would record a change that does nothing.
  // Turning one off (removing the value) stays allowed, so leftovers can be cleaned up.
  if (enabled) await assertEditionSupports(USER_SETTINGS[settingId].editions);
  // A setting overridden by a policy would record a change that does nothing.
  const blocked = await blockingPolicyReason(settingId).catch(() => null);
  if (blocked) throw new Error(`${blocked} Nothing was changed.`);
  return serializeMutation(() => setUserSetting(app.getPath('userData'), settingId, enabled));
});

ipcMain.handle('pc-opti:list-gpu-preferences', async () => {
  assertCapabilityAvailable('graphics:per-app-gpu-preference');
  const items = await listGpuPreferences();
  latestGpuPreferenceTargets = new Map(items.map((item) => [item.id, item.exePath]));
  return items;
});

// The executable path comes only from this main-process dialog or the fresh Registry list.
ipcMain.handle('pc-opti:choose-gpu-preference-app', async () => {
  assertCapabilityAvailable('graphics:per-app-gpu-preference');
  const selection = await dialog.showOpenDialog(mainWindow, { title: 'Choose a game or app', properties: ['openFile'], filters: [{ name: 'Applications', extensions: ['exe'] }] });
  if (selection.canceled || !selection.filePaths[0]) return { canceled: true };
  const exePath = assertExecutablePath(selection.filePaths[0]);
  const state = await readGpuPreference(exePath);
  const item = { id: gpuPreferenceTargetId(exePath), exePath, kind: state.kind, data: state.data, preference: state.kind === 'String' ? parseGpuPreference(state.data) : null };
  latestGpuPreferenceTargets.set(item.id, exePath);
  return { canceled: false, item };
});

ipcMain.handle('pc-opti:set-gpu-preference', async (_event, targetId, preference) => {
  assertCapabilityAvailable('graphics:per-app-gpu-preference');
  assertShortString(targetId, 'Graphics preference target', /^[a-f0-9]{24}$/);
  if (![0, 1, 2].includes(preference)) throw new Error('Graphics preference is not valid.');
  const exePath = latestGpuPreferenceTargets.get(targetId);
  if (!exePath) throw new Error('Refresh the app list before changing a graphics preference.');
  return serializeMutation(() => setGpuPreference(app.getPath('userData'), exePath, preference));
});

ipcMain.handle('pc-opti:list-fullscreen-optimizations', async () => {
  assertCapabilityAvailable('graphics:fullscreen-optimizations');
  const items = await fullscreenOptimizations.listFullscreenOptimizations();
  latestFullscreenTargets = new Map(items.map((item) => [item.id, item.exePath]));
  return items;
});

// The executable path comes only from this main-process dialog or the fresh Registry list.
ipcMain.handle('pc-opti:choose-fullscreen-optimizations-app', async () => {
  assertCapabilityAvailable('graphics:fullscreen-optimizations');
  const selection = await dialog.showOpenDialog(mainWindow, { title: 'Choose a game', properties: ['openFile'], filters: [{ name: 'Applications', extensions: ['exe'] }] });
  if (selection.canceled || !selection.filePaths[0]) return { canceled: true };
  const item = await fullscreenOptimizations.readFullscreenOptimizations(selection.filePaths[0]);
  latestFullscreenTargets.set(item.id, item.exePath);
  return { canceled: false, item };
});

ipcMain.handle('pc-opti:set-fullscreen-optimizations', async (_event, targetId, disableOptimizations) => {
  assertCapabilityAvailable('graphics:fullscreen-optimizations');
  assertShortString(targetId, 'Program', /^[a-f0-9]{24}$/);
  if (typeof disableOptimizations !== 'boolean') throw new Error('Choose on or off.');
  const exePath = latestFullscreenTargets.get(targetId);
  if (!exePath) throw new Error('Choose the game again before changing this setting.');
  return serializeMutation(() => setFullscreenOptimizations(app.getPath('userData'), exePath, disableOptimizations));
});

ipcMain.handle('pc-opti:read-display-modes', async () => {
  assertCapabilityAvailable('diagnostic:display-modes');
  return readDisplayModes();
});

ipcMain.handle('pc-opti:read-wifi-status', async () => {
  assertCapabilityAvailable('diagnostic:wifi-link');
  return readWifiStatus();
});

ipcMain.handle('pc-opti:get-audit-history', async () => {
  assertCapabilityAvailable('history:view-local');
  return journalStateForRenderer(inspectJournalRecovery(app.getPath('userData')));
});

ipcMain.handle('pc-opti:retry-audit-verification', async () => {
  assertCapabilityAvailable('history:view-local');
  const userDataPath = app.getPath('userData');
  const current = inspectJournalRecovery(userDataPath);
  if (current.recovery?.kind !== 'INTERRUPTED') {
    throw new Error('Only interrupted actions can be re-verified. Refresh Local Audit History for the current recovery state.');
  }
  await serializeMutation(() => reconcilePendingEntries(userDataPath));
  return journalStateForRenderer(inspectJournalRecovery(userDataPath));
});

ipcMain.handle('pc-opti:recover-corrupt-audit-journal', async () => {
  assertCapabilityAvailable('history:recover-corrupt');
  auditExportPreviews.clear();
  journalDeletionPreviews.clear();
  return journalStateForRenderer(await serializeMutation(() => recoverCorruptJournal(app.getPath('userData'))));
});

ipcMain.handle('pc-opti:get-audit-export-preview', async () => {
  assertCapabilityAvailable('history:export-redacted');
  const preview = createAuditExportPreview(readJournal(app.getPath('userData')));
  auditExportPreviews.issue(preview);
  return {
    payload: preview.payload,
    omittedFields: preview.omittedFields,
  };
});

ipcMain.handle('pc-opti:export-audit-history', async () => {
  assertCapabilityAvailable('history:export-redacted');
  const preview = auditExportPreviews.takeLatest().preview;
  const currentPreview = createAuditExportPreview(readJournal(app.getPath('userData')), preview.payload.createdAt);
  if (currentPreview.sourceFingerprint !== preview.sourceFingerprint) {
    throw new Error('Local Audit History changed after preview. Refresh the export preview and try again.');
  }
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export redacted Local Audit History',
    defaultPath: path.join(app.getPath('documents'), `dialed-audit-redacted-${new Date().toISOString().slice(0, 10)}.json`),
    filters: [{ name: 'JSON document', extensions: ['json'] }],
    properties: ['createDirectory', 'showOverwriteConfirmation'],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  return { canceled: false, ...writeAuditExport(result.filePath, preview.payload) };
});

ipcMain.handle('pc-opti:get-audit-deletion-preview', async (_event, mode) => {
  assertCapabilityAvailable('history:delete-completed');
  assertShortString(mode, 'Audit deletion mode', /^(COMPLETED_30_DAYS|COMPLETED_90_DAYS|ALL_DELETABLE)$/);
  const preview = createJournalDeletionPreview(readJournal(app.getPath('userData')), mode);
  const pending = journalDeletionPreviews.issue(preview);
  return {
    token: pending.token,
    mode: preview.mode,
    cutoffTimestamp: preview.cutoffTimestamp,
    previewEntries: preview.previewEntries,
    deleteCount: preview.deleteCount,
    retainCount: preview.retainCount,
    protectedCounts: preview.protectedCounts,
  };
});

ipcMain.handle('pc-opti:delete-audit-history', async (_event, token) => {
  assertCapabilityAvailable('history:delete-completed');
  assertShortString(token, 'Audit deletion preview token', /^[0-9a-f-]{36}$/i);
  const preview = journalDeletionPreviews.take(token).preview;
  const result = await serializeMutation(() => applyJournalDeletion(app.getPath('userData'), preview));
  return { ...result, entries: journalForRenderer(result.entries) };
});

ipcMain.handle('pc-opti:list-benchmark-evidence', async () => {
  assertCapabilityAvailable('benchmark:import-compare');
  return currentBenchmarkEvidence();
});

ipcMain.handle('pc-opti:get-presentmon-info', async () => {
  assertCapabilityAvailable('benchmark:native-presentmon-capture');
  return presentMonCaptures().info();
});

ipcMain.handle('pc-opti:list-presentmon-targets', async () => {
  assertCapabilityAvailable('benchmark:native-presentmon-capture');
  return presentMonCaptures().targets();
});

ipcMain.handle('pc-opti:get-presentmon-capture-state', async () => {
  assertCapabilityAvailable('benchmark:native-presentmon-capture');
  return presentMonCaptures().state();
});

ipcMain.handle('pc-opti:preview-presentmon-capture', async (_event, targetId, durationSeconds, hardwareReadings) => {
  assertCapabilityAvailable('benchmark:native-presentmon-capture');
  assertShortString(targetId, 'PresentMon target id', /^[a-f0-9]{32}$/);
  const duration = Number(durationSeconds);
  if (![10, 20, 30].includes(duration)) throw new Error('PresentMon capture duration must be 10, 20, or 30 seconds.');
  const withHardwareReadings = hardwareReadings === true;
  if (withHardwareReadings) assertCapabilityAvailable('telemetry:windows-counters');
  const withVendorSensors = withHardwareReadings && isCapabilityAvailable('telemetry:nvidia-gpu-sensors', resolveRuntimeProfileForApp());
  const service = presentMonCaptures();
  const [tool, inventory] = await Promise.all([service.info(), service.targets()]);
  if (tool.status !== 'AVAILABLE') throw new Error(tool.reason || 'The pinned PresentMon tool is unavailable.');
  const target = inventory.items.find((item) => item.targetId === targetId);
  if (!target) throw new Error('The selected PresentMon target is no longer available. Refresh the target list.');
  const preview = {
    target,
    durationSeconds: duration,
    toolVersion: tool.version,
    hardwareReadings: withHardwareReadings,
    vendorSensors: withVendorSensors,
    consequence: `Writes one bounded local CSV and manifest after revalidating this exact process and the pinned Intel-signed PresentMon binary.${withHardwareReadings ? ` Also reads Windows CPU, memory and GPU counters once per second for the same window${withVendorSensors ? ', plus GPU temperature and power from the installed NVIDIA driver when present and signature-verified,' : ''} and saves them next to the capture.` : ''} It does not inject, simulate input, or change game or Windows settings.`,
  };
  const pending = presentMonCaptureConsentPreviews.issue(preview);
  return { ...preview, token: pending.token };
});

ipcMain.handle('pc-opti:start-presentmon-capture', async (_event, token) => {
  assertCapabilityAvailable('benchmark:native-presentmon-capture');
  assertShortString(token, 'PresentMon capture consent token', /^[0-9a-f-]{36}$/i);
  const pending = presentMonCaptureConsentPreviews.take(token);
  presentMonCaptureConsentPreviews.assertFresh(pending);
  return presentMonCaptures().start(pending.preview.target.targetId, pending.preview.durationSeconds, { hardwareReadings: pending.preview.hardwareReadings === true, vendorSensors: pending.preview.vendorSensors === true });
});

let activeLiveHardwareRead = null;
// One bounded six-sample read at a time; concurrent requests share the same result.
ipcMain.handle('pc-opti:read-live-hardware', async (_event, seconds) => {
  assertCapabilityAvailable('telemetry:windows-counters');
  // Only the fixed durations are accepted; anything else from the renderer is refused.
  if (seconds !== undefined && ![5, 15, 30].includes(seconds)) throw new Error('Choose a reading length of 5, 15 or 30 seconds.');
  const vendorSensors = isCapabilityAvailable('telemetry:nvidia-gpu-sensors', resolveRuntimeProfileForApp());
  if (!activeLiveHardwareRead) activeLiveHardwareRead = readLiveHardware({}, { vendorSensors, seconds: seconds ?? 5 }).finally(() => { activeLiveHardwareRead = null; });
  return activeLiveHardwareRead;
});

ipcMain.handle('pc-opti:stop-presentmon-capture', async () => {
  assertCapabilityAvailable('benchmark:native-presentmon-capture');
  return presentMonCaptures().stop();
});

ipcMain.handle('pc-opti:prepare-native-presentmon-import', async (_event, captureIds) => {
  assertCapabilityAvailable('benchmark:native-presentmon-capture');
  assertCapabilityAvailable('benchmark:import-compare');
  if (!Array.isArray(captureIds) || captureIds.length < 2 || captureIds.length > 20) throw new Error('Select 2 to 20 native PresentMon captures.');
  captureIds.forEach((captureId) => assertShortString(captureId, 'PresentMon capture id', /^[0-9a-f-]{36}$/i));
  const sources = presentMonCaptures().prepareSources(captureIds);
  const pending = presentMonImportDrafts.issue({ sources });
  return {
    canceled: false,
    token: pending.token,
    format: 'PRESENTMON',
    requiresMetadata: true,
    sources: sources.map((source) => ({
      sourceId: source.sourceId,
      fileName: source.fileName,
      capturedAt: source.capturedAt,
      metric: source.metric,
      metricColumn: source.metricColumn,
      unit: source.unit,
      unavailableFrameCount: source.unavailableFrameCount,
      toolVersion: source.toolVersion,
      applications: source.applications.map((application) => ({
        application: application.application,
        processIds: application.processIds,
        sampleCount: application.samples.length,
      })),
    })),
  };
});

ipcMain.handle('pc-opti:preview-presentmon-capture-deletion', async (_event, captureId) => {
  assertCapabilityAvailable('benchmark:native-presentmon-capture');
  assertShortString(captureId, 'PresentMon capture id', /^[0-9a-f-]{36}$/i);
  const preview = presentMonCaptures().previewDeletion(captureId);
  const pending = presentMonDeletionPreviews.issue(preview);
  return { token: pending.token, ...preview };
});

ipcMain.handle('pc-opti:delete-presentmon-capture', async (_event, token) => {
  assertCapabilityAvailable('benchmark:native-presentmon-capture');
  assertShortString(token, 'PresentMon capture deletion token', /^[0-9a-f-]{36}$/i);
  const pending = presentMonDeletionPreviews.take(token);
  return serializeMutation(() => {
    presentMonDeletionPreviews.assertFresh(pending);
    return presentMonCaptures().deleteCapture(pending.preview);
  });
});

ipcMain.handle('pc-opti:preview-benchmark-import', async () => {
  assertCapabilityAvailable('benchmark:import-compare');
  benchmarkImportPreviews.clear();
  presentMonImportDrafts.clear();
  const selection = await dialog.showOpenDialog(mainWindow, {
    title: 'Import benchmark evidence',
    defaultPath: app.getPath('documents'),
    filters: [
      { name: 'Benchmark evidence', extensions: ['json', 'csv'] },
      { name: 'JSON document', extensions: ['json'] },
      { name: 'CSV document', extensions: ['csv'] },
    ],
    properties: ['openFile', 'multiSelections'],
  });
  if (selection.canceled || selection.filePaths.length === 0) return { canceled: true };
  if (selection.filePaths.length > 2) throw new Error('Select one Dialed evidence file or exactly two PresentMon CSV captures.');
  const sources = selection.filePaths.map(parseBenchmarkSource);
  if (sources.every((source) => source.format === 'PRESENTMON')) {
    if (sources.length !== 2) throw new Error('Select exactly two PresentMon CSV captures: one baseline and one candidate.');
    const identifiedSources = sources.map((source) => ({ ...source, sourceId: crypto.randomUUID() }));
    const pending = presentMonImportDrafts.issue({ sources: identifiedSources });
    return {
      canceled: false,
      token: pending.token,
      format: 'PRESENTMON',
      requiresMetadata: true,
      sources: identifiedSources.map((source) => ({
        sourceId: source.sourceId,
        fileName: source.fileName,
        capturedAt: source.capturedAt,
        metric: source.metric,
        metricColumn: source.metricColumn,
        unit: source.unit,
        unavailableFrameCount: source.unavailableFrameCount,
        applications: source.applications.map((application) => ({
          application: application.application,
          processIds: application.processIds,
          sampleCount: application.samples.length,
        })),
      })),
    };
  }
  if (sources.length !== 1 || sources[0].format !== 'PC_OPTI') {
    throw new Error('Do not mix Dialed evidence files with raw PresentMon captures in one import.');
  }
  const imported = sources[0].records;
  const preview = createBenchmarkImportPreview(readBenchmarks(app.getPath('userData')), imported);
  const pending = benchmarkImportPreviews.issue(preview);
  return { canceled: false, token: pending.token, records: preview.preview };
});

ipcMain.handle('pc-opti:prepare-presentmon-import', async (_event, token, metadata) => {
  assertCapabilityAvailable('benchmark:import-compare');
  assertShortString(token, 'PresentMon import token', /^[0-9a-f-]{36}$/i);
  const draft = presentMonImportDrafts.peek(token);
  const records = createPresentMonRecords(draft.preview.sources, metadata);
  const preview = createBenchmarkImportPreview(readBenchmarks(app.getPath('userData')), records);
  presentMonImportDrafts.clear();
  const pending = benchmarkImportPreviews.issue(preview);
  return { canceled: false, token: pending.token, records: preview.preview };
});

ipcMain.handle('pc-opti:apply-benchmark-import', async (_event, token) => {
  assertCapabilityAvailable('benchmark:import-compare');
  assertShortString(token, 'Benchmark import preview token', /^[0-9a-f-]{36}$/i);
  const preview = benchmarkImportPreviews.take(token).preview;
  await serializeMutation(() => applyBenchmarkImport(app.getPath('userData'), preview));
  return currentBenchmarkEvidence();
});

ipcMain.handle('pc-opti:preview-benchmark-deletion', async (_event, experimentId) => {
  assertCapabilityAvailable('benchmark:delete-experiment');
  assertShortString(experimentId, 'Benchmark experiment id', /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
  const preview = createBenchmarkDeletionPreview(readBenchmarks(app.getPath('userData')), experimentId);
  const pending = benchmarkDeletionPreviews.issue(preview);
  return { token: pending.token, experimentId, deletedCount: preview.deletedCount, summary: preview.summary };
});

ipcMain.handle('pc-opti:delete-benchmark-experiment', async (_event, token) => {
  assertCapabilityAvailable('benchmark:delete-experiment');
  assertShortString(token, 'Benchmark deletion preview token', /^[0-9a-f-]{36}$/i);
  const preview = benchmarkDeletionPreviews.take(token).preview;
  const result = await serializeMutation(() => deleteBenchmarkExperiment(app.getPath('userData'), preview));
  return { ...result, ...currentBenchmarkEvidence() };
});

ipcMain.handle('pc-opti:rollback-audit-entry', async (_event, entryId) => {
  assertShortString(entryId, 'Audit entry id', /^[0-9a-f-]{36}$/i);
  const entry = readJournal(app.getPath('userData')).find((item) => item.id === entryId);
  if (!entry) throw new Error('The Local Audit History entry no longer exists. Refresh history before rollback.');
  assertCapabilityAvailable(entry.capabilityId);
  return serializeMutation(() => rollbackAuditEntry(app.getPath('userData'), entryId));
});

if (hasSingleInstanceLock) app.whenReady().then(async () => {
  // Before any window can read or write the change log.
  await prepareProtectedData();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
