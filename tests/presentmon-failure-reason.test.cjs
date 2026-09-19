const test = require('node:test');
const assert = require('node:assert/strict');
const { explainCaptureFailure } = require('../src/main/presentmon/index.cjs');

test('a PresentMon permission failure is explained plainly instead of as a missing file', () => {
  // Seen on a real PC: Dialed run as a normal user, PresentMon exited with code 6 and
  // the person was shown only "ENOENT: no such file or directory" for the missing CSV.
  const output = [
    'error: failed to start trace session: access denied.',
    '       PresentMon requires either administrative privileges or to be run by a user in the',
    '       "Performance Log Users" user group.  View the readme for more details.',
  ].join('\n');
  const reason = explainCaptureFailure(output);
  assert.match(reason, /needs Dialed running as administrator/);
  assert.match(reason, /Performance Log Users/);
  assert.match(reason, /Nothing was recorded/);
});

test('other PresentMon failures keep PresentMon\'s own reason', () => {
  assert.equal(explainCaptureFailure('error: target process exited'), null);
  assert.equal(explainCaptureFailure(''), null);
  assert.equal(explainCaptureFailure(undefined), null);
});
