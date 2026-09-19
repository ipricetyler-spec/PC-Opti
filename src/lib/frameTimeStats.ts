export interface FrameTimeStats {
  count: number;
  averageFps: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  p999Ms: number;
  onePercentLowFps: number;
  pointOnePercentLowFps: number;
  stutterCount: number;
  stutterThresholdMs: number;
}

// Nearest-rank percentile on an ascending copy.
function percentile(sorted: number[], fraction: number) {
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[rank];
}

function averageOfSlowest(sorted: number[], fraction: number) {
  const count = Math.max(1, Math.floor(sorted.length * fraction));
  const slowest = sorted.slice(sorted.length - count);
  return slowest.reduce((sum, value) => sum + value, 0) / slowest.length;
}

// Frame-time samples in milliseconds. "1% low" is the FPS equivalent of the mean of
// the slowest 1% of frames; a stutter is a frame longer than twice the median.
export function computeFrameTimeStats(samples: number[], unit = 'ms'): FrameTimeStats | null {
  if (!/^ms$/i.test(unit)) return null;
  const valid = samples.filter((value) => Number.isFinite(value) && value > 0 && value < 10_000);
  if (valid.length < 20) return null;
  const sorted = [...valid].sort((left, right) => left - right);
  const total = valid.reduce((sum, value) => sum + value, 0);
  const p50Ms = percentile(sorted, 0.5);
  const stutterThresholdMs = p50Ms * 2;
  return {
    count: valid.length,
    averageFps: 1000 / (total / valid.length),
    p50Ms,
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    p999Ms: percentile(sorted, 0.999),
    onePercentLowFps: 1000 / averageOfSlowest(sorted, 0.01),
    pointOnePercentLowFps: 1000 / averageOfSlowest(sorted, 0.001),
    stutterCount: valid.filter((value) => value > stutterThresholdMs).length,
    stutterThresholdMs,
  };
}

// Keeps the slowest frame in each bucket so spikes stay visible after downsampling.
export function downsampleFrameTimes(samples: number[], maxPoints = 400) {
  const valid = samples.filter((value) => Number.isFinite(value) && value > 0);
  if (valid.length <= maxPoints) return valid;
  const bucketSize = valid.length / maxPoints;
  const points: number[] = [];
  for (let bucket = 0; bucket < maxPoints; bucket += 1) {
    const start = Math.floor(bucket * bucketSize);
    const end = Math.max(start + 1, Math.floor((bucket + 1) * bucketSize));
    points.push(Math.max(...valid.slice(start, end)));
  }
  return points;
}
