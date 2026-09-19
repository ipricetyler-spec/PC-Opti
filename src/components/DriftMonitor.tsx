import { ErrorText } from './ErrorText';
import { ArrowRight, Database, Filter, Save, Search, ShieldCheck } from 'lucide-react';
import { summarizeDrift } from '../lib/driftDiff';
import { useMemo, useState } from 'react';
import type { DriftReport } from '../types';
import { plainLabel } from '../lib/plainLabels';

interface DriftMonitorProps {
  report: DriftReport | null;
  loading: boolean;
  error: string | null;
  onOpenScan: () => void;
  onSetBaseline: () => void;
}

function formatValue(value: unknown | null) {
  if (value === null) return 'Not present';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value, null, 2);
}

type DriftKind = DriftReport['changes'][number]['kind'];

export function DriftMonitor({ report, loading, error, onOpenScan, onSetBaseline }: DriftMonitorProps) {
  // A drift error (corrupt or cross-device baseline) means a baseline file still
  // exists on disk even though report is null, so "Replace baseline" must stay
  // enabled and correctly labeled — otherwise a bad baseline can never be fixed
  // from this screen.
  const hasBaseline = Boolean(report?.baseline) || Boolean(error);
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | DriftKind>('all');
  const [sortMode, setSortMode] = useState<'label' | 'kind'>('label');

  const filteredChanges = useMemo(() => {
    if (!report?.changes?.length) return [];
    const terms = query.trim().toLowerCase();
    const rows = report.changes.filter((change) => {
      if (kindFilter !== 'all' && change.kind !== kindFilter) return false;
      if (!terms) return true;
      return change.label.toLowerCase().includes(terms)
        || change.path.toLowerCase().includes(terms)
        || formatValue(change.before).toLowerCase().includes(terms)
        || formatValue(change.after).toLowerCase().includes(terms);
    });
    if (sortMode === 'kind') rows.sort((left, right) => left.kind.localeCompare(right.kind) || left.label.localeCompare(right.label));
    else rows.sort((left, right) => left.label.localeCompare(right.label));
    return rows;
  }, [kindFilter, query, report, sortMode]);

  return <div className="space-y-5">
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <div className="flex items-center gap-2"><Database className="h-5 w-5 text-cyan-400" /><h2 className="text-lg font-bold text-slate-100">Changes since your snapshot</h2></div>
          <p className="mt-2 max-w-2xl text-xs leading-relaxed text-slate-400">Save a snapshot of this PC, and Dialed will show what changed since: new startup apps, driver updates and settings changed by Windows or other programs. Things that change constantly, like memory use and free space, are ignored.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onOpenScan} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200"><ArrowRight className="h-3.5 w-3.5" />Scan details</button>
          <button type="button" onClick={onSetBaseline} disabled={loading} className="inline-flex items-center gap-2 rounded-lg bg-cyan-400 px-3 py-2 text-xs font-bold text-slate-950 disabled:opacity-60"><Save className="h-3.5 w-3.5" />{hasBaseline ? 'Save a new snapshot' : 'Save snapshot'}</button>
        </div>
      </div>
      {error && <p className="mt-4 rounded-lg border border-rose-500/30 bg-rose-950/30 p-3 text-xs text-rose-200"><ErrorText text={error} /></p>}
    </section>

    {!error && report && !report.baseline && <section className="rounded-2xl border border-amber-500/25 bg-amber-950/15 p-5 text-sm text-amber-100/80">No snapshot saved yet. Choose <strong>Save snapshot</strong> to start tracking changes.</section>}

    {!error && report?.baseline && <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 text-xs text-slate-400">
      Snapshot saved {new Date(report.baseline.createdAt).toLocaleString()}. Compared with the scan from {new Date(report.currentSnapshotTimestamp).toLocaleString()}.
    </section>}

    {!error && report?.baseline && <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
      <div className="mb-3 flex flex-wrap gap-2">
        <label className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950/50 px-2 py-1.5 text-xs text-slate-300">
          <Search className="h-3.5 w-3.5 text-slate-400" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search changes" className="w-64 bg-transparent outline-none placeholder:text-slate-500" />
        </label>
        <label className="text-[11px] text-slate-400">
          <div className="mb-1 flex items-center gap-1"><Filter className="h-3 w-3" />Type</div>
          <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as 'all' | DriftKind)} className="rounded border border-slate-700 bg-slate-950/50 px-2 py-1 text-xs text-slate-100">
            <option value="all">All</option>
            <option value="ADDED">Added</option>
            <option value="REMOVED">Removed</option>
            <option value="CHANGED">Changed</option>
          </select>
        </label>
        <label className="text-[11px] text-slate-400">
          <div className="mb-1">Sort</div>
          <select value={sortMode} onChange={(event) => setSortMode(event.target.value as 'label' | 'kind')} className="rounded border border-slate-700 bg-slate-950/50 px-2 py-1 text-xs text-slate-100">
            <option value="label">Label</option>
            <option value="kind">Change kind</option>
          </select>
        </label>
      </div>
      <p role="status" aria-live="polite" aria-atomic="true" className="text-xs text-slate-500">Showing <span className="font-semibold text-slate-200">{filteredChanges.length}</span> of <span className="font-semibold text-slate-200">{report?.changes.length ?? 0}</span> tracked changes.</p>
    </section>}

    {!error && report?.baseline && report.changes.length === 0 && <section className="flex gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-950/10 p-5 text-sm text-emerald-100/80"><ShieldCheck className="h-5 w-5 shrink-0 text-emerald-300" /><div><p className="font-semibold text-emerald-200">Nothing has changed</p><p className="mt-1 text-xs">The settings Dialed tracks match your snapshot.</p></div></section>}

    {!error && report?.changes && report.changes.length > 0 && <section className="space-y-3">
      {filteredChanges.length === 0
        ? <section className="rounded-xl border border-amber-500/20 bg-amber-950/20 p-4 text-xs text-amber-100/90">Nothing matches these filters.</section>
        : <h3 className="text-sm font-semibold text-slate-200">{filteredChanges.length} tracked change{filteredChanges.length === 1 ? '' : 's'}</h3>}
      {filteredChanges.map((change) => {
        const summary = summarizeDrift(change.before, change.after);
        return <article key={change.path} className={`rounded-xl border p-4 ${summary.onlyFilledIn ? 'border-slate-700 bg-slate-900/50' : 'border-amber-500/20 bg-slate-900/70'}`}>
          <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-semibold text-slate-100">{change.label}</h4>
            {summary.onlyFilledIn
              ? <span className="rounded bg-slate-700/60 px-2 py-1 text-[11px] font-semibold text-slate-300">Newly read</span>
              : <span className="rounded bg-amber-500/10 px-2 py-1 text-[11px] font-semibold text-amber-300">{plainLabel(change.kind)}</span>}</div>
          <p data-technical-detail className="mt-1 font-mono text-[11px] text-slate-500">{change.path}</p>
          {summary.onlyFilledIn && <p className="mt-2 text-xs text-slate-400">Not a change to your PC. The snapshot could not read this value, and the latest scan could.</p>}
          {summary.availability && <p className="mt-2 text-xs text-slate-300">{summary.availability}</p>}
          {summary.lines.length > 0
            ? <ul className="mt-3 space-y-1.5 text-xs">{summary.lines.map((line) => <li key={line.field} className="grid gap-1 sm:grid-cols-[minmax(0,14rem)_1fr]">
              <span className="font-semibold text-slate-300">{line.field}</span>
              <span className={line.filledIn ? 'text-slate-400' : 'text-slate-200'}>{line.before} <span aria-hidden="true">→</span><span className="sr-only">changed to</span> {line.after}</span>
            </li>)}</ul>
            : !summary.availability && <p className="mt-2 text-xs text-slate-400">The values are the same; only how they were recorded differs.</p>}
          <details className="mt-3 text-xs text-slate-400"><summary className="cursor-pointer font-semibold">Show raw scan data</summary>
            <div className="mt-3 grid gap-3 lg:grid-cols-2"><Value label="Baseline" value={formatValue(change.before)} /><Value label="Current scan" value={formatValue(change.after)} /></div>
          </details>
        </article>;
      })}
    </section>}
  </div>;
}

function Value({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-lg border border-slate-800 bg-slate-950/60 p-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-slate-300">{value}</pre></div>;
}
