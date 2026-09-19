const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('Test a change never writes to Windows itself; only read and capture-state calls reach the native bridge', () => {
  const source = read('src/components/TestAChange.tsx');
  const calls = new Set([...source.matchAll(/window\.pcOptiNative\??\.(\w+)/g)].map((match) => match[1]));
  // Saving a comparison writes Dialed's own local evidence, never Windows state.
  assert.deepEqual([...calls].sort(), ['applyBenchmarkImport', 'getBootTime', 'getPresentMonCaptureState', 'prepareNativePresentMonImport', 'preparePresentMonImport', 'readDisplayModes']);
});

test('a tweak is applied and undone through the same confirmed, journaled paths as the Tweaks page', () => {
  const app = read('src/App.tsx');
  const apply = app.slice(app.indexOf('const applyTweakForTest'), app.indexOf('const undoEntryForTest'));
  assert.match(apply, /await executeTimingExperiment\(item\)/);
  assert.match(apply, /await toggleUserSetting\(card, /);
  assert.doesNotMatch(apply, /pcOptiNative\.(setUserSetting|executeTimingExperiment)/);
  // The change is linked to the journal entry the action wrote, never to a guess.
  assert.match(apply, /entry\.rollback\.available/);
  const undo = app.slice(app.indexOf('const undoEntryForTest'), app.indexOf('const openComparison'));
  assert.match(undo, /await rollbackAuditEntry\(entry, \{ stay: true \}\)/);
  assert.doesNotMatch(undo, /pcOptiNative\.rollbackAuditEntry/);
});

test('only reversible tweaks with a before/after effect are testable', () => {
  const app = read('src/App.tsx');
  const block = app.slice(app.indexOf('const TESTABLE_TWEAKS'), app.indexOf('const newestEntry'));
  for (const id of ['dynamic-tick', 'clock-source', 'cpu-minimum-state', 'global-timer-resolution', 'gpu-scheduling', 'game-mode', 'mpo', 'background-recording']) {
    assert.match(block, new RegExp(`'?${id}'?:`));
  }
  for (const id of ['temp-files', 'shader-caches', 'retrim', 'consumer-features', 'startup-apps']) assert.doesNotMatch(block, new RegExp(id));
});

test('the boot-time bridge is read-only and takes no input', () => {
  const main = read('electron/main.cjs');
  assert.match(main, /ipcMain\.handle\('pc-opti:get-boot-time', \(\) => new Date\(Date\.now\(\) - require\('node:os'\)\.uptime\(\) \* 1000\)\.toISOString\(\)\);/);
  assert.match(read('electron/preload.cjs'), /getBootTime: \(\) => ipcRenderer\.invoke\('pc-opti:get-boot-time'\)/);
});

test('display tests keep the monitor and graphics-card check, and older display experiments keep their steps', () => {
  const component = read('src/components/TestAChange.tsx');
  assert.match(component, /contextChanges\(baseline, \{/);
  assert.match(component, /not a like-for-like comparison/);
  const guide = read('src/components/DisplaySetupGuide.tsx');
  assert.match(guide, /existingBaseline && legacyExperimentInProgress\(existingBaseline\.id\)\s*\? <DisplayExperimentSteps/);
  assert.match(guide, /Step 3 · Test a display setting/);
});

test('a test builds its comparison from what it knows and marks the rest "Not recorded"', () => {
  const source = read('src/components/TestAChange.tsx');
  const save = source.slice(source.indexOf('const saveComparison'), source.indexOf('// For a test started from Display setup'));
  assert.match(save, /sessionPairIssue\(session, captures, history\)/);
  assert.match(save, /value\.trim\(\) \|\| known\[field\] \|\| 'Not recorded'/);
  assert.match(save, /\(not checked by Dialed\)/);
});

test('inside a test the recorder never falls back to the first running program', () => {
  const recorder = read('src/components/NativePresentMonCapture.tsx');
  assert.match(recorder, /setTargetId\(wanted\?\.targetId \|\| \(preferTarget !== undefined \? '' : inventory\.items\[0\]\?\.targetId \|\| ''\)\)/);
  assert.match(read('src/components/TestAChange.tsx'), /<NativePresentMonCapture compact preferTarget=\{test\.game\}/);
});
