import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DISPLAY_BASELINES_KEY,
  MAX_STORED_BASELINES,
  baselineFor,
  contextChanges,
  describeField,
  emptySettings,
  gameKeyFor,
  known,
  missingRequired,
  parseBaselines,
  parseSettings,
  removeBaseline,
  saveBaselines,
  upsertBaseline,
  type BaselineSettings,
  type DisplayBaseline,
} from '../src/lib/displayBaseline';

function completeSettings(): BaselineSettings {
  return {
    ...emptySettings(144),
    resolution: known({ width: 2560, height: 1440 }),
    displayMode: known('FULLSCREEN' as const),
    frameCap: known(141),
    vsync: known('OFF' as const),
  };
}

function baseline(overrides: Partial<DisplayBaseline['context']> = {}, id = '11111111-1111-4111-8111-111111111111'): DisplayBaseline {
  return {
    schemaVersion: 1,
    id,
    savedAt: '2026-09-17T12:00:00.000Z',
    context: {
      gameKey: 'guide:fortnite-pc-performance-review',
      gameName: 'Fortnite',
      guideId: 'fortnite-pc-performance-review',
      monitorKey: 'aaaaaaaaaaaaaaaa',
      monitorLabel: 'LG ULTRAGEAR',
      gpuName: 'NVIDIA GeForce RTX 4080',
      driverVersion: '31.0.15.6109',
      ...overrides,
    },
    settings: completeSettings(),
  };
}

test('only the monitor refresh rate is prefilled, and it is marked as observed', () => {
  const settings = emptySettings(144);
  assert.deepEqual(settings.refreshHz, { value: 144, source: 'OBSERVED' });
  // The game resolution is never prefilled from the desktop: a game can render at a
  // resolution the desktop is not using, and a wrong "observed" value is worse than
  // an honest blank.
  assert.deepEqual(settings.resolution, { value: null, source: 'UNKNOWN' });
  for (const field of ['displayMode', 'frameCap', 'vsync', 'vrr', 'vrrRange', 'hdr', 'latency'] as const) {
    assert.equal(settings[field].source, 'UNKNOWN', `${field} starts explicitly unknown`);
  }
});

test('an implausible observed refresh rate is left unknown rather than trusted', () => {
  assert.equal(emptySettings(null).refreshHz.source, 'UNKNOWN');
  assert.equal(emptySettings(1).refreshHz.source, 'UNKNOWN');
  assert.equal(emptySettings(5000).refreshHz.source, 'UNKNOWN');
});

test('a baseline cannot be saved until the four timing-critical settings are known', () => {
  assert.deepEqual(missingRequired(emptySettings(144)), ['Game resolution', 'Display mode', 'Frame cap', 'V-Sync']);
  assert.deepEqual(missingRequired(completeSettings()), []);
  // Optional settings may stay explicitly unknown without blocking the save.
  const settings = completeSettings();
  assert.equal(settings.hdr.source, 'UNKNOWN');
  assert.deepEqual(missingRequired(settings), []);
});

test('manual and detected games get distinct, stable keys', () => {
  assert.equal(gameKeyFor('fortnite-pc-performance-review', 'Fortnite'), 'guide:fortnite-pc-performance-review');
  assert.equal(gameKeyFor(null, '  Some   Game '), 'manual:some game');
  assert.equal(gameKeyFor(null, 'SOME GAME'), gameKeyFor(null, 'some game'), 'case does not split one game into two');
});

test('saving again for the same game and monitor replaces the baseline instead of duplicating it', () => {
  const first = baseline();
  const replacement = baseline({}, '22222222-2222-4222-8222-222222222222');
  const otherMonitor = baseline({ monitorKey: 'bbbbbbbbbbbbbbbb' }, '33333333-3333-4333-8333-333333333333');

  let stored = upsertBaseline([], first);
  stored = upsertBaseline(stored, otherMonitor);
  stored = upsertBaseline(stored, replacement);

  assert.equal(stored.length, 2);
  assert.equal(baselineFor(stored, first.context.gameKey, 'aaaaaaaaaaaaaaaa')?.id, replacement.id);
  assert.equal(baselineFor(stored, first.context.gameKey, 'bbbbbbbbbbbbbbbb')?.id, otherMonitor.id);
  assert.equal(baselineFor(stored, 'guide:other-game', 'aaaaaaaaaaaaaaaa'), null);

  assert.equal(removeBaseline(stored, replacement.id).length, 1);
});

test('stored baselines are capped so storage cannot grow without limit', () => {
  let stored: DisplayBaseline[] = [];
  for (let index = 0; index < MAX_STORED_BASELINES + 10; index += 1) {
    const monitorKey = index.toString(16).padStart(16, '0');
    const id = `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
    stored = upsertBaseline(stored, baseline({ monitorKey }, id));
  }
  assert.equal(stored.length, MAX_STORED_BASELINES);
});

test('a driver update, a different card, a missing monitor and a changed refresh rate are all surfaced', () => {
  const saved = baseline();
  assert.deepEqual(contextChanges(saved, {
    monitorPresent: true, observedRefreshHz: 144, gpuName: 'NVIDIA GeForce RTX 4080', driverVersion: '31.0.15.6109',
  }), [], 'an unchanged setup reports nothing');

  const changes = contextChanges(saved, {
    monitorPresent: true, observedRefreshHz: 60, gpuName: 'NVIDIA GeForce RTX 4080', driverVersion: '32.0.15.6600',
  });
  assert.equal(changes.length, 2);
  assert.match(changes.join('\n'), /driver changed from 31\.0\.15\.6109 to 32\.0\.15\.6600/);
  assert.match(changes.join('\n'), /now at 60 Hz; the baseline recorded 144 Hz/);

  const swapped = contextChanges(saved, {
    monitorPresent: false, observedRefreshHz: null, gpuName: 'AMD Radeon RX 7900 XTX', driverVersion: null,
  });
  assert.match(swapped.join('\n'), /not attached right now/);
  assert.match(swapped.join('\n'), /graphics card changed/);
  assert.doesNotMatch(swapped.join('\n'), /Hz/, 'a refresh rate is not compared when the monitor is absent');
});

test('a stored record is rebuilt field by field, and a bad one is dropped whole', () => {
  const good = baseline();
  const tampered = { ...baseline({}, '44444444-4444-4444-8444-444444444444'), settings: { ...completeSettings(), frameCap: { value: 999_999, source: 'MANUAL' } } };
  const wrongSource = { ...baseline({}, '55555555-5555-4555-8555-555555555555'), settings: { ...completeSettings(), vsync: { value: 'ON', source: 'INVENTED' } } };
  const unknownWithValue = { ...baseline({}, '66666666-6666-4666-8666-666666666666'), settings: { ...completeSettings(), hdr: { value: 'ON', source: 'UNKNOWN' } } };
  const badMonitorKey = baseline({ monitorKey: '../../etc/passwd' }, '77777777-7777-4777-8777-777777777777');
  const badGameKey = baseline({ gameKey: 'javascript:alert(1)' }, '88888888-8888-4888-8888-888888888888');

  const parsed = parseBaselines(JSON.stringify([good, tampered, wrongSource, unknownWithValue, badMonitorKey, badGameKey]));
  assert.deepEqual(parsed.map((item) => item.id), [good.id]);

  assert.deepEqual(parseBaselines(null), []);
  assert.deepEqual(parseBaselines('not json'), []);
  assert.deepEqual(parseBaselines('{"not":"an array"}'), []);
});

test('an inverted G-SYNC / FreeSync range is refused', () => {
  const settings = { ...completeSettings(), vrrRange: { value: { minHz: 144, maxHz: 48 }, source: 'MANUAL' } };
  assert.equal(parseSettings(settings), undefined);
  const valid = { ...completeSettings(), vrrRange: { value: { minHz: 48, maxHz: 144 }, source: 'MANUAL' } };
  assert.ok(parseSettings(valid));
});

test('a round trip through storage preserves every field and its source', () => {
  const stored: Record<string, string> = {};
  const storage = { setItem: (key: string, value: string) => { stored[key] = value; } };
  const original = baseline();
  assert.equal(saveBaselines(storage, [original]), true);
  const [restored] = parseBaselines(stored[DISPLAY_BASELINES_KEY]);
  assert.deepEqual(restored, original);
  assert.equal(restored.settings.refreshHz.source, 'OBSERVED');
});

test('a storage failure reports itself instead of pretending the baseline was saved', () => {
  const failing = { setItem: () => { throw new Error('quota exceeded'); } };
  assert.equal(saveBaselines(failing, [baseline()]), false);
});

test('fields are described in plain language, and unknown is said plainly', () => {
  const settings = completeSettings();
  assert.equal(describeField('resolution', settings), '2560 × 1440');
  assert.equal(describeField('frameCap', settings), '141 FPS');
  assert.equal(describeField('frameCap', { ...settings, frameCap: known('UNCAPPED' as const) }), 'No cap');
  assert.equal(describeField('displayMode', settings), 'Fullscreen');
  assert.equal(describeField('vsync', settings), 'Off');
  assert.equal(describeField('hdr', settings), 'Not known');
  assert.equal(describeField('latency', { ...settings, latency: known('REFLEX_BOOST' as const) }), 'NVIDIA Reflex + Boost');
});
