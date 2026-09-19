export function benchmarkNeedsReview(comparisons) {
  return comparisons.some((comparison) => comparison.classification !== 'MEASURED_DIFFERENCE');
}

export function computeReadinessState(input) {
  const blockers = [];
  const reviewItems = [];
  if (!input.hasSnapshot) blockers.push('Dialed has not finished scanning this PC yet.');
  if (input.requiredCapabilityUnavailable) blockers.push('Something Dialed needs to make or undo changes is unavailable.');
  if (input.scanError) reviewItems.push('The last scan hit an error.');
  if (input.historyRecovery || input.unresolvedHistory > 0) reviewItems.push('A change in your history did not finish or could not be confirmed.');
  if (input.driftError) reviewItems.push('Dialed could not compare this PC with your saved snapshot.');
  if (input.antiCheatStatus === 'WARN') reviewItems.push('Anti-cheat software is running, so Dialed is being extra careful with game-related changes.');
  if (input.reviewRecommendations > 0) reviewItems.push('A suggestion needs your decision.');
  if (benchmarkNeedsReview(input.benchmarkComparisons || [])) reviewItems.push('A performance test is unfinished, unclear, or showed things got worse.');
  return {
    state: blockers.length > 0 ? 'Blocked' : reviewItems.length > 0 ? 'Review' : 'Ready',
    blockers,
    reviewItems,
  };
}
