const test = require('node:test');
const assert = require('node:assert/strict');
const { observedFor, normalizeInventory } = require('../src/main/bios-guidance/index.cjs');

const hardware = (overrides = {}) => normalizeInventory({
  memory: [{ configuredSpeed: 6000, ratedSpeed: 4800, memoryType: 34 }, { configuredSpeed: 6000, ratedSpeed: 4800, memoryType: 34 }],
  nvidia: { memoryMiB: 16376, bar1MiB: 16384, genCurrent: 4, genMax: 4, widthCurrent: 16, widthMax: 16 },
  ...overrides,
});

test('memory above its standard speed is observed without claiming EXPO is on', () => {
  const text = observedFor({ kind: 'memory' }, hardware());
  assert.match(text, /6000 MT\/s, above the modules' standard 4800/);
  assert.match(text, /profile or a manual setting appears to be active; Windows cannot tell which/);
  assert.doesNotMatch(text, /EXPO is on|XMP is on/);
  assert.match(observedFor({ kind: 'memory' }, hardware({ memory: [{ configuredSpeed: 4800, ratedSpeed: 4800, memoryType: 34 }] })), /standard speed\. No memory profile/);
  assert.equal(observedFor({ kind: 'memory' }, hardware({ memory: [{ configuredSpeed: 6000, memoryType: 34 }] })), null, 'no rated speed, nothing observed');
});

test('Resizable BAR and the PCIe link are reported only from NVIDIA readings', () => {
  assert.match(observedFor({ kind: 'rebar', gpuVendor: 'nvidia' }, hardware()), /16384 MiB BAR window.*when it is active/);
  assert.match(observedFor({ kind: 'rebar', gpuVendor: 'nvidia' }, hardware({ nvidia: { memoryMiB: 16376, bar1MiB: 256 } })), /usually means Resizable BAR is not active/);
  assert.equal(observedFor({ kind: 'rebar', gpuVendor: 'nvidia' }, hardware({ nvidia: null })), null);
  assert.match(observedFor({ kind: 'pcie' }, hardware()), /Gen 4 x16 right now.*check it during a game/);
  assert.match(observedFor({ kind: 'pcie' }, hardware({ nvidia: { genCurrent: 1, genMax: 4, widthCurrent: 8, widthMax: 16 } })), /narrower than the card supports \(x8 of x16\)/);
  assert.equal(observedFor({ kind: 'cpu' }, hardware()), null, 'CPU settings are never inferred');
});
