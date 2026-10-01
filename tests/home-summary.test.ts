import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homeItems } from '../src/components/HomeSummary';

const snapshot = { timestamp: '2026-09-19T12:00:00.000Z' } as never;
const empty = { records: [], comparisons: [] } as never;
const rec = (id: string, actionStatus: string) => ({ id, title: `T ${id}`, observation: `O ${id}`, actionStatus, targetPanel: { id: 'startup', label: `Open ${id}`, sectionId: null } }) as never;
const entry = (status: string) => ({ id: `e-${status}`, status, rollback: { available: false } }) as never;

test('an unfinished change comes first and is marked urgent', () => {
  const items = homeItems({ snapshot, history: [entry('SUCCESS'), entry('NEEDS_REVIEW')], historyRecovery: null, recommendations: [rec('a', 'OPTIONAL_ACTION')], benchmarkEvidence: empty });
  assert.equal(items[0].key, 'unfinished');
  assert.equal(items[0].urgent, true);
  assert.equal(items[0].target.evidenceId, 'e-NEEDS_REVIEW');
});

test('a failed action says it failed, names itself, and is not called unfinished', () => {
  const now = Date.parse('2026-09-30T12:00:00Z');
  const retrim = (drive: string, when = '2026-09-29T12:00:00Z') => ({ id: `r-${drive}`, actionId: `retrim-drive:${drive}`, timestamp: when, status: 'FAILED', title: `ReTRIM ${drive}:`, rollback: { available: false } }) as never;
  const items = homeItems({ now, snapshot, history: [retrim('C'), retrim('D'), retrim('E')], historyRecovery: null, recommendations: [], benchmarkEvidence: empty });
  assert.deepEqual(items.map((item) => item.key), ['failed']);
  assert.equal(items[0].title, '3 actions failed');
  assert.match(items[0].detail, /^Windows reported an error for ReTRIM C:, ReTRIM D: and ReTRIM E:, so they did not complete as planned\./);
  assert.doesNotMatch(`${items[0].title} ${items[0].detail}`, /did not finish/);
  assert.notEqual(items[0].urgent, true);
  assert.equal(items[0].target.evidenceId, 'r-C');
  const both = homeItems({ now, snapshot, history: [retrim('C'), entry('PENDING')], historyRecovery: null, recommendations: [], benchmarkEvidence: empty });
  assert.deepEqual(both.map((item) => [item.key, item.title]), [['unfinished', 'A change did not finish'], ['failed', 'An action failed']]);
  // Older than a week, or followed by a success of the same action: left to Restore › History.
  assert.deepEqual(homeItems({ now, snapshot, history: [retrim('C', '2026-09-06T17:25:25Z')], historyRecovery: null, recommendations: [], benchmarkEvidence: empty }), []);
  const retried = { id: 'ok', actionId: 'retrim-drive:C', timestamp: '2026-09-29T13:00:00Z', status: 'SUCCESS', title: 'ReTRIM C:', rollback: { available: false } } as never;
  assert.deepEqual(homeItems({ now, snapshot, history: [retrim('C'), retried], historyRecovery: null, recommendations: [], benchmarkEvidence: empty }), []);
  // A failed row is not a suggestion, so it cannot hide the "See all" link.
  const withTips = homeItems({ now, snapshot, history: [retrim('C')], historyRecovery: null, recommendations: ['a', 'b', 'c'].map((id) => rec(id, 'OPTIONAL_ACTION')), benchmarkEvidence: empty });
  assert.deepEqual(withTips.map((item) => item.key), ['failed', 'a', 'b']);
});

test('suggestions that need a decision come before optional fixes and tips; no-action items are left out', () => {
  const items = homeItems({ snapshot, history: [], historyRecovery: null, recommendations: [rec('tip', 'GUIDANCE_ONLY'), rec('none', 'NO_ACTION'), rec('fix', 'OPTIONAL_ACTION'), rec('decide', 'REVIEW')], benchmarkEvidence: empty });
  assert.deepEqual(items.map((item) => item.key), ['decide', 'fix', 'tip']);
});

test('at most three items; no scan asks for one first; a regression is surfaced', () => {
  const recs = ['a', 'b', 'c', 'd'].map((id) => rec(id, 'OPTIONAL_ACTION'));
  assert.equal(homeItems({ snapshot, history: [], historyRecovery: null, recommendations: recs, benchmarkEvidence: empty }).length, 3);
  const noScan = homeItems({ snapshot: null, history: [], historyRecovery: null, recommendations: recs, benchmarkEvidence: empty });
  assert.equal(noScan[0].key, 'scan');
  const worse = homeItems({ snapshot, history: [], historyRecovery: null, recommendations: [], benchmarkEvidence: { records: [], comparisons: [{ experimentId: 'x', classification: 'REGRESSION' }] } as never });
  assert.equal(worse[0].key, 'regression');
  assert.equal(worse[0].target.id, 'benchmarks');
});

test('nothing to do means an empty list', () => {
  assert.deepEqual(homeItems({ snapshot, history: [entry('SUCCESS')], historyRecovery: null, recommendations: [], benchmarkEvidence: empty }), []);
});
