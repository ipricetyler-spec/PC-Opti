import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activeTests, awaitingRestart, changeDescription, newChangeTest, parseChangeTests, sessionForChange, testStep, upsertChangeTest, withBootSeen, type ChangeTest,
} from '../src/lib/changeTest';
import { partitionRuns } from '../src/lib/displayExperiment';
import { parseSessions, sessionPairIssue } from '../src/lib/experimentSessions';

const ID = '11111111-2222-4333-8444-555555555555';
const T0 = '2026-09-18T20:00:00.000Z';
const at = (minutes: number) => new Date(Date.parse(T0) + minutes * 60_000).toISOString();

function capture(id: string, startMinute: number, extra: Record<string, unknown> = {}) {
  return {
  captureId: id, status: 'COMPLETE', stopReason: 'TIMED', protocolComplete: true,
  startedAt: at(startMinute), completedAt: at(startMinute + 0.5), durationSeconds: 30,
  target: { name: 'VALORANT-Win64-Shipping.exe' }, ...extra,
  } as never;
}

const tweak = { kind: 'TWEAK' as const, tweakId: 'dynamic-tick', title: 'Dynamic tick', restartRequired: true };
const manual = { kind: 'MANUAL' as const, title: 'Multithreaded rendering', fromText: 'On', toText: 'Off', displayBaselineId: null };

test('a new tweak test drives an AUDIT session; a manual one a MANUAL session', () => {
  const t = newChangeTest({ id: ID, createdAt: T0, game: 'VALORANT', source: tweak });
  assert.equal(t.session.changeMode, 'AUDIT');
  assert.equal(t.session.auditId, '');
  assert.equal(t.test.sessionId, `session-${ID}`);
  const m = newChangeTest({ id: ID, createdAt: T0, game: 'VALORANT', source: manual });
  assert.equal(m.session.changeMode, 'MANUAL');
  assert.equal(m.session.changeDescription, 'Multithreaded rendering (On → Off)');
  // Both sessions survive the stored-session validator.
  assert.equal(parseSessions(JSON.stringify([t.session])).length, 1);
  assert.equal(parseSessions(JSON.stringify([m.session])).length, 1);
});

test('steps follow before → change → after → result → done', () => {
  const { test: t, session } = newChangeTest({ id: ID, createdAt: T0, game: 'VALORANT', source: manual });
  assert.equal(testStep(t, session), 'BEFORE');
  const a = { ...t, beforeDoneAt: at(5) };
  assert.equal(testStep(a, session), 'CHANGE');
  const b = { ...a, change: { declaredAt: at(6), auditEntryId: null } };
  assert.equal(testStep(b, session), 'AFTER');
  const c = { ...b, afterDoneAt: at(12) };
  assert.equal(testStep(c, session), 'RESULT');
  assert.equal(testStep(c, { ...session, decision: 'KEEP' }), 'DONE');
});

test('the tweak change is linked by its journal entry, and sessionPairIssue accepts it only between the phases', () => {
  const { test: t, session } = newChangeTest({ id: ID, createdAt: T0, game: 'VALORANT', source: { ...tweak, restartRequired: false } });
  const changed = { ...t, beforeDoneAt: at(5), change: { declaredAt: at(6), auditEntryId: 'entry-1' } };
  const linked = sessionForChange(session, changed, at(6), 'entry-1');
  assert.equal(linked.auditId, 'entry-1');
  const runs = [capture('b1', 1), capture('b2', 2), capture('b3', 3), capture('a1', 7), capture('a2', 8), capture('a3', 9)];
  const withRuns = { ...linked, baselineIds: ['b1', 'b2', 'b3'], candidateIds: ['a1', 'a2', 'a3'], baselineId: 'b1', candidateId: 'a1' };
  assert.equal(sessionPairIssue(withRuns, runs, [{ id: 'entry-1', status: 'SUCCESS', timestamp: at(6) }]), null);
  assert.notEqual(sessionPairIssue(withRuns, runs, [{ id: 'entry-1', status: 'SUCCESS', timestamp: at(8) }]), null);
});

test('after a restart-required change, runs from before the restart are set aside', () => {
  const { test: t } = newChangeTest({ id: ID, createdAt: T0, game: 'VALORANT', source: tweak });
  const changed: ChangeTest = { ...t, beforeDoneAt: at(5), change: { declaredAt: at(6), auditEntryId: 'entry-1' } };
  const oldBoot = at(-600);
  assert.equal(awaitingRestart(changed, oldBoot), true);
  assert.equal(withBootSeen(changed, oldBoot), changed);
  const booted = withBootSeen(changed, at(10));
  assert.equal(booted.activeFrom, at(10));
  assert.equal(awaitingRestart(booted, at(10)), false);
  const runs = [capture('b1', 1), capture('b2', 2), capture('early', 7), capture('w', 11), capture('a1', 12)];
  const partition = partitionRuns(runs, booted);
  assert.deepEqual(partition.candidate.map((run) => run.captureId), ['a1']);
  assert.match(partition.notCounted.find((item) => item.capture.captureId === 'early')?.reason ?? '', /before the restart/);
});

test('a change without a restart files runs by time, with a warm-up on each side', () => {
  const { test: t } = newChangeTest({ id: ID, createdAt: T0, game: 'VALORANT', source: manual });
  const changed: ChangeTest = { ...t, beforeDoneAt: at(5), change: { declaredAt: at(6), auditEntryId: null } };
  const partition = partitionRuns([capture('w1', 1), capture('b1', 2), capture('w2', 7), capture('a1', 8)], changed);
  assert.deepEqual(partition.baseline.map((run) => run.captureId), ['b1']);
  assert.deepEqual(partition.candidate.map((run) => run.captureId), ['a1']);
  assert.deepEqual(partition.warmups, { baseline: 'w1', candidate: 'w2' });
});

test('stored tests are rebuilt field by field; out-of-order or forged records are dropped', () => {
  const { test: t } = newChangeTest({ id: ID, createdAt: T0, game: 'VALORANT', source: tweak });
  const good = { ...t, beforeDoneAt: at(5), change: { declaredAt: at(6), auditEntryId: 'entry-1' } };
  assert.equal(parseChangeTests(JSON.stringify([good])).length, 1);
  assert.equal(parseChangeTests(JSON.stringify([{ ...good, beforeDoneAt: null }])).length, 0);
  assert.equal(parseChangeTests(JSON.stringify([{ ...good, change: { declaredAt: at(6), auditEntryId: null } }])).length, 0);
  assert.equal(parseChangeTests(JSON.stringify([{ ...good, sessionId: 'session-other' }])).length, 0);
  assert.equal(parseChangeTests(JSON.stringify([{ ...good, source: { ...tweak, tweakId: '../x' } }])).length, 0);
  assert.equal(parseChangeTests(JSON.stringify([{ ...good, revertDeclaredAt: at(1) }])).length, 0);
  assert.deepEqual(parseChangeTests('not json'), []);
});

test('only undecided tests are in progress, and upsert keeps the newest first', () => {
  const one = newChangeTest({ id: ID, createdAt: T0, game: 'A', source: manual });
  const two = newChangeTest({ id: '99999999-2222-4333-8444-555555555555', createdAt: at(1), game: 'B', source: manual });
  const tests = upsertChangeTest(upsertChangeTest([], one.test), two.test);
  assert.equal(tests[0].id, two.test.id);
  assert.deepEqual(activeTests(tests, [one.session, { ...two.session, decision: 'KEEP' }]).map((item) => item.game), ['A']);
  assert.equal(changeDescription(tweak), 'Dialed tweak: Dynamic tick');
});

test('the recorder matches the game named in a test by program or window name', async () => {
  const { matchingTarget } = await import('../src/components/NativePresentMonCapture');
  const targets = [{ name: 'claude.exe', windowTitle: 'Claude' }, { name: 'VALORANT-Win64-Shipping.exe', windowTitle: 'VALORANT  ' }];
  assert.equal(matchingTarget(targets, 'Valorant')?.name, 'VALORANT-Win64-Shipping.exe');
  assert.equal(matchingTarget(targets, 'Counter-Strike 2'), null);
  assert.equal(matchingTarget(targets, 'x'), null);
});
