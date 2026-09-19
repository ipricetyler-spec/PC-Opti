import { ErrorText } from './ErrorText';
import { Activity, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import type { LiveHardwareReading } from '../types';
import { HardwareReadingsSummary } from './HardwareReadingsSummary';

export function LiveHardwareCard() {
  const [reading, setReading] = useState<LiveHardwareReading | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Short for a quick look; longer to see how speeds and temperatures move under a load.
  const [seconds, setSeconds] = useState<5 | 15 | 30>(5);
  const read = async () => {
    if (!window.pcOptiNative?.readLiveHardware) { setError('Live hardware readings are available in the Dialed desktop app.'); return; }
    setBusy(true);
    setError(null);
    try { setReading(await window.pcOptiNative.readLiveHardware(seconds)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Hardware readings could not be taken.'); }
    finally { setBusy(false); }
  };
  return <section aria-label="Live hardware reading" className="rounded-xl border border-slate-800 bg-slate-950/45 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="flex items-center gap-2 text-cyan-300"><Activity className="h-4 w-4" /><h3 className="text-sm font-semibold text-slate-100">Live hardware reading</h3></div><p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-slate-400">Watch CPU, memory and graphics card load for a few seconds (temperature and power need an NVIDIA card). It stops on its own and changes nothing.</p></div>
      <div className="flex flex-wrap items-center gap-2">
      <label className="text-xs text-slate-400">Length
        <select value={seconds} disabled={busy} onChange={(event) => setSeconds(Number(event.target.value) as 5 | 15 | 30)} className="ml-2 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white">
          <option value={5}>5 seconds</option>
          <option value={15}>15 seconds</option>
          <option value={30}>30 seconds</option>
        </select>
      </label>
      <button type="button" onClick={() => void read()} disabled={busy} className="inline-flex items-center gap-2 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-200 disabled:opacity-50">{busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />}{busy ? `Reading for ${seconds} seconds…` : reading ? 'Read again' : `Read for ${seconds} seconds`}</button>
      </div>
    </div>
    {error && <p role="alert" className="mt-3 text-xs text-amber-200"><ErrorText text={error} /></p>}
    {reading && <div className="mt-3">
      {reading.status === 'RECORDED' ? <HardwareReadingsSummary view={reading} /> : <p className="text-xs text-amber-200">{reading.errors[0] || 'Windows did not return enough readings.'}</p>}
      <p className="mt-2 text-[11px] text-slate-500">Read {new Date(reading.collectedAt).toLocaleTimeString()}.</p>
    </div>}
  </section>;
}
