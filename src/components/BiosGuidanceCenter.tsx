import { ErrorText } from './ErrorText';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Cpu, Download, ExternalLink, RefreshCw } from 'lucide-react';
import type { BiosGuidancePlan } from '../types';
import { BIOS_NOTE_STATUSES, formatBiosPlan, parseBiosNotes, type BiosNotes } from '../lib/biosPlan.js';

const buttonClass = 'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-50';

export function BiosGuidanceCenter() {
  const [plan, setPlan] = useState<BiosGuidancePlan | null>(null);
  const [notes, setNotes] = useState<BiosNotes>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const generation = useRef(0);
  const keyFor = (value: BiosGuidancePlan) => `dialed-bios-notes:v1:${value.catalogVersion}:${value.fingerprint}`;

  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setError(null);
    if (!window.pcOptiNative?.readBiosPlan) {
      setError('Open the current Dialed desktop build to detect your hardware. Browser previews do not supply a pretend BIOS plan.');
      return;
    }
    setLoading(true);
    setPlan(null);
    try {
      const result = await window.pcOptiNative.readBiosPlan();
      if (request !== generation.current) return;
      let savedNotes: BiosNotes = {};
      try {
        savedNotes = parseBiosNotes(localStorage.getItem(keyFor(result)), result.recommendations.map((item) => item.id));
      } catch { setNotice('Local note storage is unavailable. Save your plan before leaving this page.'); }
      setNotes(savedNotes);
      setPlan(result);
    } catch (failure) {
      if (request === generation.current) setError(failure instanceof Error ? failure.message : 'Hardware read failed. No BIOS settings were changed.');
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => { generation.current += 1; };
  }, [refresh]);

  const updateNote = (id: string, update: Partial<BiosNotes[string]>) => {
    if (!plan) return;
    const current = notes[id] || { status: 'Not reviewed', previousValue: '' };
    const next = { ...notes, [id]: { ...current, ...update } };
    setNotes(next);
    try { localStorage.setItem(keyFor(plan), JSON.stringify(next)); }
    catch { setNotice('Local note storage is unavailable. Save your plan before leaving this page.'); }
  };

  const openSource = async (url: string) => {
    try {
      if (window.pcOptiNative) await window.pcOptiNative.openExternalLink(url);
      else window.open(url, '_blank', 'noopener,noreferrer');
    } catch { setNotice('The source could not be opened. Its full address is included in the saved plan.'); }
  };

  const savePlan = () => {
    if (!plan) return;
    try {
      const url = URL.createObjectURL(new Blob([formatBiosPlan(plan, notes)], { type: 'text/plain;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `Dialed-BIOS-plan-${plan.fingerprint.slice(0, 8)}.txt`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('Plan download requested. Keep it on a device you can read while Windows is closed; it includes your hardware model names and notes.');
    } catch { setNotice('The plan could not be saved. Keep your previous-setting notes before rebooting.'); }
  };

  const items = plan?.recommendations.filter((item) => advanced || !item.advanced) || [];
  const advancedCount = plan?.recommendations.filter((item) => item.advanced).length || 0;
  const display = (value: string) => value || 'Unknown';

  return <div className="min-w-0 space-y-4 [overflow-wrap:anywhere]" aria-busy={loading}>
    <section className="rounded-2xl border border-cyan-500/20 bg-slate-900/70 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold text-cyan-300"><Cpu className="h-4 w-4" /> Hardware-matched guidance</div>
          <h2 className="mt-2 text-2xl font-bold text-white">My BIOS plan</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">BIOS settings worth checking for your hardware, with steps to follow. Dialed never changes BIOS settings or restarts your PC.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={buttonClass} onClick={() => void refresh()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />{loading ? 'Reading hardware…' : 'Refresh hardware'}</button>
          <button className={buttonClass} onClick={savePlan} disabled={!plan || loading}><Download className="h-4 w-4" />Save BIOS plan</button>
        </div>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-amber-200"><ErrorText text={error} /></p>}
      {notice && <p role="status" className="mt-3 text-xs text-cyan-200">{notice}</p>}
      {loading && <p role="status" className="mt-3 text-sm text-slate-400">Reading CPU, motherboard, firmware, memory and graphics metadata. This can take up to 30 seconds.</p>}
    </section>

    {plan && <>
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <h3 className="font-semibold text-white">Your detected hardware</h3>
        <p className="mt-2 text-xs text-slate-400">As reported by Windows. The settings below are suggestions to check in your BIOS; your notes record what you did.</p>
        <dl className="mt-3 grid min-w-0 gap-3 text-xs sm:grid-cols-2">
          {[
            ['Processor', display(plan.hardware.cpu.name)],
            ['Motherboard', `${display(plan.hardware.board.manufacturer)} ${display(plan.hardware.board.product)} · revision ${display(plan.hardware.board.revision)}`],
            ['Firmware', `${display(plan.hardware.bios.version)} · ${display(plan.hardware.bios.date)}`],
            ['Graphics', plan.hardware.gpus.join(' / ') || 'Unknown'],
          ].map(([label, value]) => <div key={label} className="min-w-0 rounded-lg bg-slate-950/50 p-3"><dt className="text-slate-400">{label}</dt><dd className="mt-1 text-slate-100">{value}</dd></div>)}
        </dl>
        <p className="mt-3 text-xs text-slate-400">Windows cannot tell whether EXPO/XMP is on. Check it in your BIOS and note what it was before you change it.</p>
        <p className="mt-2 text-xs text-slate-400">{plan.limitations}</p>
        <details data-technical-detail className="mt-3 text-xs text-slate-300">
          <summary className="cursor-pointer py-1 font-medium">RAM modules and matching details ({plan.hardware.memory.length} modules)</summary>
          <ul className="mt-2 space-y-2">
            {plan.hardware.memory.map((item, index) => <li key={index}>{display(item.slot)} · {display(item.partNumber)} · {item.capacityBytes ? `${item.capacityBytes / 2 ** 30} GiB` : 'Unknown capacity'} · reported configured speed: {item.configuredSpeed || 'Unknown'}{item.memoryType === 26 ? ' · DDR4' : item.memoryType === 34 ? ' · DDR5' : ' · Unknown memory type'}</li>)}
          </ul>
          <p className="mt-3">{plan.match.reason}</p>
          <p className="mt-2 text-slate-400">Catalog {plan.catalogVersion} · Sources reviewed {plan.reviewedAt} · Review due {plan.reviewAfter}</p>
        </details>
        {plan.match.supportUrl && <button className="mt-3 inline-flex items-center gap-1 text-xs text-cyan-300 hover:underline" onClick={() => void openSource(plan.match.supportUrl!)}><ExternalLink className="h-3 w-3" />{plan.match.supportMatch === 'MODEL' ? 'Open your motherboard’s manuals and support' : 'Find your exact board manual and RAM support list'}</button>}
        {[...plan.hardware.errors, ...plan.warnings].map((warning, index) => <p key={index} className="mt-2 text-xs text-amber-200">{warning}</p>)}
      </section>

      <section className="rounded-2xl border border-amber-500/20 bg-slate-900/70 p-4">
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-amber-200">Before changing BIOS: recovery key, previous settings, one change at a time</summary>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-xs leading-relaxed text-slate-300">{plan.preparation.map((step) => <li key={step}>{step}</li>)}</ol>
          {plan.preparationSources.map((source) => <button key={source.url} className="mt-3 text-xs text-cyan-300 hover:underline" onClick={() => void openSource(source.url)}>{source.title} ↗</button>)}
        </details>
        <p className="mt-2 text-xs text-slate-400">A saved plan is not a BIOS backup. Memory and CPU tuning can cause crashes; if your settings already work, keep them.</p>
      </section>

      {plan.status !== 'GUIDANCE_AVAILABLE' && <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <h3 className="font-semibold text-white">No reviewed recipe for this combination yet</h3>
        <p className="mt-2 text-sm text-slate-300">{plan.match.reason} Save the inventory and use your system manufacturer’s exact-model manual; do not borrow a retail desktop preset.</p>
      </section>}

      {plan.status === 'GUIDANCE_AVAILABLE' && <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold text-white">{items.length} relevant checks <span className="text-xs font-normal text-slate-400">· not a list of detected faults</span></h3>
        {advancedCount > 0 && <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={advanced} onChange={(event) => setAdvanced(event.target.checked)} />Include advanced CPU tuning</label>}
      </div>}
      {items.map((item) => <section key={item.id} className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-base font-semibold text-white">{item.title}</h3><span className="text-xs text-amber-200">{item.risk} · Manual</span></div>
        <p className="mt-2 text-sm text-slate-300">{item.benefit}</p>
        <p className="mt-2 text-xs text-cyan-200"><strong>Target:</strong> {item.target}</p>
        <p className="mt-2 flex gap-2 text-xs leading-relaxed text-amber-200/90"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{item.tradeoff}</p>
        <details className="mt-3">
          <summary className="cursor-pointer rounded py-2 text-sm font-semibold text-cyan-300">Steps, compatibility and recovery</summary>
          <div className="mt-2 space-y-4 text-xs leading-relaxed text-slate-300">
            <p>{item.matchReason} Current setting: {item.currentState}.</p>
            <div><h4 className="font-semibold text-white">Check first</h4><ul className="mt-1 list-disc space-y-1 pl-5">{item.checks.map((step) => <li key={step}>{step}</li>)}</ul></div>
            <p><strong className="text-white">Where to look:</strong> {item.menuHint}</p>
            <ol className="list-decimal space-y-2 pl-5">{item.steps.map((step) => <li key={step}>{step}</li>)}</ol>
            <p><strong className="text-white">After reboot:</strong> {item.verify}</p>
            <p><strong className="text-white">If it does not work:</strong> {item.undo}</p>
            <div className="flex flex-wrap gap-3">{item.sources.map((source) => <button key={source.url} onClick={() => void openSource(source.url)} className="text-left text-cyan-300 hover:underline">{source.title} ↗</button>)}</div>
          </div>
        </details>
        <div className="mt-4 grid gap-3 border-t border-slate-800 pt-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <label className="min-w-0 text-xs text-slate-400">Your progress (Dialed cannot check this)
            <select aria-label={`Progress: ${item.title}`} className="mt-1 block w-full min-w-0 rounded-lg border border-slate-700 bg-slate-950 p-2 text-slate-200" value={notes[item.id]?.status || 'Not reviewed'} onChange={(event) => updateNote(item.id, { status: event.target.value })}>{BIOS_NOTE_STATUSES.map((status) => <option key={status}>{status}</option>)}</select>
          </label>
          <label className="min-w-0 text-xs text-slate-400">Previous setting / test notes (saved on this device)
            <textarea aria-label={`Previous setting: ${item.title}`} rows={2} maxLength={1000} value={notes[item.id]?.previousValue || ''} onChange={(event) => updateNote(item.id, { previousValue: event.target.value })} placeholder="Example: previous profile = Auto; record your result after testing. No passwords or recovery keys." className="mt-1 block w-full min-w-0 resize-y rounded-lg border border-slate-700 bg-slate-950 p-2 text-slate-200" />
          </label>
        </div>
      </section>)}
    </>}
  </div>;
}
