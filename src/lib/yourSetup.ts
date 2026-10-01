import type { MeasuredRate } from './measuredRates';

// "Your setup" on Home: what is set now, each labelled as read from Windows, measured, or recorded
// by Dialed, with a date for anything measured. Unknown stays unknown: a value Dialed could not read
// says so, and nothing is called optimized, maxed or scored.

export type SetupSection = 'power' | 'input' | 'games' | 'network';
export interface SetupLine { key: SetupSection; label: string; value: string; source: 'Read from Windows' | 'Measured' | 'Recorded by Dialed' | 'Not checked yet' | 'Could not read' }

const day = (iso: string, now: Date) => {
  const at = new Date(iso);
  return at.toDateString() === now.toDateString() ? 'today' : at.toLocaleDateString([], { day: 'numeric', month: 'short' });
};

export function yourSetupLines(input: {
  /** undefined: still reading or unavailable; null: Windows did not report one. */
  powerPlan: string | null | undefined;
  powerPlanError?: boolean;
  lastRate: MeasuredRate | null;
  /** Games Dialed applied a profile to, newest first; null when the list could not be read. */
  appliedProfiles: Array<{ game: string; at: string }> | null;
  lastNetwork: { line: string } | null | undefined;
  now?: Date;
}): SetupLine[] {
  const now = input.now ?? new Date();
  const lines: SetupLine[] = [];
  lines.push(input.powerPlanError || input.powerPlan === null
    ? { key: 'power', label: 'Power plan', value: 'Could not read the active plan', source: 'Could not read' }
    : input.powerPlan === undefined
      ? { key: 'power', label: 'Power plan', value: 'Reading…', source: 'Not checked yet' }
      : { key: 'power', label: 'Power plan', value: input.powerPlan, source: 'Read from Windows' });
  lines.push(input.lastRate
    ? { key: 'input', label: 'Polling rate', value: `${input.lastRate.name ? `${input.lastRate.name}: ` : ''}about ${input.lastRate.reportsPerSecond.toLocaleString()} reports/s, ${day(input.lastRate.at, now)}`, source: 'Measured' }
    : { key: 'input', label: 'Polling rate', value: 'No rate check yet', source: 'Not checked yet' });
  lines.push(input.appliedProfiles === null
    ? { key: 'games', label: 'Game profiles', value: 'Could not read game backups', source: 'Could not read' }
    : input.appliedProfiles.length
      // Dialed's record, not a fresh read of the game's file: the game or another tool may have changed it since.
      ? { key: 'games', label: 'Game profiles', value: `Applied and not undone: ${input.appliedProfiles.map((item) => `${item.game} (${day(item.at, now)})`).join(', ')}`, source: 'Recorded by Dialed' }
      : { key: 'games', label: 'Game profiles', value: 'None applied by Dialed', source: 'Recorded by Dialed' });
  lines.push(input.lastNetwork
    ? { key: 'network', label: 'Network', value: input.lastNetwork.line, source: 'Measured' }
    : { key: 'network', label: 'Network', value: input.lastNetwork === undefined ? 'Could not read saved tests' : 'No saved network test yet', source: input.lastNetwork === undefined ? 'Could not read' : 'Not checked yet' });
  return lines;
}
