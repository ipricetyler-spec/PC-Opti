import { ErrorText } from './ErrorText';
import { Cpu, FolderOpen, LoaderCircle, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { GpuPreferenceItem } from '../types';
import { useConfirm } from './ConfirmContext';

const OPTIONS = [
  [0, 'Let Windows decide'],
  [1, 'Power saving'],
  [2, 'High performance'],
] as const;

function fileName(exePath: string) {
  return exePath.split('\\').pop() || exePath;
}

export function GpuPreferenceCenter({ onChanged, graphicsCards }: { onChanged: () => void; graphicsCards: string[] }) {
  const confirm = useConfirm();
  const [items, setItems] = useState<GpuPreferenceItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!window.pcOptiNative?.listGpuPreferences) { setError('Per-app graphics preferences can be changed in the Dialed desktop app.'); return; }
    setBusy(true);
    setError(null);
    try { setItems(await window.pcOptiNative.listGpuPreferences()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Graphics preferences could not be read.'); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const chooseApp = async () => {
    const native = window.pcOptiNative;
    if (!native || busy) return;
    setError(null);
    try {
      const result = await native.chooseGpuPreferenceApp();
      if (result.canceled || !result.item) return;
      const item = result.item;
      setItems((current) => [item, ...current.filter((entry) => entry.id !== item.id)]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The app could not be selected.'); }
  };

  const apply = async (item: GpuPreferenceItem, preference: 0 | 1 | 2) => {
    const native = window.pcOptiNative;
    if (!native || busy || item.preference === preference) return;
    const label = OPTIONS.find(([value]) => value === preference)?.[1] || 'selected';
    const confirmed = await confirm({
      title: `Set ${fileName(item.exePath)} to ${label}?`,
      description: 'This is the same per-app choice as Windows Settings › System › Display › Graphics.',
      details: item.exePath,
      notice: 'Restart the program for the change to apply. Mostly matters on laptops; PCs with one graphics card see no difference. You can undo it in Restore › Recovery & history.',
      confirmLabel: `Use ${label}`,
    });
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const result = await native.setGpuPreference(item.id, preference);
      if (!result.success) throw new Error(result.error || 'Windows did not confirm the graphics preference.');
      setStatus(`${fileName(item.exePath)} now uses ${label}. Restart it to apply.`);
      onChanged();
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The graphics preference could not be changed.');
    } finally { setBusy(false); }
  };

  return <section aria-label="Per-app graphics preference" className="mt-6 rounded-2xl border border-slate-700 bg-slate-900/70 p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="flex items-center gap-2 text-cyan-300"><Cpu className="h-5 w-5" /><h3 className="text-lg font-semibold text-white">Graphics processor per program</h3></div><p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-400">Which graphics chip each program uses: the power-saving one built into the CPU, or the separate graphics card. Programs appear here once they have a choice saved. Add a game with “Choose game or app”.</p>
        {graphicsCards.length === 1 && <p className="mt-2 max-w-2xl rounded-lg border border-slate-700 bg-slate-950/40 p-2 text-xs leading-relaxed text-slate-300">This PC reports one graphics processor ({graphicsCards[0]}), so every program already uses it and these choices have no effect here. They matter on laptops and on desktops with the CPU's built-in graphics turned on.</p>}</div>
      <div className="flex gap-2">
        <button type="button" onClick={() => void chooseApp()} disabled={busy} className="inline-flex items-center gap-2 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-200 disabled:opacity-50"><FolderOpen className="h-3.5 w-3.5" />Choose game or app</button>
        <button type="button" onClick={() => void refresh()} disabled={busy} aria-label="Refresh graphics preferences" className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />Refresh</button>
      </div>
    </div>
    {items.length === 0 && !busy && <p className="mt-4 text-xs text-slate-500">No program has a graphics preference saved yet.</p>}
    <ul className="mt-4 space-y-2">{items.map((item) => <li key={item.id} className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
      <p className="text-sm font-semibold text-slate-100">{fileName(item.exePath)}</p>
      <p data-technical-detail className="mt-0.5 break-all text-[11px] text-slate-500">{item.exePath}</p>
      {item.kind && item.kind !== 'String' ? <p className="mt-2 text-xs text-amber-200">This entry is stored in an unexpected format, so Dialed leaves it alone.</p> : <div role="group" aria-label={`Graphics preference for ${fileName(item.exePath)}`} className="mt-2 flex flex-wrap gap-2">{OPTIONS.map(([value, label]) => <button key={value} type="button" aria-pressed={item.preference === value} disabled={busy} onClick={() => void apply(item, value)} className={`rounded-lg border px-3 py-1.5 text-[11px] font-semibold disabled:opacity-50 ${item.preference === value ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-100' : 'border-slate-700 text-slate-300'}`}>{label}</button>)}</div>}
    </li>)}</ul>
    {busy && <LoaderCircle className="mt-3 h-4 w-4 animate-spin text-slate-400" />}
    {status && <p role="status" className="mt-3 text-xs text-emerald-200">{status}</p>}
    {error && <p role="alert" className="mt-3 text-xs text-amber-200"><ErrorText text={error} /></p>}
  </section>;
}
