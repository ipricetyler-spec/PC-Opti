import { useEffect, useState } from 'react';
import { ErrorText } from './ErrorText';
import { useConfirm } from './ConfirmContext';

type Program = { path: string; name: string; processes: number; hasWindow: boolean };
type Outcome = { path: string; name: string; outcome: 'CLOSED' | 'ENDED' | 'STILL_OPEN' | 'STILL_RUNNING' };

// The reader's chosen programs, by file path; remembered so the next game is one click.
const CHOSEN_KEY = 'dialed-close-before-game:v1';
function readChosen(): string[] {
  try { const value = JSON.parse(window.localStorage.getItem(CHOSEN_KEY) ?? '[]'); return Array.isArray(value) ? value.filter((item) => typeof item === 'string').slice(0, 40) : []; } catch { return []; }
}
function saveChosen(paths: string[]) {
  try { window.localStorage.setItem(CHOSEN_KEY, JSON.stringify(paths)); } catch { /* chosen again next time */ }
}
const same = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
const OUTCOME_WORDS: Record<Outcome['outcome'], string> = { CLOSED: 'closed', ENDED: 'ended after 5 seconds', STILL_OPEN: 'still open; it may be asking whether to save. Dialed left it alone', STILL_RUNNING: 'still running; Windows would not end it' };
const stopped = (item: Outcome) => item.outcome === 'CLOSED' || item.outcome === 'ENDED';

export function CloseBeforeGame() {
  const confirm = useConfirm();
  const [programs, setPrograms] = useState<Program[] | null>(null);
  const [chosen, setChosen] = useState<string[]>(readChosen);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Outcome[] | null>(null);
  const [reopenNote, setReopenNote] = useState<string | null>(null);
  const native = window.pcOptiNative;

  const refresh = async () => {
    if (!native?.listClosablePrograms) return;
    try { setPrograms(await native.listClosablePrograms()); setError(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Dialed could not list the running programs.'); }
  };
  useEffect(() => { void refresh(); }, []);
  if (!native?.listClosablePrograms) return null;

  const toggle = (item: Program, on: boolean) => {
    const next = on ? [...chosen.filter((value) => !same(value, item.path)), item.path] : chosen.filter((value) => !same(value, item.path));
    setChosen(next); saveChosen(next);
  };
  const running = (programs ?? []).filter((item) => chosen.some((value) => same(value, item.path)));
  const notRunning = chosen.filter((value) => !(programs ?? []).some((item) => same(item.path, value)));

  const close = async () => {
    if (!native.closePrograms || !running.length || busy) return;
    const ok = await confirm({
      title: `Close ${running.length} program${running.length === 1 ? '' : 's'}?`,
      description: 'Dialed asks each program to close, as if you closed its window. After 5 seconds, a program with no window left is ended, like End task in Task Manager. One still showing a window is left open, in case it is asking whether to save.',
      details: running.map((item) => `${item.name}${item.hasWindow ? '' : ' (no window: it will be ended)'} — ${item.path}`).join('\n'),
      detailsLabel: 'Programs',
      notice: 'This cannot be undone like a setting: unsaved work in a program that is ended is lost, and Reopen starts programs fresh. Check the list: do not close a launcher your game needs (Steam, Riot Client), or security, VPN or anti-cheat software.',
      confirmLabel: `Close ${running.length}`,
    });
    if (!ok) return;
    setBusy(true); setError(null); setReopenNote(null);
    try { setResults((await native.closePrograms(running.map((item) => item.path))).results); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Dialed could not close the programs.'); }
    finally { setBusy(false); void refresh(); }
  };
  const reopen = async () => {
    if (!native.reopenPrograms || !results || busy) return;
    setBusy(true); setError(null);
    try {
      const closed = results.filter(stopped);
      const { reopened, elevated, notStarted } = await native.reopenPrograms(closed.map((item) => item.path));
      const names = (paths: string[]) => paths.map((value) => closed.find((item) => same(item.path, value))?.name ?? value).join(', ');
      setReopenNote([
        `${reopened.length} of ${closed.length} running again. Some programs open their main window instead of starting in the tray.`,
        notStarted.length ? `Not running yet: ${names(notStarted)}. Start ${notStarted.length === 1 ? 'it' : 'them'} from the Start menu.` : '',
        elevated.length ? `Running with administrator rights: ${names(elevated)}. Close ${elevated.length === 1 ? 'it' : 'them'} and start ${elevated.length === 1 ? 'it' : 'them'} yourself from the Start menu.` : '',
      ].filter(Boolean).join(' '));
      setResults(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Dialed could not reopen the programs.'); }
    finally { setBusy(false); setTimeout(() => void refresh(), 1500); }
  };

  return <section aria-labelledby="close-before-game" className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
    <h3 id="close-before-game" className="text-sm font-semibold text-slate-100">Close before a game</h3>
    <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">Pick the programs you do not need while playing. Dialed remembers your picks, so before the next game it is one click. Programs in the Windows folder, Dialed, and the security and anti-cheat programs Dialed recognises are left out; check the list yourself before closing. No FPS figure is promised; how much it helps depends on what those programs were doing.</p>
    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
      <button type="button" disabled={busy || !running.length} onClick={() => void close()} className="rounded-md bg-cyan-400 px-3 py-1.5 font-semibold text-slate-950 disabled:opacity-40">{busy ? 'Working…' : running.length ? `Close ${running.length} chosen` : 'None of your picks is running'}</button>
      {results && results.some(stopped) && <button type="button" disabled={busy} onClick={() => void reopen()} className="rounded-md border border-slate-700 px-3 py-1.5 font-semibold text-slate-200 disabled:opacity-40">Reopen them</button>}
      <button type="button" disabled={busy} onClick={() => void refresh()} className="rounded-md border border-slate-700 px-3 py-1.5 font-semibold text-slate-300 disabled:opacity-40">Refresh list</button>
    </div>
    {error && <p role="alert" className="mt-2 text-xs text-amber-200"><ErrorText text={error} /></p>}
    {results && <ul role="log" aria-label="Close results" className="mt-3 space-y-1 text-xs">{results.map((item) => <li key={item.path} className={stopped(item) ? 'text-emerald-200' : 'text-amber-200'}>{stopped(item) ? '✓' : '✗'} {item.name}: {OUTCOME_WORDS[item.outcome]}</li>)}</ul>}
    {reopenNote && <p role="status" className="mt-2 text-xs text-slate-300">{reopenNote}</p>}
    {programs && <fieldset className="mt-4">
      <legend className="text-xs font-semibold text-slate-300">Running now ({programs.length})</legend>
      <div className="mt-2 grid gap-1.5 sm:grid-cols-2">{programs.map((item) => <label key={item.path} title={item.path} className="flex min-w-0 items-center gap-2 text-xs text-slate-300">
        <input type="checkbox" checked={chosen.some((value) => same(value, item.path))} onChange={(event) => toggle(item, event.target.checked)} className="h-4 w-4 shrink-0 accent-cyan-400" />
        <span className="truncate">{item.name}{item.processes > 1 ? ` (${item.processes})` : ''}</span>
      </label>)}</div>
      {notRunning.length > 0 && <p className="mt-2 text-[11px] text-slate-500">{notRunning.length} of your picks {notRunning.length === 1 ? 'is' : 'are'} not running now and will be closed when {notRunning.length === 1 ? 'it is' : 'they are'}.</p>}
    </fieldset>}
  </section>;
}
