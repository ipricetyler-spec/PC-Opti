import { ErrorText } from './ErrorText';
import { AlertTriangle, ArchiveRestore, FolderSearch, Gamepad2, HardDriveDownload, RefreshCw, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { GameConfigBackup, GameSettingsGuide, InstalledGameDiscovery } from '../types';

interface GameConfigCenterProps {
  mode?: 'all' | 'discovery' | 'backups';
  guides: GameSettingsGuide[];
  discovery: InstalledGameDiscovery | null;
  backups: GameConfigBackup[];
  loading: boolean;
  busy: boolean;
  error: string | null;
  status: string | null;
  onRefresh: () => void;
  onBackup: (gameId: string) => void;
  onRestore: (backupId: string) => void;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function GameConfigCenter({ mode = 'all', guides, discovery, backups, loading, busy, error, status, onRefresh, onBackup, onRestore }: GameConfigCenterProps) {
  const [selectedGuideId, setSelectedGuideId] = useState('');
  const [query, setQuery] = useState('');
  const guideNames = useMemo(() => new Map(guides.map((guide) => [guide.id, guide.game])), [guides]);
  const effectiveGuideId = selectedGuideId || discovery?.games[0]?.guideId || guides[0]?.id || '';
  const detectedGames = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return discovery?.games || [];
    return (discovery?.games || []).filter((game) => `${game.game} ${game.detectedDisplayName} ${game.publisher}`.toLowerCase().includes(needle));
  }, [discovery?.games, query]);

  return <section className="mb-6 rounded-2xl border border-violet-500/20 bg-gradient-to-br from-slate-900 via-slate-900 to-violet-950/20 p-6 shadow-xl">
    <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
      <div className="max-w-3xl">
        <div className="inline-flex items-center gap-2 rounded-full border border-violet-400/20 bg-violet-400/10 px-3 py-1 text-[11px] font-semibold text-violet-200"><ArchiveRestore className="h-3.5 w-3.5" /> Game config safety</div>
        <h2 className="mt-3 text-2xl font-bold text-white">{mode === 'backups' ? 'Your game setting backups' : 'Games on this PC'}</h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-400">Back up a game's settings files before you change anything, and put them back later. Restoring always shows you exactly what will change first, and keeps a copy of what it replaces.</p>
      </div>
      <button type="button" onClick={onRefresh} disabled={loading || busy} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 disabled:opacity-60"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />{loading ? 'Checking…' : 'Refresh'}</button>
    </div>

    {mode !== 'backups' && <div className="mt-4 grid gap-3 lg:grid-cols-3">
      <div className="rounded-xl border border-slate-800 bg-slate-950/45 p-4 lg:col-span-2">
        <div className="flex items-center gap-2"><FolderSearch className="h-4 w-4 text-cyan-300" /><h3 className="text-sm font-semibold text-slate-100">Supported games found</h3></div>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">If a game is missing here, it may still be installed; Dialed only finds games Windows lists.</p>
        <label className="mt-3 block max-w-sm text-[11px] font-semibold uppercase tracking-wide text-slate-500">Find a game<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search game or publisher" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-normal normal-case tracking-normal text-slate-200 outline-none focus:border-cyan-400" /></label>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {detectedGames.map((game) => <div key={game.guideId} className="min-w-0 rounded-lg border border-slate-800 bg-slate-900/70 p-3">
            <div className="flex items-center gap-2"><Gamepad2 className="h-4 w-4 shrink-0 text-emerald-300" /><span className="truncate text-xs font-semibold text-slate-100">{game.game}</span><span className="ml-auto rounded bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-300">DETECTED</span></div>
            <p data-technical-detail className="mt-2 [overflow-wrap:anywhere] text-[11px] leading-relaxed text-slate-500">Windows lists: {game.detectedDisplayName}{game.publisher ? ` · ${game.publisher}` : ''}</p>
            {game.configHints.filter((hint) => hint.state.startsWith('EXISTING')).map((hint) => <p data-technical-detail key={hint.path} className="mt-1 [overflow-wrap:anywhere] text-[11px] text-cyan-200/70">Settings file: {hint.path}</p>)}
          </div>)}
          {!loading && discovery && discovery.games.length === 0 ? <p className="rounded-lg border border-amber-500/20 bg-amber-950/10 p-3 text-xs text-amber-100/70 sm:col-span-2">No supported games were found. You can still back up settings files by hand below.</p> : null}
          {!loading && discovery && discovery.games.length > 0 && detectedGames.length === 0 ? <p className="rounded-lg border border-slate-700 bg-slate-950/50 p-3 text-xs text-slate-400 sm:col-span-2">No detected game matches that search.</p> : null}
        </div>
        {discovery ? <p data-technical-detail className="mt-3 text-[11px] leading-relaxed text-slate-600">{discovery.limitations}</p> : null}
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-950/45 p-4">
        <div className="flex items-center gap-2"><HardDriveDownload className="h-4 w-4 text-violet-300" /><h3 className="text-sm font-semibold text-slate-100">Back up settings files</h3></div>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">Pick the game, then choose its settings files (.cfg, .ini, .json and similar).</p>
        <label className="mt-3 block text-[11px] text-slate-400">Game
          <select value={effectiveGuideId} onChange={(event) => setSelectedGuideId(event.target.value)} disabled={guides.length === 0 || busy} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-100">
            {guides.map((guide) => <option key={guide.id} value={guide.id}>{guide.game}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => onBackup(effectiveGuideId)} disabled={!effectiveGuideId || busy} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-400 px-3 py-2 text-xs font-black text-slate-950 disabled:opacity-40"><HardDriveDownload className="h-4 w-4" />Select files and back up</button>
      </div>
    </div>}

    {mode !== 'discovery' && <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/45 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold text-slate-100">Backups</h3><p className="mt-1 text-[11px] text-slate-500">Restoring replaces only the files in the backup, after showing you what will change.</p></div><span className="rounded bg-slate-800 px-2 py-1 text-[11px] text-slate-400">{backups.length} backup{backups.length === 1 ? '' : 's'}</span></div>
      {backups.flatMap((backup) => backup.recoveryWarnings || []).map((warning) => <p key={warning} role="alert" className="mt-3 rounded-lg border border-amber-500/30 bg-amber-950/20 p-3 text-xs text-amber-200 [overflow-wrap:anywhere]">{warning}</p>)}
      <div className="mt-3 grid gap-2">
        {backups.map((backup) => <div key={backup.backupId} className="flex min-w-0 flex-col justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/70 p-3 sm:flex-row sm:items-center">
          <div className="min-w-0"><p className="text-xs font-semibold text-slate-100">{guideNames.get(backup.gameId) || backup.gameId}</p><p className="mt-1 text-[11px] text-slate-500">{new Date(backup.createdAt).toLocaleString()} · {backup.files.length} file{backup.files.length === 1 ? '' : 's'} · {formatBytes(backup.totalBytes)}</p><p data-technical-detail className="mt-1 truncate text-[11px] text-slate-600">{backup.files.map((file) => file.name).join(', ')}</p></div>
          <button type="button" onClick={() => onRestore(backup.backupId)} disabled={busy} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-200 disabled:opacity-40"><ArchiveRestore className="h-3.5 w-3.5" />Preview restore</button>
        </div>)}
        {!loading && backups.length === 0 ? <p className="rounded-lg border border-slate-800 bg-slate-900/50 p-3 text-xs text-slate-500">No backups yet.</p> : null}
      </div>
    </div>}

    <div className="mt-4 flex gap-2 rounded-lg border border-emerald-500/20 bg-emerald-950/10 p-3 text-xs leading-relaxed text-emerald-100/80"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />Backups you make, and the automatic ones made before a profile is applied, appear here. Close the game before restoring; whole files are put back.</div>
    {status ? <p role="status" className="mt-3 rounded-lg border border-cyan-500/20 bg-cyan-950/15 p-3 text-xs text-cyan-100/80">{status}</p> : null}
    {error ? <p role="alert" className="mt-3 flex gap-2 rounded-lg border border-rose-500/30 bg-rose-950/20 p-3 text-xs text-rose-200"><AlertTriangle className="h-4 w-4 shrink-0" /><ErrorText text={error} /></p> : null}
  </section>;
}
