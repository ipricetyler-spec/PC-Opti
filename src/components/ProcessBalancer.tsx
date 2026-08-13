import { AlertTriangle, Cpu, Leaf, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ManageableProcess } from '../types';

interface ProcessBalancerProps {
  items: ManageableProcess[];
  errors: Array<{ component: string; message: string }>;
  loading: boolean;
  activeProcessId: number | null;
  actionError: string | null;
  onRefresh: () => void;
  onEnable: (process: ManageableProcess) => void;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes;
  let index = -1;
  do {
    value /= 1024;
    index += 1;
  } while (value >= 1024 && index < units.length - 1);
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

export function ProcessBalancer({ items, errors, loading, activeProcessId, actionError, onRefresh, onEnable }: ProcessBalancerProps) {
  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-emerald-500/20 bg-gradient-to-r from-slate-900 via-slate-900 to-emerald-950/20 p-6 shadow-xl">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[11px] font-semibold text-emerald-300">
              <Leaf className="h-3.5 w-3.5" /> Dynamic Eco-Balance
            </div>
            <h2 className="mt-3 text-2xl font-bold text-white">Reversible background process balancing</h2>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-400">
              Apply Windows EcoQoS only to a selected non-system process in your current session. This lowers its execution-speed QoS; PC-Opti never kills, suspends, reprioritizes, or assigns CPU affinity to a process.
            </p>
          </div>
          <button onClick={onRefresh} disabled={loading} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-60">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> {loading ? 'Reading processes…' : 'Refresh process list'}
          </button>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <InfoCard icon={<ShieldCheck className="h-4 w-4 text-emerald-400" />} title="Protected scope" detail="Windows shell, input, audio, security, and core-system processes are excluded before an action can be requested." />
        <InfoCard icon={<Cpu className="h-4 w-4 text-cyan-400" />} title="Evidence shown" detail="Recent Windows per-process CPU percentage and current working-set memory are read at refresh time." />
        <InfoCard icon={<RotateCcw className="h-4 w-4 text-violet-400" />} title="Deterministic restore" detail="Each change is stored locally and can be reversed from Local Audit History while that exact process is still running." />
      </section>

      {actionError && <p className="rounded-lg border border-rose-500/30 bg-rose-950/30 p-3 text-xs text-rose-200">{actionError}</p>}
      {errors.length > 0 && <section className="rounded-2xl border border-amber-500/30 bg-amber-950/20 p-5"><div className="flex items-center gap-2 text-sm font-semibold text-amber-300"><AlertTriangle className="h-4 w-4" /> Process inventory limits</div><ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-amber-100/80">{errors.map((error) => <li key={`${error.component}-${error.message}`}>{error.component}: {error.message}</li>)}</ul></section>}

      <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70 shadow-xl">
        <div className="border-b border-slate-800 px-5 py-4">
          <h3 className="font-semibold text-slate-100">Current-session background candidates</h3>
          <p className="mt-1 text-xs text-slate-500">Ordered by recent CPU share, then working-set memory. An existing Efficiency Mode state is shown but never overwritten.</p>
        </div>
        {loading ? <div className="p-6 text-sm text-slate-400">Reading native process telemetry…</div> : items.length ? <div className="divide-y divide-slate-800">{items.map((process) => {
          const active = activeProcessId === process.pid;
          return <div key={process.pid} className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><span className="truncate text-sm font-semibold text-slate-100">{process.name}</span><span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">PID {process.pid}</span>{process.efficiencyMode && <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300"><Leaf className="h-3 w-3" />Efficiency Mode active</span>}</div>
              <p className="mt-1 text-xs text-slate-500">{process.cpuPercent}% recent CPU · {formatBytes(process.workingSetBytes)} working set</p>
            </div>
            <button onClick={() => onEnable(process)} disabled={active || process.efficiencyMode} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-emerald-400 px-3 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50">
              <Leaf className="h-3.5 w-3.5" /> {active ? 'Applying…' : process.efficiencyMode ? 'Already enabled' : 'Enable EcoQoS'}
            </button>
          </div>;
        })}</div> : <div className="p-6 text-sm text-slate-500">No eligible current-session background processes were returned. Refresh after opening a desktop application.</div>}
      </section>
    </div>
  );
}

function InfoCard({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4"><div className="flex items-center gap-2 text-xs font-semibold text-slate-300">{icon}{title}</div><p className="mt-2 text-xs leading-relaxed text-slate-500">{detail}</p></div>;
}
