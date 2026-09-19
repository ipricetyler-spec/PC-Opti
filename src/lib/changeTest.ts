/**
 * "Test a change": one guided before/after test, started from a tweak card, from Display
 * setup, or on its own.
 *
 * Like display experiments, this is a thin layer over the existing evidence: runs are
 * ordinary PresentMon captures filed by time (`partitionRuns`), the decision lives on an
 * ordinary experiment session, and the matching rules are `sessionPairIssue`'s. What it
 * adds is who makes the change:
 *
 *   - TWEAK: Dialed applies one of its own reversible settings through the normal
 *     journaled action, so the session is in AUDIT mode and points at that journal entry.
 *     Undo is the journal's own restore.
 *   - MANUAL: the person changes something in a game or driver and says when; the session
 *     is in MANUAL mode, exactly as display experiments are.
 *
 * Pure and storage-agnostic so it can be tested without a browser.
 */
import type { ExperimentSession } from './experimentSessions';
import type { RunWindow } from './displayExperiment';

export const CHANGE_TESTS_KEY = 'dialed-change-tests:v1';
export const MAX_STORED_TESTS = 50;

export type ChangeTestSource =
  | { kind: 'TWEAK'; tweakId: string; title: string; restartRequired: boolean }
  | { kind: 'MANUAL'; title: string; fromText: string; toText: string; displayBaselineId: string | null };

export interface ChangeTest extends RunWindow {
  schemaVersion: 1;
  id: string;
  sessionId: string;
  createdAt: string;
  game: string;
  source: ChangeTestSource;
  /** When the person finished the before runs and moved on to the change. */
  beforeDoneAt: string | null;
  change: { declaredAt: string; auditEntryId: string | null } | null;
  /** For a restart-required tweak: the first boot after the change. Set once seen. */
  activeFrom: string | null;
  afterDoneAt: string | null;
  /** Put back to re-check (optional). For a tweak this is Dialed's own undo. */
  revertDeclaredAt: string | null;
  revertAuditEntryId: string | null;
  warmup: true;
}

export type ChangeTestStep = 'BEFORE' | 'CHANGE' | 'AFTER' | 'RESULT' | 'DONE';
export const STEP_ORDER: ChangeTestStep[] = ['BEFORE', 'CHANGE', 'AFTER', 'RESULT', 'DONE'];
export const STEP_LABELS: Record<ChangeTestStep, string> = {
  BEFORE: 'Measure before', CHANGE: 'Make the change', AFTER: 'Measure after', RESULT: 'Result', DONE: 'Done',
};

export function changeDescription(source: ChangeTestSource): string {
  if (source.kind === 'TWEAK') return `Dialed tweak: ${source.title}`.slice(0, 240);
  const detail = source.fromText.trim() || source.toText.trim() ? ` (${source.fromText.trim() || '?'} → ${source.toText.trim() || '?'})` : '';
  return `${source.title.trim()}${detail}`.slice(0, 240);
}

export function newChangeTest(input: { id: string; createdAt: string; game: string; source: ChangeTestSource }): { test: ChangeTest; session: ExperimentSession } {
  const sessionId = `session-${input.id}`;
  const test: ChangeTest = {
    schemaVersion: 1, id: input.id, sessionId, createdAt: input.createdAt, game: input.game.trim().slice(0, 80), source: input.source,
    beforeDoneAt: null, change: null, activeFrom: null, afterDoneAt: null, revertDeclaredAt: null, revertAuditEntryId: null, warmup: true,
  };
  const session: ExperimentSession = {
    id: sessionId,
    workload: (test.game || 'Game').slice(0, 160),
    // A manual change is described up front; `sessionPairIssue` still refuses to compare
    // until the time of the change is recorded.
    changeDescription: changeDescription(input.source),
    createdAt: input.createdAt,
    baselineId: '', candidateId: '', auditId: '',
    decision: 'UNDECIDED',
    changeMode: input.source.kind === 'TWEAK' ? 'AUDIT' : 'MANUAL',
    ...(input.source.kind === 'MANUAL' ? { manualChangedAt: '' } : {}),
    baselineIds: [], candidateIds: [],
  };
  return { test, session };
}

/** The session fields that record the change once it is made. */
export function sessionForChange(session: ExperimentSession, test: ChangeTest, declaredAt: string, auditEntryId: string | null): ExperimentSession {
  return test.source.kind === 'TWEAK'
    ? { ...session, auditId: auditEntryId ?? '', decision: 'UNDECIDED' }
    : { ...session, manualChangedAt: declaredAt, decision: 'UNDECIDED' };
}

export function testStep(test: ChangeTest, session: ExperimentSession | null): ChangeTestStep {
  if (session && session.decision !== 'UNDECIDED') return 'DONE';
  if (!test.beforeDoneAt) return 'BEFORE';
  if (!test.change) return 'CHANGE';
  if (!test.afterDoneAt) return 'AFTER';
  return 'RESULT';
}

/** A test is waiting on a restart when its tweak needs one and this boot started before
 *  the change was made. */
export function awaitingRestart(test: ChangeTest, bootTime: string | null): boolean {
  if (test.source.kind !== 'TWEAK' || !test.source.restartRequired || !test.change || !bootTime) return false;
  return Date.parse(bootTime) < Date.parse(test.change.declaredAt);
}

/** Records the first boot after a restart-required change, so runs from before it are
 *  set aside. Returns the same object when nothing changes. */
export function withBootSeen(test: ChangeTest, bootTime: string | null): ChangeTest {
  if (test.source.kind !== 'TWEAK' || !test.source.restartRequired || !test.change || test.activeFrom || !bootTime) return test;
  if (Date.parse(bootTime) <= Date.parse(test.change.declaredAt)) return test;
  return { ...test, activeFrom: bootTime };
}

export function activeTests(tests: ChangeTest[], sessions: ExperimentSession[]): ChangeTest[] {
  return tests.filter((test) => {
    const session = sessions.find((item) => item.id === test.sessionId);
    return session ? session.decision === 'UNDECIDED' : false;
  });
}

// --- Storage ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TWEAK_ID = /^[a-z0-9-]{1,60}$/;

function time(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)) ? value : undefined;
}

function text(value: unknown, limit: number): string | undefined {
  return typeof value === 'string' && value.length <= limit ? value : undefined;
}

function parseSource(raw: unknown): ChangeTestSource | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const item = raw as Record<string, unknown>;
  const title = text(item.title, 120);
  if (!title || !title.trim()) return undefined;
  if (item.kind === 'TWEAK') {
    if (typeof item.tweakId !== 'string' || !TWEAK_ID.test(item.tweakId) || typeof item.restartRequired !== 'boolean') return undefined;
    return { kind: 'TWEAK', tweakId: item.tweakId, title, restartRequired: item.restartRequired };
  }
  if (item.kind === 'MANUAL') {
    const fromText = text(item.fromText, 80);
    const toText = text(item.toText, 80);
    const baseline = item.displayBaselineId === null || item.displayBaselineId === undefined ? null
      : typeof item.displayBaselineId === 'string' && UUID.test(item.displayBaselineId) ? item.displayBaselineId : undefined;
    if (fromText === undefined || toText === undefined || baseline === undefined) return undefined;
    return { kind: 'MANUAL', title, fromText, toText, displayBaselineId: baseline };
  }
  return undefined;
}

function parseTest(raw: unknown): ChangeTest | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const item = raw as Record<string, unknown>;
  if (item.schemaVersion !== 1 || typeof item.id !== 'string' || !UUID.test(item.id) || item.sessionId !== `session-${item.id}`) return undefined;
  const createdAt = time(item.createdAt);
  const game = text(item.game, 80);
  const source = parseSource(item.source);
  if (!createdAt || game === undefined || !source) return undefined;
  const beforeDoneAt = time(item.beforeDoneAt);
  const activeFrom = time(item.activeFrom);
  const afterDoneAt = time(item.afterDoneAt);
  const revertDeclaredAt = time(item.revertDeclaredAt);
  if (beforeDoneAt === undefined || activeFrom === undefined || afterDoneAt === undefined || revertDeclaredAt === undefined) return undefined;
  let change: ChangeTest['change'] = null;
  if (item.change !== null && item.change !== undefined) {
    const raw = item.change as Record<string, unknown>;
    const declaredAt = time(raw?.declaredAt);
    const audit = raw?.auditEntryId === null ? null : text(raw?.auditEntryId, 80);
    if (!declaredAt || audit === undefined || Date.parse(declaredAt) < Date.parse(createdAt)) return undefined;
    if (source.kind === 'TWEAK' ? !audit : audit !== null) return undefined;
    change = { declaredAt, auditEntryId: audit };
  }
  // Each step follows the one before it.
  if (change && !beforeDoneAt) return undefined;
  if ((afterDoneAt || activeFrom) && !change) return undefined;
  if (revertDeclaredAt && (!change || Date.parse(revertDeclaredAt) <= Date.parse(change.declaredAt))) return undefined;
  const revertAudit = item.revertAuditEntryId === null || item.revertAuditEntryId === undefined ? null : text(item.revertAuditEntryId, 80);
  if (revertAudit === undefined) return undefined;
  return {
    schemaVersion: 1, id: item.id, sessionId: item.sessionId as string, createdAt, game, source,
    beforeDoneAt, change, activeFrom, afterDoneAt, revertDeclaredAt, revertAuditEntryId: revertAudit, warmup: true,
  };
}

export function parseChangeTests(raw: string | null): ChangeTest[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX_STORED_TESTS).map(parseTest).filter((item): item is ChangeTest => item !== undefined);
  } catch {
    return [];
  }
}

export function saveChangeTests(storage: Pick<Storage, 'setItem'>, tests: ChangeTest[]): boolean {
  try {
    storage.setItem(CHANGE_TESTS_KEY, JSON.stringify(tests.slice(0, MAX_STORED_TESTS)));
    return true;
  } catch {
    return false;
  }
}

export function upsertChangeTest(tests: ChangeTest[], next: ChangeTest): ChangeTest[] {
  return [next, ...tests.filter((test) => test.id !== next.id)].slice(0, MAX_STORED_TESTS);
}
