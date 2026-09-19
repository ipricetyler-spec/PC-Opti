import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_SELECTION,
  chosenGameName,
  effectiveGpu,
  gpuAssociation,
  graphicsAdapters,
  normalizeManualGameName,
  parseSelection,
  saveSelection,
  selectableMonitors,
  selectionIsStale,
  setupCompleteness,
  type DisplaySetupSelection,
  type GraphicsAdapter,
} from '../src/lib/displaySetup';
import type { DisplayModeReport, InstalledGameDiscovery, SystemScanSnapshot } from '../src/types';

function report(displays: Partial<DisplayModeReport['displays'][number]>[]): DisplayModeReport {
  return {
    collectedAt: '2026-09-17T12:00:00.000Z',
    displays: displays.map((display) => ({
      label: 'Display 1',
      monitorKey: 'aaaaaaaaaaaaaaaa',
      monitorName: null,
      deviceName: '\\\\.\\DISPLAY1',
      primary: false,
      adapter: 'NVIDIA GeForce RTX 4080',
      currentWidth: 2560,
      currentHeight: 1440,
      currentHz: 144,
      maxHzAtCurrentResolution: 144,
      maxHzAnyResolution: 144,
      status: 'AT_HIGHEST_OFFERED' as const,
      ...display,
    })),
  };
}

const NVIDIA: GraphicsAdapter = { name: 'NVIDIA GeForce RTX 4080', driverVersion: '31.0.15.6109', vendor: 'NVIDIA' };
const INTEL: GraphicsAdapter = { name: 'Intel UHD Graphics 770', driverVersion: '31.0.101.4502', vendor: 'Intel Corporation' };

test('a monitor without a stable identity cannot be chosen', () => {
  // A baseline keyed to nothing could never be matched back to this panel, so the
  // entry is shown but not selectable rather than silently keyed to something transient.
  const monitors = selectableMonitors(report([
    { monitorKey: 'bbbbbbbbbbbbbbbb', monitorName: 'LG ULTRAGEAR', primary: true },
    { monitorKey: null, monitorName: null, label: 'Display 2' },
  ]));
  assert.equal(monitors[0].selectable, true);
  assert.equal(monitors[0].label, 'LG ULTRAGEAR');
  assert.match(monitors[0].detail, /2560 × 1440 · 144 Hz · Main display/);
  assert.equal(monitors[1].selectable, false);
  assert.equal(monitors[1].label, 'Display 2 · 144 Hz', 'falls back to position and refresh rate rather than inventing a name');
});

test('unknown resolution and refresh rate are said plainly, not hidden', () => {
  const monitors = selectableMonitors(report([{ currentWidth: null, currentHeight: null, currentHz: null }]));
  assert.match(monitors[0].detail, /Resolution unknown/);
  assert.match(monitors[0].detail, /Refresh rate unknown/);
});

test('graphics adapters come from the existing scan and drop empty placeholders', () => {
  const snapshot = {
    diagnostics: {
      graphics: {
        status: 'AVAILABLE',
        source: 'Win32_VideoController',
        value: [
          { name: 'NVIDIA GeForce RTX 4080', driverVersion: '31.0.15.6109', status: 'OK', adapterCompatibility: 'NVIDIA' },
          { name: 'Name not returned', driverVersion: 'Not returned', status: '', adapterCompatibility: '' },
        ],
      },
    },
  } as unknown as SystemScanSnapshot;
  const adapters = graphicsAdapters(snapshot);
  assert.equal(adapters.length, 1);
  assert.equal(adapters[0].driverVersion, '31.0.15.6109');
  assert.deepEqual(graphicsAdapters(null), []);
});

test('unavailable graphics evidence yields no adapters rather than throwing', () => {
  const snapshot = {
    diagnostics: { graphics: { status: 'UNAVAILABLE', reason: 'blocked', source: 'Win32_VideoController' } },
  } as unknown as SystemScanSnapshot;
  assert.deepEqual(graphicsAdapters(snapshot), []);
});

test('two graphics cards means asking, never guessing which one drives the monitor', () => {
  // Windows cannot report the association on a switchable-graphics laptop. Picking the
  // first adapter would label the evidence with a GPU that never rendered the game.
  assert.equal(gpuAssociation([NVIDIA, INTEL], null), 'NEEDS_USER_CHOICE');
  assert.equal(effectiveGpu([NVIDIA, INTEL], null), null);

  assert.equal(gpuAssociation([NVIDIA, INTEL], 'NVIDIA GeForce RTX 4080'), 'USER_CHOSEN');
  assert.equal(effectiveGpu([NVIDIA, INTEL], 'NVIDIA GeForce RTX 4080')?.driverVersion, '31.0.15.6109');

  // A saved choice naming a card that is no longer present falls back to asking again.
  assert.equal(gpuAssociation([NVIDIA, INTEL], 'AMD Radeon RX 7900'), 'NEEDS_USER_CHOICE');

  assert.equal(gpuAssociation([NVIDIA], null), 'SINGLE_GPU');
  assert.equal(effectiveGpu([NVIDIA], null)?.name, NVIDIA.name);
  assert.equal(gpuAssociation([], null), 'UNKNOWN');
});

test('the setup is incomplete until game, monitor and graphics card are all settled', () => {
  const discovery = { scannedAt: '', limitations: '', games: [{ guideId: 'fortnite-pc-performance-review', game: 'Fortnite' }] } as unknown as InstalledGameDiscovery;
  const empty = setupCompleteness(EMPTY_SELECTION, [NVIDIA, INTEL], discovery);
  assert.equal(empty.complete, false);
  assert.deepEqual(empty.missing, [
    'Choose the game',
    'Choose the monitor you play on',
    'Say which graphics card drives that monitor',
  ]);

  const done: DisplaySetupSelection = {
    ...EMPTY_SELECTION,
    monitorKey: 'aaaaaaaaaaaaaaaa',
    guideId: 'fortnite-pc-performance-review',
    gpuName: 'NVIDIA GeForce RTX 4080',
  };
  assert.equal(setupCompleteness(done, [NVIDIA, INTEL], discovery).complete, true);
});

test('a manually described game counts, and is cleaned up but not rejected', () => {
  const discovery = { scannedAt: '', limitations: '', games: [] } as unknown as InstalledGameDiscovery;
  const manual: DisplaySetupSelection = { ...EMPTY_SELECTION, manualGameName: 'Some Unlisted Game' };
  assert.equal(chosenGameName(manual, discovery), 'Some Unlisted Game');
  assert.equal(setupCompleteness(manual, [NVIDIA], discovery).hasGame, true);
  assert.equal(normalizeManualGameName('  Spaced   Out   Name  '), 'Spaced Out Name');
  assert.equal(normalizeManualGameName('x'.repeat(200)).length, 80);
});

test('a detected game that is no longer detected reads as unchosen, not as a wrong name', () => {
  const discovery = { scannedAt: '', limitations: '', games: [] } as unknown as InstalledGameDiscovery;
  const selection: DisplaySetupSelection = { ...EMPTY_SELECTION, guideId: 'fortnite-pc-performance-review' };
  assert.equal(chosenGameName(selection, discovery), null);
});

test('a monitor that is no longer attached marks the selection stale', () => {
  // The evidence is kept and the context flagged, rather than quietly pointing the
  // saved setup at whichever monitor happens to be plugged in now.
  const selection: DisplaySetupSelection = { ...EMPTY_SELECTION, monitorKey: 'cccccccccccccccc' };
  assert.equal(selectionIsStale(selection, report([{ monitorKey: 'aaaaaaaaaaaaaaaa' }])), true);
  assert.equal(selectionIsStale(selection, report([{ monitorKey: 'cccccccccccccccc' }])), false);
  assert.equal(selectionIsStale(EMPTY_SELECTION, report([])), false, 'nothing chosen cannot be stale');
  assert.equal(selectionIsStale(selection, null), false, 'an unread report is not evidence of removal');
});

test('a stored selection is validated rather than trusted', () => {
  assert.deepEqual(parseSelection(null), EMPTY_SELECTION);
  assert.deepEqual(parseSelection('not json'), EMPTY_SELECTION);
  assert.deepEqual(parseSelection(JSON.stringify({ schemaVersion: 99, monitorKey: 'aaaaaaaaaaaaaaaa' })), EMPTY_SELECTION);

  const hostile = parseSelection(JSON.stringify({
    schemaVersion: 1,
    monitorKey: '../../etc/passwd',
    guideId: 'Not A Valid Guide Id!',
    manualGameName: 'y'.repeat(500),
    gpuName: 'NVIDIA GeForce RTX 4080',
  }));
  assert.equal(hostile.monitorKey, null, 'a malformed key is dropped, not stored');
  assert.equal(hostile.guideId, null, 'a guide id that does not match the known shape is dropped');
  assert.equal(hostile.manualGameName?.length, 80);
  assert.equal(hostile.gpuName, 'NVIDIA GeForce RTX 4080');
});

test('a storage failure reports itself instead of pretending the setup was saved', () => {
  const failing = { setItem: () => { throw new Error('quota exceeded'); } };
  assert.equal(saveSelection(failing, EMPTY_SELECTION), false);

  const saved: Record<string, string> = {};
  const working = { setItem: (key: string, value: string) => { saved[key] = value; } };
  assert.equal(saveSelection(working, { ...EMPTY_SELECTION, monitorKey: 'aaaaaaaaaaaaaaaa' }), true);
  assert.equal(parseSelection(saved['dialed-display-setup:v1']).monitorKey, 'aaaaaaaaaaaaaaaa');
  assert.notEqual(parseSelection(saved['dialed-display-setup:v1']).updatedAt, '');
});

test('two monitors both reported as "Generic PnP Monitor" get their real names back', () => {
  // Seen on a real two-monitor PC: Windows gave both panels the same generic
  // monitor-level name, which would have made them impossible to tell apart.
  const generic = report([
    { monitorKey: 'aaaaaaaaaaaaaaaa', monitorName: 'Generic PnP Monitor', currentHz: 360, primary: true },
    { monitorKey: 'bbbbbbbbbbbbbbbb', monitorName: 'Generic PnP Monitor', currentHz: 240, label: 'Display 2' },
  ]);
  const named = [{ label: 'Example 360Hz Monitor', refreshRateHz: 360 }, { label: 'Example 240Hz Monitor', refreshRateHz: 239.96 }];
  assert.deepEqual(selectableMonitors(generic, named).map((monitor) => monitor.label), ['Example 360Hz Monitor', 'Example 240Hz Monitor']);

  // An ambiguous match is not guessed: two panels at the same rate fall back to position.
  const sameRate = [{ label: 'Panel A', refreshRateHz: 144 }, { label: 'Panel B', refreshRateHz: 144 }];
  const both144 = report([{ monitorName: 'Generic PnP Monitor', currentHz: 144 }, { monitorName: 'Generic PnP Monitor', currentHz: 144, monitorKey: 'bbbbbbbbbbbbbbbb' }]);
  assert.deepEqual(selectableMonitors(both144, sameRate).map((monitor) => monitor.label), ['Display 1 · 144 Hz', 'Display 2 · 144 Hz']);

  // A specific name from Windows is kept as it is.
  assert.equal(selectableMonitors(report([{ monitorName: 'LG ULTRAGEAR' }]), named)[0].label, 'LG ULTRAGEAR');
});
