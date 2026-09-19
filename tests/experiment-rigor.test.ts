import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abaCheck, capWarning, conditionFlags, effectVsNoise, noiseFloor, runProgress } from '../src/lib/experimentRigor';
import type { FrameSummary, PresentMonCaptureEntry, TelemetryStat } from '../src/types';

type Run = Pick<PresentMonCaptureEntry, 'captureId' | 'frameSummary' | 'telemetry'>;

function summary(averageFps: number, overrides: Partial<FrameSummary> = {}): FrameSummary {
  return { application: 'game.exe', frames: 3000, averageFps, onePercentLowFps: averageFps * 0.7, medianFrameMs: 1000 / averageFps, p99FrameMs: 1000 / (averageFps * 0.7), spreadPercent: 20, capLikely: false, capFps: null, ...overrides };
}

function stat(mean: number): TelemetryStat {
  return { count: 20, min: mean, mean, p95: mean, max: mean, stale: 0, unavailable: 0, warmup: 0, coveragePercent: 100 };
}

function run(id: string, fps: number, metrics: Record<string, number> = {}, overrides: Partial<FrameSummary> = {}): Run {
  return {
    captureId: id,
    frameSummary: summary(fps, overrides),
    telemetry: Object.keys(metrics).length ? {
      requested: true, status: 'RECORDED', error: null,
      view: { status: 'RECORDED', stopReason: 'COMPLETE', errors: [], targetTracked: true, targetChanged: false, adapters: [], summary: { samples: 20, performanceLimitedShare: null, metrics: Object.fromEntries(Object.entries(metrics).map(([key, value]) => [key, stat(value)])) } },
    } : null,
  };
}

test('the run counter includes the warm-up and says when a side is done', () => {
  assert.match(runProgress('before', 0, false, true).label, /before run 1 of 4\. This first one is a warm-up/);
  assert.equal(runProgress('before', 2, true, true).label, 'Next: before run 4 of 4.');
  assert.equal(runProgress('after', 3, true, true).complete, true);
  assert.equal(runProgress('after', 0, false, false).target, 3);
});

test('the noise floor is the range of average FPS across unchanged runs', () => {
  assert.deepEqual(noiseFloor([run('a', 198), run('b', 200), run('c', 202)]), { runs: 3, averageFps: 200, rangePercent: 2 });
  assert.equal(noiseFloor([run('a', 200)]), null);
});

test('a change is only called a difference when it beats normal variation', () => {
  const before = [run('a', 198), run('b', 200), run('c', 202)];
  const beyond = effectVsNoise(before, [run('d', 219), run('e', 220), run('f', 221)]);
  assert.equal(beyond.verdict, 'BEYOND_NOISE');
  assert.equal(beyond.averageFpsChangePercent, 10);
  const within = effectVsNoise(before, [run('d', 200), run('e', 202), run('f', 203)]);
  assert.equal(within.verdict, 'WITHIN_NOISE');
  assert.match(within.text, /no measurable difference/);
  assert.equal(effectVsNoise(before, [run('d', 250)]).verdict, 'NOT_ENOUGH_RUNS');
  // Runs saved before summaries existed do not count toward the check.
  assert.equal(effectVsNoise(before, [{ captureId: 'x', frameSummary: null, telemetry: null }, run('e', 220), run('f', 221)]).verdict, 'NOT_ENOUGH_RUNS');
});

test('undo-and-remeasure confirms only when results return to the baseline', () => {
  const before = [run('a', 198), run('b', 200), run('c', 202)];
  assert.equal(abaCheck(before, [run('k1', 201), run('k2', 199)]).verdict, 'CONFIRMED');
  const drifted = abaCheck(before, [run('k1', 219), run('k2', 221)]);
  assert.equal(drifted.verdict, 'DID_NOT_RETURN');
  assert.match(drifted.text, /do not rely on this result/);
  assert.equal(abaCheck(before, [run('k1', 200)]).verdict, 'NOT_ENOUGH_RUNS');
});

test('a frame cap is reported when most runs sit at one rate', () => {
  const capped = { capLikely: true, capFps: 141 };
  const warning = capWarning([run('a', 141, {}, capped), run('b', 141, {}, capped), run('c', 180)]);
  assert.equal(warning?.capFps, 141);
  assert.match(warning!.text, /1% lows/);
  assert.equal(capWarning([run('a', 141, {}, capped), run('b', 180)]), null, 'half is not most');
});

test('runs under different hardware conditions are flagged, and missing readings are not', () => {
  const normal = { 'gpu.gpu0.temperatureC': 65, 'gpu.gpu0.clockMhz': 2700, 'cpu.effectiveMhz': 4700 };
  const before = [run('a', 200, normal), run('b', 200, normal), run('c', 200, normal)];
  const hot = run('d', 190, { ...normal, 'gpu.gpu0.temperatureC': 78, 'gpu.gpu0.clockMhz': 2450, 'gpu.gpu0.thermalSlowdown': 1 });
  const flags = conditionFlags(before, [...before, hot, run('e', 200)]);
  assert.deepEqual([...flags.keys()], ['d']);
  const notes = flags.get('d')!;
  assert.equal(notes.length, 3);
  assert.match(notes[0], /GPU ran 78 .C, versus about 65 .C/);
  assert.match(notes[2], /slowed itself down/);
});
