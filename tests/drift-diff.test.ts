import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeValue, humanizeKey, summarizeDrift } from '../src/lib/driftDiff';

const evidence = (value: unknown) => ({ status: 'AVAILABLE', value, source: 'fixture' });

test('a name the baseline scan could not read is not reported as a change to the PC', () => {
  // Seen on a real PC: the power plan was the same, only its name had not been read.
  const summary = summarizeDrift(
    evidence({ guid: '381b4222-f694-41f0-9685-ff5bb260df2e', name: 'Name not returned' }),
    evidence({ guid: '381b4222-f694-41f0-9685-ff5bb260df2e', name: 'Balanced' }),
  );
  assert.deepEqual(summary.lines, [{ field: 'Name', before: 'Not reported', after: 'Balanced', filledIn: true }]);
  assert.equal(summary.onlyFilledIn, true);
});

test('a real change is reported plainly, with unchanged fields left out', () => {
  const summary = summarizeDrift(evidence({ guid: 'a', name: 'Balanced' }), evidence({ guid: 'b', name: 'High performance' }));
  assert.deepEqual(summary.lines.map((line) => [line.field, line.before, line.after]), [['Guid', 'a', 'b'], ['Name', 'Balanced', 'High performance']]);
  assert.equal(summary.onlyFilledIn, false);
});

test('list items are matched by name, so only the one that changed is shown', () => {
  const before = evidence([
    { product: 'Easy Anti-Cheat', serviceName: 'EasyAntiCheat_EOS', state: 'Stopped', driverPresent: false },
    { product: 'Riot Vanguard', serviceName: 'vgc', state: 'Running', driverPresent: true },
  ]);
  const after = evidence([
    { product: 'Riot Vanguard', serviceName: 'vgc', state: 'Stopped', driverPresent: true },
    { product: 'Easy Anti-Cheat', serviceName: 'EasyAntiCheat_EOS', state: 'Stopped', driverPresent: false },
  ]);
  assert.deepEqual(summarizeDrift(before, after).lines, [{ field: 'Riot Vanguard · State', before: 'Running', after: 'Stopped', filledIn: false }]);
});

test('items that appear or disappear are named, not dumped', () => {
  const summary = summarizeDrift(evidence([{ product: 'BattlEye' }]), evidence([{ product: 'Easy Anti-Cheat' }]));
  assert.deepEqual(summary.lines.map((line) => `${line.field}: ${line.before} → ${line.after}`), [
    'BattlEye: Present → No longer listed',
    'Easy Anti-Cheat: Not listed → Now listed',
  ]);
});

test('evidence that became unreadable says so, with the reason', () => {
  const summary = summarizeDrift(evidence({ state: 'Enabled' }), { status: 'UNAVAILABLE', reason: 'Access denied', source: 'fixture' });
  assert.match(String(summary.availability), /could be read in the baseline scan but not now: Access denied/);
});

test('values are described in plain language', () => {
  assert.equal(humanizeKey('driverPresent'), 'Driver present');
  assert.equal(humanizeKey('hardware_gpu_scheduling'), 'Hardware gpu scheduling');
  assert.equal(describeValue(true), 'Yes');
  assert.equal(describeValue(1234567), '1,234,567');
  assert.equal(describeValue(null), 'Not reported');
  assert.equal(describeValue('Name not returned'), 'Not reported');
  assert.equal(describeValue('x'.repeat(200)).length, 121);
});

test('a very large difference is capped rather than flooding the screen', () => {
  const many = (prefix: string) => evidence(Array.from({ length: 100 }, (_, index) => ({ name: `${prefix}${index}` })));
  assert.ok(summarizeDrift(many('a'), many('b')).lines.length <= 40);
});
