import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RECOVERY_STEPS, recoveryStepsText } from '../src/components/RecoveryStepsCard';

test('the saved recovery steps are plain text with the exact commands for what Dialed changes', () => {
  const text = recoveryStepsText();
  assert.match(text, /^If Windows will not start: recovery steps from Dialed\r\n/);
  // In the recovery environment the installed Windows is {default}, not {current}.
  assert.match(text, /bcdedit \/deletevalue \{default\} disabledynamictick/);
  assert.match(text, /bcdedit \/deletevalue \{default\} useplatformclock/);
  assert.doesNotMatch(text, /\{current\}/);
  assert.match(text, /starts with "Dialed"/);
  assert.match(text, /aka\.ms\/myrecoverykey/);
  assert.equal(RECOVERY_STEPS.length, 6);
  // Nothing that weakens protection is suggested.
  assert.doesNotMatch(text, /disable (secure boot|bitlocker|defender)/i);
});
