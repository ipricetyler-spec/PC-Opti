import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeRollbackTarget, rollbackDisclosureText } from '../src/lib/rollbackDisclosure';
import type { AuditJournalEntry } from '../src/types';

type RollbackKind = NonNullable<AuditJournalEntry['rollback']['kind']>;

function entry(kind: RollbackKind, preAction: unknown): AuditJournalEntry {
  return {
    id: '00000000-0000-4000-8000-000000000000',
    timestamp: '2026-09-17T12:00:00.000Z',
    actionId: 'fixture',
    title: 'Fixture entry',
    category: 'Startup management',
    preAction,
    resultingState: null,
    status: 'SUCCESS',
    exitCode: 0,
    stdout: '',
    stderr: '',
    rollback: { available: true, reason: 'fixture', kind },
  };
}

// The audit journal lives in per-user app data, so another program running as the same
// user can add an entry to it. Dialed refuses shapes it could not have written, but a
// plausible forged entry is still possible. Every rollback kind must therefore show what
// it would actually do, so the person can recognise something they did not do.
test('every supported rollback kind discloses its real target', () => {
  const cases: Array<[RollbackKind, unknown, RegExp]> = [
    ['restore-registry-run-value', {
      registryPath: 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
      valueName: 'ForgedEntry',
      value: 'C:\\Users\\Public\\payload.exe',
    }, /payload\.exe/],
    ['restore-gpu-preference', { exePath: 'C:\\Games\\game.exe' }, /game\.exe/],
    ['disable-process-ecoqos', { name: 'fixture-app' }, /fixture-app/],
    ['restore-power-plan', { previousName: 'Balanced', targetName: 'High performance' }, /Balanced/],
    ['restore-consumer-features-policy', {
      valueName: 'DisableWindowsConsumerFeatures', value: 1, valueExists: true,
    }, /DisableWindowsConsumerFeatures/],
    ['restore-boot-timing-setting', { actionId: 'timing:restore-automatic-clock-source' }, /clock source/i],
  ];

  for (const [kind, preAction, expected] of cases) {
    const lines = describeRollbackTarget(entry(kind, preAction));
    assert.ok(lines.length > 0, `${kind} must disclose at least one line`);
    assert.match(lines.join('\n'), expected);
  }
});

test('a policy restore says plainly when the setting will be removed rather than set', () => {
  const lines = describeRollbackTarget(entry('restore-consumer-features-policy', {
    valueName: 'DisableWindowsConsumerFeatures', valueExists: false,
  }));
  assert.match(lines.join('\n'), /removed/);
});

test('control characters cannot disturb the confirmation text', () => {
  // Built with fromCharCode so this source file carries no literal control bytes.
  const nul = String.fromCharCode(0);
  const unitSeparator = String.fromCharCode(31);
  const del = String.fromCharCode(127);
  const controlPattern = new RegExp(`[\\u0000-\\u001f\\u007f]`);
  const lines = describeRollbackTarget(entry('restore-registry-run-value', {
    registryPath: 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
    valueName: `Name${nul}With${unitSeparator}Control${del}`,
    value: 'first.exe\r\nsecond.exe',
  }));
  // Checked per line: the join separator is itself a newline, so it would match.
  for (const line of lines) {
    assert.doesNotMatch(line, controlPattern, `line still carries a control character: ${JSON.stringify(line)}`);
  }
  assert.match(lines.join(String.fromCharCode(10)), new RegExp(String.fromCharCode(0xfffd)));
});

test('long values are truncated so one entry cannot flood the dialog', () => {
  const lines = describeRollbackTarget(entry('restore-registry-run-value', {
    registryPath: 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
    valueName: 'Name',
    value: 'a'.repeat(5000),
  }));
  assert.ok(lines.join('\n').length < 600);
  assert.match(lines.join('\n'), /…/);
});

test('an unrecognised or empty pre-action discloses nothing rather than guessing', () => {
  assert.deepEqual(describeRollbackTarget(entry('restore-registry-run-value', null)), []);
  assert.deepEqual(describeRollbackTarget(entry('restore-power-plan', 'not-an-object')), []);
  assert.equal(rollbackDisclosureText(entry('disable-process-ecoqos', {})), '');
});

test('a per-user setting restore names the setting and what it goes back to', () => {
  const base = { id: 'x', timestamp: '2026-09-18T10:00:00.000Z', actionId: 'settings:user:game-mode', title: 'Game Mode: turn off', category: 'Windows gaming setting', resultingState: null, status: 'SUCCESS' as const, exitCode: 0, stdout: '', stderr: '' };
  const rollback = { available: true, reason: '', kind: 'restore-user-setting' as const };
  assert.deepEqual(describeRollbackTarget({ ...base, rollback, preAction: { settingId: 'game-mode', existed: true, value: 1, kind: 'DWord' } }), ['Setting: Game Mode', 'Will be set back to: on']);
  assert.deepEqual(describeRollbackTarget({ ...base, rollback, preAction: { settingId: 'background-recording', existed: false, value: null } }), ['Setting: Game Bar background recording', 'Will be set back to: the Windows default']);
  // An unknown id is not described, so a forged entry cannot put arbitrary text in the dialog.
  assert.deepEqual(describeRollbackTarget({ ...base, rollback, preAction: { settingId: 'HKLM evil', existed: true, value: 1 } }), []);
});

test('a mouse acceleration restore says which state it returns to', () => {
  const base = { id: 'x', timestamp: '2026-09-18T10:00:00.000Z', actionId: 'settings:user:mouse-acceleration', title: 'Mouse acceleration: turn off', category: 'Windows gaming setting', resultingState: null, status: 'SUCCESS' as const, exitCode: 0, stdout: '', stderr: '' };
  const rollback = { available: true, reason: '', kind: 'restore-mouse-acceleration' as const };
  assert.deepEqual(describeRollbackTarget({ ...base, rollback, preAction: { values: { MouseSpeed: { exists: true, value: '1' } } } }), ['Setting: Mouse acceleration (Enhance pointer precision)', 'Will be set back to: on']);
  assert.deepEqual(describeRollbackTarget({ ...base, rollback, preAction: { values: { MouseSpeed: { exists: true, value: 'rm -rf' } } } })[1], 'Will be set back to: the previous values');
});

test('power restores name the plan or percentage they return to', () => {
  const base = { id: 'x', timestamp: '2026-09-18T10:00:00.000Z', title: 't', category: 'Power plan', status: 'SUCCESS' as const, exitCode: 0, stdout: '', stderr: '' };
  assert.deepEqual(describeRollbackTarget({ ...base, actionId: 'power:add-ultimate-plan', preAction: { beforeGuids: [] }, resultingState: { createdGuid: '0f3c2a44-1111-4a2b-9c3d-123456789abc', name: 'Ultimate Performance' }, rollback: { available: true, reason: '', kind: 'remove-power-plan' } }), ['Power plan to remove: Ultimate Performance', 'Plan id: 0f3c2a44-1111-4a2b-9c3d-123456789abc']);
  assert.deepEqual(describeRollbackTarget({ ...base, actionId: 'power:cpu-minimum-state:x', preAction: { ac: 5, schemeName: 'Balanced' }, resultingState: null, rollback: { available: true, reason: '', kind: 'restore-cpu-minimum-state' } }), ['Minimum processor state (plugged in) will be set back to: 5%', 'Power plan: Balanced']);
});

test('undo for the windowed-games, fullscreen and USB tweaks says what goes back', () => {
  assert.deepEqual(describeRollbackTarget(entry('restore-usb-selective-suspend', { ac: 1, schemeName: 'Balanced' })), ['USB selective suspend (plugged in) will be set back to: on', 'Power plan: Balanced']);
  assert.deepEqual(describeRollbackTarget(entry('restore-windowed-games', { existed: false })), ['Setting: Optimizations for windowed games', 'Will be set back to: the Windows default']);
  assert.deepEqual(describeRollbackTarget(entry('restore-fullscreen-optimizations', { exePath: 'D:\Games\game.exe', existed: false })), ['Game: D:\Games\game.exe', 'Fullscreen optimizations will be set back to: on']);
  assert.deepEqual(describeRollbackTarget(entry('restore-fullscreen-optimizations', { exePath: 'D:\Games\game.exe', existed: true, data: '~ DISABLEDXMAXIMIZEDWINDOWEDMODE' })), ['Game: D:\Games\game.exe', 'Fullscreen optimizations will be set back to: off']);
});
