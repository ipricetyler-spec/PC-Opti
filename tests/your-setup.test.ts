import { test } from 'node:test';
import assert from 'node:assert/strict';
import { yourSetupLines } from '../src/lib/yourSetup';

const now = new Date('2026-10-01T12:00:00Z');

test('Your setup labels every value by where it came from and keeps unknown as unknown', () => {
  const known = yourSetupLines({
    powerPlan: 'Balanced', lastRate: { reportsPerSecond: 8007, at: '2026-10-01T09:00:00Z', name: 'DualSense Edge' },
    appliedProfiles: [{ game: 'VALORANT', at: '2026-09-28T10:00:00Z' }], lastNetwork: { line: '30 Sep · 1153 down / 46 up Mbps' }, now,
  });
  assert.deepEqual(known.map((line) => line.source), ['Read from Windows', 'Measured', 'Recorded by Dialed', 'Measured']);
  assert.match(known[1].value, /DualSense Edge: about 8,007 reports\/s, today/);
  assert.match(known[2].value, /^VALORANT \(/);

  const unknown = yourSetupLines({ powerPlan: null, lastRate: null, appliedProfiles: null, lastNetwork: undefined, now });
  assert.deepEqual(unknown.map((line) => line.source), ['Could not read', 'Not checked yet', 'Could not read', 'Could not read']);
  // Nothing claims a state it does not know, and nothing scores the PC.
  for (const line of [...known, ...unknown]) assert.doesNotMatch(line.value, /optimi[sz]ed|maxed|score|faster|boost/i);
});
