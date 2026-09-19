const { runPowerShell } = require('../scanner/index.cjs');

// The audit journal lives in per-user app data, so any program running as the same user
// can edit it. For the one restore that writes an arbitrary command line into a
// machine-wide location — a machine-wide startup (Run) entry — Dialed keeps its own copy
// of what it removed under HKLM\SOFTWARE\Dialed. Only administrators can create or change
// keys there (a standard user cannot even pre-create the parent key), and Dialed runs as
// administrator. The restore uses this protected copy, not the journal.
const PROTECTED_ROOT = 'HKLM:\\SOFTWARE\\Dialed\\ProtectedStartupBackups';
const ENTRY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELDS = Object.freeze(['registryPath', 'registryView', 'valueName', 'value', 'registryValueKind']);

function encode(value) {
  return Buffer.from(String(value), 'utf8').toString('base64');
}

function decodeExpression(base64) {
  return `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${base64}'))`;
}

function assertEntryId(entryId) {
  if (typeof entryId !== 'string' || !ENTRY_ID.test(entryId)) throw new Error('The protected copy identifier is not valid.');
  return entryId.toLowerCase();
}

function keyPath(entryId) {
  // Under the Node test runner the real machine registry is never touched, even if a test
  // forgets to pass a fake. Tests run in shells that may be elevated.
  if (process.env.NODE_TEST_CONTEXT) throw new Error('The protected store is not available inside the test runner; pass a fake.');
  return `${PROTECTED_ROOT}\\${assertEntryId(entryId)}`;
}

async function writeProtectedStartupBackup(entryId, preAction, run = runPowerShell) {
  const path = keyPath(entryId);
  const sets = FIELDS.map((field) => {
    const value = preAction?.[field];
    if (typeof value !== 'string') throw new Error('The startup entry to protect is incomplete.');
    return `New-ItemProperty -LiteralPath $key -Name '${field}' -PropertyType String -Value (${decodeExpression(encode(value))}) -Force -ErrorAction Stop | Out-Null`;
  }).join('; ');
  const script = `& { $key = ${decodeExpression(encode(path))}; if (Test-Path -LiteralPath $key) { throw 'A protected copy already exists for this entry.' }; New-Item -Path $key -Force -ErrorAction Stop | Out-Null; ${sets}; [pscustomobject]@{ written = $true } | ConvertTo-Json -Compress }`;
  const { stdout, stderr, exitCode } = await run(script);
  return { output: JSON.parse(stdout), stdout, stderr, exitCode };
}

async function readProtectedStartupBackup(entryId, run = runPowerShell) {
  const path = keyPath(entryId);
  const reads = FIELDS.map((field) => `'${field}' = [string]$item.GetValue('${field}', $null)`).join('; ');
  const script = `& { $key = ${decodeExpression(encode(path))}; if (-not (Test-Path -LiteralPath $key)) { [pscustomobject]@{ exists = $false } | ConvertTo-Json -Compress; return }; $item = Get-Item -LiteralPath $key -ErrorAction Stop; [pscustomobject]@{ exists = $true; ${reads} } | ConvertTo-Json -Compress }`;
  const { stdout } = await run(script);
  const parsed = JSON.parse(stdout);
  if (!parsed?.exists) return { exists: false };
  return { exists: true, ...Object.fromEntries(FIELDS.map((field) => [field, typeof parsed[field] === 'string' ? parsed[field] : null])) };
}

async function removeProtectedStartupBackup(entryId, run = runPowerShell) {
  const path = keyPath(entryId);
  const { stdout, stderr, exitCode } = await run(`& { $key = ${decodeExpression(encode(path))}; if (Test-Path -LiteralPath $key) { Remove-Item -LiteralPath $key -Recurse -ErrorAction Stop }; [pscustomobject]@{ removed = $true } | ConvertTo-Json -Compress }`);
  return { output: JSON.parse(stdout), stdout, stderr, exitCode };
}

/** True when the journal's record and the protected copy agree on every restored field. */
function matchesProtectedCopy(preAction, copy) {
  return Boolean(copy?.exists) && FIELDS.every((field) => preAction?.[field] === copy[field]);
}

module.exports = {
  FIELDS,
  PROTECTED_ROOT,
  matchesProtectedCopy,
  readProtectedStartupBackup,
  removeProtectedStartupBackup,
  writeProtectedStartupBackup,
};
