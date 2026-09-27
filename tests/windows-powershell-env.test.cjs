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

test('every Windows PowerShell launcher uses the fixed System32 path, the trusted module path and the shared environment', () => {
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  for (const file of ['src/main/scanner/index.cjs', 'src/main/optional-apps/index.cjs', 'src/main/telemetry/index.cjs', 'src/main/presentmon/index.cjs', 'src/main/input-devices/index.cjs']) {
    const text = read(file);
    assert.match(text, /spawn(?:Process|AndCollect)?\(windowsPowerShellPath\(\)|spawn\(executable,/, file);
    assert.match(text, /env: windowsPowerShellEnvironment\(\)/, file);
    assert.match(text, /windowsPowerShellArguments\(|withTrustedModulePath\(bootstrap\)/, file);
    assert.doesNotMatch(text, /'powershell\.exe'|SystemRoot \|\| 'C:/, `${file} resolves PowerShell itself`);
  }
  assert.match(read('src/main/input-devices/index.cjs'), /const executable = windowsPowerShellPath\(\);/);
});

test('the shared launcher pins the executable, resets the module path first, and moves TEMP when asked', () => {
  const helper = require('../src/main/shared/windows-powershell-env.cjs');
  assert.equal(helper.windowsPowerShellPath({ SystemRoot: 'D:\\Windows' }), 'D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  for (const bad of [undefined, '', '\\\\server\\share', 'C:\\Windows;C:\\Evil', 'relative']) {
    assert.equal(helper.systemRoot({ SystemRoot: bad }), 'C:\\Windows', String(bad));
  }
  const args = helper.windowsPowerShellArguments('& { Get-Date }');
  assert.deepEqual(args.slice(0, 5), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command']);
  assert.match(args[5], /^\$env:PSModulePath = \(Join-Path \$PSHOME 'Modules'\) \+ ';' \+ \(Join-Path \(\[Environment\]::GetFolderPath\('ProgramFiles'\)\) 'WindowsPowerShell\\Modules'\)\n& \{ Get-Date \}$/);

  const temp = path.join(require('node:os').tmpdir(), `dialed-ps-temp-${process.pid}`);
  try {
    helper.usePowerShellTempDirectory(temp);
    assert.ok(fs.statSync(temp).isDirectory(), 'the folder is created');
    const environment = helper.windowsPowerShellEnvironment({ Temp: 'C:\\Users\\x\\AppData\\Local\\Temp', tmp: 'y', Path: 'C:\\Windows' });
    assert.deepEqual(environment, { Path: 'C:\\Windows', TEMP: temp, TMP: temp });
  } finally {
    helper.usePowerShellTempDirectory(null);
    fs.rmSync(temp, { recursive: true, force: true });
  }
  assert.deepEqual(helper.windowsPowerShellEnvironment({ TEMP: 'kept' }), { TEMP: 'kept' }, 'without a protected folder, TEMP is left alone');
});

test('the injectable launchers really start the pinned PowerShell with the reset module path', async () => {
  const { EventEmitter } = require('node:events');
  const calls = [];
  const spawnProcess = (executable, args, options) => {
    calls.push({ executable, args, env: options.env });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { end: () => {}, on: () => {} };
    child.kill = () => {};
    setImmediate(() => { child.stdout.emit('data', Buffer.from('[]')); child.emit('close', 1); });
    return child;
  };
  await require('../src/main/optional-apps/index.cjs').runPowerShell('& { }', { spawnProcess }).catch(() => {});
  await presentmon.listPresentMonTargets({ spawnProcess }).catch(() => {});
  await presentmon.readAuthenticodeSignature('C:\\x.exe', { spawnProcess }).catch(() => {});
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.match(call.executable, /\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe$/);
    assert.match(call.args.at(-1), /^\$env:PSModulePath = /);
    assert.ok(!Object.keys(call.env).some((name) => name.toLowerCase() === 'psmodulepath'));
  }
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
