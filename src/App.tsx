import type { ExperimentSession } from './lib/experimentSessions';
import { WorkspaceErrorBoundary } from './components/WorkspaceErrorBoundary';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadScanDetails, loadTweaks, loadGames, loadGpu, loadMeasure, loadSettings } from './workspaces';
import { AlertCircle, CheckCircle2, Database, RefreshCw, TimerReset } from 'lucide-react';
import { ActionPreviewDialog } from './components/ActionPreviewDialog';
import type { ActionPreviewRequest } from './components/ActionPreviewDialog';
import { ConfirmContext, toPreviewRequest, type ConfirmRequest } from './components/ConfirmContext';
import { useGameSession } from './lib/useGameSession';
import { BackgroundActivity } from './components/BackgroundActivity';
import { DriftMonitor } from './components/DriftMonitor';
import { LocalAuditHistory } from './components/LocalAuditHistory';
import { RecoveryStepsCard } from './components/RecoveryStepsCard';
import { Sidebar } from './components/Sidebar';
import type { AppTab } from './components/Sidebar';
import { ThemePicker } from './components/ThemePicker';
import { TechnicalDetailsSetting } from './components/TechnicalDetailsSetting';
import { TabRow, TabPanel } from './components/TabRow';
import { DEFAULT_APP_THEME, isAppThemeId, type AppThemeId } from './lib/themes';
import { describeRollbackTarget, rollbackDisclosureText } from './lib/rollbackDisclosure';
import { graphicsAdapters } from './lib/displaySetup';
import { TWEAKS, buildTweakCards, noLongerInEffect, type TweakCardState, type TweakDestination, batchActionFor } from './lib/tweaks';
import { TweaksOverview, usePowerPlanName, type BatchResult, type UserSettingState } from './components/TweaksOverview';
import type { TestPrefill, TestableTweak } from './components/TestAChange';
import { HomeSummary } from './components/HomeSummary';
import { ShowDetails } from './components/ShowDetails';
import type { AuditDeletionMode, AuditHistoryNotice, AuditHistoryRecovery, AuditJournalEntry, BenchmarkEvidenceState, CacheCleanupInventory, BenchmarkImportPreview, DriftReport, GameConfigBackup, GameSettingsGuide, InstalledApplicationInventory, InstalledGameDiscovery, LocalRecommendation, ManageableProcess, MaintenanceAction, PresentMonImportMetadata, PresentMonImportSourceSummary, ReleaseStatus, RuntimeProfileState, SafeOsPolicy, StartupManagementItem, SystemScanSnapshot, TimingExperiment } from './types';

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let amount = bytes;
  let index = -1;
  do {
    amount /= 1024;
    index += 1;
  } while (amount >= 1024 && index < units.length - 1);
  return `${amount.toFixed(amount >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatPreviewDetails(value: unknown) {
  return JSON.stringify(value, null, 2) ?? 'No structured preview details were returned.';
}

const APP_THEME_STORAGE_KEY = 'pcopti-theme:v1';
const GOLD_DEFAULT_MIGRATION_KEY = 'pcopti-theme-gold-default:v1';
const TECHNICAL_DETAILS_STORAGE_KEY = 'dialed-technical-details:v1';

async function readRuntimeProfile() {
  if (!window.pcOptiNative) return null;
  return window.pcOptiNative.getRuntimeProfile();
}

const CACHE_CLEANUP_COPY = {
  'clear-shader-caches': {
    title: 'Clear graphics shader caches',
    description: 'Deletes saved shader files from DirectX, NVIDIA and AMD that are over a day old. Worth doing after a driver update. Games rebuild them, so the next launch of each game may stutter briefly.',
  },
  'clear-crash-dumps': {
    title: 'Clear old app crash dumps',
    description: 'Deletes crash reports older than a week. Once deleted, they cannot be sent to a developer.',
  },
} as const;

function queueFromSnapshot(snapshot: SystemScanSnapshot | null, capabilities: Set<string>, caches: CacheCleanupInventory | null = null): MaintenanceAction[] {
  if (!snapshot) return [];
  const queue: MaintenanceAction[] = [];
  if (capabilities.has('maintenance:clear-temp-files') && snapshot.metrics.tempFiles.pathCount > 0) {
    queue.push({
      id: 'clear-temp-files',
      kind: 'clear-temp-files',
      title: 'Clear temporary files',
      description: 'Deletes temporary files older than a week. Files in use are skipped.',
      evidence: `${formatBytes(snapshot.metrics.tempFiles.totalSizeBytes)} in ${snapshot.metrics.tempFiles.pathCount.toLocaleString()} files.`,
      reversible: false,
    });
  }
  if (capabilities.has('maintenance:retrim-drive') && snapshot.metrics.storage.status === 'AVAILABLE') snapshot.metrics.storage.value.filter((drive) => drive.isSSD && drive.trimEnabled).forEach((drive) => {
    queue.push({
      id: `retrim-drive:${drive.driveLetter}`,
      kind: 'retrim-drive',
      title: `Run TRIM on ${drive.driveLetter}:`,
      description: 'Asks Windows to tell this SSD which space is free. Windows does this on a schedule anyway; it is upkeep, not a speed boost.',
      evidence: `${drive.driveLetter}: is an SSD with TRIM on.`,
      reversible: false,
    });
  });
  (['clear-shader-caches', 'clear-crash-dumps'] as const).forEach((kind) => {
    const summary = caches?.items[kind];
    if (!capabilities.has(`maintenance:${kind}`) || !summary || summary.pathCount === 0) return;
    queue.push({
      id: kind,
      kind,
      ...CACHE_CLEANUP_COPY[kind],
      evidence: `${formatBytes(summary.totalSizeBytes)} across ${summary.pathCount.toLocaleString()} eligible files in a fresh cache check.`,
      reversible: false,
    });
  });
  return queue;
}

const BiosGuidanceCenter = lazy(() => import('./components/BiosGuidanceCenter').then((module) => ({ default: module.BiosGuidanceCenter })));
const BenchmarkEvidence = lazy(() => import('./components/BenchmarkEvidence').then((module) => ({ default: module.BenchmarkEvidence })));
const TestAChange = lazy(() => import('./components/TestAChange').then((module) => ({ default: module.TestAChange })));
const GameOptimizationCenter = lazy(() => import('./components/GameOptimizationCenter').then((module) => ({ default: module.GameOptimizationCenter })));
const InputDevicesCenter = lazy(() => import('./components/InputDevicesCenter').then((module) => ({ default: module.InputDevicesCenter })));
const NetworkQualityLab = lazy(() => import('./components/NetworkQualityLab').then((module) => ({ default: module.NetworkQualityLab })));
const PerformanceLab = lazy(() => import('./components/PerformanceLab').then((module) => ({ default: module.PerformanceLab })));
// Each section loads its own components the first time it opens; see src/workspaces.
const DashboardOverview = lazy(() => loadScanDetails().then((module) => ({ default: module.DashboardOverview })));
const SystemInsightCenters = lazy(() => loadScanDetails().then((module) => ({ default: module.SystemInsightCenters })));
// Boot-timing changes are recorded under a timing: action id, and undoing one writes boot settings too.
const isBootEntry = (entry: AuditJournalEntry) => entry.actionId.startsWith('timing:');
/** Today's scans show the time only; older ones show the date, so a stale scan never reads as fresh. */
function scanTimeLabel(timestamp: string, now = new Date()) {
  const at = new Date(timestamp);
  return at.toDateString() === now.toDateString()
    ? at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : at.toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}
const LAST_TWEAK_RUN_KEY = 'dialed-last-tweak-run';
function readLastTweakRun(): { results: BatchResult[]; entryIds: string[] } | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(LAST_TWEAK_RUN_KEY) || 'null');
    if (!parsed || !Array.isArray(parsed.entryIds) || !Array.isArray(parsed.results) || parsed.entryIds.length > 64 || parsed.results.length > 64) return null;
    const entryIds = parsed.entryIds.filter((id: unknown): id is string => typeof id === 'string' && id.length <= 128);
    const results = parsed.results.filter((item: unknown): item is BatchResult => Boolean(item) && typeof (item as BatchResult).title === 'string' && typeof (item as BatchResult).ok === 'boolean' && typeof (item as BatchResult).message === 'string');
    return entryIds.length ? { results, entryIds } : null;
  } catch { return null; }
}
function writeLastTweakRun(run: { results: BatchResult[]; entryIds: string[] } | null) {
  try { if (run) localStorage.setItem(LAST_TWEAK_RUN_KEY, JSON.stringify(run)); else localStorage.removeItem(LAST_TWEAK_RUN_KEY); } catch { /* per-user convenience only */ }
}
async function readBootNotice(): Promise<string | null> {
  try { return (await window.pcOptiNative?.readBootNotice?.()) ?? null; } catch { return null; }
}
const StartupCenter = lazy(() => loadTweaks().then((module) => ({ default: module.StartupCenter })));
const ProcessBalancer = lazy(() => loadTweaks().then((module) => ({ default: module.ProcessBalancer })));
const GameSessionMode = lazy(() => loadTweaks().then((module) => ({ default: module.GameSessionMode })));
const SafePolicies = lazy(() => loadTweaks().then((module) => ({ default: module.SafePolicies })));
const PowerPlanCard = lazy(() => loadTweaks().then((module) => ({ default: module.PowerPlanCard })));
const MaintenanceQueue = lazy(() => loadTweaks().then((module) => ({ default: module.MaintenanceQueue })));
const GameSettingsCenter = lazy(() => loadGames().then((module) => ({ default: module.GameSettingsCenter })));
const GameConfigCenter = lazy(() => loadGames().then((module) => ({ default: module.GameConfigCenter })));
const DisplaySetupGuide = lazy(() => loadGames().then((module) => ({ default: module.DisplaySetupGuide })));
const GpuPreferenceCenter = lazy(() => loadGpu().then((module) => ({ default: module.GpuPreferenceCenter })));
const FullscreenOptimizationsCenter = lazy(() => loadGpu().then((module) => ({ default: module.FullscreenOptimizationsCenter })));
const ExperimentSessions = lazy(() => loadMeasure().then((module) => ({ default: module.ExperimentSessions })));
const ReleaseStatusCard = lazy(() => loadSettings().then((module) => ({ default: module.ReleaseStatusCard })));
const LocalDataCenter = lazy(() => loadSettings().then((module) => ({ default: module.LocalDataCenter })));
const HardwareReadingsSetting = lazy(() => loadSettings().then((module) => ({ default: module.HardwareReadingsSetting })));

export default function App() {
  const [sessionContext, setSessionContext] = useState<ExperimentSession | null>(null);
  const [focusedAuditId, setFocusedAuditId] = useState<string | null>(null);
  const [focusedExperimentId, setFocusedExperimentId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>('readiness');
  const [optimizeView, setOptimizeView] = useState<'all' | 'startup' | 'background' | 'windows' | 'maintenance' | 'bios'>('all');
  // Boot timing and per-program graphics live at the end of All tweaks, folded until opened.
  // Each folded section loads its data only once opened: both read Windows state that the rest of All tweaks does not need.
  const [tweakToolsOpen, setTweakToolsOpen] = useState<{ 'boot-timing': boolean; 'per-program-graphics': boolean }>({ 'boot-timing': false, 'per-program-graphics': false });
  const openTweakTools = useCallback((section: 'boot-timing' | 'per-program-graphics') => {
    setOptimizeView('all'); setActiveTab('startup'); setTweakToolsOpen((current) => ({ ...current, [section]: true }));
    // After the section opens and lays out; a smooth scroll started earlier was cancelled by that layout.
    window.setTimeout(() => requestAnimationFrame(() => document.getElementById(section)?.scrollIntoView({ block: 'start' })), 120);
  }, []);
  const [gameView, setGameView] = useState<'profiles' | 'guides' | 'backups'>('profiles');
  // Display setup moved to Measure (2026-10-06): it is a way to test a display or graphics-card setting.
  const [displaySetupOpen, setDisplaySetupOpen] = useState(false);
  const [measureView, setMeasureView] = useState<'test' | 'results'>('test');
  const [savedTestsOpen, setSavedTestsOpen] = useState(false);
  const [testPrefill, setTestPrefill] = useState<TestPrefill | null>(null);
  const clearTestPrefill = useCallback(() => setTestPrefill(null), []);
  const [verifyView, setVerifyView] = useState<'drift' | 'history'>('history');
  const [appTheme, setAppTheme] = useState<AppThemeId>(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(APP_THEME_STORAGE_KEY);
      // Dialed saved the theme on every start, so a stored Console usually meant "never chosen", not
      // a choice. When black and gold became the default (2026-10-03), move that once; picking
      // Console again afterwards sticks.
      if (stored === 'console' && !window.localStorage.getItem(GOLD_DEFAULT_MIGRATION_KEY)) stored = 'console-gold';
      window.localStorage.setItem(GOLD_DEFAULT_MIGRATION_KEY, '1');
    } catch { /* storage unavailable: use the default */ }
    return isAppThemeId(stored) ? stored : DEFAULT_APP_THEME;
  });
  const [technicalDetails, setTechnicalDetails] = useState(() => window.localStorage.getItem(TECHNICAL_DETAILS_STORAGE_KEY) === 'shown');
  const [runtimeProfile, setRuntimeProfile] = useState<RuntimeProfileState>({ profile: 'public', capabilities: [] });
  const [snapshot, setSnapshot] = useState<SystemScanSnapshot | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [activeActionId, setActiveActionId] = useState<string | null>(null);
  const [maintenanceError, setMaintenanceError] = useState<string | null>(null);
  const [history, setHistory] = useState<AuditJournalEntry[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [isHistoryPrivacyBusy, setIsHistoryPrivacyBusy] = useState(false);
  const [historyPrivacyStatus, setHistoryPrivacyStatus] = useState<string | null>(null);
  const [historyActionError, setHistoryActionError] = useState<string | null>(null);
  const [historyRecovery, setHistoryRecovery] = useState<AuditHistoryRecovery | null>(null);
  const [historyNotices, setHistoryNotices] = useState<AuditHistoryNotice[]>([]);
  const [isHistoryRecoveryBusy, setIsHistoryRecoveryBusy] = useState(false);
  const [startupItems, setStartupItems] = useState<StartupManagementItem[]>([]);
  const [startupErrors, setStartupErrors] = useState<Array<{ component: string; message: string }>>([]);
  const [isStartupLoading, setIsStartupLoading] = useState(false);
  const [activeStartupItemId, setActiveStartupItemId] = useState<string | null>(null);
  const [startupActionError, setStartupActionError] = useState<string | null>(null);
  const [processes, setProcesses] = useState<ManageableProcess[]>([]);
  const [processErrors, setProcessErrors] = useState<Array<{ component: string; message: string }>>([]);
  const [isProcessLoading, setIsProcessLoading] = useState(false);
  const [activeProcessId, setActiveProcessId] = useState<number | null>(null);
  const [processActionError, setProcessActionError] = useState<string | null>(null);
  const [policies, setPolicies] = useState<SafeOsPolicy[]>([]);
  const [policyErrors, setPolicyErrors] = useState<Array<{ component: string; message: string }>>([]);
  const [isPolicyLoading, setIsPolicyLoading] = useState(false);
  const [activePolicyId, setActivePolicyId] = useState<string | null>(null);
  const [policyActionError, setPolicyActionError] = useState<string | null>(null);
  const [rollingBackId, setRollingBackId] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<LocalRecommendation[]>([]);
  const [recommendationError, setRecommendationError] = useState<string | null>(null);
  const [driftReport, setDriftReport] = useState<DriftReport | null>(null);
  const [driftError, setDriftError] = useState<string | null>(null);
  const [isDriftLoading, setIsDriftLoading] = useState(false);
  const [benchmarkEvidence, setBenchmarkEvidence] = useState<BenchmarkEvidenceState>({ records: [], comparisons: [] });
  const [isBenchmarkLoading, setIsBenchmarkLoading] = useState(false);
  const [benchmarkError, setBenchmarkError] = useState<string | null>(null);
  const [presentMonImport, setPresentMonImport] = useState<{ token: string; sources: PresentMonImportSourceSummary[] } | null>(null);
  const [timingExperiments, setTimingExperiments] = useState<TimingExperiment[]>([]);
  const [timingErrors, setTimingErrors] = useState<Array<{ component: string; message: string }>>([]);
  const [scanSuggestionsOpen, setScanSuggestionsOpen] = useState(false);
  // Only the Home link opens the suggestion list; any other arrival shows it collapsed as before.
  useEffect(() => { if (activeTab !== 'overview') setScanSuggestionsOpen(false); }, [activeTab]);
  const [isTimingLoading, setIsTimingLoading] = useState(false);
  const [activeTimingActionId, setActiveTimingActionId] = useState<TimingExperiment['actionId']>(null);
  const [timingStatus, setTimingStatus] = useState<string | null>(null);
  const [timingActionError, setTimingActionError] = useState<string | null>(null);
  const [gameSettingsGuides, setGameSettingsGuides] = useState<GameSettingsGuide[]>([]);
  const [isGameSettingsLoading, setIsGameSettingsLoading] = useState(false);
  const [gameSettingsError, setGameSettingsError] = useState<string | null>(null);
  const [installedGameDiscovery, setInstalledGameDiscovery] = useState<InstalledGameDiscovery | null>(null);
  const [gameConfigBackups, setGameConfigBackups] = useState<GameConfigBackup[]>([]);
  const [isGameConfigLoading, setIsGameConfigLoading] = useState(false);
  const [isGameConfigBusy, setIsGameConfigBusy] = useState(false);
  const [gameConfigError, setGameConfigError] = useState<string | null>(null);
  const [gameConfigStatus, setGameConfigStatus] = useState<string | null>(null);
  const [installedApplications, setInstalledApplications] = useState<InstalledApplicationInventory | null>(null);
  const [isInstalledAppsLoading, setIsInstalledAppsLoading] = useState(false);
  const [installedAppsError, setInstalledAppsError] = useState<string | null>(null);
  const [releaseStatus, setReleaseStatus] = useState<ReleaseStatus | null>(null);
  const [isReleaseStatusLoading, setIsReleaseStatusLoading] = useState(false);
  const [releaseStatusError, setReleaseStatusError] = useState<string | null>(null);
  const [actionPreview, setActionPreview] = useState<ActionPreviewRequest | null>(null);
  const actionPreviewResolver = useRef<((confirmed: boolean) => void) | null>(null);
  const [cacheInventory, setCacheInventory] = useState<CacheCleanupInventory | null>(null);
  const [isUndoAllBusy, setIsUndoAllBusy] = useState(false);

  const requestPreviewConfirmation = useCallback((request: ActionPreviewRequest) => new Promise<boolean>((resolve) => {
    actionPreviewResolver.current?.(false);
    actionPreviewResolver.current = resolve;
    setActionPreview(request);
  }), []);
  const finishPreviewConfirmation = useCallback((confirmed: boolean) => {
    const resolve = actionPreviewResolver.current;
    actionPreviewResolver.current = null;
    setActionPreview(null);
    resolve?.(confirmed);
  }, []);
  const cancelPreviewConfirmation = useCallback(() => finishPreviewConfirmation(false), [finishPreviewConfirmation]);
  const confirmPreviewAction = useCallback(() => finishPreviewConfirmation(true), [finishPreviewConfirmation]);
  const confirmAction = useCallback((request: ConfirmRequest) => requestPreviewConfirmation(toPreviewRequest(request)), [requestPreviewConfirmation]);

  useEffect(() => () => {
    actionPreviewResolver.current?.(false);
    actionPreviewResolver.current = null;
  }, []);

  const capabilityIds = useMemo(() => new Set(runtimeProfile.capabilities.map((capability) => capability.id)), [runtimeProfile]);
  const navigateToRecommendationPanel = useCallback((target: LocalRecommendation['targetPanel']) => {
    let groupedTarget: AppTab = target.id === 'game-settings' ? 'game-settings' : target.id === 'network-quality' ? 'network-quality' : target.id === 'performance-lab' ? 'startup' : target.id === 'benchmarks' ? 'performance-lab' : target.id === 'drift' || target.id === 'history' ? 'drift' : target.id === 'workload-profiles' || target.id === 'plan-composer' || target.id === 'clean-room-parity' ? 'workload-profiles' : target.id === 'overview' ? 'overview' : 'startup';
    if (target.id === 'balancer') setOptimizeView('background');
    if (target.id === 'maintenance') setOptimizeView('maintenance');
    if (target.id === 'startup') setOptimizeView('startup');
    if (target.id === 'performance-lab') { openTweakTools('boot-timing'); return; }
    if (target.id === 'benchmarks') { setFocusedExperimentId(target.evidenceId || null); setMeasureView('results'); }
    if (target.id === 'history') { setVerifyView('history'); setFocusedAuditId(target.evidenceId || null); }
    if (target.id === 'drift') setVerifyView('drift');
    setActiveTab(groupedTarget);
    const sectionId = target.sectionId;
    if (sectionId) {
      window.setTimeout(() => document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
    }
  }, [openTweakTools]);
  // Recommendations are shown in the order the scan produced them.
  const orderedRecommendations = recommendations;
  useEffect(() => {
    document.documentElement.dataset.theme = appTheme;
    window.localStorage.setItem(APP_THEME_STORAGE_KEY, appTheme);
  }, [appTheme]);
  useEffect(() => {
    document.documentElement.dataset.technicalDetails = technicalDetails ? 'shown' : 'hidden';
    window.localStorage.setItem(TECHNICAL_DETAILS_STORAGE_KEY, technicalDetails ? 'shown' : 'hidden');
  }, [technicalDetails]);

  const refreshRuntimeProfile = useCallback(async () => {
    if (!window.pcOptiNative) return;
    try {
      const latest = await readRuntimeProfile();
      if (latest) setRuntimeProfile(latest);
    } catch (error) {
      setScanError(error instanceof Error ? error.message : 'The runtime profile could not be verified.');
    }
  }, []);
  const availableTabs = useMemo<AppTab[]>(() => ['readiness', 'overview', 'startup', 'game-settings', 'network-quality', 'input-devices', 'performance-lab', 'drift', 'workload-profiles'], []);

  // Restore opens on the History tab; a link to another tab opens it only for that visit.
  useEffect(() => { if (activeTab !== 'drift' && verifyView !== 'history') setVerifyView('history'); }, [activeTab, verifyView]);

  const loadHistory = useCallback(async () => {
    if (!window.pcOptiNative) return;
    setIsHistoryLoading(true);
    try {
      const state = await window.pcOptiNative.getAuditHistory();
      setHistory(state.entries);
      setHistoryRecovery(state.recovery);
      setHistoryNotices(state.protection?.notices ?? []);
    } catch (error) {
      setHistoryActionError(error instanceof Error ? error.message : 'Could not load local audit history.');
    } finally {
      setIsHistoryLoading(false);
    }
  }, []);

  const retryAuditVerification = async () => {
    if (!window.pcOptiNative || isHistoryRecoveryBusy) return;
    setIsHistoryRecoveryBusy(true);
    setHistoryActionError(null);
    try {
      const state = await window.pcOptiNative.retryAuditVerification();
      setHistory(state.entries);
      setHistoryRecovery(state.recovery);
      setHistoryNotices(state.protection?.notices ?? []);
    } catch (error) {
      setHistoryActionError(error instanceof Error ? error.message : 'Interrupted actions could not be verified.');
    } finally {
      setIsHistoryRecoveryBusy(false);
    }
  };

  const recoverCorruptAuditJournal = async () => {
    if (!window.pcOptiNative || isHistoryRecoveryBusy) return;
    const confirmed = await confirmAction({
      title: 'Preserve the unreadable history and start fresh?',
      description: 'Dialed keeps an exact copy of the unreadable file, then starts an empty history.',
      details: 'The unreadable journal is copied into Dialed’s own data folder before a new, empty journal is created.',
      notice: 'No Windows setting is changed or undone.',
      confirmLabel: 'Preserve and start fresh',
    });
    if (!confirmed) return;
    setIsHistoryRecoveryBusy(true);
    setHistoryActionError(null);
    try {
      const state = await window.pcOptiNative.recoverCorruptAuditJournal();
      setHistory(state.entries);
      setHistoryRecovery(state.recovery);
      setHistoryNotices(state.protection?.notices ?? []);
      setHistoryPrivacyStatus(`Unreadable history was preserved as ${state.quarantine.fileName}. A verified empty journal is now active.`);
    } catch (error) {
      setHistoryActionError(error instanceof Error ? error.message : 'The unreadable local audit journal could not be preserved and reset.');
    } finally {
      setIsHistoryRecoveryBusy(false);
    }
  };

  const loadStartupItems = useCallback(async () => {
    if (!window.pcOptiNative) {
      setStartupErrors([{ component: 'Startup Center', message: 'Startup management is available only in the Dialed Electron desktop application.' }]);
      return;
    }
    setIsStartupLoading(true);
    try {
      const result = await window.pcOptiNative.listStartupItems();
      setStartupItems(result.items);
      setStartupErrors(result.errors);
    } catch (error) {
      setStartupErrors([{ component: 'Startup Center', message: error instanceof Error ? error.message : 'Could not read the Windows startup inventory.' }]);
    } finally {
      setIsStartupLoading(false);
    }
  }, []);

  const loadProcesses = useCallback(async () => {
    if (!window.pcOptiNative) {
      setProcessErrors([{ component: 'Background apps', message: 'Background-app scheduling controls are available only in the Dialed Electron desktop application.' }]);
      return;
    }
    setIsProcessLoading(true);
    try {
      const result = await window.pcOptiNative.listManageableProcesses();
      setProcesses(result.items);
      setProcessErrors(result.errors);
    } catch (error) {
      setProcessErrors([{ component: 'Background apps', message: error instanceof Error ? error.message : 'Could not read the current Windows process inventory.' }]);
    } finally {
      setIsProcessLoading(false);
    }
  }, []);

  const loadPolicies = useCallback(async () => {
    if (!window.pcOptiNative) {
      setPolicyErrors([{ component: 'Safe OS policies', message: 'Policy management is available only in the Dialed Electron desktop application.' }]);
      return;
    }
    setIsPolicyLoading(true);
    try {
      const result = await window.pcOptiNative.listSafePolicies();
      setPolicies(result.items);
      setPolicyErrors(result.errors);
    } catch (error) {
      setPolicyErrors([{ component: 'Safe OS policies', message: error instanceof Error ? error.message : 'Could not read the Windows policy state.' }]);
    } finally {
      setIsPolicyLoading(false);
    }
  }, []);

  const loadBenchmarkEvidence = useCallback(async () => {
    if (!window.pcOptiNative) {
      setBenchmarkError('Benchmark evidence is available only in the Dialed Electron desktop application.');
      return;
    }
    setIsBenchmarkLoading(true);
    setBenchmarkError(null);
    try {
      setBenchmarkEvidence(await window.pcOptiNative.listBenchmarkEvidence());
    } catch (error) {
      setBenchmarkError(error instanceof Error ? error.message : 'Could not load local benchmark evidence.');
    } finally {
      setIsBenchmarkLoading(false);
    }
  }, []);

  const loadTimingExperiments = useCallback(async () => {
    if (!window.pcOptiNative) {
      setTimingErrors([{ component: 'Windows timing', message: 'Boot timing evidence is available only in the Dialed Electron desktop application.' }]);
      return;
    }
    setIsTimingLoading(true);
    setTimingActionError(null);
    try {
      const result = await window.pcOptiNative.listTimingExperiments();
      setTimingExperiments(result.items);
      setTimingErrors(result.errors);
    } catch (error) {
      setTimingExperiments([]);
      setTimingErrors([{ component: 'Windows timing', message: error instanceof Error ? error.message : 'Could not read the current Windows boot timing state.' }]);
    } finally {
      setIsTimingLoading(false);
    }
  }, []);

  const loadGameSettingsGuides = useCallback(async () => {
    if (!window.pcOptiNative) {
      setGameSettingsError('Game settings guidance is available only in the Dialed Electron desktop application.');
      return;
    }
    setIsGameSettingsLoading(true);
    setGameSettingsError(null);
    try {
      setGameSettingsGuides(await window.pcOptiNative.listGameSettingsGuides());
    } catch (error) {
      setGameSettingsGuides([]);
      setGameSettingsError(error instanceof Error ? error.message : 'Could not load the reviewed game settings guides.');
    } finally {
      setIsGameSettingsLoading(false);
    }
  }, []);

  const loadGameConfigCenter = useCallback(async () => {
    if (!window.pcOptiNative) return;
    setIsGameConfigLoading(true);
    setGameConfigError(null);
    try {
      const [discovery, backups] = await Promise.all([
        window.pcOptiNative.discoverInstalledGames(),
        window.pcOptiNative.listGameConfigBackups(),
      ]);
      setInstalledGameDiscovery(discovery);
      setGameConfigBackups(backups);
    } catch (error) {
      setGameConfigError(error instanceof Error ? error.message : 'Installed-game discovery or local backup inventory could not be read.');
    } finally {
      setIsGameConfigLoading(false);
    }
  }, []);

  const loadInstalledApplications = useCallback(async () => {
    if (!window.pcOptiNative) return;
    setIsInstalledAppsLoading(true);
    setInstalledAppsError(null);
    try {
      setInstalledApplications(await window.pcOptiNative.listInstalledApplications());
    } catch (error) {
      setInstalledAppsError(error instanceof Error ? error.message : 'The installed application inventory could not be read.');
    } finally {
      setIsInstalledAppsLoading(false);
    }
  }, []);

  const loadReleaseStatus = useCallback(async () => {
    if (!window.pcOptiNative) return;
    setIsReleaseStatusLoading(true);
    setReleaseStatusError(null);
    try {
      setReleaseStatus(await window.pcOptiNative.getReleaseStatus());
    } catch (error) {
      setReleaseStatusError(error instanceof Error ? error.message : 'The installed build and signature status could not be read.');
    } finally {
      setIsReleaseStatusLoading(false);
    }
  }, []);

  const loadCacheInventory = useCallback(async () => {
    if (!window.pcOptiNative?.inspectMaintenanceCaches) return;
    try {
      setCacheInventory(await window.pcOptiNative.inspectMaintenanceCaches());
    } catch {
      setCacheInventory(null);
    }
  }, []);

  const createGameConfigBackup = async (gameId: string) => {
    if (!window.pcOptiNative || isGameConfigBusy) return;
    setIsGameConfigBusy(true);
    setGameConfigError(null);
    setGameConfigStatus(null);
    try {
      const result = await window.pcOptiNative.createGameConfigBackup(gameId);
      if (result.canceled || !result.backup) {
        setGameConfigStatus('Backup canceled. No source file or local backup was changed.');
        return;
      }
      setGameConfigBackups(await window.pcOptiNative.listGameConfigBackups());
      setGameConfigStatus(`Created an exact ${result.backup.files.length}-file backup with SHA-256 evidence. The selected source files were not changed.`);
    } catch (error) {
      setGameConfigError(error instanceof Error ? error.message : 'The selected game configuration files could not be backed up.');
    } finally {
      setIsGameConfigBusy(false);
    }
  };

  // Puts back only the keys a profile changed, keeping anything the game wrote since.
  const undoGameProfile = async (backupId: string) => {
    if (!window.pcOptiNative || isGameConfigBusy) return;
    setIsGameConfigBusy(true);
    setGameConfigError(null);
    setGameConfigStatus(null);
    try {
      const preview = await window.pcOptiNative.previewGameProfileUndo(backupId);
      const confirmed = await confirmAction({
        title: `Undo the ${preview.game} profile settings?`,
        description: `${preview.changes.length} setting${preview.changes.length === 1 ? '' : 's'} go back to what ${preview.changes.length === 1 ? 'it was' : 'they were'} before the profile. Everything else in the file stays as it is now, including changes made in the game.`,
        details: preview.changes.map((change) => `• ${change.key}: ${change.before} → ${change.after}`).join('\n'),
        warning: preview.protectionNotice ?? null, notice: `Close the game and its launcher first. Dialed rechecks the file before writing and verifies it afterwards.`,
        confirmLabel: 'Undo settings',
      });
      if (!confirmed) {
        setGameConfigStatus('Undo canceled. No game settings file was changed.');
        return;
      }
      const result = await window.pcOptiNative.applyGameProfileUndo(preview.token);
      setGameConfigBackups(await window.pcOptiNative.listGameConfigBackups());
      setGameConfigStatus(`Put back ${result.changedCount} setting${result.changedCount === 1 ? '' : 's'} and checked the file.`);
    } catch (error) {
      setGameConfigError(error instanceof Error ? error.message : 'The profile settings could not be undone.');
    } finally {
      setIsGameConfigBusy(false);
    }
  };

  const restoreGameConfigBackup = async (backupId: string) => {
    if (!window.pcOptiNative || isGameConfigBusy) return;
    setIsGameConfigBusy(true);
    setGameConfigError(null);
    setGameConfigStatus(null);
    try {
      const preview = await window.pcOptiNative.previewGameConfigRestore(backupId);
      const changedCount = preview.files.filter((file) => file.willOverwriteChangedFile).length;
      const missingCount = preview.files.filter((file) => file.currentState === 'MISSING').length;
      const targets = preview.files.map((file) => `• ${file.sourcePath} (${file.currentState === 'MISSING' ? 'will be recreated' : file.willOverwriteChangedFile ? 'current content differs' : 'already matches backup'})`).join('\n');
      const confirmed = await confirmAction({
        title: `Restore ${preview.files.length} game settings file${preview.files.length === 1 ? '' : 's'}?`,
        description: `${changedCount} current ${changedCount === 1 ? 'file differs' : 'files differ'} from the backup. ${missingCount} will be recreated.`,
        details: targets,
        warning: preview.protectionNotice ?? null, notice: `Close the game and its launcher first. Dialed rechecks every file before writing, verifies the restored copies, and keeps the overwritten content.`,
        confirmLabel: 'Restore files',
      });
      if (!confirmed) {
        setGameConfigStatus('Restore canceled after preview. No game configuration file was changed.');
        return;
      }
      const result = await window.pcOptiNative.applyGameConfigRestore(preview.token);
      setGameConfigBackups(await window.pcOptiNative.listGameConfigBackups());
      setGameConfigStatus(`Restored and hash-verified ${result.restoredCount} file${result.restoredCount === 1 ? '' : 's'}. Overwritten content was retained in local recovery evidence.`);
    } catch (error) {
      setGameConfigError(error instanceof Error ? error.message : 'The game configuration restore could not be completed.');
    } finally {
      setIsGameConfigBusy(false);
    }
  };

  const runScan = useCallback(async () => {
    if (!window.pcOptiNative) {
      setScanError('Verified system scans are available only in the Dialed Electron desktop application. No browser fallback is shown.');
      return;
    }
    setIsScanning(true);
    setIsDriftLoading(true);
    setScanError(null);
    setRecommendationError(null);
    setDriftError(null);
    try {
      const nextSnapshot = await window.pcOptiNative.scanSystem();
      setSnapshot(nextSnapshot);
      try {
        setRecommendations(await window.pcOptiNative.getLocalRecommendations());
      } catch (error) {
        setRecommendations([]);
        setRecommendationError(error instanceof Error ? error.message : 'Local recommendations could not be generated.');
      }
      try {
        setDriftReport(await window.pcOptiNative.getDriftReport());
      } catch (error) {
        setDriftReport(null);
        setDriftError(error instanceof Error ? error.message : 'The local drift baseline could not be compared.');
      }
      await loadStartupItems();
    } catch (error) {
      setScanError(error instanceof Error ? error.message : 'The Windows telemetry scan could not be completed.');
    } finally {
      setIsScanning(false);
      setIsDriftLoading(false);
    }
  }, [loadStartupItems]);

  const defineDriftBaseline = async () => {
    if (!window.pcOptiNative || isDriftLoading) return;
    // driftReport is null both before the first scan and after a comparison error
    // (corrupt or cross-device baseline). In the error case a baseline file still
    // exists on disk, so treat a known drift error the same as a known baseline
    // when deciding whether to ask for replace confirmation — otherwise a bad
    // baseline can never be replaced from the UI.
    const hasKnownBaseline = Boolean(driftReport?.baseline) || Boolean(driftError);
    if (hasKnownBaseline && !(await confirmAction({ title: 'Replace the saved baseline?', description: 'Future change checks will compare against the latest verified scan instead.', details: 'Only Dialed’s saved baseline file is replaced.', notice: 'No Windows setting is changed.', confirmLabel: 'Replace baseline' }))) return;
    setIsDriftLoading(true);
    setDriftError(null);
    try {
      setDriftReport(await window.pcOptiNative.setDriftBaseline());
    } catch (error) {
      setDriftError(error instanceof Error ? error.message : 'The local drift baseline could not be saved.');
    } finally {
      setIsDriftLoading(false);
    }
  };

  useEffect(() => {
    void runScan();
    void loadHistory();
  }, [loadHistory, runScan]);

  useEffect(() => {
    if (!window.pcOptiNative) return;
    void refreshRuntimeProfile();
  }, [refreshRuntimeProfile]);

  useEffect(() => {
    if (availableTabs.length > 0 && !availableTabs.includes(activeTab)) setActiveTab(availableTabs[0]);
  }, [activeTab, availableTabs]);

  useEffect(() => {
    if (activeTab === 'overview' && capabilityIds.has('diagnostic:installed-app-inventory')) void loadInstalledApplications();
    if (activeTab === 'workload-profiles' && capabilityIds.has('diagnostic:release-status')) void loadReleaseStatus();
    if (activeTab === 'startup') void loadProcesses();
    if (activeTab === 'startup') void loadPolicies();
    // Measure's Test a change lists the boot-timing tweaks, so it needs their state too.
    if (activeTab === 'startup' || activeTab === 'performance-lab') void loadTimingExperiments();
    if (activeTab === 'startup' && capabilityIds.has('maintenance:clear-shader-caches')) void loadCacheInventory();
    if (activeTab === 'game-settings') {
      if (capabilityIds.has('game:settings-guidance')) void loadGameSettingsGuides();
      if (capabilityIds.has('game:installed-discovery') && capabilityIds.has('game:config-backup')) void loadGameConfigCenter();
    }
    // Saved comparisons are also read where experiment decisions are made — Home's session
    // list and Games › Display setup — so a decision can resume after a restart without
    // first visiting Measure.
    if (activeTab === 'performance-lab' || activeTab === 'readiness' || activeTab === 'game-settings') void loadBenchmarkEvidence();
  }, [activeTab, capabilityIds, loadBenchmarkEvidence, loadGameConfigCenter, loadGameSettingsGuides, loadInstalledApplications, loadPolicies, loadProcesses, loadReleaseStatus, loadTimingExperiments, loadCacheInventory, runtimeProfile.profile]);

  const queue = useMemo(() => queueFromSnapshot(snapshot, capabilityIds, cacheInventory), [cacheInventory, capabilityIds, snapshot]);
  const refreshAfterSessionChange = useCallback(() => { void loadHistory(); void loadProcesses(); }, [loadHistory, loadProcesses]);
  const gameSession = useGameSession(refreshAfterSessionChange);

  const powerPlanName = usePowerPlanName(activeTab === 'startup' && optimizeView === 'all' && capabilityIds.has('power:switch-plan'), history);
  const [userSettings, setUserSettings] = useState<Partial<Record<string, UserSettingState>>>({});
  const [busySettingId, setBusySettingId] = useState<string | null>(null);
  // A tweak opened from search is outlined for a few seconds, then the outline clears.
  const [focusTweakId, setFocusTweakId] = useState<string | null>(null);
  useEffect(() => {
    if (!focusTweakId) return;
    const timer = window.setTimeout(() => setFocusTweakId(null), 4000);
    return () => window.clearTimeout(timer);
  }, [focusTweakId]);
  const openTweak = (tweakId: string) => { setOptimizeView('all'); setActiveTab('startup'); setFocusTweakId(tweakId); };
  const [tweakError, setTweakError] = useState<string | null>(null);
  const loadUserSettings = useCallback(async () => {
    if (!window.pcOptiNative) return;
    try { setUserSettings(await window.pcOptiNative.readUserSettings()); } catch { setUserSettings({}); }
  }, []);
  useEffect(() => { if ((activeTab === 'startup' && optimizeView === 'all') || activeTab === 'performance-lab' || activeTab === 'readiness') void loadUserSettings(); }, [activeTab, optimizeView, loadUserSettings, history]);
  const openTweakDestination = (destination: TweakDestination) => {
    if (destination.tab === 'gpu') { openTweakTools('per-program-graphics'); return; }
    if (destination.tab === 'game-settings') { setGameView(destination.view); setActiveTab('game-settings'); return; }
    if (destination.view === 'timing') { openTweakTools('boot-timing'); return; }
    setOptimizeView(destination.view); setActiveTab('startup');
  };
  const toggleUserSetting = async (card: TweakCardState, enable: boolean) => {
    const settingId = card.definition.userSettingId;
    if (!settingId || !window.pcOptiNative || busySettingId) return;
    // Modern Standby PCs only allow Balanced-based plans, so say so before adding Ultimate Performance.
    const planNotice = settingId === 'ultimate-plan' ? (await window.pcOptiNative.listPowerPlans().catch(() => null))?.planNotice ?? null : null;
    const confirmed = await confirmAction({
      title: card.definition.oneWay ? `${card.definition.actionLabel}: ${card.definition.title}?` : `Turn ${enable ? 'on' : 'off'} ${card.definition.title}?`,
      description: card.definition.whatChanges,
      details: card.definition.oneWay ? `${card.definition.title}: ${userSettings[settingId]?.detail ?? 'current state'} → ${card.definition.actionLabel.toLowerCase()}\nUndo: ${card.definition.undo}` : `${card.definition.title}: ${userSettings[settingId]?.enabled === null ? 'Windows default' : enable ? 'off' : 'on'} → ${enable ? 'on' : 'off'}\nUndo: ${card.definition.undo}`,
      warning: planNotice ?? null, notice: `Dialed records the previous value first, checks the new value after writing it, and keeps the change in Restore so you can undo it. ${card.definition.requiresRestart ? 'Restart Windows for it to take effect.' : 'Restart a running game for it to take effect.'}${card.definition.requiresAdmin ? ' This machine-wide setting needs Dialed running as administrator.' : ''}`,
      confirmLabel: card.definition.oneWay ? card.definition.actionLabel : `Turn ${enable ? 'on' : 'off'}`,
    });
    if (!confirmed) return;
    setBusySettingId(settingId);
    setTweakError(null);
    try {
      const result = await window.pcOptiNative.setUserSetting(settingId, enable);
      if (!result.success) setTweakError(result.error || `${card.definition.title} could not be changed. Nothing is recorded as applied.`);
    } catch (error) {
      setTweakError(error instanceof Error ? error.message : `${card.definition.title} could not be changed.`);
    } finally {
      setBusySettingId(null);
      await loadHistory();
      await loadUserSettings();
    }
  };
  const tweakCards = useMemo(() => {
    const timing = (actionId: string) => timingExperiments.find((experiment) => experiment.actionId === actionId)?.currentState ?? null;
    const maintenance = (kind: MaintenanceAction['kind']) => (snapshot ? (queue.some((action) => action.kind === kind) ? 'Something to review' : 'Nothing to do right now') : null);
    const policy = policies.find((item) => item.id === 'disable-windows-consumer-features');
    const onOff = (state?: UserSettingState) => (state?.unsupported ? 'Not applied on this Windows edition' : state && state.enabled !== null ? (state.enabled ? 'On' : 'Off') : null);
    const states: Record<string, string | null> = {
      'power-plan': powerPlanName,
      'startup-apps': startupItems.length ? `${startupItems.filter((item) => item.canDisable).length} of ${startupItems.length} can be turned off` : null,
      ecoqos: processes.length ? `${processes.filter((item) => item.efficiencyMode).length} of ${processes.length} background programs in efficiency mode` : null,
      'consumer-features': userSettings['consumer-features']?.unsupported ? 'Not applied on this Windows edition' : policy ? (policy.enabled ? 'Suggestions turned off' : 'Windows default (suggestions on)') : null,
      'game-mode': onOff(userSettings['game-mode']),
      'background-recording': onOff(userSettings['background-recording']),
      'gpu-scheduling': userSettings['gpu-scheduling']?.enabled === null && userSettings['gpu-scheduling']?.manageable ? 'Not set (the graphics driver decides)' : onOff(userSettings['gpu-scheduling']),
      mpo: onOff(userSettings.mpo),
      'global-timer-resolution': onOff(userSettings['global-timer-resolution']),
      'mouse-acceleration': onOff(userSettings['mouse-acceleration']),
      'ultimate-plan': userSettings['ultimate-plan']?.detail ?? null,
      'cpu-minimum-state': userSettings['cpu-minimum-state']?.detail ?? null,
      'usb-selective-suspend': userSettings['usb-selective-suspend']?.detail ?? null,
      'windowed-games': userSettings['windowed-games']?.enabled === null && userSettings['windowed-games']?.manageable ? 'Windows default' : onOff(userSettings['windowed-games']),
      'block-background-apps': onOff(userSettings['block-background-apps']),
      'exclude-driver-updates': onOff(userSettings['exclude-driver-updates']),
      'no-auto-restart': onOff(userSettings['no-auto-restart']),
      'processor-scheduling': userSettings['processor-scheduling']?.detail ?? onOff(userSettings['processor-scheduling']),
      'multimedia-scheduler': userSettings['multimedia-scheduler']?.detail ?? null,
      'network-power': userSettings['network-power']?.detail ?? (userSettings['network-power']?.unsupported ? 'No wired adapter with these settings' : null),
      'dynamic-tick': timing('timing:disable-dynamic-tick'),
      'clock-source': timing('timing:restore-automatic-clock-source'),
      'temp-files': maintenance('clear-temp-files'),
      'shader-caches': maintenance('clear-shader-caches'),
      retrim: maintenance('retrim-drive'),
    };
    // A card appears only when this build can act on it (the BIOS guide needs its guide).
    const available = (definition: (typeof TWEAKS)[number]) => definition.id === 'bios'
      ? capabilityIds.has('bios:hardware-guidance') || !window.pcOptiNative
      : definition.capabilityIds.some((id) => capabilityIds.has(id));
    return buildTweakCards(TWEAKS, history, states, available);
  }, [capabilityIds, history, policies, powerPlanName, processes, queue, snapshot, startupItems, timingExperiments, userSettings]);

  const runMaintenance = async (action: MaintenanceAction) => {
    if (!window.pcOptiNative || activeActionId) return;
    const irreversibleNotice = action.kind === 'clear-temp-files'
      ? 'Deleted temporary files cannot be restored. Restore › History records the outcome but cannot offer rollback.'
      : action.kind === 'retrim-drive'
        ? 'ReTRIM is a maintenance request, not a reversible setting change.'
        : 'Deleted cache files cannot be restored by Dialed; apps rebuild them when needed. Restore › History records the outcome but cannot offer rollback.';
    const confirmed = await confirmAction({ title: `${action.title}?`, description: action.description, details: `Evidence: ${action.evidence}`, notice: irreversibleNotice, confirmLabel: 'Run now', tone: action.kind === 'retrim-drive' ? 'default' : 'danger' });
    if (!confirmed) return;

    setActiveActionId(action.id);
    setMaintenanceError(null);
    try {
      const result = await window.pcOptiNative.executeMaintenance(action.id);
      await loadHistory();
      if (!result.success) {
        setMaintenanceError(result.error || 'Windows reported that the maintenance action did not complete. See Restore › History for details.');
        return;
      }
      await Promise.all([runScan(), loadCacheInventory()]);
      setVerifyView('history');
      setActiveTab('drift');
    } catch (error) {
      setMaintenanceError(error instanceof Error ? error.message : 'The maintenance action could not be started.');
    } finally {
      setActiveActionId(null);
    }
  };

  const executeTimingExperiment = async (item: TimingExperiment) => {
    if (!window.pcOptiNative || !item.actionId || activeTimingActionId) return;
    const timingBootNotice = await readBootNotice();
    const confirmed = await confirmAction({
      title: `${item.title}?`,
      description: item.framing,
      details: `Now: ${item.currentState}\n\nDialed must be running as administrator. It backs up the boot settings first, changes only this one value, then checks it.`,
      warning: timingBootNotice ?? null, notice: `Nothing changes until you restart. Measure before and after to see whether it helps. The previous value is kept so you can undo it exactly.`,
      confirmLabel: 'Apply',
    });
    if (!confirmed) return;

    setActiveTimingActionId(item.actionId);
    setTimingStatus(null);
    setTimingActionError(null);
    try {
      const result = await window.pcOptiNative.executeTimingExperiment(item.actionId);
      await Promise.all([loadTimingExperiments(), loadHistory()]);
      if (!result.success) {
        setTimingActionError(result.error || 'Windows did not confirm the change. Check Restore › History before trying again.');
        return;
      }
      setTimingStatus('Done. Restart Windows for it to take effect, then measure to see whether it helped.');
    } catch (error) {
      setTimingActionError(error instanceof Error ? error.message : 'The timing experiment could not be started.');
    } finally {
      setActiveTimingActionId(null);
    }
  };

  // Settings another tool changed from the Windows default, with no active Dialed change.
  // Home's count of Dialed changes that Windows or another program has since set back (same test as the Tweaks cards).
  const setBackCount = useMemo(() => tweakCards.filter((card) => noLongerInEffect(card, userSettings[card.definition.userSettingId ?? card.definition.id])).length, [tweakCards, userSettings]);
  const outsideChanges = useMemo(() => {
    const found: Record<string, { onReturnToDefault: () => void }> = {};
    for (const card of tweakCards) {
      if (card.undoEntry) continue;
      const settingId = card.definition.userSettingId;
      const state = settingId ? userSettings[settingId] : undefined;
      if (settingId && state?.differsFromDefault && typeof state.windowsDefault === 'boolean' && state.manageable) {
        const target = state.windowsDefault;
        found[card.definition.id] = { onReturnToDefault: () => void toggleUserSetting(card, target) };
      }
    }
    const tick = timingExperiments.find((item) => item.id === 'consistent-tick-experiment');
    const tickCard = tweakCards.find((card) => card.definition.id === 'dynamic-tick');
    if (tick?.restoreDefaultActionId && tickCard && !tickCard.undoEntry) {
      const restore = { ...tick, title: 'Return dynamic tick to the Windows default', framing: 'Removes the dynamic tick value another tool set, so Windows uses its default again. Measure before and after to see whether it made a difference.', actionId: tick.restoreDefaultActionId } as unknown as TimingExperiment;
      found['dynamic-tick'] = { onReturnToDefault: () => void executeTimingExperiment(restore) };
    }
    return found;
  }, [tweakCards, userSettings, timingExperiments]);
  // "Apply selected" on the Tweaks page: one confirmation, then each change in turn,
  // each journaled and undoable on its own; "Undo this run" reverses them together.
  const [batchSelected, setBatchSelected] = useState<Set<string>>(() => new Set());
  const [batchRunning, setBatchRunning] = useState(false);
  // The last applied run survives a restart, so "Undo this run" is still offered. Only the entry
  // ids are kept; undo re-reads the history and offers only entries that can still be undone.
  const savedRun = useMemo(() => readLastTweakRun(), []);
  const [batchResults, setBatchResults] = useState<BatchResult[] | null>(savedRun?.results ?? null);
  const [batchResultsVerb, setBatchResultsVerb] = useState<'applied' | 'undone'>('applied');
  const [batchEntryIds, setBatchEntryIds] = useState<string[]>(savedRun?.entryIds ?? []);
  useEffect(() => { writeLastTweakRun(batchResultsVerb === 'applied' && batchEntryIds.length && batchResults ? { results: batchResults, entryIds: batchEntryIds } : null); }, [batchResults, batchResultsVerb, batchEntryIds]);
  const batchActions = useMemo(() => {
    const actions: Record<string, NonNullable<ReturnType<typeof batchActionFor>>> = {};
    for (const card of tweakCards) {
      const settingId = card.definition.userSettingId;
      const action = batchActionFor(card.definition, settingId ? userSettings[settingId] : undefined, Boolean(outsideChanges[card.definition.id]));
      if (action) actions[card.definition.id] = action;
    }
    return actions;
  }, [tweakCards, userSettings, outsideChanges]);
  const [batchRestorePoint, setBatchRestorePoint] = useState(false);
  const applySelectedTweaks = async (ids?: string[]) => {
    const native = window.pcOptiNative;
    if (!native || batchRunning || busySettingId) return;
    const plan = tweakCards.filter((card) => (ids ? ids.includes(card.definition.id) : batchSelected.has(card.definition.id)) && batchActions[card.definition.id]).map((card) => ({ card, action: batchActions[card.definition.id] }));
    if (!plan.length) return;
    const restart = plan.filter(({ card }) => card.definition.requiresRestart).map(({ card }) => card.definition.title);
    const confirmed = await confirmAction({
      title: `Apply ${plan.length} change${plan.length === 1 ? '' : 's'}?`,
      description: 'Dialed applies them one at a time. Each is recorded separately, so you can undo any one of them later, or all of them with "Undo this run".',
      details: plan.map(({ card, action }) => `${card.definition.title}: ${action.from} → ${action.to}`).join('\n'),
      detailsLabel: 'Changes',
      notice: `Dialed records each previous value first and checks each new value after writing it. If one fails, the others still run and the failure is shown.${restart.length ? ` Restart Windows afterwards for: ${restart.join(', ')}.` : ' Restart a running game for the changes to apply.'}`,
      warning: batchRestorePoint ? 'Dialed asks Windows for a restore point first and stops if it cannot confirm one. A restore point rolls back system settings and programs together and does not back up your files; to reverse one tweak, use its own Undo.' : null,
      confirmLabel: `Apply ${plan.length}`,
    });
    if (!confirmed) return;
    if (batchRestorePoint) {
      setBatchRunning(true);
      setTweakError(null);
      try {
        if (!native.createRestorePoint) throw new Error('This build cannot make a restore point. Nothing was changed.');
        const point = await native.createRestorePoint();
        if (point.status === 'THROTTLED') {
          setBatchRunning(false);
          const proceed = await confirmAction({
            title: 'Continue without a new restore point?',
            description: point.message || 'Windows made a restore point within the past 24 hours, so it did not make another.',
            details: plan.map(({ card, action }) => `${card.definition.title}: ${action.from} → ${action.to}`).join('\n'),
            detailsLabel: 'Changes',
            notice: 'Windows allows one restore point per 24 hours. The earlier one is still there, and each change can still be undone on its own.',
            confirmLabel: `Apply ${plan.length} without a new one`,
          });
          if (!proceed) return;
          setBatchRunning(true);
        }
      } catch (error) {
        setBatchRunning(false);
        setTweakError(error instanceof Error ? error.message : 'Dialed could not confirm a restore point, so none of the selected changes were made.');
        await loadHistory();
        return;
      }
    }
    setBatchRunning(true);
    setBatchResults(null);
    const results: BatchResult[] = [];
    const entryIds: string[] = [];
    for (const { card, action } of plan) {
      setBusySettingId(action.settingId);
      try {
        const result = await native.setUserSetting(action.settingId, action.enable);
        if (result.success) { entryIds.push(result.entry.id); results.push({ title: card.definition.title, ok: true, message: `${action.from} → ${action.to}` }); }
        else results.push({ title: card.definition.title, ok: false, message: result.error || 'Windows did not confirm the change. Nothing is recorded as applied.' });
      } catch (error) {
        results.push({ title: card.definition.title, ok: false, message: error instanceof Error ? error.message : 'The change could not be made.' });
      }
    }
    setBusySettingId(null);
    setBatchSelected(new Set());
    setBatchResults(results); setBatchResultsVerb('applied');
    setBatchEntryIds(entryIds);
    setBatchRunning(false);
    await loadHistory();
    await loadUserSettings();
  };
  const undoTweakRun = async () => {
    const native = window.pcOptiNative;
    if (!native || batchRunning || !batchEntryIds.length) return;
    const entries = (await native.getAuditHistory()).entries;
    const undoable = [...batchEntryIds].reverse().map((id) => entries.find((entry) => entry.id === id)).filter((entry): entry is AuditJournalEntry => Boolean(entry?.rollback.available));
    if (!undoable.length) { setTweakError('Nothing from that run can be undone from here any more. Check Restore.'); return; }
    const runBootNotice = undoable.some(isBootEntry) ? await readBootNotice() : null;
    const confirmed = await confirmAction({
      title: `Undo ${undoable.length} change${undoable.length === 1 ? '' : 's'} from this run?`,
      description: 'Each setting goes back to exactly what it was before the run, newest first.',
      details: undoable.map((entry) => entry.title).join('\n'),
      detailsLabel: 'Changes to undo',
      warning: runBootNotice ?? null, notice: `Dialed checks that each setting still has the value it wrote, and skips any that something else has changed since.`,
      confirmLabel: 'Undo run',
    });
    if (!confirmed) return;
    setBatchRunning(true);
    const results: BatchResult[] = [];
    for (const entry of undoable) {
      try {
        const result = await native.rollbackAuditEntry(entry.id);
        results.push({ title: entry.title, ok: result.success, message: result.success ? 'undone' : result.error || 'Windows did not confirm the undo.' });
      } catch (error) {
        results.push({ title: entry.title, ok: false, message: error instanceof Error ? error.message : 'The undo could not be made.' });
      }
    }
    setBatchResults(results); setBatchResultsVerb('undone');
    setBatchEntryIds([]);
    setBatchRunning(false);
    await loadHistory();
    await loadUserSettings();
  };
  // Test a change: apply one Dialed tweak through its normal confirmed, journaled path,
  // then return the journal entry it wrote (null if canceled or failed).
  const TESTABLE_TWEAKS: Record<string, { timingActionId?: string }> = {
    'dynamic-tick': { timingActionId: 'timing:disable-dynamic-tick' },
    'clock-source': { timingActionId: 'timing:restore-automatic-clock-source' },
    'cpu-minimum-state': {}, 'global-timer-resolution': {}, 'gpu-scheduling': {}, 'game-mode': {}, mpo: {}, 'background-recording': {}, 'windowed-games': {},
  };
  const newestEntry = async (since: number, match: (entry: AuditJournalEntry) => boolean): Promise<AuditJournalEntry | null> => {
    if (!window.pcOptiNative) return null;
    const state = await window.pcOptiNative.getAuditHistory();
    return state.entries
      .filter((entry) => Date.parse(entry.timestamp) >= since && entry.status === 'SUCCESS' && match(entry))
      .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))[0] ?? null;
  };
  const applyTweakForTest = async (tweakId: string): Promise<AuditJournalEntry | null> => {
    const card = tweakCards.find((item) => item.definition.id === tweakId);
    const spec = TESTABLE_TWEAKS[tweakId];
    if (!card || !spec) return null;
    const since = Date.now() - 1000;
    if (spec.timingActionId) {
      const direct = timingExperiments.find((experiment) => experiment.actionId === spec.timingActionId);
      // Dynamic tick already set (for example by another tool): test returning it to the default.
      const tick = timingExperiments.find((experiment) => experiment.id === 'consistent-tick-experiment');
      const item = direct ?? (spec.timingActionId === 'timing:disable-dynamic-tick' && tick?.restoreDefaultActionId
        ? { ...tick, title: 'Return dynamic tick to the Windows default', actionId: tick.restoreDefaultActionId } as unknown as TimingExperiment
        : undefined);
      if (!item) { setTweakError(`${card.definition.title} cannot be changed right now.`); return null; }
      await executeTimingExperiment(item);
    } else {
      const settingId = card.definition.userSettingId;
      if (!settingId) return null;
      const current = userSettings[settingId]?.enabled;
      await toggleUserSetting(card, card.definition.oneWay ? true : current !== true);
    }
    return newestEntry(since, (entry) => card.definition.capabilityIds.includes(entry.capabilityId ?? '') && entry.rollback.available);
  };
  const undoEntryForTest = async (entryId: string): Promise<AuditJournalEntry | null> => {
    if (!window.pcOptiNative) return null;
    const entry = (await window.pcOptiNative.getAuditHistory()).entries.find((item) => item.id === entryId);
    if (!entry || !entry.rollback.available) { setHistoryActionError('That change can no longer be undone from here. Check Restore › History.'); return null; }
    await rollbackAuditEntry(entry, { stay: true });
    const after = (await window.pcOptiNative.getAuditHistory()).entries;
    const original = after.find((item) => item.id === entryId);
    const restoreId = original && !original.rollback.available ? /Restored by audit entry ([0-9a-f-]{8,})/i.exec(original.rollback.reason || '')?.[1] : undefined;
    return restoreId ? after.find((item) => item.id === restoreId) ?? null : null;
  };
  const openComparison = (preview: BenchmarkImportPreview, session: ExperimentSession) => {
    setSessionContext(session);
    acceptNativePresentMonImport(preview);
    setMeasureView('results');
    setActiveTab('performance-lab');
  };
  const openTest = (prefill: TestPrefill | null = null) => {
    if (prefill) setTestPrefill(prefill);
    setMeasureView('test');
    setActiveTab('performance-lab');
  };

  const disableStartupItem = async (item: StartupManagementItem) => {
    if (!window.pcOptiNative || activeStartupItemId) return;
    const machineWide = item.scope.startsWith('All users');
    const capabilityId = machineWide ? 'startup:disable-machine-run' : 'startup:disable-current-user-run';
    const securityImplications = runtimeProfile.capabilities.find((capability) => capability.id === capabilityId)?.securityImplications
      || 'Disabling security or backup software at sign-in may reduce protection; review the selected entry before continuing.';
    const confirmed = await confirmAction({
      title: `Stop ${item.name} from starting at sign-in?`,
      description: `Dialed removes only this ${machineWide ? 'machine-wide' : 'current-user'} startup entry and keeps its exact previous value so you can restore it.`,
      details: `Windows command: ${item.path || 'not returned'}\n\nSecurity impact: ${securityImplications}`,
      notice: machineWide ? 'Machine-wide entry: Dialed must be running as administrator. Restore it anytime from Startup apps or Restore › History.' : 'Restore it anytime from Startup apps or Restore › History.',
      confirmLabel: 'Disable at sign-in',
    });
    if (!confirmed) return;

    setActiveStartupItemId(item.id);
    setStartupActionError(null);
    try {
      const result = await window.pcOptiNative.disableStartupItem(item.id);
      await loadHistory();
      if (!result.success) {
        setStartupActionError(result.error || 'Windows reported that the startup item was not changed.');
        return;
      }
      await runScan();
    } catch (error) {
      setStartupActionError(error instanceof Error ? error.message : 'The startup item could not be changed.');
    } finally {
      setActiveStartupItemId(null);
    }
  };

  const enableProcessEcoQos = async (process: ManageableProcess) => {
    if (!window.pcOptiNative || activeProcessId) return;
    const confirmed = await confirmAction({
      title: `Use EcoQoS for ${process.name}?`,
      description: 'Windows gives this one app a lower-power lane. It is not closed, suspended or pinned to specific cores.',
      details: `${process.name} · PID ${process.pid} · ${process.cpuPercent === null ? 'unknown' : `${process.cpuPercent}%`} recent CPU`,
      notice: 'Use this only for background work. If this is a game or launcher, cancel — slowing a game is usually backwards. Undo it from Restore › History while the app is still running.',
      confirmLabel: 'Use EcoQoS',
    });
    if (!confirmed) return;

    setActiveProcessId(process.pid);
    setProcessActionError(null);
    try {
      const result = await window.pcOptiNative.enableProcessEcoQos(process.pid, process.creationTime || '');
      await Promise.all([loadProcesses(), loadHistory()]);
      if (!result.success) {
        setProcessActionError(result.error || 'Windows reported that EcoQoS could not be applied.');
      }
    } catch (error) {
      setProcessActionError(error instanceof Error ? error.message : 'EcoQoS could not be applied.');
    } finally {
      setActiveProcessId(null);
    }
  };

  const enableConsumerFeaturesPolicy = async (policy: SafeOsPolicy) => {
    if (!window.pcOptiNative || activePolicyId) return;
    const confirmed = await confirmAction({
      title: `${policy.title}?`,
      description: 'Stops Windows from automatically installing sponsored consumer apps. Microsoft Store, Windows Update, Defender and your installed apps are not removed.',
      details: 'Windows policy: DisableWindowsConsumerFeatures = 1\nDialed creates and verifies a System Restore point first.',
      notice: 'If Windows already made a restore point in the last 24 hours, Dialed stops and asks again before changing anything. The previous policy value is kept so you can restore it.',
      confirmLabel: 'Apply policy',
    });
    if (!confirmed) return;

    setActivePolicyId(policy.id);
    setPolicyActionError(null);
    try {
      let result = await window.pcOptiNative.enableConsumerFeaturesPolicy();
      if (result.requiresThrottleConfirmation) {
        if (!result.throttleToken || !result.checkpoint) throw new Error('Windows returned an incomplete restore-point throttle result. The policy was not changed.');
        const proceeded = await confirmAction({
          title: 'Use the recent restore point?',
          description: result.checkpoint.message,
          details: `Windows restore point: sequence ${result.checkpoint.sequenceNumber ?? 'not reported'}, created ${result.checkpoint.creationTime || 'at an unreported time'}.`,
          notice: 'Dialed has not changed the policy. Cancel leaves it unchanged.',
          confirmLabel: 'Continue with existing restore point',
        });
        if (!proceeded) {
          setPolicyActionError('The policy was not changed because you declined to proceed without a newly created restore point.');
          return;
        }
        result = await window.pcOptiNative.confirmConsumerFeaturesPolicy(result.throttleToken);
      }
      await Promise.all([loadPolicies(), loadHistory()]);
      if (!result.success) {
        setPolicyActionError(result.error || 'Windows reported that the policy was not applied.');
      }
    } catch (error) {
      setPolicyActionError(error instanceof Error ? error.message : 'The Windows policy could not be applied.');
    } finally {
      setActivePolicyId(null);
    }
  };

  const rollbackAuditEntry = async (entry: AuditJournalEntry, options: { stay?: boolean } = {}) => {
    if (!window.pcOptiNative || rollingBackId) return;
    const bootNotice = isBootEntry(entry) ? await readBootNotice() : null;
    const confirmed = await confirmAction({
      title: `Undo: ${entry.title}?`,
      description: entry.rollback.reason,
      details: [`Recorded ${new Date(entry.timestamp).toLocaleString()}`, rollbackDisclosureText(entry)].filter(Boolean).join('\n'),
      warning: bootNotice ?? null, notice: `Dialed first checks that the current state still matches what it changed, and refuses if something else changed it since. Check that the details above match a change you made with Dialed.`,
      confirmLabel: 'Undo',
    });
    if (!confirmed) return;

    setRollingBackId(entry.id);
    setHistoryActionError(null);
    try {
      const result = await window.pcOptiNative.rollbackAuditEntry(entry.id);
      await loadHistory();
      if (!result.success) {
        setHistoryActionError(result.error || 'Windows reported that the rollback did not complete.');
        // Restore failures are always shown in Restore › History, even when started elsewhere.
        if (options.stay) {
          setVerifyView('history');
          setActiveTab('drift');
        }
        return;
      }
      await runScan();
      if (!options.stay) {
        setVerifyView('history');
        setActiveTab('drift');
      }
    } catch (error) {
      setHistoryActionError(error instanceof Error ? error.message : 'The rollback could not be completed.');
    } finally {
      setRollingBackId(null);
    }
  };

  const undoAllDialedChanges = async () => {
    const native = window.pcOptiNative;
    if (!native || rollingBackId || isUndoAllBusy) return;
    const restorable = history
      .filter((entry) => entry.status === 'SUCCESS' && entry.rollback.available)
      .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
    if (restorable.length === 0) {
      setHistoryPrivacyStatus('No recorded change currently has an available restore.');
      return;
    }
    const undoAllBootNotice = restorable.some(isBootEntry) ? await readBootNotice() : null;
    const confirmed = await confirmAction({
      title: `Undo ${restorable.length} Dialed change${restorable.length === 1 ? '' : 's'}?`,
      description: 'Dialed restores each change newest first and checks that nothing else changed it before writing.',
      details: restorable.map((entry) => {
        const disclosure = describeRollbackTarget(entry).map((line) => `    ${line}`).join('\n');
        return `• ${entry.title} (${new Date(entry.timestamp).toLocaleString()})${disclosure ? `\n${disclosure}` : ''}`;
      }).join('\n'),
      warning: undoAllBootNotice ?? null, notice: `A change that something else has modified is reported, not forced. Boot timing restores still need a reboot. Deleted files and removed apps cannot be restored and are not listed. Check that each entry above matches a change you made with Dialed.`,
      confirmLabel: `Undo ${restorable.length} change${restorable.length === 1 ? '' : 's'}`,
      tone: 'danger',
    });
    if (!confirmed) return;
    setIsUndoAllBusy(true);
    setHistoryActionError(null);
    setHistoryPrivacyStatus(null);
    const failures: string[] = [];
    let restored = 0;
    for (const entry of restorable) {
      try {
        const result = await native.rollbackAuditEntry(entry.id);
        if (result.success) restored += 1;
        else failures.push(`${entry.title}: ${result.error || 'restore did not verify'}`);
      } catch (error) {
        failures.push(`${entry.title}: ${error instanceof Error ? error.message : 'restore could not start'}`);
      }
    }
    try {
      await loadHistory();
      await runScan();
    } finally {
      setIsUndoAllBusy(false);
    }
    setHistoryPrivacyStatus(`Restored ${restored} of ${restorable.length} change${restorable.length === 1 ? '' : 's'}.${failures.length ? ` ${failures.length} could not be restored; see below.` : ''}`);
    if (failures.length) setHistoryActionError(failures.join('\n'));
  };

  const exportAuditHistory = async () => {
    if (!window.pcOptiNative || isHistoryPrivacyBusy) return;
    setIsHistoryPrivacyBusy(true);
    setHistoryPrivacyStatus(null);
    try {
      const preview = await window.pcOptiNative.getAuditExportPreview();
      const confirmed = await requestPreviewConfirmation({
        title: 'Export redacted Restore › History?',
        description: 'Review the exact redacted payload before choosing where to save it.',
        detailsLabel: 'Redacted export payload',
        details: formatPreviewDetails(preview.payload),
        notice: `Omitted locally: ${preview.omittedFields.join('; ')}. A save dialog will open only after confirmation. No data is uploaded.`,
        confirmLabel: 'Choose save location',
      });
      if (!confirmed) {
        setHistoryPrivacyStatus('Redacted export canceled before file selection.');
        return;
      }
      const result = await window.pcOptiNative.exportAuditHistory();
      setHistoryPrivacyStatus(result.canceled
        ? 'Redacted export canceled; no file was written.'
        : `Exported ${result.entryCount ?? 0} redacted entries to ${result.fileName ?? 'the selected JSON file'}.`);
    } catch (error) {
      setHistoryActionError(error instanceof Error ? error.message : 'The redacted history export could not be completed.');
    } finally {
      setIsHistoryPrivacyBusy(false);
    }
  };

  const deleteAuditHistory = async (mode: AuditDeletionMode) => {
    if (!window.pcOptiNative || isHistoryPrivacyBusy) return;
    setIsHistoryPrivacyBusy(true);
    setHistoryPrivacyStatus(null);
    try {
      const preview = await window.pcOptiNative.getAuditDeletionPreview(mode);
      if (preview.deleteCount === 0) {
        setHistoryPrivacyStatus(`No eligible completed entries matched this retention choice. Protected: ${preview.protectedCounts.unresolved} unresolved, ${preview.protectedCounts.rollbackAvailable} with rollback available.`);
        return;
      }
      const confirmed = await requestPreviewConfirmation({
        title: `Permanently delete ${preview.deleteCount} completed history entr${preview.deleteCount === 1 ? 'y' : 'ies'}?`,
        description: 'Review the exact completed Restore › History entries selected by this retention choice.',
        detailsLabel: 'History entries selected for deletion',
        details: formatPreviewDetails(preview.previewEntries),
        notice: `Retained after deletion: ${preview.retainCount}. Protected automatically: ${preview.protectedCounts.unresolved} unresolved, ${preview.protectedCounts.rollbackAvailable} with rollback available, ${preview.protectedCounts.invalidOrUnclassified} invalid or unclassified. This is permanent local history deletion, not rollback. It does not undo any Windows action.`,
        confirmLabel: `Delete ${preview.deleteCount} entr${preview.deleteCount === 1 ? 'y' : 'ies'}`,
        tone: 'danger',
      });
      if (!confirmed) {
        setHistoryPrivacyStatus('History deletion canceled; no entries were removed.');
        return;
      }
      const result = await window.pcOptiNative.deleteAuditHistory(preview.token);
      setHistory(result.entries);
      setHistoryPrivacyStatus(`Deleted ${result.deletedCount} completed entr${result.deletedCount === 1 ? 'y' : 'ies'}; retained ${result.retainedCount}. No Windows action was changed.`);
    } catch (error) {
      setHistoryActionError(error instanceof Error ? error.message : 'The history entries could not be deleted.');
    } finally {
      setIsHistoryPrivacyBusy(false);
    }
  };

  const importBenchmarkEvidence = async () => {
    if (!window.pcOptiNative || isBenchmarkLoading) return;
    setSessionContext(null);
    setIsBenchmarkLoading(true);
    setBenchmarkError(null);
    try {
      const preview = await window.pcOptiNative.previewBenchmarkImport();
      if (preview.canceled || !preview.token) return;
      if (preview.requiresMetadata && preview.format === 'PRESENTMON' && preview.sources) {
        setPresentMonImport({ token: preview.token, sources: preview.sources });
        return;
      }
      if (!preview.records) return;
      const confirmed = await requestPreviewConfirmation({
        title: 'Import these benchmark records?',
        description: 'Review the exact records before adding them to local evidence storage.',
        detailsLabel: 'Benchmark records prepared for import',
        details: formatPreviewDetails(preview.records),
        notice: 'Dialed did not launch a benchmark tool. Raw samples and conditions will be retained locally; no score, Windows action, or rollback is generated automatically.',
        confirmLabel: 'Import records',
      });
      if (!confirmed) return;
      setBenchmarkEvidence(await window.pcOptiNative.applyBenchmarkImport(preview.token));
    } catch (error) {
      setBenchmarkError(error instanceof Error ? error.message : 'Benchmark evidence import could not be completed.');
    } finally {
      setIsBenchmarkLoading(false);
    }
  };

  const preparePresentMonImport = async (metadata: PresentMonImportMetadata) => {
    if (!window.pcOptiNative || isBenchmarkLoading || !presentMonImport) return;
    setIsBenchmarkLoading(true);
    setBenchmarkError(null);
    try {
      const preview = await window.pcOptiNative.preparePresentMonImport(presentMonImport.token, metadata);
      if (preview.canceled || !preview.token || !preview.records) return;
      const nativeCapture = presentMonImport.sources.every((source) => Boolean(source.toolVersion));
      const confirmed = await requestPreviewConfirmation({
        title: 'Import these PresentMon benchmark records?',
        description: 'Review the exact frame-time records before adding them to local evidence storage.',
        detailsLabel: 'PresentMon records prepared for import',
        details: formatPreviewDetails(preview.records),
        notice: `Raw frame-time samples and recorded conditions will be retained locally. ${nativeCapture ? 'Dialed launched only the pinned, verified PresentMon console tool for these native captures.' : 'Dialed did not launch PresentMon for these file-selected captures.'} No performance improvement or end-to-end input latency is inferred.`,
        confirmLabel: 'Import records',
      });
      if (!confirmed) return;
      setBenchmarkEvidence(await window.pcOptiNative.applyBenchmarkImport(preview.token));
      setPresentMonImport(null);
    } catch (error) {
      setBenchmarkError(error instanceof Error ? error.message : 'PresentMon evidence import could not be completed.');
    } finally {
      setIsBenchmarkLoading(false);
    }
  };

  const acceptNativePresentMonImport = (preview: BenchmarkImportPreview) => {
    if (!preview.token || !preview.sources) {
      setBenchmarkError('Native PresentMon comparison preparation returned incomplete evidence.');
      return;
    }
    setPresentMonImport({ token: preview.token, sources: preview.sources });
  };

  const deleteBenchmarkEvidence = async (experimentId: string) => {
    if (!window.pcOptiNative || isBenchmarkLoading) return;
    setIsBenchmarkLoading(true);
    setBenchmarkError(null);
    try {
      const preview = await window.pcOptiNative.previewBenchmarkDeletion(experimentId);
      const confirmed = await requestPreviewConfirmation({
        title: `Permanently delete ${preview.deletedCount} benchmark record${preview.deletedCount === 1 ? '' : 's'}?`,
        description: `Review the local evidence selected for experiment '${preview.experimentId}'.`,
        detailsLabel: 'Benchmark evidence selected for deletion',
        details: formatPreviewDetails(preview.summary),
        notice: 'This removes only imported benchmark evidence. It does not roll back or change Windows configuration.',
        confirmLabel: `Delete ${preview.deletedCount} record${preview.deletedCount === 1 ? '' : 's'}`,
        tone: 'danger',
      });
      if (!confirmed) return;
      setBenchmarkEvidence(await window.pcOptiNative.deleteBenchmarkExperiment(preview.token));
    } catch (error) {
      setBenchmarkError(error instanceof Error ? error.message : 'Benchmark evidence deletion could not be completed.');
    } finally {
      setIsBenchmarkLoading(false);
    }
  };

  const testableTweaks: TestableTweak[] = tweakCards
    .filter((card) => {
      const spec = TESTABLE_TWEAKS[card.definition.id];
      if (!spec) return false;
      if (spec.timingActionId) return timingExperiments.some((experiment) => experiment.actionId === spec.timingActionId);
      const setting = card.definition.userSettingId ? userSettings[card.definition.userSettingId] : undefined;
      return Boolean(setting?.manageable && !setting.unsupported);
    })
    .sort((left, right) => Number(right.definition.measureFirst) - Number(left.definition.measureFirst))
    .map((card) => ({
      id: card.definition.id,
      title: card.definition.title,
      summary: card.definition.summary,
      state: card.state,
      restartRequired: Boolean(card.definition.requiresRestart || TESTABLE_TWEAKS[card.definition.id]?.timingActionId),
      requiresAdmin: Boolean(card.definition.requiresAdmin || TESTABLE_TWEAKS[card.definition.id]?.timingActionId),
    }));
  const testableIds = new Set(testableTweaks.map((item) => item.id));

  return <ConfirmContext.Provider value={confirmAction}><div className="app-shell min-h-screen text-slate-200"><a href="#main-content" className="sr-only fixed left-4 top-4 z-[100] rounded-lg bg-cyan-300 px-4 py-2 text-sm font-bold text-slate-950 focus:not-sr-only">Skip to main content</a>{actionPreview ? <ActionPreviewDialog request={actionPreview} onCancel={cancelPreviewConfirmation} onConfirm={confirmPreviewAction} /> : null}<div className="flex min-h-screen flex-col min-[960px]:flex-row"><Sidebar activeTab={activeTab} availableTabs={availableTabs} onChange={setActiveTab} profile={runtimeProfile.profile} onOpenTweak={availableTabs.includes('startup') ? openTweak : undefined} tweakIds={new Set(tweakCards.map((card) => card.definition.id))} /><main id="main-content" tabIndex={-1} className="min-w-0 flex-1 panel-shell"><header className="app-header flex flex-col justify-between gap-3 border-b border-slate-800 px-6 py-4 backdrop-blur sm:flex-row sm:items-center"><div><p className="text-xs font-semibold uppercase tracking-wider text-cyan-400">Dialed · Windows performance optimizer</p><p className="mt-0.5 text-xs text-slate-500">Your PC, dialed in. Every change is explained, checked and can be undone.</p></div><div className="flex flex-col items-end gap-2 text-xs text-slate-400"><div className="flex flex-wrap items-center justify-end gap-2"></div><span role="status" className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${isScanning ? 'border-cyan-400/30 bg-cyan-400/10 text-cyan-200' : scanError ? 'border-rose-500/30 bg-rose-950/20 text-rose-200' : snapshot ? snapshot.metadata.errors.length ? 'border-amber-500/30 bg-amber-950/20 text-amber-200' : 'border-emerald-500/30 bg-emerald-950/20 text-emerald-200' : 'border-slate-700 bg-slate-900/50 text-slate-400'}`}>{isScanning ? <RefreshCw className="h-3 w-3 animate-spin" /> : scanError ? <AlertCircle className="h-3 w-3" /> : snapshot ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}{isScanning ? 'Verified scan running' : scanError ? 'Latest scan failed · previous evidence retained' : snapshot ? `Scanned ${scanTimeLabel(snapshot.timestamp)}${snapshot.metadata.errors.length ? ` · ${snapshot.metadata.errors.length} gap${snapshot.metadata.errors.length === 1 ? '' : 's'}` : ''}` : 'No completed scan'}</span></div></header>{runtimeProfile.accountMismatch ? <p role="alert" className="mx-auto mt-5 w-[calc(100%-2.5rem)] max-w-7xl rounded-xl border border-amber-500/40 bg-amber-950/30 p-4 text-sm text-amber-100 sm:w-[calc(100%-3.5rem)]">{runtimeProfile.accountMismatch}</p> : null}<div className="mx-auto w-full max-w-7xl p-5 sm:p-7"><WorkspaceErrorBoundary key={activeTab} onRecover={() => { setVerifyView('history'); setActiveTab('drift'); }}><Suspense fallback={<p className="text-sm text-slate-400">Loading…</p>}>
    {(activeTab === 'readiness' || activeTab === 'overview') && <TabRow<'readiness' | 'overview'> ariaLabel="Home views" items={[{ id: 'readiness', label: 'Summary' }, { id: 'overview', label: 'Scan details' }]} value={activeTab} onChange={setActiveTab} className="mb-6 flex flex-wrap gap-x-6 gap-y-2 border-b border-slate-800" />}
    {activeTab === 'readiness' && <TabPanel ariaLabel="Home views" value={activeTab}><HomeSummary snapshot={snapshot} isScanning={isScanning} scanError={scanError} history={history} historyRecovery={historyRecovery} recommendations={orderedRecommendations} benchmarkEvidence={benchmarkEvidence} onScan={() => void runScan()} onOpenScanDetails={() => setActiveTab('overview')} setBackCount={setBackCount} onNavigate={navigateToRecommendationPanel} onOpenRestore={() => { setVerifyView('history'); setFocusedAuditId(null); setActiveTab('drift'); }} onOpenSuggestions={() => { setScanSuggestionsOpen(true); setActiveTab('overview'); }} onOpenTest={() => openTest()} /></TabPanel>}
    {activeTab === 'workload-profiles' && <><section className="mb-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-6"><p className="text-xs font-semibold uppercase tracking-wider text-cyan-300">Settings</p><h2 className="mt-2 text-2xl font-bold text-white">Appearance, data and release status</h2><p className="mt-1 text-sm text-slate-400">Choose a look, manage what Dialed stores on this PC, and review the installed version. Nothing here changes Windows.</p></section><ThemePicker activeTheme={appTheme} onChange={setAppTheme} /><TechnicalDetailsSetting enabled={technicalDetails} onChange={setTechnicalDetails} />{capabilityIds.has('telemetry:windows-counters') && <HardwareReadingsSetting />}<BackgroundActivity /><LocalDataCenter auditEntries={history} comparisons={benchmarkEvidence.comparisons} appVersion={releaseStatus?.version} technicalDetails={technicalDetails} auditCount={history.length} comparisonCount={benchmarkEvidence.comparisons.length} theme={appTheme} onNavigate={(tab) => { if (tab === 'drift') { setVerifyView('history'); setFocusedAuditId(null); } if (tab === 'game-settings') setGameView('backups'); setActiveTab(tab); }} /><ReleaseStatusCard status={releaseStatus} loading={isReleaseStatusLoading} error={releaseStatusError} onRefresh={loadReleaseStatus} /></>}
    {activeTab === 'overview' && <TabPanel ariaLabel="Home views" value={activeTab}><DashboardOverview suggestionsOpen={scanSuggestionsOpen} snapshot={snapshot} isScanning={isScanning} scanError={scanError} recommendations={orderedRecommendations} recommendationError={recommendationError} onScan={runScan} onNavigateRecommendation={navigateToRecommendationPanel} driftReport={driftReport} onOpenChanges={() => { setVerifyView('drift'); setActiveTab('drift'); }} onOpenStartup={() => openTweakDestination({ tab: 'startup', view: 'startup' })} onOpenTempFiles={() => openTweakDestination({ tab: 'startup', view: 'maintenance' })} />
    <SystemInsightCenters snapshot={snapshot} inventory={installedApplications} appsLoading={isInstalledAppsLoading} appsError={installedAppsError} onRefreshApps={loadInstalledApplications} /></TabPanel>}
    {activeTab === 'startup' && <TabRow<typeof optimizeView> ariaLabel="Optimize categories" items={([['all', 'All tweaks'], ['startup', 'Startup'], ['background', 'Background apps'], ['windows', 'Windows'], ['maintenance', 'Upkeep'], ['bios', 'BIOS']] as const).map(([id, label]) => ({ id, label }))} value={optimizeView} onChange={setOptimizeView} className="mb-6 flex flex-wrap gap-x-6 gap-y-2 border-b border-slate-800" />}
    {activeTab === 'startup' && <TabPanel ariaLabel="Optimize categories" value={optimizeView}>
    {activeTab === 'startup' && optimizeView === 'bios' && (capabilityIds.has('bios:hardware-guidance') || !window.pcOptiNative) && <Suspense fallback={<p className="text-sm text-slate-400">Loading BIOS guide…</p>}><BiosGuidanceCenter /></Suspense>}
    {activeTab === 'startup' && optimizeView === 'all' && <TweaksOverview focusId={focusTweakId} outsideChanges={outsideChanges} batch={{ actions: batchActions, selected: batchSelected, onSelect: (id, value) => setBatchSelected((current) => { const next = new Set(current); if (value) next.add(id); else next.delete(id); return next; }), onApply: (ids) => void applySelectedTweaks(ids), onClear: () => setBatchSelected(new Set()), running: batchRunning, results: batchResults, resultsVerb: batchResultsVerb, onUndoRun: batchEntryIds.length ? () => void undoTweakRun() : undefined, restorePoint: window.pcOptiNative?.createRestorePoint && capabilityIds.has('recovery:restore-point') ? { checked: batchRestorePoint, onChange: setBatchRestorePoint } : undefined }} cards={tweakCards} restoringId={rollingBackId} userSettings={userSettings} busySettingId={busySettingId} error={tweakError} onToggle={(card, enable) => void toggleUserSetting(card, enable)} onOpen={openTweakDestination} onUndo={(entry) => void rollbackAuditEntry(entry, { stay: true })} onReviewChanges={() => { setVerifyView('history'); setFocusedAuditId(null); setActiveTab('drift'); }} testableIds={testableIds} onTest={(tweakId) => openTest({ tweakId })} />}
    {/* Two tools that work on one program or one boot setting at a time, kept with the tweaks they belong to (2026-10-06: the
        GPU section and the Boot timing tab repeated cards already on All tweaks). */}
    {activeTab === 'startup' && optimizeView === 'all' && <div className="mt-8 space-y-4">
      {(capabilityIds.has('graphics:per-app-gpu-preference') || capabilityIds.has('graphics:fullscreen-optimizations')) && <details id="per-program-graphics" className="scroll-mt-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-5" open={tweakToolsOpen['per-program-graphics'] || undefined} onToggle={(event) => { const open = event.currentTarget.open; setTweakToolsOpen((current) => ({ ...current, 'per-program-graphics': open })); }}>
        <summary className="cursor-pointer text-sm font-semibold text-slate-100">Graphics settings for one program</summary>
        {tweakToolsOpen['per-program-graphics'] && <Suspense fallback={<p className="mt-4 text-sm text-slate-400">Loading…</p>}><div className="mt-4 space-y-6">{graphicsAdapters(snapshot).length > 1 && capabilityIds.has('graphics:per-app-gpu-preference') && <GpuPreferenceCenter onChanged={() => void loadHistory()} graphicsCards={graphicsAdapters(snapshot).map((adapter) => adapter.name)} />}{capabilityIds.has('graphics:fullscreen-optimizations') && <FullscreenOptimizationsCenter onChanged={() => void loadHistory()} />}</div></Suspense>}
      </details>}
      <details id="boot-timing" className="scroll-mt-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-5" open={tweakToolsOpen['boot-timing'] || undefined} onToggle={(event) => { const open = event.currentTarget.open; setTweakToolsOpen((current) => ({ ...current, 'boot-timing': open })); }}>
        <summary className="cursor-pointer text-sm font-semibold text-slate-100">Boot timing experiments</summary>
        {tweakToolsOpen['boot-timing'] && <div className="mt-4"><Suspense fallback={<p className="text-sm text-slate-400">Loading boot timing controls…</p>}><PerformanceLab items={timingExperiments} errors={timingErrors} loading={isTimingLoading} activeActionId={activeTimingActionId} status={timingStatus} error={timingActionError} onRefresh={loadTimingExperiments} onExecute={executeTimingExperiment} /></Suspense></div>}
      </details>
    </div>}
    {activeTab === 'startup' && optimizeView === 'startup' && <StartupCenter items={startupItems} errors={startupErrors} loading={isStartupLoading} activeItemId={activeStartupItemId} actionError={startupActionError} onRefresh={loadStartupItems} onDisable={disableStartupItem} history={history} restoringId={rollingBackId} onRestore={(entry) => void rollbackAuditEntry(entry, { stay: true })} />}
    {activeTab === 'startup' && optimizeView === 'background' && <div className="space-y-6"><GameSessionMode processes={processes} session={gameSession.session} onStart={(game, apps) => void gameSession.start(game, apps)} onEnd={(reason) => void gameSession.end(reason)} /><ProcessBalancer items={processes} errors={processErrors} loading={isProcessLoading} activeProcessId={activeProcessId} actionError={processActionError} onRefresh={loadProcesses} onEnable={enableProcessEcoQos} /></div>}
    {activeTab === 'startup' && optimizeView === 'windows' && <div className="space-y-6">{capabilityIds.has('power:switch-plan') && <PowerPlanCard onChanged={() => void loadHistory()} />}<SafePolicies policies={policies} errors={policyErrors} loading={isPolicyLoading} activePolicyId={activePolicyId} actionError={policyActionError} onRefresh={loadPolicies} onEnable={enableConsumerFeaturesPolicy} /></div>}
    {activeTab === 'startup' && optimizeView === 'maintenance' && (snapshot ? <div id="maintenance-queue" className="scroll-mt-6"><MaintenanceQueue actions={queue} activeActionId={activeActionId} error={maintenanceError} onExecute={runMaintenance} /></div> : <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 text-sm text-slate-400"><div className="flex items-center gap-2"><AlertCircle className="h-4 w-4 text-amber-300" />A verified scan is required before reviewing maintenance actions.</div><button onClick={() => setActiveTab('overview')} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-cyan-400 px-3 py-2 text-xs font-bold text-slate-950"><CheckCircle2 className="h-3.5 w-3.5" />Open Scan</button></section>)}
    </TabPanel>}
    {(activeTab === 'performance-lab' || activeTab === 'network-quality') && <TabRow<'test' | 'results' | 'network-quality'> ariaLabel="Measure views" items={[{ id: 'test', label: 'Test a change' }, { id: 'network-quality', label: 'Network' }]} value={activeTab === 'network-quality' ? 'network-quality' : measureView} onChange={(view) => { if (view === 'network-quality') setActiveTab('network-quality'); else { setMeasureView(view); setActiveTab('performance-lab'); } }} className="mb-6 flex flex-wrap gap-x-6 gap-y-2 border-b border-slate-800" />}
    {(activeTab === 'performance-lab' || activeTab === 'network-quality') && <TabPanel ariaLabel="Measure views" value={activeTab === 'network-quality' ? 'network-quality' : measureView}>
    {activeTab === 'performance-lab' && measureView === 'test' && <Suspense fallback={<p className="text-sm text-slate-400">Loading…</p>}><TestAChange tweaks={testableTweaks} history={history} snapshot={snapshot} evidence={benchmarkEvidence} prefill={testPrefill} onPrefillUsed={clearTestPrefill} onApplyTweak={applyTweakForTest} onUndoEntry={undoEntryForTest} onEvidenceChange={setBenchmarkEvidence} onImportPreview={(preview) => { setSessionContext(null); acceptNativePresentMonImport(preview); setMeasureView('results'); }} onOpenRecordings={() => setMeasureView('results')} /></Suspense>}
    {activeTab === 'performance-lab' && measureView === 'results' && <Suspense fallback={<p className="text-sm text-slate-400">Loading measurement tools…</p>}><BenchmarkEvidence snapshot={snapshot} focusedExperimentId={focusedExperimentId} sessionContext={sessionContext} evidence={benchmarkEvidence} loading={isBenchmarkLoading} error={benchmarkError} presentMonImport={presentMonImport} onRefresh={loadBenchmarkEvidence} onImport={importBenchmarkEvidence} onNativeImportPreview={(preview) => { setSessionContext(null); acceptNativePresentMonImport(preview); }} onPreparePresentMonImport={preparePresentMonImport} onCancelPresentMonImport={() => setPresentMonImport(null)} onDelete={deleteBenchmarkEvidence} /></Suspense>}
    {/* Saved tests are otherwise reached only from a finished result, which left people with
        no finished test unable to export, import or tidy up the ones they have. */}
    {activeTab === 'performance-lab' && measureView === 'test' && <details id="display-setup" className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-5" open={displaySetupOpen || undefined} onToggle={(event) => { const open = event.currentTarget.open; setDisplaySetupOpen(open); }}>
      <summary className="cursor-pointer text-sm font-semibold text-slate-100">Test a display or graphics-card setting</summary>
      {displaySetupOpen && <div className="mt-4"><Suspense fallback={<p className="text-sm text-slate-400">Loading…</p>}><DisplaySetupGuide onOpenMeasure={() => { setMeasureView('test'); setActiveTab('performance-lab'); document.getElementById('main-content')?.scrollIntoView({ block: 'start' }); }} onTest={(prefill) => openTest(prefill)} snapshot={snapshot} discovery={installedGameDiscovery} /></Suspense></div>}
    </details>}
    {activeTab === 'performance-lab' && measureView === 'test' && <p className="mt-4 text-xs text-slate-400">Export, import or tidy up earlier tests: <button type="button" className="text-cyan-300 underline underline-offset-2" onClick={() => { setSavedTestsOpen(true); setMeasureView('results'); }}>Saved tests</button></p>}
    {activeTab === 'performance-lab' && measureView === 'results' && <details open={savedTestsOpen || undefined} onToggle={(event) => setSavedTestsOpen(event.currentTarget.open)} className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-5"><summary className="cursor-pointer text-sm font-semibold text-slate-100">Saved tests: notes, decisions, export and import</summary><div className="mt-4"><ExperimentSessions history={history} evidence={benchmarkEvidence} onNavigate={(destination, evidenceId) => { if (destination === 'history') { setFocusedAuditId(evidenceId || null); setVerifyView('history'); setActiveTab('drift'); } else if (destination === 'measure') { setActiveTab('performance-lab'); } else { setOptimizeView('all'); setActiveTab('startup'); } }} onCompare={openComparison} /></div></details>}
    {activeTab === 'network-quality' && <Suspense fallback={<p className="text-sm text-slate-400">Loading connection tools…</p>}><NetworkQualityLab snapshot={snapshot} onOpenScan={() => setActiveTab('overview')} /></Suspense>}
    </TabPanel>}
    {activeTab === 'game-settings' && <><TabRow<typeof gameView> ariaLabel="Game categories" items={([['profiles', 'Profiles'], ['guides', 'Guides'], ['backups', 'Backups']] as const).map(([id, label]) => ({ id, label }))} value={gameView} onChange={setGameView} className="mb-6 flex flex-wrap gap-x-6 gap-y-2 border-b border-slate-800" /><TabPanel ariaLabel="Game categories" value={gameView}>{gameView === 'profiles' && capabilityIds.has('game:reviewed-profile') && <Suspense fallback={<p className="text-sm text-slate-400">Loading game profiles…</p>}><GameOptimizationCenter busy={isGameConfigBusy} restoreStatus={gameConfigStatus} restoreError={gameConfigError} onBusyChange={setIsGameConfigBusy} onBackupCreated={(backup) => setGameConfigBackups((items) => [backup, ...items.filter((item) => item.backupId !== backup.backupId)])} onRestore={restoreGameConfigBackup} onUndoProfile={undoGameProfile} /></Suspense>}{gameView === 'guides' && <GameSettingsCenter guides={gameSettingsGuides} loading={isGameSettingsLoading} error={gameSettingsError} onRefresh={loadGameSettingsGuides} />}{gameView === 'backups' && <GameConfigCenter mode="all" guides={gameSettingsGuides} discovery={installedGameDiscovery} backups={gameConfigBackups} loading={isGameConfigLoading} busy={isGameConfigBusy} error={gameConfigError} status={gameConfigStatus} onRefresh={loadGameConfigCenter} onBackup={createGameConfigBackup} onRestore={restoreGameConfigBackup} onUndoProfile={undoGameProfile} />}</TabPanel></>}
    {activeTab === 'input-devices' && <Suspense fallback={<p className="text-sm text-slate-400">Loading input devices…</p>}><InputDevicesCenter /></Suspense>}
    {activeTab === 'drift' && <><TabRow<typeof verifyView> ariaLabel="Restore views" items={([['history', 'History'], ['drift', 'Outside changes']] as const).map(([id, label]) => ({ id, label }))} value={verifyView} onChange={setVerifyView} className="mb-6 flex flex-wrap gap-x-6 gap-y-2 border-b border-slate-800" /><TabPanel ariaLabel="Restore views" value={verifyView}>{verifyView === 'history' && <LocalAuditHistory focusedId={focusedAuditId} entries={history} loading={isHistoryLoading} rollingBackId={rollingBackId} privacyBusy={isHistoryPrivacyBusy} privacyStatus={historyPrivacyStatus} actionError={historyActionError} recovery={historyRecovery} notices={historyNotices} recoveryBusy={isHistoryRecoveryBusy} onRefresh={loadHistory} onRetryVerification={retryAuditVerification} onRecoverCorruptJournal={recoverCorruptAuditJournal} onRollback={(entry) => void rollbackAuditEntry(entry)} onUndoAll={() => void undoAllDialedChanges()} undoAllBusy={isUndoAllBusy} onExport={exportAuditHistory} onDelete={deleteAuditHistory} />}{verifyView === 'history' && <RecoveryStepsCard />}{verifyView === 'drift' && <DriftMonitor report={driftReport} loading={isDriftLoading} error={driftError} onOpenScan={() => setActiveTab('overview')} onSetBaseline={defineDriftBaseline} />}</TabPanel></>}
  </Suspense></WorkspaceErrorBoundary></div></main></div></div></ConfirmContext.Provider>;
}
