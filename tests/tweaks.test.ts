import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TWEAKS, TWEAK_GROUPS, activeChanges, buildTweakCards, changedLabel } from '../src/lib/tweaks';
import type { AuditJournalEntry } from '../src/types';

function entry(id: string, capabilityId: string, overrides: Partial<AuditJournalEntry> = {}): AuditJournalEntry {
  return {
    id, timestamp: `2026-09-18T10:0${id.length % 10}:00.000Z`, actionId: capabilityId, capabilityId, title: id, category: 'test',
    preAction: null, resultingState: null, status: 'SUCCESS', exitCode: 0, stdout: '', stderr: '',
    rollback: { available: true, reason: 'Restorable.' },
    ...overrides,
  };
}

test('every tweak explains itself fully and belongs to a known group', () => {
  const ids = new Set<string>();
  for (const tweak of TWEAKS) {
    assert.ok(!ids.has(tweak.id), `duplicate ${tweak.id}`);
    ids.add(tweak.id);
    assert.ok(TWEAK_GROUPS.includes(tweak.group));
    for (const field of ['summary', 'whatChanges', 'whenItHelps', 'leaveItIf', 'undo', 'actionLabel'] as const) assert.ok(tweak[field].trim().length > 10 || field === 'actionLabel', `${tweak.id}.${field}`);
    // No speed promises: the explanations never quote an FPS or percentage gain.
    assert.doesNotMatch(`${tweak.whatChanges} ${tweak.whenItHelps}`, /\+\s*\d+\s*%|\d+\s*(fps|%)\s*(more|faster|gain|boost)/i);
  }
});

test('only successful, still-undoable changes count, newest first', () => {
  const history = [
    entry('old', 'power:switch-plan', { timestamp: '2026-09-17T10:00:00.000Z' }),
    entry('new', 'power:switch-plan', { timestamp: '2026-09-18T10:00:00.000Z' }),
    entry('failed', 'power:switch-plan', { status: 'FAILED' }),
    entry('undone', 'power:switch-plan', { rollback: { available: true, reason: '', completedAt: '2026-09-18T11:00:00.000Z' } }),
    entry('final', 'power:switch-plan', { rollback: { available: false, reason: 'Cannot be undone.' } }),
    entry('other', 'process:enable-ecoqos'),
  ];
  assert.deepEqual(activeChanges(history, ['power:switch-plan']).map((item) => item.id), ['new', 'old']);
});

test('a one-setting card gets an Undo for its latest change; a many-item card does not', () => {
  const history = [entry('plan', 'power:switch-plan'), entry('s1', 'startup:disable-current-user-run'), entry('s2', 'startup:disable-machine-run')];
  const cards = buildTweakCards(TWEAKS, history, { 'power-plan': 'Balanced' });
  const power = cards.find((card) => card.definition.id === 'power-plan')!;
  assert.equal(power.undoEntry?.id, 'plan');
  assert.equal(power.state, 'Balanced');
  assert.match(changedLabel(power)!, /^Changed by Dialed/);
  const startup = cards.find((card) => card.definition.id === 'startup-apps')!;
  assert.equal(startup.undoEntry, null, 'several startup entries cannot share one Undo button');
  assert.equal(changedLabel(startup), '2 changes made by Dialed');
  const unchanged = cards.find((card) => card.definition.id === 'dynamic-tick')!;
  assert.equal(changedLabel(unchanged), null);
  assert.equal(unchanged.state, null);
});

test('cards this build cannot act on are left out', () => {
  const cards = buildTweakCards(TWEAKS, [], {}, (definition) => definition.id !== 'retrim');
  assert.ok(!cards.some((card) => card.definition.id === 'retrim'));
  assert.equal(cards.length, TWEAKS.length - 1);
});

test('experiments are marked for measuring and everything else is not', () => {
  assert.deepEqual(TWEAKS.filter((tweak) => tweak.measureFirst).map((tweak) => tweak.id).sort(), ['clock-source', 'cpu-minimum-state', 'dynamic-tick', 'global-timer-resolution']);
});
