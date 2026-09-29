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
  // Shown only when this build can set up the higher tier (the signed native setup, or the legacy
  // route), for a High-Speed device; otherwise the reader is told to keep the protection on.
  assert.match(center, /const higherRatesPossible = legacyWrites \|\| nativeSetupAvailable;/);
  assert.match(center, /onAvailabilityChange=\{setNativeSetupAvailable\}/);
  assert.match(center, /memoryIntegrity !== 'Disabled' && higherRatesPossible && selected\?\.speed === 'High-Speed' && \(selected\.filterActive \|\| nativeSetupAvailable\) \? <MemoryIntegrityGuide/);
  assert.match(center, /memoryIntegrity !== 'Disabled' && !higherRatesPossible \? <p[^>]*>.*no reason to turn Memory Integrity off for Dialed/);
  assert.match(guide, /anti-cheat/);
});

test('Core isolation is an allowlisted page, and no code path writes the Memory Integrity setting', () => {
  const main = read('electron/main.cjs');
  assert.match(main, /'core-isolation': 'windowsdefender:\/\/coreisolation'/);
  const sources = ['electron/main.cjs', 'src/main/input-devices/index.cjs', 'src/main/input-devices/native.ps1', 'src/main/journal/index.cjs'].map(read).join('\n');
  assert.doesNotMatch(sources, /HypervisorEnforcedCodeIntegrity[^\n]*(Set-ItemProperty|New-ItemProperty|reg add)/i);
  assert.doesNotMatch(sources, /(Set-ItemProperty|New-ItemProperty|reg add)[^\n]*HypervisorEnforcedCodeIntegrity/i);
});
