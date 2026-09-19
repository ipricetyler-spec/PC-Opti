import { partName } from '../lib/friendlyError';
import { ErrorText } from './ErrorText';
import { AlertTriangle, CheckCircle2, Filter, ListChecks, LoaderCircle, RefreshCw, RotateCcw, Search, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { AuditJournalEntry, StartupManagementItem } from '../types';

interface StartupCenterProps {
  items: StartupManagementItem[];
  errors: Array<{ component: string; message: string }>;
  loading: boolean;
  activeItemId: string | null;
  actionError: string | null;
  onRefresh: () => void;
  onDisable: (item: StartupManagementItem) => void;
  history?: AuditJournalEntry[];
  restoringId?: string | null;
  onRestore?: (entry: AuditJournalEntry) => void;
}

export function StartupCenter({
  items,
  errors,
  loading,
  activeItemId,
  actionError,
  onRefresh,
  onDisable,
  history = [],
  restoringId = null,
  onRestore,
}: StartupCenterProps) {
  const manageable = items.filter((item) => item.canDisable);
  const disabledByDialed = history.filter((entry) => entry.status === 'SUCCESS' && entry.rollback.available && entry.rollback.kind === 'restore-registry-run-value');
  const readOnly = items.length - manageable.length;
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'Registry' | 'TaskScheduler'>('all');
  const [manageabilityFilter, setManageabilityFilter] = useState<'all' | 'manageable' | 'read-only'>('all');
  const [sortMode, setSortMode] = useState<'name' | 'source' | 'scope'>('name');

  const sourceCounts = useMemo(() => ({
    all: items.length,
    Registry: items.filter((item) => item.source === 'Registry').length,
    TaskScheduler: items.filter((item) => item.source === 'TaskScheduler').length,
  }), [items]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const rows = items.filter((item) => {
      if (sourceFilter !== 'all' && item.source !== sourceFilter) return false;
      if (manageabilityFilter === 'manageable' && !item.canDisable) return false;
      if (manageabilityFilter === 'read-only' && item.canDisable) return false;
      if (!normalizedQuery) return true;
      return (
        item.name.toLowerCase().includes(normalizedQuery)
        || (item.path || '').toLowerCase().includes(normalizedQuery)
        || item.scope.toLowerCase().includes(normalizedQuery)
        || item.managementNote.toLowerCase().includes(normalizedQuery)
      );
    });

    if (sortMode === 'source') rows.sort((a, b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name));
    else if (sortMode === 'scope') rows.sort((a, b) => a.scope.localeCompare(b.scope) || a.name.localeCompare(b.name));
    else rows.sort((a, b) => a.name.localeCompare(b.name));
    return rows;
  }, [items, manageabilityFilter, query, sortMode, sourceFilter]);

  const resetFilters = () => {
    setQuery('');
    setSourceFilter('all');
    setManageabilityFilter('all');
    setSortMode('name');
  };

  return (
    <div id="startup-center" className="scroll-mt-6 space-y-6">
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div className="flex items-start gap-3">
            <ListChecks className="mt-0.5 h-5 w-5 text-cyan-400" />
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-cyan-300">
                Startup apps
                <span data-technical-detail className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-0.5 text-[11px]">From Windows</span>
              </div>
              <h2 className="mt-2 text-xl font-bold text-white">Review what starts with Windows</h2>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-400">
                Programs and scheduled tasks that start when you sign in. Turn them off one at a time; each can be turned back on.
              </p>
            </div>
          </div>
          <button
            onClick={onRefresh}
            disabled={loading || Boolean(activeItemId)}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <Summary label="Start with Windows" value={items.length.toString()} />
          <Summary label="Can be turned off" value={manageable.length.toString()} tone="cyan" />
          <Summary label="Shown only" value={readOnly.toString()} tone="slate" />
        </div>

        <div className="mt-4 flex gap-2 rounded-lg border border-amber-500/25 bg-amber-950/20 p-3 text-xs leading-relaxed text-amber-100/90">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" />
          Startup entries are turned off one at a time. Machine-wide entries need Dialed running as administrator; scheduled tasks remain visible and read-only. Every change keeps the exact previous entry so you can turn it back on.
        </div>
      </section>

      {(errors.length > 0 || actionError) && (
        <section className="rounded-xl border border-rose-500/30 bg-rose-950/20 p-4 text-xs text-rose-100">
          {actionError && <p><ErrorText text={actionError} /></p>}
          {errors.map((error) => <p key={`${error.component}-${error.message}`}>{partName(error.component)}: <ErrorText text={error.message} /></p>)}
        </section>
      )}

      {onRestore && disabledByDialed.length > 0 && (
        <section aria-label="Turned off by Dialed" className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <h3 className="text-sm font-semibold text-slate-100">Turned off by Dialed</h3>
          <p className="mt-1 text-xs text-slate-500">Turn any of these back on. Dialed puts back exactly what was there, unless something else has changed it since.</p>
          <ul className="mt-3 space-y-2">{disabledByDialed.map((entry) => (
            <li key={entry.id} className="flex flex-col justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-xs sm:flex-row sm:items-center">
              <span className="min-w-0"><span className="block font-semibold text-slate-200">{entry.title.replace(/^Disable startup(?: item)?:\s*/i, '')}</span><span className="text-slate-500">Turned off {new Date(entry.timestamp).toLocaleString()}</span></span>
              <button type="button" onClick={() => onRestore(entry)} disabled={Boolean(restoringId) || Boolean(activeItemId)} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 font-semibold text-cyan-200 disabled:opacity-50">
                {restoringId === entry.id ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                {restoringId === entry.id ? 'Turning back on…' : 'Turn back on'}
              </button>
            </li>
          ))}</ul>
        </section>
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70">
        <div className="border-b border-slate-800 px-5 py-4">
          <h3 className="text-sm font-semibold text-slate-100">Startup programs</h3>
          <p className="mt-1 text-xs text-slate-500">Each shows the program path Windows reports.</p>
        </div>
        <div className="border-b border-slate-800/80 bg-slate-950/30 p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2 rounded border border-slate-700 bg-slate-950/40 px-2 py-2 text-xs text-slate-300">
              <Search className="h-3.5 w-3.5 text-slate-400" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search programs" className="w-64 bg-transparent outline-none placeholder:text-slate-500" />
            </label>
            <label className="text-[11px] text-slate-400">
              <div className="mb-1 flex items-center gap-1"><Filter className="h-3 w-3" /> Source</div>
              <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as 'all' | 'Registry' | 'TaskScheduler')} className="rounded border border-slate-700 bg-slate-950/40 px-2 py-1 text-xs text-slate-100">
                <option value="all">All ({sourceCounts.all})</option>
                <option value="Registry">Registry ({sourceCounts.Registry})</option>
                <option value="TaskScheduler">Task Scheduler ({sourceCounts.TaskScheduler})</option>
              </select>
            </label>
            <label className="text-[11px] text-slate-400">
              <div className="mb-1">Change type</div>
              <select value={manageabilityFilter} onChange={(event) => setManageabilityFilter(event.target.value as 'all' | 'manageable' | 'read-only')} className="rounded border border-slate-700 bg-slate-950/40 px-2 py-1 text-xs text-slate-100">
                <option value="all">All</option>
                <option value="manageable">Manageable</option>
                <option value="read-only">Read-only</option>
              </select>
            </label>
            <label className="text-[11px] text-slate-400">
              <div className="mb-1">Sort</div>
              <select value={sortMode} onChange={(event) => setSortMode(event.target.value as 'name' | 'source' | 'scope')} className="rounded border border-slate-700 bg-slate-950/40 px-2 py-1 text-xs text-slate-100">
                <option value="name">Name</option>
                <option value="source">Source</option>
                <option value="scope">Scope</option>
              </select>
            </label>
            <button onClick={resetFilters} className="rounded-lg border border-slate-700 bg-slate-900/50 px-2 py-2 text-[11px] text-slate-300">Reset</button>
          </div>
          <p role="status" aria-live="polite" aria-atomic="true" className="text-xs text-slate-500">
            Showing <span className="font-semibold text-slate-200">{filteredItems.length}</span> of <span className="font-semibold text-slate-200">{items.length}</span> detected entries.
          </p>
        </div>
        <div className="divide-y divide-slate-800/70">
          {filteredItems.map((item) => {
            const running = activeItemId === item.id;
            return (
              <article key={item.id} className="p-5">
                <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-sm font-semibold text-slate-100">{item.name}</h4>
                      <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                        <CheckCircle2 className="h-3 w-3" /> Enabled
                      </span>
                      <span data-technical-detail className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-400">{item.source}</span>
                      <span data-technical-detail className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-400">{item.scope}</span>
                    </div>
                    <p data-technical-detail className="mt-2 break-all font-mono text-[11px] leading-relaxed text-slate-500">{item.path || 'Windows did not return an executable path.'}</p>
                    <p className="mt-2 text-xs text-slate-400">{item.managementNote}</p>
                  </div>
                  {item.canDisable ? (
                    <button
                      onClick={() => onDisable(item)}
                      disabled={Boolean(activeItemId)}
                      className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
                    >
                      {running ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                      {running ? 'Disabling…' : 'Disable at sign-in'}
                    </button>
                  ) : (
                    <span className="shrink-0 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-500">Read-only</span>
                  )}
                </div>
              </article>
            );
          })}
          {!loading && filteredItems.length === 0 && items.length > 0 && <p className="p-8 text-center text-sm text-slate-500">Nothing matches these filters.</p>}
          {!loading && items.length === 0 && <p className="p-8 text-center text-sm text-slate-500">Nothing starts with Windows.</p>}
        </div>
      </section>
    </div>
  );
}

function Summary({ label, value, tone = 'slate' }: { label: string; value: string; tone?: 'cyan' | 'slate' }) {
  return <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><p className="text-[11px] text-slate-500">{label}</p><p className={`mt-1 text-xl font-bold ${tone === 'cyan' ? 'text-cyan-300' : 'text-slate-200'}`}>{value}</p></div>;
}
