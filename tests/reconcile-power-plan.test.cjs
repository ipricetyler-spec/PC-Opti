const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tempDir } = require('./helpers/temp-dir.cjs');
const journal = require('../src/main/journal/index.cjs');

const BALANCED = '381b4222-f694-41f0-9685-ff5bb260df2e';
const NEW = '0f3c2a44-1111-4a2b-9c3d-123456789abc';
const OTHER = '0f3c2a44-2222-4a2b-9c3d-123456789abc';
const ADD_ID = '00000000-0000-4000-8000-00000000000a';

function addEntry(status = 'PENDING', extra = {}) {
  return { id: ADD_ID, actionId: 'power:add-ultimate-plan', title: 'Add the Ultimate Performance power plan', status, preAction: { beforeGuids: [BALANCED] }, rollback: { available: true, kind: 'remove-power-plan', reason: '' }, ...extra };
}

function withJournal(entries) {
  const directory = tempDir('dialed-reconcile-');
  fs.writeFileSync(path.join(directory, 'journal.json'), JSON.stringify(entries));
  return directory;
}

const plans = (...items) => ({ listPowerPlans: async () => ({ items: items.map(([guid, name]) => ({ guid, name })), activeGuid: BALANCED }) });

test('an interrupted Ultimate plan add is settled from the plan list recorded before it', async () => {
  const cases = [
    [plans([BALANCED, 'Balanced'], [NEW, 'Ultimate Performance']), 'SUCCESS', 'INTENDED_STATE', true],
    [plans([BALANCED, 'Balanced']), 'FAILED', 'PRE_ACTION_STATE', false],
    [plans([BALANCED, 'Balanced'], [NEW, 'Ultimate Performance'], [OTHER, 'Something else']), 'NEEDS_REVIEW', 'DIVERGED', false],
  ];
  for (const [adapters, status, classification, undoable] of cases) {
    const directory = withJournal([addEntry()]);
    await journal.reconcilePendingEntries(directory, adapters);
    const entry = journal.readJournal(directory)[0];
    assert.equal(entry.status, status, classification);
    assert.equal(entry.reconciliation.classification, classification);
    assert.equal(entry.rollback.available, undoable, classification);
    if (status === 'SUCCESS') assert.equal(entry.resultingState.createdGuid, NEW, 'undo will remove exactly the plan that was added');
  }
});

test('an interrupted Ultimate plan undo is settled, and a finished one closes the original change', async () => {
  const original = addEntry('SUCCESS', { resultingState: { createdGuid: NEW, name: 'Ultimate Performance' } });
  const undo = { id: '00000000-0000-4000-8000-00000000000b', actionId: `power:remove-ultimate-plan:${ADD_ID}`, status: 'PENDING', preAction: { originalAuditEntryId: ADD_ID, restoring: original.preAction }, rollback: { available: false, reason: '' } };

  const finished = withJournal([undo, original]);
  await journal.reconcilePendingEntries(finished, plans([BALANCED, 'Balanced']));
  const [finishedUndo, closed] = journal.readJournal(finished);
  assert.equal(finishedUndo.status, 'SUCCESS');
  assert.equal(closed.rollback.available, false, 'the original change is no longer offered for undo');

  const notDone = withJournal([undo, original]);
  await journal.reconcilePendingEntries(notDone, plans([BALANCED, 'Balanced'], [NEW, 'Ultimate Performance']));
  const [failedUndo, stillOpen] = journal.readJournal(notDone);
  assert.equal(failedUndo.status, 'FAILED');
  assert.equal(stillOpen.rollback.available, true, 'the plan is still there, so it can be undone again');
});

test('any other interrupted undo explains what a later "changed since" refusal most likely means', async () => {
  const undo = { id: '00000000-0000-4000-8000-00000000000c', actionId: 'process:disable-ecoqos:00000000-0000-4000-8000-00000000000d', status: 'PENDING', preAction: { originalAuditEntryId: 'x', restoring: {} }, rollback: { available: false, reason: '' } };
  const directory = withJournal([undo]);
  await journal.reconcilePendingEntries(directory, {});
  const entry = journal.readJournal(directory)[0];
  assert.equal(entry.status, 'NEEDS_REVIEW');
  assert.match(entry.reconciliation.message, /this undo most likely finished/);
});
