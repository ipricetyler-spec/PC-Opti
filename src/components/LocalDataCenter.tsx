import { useEffect, useState } from 'react';
import type { AppTab } from './Sidebar';
import { buildSupportSummary } from '../lib/supportSummary';
import { SESSION_KEY } from '../lib/experimentSessions';

export function LocalDataCenter({ auditCount, comparisonCount, theme, onNavigate, auditEntries, comparisons, appVersion, technicalDetails }: {
  auditCount: number; comparisonCount: number; theme: string; onNavigate: (tab: AppTab) => void;
  auditEntries?: unknown; comparisons?: unknown; appVersion?: string; technicalDetails?: boolean;
}) {
  const [status, setStatus] = useState('');
  const [appearance, setAppearance] = useState(() => ({density:document.documentElement.dataset.density,background:document.documentElement.dataset.background}));
  useEffect(() => {
    const observer = new MutationObserver(() => setAppearance({density:document.documentElement.dataset.density,background:document.documentElement.dataset.background}));
    observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-density','data-background']});
    return () => observer.disconnect();
  }, []);
  let sessionRaw: string | null | undefined;
  try { sessionRaw = localStorage.getItem(SESSION_KEY); } catch { sessionRaw = undefined; }
  const summary = buildSupportSummary({ auditEntries, comparisons, appVersion, theme, technicalDetails, ...appearance, sessionRaw });
  const preview = JSON.stringify(summary, null, 2);
  const download = () => {
    try {
      const url = URL.createObjectURL(new Blob([preview], { type: 'application/json' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'Dialed-support-summary.json'; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000); setStatus('Saved. Nothing was sent.');
    } catch { setStatus('Could not save the file.'); }
  };
  return <section aria-label="Local data and support" className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
    <h2 className="text-lg font-semibold">Local data and support</h2>
    <p className="mt-2 text-sm text-slate-400">What Dialed keeps on this PC, and where to delete it. Deleting a record never undoes a change.</p>
    <div className="mt-3 flex flex-wrap gap-2">{([['drift','Change history'],['performance-lab','Recordings and test results'],['game-settings','Game backups']] as const).map(([tab,label]) => <button key={tab} className="rounded-lg border border-cyan-400/30 px-3 py-2 text-xs text-cyan-200" onClick={() => onNavigate(tab)}>{label}</button>)}</div>
    <p className="mt-4 text-xs text-slate-300">Support file: {auditCount} audit entries; {comparisonCount} comparisons; appearance {theme}. No device identifiers, filenames, paths, process names, button input or error logs are included.</p>
    <p className="mt-2 text-xs text-slate-400">A summary you can send if you need help. Preview it below; it is saved to your PC and never sent automatically.</p>
    <details className="mt-3"><summary className="cursor-pointer text-xs font-semibold text-slate-300">Preview</summary><pre aria-label="Exact support export JSON" className="mt-3 max-h-80 overflow-auto rounded-lg border border-slate-700 bg-slate-950 p-3 text-xs text-slate-300">{preview}</pre></details>
    <button className="mt-3 rounded-lg border border-slate-700 px-3 py-2 text-xs" onClick={download}>Save support file</button>
    {status && <p role="status" className="mt-2 text-xs text-slate-400">{status}</p>}
  </section>;
}
