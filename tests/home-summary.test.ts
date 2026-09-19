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
