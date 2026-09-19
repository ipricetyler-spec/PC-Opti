import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monitorDisplayName, selectableMonitors } from '../src/lib/displaySetup';

const mode = (over: Record<string, unknown>) => ({
  label: 'Display 1', monitorKey: 'k1', monitorName: 'Generic PnP Monitor', deviceName: '\\\\.\\DISPLAY1', primary: false, adapter: 'GPU',
  currentWidth: 1920, currentHeight: 1080, currentHz: 240, maxHzAtCurrentResolution: 240, maxHzAnyResolution: 240, status: 'AT_HIGHEST_OFFERED', ...over,
}) as never;

// The owner's PC on 2026-09-19: Windows names both "Generic PnP Monitor"; Electron reads the EDID names.
const named = [
  { label: 'Example 360Hz Monitor', refreshRateHz: 360, logicalWidth: 1920, logicalHeight: 1080, scaleFactor: 1, primary: true },
  { label: 'Example 240Hz Monitor', refreshRateHz: 240, logicalWidth: 1920, logicalHeight: 1080, scaleFactor: 1, primary: false },
];

test('generic monitors take their real model names', () => {
  const report = { collectedAt: '', displays: [mode({ currentHz: 360, primary: true }), mode({ label: 'Display 2', monitorKey: 'k2', currentHz: 240 })] } as never;
  assert.deepEqual(selectableMonitors(report, named).map((item) => item.label), ['Example 360Hz Monitor', 'Example 240Hz Monitor']);
});

test('two monitors at the same refresh rate are told apart by resolution, then by which is the main display', () => {
  const sameRate = [
    { label: 'Main 27in', refreshRateHz: 240, logicalWidth: 2560, logicalHeight: 1440, scaleFactor: 1, primary: true },
    { label: 'Side 24in', refreshRateHz: 240, logicalWidth: 1920, logicalHeight: 1080, scaleFactor: 1, primary: false },
  ];
  assert.equal(monitorDisplayName(mode({ currentWidth: 1920, currentHeight: 1080 }), 1, sameRate), 'Side 24in');
  const identical = sameRate.map((item) => ({ ...item, logicalWidth: 1920, logicalHeight: 1080 }));
  assert.equal(monitorDisplayName(mode({ primary: true }), 0, identical), 'Main 27in');
  // Scaled desktops: 1536 x 864 logical at 125% is a 1920 x 1080 panel.
  assert.equal(monitorDisplayName(mode({}), 1, [{ label: 'Scaled 24in', refreshRateHz: 240, logicalWidth: 1536, logicalHeight: 864, scaleFactor: 1.25, primary: false }, sameRate[0]]), 'Scaled 24in');
});

test('no unique match falls back to a positional label; a real Windows name is kept', () => {
  const twins = [{ label: 'A', refreshRateHz: 240, primary: false }, { label: 'B', refreshRateHz: 240, primary: false }];
  assert.equal(monitorDisplayName(mode({}), 1, twins), 'Display 2 · 240 Hz');
  assert.equal(monitorDisplayName(mode({ monitorName: 'ASUS VG279QM' }), 0, named), 'ASUS VG279QM');
});
