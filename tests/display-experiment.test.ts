import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  blockingContextChanges,
  describeDeclaredChange,
  evidenceStrength,
  experimentFor,
  experimentStage,
  isUsableCapture,
  linkRuns,
  newExperimentSession,
  parseExperiments,
  partitionRuns,
  saveExperiments,
  selectRuns,
  sessionLimitReached,
  upsertExperiment,
  vendorFor,
  DISPLAY_EXPERIMENTS_KEY,
  type DisplayExperiment,
} from '../src/lib/displayExperiment';
import { emptySettings, type DisplayBaseline } from '../src/lib/displayBaseline';
import { parseSessions, sessionPairIssue, type ExperimentSession } from '../src/lib/experimentSessions';
import type { PresentMonCaptureEntry } from '../src/types';

const BASELINE_ID = '11111111-1111-4111-8111-111111111111';
const EXPERIMENT_ID = '22222222-2222-4222-8222-222222222222';
const OPENED = '2026-09-17T10:00:00.000Z';
const CHANGED = '2026-09-17T11:00:00.000Z';

function minute(offset: number): string {
  return new Date(Date.parse(OPENED) + offset * 60_000).toISOString();
}

function capture(id: string, startMinute: number, overrides: Partial<PresentMonCaptureEntry> = {}): PresentMonCaptureEntry {
  return {
    captureId: id,
    status: 'COMPLETE',
    stopReason: 'TIMED',
    protocolComplete: true,
    durationSeconds: 20,
    startedAt: minute(startMinute),
    completedAt: new Date(Date.parse(minute(startMinute)) + 20_000).toISOString(),
    target: { targetId: 't', pid: 100, name: 'FortniteClient-Win64-Shipping.exe', windowTitle: 'Fortnite', startedAt: OPENED },
    tool: { version: '2.5.1', sha256: '', signerSubject: '', timestampSubject: '', sourceUrl: '', license: '' },
    output: null,
    applications: [],
    error: null,
    ...overrides,
  };
}

const baseline: DisplayBaseline = {
  schemaVersion: 1,
  id: BASELINE_ID,
  savedAt: OPENED,
  context: {
    gameKey: 'guide:fortnite-pc-performance-review', gameName: 'Fortnite', guideId: 'fortnite-pc-performance-review',
    monitorKey: 'aaaaaaaaaaaaaaaa', monitorLabel: 'LG ULTRAGEAR', gpuName: 'NVIDIA GeForce RTX 4080', driverVersion: '31.0.15.6109',
  },
  settings: emptySettings(144),
};

function experiment(overrides: Partial<DisplayExperiment> = {}): DisplayExperiment {
  return { schemaVersion: 1, id: EXPERIMENT_ID, baselineId: BASELINE_ID, sessionId: `session-${EXPERIMENT_ID}`, createdAt: OPENED, change: null, restoreDeclaredAt: null, ...overrides };
}

const declared = { field: 'frameCap' as const, fromText: '141 FPS', toText: 'No cap', notes: '', declaredAt: CHANGED };

test('a new session is manual-mode, empty, and valid for the existing session store', () => {
  const session = newExperimentSession(baseline, EXPERIMENT_ID, OPENED);
  assert.equal(session.changeMode, 'MANUAL');
  assert.equal(session.auditId, '', 'a manual change can never claim a Dialed action');
  assert.equal(session.workload, 'Fortnite on LG ULTRAGEAR');
  // The existing parser is the gate for everything in the store; the new session must pass it.
  assert.doesNotThrow(() => parseSessions(JSON.stringify([session])));
});

test('an undeclared change can never reach a comparison', () => {
  // The change description stays empty until the change is declared, and the existing
  // rules refuse a manual session without one.
  const session = { ...newExperimentSession(baseline, EXPERIMENT_ID, OPENED), baselineIds: ['a'], baselineId: 'a', candidateIds: ['b'], candidateId: 'b' };
  const issue = sessionPairIssue(session, [capture('a', 5), capture('b', 70)], []);
  assert.match(String(issue), /Describe the manual change|Declare when the manual change/);
});

test('runs are filed before or after purely by time relative to the declared change', () => {
  const runs = [
    capture('before-1', 5),
    capture('before-2', 10),
    capture('straddles', 59.9),
    capture('after-1', 65),
    capture('failed', 70, { status: 'FAILED', stopReason: 'PROCESS_ERROR', completedAt: null }),
    capture('unverified', 72, { protocolComplete: false }),
    capture('too-early', -30),
  ];
  const partition = partitionRuns(runs, experiment({ change: declared }));
  assert.deepEqual(partition.baseline.map((run) => run.captureId), ['before-1', 'before-2']);
  assert.deepEqual(partition.candidate.map((run) => run.captureId), ['after-1']);
  const notCounted = Object.fromEntries(partition.notCounted.map((item) => [item.capture.captureId, item.reason]));
  assert.equal(notCounted.straddles, 'Ran while the change was being made');
  assert.equal(notCounted.failed, 'Did not complete');
  assert.equal(notCounted.unverified, 'Duration was not verified');
  assert.ok(!('too-early' in notCounted), 'runs from before the experiment are ignored, not listed');
});

test('before a change is declared, every usable run counts as baseline', () => {
  const partition = partitionRuns([capture('a', 5), capture('b', 90)], experiment());
  assert.deepEqual(partition.baseline.map((run) => run.captureId), ['a', 'b']);
  assert.equal(partition.candidate.length, 0);
});

test('a failed or cancelled capture never counts as evidence', () => {
  assert.equal(isUsableCapture(capture('ok', 0)), true);
  assert.equal(isUsableCapture(capture('user-stopped', 0, { stopReason: 'USER' })), false);
  assert.equal(isUsableCapture(capture('exited', 0, { stopReason: 'EARLY_EXIT' })), false);
  assert.equal(isUsableCapture(capture('review', 0, { status: 'NEEDS_REVIEW' })), false);
});

test('evidence strength follows the approved rule: one is descriptive, three is matched, two is neither', () => {
  assert.equal(evidenceStrength(0), 'NONE');
  assert.equal(evidenceStrength(1), 'DESCRIPTIVE');
  assert.equal(evidenceStrength(2), 'NEEDS_ONE_MORE');
  assert.equal(evidenceStrength(3), 'MATCHED');
  assert.equal(evidenceStrength(7), 'MATCHED');
});

test('run selection always produces a shape the existing comparison rules accept', () => {
  const runs = (prefix: string, count: number, start: number) => Array.from({ length: count }, (_, index) => capture(`${prefix}${index}`, start + index * 2));
  // Three or more per side: all are used.
  let selected = selectRuns({ baseline: runs('b', 3, 5), candidate: runs('c', 4, 65), notCounted: [] });
  assert.equal(selected.baselineIds.length, 3);
  assert.equal(selected.candidateIds.length, 4);
  // Two against one is trimmed to a one-and-one descriptive pair, using the runs nearest the change.
  selected = selectRuns({ baseline: runs('b', 2, 5), candidate: runs('c', 1, 65), notCounted: [] });
  assert.deepEqual(selected, { baselineIds: ['b1'], candidateIds: ['c0'] });
  // Never more than twenty in total.
  selected = selectRuns({ baseline: runs('b', 15, 0), candidate: runs('c', 15, 65), notCounted: [] });
  assert.ok(selected.baselineIds.length + selected.candidateIds.length <= 20);
});

test('a full declared sequence satisfies the existing pairing rules end to end', () => {
  const change = experiment({ change: declared });
  const runs = [capture('b1', 5), capture('b2', 10), capture('b3', 15), capture('c1', 65), capture('c2', 70), capture('c3', 75)];
  const session: ExperimentSession = {
    ...newExperimentSession(baseline, EXPERIMENT_ID, OPENED),
    changeDescription: describeDeclaredChange(declared),
    manualChangedAt: CHANGED,
  };
  const linked = linkRuns(session, partitionRuns(runs, change));
  assert.equal(sessionPairIssue(linked, runs, []), null);
  assert.equal(experimentStage({ experiment: change, session: linked, partition: partitionRuns(runs, change), captures: runs, hasComparison: false }), 'COMPARE');
});

test('a run of a different program or length is set aside, not allowed to block everything', () => {
  // One accidental run of the wrong game or length would otherwise sit in the set for
  // good and block the comparison with no way to remove it.
  const change = experiment({ change: declared });
  const other = { targetId: 't2', pid: 200, name: 'Other.exe', windowTitle: 'Other', startedAt: OPENED };
  const runs = [capture('b1', 5), capture('b-wrong-game', 8, { target: other }), capture('c-wrong-length', 64, { durationSeconds: 30 }), capture('c1', 65)];
  const partition = partitionRuns(runs, change);
  assert.deepEqual(partition.baseline.map((run) => run.captureId), ['b1']);
  assert.deepEqual(partition.candidate.map((run) => run.captureId), ['c1']);
  const setAside = partition.notCounted.filter((item) => /Different program or run length/.test(item.reason)).map((item) => item.capture.captureId).sort();
  assert.deepEqual(setAside, ['b-wrong-game', 'c-wrong-length']);

  const session: ExperimentSession = { ...newExperimentSession(baseline, EXPERIMENT_ID, OPENED), changeDescription: 'x', manualChangedAt: CHANGED };
  const linked = linkRuns(session, partition);
  assert.equal(sessionPairIssue(linked, runs, []), null, 'the remaining matched pair is comparable');
});

test('new evidence resets a decision made on older evidence', () => {
  const change = experiment({ change: declared });
  const session: ExperimentSession = { ...newExperimentSession(baseline, EXPERIMENT_ID, OPENED), decision: 'KEEP', baselineIds: ['b1'], baselineId: 'b1', candidateIds: ['c1'], candidateId: 'c1' };
  assert.equal(linkRuns(session, partitionRuns([capture('b1', 5), capture('c1', 65)], change)).decision, 'KEEP', 'unchanged runs keep the decision');
  assert.equal(linkRuns(session, partitionRuns([capture('b1', 5), capture('c2', 66)], change)).decision, 'UNDECIDED');
});

test('the stage follows the evidence, so a reload resumes at the right step', () => {
  const session = newExperimentSession(baseline, EXPERIMENT_ID, OPENED);
  const stage = (exp: DisplayExperiment, runs: PresentMonCaptureEntry[], overrides: Partial<ExperimentSession> = {}, hasComparison = false) =>
    experimentStage({ experiment: exp, session: { ...session, ...overrides }, partition: partitionRuns(runs, exp), captures: runs, hasComparison });

  assert.equal(experimentStage({ experiment: experiment(), session: null, partition: partitionRuns([], experiment()), captures: [], hasComparison: false }), 'MEASURE_BASELINE');
  assert.equal(stage(experiment(), []), 'MEASURE_BASELINE');
  assert.equal(stage(experiment(), [capture('b1', 5)]), 'DECLARE_CHANGE');
  assert.equal(stage(experiment({ change: declared }), [capture('b1', 5)]), 'MEASURE_CANDIDATE');
  assert.equal(stage(experiment({ change: declared }), [capture('b1', 5), capture('c1', 65)], {}, true), 'DECIDE');
  assert.equal(stage(experiment({ change: declared }), [capture('b1', 5)], { decision: 'INCONCLUSIVE' }), 'DONE');
});

test('a changed refresh rate is not held against an experiment that changed the refresh rate', () => {
  const changes = ['The monitor is now at 240 Hz; the baseline recorded 144 Hz.', 'The graphics driver changed from 1 to 2.'];
  assert.deepEqual(blockingContextChanges(changes, experiment({ change: { ...declared, field: 'refreshHz' } })), ['The graphics driver changed from 1 to 2.']);
  assert.deepEqual(blockingContextChanges(changes, experiment({ change: declared })), changes, 'any other change still counts');
  assert.deepEqual(blockingContextChanges(changes, null), changes);
});

test('the declared change reads as a plain sentence and fits the session field', () => {
  assert.equal(describeDeclaredChange(declared), 'Changed Frame cap from 141 FPS to No cap');
  assert.equal(describeDeclaredChange({ ...declared, notes: 'using in-game limiter' }), 'Changed Frame cap from 141 FPS to No cap — using in-game limiter');
  assert.ok(describeDeclaredChange({ ...declared, notes: 'x'.repeat(500) }).length <= 240);
});

test('graphics card vendor is recognised from the name or the reported vendor', () => {
  assert.equal(vendorFor('NVIDIA GeForce RTX 4080'), 'NVIDIA');
  assert.equal(vendorFor('AMD Radeon RX 7900 XTX'), 'AMD');
  assert.equal(vendorFor('Intel Arc A770'), 'INTEL');
  assert.equal(vendorFor('Some Card', 'Advanced Micro Devices, Inc.'), 'AMD');
  assert.equal(vendorFor(null), 'UNKNOWN');
});

test('the session store limit is respected rather than exceeded', () => {
  const sessions = Array.from({ length: 20 }, (_, index) => ({ ...newExperimentSession(baseline, `id-${index}`, OPENED) }));
  assert.equal(sessionLimitReached(sessions), true);
  assert.equal(sessionLimitReached(sessions.slice(1)), false);
});

test('stored experiments are validated, and the newest one for a baseline is found', () => {
  const older = experiment({ id: '33333333-3333-4333-8333-333333333333', createdAt: '2026-09-16T10:00:00.000Z' });
  const newer = experiment({ change: declared });
  const hostile = [
    { ...experiment(), id: 'not-a-uuid' },
    { ...experiment(), sessionId: 'javascript:alert(1)' },
    { ...experiment(), change: { ...declared, field: 'notAField' } },
    { ...experiment(), change: { ...declared, declaredAt: '2020-01-01T00:00:00.000Z' } },
  ];
  const stored: Record<string, string> = {};
  assert.equal(saveExperiments({ setItem: (key, value) => { stored[key] = value; } }, [older, newer, ...hostile] as DisplayExperiment[]), true);
  const parsed = parseExperiments(stored[DISPLAY_EXPERIMENTS_KEY]);
  assert.deepEqual(parsed.map((item) => item.id).sort(), [older.id, newer.id].sort());
  assert.equal(experimentFor(parsed, BASELINE_ID)?.id, newer.id);
  assert.equal(experimentFor(parsed, '99999999-9999-4999-8999-999999999999'), null);

  assert.equal(upsertExperiment([older], { ...older, restoreDeclaredAt: CHANGED }).length, 1);
  assert.equal(saveExperiments({ setItem: () => { throw new Error('quota'); } }, [newer]), false);
  assert.deepEqual(parseExperiments('garbage'), []);
});

test('with warm-up on, the first run on each side is set aside and the reason shown', () => {
  const runs = [capture('w1', 5), capture('b1', 10), capture('b2', 15), capture('w2', 65), capture('c1', 70)];
  const partition = partitionRuns(runs, experiment({ change: declared, warmup: true }));
  assert.deepEqual(partition.baseline.map((run) => run.captureId), ['b1', 'b2']);
  assert.deepEqual(partition.candidate.map((run) => run.captureId), ['c1']);
  assert.deepEqual(partition.warmups, { baseline: 'w1', candidate: 'w2' });
  assert.ok(partition.notCounted.every((item) => /Warm-up/.test(item.reason)));
  // Older experiments, saved before warm-ups existed, keep counting every run.
  assert.equal(partitionRuns(runs, experiment({ change: declared })).baseline.length, 3);
});

test('runs after the setting is put back are check runs, never after runs', () => {
  const reverted = new Date(Date.parse(CHANGED) + 30 * 60_000).toISOString();
  const runs = [capture('b1', 5), capture('c1', 65), capture('c2', 70), capture('x1', 89.9), capture('k1', 95), capture('k2', 100)];
  const partition = partitionRuns(runs, experiment({ change: declared, revertDeclaredAt: reverted }));
  assert.deepEqual(partition.candidate.map((run) => run.captureId), ['c1', 'c2']);
  assert.deepEqual(partition.check.map((run) => run.captureId), ['k1', 'k2']);
  assert.deepEqual(partition.notCounted.map((item) => [item.capture.captureId, item.reason]), [['x1', 'Ran while the setting was being put back']]);
});

test('saved warm-up and put-back fields are validated', () => {
  const later = new Date(Date.parse(CHANGED) + 60_000).toISOString();
  const good = experiment({ change: declared, warmup: true, revertDeclaredAt: later });
  assert.deepEqual(parseExperiments(JSON.stringify([good])), [good]);
  // A put-back time without a change, or before it, is refused.
  assert.equal(parseExperiments(JSON.stringify([experiment({ revertDeclaredAt: later })])).length, 0);
  assert.equal(parseExperiments(JSON.stringify([experiment({ change: declared, revertDeclaredAt: OPENED })])).length, 0);
  assert.equal(parseExperiments(JSON.stringify([{ ...experiment(), warmup: 'yes' }])).length, 0);
});
