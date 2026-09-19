import { ErrorText } from './ErrorText';
import { ExternalLink, Filter, Gamepad2, RefreshCw, Search, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { GameSettingsGuide } from '../types';
import { plainLabel } from '../lib/plainLabels';

interface GameSettingsCenterProps {
  guides: GameSettingsGuide[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

export function GameSettingsCenter({ guides, loading, error, onRefresh }: GameSettingsCenterProps) {
  const [query, setQuery] = useState('');
  const [platformFilter, setPlatformFilter] = useState<'all' | string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | GameSettingsGuide['status']>('all');
  const [sortMode, setSortMode] = useState<'name' | 'platform'>('name');

  const platformOptions = useMemo(() => ['all', ...new Set(guides.map((guide) => guide.platform))], [guides]);

  const filteredGuides = useMemo(() => {
    const rows = guides.filter((guide) => {
      if (platformFilter !== 'all' && guide.platform !== platformFilter) return false;
      if (statusFilter !== 'all' && guide.status !== statusFilter) return false;
      if (!query.trim()) return true;

      const terms = query.trim().toLowerCase();
      return guide.game.toLowerCase().includes(terms)
        || guide.platform.toLowerCase().includes(terms)
        || guide.objective.toLowerCase().includes(terms)
        || guide.applicability.toLowerCase().includes(terms)
        || guide.ongoingTesting.toLowerCase().includes(terms);
    });

    if (sortMode === 'platform') rows.sort((left, right) => left.platform.localeCompare(right.platform) || left.game.localeCompare(right.game));
    else rows.sort((left, right) => left.game.localeCompare(right.game));

    return rows;
  }, [guides, platformFilter, query, sortMode, statusFilter]);

  const resetFilters = () => {
    setQuery('');
    setPlatformFilter('all');
    setStatusFilter('all');
    setSortMode('name');
  };

  return <div className="space-y-6">
    <section className="rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-slate-900 via-slate-900 to-cyan-950/20 p-6 shadow-xl">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold text-cyan-200"><Gamepad2 className="h-3.5 w-3.5" /> Game guides</div>
          <h2 className="mt-3 text-2xl font-bold text-white">Setting guides for popular games</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-400">What each in-game setting does, what it costs, and how to test it. You change these in the game yourself. For a few games, Profiles can apply some of them for you.</p>
        </div>
        <button onClick={onRefresh} disabled={loading} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-60"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />{loading ? 'Loading…' : 'Refresh'}</button>
      </div>
      <div className="mt-4 flex gap-2 rounded-lg border border-emerald-500/20 bg-emerald-950/10 p-3 text-xs leading-relaxed text-emerald-100/80"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />Every guide is based on the game maker's own advice, checked against current sources.</div>
      {error && <p role="alert" className="mt-4 rounded-lg border border-rose-500/30 bg-rose-950/30 p-3 text-xs text-rose-200"><ErrorText text={error} /></p>}
    </section>

    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 text-xs text-slate-300">
      <div className="mb-2 flex flex-wrap gap-2">
        <label className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950/50 px-2 py-1.5">
          <Search className="h-3.5 w-3.5 text-slate-400" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search games" className="w-72 bg-transparent outline-none placeholder:text-slate-500" />
        </label>
        <label className="text-[11px] text-slate-400">
          <div className="mb-1 flex items-center gap-1"><Filter className="h-3 w-3" /> Platform</div>
          <select value={platformFilter} onChange={(event) => setPlatformFilter(event.target.value)} className="rounded border border-slate-700 bg-slate-950/50 px-2 py-1 text-xs text-slate-100">
            {platformOptions.map((platform) => <option key={platform} value={platform}>{platform}</option>)}
          </select>
        </label>
        <label className="text-[11px] text-slate-400">
          <div className="mb-1">Status</div>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | GameSettingsGuide['status'])} className="rounded border border-slate-700 bg-slate-950/50 px-2 py-1 text-xs text-slate-100">
            <option value="all">All</option>
            <option value="VERIFIED_GUIDANCE">Verified guidance</option>
          </select>
        </label>
        <label className="text-[11px] text-slate-400">
          <div className="mb-1">Sort</div>
          <select value={sortMode} onChange={(event) => setSortMode(event.target.value as 'name' | 'platform')} className="rounded border border-slate-700 bg-slate-950/50 px-2 py-1 text-xs text-slate-100">
            <option value="name">Game</option>
            <option value="platform">Platform</option>
          </select>
        </label>
        <button onClick={resetFilters} className="rounded-lg border border-slate-700 bg-slate-950/50 px-2 py-1 text-[11px] text-slate-300">Reset</button>
      </div>
      <p role="status" aria-live="polite" aria-atomic="true" className="text-slate-500">Showing <span className="font-semibold text-slate-200">{filteredGuides.length}</span> of <span className="font-semibold text-slate-200">{guides.length}</span> game guides.</p>
    </section>

    {filteredGuides.map((guide) => <article key={guide.id} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-xl">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-bold text-slate-100">{guide.game}</h3><span className="rounded bg-emerald-500/10 px-2 py-0.5 text-[11px] font-bold text-emerald-300">{plainLabel(guide.status)}</span><span className="rounded bg-slate-800 px-2 py-0.5 text-[11px] font-semibold text-slate-400">{plainLabel(guide.automation)}</span></div>
          <p data-technical-detail className="mt-1 text-xs text-slate-500">{guide.platform} · reviewed {guide.lastReviewed}</p>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-300">{guide.objective}</p>
          <p className="mt-2 max-w-3xl text-xs leading-relaxed text-slate-500">{guide.applicability}</p>
        </div>
        <SlidersHorizontal className="h-6 w-6 shrink-0 text-cyan-400" />
      </div>

      <details className="mt-4 rounded-xl border border-slate-800 bg-slate-950/30 p-3">
      <summary className="cursor-pointer text-xs font-semibold text-cyan-200">Show {guide.settings.length} setting{guide.settings.length === 1 ? '' : 's'}, testing notes and sources</summary>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">{guide.settings.map((setting) => <section key={setting.id} className="rounded-xl border border-slate-800 bg-slate-950/45 p-4">
        <h4 className="text-sm font-semibold text-cyan-200">{setting.label}</h4>
        <p className="mt-2 text-xs leading-relaxed text-slate-300">{setting.recommendation}</p>
        <dl className="mt-3 space-y-2 text-[11px] leading-relaxed">
          <GuideDetail label="Why it may help" value={setting.rationale} />
          <GuideDetail label="Tradeoff" value={setting.tradeoff} />
          <GuideDetail label="Verify" value={setting.verification} />
        </dl>
      </section>)}</div>

      <div className="mt-4 rounded-lg border border-violet-500/20 bg-violet-950/15 p-3 text-xs leading-relaxed text-violet-100/80"><span className="font-semibold text-violet-300">How to test: </span>{guide.ongoingTesting}</div>
      <div className="mt-4 flex flex-wrap gap-3">{guide.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400 underline decoration-slate-700 underline-offset-2 hover:text-cyan-300">{source.title}<ExternalLink className="h-3 w-3" /></a>)}</div>
      </details>
    </article>)}

    {!loading && guides.length === 0 && !error && <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-8 text-center"><Gamepad2 className="mx-auto h-8 w-8 text-slate-600" /><p className="mt-3 text-sm text-slate-400">No guides available yet.</p></section>}
    {!loading && guides.length > 0 && filteredGuides.length === 0 && <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-8 text-center"><Gamepad2 className="mx-auto h-8 w-8 text-slate-600" /><p className="mt-3 text-sm text-slate-400">Nothing matches these filters.</p></section>}
  </div>;
}

function GuideDetail({ label, value }: { label: string; value: string }) {
  return <div><dt className="font-semibold text-slate-500">{label}</dt><dd className="mt-0.5 text-slate-400">{value}</dd></div>;
}
