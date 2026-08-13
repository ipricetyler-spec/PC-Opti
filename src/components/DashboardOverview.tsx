import { AlertTriangle, Bot, Cpu, Database, HardDrive, RefreshCw, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import type { GroundedAiAudit, SystemScanSnapshot } from '../types';

interface DashboardOverviewProps {
  snapshot: SystemScanSnapshot | null;
  isScanning: boolean;
  scanError: string | null;
  aiAudit: GroundedAiAudit | null;
  aiError: string | null;
  isAiLoading: boolean;
  onScan: () => void;
  onRunAiAudit: () => void;
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
  aiAudit,
  aiError,
  isAiLoading,
  onScan,
  onRunAiAudit,
}: DashboardOverviewProps) {
  if (!snapshot) {
    return (
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-8 text-center shadow-xl">
        <ShieldCheck className="mx-auto h-10 w-10 text-cyan-400" />
        <h2 className="mt-4 text-xl font-bold text-slate-100">Start with a verified system scan</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-slate-400">
          PC-Opti reads Windows telemetry in the Electron main process. It does not invent temperatures, performance scores, installed games, or maintenance results.
        </p>
        {scanError && <p className="mx-auto mt-4 max-w-xl rounded-lg border border-rose-500/30 bg-rose-950/30 p-3 text-xs text-rose-200">{scanError}</p>}
        <button onClick={onScan} disabled={isScanning} className="mt-6 inline-flex items-center gap-2 rounded-lg bg-cyan-400 px-4 py-2.5 text-sm font-bold text-slate-950 disabled:opacity-60">
          <RefreshCw className={`h-4 w-4 ${isScanning ? 'animate-spin' : ''}`} />
          {isScanning ? 'Scanning Windows telemetry…' : 'Run verified scan'}
        </button>
      </section>
    );
  }

  const memoryUsed = Math.max(0, snapshot.metrics.memory.totalBytes - snapshot.metrics.memory.freeBytes);
  const memoryPressure = snapshot.metrics.memory.loadPercentage >= 90 ? 'critical' : snapshot.metrics.memory.loadPercentage >= 80 ? 'elevated' : 'normal';
  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-cyan-500/20 bg-gradient-to-r from-slate-900 via-slate-900 to-cyan-950/20 p-6 shadow-xl">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold text-cyan-300">
              <ShieldCheck className="h-3.5 w-3.5" /> Scan verified via native OS telemetry
            </div>
            <h2 className="mt-3 text-2xl font-bold text-white">System diagnostic</h2>
            <p className="mt-1 text-sm text-slate-400">
              Completed {new Date(snapshot.timestamp).toLocaleString()} in {snapshot.metadata.executionTimeMs.toLocaleString()} ms
              {snapshot.metadata.elevated ? ' with administrator rights.' : ' without administrator rights.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={onScan} disabled={isScanning} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-60">
              <RefreshCw className={`h-3.5 w-3.5 ${isScanning ? 'animate-spin' : ''}`} /> {isScanning ? 'Scanning…' : 'Scan again'}
            </button>
            <button onClick={onRunAiAudit} disabled={isAiLoading || isScanning} className="inline-flex items-center gap-2 rounded-lg bg-cyan-400 px-3.5 py-2 text-xs font-bold text-slate-950 disabled:opacity-60">
              <Bot className={`h-3.5 w-3.5 ${isAiLoading ? 'animate-pulse' : ''}`} /> {isAiLoading ? 'Auditing…' : 'Grounded AI audit'}
            </button>
          </div>
        </div>
      </section>

      {scanError && <p className="rounded-lg border border-rose-500/30 bg-rose-950/30 p-3 text-xs text-rose-200">Latest scan error: {scanError}</p>}

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Metric icon={<Cpu className="h-4 w-4 text-cyan-400" />} label="Processor" value={snapshot.metrics.cpu.name} detail={`${snapshot.metrics.cpu.cores} cores · ${snapshot.metrics.cpu.logicalProcessors} logical processors`} />
        <Metric icon={<Database className="h-4 w-4 text-emerald-400" />} label="Memory" value={`${snapshot.metrics.memory.loadPercentage}% in use`} detail={`${formatBytes(memoryUsed)} used of ${formatBytes(snapshot.metrics.memory.totalBytes)}`} />
        <Metric icon={<HardDrive className="h-4 w-4 text-violet-400" />} label="Startup items" value={`${snapshot.metrics.startupItems.length} detected`} detail="Registry and logon/startup scheduled tasks" />
        <Metric icon={<Database className="h-4 w-4 text-amber-400" />} label="Temporary files" value={formatBytes(snapshot.metrics.tempFiles.totalSizeBytes)} detail={`${snapshot.metrics.tempFiles.pathCount.toLocaleString()} files in Windows temp locations`} />
      </section>

      <section className={`rounded-2xl border p-5 ${memoryPressure === 'critical' ? 'border-rose-500/30 bg-rose-950/20' : memoryPressure === 'elevated' ? 'border-amber-500/30 bg-amber-950/20' : 'border-emerald-500/20 bg-emerald-950/10'}`}>
        <div className="flex gap-3"><AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${memoryPressure === 'critical' ? 'text-rose-300' : memoryPressure === 'elevated' ? 'text-amber-300' : 'text-emerald-300'}`} /><div><h3 className="text-sm font-semibold text-slate-100">{memoryPressure === 'critical' ? 'Critical memory pressure detected' : memoryPressure === 'elevated' ? 'Elevated memory pressure detected' : 'Memory pressure is currently normal'}</h3><p className="mt-1 text-xs leading-relaxed text-slate-400">{memoryPressure === 'critical' ? `Windows reports ${snapshot.metrics.memory.loadPercentage}% physical-memory use. Before launching a demanding workload, close or selectively EcoQoS non-critical background apps; PC-Opti will not flush RAM because cached memory is useful to Windows.` : memoryPressure === 'elevated' ? `Windows reports ${snapshot.metrics.memory.loadPercentage}% physical-memory use. Review current-session background workloads if you notice stutter; no intervention is automatically applied.` : `${formatBytes(snapshot.metrics.memory.freeBytes)} physical memory is currently available to Windows. No memory-management action is recommended.`}</p></div></div>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 xl:col-span-3">
          <h3 className="font-semibold text-slate-100">Storage volumes</h3>
          <div className="mt-4 space-y-3">
            {snapshot.metrics.storage.map((drive) => {
              const percentFree = drive.totalBytes ? Math.round((drive.freeBytes / drive.totalBytes) * 100) : 0;
              return <div key={drive.driveLetter} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <div className="flex items-center justify-between gap-3 text-sm"><span className="font-medium text-slate-200">{drive.driveLetter}: {drive.label || 'Local disk'}</span><span className="text-xs text-slate-400">{formatBytes(drive.freeBytes)} free / {formatBytes(drive.totalBytes)}</span></div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800"><div className="h-full bg-violet-400" style={{ width: `${percentFree}%` }} /></div>
                <div className="mt-2 flex gap-2 text-[11px]"><span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-400">{drive.isSSD ? 'SSD' : 'Storage media unconfirmed'}</span><span className={`rounded px-1.5 py-0.5 ${drive.trimEnabled ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}>TRIM {drive.trimEnabled ? 'enabled' : 'not confirmed'}</span></div>
              </div>;
            })}
            {snapshot.metrics.storage.length === 0 && <p className="text-sm text-slate-500">No fixed Windows volumes were returned by the scan.</p>}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 xl:col-span-2">
          <h3 className="font-semibold text-slate-100">Scan scope</h3>
          <dl className="mt-4 space-y-3 text-xs"><Detail label="Operating system" value={`${snapshot.metrics.os.caption} (${snapshot.metrics.os.build})`} /><Detail label="Architecture" value={snapshot.metrics.os.architecture} /><Detail label="Startup sources" value="Registry and Task Scheduler" /><Detail label="Device identifier" value={`${snapshot.deviceHash.slice(0, 12)}… (hashed locally)`} /></dl>
        </div>
      </section>

      {(snapshot.metadata.errors.length > 0 || aiError) && <section className="rounded-2xl border border-amber-500/30 bg-amber-950/20 p-5"><div className="flex gap-2 text-sm font-semibold text-amber-300"><AlertTriangle className="h-4 w-4" /> Limits and errors</div><ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-amber-100/80">{snapshot.metadata.errors.map((error) => <li key={`${error.component}-${error.message}`}>{error.component}: {error.message}</li>)}{aiError && <li>AI audit: {aiError}</li>}</ul></section>}

      {aiAudit && <AiAudit audit={aiAudit} timestamp={snapshot.timestamp} />}
    </div>
  );
}

function Metric({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string; detail: string }) {
  return <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4"><div className="flex items-center gap-2 text-xs font-medium text-slate-400">{icon}{label}</div><div className="mt-3 truncate text-base font-bold text-slate-100" title={value}>{value}</div><p className="mt-1 text-[11px] text-slate-500">{detail}</p></div>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-4"><dt className="text-slate-500">{label}</dt><dd className="max-w-[65%] text-right text-slate-300">{value}</dd></div>;
}

function AiAudit({ audit, timestamp }: { audit: GroundedAiAudit; timestamp: string }) {
  return <section className="rounded-2xl border border-cyan-500/25 bg-cyan-950/10 p-5"><div className="flex items-center gap-2 text-sm font-semibold text-cyan-300"><Bot className="h-4 w-4" /> Grounded AI audit</div><p className="mt-1 text-xs text-slate-500">AI inferences based only on the scan captured {new Date(timestamp).toLocaleString()}; they are not OS telemetry.</p><div className="mt-4 grid gap-4 lg:grid-cols-2"><AuditList title="Verified facts" items={audit.facts} /><AuditList title="AI inferences" items={audit.inferences} /><AuditList title="Recommendations" items={audit.recommendations.map((item) => `${item.title}: ${item.rationale}`)} /><AuditList title="Limitations" items={audit.limitations} /></div></section>;
}

function AuditList({ title, items }: { title: string; items: string[] }) {
  return <div><h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h4>{items.length ? <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-slate-300">{items.map((item, index) => <li key={`${title}-${index}`} className="rounded bg-slate-950/50 p-2">{item}</li>)}</ul> : <p className="mt-2 text-xs text-slate-500">None returned.</p>}</div>;
}
