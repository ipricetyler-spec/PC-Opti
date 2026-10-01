import type { NetworkProbeEndpoint, NetworkQualityHistoryEntry } from '../types';

// Consent to a network test covers exactly what was disclosed: the mode, the server, the data
// limit and the connection count. Any change to those asks again. Kept per user only.
const CONSENT_KEY = 'dialed-network-consent';

export function consentSignature(endpoint: Pick<NetworkProbeEndpoint, 'mode' | 'url' | 'maximumTotalBytes' | 'maximumParallelConnections'> | null | undefined): string | null {
  if (!endpoint) return null;
  return [endpoint.mode, endpoint.url, endpoint.maximumTotalBytes, endpoint.maximumParallelConnections].join('|');
}

function readConsents(): string[] {
  try { const value = JSON.parse(localStorage.getItem(CONSENT_KEY) || '[]'); return Array.isArray(value) ? value.filter((item) => typeof item === 'string').slice(0, 8) : []; }
  catch { return []; }
}

export function hasRememberedConsent(signature: string | null): boolean {
  return signature !== null && readConsents().includes(signature);
}

export function rememberConsent(signature: string | null, given: boolean) {
  if (signature === null) return;
  const rest = readConsents().filter((item) => item !== signature);
  try { localStorage.setItem(CONSENT_KEY, JSON.stringify(given ? [signature, ...rest].slice(0, 8) : rest)); } catch { /* per-user convenience only */ }
}

/** The increase while busy above which the latest-result advice says the connection slowed. */
export const BUSY_SLOWDOWN_MS = 30;

const ms = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value)} ms` : null;
const mbps = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) ? `${value >= 100 ? Math.round(value) : value.toFixed(1)}` : '—';

/** One readable line per saved test: when, speeds, idle response and the increase while busy. */
export function savedTestLine(entry: NetworkQualityHistoryEntry): string {
  const when = new Date(entry.completedAt).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  if (entry.status === 'OFFLINE') return `${when} · Could not reach the test server`;
  const m = entry.metrics;
  const parts = [`${when}`, `${mbps(m.downloadMbps)} down / ${mbps(m.uploadMbps)} up Mbps`];
  const idle = ms(m.idleLatencyMs);
  if (idle) parts.push(`${idle} response`);
  // Only a measured increase is shown; a missing one is not shown as zero.
  const busy = typeof m.downloadLoadedLatencyIncreaseMs === 'number' && Number.isFinite(m.downloadLoadedLatencyIncreaseMs)
    ? `${m.downloadLoadedLatencyIncreaseMs >= 0 ? '+' : ''}${Math.round(m.downloadLoadedLatencyIncreaseMs)} ms while downloading` : null;
  if (busy) parts.push(busy);
  // A plain verdict only from a measured increase and timing good enough to judge.
  if (busy && entry.quality === 'SUFFICIENT') parts.push((m.downloadLoadedLatencyIncreaseMs as number) > BUSY_SLOWDOWN_MS ? 'slowed while busy' : 'held steady while busy');
  if (entry.status === 'PARTIAL') parts.push('some parts failed');
  return parts.join(' · ');
}
