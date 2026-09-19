import { partName } from '../lib/friendlyError';
import { ErrorText } from './ErrorText';
import { AlertTriangle, Cpu, Filter, Leaf, RefreshCw, RotateCcw, Search, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { ManageableProcess } from '../types';
import { ShowDetails } from './ShowDetails';

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
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'throttled' | 'eligible'>('all');
  const [sortMode, setSortMode] = useState<'name' | 'cpu' | 'memory'>('cpu');

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const rows = items.filter((process) => {
      if (statusFilter === 'throttled' && !process.efficiencyMode) return false;
      if (statusFilter === 'eligible' && process.efficiencyMode) return false;
      if (!normalizedQuery) return true;
      return process.name.toLowerCase().includes(normalizedQuery) || `${process.pid}`.includes(normalizedQuery);
    });

    if (sortMode === 'name') rows.sort((left, right) => left.name.localeCompare(right.name));
    else if (sortMode === 'memory') rows.sort((left, right) => right.workingSetBytes - left.workingSetBytes);
    else rows.sort((left, right) => (right.cpuPercent ?? -1) - (left.cpuPercent ?? -1));
    return rows;
  }, [items, query, sortMode, statusFilter]);

  const resetFilters = () => {
    setQuery('');
    setStatusFilter('all');
    setSortMode('cpu');
  };

  return (
    <div id="process-balancer" className="scroll-mt-6 space-y-6">
      <section className="rounded-2xl border border-emerald-500/20 bg-gradient-to-r from-slate-900 via-slate-900 to-emerald-950/20 p-6 shadow-xl">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[11px] font-semibold text-emerald-300">
              <Leaf className="h-3.5 w-3.5" /> Background apps
            </div>
            <h2 className="mt-3 text-2xl font-bold text-white">Slow down background apps</h2>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-400">
              Efficiency mode (EcoQoS) asks Windows to run an app on slower, low-power processor cores, leaving more room for your game. The app itself may run slower. It lasts until the app closes, and Dialed never closes, pauses or reprioritises anything.
            </p>
          </div>
          <button onClick={onRefresh} disabled={loading} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-60">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> {loading ? 'Reading…' : 'Refresh'}
          </button>
        </div>
      </section>

      <ShowDetails label="How this works: what is protected, what the numbers mean, how to undo">
      <section className="grid gap-4 lg:grid-cols-3">
        <InfoCard icon={<ShieldCheck className="h-4 w-4 text-emerald-400" />} title="Always protected" detail="Windows itself, input, audio and anti-cheat programs are never offered. Security software may not all be on that list, so check each name before slowing it down." />
        <InfoCard icon={<Cpu className="h-4 w-4 text-cyan-400" />} title="What the numbers mean" detail="Recent CPU use and memory for each app, read when you refresh." />
        <InfoCard icon={<RotateCcw className="h-4 w-4 text-violet-400" />} title="How to undo it" detail="Open Restore › Recovery & history. Each change is recorded and can be undone while that program is still running." />
      </section>
      </ShowDetails>

      {actionError && <p className="rounded-lg border border-rose-500/30 bg-rose-950/30 p-3 text-xs text-rose-200"><ErrorText text={actionError} /></p>}
      {errors.length > 0 && <section className="rounded-2xl border border-amber-500/30 bg-amber-950/20 p-5"><div className="flex items-center gap-2 text-sm font-semibold text-amber-300"><AlertTriangle className="h-4 w-4" /> Some programs could not be read</div><ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-amber-100/80">{errors.map((error) => <li key={`${error.component}-${error.message}`}>{partName(error.component)}: <ErrorText text={error.message} /></li>)}</ul></section>}

      <section className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-4 text-xs leading-relaxed text-amber-100/80">
        <div className="flex items-center gap-2 font-semibold text-amber-300"><AlertTriangle className="h-4 w-4" /> Background processes only</div>
        <p className="mt-2">Never use this on a game or launcher; it would slow the game down. Dialed cannot always tell which apps are games, so check each name. Game session above is safer: it never touches the game you pick.</p>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70 shadow-xl">
        <div className="border-b border-slate-800 px-5 py-4">
          <h3 className="font-semibold text-slate-100">Running apps</h3>
          <p className="mt-1 text-xs text-slate-500">Apps already in efficiency mode are shown and left as they are.</p>
        </div>
        <div className="border-b border-slate-800/80 bg-slate-950/30 px-4 py-3 text-xs">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2 rounded border border-slate-700 bg-slate-900/50 px-2 py-1.5 text-slate-300">
              <Search className="h-3.5 w-3.5 text-slate-400" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search apps" className="w-64 bg-transparent outline-none placeholder:text-slate-500" />
            </label>
            <label className="text-[11px] text-slate-400">
              <div className="mb-1 flex items-center gap-1"><Filter className="h-3 w-3" /> View</div>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | 'throttled' | 'eligible')} className="rounded border border-slate-700 bg-slate-900/50 px-2 py-1 text-xs text-slate-100">
                <option value="all">All processes</option>
                <option value="eligible">Eligible</option>
                <option value="throttled">Already in efficiency mode</option>
              </select>
            </label>
            <label className="text-[11px] text-slate-400">
              <div className="mb-1">Sort</div>
              <select value={sortMode} onChange={(event) => setSortMode(event.target.value as 'name' | 'cpu' | 'memory')} className="rounded border border-slate-700 bg-slate-900/50 px-2 py-1 text-xs text-slate-100">
                <option value="cpu">CPU (high→low)</option>
                <option value="memory">Memory (high→low)</option>
                <option value="name">Name A→Z</option>
              </select>
            </label>
            <button onClick={resetFilters} className="rounded-lg border border-slate-700 bg-slate-900/50 px-2 py-1.5 text-[11px] text-slate-300">Reset</button>
          </div>
          <p role="status" aria-live="polite" aria-atomic="true" className="text-slate-500">Showing <span className="font-semibold text-slate-200">{filteredItems.length}</span> of <span className="font-semibold text-slate-200">{items.length}</span> processes.</p>
        </div>
        {loading ? <div className="p-6 text-sm text-slate-400">Reading running apps…</div> : filteredItems.length ? <div className="divide-y divide-slate-800">{filteredItems.map((process) => {
          const active = activeProcessId === process.pid;
          return <div key={process.pid} className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><span className="truncate text-sm font-semibold text-slate-100">{process.name}</span><span data-technical-detail className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[11px] text-slate-400">PID {process.pid}</span>{process.efficiencyMode && <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-300"><Leaf className="h-3 w-3" />Efficiency Mode active</span>}</div>
              <p className="mt-1 text-xs text-slate-500">{process.cpuPercent === null ? 'Unknown CPU' : `${process.cpuPercent}% recent CPU`} · {formatBytes(process.workingSetBytes)} working set</p>
            </div>
            <button onClick={() => onEnable(process)} disabled={active || process.efficiencyMode || !process.creationTime} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-emerald-400 px-3 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50">
              <Leaf className="h-3.5 w-3.5" /> {active ? 'Applying…' : process.efficiencyMode ? 'Already enabled' : !process.creationTime ? 'Refresh first' : 'Use efficiency mode'}
            </button>
          </div>;
        })}</div> : <div className="p-6 text-sm text-slate-500">{loading ? '' : filteredItems.length === 0 ? 'No background processes match the current filters.' : 'No apps to show. Open an app, then refresh.'}</div>}
      </section>
    </div>
  );
}

function InfoCard({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4"><div className="flex items-center gap-2 text-xs font-semibold text-slate-300">{icon}{title}</div><p className="mt-2 text-xs leading-relaxed text-slate-500">{detail}</p></div>;
}
