/**
 * Step 2 of the Display setup workflow: the saved baseline.
 *
 * A baseline records the game and display settings in force when the "before"
 * measurement is taken, so that the "after" measurement can be checked against the
 * same conditions. Every field carries where its value came from:
 *
 *   OBSERVED — read from Windows by Dialed
 *   MANUAL   — entered by the person
 *   UNKNOWN  — explicitly not known; never a silent blank
 *
 * Pure and storage-agnostic so it can be tested without a browser. Nothing here reads
 * or changes a display, game or graphics-card setting.
 */

export const DISPLAY_BASELINES_KEY = 'dialed-display-baselines:v1';
export const MAX_STORED_BASELINES = 50;

export type FieldSource = 'OBSERVED' | 'MANUAL' | 'UNKNOWN';

/** Invariant: source is UNKNOWN exactly when value is null. */
export interface Field<T> {
  value: T | null;
  source: FieldSource;
}

export const DISPLAY_MODES = ['FULLSCREEN', 'BORDERLESS', 'WINDOWED'] as const;
export const SYNC_MODES = ['OFF', 'ON', 'ADAPTIVE', 'FAST'] as const;
export const ON_OFF = ['ON', 'OFF'] as const;
export const LATENCY_FEATURES = ['NONE', 'REFLEX_ON', 'REFLEX_BOOST', 'ANTI_LAG', 'ANTI_LAG_2', 'XELL', 'OTHER'] as const;

export type DisplayMode = typeof DISPLAY_MODES[number];
export type SyncMode = typeof SYNC_MODES[number];
export type OnOff = typeof ON_OFF[number];
export type LatencyFeature = typeof LATENCY_FEATURES[number];
export type FrameCap = number | 'UNCAPPED';

export interface BaselineSettings {
  resolution: Field<{ width: number; height: number }>;
  refreshHz: Field<number>;
  displayMode: Field<DisplayMode>;
  frameCap: Field<FrameCap>;
  vsync: Field<SyncMode>;
  vrr: Field<OnOff>;
  vrrRange: Field<{ minHz: number; maxHz: number }>;
  hdr: Field<OnOff>;
  latency: Field<LatencyFeature>;
}

export interface BaselineContext {
  /** "guide:<id>" for a detected game, "manual:<name>" for a described one. */
  gameKey: string;
  gameName: string;
  guideId: string | null;
  monitorKey: string;
  monitorLabel: string;
  gpuName: string | null;
  driverVersion: string | null;
}

export interface DisplayBaseline {
  schemaVersion: 1;
  id: string;
  savedAt: string;
  context: BaselineContext;
  settings: BaselineSettings;
}

export const FIELD_LABELS: Record<keyof BaselineSettings, string> = {
  resolution: 'Game resolution',
  refreshHz: 'Monitor refresh rate',
  displayMode: 'Display mode',
  frameCap: 'Frame cap',
  vsync: 'V-Sync',
  vrr: 'G-SYNC / FreeSync',
  vrrRange: 'G-SYNC / FreeSync range',
  hdr: 'HDR',
  latency: 'Latency feature',
};

/**
 * The four settings that most change frame timing. Without them a before/after
 * comparison cannot say what it compared, so a baseline is not saved until each is
 * known. Everything else may stay explicitly unknown.
 */
export const REQUIRED_FIELDS: Array<keyof BaselineSettings> = ['resolution', 'displayMode', 'frameCap', 'vsync'];

const BOUNDS = {
  pixels: { min: 320, max: 16_384 },
  hz: { min: 20, max: 1_000 },
  fps: { min: 10, max: 2_000 },
} as const;

const unknown = <T>(): Field<T> => ({ value: null, source: 'UNKNOWN' });
export const known = <T>(value: T, source: 'OBSERVED' | 'MANUAL' = 'MANUAL'): Field<T> => ({ value, source });

/**
 * Starting values for a new baseline. Only the monitor refresh rate is prefilled, and
 * only because it describes the monitor. The game's resolution is never prefilled
 * from the desktop: the spec forbids it, because a game can render at a resolution
 * the desktop is not using, and a wrong "observed" value is worse than an honest blank.
 */
export function emptySettings(observedRefreshHz: number | null): BaselineSettings {
  return {
    resolution: unknown(),
    refreshHz: isWithin(observedRefreshHz, BOUNDS.hz) ? known(observedRefreshHz as number, 'OBSERVED') : unknown(),
    displayMode: unknown(),
    frameCap: unknown(),
    vsync: unknown(),
    vrr: unknown(),
    vrrRange: unknown(),
    hdr: unknown(),
    latency: unknown(),
  };
}

export function missingRequired(settings: BaselineSettings): string[] {
  return REQUIRED_FIELDS.filter((field) => settings[field].source === 'UNKNOWN').map((field) => FIELD_LABELS[field]);
}

function isWithin(value: unknown, bounds: { min: number; max: number }): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= bounds.min && value <= bounds.max;
}

function isInteger(value: unknown, bounds: { min: number; max: number }): boolean {
  return isWithin(value, bounds) && Number.isInteger(value);
}

export function gameKeyFor(guideId: string | null, gameName: string): string {
  if (guideId) return `guide:${guideId}`;
  return `manual:${gameName.replace(/\s+/g, ' ').trim().toLowerCase()}`;
}

export function pairKey(gameKey: string, monitorKey: string): string {
  return `${gameKey}|${monitorKey}`;
}

export function baselineFor(baselines: DisplayBaseline[], gameKey: string, monitorKey: string): DisplayBaseline | null {
  const key = pairKey(gameKey, monitorKey);
  return baselines.find((baseline) => pairKey(baseline.context.gameKey, baseline.context.monitorKey) === key) ?? null;
}

/** One saved baseline per game and monitor: saving again replaces, never duplicates. */
export function upsertBaseline(baselines: DisplayBaseline[], next: DisplayBaseline): DisplayBaseline[] {
  const key = pairKey(next.context.gameKey, next.context.monitorKey);
  const others = baselines.filter((baseline) => pairKey(baseline.context.gameKey, baseline.context.monitorKey) !== key);
  return [next, ...others].slice(0, MAX_STORED_BASELINES);
}

export function removeBaseline(baselines: DisplayBaseline[], id: string): DisplayBaseline[] {
  return baselines.filter((baseline) => baseline.id !== id);
}

export interface CurrentContext {
  monitorPresent: boolean;
  observedRefreshHz: number | null;
  gpuName: string | null;
  driverVersion: string | null;
}

/**
 * Things that have changed since the baseline was saved. A driver update or a
 * different graphics card makes a before/after comparison meaningless without the
 * person knowing, so these are surfaced rather than silently ignored. The saved
 * baseline itself is never altered.
 */
export function contextChanges(baseline: DisplayBaseline, current: CurrentContext): string[] {
  const changes: string[] = [];
  if (!current.monitorPresent) {
    changes.push(`${baseline.context.monitorLabel} is not attached right now.`);
  }
  if (baseline.context.gpuName && current.gpuName && baseline.context.gpuName !== current.gpuName) {
    changes.push(`The graphics card changed from ${baseline.context.gpuName} to ${current.gpuName}.`);
  }
  if (baseline.context.driverVersion && current.driverVersion && baseline.context.driverVersion !== current.driverVersion) {
    changes.push(`The graphics driver changed from ${baseline.context.driverVersion} to ${current.driverVersion}.`);
  }
  const savedRefresh = baseline.settings.refreshHz;
  if (savedRefresh.source !== 'UNKNOWN' && savedRefresh.value !== null && current.monitorPresent
    && current.observedRefreshHz !== null && current.observedRefreshHz !== savedRefresh.value) {
    changes.push(`The monitor is now at ${current.observedRefreshHz} Hz; the baseline recorded ${savedRefresh.value} Hz.`);
  }
  return changes;
}

// --- Validation of stored data ------------------------------------------------------
// Stored baselines come back from local storage, which anything running as the user can
// edit. Each record is rebuilt field by field; a record that fails is dropped whole
// rather than partially trusted.

type Parser<T> = (value: unknown) => T | undefined;

function parseField<T>(raw: unknown, parseValue: Parser<T>): Field<T> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const { value, source } = raw as { value: unknown; source: unknown };
  if (source === 'UNKNOWN') return value === null ? unknown() : undefined;
  if (source !== 'OBSERVED' && source !== 'MANUAL') return undefined;
  const parsed = parseValue(value);
  return parsed === undefined ? undefined : { value: parsed, source };
}

const oneOf = <T extends string>(allowed: readonly T[]): Parser<T> =>
  (value) => (typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : undefined);

const parseResolution: Parser<{ width: number; height: number }> = (value) => {
  if (!value || typeof value !== 'object') return undefined;
  const { width, height } = value as { width: unknown; height: unknown };
  return isInteger(width, BOUNDS.pixels) && isInteger(height, BOUNDS.pixels) ? { width: width as number, height: height as number } : undefined;
};

const parseHz: Parser<number> = (value) => (isWithin(value, BOUNDS.hz) ? value as number : undefined);

const parseFrameCap: Parser<FrameCap> = (value) => (value === 'UNCAPPED' ? 'UNCAPPED' : isWithin(value, BOUNDS.fps) ? value as number : undefined);

const parseVrrRange: Parser<{ minHz: number; maxHz: number }> = (value) => {
  if (!value || typeof value !== 'object') return undefined;
  const { minHz, maxHz } = value as { minHz: unknown; maxHz: unknown };
  return isWithin(minHz, BOUNDS.hz) && isWithin(maxHz, BOUNDS.hz) && (minHz as number) < (maxHz as number)
    ? { minHz: minHz as number, maxHz: maxHz as number }
    : undefined;
};

function boundedText(value: unknown, limit: number): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : null;
}

export function parseSettings(raw: unknown): BaselineSettings | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const source = raw as Record<string, unknown>;
  const settings = {
    resolution: parseField(source.resolution, parseResolution),
    refreshHz: parseField(source.refreshHz, parseHz),
    displayMode: parseField(source.displayMode, oneOf(DISPLAY_MODES)),
    frameCap: parseField(source.frameCap, parseFrameCap),
    vsync: parseField(source.vsync, oneOf(SYNC_MODES)),
    vrr: parseField(source.vrr, oneOf(ON_OFF)),
    vrrRange: parseField(source.vrrRange, parseVrrRange),
    hdr: parseField(source.hdr, oneOf(ON_OFF)),
    latency: parseField(source.latency, oneOf(LATENCY_FEATURES)),
  };
  return Object.values(settings).every((field) => field !== undefined) ? settings as BaselineSettings : undefined;
}

function parseBaseline(raw: unknown): DisplayBaseline | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;
  if (record.schemaVersion !== 1) return undefined;
  if (typeof record.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(record.id)) return undefined;
  if (typeof record.savedAt !== 'string' || !Number.isFinite(Date.parse(record.savedAt))) return undefined;
  const context = record.context as Record<string, unknown> | undefined;
  if (!context || typeof context !== 'object') return undefined;
  const gameKey = boundedText(context.gameKey, 120);
  const gameName = boundedText(context.gameName, 80);
  const monitorKey = typeof context.monitorKey === 'string' && /^[0-9a-f]{16}$/.test(context.monitorKey) ? context.monitorKey : null;
  const monitorLabel = boundedText(context.monitorLabel, 160);
  if (!gameKey || !/^(guide|manual):/.test(gameKey) || !gameName || !monitorKey || !monitorLabel) return undefined;
  const guideId = typeof context.guideId === 'string' && /^[a-z0-9][a-z0-9-]{1,79}$/.test(context.guideId) ? context.guideId : null;
  const settings = parseSettings(record.settings);
  if (!settings) return undefined;
  return {
    schemaVersion: 1,
    id: record.id,
    savedAt: record.savedAt,
    context: {
      gameKey, gameName, guideId, monitorKey, monitorLabel,
      gpuName: boundedText(context.gpuName, 160),
      driverVersion: boundedText(context.driverVersion, 40),
    },
    settings,
  };
}

export function parseBaselines(raw: string | null): DisplayBaseline[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX_STORED_BASELINES).map(parseBaseline).filter((item): item is DisplayBaseline => item !== undefined);
  } catch {
    return [];
  }
}

/** Saving is best-effort: a storage failure must never lose what is on screen. */
export function saveBaselines(storage: Pick<Storage, 'setItem'>, baselines: DisplayBaseline[]): boolean {
  try {
    storage.setItem(DISPLAY_BASELINES_KEY, JSON.stringify(baselines.slice(0, MAX_STORED_BASELINES)));
    return true;
  } catch {
    return false;
  }
}

/** Plain-language rendering of one field, for summaries and confirmations. */
export function describeField(field: keyof BaselineSettings, settings: BaselineSettings): string {
  const entry = settings[field];
  if (entry.source === 'UNKNOWN' || entry.value === null) return 'Not known';
  const value = entry.value as unknown;
  switch (field) {
    case 'resolution': {
      const { width, height } = value as { width: number; height: number };
      return `${width} × ${height}`;
    }
    case 'refreshHz': return `${value} Hz`;
    case 'frameCap': return value === 'UNCAPPED' ? 'No cap' : `${value} FPS`;
    case 'vrrRange': {
      const { minHz, maxHz } = value as { minHz: number; maxHz: number };
      return `${minHz}–${maxHz} Hz`;
    }
    case 'displayMode': return ({ FULLSCREEN: 'Fullscreen', BORDERLESS: 'Borderless window', WINDOWED: 'Windowed' } as const)[value as DisplayMode];
    case 'vsync': return ({ OFF: 'Off', ON: 'On', ADAPTIVE: 'Adaptive', FAST: 'Fast Sync / Enhanced Sync' } as const)[value as SyncMode];
    case 'latency': return ({ NONE: 'None', REFLEX_ON: 'NVIDIA Reflex', REFLEX_BOOST: 'NVIDIA Reflex + Boost', ANTI_LAG: 'AMD Anti-Lag', ANTI_LAG_2: 'AMD Anti-Lag 2', XELL: 'Intel XeLL', OTHER: 'Other' } as const)[value as LatencyFeature];
    default: return value === 'ON' ? 'On' : value === 'OFF' ? 'Off' : String(value);
  }
}
