const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { listPowerShellScripts } = require('./helpers/powershell-scripts.cjs');
const { windowsPowerShellEnvironment } = require('../src/main/shared/windows-powershell-env.cjs');

const MAIN = path.join(__dirname, '..', 'src', 'main');
// Files that run PowerShell only through a script built in another module.
const REUSES_ANOTHER_MODULE = new Set(['src/main/updater/index.cjs']);

function sourceFiles(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) sourceFiles(full, out);
    else if (name.endsWith('.cjs')) out.push(full);
  }
  return out;
}

test('no script uses a bare try/catch as a value; it swallows the next line and breaks parsing', () => {
  const offenders = [];
  for (const file of sourceFiles(MAIN)) {
    fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, index) => {
      if (/=\s*try\s*\{/.test(line)) offenders.push(`${path.relative(MAIN, file)}:${index + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
});

test('every file that runs PowerShell has its scripts found by the syntax check', () => {
  const root = path.join(__dirname, '..');
  const found = new Set(listPowerShellScripts().map((script) => script.where.split(':')[0]));
  const missed = sourceFiles(MAIN)
    .filter((file) => /runPowerShell\(|powershell\.exe|powershellPath\(\)/.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(root, file).replace(/\\/g, '/'))
    .filter((file) => !found.has(file) && !REUSES_ANOTHER_MODULE.has(file) && file !== 'src/main/shared/windows-powershell-env.cjs');
  assert.deepEqual(missed, []);
});

// Parses only; nothing is run.
test('Windows PowerShell parses every script Dialed ships', { skip: process.platform !== 'win32' }, () => {
  const scripts = listPowerShellScripts();
  assert.ok(scripts.length >= 70, `only ${scripts.length} scripts found`);
  const input = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dialed-ps-')), 'scripts.json');
  fs.writeFileSync(input, JSON.stringify(scripts));
  const check = `$items = Get-Content -LiteralPath '${input.replace(/'/g, "''")}' -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($item in $items) {
  $errors = $null
  [void][System.Management.Automation.Language.Parser]::ParseInput([string]$item.text, [ref]$null, [ref]$errors)
  foreach ($e in $errors) { '{0} (script line {1}): {2}' -f $item.where, $e.Extent.StartLineNumber, $e.Message }
}`;
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', check], { encoding: 'utf8', env: windowsPowerShellEnvironment(), windowsHide: true });
  fs.rmSync(path.dirname(input), { recursive: true, force: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '', result.stdout);
});
