import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consentSignature, savedTestLine } from '../src/lib/networkTestMemory';
import type { NetworkQualityHistoryEntry } from '../src/types';

const entry = (overrides: Omit<Partial<NetworkQualityHistoryEntry>, 'metrics'> & { metrics?: Partial<NetworkQualityHistoryEntry['metrics']> } = {}): NetworkQualityHistoryEntry => ({
  id: 'x', completedAt: '2026-09-30T18:05:00Z', status: 'COMPLETE', endpointId: 'e', methodVersion: 'warmed-https-v2', mode: 'quick', quality: 'SUFFICIENT',
  ...overrides,
  metrics: { idleLatencyMs: 12.4, idleJitterMs: 1, idleP90Ms: 15, idleVariabilityMs: 2, requestFailurePercent: 0, downloadLoadedLatencyMs: 40, downloadLoadedLatencyIncreaseMs: 27.6, uploadLoadedLatencyMs: null, uploadLoadedLatencyIncreaseMs: null, downloadMbps: 1153.2, uploadMbps: 46.04, ...overrides.metrics },
} as NetworkQualityHistoryEntry);

test('a saved test reads as one line: speeds, response and the measured increase while busy', () => {
  const line = savedTestLine(entry());
  assert.match(line, /1153 down \/ 46\.0 up Mbps · 12 ms response · \+28 ms while downloading$/);
  // A missing increase is left out, never shown as zero.
  assert.doesNotMatch(savedTestLine(entry({ metrics: { downloadLoadedLatencyIncreaseMs: null } })), /while downloading/);
  assert.match(savedTestLine(entry({ status: 'PARTIAL' })), /some parts failed$/);
  assert.match(savedTestLine(entry({ status: 'OFFLINE' })), /Could not reach the test server$/);
});

test('consent covers exactly what was disclosed', () => {
  const base = { mode: 'quick' as const, url: 'https://speed.cloudflare.com/x', maximumTotalBytes: 100, maximumParallelConnections: 6 };
  assert.equal(consentSignature(null), null);
  assert.notEqual(consentSignature(base), consentSignature({ ...base, maximumTotalBytes: 200 }));
  assert.notEqual(consentSignature(base), consentSignature({ ...base, url: 'https://other.example/x' }));
  assert.equal(consentSignature(base), consentSignature({ ...base }));
});
