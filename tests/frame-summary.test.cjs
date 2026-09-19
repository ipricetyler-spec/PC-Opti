const test = require('node:test');
const assert = require('node:assert/strict');
const { isFrameSummary, summarizeCapture, summarizeFrames } = require('../src/main/presentmon/frame-summary.cjs');

test('average FPS is frames over time and the 1% low comes from the slowest frames', () => {
  // 99 frames at 5 ms and one at 20 ms: 100 frames in 515 ms.
  const summary = summarizeFrames('game.exe', [...Array(99).fill(5), 20]);
  assert.equal(summary.frames, 100);
  assert.equal(summary.averageFps, Math.round((1000 / 5.15) * 100) / 100);
  assert.equal(summary.p99FrameMs, 5);
  assert.equal(summarizeFrames('game.exe', [...Array(98).fill(5), 20, 20]).onePercentLowFps, 50);
});

test('a steady frame rate is reported as likely capped, a wandering one is not', () => {
  const capped = summarizeFrames('game.exe', Array.from({ length: 500 }, (_, index) => 7.09 + (index % 3) * 0.05));
  assert.equal(capped.capLikely, true);
  assert.equal(capped.capFps, 140);
  const uncapped = summarizeFrames('game.exe', Array.from({ length: 500 }, (_, index) => 4 + (index % 10) * 0.4));
  assert.equal(uncapped.capLikely, false);
  assert.equal(uncapped.capFps, null);
});

test('too few frames give no summary, and the busiest application is used', () => {
  assert.equal(summarizeFrames('game.exe', [5, 5, 5]), null);
  const summary = summarizeCapture([{ application: 'overlay.exe', samples: Array(40).fill(16) }, { application: 'game.exe', samples: Array(400).fill(5) }]);
  assert.equal(summary.application, 'game.exe');
});

test('saved summaries are validated before being shown', () => {
  assert.equal(isFrameSummary(summarizeFrames('game.exe', Array(100).fill(5))), true);
  assert.equal(isFrameSummary({ application: 'x', frames: -1 }), false);
  assert.equal(isFrameSummary(null), true);
});
