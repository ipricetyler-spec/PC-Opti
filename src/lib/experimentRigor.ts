/**
 * Checks that make a before/after experiment harder to fool:
 *
 *   - run counter: how many runs to take, with the warm-up run called out
 *   - noise floor: how much runs varied with nothing changed, so a result is only called
 *     a difference when it moves further than that
 *   - undo-and-remeasure (A-B-A): if results go back to the baseline once the setting is
 *     put back, the change caused the difference; if not, something else drifted
 *   - frame-cap warning: a capped game cannot show higher average FPS
 *   - condition check: runs whose temperature or clocks differ from the rest
 *
 * These describe the person's own runs. They are not significance tests, and frame times
 * are not input latency. Pure, so it can be tested without a browser.
 */
import type { FrameSummary, PresentMonCaptureEntry, TelemetryStat } from '../types';

/** Counted runs recommended per side — the minimum the matched comparison accepts. */
export const RECOMMENDED_RUNS = 3;

type Run = Pick<PresentMonCaptureEntry, 'captureId' | 'frameSummary' | 'telemetry'>;

function summaries(runs: Run[]): FrameSummary[] {
  return runs.map((run) => run.frameSummary).filter((item): item is FrameSummary => !!item);
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

// --- Run counter -----------------------------------------------------------------------

export interface RunProgress {
  /** Runs taken on this side, including a warm-up run. */
  taken: number;
  /** Runs to take on this side, including a warm-up run. */
  target: number;
  complete: boolean;
  label: string;
}

export function runProgress(side: 'before' | 'after' | 'check', counted: number, warmupTaken: boolean, warmupEnabled: boolean): RunProgress {
  const target = RECOMMENDED_RUNS + (warmupEnabled ? 1 : 0);
  const taken = counted + (warmupTaken ? 1 : 0);
  const complete = counted >= RECOMMENDED_RUNS;
  const name = side === 'before' ? 'Before' : side === 'after' ? 'After' : 'Check';
  if (complete) return { taken, target, complete, label: `${name} runs done — ${counted} counted${warmupTaken ? ', plus the warm-up' : ''}. More runs only make the result steadier.` };
  const next = Math.min(taken + 1, target);
  const warmupNote = warmupEnabled && !warmupTaken ? ' This first one is a warm-up and is not counted.' : '';
  return { taken, target, complete, label: `Next: ${name.toLowerCase()} run ${next} of ${target}.${warmupNote}` };
}

// --- Noise floor ---------------------------------------------------------------------

export interface NoiseFloor {
  runs: number;
  averageFps: number;
  /** (highest − lowest average FPS) ÷ their mean, as a percentage. */
  rangePercent: number;
}

/** How much the average FPS varied across runs taken with nothing changed. */
export function noiseFloor(runs: Run[]): NoiseFloor | null {
  const items = summaries(runs);
  if (items.length < 2) return null;
  const fps = items.map((item) => item.averageFps);
  const average = mean(fps);
  if (average <= 0) return null;
  return { runs: items.length, averageFps: round1(average), rangePercent: round1(((Math.max(...fps) - Math.min(...fps)) / average) * 100) };
}

export interface EffectCheck {
  verdict: 'BEYOND_NOISE' | 'WITHIN_NOISE' | 'NOT_ENOUGH_RUNS';
  averageFpsChangePercent: number | null;
  onePercentLowChangePercent: number | null;
  /** The larger of the two sides' run-to-run range. */
  noisePercent: number | null;
  text: string;
}

function percentChange(from: number, to: number): number {
  return round1(((to - from) / from) * 100);
}

function signed(value: number): string {
  return `${value > 0 ? '+' : ''}${value}%`;
}

/**
 * Compares the change in average FPS with the normal run-to-run variation on both sides.
 * Conservative on purpose: the change has to exceed the full range the runs already
 * showed, not just their typical spread.
 */
export function effectVsNoise(before: Run[], after: Run[]): EffectCheck {
  const baseline = summaries(before);
  const candidate = summaries(after);
  const beforeNoise = noiseFloor(before);
  const afterNoise = noiseFloor(after);
  if (baseline.length < RECOMMENDED_RUNS || candidate.length < RECOMMENDED_RUNS || !beforeNoise || !afterNoise) {
    return { verdict: 'NOT_ENOUGH_RUNS', averageFpsChangePercent: null, onePercentLowChangePercent: null, noisePercent: null, text: `Take at least ${RECOMMENDED_RUNS} counted runs on each side to see whether a difference is bigger than normal variation.` };
  }
  const fpsChange = percentChange(mean(baseline.map((item) => item.averageFps)), mean(candidate.map((item) => item.averageFps)));
  const lowChange = percentChange(mean(baseline.map((item) => item.onePercentLowFps)), mean(candidate.map((item) => item.onePercentLowFps)));
  const noise = Math.max(beforeNoise.rangePercent, afterNoise.rangePercent);
  const beyond = Math.abs(fpsChange) > noise;
  const text = beyond
    ? `Average FPS moved ${signed(fpsChange)}, more than your runs varied on their own (up to ${noise}%). 1% lows moved ${signed(lowChange)}.`
    : `Average FPS moved ${signed(fpsChange)}, which is within how much your runs varied on their own (up to ${noise}%). Treat it as no measurable difference. 1% lows moved ${signed(lowChange)}.`;
  return { verdict: beyond ? 'BEYOND_NOISE' : 'WITHIN_NOISE', averageFpsChangePercent: fpsChange, onePercentLowChangePercent: lowChange, noisePercent: noise, text };
}

// --- Undo and re-measure (A-B-A) -------------------------------------------------------

export interface AbaCheck {
  verdict: 'CONFIRMED' | 'DID_NOT_RETURN' | 'NOT_ENOUGH_RUNS';
  text: string;
}

/**
 * After the setting is put back, results should return to the baseline. If they do, the
 * difference followed the setting; if they stay where the "after" runs were, something
 * else changed during the test — heat, a background task, a game update.
 */
export function abaCheck(before: Run[], check: Run[]): AbaCheck {
  const baseline = summaries(before);
  const returned = summaries(check);
  const noise = noiseFloor(before);
  if (returned.length < 2 || !noise || baseline.length < 2) {
    return { verdict: 'NOT_ENOUGH_RUNS', text: 'Take at least 2 counted runs with the setting put back to check whether results return to your baseline.' };
  }
  const change = percentChange(mean(baseline.map((item) => item.averageFps)), mean(returned.map((item) => item.averageFps)));
  // Allow a little more than the baseline's own range, so a clean return is not
  // rejected for being at the edge of normal variation.
  const allowed = Math.max(noise.rangePercent * 1.5, 1);
  return Math.abs(change) <= allowed
    ? { verdict: 'CONFIRMED', text: `With the setting put back, average FPS came back to within ${signed(change)} of your baseline, so the difference followed the setting.` }
    : { verdict: 'DID_NOT_RETURN', text: `With the setting put back, average FPS stayed ${signed(change)} away from your baseline. Something besides the setting changed during the test, so do not rely on this result.` };
}

// --- Frame cap -----------------------------------------------------------------------

/** The cap most runs sat at, when most runs look capped. */
export function capWarning(runs: Run[]): { capFps: number; text: string } | null {
  const items = summaries(runs);
  const capped = items.filter((item) => item.capLikely && item.capFps);
  if (!items.length || capped.length * 2 <= items.length) return null;
  const capFps = Math.round(median(capped.map((item) => item.capFps as number)));
  return {
    capFps,
    text: `Most runs held steady at about ${capFps} FPS, which looks like a frame cap, V-Sync or the monitor's refresh rate. Average FPS cannot rise past a cap, so judge this change by 1% lows and frame-time consistency, or lift the cap for both before and after runs.`,
  };
}

// --- Conditions ------------------------------------------------------------------------

const CPU_SPEED = 'cpu.effectiveMhz';

function stat(run: Run, key: string): TelemetryStat | undefined {
  return run.telemetry?.view?.summary.metrics[key];
}

function gpuKey(runs: Run[], metric: string): string | null {
  for (const run of runs) {
    const key = Object.keys(run.telemetry?.view?.summary.metrics ?? {}).find((name) => name.startsWith('gpu.') && name.endsWith(`.${metric}`));
    if (key) return key;
  }
  return null;
}

function meanOf(run: Run, key: string | null): number | null {
  if (!key) return null;
  const value = stat(run, key)?.mean;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Flags runs whose hardware conditions differ from the typical before run: a GPU more
 * than 5 °C warmer or cooler, GPU or CPU clocks more than 5% apart, or GPU throttling
 * that the typical run did not show. Runs without hardware readings are not flagged —
 * that is reported separately, as missing readings, not as a problem.
 */
export function conditionFlags(before: Run[], runs: Run[]): Map<string, string[]> {
  const temperature = gpuKey([...before, ...runs], 'temperatureC');
  const gpuClock = gpuKey([...before, ...runs], 'clockMhz');
  const throttle = [gpuKey([...before, ...runs], 'thermalSlowdown'), gpuKey([...before, ...runs], 'powerLimited')].filter((key): key is string => !!key);
  const reference = (key: string | null): number | null => {
    const values = before.map((run) => meanOf(run, key)).filter((value): value is number => value !== null);
    return values.length ? median(values) : null;
  };
  const refTemperature = reference(temperature);
  const refGpuClock = reference(gpuClock);
  const refCpu = reference(CPU_SPEED);
  const refThrottled = before.some((run) => throttle.some((key) => (meanOf(run, key) ?? 0) > 0));
  const flags = new Map<string, string[]>();
  for (const run of runs) {
    const notes: string[] = [];
    const runTemperature = meanOf(run, temperature);
    if (refTemperature !== null && runTemperature !== null && Math.abs(runTemperature - refTemperature) > 5) notes.push(`GPU ran ${Math.round(runTemperature)} °C, versus about ${Math.round(refTemperature)} °C`);
    const runGpuClock = meanOf(run, gpuClock);
    if (refGpuClock && runGpuClock !== null && Math.abs(runGpuClock - refGpuClock) / refGpuClock > 0.05) notes.push(`GPU clock averaged ${Math.round(runGpuClock)} MHz, versus about ${Math.round(refGpuClock)} MHz`);
    const runCpu = meanOf(run, CPU_SPEED);
    if (refCpu && runCpu !== null && Math.abs(runCpu - refCpu) / refCpu > 0.05) notes.push(`CPU speed averaged ${(runCpu / 1000).toFixed(2)} GHz, versus about ${(refCpu / 1000).toFixed(2)} GHz`);
    if (!refThrottled && throttle.some((key) => (meanOf(run, key) ?? 0) > 0)) notes.push('The GPU slowed itself down for heat or power during this run');
    if (notes.length) flags.set(run.captureId, notes);
  }
  return flags;
}
