import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RECORDING_HOTKEYS, hotkeyAction, hotkeyLabel } from '../src/lib/recordingHotkey';

test('the hotkey starts only a recording already confirmed in Dialed, and stops one in progress', () => {
  const ready = { recording: false, busy: false, toolReady: true, targetChosen: true, approved: true };
  assert.equal(hotkeyAction(ready), 'START');
  assert.equal(hotkeyAction({ ...ready, approved: false }), 'REFUSE', 'a confirmation cannot be shown over a game');
  assert.equal(hotkeyAction({ ...ready, toolReady: false }), 'REFUSE');
  assert.equal(hotkeyAction({ ...ready, targetChosen: false }), 'REFUSE');
  assert.equal(hotkeyAction({ ...ready, busy: true }), 'REFUSE');
  assert.equal(hotkeyAction({ ...ready, recording: true, approved: false }), 'STOP');
  assert.equal(hotkeyAction({ ...ready, recording: true, busy: true }), 'REFUSE');
  assert.deepEqual([...RECORDING_HOTKEYS], ['Control+Shift+F9', 'Control+Shift+F10', 'Control+Alt+F9', 'Control+Alt+F10']);
  assert.equal(hotkeyLabel('Control+Shift+F9'), 'Ctrl + Shift + F9');
});