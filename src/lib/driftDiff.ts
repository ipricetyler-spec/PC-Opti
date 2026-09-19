/**
 * Turns a tracked change between two scans into a short list of what actually differs,
 * in plain language, instead of two walls of raw scan data to compare by eye.
 *
 * Scan evidence is wrapped as { status, value, source }. Only the fields that differ are
 * listed; everything identical is left out. List items (anti-cheat products, drives,
 * adapters) are matched by their name rather than their position, so a reordered list is
 * not reported as a change.
 *
 * A value going from "not returned" to a real value is not a change to the PC — the
 * earlier scan simply could not read it — so it is marked as such rather than presented
 * as something that changed.
 */

export interface DiffLine {
  /** Plain-language name of what differs, e.g. "Name" or "Easy Anti-Cheat · State". */
  field: string;
  before: string;
  after: string;
  /** True when the earlier value was only missing, not different. */
  filledIn: boolean;
}

export interface DriftSummary {
  lines: DiffLine[];
  /** True when every line is a value that was merely missing before. */
  onlyFilledIn: boolean;
  /** Evidence that became unavailable or available, described plainly. */
  availability: string | null;
}

const PLACEHOLDER = /^(?:name )?not (?:returned|reported|available)$/i;
const IDENTITY_KEYS = ['product', 'name', 'friendlyName', 'displayName', 'interfaceDescription', 'serviceName', 'driveLetter', 'id', 'guid'];
const MAX_LINES = 40;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPlaceholder(value: unknown): boolean {
  return value === null || value === undefined || value === '' || (typeof value === 'string' && PLACEHOLDER.test(value.trim()));
}

/** "driverPresent" → "Driver present", "serviceName" → "Service name". */
export function humanizeKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function describeValue(value: unknown): string {
  if (isPlaceholder(value)) return 'Not reported';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return Number.isInteger(value) ? value.toLocaleString('en-US') : String(Number(value.toFixed(2)));
  if (typeof value === 'string') return value.length > 120 ? `${value.slice(0, 120)}…` : value;
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`;
  return 'Details';
}

function identityOf(item: unknown, index: number): string {
  if (isRecord(item)) {
    for (const key of IDENTITY_KEYS) {
      const value = item[key];
      if (typeof value === 'string' && value.trim() && !isPlaceholder(value)) return value.trim();
    }
  }
  return `Item ${index + 1}`;
}

function walk(before: unknown, after: unknown, prefix: string, lines: DiffLine[]): void {
  if (lines.length >= MAX_LINES) return;
  if (Array.isArray(before) || Array.isArray(after)) {
    const left = Array.isArray(before) ? before : [];
    const right = Array.isArray(after) ? after : [];
    const leftById = new Map(left.map((item, index) => [identityOf(item, index), item]));
    const rightById = new Map(right.map((item, index) => [identityOf(item, index), item]));
    for (const [id, item] of leftById) {
      if (lines.length >= MAX_LINES) return;
      const label = prefix ? `${prefix} · ${id}` : id;
      if (!rightById.has(id)) lines.push({ field: label, before: 'Present', after: 'No longer listed', filledIn: false });
      else walk(item, rightById.get(id), label, lines);
    }
    for (const [id] of rightById) {
      if (lines.length >= MAX_LINES) return;
      if (!leftById.has(id)) lines.push({ field: prefix ? `${prefix} · ${id}` : id, before: 'Not listed', after: 'Now listed', filledIn: false });
    }
    return;
  }
  if (isRecord(before) || isRecord(after)) {
    const left = isRecord(before) ? before : {};
    const right = isRecord(after) ? after : {};
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
      walk(left[key], right[key], prefix ? `${prefix} · ${humanizeKey(key)}` : humanizeKey(key), lines);
    }
    return;
  }
  if (before === after || (isPlaceholder(before) && isPlaceholder(after))) return;
  lines.push({
    field: prefix || 'Value',
    before: describeValue(before),
    after: describeValue(after),
    filledIn: isPlaceholder(before) && !isPlaceholder(after),
  });
}

function unwrapEvidence(value: unknown): { status: string | null; value: unknown; reason: string | null } {
  if (isRecord(value) && typeof value.status === 'string' && ('value' in value || 'reason' in value)) {
    return { status: value.status, value: value.value ?? null, reason: typeof value.reason === 'string' ? value.reason : null };
  }
  return { status: null, value, reason: null };
}

export function summarizeDrift(before: unknown, after: unknown): DriftSummary {
  const left = unwrapEvidence(before);
  const right = unwrapEvidence(after);
  let availability: string | null = null;
  if (left.status && right.status && left.status !== right.status) {
    availability = right.status === 'AVAILABLE'
      ? 'This could not be read in the baseline scan and can be now.'
      : `This could be read in the baseline scan but not now${right.reason ? `: ${right.reason}` : '.'}`;
  } else if (before === null && after !== null) {
    availability = 'Not present in the baseline scan.';
  } else if (before !== null && after === null) {
    availability = 'No longer present in the current scan.';
  }
  const lines: DiffLine[] = [];
  walk(left.value, right.value, '', lines);
  return { lines, onlyFilledIn: lines.length > 0 && lines.every((line) => line.filledIn), availability };
}
