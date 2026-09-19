import { Activity } from 'lucide-react';
import { useState } from 'react';
import { readHardwareReadingsPreference, writeHardwareReadingsPreference } from '../lib/telemetry';

export function HardwareReadingsSetting() {
  const [enabled, setEnabled] = useState(() => readHardwareReadingsPreference());
  const [message, setMessage] = useState<string | null>(null);
  return <section aria-label="Hardware readings" className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
    <div className="flex items-center gap-2 text-cyan-300"><Activity className="h-4 w-4" /><h2 className="text-sm font-semibold text-slate-100">Hardware readings with captures</h2></div>
    <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs leading-relaxed text-slate-300">
      <input type="checkbox" checked={enabled} onChange={(event) => { const next = event.target.checked; setEnabled(next); setMessage(writeHardwareReadingsPreference(next) ? null : 'This preference could not be saved on this PC.'); }} className="mt-0.5 h-4 w-4 accent-cyan-400" />
      <span>Tick “Also record CPU and graphics card load” by default when measuring a game.</span>
    </label>
    <p className="mt-2 text-[11px] leading-relaxed text-slate-500">You can still change it for each recording. Readings are taken once a second while recording only, stay on this PC and are deleted with the recording.</p>
    {message && <p role="status" className="mt-2 text-xs text-amber-200">{message}</p>}
  </section>;
}
