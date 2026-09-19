import { ErrorText } from './ErrorText';
import { CheckCircle2, ClipboardCheck, Filter, LoaderCircle, Search, ShieldAlert, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { MaintenanceAction } from '../types';

interface MaintenanceQueueProps {
  actions: MaintenanceAction[];
  activeActionId: string | null;
  error: string | null;
  onExecute: (action: MaintenanceAction) => void;
}

export function MaintenanceQueue({ actions, activeActionId, error, onExecute }: MaintenanceQueueProps) {
  const [query, setQuery] = useState('');
  const [reversibleFilter, setReversibleFilter] = useState<'all' | 'reversible' | 'irreversible'>('all');
  const [sortMode, setSortMode] = useState<'name' | 'reversible'>('name');

  const filteredActions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const rows = actions.filter((action) => {
      if (reversibleFilter === 'reversible' && !action.reversible) return false;
      if (reversibleFilter === 'irreversible' && action.reversible) return false;
      if (!normalized) return true;
      return action.title.toLowerCase().includes(normalized) || action.description.toLowerCase().includes(normalized) || action.evidence.toLowerCase().includes(normalized);
    });

    if (sortMode === 'reversible') rows.sort((left, right) => Number(right.reversible) - Number(left.reversible) || left.title.localeCompare(right.title));
    else rows.sort((left, right) => left.title.localeCompare(right.title));
    return rows;
  }, [actions, reversibleFilter, query, sortMode]);

  const resetFilters = () => {
    setQuery('');
    setReversibleFilter('all');
    setSortMode('name');
  };

  return <div className="space-y-6"><section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6"><div className="flex items-start gap-3"><ClipboardCheck className="mt-0.5 h-5 w-5 text-cyan-400" /><div><h2 className="text-xl font-bold text-white">Maintenance tasks</h2><p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-400">Upkeep tasks based on your latest scan. Run them one at a time.</p></div></div><div className="mt-4 flex gap-2 rounded-lg border border-amber-500/25 bg-amber-950/20 p-3 text-xs text-amber-100/90"><ShieldAlert className="h-4 w-4 shrink-0 text-amber-300" />Deleted files cannot be brought back. Every task is recorded in Restore › Recovery & history.</div></section>{error && <p className="rounded-lg border border-rose-500/30 bg-rose-950/30 p-3 text-xs text-rose-200"><ErrorText text={error} /></p>}
    <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-xs">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-2 rounded border border-slate-700 bg-slate-950/40 px-2 py-1.5">
          <Search className="h-3.5 w-3.5 text-slate-400" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tasks" className="w-64 bg-transparent outline-none placeholder:text-slate-500" />
        </label>
        <label className="text-[11px] text-slate-400">
          <div className="mb-1 flex items-center gap-1"><Filter className="h-3 w-3" /> Reversibility</div>
          <select value={reversibleFilter} onChange={(event) => setReversibleFilter(event.target.value as 'all' | 'reversible' | 'irreversible')} className="rounded border border-slate-700 bg-slate-950/40 px-2 py-1 text-xs text-slate-100">
            <option value="all">All actions</option>
            <option value="reversible">Reversible</option>
            <option value="irreversible">Not reversible</option>
          </select>
        </label>
        <label className="text-[11px] text-slate-400">
          <div className="mb-1">Sort</div>
          <select value={sortMode} onChange={(event) => setSortMode(event.target.value as 'name' | 'reversible')} className="rounded border border-slate-700 bg-slate-950/40 px-2 py-1 text-xs text-slate-100">
            <option value="name">Name A→Z</option>
            <option value="reversible">Reversibility</option>
          </select>
        </label>
        <button onClick={resetFilters} className="rounded-lg border border-slate-700 bg-slate-900/40 px-2 py-1 text-[11px] text-slate-300"><X className="h-3.5 w-3.5" /> Reset</button>
      </div>
      <p role="status" aria-live="polite" aria-atomic="true" className="text-slate-500">Showing <span className="font-semibold text-slate-200">{filteredActions.length}</span> of <span className="font-semibold text-slate-200">{actions.length}</span> maintenance actions.</p>
    </section>
    <section className="grid gap-4 lg:grid-cols-2">{filteredActions.map((action) => { const running = action.id === activeActionId; return <article key={action.id} className="rounded-xl border border-slate-800 bg-slate-900/70 p-5"><div className="flex items-start justify-between gap-4"><div><h3 className="font-semibold text-slate-100">{action.title}</h3><p className="mt-1 text-xs leading-relaxed text-slate-400">{action.description}</p></div><span className={`shrink-0 rounded px-2 py-1 text-[11px] font-semibold ${action.reversible ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}>{action.reversible ? 'REVERSIBLE' : 'NOT REVERSIBLE'}</span></div><div data-technical-detail className="mt-4 rounded-lg bg-slate-950/70 p-3 text-xs text-cyan-200"><span className="font-semibold text-cyan-400">From your scan: </span>{action.evidence}</div><button onClick={() => onExecute(action)} disabled={Boolean(activeActionId)} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-cyan-400 px-3 py-2 text-xs font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50">{running ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}{running ? 'Running…' : 'Review and run'}</button></article>; })}{actions.length === 0 && <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-6 text-sm text-slate-400">Nothing needs doing right now.</section>}</section>
    {!error && filteredActions.length === 0 && actions.length > 0 && <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-6 text-sm text-slate-400">Nothing matches these filters.</section>}
  </div>;
}
