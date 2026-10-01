import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deviceRateLine, parseMeasuredRates } from '../src/lib/measuredRates';

const id = 'a'.repeat(64);
const now = new Date('2026-10-01T12:00:00Z');

test('a device row keeps saved and measured apart, and a measurement always has its date', () => {
  assert.equal(deviceRateLine({ configuredHz: 4000 }, undefined, now), 'Saved 4,000 Hz · Not checked yet');
  assert.equal(deviceRateLine({ configuredHz: null }, undefined, now), 'Saved: Windows default · Not checked yet');
  assert.equal(deviceRateLine({ configuredHz: null, inactiveHz: 8000 }, undefined, now), '8,000 Hz set earlier, not in effect · Not checked yet');
  const today = deviceRateLine({ configuredHz: 8000 }, { reportsPerSecond: 8007, at: '2026-10-01T09:00:00Z' }, now);
  assert.equal(today, 'Saved 8,000 Hz · Measured about 8,007 reports/s today');
  const older = deviceRateLine({ configuredHz: 1000 }, { reportsPerSecond: 998, at: '2026-09-20T09:00:00Z' }, now);
  assert.ok(older.includes('Measured about 998 reports/s'));
  assert.ok(!older.includes('today'));
  // Never a performance word or a score.
  for (const line of [today, older]) assert.doesNotMatch(line, /latency|optimi[sz]ed|maxed|boost/i);
});

test('stored measurements are validated and malformed entries ignored', () => {
  assert.deepEqual(parseMeasuredRates(null), {});
  assert.deepEqual(parseMeasuredRates('not json'), {});
  assert.deepEqual(parseMeasuredRates('[1,2]'), {});
  const parsed = parseMeasuredRates(JSON.stringify({ [id]: { reportsPerSecond: 1000.4, at: '2026-10-01T00:00:00Z' }, bad: { reportsPerSecond: 5, at: 'x' }, ['b'.repeat(64)]: { reportsPerSecond: -1, at: '2026-10-01T00:00:00Z' } }));
  assert.deepEqual(Object.keys(parsed), [id]);
  assert.equal(parsed[id].reportsPerSecond, 1000);
});
