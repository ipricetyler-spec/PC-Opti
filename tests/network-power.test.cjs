const assert = require('node:assert/strict');
const { test } = require('node:test');
const { tempDir } = require('./helpers/temp-dir.cjs');
const networkPower = require('../src/main/network-power/index.cjs');
const journal = require('../src/main/journal/index.cjs');
const capabilities = require('../src/main/capabilities/index.cjs');

const GUID = '{230E5759-AD06-4B42-8DCB-8602ADFCC80F}';
// The shape PowerShell returns, as read on the owner's Realtek 2.5GbE adapter (all off there).
const raw = (values) => [{ guid: GUID, name: 'Ethernet', description: 'Realtek PCIe 2.5GbE Family Controller', settings: [
  { keyword: '*EEE', value: values.eee, valid: ['0', '1'] },
  { keyword: 'EnableGreenEthernet', value: values.green, valid: ['0', '1'] },
  { keyword: 'EEEMaxSupportSpeed', value: '1000', valid: ['10', '100', '1000', '2500'] },
  { keyword: 'PowerSavingMode', value: '0', valid: ['0', '1'] },
] }];

test('only known on/off power-saving properties on wired adapters are read', () => {
  const adapters = networkPower.normalizeAdapters(raw({ eee: '1', green: '0' }));
  assert.equal(adapters.length, 1);
  assert.deepEqual(adapters[0].settings.map((item) => item.keyword), ['*EEE', 'EnableGreenEthernet', 'PowerSavingMode'], 'the speed setting is not on/off and is ignored');
  assert.deepEqual(networkPower.onSettings(adapters).map((item) => item.label), ['Energy-Efficient Ethernet']);
  assert.equal(networkPower.describeAdapters(adapters), 'On: Energy-Efficient Ethernet');
  assert.equal(networkPower.describeAdapters(networkPower.normalizeAdapters(raw({ eee: '0', green: '0' }))), 'Off on Ethernet');
  assert.equal(networkPower.describeAdapters([]), 'No wired adapter with power-saving settings');
  assert.deepEqual(networkPower.normalizeAdapters([{ guid: 'not-a-guid', settings: [] }]), []);
});

function fakes(values, elevated = true) {
  const state = { values: { ...values }, writes: [] };
  return {
    state,
    readNetworkPower: async () => { const adapters = networkPower.normalizeAdapters(raw(state.values)); return { adapters, on: networkPower.onSettings(adapters) }; },
    writeNetworkPower: async (changes) => { state.writes.push(changes.map((item) => `${item.keyword}=${item.value}`)); for (const change of changes) state.values[change.keyword === '*EEE' ? 'eee' : 'green'] = change.value; return { output: { written: true }, stdout: '', stderr: '', exitCode: 0 }; },
    isCurrentProcessElevated: async () => elevated,
  };
}

test('turning power saving off changes only what is on, verifies it, and Undo turns exactly that back on', async () => {
  const directory = tempDir('dialed-netpower-');
  const adapters = fakes({ eee: '1', green: '1' });
  const result = await journal.setNetworkPowerSavingOff(directory, adapters);
  assert.equal(result.success, true);
  assert.equal(result.entry.capabilityId, 'network:adapter-power-saving');
  assert.equal(result.entry.title, 'Network adapter power saving: turn off (Energy-Efficient Ethernet, Green Ethernet)');
  assert.deepEqual(adapters.state.writes, [['*EEE=0', 'EnableGreenEthernet=0']]);
  await journal.rollbackAuditEntry(directory, result.entry.id, adapters);
  assert.deepEqual(adapters.state.values, { eee: '1', green: '1' });
});

test('Undo is refused when a setting was turned back on elsewhere; nothing runs without admin or when already off', async () => {
  const directory = tempDir('dialed-netpower-');
  const adapters = fakes({ eee: '1', green: '0' });
  const result = await journal.setNetworkPowerSavingOff(directory, adapters);
  adapters.state.values.eee = '1';
  await assert.rejects(() => journal.rollbackAuditEntry(directory, result.entry.id, adapters), /changed after Dialed set them, or the adapter is gone/);
  const off = fakes({ eee: '0', green: '0' });
  await assert.rejects(() => journal.setNetworkPowerSavingOff(tempDir('dialed-netpower-'), off), /already off/);
  const denied = fakes({ eee: '1', green: '0' }, false);
  await assert.rejects(() => journal.setNetworkPowerSavingOff(tempDir('dialed-netpower-'), denied), /administrator/);
  assert.deepEqual([...off.state.writes, ...denied.state.writes], []);
});

test('the change maps to its own administrator capability and promises no latency number', async () => {
  const capability = capabilities.capabilityForAction('network:adapter-power-saving');
  assert.equal(capability.id, 'network:adapter-power-saving');
  assert.equal(capability.privilegeRequirement, 'Administrator');
  assert.match(capability.expectedBenefit, /No latency figure is promised/);
  await assert.rejects(() => networkPower.writeNetworkPower([{ guid: GUID, keyword: 'NetworkAddress', value: '0' }], async () => { throw new Error('must not run'); }), /not valid/);
});
