// The last polling-rate check per device, so the device list can show what Windows received
// beside what is saved. Kept only in this browser profile: a per-user convenience, never evidence
// another part of Dialed relies on. Saved (read back from Windows) and measured (observed reports)
// are always worded differently, and a measurement always carries its date.

export interface MeasuredRate { reportsPerSecond: number; at: string; name?: string }
type Store = Record<string, MeasuredRate>;

const KEY = 'dialed-measured-rates';
const MAX_DEVICES = 64;

export function parseMeasuredRates(raw: string | null): Store {
  try {
    const parsed = JSON.parse(raw || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Store = {};
    for (const [id, value] of Object.entries(parsed).slice(0, MAX_DEVICES)) {
      const item = value as Partial<MeasuredRate>;
      if (/^[a-f0-9]{64}$/.test(id) && Number.isFinite(item?.reportsPerSecond) && (item.reportsPerSecond as number) > 0
        && typeof item?.at === 'string' && Number.isFinite(Date.parse(item.at))) out[id] = { reportsPerSecond: Math.round(item.reportsPerSecond as number), at: item.at, ...(typeof item.name === 'string' ? { name: item.name.slice(0, 120) } : {}) };
    }
    return out;
  } catch { return {}; }
}

export function readMeasuredRates(): Store {
  try { return parseMeasuredRates(localStorage.getItem(KEY)); } catch { return {}; }
}

export function rememberMeasuredRate(deviceId: string, reportsPerSecond: number, at = new Date(), name?: string): Store {
  const next = { ...readMeasuredRates(), [deviceId]: { reportsPerSecond: Math.round(reportsPerSecond), at: at.toISOString(), ...(name ? { name: name.slice(0, 120) } : {}) } };
  const trimmed = Object.fromEntries(Object.entries(next).sort((a, b) => Date.parse(b[1].at) - Date.parse(a[1].at)).slice(0, MAX_DEVICES));
  try { localStorage.setItem(KEY, JSON.stringify(trimmed)); } catch { /* per-user convenience only */ }
  return parseMeasuredRates(JSON.stringify(trimmed));
}

/** The most recent rate check across devices, for Home. */
export function latestMeasuredRate(store: Store): MeasuredRate | null {
  return Object.values(store).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] ?? null;
}

/** One short line for a device row: what is saved, and what was last measured and when. */
export function deviceRateLine(device: { configuredHz: number | null; inactiveHz?: number | null }, measured: MeasuredRate | undefined, now = new Date()): string {
  const saved = device.configuredHz !== null ? `Saved ${device.configuredHz.toLocaleString()} Hz`
    : device.inactiveHz ? `${device.inactiveHz.toLocaleString()} Hz set earlier, not in effect`
    : 'Saved: Windows default';
  if (!measured) return `${saved} · Not checked yet`;
  const at = new Date(measured.at);
  const when = at.toDateString() === now.toDateString() ? 'today' : at.toLocaleDateString([], { day: 'numeric', month: 'short' });
  return `${saved} · Measured about ${measured.reportsPerSecond.toLocaleString()} reports/s ${when}`;
}
