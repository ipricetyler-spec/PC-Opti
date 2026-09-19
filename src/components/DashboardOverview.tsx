import { partName } from '../lib/friendlyError';
import { ErrorText } from './ErrorText';
import { AlertTriangle, Cpu, Database, HardDrive, RefreshCw, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import type { DriftReport, LocalRecommendation, SystemScanSnapshot } from '../types';
import { plainLabel } from '../lib/plainLabels';
import { ExpandedDiagnostics } from './ExpandedDiagnostics';
import { RecommendationsPanel } from './RecommendationsPanel';
import { ShowDetails } from './ShowDetails';

interface DashboardOverviewProps {
  snapshot: SystemScanSnapshot | null;
  isScanning: boolean;
  scanError: string | null;
  recommendations: LocalRecommendation[];
  recommendationError: string | null;
  onScan: () => void;
  onNavigateRecommendation: (target: LocalRecommendation['targetPanel']) => void;
  driftReport?: DriftReport | null;
  onOpenChanges?: () => void;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = -1;
  do {
    value /= 1024;
    index += 1;
  } while (value >= 1024 && index < units.length - 1);
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

export function DashboardOverview({
  snapshot,
  isScanning,
  scanError,
  recommendations,
  recommendationError,
  onScan,
  onNavigateRecommendation,
  driftReport = null,
  onOpenChanges,
}: DashboardOverviewProps) {
  if (!snapshot) {
    return (
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-8 text-center shadow-xl">
        <ShieldCheck className="mx-auto h-10 w-10 text-cyan-400" />
        <h2 className="mt-4 text-xl font-bold text-slate-100">Start by scanning this PC</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-slate-400">
          Dialed reads Windows telemetry in the Electron main process. It does not invent temperatures, performance scores, installed games, or maintenance results.
        </p>
        {scanError && <p className="mx-auto mt-4 max-w-xl rounded-lg border border-rose-500/30 bg-rose-950/30 p-3 text-xs text-rose-200"><ErrorText text={scanError} /></p>}
        <button onClick={onScan} disabled={isScanning} className="mt-6 inline-flex items-center gap-2 rounded-lg bg-cyan-400 px-4 py-2.5 text-sm font-bold text-slate-950 disabled:opacity-60">
          <RefreshCw className={`h-4 w-4 ${isScanning ? 'animate-spin' : ''}`} />
          {isScanning ? 'Scanning…' : 'Scan this PC'}
        </button>
      </section>
    );
  }

  const cpu = snapshot.metrics.cpu.status === 'AVAILABLE' ? snapshot.metrics.cpu.value : null;
  const memory = snapshot.metrics.memory.status === 'AVAILABLE' ? snapshot.metrics.memory.value : null;
  const storage = snapshot.metrics.storage.status === 'AVAILABLE' ? snapshot.metrics.storage.value : null;
  const memoryUsed = memory ? Math.max(0, memory.totalBytes - memory.freeBytes) : null;
  const memoryPressure = !memory ? 'unavailable' : memory.loadPercentage >= 90 ? 'critical' : memory.loadPercentage >= 80 ? 'elevated' : 'normal';
  const evidenceGaps = snapshot.metadata.errors.length;
  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-cyan-500/20 bg-gradient-to-r from-slate-900 via-slate-900 to-cyan-950/20 p-6 shadow-xl">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold text-cyan-300">
              <ShieldCheck className="h-3.5 w-3.5" /> Scan
            </div>
            <h2 className="mt-3 text-2xl font-bold text-white">This PC</h2>
            <p data-technical-detail className="mt-1 text-sm text-slate-400">
              Completed {new Date(snapshot.timestamp).toLocaleString()} in {snapshot.metadata.executionTimeMs.toLocaleString()} ms
              {snapshot.metadata.elevated ? ' with administrator rights.' : ' without administrator rights.'}
            </p>
          </div>
          <button onClick={onScan} disabled={isScanning} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-60">
            <RefreshCw className={`h-3.5 w-3.5 ${isScanning ? 'animate-spin' : ''}`} /> {isScanning ? 'Scanning…' : 'Scan again'}
          </button>
        </div>
        <div role="status" aria-live="polite" className={`mt-4 flex items-start gap-2 rounded-xl border p-3 text-xs ${isScanning ? 'border-cyan-400/30 bg-cyan-400/10 text-cyan-100' : scanError ? 'border-rose-500/30 bg-rose-950/25 text-rose-100' : evidenceGaps ? 'border-amber-500/30 bg-amber-950/20 text-amber-100' : 'border-emerald-500/30 bg-emerald-950/20 text-emerald-100'}`}>
          {isScanning ? <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 animate-spin" /> : scanError || evidenceGaps ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />}
          <div><p className="font-semibold">{isScanning ? 'Scanning…' : scanError ? 'The last scan did not finish' : evidenceGaps ? `Scan finished; ${evidenceGaps} item${evidenceGaps === 1 ? '' : 's'} could not be read` : 'Scan finished'}</p><p className="mt-1 opacity-80">{isScanning ? 'Reading this PC. Your previous results stay until the scan finishes.' : scanError ? `Showing the scan from ${new Date(snapshot.timestamp).toLocaleString()}. ${scanError}` : `Scanned ${new Date(snapshot.timestamp).toLocaleString()}.${evidenceGaps ? ' Items that could not be read are listed under Limits and errors.' : ''}`}</p></div>
        </div>
      </section>

      <ChangesSinceBaseline report={driftReport} onOpenChanges={onOpenChanges} />

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Metric icon={<Cpu className="h-4 w-4 text-cyan-400" />} label="Processor" value={cpu?.name ?? snapshot.metrics.cpu.status.replaceAll('_', ' ')} detail={snapshot.metrics.cpu.status === 'AVAILABLE' ? `${snapshot.metrics.cpu.value.cores} cores · ${snapshot.metrics.cpu.value.logicalProcessors} logical processors` : snapshot.metrics.cpu.reason} />
        <Metric icon={<Database className="h-4 w-4 text-emerald-400" />} label="Memory" value={memory ? `${memory.loadPercentage}% in use` : snapshot.metrics.memory.status.replaceAll('_', ' ')} detail={snapshot.metrics.memory.status === 'AVAILABLE' && memoryUsed !== null ? `${formatBytes(memoryUsed)} used of ${formatBytes(snapshot.metrics.memory.value.totalBytes)}` : snapshot.metrics.memory.status !== 'AVAILABLE' ? snapshot.metrics.memory.reason : 'Memory use was not calculated.'} />
        <Metric icon={<HardDrive className="h-4 w-4 text-violet-400" />} label="Startup items" value={`${snapshot.metrics.startupItems.length} detected`} detail="Programs set to start with Windows" />
        <Metric icon={<Database className="h-4 w-4 text-amber-400" />} label="Temporary files" value={formatBytes(snapshot.metrics.tempFiles.totalSizeBytes)} detail={`${snapshot.metrics.tempFiles.pathCount.toLocaleString()} files in Windows temp locations`} />
      </section>

      <section className={`rounded-2xl border p-5 ${memoryPressure === 'critical' ? 'border-rose-500/30 bg-rose-950/20' : memoryPressure === 'normal' ? 'border-emerald-500/20 bg-emerald-950/10' : 'border-amber-500/30 bg-amber-950/20'}`}>
        <div className="flex gap-3"><AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${memoryPressure === 'critical' ? 'text-rose-300' : memoryPressure === 'normal' ? 'text-emerald-300' : 'text-amber-300'}`} /><div><h3 className="text-sm font-semibold text-slate-100">{memoryPressure === 'critical' ? 'Memory is almost full' : memoryPressure === 'elevated' ? 'Memory use is high' : memoryPressure === 'normal' ? 'Memory use is normal' : 'Memory use could not be read'}</h3><p className="mt-1 text-xs leading-relaxed text-slate-400">{memoryPressure === 'critical' ? `${memory?.loadPercentage}% of memory is in use. Close background apps you do not need before playing, or put them in efficiency mode. Dialed does not "clear RAM"; Windows uses spare memory as a cache on purpose.` : memoryPressure === 'elevated' ? `${memory?.loadPercentage}% of memory is in use. If games stutter, check which background apps are running.` : memoryPressure === 'normal' && memory ? `${formatBytes(memory.freeBytes)} free. Nothing to do.` : snapshot.metrics.memory.status !== 'AVAILABLE' ? snapshot.metrics.memory.reason : 'Windows did not report memory use.'}</p></div></div>
      </section>

      <section id="storage-volumes" className="grid scroll-mt-5 grid-cols-1 gap-4 xl:grid-cols-5">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 xl:col-span-3">
          <h3 className="font-semibold text-slate-100">Storage volumes</h3>
          <div className="mt-4 space-y-3">
            {storage?.map((drive) => {
              const percentFree = drive.totalBytes ? Math.round((drive.freeBytes / drive.totalBytes) * 100) : 0;
              return <div key={drive.driveLetter} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <div className="flex items-center justify-between gap-3 text-sm"><span className="font-medium text-slate-200">{drive.driveLetter}: {drive.label || 'Local disk'}</span><span className="text-xs text-slate-400">{formatBytes(drive.freeBytes)} free / {formatBytes(drive.totalBytes)}</span></div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800"><div className="h-full bg-violet-400" style={{ width: `${percentFree}%` }} /></div>
                <div className="mt-2 flex gap-2 text-[11px]"><span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-400">{drive.isSSD ? 'SSD' : 'Drive type unknown'}</span><span className={`rounded px-1.5 py-0.5 ${drive.trimEnabled ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}>TRIM {drive.trimEnabled ? 'enabled' : 'not confirmed'}</span></div>
              </div>;
            })}
            {storage?.length === 0 && <p className="text-sm text-slate-500">No drives were found.</p>}
            {snapshot.metrics.storage.status !== 'AVAILABLE' && <p className="rounded-lg border border-amber-500/20 bg-amber-950/10 p-3 text-sm text-amber-100/80">{snapshot.metrics.storage.status.replaceAll('_', ' ')}: {snapshot.metrics.storage.reason}</p>}
          </div>
        </div>
        <div data-technical-detail className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 xl:col-span-2">
          <h3 className="font-semibold text-slate-100">Scan scope</h3>
          <dl className="mt-4 space-y-3 text-xs"><Detail label="Operating system" value={`${snapshot.metrics.os.caption} (${snapshot.metrics.os.build})`} /><Detail label="Architecture" value={snapshot.metrics.os.architecture} /><Detail label="Startup sources" value="Startup programs and scheduled tasks" /><Detail label="Device identifier" value={`${snapshot.deviceHash.slice(0, 12)}… (hashed locally)`} /></dl>
        </div>
      </section>

      <div data-technical-detail id="expanded-diagnostics" className="scroll-mt-5"><ExpandedDiagnostics diagnostics={snapshot.diagnostics} /></div>

      <ShowDetails label={`All suggestions (${recommendations.filter((item) => item.actionStatus !== 'NO_ACTION').length})`} defaultOpen={Boolean(recommendationError)}><RecommendationsPanel recommendations={recommendations} error={recommendationError} onNavigate={onNavigateRecommendation} /></ShowDetails>

      {snapshot.metadata.errors.length > 0 && <section className="rounded-2xl border border-amber-500/30 bg-amber-950/20 p-5"><div className="flex gap-2 text-sm font-semibold text-amber-300"><AlertTriangle className="h-4 w-4" /> Items that could not be read</div><ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-amber-100/80">{snapshot.metadata.errors.map((error) => <li key={`${error.component}-${error.message}`}>{partName(error.component)}: <ErrorText text={error.message} /></li>)}</ul></section>}
    </div>
  );
}

function ChangesSinceBaseline({ report, onOpenChanges }: { report: DriftReport | null; onOpenChanges?: () => void }) {
  if (!report) return null;
  const changes = report.changes;
  const since = report.baseline ? new Date(report.baseline.createdAt).toLocaleDateString() : null;
  return <section aria-label="What changed since your snapshot" className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-100">What changed since your snapshot</h3>
        <p className="mt-1 text-xs text-slate-400">{!since ? 'No snapshot saved yet. Save one to spot new startup apps, driver updates and changed settings after Windows or game updates.' : changes.length === 0 ? `Nothing has changed since ${since}.` : `${changes.length} change${changes.length === 1 ? '' : 's'} since ${since}.`}</p>
      </div>
      {onOpenChanges && <button type="button" onClick={onOpenChanges} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700">{since ? 'Review changes' : 'Save snapshot'}</button>}
    </div>
    {changes.length > 0 && <ul className="mt-3 grid gap-2 md:grid-cols-2">{changes.slice(0, 6).map((change) => <li key={change.path} className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs"><span className="min-w-0 truncate text-slate-200">{change.label}</span><span className="shrink-0 rounded bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-300">{plainLabel(change.kind)}</span></li>)}</ul>}
    {changes.length > 6 && <p className="mt-2 text-[11px] text-slate-500">and {changes.length - 6} more</p>}
  </section>;
}

function Metric({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string; detail: string }) {
  return <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4"><div className="flex items-center gap-2 text-xs font-medium text-slate-400">{icon}{label}</div><div className="mt-3 truncate text-base font-bold text-slate-100" title={value}>{value}</div><p data-technical-detail className="mt-1 text-[11px] text-slate-500">{detail}</p></div>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-4"><dt className="text-slate-500">{label}</dt><dd className="max-w-[65%] text-right text-slate-300">{value}</dd></div>;
}
