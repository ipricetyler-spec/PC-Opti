import type { DisplayModeReport, InstalledGameDiscovery, SystemScanSnapshot } from '../types';

/**
 * Step 1 of the Display setup workflow: choose which game, which monitor and — when
 * Windows cannot tell us — which GPU actually drives that monitor.
 *
 * Everything here is pure so it can be tested without Electron. Nothing in this module
 * reads or writes a display setting; the choices are recorded locally and used to label
 * evidence later in the workflow.
 */

export const DISPLAY_SETUP_KEY = 'dialed-display-setup:v1';

export type GpuAssociation = 'SINGLE_GPU' | 'NEEDS_USER_CHOICE' | 'USER_CHOSEN' | 'UNKNOWN';

export interface DisplaySetupSelection {
  schemaVersion: 1;
  /** Hash of the monitor DeviceID. Null until a monitor with an identity is chosen. */
  monitorKey: string | null;
  /** Shown to the person so a stale selection is recognisable. */
  monitorLabel: string | null;
  /** A detected game's guideId, or null when the game was described manually. */
  guideId: string | null;
  /** Free text, used only when no detected game was chosen. */
  manualGameName: string | null;
  /** Which GPU the person says drives the chosen monitor, when Windows cannot say. */
  gpuName: string | null;
  updatedAt: string;
}

export interface GraphicsAdapter {
  name: string;
  driverVersion: string;
  vendor: string;
}

export const EMPTY_SELECTION: DisplaySetupSelection = {
  schemaVersion: 1,
  monitorKey: null,
  monitorLabel: null,
  guideId: null,
  manualGameName: null,
  gpuName: null,
  updatedAt: '',
};

const MAX_MANUAL_GAME_NAME = 80;

/** A monitor the person can choose, built from the display-modes read. */
export interface SelectableMonitor {
  monitorKey: string | null;
  label: string;
  detail: string;
  primary: boolean;
  selectable: boolean;
}

/** The friendly names Windows gives through the other display reader, e.g. "Example 360Hz Monitor". */
export interface NamedDisplay {
  label: string;
  refreshRateHz: number | null;
  logicalWidth?: number | null;
  logicalHeight?: number | null;
  scaleFactor?: number | null;
  primary?: boolean;
}

/**
 * Windows often reports every panel's monitor-level name as "Generic PnP Monitor", which
 * would make two monitors indistinguishable in the list. The desktop display reader has
 * the real model names (from each monitor's EDID), so a generic entry borrows the name of
 * the one display that matches it: same refresh rate, then same resolution, then the same
 * main-display flag. When no single display matches, it falls back to a positional label
 * with the refresh rate rather than guessing.
 */
export function monitorDisplayName(display: DisplayModeReport['displays'][number], index: number, named: NamedDisplay[]): string {
  const reported = display.monitorName && !/generic/i.test(display.monitorName) ? display.monitorName : null;
  if (reported) return reported;
  const physical = (item: NamedDisplay) => item.logicalWidth && item.logicalHeight
    ? `${Math.round(item.logicalWidth * (item.scaleFactor || 1))}x${Math.round(item.logicalHeight * (item.scaleFactor || 1))}` : null;
  const narrowings: Array<(item: NamedDisplay) => boolean> = [
    (item) => display.currentHz !== null && item.refreshRateHz !== null && Math.round(item.refreshRateHz) === display.currentHz,
    (item) => display.currentWidth !== null && display.currentHeight !== null && physical(item) === `${display.currentWidth}x${display.currentHeight}`,
    (item) => item.primary === display.primary,
  ];
  let candidates = named;
  for (const matches of narrowings) {
    const narrowed = candidates.filter(matches);
    if (narrowed.length === 1) return narrowed[0].label;
    if (narrowed.length > 1) candidates = narrowed;
  }
  return display.currentHz !== null ? `Display ${index + 1} · ${display.currentHz} Hz` : display.label;
}

/**
 * The monitors the person can choose. An entry with no stable identity is listed but not
 * selectable — a baseline keyed to nothing could not be matched later.
 */
export function selectableMonitors(report: DisplayModeReport | null, named: NamedDisplay[] = []): SelectableMonitor[] {
  if (!report) return [];
  return report.displays.map((display, index) => {
    const resolution = display.currentWidth !== null && display.currentHeight !== null
      ? `${display.currentWidth} × ${display.currentHeight}`
      : 'Resolution unknown';
    const rate = display.currentHz !== null ? `${display.currentHz} Hz` : 'Refresh rate unknown';
    return {
      monitorKey: display.monitorKey,
      label: monitorDisplayName(display, index, named),
      detail: `${resolution} · ${rate}${display.primary ? ' · Main display' : ''}`,
      primary: display.primary,
      selectable: display.monitorKey !== null,
    };
  });
}

/** Reads the graphics adapters already present in the scan snapshot. */
export function graphicsAdapters(snapshot: SystemScanSnapshot | null): GraphicsAdapter[] {
  const evidence = snapshot?.diagnostics?.graphics;
  if (!evidence || evidence.status !== 'AVAILABLE') return [];
  return evidence.value
    .filter((adapter) => adapter.name && adapter.name !== 'Name not returned')
    .map((adapter) => ({
      name: adapter.name,
      driverVersion: adapter.driverVersion,
      vendor: adapter.adapterCompatibility,
    }));
}

/**
 * Windows lists every graphics adapter, but it does not say which one is driving a
 * given monitor. On a laptop with switchable graphics that association genuinely cannot
 * be read here, so when more than one adapter exists the person is asked rather than
 * guessed at. Guessing would silently label evidence with the wrong GPU.
 */
export function gpuAssociation(adapters: GraphicsAdapter[], chosen: string | null): GpuAssociation {
  if (adapters.length === 0) return 'UNKNOWN';
  if (adapters.length === 1) return 'SINGLE_GPU';
  if (chosen && adapters.some((adapter) => adapter.name === chosen)) return 'USER_CHOSEN';
  return 'NEEDS_USER_CHOICE';
}

/** The adapter the workflow should record, or null while the question is unanswered. */
export function effectiveGpu(adapters: GraphicsAdapter[], chosen: string | null): GraphicsAdapter | null {
  const association = gpuAssociation(adapters, chosen);
  if (association === 'SINGLE_GPU') return adapters[0];
  if (association === 'USER_CHOSEN') return adapters.find((adapter) => adapter.name === chosen) ?? null;
  return null;
}

export function normalizeManualGameName(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_MANUAL_GAME_NAME);
}

/** The chosen game's display name, from either source, or null when none is chosen. */
export function chosenGameName(selection: DisplaySetupSelection, discovery: InstalledGameDiscovery | null): string | null {
  if (selection.guideId) {
    const detected = discovery?.games.find((game) => game.guideId === selection.guideId);
    return detected ? detected.game : null;
  }
  return selection.manualGameName || null;
}

export interface SetupCompleteness {
  hasMonitor: boolean;
  hasGame: boolean;
  hasGpu: boolean;
  complete: boolean;
  /** What is still needed, in the order the screen asks for it. */
  missing: string[];
}

export function setupCompleteness(
  selection: DisplaySetupSelection,
  adapters: GraphicsAdapter[],
  discovery: InstalledGameDiscovery | null,
): SetupCompleteness {
  const hasMonitor = selection.monitorKey !== null;
  const hasGame = chosenGameName(selection, discovery) !== null;
  const hasGpu = effectiveGpu(adapters, selection.gpuName) !== null;
  const missing: string[] = [];
  if (!hasGame) missing.push('Choose the game');
  if (!hasMonitor) missing.push('Choose the monitor you play on');
  if (!hasGpu) missing.push('Say which graphics card drives that monitor');
  return { hasMonitor, hasGame, hasGpu, complete: missing.length === 0, missing };
}

/**
 * A selection saved earlier can refer to a monitor that is no longer attached. The
 * spec requires that this be marked stale and the evidence kept, rather than silently
 * substituting whichever monitor happens to be present now.
 */
export function selectionIsStale(selection: DisplaySetupSelection, report: DisplayModeReport | null): boolean {
  if (!selection.monitorKey || !report) return false;
  return !report.displays.some((display) => display.monitorKey === selection.monitorKey);
}

export function parseSelection(raw: string | null): DisplaySetupSelection {
  if (!raw) return EMPTY_SELECTION;
  try {
    const parsed = JSON.parse(raw) as Partial<DisplaySetupSelection>;
    if (!parsed || typeof parsed !== 'object' || parsed.schemaVersion !== 1) return EMPTY_SELECTION;
    const text = (value: unknown, limit: number): string | null =>
      typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : null;
    return {
      schemaVersion: 1,
      monitorKey: typeof parsed.monitorKey === 'string' && /^[0-9a-f]{16}$/.test(parsed.monitorKey) ? parsed.monitorKey : null,
      monitorLabel: text(parsed.monitorLabel, 160),
      guideId: typeof parsed.guideId === 'string' && /^[a-z0-9][a-z0-9-]{1,79}$/.test(parsed.guideId) ? parsed.guideId : null,
      manualGameName: text(parsed.manualGameName, MAX_MANUAL_GAME_NAME),
      gpuName: text(parsed.gpuName, 160),
      updatedAt: text(parsed.updatedAt, 40) ?? '',
    };
  } catch {
    return EMPTY_SELECTION;
  }
}

/** Saving is best-effort: a storage failure must never lose what is on screen. */
export function saveSelection(storage: Pick<Storage, 'setItem'>, selection: DisplaySetupSelection): boolean {
  try {
    storage.setItem(DISPLAY_SETUP_KEY, JSON.stringify({ ...selection, updatedAt: new Date().toISOString() }));
    return true;
  } catch {
    return false;
  }
}
