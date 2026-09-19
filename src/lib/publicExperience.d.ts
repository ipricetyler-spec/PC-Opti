import type { BenchmarkComparison } from '../types';

export function benchmarkNeedsReview(comparisons: BenchmarkComparison[]): boolean;
export function computeReadinessState(input: {
  hasSnapshot: boolean;
  requiredCapabilityUnavailable?: boolean;
  scanError?: boolean;
  historyRecovery?: boolean;
  unresolvedHistory: number;
  driftError?: boolean;
  antiCheatStatus: 'PASS' | 'WARN' | 'BLOCKED' | 'UNKNOWN';
  reviewRecommendations: number;
  benchmarkComparisons: BenchmarkComparison[];
}): { state: 'Ready' | 'Review' | 'Blocked'; blockers: string[]; reviewItems: string[] };
