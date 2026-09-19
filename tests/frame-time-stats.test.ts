import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFrameTimeStats, downsampleFrameTimes } from '../src/lib/frameTimeStats';
import { plainLabel } from '../src/lib/plainLabels';

test('frame-time stats report percentiles, lows and stutters from millisecond samples', () => {
  const samples = [...Array.from({ length: 990 }, () => 10), ...Array.from({ length: 10 }, () => 40)];
  const stats = computeFrameTimeStats(samples, 'ms');
  assert.ok(stats);
  assert.equal(stats.count, 1000);
  assert.equal(stats.p50Ms, 10);
  assert.equal(stats.p99Ms, 10);
  assert.equal(stats.p999Ms, 40);
  assert.equal(stats.onePercentLowFps, 25);
  assert.equal(stats.stutterCount, 10);
  assert.ok(Math.abs(stats.averageFps - 1000 / 10.3) < 1e-9);
});

test('frame-time stats refuse non-frame units and too few samples instead of inventing lows', () => {
  assert.equal(computeFrameTimeStats([10, 11, 12], 'ms'), null);
  assert.equal(computeFrameTimeStats(Array.from({ length: 100 }, () => 60), 'fps'), null);
});

test('downsampling keeps the slowest frame of each bucket', () => {
  const samples = Array.from({ length: 1000 }, (_, index) => (index === 537 ? 99 : 8));
  const points = downsampleFrameTimes(samples, 100);
  assert.equal(points.length, 100);
  assert.ok(points.includes(99));
});

test('plain labels translate internal codes and never show raw snake case', () => {
  assert.equal(plainLabel('NEEDS_REVIEW'), 'Needs review');
  assert.equal(plainLabel('MEASURED_DIFFERENCE'), 'It helped');
  assert.equal(plainLabel('SOME_NEW_CODE'), 'Some new code');
  assert.equal(plainLabel(null), 'Unknown');
});
