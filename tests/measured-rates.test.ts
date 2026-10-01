import { test, expect } from 'bun:test';
import { deviceRateLine, parseMeasuredRates } from '../src/lib/measuredRates';

const id = 'a'.repeat(64);
const now = new Date('2026-10-01T12:00:00Z');

test('a device row keeps saved and measured apart, and a measurement always has its date', () => {
  expect(deviceRateLine({ configuredHz: 4000 }, undefined, now)).toBe('Saved 4,000 Hz · Not checked yet');
  expect(deviceRateLine({ configuredHz: null }, undefined, now)).toBe('Saved: Windows default · Not checked yet');
  expect(deviceRateLine({ configuredHz: null, inactiveHz: 8000 }, undefined, now)).toBe('8,000 Hz set earlier, not in effect · Not checked yet');
  const today = deviceRateLine({ configuredHz: 8000 }, { reportsPerSecond: 8007, at: '2026-10-01T09:00:00Z' }, now);
  expect(today).toBe('Saved 8,000 Hz · Measured about 8,007 reports/s today');
  const older = deviceRateLine({ configuredHz: 1000 }, { reportsPerSecond: 998, at: '2026-09-20T09:00:00Z' }, now);
  expect(older).toContain('Measured about 998 reports/s');
  expect(older).not.toContain('today');
  // Never a performance word or a score.
  for (const line of [today, older]) expect(line).not.toMatch(/latency|optimi[sz]ed|maxed|boost/i);
});

test('stored measurements are validated and malformed entries ignored', () => {
  expect(parseMeasuredRates(null)).toEqual({});
  expect(parseMeasuredRates('not json')).toEqual({});
  expect(parseMeasuredRates('[1,2]')).toEqual({});
  const parsed = parseMeasuredRates(JSON.stringify({ [id]: { reportsPerSecond: 1000.4, at: '2026-10-01T00:00:00Z' }, bad: { reportsPerSecond: 5, at: 'x' }, ['b'.repeat(64)]: { reportsPerSecond: -1, at: '2026-10-01T00:00:00Z' } }));
  expect(Object.keys(parsed)).toEqual([id]);
  expect(parsed[id].reportsPerSecond).toBe(1000);
});
