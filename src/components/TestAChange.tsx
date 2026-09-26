import { ErrorText } from './ErrorText';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FlaskConical, RotateCcw, TriangleAlert } from 'lucide-react';
import type { AuditJournalEntry, BenchmarkEvidenceState, BenchmarkImportPreview, PresentMonCaptureEntry, PresentMonCaptureState, SystemScanSnapshot, TelemetryView } from '../types';
import { ComparisonCard, defaultPresentMonMetadata } from './BenchmarkEvidence';
import { useConfirm } from './ConfirmContext';
import { NativePresentMonCapture } from './NativePresentMonCapture';
import { SESSION_KEY, parseSessions, sameCaptureGroup, sessionCaptureIds, sessionPairIssue, type ExperimentSession } from '../lib/experimentSessions';
import { linkRuns, partitionRuns, sessionLimitReached, vendorFor } from '../lib/displayExperiment';
import { abaCheck, capWarning, conditionFlags, effectVsNoise, runProgress, RECOMMENDED_RUNS } from '../lib/experimentRigor';
import {
  CHANGE_TESTS_KEY, STEP_LABELS, VISIBLE_STEPS, activeTests, awaitingRestart, newChangeTest, parseChangeTests, saveChangeTests, sessionForChange, visibleStepIndex,
  testStep, upsertChangeTest, withBootSeen, type ChangeTest, type ChangeTestSource,
} from '../lib/changeTest';
import { DISPLAY_BASELINES_KEY, FIELD_LABELS, contextChanges, parseBaselines, type DisplayBaseline } from '../lib/displayBaseline';
import { effectiveGpu, graphicsAdapters } from '../lib/displaySetup';

export interface TestableTweak {
  id: string;
  title: string;
  summary: string;
  state: string | null;
  restartRequired: boolean;
  requiresAdmin: boolean;
}

export interface TestPrefill {
  tweakId?: string;
  game?: string;
  manual?: { title: string; fromText: string; displayBaselineId: string | null };
}

const BUTTON = 'rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-sm font-semibold text-cyan-200 disabled:opacity-40';
const PRIMARY = 'rounded-lg bg-cyan-400 px-4 py-2 text-sm font-bold text-slate-950 disabled:opacity-40';
const FIELD = 'mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm text-white';

const VENDOR_TIP = {
  NVIDIA: 'For driver settings, use NVIDIA Control Panel › Manage 3D settings › Program Settings (per game), not the global settings.',
  AMD: 'For driver settings, use AMD Software › Gaming › Games and pick this game, not the global settings.',
  INTEL: 'For driver settings, use Intel\'s graphics software per game where it offers it.',
  UNKNOWN: 'Prefer the game\'s own settings menu over graphics-driver settings.',
} as const;

export function readSessions(): { sessions: ExperimentSession[]; blocked: boolean } {
  try { return { sessions: parseSessions(window.localStorage.getItem(SESSION_KEY)), blocked: false }; }
  catch { return { sessions: [], blocked: true }; }
}

export function readTests(): ChangeTest[] {
  try { return parseChangeTests(window.localStorage.getItem(CHANGE_TESTS_KEY)); }
  catch { return []; }
}

const SELECTED_KEY = 'dialed-change-test-selected:v1';
const CHANGED_EVENT = 'dialed-change-tests-changed';

function readSelected(): string | null {
  try { return window.localStorage.getItem(SELECTED_KEY); } catch { return null; }
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

/** With too few runs to judge, still show what moved, and say it cannot be judged yet. */
function roughDifference(before: PresentMonCaptureEntry[], after: PresentMonCaptureEntry[]): string {
  const fps = (runs: PresentMonCaptureEntry[]) => average(runs.map((run) => run.frameSummary?.averageFps).filter((value): value is number => typeof value === 'number'));
  const from = fps(before);
  const to = fps(after);
  const needed = `Record ${RECOMMENDED_RUNS} counted runs on each side to see whether a difference is bigger than normal run-to-run variation.`;
  if (from === null || to === null || from <= 0) return needed;
  const change = ((to - from) / from) * 100;
  const runs = Math.min(before.length, after.length);
  return `Average FPS went from ${Math.round(from)} to ${Math.round(to)} (${change > 0 ? '+' : ''}${change.toFixed(1)}%). With ${runs === 1 ? 'one run' : `${runs} runs`} on each side, Dialed cannot tell yet whether that is the change or normal variation. ${needed}`;
}

function SideSummary({ label, runs }: { label: string; runs: PresentMonCaptureEntry[] }) {
  const fps = average(runs.map((run) => run.frameSummary?.averageFps).filter((value): value is number => typeof value === 'number'));
  const low = average(runs.map((run) => run.frameSummary?.onePercentLowFps).filter((value): value is number => typeof value === 'number'));
  return <div className="rounded-lg border border-slate-700 bg-slate-950/40 p-3">
    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-1 text-lg font-bold text-slate-100">{fps === null ? '—' : `${Math.round(fps)} FPS`}</p>
    <p className="text-xs text-slate-400">{low === null ? 'No runs' : `1% low ${Math.round(low)} FPS · ${runs.length} run${runs.length === 1 ? '' : 's'}`}</p>
  </div>;
}

function RunList({ runs, flags }: { runs: PresentMonCaptureEntry[]; flags: Map<string, string[]> }) {
  if (!runs.length) return null;
  return <ul className="mt-2 space-y-1 text-xs text-slate-400">
    {runs.map((run, index) => <li key={run.captureId}>Run {index + 1} · {new Date(run.startedAt).toLocaleTimeString()} · {run.durationSeconds} s
      {run.frameSummary && <> · <span className="text-slate-200">{Math.round(run.frameSummary.averageFps)} FPS</span>, 1% low {Math.round(run.frameSummary.onePercentLowFps)}{run.frameSummary.capLikely ? ' · looks capped' : ''}</>}
      {flags.get(run.captureId)?.map((note) => <span key={note} className="block text-amber-200">Different conditions: {note}.</span>)}
    </li>)}
  </ul>;
}

export function TestAChange({ tweaks, history, snapshot, evidence, prefill, onPrefillUsed, onApplyTweak, onUndoEntry, onEvidenceChange, onImportPreview }: {
  tweaks: TestableTweak[];
  history: AuditJournalEntry[];
  snapshot: SystemScanSnapshot | null;
  evidence: BenchmarkEvidenceState;
  prefill: TestPrefill | null;
  onPrefillUsed: () => void;
  /** Applies one Dialed tweak through its normal confirmed, journaled action. Returns the
   *  journal entry, or null when it was canceled or failed. */
  onApplyTweak: (tweakId: string) => Promise<AuditJournalEntry | null>;
  /** Restores one journal entry through the normal confirmed restore. Returns the restore's
   *  own journal entry, or null when it was canceled or failed. */
  onUndoEntry: (entryId: string) => Promise<AuditJournalEntry | null>;
  /** Saved comparisons changed (a test saved its own). */
  onEvidenceChange: (state: BenchmarkEvidenceState) => void;
  onImportPreview: (preview: BenchmarkImportPreview) => void;
}) {
  const confirm = useConfirm();
  const [tests, setTests] = useState(readTests);
  const [sessionState, setSessionState] = useState(readSessions);
  const [captures, setCaptures] = useState<PresentMonCaptureEntry[]>([]);
  const [bootTime, setBootTime] = useState<string | null>(null);
  // Remembered so the same test is still on screen after the page is rebuilt (a rescan
  // after an undo does that) or Dialed is reopened.
  const [selectedId, setSelectedIdState] = useState<string | null>(readSelected);
  const setSelectedId = (id: string | null) => {
    setSelectedIdState(id);
    try { if (id) window.localStorage.setItem(SELECTED_KEY, id); else window.localStorage.removeItem(SELECTED_KEY); } catch { /* a convenience only */ }
  };
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [displayIssues, setDisplayIssues] = useState<string[] | null>(null);

  // Set-up form
  const [kind, setKind] = useState<'TWEAK' | 'MANUAL'>(tweaks.length ? 'TWEAK' : 'MANUAL');
  const [tweakId, setTweakId] = useState(tweaks[0]?.id ?? '');
  const [game, setGame] = useState('');
  const [manualTitle, setManualTitle] = useState('');
  const [manualFrom, setManualFrom] = useState('');
  const [manualTo, setManualTo] = useState('');
  const [displayBaselineId, setDisplayBaselineId] = useState<string | null>(null);

  const running = activeTests(tests, sessionState.sessions);
  const test = tests.find((item) => item.id === selectedId) ?? (creating ? null : running[0] ?? null);
  const storedSession = test ? sessionState.sessions.find((item) => item.id === test.sessionId) ?? null : null;
  const step = test ? testStep(test, storedSession) : null;
  const partition = useMemo(() => (test ? partitionRuns(captures, test) : null), [captures, test]);
  const decided = step === 'DONE';
  const session = storedSession && partition && !decided ? linkRuns(storedSession, partition) : storedSession;
  // Once decided, the result is frozen to the runs it was decided on: runs recorded later
  // for something else must not join it.
  const linked = (ids: string[] | undefined) => captures.filter((capture) => (ids ?? []).includes(capture.captureId));
  const before = decided && session ? linked(session.baselineIds) : (partition?.baseline ?? []) as PresentMonCaptureEntry[];
  const after = decided && session ? linked(session.candidateIds) : (partition?.candidate ?? []) as PresentMonCaptureEntry[];
  const check = decided ? [] : (partition?.check ?? []) as PresentMonCaptureEntry[];
  const flags = conditionFlags(before, [...before, ...after, ...check]);
  const waitingForRestart = test ? awaitingRestart(test, bootTime) : false;
  const tweak = test?.source.kind === 'TWEAK' ? tweaks.find((item) => item.id === (test.source as { tweakId: string }).tweakId) ?? null : null;
  const gpu = effectiveGpu(graphicsAdapters(snapshot), null);
  const comparison = session ? evidence.comparisons.find((item) => item.experimentId === session.id
    && sameCaptureGroup(item.baseline?.trialIds, sessionCaptureIds(session, 'baseline'))
    && sameCaptureGroup(item.candidate?.trialIds, sessionCaptureIds(session, 'candidate'))) ?? null : null;
  const readings = useMemo(() => new Map<string, TelemetryView | null>(captures.map((capture) => [capture.captureId, capture.telemetry?.status === 'RECORDED' ? capture.telemetry.view ?? null : null])), [captures]);

  // Prefill from a tweak card or Display setup starts a fresh set-up form.
  useEffect(() => {
    if (!prefill) return;
    setCreating(true);
    setSelectedId(null);
    if (prefill.tweakId && tweaks.some((item) => item.id === prefill.tweakId)) { setKind('TWEAK'); setTweakId(prefill.tweakId); }
    if (prefill.manual) { setKind('MANUAL'); setManualTitle(prefill.manual.title); setManualFrom(prefill.manual.fromText); setManualTo(''); setDisplayBaselineId(prefill.manual.displayBaselineId); }
    else setDisplayBaselineId(null);
    if (prefill.game) setGame(prefill.game);
    onPrefillUsed();
  }, [prefill, tweaks, onPrefillUsed]);

  const writeSessions = (next: ExperimentSession[]): boolean => {
    if (sessionState.blocked) {
      setError('Your saved tests could not be read, so nothing new is saved over them. Open Recordings & results › Saved tests to export and recover them first.');
      return false;
    }
    try {
      const raw = JSON.stringify(next);
      parseSessions(raw);
      window.localStorage.setItem(SESSION_KEY, raw);
      setSessionState({ sessions: next, blocked: false });
      window.dispatchEvent(new Event(CHANGED_EVENT));
      return true;
    } catch {
      setError('Progress could not be saved on this PC. What was saved before is unchanged.');
      return false;
    }
  };
  const writeTests = (next: ChangeTest[]): boolean => {
    const saved = saveChangeTests(window.localStorage, next);
    if (saved) { setTests(next); window.dispatchEvent(new Event(CHANGED_EVENT)); }
    else setError('Progress could not be saved on this PC. What was saved before is unchanged.');
    return saved;
  };
  const saveTest = (next: ChangeTest) => writeTests(upsertChangeTest(tests, next));
  const updateSession = (patch: Partial<ExperimentSession>, base: ExperimentSession | null = session): boolean => {
    if (!base) return false;
    return writeSessions(sessionState.sessions.map((item) => item.id === base.id ? { ...base, ...patch } : item));
  };

  // Another copy of this page (rebuilt while an action was running) may have saved progress.
  useEffect(() => {
    const reload = () => { setTests(readTests()); setSessionState(readSessions()); };
    window.addEventListener(CHANGED_EVENT, reload);
    return () => window.removeEventListener(CHANGED_EVENT, reload);
  }, []);

  // Keep the session's run links in step with the runs shown here, as display experiments do.
  useEffect(() => {
    if (!session || !storedSession || session === storedSession) return;
    writeSessions(sessionState.sessions.map((item) => item.id === session.id ? session : item));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.baselineIds?.join(','), session?.candidateIds?.join(',')]);

  // Record the first boot after a restart-required change.
  useEffect(() => {
    if (!test) return;
    const next = withBootSeen(test, bootTime);
    if (next !== test) saveTest(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [test?.id, test?.change?.declaredAt, bootTime]);

  const readRuns = useCallback(async () => {
    if (!window.pcOptiNative) return;
    try {
      setCaptures((await window.pcOptiNative.getPresentMonCaptureState()).entries);
      if (window.pcOptiNative.getBootTime) setBootTime(await window.pcOptiNative.getBootTime());
    } catch {
      setError('Your recordings could not be read. Nothing was changed.');
    }
  }, []);
  useEffect(() => { void readRuns(); }, [readRuns]);
  // While a test is waiting for runs, watch for them instead of making the reader press refresh.
  // getPresentMonCaptureState is a cheap local read; it stops as soon as the test is decided.
  useEffect(() => {
    if (!selectedId || creating) return undefined;
    if (step !== 'BEFORE' && step !== 'AFTER' && step !== 'RESULT') return undefined;
    const timer = window.setInterval(() => { void readRuns(); }, 4000);
    return () => window.clearInterval(timer);
  }, [selectedId, creating, step, readRuns]);
  const onRecorderState = useCallback((state: PresentMonCaptureState) => setCaptures(state.entries), []);

  // --- Actions -------------------------------------------------------------------------

  const start = () => {
    setError(null);
    const source: ChangeTestSource | null = kind === 'TWEAK'
      ? (() => { const item = tweaks.find((candidate) => candidate.id === tweakId); return item ? { kind: 'TWEAK', tweakId: item.id, title: item.title, restartRequired: item.restartRequired } : null; })()
      : manualTitle.trim() ? { kind: 'MANUAL', title: manualTitle.trim().slice(0, 120), fromText: manualFrom.trim().slice(0, 80), toText: manualTo.trim().slice(0, 80), displayBaselineId } : null;
    if (!source) { setError(kind === 'TWEAK' ? 'Choose a tweak to test.' : 'Say which setting you will change.'); return; }
    if (!game.trim()) { setError('Say which game you will test in.'); return; }
    if (sessionLimitReached(sessionState.sessions)) { setError('You have 20 saved tests, the most Dialed keeps. Delete one in Recordings & results › Saved tests to start another.'); return; }
    const created = newChangeTest({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), game, source });
    if (!writeSessions([created.session, ...sessionState.sessions])) return;
    if (!writeTests(upsertChangeTest(tests, created.test))) return;
    setSelectedId(created.test.id);
    setCreating(false);
  };

  const finishBefore = () => { if (test) saveTest({ ...test, beforeDoneAt: new Date().toISOString() }); };

  const makeChange = async () => {
    if (!test || !session || busy) return;
    setError(null);
    if (test.source.kind === 'TWEAK') {
      setBusy(true);
      try {
        const entry = await onApplyTweak(test.source.tweakId);
        if (!entry) return;
        if (!updateSession({}, sessionForChange(session, test, entry.timestamp, entry.id))) return;
        saveTest({ ...test, change: { declaredAt: entry.timestamp, auditEntryId: entry.id } });
      } finally { setBusy(false); }
      return;
    }
    const source = test.source;
    const confirmed = await confirm({
      title: 'Have you made the change?',
      description: `Confirm only after you have changed it in ${test.game || 'the game'} (or your graphics software), and before you record again.`,
      details: `${source.title}${source.fromText || source.toText ? `: ${source.fromText || '?'} → ${source.toText || '?'}` : ''}`,
      detailsLabel: 'What you changed',
      notice: 'Dialed cannot make or check this change. The time you confirm is what separates your before runs from your after runs.',
      confirmLabel: 'I have made the change',
    });
    if (!confirmed) return;
    const declaredAt = new Date().toISOString();
    if (!updateSession({}, sessionForChange(session, test, declaredAt, null))) return;
    saveTest({ ...test, change: { declaredAt, auditEntryId: null } });
  };

  const finishAfter = () => { if (test) saveTest({ ...test, afterDoneAt: new Date().toISOString() }); };

  // Put it back to re-check (optional). For a tweak, Dialed restores it itself.
  const putBackToCheck = async () => {
    if (!test?.change || test.revertDeclaredAt || busy) return;
    if (test.source.kind === 'TWEAK') {
      if (!test.change.auditEntryId) return;
      setBusy(true);
      try {
        const restore = await onUndoEntry(test.change.auditEntryId);
        if (restore) saveTest({ ...test, revertDeclaredAt: restore.timestamp, revertAuditEntryId: restore.id });
      } finally { setBusy(false); }
      return;
    }
    const confirmed = await confirm({
      title: 'Put it back and measure again?',
      description: `Set ${test.source.title} back to ${test.source.fromText || 'what it was'}, then record a few more runs. If results return to your before numbers, the difference came from this setting.`,
      details: `${test.source.title}: ${test.source.toText || 'new value'} → ${test.source.fromText || 'previous value'}`,
      detailsLabel: 'Set it back to',
      notice: 'Dialed cannot make or check this change. Confirm only once you have done it.',
      confirmLabel: 'I have put it back',
    });
    if (confirmed) saveTest({ ...test, revertDeclaredAt: new Date().toISOString() });
  };

  const decide = async (decision: 'KEEP' | 'UNDO' | 'UNSURE') => {
    if (!test?.change || !session || busy) return;
    setError(null);
    // Keep showing this test once decided, rather than falling back to the set-up form.
    setSelectedId(test.id);
    const reverted = Boolean(test.revertDeclaredAt);
    if (decision === 'KEEP') {
      if (reverted && test.source.kind === 'TWEAK') {
        setBusy(true);
        try {
          const entry = await onApplyTweak(test.source.tweakId);
          if (!entry) return;
        } finally { setBusy(false); }
      } else if (reverted) {
        const confirmed = await confirm({
          title: 'Set it again?',
          description: `You put ${test.source.title} back to check. To keep the change, set it to ${test.source.kind === 'MANUAL' ? test.source.toText || 'the new value' : 'the new value'} again.`,
          details: test.source.title, detailsLabel: 'Setting', notice: 'Dialed cannot make or check this change.', confirmLabel: 'I have set it again',
        });
        if (!confirmed) return;
      }
      updateSession({ decision: 'KEEP' });
      return;
    }
    if (decision === 'UNDO') {
      if (!reverted && test.source.kind === 'TWEAK') {
        if (!test.change.auditEntryId) return;
        setBusy(true);
        try {
          const restore = await onUndoEntry(test.change.auditEntryId);
          if (!restore) return;
        } finally { setBusy(false); }
      } else if (!reverted) {
        const confirmed = await confirm({
          title: 'Put the setting back?',
          description: `Set ${test.source.title} back to ${test.source.kind === 'MANUAL' ? test.source.fromText || 'what it was' : 'what it was'}, in the same place you changed it.`,
          details: test.source.title, detailsLabel: 'Setting', notice: 'Dialed cannot make or check this change. Confirm only once you have done it.', confirmLabel: 'I have put it back',
        });
        if (!confirmed) return;
      }
      updateSession({ decision: 'REVIEW_RESTORE' });
      return;
    }
    updateSession({ decision: 'INCONCLUSIVE' });
  };

  const cancel = async () => {
    if (!test || !session) return;
    const applied = test.source.kind === 'TWEAK' && test.change && !test.revertDeclaredAt;
    const confirmed = await confirm({
      title: 'Stop this test?',
      description: applied ? 'The test is closed. The tweak stays as it is now; undo it from Restore › Recovery & history if you want.' : 'The test is closed. Your recordings are kept.',
      details: `${test.source.title} in ${test.game}`,
      detailsLabel: 'Test',
      notice: 'Nothing on your PC changes.',
      confirmLabel: 'Stop test',
    });
    if (!confirmed) return;
    setSelectedId(test.id);
    updateSession({ decision: 'INCONCLUSIVE' });
  };

  // The detailed comparison is built from what the test already knows. Anything the
  // test cannot know is recorded as "Not recorded", never guessed.
  const saveComparison = async () => {
    if (!test || !session || !window.pcOptiNative || busy) return;
    const issue = sessionPairIssue(session, captures, history);
    if (issue) { setError(issue); return; }
    setBusy(true);
    setError(null);
    try {
      const ids = [...sessionCaptureIds(session, 'baseline'), ...sessionCaptureIds(session, 'candidate')];
      const prepared = await window.pcOptiNative.prepareNativePresentMonImport(ids);
      if (prepared.canceled || !prepared.token || !prepared.sources) throw new Error('Those recordings could not be read for the comparison.');
      const metadata = defaultPresentMonMetadata(snapshot, session, prepared.sources);
      const duration = captures.find((capture) => capture.captureId === ids[0])?.durationSeconds;
      const known: Record<string, string> = {
        scene: `Same scene each run in ${test.game}, as the test asks (not checked by Dialed)`,
        duration: duration ? `${duration} seconds` : 'Not recorded',
        warmup: 'First run on each side set aside as a warm-up',
        graphicsPreset: test.source.kind === 'MANUAL' ? `Only ${test.source.title} changed (not checked by Dialed)` : 'Not recorded',
      };
      metadata.conditions = Object.fromEntries(Object.entries(metadata.conditions).map(([field, value]) => [field, value.trim() || known[field] || 'Not recorded']));
      metadata.workload = metadata.workload || test.game;
      metadata.changeDescription = metadata.changeDescription || test.source.title;
      const preview = await window.pcOptiNative.preparePresentMonImport(prepared.token, metadata);
      if (preview.canceled || !preview.token) throw new Error('The comparison could not be prepared.');
      onEvidenceChange(await window.pcOptiNative.applyBenchmarkImport(preview.token));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The comparison could not be prepared.');
    } finally { setBusy(false); }
  };

  // For a test started from Display setup: the monitor, card and refresh rate must still
  // match the saved display baseline, or the comparison is not like for like.
  const checkDisplay = useCallback(async () => {
    if (!test || test.source.kind !== 'MANUAL' || !test.source.displayBaselineId) { setDisplayIssues(null); return; }
    let baselines: DisplayBaseline[];
    try { baselines = parseBaselines(window.localStorage.getItem(DISPLAY_BASELINES_KEY)); } catch { baselines = []; }
    const baseline = baselines.find((item) => item.id === (test.source as { displayBaselineId: string }).displayBaselineId);
    if (!baseline || !window.pcOptiNative?.readDisplayModes) { setDisplayIssues(null); return; }
    try {
      const modes = await window.pcOptiNative.readDisplayModes();
      const display = modes.displays.find((item) => item.monitorKey === baseline.context.monitorKey) ?? null;
      const current = effectiveGpu(graphicsAdapters(snapshot), baseline.context.gpuName);
      const changes = contextChanges(baseline, {
        monitorPresent: display !== null,
        observedRefreshHz: display?.currentHz ?? null,
        gpuName: current?.name ?? null,
        driverVersion: current && current.driverVersion !== 'Not returned' ? current.driverVersion : null,
      });
      // When the refresh rate is the setting under test, a new rate is the change working.
      setDisplayIssues(test.source.title === FIELD_LABELS.refreshHz ? changes.filter((item) => !/^The monitor is now at \d+ Hz/.test(item)) : changes);
    } catch { setDisplayIssues(null); }
  }, [test, snapshot]);
  useEffect(() => { if (step === 'RESULT') void checkDisplay(); }, [step, checkDisplay]);

  // --- Rendering -----------------------------------------------------------------------

  const tips = <details className="mt-3 rounded-lg border border-slate-700 bg-slate-950/30 p-3 text-xs leading-relaxed text-slate-300">
    <summary className="cursor-pointer font-semibold text-slate-200">How to get a trustworthy result</summary>
    <ul className="mt-2 list-disc space-y-1 pl-5">
      <li>Play the same scene the same way every run: a practice range, a bot drill, a replay or a benchmark. Not live matches.</li>
      <li>Turn off the game's frame-rate limit (or V-Sync) for the test. A capped game shows the same FPS either way.</li>
      <li>Close anything heavy in the background, and keep the room and PC at a similar temperature.</li>
      <li>Record {RECOMMENDED_RUNS + 1} runs before and {RECOMMENDED_RUNS + 1} after. The first on each side is a warm-up and is not counted.</li>
    </ul>
  </details>;

  if (!test) {
    return <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
      <div className="flex items-center gap-2 text-cyan-300"><FlaskConical className="h-5 w-5" /><span className="text-sm font-semibold">Test a change</span></div>
      <h2 className="mt-2 text-xl font-bold text-white">Did it actually help?</h2>
      <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-400">Measure a game, make one change, measure again. Dialed tells you whether the difference is real or just normal run-to-run wobble, then helps you keep it or undo it.</p>
      {running.length > 0 && <div className="mt-4 rounded-lg border border-slate-700 p-3 text-xs text-slate-300">
        <p className="font-semibold text-slate-200">Tests in progress</p>
        <ul className="mt-2 space-y-1">{running.map((item) => <li key={item.id}><button type="button" className="text-cyan-300 underline underline-offset-2" onClick={() => { setSelectedId(item.id); setCreating(false); }}>{item.source.title} in {item.game}</button> · {STEP_LABELS[testStep(item, sessionState.sessions.find((saved) => saved.id === item.sessionId) ?? null)]}</li>)}</ul>
      </div>}
      <div className="mt-5 space-y-4">
        <fieldset>
          <legend className="text-sm font-semibold text-slate-100">1. What do you want to test?</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className={`cursor-pointer rounded-lg border p-3 text-sm ${kind === 'TWEAK' ? 'border-cyan-400/50 bg-cyan-950/20' : 'border-slate-700'} ${tweaks.length ? '' : 'opacity-50'}`}>
              <input type="radio" name="test-kind" className="mr-2 accent-cyan-400" checked={kind === 'TWEAK'} disabled={!tweaks.length} onChange={() => setKind('TWEAK')} />
              A Dialed tweak <span className="block pl-6 text-xs text-slate-400">Dialed makes the change and can undo it for you.</span>
            </label>
            <label className={`cursor-pointer rounded-lg border p-3 text-sm ${kind === 'MANUAL' ? 'border-cyan-400/50 bg-cyan-950/20' : 'border-slate-700'}`}>
              <input type="radio" name="test-kind" className="mr-2 accent-cyan-400" checked={kind === 'MANUAL'} onChange={() => setKind('MANUAL')} />
              A game or driver setting <span className="block pl-6 text-xs text-slate-400">You change it yourself; Dialed measures.</span>
            </label>
          </div>
          {kind === 'TWEAK' ? <label className="mt-3 block text-xs font-semibold text-slate-300">Tweak
            <select className={FIELD} value={tweakId} onChange={(event) => setTweakId(event.target.value)}>
              {tweaks.map((item) => <option key={item.id} value={item.id}>{item.title}{item.state ? ` (now: ${item.state})` : ''}</option>)}
            </select>
            {tweaks.find((item) => item.id === tweakId) && <span className="mt-1 block font-normal text-slate-400">{tweaks.find((item) => item.id === tweakId)!.summary}{tweaks.find((item) => item.id === tweakId)!.restartRequired ? ' Needs a restart between the before and after runs.' : ''}</span>}
          </label> : <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-3">
            <label className="text-xs font-semibold text-slate-300">Setting<input className={FIELD} maxLength={120} value={manualTitle} placeholder="e.g. Multithreaded rendering" onChange={(event) => setManualTitle(event.target.value)} /></label>
            <label className="text-xs font-semibold text-slate-300">Now set to<input className={FIELD} maxLength={80} value={manualFrom} placeholder="e.g. On" onChange={(event) => setManualFrom(event.target.value)} /></label>
            <label className="text-xs font-semibold text-slate-300">Change it to<input className={FIELD} maxLength={80} value={manualTo} placeholder="e.g. Off" onChange={(event) => setManualTo(event.target.value)} /></label>
          </div>}
          {kind === 'MANUAL' && displayBaselineId && <p className="mt-2 text-xs text-slate-400">Linked to your Display setup baseline: Dialed will check your monitor and graphics card still match before showing the result.</p>}
        </fieldset>
        <label className="block text-sm font-semibold text-slate-100">2. Which game will you test in?
          <input className={`${FIELD} max-w-md`} maxLength={80} value={game} placeholder="e.g. VALORANT" onChange={(event) => setGame(event.target.value)} />
        </label>
      </div>
      {tips}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" className={PRIMARY} onClick={start}>Start test</button>
        {creating && running.length > 0 && <button type="button" className={BUTTON} onClick={() => setCreating(false)}>Back to the test in progress</button>}
      </div>
      {error && <p role="alert" className="mt-3 text-xs text-amber-200"><ErrorText text={error} /></p>}
    </section>;
  }

  const shownIndex = visibleStepIndex(step!);
  const counted = step === 'BEFORE' ? before.length : after.length;
  const effect = effectVsNoise(before, after);
  const cap = capWarning([...before, ...after]);
  const aba = abaCheck(before, check);
  const recorder = <div className="mt-3 rounded-lg border border-slate-700 bg-slate-950/30 p-3"><NativePresentMonCapture compact preferTarget={test.game} onImportPreview={onImportPreview} onStateChange={onRecorderState} /></div>;
  const notCounted = partition?.notCounted.filter((item) => item.reason !== 'Warm-up run — set aside so the game, shaders and clocks settle first') ?? [];
  const decisionText = { KEEP: 'You kept the change.', REVIEW_RESTORE: 'You undid the change.', INCONCLUSIVE: 'Closed without a decision.', UNDECIDED: '' };

  return <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-2 text-cyan-300"><FlaskConical className="h-5 w-5" /><span className="text-sm font-semibold">Test a change</span></div>
        <h2 className="mt-2 text-xl font-bold text-white">{test.source.title}</h2>
        <p className="mt-1 text-sm text-slate-400">in {test.game}{test.source.kind === 'MANUAL' && (test.source.fromText || test.source.toText) ? ` · ${test.source.fromText || '?'} → ${test.source.toText || '?'}` : ''}{tweak?.state ? ` · now: ${tweak.state}` : ''}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {!decided && <button type="button" className="text-xs text-slate-400 underline underline-offset-2" onClick={() => void cancel()}>Stop this test</button>}
        <button type="button" className="text-xs text-cyan-300 underline underline-offset-2" onClick={() => { setCreating(true); setSelectedId(null); }}>New test</button>
      </div>
    </div>

    <ol className="mt-5 grid grid-cols-3 gap-1" aria-label="Test steps">
      {VISIBLE_STEPS.map((item, index) => <li key={item} aria-current={index === shownIndex ? 'step' : undefined} className={`rounded px-2 py-1.5 text-center text-[11px] font-semibold ${index < shownIndex ? 'bg-emerald-500/10 text-emerald-300' : index === shownIndex ? 'bg-cyan-400/15 text-cyan-200' : 'bg-slate-800/60 text-slate-500'}`}>{index < shownIndex ? '✓ ' : ''}{STEP_LABELS[item]}</li>)}
    </ol>

    <div className="mt-5">
      {(step === 'BEFORE' || step === 'AFTER') && <>
        <h3 className="text-base font-semibold text-slate-100">{step === 'BEFORE' ? 'Measure before the change' : 'Measure after the change'}</h3>
        {step === 'AFTER' && waitingForRestart ? <div role="alert" className="mt-3 flex gap-3 rounded-lg border border-amber-500/30 bg-amber-950/15 p-4 text-sm text-amber-100">
          <TriangleAlert className="h-5 w-5 shrink-0 text-amber-300" />
          <div><p className="font-semibold">Restart Windows first</p><p className="mt-1 text-xs leading-relaxed">{test.source.title} only takes effect after a restart. Restart now, open Dialed as administrator, and come back to Measure › Test a change. Runs recorded before the restart are not counted.</p></div>
        </div> : <>
          <p className="mt-1 text-sm text-slate-400">Start {test.game} at your test scene, then press Start recording below. {step === 'AFTER' ? 'Use the same scene and run length as before.' : ''}</p>
          <p className={`mt-3 text-sm font-semibold ${counted >= RECOMMENDED_RUNS ? 'text-emerald-200' : 'text-slate-200'}`}>{runProgress(step === 'BEFORE' ? 'before' : 'after', counted, Boolean(partition?.warmups[step === 'BEFORE' ? 'baseline' : 'candidate']), true).label}</p>
          {recorder}
          <RunList runs={step === 'BEFORE' ? before : after} flags={flags} />
        </>}
        {notCounted.length > 0 && <p className="mt-2 text-xs text-slate-500">Not counted: {notCounted.map((item) => `${new Date(item.capture.startedAt).toLocaleTimeString()} (${item.reason.toLowerCase()})`).join(', ')}.</p>}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" className={PRIMARY} disabled={counted < 1 || (step === 'AFTER' && waitingForRestart)} onClick={step === 'BEFORE' ? finishBefore : finishAfter}>{step === 'BEFORE' ? 'Done — make the change' : 'Done — show the result'}</button>
          {counted > 0 && counted < RECOMMENDED_RUNS && <span className="text-xs text-slate-400">You can continue now, but {RECOMMENDED_RUNS} counted runs give a trustworthy answer.</span>}
        </div>
      </>}

      {step === 'CHANGE' && <>
        <h3 className="text-base font-semibold text-slate-100">Make the change</h3>
        {test.source.kind === 'TWEAK' ? <>
          <p className="mt-1 text-sm leading-relaxed text-slate-400">Dialed will change {test.source.title} now{tweak?.state ? ` (currently ${tweak.state})` : ''}. It is recorded in Restore, and you can undo it at the end of the test.{tweak?.requiresAdmin ? ' Dialed must be running as administrator.' : ''}</p>
          {test.source.restartRequired && <p className="mt-2 text-sm text-amber-100">This needs a restart. After applying, restart Windows, then come back here to measure again.</p>}
          <button type="button" className={`${PRIMARY} mt-4`} disabled={busy} onClick={() => void makeChange()}>{busy ? 'Applying…' : `Apply: ${test.source.title}`}</button>
        </> : <>
          <p className="mt-1 text-sm leading-relaxed text-slate-400">Now change <strong className="text-slate-200">{test.source.title}</strong>{test.source.toText ? <> to <strong className="text-slate-200">{test.source.toText}</strong></> : ''} in {test.game}'s settings. Change only this one thing. {VENDOR_TIP[vendorFor(gpu?.name ?? null, gpu?.vendor ?? null)]}</p>
          <button type="button" className={`${PRIMARY} mt-4`} onClick={() => void makeChange()}>I have made the change</button>
        </>}
      </>}

      {(step === 'RESULT' || step === 'DONE') && <>
        <h3 className="text-base font-semibold text-slate-100">{decided ? 'Result' : 'Did it help?'}</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2"><SideSummary label="Before" runs={before} /><SideSummary label="After" runs={after} /></div>
        <p className={`mt-3 rounded-lg border p-3 text-sm leading-relaxed ${effect.verdict === 'BEYOND_NOISE' ? 'border-emerald-500/30 bg-emerald-950/15 text-emerald-100' : 'border-slate-700 bg-slate-950/30 text-slate-200'}`}>{effect.verdict === 'NOT_ENOUGH_RUNS' ? roughDifference(before, after) : effect.text}</p>
        {cap && <p className="mt-2 text-sm text-amber-200">{cap.text}</p>}
        {flags.size > 0 && <p className="mt-2 text-sm text-amber-200">Some runs ran under different conditions (temperature or clock speed). Their numbers are less reliable.</p>}
        {displayIssues && displayIssues.length > 0 && <div role="alert" className="mt-2 rounded-lg border border-amber-500/30 bg-amber-950/15 p-3 text-xs text-amber-100">
          <p className="font-semibold">Your display setup changed besides this setting, so this is not a like-for-like comparison:</p>
          <ul className="mt-1 list-disc pl-5">{displayIssues.map((item) => <li key={item}>{item}</li>)}</ul>
          <p className="mt-1">Put it back the way it was, then check again.</p>
          <button type="button" className={`${BUTTON} mt-2`} onClick={() => void checkDisplay()}>Check again</button>
        </div>}

        {!decided && test.change && <div className="mt-4 rounded-lg border border-dashed border-slate-600 p-3 text-xs leading-relaxed text-slate-300">
          <p className="font-semibold text-slate-200">Optional: double-check by putting it back</p>
          {!test.revertDeclaredAt ? <>
            <p className="mt-1 text-slate-400">If the numbers return to your before results once the setting is back, the difference really came from this setting, not from heat or a background task.</p>
            {test.source.kind === 'TWEAK' && test.source.restartRequired
              ? <p className="mt-1 text-slate-500">Skipped for this tweak, because putting it back needs another restart.</p>
              : <button type="button" className={`${BUTTON} mt-2 inline-flex items-center gap-1.5`} disabled={busy} onClick={() => void putBackToCheck()}><RotateCcw className="h-4 w-4" />{test.source.kind === 'TWEAK' ? 'Put it back and measure again' : 'I have put it back — measure again'}</button>}
          </> : <>
            <p className="mt-1 text-slate-400">Put back {new Date(test.revertDeclaredAt).toLocaleTimeString()}. {runProgress('check', check.length, Boolean(partition?.warmups.check), true).label}</p>
            {recorder}
            <RunList runs={check} flags={flags} />
            <p className={`mt-2 ${aba.verdict === 'CONFIRMED' ? 'text-emerald-200' : aba.verdict === 'DID_NOT_RETURN' ? 'text-amber-200' : 'text-slate-400'}`}>{aba.text}</p>
          </>}
        </div>}

        {!decided ? <div className="mt-5">
          <p className="text-sm font-semibold text-slate-100">What do you want to do?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={PRIMARY} disabled={busy} onClick={() => void decide('KEEP')}>Keep it{test.revertDeclaredAt ? ' (apply again)' : ''}</button>
            <button type="button" className={BUTTON} disabled={busy} onClick={() => void decide('UNDO')}>{test.revertDeclaredAt ? 'Leave it undone' : test.source.kind === 'TWEAK' ? 'Undo it' : 'I will undo it'}</button>
            <button type="button" className={BUTTON} disabled={busy} onClick={() => void decide('UNSURE')}>Not sure</button>
          </div>
          {test.source.kind === 'TWEAK' && test.source.restartRequired && <p className="mt-2 text-xs text-slate-400">Undoing needs another restart to take effect.</p>}
        </div> : <div className="mt-5 flex flex-wrap items-center gap-3">
          <p role="status" className="inline-flex items-center gap-1.5 text-sm text-emerald-200"><CheckCircle2 className="h-4 w-4" />{decisionText[session?.decision ?? 'UNDECIDED']}</p>
          <button type="button" className={PRIMARY} onClick={() => { setCreating(true); setSelectedId(null); }}>Test something else</button>
        </div>}
        {comparison ? <details className="mt-5 rounded-xl border border-slate-700 bg-slate-950/30 p-3" open>
          <summary className="cursor-pointer text-sm font-semibold text-slate-100">Detailed comparison and frame-time graph</summary>
          <div className="mt-3"><ComparisonCard comparison={comparison} readings={readings} title={`${test.source.title} in ${test.game}`} /></div>
        </details> : after.length > 0 && before.length > 0 && <button type="button" className={`${BUTTON} mt-5`} disabled={busy} onClick={() => void saveComparison()}>{busy ? 'Building…' : 'Show the detailed comparison and frame-time graph'}</button>}
      </>}
    </div>
    {error && <p role="alert" className="mt-3 text-xs text-amber-200"><ErrorText text={error} /></p>}
  </section>;
}

