import { useCallback, useEffect, useRef, useState } from 'react';
import type { ManageableProcess } from '../types';

export interface GameSessionState {
  status: 'idle' | 'starting' | 'active' | 'ending';
  game: { pid: number; creationTime: string; name: string } | null;
  applied: Array<{ entryId: string; name: string; pid: number }>;
  startedAt: string | null;
  messages: string[];
}

const IDLE: GameSessionState = { status: 'idle', game: null, applied: [], startedAt: null, messages: [] };
const POLL_MS = 5000;

// Applies EcoQoS to chosen background apps while one running game stays open, then
// restores every applied entry through the normal verified rollback. State lives in
// the App so leaving the Background apps tab does not end the session.
export function useGameSession(onChanged: () => void) {
  const [session, setSession] = useState<GameSessionState>(IDLE);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const end = useCallback(async (reason: string) => {
    const current = sessionRef.current;
    const native = window.pcOptiNative;
    if (!native || (current.status !== 'active' && current.status !== 'starting')) return;
    setSession({ ...current, status: 'ending' });
    const messages = [reason];
    for (const item of current.applied) {
      try {
        const result = await native.rollbackAuditEntry(item.entryId);
        messages.push(result.success ? `${item.name}: EcoQoS removed and verified.` : `${item.name}: ${result.error || 'restore did not verify; review Recovery & history.'}`);
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        messages.push(/ended|reused/i.test(text) ? `${item.name}: app already closed, so EcoQoS ended with it.` : `${item.name}: ${text}`);
      }
    }
    setSession({ ...IDLE, messages });
    onChanged();
  }, [onChanged]);

  const start = useCallback(async (game: ManageableProcess, apps: ManageableProcess[]) => {
    const native = window.pcOptiNative;
    if (!native || sessionRef.current.status !== 'idle' || !game.creationTime) return;
    const next: GameSessionState = { status: 'starting', game: { pid: game.pid, creationTime: game.creationTime, name: game.name }, applied: [], startedAt: new Date().toISOString(), messages: [] };
    setSession(next);
    for (const app of apps) {
      if (app.pid === game.pid || !app.creationTime) continue;
      try {
        const result = await native.enableProcessEcoQos(app.pid, app.creationTime);
        if (result.success && result.entry) next.applied.push({ entryId: result.entry.id, name: app.name, pid: app.pid });
        else next.messages.push(`${app.name}: ${result.error || 'EcoQoS was not verified.'}`);
      } catch (error) {
        next.messages.push(`${app.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    setSession({ ...next, status: 'active', applied: [...next.applied], messages: [...next.messages] });
    onChanged();
  }, [onChanged]);

  useEffect(() => {
    if (session.status !== 'active' || !session.game) return;
    const native = window.pcOptiNative;
    if (!native) return;
    const timer = window.setInterval(() => {
      void native.listManageableProcesses().then((inventory) => {
        const game = sessionRef.current.game;
        if (game && !inventory.items.some((item) => item.pid === game.pid && item.creationTime === game.creationTime)) {
          void end(`${game.name} closed, so the game session ended automatically.`);
        }
      }).catch(() => undefined);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [end, session.game, session.status]);

  return { session, start, end };
}
