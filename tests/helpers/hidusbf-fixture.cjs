const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// hidusbf-native-protocol.test.cjs, general-release-policy.test.cjs and
// native-release-policy.test.cjs each build and run this same fixture project. Node's test
// runner executes test files concurrently, and `dotnet run` does its own incremental build
// into the project's shared obj/bin folders first — so two of these tests landing at the same
// time can have MSBuild try to write the same output DLL from two processes at once, which
// fails with "the process cannot access the file ... because it is being used by another
// process." (Reproduced directly by running these three files together.)
//
// A cross-process lock file serializes the dotnet calls instead: whichever test gets there
// first builds, and the others' incremental builds are then near-instant no-ops.
const PROJECT = path.resolve(__dirname, '../../native/hidusbf-helper-fixture/Dialed.HidusbfProtocolFixture.csproj');
const LOCK_PATH = path.join(os.tmpdir(), 'dialed-hidusbf-fixture-build.lock');
// A test process killed mid-build (for example by its own timeout) could leave this behind;
// nothing legitimately holds it this long.
const STALE_LOCK_MS = 5 * 60 * 1000;
const LOCK_WAIT_DEADLINE_MS = 90000;

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireLock() {
  const deadline = Date.now() + LOCK_WAIT_DEADLINE_MS;
  for (;;) {
    try {
      fs.writeFileSync(LOCK_PATH, String(process.pid), { flag: 'wx' });
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        if (Date.now() - fs.statSync(LOCK_PATH).mtimeMs > STALE_LOCK_MS) fs.unlinkSync(LOCK_PATH);
      } catch { /* another test released it, or beat us to removing it; just retry */ }
      if (Date.now() > deadline) throw new Error('Timed out waiting for the HIDUSBF fixture build lock.');
      sleepSync(150);
    }
  }
}

function releaseLock() {
  try { fs.unlinkSync(LOCK_PATH); } catch { /* already gone */ }
}

/**
 * Runs the compiled fixture project with the given CLI args, serialized against the other
 * fixture-corpus tests so concurrent `dotnet run` builds never race on the same output files.
 * `options` is passed through to execFileSync exactly as each test's own call needs.
 */
function runHidusbfFixture(args, options = {}) {
  acquireLock();
  try {
    return execFileSync('dotnet', ['run', '--project', PROJECT, '--configuration', 'Release', '--verbosity', 'quiet', '--', ...args], { encoding: 'utf8', windowsHide: true, ...options });
  } finally {
    releaseLock();
  }
}

module.exports = { runHidusbfFixture, HIDUSBF_FIXTURE_PROJECT: PROJECT };
