import { ErrorText } from './ErrorText';
import { AppWindow, ExternalLink, Gamepad2, MonitorCog, RefreshCw, ShieldAlert, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { OptionalAppCandidate, OptionalAppInventory, SystemScanSnapshot } from '../types';
import { useConfirm } from './ConfirmContext';
import { ShowDetails } from './ShowDetails';

interface WindowsControlsCenterProps {
  snapshot: SystemScanSnapshot | null;
}

const SETTINGS_PAGES = [
  { id: 'game-mode' as const, title: 'Game Mode', detail: 'Lets Windows prioritise the game you are playing. On by default; most people should leave it on.', icon: Gamepad2 },
  { id: 'game-bar' as const, title: 'Game Bar', detail: 'The Win+G overlay. Keep it if you use Xbox chat, widgets or clip recording.', icon: Gamepad2 },
  { id: 'captures' as const, title: 'Captures', detail: 'Background recording and clip settings. Turning recording off frees a little work, but do not expect a big FPS change.', icon: MonitorCog },
  { id: 'graphics' as const, title: 'Graphics defaults', detail: 'GPU scheduling and which graphics card each app uses. The GPU section explains each one.', icon: MonitorCog },
  { id: 'startup-apps' as const, title: 'Windows Startup apps', detail: 'The Windows version of Dialed\'s Startup apps page.', icon: AppWindow },
  { id: 'installed-apps' as const, title: 'Windows Installed apps', detail: 'Uninstall anything Dialed does not offer to remove.', icon: AppWindow },
];

function evidenceText(snapshot: SystemScanSnapshot | null, pageId: typeof SETTINGS_PAGES[number]['id']) {
  if (!snapshot) return 'Scan this PC to see the current setting.';
  if (pageId === 'captures') {
    const evidence = snapshot.diagnostics.gameDvr;
    return evidence.status === 'AVAILABLE' ? `Observed: ${evidence.value.state}.` : `Could not read the current setting: ${evidence.reason}`;
  }
  if (pageId === 'graphics') {
    const evidence = snapshot.diagnostics.hardwareGpuScheduling;
    return evidence.status === 'AVAILABLE' ? `GPU scheduling: ${evidence.value.state}.` : `Could not read GPU scheduling: ${evidence.reason}`;
  }
  return 'You change this in Windows; Dialed only opens the page.';
}

export function WindowsControlsCenter({ snapshot }: WindowsControlsCenterProps) {
  const [inventory, setInventory] = useState<OptionalAppInventory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const confirm = useConfirm();

  const refresh = async () => {
    if (!window.pcOptiNative) return;
    setLoading(true);
    setError(null);
    try {
      setInventory(await window.pcOptiNative.listOptionalAppCandidates());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not read the list of removable apps.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const openSettings = async (pageId: typeof SETTINGS_PAGES[number]['id']) => {
    if (!window.pcOptiNative) return;
    setError(null);
    try {
      await window.pcOptiNative.openWindowsSettings(pageId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Windows Settings could not open that page.');
    }
  };

  const reviewRemoval = async (item: OptionalAppCandidate) => {
    if (!window.pcOptiNative || activeId) return;
    setActiveId(item.id);
    setError(null);
    setStatus(null);
    try {
      const preview = await window.pcOptiNative.previewOptionalAppRemoval(item.id);
      const confirmed = await confirm({
        title: `Remove ${preview.title} for this Windows account?`,
        description: preview.consequence,
        details: `${preview.packageFullName}\nVersion ${preview.version}\n\n${preview.recovery}`,
        notice: 'Removes it for your account only. Other accounts, games, Xbox services, drivers and security software are never touched. Dialed cannot undo this; you can reinstall it from the Microsoft Store.',
        confirmLabel: 'Remove app',
        tone: 'danger',
      });
      if (!confirmed) {
        setStatus('Canceled. Nothing was removed.');
        return;
      }
      const result = await window.pcOptiNative.applyOptionalAppRemoval(preview.token);
      if (!result.success) throw new Error(result.error || 'Windows did not confirm the removal. Check Restore › Recovery & history before trying again.');
      setStatus(`${preview.title} is no longer registered for the current Windows account. No performance improvement is claimed. The result and recovery limit were recorded in Local Audit History.`);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The app could not be removed safely.');
    } finally {
      setActiveId(null);
    }
  };

  return <div className="mt-4 space-y-4">
    <section className="rounded-xl border border-slate-800 bg-slate-950/45 p-4">
      <div><p className="text-xs font-semibold uppercase tracking-wider text-cyan-300">Windows settings</p><h3 className="mt-1 text-sm font-semibold text-slate-100">Shortcuts to the matching Windows Settings pages</h3><p className="mt-1 text-[11px] leading-relaxed text-slate-500">Each opens the page in Windows Settings, with what Dialed found on this PC. Dialed changes nothing from here.</p></div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{SETTINGS_PAGES.map((page) => {
        const Icon = page.icon;
        return <article key={page.id} className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-100"><Icon className="h-4 w-4 text-violet-300" />{page.title}</div>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-400">{page.detail}</p>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-600">{evidenceText(snapshot, page.id)}</p>
          <button type="button" onClick={() => openSettings(page.id)} disabled={!window.pcOptiNative} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-violet-400/30 bg-violet-400/10 px-3 py-2 text-[11px] font-semibold text-violet-200 disabled:opacity-40"><ExternalLink className="h-3.5 w-3.5" />Open Windows Settings</button>
        </article>;
      })}</div>
    </section>

    <ShowDetails label="Remove built-in apps">
    <section className="rounded-xl border border-amber-500/20 bg-slate-950/45 p-4">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start"><div><p className="text-xs font-semibold uppercase tracking-wider text-amber-300">Remove built-in apps</p><h3 className="mt-1 text-sm font-semibold text-slate-100">Only a short list of optional Microsoft Store apps</h3><p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-slate-500">Remove optional apps one at a time, after seeing exactly what will go. Nothing is picked for you. Games, Xbox services, security software and drivers are never on the list.</p></div><button type="button" onClick={refresh} disabled={loading || Boolean(activeId)} className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-[11px] font-semibold text-slate-300 disabled:opacity-40"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />{loading ? 'Reading apps…' : 'Refresh'}</button></div>
      <div className="mt-3 flex gap-2 rounded-lg border border-rose-500/20 bg-rose-950/10 p-3 text-[11px] leading-relaxed text-rose-100/80"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" /><span><strong>Dialed cannot undo a removal.</strong> Microsoft Store Library may offer reinstallation, but availability, prior app data, preferences, and integrations are not guaranteed to return.</span></div>
      {error ? <p role="alert" className="mt-3 rounded-lg border border-rose-500/25 bg-rose-950/20 p-3 text-xs text-rose-200"><ErrorText text={error} /></p> : null}
      {status ? <p className="mt-3 rounded-lg border border-cyan-500/20 bg-cyan-950/10 p-3 text-xs text-cyan-100">{status}</p> : null}
      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{inventory?.items.map((item) => <article key={item.packageFullName} className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
        <div className="flex items-start justify-between gap-2"><div><p className="text-sm font-semibold text-slate-100">{item.title}</p><p data-technical-detail className="mt-1 break-all text-[11px] text-slate-600">{item.packageFullName}</p></div><span className="rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-400">Current user</span></div>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-400">{item.consequence}</p>
        <p data-technical-detail className="mt-2 text-[11px] text-slate-600">Version {item.version} · {item.architecture} · {item.signatureKind}</p>
        <button type="button" onClick={() => reviewRemoval(item)} disabled={Boolean(activeId) || !window.pcOptiNative} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-[11px] font-semibold text-rose-200 disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" />{activeId === item.id ? 'Checking…' : 'Review removal'}</button>
      </article>)}</div>
      {!loading && inventory && inventory.items.length === 0 ? <p className="mt-3 rounded-lg border border-slate-800 bg-slate-900/50 p-3 text-xs text-slate-500">None of the removable apps are installed.</p> : null}
      {inventory ? <p data-technical-detail className="mt-3 text-[11px] leading-relaxed text-slate-600">{inventory.items.length} eligible package{inventory.items.length === 1 ? '' : 's'} · {inventory.limitations}</p> : null}
    </section>
    </ShowDetails>
  </div>;
}
