const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tempDir } = require('./helpers/temp-dir.cjs');
const maintenance = require('../src/main/maintenance/index.cjs');
const { windowsPowerShellEnvironment, windowsPowerShellPath } = require('../src/main/shared/windows-powershell-env.cjs');

// Runs the real delete helper against files this test creates in its own scratch folders.
// Nothing outside them is opened for deletion.
function runHelper(root, files, cutoff) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `Add-Type -TypeDefinition @'\n${maintenance.SAFE_DELETE_SOURCE}\n'@`,
    `$root = '${root}'`,
    '$realRoot = [DialedSafeDelete]::RealFolderPath($root)',
    `$cutoff = [DateTime]::Parse('${cutoff}').ToUniversalTime().ToFileTimeUtc()`,
    `$results = [ordered]@{ realRoot = $realRoot }`,
    ...files.map((file) => `$results['${file}'] = [DialedSafeDelete]::DeleteIfOld((Join-Path $root '${file}'), $realRoot, $cutoff)`),
    '[pscustomobject]$results | ConvertTo-Json -Compress',
  ].join('\n');
  const scriptFile = path.join(tempDir('dialed-clean-script-'), 'probe.ps1');
  fs.writeFileSync(scriptFile, script, 'utf8');
  const result = spawnSync(windowsPowerShellPath(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptFile], { encoding: 'utf8', env: windowsPowerShellEnvironment() });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function makeOld(file, bytes = 'x') {
  fs.writeFileSync(file, bytes);
  const old = new Date('2020-01-01T00:00:00Z');
  fs.utimesSync(file, old, old);
}

test('cleanup deletes only old, single-name files whose real location is inside the root', { skip: process.platform !== 'win32' }, () => {
  const root = fs.realpathSync.native(tempDir('dialed-clean-root-'));
  const outside = fs.realpathSync.native(tempDir('dialed-clean-outside-'));
  makeOld(path.join(root, 'old.tmp'), 'abcd');
  fs.writeFileSync(path.join(root, 'recent.tmp'), 'new');
  makeOld(path.join(root, 'readonly.tmp'), 'ro');
  fs.chmodSync(path.join(root, 'readonly.tmp'), 0o444);
  makeOld(path.join(root, 'linked.tmp'), 'l');
  fs.linkSync(path.join(root, 'linked.tmp'), path.join(outside, 'second-name.tmp'));
  fs.mkdirSync(path.join(root, 'folder'));
  // A folder inside the root that is really a junction to a folder outside it.
  makeOld(path.join(outside, 'precious.dat'), 'keep me');
  fs.symlinkSync(outside, path.join(root, 'swapped'), 'junction');

  const result = runHelper(root, ['old.tmp', 'recent.tmp', 'readonly.tmp', 'linked.tmp', 'folder', 'swapped\\precious.dat', 'missing.tmp'], '2024-01-01T00:00:00Z');
  assert.equal(result.realRoot.toLowerCase(), root.toLowerCase());
  assert.equal(result['old.tmp'], 4);
  assert.equal(fs.existsSync(path.join(root, 'old.tmp')), false, 'an old file is deleted');
  assert.equal(result['readonly.tmp'], 2);
  assert.equal(fs.existsSync(path.join(root, 'readonly.tmp')), false, 'a read-only old file is deleted too');
  assert.equal(result['recent.tmp'], -1);
  assert.equal(result['linked.tmp'], -1, 'a file with another name elsewhere is refused');
  assert.equal(result.folder, -1);
  assert.equal(result['swapped\\precious.dat'], -1, 'a file reached through a junction is refused');
  assert.equal(result['missing.tmp'], -1);
  for (const kept of [path.join(root, 'recent.tmp'), path.join(root, 'linked.tmp'), path.join(outside, 'second-name.tmp'), path.join(outside, 'precious.dat')]) {
    assert.ok(fs.existsSync(kept), `${kept} is kept`);
  }
});

test('the cleanup scripts clean only the user temp folder and delete through the checked handle', () => {
  const inventory = maintenance.createTempMaintenancePowerShellScript(false);
  const deletion = maintenance.createTempMaintenancePowerShellScript(true);
  for (const script of [inventory, deletion]) {
    assert.match(script, /@\(\(Join-Path \$env:LOCALAPPDATA 'Temp'\)\)/);
    assert.doesNotMatch(script, /WINDIR|\$env:TEMP/);
  }
  assert.doesNotMatch(inventory, /Remove-Item/, 'taking inventory deletes nothing');
  for (const script of [deletion, maintenance.createCacheCleanupPowerShellScript('clear-shader-caches', true)]) {
    assert.match(script, /\[DialedSafeDelete\]::DeleteIfOld\(\$fullName, \$realRoot, \$cutoffUtc\.ToFileTimeUtc\(\)\)/);
    assert.match(script, /\[DialedSafeDelete\]::RealFolderPath\(\$root\)/);
    assert.doesNotMatch(script, /Remove-Item/);
  }
});
