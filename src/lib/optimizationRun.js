export const OPTIMIZATION_RUN_TONES = Object.freeze({
  idle: 'idle',
  running: 'running',
  success: 'success',
  warning: 'warning',
  failure: 'failure',
});

export function summarizeOptimizationRun(entries, running) {
  const counts = {
    queued: 0,
    running: 0,
    success: 0,
    skipped: 0,
    failed: 0,
    needsReview: 0,
  };

  for (const entry of entries) {
    if (entry?.status === 'QUEUED') counts.queued += 1;
    else if (entry?.status === 'RUNNING') counts.running += 1;
    else if (entry?.status === 'SUCCESS') counts.success += 1;
    else if (entry?.status === 'SKIPPED') counts.skipped += 1;
    else if (entry?.status === 'FAILED') counts.failed += 1;
    else if (entry?.status === 'NEEDS_REVIEW') counts.needsReview += 1;
  }

  const total = entries.length;
  const unfinished = counts.queued + counts.running;
  const finished = total - unfinished;

  if (total === 0) return { code: 'IDLE', label: '', tone: OPTIMIZATION_RUN_TONES.idle, counts, total, finished, unfinished };
  if (running) return { code: 'RUNNING', label: 'RUNNING', tone: OPTIMIZATION_RUN_TONES.running, counts, total, finished, unfinished };
  if (unfinished > 0) return { code: 'INTERRUPTED', label: 'RUN INTERRUPTED', tone: OPTIMIZATION_RUN_TONES.warning, counts, total, finished, unfinished };
  if (counts.failed > 0) return { code: 'FAILURES', label: 'COMPLETED WITH FAILURES', tone: OPTIMIZATION_RUN_TONES.failure, counts, total, finished, unfinished };
  if (counts.needsReview > 0 || counts.skipped > 0) return { code: 'WARNINGS', label: 'COMPLETED WITH WARNINGS', tone: OPTIMIZATION_RUN_TONES.warning, counts, total, finished, unfinished };
  return { code: 'SUCCESS', label: 'RUN COMPLETE', tone: OPTIMIZATION_RUN_TONES.success, counts, total, finished, unfinished };
}
