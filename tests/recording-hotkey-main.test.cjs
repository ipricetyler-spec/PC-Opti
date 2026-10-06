const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

test('the recording hotkey takes only the offered keys, sends no data, and is released on quit', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /const RECORDING_HOTKEYS = Object\.freeze\(\['Control\+Shift\+F9', 'Control\+Shift\+F10', 'Control\+Alt\+F9', 'Control\+Alt\+F10'\]\);/);
  assert.match(main, /if \(accelerator !== null && !RECORDING_HOTKEYS\.includes\(accelerator\)\) throw new Error/);
  // One key at a time: the previous one is released before another is taken.
  assert.match(main, /if \(recordingHotkey\) \{ globalShortcut\.unregister\(recordingHotkey\); recordingHotkey = null; \}/);
  assert.match(main, /mainWindow\.webContents\.send\('pc-opti:recording-hotkey'\);/);
  assert.match(main, /app\.on\('will-quit', \(\) => globalShortcut\.unregisterAll\(\)\);/);
  const recorder = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'NativePresentMonCapture.tsx'), 'utf8');
  // The recorder releases the key when it closes.
  assert.match(recorder, /return \(\) => \{ live = false; void api\.setRecordingHotkey\?\.\(null\)/);
});