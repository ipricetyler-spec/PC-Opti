import { ErrorText } from './ErrorText';
import { Clock3, Download, FileWarning, History, LoaderCircle, RotateCcw, Search, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { AuditDeletionMode, AuditHistoryRecovery, AuditJournalEntry } from '../types';
import { plainLabel } from '../lib/plainLabels';
import { ShowDetails } from './ShowDetails';

interface LocalAuditHistoryProps {
  focusedId?: string | null;
  entries: AuditJournalEntry[];
  loading: boolean;
  rollingBackId: string | null;
  privacyBusy: boolean;
  privacyStatus: string | null;
  actionError: string | null;
  recovery: AuditHistoryRecovery | null;
  recoveryBusy: boolean;
  onRefresh: () => void;
  onRetryVerification: () => void;
  onRecoverCorruptJournal: () => void;
  onRollback: (entry: AuditJournalEntry) => void;
  onExport: () => void;
  onDelete: (mode: AuditDeletionMode) => void;
  onUndoAll?: () => void;
  undoAllBusy?: boolean;
}

const RETENTION_LABELS: Record<AuditDeletionMode, string> = {
  COMPLETED_30_DAYS: 'Finished, older than 30 days',
  COMPLETED_90_DAYS: 'Finished, older than 90 days',
  ALL_DELETABLE: 'All finished changes that can be cleared',
};

const HISTORY_FILTERS = [
  { value: 'all', label: 'All entries' },
  { value: 'needs-review', label: 'Needs review' },
  { value: 'failed', label: 'Failed' },
  { value: 'pending', label: 'Pending' },
  { value: 'success', label: 'Success' },
  { value: 'rollback', label: 'Can be undone' },
  { value: 'undone', label: 'Undone changes and undos' },
  { value: 'unresolved', label: 'Unfinished' },
] as const;

type HistoryFilterValue = (typeof HISTORY_FILTERS)[number]['value'];

function isUnresolved(entry: AuditJournalEntry) {
  return (
    entry.status === 'NEEDS_REVIEW'
    || entry.status === 'PENDING'
    || entry.reconciliation?.classification === 'UNKNOWN'
    || entry.reconciliation?.classification === 'UNAVAILABLE'
  );
}

// The journal marks an undone change with the id of the entry that restored it.
export function restoredById(entry: AuditJournalEntry): string | null {
  if (entry.rollback.available) return null;
  const match = /Restored by audit entry ([0-9a-f-]{8,})/i.exec(entry.rollback.reason || '');
  return match ? match[1] : null;
}

interface UndoLinks {
  undoneBy: Map<string, AuditJournalEntry>;
  undid: Map<string, AuditJournalEntry>;
}

function buildUndoLinks(entries: AuditJournalEntry[]): UndoLinks {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const undoneBy = new Map<string, AuditJournalEntry>();
  const undid = new Map<string, AuditJournalEntry>();
  for (const entry of entries) {
    const restoreId = restoredById(entry);
    const restore = restoreId ? byId.get(restoreId) : undefined;
    if (!restore) continue;
    undoneBy.set(entry.id, restore);
    undid.set(restore.id, entry);
  }
  return { undoneBy, undid };
}

function jumpTo(id: string) {
  document.getElementById(`audit-entry-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function isFiltered(entry: AuditJournalEntry, filter: HistoryFilterValue, links?: UndoLinks) {
  if (filter === 'all') return true;
  if (filter === 'undone') return Boolean(links && (links.undoneBy.has(entry.id) || links.undid.has(entry.id)));
  if (filter === 'needs-review') return entry.status === 'NEEDS_REVIEW';
  if (filter === 'failed') return entry.status === 'FAILED';
  if (filter === 'pending') return entry.status === 'PENDING';
  if (filter === 'success') return entry.status === 'SUCCESS';
  if (filter === 'rollback') return entry.rollback.available;
  if (filter === 'unresolved') return isUnresolved(entry);
  return true;
}

export function LocalAuditHistory({
  focusedId,
  entries,
  loading,
  rollingBackId,
  privacyBusy,
  privacyStatus,
  actionError,
  recovery,
  recoveryBusy,
  onRefresh,
  onRetryVerification,
  onRecoverCorruptJournal,
  onRollback,
  onExport,
  onDelete,
  onUndoAll,
  undoAllBusy = false,
}: LocalAuditHistoryProps) {
  const [deletionMode, setDeletionMode] = useState<AuditDeletionMode>('COMPLETED_90_DAYS');
  const [historyFilter, setHistoryFilter] = useState<HistoryFilterValue>('all');
  const [historyQuery, setHistoryQuery] = useState('');
  // Opening one entry from elsewhere shows just that entry, with a visible way back to the full list.
  const [focusOnly, setFocusOnly] = useState(Boolean(focusedId));
  useEffect(() => { setFocusOnly(Boolean(focusedId)); setHistoryQuery(''); setHistoryFilter('all'); }, [focusedId]);
  const focusedEntry = focusOnly && focusedId ? entries.find((entry) => entry.id === focusedId) ?? null : null;
  const showAll = () => { setFocusOnly(false); setHistoryQuery(''); setHistoryFilter('all'); };
  const pickFilter = (filter: HistoryFilterValue) => { setFocusOnly(false); setHistoryQuery(''); setHistoryFilter(filter); };
  const [historySort, setHistorySort] = useState<'newest' | 'oldest' | 'status'>('newest');
  const controlsDisabled = loading || privacyBusy || recoveryBusy || Boolean(rollingBackId);

  const counts = useMemo(() => {
    const statusBuckets = {
      completed: 0,
      needsReview: 0,
      failed: 0,
      pending: 0,
      rollbackAvailable: 0,
      protected: 0,
    };
    for (const entry of entries) {
      if (entry.status === 'SUCCESS') statusBuckets.completed += 1;
      if (entry.status === 'NEEDS_REVIEW') statusBuckets.needsReview += 1;
      if (entry.status === 'FAILED') statusBuckets.failed += 1;
      if (entry.status === 'PENDING') statusBuckets.pending += 1;
      if (entry.rollback.available) statusBuckets.rollbackAvailable += 1;
      if (isUnresolved(entry)) statusBuckets.protected += 1;
    }
    return statusBuckets;
  }, [entries]);

  const undoLinks = useMemo(() => buildUndoLinks(entries), [entries]);

  const displayedEntries = useMemo(
    () => {
      const filtered = entries.filter((entry) => {
        if (focusedEntry) return entry.id === focusedEntry.id;
        if (!isFiltered(entry, historyFilter, undoLinks)) return false;
        if (!historyQuery.trim()) return true;
        const needle = historyQuery.toLowerCase().trim();
        const text = `${entry.id} ${entry.title} ${entry.status} ${entry.stderr || ''} ${entry.reconciliation?.message || ''}`.toLowerCase();
        return text.includes(needle);
      });
      if (historySort === 'newest') {
        filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      } else if (historySort === 'oldest') {
        filtered.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      } else {
        filtered.sort((a, b) => a.status.localeCompare(b.status) || new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      }
      return filtered;
    },
    [entries, focusedEntry, historyFilter, historySort, historyQuery, undoLinks]
  );

  return <div className="space-y-6">
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div>
          <div className="flex items-center gap-2 text-cyan-300">
            <History className="h-5 w-5" />
            <span className="text-sm font-semibold">Recovery & history</span>
          </div>
          <h2 className="mt-2 text-xl font-bold text-white">Everything Dialed has changed</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Every change Dialed made, with Undo where Windows allows it. This list stays on this PC.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={onRefresh} disabled={controlsDisabled} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-60">
            {loading && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}{loading ? 'Loading…' : 'Refresh history'}
          </button>
          {onUndoAll && <button onClick={onUndoAll} disabled={controlsDisabled || undoAllBusy || counts.rollbackAvailable === 0} className="inline-flex items-center justify-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2 text-xs font-semibold text-amber-200 disabled:opacity-60">
            {undoAllBusy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}Undo all Dialed changes ({counts.rollbackAvailable})
          </button>}
        </div>
      </div>
      <ShowDetails className="mt-4" label="History tools: how undo works, export, clear old records">
      <div className="mt-4 rounded-xl border border-cyan-500/20 bg-cyan-950/10 p-4 text-xs leading-relaxed text-cyan-100/80"><strong className="text-cyan-200">How undo works:</strong> changes that can be undone have a Restore button below. If Dialed was closed partway through a change, a banner asks you to re-check it before anything else happens. Clearing old history never undoes a change.</div>
      <div className="mt-3 flex flex-col gap-3 rounded-xl border border-rose-500/20 bg-rose-950/10 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold text-rose-200">Clear old history</p>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500">Changes you can still undo, and anything unfinished, are always kept. Your PC is not changed.</p>
        </div>
        <div className="flex flex-col flex-wrap gap-2 sm:flex-row">
          <select
            aria-label="Which completed entries to delete"
            value={deletionMode}
            onChange={(event) => setDeletionMode(event.target.value as AuditDeletionMode)}
            disabled={controlsDisabled}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-300 disabled:opacity-60"
          >
            {Object.entries(RETENTION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <button
            onClick={() => onDelete(deletionMode)}
            disabled={controlsDisabled}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3.5 py-2 text-xs font-semibold text-rose-200 disabled:opacity-60"
          >
            <Trash2 className="h-3.5 w-3.5" />Preview deletion
          </button>
        </div>
      </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-400">
          <button onClick={onExport} disabled={controlsDisabled} className="inline-flex items-center justify-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3.5 py-2 text-xs font-semibold text-cyan-200 disabled:opacity-60">
            {privacyBusy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}Export
          </button>
          <span>Saves a copy of this list, with private details removed.</span>
        </div>
      </ShowDetails>
      {privacyStatus && <p className="mt-4 rounded-lg border border-slate-700 bg-slate-950/60 p-3 text-xs text-slate-300">{privacyStatus}</p>}
      {actionError && <p role="alert" className="mt-4 rounded-lg border border-rose-500/30 bg-rose-950/30 p-3 text-xs text-rose-200"><ErrorText text={actionError} /></p>}
    </section>

    {recovery && <section role="alert" className="rounded-xl border border-amber-500/40 bg-amber-950/30 p-5 text-amber-100">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <p className="text-sm font-semibold">{recovery.kind === 'INTERRUPTED' ? `${recovery.pendingCount ?? 0} action${recovery.pendingCount === 1 ? '' : 's'} did not finish.` : 'Dialed could not finish checking your history.'}</p>
          <p className="mt-1 text-xs leading-relaxed text-amber-100/70">
            {recovery.kind === 'INTERRUPTED'
              ? 'Check again reads your PC and works out whether each unfinished change took effect. Nothing is lost.'
              : recovery.reason}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {recovery.kind === 'INTERRUPTED' && <button onClick={onRetryVerification} disabled={controlsDisabled} className="inline-flex items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-100 disabled:opacity-50">
            {recoveryBusy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}Check again</button>}
          {recovery.kind === 'CORRUPT' && recovery.recoverable && <button
            onClick={onRecoverCorruptJournal}
            disabled={controlsDisabled}
            className="inline-flex items-center gap-2 rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs font-semibold text-rose-100 disabled:opacity-50"
          >Preserve and start fresh</button>}
        </div>
      </div>
    </section>}

    <section aria-label="Filter by result" className="flex flex-wrap gap-2">
      <LedgerStat active={!focusedEntry && historyFilter === 'all'} onClick={() => pickFilter('all')} label="Total" value={`${entries.length}`} detail="All recorded changes." />
      <LedgerStat active={!focusedEntry && historyFilter === 'success'} onClick={() => pickFilter('success')} label="Success" value={`${counts.completed}`} detail="Finished and confirmed." />
      <LedgerStat active={!focusedEntry && historyFilter === 'needs-review'} onClick={() => pickFilter('needs-review')} label="Needs review" value={`${counts.needsReview}`} detail="Could not be confirmed; worth a look." />
      <LedgerStat active={!focusedEntry && historyFilter === 'failed'} onClick={() => pickFilter('failed')} label="Failed" value={`${counts.failed}`} detail="Windows refused or the change failed." />
      <LedgerStat active={!focusedEntry && historyFilter === 'pending'} onClick={() => pickFilter('pending')} label="Pending" value={`${counts.pending}`} detail="Still being checked." />
      <LedgerStat active={!focusedEntry && historyFilter === 'rollback'} onClick={() => pickFilter('rollback')} label="Can be undone" value={`${counts.rollbackAvailable}`} detail="Have a Restore button." />
      <LedgerStat active={!focusedEntry && historyFilter === 'unresolved'} onClick={() => pickFilter('unresolved')} label="Unfinished" value={`${counts.protected}`} detail="Kept until they are checked." />
    </section>

    <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
      <div className="grid min-w-0 gap-3 grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] items-end">
        <div className="min-w-0 space-y-1 text-xs text-slate-400">
          <p>Pick a result above, or filter here.</p>
          <p role="status" aria-live="polite" aria-atomic="true" className="text-[11px]">Showing {displayedEntries.length} of {entries.length} records</p>
        </div>
        <label className="block min-w-0 text-[11px] font-medium text-slate-300">
          <span className="mb-1 block"><Search className="mr-1 inline h-3.5 w-3.5" />Find</span>
          <input value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 outline-none focus:border-violet-400" placeholder="Search changes" />
        </label>
        <label className="block min-w-0 text-[11px] font-medium text-slate-300">
          <span className="mb-1 block">Show</span>
          <select
            value={historyFilter}
            onChange={(event) => setHistoryFilter(event.target.value as HistoryFilterValue)}
            disabled={controlsDisabled}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-300 disabled:opacity-60"
          >
            {HISTORY_FILTERS.map((filter) => <option key={filter.value} value={filter.value}>{filter.label}</option>)}
          </select>
        </label>
        <label className="block min-w-0 text-[11px] font-medium text-slate-300">
          <span className="mb-1 block">Sort</span>
          <select
            value={historySort}
            onChange={(event) => setHistorySort(event.target.value as 'newest' | 'oldest' | 'status')}
            disabled={controlsDisabled}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-300 disabled:opacity-60"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="status">Status</option>
          </select>
        </label>
        <button type="button" onClick={() => { showAll(); setHistorySort('newest'); }} className="inline-flex items-center justify-center gap-1 self-end rounded-lg border border-slate-700 px-2.5 py-2 text-[11px] text-slate-300"><SlidersHorizontal className="h-3.5 w-3.5" />Reset</button>
      </div>
    </section>

    {focusedEntry && <section role="status" className="flex flex-col gap-3 rounded-xl border border-cyan-500/30 bg-cyan-950/20 p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs text-cyan-100">Showing only the entry you opened: <strong>{focusedEntry.title}</strong>.</p>
      <button type="button" onClick={showAll} className="inline-flex shrink-0 items-center justify-center rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-200">Show all {entries.length} entries</button>
    </section>}

    {displayedEntries.length > 0 ? (
      <section className="space-y-3">
        {displayedEntries.map((entry) => { const undoneBy = undoLinks.undoneBy.get(entry.id); const undid = undoLinks.undid.get(entry.id); return <article id={`audit-entry-${entry.id}`} key={entry.id} className={`rounded-xl border p-4 ${entry.status === 'NEEDS_REVIEW' ? 'border-amber-500/40 bg-amber-950/20 text-amber-100' : entry.status === 'FAILED' ? 'border-rose-500/40 bg-rose-950/20 text-rose-200' : isUnresolved(entry) ? 'border-amber-500/40 bg-amber-950/20' : 'border-slate-800 bg-slate-900/70'}`}>
          <div className="flex flex-col justify-between gap-3 md:flex-row">
            <div>
              <div className="flex items-center gap-2">
                <span className={`rounded px-2 py-0.5 text-[11px] font-bold ${
                  entry.status === 'SUCCESS'
                    ? 'bg-emerald-500/10 text-emerald-300'
                    : entry.status === 'FAILED'
                      ? 'bg-rose-500/10 text-rose-300'
                      : 'bg-amber-500/10 text-amber-300'
                }`}>
                  {plainLabel(entry.status)}
                </span>
                {undoneBy && <span className="rounded bg-sky-500/10 px-2 py-0.5 text-[11px] font-bold text-sky-300">Undone</span>}
                {undid && <span className="rounded bg-sky-500/10 px-2 py-0.5 text-[11px] font-bold text-sky-300">Undo</span>}
                <h3 className="text-sm font-semibold text-slate-100">{entry.title}</h3>
              </div>
              <p className="mt-2 flex items-center gap-1 text-[11px] text-slate-500">
                <Clock3 className="h-3 w-3" />
                {new Date(entry.timestamp).toLocaleString()}<span data-technical-detail> · exit code {entry.exitCode ?? 'not available'}</span>
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-400">
              {undoneBy ? <span>Undone {new Date(undoneBy.timestamp).toLocaleString()} · <button type="button" onClick={() => jumpTo(undoneBy.id)} className="text-sky-300 underline-offset-2 hover:underline">see the undo</button></span>
                : undid ? <span>Reversed “{undid.title}” from {new Date(undid.timestamp).toLocaleString()} · <button type="button" onClick={() => jumpTo(undid.id)} className="text-sky-300 underline-offset-2 hover:underline">see the change</button></span>
                : <span>{entry.rollback.available ? 'Can be undone' : plainRollbackReason(entry.rollback.reason)}</span>}
              {entry.rollback.available && (
                <button
                  onClick={() => onRollback(entry)}
                  disabled={Boolean(rollingBackId) || privacyBusy}
                  className="inline-flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-amber-200 disabled:opacity-50"
                >
                  {rollingBackId === entry.id ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                  {rollingBackId === entry.id ? 'Restoring…' : 'Restore'}
                </button>
              )}
            </div>
          </div>
          {entry.reconciliation && (
            <p className="mt-3 rounded-lg border border-amber-500/20 bg-amber-950/20 p-3 text-xs text-amber-100">
              <strong>{plainLabel(entry.reconciliation.classification)}:</strong> <ErrorText text={entry.reconciliation.message} />
            </p>
          )}
          {entry.status === 'SUCCESS' && maintenanceSummary(entry.resultingState) && <p className="mt-3 text-xs text-slate-300">{maintenanceSummary(entry.resultingState)}</p>}
          {entry.status === 'SUCCESS' && <pre data-technical-detail className="mt-3 max-h-32 overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-3 text-[11px] text-slate-400">{JSON.stringify(entry.resultingState, null, 2)}</pre>}
          {entry.status === 'FAILED' && <p className="mt-3 rounded-lg border border-rose-500/20 bg-rose-950/20 p-3 text-xs text-rose-200"><ErrorText text={entry.stderr || entry.reconciliation?.message || 'Windows did not say why.'} /></p>}
          {/* Shown only when it adds something beyond the reconciliation message above. */}
          {entry.status === 'NEEDS_REVIEW' && entry.stderr && entry.stderr !== entry.reconciliation?.message && <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-950/30 p-3 text-xs text-amber-100"><ErrorText text={entry.stderr} /></p>}
          {!entry.stderr && !entry.reconciliation?.message && entry.status === 'NEEDS_REVIEW' && <p className="mt-3 rounded-lg border border-amber-500/20 bg-amber-950/20 p-3 text-xs text-amber-100">No message was returned from this run.</p>}
        </article>; })}
      </section>
    ) : (
      <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-8 text-center">
        <FileWarning className="mx-auto h-8 w-8 text-slate-600" />
        <p className="mt-3 text-sm text-slate-400">
          {historyFilter === 'all' ? 'No changes have been recorded on this PC yet.' : 'No entries match this filter.'}
        </p>
      </section>
    )}
  </div>;
}

// Older entries keep the wording they were saved with; show it the way it reads today.
const OLDER_REASONS: Record<string, string> = {
  'This maintenance action does not alter a reversible configuration state.': 'Nothing to undo: this task does not change any setting.',
};

function plainRollbackReason(reason: string | undefined): string {
  return reason ? OLDER_REASONS[reason] ?? reason : '';
}

function LedgerStat({ label, value, detail, active, onClick }: { label: string; value: string; detail: string; active: boolean; onClick: () => void }) {
  // Counts of zero are hidden, except the total; they appear as soon as there is one.
  if (value === '0' && label !== 'Total' && !active) return null;
  return <button type="button" onClick={onClick} aria-pressed={active} title={detail} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors hover:border-slate-500 ${active ? 'border-cyan-500/60 bg-cyan-950/30 text-cyan-100' : 'border-slate-700 bg-slate-900/60 text-slate-300'}`}>
    <span>{label}</span><span className="font-mono font-bold">{value}</span>
  </button>;
}

function maintenanceSummary(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const result = value as Record<string, unknown>;
  if (result.commandStatus !== 'COMPLETED') return null;
  const count = (key: string) => typeof result[key] === 'number' && Number.isFinite(result[key]) ? result[key] : 'unknown';
  return result.byteAccounting === 'SUM_OF_REMOVED_FILE_LENGTHS'
    ? `Done. Removed ${count('deletedFileCount')} files; skipped ${count('skippedFileCount')} that were in use.`
    : 'Windows ran the task.';
}
