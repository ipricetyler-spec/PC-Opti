import type { NetworkQualityHistoryEntry } from '../types';

export const NETWORK_CONTEXT_KEY = 'dialed-network-context:v1';
export interface NetworkRunContext { adapter: string; vpn: string; background: string }
export function parseNetworkContexts(raw: string | null): Record<string, NetworkRunContext> {
  if (!raw) return {};
  if (raw.length > 32000) throw new Error('Network context storage exceeds its limit.');
  const data = JSON.parse(raw);
  if (!data || Array.isArray(data) || typeof data !== 'object' || Object.keys(data).length > 20) throw new Error('Network context storage is invalid.');
  for (const [id, value] of Object.entries(data)) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id) || !value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Network context entry is invalid.');
    const context = value as Record<string, unknown>;
    if (Object.keys(context).some((key) => !['adapter','vpn','background'].includes(key)) || ['adapter','vpn','background'].some((key) => typeof context[key] !== 'string' || (context[key] as string).length > 240)) throw new Error('Network context notes are invalid.');
  }
  return data;
}
export function compareNetworkRuns(before: NetworkQualityHistoryEntry | undefined, after: NetworkQualityHistoryEntry | undefined, contexts: Record<string, NetworkRunContext>) {
  if (!before || !after || before.id === after.id) return { issue: 'Choose two different saved runs.', deltas: null };
  if (before.status !== 'COMPLETE' || after.status !== 'COMPLETE') return { issue: 'Only complete runs can be compared; partial or offline evidence remains in history.', deltas: null };
  if (before.methodVersion === 'legacy-v1' || after.methodVersion === 'legacy-v1') return { issue: 'Legacy v1 samples are preserved for reference but cannot be compared with the corrected warmed-HTTPS method.', deltas: null };
  if (before.methodVersion !== after.methodVersion || before.mode !== after.mode || before.endpointId !== after.endpointId) return { issue: 'The endpoint, mode, or versioned test method differs.', deltas: null };
  if (before.quality !== 'SUFFICIENT' || after.quality !== 'SUFFICIENT') return { issue: 'Both runs need sufficient verified transfer overlap before comparison.', deltas: null };
  const first = contexts[before.id], second = contexts[after.id];
  if (!first || !second || [first,second].some((value) => Object.values(value).some((field) => !field.trim()))) return { issue: 'Declare adapter/connection, VPN and background conditions for both runs.', deltas: null };
  if ((['adapter','vpn','background'] as const).some((key) => first[key].trim().toLowerCase() !== second[key].trim().toLowerCase())) return { issue: 'Declared conditions differ. These runs are not a matched comparison.', deltas: null };
  const delta = (key: keyof NetworkQualityHistoryEntry['metrics']) => {
    const left = before.metrics[key], right = after.metrics[key];
    return typeof left === 'number' && Number.isFinite(left) && left >= 0 && typeof right === 'number' && Number.isFinite(right) && right >= 0 ? right - left : null;
  };
  return { issue: null, deltas: { idleMs: delta('idleLatencyMs'), downloadLoadedMs: delta('downloadLoadedLatencyMs'), uploadLoadedMs: delta('uploadLoadedLatencyMs'), downloadMbps: delta('downloadMbps'), uploadMbps: delta('uploadMbps') } };
}
