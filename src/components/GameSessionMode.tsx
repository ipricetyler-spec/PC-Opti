import { Gamepad2, LoaderCircle, Play, Square } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ManageableProcess } from '../types';
import type { GameSessionState } from '../lib/useGameSession';
import { useConfirm } from './ConfirmContext';

const MAX_APPS = 8;

interface GameSessionModeProps {
  processes: ManageableProcess[];
  session: GameSessionState;
  onStart: (game: ManageableProcess, apps: ManageableProcess[]) => void;
  onEnd: (reason: string) => void;
}

export function GameSessionMode({ processes, session, onStart, onEnd }: GameSessionModeProps) {
  const confirm = useConfirm();
  const [gamePid, setGamePid] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const game = processes.find((item) => String(item.pid) === gamePid) || null;
  const candidates = useMemo(() => processes.filter((item) => item.pid !== game?.pid && !item.efficiencyMode && item.creationTime).sort((left, right) => (right.cpuPercent ?? -1) - (left.cpuPercent ?? -1)), [game?.pid, processes]);
  const busy = session.status === 'starting' || session.status === 'ending';

  const start = async () => {
    if (!game) return;
    const apps = candidates.filter((item) => selected.includes(item.pid));
    const confirmed = await confirm({
      title: `Start a game session for ${game.name}?`,
      description: 'While this game runs, Windows will run the chosen background apps in efficiency mode.',
      details: apps.map((item) => `• ${item.name} (PID ${item.pid})`).join('\n'),
      notice: 'Nothing is closed or paused. When the game closes, or you end the session, Dialed turns efficiency mode off again and checks it. If Dialed closes first, undo it from Restore › Recovery & history.',
      confirmLabel: `Start session (${apps.length} app${apps.length === 1 ? '' : 's'})`,
    });
    if (confirmed) onStart(game, apps);
  };

  return <section aria-label="Game session" className="rounded-2xl border border-cyan-500/20 bg-slate-900/70 p-5">
    <div className="flex items-center gap-2 text-cyan-300"><Gamepad2 className="h-5 w-5" /><h3 className="text-sm font-semibold">Game session</h3></div>
    <p className="mt-2 max-w-3xl text-xs leading-relaxed text-slate-400">Pick a game that is already running and up to {MAX_APPS} background apps. Dialed applies EcoQoS to those apps only while the game stays open, then undoes it automatically.</p>
    {session.status === 'idle' ? <>
      <label className="mt-4 block text-xs font-semibold text-slate-300">Running game
        <select value={gamePid} onChange={(event) => { setGamePid(event.target.value); setSelected([]); }} className="mt-1 block w-full max-w-md rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100">
          <option value="">Choose the game process</option>
          {processes.filter((item) => item.creationTime).map((item) => <option key={item.pid} value={item.pid}>{item.name} · PID {item.pid}</option>)}
        </select>
      </label>
      {game && <fieldset className="mt-3">
        <legend className="text-xs font-semibold text-slate-300">Background apps to slow down ({selected.length}/{MAX_APPS})</legend>
        <div className="mt-2 grid max-h-56 gap-1 overflow-y-auto sm:grid-cols-2">{candidates.map((item) => {
          const checked = selected.includes(item.pid);
          return <label key={item.pid} className="flex items-center gap-2 rounded border border-slate-800 px-2 py-1.5 text-xs text-slate-300">
            <input type="checkbox" checked={checked} disabled={!checked && selected.length >= MAX_APPS} onChange={() => setSelected((current) => checked ? current.filter((pid) => pid !== item.pid) : [...current, item.pid])} className="accent-cyan-400" />
            <span className="min-w-0 truncate">{item.name}</span><span className="ml-auto shrink-0 text-slate-500">{item.cpuPercent === null ? '' : `${item.cpuPercent}% CPU`}</span>
          </label>;
        })}</div>
      </fieldset>}
      <button type="button" onClick={() => void start()} disabled={!game || selected.length === 0} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-cyan-400 px-3 py-2 text-xs font-bold text-slate-950 disabled:opacity-40"><Play className="h-3.5 w-3.5" />Start game session</button>
    </> : <div role="status" className="mt-4 rounded-lg border border-cyan-400/30 bg-cyan-400/10 p-3 text-xs text-cyan-100">
      <p className="font-semibold">{session.status === 'starting' ? 'Starting session…' : session.status === 'ending' ? 'Ending session…' : `Session active for ${session.game?.name}`}</p>
      {session.applied.length > 0 && <p className="mt-1">In efficiency mode: {session.applied.map((item) => item.name).join(', ')}</p>}
      {session.status === 'active' && <button type="button" onClick={() => onEnd('Session ended by you.')} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-cyan-300/40 px-3 py-2 font-semibold"><Square className="h-3.5 w-3.5" />End session</button>}
      {busy && <LoaderCircle className="mt-2 h-4 w-4 animate-spin" />}
    </div>}
    {session.messages.length > 0 && <ul className="mt-3 space-y-1 text-[11px] text-slate-400">{session.messages.map((message, index) => <li key={`${index}-${message}`}>• {message}</li>)}</ul>}
  </section>;
}
