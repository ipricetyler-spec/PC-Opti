'use strict';

// A per-run summary of frame times, saved with each capture so experiments can judge
// run-to-run variation, spot a frame cap and show a readable result without re-reading
// the CSV. Frame times are milliseconds between presented frames; they describe how
// evenly frames were delivered, not input latency.

// A run counts as "looks capped" when this share of frames sits within this tolerance
// of the median. Uncapped games wander far more than this frame to frame.
const CAP_TOLERANCE = 0.03;
const CAP_SHARE = 0.8;
const MIN_FRAMES = 30;

function percentile(sorted, fraction) {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
}

function round(value, places = 2) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/**
 * Summarizes one application's frame times. Returns null when there are too few frames
 * to say anything useful.
 */
function summarizeFrames(application, samples) {
  const frames = Array.isArray(samples) ? samples.filter((value) => typeof value === 'number' && Number.isFinite(value) && value > 0) : [];
  if (frames.length < MIN_FRAMES) return null;
  const sorted = [...frames].sort((left, right) => left - right);
  const total = frames.reduce((sum, value) => sum + value, 0);
  const meanMs = total / frames.length;
  const medianMs = percentile(sorted, 0.5);
  const p99Ms = percentile(sorted, 0.99);
  const p5Ms = percentile(sorted, 0.05);
  const p95Ms = percentile(sorted, 0.95);
  const nearMedian = frames.filter((value) => Math.abs(value - medianMs) <= medianMs * CAP_TOLERANCE).length / frames.length;
  const capLikely = nearMedian >= CAP_SHARE;
  return {
    application: String(application).slice(0, 120),
    frames: frames.length,
    // Frames divided by elapsed time, which is what "average FPS" means.
    averageFps: round(1000 / meanMs),
    // The FPS of the slowest 1% of frames.
    onePercentLowFps: round(1000 / p99Ms),
    medianFrameMs: round(medianMs, 3),
    p99FrameMs: round(p99Ms, 3),
    // Width of the middle 90% of frame times relative to the median: lower is steadier.
    spreadPercent: round(((p95Ms - p5Ms) / medianMs) * 100),
    capLikely,
    capFps: capLikely ? Math.round(1000 / medianMs) : null,
  };
}

/** The summary for the application with the most frames — the game, in practice. */
function summarizeCapture(applications) {
  const main = (applications || []).reduce((best, item) => (!best || item.samples.length > best.samples.length ? item : best), null);
  return main ? summarizeFrames(main.application, main.samples) : null;
}

function isFrameSummary(value) {
  if (value === null) return true;
  if (!value || typeof value !== 'object') return false;
  const numbers = ['frames', 'averageFps', 'onePercentLowFps', 'medianFrameMs', 'p99FrameMs', 'spreadPercent'];
  return typeof value.application === 'string' && value.application.length <= 120
    && numbers.every((key) => typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] >= 0)
    && typeof value.capLikely === 'boolean'
    && (value.capFps === null || (Number.isInteger(value.capFps) && value.capFps > 0));
}

module.exports = { CAP_SHARE, CAP_TOLERANCE, isFrameSummary, summarizeCapture, summarizeFrames };
