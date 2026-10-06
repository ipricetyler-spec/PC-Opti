const assert = require('node:assert/strict');
const { test } = require('node:test');
const nvidia = require('../src/main/nvidia-settings/index.cjs');

// Raw ids as the driver returns them; values as read from the owner's driver on 2026-10-06.
const raw = (overrides = {}) => ({ available: true, settings: {
  [0x1194F158]: 0, [0x00A879CF]: 0x60925292, [0x10835002]: null, [0x007BA09E]: 1, [0x1057EB71]: 1,
  [0x00AC8497]: 0xFFFFFFFF, [0x00CE2691]: 0x14, [0x20C1221E]: 1, ...overrides } });

test('settings are described in words, and only known defaults count as changed', () => {
  const result = nvidia.describeNvidiaSettings(raw());
  const row = (id) => result.rows.find((item) => item.id === id);
  assert.deepEqual([row('power').value, row('power').differs], ['Prefer maximum performance', true]);
  assert.deepEqual([row('vsync').value, row('vsync').differs], ['Use the 3D application setting', false]);
  assert.deepEqual([row('frame-cap').value, row('frame-cap').differs], ['Not set (driver default)', false]);
  assert.equal(row('shader-cache').value, 'Unlimited');
  assert.equal(row('shader-cache').differs, false, 'no claimed default, so never "changed"');
  assert.equal(result.rows.filter((item) => item.differs).length, 4);
  assert.equal(nvidia.describeNvidiaSettings(raw({ [0x1057EB71]: 9 })).rows.find((item) => item.id === 'power').value, 'A value Dialed does not recognize (9)');
  assert.deepEqual(nvidia.describeNvidiaSettings({ available: false }), { available: false, rows: [], notes: [] });
});

test('G-SYNC notes appear only for the combinations they describe', () => {
  const on = nvidia.describeNvidiaSettings(raw({ [0x1194F158]: 1, [0x00A879CF]: 0x08416747 })).notes;
  assert.equal(on.length, 2);
  assert.match(on[0], /vertical sync is forced off/);
  assert.match(on[1], /no frame-rate cap/);
  const capped = nvidia.describeNvidiaSettings(raw({ [0x1194F158]: 2, [0x10835002]: 141 })).notes;
  assert.deepEqual(capped, []);
  assert.match(nvidia.describeNvidiaSettings(raw()).notes[0], /G-SYNC is off in the driver/);
  for (const note of [...on, ...nvidia.describeNvidiaSettings(raw()).notes]) assert.doesNotMatch(note, /\bFPS gain|faster|latency reduction/i);
});

test('the reader is read-only and reports a PC without the NVIDIA driver as unavailable', async () => {
  // NVAPI ids of the functions that write or save driver settings must never appear.
  for (const writer of ['0x577DD202', '0xFCBC7E14', '0x5927B094', '0x2EA97D9F']) assert.doesNotMatch(nvidia.READER, new RegExp(writer.slice(2), 'i'));
  assert.match(nvidia.readerScript(), /nvapi64\.dll/);
  assert.deepEqual(await nvidia.readNvidiaSettings(async () => ({ stdout: '{"available":false}' })), { available: false, rows: [], notes: [] });
  await assert.rejects(() => nvidia.readNvidiaSettings(async () => ({ stdout: 'garbage' })), /could not read the NVIDIA driver settings/);
});
