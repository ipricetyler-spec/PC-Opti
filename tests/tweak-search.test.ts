import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TWEAKS, tweakMatches } from '../src/lib/tweaks';

const titles = (query: string) => TWEAKS.filter((tweak) => tweakMatches(tweak, query)).map((tweak) => tweak.title);

test('short searches match the start of a word in a tweak title', () => {
  assert.ok(titles('se').includes('USB selective suspend'));
  assert.ok(!titles('se').includes('Mouse acceleration'), '"se" inside "Mouse" is not a match');
  assert.deepEqual(titles('usb'), ['USB selective suspend']);
});

test('longer searches also match anywhere in the title or summary', () => {
  assert.ok(titles('flicker').includes('Multiplane overlay (MPO)'));
  assert.ok(titles('suspend').includes('USB selective suspend'));
  assert.equal(titles('zzzz').length, 0);
  assert.equal(titles('').length, TWEAKS.length);
});
