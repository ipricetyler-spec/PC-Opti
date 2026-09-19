// Browser + real Input Devices service and payload-agnostic driver-lifecycle UI fixtures.
// Requires an existing Playwright installation and a loopback Vite server.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.DIALED_PLAYWRIGHT_PATH || 'playwright');
const input = require('../src/main/input-devices/index.cjs');
const { readBundledStatus } = require('../src/main/input-driver-lifecycle/bundled-status.cjs');
const { listCapabilities } = require('../src/main/capabilities/index.cjs');
const { listGameSettingsGuides } = require('../src/main/game-settings/index.cjs');
const { migrateSystemScanSnapshot } = require('../src/main/snapshot/index.cjs');

const out = path.resolve(process.env.DIALED_UI_OUTPUT || path.join(__dirname, '../output/playwright'));
const origin = process.env.DIALED_UI_URL || 'http://127.0.0.1:5178';
if (new URL(origin).hostname !== '127.0.0.1') throw new Error('Fixture test is restricted to loopback.');
const themes = ['midnight', 'ember', 'violet', 'forest', 'graphite', 'oled', 'aurora', 'carbon-gold'];
const clone = (value) => JSON.parse(JSON.stringify(value));

function device(id, parent, extra = {}) {
  return { id, parent, name: id, service: '', className: '', location: '', compatibleIds: [], hardwareIds: [], lowerFilters: [], problem: 0, present: true, interval: null, speed: -1, port: -1, inputKind: '', ...extra };
}

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dialed-input-ui-'));
  const pci = 'PCI\\VEN_1022&DEV_15B6&SUBSYS_00000000\\ROOT';
  const hub = 'USB\\ROOT_HUB30\\HUB';
  const physical = 'USB\\VID_1234&PID_5678\\FIXTURE';
  const keyboardPhysical = 'USB\\VID_2222&PID_3333\\KEYBOARD';
  const controllerPhysical = 'USB\\VID_054C&PID_0DF2\\CONTROLLER';
  const headsetPhysical = 'USB\\VID_9999&PID_0001\\HEADSET';
  let changeCount = 0, tierChangeCount = 0;
  let nativeSetupReady = false, nativeExpired = false, scanCount = 0, holdNextScan = false, releaseScan;
  let messageCase = 'DEFAULT', legacyWrites = true;
  const raw = {
    elevated: true,
    bootId: '2026-08-30T12:00:00.0000000Z',
    security: { memoryIntegrity: 'Disabled' },
    driver: {
      state: 'Running', hash: input.PATCHING_1K_SHA256, signature: 'ValidMicrosoft', mode: 'Patching',
      patchLocations: {
        servicesParameters: { keyExists: false, valueExists: false, kind: '', value: null },
        legacyControl: { keyExists: false, valueExists: false, kind: '', value: null },
      },
    },
    nodes: [
      device(pci, '', { name: 'AMD integrated USB controller' }),
      device(hub, pci, { name: 'USB Root Hub', service: 'USBHUB3', compatibleIds: ['USB\\CLASS_09'] }),
      device(physical, hub, { name: 'Fixture Pro Mouse', location: 'PCIROOT(0)#USBROOT(1)#USB(2)', lowerFilters: ['hidusbf'], speed: 1, port: 2, interval: { key: 'Driver', kind: 'DWord', value: 8, readable: true, ambiguous: false } }),
      device('HID\\VID_1234&PID_5678\\MOUSE', physical, { name: 'Fixture Pro Mouse', className: 'Mouse', service: 'mouhid', inputKind: 'MOUSE' }),
      device(keyboardPhysical, hub, { name: 'Fixture TKL Keyboard', location: 'PCIROOT(0)#USBROOT(1)#USB(3)', speed: 1, port: 3 }),
      device('HID\\VID_2222&PID_3333\\KEYBOARD', keyboardPhysical, { name: 'Fixture TKL Keyboard', className: 'Keyboard', service: 'kbdhid', inputKind: 'KEYBOARD' }),
      device(controllerPhysical, hub, { name: 'Fixture High-Speed Controller', location: 'PCIROOT(0)#USBROOT(1)#USB(4)', lowerFilters: ['hidusbf'], speed: 2, port: 4, interval: { key: 'Driver', kind: 'DWord', value: 1, readable: true, ambiguous: false } }),
      device('HID\\VID_054C&PID_0DF2\\GAMEPAD', controllerPhysical, { name: 'Fixture High-Speed Controller', className: 'HIDClass', service: 'hidusb', inputKind: 'GAMEPAD' }),
      device(headsetPhysical, hub, { name: 'Fixture Composite Headset', location: 'PCIROOT(0)#USBROOT(1)#USB(6)', lowerFilters: ['hidusbf'], speed: 2, port: 6, interval: { key: 'Driver', kind: 'DWord', value: 1, readable: true, ambiguous: false } }),
    ],
  };
  const scanSnapshot = migrateSystemScanSnapshot({
    schemaVersion: '1.0.0',
    timestamp: '2026-08-30T12:00:00.000Z',
    deviceHash: 'fixture-local-only-hash',
    metrics: {
      os: { caption: 'Windows 11 Fixture', version: '10.0', build: '26100', architecture: '64-bit' },
      cpu: { name: 'Fixture CPU', cores: 8, logicalProcessors: 16, maxClockSpeedMhz: 5000 },
      memory: { totalBytes: 32_000_000_000, freeBytes: 16_000_000_000, loadPercentage: 50 },
      storage: [{ driveLetter: 'C', label: 'Fixture', totalBytes: 1_000_000_000, freeBytes: 500_000_000, isSSD: true, trimEnabled: true }],
      startupItems: [],
      tempFiles: { totalSizeBytes: 1_024, pathCount: 2 },
    },
    metadata: { executionTimeMs: 247, elevated: false, errors: [] },
  });
  const networkEndpoint = { id: 'cloudflare-warmed-http-v2-quick', mode: 'quick', methodVersion: 'warmed-https-v2', title: 'Fixture quick check', url: 'https://speed.cloudflare.com', requests: 22, idleRequests: 9, loadedRequestsPerDirection: 5, maximumDownloadBytes: 4 * 1024 * 1024, maximumUploadBytes: 512 * 1024, maximumTotalBytes: 4.5 * 1024 * 1024, maximumDurationSeconds: 60, maximumParallelConnections: 6, privacy: 'Fixture privacy preview.' };
  const networkConsent = { token: '00000000-0000-4000-8000-000000000001', endpoint: networkEndpoint, mode: 'quick', privacy: networkEndpoint.privacy, consequence: 'Runs one bounded fixture connection test.', expiresAt: '2099-01-01T00:00:00.000Z' };
  const failedSample = (index) => ({ index, success: false, durationMs: null, error: 'Fixture endpoint refused the HTTPS request.' });
  const networkResult = {
    status: 'OFFLINE', endpoint: networkEndpoint, methodVersion: 'warmed-https-v2', mode: 'quick', quality: 'INSUFFICIENT', startedAt: '2026-08-30T12:00:00.000Z', completedAt: '2026-08-30T12:00:04.000Z',
    samples: [], idleSamples: [1,2,3,4,5,6,7,8,9].map(failedSample), loadedSamples: [1,2,3,4,5].map(failedSample), downloadLoadedSamples: [1,2,3,4,5].map(failedSample), uploadLoadedSamples: [1,2,3,4,5].map(failedSample),
    download: { success: false, durationMs: null, error: 'Fixture download was unavailable.' },
    upload: { success: false, durationMs: null, error: 'Fixture upload was unavailable.' },
    metrics: { latencyMs:null,jitterMs:null,idleLatencyMs:null,idleJitterMs:null,idleP10Ms:null,idleP90Ms:null,idleVariabilityMs:null,loadedLatencyMs:null,loadedJitterMs:null,loadedLatencyIncreaseMs:null,downloadLoadedLatencyMs:null,downloadLoadedP90Ms:null,downloadLoadedLatencyIncreaseMs:null,uploadLoadedLatencyMs:null,uploadLoadedP90Ms:null,uploadLoadedLatencyIncreaseMs:null,downloadMbps:null,uploadMbps:null,requestFailurePercent:100,successfulSamples:0,failedSamples:9,expectedSamples:9 },
    loadQuality: { download: { status:'INSUFFICIENT',overlappingSuccessfulSamples:0,requiredOverlappingSamples:3,transferDurationMs:null,minimumTransferDurationMs:750 }, upload: { status:'INSUFFICIENT',overlappingSuccessfulSamples:0,requiredOverlappingSamples:3,transferDurationMs:null,minimumTransferDurationMs:750 } },
    runConditions: { mode:'quick',methodVersion:'warmed-https-v2',downloadBytes:0,uploadBytes:0,maximumTotalBytes:networkEndpoint.maximumTotalBytes,maximumParallelConnections:6 },
    limitations: 'Fixture result only.', persistence: { saved: true }, history: { status: 'READY', entries: [] },
  };
  const lifecyclePackage = {
    packageId: 'dialed-input-driver-fixture', version: '1.0.0', publisher: 'Dialed Fixture Publisher', attribution: 'Fixture-only authorized package contract.',
    supportedPollingHz: [125, 250, 500, 1000, 2000, 4000, 8000], maximumPollingHz: 8000,
  };
  const lifecycleCapabilities = (overrides = {}) => ({ install: false, repair: false, upgrade: false, detach: false, removePackage: false, adopt: false, ...overrides });
  const lifecycleOperationId = 'fixture_driver_operation_000001';
  let lifecycleMode = 'UNAVAILABLE';
  let cancelNextLifecycleElevation = false;
  let lifecyclePreview = null;
  let lifecycleLastOutcome = null;
  const lifecycleStatus = () => {
    if (lifecycleMode === 'UNAVAILABLE') return { status: 'UNAVAILABLE', installEnabled: false, capabilities: lifecycleCapabilities(), package: null, ownership: 'NONE', managedDeviceCount: 0, operationId: null, lastOutcome: null, reasons: [{ code: 'REDISTRIBUTION_PERMISSION_REQUIRED', message: 'Fixture permission gate.' }] };
    if (lifecycleMode === 'READY') return { status: 'READY_FOR_PREFLIGHT', installEnabled: true, capabilities: lifecycleCapabilities({ install: true }), package: lifecyclePackage, ownership: 'NONE', managedDeviceCount: 0, operationId: null, lastOutcome: lifecycleLastOutcome, reasons: [] };
    if (lifecycleMode === 'EXTERNAL') return { status: 'EXTERNAL_PACKAGE_PRESENT', installEnabled: false, capabilities: lifecycleCapabilities({ adopt: true }), package: lifecyclePackage, ownership: 'NONE', managedDeviceCount: 0, operationId: null, lastOutcome: lifecycleLastOutcome, reasons: [{ code: 'EXPLICIT_ADOPTION_REQUIRED', message: 'Explicit adoption is required for this matching external package.' }] };
    if (lifecycleMode === 'RESTART') return { status: 'RESTART_REQUIRED', installEnabled: false, capabilities: lifecycleCapabilities(), package: lifecyclePackage, ownership: 'DIALED', managedDeviceCount: 1, operationId: lifecycleOperationId, lastOutcome: lifecycleLastOutcome, reasons: [{ code: 'RECONCILIATION_REQUIRED', message: 'Restart, then reconcile this saved operation.' }] };
    if (lifecycleMode === 'NEEDS_REVIEW') return { status: 'NEEDS_REVIEW', installEnabled: false, capabilities: lifecycleCapabilities(), package: lifecyclePackage, ownership: 'DIALED', managedDeviceCount: 1, operationId: lifecycleOperationId, lastOutcome: lifecycleLastOutcome, reasons: [{ code: 'EXACT_STATE_DRIFT', message: 'Saved driver state requires exact review before another change.' }] };
    if (lifecycleMode === 'DETACHED') return { status: 'FILTER_DETACHED', installEnabled: true, capabilities: lifecycleCapabilities({ install: true, repair: true, removePackage: true }), package: lifecyclePackage, ownership: 'DIALED', managedDeviceCount: 0, operationId: lifecycleOperationId, lastOutcome: lifecycleLastOutcome, reasons: [] };
    if (lifecycleMode === 'ADOPTED') return { status: 'ACTIVE', installEnabled: true, capabilities: lifecycleCapabilities({ detach: true }), package: lifecyclePackage, ownership: 'ADOPTED', managedDeviceCount: 1, operationId: lifecycleOperationId, lastOutcome: lifecycleLastOutcome, reasons: [] };
    if (lifecycleMode === 'UPGRADE') return { status: 'ACTIVE', installEnabled: true, capabilities: lifecycleCapabilities({ upgrade: true, repair: true, detach: true }), package: lifecyclePackage, ownership: 'DIALED', managedDeviceCount: 2, operationId: lifecycleOperationId, lastOutcome: lifecycleLastOutcome, reasons: [] };
    return { status: 'ACTIVE', installEnabled: true, capabilities: lifecycleCapabilities({ repair: true, detach: true }), package: lifecyclePackage, ownership: 'DIALED', managedDeviceCount: 1, operationId: lifecycleOperationId, lastOutcome: lifecycleLastOutcome, reasons: [] };
  };
  const native = async (mode, payload) => {
    if (mode === 'Scan') return clone(raw);
    if (mode === 'Test') {
      if (['IDLE_CONTROLS', 'ACTIVE_CONTROLS', 'PARTIAL_CONTROLS', 'UNSUPPORTED_CONTROLS', 'UNMONITORED_CONTROLS'].includes(messageCase)) return { activityVersion: 1, channels: [{ kind: 'GAMEPAD', timesMs: Array.from({ length: 32040 }, (_, i) => i * 1000 / 4005), activity: { decoded: messageCase === 'UNSUPPORTED_CONTROLS' ? 0 : 32040, unsupported: messageCase === 'UNSUPPORTED_CONTROLS' ? 32040 : 0, errors: messageCase === 'PARTIAL_CONTROLS' ? 1 : 0, unmonitoredControls: messageCase === 'UNMONITORED_CONTROLS' ? 2 : 0, buttons: messageCase === 'ACTIVE_CONTROLS' ? 4 : 0, keys: 0, movement: 0, axes: messageCase === 'ACTIVE_CONTROLS' ? 6 : 0, hats: messageCase === 'ACTIVE_CONTROLS' ? 2 : 0 } }] };
      if (messageCase === 'NO_MESSAGES') return { channels: [] };
      if (messageCase === '4005_MESSAGES') return { channels: [{ kind: 'GAMEPAD', timesMs: Array.from({ length: 32040 }, (_, i) => i * 1000 / 4005) }] };
      const kind = payload.id === keyboardPhysical ? 'KEYBOARD' : payload.id === controllerPhysical ? 'GAMEPAD' : 'MOUSE';
      const samples = payload.id === controllerPhysical ? 64_000 : 50;
      const gap = payload.id === controllerPhysical ? 0.125 : 2;
      return { channels: [{ kind, timesMs: Array.from({ length: samples }, (_, index) => index * gap) }] };
    }
    if (mode === 'Change') {
      const target = raw.nodes.find((item) => item.id === payload.id);
      assert.equal(target.interval.value, payload.before);
      target.interval.value = payload.after;
      changeCount += 1;
      if (changeCount === 2) throw new Error('fixture interrupted after write');
      return { status: 'CONFIGURED' };
    }
    if (mode === 'TierChange') {
      assert.deepEqual(raw.driver.patchLocations.servicesParameters, payload.beforeCanonical);
      assert.deepEqual(raw.driver.patchLocations.legacyControl, payload.legacyPatch);
      raw.driver.patchLocations.servicesParameters = clone(payload.afterCanonical);
      raw.driver.patchUsbXhci = payload.afterCanonical.valueExists ? payload.afterCanonical.value : 1;
      raw.driver.patchSource = payload.afterCanonical.valueExists ? 'Registry override' : 'Driver default';
      tierChangeCount += 1;
      return { status: 'CONFIGURED', rebootRequired: true };
    }
    throw new Error('Unknown input fixture operation.');
  };
  let nativeHistory = false;
  const service = input.createInputService(path.join(root, 'user-data'), { native, allowLegacyNewWrites: () => legacyWrites, legacyRestoreAuthority: () => ({ allowed: !nativeHistory, message: nativeHistory ? 'Native setup has reserved machine history. Legacy restore is blocked; saved values are retained.' : '' }) });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 960, height: 700 } });
    await context.exposeBinding('__inputFixture', async (_source, method, ...args) => {
      if (method === 'scan') {
        scanCount++; const next = await service.scan();
        if (holdNextScan) { holdNextScan = false; await new Promise(resolve => { releaseScan = resolve; }); releaseScan = null; }
        return next;
      }
      if (method === 'nativeSetupReady') { nativeSetupReady = true; return true; }
      if (method === 'nativeExpired') { nativeExpired = true; return true; }
      if (method === 'messageCase') { messageCase = args[0]; return true; }
      if (method === 'legacyWrites') { legacyWrites = args[0]; return true; }
      if (method === 'nativeHistory') { nativeHistory = args[0]; return true; }
      if (method === 'legacyNeedsReview') { const store = input.readStore(path.join(root, 'user-data')); const record = store.history.find(item => item.purpose === 'TIER_ISOLATION'); if (!record) throw new Error('Missing fixture recovery'); record.status = 'NEEDS_REVIEW'; input.writeStore(path.join(root, 'user-data'), store); return true; }
      if (method === 'nativeRate') { raw.nodes.find(item => item.id === controllerPhysical).interval.value = args[0]; return true; }
      if (method === 'scanStats') return { count: scanCount, held: Boolean(releaseScan) };
      if (method === 'holdScan') { holdNextScan = true; return true; }
      if (method === 'releaseScan') { releaseScan(); return true; }
      if (method === 'label') return service.labelPort(args[0], args[1]);
      if (method === 'preview') return service.preview(args[0], args[1], args[2]);
      if (method === 'previewIsolation') return service.previewIsolation(args[0]);
      if (method === 'apply') return service.apply(args[0]);
      if (method === 'previewTier') return service.previewTier(args[0], args[1]);
      if (method === 'applyTier') return service.applyTier(args[0]);
      if (method === 'test') return service.test(args[0]);
      if (method === 'cancel') return service.cancelTest();
      if (method === 'reconcile') return service.reconcile(args[0]);
      if (method === 'reconcileTier') return service.reconcileTier(args[0]);
      if (method === 'lifecycleStatus') { assert.match(args[0], /^[a-f0-9]{64}$/); return clone(lifecycleStatus()); }
      if (method === 'bundleStatus') return readBundledStatus(path.resolve(__dirname, '../vendor/hidusbf'), nativeExpired ? { nativeBroker: {available:false,code:'NATIVE_RELEASE_REJECTED',message:'Fixture policy expired.'} } : nativeSetupReady ? { nativeBroker: {available:true,code:'FIXTURE_READY',message:'Closed fixture setup is available.'} } : {});
      if (method === 'lifecycleMode') { lifecycleMode = args[0]; cancelNextLifecycleElevation = Boolean(args[1]); lifecyclePreview = null; lifecycleLastOutcome = null; return clone(lifecycleStatus()); }
      if (method === 'lifecyclePreview') {
        const [action, deviceDigest, requestedHz] = args;
        if (deviceDigest !== null) assert.match(deviceDigest, /^[a-f0-9]{64}$/);
        if (['INSTALL', 'ATTACH', 'ADOPT'].includes(action)) assert.ok(lifecyclePackage.supportedPollingHz.includes(requestedHz));
        lifecyclePreview = {
          action, token: 'fixture_driver_preview_token_000001', expiresAt: '2026-08-30T14:00:00.000Z', operationId: null,
          requestedHz: requestedHz ?? null, requiresElevation: action !== 'ADOPT', requiresRestart: action !== 'ADOPT', package: lifecyclePackage,
          summary: action === 'ADOPT' ? ['Record the exact existing package as externally installed.', 'Manage only the selected attached device.', 'Never repair, upgrade, or remove the external package automatically.'] : [`Review ${action.toLowerCase()} against the immutable fixture package.`, 'Limit the change to the saved Dialed scope.', 'Verify exact state before reporting completion.'],
        };
        return clone(lifecyclePreview);
      }
      if (method === 'lifecycleApply') {
        assert.equal(args[0], lifecyclePreview?.token);
        const action = lifecyclePreview.action;
        if (cancelNextLifecycleElevation && lifecyclePreview.requiresElevation) {
          cancelNextLifecycleElevation = false;
          lifecycleLastOutcome = { action, outcome: 'CANCELLED', recordedAt: '2026-08-30T13:30:00.000Z' };
          return { status: 'NOT_APPLIED', action, operationId: lifecycleOperationId, canceled: true, restartRequired: false, managedDeviceCount: 0, package: lifecyclePackage, summary: 'Administrator approval was canceled before Windows changed driver state. Nothing was applied.' };
        }
        if (action === 'ADOPT') lifecycleMode = 'ADOPTED';
        else if (action === 'DETACH') lifecycleMode = 'DETACHED';
        else if (action === 'REMOVE_PACKAGE') lifecycleMode = 'READY';
        else if (action === 'INSTALL' || action === 'ATTACH') lifecycleMode = 'RESTART';
        else lifecycleMode = 'ACTIVE';
        lifecycleLastOutcome = { action, outcome: 'APPLIED', recordedAt: '2026-08-30T13:31:00.000Z' };
        const restartRequired = lifecycleMode === 'RESTART';
        return { status: lifecycleStatus().status, action, operationId: lifecycleOperationId, canceled: false, restartRequired, managedDeviceCount: lifecycleStatus().managedDeviceCount, package: lifecyclePackage, summary: restartRequired ? 'The protected operation was read back. Restart Windows, then reconcile this operation.' : 'The protected operation was read back exactly.' };
      }
      if (method === 'lifecycleReconcile') { assert.equal(args[0], lifecycleOperationId); lifecycleMode = 'ACTIVE'; return clone(lifecycleStatus()); }
      if (method === 'reboot') { raw.bootId = '2026-08-30T13:00:00.0000000Z'; return true; }
      if (method === 'move') { raw.nodes.find((item) => item.id === physical).location = 'PCIROOT(0)#USBROOT(1)#USB(5)'; raw.nodes.find((item) => item.id === physical).port = 5; return true; }
      throw new Error('Unknown input fixture binding.');
    });
    const releaseStatus = await require('../src/main/release-status/index.cjs').readReleaseStatus({ version: '2.8.0', isPackaged: false, executablePath: 'browser-fixture' });
    await context.addInitScript(({ capabilities, guides, snapshot, endpoint, probeResult, probeConsent, releaseStatus }) => {
      const rows = async () => ({ items: [], errors: [] });
      const call = (method, ...args) => window.__inputFixture(method, ...args);
      window.pcOptiNative = {
        getRuntimeProfile: async () => ({ profile: 'public', capabilities }), listCapabilities: async () => capabilities,
        scanSystem: async () => snapshot,
        getReleaseStatus: async () => releaseStatus,
        getLocalRecommendations: async () => [], getAuditHistory: async () => ({ entries: [], recovery: null }),
        getDriftReport: async () => ({ baseline: null, currentSnapshotTimestamp: snapshot.timestamp, changes: [] }),
        listInstalledApplications: async () => ({ scannedAt: new Date().toISOString(), items: [], errors: [], limitations: 'Fixture inventory only.' }),
        listStartupItems: rows, listManageableProcesses: rows, listSafePolicies: rows, listTimingExperiments: rows,
        listGameSettingsGuides: async () => guides, listGameProfiles: async () => [],
        listGameConfigBackups: async () => [], discoverInstalledGames: async () => ({ scannedAt: new Date().toISOString(), games: [], limitations: 'Fixture only.' }),
        getNetworkProbeInfo: async () => [endpoint],
        listNetworkQualityHistory: async () => ({ status: 'READY', entries: [] }),
        previewNetworkQualityProbe: async (mode) => { if (mode !== 'quick') throw new Error('Fixture supports quick only.'); return probeConsent; },
        runNetworkQualityProbe: async (token) => {
          if (token !== probeConsent.token) throw new Error('Fixture network consent token changed.');
          return probeResult;
        },
        getNetworkProbeProgress: async () => ({ phase:'COMPLETE',completedSteps:6,totalSteps:6,message:'Fixture complete.',bytesTransferred:0,maximumTotalBytes:endpoint.maximumTotalBytes }),
        cancelNetworkQualityProbe: async () => ({ canceled: true }),
        getPresentMonInfo: async () => ({ status: 'UNAVAILABLE', version: '2.5.1', sha256: 'fixture', signerSubject: 'fixture', sourceUrl: 'https://github.com/GameTechDev/PresentMon/releases/tag/v2.5.1', license: 'MIT', executableName: 'PresentMon.exe', reason: 'Browser fixture does not launch native tools.' }),
        listPresentMonTargets: async () => ({ scannedAt: new Date().toISOString(), items: [], limitations: 'Browser fixture targets.' }),
        getPresentMonCaptureState: async () => ({ active: null, entries: [], maximumEntries: 100 }),
        startPresentMonCapture: async () => { throw new Error('Browser fixture does not launch native tools.'); },
        stopPresentMonCapture: async () => ({ stopped: false }),
        prepareNativePresentMonImport: async () => ({ canceled: true }),
        scanInputDevices: () => call('scan'), labelInputPort: (id, label) => call('label', id, label),
        getInputDriverLifecycleStatus: (deviceDigest) => call('lifecycleStatus', deviceDigest),
        getBundledInputStatus: () => call('bundleStatus'),
        openBundledInputSetup: async () => { window.__fixtureSetupLaunches = (window.__fixtureSetupLaunches || 0) + 1; return {status:'OPENED',changed:false}; },
        onBundledInputSetupClosed: listener => { window.__closeNativeSetup = listener; return () => { delete window.__closeNativeSetup; }; },
        previewInputDriverInstall: (deviceDigest, requestedHz) => call('lifecyclePreview', 'INSTALL', deviceDigest, requestedHz),
        previewInputDriverAdoption: (deviceDigest, requestedHz) => call('lifecyclePreview', 'ADOPT', deviceDigest, requestedHz),
        previewInputDriverRepair: (deviceDigest) => call('lifecyclePreview', 'REPAIR', deviceDigest, null),
        previewInputDriverUpgrade: () => call('lifecyclePreview', 'UPGRADE', null, null),
        previewInputDriverDetach: (deviceDigest) => call('lifecyclePreview', 'DETACH', deviceDigest, null),
        previewInputDriverPackageRemoval: () => call('lifecyclePreview', 'REMOVE_PACKAGE', null, null),
        applyInputDriverLifecycle: (token) => call('lifecycleApply', token),
        reconcileInputDriverLifecycle: (operationId) => call('lifecycleReconcile', operationId),
        previewInputPolling: (id, rate, historyId) => call('preview', id, rate, historyId),
        previewInputIsolation: (id) => call('previewIsolation', id),
        applyInputPolling: (token) => call('apply', token), testInputDevice: (id) => call('test', id),
        previewInputTier: (id, historyId) => call('previewTier', id, historyId), applyInputTier: (token) => call('applyTier', token),
        cancelInputTest: () => call('cancel'), reconcileInputChange: (id) => call('reconcile', id),
        reconcileInputTier: (id) => call('reconcileTier', id),
        openExternalLink: async () => ({ opened: true }),
      };
    }, { capabilities: listCapabilities('public'), guides: listGameSettingsGuides(), snapshot: scanSnapshot, endpoint: networkEndpoint, probeResult: networkResult, probeConsent: networkConsent, releaseStatus });

    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.technicalDetails), 'hidden');
    await page.getByText(/Latest verified scan completed/).waitFor();
    await page.getByRole('button', { name: 'Open Scan' }).first().click();
    await page.getByText('Verified scan completed successfully', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Scan again' }).count(), 1);
    await page.screenshot({ path: path.join(out, 'scan-completion-midnight-960.png'), fullPage: true });

    await page.locator('aside nav button').filter({ hasText: /^Settings/ }).click();
    const technicalToggle = page.getByRole('checkbox', { name: 'Technical details', exact: true });
    assert.equal(await technicalToggle.isChecked(), false);
    await technicalToggle.check();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.technicalDetails), 'shown');

    await page.locator('aside nav button').filter({ hasText: /^Network/ }).click();
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Start quick check' }).click();
    await page.getByText('Connection test completed, but the endpoint was unreachable', { exact: true }).waitFor();
    await page.getByText('What failed', { exact: true }).waitFor();
    await page.getByText(/Fixture endpoint refused the HTTPS request/).first().waitFor();
    await page.screenshot({ path: path.join(out, 'connection-offline-midnight-960.png'), fullPage: true });

    await page.locator('aside nav button').filter({ hasText: /^Input Devices/ }).click();
    const section = page.getByRole('region', { name: 'Input devices' });
    await section.getByRole('button', { name: 'Scan input devices' }).click();
    const deviceList = section.getByLabel('Connected input devices');
    await deviceList.getByRole('button', { name: /Fixture Pro Mouse/ }).waitFor();
    assert.equal(await section.getByText('AURA LED Controller', { exact: true }).count(), 0);
    await deviceList.getByRole('button', { name: /Fixture Pro Mouse/ }).click();

    await section.getByRole('tab', { name: /USB connection/ }).click();
    await section.getByText('Optional: name this physical port', { exact: true }).click();
    await section.getByLabel('Give this physical port a useful name').fill('Rear port beside Ethernet');
    await section.getByRole('button', { name: 'Save label' }).click();
    await page.waitForFunction(() => document.querySelector('[aria-label="Connected input devices"]')?.textContent?.includes('Rear port beside Ethernet'));
    assert.match(await section.innerText(), /Rear port beside Ethernet/);
    await section.getByRole('button', { name: 'Use this as the starting port' }).click();
    await page.evaluate(() => window.__inputFixture('move'));
    await section.getByRole('button', { name: 'Refresh devices' }).click();
    await section.getByText(/Different connection detected/).waitFor();

    const inputTools = section.getByRole('tablist', { name: 'Input device tools' });
    const connectionTool = inputTools.getByRole('tab', { name: /USB connection/ });
    const pollingTool = inputTools.getByRole('tab', { name: /Polling rate/ });
    assert.match(await pollingTool.innerText(), /Polling rate/);
    await pollingTool.click();
    assert.equal(await pollingTool.getAttribute('aria-selected'), 'true');
    const maintenance = section.getByText(/^Existing-driver tools and maintenance/);
    assert.equal(await maintenance.evaluate(el => el.parentElement.open), false, 'Normal path keeps maintenance secondary.');
    await maintenance.click();
    await section.getByLabel('Choose a new polling-rate request').selectOption('1000');
    await section.getByRole('button', { name: 'Review rate change' }).click();
    await section.getByRole('button', { name: 'Cancel' }).click();
    await section.getByRole('button', { name: 'Review rate change' }).click();
    await section.getByRole('button', { name: 'Save previous setting & apply' }).click();
    await section.getByText(/Polling override saved and read back/).waitFor();
    await section.getByRole('button', { name: 'Review restore' }).click();
    await section.getByRole('button', { name: 'Confirm restore' }).click();
    await section.getByRole('alert').filter({ hasText: /needs review/ }).waitFor();
    await section.getByRole('button', { name: 'Recheck saved change' }).click();
    await section.getByText(/Saved device state reconciled/).waitFor();
    assert.equal(await section.getByRole('button', { name: 'Recheck saved change' }).count(), 0);

    await section.getByText('SELECTED', { exact: true }).waitFor();
    await section.getByRole('button', { name: 'Run 8-second input check' }).click();
    await section.getByText(/Not enough sustained Windows messages|No supported saved request|Not enough continuous movement/).waitFor();
    await section.getByText('500 Windows messages/s', { exact: true }).waitFor();
    const keyboardDevice = deviceList.getByRole('button', { name: /Fixture TKL Keyboard/ });
    await keyboardDevice.click();
    await page.waitForTimeout(100);
    assert.deepEqual(errors, [], 'Selecting the keyboard must not cause a renderer error.');
    const selectedKeyboard = deviceList.locator('button').filter({ hasText: 'Fixture TKL Keyboard' });
    assert.equal(await selectedKeyboard.count(), 1, 'Keyboard must remain in the connected-device list after selection.');
    assert.equal(await selectedKeyboard.getAttribute('aria-pressed'), 'true', 'Keyboard selection must become active before its delivery guidance is checked.');
    await section.getByRole('heading', { name: 'Input activity & message rate' }).waitFor();
    await section.getByText(/press different keys continuously|physical product is a keyboard, type continuously/).waitFor();
    await section.getByRole('button', { name: 'Run 8-second input check' }).click();
    await section.getByText(/Keyboard traffic reflects key changes/).waitFor();
    await section.getByText(/Keyboard channel 1/).waitFor();
    await deviceList.getByRole('button', { name: /Fixture High-Speed Controller/ }).click();
    await connectionTool.click();
    await section.getByText('Connection details & confidence', { exact: true }).click();
    await section.getByText('Technical identity: VID 054C · PID 0DF2', { exact: true }).waitFor();
    await pollingTool.click();
    await section.getByText('Current request', { exact: true }).waitFor();
    assert.equal(await section.getByLabel('Choose a new polling-rate request').evaluate((element) => getComputedStyle(element).colorScheme), 'dark');
    await section.getByText(/existing interval requests 8000 Hz, but the presumed current xHCI patch tier supports requests only up to 1000 Hz/).waitFor();
    assert.equal(await section.getByLabel('Choose a new polling-rate request').inputValue(), '');
    assert.equal(await section.getByRole('button', { name: 'Review rate change' }).isDisabled(), true);
    await section.getByText('Fixture Composite Headset', { exact: true }).waitFor();
    await section.getByRole('button', { name: 'Review 1 kHz isolation' }).click();
    await section.getByRole('button', { name: 'Save prior setting & isolate' }).click();
    await section.getByText(/1 kHz safety interval was saved and read back/).waitFor();
    await section.getByRole('button', { name: 'Review guarded 8 kHz setup' }).click();
    await section.getByRole('button', { name: 'Save state & configure tier' }).click();
    await section.getByText(/4–8 kHz tier was configured and read back/).waitFor();
    await page.evaluate(() => window.__inputFixture('reboot'));
    await section.getByRole('button', { name: 'Refresh devices' }).click();
    await section.getByRole('button', { name: 'Check after restart' }).click();
    await section.getByText(/Driver setup is ready for the selected device/).waitFor();
    assert.equal(await section.getByLabel('Choose a new polling-rate request').inputValue(), '8000');
    await section.getByRole('button', { name: 'Run 8-second input check' }).click();
    await section.getByText(/About 8000 Windows messages\/s for the 8000 Hz saved request/).waitFor();
    await section.getByText(/Control activity was not measured by this capture/).waitFor();
    await page.evaluate(() => { document.documentElement.dataset.technicalDetails = 'hidden'; });
    assert.equal(await section.getByLabel('Polling evidence ladder').isVisible(), false);
    assert.ok(await section.getByText(/HIDUSBF filter present/).count() > 0);
    assert.equal(await section.getByText(/HIDUSBF filter present/).first().isVisible(), false);
    assert.equal(await section.getByText(/GLOBAL TO FILTERED HIGH-SPEED DEVICES/).isVisible(), false);
    assert.equal(await section.getByText(/About 8000 Windows messages\/s for the 8000 Hz saved request/).isVisible(), true);
    await section.getByText('Signed-package maintenance is currently unavailable.', { exact: true }).waitFor();
    await section.getByRole('heading', { name: 'Existing compatible high polling-rate driver' }).waitFor();
    assert.equal(await section.getByRole('link', { name: 'Open official HIDUSBF project' }).count(), 0, 'Unavailable normal mode must not direct users into a separate installation route.');
    await section.screenshot({ path: path.join(out, 'input-devices-simple-midnight-960.png') });
    // Real service, timestamp-only fixture: a 4 kHz stream has no evidence of
    // physical movement, so the renderer must not turn it into a green pass.
    await page.evaluate(() => window.__inputFixture('nativeRate', 2));
    await section.getByRole('button', { name: 'Refresh devices' }).click();
    await page.evaluate(() => window.__inputFixture('messageCase', '4005_MESSAGES'));
    await section.getByRole('button', { name: 'Run 8-second input check' }).click();
    const messagePanel = section.getByLabel('Windows message check', { exact: true });
    const resultPanel = section.getByLabel('Input test results', { exact: true });
    await resultPanel.getByText(/About 4005 Windows messages\/s for the 4000 Hz saved request/).waitFor();
    await resultPanel.getByRole('status').getByText(/Control activity was not measured by this capture/).waitFor();
    assert.doesNotMatch(await resultPanel.getByRole('status').last().getAttribute('class'), /emerald|green/);
    assert.doesNotMatch(await resultPanel.getByRole('status').last().innerText(), /passed|verified|activity detected/i);
    await messagePanel.getByText(/See control activity separately from messages sent while idle/).waitFor();
    for (const width of [960, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await messagePanel.screenshot({ path: path.join(out, `input-messages-4005-${width}.png`) });
    }
    await page.evaluate(() => window.__inputFixture('messageCase', 'NO_MESSAGES'));
    await section.getByRole('button', { name: 'Run 8-second input check' }).click();
    await resultPanel.getByRole('status').getByText(/No Windows messages were received from this device/).waitFor();
    assert.doesNotMatch(await resultPanel.innerText(), /4005|No input detected/i);
    await messagePanel.screenshot({ path: path.join(out, 'input-messages-none-1280.png') });
    for (const [fixture, expected] of [['IDLE_CONTROLS', /No significant control changes detected/], ['ACTIVE_CONTROLS', /Control activity detected on the selected device/], ['PARTIAL_CONTROLS', /Control activity is inconclusive/], ['UNSUPPORTED_CONTROLS', /Control activity is inconclusive/], ['UNMONITORED_CONTROLS', /Some declared controls are not monitored/]]) {
      await page.evaluate((value) => window.__inputFixture('messageCase', value), fixture);
      await section.getByRole('button', { name: 'Run 8-second input check' }).click();
      await resultPanel.getByLabel('Control activity result').getByText(expected).waitFor();
      assert.equal(await resultPanel.getByLabel('Control activity result').isVisible(), true);
      await resultPanel.getByText(/About 4005 Windows messages\/s/).waitFor();
      for (const width of [960, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await messagePanel.screenshot({ path: path.join(out, `input-controls-${fixture}-${width}.png`) });
      }
    }
    await page.evaluate(() => window.__inputFixture('messageCase', 'DEFAULT'));
    await page.evaluate(() => window.__inputFixture('nativeRate', 1));
    await section.getByRole('button', { name: 'Refresh devices' }).click();
    await page.setViewportSize({ width: 960, height: 700 });
    await connectionTool.click();
    await section.getByText('No additional USB hubs detected', { exact: true }).waitFor();
    assert.equal(await section.getByText('Controller attachment', { exact: true }).isVisible(), false);
    assert.equal(await section.getByText('Additional hubs', { exact: true }).isVisible(), false);
    await section.screenshot({ path: path.join(out, 'input-devices-connection-simple-midnight-960.png') });
    await pollingTool.click();
    await page.evaluate(() => window.__inputFixture('lifecycleMode', 'UNAVAILABLE', false));
    const bundlePanel = section.getByRole('region', { name: 'Bundled HIDUSBF setup' });
    await bundlePanel.getByText('Driver setup and compatibility details', { exact: true }).click();
    await bundlePanel.getByText(/unchanged upstream files verified/).waitFor();
    assert.equal(await bundlePanel.getByRole('button', { name: 'Change rate…' }).isDisabled(), true, 'Unsigned/unconfigured source must not launch the native setup broker.');
    for (const rate of ['1 kHz', '2 kHz', '4 kHz', '8 kHz']) await bundlePanel.getByText(rate, { exact: true }).waitFor();
    await deviceList.getByRole('button', { name: /Fixture TKL Keyboard/ }).click();
    await section.getByText('Signed-package maintenance is currently unavailable.', { exact: true }).waitFor();
    await section.getByRole('heading', { name: 'Existing compatible driver — only for already filtered devices' }).waitFor();
    assert.equal(await section.getByText('Fixture permission gate.', { exact: true }).isVisible(), false, 'Unavailable gate evidence must stay hidden in simple mode.');

    await page.evaluate(() => window.__inputFixture('lifecycleMode', 'READY', false));
    await section.getByRole('button', { name: 'Refresh devices' }).click();
    await section.getByRole('button', { name: 'Review driver setup' }).waitFor();
    assert.equal(await section.getByLabel('Choose a standalone driver polling request').inputValue(), '1000');
    await section.getByRole('button', { name: 'Review driver setup' }).click();
    const driverConfirmation = section.getByRole('region', { name: 'Install the reviewed driver for this device' });
    await driverConfirmation.waitFor();
    assert.equal(await driverConfirmation.evaluate((element) => document.activeElement === element), true, 'Focus must move to the consequential standalone confirmation.');
    await section.getByText(/Affected scope: Fixture TKL Keyboard only · 1000 Hz request/).waitFor();
    await page.keyboard.press('Tab');
    assert.equal(await section.getByRole('button', { name: 'Approve in Windows & apply' }).evaluate((element) => document.activeElement === element), true);
    await page.keyboard.press('Tab');
    assert.equal(await section.getByRole('button', { name: 'Cancel' }).evaluate((element) => document.activeElement === element), true);
    await page.keyboard.press('Enter');
    assert.equal(await driverConfirmation.count(), 0, 'Keyboard cancellation must close the standalone confirmation.');
    await section.getByRole('button', { name: 'Review driver setup' }).click();
    await deviceList.getByRole('button', { name: /Fixture Pro Mouse/ }).click();
    assert.equal(await section.getByRole('region', { name: 'Install the reviewed driver for this device' }).count(), 0, 'Changing the selected device must invalidate the prior driver confirmation.');
    await deviceList.getByRole('button', { name: /Fixture TKL Keyboard/ }).click();

    await page.evaluate(() => window.__inputFixture('lifecycleMode', 'UPGRADE', false));
    await section.getByRole('button', { name: 'Refresh devices' }).click();
    await section.getByRole('button', { name: 'Review driver upgrade' }).click();
    const upgradeConfirmation = section.getByRole('region', { name: 'Upgrade the Dialed-installed driver' });
    await upgradeConfirmation.getByText(/Affected scope: all currently Dialed-managed device scopes/).waitFor();
    assert.equal(await upgradeConfirmation.getByText(/including Fixture TKL Keyboard/).count(), 0, 'A global package upgrade must not claim the unrelated current selection is managed.');
    await upgradeConfirmation.getByRole('button', { name: 'Cancel' }).click();

    await page.evaluate(() => window.__inputFixture('lifecycleMode', 'READY', true));
    await section.getByRole('button', { name: 'Refresh devices' }).click();
    await section.getByRole('button', { name: 'Review driver setup' }).click();
    await section.getByRole('button', { name: 'Approve in Windows & apply' }).click();
    const canceledOutcome = section.getByText('Nothing was applied.', { exact: true });
    await canceledOutcome.waitFor();
    await section.getByRole('button', { name: 'Refresh devices' }).click();
    await canceledOutcome.waitFor();
    await section.getByText('The last administrator request was canceled before Windows changed driver state. Nothing changed; review it again when ready.', { exact: true }).waitFor();
    await section.getByRole('button', { name: 'Review driver setup' }).waitFor();

    await section.getByRole('button', { name: 'Review driver setup' }).click();
    await section.getByRole('button', { name: 'Approve in Windows & apply' }).click();
    await section.getByText('The driver operation was read back; Windows requires a restart.', { exact: true }).waitFor();
    await section.getByRole('button', { name: 'Check after restart' }).waitFor();
    assert.equal(await section.getByRole('button', { name: 'Review driver setup' }).count(), 0, 'Restart state must suppress further mutations.');
    await section.getByRole('button', { name: 'Check after restart' }).click();
    await section.getByText('The reviewed driver scope is active.', { exact: true }).waitFor();
    await section.getByRole('button', { name: 'Review driver repair' }).waitFor();
    await section.getByRole('button', { name: 'Review exact driver detach' }).click();
    await section.getByRole('button', { name: 'Approve in Windows & apply' }).click();
    await section.getByText('The reviewed driver package is installed with no managed attachments.', { exact: true }).waitFor();
    await section.getByRole('button', { name: 'Review driver package removal' }).waitFor();
    await section.getByRole('button', { name: 'Review driver package removal' }).click();
    await section.getByRole('region', { name: 'Remove the detached driver package' }).getByRole('button', { name: 'Cancel' }).click();

    await page.evaluate(() => window.__inputFixture('lifecycleMode', 'EXTERNAL', false));
    await section.getByRole('button', { name: 'Refresh devices' }).click();
    await section.getByRole('button', { name: 'Review existing driver adoption' }).click();
    await section.getByText(/Never repair, upgrade, or remove the external package automatically/).waitFor();
    await section.getByRole('button', { name: 'Confirm exact adoption' }).click();
    await section.getByText('The reviewed driver scope is active.', { exact: true }).waitFor();
    assert.equal(await section.getByRole('button', { name: 'Review driver repair' }).count(), 0, 'Adopted packages must not expose repair.');
    assert.equal(await section.getByRole('button', { name: 'Review driver upgrade' }).count(), 0, 'Adopted packages must not expose upgrade.');
    assert.equal(await section.getByRole('button', { name: 'Review driver package removal' }).count(), 0, 'Adopted packages must not expose removal.');

    await page.evaluate(() => window.__inputFixture('lifecycleMode', 'NEEDS_REVIEW', false));
    await section.getByRole('button', { name: 'Refresh devices' }).click();
    const lifecyclePanel = section.locator('[data-input-driver-lifecycle]');
    await lifecyclePanel.getByRole('button', { name: 'Recheck saved driver operation' }).waitFor();
    assert.equal(await lifecyclePanel.getByRole('button', { name: /Review (driver|device|existing)/ }).count(), 0, 'Needs-review state must suppress lifecycle mutations.');
    await lifecyclePanel.getByRole('button', { name: 'Recheck saved driver operation' }).click();
    await section.getByText('The reviewed driver scope is active.', { exact: true }).waitFor();

    await deviceList.getByRole('button', { name: /Fixture High-Speed Controller/ }).click();
    await connectionTool.click();
    await page.evaluate(() => window.__inputFixture('nativeSetupReady'));
    await pollingTool.click();
    const primarySetup = section.getByRole('region', { name: 'Bundled HIDUSBF setup' });
    await primarySetup.getByRole('button', { name: 'Change rate…' }).waitFor();
    await section.getByRole('button', { name: 'Run 8-second input check' }).click();
    await section.getByLabel('Input test results').waitFor();
    const scansBeforeClose = await page.evaluate(async () => (await window.__inputFixture('scanStats')).count);
    await primarySetup.getByRole('button', { name: 'Change rate…' }).click();
    assert.equal(await section.getByLabel('Input test results').count(), 0, 'Opening setup invalidates previous measurement.');
    assert.equal(await section.getByRole('button', { name: 'Refresh devices' }).isDisabled(), true);
    assert.equal(await section.getByRole('button', { name: 'Run 8-second input check' }).isDisabled(), true);
    assert.equal(await deviceList.getByRole('button', { name: /Fixture Pro Mouse/ }).isDisabled(), true);
    await page.evaluate(async () => { await window.__inputFixture('nativeRate', 4); window.__closeNativeSetup(); });
    await primarySetup.getByText('1000 Hz', { exact: true }).waitFor();
    await section.getByText(/Saved settings refreshed after setup/).waitFor();
    assert.equal(await page.evaluate(async () => (await window.__inputFixture('scanStats')).count), scansBeforeClose + 1);
    assert.equal(await primarySetup.getByRole('button', { name: 'Change rate…' }).isEnabled(), true);
    assert.equal(await section.getByLabel('Input test results').count(), 0);
    assert.doesNotMatch(await primarySetup.innerText(), /Device reconnect verified|This change is complete/);

    await page.evaluate(() => window.__inputFixture('holdScan'));
    await section.getByRole('button', { name: 'Refresh devices' }).click();
    await page.waitForFunction(async () => (await window.__inputFixture('scanStats')).held);
    await page.evaluate(async () => { await window.__inputFixture('nativeRate', 2); window.__closeNativeSetup(); await window.__inputFixture('releaseScan'); });
    await primarySetup.getByText('4000 Hz', { exact: true }).waitFor();
    await section.getByRole('button', { name: 'Refresh devices' }).waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(async () => (await window.__inputFixture('scanStats')).count), scansBeforeClose + 3, 'An old in-flight scan is followed by a fresh read.');
    assert.equal(await page.evaluate(() => window.__fixtureSetupLaunches), 1);

    await page.evaluate(() => { document.documentElement.dataset.technicalDetails = 'shown'; });
    await section.getByText('Signed package evidence', { exact: true }).click();
    await section.getByText(/Dialed Fixture Publisher/).waitFor();
    const layouts = [];
    const themeFingerprints = new Map();
    for (const theme of themes) for (const width of [960, 1280]) {
      await page.evaluate((nextTheme) => { document.documentElement.dataset.theme = nextTheme; }, theme);
      await page.setViewportSize({ width, height: 700 });
      const layout = await section.evaluate((element) => ({ width: element.clientWidth, scroll: element.scrollWidth, pageWidth: document.documentElement.clientWidth, pageScroll: document.documentElement.scrollWidth }));
      assert.ok(layout.scroll <= layout.width && layout.pageScroll <= layout.pageWidth, `${theme} overflow at ${width}`);
      if (width === 960) {
        const fingerprint = await page.evaluate(() => {
          const shell = document.querySelector('.app-shell');
          const sidebar = document.querySelector('.app-sidebar');
          const header = document.querySelector('.app-header');
          if (!shell || !sidebar || !header) throw new Error('Theme surfaces are missing.');
          return [getComputedStyle(shell).backgroundImage, getComputedStyle(sidebar).backgroundImage, getComputedStyle(header).backgroundColor].join('|');
        });
        themeFingerprints.set(theme, fingerprint);
      }
      layouts.push({ theme, width, overflow: false });
    }
    assert.equal(new Set(themeFingerprints.values()).size, themes.length, 'All eight themes must have visibly distinct computed surface fingerprints.');
    await page.setViewportSize({ width: 960, height: 700 });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'carbon-gold'; });
    await section.screenshot({ path: path.join(out, 'input-devices-carbon-gold-960.png') });
    await maintenance.click();
    await page.evaluate(() => { document.documentElement.dataset.technicalDetails = 'hidden'; document.documentElement.dataset.theme = 'midnight'; });
    await page.setViewportSize({width:1280,height:900});
    await section.screenshot({path:path.join(out,'input-devices-normal-1280.png')});
    assert.equal(await section.getByRole('button',{name:'Review rate change'}).count(),0);
    await maintenance.click();
    await section.getByRole('button', { name: 'Review exact restore' }).click();
    await section.getByRole('region', { name: 'Confirm polling change' }).waitFor();
    assert.equal(await maintenance.evaluate(el => el.parentElement.open),true,'Recovery opens the section containing its confirmation.');
    await section.getByRole('button', { name: 'Cancel', exact:true }).click();
    await page.evaluate(() => window.__inputFixture('legacyWrites', false));
    await section.getByRole('button', { name: 'Refresh devices' }).click();
    await section.getByText(/Legacy controls are reserved for their own recorded recovery/).waitFor();
    assert.equal(await section.getByRole('button', { name: 'Review rate change', exact: true }).count(), 0);
    assert.equal(await section.getByRole('button', { name: 'Review guarded 8 kHz setup' }).count(), 0);
    assert.equal(await section.getByRole('button', { name: 'Review 1 kHz isolation' }).count(), 0);
    await section.getByRole('button', { name: 'Review exact restore' }).click();
    await section.getByRole('region', { name: 'Confirm polling change' }).waitFor();
    await section.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByLabel('Find a workspace').fill('bios');
    assert.equal(await page.locator('aside nav button').filter({ hasText: /^Optimize/ }).count(), 1);
    assert.equal(await page.locator('aside nav button').filter({ hasText: /^Games/ }).count(), 0);
    await page.getByRole('button', { name: 'Clear search' }).click();
    await page.evaluate(async () => { await window.__inputFixture('nativeHistory',true); await window.__inputFixture('legacyNeedsReview'); await window.__inputFixture('nativeExpired'); });
    await section.getByRole('button', { name: 'Refresh devices' }).click();
    await section.getByLabel('Legacy recovery needs review').waitFor();
    if (await maintenance.evaluate(el=>el.parentElement.open)) await maintenance.click();
    assert.equal(await section.getByLabel('Legacy recovery needs review').isVisible(),true);
    await section.getByLabel('Legacy recovery needs review').getByText(/Original interval/).waitFor();
    await section.getByRole('button',{name:'Show saved recovery'}).click();
    assert.equal(await section.getByRole('button',{name:'Review exact restore'}).isDisabled(),true);
    const polishLayouts = [];
    for (const workspace of ['Home', 'Verify', 'Settings', 'Games', 'Input Devices']) {
      await page.locator('aside nav button').filter({ hasText: new RegExp('^' + workspace) }).click();
      if (workspace === 'Home') {
        await page.getByRole('heading', { name: 'Your next safe step, without the wall of evidence' }).waitFor();
      }
      if (workspace === 'Verify') {
        await page.getByRole('tab', { name: 'Readiness' }).click();
        await page.evaluate(() => { document.documentElement.dataset.technicalDetails = 'shown'; });
        await page.getByRole('heading', { name: 'Available checks and evidence' }).waitFor();
      }
      if (workspace === 'Settings') {
        await page.getByRole('heading', { name: 'Goal, appearance, and release status' }).waitFor();
        await page.getByText('Development preview', { exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: /Create profile|Duplicate profile/ }).count(), 0);
      }
      if (workspace === 'Input Devices') {
        await section.getByRole('button', { name: 'Scan input devices' }).click();
        await section.getByRole('tab', { name: 'Polling rate' }).click();
        await section.getByRole('button', { name: 'Refresh devices' }).waitFor();
        await section.getByText(/No rate-change path is available/).waitFor();
        assert.equal(await section.getByRole('button',{name:'Change rate…'}).isDisabled(),true);
        assert.ok(Number(await section.getByRole('button',{name:'Change rate…'}).evaluate(el=>getComputedStyle(el).opacity)) < 0.6);
        assert.equal(await section.getByRole('button',{name:'Run 8-second input check'}).isEnabled(),true);
      }
      if (workspace === 'Games') {
        assert.equal(await page.getByLabel('Display and GPU setup guide').count(),0);
        await page.getByRole('tab',{name:'Display & GPU',exact:true}).click();
        await page.getByLabel('Display and GPU setup guide').waitFor();
      }
      for (const theme of themes) for (const width of [960, 1280]) {
        await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
        await page.setViewportSize({ width, height: 900 });
        assert.match(await page.locator('.app-header').innerText(), /Goal:/);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, `${workspace} overflow: ${theme} ${width}`);
        await page.screenshot({ path: path.join(out, `polish-${workspace.replace(/ /g, '-')}-${theme}-${width}.png`), fullPage: true });
        polishLayouts.push({ workspace, theme, width, overflow: false });
      }
    }
    assert.deepEqual(errors, []);
    const report = { status: 'PASS', scope: 'Browser plus real Input Devices service and payload-agnostic lifecycle states; no host mutation', lifecycleStates: ['UNAVAILABLE', 'READY_FOR_PREFLIGHT', 'NOT_APPLIED', 'RESTART_REQUIRED', 'ACTIVE', 'FILTER_DETACHED', 'EXTERNAL_PACKAGE_PRESENT', 'NEEDS_REVIEW'], layouts, distinctThemeFingerprints: themeFingerprints.size, errors, changeCount, tierChangeCount, setupExitRefresh:true, deferredRefresh:true, nativeLaunches:0, messageChecks: { legacyCaptureActivityUnknown: true, neutral4005MessagesAt4000Request: true, subsequentSilenceClearsRate: true, normalModeVisible: true, controlCases: ['idle','active','partial','unsupported','unmonitored'], physicalTests:false } };
    report.polishLayouts = polishLayouts; report.legacyRestoreOnly = true; report.biosWorkspaceCorrect = true;
    report.nativeHistoryRestoreBlocked = true; report.urgentRecoveryVisibleCollapsed = true; report.expiredPolicyReadOnlyChecksAvailable = true; report.displayGuideOwnTab = true;
    fs.writeFileSync(path.join(out, 'input-devices-ui-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
