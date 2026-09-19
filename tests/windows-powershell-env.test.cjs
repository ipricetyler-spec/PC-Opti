const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { windowsPowerShellEnvironment } = require('../src/main/shared/windows-powershell-env.cjs');
const presentmon = require('../src/main/presentmon/index.cjs');

test('a PowerShell 7 module path is removed, whatever its casing, and nothing else changes', () => {
  const source = { PSModulePath: 'C:\\Program Files\\PowerShell\\Modules', psmodulepath: 'x', Path: 'C:\\Windows', SystemRoot: 'C:\\Windows' };
  const environment = windowsPowerShellEnvironment(source);
  assert.deepEqual(environment, { Path: 'C:\\Windows', SystemRoot: 'C:\\Windows' });
  assert.equal(source.PSModulePath, 'C:\\Program Files\\PowerShell\\Modules', 'the caller\'s environment is not modified');
});

test('every Windows PowerShell launcher starts it without an inherited module path', () => {
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  assert.match(read('src/main/scanner/index.cjs'), /\{ windowsHide: true, env: windowsPowerShellEnvironment\(\) \}/);
  assert.match(read('src/main/optional-apps/index.cjs'), /'-Command', script\], \{ windowsHide: true, env: windowsPowerShellEnvironment\(\) \}\)/);
  assert.match(read('src/main/telemetry/index.cjs'), /stdio: \['ignore', 'pipe', 'pipe'\], env: windowsPowerShellEnvironment\(\) \}/);
  assert.match(read('src/main/presentmon/index.cjs'), /spawnOptions: \{ \.\.\.dependencies\.spawnOptions, env: windowsPowerShellEnvironment\(\) \}/);
  // Input devices had its own copy of this guard first.
  assert.match(read('src/main/input-devices/index.cjs'), /name\.toLowerCase\(\) === 'psmodulepath'\) delete environment\[name\]/);
});

test('a signature check that prints nothing is reported as a failed check, not an unsigned file', async () => {
  const spawnProcess = () => {
    const { EventEmitter } = require('node:events');
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    setImmediate(() => { child.stderr.emit('data', Buffer.from("Get-AuthenticodeSignature : The command was found in the module but could not be loaded.\r\nAt line:1")); child.emit('close', 0); });
    return child;
  };
  await assert.rejects(presentmon.readAuthenticodeSignature('C:\\x.exe', { spawnProcess }), /Windows could not check the PresentMon signature\. Get-AuthenticodeSignature : The command was found in the module but could not be loaded\.$/);
});
