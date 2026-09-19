import type { AuditJournalEntry } from '../types';

const MAX_DISPLAY_LENGTH = 200;

// Labels for the per-user settings Dialed manages; anything else is not described.
const USER_SETTING_LABELS: Record<string, string> = { 'game-mode': 'Game Mode', 'background-recording': 'Game Bar background recording', 'gpu-scheduling': 'Hardware-accelerated GPU scheduling', mpo: 'Multiplane overlay (MPO)', 'global-timer-resolution': 'Global timer resolution requests', 'block-background-apps': 'Block background apps', 'exclude-driver-updates': 'Keep Windows Update from installing drivers', 'no-auto-restart': 'No automatic restart while signed in' };

function displayValue(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  // Control characters are refused by the main process before any write, but they must
  // not be able to disturb the confirmation text either.
  const printable = value.replace(/[\u0000-\u001f\u007f]/g, '\uFFFD');
  return printable.length > MAX_DISPLAY_LENGTH ? `${printable.slice(0, MAX_DISPLAY_LENGTH)}…` : printable;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * Describes exactly what a restore will write, for display in the confirmation.
 *
 * The audit journal is stored in per-user app data, so another program running as the
 * same user can add an entry to it. Dialed refuses shapes it could not have written,
 * but a plausible-looking forged entry is still possible, and the title alone does not
 * show what would be restored. These lines put the real target in front of the person
 * before they approve it.
 */
export function describeRollbackTarget(entry: AuditJournalEntry): string[] {
  const preAction = asRecord(entry.preAction);
  if (!preAction) return [];

  if (entry.rollback.kind === 'restore-registry-run-value') {
    const registryPath = displayValue(preAction.registryPath);
    const valueName = displayValue(preAction.valueName);
    const value = displayValue(preAction.value);
    const lines: string[] = [];
    if (registryPath) lines.push(`Startup location: ${registryPath}`);
    if (valueName) lines.push(`Entry name: ${valueName}`);
    if (value) lines.push(`Program it will start: ${value}`);
    return lines;
  }

  if (entry.rollback.kind === 'remove-power-plan') {
    const result = asRecord(entry.resultingState);
    const name = displayValue(result?.name);
    const guid = typeof result?.createdGuid === 'string' && /^[0-9a-f-]{36}$/.test(result.createdGuid) ? result.createdGuid : null;
    return [`Power plan to remove: ${name || 'the plan Dialed added'}`, ...(guid ? [`Plan id: ${guid}`] : [])];
  }

  if (entry.rollback.kind === 'restore-cpu-minimum-state') {
    const previous = typeof preAction.ac === 'number' && Number.isInteger(preAction.ac) && preAction.ac >= 0 && preAction.ac <= 100 ? `${preAction.ac}%` : null;
    const plan = displayValue(preAction.schemeName);
    return [`Minimum processor state (plugged in) will be set back to: ${previous ?? 'the previous value'}`, ...(plan ? [`Power plan: ${plan}`] : [])];
  }

  if (entry.rollback.kind === 'restore-mouse-acceleration') {
    const values = asRecord(preAction.values);
    const speed = asRecord(values?.MouseSpeed);
    const previous = speed?.exists === true && typeof speed.value === 'string' && /^\d{1,3}$/.test(speed.value) ? (speed.value === '0' ? 'off' : 'on') : 'the previous values';
    return ['Setting: Mouse acceleration (Enhance pointer precision)', `Will be set back to: ${previous}`];
  }

  if (entry.rollback.kind === 'restore-user-setting') {
    const label = USER_SETTING_LABELS[String(preAction.settingId)];
    if (!label) return [];
    const previous = preAction.existed === true && typeof preAction.value === 'number' ? (preAction.value === 0 ? 'off' : 'on') : 'the Windows default';
    return [`Setting: ${label}`, `Will be set back to: ${previous}`];
  }

  if (entry.rollback.kind === 'restore-gpu-preference') {
    const exePath = displayValue(preAction.exePath) || displayValue(preAction.path);
    return exePath ? [`Application: ${exePath}`] : [];
  }

  if (entry.rollback.kind === 'disable-process-ecoqos') {
    const name = displayValue(preAction.name);
    return name ? [`Program: ${name}`] : [];
  }

  if (entry.rollback.kind === 'restore-power-plan') {
    const previousName = displayValue(preAction.previousName) || displayValue(preAction.previousGuid);
    const targetName = displayValue(preAction.targetName);
    const lines: string[] = [];
    if (previousName) lines.push(`Power plan it will switch back to: ${previousName}`);
    if (targetName) lines.push(`Currently switching away from: ${targetName}`);
    return lines;
  }

  if (entry.rollback.kind === 'restore-consumer-features-policy') {
    const valueName = displayValue(preAction.valueName);
    const lines: string[] = [];
    if (valueName) lines.push(`Windows policy setting: ${valueName}`);
    lines.push(preAction.valueExists
      ? `It will be set back to: ${String(preAction.value)}`
      : 'It will be removed, which is how Windows had it before.');
    return lines;
  }

  if (entry.rollback.kind === 'restore-boot-timing-setting') {
    // actionId is checked against a fixed list in the main process before anything is
    // written, so it is safe to show, but it is a raw identifier — give it a plain name.
    const actionId = displayValue(preAction.actionId);
    if (!actionId) return [];
    const plainName = actionId.includes('clock-source')
      ? 'Automatic clock source selection'
      : actionId.includes('dynamic-tick')
        ? 'Dynamic tick'
        : actionId;
    return [`Windows boot setting: ${plainName}`, 'Takes effect after a restart.'];
  }

  return [];
}

/** The same disclosure, formatted as one block for a confirmation dialog. */
export function rollbackDisclosureText(entry: AuditJournalEntry): string {
  return describeRollbackTarget(entry).join('\n');
}
