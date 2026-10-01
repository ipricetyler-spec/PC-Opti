import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { computeFrameTimeStats } from '../src/lib/frameTimeStats';
import { comparableLowFps, effectVsNoise } from '../src/lib/experimentRigor';

const require = createRequire(import.meta.url);
const { summarizeFrames } = require('../src/main/presentmon/frame-summary.cjs');

test('the run summary and the detailed statistics mean the same thing by "1% low"', () => {
  // Codex's reproduction: 990 frames at 5 ms and 10 at 500 ms read 200 FPS in one view and 2 in the other.
  const frames = [...Array(990).fill(5), ...Array(10).fill(500)];
  const summary = summarizeFrames('game.exe', frames);
  const detail = computeFrameTimeStats(frames)!;
  assert.equal(summary.lowMethod, 'slowest-1-percent-mean');
  assert.equal(Math.round(summary.onePercentLowFps), Math.round(detail.onePercentLowFps));
  assert.equal(Math.round(summary.onePercentLowFps), 2);
});

test('a long pause stays in the detailed statistics instead of disappearing', () => {
  const frames = [...Array(30).fill(5), 10_000];
  const detail = computeFrameTimeStats(frames)!;
  assert.equal(detail.count, 31);
  assert.ok(detail.averageFps < 4, 'a ten-second freeze must pull the average down');
});

test('1% lows from summaries saved under the old definition are never compared', () => {
  assert.equal(comparableLowFps({ onePercentLowFps: 90 }), null);
  assert.equal(comparableLowFps({ onePercentLowFps: 90, lowMethod: 'slowest-1-percent-mean' }), 90);
  const run = (fps: number, lowMethod?: 'slowest-1-percent-mean') => ({ captureId: `${fps}-${Math.random()}`, status: 'COMPLETE', protocolComplete: true, frameSummary: { application: 'g', frames: 3000, averageFps: fps, onePercentLowFps: fps * 0.7, medianFrameMs: 1000 / fps, p99FrameMs: 1000 / (fps * 0.7), spreadPercent: 5, capLikely: false, capFps: null, ...(lowMethod ? { lowMethod } : {}) } });
  const mixed = effectVsNoise([run(100), run(101), run(100)] as never, [run(110, 'slowest-1-percent-mean'), run(111, 'slowest-1-percent-mean'), run(110, 'slowest-1-percent-mean')] as never);
  assert.equal(mixed.onePercentLowChangePercent, null);
  assert.match(mixed.text, /1% lows are not compared/);
});
