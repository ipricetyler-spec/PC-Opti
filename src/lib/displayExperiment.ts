/**
 * Steps 3–6 of the Display setup workflow: measure the baseline, declare one change,
 * measure the candidate, then decide.
 *
 * This deliberately does not build a second evidence system. A display experiment is a
 * thin link between a saved display baseline and an ordinary experiment session in
 * manual-change mode. Capture, matching rules and the paired comparison are all the
 * existing ones:
 *
 *   - captures come from the existing PresentMon flow (target picker, consent, provenance)
 *   - `sessionPairIssue` enforces one run per side (descriptive) or at least three,
 *     matched target and duration, and baseline runs finishing before the change
 *   - the comparison is prepared and saved through the existing Measure import
 *   - the decision is recorded on the session — never in the privileged action journal,
 *     because the person made the change, not Dialed
 *
 * Pure and storage-agnostic so it can be tested without a browser.
 */
import type { PresentMonCaptureEntry } from '../types';
import type { ExperimentSession } from './experimentSessions';
import { sessionCaptureIds, sessionPairIssue } from './experimentSessions';
import { FIELD_LABELS, type BaselineSettings, type DisplayBaseline } from './displayBaseline';

export const DISPLAY_EXPERIMENTS_KEY = 'dialed-display-experiments:v1';
export const MAX_STORED_EXPERIMENTS = 50;
const MAX_SESSIONS = 20;

export interface DeclaredChange {
  field: keyof BaselineSettings;
  /** The baseline value, as shown to the person — what to set it back to. */
  fromText: string;
  toText: string;
  notes: string;
  declaredAt: string;
}

export interface DisplayExperiment {
  schemaVersion: 1;
  id: string;
  baselineId: string;
  sessionId: string;
  createdAt: string;
  change: DeclaredChange | null;
  /** When the person said they had put the setting back. Never verified by Dialed. */
  restoreDeclaredAt: string | null;
  /** When true, the first run on each side is a warm-up and is not counted. Experiments
   *  saved before this existed have no warm-up. */
  warmup?: boolean;
  /** Undo-and-remeasure: when the person said they had put the setting back to re-check.
   *  Runs after this are check runs, not after runs. Never verified by Dialed. */
  revertDeclaredAt?: string | null;
}

export type ExperimentStage =
  | 'MEASURE_BASELINE'
  | 'DECLARE_CHANGE'
  | 'MEASURE_CANDIDATE'
  | 'COMPARE'
  | 'DECIDE'
  | 'DONE';

export type GpuVendor = 'NVIDIA' | 'AMD' | 'INTEL' | 'UNKNOWN';

type Capture = Pick<PresentMonCaptureEntry, 'captureId' | 'status' | 'startedAt' | 'completedAt' | 'durationSeconds' | 'protocolComplete' | 'stopReason' | 'target'>;

// --- Sessions ------------------------------------------------------------------------

export function experimentWorkload(baseline: DisplayBaseline): string {
  return `${baseline.context.gameName} on ${baseline.context.monitorLabel}`.slice(0, 160);
}

/**
 * Creates the manual-change session this experiment drives. The change description is
 * left empty until the change is declared: `sessionPairIssue` refuses to compare a
 * manual session without one, so an undeclared change can never reach a comparison.
 */
export function newExperimentSession(baseline: DisplayBaseline, id: string, createdAt: string): ExperimentSession {
  return {
    id: `session-${id}`,
    workload: experimentWorkload(baseline),
    changeDescription: '',
    createdAt,
    baselineId: '',
    candidateId: '',
    auditId: '',
    decision: 'UNDECIDED',
    changeMode: 'MANUAL',
    manualChangedAt: '',
    baselineIds: [],
    candidateIds: [],
  };
}

export function sessionLimitReached(sessions: ExperimentSession[]): boolean {
  return sessions.length >= MAX_SESSIONS;
}

export function describeDeclaredChange(change: Pick<DeclaredChange, 'field' | 'fromText' | 'toText' | 'notes'>): string {
  const base = `Changed ${FIELD_LABELS[change.field]} from ${change.fromText} to ${change.toText}`;
  const notes = change.notes.trim();
  return (notes ? `${base} — ${notes}` : base).slice(0, 240);
}

// --- Runs ----------------------------------------------------------------------------

/** Only a completed, timed capture with a verified duration can count as evidence. */
export function isUsableCapture(capture: Capture): boolean {
  return capture.status === 'COMPLETE' && capture.stopReason === 'TIMED' && capture.protocolComplete === true
    && !!capture.completedAt && Number.isFinite(Date.parse(capture.completedAt)) && Number.isFinite(Date.parse(capture.startedAt));
}

export interface RunPartition {
  /** Usable runs that finished after the experiment began and before the change. */
  baseline: Capture[];
  /** Usable runs that started after the declared change (and before any undo). */
  candidate: Capture[];
  /** Usable runs that started after the setting was put back to re-check. */
  check: Capture[];
  /** The capture set aside as the warm-up run on each side, if any. */
  warmups: Partial<Record<'baseline' | 'candidate' | 'check', string>>;
  /** Runs in the experiment's window that cannot count, with the reason. */
  notCounted: Array<{ capture: Capture; reason: string }>;
}

/**
 * Sorts captures into before and after purely by time relative to the declared change.
 * This is correct by construction: a run cannot be filed on the wrong side of a change
 * it did not straddle. A run that straddles the change, or failed, is shown as not
 * counted rather than silently dropped, so the person can see why.
 */
/** The timing an experiment needs to file runs: when it began, when the change was
 *  made, and when it was put back to re-check. Display experiments and change tests both
 *  have this shape. */
export interface RunWindow {
  createdAt: string;
  change: { declaredAt: string } | null;
  revertDeclaredAt?: string | null;
  warmup?: boolean;
  /** For a change that needs a restart: runs after the change that started before this
   *  boot ran without it, so they are set aside. */
  activeFrom?: string | null;
}

export function partitionRuns(captures: Capture[], experiment: RunWindow): RunPartition {
  const opened = Date.parse(experiment.createdAt);
  const changedAt = experiment.change ? Date.parse(experiment.change.declaredAt) : null;
  const revertedAt = experiment.change && experiment.revertDeclaredAt ? Date.parse(experiment.revertDeclaredAt) : null;
  const result: RunPartition = { baseline: [], candidate: [], check: [], notCounted: [], warmups: {} };
  for (const capture of captures) {
    const started = Date.parse(capture.startedAt);
    if (!Number.isFinite(started) || started < opened) continue;
    if (!isUsableCapture(capture)) {
      result.notCounted.push({ capture, reason: capture.status === 'COMPLETE' ? 'Duration was not verified' : 'Did not complete' });
      continue;
    }
    const completed = Date.parse(capture.completedAt as string);
    const activeFrom = experiment.activeFrom ? Date.parse(experiment.activeFrom) : null;
    if (changedAt !== null && activeFrom !== null && started > changedAt && started < activeFrom && (revertedAt === null || started < revertedAt)) {
      result.notCounted.push({ capture, reason: 'Recorded before the restart, so the change was not active yet' });
      continue;
    }
    if (changedAt === null || completed < changedAt) result.baseline.push(capture);
    else if (started > changedAt && (revertedAt === null || completed < revertedAt)) result.candidate.push(capture);
    else if (revertedAt !== null && started > revertedAt) result.check.push(capture);
    else result.notCounted.push({ capture, reason: revertedAt !== null && started > changedAt ? 'Ran while the setting was being put back' : 'Ran while the change was being made' });
  }
  const byStart = (left: Capture, right: Capture) => Date.parse(left.startedAt) - Date.parse(right.startedAt);
  const sides = ['baseline', 'candidate', 'check'] as const;
  for (const side of sides) result[side].sort(byStart);

  // The first run after a change, or after starting, runs with cold caches, shader
  // compilation and clocks still settling. It is set aside, with the reason shown.
  if (experiment.warmup) {
    for (const side of sides) {
      const first = result[side].shift();
      if (first) {
        result.warmups[side] = first.captureId;
        result.notCounted.push({ capture: first, reason: 'Warm-up run — set aside so the game, shaders and clocks settle first' });
      }
    }
  }

  // Every run must match the first baseline run's program and length — the comparison
  // rules require it. Without this, one accidental run of the wrong game or length would
  // sit in the set permanently and block the comparison with no way to remove it; setting
  // it aside as "not counted", with the reason shown, keeps the rest usable.
  const reference = result.baseline[0];
  if (reference) {
    const matches = (capture: Capture) => capture.target.name === reference.target.name && capture.durationSeconds === reference.durationSeconds;
    const reason = `Different program or run length from your first before run (${reference.target.name}, ${reference.durationSeconds} s)`;
    for (const side of sides) {
      const kept: Capture[] = [];
      for (const capture of result[side]) {
        if (matches(capture)) kept.push(capture);
        else result.notCounted.push({ capture, reason });
      }
      result[side] = kept;
    }
  }
  return result;
}

/**
 * How much weight the runs can bear. One run per side can be compared, but only
 * descriptively; at least three per side are needed for a matched comparison. Two is
 * neither — the existing rules refuse it — so the person is told to take one more.
 */
export function evidenceStrength(runs: number): 'NONE' | 'DESCRIPTIVE' | 'NEEDS_ONE_MORE' | 'MATCHED' {
  if (runs <= 0) return 'NONE';
  if (runs === 1) return 'DESCRIPTIVE';
  if (runs === 2) return 'NEEDS_ONE_MORE';
  return 'MATCHED';
}

/**
 * Picks which runs to link. With three or more per side all are used; with exactly one
 * per side that pair is used; otherwise the sides are trimmed to one each so a
 * descriptive comparison is still possible while more runs are taken.
 */
export function selectRuns(partition: Pick<RunPartition, 'baseline' | 'candidate' | 'notCounted'>): { baselineIds: string[]; candidateIds: string[] } {
  const baseline = partition.baseline.map((capture) => capture.captureId);
  const candidate = partition.candidate.map((capture) => capture.captureId);
  if (baseline.length >= 3 && candidate.length >= 3) {
    const total = baseline.length + candidate.length;
    if (total <= 20) return { baselineIds: baseline, candidateIds: candidate };
    return { baselineIds: baseline.slice(-10), candidateIds: candidate.slice(0, 10) };
  }
  if (baseline.length && candidate.length) return { baselineIds: baseline.slice(-1), candidateIds: candidate.slice(0, 1) };
  return { baselineIds: baseline, candidateIds: candidate };
}

/** The session with its run links refreshed from the current captures. */
export function linkRuns(session: ExperimentSession, partition: RunPartition): ExperimentSession {
  const { baselineIds, candidateIds } = selectRuns(partition);
  const unchanged = sameIds(sessionCaptureIds(session, 'baseline'), baselineIds) && sameIds(sessionCaptureIds(session, 'candidate'), candidateIds);
  if (unchanged) return session;
  return {
    ...session,
    baselineIds,
    candidateIds,
    baselineId: baselineIds[0] ?? '',
    candidateId: candidateIds[0] ?? '',
    // New evidence invalidates a decision made on the old evidence.
    decision: 'UNDECIDED',
  };
}

function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

// --- Context ---------------------------------------------------------------------------

/**
 * Context changes that should block a matched result. When the declared change is the
 * refresh rate itself, a different observed refresh rate is the change working, not a
 * confounder, so that one is not counted against it.
 */
export function blockingContextChanges(changes: string[], experiment: DisplayExperiment | null): string[] {
  if (experiment?.change?.field !== 'refreshHz') return changes;
  return changes.filter((change) => !/^The monitor is now at \d+ Hz/.test(change));
}

// --- Stage -----------------------------------------------------------------------------

export interface StageInput {
  experiment: RunWindow;
  session: ExperimentSession | null;
  partition: RunPartition;
  captures: Capture[];
  hasComparison: boolean;
}

export function experimentStage({ experiment, session, partition, captures, hasComparison }: StageInput): ExperimentStage {
  if (!session) return 'MEASURE_BASELINE';
  if (session.decision !== 'UNDECIDED') return 'DONE';
  if (!experiment.change) return partition.baseline.length ? 'DECLARE_CHANGE' : 'MEASURE_BASELINE';
  if (!partition.candidate.length) return 'MEASURE_CANDIDATE';
  if (hasComparison) return 'DECIDE';
  return sessionPairIssue(session, captures as PresentMonCaptureEntry[], []) === null ? 'COMPARE' : 'MEASURE_CANDIDATE';
}

// --- Vendor guidance -----------------------------------------------------------------

export function vendorFor(gpuName: string | null, vendor: string | null = null): GpuVendor {
  const text = `${gpuName ?? ''} ${vendor ?? ''}`.toLowerCase();
  if (/nvidia|geforce|quadro|rtx/.test(text)) return 'NVIDIA';
  if (/amd|radeon|advanced micro devices/.test(text)) return 'AMD';
  if (/intel|arc\b|iris|uhd graphics/.test(text)) return 'INTEL';
  return 'UNKNOWN';
}

// --- Storage ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELDS = Object.keys(FIELD_LABELS) as Array<keyof BaselineSettings>;

function validTime(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
}

function text(value: unknown, limit: number): string | undefined {
  return typeof value === 'string' && value.length <= limit ? value : undefined;
}

function parseChange(raw: unknown): DeclaredChange | null | undefined {
  if (raw === null) return null;
  if (!raw || typeof raw !== 'object') return undefined;
  const change = raw as Record<string, unknown>;
  const field = FIELDS.find((name) => name === change.field);
  const fromText = text(change.fromText, 80);
  const toText = text(change.toText, 80);
  const notes = text(change.notes, 160);
  if (!field || fromText === undefined || toText === undefined || !toText.trim() || notes === undefined || !validTime(change.declaredAt)) return undefined;
  return { field, fromText, toText, notes, declaredAt: change.declaredAt };
}

function parseExperiment(raw: unknown): DisplayExperiment | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const item = raw as Record<string, unknown>;
  if (item.schemaVersion !== 1 || typeof item.id !== 'string' || !UUID.test(item.id)) return undefined;
  if (typeof item.baselineId !== 'string' || !UUID.test(item.baselineId)) return undefined;
  if (typeof item.sessionId !== 'string' || !/^session-[a-z0-9-]+$/.test(item.sessionId) || item.sessionId.length > 80) return undefined;
  if (!validTime(item.createdAt)) return undefined;
  const change = parseChange(item.change);
  if (change === undefined) return undefined;
  const restore = item.restoreDeclaredAt === null ? null : validTime(item.restoreDeclaredAt) ? item.restoreDeclaredAt : undefined;
  if (restore === undefined) return undefined;
  if (change && Date.parse(change.declaredAt) < Date.parse(item.createdAt)) return undefined;
  if (item.warmup !== undefined && typeof item.warmup !== 'boolean') return undefined;
  const revert = item.revertDeclaredAt === undefined || item.revertDeclaredAt === null ? null : validTime(item.revertDeclaredAt) ? item.revertDeclaredAt : undefined;
  if (revert === undefined || (revert && (!change || Date.parse(revert) <= Date.parse(change.declaredAt)))) return undefined;
  return {
    schemaVersion: 1, id: item.id, baselineId: item.baselineId, sessionId: item.sessionId, createdAt: item.createdAt, change, restoreDeclaredAt: restore,
    ...(item.warmup !== undefined ? { warmup: item.warmup } : {}),
    ...(revert ? { revertDeclaredAt: revert } : {}),
  };
}

export function parseExperiments(raw: string | null): DisplayExperiment[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX_STORED_EXPERIMENTS).map(parseExperiment).filter((item): item is DisplayExperiment => item !== undefined);
  } catch {
    return [];
  }
}

export function saveExperiments(storage: Pick<Storage, 'setItem'>, experiments: DisplayExperiment[]): boolean {
  try {
    storage.setItem(DISPLAY_EXPERIMENTS_KEY, JSON.stringify(experiments.slice(0, MAX_STORED_EXPERIMENTS)));
    return true;
  } catch {
    return false;
  }
}

/** The experiment in progress for a baseline — the newest one linked to it. */
export function experimentFor(experiments: DisplayExperiment[], baselineId: string): DisplayExperiment | null {
  return experiments
    .filter((experiment) => experiment.baselineId === baselineId)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0] ?? null;
}

export function upsertExperiment(experiments: DisplayExperiment[], next: DisplayExperiment): DisplayExperiment[] {
  return [next, ...experiments.filter((experiment) => experiment.id !== next.id)].slice(0, MAX_STORED_EXPERIMENTS);
}
