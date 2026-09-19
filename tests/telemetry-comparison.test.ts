import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareHardwareConditions, formatMetricValue, metricRows, sensorFlagShare } from '../src/lib/telemetry';
import type { TelemetryStat, TelemetryView } from '../src/types';

function stat(mean: number): TelemetryStat {
  return { count: 10, min: mean, mean, p95: mean, max: mean, stale: 0, unavailable: 0, warmup: 1, coveragePercent: 100 };
}

function view(cpu: number, gpu: number, limitedShare = 0, identity: 'VERIFIED' | 'UNAVAILABLE' = 'VERIFIED'): TelemetryView {
  return {
    status: 'RECORDED', stopReason: 'CAPTURE_FINISHED', errors: [], targetTracked: true, targetChanged: false,
    adapters: [{ id: 'gpu0', label: identity === 'VERIFIED' ? 'Fixture GPU' : 'GPU 1', identity, dedicatedCapacityBytes: identity === 'VERIFIED' ? 8e9 : null }],
    summary: { samples: 11, performanceLimitedShare: limitedShare, metrics: { 'cpu.utilityPercent': stat(cpu), 'gpu.gpu0.threeDPercent': stat(gpu), 'gpu.gpu0.dedicatedUsageBytes': stat(5e9) } },
  };
}

test('differences are never flagged with fewer than three recorded runs per side', () => {
  const result = compareHardwareConditions([view(20, 50), view(22, 52)], [view(80, 99), view(82, 98)]);
  assert.equal(result.canFlag, false);
  assert.ok(result.rows.every((row) => !row.flagged));
  assert.equal(result.rows.find((row) => row.key === 'cpu.utilityPercent')?.baselineMean, 21);
});

test('a percent difference is flagged only above max(15 points, 2 × pooled run SD)', () => {
  const flagged = compareHardwareConditions([view(20, 50), view(22, 50), view(21, 50)], [view(60, 55), view(62, 55), view(61, 55)]);
  assert.equal(flagged.rows.find((row) => row.key === 'cpu.utilityPercent')?.flagged, true);
  assert.equal(flagged.rows.find((row) => row.key === 'gpu:Fixture GPU:threeDPercent')?.flagged, false, '5 points is below 15');
  assert.equal(flagged.rows.find((row) => row.key === 'gpu:Fixture GPU:dedicatedUsageBytes')?.flagged, false, 'byte metrics are never flagged by the point rule');

  const noisy = compareHardwareConditions([view(10, 50), view(50, 50), view(90, 50)], [view(40, 50), view(80, 50), view(100, 50)]);
  assert.equal(noisy.rows.find((row) => row.key === 'cpu.utilityPercent')?.flagged, false, 'a 23-point gap inside large run-to-run spread is not flagged');
});

test('unverified adapters are not compared, failed runs are ignored, and limit warnings need one clean side', () => {
  const result = compareHardwareConditions([view(20, 50, 0.2, 'UNAVAILABLE'), null, view(20, 50, 0, 'UNAVAILABLE')], [view(20, 50, 0, 'UNAVAILABLE')]);
  assert.equal(result.rows.some((row) => row.key.startsWith('gpu:')), false);
  assert.equal(result.rows.find((row) => row.key === 'cpu.utilityPercent')?.baselineRuns, 2);
  assert.match(result.limitWarning || '', /before runs but not during the after runs/);
  assert.equal(compareHardwareConditions([view(20, 50, 0.2)], [view(20, 50, 0.01)]).limitWarning, null, 'the other side is not clean');
});

test('NVIDIA sensor readings get units, stay informational in comparisons, and unsupported sensors are hidden', () => {
  const withSensors = (temperature: number, thermalShare: number): TelemetryView => {
    const base = view(30, 90);
    base.sensors = { source: 'NVML', status: 'OK', driverVersion: '581.29' };
    base.summary.metrics['gpu.gpu0.temperatureC'] = stat(temperature);
    base.summary.metrics['gpu.gpu0.powerWatts'] = stat(250);
    base.summary.metrics['gpu.gpu0.thermalSlowdown'] = stat(thermalShare);
    base.summary.metrics['gpu.gpu0.fanPercent'] = { ...stat(0), count: 0, mean: null, min: null, max: null, p95: null };
    return base;
  };
  const rows = metricRows(withSensors(71, 0));
  assert.ok(rows.some((row) => row.label === 'Fixture GPU · temperature' && row.unit === 'celsius'));
  assert.equal(rows.some((row) => row.label.includes('fan speed')), false, 'a sensor with no values is not shown');
  assert.equal(formatMetricValue(71.4, 'celsius'), '71 °C');
  assert.equal(formatMetricValue(249.6, 'watts'), '250 W');
  assert.equal(formatMetricValue(810, 'mhz'), '810 MHz');
  assert.equal(sensorFlagShare(withSensors(83, 0.25), 'gpu0', 'thermalSlowdown'), 0.25);
  assert.equal(sensorFlagShare(withSensors(83, 0.25), 'gpu0', 'powerLimited'), null);
  const comparison = compareHardwareConditions([withSensors(60, 0), withSensors(61, 0), withSensors(62, 0)], [withSensors(85, 0), withSensors(86, 0), withSensors(84, 0)]);
  const temperatureRow = comparison.rows.find((row) => row.key === 'gpu:Fixture GPU:temperatureC');
  assert.equal(temperatureRow?.candidateMean, 85);
  assert.equal(temperatureRow?.flagged, false, 'temperature is shown but never flagged by the point rule');
});

test('metric rows use plain labels and units without inventing temperatures', () => {
  const rows = metricRows(view(20, 50));
  assert.deepEqual(rows.map((row) => row.label), ['CPU load (utility)', 'Fixture GPU · 3D engine load', 'Fixture GPU · video memory in use']);
  assert.equal(rows.some((row) => /temp/i.test(row.label)), false);
  assert.equal(formatMetricValue(4700, 'mhz'), '4.70 GHz');
  assert.equal(formatMetricValue(8 * 1024 ** 3, 'bytes'), '8.0 GiB');
  assert.equal(formatMetricValue(null, 'percent'), '—');
});
