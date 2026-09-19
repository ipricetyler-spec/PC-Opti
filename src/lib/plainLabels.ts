const LABELS: Record<string, string> = {
  SUCCESS: 'Completed',
  FAILED: 'Failed',
  NEEDS_REVIEW: 'Needs review',
  PENDING: 'Not finished',
  ADDED: 'Added',
  REMOVED: 'Removed',
  CHANGED: 'Changed',
  MEASURED_DIFFERENCE: 'It helped',
  REGRESSION: 'Got worse',
  INCONCLUSIVE: 'No clear difference',
  HIGH_VARIANCE: 'Too inconsistent to judge',
  INCOMPLETE: 'Needs more captures',
  INCOMPARABLE: 'Not comparable',
  INTENDED_STATE: 'Change is in place',
  PRE_ACTION_STATE: 'Change did not take effect',
  DIVERGED: 'Changed by something else',
  TARGET_CHANGED: 'Target no longer running',
  UNKNOWN: 'Could not be determined',
  UNAVAILABLE: 'Could not be read',
  OPTIONAL_ACTION: 'Optional fix',
  GUIDANCE_ONLY: 'Tip',
  REVIEW: 'Review',
  NO_ACTION: 'No action needed',
  VERIFIED_GUIDANCE: 'Reviewed guide',
  MANUAL_ONLY: 'Manual steps',
  COMPLETE: 'Complete',
  PARTIAL: 'Partial',
  OFFLINE: 'Unreachable',
  CANCELED: 'Canceled',
  AVAILABLE: 'Available',
  TIMED: 'Finished on time',
};

// Maps internal status codes to the words a customer sees. Unknown codes fall back to
// sentence case so a new code never appears as SHOUTED_SNAKE_CASE.
export function plainLabel(code: string | null | undefined) {
  if (!code) return 'Unknown';
  if (LABELS[code]) return LABELS[code];
  const words = code.replaceAll('_', ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
