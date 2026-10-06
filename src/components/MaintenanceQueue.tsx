import { ErrorText } from './ErrorText';
import { CheckCircle2, ClipboardCheck, LoaderCircle, ShieldAlert } from 'lucide-react';
import type { MaintenanceAction } from '../types';

interface MaintenanceQueueProps {
  actions: MaintenanceAction[];
  activeActionId: string | null;
  error: string | null;
  onExecute: (action: MaintenanceAction) => void;
}

// Clearing shader caches is the one task worth doing on purpose (after a driver update); the rest is
// housekeeping Windows mostly does anyway, so it follows. A few tasks need no search or filters.
const ORDER: Record<MaintenanceAction['kind'], number> = { 'clear-shader-caches': 0, 'clear-temp-files': 1, 'clear-crash-dumps': 2, 'retrim-drive': 3 };

export function MaintenanceQueue({ actions, activeActionId, error, onExecute }: MaintenanceQueueProps) {
  const ordered = [...actions].sort((left, right) => (ORDER[left.kind] ?? 9) - (ORDER[right.kind] ?? 9) || left.title.localeCompare(right.title));
  return <div className="space-y-6"><section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6"><div className="flex items-start gap-3"><ClipboardCheck className="mt-0.5 h-5 w-5 text-cyan-400" /><div><h2 className="text-xl font-bold text-white">Upkeep</h2><p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-400">Housekeeping based on your latest scan, one task at a time. None of it makes games faster on its own.</p></div></div><div className="mt-4 flex gap-2 rounded-lg border border-amber-500/25 bg-amber-950/20 p-3 text-xs text-amber-100/90"><ShieldAlert className="h-4 w-4 shrink-0 text-amber-300" />Deleted files cannot be brought back. Every task is recorded in Restore › History.</div></section>{error && <p className="rounded-lg border border-rose-500/30 bg-rose-950/30 p-3 text-xs text-rose-200"><ErrorText text={error} /></p>}
    <section className="grid gap-4 lg:grid-cols-2">{ordered.map((action) => { const running = action.id === activeActionId; return <article key={action.id} className="rounded-xl border border-slate-800 bg-slate-900/70 p-5"><div className="flex items-start justify-between gap-4"><div><h3 className="font-semibold text-slate-100">{action.title}</h3><p className="mt-1 text-xs leading-relaxed text-slate-400">{action.description}</p></div><span className={`shrink-0 rounded px-2 py-1 text-[11px] font-semibold ${action.reversible ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}>{action.reversible ? 'REVERSIBLE' : 'NOT REVERSIBLE'}</span></div><div data-technical-detail className="mt-4 rounded-lg bg-slate-950/70 p-3 text-xs text-cyan-200"><span className="font-semibold text-cyan-400">From your scan: </span>{action.evidence}</div><button onClick={() => onExecute(action)} disabled={Boolean(activeActionId)} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-cyan-400 px-3 py-2 text-xs font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50">{running ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}{running ? 'Running…' : 'Review and run'}</button></article>; })}{actions.length === 0 && <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-6 text-sm text-slate-400">Nothing needs doing right now.</section>}</section>
  </div>;
}
