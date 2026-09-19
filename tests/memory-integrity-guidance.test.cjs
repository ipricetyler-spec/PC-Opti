const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('the Memory Integrity guide only explains and opens Windows Security; it never changes the setting', () => {
  const center = read('src/components/InputDevicesCenter.tsx');
  const guide = center.slice(center.indexOf('function MemoryIntegrityGuide'));
  assert.ok(guide.length > 100, 'guide component exists');
  // The only native call is opening the allowlisted page.
  assert.deepEqual([...guide.matchAll(/window\.pcOptiNative\?*\.(\w+)/g)].map((match) => match[1]), ['openWindowsSettings']);
  assert.match(guide, /openWindowsSettings\('core-isolation'\)/);
  assert.match(guide, /Dialed does not change Memory Integrity/);
  assert.match(guide, /NoPatch/);
  // Shown only for an eligible High-Speed device with the filter attached.
  assert.match(center, /memoryIntegrity !== 'Disabled' && selected\?\.speed === 'High-Speed' && selected\.filterActive \? <MemoryIntegrityGuide/);
});

test('Core isolation is an allowlisted page, and no code path writes the Memory Integrity setting', () => {
  const main = read('electron/main.cjs');
  assert.match(main, /'core-isolation': 'windowsdefender:\/\/coreisolation'/);
  const sources = ['electron/main.cjs', 'src/main/input-devices/index.cjs', 'src/main/input-devices/native.ps1', 'src/main/journal/index.cjs'].map(read).join('\n');
  assert.doesNotMatch(sources, /HypervisorEnforcedCodeIntegrity[^\n]*(Set-ItemProperty|New-ItemProperty|reg add)/i);
  assert.doesNotMatch(sources, /(Set-ItemProperty|New-ItemProperty|reg add)[^\n]*HypervisorEnforcedCodeIntegrity/i);
});
