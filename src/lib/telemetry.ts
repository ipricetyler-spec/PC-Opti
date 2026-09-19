import type { TelemetryStat, TelemetryView } from '../types';

export const HARDWARE_READINGS_PREFERENCE_KEY = 'dialed-capture-hardware-readings:v1';

export function readHardwareReadingsPreference() {
  try { return localStorage.getItem(HARDWARE_READINGS_PREFERENCE_KEY) === 'on'; } catch { return false; }
}

export function writeHardwareReadingsPreference(enabled: boolean) {
  try { localStorage.setItem(HARDWARE_READINGS_PREFERENCE_KEY, enabled ? 'on' : 'off'); return true; } catch { return false; }
}

export type MetricUnit = 'percent' | 'mhz' | 'bytes' | 'celsius' | 'watts';

export interface MetricRow {
  key: string;
  label: string;
  unit: MetricUnit;
  stat: TelemetryStat;
  capacityBytes: number | null;
}

export function formatMetricValue(value: number | null, unit: MetricUnit) {
  if (value === null || !Number.isFinite(value)) return '—';
  if (unit === 'percent') return `${value.toFixed(0)}%`;
  if (unit === 'mhz') return value >= 1000 ? `${(value / 1000).toFixed(2)} GHz` : `${value.toFixed(0)} MHz`;
  if (unit === 'celsius') return `${value.toFixed(0)} °C`;
  if (unit === 'watts') return `${value.toFixed(0)} W`;
  return `${(value / 1024 ** 3).toFixed(1)} GiB`;
}

// Share of valid readings in which NVIDIA reported the given slowdown flag, or null.
export function sensorFlagShare(view: TelemetryView, adapterId: string, flag: 'thermalSlowdown' | 'powerLimited' | 'hardwareSlowdown') {
  const stat = view.summary.metrics[`gpu.${adapterId}.${flag}`];
  return stat && stat.count > 0 && stat.mean !== null ? stat.mean : null;
}

export function metricRows(view: TelemetryView): MetricRow[] {
  const rows: MetricRow[] = [];
  const push = (key: string, label: string, unit: MetricUnit, capacityBytes: number | null = null) => {
    const stat = view.summary.metrics[key];
    // A reading that never produced a value (for example an unsupported sensor) is left out.
    if (stat && (stat.count > 0 || stat.stale > 0)) rows.push({ key, label, unit, stat, capacityBytes });
  };
  push('cpu.utilityPercent', 'CPU load (utility)', 'percent');
  push('cpu.effectiveMhz', 'CPU speed (all-core average)', 'mhz');
  push('cpu.fastestCoreMhz', 'CPU speed (fastest core)', 'mhz');
  push('cpu.performancePercent', 'CPU speed vs. rated base', 'percent');
  push('cpu.frequencyMhz', 'CPU rated base speed', 'mhz');
  push('memory.availableBytes', 'Available memory', 'bytes');
  for (const adapter of view.adapters) {
    push(`gpu.${adapter.id}.threeDPercent`, `${adapter.label} · 3D engine load`, 'percent');
    push(`gpu.${adapter.id}.busiestEnginePercent`, `${adapter.label} · busiest engine`, 'percent');
    push(`gpu.${adapter.id}.dedicatedUsageBytes`, `${adapter.label} · video memory in use`, 'bytes', adapter.dedicatedCapacityBytes);
    push(`gpu.${adapter.id}.sharedUsageBytes`, `${adapter.label} · shared GPU memory`, 'bytes');
    push(`gpu.${adapter.id}.targetDedicatedBytes`, `${adapter.label} · captured app’s video memory`, 'bytes');
    push(`gpu.${adapter.id}.temperatureC`, `${adapter.label} · temperature`, 'celsius');
    push(`gpu.${adapter.id}.powerWatts`, `${adapter.label} · power draw`, 'watts');
    push(`gpu.${adapter.id}.powerLimitWatts`, `${adapter.label} · power limit`, 'watts');
    push(`gpu.${adapter.id}.clockMhz`, `${adapter.label} · core clock`, 'mhz');
    push(`gpu.${adapter.id}.memoryClockMhz`, `${adapter.label} · memory clock`, 'mhz');
    push(`gpu.${adapter.id}.fanPercent`, `${adapter.label} · fan speed`, 'percent');
  }
  return rows;
}

export interface ConditionDifference {
  key: string;
  label: string;
  unit: MetricUnit;
  baselineMean: number | null;
  candidateMean: number | null;
  baselineRuns: number;
  candidateRuns: number;
  flagged: boolean;
}

export interface HardwareConditionComparison {
  rows: ConditionDifference[];
  canFlag: boolean;
  limitWarning: string | null;
}

const FLAG_POINTS = 15;
const MIN_RUNS_TO_FLAG = 3;
const LIMITED_SHARE = 0.05;

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function variance(values: number[]) {
  if (values.length < 2) return 0;
  const average = mean(values);
  return values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
}

// Adapters are matched across runs only by a verified label; unverified adapters are
// never compared because index order is not stable identity.
function comparableKeys(views: TelemetryView[]) {
  const keys = new Map<string, { label: string; unit: MetricUnit; resolve: (view: TelemetryView) => TelemetryStat | undefined }>();
  const add = (key: string, label: string, unit: MetricUnit) => keys.set(key, { label, unit, resolve: (view) => view.summary.metrics[key] });
  add('cpu.utilityPercent', 'CPU load (utility)', 'percent');
  add('memory.availableBytes', 'Available memory', 'bytes');
  const labels = new Set(views.flatMap((view) => view.adapters.filter((adapter) => adapter.identity === 'VERIFIED').map((adapter) => adapter.label)));
  for (const label of labels) {
    for (const [metric, suffix, unit] of [['threeDPercent', '3D engine load', 'percent'], ['busiestEnginePercent', 'busiest engine', 'percent'], ['dedicatedUsageBytes', 'video memory in use', 'bytes'], ['temperatureC', 'temperature', 'celsius'], ['powerWatts', 'power draw', 'watts']] as const) {
      keys.set(`gpu:${label}:${metric}`, {
        label: `${label} · ${suffix}`,
        unit,
        resolve: (view) => {
          const adapter = view.adapters.find((item) => item.identity === 'VERIFIED' && item.label === label);
          return adapter ? view.summary.metrics[`gpu.${adapter.id}.${metric}`] : undefined;
        },
      });
    }
  }
  return keys;
}

function runMeans(views: TelemetryView[], resolve: (view: TelemetryView) => TelemetryStat | undefined) {
  return views.map(resolve).filter((stat): stat is TelemetryStat => Boolean(stat && stat.count > 0 && stat.mean !== null)).map((stat) => stat.mean as number);
}

// Informational only, never a verdict. With at least three recorded runs per side, a
// percent metric is flagged when the difference in run means exceeds
// max(15 points, 2 × pooled run-to-run standard deviation).
export function compareHardwareConditions(baselineViews: Array<TelemetryView | null>, candidateViews: Array<TelemetryView | null>): HardwareConditionComparison {
  const baseline = baselineViews.filter((view): view is TelemetryView => view?.status === 'RECORDED');
  const candidate = candidateViews.filter((view): view is TelemetryView => view?.status === 'RECORDED');
  const canFlag = baseline.length >= MIN_RUNS_TO_FLAG && candidate.length >= MIN_RUNS_TO_FLAG;
  const rows: ConditionDifference[] = [];
  for (const [key, definition] of comparableKeys([...baseline, ...candidate])) {
    const before = runMeans(baseline, definition.resolve);
    const after = runMeans(candidate, definition.resolve);
    if (!before.length && !after.length) continue;
    let flagged = false;
    if (canFlag && definition.unit === 'percent' && before.length >= MIN_RUNS_TO_FLAG && after.length >= MIN_RUNS_TO_FLAG) {
      const pooled = Math.sqrt(((before.length - 1) * variance(before) + (after.length - 1) * variance(after)) / (before.length + after.length - 2));
      flagged = Math.abs(mean(before) - mean(after)) > Math.max(FLAG_POINTS, 2 * pooled);
    }
    rows.push({ key, label: definition.label, unit: definition.unit, baselineMean: before.length ? mean(before) : null, candidateMean: after.length ? mean(after) : null, baselineRuns: before.length, candidateRuns: after.length, flagged });
  }
  const limited = (views: TelemetryView[]) => views.some((view) => (view.summary.performanceLimitedShare ?? 0) >= LIMITED_SHARE);
  const clean = (views: TelemetryView[]) => views.length > 0 && views.every((view) => view.summary.performanceLimitedShare === 0);
  let limitWarning: string | null = null;
  if (limited(baseline) && clean(candidate)) limitWarning = 'Windows reported the processor limited below its maximum performance during some before runs but not during the after runs.';
  else if (limited(candidate) && clean(baseline)) limitWarning = 'Windows reported the processor limited below its maximum performance during some after runs but not during the before runs.';
  return { rows, canFlag, limitWarning };
}
