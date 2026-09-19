import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TWEAKS, batchActionFor } from '../src/lib/tweaks';

const card = (id: string) => {
  const found = TWEAKS.find((tweak) => tweak.id === id);
  if (!found) throw new Error(id);
  return found;
};

test('an on/off card flips its current state, exactly like its own button', () => {
  assert.deepEqual(batchActionFor(card('game-mode'), { enabled: false, manageable: true }), { settingId: 'game-mode', enable: true, label: 'Turn on', from: 'off', to: 'on' });
  assert.equal(batchActionFor(card('game-mode'), { enabled: true, manageable: true })?.enable, false);
});

test('one-way cards are selectable only while their change is not made yet', () => {
  assert.equal(batchActionFor(card('usb-selective-suspend'), { enabled: false, manageable: true })?.label, 'Turn off');
  assert.equal(batchActionFor(card('usb-selective-suspend'), { enabled: true, manageable: true }), null);
  assert.equal(batchActionFor(card('cpu-minimum-state'), { enabled: false, manageable: true })?.enable, true);
});

test('a setting changed outside Dialed returns to the Windows default', () => {
  const action = batchActionFor(card('mpo'), { enabled: false, manageable: true, windowsDefault: true }, true);
  assert.equal(action?.label, 'Return to Windows default');
  assert.equal(action?.enable, true);
});

test('a leftover policy can be removed, and nothing else is offered on an edition that ignores it', () => {
  assert.equal(batchActionFor(card('exclude-driver-updates'), { enabled: null, manageable: false, unsupported: 'Home ignores it.', leftover: true })?.label, 'Remove leftover');
  assert.equal(batchActionFor(card('exclude-driver-updates'), { enabled: null, manageable: false, unsupported: 'Home ignores it.', leftover: false }), null);
  assert.equal(batchActionFor(card('consumer-features'), { enabled: null, manageable: false, unsupported: 'Home ignores it.', leftover: true })?.enable, false, 'suggested content can only be removed, never turned on');
});

test('cards without a direct change are never selectable', () => {
  assert.equal(batchActionFor(card('power-plan'), { enabled: true, manageable: true }), null, 'opens a page instead');
  assert.equal(batchActionFor(card('dynamic-tick'), undefined), null, 'experiments batch in Recommended');
  assert.equal(batchActionFor(card('game-mode'), { enabled: null, manageable: true }), null, 'unknown state');
  assert.equal(batchActionFor(card('game-mode'), { enabled: true, manageable: false }), null, 'stored in a form Dialed will not overwrite');
  assert.equal(batchActionFor(card('game-mode'), undefined), null, 'not read yet');
});

test('a one-way change shows the current value in words when Windows reported it', () => {
  assert.equal(batchActionFor(card('usb-selective-suspend'), { enabled: false, manageable: true, detail: 'On when plugged in (Balanced)' })?.from, 'On when plugged in (Balanced)');
});
