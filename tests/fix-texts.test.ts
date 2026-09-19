import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { FIX_TEXTS, WHY_LISTED, fixTextsFor } from '../src/lib/fixTexts';

const require = createRequire(import.meta.url);
const capabilities = require('../src/main/capabilities/index.cjs');
const registry: Array<{ id: string; rollbackMethod: string }> = capabilities.CAPABILITIES || Object.values(capabilities).find(Array.isArray);

test('every plain text belongs to a real capability', () => {
  const ids = new Set(registry.map((item) => item.id));
  for (const id of Object.keys(FIX_TEXTS)) assert.ok(ids.has(id), id);
});

test('fixes that cannot be undone still say so', () => {
  for (const item of registry.filter((entry) => FIX_TEXTS[entry.id] && /^Unavailable$/.test(entry.rollbackMethod))) {
    assert.match(FIX_TEXTS[item.id].undo, /cannot be brought back/, item.id);
  }
  assert.match(FIX_TEXTS['maintenance:retrim-drive'].undo, /Nothing to undo/);
});

test('when undo is refused is still stated', () => {
  for (const id of ['startup:disable-current-user-run', 'startup:disable-machine-run', 'policy:disable-windows-consumer-features', 'timing:restore-automatic-clock-source', 'timing:disable-dynamic-tick']) {
    assert.match(FIX_TEXTS[id].undo, /Undo is refused if/, id);
  }
});

test('the plain texts use no technical jargon', () => {
  const all = [...Object.values(FIX_TEXTS).flatMap((item) => Object.values(item)), ...Object.values(WHY_LISTED)].join(' ');
  assert.doesNotMatch(all, /Registry|PID|EcoQoS|Remove-Item|BCD|useplatformclock|disabledynamictick|DWORD|pre-state|Get-ComputerRestorePoint/i);
});

test('an unknown capability falls back to the registry', () => {
  assert.equal(fixTextsFor('not:a-capability'), null);
});
