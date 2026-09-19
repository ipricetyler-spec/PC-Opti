import { ErrorText } from './ErrorText';
import { useEffect, useMemo, useState } from 'react';
import { Activity, CheckCircle2, FlaskConical, RefreshCw, Scale, Wrench } from 'lucide-react';
import type { BenchmarkComparison, BenchmarkEvidenceState, BenchmarkImportPreview, PresentMonCaptureEntry } from '../types';
import { useConfirm } from './ConfirmContext';
import { NativePresentMonCapture } from './NativePresentMonCapture';
import { SESSION_KEY, parseSessions, sameCaptureGroup, sessionCaptureIds, sessionPairIssue, type ExperimentSession } from '../lib/experimentSessions';
import { FIELD_LABELS, describeField, type BaselineSettings, type DisplayBaseline } from '../lib/displayBaseline';
import {
  DISPLAY_EXPERIMENTS_KEY,
  blockingContextChanges,
  describeDeclaredChange,
  evidenceStrength,
  experimentFor,
  experimentStage,
  linkRuns,
  newExperimentSession,
  parseExperiments,
  partitionRuns,
  saveExperiments,
  sessionLimitReached,
  upsertExperiment,
  vendorFor,
  type DisplayExperiment,
  type ExperimentStage,
} from '../lib/displayExperiment';
import { abaCheck, capWarning, conditionFlags, effectVsNoise, runProgress } from '../lib/experimentRigor';

const BUTTON = 'rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-sm font-semibold text-cyan-200 disabled:opacity-40';
const FIELD_CLASS = 'mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm text-white';
const STAGE_ORDER: ExperimentStage[] = ['MEASURE_BASELINE', 'DECLARE_CHANGE', 'MEASURE_CANDIDATE', 'COMPARE', 'DECIDE', 'DONE'];

const VENDOR_GUIDANCE = {
  NVIDIA: 'Change it in the game\'s own settings first. For driver-level settings use NVIDIA Control Panel › Manage 3D settings › Program Settings, or the NVIDIA app\'s per-game settings — not the global settings. In supported games, start with in-game NVIDIA Reflex; it takes precedence over the driver\'s Low Latency Mode.',
  AMD: 'Change it in the game\'s own settings first. For driver-level settings use AMD Software › Gaming › Games and select this game, rather than the global settings. Anti-Lag 2 works only in games that integrate it.',
  INTEL: 'Change it in the game\'s own settings first. Use Intel\'s graphics software for per-game driver settings where it offers them, rather than global settings.',
  UNKNOWN: 'Change it in the game\'s own settings menu. Use graphics-card software only if the game has no option for it, and prefer per-game settings over global ones.',
} as const;

function readSessions(): { sessions: ExperimentSession[]; blocked: boolean } {
  try { return { sessions: parseSessions(window.localStorage.getItem(SESSION_KEY)), blocked: false }; }
  catch { return { sessions: [], blocked: true }; }
}

function readExperiments(): DisplayExperiment[] {
  try { return parseExperiments(window.localStorage.getItem(DISPLAY_EXPERIMENTS_KEY)); }
  catch { return []; }
}

/** The saved comparison for exactly this session and exactly these runs, if any. */
function linkedComparison(evidence: BenchmarkEvidenceState, session: ExperimentSession | null): BenchmarkComparison | null {
  if (!session) return null;
  return evidence.comparisons.find((item) => item.experimentId === session.id
    && sameCaptureGroup(item.baseline?.trialIds, sessionCaptureIds(session, 'baseline'))
    && sameCaptureGroup(item.candidate?.trialIds, sessionCaptureIds(session, 'candidate'))
    && Boolean(session.manualChangedAt && item.candidate?.notes.includes(session.manualChangedAt))) ?? null;
}

function StrengthNote({ runs }: { runs: number }) {
  const strength = evidenceStrength(runs);
  const text = strength === 'NONE' ? 'No runs yet.'
    : strength === 'DESCRIPTIVE' ? '1 run — enough for a descriptive look, not a matched comparison. Take two more for that.'
      : strength === 'NEEDS_ONE_MORE' ? '2 runs — take one more. A matched comparison needs at least three per side.'
        : `${runs} runs — enough for a matched comparison.`;
  return <p className="text-xs text-slate-400">{text}</p>;
}

function RunCounter({ side, counted, warmupTaken, warmupEnabled }: { side: 'before' | 'after' | 'check'; counted: number; warmupTaken: boolean; warmupEnabled: boolean }) {
  const progress = runProgress(side, counted, warmupTaken, warmupEnabled);
  return <p className={`text-xs ${progress.complete ? 'text-emerald-200' : 'text-slate-300'}`}>{progress.label}</p>;
}

function RunList({ label, runs, flags }: { label: string; runs: PresentMonCaptureEntry[]; flags?: Map<string, string[]> }) {
  if (!runs.length) return null;
  return <div><p className="text-xs font-semibold text-slate-300">{label}</p><ul className="mt-1 space-y-1 text-xs text-slate-400">
    {runs.map((run) => <li key={run.captureId}>{new Date(run.startedAt).toLocaleTimeString()} · {run.target.name} · {run.durationSeconds} s
      {run.frameSummary && <> · <span className="text-slate-200">{Math.round(run.frameSummary.averageFps)} FPS avg</span>, {Math.round(run.frameSummary.onePercentLowFps)} FPS 1% low{run.frameSummary.capLikely ? ' · looks capped' : ''}</>}
      {flags?.get(run.captureId)?.map((note) => <span key={note} className="block text-amber-200">Different conditions: {note}.</span>)}
    </li>)}
  </ul></div>;
}

export function DisplayExperimentSteps({ baseline, contextChanges, gpuName, gpuVendor, evidence, onCompare, onImportPreview }: {
  baseline: DisplayBaseline;
  contextChanges: string[];
  gpuName: string | null;
  gpuVendor: string | null;
  evidence: BenchmarkEvidenceState;
  onCompare: (preview: BenchmarkImportPreview, session: ExperimentSession) => void;
  onImportPreview: (preview: BenchmarkImportPreview) => void;
}) {
  const confirm = useConfirm();
  const [experiments, setExperiments] = useState(readExperiments);
  const [sessionState, setSessionState] = useState(readSessions);
  const [captures, setCaptures] = useState<PresentMonCaptureEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changeField, setChangeField] = useState<keyof BaselineSettings>('frameCap');
  const [changeTo, setChangeTo] = useState('');
  const [changeNotes, setChangeNotes] = useState('');

  const experiment = experimentFor(experiments, baseline.id);
  const storedSession = experiment ? sessionState.sessions.find((item) => item.id === experiment.sessionId) ?? null : null;
  const partition = useMemo(() => (experiment ? partitionRuns(captures, experiment) : null), [captures, experiment]);
  // Until a decision is made, the session's run links follow the current captures, so the
  // comparison is made on the runs actually shown here. Once decided they freeze: runs
  // recorded later for something else must not be pulled in and silently undo the decision.
  const decided = storedSession !== null && storedSession.decision !== 'UNDECIDED';
  const session = storedSession && partition && !decided ? linkRuns(storedSession, partition) : storedSession;
  const shownBaseline = decided && storedSession
    ? captures.filter((capture) => sessionCaptureIds(storedSession, 'baseline').includes(capture.captureId))
    : (partition?.baseline ?? []) as PresentMonCaptureEntry[];
  const shownCandidate = decided && storedSession
    ? captures.filter((capture) => sessionCaptureIds(storedSession, 'candidate').includes(capture.captureId))
    : (partition?.candidate ?? []) as PresentMonCaptureEntry[];
  const comparison = linkedComparison(evidence, session);
  const stage: ExperimentStage = experiment && partition
    ? experimentStage({ experiment, session, partition, captures, hasComparison: comparison !== null })
    : 'MEASURE_BASELINE';
  const blocking = blockingContextChanges(contextChanges, experiment);
  const pairIssue = session ? sessionPairIssue(session, captures, []) : null;
  const vendor = vendorFor(gpuName, gpuVendor);
  const warmupEnabled = experiment?.warmup === true;
  const shownCheck = (partition?.check ?? []) as PresentMonCaptureEntry[];
  const flags = conditionFlags(shownBaseline, [...shownBaseline, ...shownCandidate, ...shownCheck]);
  const effect = effectVsNoise(shownBaseline, shownCandidate);
  const cap = capWarning([...shownBaseline, ...shownCandidate]);
  const aba = abaCheck(shownBaseline, shownCheck);
  const candidateDone = shownCandidate.length > 0;

  const writeSessions = (next: ExperimentSession[]): boolean => {
    if (sessionState.blocked) {
      setError('Saved experiment sessions could not be read, so nothing new is saved over them. Open Home › experiment sessions to export and recover them first.');
      return false;
    }
    try {
      const raw = JSON.stringify(next);
      parseSessions(raw);
      window.localStorage.setItem(SESSION_KEY, raw);
      setSessionState({ sessions: next, blocked: false });
      return true;
    } catch {
      setError('Progress could not be saved to this device. What was saved before is unchanged.');
      return false;
    }
  };
  const writeExperiments = (next: DisplayExperiment[]): boolean => {
    const saved = saveExperiments(window.localStorage, next);
    if (saved) setExperiments(next);
    else setError('Progress could not be saved to this device. What was saved before is unchanged.');
    return saved;
  };
  const updateSession = (patch: Partial<ExperimentSession>): boolean => {
    if (!session) return false;
    return writeSessions(sessionState.sessions.map((item) => item.id === session.id ? { ...session, ...patch } : item));
  };

  // Persist refreshed run links so the Home session list shows the same runs as here.
  useEffect(() => {
    if (!session || !storedSession || session === storedSession) return;
    writeSessions(sessionState.sessions.map((item) => item.id === session.id ? session : item));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.baselineIds?.join(','), session?.candidateIds?.join(',')]);

  const readRuns = async () => {
    if (!window.pcOptiNative) { setError('Runs are recorded in the Dialed desktop app.'); return; }
    setBusy(true);
    try {
      setCaptures((await window.pcOptiNative.getPresentMonCaptureState()).entries);
      setError(null);
    } catch {
      setError('Saved runs could not be read. Nothing was started or changed.');
    } finally { setBusy(false); }
  };
  useEffect(() => { void readRuns(); }, []);

  const start = () => {
    setError(null);
    if (sessionLimitReached(sessionState.sessions)) {
      setError('You already have 20 experiment sessions, the most Dialed keeps. Delete one from Home › experiment sessions to start another.');
      return;
    }
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const nextSession = newExperimentSession(baseline, id, createdAt);
    if (!writeSessions([nextSession, ...sessionState.sessions])) return;
    writeExperiments(upsertExperiment(experiments, {
      schemaVersion: 1, id, baselineId: baseline.id, sessionId: nextSession.id, createdAt, change: null, restoreDeclaredAt: null, warmup: true,
    }));
  };

  const declare = async () => {
    if (!experiment || !session || !changeTo.trim()) return;
    const fromText = describeField(changeField, baseline.settings);
    const confirmed = await confirm({
      title: 'Record this change?',
      description: `Only record it after you have made it in ${baseline.context.gameName} or your graphics-card software, and before you measure again.`,
      details: `${FIELD_LABELS[changeField]}: ${fromText} → ${changeTo.trim()}${changeNotes.trim() ? `\nNote: ${changeNotes.trim()}` : ''}`,
      detailsLabel: 'What you changed',
      notice: 'Dialed does not make or check this change. The time you record here is what separates your before runs from your after runs.',
      confirmLabel: 'I have made this change',
    });
    if (!confirmed) return;
    const declaredAt = new Date().toISOString();
    const change = { field: changeField, fromText, toText: changeTo.trim().slice(0, 80), notes: changeNotes.trim().slice(0, 160), declaredAt };
    if (!updateSession({ changeDescription: describeDeclaredChange(change), manualChangedAt: declaredAt, decision: 'UNDECIDED' })) return;
    writeExperiments(upsertExperiment(experiments, { ...experiment, change }));
  };

  const compare = async () => {
    if (!session || pairIssue || blocking.length || !window.pcOptiNative) return;
    setBusy(true);
    try {
      const preview = await window.pcOptiNative.prepareNativePresentMonImport([...sessionCaptureIds(session, 'baseline'), ...sessionCaptureIds(session, 'candidate')]);
      if (!preview.canceled) onCompare(preview, session);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The comparison could not be prepared.');
    } finally { setBusy(false); }
  };

  const restore = async () => {
    if (!experiment?.change) return;
    const confirmed = await confirm({
      title: 'Put the setting back?',
      description: `Set ${FIELD_LABELS[experiment.change.field]} back to what it was in your baseline, in the same place you changed it.`,
      details: `${FIELD_LABELS[experiment.change.field]}: ${experiment.change.toText} → ${experiment.change.fromText}`,
      detailsLabel: 'Set it back to',
      notice: 'Dialed cannot make or check this change. Confirm only once you have done it yourself.',
      confirmLabel: 'I have put it back',
    });
    if (!confirmed) return;
    if (updateSession({ decision: 'REVIEW_RESTORE' })) writeExperiments(upsertExperiment(experiments, { ...experiment, restoreDeclaredAt: new Date().toISOString() }));
  };

  const revertToCheck = async () => {
    if (!experiment?.change || experiment.revertDeclaredAt) return;
    const confirmed = await confirm({
      title: 'Put it back and measure again?',
      description: `Set ${FIELD_LABELS[experiment.change.field]} back to your baseline value, then record more runs. If results return to your baseline, the difference followed the setting.`,
      details: `${FIELD_LABELS[experiment.change.field]}: ${experiment.change.toText} → ${experiment.change.fromText}`,
      detailsLabel: 'Set it back to',
      notice: 'Dialed cannot make or check this change. Confirm only once you have done it yourself. If you then decide to keep the change, set it again afterwards.',
      confirmLabel: 'I have put it back',
    });
    if (!confirmed) return;
    writeExperiments(upsertExperiment(experiments, { ...experiment, revertDeclaredAt: new Date().toISOString() }));
  };

  const stepState = (step: ExperimentStage) => {
    const current = STAGE_ORDER.indexOf(stage);
    const index = STAGE_ORDER.indexOf(step);
    return index < current ? 'done' : index === current ? 'current' : 'later';
  };
  const stepClass = (step: ExperimentStage) => `rounded-xl border p-4 ${stepState(step) === 'current' ? 'border-cyan-400/40 bg-slate-950/60' : 'border-slate-700 bg-slate-950/30'}`;
  const doneMark = (step: ExperimentStage) => stepState(step) === 'done' ? <CheckCircle2 className="h-4 w-4 text-emerald-300" aria-label="done" /> : null;

  if (!experiment) {
    return <div className="rounded-xl border border-slate-700 bg-slate-950/40 p-4">
      <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-100"><FlaskConical className="h-4 w-4 text-cyan-300" /> Step 3 · Measure, change one thing, measure again</h4>
      <p className="mt-1 text-xs leading-relaxed text-slate-400">Dialed records frame-time runs before and after one change you make, then compares them. It creates an experiment session on Home that holds your runs and your decision.</p>
      <button type="button" className={`${BUTTON} mt-3`} onClick={start}>Start measuring</button>
      {error && <p role="alert" className="mt-2 text-xs text-amber-200"><ErrorText text={error} /></p>}
    </div>;
  }

  return <div className="space-y-4">
    <p role="status" className="text-xs text-slate-400">Experiment for {baseline.context.gameName} on {baseline.context.monitorLabel} · current step: {{
      MEASURE_BASELINE: 'measure your baseline', DECLARE_CHANGE: 'make one change', MEASURE_CANDIDATE: 'measure again',
      COMPARE: 'compare', DECIDE: 'decide', DONE: 'decision recorded',
    }[stage]}. Your progress is saved; you can leave and come back.</p>

    <div className={stepClass('MEASURE_BASELINE')}>
      <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-100"><Activity className="h-4 w-4 text-cyan-300" /> Step 3 · Measure your baseline {doneMark('MEASURE_BASELINE')}</h4>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-relaxed text-slate-400">
        <li>Use the same scene every time — a replay, benchmark or fixed route.</li>
        <li>Use the same run length every time; runs of different lengths cannot be compared.</li>
        <li>Keep the settings you saved in step 2, and close anything heavy in the background.</li>
      </ul>
      <div className="mt-3">{warmupEnabled && !decided && <RunCounter side="before" counted={shownBaseline.length} warmupTaken={!!partition?.warmups.baseline} warmupEnabled />}<StrengthNote runs={shownBaseline.length} /></div>
      <div className="mt-2"><RunList label="Before runs" runs={shownBaseline} flags={flags} /></div>
    </div>

    <div className={stepClass('DECLARE_CHANGE')}>
      <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-100"><Wrench className="h-4 w-4 text-cyan-300" /> Step 4 · Change one setting {doneMark('DECLARE_CHANGE')}</h4>
      {experiment.change
        ? <p className="mt-2 text-xs text-slate-300">Recorded {new Date(experiment.change.declaredAt).toLocaleString()}: {describeDeclaredChange(experiment.change)}. To undo it, set {FIELD_LABELS[experiment.change.field]} back to {experiment.change.fromText}.</p>
        : stage === 'DECLARE_CHANGE' ? <>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">{VENDOR_GUIDANCE[vendor]} <span className="text-slate-500">Guidance reviewed September 5, 2026.</span></p>
          <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-3">
            <label className="text-xs font-semibold text-slate-300">Setting you changed
              <select className={FIELD_CLASS} value={changeField} onChange={(event) => setChangeField(event.target.value as keyof BaselineSettings)}>
                {(Object.keys(FIELD_LABELS) as Array<keyof BaselineSettings>).map((field) => <option key={field} value={field}>{FIELD_LABELS[field]}</option>)}
              </select>
            </label>
            <div className="text-xs text-slate-300"><span className="font-semibold">Baseline value</span><p className="mt-2 rounded-lg border border-slate-700 p-2">{describeField(changeField, baseline.settings)}</p><p className="mt-1 text-slate-500">This is what you would set it back to.</p></div>
            <label className="text-xs font-semibold text-slate-300">New value
              <input className={FIELD_CLASS} maxLength={80} value={changeTo} placeholder="e.g. No cap" onChange={(event) => setChangeTo(event.target.value)} />
            </label>
            <label className="text-xs font-semibold text-slate-300">Note (optional)
              <input className={FIELD_CLASS} maxLength={160} value={changeNotes} onChange={(event) => setChangeNotes(event.target.value)} />
            </label>
          </div>
          <button type="button" className={`${BUTTON} mt-3`} disabled={!changeTo.trim()} onClick={() => void declare()}>I have made this change</button>
        </> : <p className="mt-1 text-xs text-slate-500">Available after at least one baseline run.</p>}
    </div>

    <div className={stepClass('MEASURE_CANDIDATE')}>
      <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-100"><Activity className="h-4 w-4 text-cyan-300" /> Step 5 · Measure again {doneMark('MEASURE_CANDIDATE')}</h4>
      <p className="mt-1 text-xs text-slate-400">Same scene, same run length, same number of runs as before where you can.</p>
      {experiment.change && <><div className="mt-2">{warmupEnabled && !decided && <RunCounter side="after" counted={shownCandidate.length} warmupTaken={!!partition?.warmups.candidate} warmupEnabled />}<StrengthNote runs={shownCandidate.length} /></div>
        <div className="mt-2"><RunList label="After runs" runs={shownCandidate} flags={flags} /></div></>}
      {experiment.change && pairIssue && (partition?.candidate.length ?? 0) > 0 && <p className="mt-2 text-xs text-amber-200">{pairIssue}</p>}
    </div>

    {stage !== 'DONE' && <details className="rounded-xl border border-slate-700 bg-slate-950/30 p-4" open={stage === 'MEASURE_BASELINE' || stage === 'MEASURE_CANDIDATE' || !!experiment.revertDeclaredAt}>
      <summary className="cursor-pointer text-sm font-semibold text-slate-100">Record a run</summary>
      <p className="mt-2 text-xs text-slate-400">Start the game at the scene first, then record here. Runs are filed as before, after or check runs automatically, by when they ran relative to the changes you record.</p>
      <div className="mt-3"><NativePresentMonCapture onImportPreview={onImportPreview} /></div>
    </details>}
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className={BUTTON} disabled={busy} onClick={() => void readRuns()}><span className="inline-flex items-center gap-1.5"><RefreshCw className="h-4 w-4" /> Check for new runs</span></button>
      {partition && partition.notCounted.length > 0 && <p className="text-xs text-slate-400">Not counted: {partition.notCounted.map((item) => `${new Date(item.capture.startedAt).toLocaleTimeString()} (${item.reason.toLowerCase()})`).join(', ')}.</p>}
    </div>

    <div className={stepClass('COMPARE')}>
      <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-100"><Scale className="h-4 w-4 text-cyan-300" /> Step 6 · Compare and decide {doneMark('DECIDE')}</h4>
      {blocking.length > 0 && !comparison && stage !== 'DONE' && <div role="alert" className="mt-2 rounded-lg border border-amber-500/30 bg-amber-950/15 p-3 text-xs leading-relaxed text-amber-100">
        <p className="font-semibold">Not comparable yet — your setup changed besides the one setting you recorded:</p>
        <ul className="mt-1 list-disc pl-5">{blocking.map((item) => <li key={item}>{item}</li>)}</ul>
        <p className="mt-1">Put the setup back the way it was and read display information again, or save a new baseline and start over.</p>
      </div>}
      {candidateDone && <div className="mt-2 space-y-2 rounded-lg border border-slate-700 p-3 text-xs leading-relaxed">
        <p className="font-semibold text-slate-200">Is the difference bigger than normal variation?</p>
        <p className={effect.verdict === 'BEYOND_NOISE' ? 'text-emerald-200' : 'text-slate-300'}>{effect.text}</p>
        {cap && <p className="text-amber-200">{cap.text}</p>}
        {flags.size > 0 && <p className="text-amber-200">Some runs ran under different conditions (marked above). Consider re-taking them once the PC is back to its usual temperature.</p>}
      </div>}
      {(stage === 'COMPARE' || stage === 'DECIDE' || stage === 'DONE') && !comparison && <>
        <p className="mt-2 text-xs text-slate-400">This opens the comparison in Measure, already linked to this experiment. Save it there, then come back here to decide.</p>
        <button type="button" className={`${BUTTON} mt-2`} disabled={busy || !!pairIssue || blocking.length > 0} onClick={() => void compare()}>Prepare the comparison</button>
      </>}
      {comparison && <p role="status" className="mt-2 text-sm text-slate-200">Result: {comparison.classification.replaceAll('_', ' ').toLowerCase()} — {comparison.reason}
        {evidenceStrength(Math.min(sessionCaptureIds(session!, 'baseline').length, sessionCaptureIds(session!, 'candidate').length)) !== 'MATCHED' && <span className="block text-xs text-slate-400">Based on one run each — descriptive only.</span>}</p>}
      {experiment.change && candidateDone && (stage !== 'DONE' || experiment.revertDeclaredAt) && <div className="mt-3 rounded-lg border border-dashed border-slate-600 p-3 text-xs leading-relaxed text-slate-300">
        <p className="font-semibold text-slate-200">Optional: put it back and measure again</p>
        {!experiment.revertDeclaredAt ? <>
          <p className="mt-1 text-slate-400">The strongest check. If results return to your baseline once the setting is back, the difference came from the setting — not from heat, a background task or a game update. Best for settings that need a restart.</p>
          {stage !== 'DONE' && <button type="button" className={`${BUTTON} mt-2`} onClick={() => void revertToCheck()}>I have put it back — measure again</button>}
        </> : <>
          <p className="mt-1 text-slate-400">You put it back at {new Date(experiment.revertDeclaredAt).toLocaleString()} (not checked by Dialed).</p>
          {/* Check runs are matched by time only, so after a decision later runs recorded for
              something else would join them; the live check is shown only while deciding. */}
          {!decided && <><div className="mt-2"><RunCounter side="check" counted={shownCheck.length} warmupTaken={!!partition?.warmups.check} warmupEnabled={warmupEnabled} /></div>
          <div className="mt-2"><RunList label="Check runs" runs={shownCheck} flags={flags} /></div>
          <p className={`mt-2 ${aba.verdict === 'CONFIRMED' ? 'text-emerald-200' : aba.verdict === 'DID_NOT_RETURN' ? 'text-amber-200' : 'text-slate-400'}`}>{aba.text}</p>
          <p className="mt-1 text-slate-400">The setting is at its baseline value now. If you keep the change, set it to {experiment.change.toText} again.</p></>}
        </>}
      </div>}
      {experiment.change && stage !== 'DONE' && <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={BUTTON} disabled={!comparison} onClick={() => updateSession({ decision: 'KEEP' })}>Keep the change</button>
        <button type="button" className={BUTTON} onClick={() => void restore()}>Put it back</button>
        <button type="button" className={BUTTON} onClick={() => updateSession({ decision: 'INCONCLUSIVE' })}>Mark as inconclusive</button>
      </div>}
      {session && session.decision !== 'UNDECIDED' && <p role="status" className="mt-2 text-xs text-emerald-200">Decision recorded: {{ KEEP: 'keep the change', REVIEW_RESTORE: 'put it back', INCONCLUSIVE: 'inconclusive', UNDECIDED: '' }[session.decision]}{experiment.restoreDeclaredAt ? ` — you confirmed putting it back at ${new Date(experiment.restoreDeclaredAt).toLocaleString()} (not checked by Dialed)` : ''}. It is also shown in your experiment sessions on Home.</p>}
      {stage === 'DONE' && <button type="button" className={`${BUTTON} mt-3`} onClick={start}>Start a new experiment on this baseline</button>}
      <p className="mt-2 text-xs text-slate-500">Frame times describe how evenly frames were delivered. They do not measure input latency — the time from a click to the screen.</p>
    </div>
    {error && <p role="alert" className="text-xs text-amber-200"><ErrorText text={error} /></p>}
  </div>;
}
