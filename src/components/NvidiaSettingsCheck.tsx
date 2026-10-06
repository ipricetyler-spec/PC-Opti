import { useEffect, useState } from 'react';
import { ErrorText } from './ErrorText';

type Reading = Awaited<ReturnType<NonNullable<NonNullable<typeof window.pcOptiNative>['readNvidiaSettings']>>>;

/** NVIDIA's global driver settings, read only. Reads once when opened, and again on request. */
export function NvidiaSettingsCheck() {
  const [reading, setReading] = useState<Reading | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const read = async () => {
    const native = window.pcOptiNative;
    if (!native?.readNvidiaSettings || busy) return;
    setBusy(true); setError(null);
    try { setReading(await native.readNvidiaSettings()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Dialed could not read the NVIDIA driver settings. Nothing was changed.'); }
    finally { setBusy(false); }
  };
  useEffect(() => { void read(); }, []);
  const differing = reading?.rows.filter((row) => row.differs).length ?? 0;
  return <div className="mt-4 space-y-3 text-sm">
    <p className="text-xs leading-relaxed text-slate-400">What NVIDIA Control Panel's Global Settings are set to, read from the driver. Dialed changes nothing here. A game's own profile in the driver can override these.</p>
    {busy && !reading && <p className="text-xs text-slate-400">Reading the driver…</p>}
    {error && <p role="alert" className="text-xs text-amber-200"><ErrorText text={error} /></p>}
    {reading && !reading.available && <p className="text-xs text-slate-300">No NVIDIA driver found on this PC.</p>}
    {reading?.available && <>
      <p role="status" className="text-xs text-slate-300">{differing ? `${differing} setting${differing === 1 ? ' differs' : 's differ'} from the driver default, set in NVIDIA Control Panel or by another tool.` : 'Every setting Dialed reads is at the driver default or not set.'}</p>
      <table className="w-full text-left text-xs">
        <thead><tr className="text-slate-500"><th className="py-1 pr-3 font-semibold">Setting</th><th className="py-1 pr-3 font-semibold">Now</th><th className="py-1 font-semibold">Driver default</th></tr></thead>
        <tbody>{reading.rows.map((row) => <tr key={row.id} className="border-t border-slate-800">
          <td className="py-1.5 pr-3 text-slate-300">{row.label}</td>
          <td className={`py-1.5 pr-3 font-mono ${row.differs ? 'text-sky-200' : 'text-slate-200'}`}>{row.value}{row.differs ? ' · changed' : ''}</td>
          <td className="py-1.5 text-slate-500">{row.defaultText ?? 'Depends on the driver'}</td>
        </tr>)}</tbody>
      </table>
      {reading.notes.length > 0 && <ul className="space-y-1.5">{reading.notes.map((note) => <li key={note} className="rounded-md border border-slate-800 bg-slate-950/60 p-2 text-xs leading-relaxed text-slate-300">{note}</li>)}</ul>}
      <p className="text-[11px] leading-relaxed text-slate-500">Power management, texture filtering and threaded optimization make small, game-dependent differences in independent testing; a changed value is not a problem by itself.</p>
    </>}
    <button type="button" disabled={busy} onClick={() => void read()} className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-slate-500 disabled:opacity-50">{busy ? 'Reading…' : 'Read again'}</button>
  </div>;
}
