import { ErrorText } from './ErrorText';
import { useEffect, useRef, useState } from 'react';
import { ArchiveRestore, Check, Gamepad2, Play, Search, X } from 'lucide-react';
import type { GameConfigBackup, GameOptimizationPreview, GameOptimizationProfile, GameOptimizationResult } from '../types';

interface Props {
  busy: boolean;
  restoreStatus?: string | null;
  restoreError?: string | null;
  onBusyChange: (busy: boolean) => void;
  onBackupCreated: (backup: GameConfigBackup) => void;
  onRestore: (backupId: string) => void;
}

export function GameOptimizationCenter({ busy, restoreStatus, restoreError, onBusyChange, onBackupCreated, onRestore }: Props) {
  const [profiles, setProfiles] = useState<GameOptimizationProfile[]>([]);
  const [preview, setPreview] = useState<GameOptimizationPreview | null>(null);
  const [result, setResult] = useState<GameOptimizationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState('');
  const inFlight = useRef(false);
  useEffect(() => {
    let active = true;
    const api = window.pcOptiNative;
    if (!api?.listGameProfiles) { setError('Game profile actions require the current Dialed desktop build.'); return; }
    api.listGameProfiles().then((items) => { if (active) setProfiles(items); }).catch((error) => { if (active) setError(String(error)); });
    return () => { active = false; };
  }, []);

  async function run(operation: () => Promise<void>, message: string) {
    if (busy || inFlight.current) return;
    inFlight.current = true;
    onBusyChange(true);
    setError(null);
    setProgress(message);
    try { await operation(); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { inFlight.current = false; onBusyChange(false); setProgress(''); }
  }

  function showPreview(profileId: string) {
    void run(async () => {
      setPreview(null);
      setResult(null);
      setPreview(await window.pcOptiNative!.previewGameProfile(profileId));
    }, 'Reading the game\'s settings…');
  }

  function applyPreview() {
    if (!preview) return;
    const token = preview.token;
    void run(async () => {
      setPreview(null);
      const applied = await window.pcOptiNative!.applyGameProfile(token);
      setResult(applied);
      onBackupCreated(applied.backup);
    }, 'Backing up, applying and checking…');
  }

  const currentProfile = profiles.find((item) => item.id === preview?.profileId);
  const buttonClass = 'inline-flex items-center justify-center gap-2 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-200 disabled:opacity-40';
  return <section aria-label="Game optimization profiles" className="mb-6 min-w-0 rounded-2xl border border-cyan-500/20 bg-slate-900 p-6 shadow-xl [overflow-wrap:anywhere]">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs font-semibold text-cyan-300">GAME PROFILES</p><h2 className="mt-2 text-2xl font-bold text-white">Apply a settings profile</h2></div>
      <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-[11px] font-semibold text-amber-200">Early access · test in your game before keeping</span>
    </div>
    <p className="mt-2 text-sm leading-relaxed text-slate-400">Pick a profile, see exactly which settings change, then apply it. Dialed backs up the game's settings file first. Close the game and its launcher before applying.</p>
    <div className="mt-4 grid gap-3 xl:grid-cols-2">
      {profiles.map((profile) => <article key={profile.id} className="min-w-0 rounded-xl border border-slate-700 bg-slate-950/45 p-4">
        <h3 className="flex items-center gap-2 text-base font-bold text-white"><Gamepad2 className="h-4 w-4 shrink-0 text-cyan-300" />{profile.game}</h3>
        <p className="mt-1 text-xs font-semibold text-slate-200">{profile.title}</p>
        <p className="mt-2 text-xs leading-relaxed text-slate-400">{profile.description}</p>
        <button type="button" onClick={() => showPreview(profile.id)} disabled={busy} className={`${buttonClass} mt-3`}><Search className="h-3.5 w-3.5" />Preview {profile.game}</button>
        <details data-technical-detail className="mt-3 text-[11px] leading-relaxed text-slate-400"><summary className="cursor-pointer text-slate-300">Sources and settings file</summary><p className="mt-2">{profile.evidence}</p><p className="mt-2">{profile.fileHint}</p><p className="mt-2">Only settings already in the file are changed. If the file looks unfamiliar, Dialed stops.</p><div className="mt-2 flex flex-wrap gap-3"><a href={profile.sourceUrl} onClick={(event) => { event.preventDefault(); void window.pcOptiNative?.openExternalLink(profile.sourceUrl).catch((error) => setError(String(error))); }} className="text-cyan-300 underline">Publisher guidance</a><a href={profile.pathSourceUrl} onClick={(event) => { event.preventDefault(); void window.pcOptiNative?.openExternalLink(profile.pathSourceUrl).catch((error) => setError(String(error))); }} className="text-cyan-300 underline">Config location</a></div></details>
      </article>)}
    </div>
    {preview ? <div className="mt-4 min-w-0 rounded-xl border border-cyan-400/30 bg-slate-950/70 p-4">
      <div className="flex items-start justify-between gap-3"><h3 className="text-sm font-bold text-white">{currentProfile?.game} — exact changes</h3><button type="button" aria-label="Cancel profile preview" onClick={() => setPreview(null)} disabled={busy} className="rounded p-1 text-slate-400"><X className="h-4 w-4" /></button></div>
      <p className="mt-2 text-[11px] text-slate-400">{preview.sourcePath}</p>
      {preview.changes.length ? <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-slate-400"><tr><th className="py-2 pr-3">Setting</th><th className="pr-3">Current</th><th>After</th></tr></thead><tbody>{preview.changes.map((change) => <tr key={change.key} className="border-t border-slate-800"><td className="py-2 pr-3 text-slate-200">{change.key}</td><td className="pr-3 text-slate-400">{change.before}</td><td className="font-semibold text-cyan-300">{change.after}</td></tr>)}</tbody></table></div> : <p role="status" className="mt-3 text-sm text-emerald-300">Already matches this profile. Nothing to apply.</p>}
      <p className="mt-3 text-[11px] leading-relaxed text-slate-400">Lower effects mean less visual detail. Measure to see whether it helps. Restoring puts back the whole file, including any other settings you changed since.</p>
      <button type="button" disabled={busy || preview.changes.length === 0} onClick={applyPreview} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-cyan-400 px-4 py-2 text-xs font-bold text-slate-950 disabled:opacity-40"><Play className="h-3.5 w-3.5" />Back up & apply {preview.changes.length} {preview.changes.length === 1 ? 'change' : 'changes'}</button>
    </div> : null}
    {progress ? <p role="status" className="mt-3 text-xs text-cyan-200">{progress}</p> : null}
    {restoreStatus ? <p role="status" className="mt-3 rounded-lg border border-cyan-500/20 bg-cyan-950/15 p-3 text-xs text-cyan-100/80">{restoreStatus}</p> : null}
    {restoreError ? <p role="alert" className="mt-3 rounded-lg border border-rose-500/30 bg-rose-950/20 p-3 text-xs text-rose-200"><ErrorText text={restoreError} /></p> : null}
    {result ? <div className="mt-4 rounded-xl border border-emerald-400/20 bg-slate-950/60 p-4"><h3 className="flex items-center gap-2 text-sm font-bold text-emerald-300"><Check className="h-4 w-4" />Applied and checked</h3><ol aria-label="Profile operation log" className="mt-3 space-y-1 text-xs text-slate-300">{result.log.map((line, index) => <li key={index}>{index + 1}. {line}</li>)}</ol><p className="mt-3 text-[11px] text-slate-500">Backup: {result.backup.backupId}<br />Backup: {result.recoveryPath}</p><button type="button" disabled={busy} onClick={() => onRestore(result.backup.backupId)} className={`${buttonClass} mt-3`}><ArchiveRestore className="h-3.5 w-3.5" />Restore this backup</button></div> : null}
    {error ? <p role="alert" className="mt-3 rounded-lg border border-rose-500/30 bg-rose-950/20 p-3 text-xs text-rose-200"><ErrorText text={error} /></p> : null}
  </section>;
}
