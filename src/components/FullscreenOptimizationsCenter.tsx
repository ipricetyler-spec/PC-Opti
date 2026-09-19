import { ErrorText } from './ErrorText';
import { FolderOpen, LoaderCircle, Maximize, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { FullscreenOptimizationItem } from '../types';
import { useConfirm } from './ConfirmContext';

function fileName(exePath: string) {
  return exePath.split('\\').pop() || exePath;
}

export function FullscreenOptimizationsCenter({ onChanged }: { onChanged: () => void }) {
  const confirm = useConfirm();
  const [items, setItems] = useState<FullscreenOptimizationItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!window.pcOptiNative?.listFullscreenOptimizations) { setError('Fullscreen optimizations can be changed in the Dialed desktop app.'); return; }
    setBusy(true);
    setError(null);
    try {
      const listed = await window.pcOptiNative.listFullscreenOptimizations();
      // Keep a game chosen in this visit on screen after it is turned back on.
      setItems((current) => [...listed, ...current.filter((item) => !listed.some((entry) => entry.id === item.id))]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The compatibility settings could not be read.'); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const chooseGame = async () => {
    const native = window.pcOptiNative;
    if (!native || busy) return;
    setError(null);
    try {
      const result = await native.chooseFullscreenOptimizationsApp();
      if (!result.canceled && result.item) {
        const item = result.item;
        setItems((current) => [item, ...current.filter((entry) => entry.id !== item.id)]);
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The game could not be selected.'); }
  };

  const apply = async (item: FullscreenOptimizationItem, disableOptimizations: boolean) => {
    const native = window.pcOptiNative;
    if (!native || busy || item.disabled === disableOptimizations) return;
    const name = fileName(item.exePath);
    const confirmed = await confirm({
      title: disableOptimizations ? `Turn off fullscreen optimizations for ${name}?` : `Turn fullscreen optimizations back on for ${name}?`,
      description: 'This is the “Disable fullscreen optimizations” box on the game’s Compatibility tab, for your account only. Other compatibility options on the game are kept.',
      details: item.exePath,
      notice: disableOptimizations
        ? 'Only worth it if this game has alt-tab, overlay or frame pacing problems in fullscreen. Restart the game for it to apply. You can undo it in Restore.'
        : 'Restart the game for it to apply. You can undo it in Restore.',
      confirmLabel: disableOptimizations ? 'Turn off' : 'Turn back on',
    });
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const result = await native.setFullscreenOptimizations(item.id, disableOptimizations);
      if (!result.success) throw new Error(result.error || 'Windows did not confirm the change.');
      setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, disabled: disableOptimizations, exists: true, kind: 'String' } : entry)));
      setStatus(`Fullscreen optimizations are now ${disableOptimizations ? 'off' : 'on'} for ${name}. Restart it to apply.`);
      onChanged();
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The setting could not be changed.');
    } finally { setBusy(false); }
  };

  return <section aria-label="Fullscreen optimizations per game" className="mt-6 rounded-2xl border border-slate-700 bg-slate-900/70 p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="flex items-center gap-2 text-cyan-300"><Maximize className="h-5 w-5" /><h3 className="text-lg font-semibold text-white">Fullscreen optimizations per game</h3></div><p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-400">Windows normally runs fullscreen games through its own display handling, which makes alt-tab and overlays quick. If one game has alt-tab trouble, overlay problems or uneven frame pacing in fullscreen, turning this off for that game alone can help. Most games are best left as they are.</p></div>
      <div className="flex gap-2">
        <button type="button" onClick={() => void chooseGame()} disabled={busy} className="inline-flex items-center gap-2 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-200 disabled:opacity-50"><FolderOpen className="h-3.5 w-3.5" />Choose a game</button>
        <button type="button" onClick={() => void refresh()} disabled={busy} aria-label="Refresh fullscreen optimizations" className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />Refresh</button>
      </div>
    </div>
    {items.length === 0 && !busy && <p className="mt-4 text-xs text-slate-500">No game has fullscreen optimizations turned off.</p>}
    <ul className="mt-4 space-y-2">{items.map((item) => <li key={item.id} className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-100">{fileName(item.exePath)}</p>
          <p data-technical-detail className="mt-0.5 break-all text-[11px] text-slate-500">{item.exePath}</p>
          <p className="mt-1 text-xs text-slate-300">Fullscreen optimizations: {item.disabled ? 'off' : 'on'}</p>
        </div>
        {item.kind && item.kind !== 'String'
          ? <p className="text-xs text-amber-200">Stored in an unexpected format, so Dialed leaves it alone.</p>
          : <button type="button" disabled={busy} onClick={() => void apply(item, !item.disabled)} className="rounded-lg border border-slate-700 px-3 py-1.5 text-[11px] font-semibold text-slate-200 disabled:opacity-50">{item.disabled ? 'Turn back on' : 'Turn off'}</button>}
      </div>
      {item.disabledForAllUsers && <p className="mt-2 text-xs text-amber-200">This game also has them turned off for all users on this PC. Dialed does not change that; clear it on the game’s Compatibility tab under “Change settings for all users”.</p>}
    </li>)}</ul>
    {busy && <LoaderCircle className="mt-3 h-4 w-4 animate-spin text-slate-400" />}
    {status && <p role="status" className="mt-3 text-xs text-emerald-200">{status}</p>}
    {error && <p role="alert" className="mt-3 text-xs text-amber-200"><ErrorText text={error} /></p>}
  </section>;
}
