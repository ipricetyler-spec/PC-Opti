import { ErrorText } from './ErrorText';
import { ExternalLink, FlaskConical, LoaderCircle, RefreshCw, RotateCcw, ShieldAlert, TimerReset, AlertTriangle, BadgeCheck } from 'lucide-react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { TimingExperiment } from '../types';

interface PerformanceLabProps {
  items: TimingExperiment[];
  errors: Array<{ component: string; message: string }>;
  loading: boolean;
  activeActionId: TimingExperiment['actionId'];
  status: string | null;
  error: string | null;
  onRefresh: () => void;
  onExecute: (item: TimingExperiment) => void;
}

function availabilityClass(availability: TimingExperiment['availability']) {
  if (availability === 'APPLICABLE') return 'border-cyan-500/25 bg-cyan-500/10 text-cyan-200';
  if (availability === 'RESEARCH_ONLY') return 'border-violet-500/25 bg-violet-500/10 text-violet-200';
  if (availability === 'UNAVAILABLE') return 'border-rose-500/25 bg-rose-500/10 text-rose-200';
  return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200';
}

export function PerformanceLab({ items, errors, loading, activeActionId, status, error, onRefresh, onExecute }: PerformanceLabProps) {
  const [query, setQuery] = useState('');
  const [availabilityFilter, setAvailabilityFilter] = useState<'All' | 'APPLICABLE' | 'ALREADY_DEFAULT' | 'ALREADY_CONFIGURED' | 'RESEARCH_ONLY' | 'UNAVAILABLE'>('All');
  const [riskFilter, setRiskFilter] = useState<'All' | 'Medium' | 'Research'>('All');
  const [actionableOnly, setActionableOnly] = useState(false);
  const [sortMode, setSortMode] = useState<'risk' | 'availability' | 'name'>('availability');
  const summary = useMemo(() => {
    const breakdown = {
      total: items.length,
      actionable: items.filter((item) => item.actionId).length,
      applicable: items.filter((item) => item.availability === 'APPLICABLE').length,
      configured: items.filter((item) => item.availability === 'ALREADY_DEFAULT' || item.availability === 'ALREADY_CONFIGURED').length,
      researchOnly: items.filter((item) => item.availability === 'RESEARCH_ONLY').length,
      unavailable: items.filter((item) => item.availability === 'UNAVAILABLE').length,
      requiresReboot: items.filter((item) => item.requiresReboot).length,
      requiresElevation: items.filter((item) => item.requiresElevation).length,
    };
    return breakdown;
  }, [items]);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredItems = useMemo(() => {
    const matches = items.filter((item) => {
      if (availabilityFilter !== 'All' && item.availability !== availabilityFilter) return false;
      if (riskFilter !== 'All' && (riskFilter === 'Research' ? item.risk !== 'Research' : item.risk !== 'Medium')) return false;
      if (actionableOnly && !item.actionId) return false;
      if (!normalizedQuery) return true;
      const haystack = `${item.title} ${item.hypothesis} ${item.framing} ${item.ongoingTesting}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
    const riskRank = (risk: TimingExperiment['risk']) => risk === 'Medium' ? 0 : 1;
    const availabilityRank = (availability: TimingExperiment['availability']) => {
      if (availability === 'APPLICABLE') return 0;
      if (availability === 'ALREADY_CONFIGURED' || availability === 'ALREADY_DEFAULT') return 1;
      if (availability === 'RESEARCH_ONLY') return 2;
      return 3;
    };
    matches.sort((left, right) => {
      if (sortMode === 'risk') return riskRank(left.risk) - riskRank(right.risk);
      if (sortMode === 'name') return left.title.localeCompare(right.title);
      if (left.actionId && !right.actionId) return -1;
      if (!left.actionId && right.actionId) return 1;
      return availabilityRank(left.availability) - availabilityRank(right.availability);
    });
    return matches;
  }, [actionableOnly, availabilityFilter, items, normalizedQuery, riskFilter, sortMode]);

  return <div id="performance-lab" className="scroll-mt-6 space-y-6">
    <section className="rounded-2xl border border-violet-500/20 bg-gradient-to-br from-slate-900 via-slate-900 to-violet-950/20 p-6 shadow-xl">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div className="max-w-3xl">
          <div data-technical-detail className="inline-flex items-center gap-2 rounded-full border border-violet-400/20 bg-violet-400/10 px-3 py-1 text-[11px] font-semibold text-violet-200"><FlaskConical className="h-3.5 w-3.5" /> Guarded experiment controls</div>
          <h2 className="mt-3 text-2xl font-bold text-white">Boot timing settings</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-400">Two settings that control how Windows keeps time. Each change backs up the boot settings first, needs a restart, and can be undone exactly.</p>
        </div>
        <button onClick={onRefresh} disabled={loading || Boolean(activeActionId)} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-60"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />{loading ? 'Reading…' : 'Refresh'}</button>
      </div>
      <div data-technical-detail className="mt-4 grid gap-3 md:grid-cols-4">
        <LabStat title="Settings found" value={summary.total} tone={summary.total > 0 ? 'ok' : 'warn'} />
        <LabStat title="Actionable" value={summary.actionable} tone={summary.actionable > 0 ? 'ok' : 'warn'} />
        <LabStat title="Need a restart" value={summary.requiresReboot} tone={summary.requiresReboot > 0 ? 'warn' : 'ok'} />
        <LabStat title="Need administrator" value={summary.requiresElevation} tone={summary.requiresElevation > 0 ? 'warn' : 'ok'} />
      </div>
      <div data-technical-detail className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-[1fr,150px,170px,170px]">
        <label className="block text-[11px] font-medium text-slate-300">
          <span className="mb-1 block"><Search className="mr-1 inline h-3.5 w-3.5" />Find</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 outline-none focus:border-violet-400" placeholder="Search" />
        </label>
        <label className="block text-[11px] font-medium text-slate-300">
          <span className="mb-1 block">Availability</span>
          <select value={availabilityFilter} onChange={(event) => setAvailabilityFilter(event.target.value as 'All' | 'APPLICABLE' | 'ALREADY_DEFAULT' | 'ALREADY_CONFIGURED' | 'RESEARCH_ONLY' | 'UNAVAILABLE')} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 outline-none focus:border-violet-400">
            <option value="All">All</option>
            <option value="APPLICABLE">Applicable</option>
            <option value="ALREADY_CONFIGURED">Configured</option>
            <option value="ALREADY_DEFAULT">Default</option>
            <option value="RESEARCH_ONLY">Information only</option>
            <option value="UNAVAILABLE">Unavailable</option>
          </select>
        </label>
        <label className="block text-[11px] font-medium text-slate-300">
          <span className="mb-1 block">Risk</span>
          <select value={riskFilter} onChange={(event) => setRiskFilter(event.target.value as 'All' | 'Medium' | 'Research')} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 outline-none focus:border-violet-400">
            <option value="All">All risks</option>
            <option value="Medium">Medium</option>
            <option value="Research">Research</option>
          </select>
        </label>
        <label className="block text-[11px] font-medium text-slate-300">
          <span className="mb-1 block">Sort</span>
          <select value={sortMode} onChange={(event) => setSortMode(event.target.value as 'risk' | 'availability' | 'name')} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 outline-none focus:border-violet-400">
            <option value="availability">Availability</option>
            <option value="risk">Risk</option>
            <option value="name">Name</option>
          </select>
        </label>
      </div>
      <div data-technical-detail className="mt-3 flex flex-wrap items-center gap-2">
        <button onClick={() => setActionableOnly((current) => !current)} className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[11px] font-semibold ${actionableOnly ? 'border-cyan-300/40 bg-cyan-400/20 text-cyan-100' : 'border-slate-700 bg-slate-900/60 text-slate-300'}`}>
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Actionable only
        </button>
        <button onClick={() => { setQuery(''); setAvailabilityFilter('All'); setRiskFilter('All'); setActionableOnly(false); setSortMode('availability'); }} className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900/60 px-3 py-1 text-[11px] font-semibold text-slate-300">
          <X className="h-3.5 w-3.5" />
          Reset
        </button>
        <p className="text-[11px] text-slate-400">{filteredItems.length} / {items.length} experiments shown</p>
      </div>
      <div data-technical-detail className="mt-3 flex flex-wrap gap-2">
        <span className="rounded-full border border-cyan-400/25 bg-cyan-400/10 px-2.5 py-1 text-[11px] text-cyan-200">Applicable: {summary.applicable}</span>
        <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 text-[11px] text-emerald-200">Already-configured/default: {summary.configured}</span>
        <span className="rounded-full border border-violet-400/25 bg-violet-400/10 px-2.5 py-1 text-[11px] text-violet-200">Research-only: {summary.researchOnly}</span>
        <span className="rounded-full border border-rose-400/25 bg-rose-400/10 px-2.5 py-1 text-[11px] text-rose-200">Unavailable: {summary.unavailable}</span>
      </div>
      <div data-technical-detail className="mt-4 grid gap-3 text-xs md:grid-cols-3">
        <LabPrinciple icon={<TimerReset className="h-4 w-4" />} title="Hardware-dependent" text="What helps one PC or game may not help another." />
        <LabPrinciple icon={<RotateCcw className="h-4 w-4" />} title="Exact undo" text="Dialed saves the previous value and puts it back exactly, unless something else has changed it since." />
        <LabPrinciple icon={<FlaskConical className="h-4 w-4" />} title="Measure it" text="A setting being on does not mean it is faster. Restart, then measure before and after." />
      </div>
    </section>

    <section className="rounded-xl border border-amber-500/25 bg-amber-950/15 p-4 text-xs leading-relaxed text-amber-100/90">
      <div className="flex gap-2"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" /><p>Boot Configuration Data affects Windows startup. Dialed must be running as administrator; it exports and hashes the BCD store before a write, verifies only the configured value, and reports the runtime effect and performance outcome as unverified until reboot and matched testing.</p></div>
    </section>

    {status && <p className="rounded-lg border border-cyan-500/25 bg-cyan-950/20 p-3 text-xs text-cyan-100">{status}</p>}
    {error && <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-950/30 p-3 text-xs text-rose-200"><ErrorText text={error} /></p>}
    {errors.length > 0 && <section className="rounded-xl border border-amber-500/25 bg-amber-950/15 p-4"><h3 className="text-xs font-semibold text-amber-200">Read limits</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-100/75">{errors.map((item) => <li key={`${item.component}-${item.message}`}>{item.component}: {item.message}</li>)}</ul></section>}

    {filteredItems.length === 0 ? (
      <section className="rounded-2xl border border-violet-500/30 bg-violet-950/20 p-6 text-sm text-slate-300">
        <div className="flex items-start gap-2">
          <ShieldAlert className="mt-0.5 h-4 w-4 text-violet-300" />
          <div>
            <p className="font-semibold text-slate-100">No timing experiments are currently eligible.</p>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-400">No experiments match the active filters. Re-run the scan or clear filters and try again.</p>
          </div>
        </div>
      </section>
    ) : (
      <section className="grid gap-4 xl:grid-cols-3">
        {filteredItems.map((item) => {
        const running = activeActionId === item.actionId && item.actionId !== null;
        return <article key={item.id} data-technical-detail={item.kind === 'RESEARCH_ONLY' ? '' : undefined} className="flex flex-col rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={`rounded border px-2 py-1 text-[11px] font-bold ${availabilityClass(item.availability)}`}>{item.availability.replaceAll('_', ' ')}</span>
            <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-500">
              <span>Risk: {item.risk}</span>
              {item.availability === 'UNAVAILABLE'
                ? <AlertTriangle className="h-3.5 w-3.5 text-rose-300" />
                : <BadgeCheck className="h-3.5 w-3.5 text-emerald-300" />}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">Action: {item.actionLabel}</span>
            {item.requiresReboot && <span className="rounded border border-amber-400/25 bg-amber-400/10 px-2 py-0.5 text-[11px] text-amber-200">Requires reboot</span>}
            {item.requiresElevation && <span className="rounded border border-rose-400/25 bg-rose-400/10 px-2 py-0.5 text-[11px] text-rose-200">Requires elevation</span>}
            <span data-technical-detail className="rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">Actionable: {item.actionId ? 'Yes' : 'No'}</span>
          </div>
          <h3 className="mt-3 font-semibold text-slate-100">{item.title}</h3>
          <p className="mt-2 text-xs leading-relaxed text-cyan-100/80">{item.framing}</p>
          <dl className="mt-4 space-y-3 text-xs">
            <LabDetail label="Current configured state" value={item.currentState} />
            <LabDetail technical label="Testable hypothesis" value={item.hypothesis} />
            <LabDetail label="Limits" value={item.limitations} />
            <LabDetail label="Rollback" value={item.rollback} />
          </dl>
          <div className="mt-4 rounded-lg border border-violet-500/20 bg-violet-950/15 p-3 text-[11px] leading-relaxed text-violet-100/80"><span className="font-semibold text-violet-300">How to verify: </span>{item.ongoingTesting.replace(/^Ongoing verification:\s*/i, '')}</div>
          <div data-technical-detail className="mt-3 flex flex-wrap gap-2">{item.sources.map((source) => <a key={source} href={source} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400 underline decoration-slate-700 underline-offset-2 hover:text-cyan-300">Microsoft guidance <ExternalLink className="h-3 w-3" /></a>)}</div>
          <button onClick={() => onExecute(item)} disabled={!item.actionId || Boolean(activeActionId) || loading} className="mt-5 inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-400 px-3 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500">
            {running ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : item.kind === 'RESEARCH_ONLY' ? <FlaskConical className="h-3.5 w-3.5" /> : <TimerReset className="h-3.5 w-3.5" />}
            {running ? 'Configuring and verifying…' : item.actionLabel}
          </button>
          {item.unavailableReason && item.availability !== 'RESEARCH_ONLY' && <p className="mt-2 text-[11px] leading-relaxed text-rose-300/80">{item.unavailableReason}</p>}
        </article>;
        })}
      </section>
    )}
  </div>;
}

function LabStat({ title, value, tone }: { title: string; value: number; tone: 'ok' | 'warn' }) {
  const classes = tone === 'ok' ? 'border-emerald-500/25 bg-emerald-950/15 text-emerald-100/80' : 'border-amber-500/25 bg-amber-950/15 text-amber-100/80';
  return <article className={`rounded-lg border p-3 ${classes}`}>
    <p className="text-[11px] uppercase tracking-wide text-slate-500">{title}</p>
    <p className="mt-1 text-xl font-bold">{value}</p>
  </article>;
}

function LabPrinciple({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3"><div className="flex items-center gap-2 font-semibold text-slate-200"><span className="text-violet-300">{icon}</span>{title}</div><p className="mt-1 leading-relaxed text-slate-500">{text}</p></div>;
}

function LabDetail({ label, value, technical = false }: { label: string; value: string; technical?: boolean }) {
  return <div data-technical-detail={technical ? '' : undefined}><dt className="font-semibold text-slate-400">{label}</dt><dd className="mt-1 leading-relaxed text-slate-500">{value}</dd></div>;
}
