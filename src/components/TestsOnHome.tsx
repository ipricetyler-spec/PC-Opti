import { FlaskConical } from 'lucide-react';
import { SESSION_KEY, parseSessions } from '../lib/experimentSessions';
import { CHANGE_TESTS_KEY, STEP_LABELS, activeTests, parseChangeTests, testStep } from '../lib/changeTest';

function readTests() {
  try { return parseChangeTests(window.localStorage.getItem(CHANGE_TESTS_KEY)); } catch { return []; }
}

function readSessions() {
  try { return { sessions: parseSessions(window.localStorage.getItem(SESSION_KEY)) }; } catch { return { sessions: [] }; }
}

/** Home's short view: tests in progress, and a way to start one. */
export function TestsOnHome({ onOpen }: { onOpen: () => void }) {
  const tests = readTests();
  const { sessions } = readSessions();
  const running = activeTests(tests, sessions);
  return <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-100"><FlaskConical className="h-4 w-4 text-cyan-300" />Did a change help?</h3>
        <p className="mt-1 text-xs text-slate-400">Measure a game before and after one change, and find out whether the difference is real.</p>
      </div>
      <button type="button" onClick={onOpen} className="rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-200">{running.length ? 'Continue' : 'Test a change'}</button>
    </div>
    {running.length > 0 && <ul className="mt-3 space-y-1 text-xs text-slate-300">{running.slice(0, 3).map((test) => <li key={test.id}>• {test.source.title} in {test.game} — next: {STEP_LABELS[testStep(test, sessions.find((item) => item.id === test.sessionId) ?? null)].toLowerCase()}</li>)}</ul>}
  </section>;
}
