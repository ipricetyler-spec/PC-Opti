import { AlertTriangle, CheckCircle2, ListChecks, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import type { StartupManagementItem } from '../types';

interface StartupCenterProps {
  items: StartupManagementItem[];
  errors: Array<{ component: string; message: string }>;
  loading: boolean;
  activeItemId: string | null;
  actionError: string | null;
  onRefresh: () => void;
  onDisable: (item: StartupManagementItem) => void;
}

export function StartupCenter({
  items,
  errors,
  loading,
  activeItemId,
  actionError,
  onRefresh,
  onDisable,
}: StartupCenterProps) {
  const manageable = items.filter((item) => item.canDisable);
  const readOnly = items.length - manageable.length;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div className="flex items-start gap-3">
            <ListChecks className="mt-0.5 h-5 w-5 text-cyan-400" />
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-cyan-300">
                Startup Center
                <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-0.5 text-[10px]">Native Windows inventory</span>
              </div>
              <h2 className="mt-2 text-xl font-bold text-white">Review what starts with Windows</h2>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-400">
                PC-Opti reads known Registry Run locations and enabled logon or boot scheduled tasks. It never estimates startup impact or disables entries in bulk.
              </p>
            </div>
          </div>
          <button
            onClick={onRefresh}
            disabled={loading || Boolean(activeItemId)}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Refreshing…' : 'Refresh inventory'}
          </button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <Summary label="Enabled entries found" value={items.length.toString()} />
          <Summary label="Individually manageable" value={manageable.length.toString()} tone="cyan" />
          <Summary label="Read-only entries" value={readOnly.toString()} tone="slate" />
        </div>

        <div className="mt-4 flex gap-2 rounded-lg border border-amber-500/25 bg-amber-950/20 p-3 text-xs leading-relaxed text-amber-100/90">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" />
          This release supports only current-user Registry Run entries. Machine-wide entries and scheduled tasks remain visible but read-only; changes are journaled with an exact rollback value.
        </div>
      </section>

      {(errors.length > 0 || actionError) && (
        <section className="rounded-xl border border-rose-500/30 bg-rose-950/20 p-4 text-xs text-rose-100">
          {actionError && <p>{actionError}</p>}
          {errors.map((error) => <p key={`${error.component}-${error.message}`}>{error.component}: {error.message}</p>)}
        </section>
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70">
        <div className="border-b border-slate-800 px-5 py-4">
          <h3 className="text-sm font-semibold text-slate-100">Detected entries</h3>
          <p className="mt-1 text-xs text-slate-500">The command path is shown exactly as returned by Windows.</p>
        </div>
        <div className="divide-y divide-slate-800/70">
          {items.map((item) => {
            const running = activeItemId === item.id;
            return (
              <article key={item.id} className="p-5">
                <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-sm font-semibold text-slate-100">{item.name}</h4>
                      <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                        <CheckCircle2 className="h-3 w-3" /> Enabled
                      </span>
                      <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">{item.source}</span>
                      <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">{item.scope}</span>
                    </div>
                    <p className="mt-2 break-all font-mono text-[11px] leading-relaxed text-slate-500">{item.path || 'Windows did not return an executable path.'}</p>
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
          {!loading && items.length === 0 && <p className="p-8 text-center text-sm text-slate-500">No enabled startup entries were returned by Windows.</p>}
        </div>
      </section>
    </div>
  );
}

function Summary({ label, value, tone = 'slate' }: { label: string; value: string; tone?: 'cyan' | 'slate' }) {
  return <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><p className="text-[11px] text-slate-500">{label}</p><p className={`mt-1 text-xl font-bold ${tone === 'cyan' ? 'text-cyan-300' : 'text-slate-200'}`}>{value}</p></div>;
}
