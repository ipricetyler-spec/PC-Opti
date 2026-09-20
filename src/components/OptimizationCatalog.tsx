import { AlertTriangle, CheckCircle2, CheckSquare2, CircleSlash2, LoaderCircle, Play, Search, ShieldCheck, Square, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { summarizeOptimizationRun } from '../lib/optimizationRun.js';
import { plainLabel } from '../lib/plainLabels';
import { useConfirm } from './ConfirmContext';

export type BatchOptimizationKind = 'startup' | 'process' | 'maintenance' | 'policy' | 'timing';

export interface BatchOptimizationItem {
  id: string;
  kind: BatchOptimizationKind;
  targetId: string;
  creationTime?: string;
  title: string;
  description: string;
  whyAppeared: string;
  category: string;
  expectedBenefit: string;
  undo: string;
  verification: string;
  riskLevel: 'Low' | 'Medium' | 'High';
  requiresAdmin: boolean;
  requiresReboot: boolean;
  irreversible: boolean;
  selectable?: boolean;
  statusReason?: string;
}

export type BatchRunStatus = 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'SKIPPED' | 'FAILED' | 'NEEDS_REVIEW';

export interface BatchRunLogEntry {
  itemId: string;
  title: string;
  status: BatchRunStatus;
  message: string;
  timestamp: string;
}

interface OptimizationCatalogProps {
  items: BatchOptimizationItem[];
  loading: boolean;
  onRefresh: () => void;
  onRunSelected: (items: BatchOptimizationItem[], emit: (entry: BatchRunLogEntry) => void) => Promise<void>;
}

function StatusIcon({ status }: { status: BatchRunStatus }) {
  if (status === 'RUNNING') return <LoaderCircle className="h-3.5 w-3.5 animate-spin text-cyan-300" />;
  if (status === 'SUCCESS') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />;
  if (status === 'SKIPPED') return <CircleSlash2 className="h-3.5 w-3.5 text-amber-300" />;
  if (status === 'NEEDS_REVIEW') return <AlertTriangle className="h-3.5 w-3.5 text-violet-300" />;
  if (status === 'FAILED') return <XCircle className="h-3.5 w-3.5 text-rose-300" />;
  return <Square className="h-3.5 w-3.5 text-slate-600" />;
}

function riskClass(risk: BatchOptimizationItem['riskLevel']) {
  if (risk === 'High') return 'bg-rose-500/10 text-rose-300';
  if (risk === 'Medium') return 'bg-amber-500/10 text-amber-300';
  return 'bg-slate-800 text-slate-300';
}

export function OptimizationCatalog({ items, loading, onRefresh, onRunSelected }: OptimizationCatalogProps) {
  const confirm = useConfirm();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<'all' | BatchOptimizationKind>('all');
  const [selected, setSelected] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<BatchRunLogEntry[]>([]);

  useEffect(() => {
    const available = new Set(items.map((item) => item.id));
    setSelected((current) => current.filter((id) => available.has(id)));
  }, [items]);

  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return items.filter((item) => {
      if (category !== 'all' && item.kind !== category) return false;
      if (!normalized) return true;
      return `${item.title} ${item.description} ${item.whyAppeared} ${item.category} ${item.expectedBenefit} ${item.undo} ${item.verification}`.toLowerCase().includes(normalized);
    });
  }, [category, items, query]);

  const selectedItems = useMemo(() => selected.map((id) => items.find((item) => item.id === id)).filter((item): item is BatchOptimizationItem => Boolean(item?.selectable !== false)), [items, selected]);
  const toggle = (id: string) => {
    if (items.find((item) => item.id === id)?.selectable === false) return;
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const runSelected = async () => {
    if (running || selectedItems.length === 0) return;
    const adminCount = selectedItems.filter((item) => item.requiresAdmin).length;
    const rebootCount = selectedItems.filter((item) => item.requiresReboot).length;
    const irreversibleCount = selectedItems.filter((item) => item.irreversible).length;
    const confirmed = await confirm({
      title: `Run ${selectedItems.length} selected fix${selectedItems.length === 1 ? '' : 'es'}?`,
      description: 'Dialed runs them one at a time, rechecks each target first, verifies each result, and keeps going if one fails or is skipped.',
      details: selectedItems.map((item) => `• ${item.title}${item.requiresReboot ? ' (reboot needed)' : ''}${item.irreversible ? ' (cannot be undone)' : ''}`).join('\n'),
      notice: `${adminCount} need administrator rights, ${rebootCount} need a reboot, and ${irreversibleCount} cannot be undone. Every attempt is recorded in Restore › Recovery & history.`,
      confirmLabel: `Run ${selectedItems.length}`,
      tone: irreversibleCount > 0 ? 'danger' : 'default',
    });
    if (!confirmed) return;

    setRunning(true);
    setLog(selectedItems.map((item) => ({ itemId: item.id, title: item.title, status: 'QUEUED', message: 'Waiting for its turn.', timestamp: new Date().toISOString() })));
    try {
      await onRunSelected(selectedItems, (entry) => setLog((current) => {
        const existing = current.findIndex((item) => item.itemId === entry.itemId);
        if (existing < 0) return [...current, entry];
        const next = [...current];
        next[existing] = entry;
        return next;
      }));
    } finally {
      setRunning(false);
    }
  };

  const runSummary = useMemo(() => summarizeOptimizationRun(log, running), [log, running]);
  const summaryToneClass = runSummary.tone === 'success'
    ? 'text-emerald-300'
    : runSummary.tone === 'failure'
      ? 'text-rose-300'
      : runSummary.tone === 'warning'
        ? 'text-amber-300'
        : 'text-cyan-300';

  return <section className="mb-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-xl">
    <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-cyan-300">Suggested fixes</p>
        <h3 className="mt-1 text-xl font-bold text-white">Fixes for this PC</h3>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">Tick the ones you want and press Run. Each is checked before and after, and can be undone where Windows allows.</p>
      </div>
      <button type="button" onClick={onRefresh} disabled={loading || running} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 disabled:opacity-50">{loading ? 'Refreshing…' : 'Refresh'}</button>
    </div>

    <div className="mt-4 flex flex-wrap items-end gap-2 rounded-xl border border-slate-800 bg-slate-950/35 p-3">
      <label className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-xs text-slate-300"><Search className="h-3.5 w-3.5 text-slate-500" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search fixes" aria-label="Search fixes" className="w-56 bg-transparent outline-none placeholder:text-slate-600" /></label>
      <label className="text-[11px] text-slate-400"><span className="mb-1 block">Category</span><select value={category} onChange={(event) => setCategory(event.target.value as 'all' | BatchOptimizationKind)} className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100"><option value="all">All</option><option value="startup">Startup</option><option value="process">Background apps</option><option value="maintenance">Maintenance</option><option value="policy">Windows policy</option><option value="timing">Boot timing</option></select></label>
      <button type="button" onClick={() => setSelected((current) => [...new Set([...current, ...visible.filter((item) => item.selectable !== false).map((item) => item.id)])])} disabled={!visible.some((item) => item.selectable !== false) || running} className="rounded-lg border border-slate-700 px-3 py-2 text-[11px] font-semibold text-slate-300 disabled:opacity-50">Select all shown ({visible.filter((item) => item.selectable !== false).length})</button>
      <button type="button" onClick={() => setSelected([])} disabled={selected.length === 0 || running} className="rounded-lg border border-slate-700 px-3 py-2 text-[11px] font-semibold text-slate-300 disabled:opacity-50">Clear</button>
    </div>

    {/* Kept above the list, and sticky, so "Run selected" stays in reach however far the list is scrolled. */}
    <div className="sticky top-2 z-10 mt-4 flex flex-col justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/95 p-3 sm:flex-row sm:items-center">
      <div className="flex items-center gap-2 text-xs text-slate-400"><ShieldCheck className="h-4 w-4 text-emerald-300" /><span><strong className="text-slate-200">{selectedItems.length}</strong> selected · {items.length} available{log.length > 0 ? ` · ${runSummary.finished}/${runSummary.total} finished` : ''}</span></div>
      <button type="button" onClick={() => void runSelected()} disabled={selectedItems.length === 0 || running} className="inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-400 px-5 py-2 text-xs font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-40">{running ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-current" />}{running ? `Running selected (${selectedItems.length})` : `Run selected (${selectedItems.length})`}</button>
    </div>

    <div className="mt-4 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
      {visible.map((item) => {
        const isSelected = selected.includes(item.id);
        const selectable = item.selectable !== false;
        return <article key={item.id} className={`min-w-0 overflow-hidden rounded-xl border p-4 transition ${isSelected ? 'border-cyan-400/50 bg-cyan-500/10' : selectable ? 'border-slate-800 bg-slate-950/45 hover:border-slate-600' : 'border-slate-800 bg-slate-950/25 opacity-75'}`}>
          <button type="button" onClick={() => toggle(item.id)} aria-pressed={isSelected} disabled={running || !selectable} className="w-full text-left disabled:cursor-not-allowed">
            <span className="flex min-w-0 items-start gap-3">{isSelected ? <CheckSquare2 className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" /> : <Square className="mt-0.5 h-4 w-4 shrink-0 text-slate-600" />}<span className="min-w-0"><span className="block break-words text-sm font-semibold text-slate-100">{item.title}</span></span></span>
            <span className="mt-3 flex flex-wrap gap-1.5 text-[11px] font-semibold"><span className="rounded bg-slate-800 px-2 py-1 text-slate-300">{item.category}</span><span className={`rounded px-2 py-1 ${riskClass(item.riskLevel)}`}>{item.riskLevel} risk</span>{!selectable ? <span className="rounded bg-amber-500/10 px-2 py-1 text-amber-300">Not available now</span> : null}{item.requiresAdmin ? <span className="rounded bg-amber-500/10 px-2 py-1 text-amber-300">Admin</span> : null}{item.requiresReboot ? <span className="rounded bg-violet-500/10 px-2 py-1 text-violet-300">Reboot</span> : null}{item.irreversible ? <span className="rounded bg-rose-500/10 px-2 py-1 text-rose-300">Can't undo</span> : null}</span>
            <span className="mt-3 block [overflow-wrap:anywhere] text-[11px] leading-relaxed text-slate-400"><span className="font-semibold text-slate-300">What changes:</span> {item.description}</span>
          </button>
          <details className="mt-2 text-[11px] leading-relaxed text-slate-400">
            <summary className="cursor-pointer font-semibold text-slate-300">Why, undo and how to check</summary>
            <span className="mt-2 grid gap-2 [overflow-wrap:anywhere]">
              <span className="block"><span className="font-semibold text-slate-300">Why this appeared:</span> {item.whyAppeared}</span>
              {item.statusReason ? <span className="block"><span className="font-semibold text-slate-300">Status:</span> {item.statusReason}</span> : null}
              <span className="block"><span className="font-semibold text-slate-300">Expected:</span> {item.expectedBenefit}</span>
              <span className="block"><span className="font-semibold text-slate-300">Undo:</span> {item.undo}</span>
              <span className="block"><span className="font-semibold text-slate-300">How to verify:</span> {item.verification}</span>
            </span>
          </details>
        </article>;
      })}
    </div>
    {!loading && items.length === 0 ? <div className="mt-4 rounded-xl border border-amber-500/25 bg-amber-950/15 p-4 text-xs text-amber-100/80"><AlertTriangle className="mr-2 inline h-4 w-4 text-amber-300" />Nothing to fix right now. Settings already in place are not shown.</div> : null}

    {log.length > 0 ? <div role="log" aria-live="polite" aria-labelledby="optimization-run-log-heading" className="mt-4 overflow-hidden rounded-xl border border-slate-800 bg-[#080a0d]">
      <div className="flex items-center justify-between gap-4 border-b border-slate-800 px-4 py-3"><div><h4 id="optimization-run-log-heading" className="text-xs font-semibold text-slate-200">Results</h4><p className="mt-0.5 text-[11px] text-slate-500">Each fix's result. Everything is also recorded in Restore › Recovery & history.</p></div><span className={`shrink-0 text-right text-[11px] font-semibold ${summaryToneClass}`}>{runSummary.label}</span></div>
      <div className="max-h-72 overflow-y-auto p-3 text-[11px]">{log.map((entry) => <div key={entry.itemId} className="flex gap-2 border-b border-slate-900 py-2 last:border-0"><span className="mt-0.5"><StatusIcon status={entry.status} /></span><span data-technical-detail className="shrink-0 font-mono text-slate-600">{new Date(entry.timestamp).toLocaleTimeString()}</span><span className="min-w-0"><span className="font-semibold text-slate-200">{entry.title}</span><span className="ml-2 text-slate-500">{plainLabel(entry.status === 'QUEUED' ? 'WAITING' : entry.status === 'RUNNING' ? 'RUNNING' : entry.status)}</span><span className="mt-0.5 block break-words text-slate-400">{entry.message}</span></span></div>)}</div>
    </div> : null}
  </section>;
}
