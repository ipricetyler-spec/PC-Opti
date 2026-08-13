import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Database, RefreshCw } from 'lucide-react';
import { DashboardOverview } from './components/DashboardOverview';
import { LocalAuditHistory } from './components/LocalAuditHistory';
import { MaintenanceQueue } from './components/MaintenanceQueue';
import { ProcessBalancer } from './components/ProcessBalancer';
import { SafePolicies } from './components/SafePolicies';
import { Sidebar } from './components/Sidebar';
import { StartupCenter } from './components/StartupCenter';
import type { AuditJournalEntry, GroundedAiAudit, ManageableProcess, MaintenanceAction, SafeOsPolicy, StartupManagementItem, SystemScanSnapshot } from './types';

type Tab = 'overview' | 'startup' | 'balancer' | 'policies' | 'maintenance' | 'history';

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

function queueFromSnapshot(snapshot: SystemScanSnapshot | null): MaintenanceAction[] {
  if (!snapshot) return [];
  const queue: MaintenanceAction[] = [];
  if (snapshot.metrics.tempFiles.pathCount > 0) {
    queue.push({
      id: 'clear-temp-files',
      kind: 'clear-temp-files',
      title: 'Clear temporary files',
      description: 'Removes files currently found under the user TEMP and Windows Temp directories. Locked files are skipped and reported by the OS.',
      evidence: `${formatBytes(snapshot.metrics.tempFiles.totalSizeBytes)} across ${snapshot.metrics.tempFiles.pathCount.toLocaleString()} files in the verified scan.`,
      reversible: false,
    });
  }
  snapshot.metrics.storage.filter((drive) => drive.isSSD && drive.trimEnabled).forEach((drive) => {
    queue.push({
      id: `retrim-drive:${drive.driveLetter}`,
      kind: 'retrim-drive',
      title: `ReTRIM ${drive.driveLetter}:`,
      description: 'Requests Windows Optimize-Volume ReTRIM for this SSD. It is a maintenance operation, not a performance guarantee, and changes no persistent setting.',
      evidence: `${drive.driveLetter}: was identified as SSD storage and Windows reported TRIM enabled.`,
      reversible: false,
    });
  });
  return queue;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [snapshot, setSnapshot] = useState<SystemScanSnapshot | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [activeActionId, setActiveActionId] = useState<string | null>(null);
  const [maintenanceError, setMaintenanceError] = useState<string | null>(null);
  const [history, setHistory] = useState<AuditJournalEntry[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
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
  const [aiAudit, setAiAudit] = useState<GroundedAiAudit | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);

  const loadHistory = useCallback(async () => {
    if (!window.pcOptiNative) return;
    setIsHistoryLoading(true);
    try {
      setHistory(await window.pcOptiNative.getAuditHistory());
    } catch (error) {
      setMaintenanceError(error instanceof Error ? error.message : 'Could not load local audit history.');
    } finally {
      setIsHistoryLoading(false);
    }
  }, []);

  const loadStartupItems = useCallback(async () => {
    if (!window.pcOptiNative) {
      setStartupErrors([{ component: 'Startup Center', message: 'Startup management is available only in the PC-Opti Electron desktop application.' }]);
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
      setProcessErrors([{ component: 'Dynamic Eco-Balance', message: 'Process balancing is available only in the PC-Opti Electron desktop application.' }]);
      return;
    }
    setIsProcessLoading(true);
    try {
      const result = await window.pcOptiNative.listManageableProcesses();
      setProcesses(result.items);
      setProcessErrors(result.errors);
    } catch (error) {
      setProcessErrors([{ component: 'Dynamic Eco-Balance', message: error instanceof Error ? error.message : 'Could not read the current Windows process inventory.' }]);
    } finally {
      setIsProcessLoading(false);
    }
  }, []);

  const loadPolicies = useCallback(async () => {
    if (!window.pcOptiNative) {
      setPolicyErrors([{ component: 'Safe OS policies', message: 'Policy management is available only in the PC-Opti Electron desktop application.' }]);
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

  const runScan = useCallback(async () => {
    if (!window.pcOptiNative) {
      setScanError('Verified system scans are available only in the PC-Opti Electron desktop application. No browser fallback is shown.');
      return;
    }
    setIsScanning(true);
    setScanError(null);
    setAiAudit(null);
      setAiError(null);
    try {
      setSnapshot(await window.pcOptiNative.scanSystem());
      await loadStartupItems();
    } catch (error) {
      setScanError(error instanceof Error ? error.message : 'The Windows telemetry scan could not be completed.');
    } finally {
      setIsScanning(false);
    }
  }, [loadStartupItems]);

  useEffect(() => {
    void runScan();
    void loadHistory();
  }, [loadHistory, runScan]);

  useEffect(() => {
    if (activeTab === 'balancer') void loadProcesses();
    if (activeTab === 'policies') void loadPolicies();
  }, [activeTab, loadPolicies, loadProcesses]);

  const queue = useMemo(() => queueFromSnapshot(snapshot), [snapshot]);

  const runMaintenance = async (action: MaintenanceAction) => {
    if (!window.pcOptiNative || activeActionId) return;
    const confirmed = window.confirm(`${action.title}\n\n${action.description}\n\nScan evidence: ${action.evidence}\n\nThis action is not reversible. Run it now?`);
    if (!confirmed) return;

    setActiveActionId(action.id);
    setMaintenanceError(null);
    try {
      const result = await window.pcOptiNative.executeMaintenance(action.id);
      await loadHistory();
      if (!result.success) {
        setMaintenanceError(result.error || 'Windows reported that the maintenance action did not complete. See Local Audit History for details.');
        return;
      }
      await runScan();
      setActiveTab('history');
    } catch (error) {
      setMaintenanceError(error instanceof Error ? error.message : 'The maintenance action could not be started.');
    } finally {
      setActiveActionId(null);
    }
  };

  const runAiAudit = async () => {
    if (!snapshot || isAiLoading) return;
    setIsAiLoading(true);
    setAiError(null);
    setAiAudit(null);
    try {
      if (!window.pcOptiNative) {
        throw new Error('Grounded AI audits are available only in the PC-Opti Electron desktop application.');
      }
      setAiAudit(await window.pcOptiNative.runAiAudit());
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'The AI audit could not be completed.');
    } finally {
      setIsAiLoading(false);
    }
  };

  const disableStartupItem = async (item: StartupManagementItem) => {
    if (!window.pcOptiNative || activeStartupItemId) return;
    const confirmed = window.confirm(
      `Disable at sign-in: ${item.name}\n\nWindows command: ${item.path || 'not returned'}\n\nPC-Opti will remove only this current-user Registry Run value and save its exact previous value for rollback. Continue?`
    );
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
      setActiveTab('history');
    } catch (error) {
      setStartupActionError(error instanceof Error ? error.message : 'The startup item could not be changed.');
    } finally {
      setActiveStartupItemId(null);
    }
  };

  const enableProcessEcoQos = async (process: ManageableProcess) => {
    if (!window.pcOptiNative || activeProcessId) return;
    const confirmed = window.confirm(
      `Enable EcoQoS: ${process.name} (PID ${process.pid})\n\nWindows will apply the execution-speed power-throttling flag to this single process. It will not be closed, suspended, or assigned CPU cores.\n\nThe exact pre-action state will be kept in Local Audit History for rollback while the process remains running. Continue?`
    );
    if (!confirmed) return;

    setActiveProcessId(process.pid);
    setProcessActionError(null);
    try {
      const result = await window.pcOptiNative.enableProcessEcoQos(process.pid);
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
    const confirmed = window.confirm(
      `${policy.title}\n\nThis applies the documented Windows policy DisableWindowsConsumerFeatures = 1. It prevents Windows from automatically installing sponsored consumer apps; it does not remove Windows Store, Windows Update, Defender, or installed apps.\n\nPC-Opti will request a System Restore checkpoint first. If that request errors, no policy will be applied. The exact prior policy state will be stored locally for rollback. Continue?`
    );
    if (!confirmed) return;

    setActivePolicyId(policy.id);
    setPolicyActionError(null);
    try {
      const result = await window.pcOptiNative.enableConsumerFeaturesPolicy();
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

  const rollbackAuditEntry = async (entry: AuditJournalEntry) => {
    if (!window.pcOptiNative || rollingBackId) return;
    const confirmed = window.confirm(`Restore: ${entry.title}\n\n${entry.rollback.reason}\n\nContinue?`);
    if (!confirmed) return;

    setRollingBackId(entry.id);
    try {
      const result = await window.pcOptiNative.rollbackAuditEntry(entry.id);
      await loadHistory();
      if (!result.success) {
        setStartupActionError(result.error || 'Windows reported that the rollback did not complete.');
        return;
      }
      await runScan();
      setActiveTab('history');
    } catch (error) {
      setStartupActionError(error instanceof Error ? error.message : 'The startup rollback could not be completed.');
    } finally {
      setRollingBackId(null);
    }
  };

  return <div className="min-h-screen bg-[#0a0b0d] text-slate-200"><div className="flex min-h-screen flex-col lg:flex-row"><Sidebar activeTab={activeTab} onChange={setActiveTab} /><main className="min-w-0 flex-1"><header className="flex flex-col justify-between gap-3 border-b border-slate-800 bg-[#0d0f13]/80 px-6 py-4 backdrop-blur sm:flex-row sm:items-center"><div><p className="text-xs font-semibold uppercase tracking-wider text-cyan-400">Local-first Windows maintenance</p><p className="mt-0.5 text-xs text-slate-500">Native telemetry, explicit actions, honest outcomes.</p></div><div className="flex items-center gap-2 text-xs text-slate-400"><Database className="h-3.5 w-3.5 text-cyan-400" />Local Audit History · no cloud sync</div></header><div className="mx-auto w-full max-w-7xl p-5 sm:p-7">
    {activeTab === 'overview' && <DashboardOverview snapshot={snapshot} isScanning={isScanning} scanError={scanError} aiAudit={aiAudit} aiError={aiError} isAiLoading={isAiLoading} onScan={runScan} onRunAiAudit={runAiAudit} />}
    {activeTab === 'startup' && <StartupCenter items={startupItems} errors={startupErrors} loading={isStartupLoading} activeItemId={activeStartupItemId} actionError={startupActionError} onRefresh={loadStartupItems} onDisable={disableStartupItem} />}
    {activeTab === 'balancer' && <ProcessBalancer items={processes} errors={processErrors} loading={isProcessLoading} activeProcessId={activeProcessId} actionError={processActionError} onRefresh={loadProcesses} onEnable={enableProcessEcoQos} />}
    {activeTab === 'policies' && <SafePolicies policies={policies} errors={policyErrors} loading={isPolicyLoading} activePolicyId={activePolicyId} actionError={policyActionError} onRefresh={loadPolicies} onEnable={enableConsumerFeaturesPolicy} />}
    {activeTab === 'maintenance' && (snapshot ? <MaintenanceQueue actions={queue} activeActionId={activeActionId} error={maintenanceError} onExecute={runMaintenance} /> : <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 text-sm text-slate-400"><div className="flex items-center gap-2"><AlertCircle className="h-4 w-4 text-amber-300" />Run a verified scan before reviewing maintenance actions.</div><button onClick={runScan} disabled={isScanning} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-cyan-400 px-3 py-2 text-xs font-bold text-slate-950"><RefreshCw className={`h-3.5 w-3.5 ${isScanning ? 'animate-spin' : ''}`} />{isScanning ? 'Scanning…' : 'Run verified scan'}</button></section>)}
    {activeTab === 'history' && <LocalAuditHistory entries={history} loading={isHistoryLoading} rollingBackId={rollingBackId} onRefresh={loadHistory} onRollback={rollbackAuditEntry} />}
  </div></main></div></div>;
}
