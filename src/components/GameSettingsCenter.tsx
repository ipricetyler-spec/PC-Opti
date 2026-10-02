import { ErrorText } from './ErrorText';
import { ChevronDown, ExternalLink, Gamepad2, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { GameSettingHelps, GameSettingsGuide } from '../types';

interface GameSettingsCenterProps {
  guides: GameSettingsGuide[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

const HELPS_LABEL: Record<GameSettingHelps, string> = {
  FRAME_RATE: 'Frame rate', LATENCY: 'Latency', VISIBILITY: 'Visibility', SMOOTHNESS: 'Smoothness',
  STABILITY: 'Stability', AIM: 'Aim', AWARENESS: 'Awareness',
};
const HELPS_ORDER = Object.keys(HELPS_LABEL) as GameSettingHelps[];
const KIND_LABEL = { GAME_MAKER: 'Game maker', GPU_MAKER: 'GPU maker', TESTED: 'Tested', PRESS: 'Press' } as const;

// "EA Help — Best settings…" → "EA Help": the row credits who said it without repeating the title.
const shortSource = (title: string) => title.split(' — ')[0];

export function GameSettingsCenter({ guides, loading, error, onRefresh }: GameSettingsCenterProps) {
  const [query, setQuery] = useState('');
  const [helps, setHelps] = useState<GameSettingHelps | 'ALL'>('ALL');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [details, setDetails] = useState<Set<string>>(new Set());

  // A search matches a game by name, or a setting by its name or value; a filter keeps only the
  // rows that help with it. Either one opens the matching games, since the rows are the answer.
  const visible = useMemo(() => {
    const terms = query.trim().toLowerCase();
    return [...guides].sort((a, b) => a.game.localeCompare(b.game)).map((guide) => {
      const gameMatches = !terms || guide.game.toLowerCase().includes(terms);
      const rows = guide.settings.filter((setting) => (helps === 'ALL' || setting.helps === helps)
        && (gameMatches || `${setting.label} ${setting.value}`.toLowerCase().includes(terms)));
      return { guide, rows };
    }).filter((item) => item.rows.length > 0);
  }, [guides, helps, query]);
  const filtering = query.trim() !== '' || helps !== 'ALL';
  const toggle = (set: Set<string>, id: string, update: (next: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    update(next);
  };

  return <div className="space-y-5">
    <section className="rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-slate-900 via-slate-900 to-cyan-950/20 p-6 shadow-xl">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold text-cyan-200"><Gamepad2 className="h-3.5 w-3.5" /> Game guides</div>
          <h2 className="mt-3 text-2xl font-bold text-white">Settings worth changing, game by game</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-400">What to set, and why in one line. You change these in the game yourself.</p>
        </div>
        <button onClick={onRefresh} disabled={loading} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-60"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />{loading ? 'Loading…' : 'Refresh'}</button>
      </div>
      <div className="mt-4 flex gap-2 rounded-lg border border-emerald-500/20 bg-emerald-950/10 p-3 text-xs leading-relaxed text-emerald-100/80"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />Every row says who recommends it: the game's maker, a GPU maker, or a site that tested it. None of it promises a frame rate.</div>
      {error && <p role="alert" className="mt-4 rounded-lg border border-rose-500/30 bg-rose-950/30 p-3 text-xs text-rose-200"><ErrorText text={error} /></p>}
    </section>

    <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 text-xs text-slate-300">
      <label className="flex max-w-md items-center gap-2 rounded-lg border border-slate-700 bg-slate-950/50 px-2.5 py-1.5">
        <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search a game or a setting" aria-label="Search a game or a setting" className="w-full bg-transparent outline-none placeholder:text-slate-500" />
      </label>
      <div role="group" aria-label="Show settings that help with" className="flex flex-wrap gap-1.5">
        {(['ALL', ...HELPS_ORDER] as const).map((value) => <button key={value} type="button" aria-pressed={helps === value} onClick={() => setHelps(value)}
          className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${helps === value ? 'border-cyan-400/60 bg-cyan-400/15 text-cyan-100' : 'border-slate-700 bg-slate-950/40 text-slate-400 hover:text-slate-200'}`}>{value === 'ALL' ? 'Everything' : HELPS_LABEL[value]}</button>)}
      </div>
      <p role="status" aria-live="polite" aria-atomic="true" className="text-slate-500">Showing {filtering
        ? `${visible.reduce((sum, item) => sum + item.rows.length, 0)} settings in ${visible.length} of ${guides.length} games.`
        : `all ${guides.length} games.`}</p>
    </section>

    {visible.map(({ guide, rows }) => {
      const expanded = filtering || open.has(guide.id);
      const showDetails = details.has(guide.id);
      return <article key={guide.id} className="rounded-2xl border border-slate-800 bg-slate-900/70 shadow-xl">
        <button type="button" aria-expanded={expanded} aria-controls={`guide-${guide.id}`} onClick={() => toggle(open, guide.id, setOpen)} disabled={filtering}
          className="flex w-full items-start justify-between gap-3 p-4 text-left disabled:cursor-default">
          <span>
            <span className="text-base font-bold text-slate-100">{guide.game}</span>
            <span className="mt-1 block text-xs leading-relaxed text-slate-400">{guide.summary}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-semibold text-cyan-200">{rows.length} setting{rows.length === 1 ? '' : 's'}{!filtering && <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />}</span>
        </button>
        {expanded && <div id={`guide-${guide.id}`} className="border-t border-slate-800 px-4 pb-4">
          <div aria-hidden className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] gap-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 md:grid"><span>Setting · set to</span><span>Helps · why</span></div>
          <ul className="divide-y divide-slate-800/70">
            {rows.map((setting) => {
              const source = setting.source === null ? null : guide.sources[setting.source];
              const detailSource = setting.detailSource !== undefined ? guide.sources[setting.detailSource] : source;
              return <li key={setting.id} className="grid gap-1 py-2.5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] md:gap-4">
                <span><span className="block text-sm font-semibold text-slate-100">{setting.label}</span><span className="block text-sm text-cyan-200">{setting.value}</span></span>
                <span className="text-xs leading-relaxed text-slate-400"><span className="mr-1.5 inline-block rounded bg-slate-800 px-1.5 py-0.5 text-[11px] font-semibold text-slate-300">{HELPS_LABEL[setting.helps]}</span>{setting.why} <span className="text-slate-500">— {source ? shortSource(source.title) : 'Dialed'}</span>
                  {showDetails && setting.detail && <span className="mt-1 block text-slate-300"><span className="font-semibold text-amber-200/90">Cost: </span>{setting.detail}{detailSource && detailSource !== source ? <span className="text-slate-500"> — {shortSource(detailSource.title)}</span> : null}</span>}
                </span>
              </li>;
            })}
          </ul>
          <button type="button" aria-expanded={showDetails} onClick={() => toggle(details, guide.id, setDetails)} className="mt-2 text-[11px] font-semibold text-cyan-300 underline decoration-cyan-800 underline-offset-2">{showDetails ? 'Hide costs, testing and sources' : 'Show costs, testing and sources'}</button>
          {showDetails && <div className="mt-3 space-y-2 text-xs leading-relaxed">
            <p className="text-violet-100/80"><span className="font-semibold text-violet-300">How to test: </span>{guide.howToTest}</p>
            {guide.boundaries.map((line) => <p key={line} className="text-slate-500">{line}</p>)}
            <ul className="flex flex-col gap-1">{guide.sources.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400 underline decoration-slate-700 underline-offset-2 hover:text-cyan-300">{source.title}<ExternalLink className="h-3 w-3" /></a> <span className="text-[11px] text-slate-500">· {KIND_LABEL[source.kind]}</span></li>)}</ul>
            <p data-technical-detail className="text-[11px] text-slate-500">{guide.platform} · reviewed {guide.lastReviewed}</p>
          </div>}
        </div>}
      </article>;
    })}

    {!loading && guides.length === 0 && !error && <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-8 text-center"><Gamepad2 className="mx-auto h-8 w-8 text-slate-600" /><p className="mt-3 text-sm text-slate-400">No guides available yet.</p></section>}
    {!loading && guides.length > 0 && visible.length === 0 && <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-8 text-center"><Gamepad2 className="mx-auto h-8 w-8 text-slate-600" /><p className="mt-3 text-sm text-slate-400">Nothing matches. Try another word or Everything.</p></section>}
  </div>;
}
