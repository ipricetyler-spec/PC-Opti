import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TWEAKS, TWEAK_GROUPS, activeChanges, buildTweakCards, changedLabel, noLongerInEffect } from '../src/lib/tweaks';
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

test('a change Windows set back reads as no longer in effect, and unknown stays unknown', () => {
  const card = (resultingState: unknown) => ({ definition: TWEAKS[0], state: null, changes: [], undoEntry: { resultingState } as unknown as AuditJournalEntry });
  const wroteOff = card({ verified: { enabled: false } });
  assert.equal(noLongerInEffect(wroteOff, { enabled: true }), true);
  assert.equal(noLongerInEffect(wroteOff, { enabled: false }), false);
  assert.equal(noLongerInEffect(wroteOff, { enabled: null }), false, 'cannot read now: unknown, not reverted');
  assert.equal(noLongerInEffect(wroteOff, undefined), false);
  assert.equal(noLongerInEffect(card(null), { enabled: true }), false, 'nothing verified: unknown');
  assert.equal(noLongerInEffect({ ...wroteOff, undoEntry: null }, { enabled: true }), false);
});

test('suggestion progress counts only settings Windows reported, and ticks only batchable ones', async () => {
  const { suggestionProgress } = await import('../src/lib/tweaks');
  const withSuggestion = TWEAKS.filter((definition) => definition.suggested).slice(0, 3);
  assert.equal(withSuggestion.length, 3);
  const cards = withSuggestion.map((definition) => ({ definition, state: null, changes: [], undoEntry: null }));
  const key = (index: number) => withSuggestion[index].userSettingId ?? withSuggestion[index].id;
  const settings = {
    [key(0)]: { enabled: withSuggestion[0].suggested === 'on' },
    [key(1)]: { enabled: withSuggestion[1].suggested !== 'on' },
    [key(2)]: { enabled: null },
  };
  const progress = suggestionProgress(cards, settings, () => true);
  assert.deepEqual({ matching: progress.matching, known: progress.known }, { matching: 1, known: 2 }, 'an unread setting counts neither way');
  assert.deepEqual(progress.toTick, [withSuggestion[1].id]);
  assert.deepEqual(suggestionProgress(cards, settings, () => false).toTick, []);
  // A setting the reader kept is reported, never recommended.
  const kept = suggestionProgress(cards, settings, () => true, new Set([withSuggestion[1].id]));
  assert.deepEqual([kept.toTick, kept.kept], [[], [withSuggestion[1].id]]);
});

test('return-to-default fixes are recommended only when another tool changed them', async () => {
  const { suggestionProgress } = await import('../src/lib/tweaks');
  const fixes = TWEAKS.filter((definition) => definition.recommendWhenChanged);
  assert.deepEqual(fixes.map((definition) => definition.id), ['processor-scheduling', 'multimedia-scheduler']);
  const cards = fixes.map((definition) => ({ definition, state: null, changes: [], undoEntry: null }));
  const progress = suggestionProgress(cards, { 'processor-scheduling': { enabled: false }, 'multimedia-scheduler': { enabled: true } }, () => true);
  assert.deepEqual([progress.toTick, progress.matching, progress.known], [['processor-scheduling'], 1, 2]);
});
