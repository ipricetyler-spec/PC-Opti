const path = require('node:path');
const { runPowerShell, ANTI_CHEAT_PROCESS_NAMES_BY_PRODUCT } = require('../scanner/index.cjs');

// "Close before a game": programs the reader picked by name, closed together after one review and
// reopened on request. Closing is not undoable the way a setting is: what a program had open is
// gone, and reopening starts it fresh. Windows' own programs, anti-cheat and Dialed are never
// listed, and only a program in this fresh listing can be closed.
const ANTI_CHEAT = new Set(Object.values(ANTI_CHEAT_PROCESS_NAMES_BY_PRODUCT).flat());
// Windows shell and input pieces that can live outside the Windows folder.
const NEVER = new Set(['explorer', 'dwm', 'csrss', 'winlogon', 'sihost', 'ctfmon', 'textinputhost', 'searchhost', 'startmenuexperiencehost', 'shellexperiencehost', 'runtimebroker', 'applicationframehost', 'systemsettings', 'securityhealthsystray', 'msmpeng', 'nissrv', 'powershell', 'pwsh', 'conhost', 'cmd', 'windowsterminal', 'openconsole',
  // Graphics driver containers and the browser engine other apps run inside; closing them breaks other programs.
  'nvcontainer', 'nvdisplay.container', 'msedgewebview2']);
// Security software is never offered, whatever its file name.
const SECURITY = /defender|antivirus|anti-virus|security|firewall/i;
const GRACE_SECONDS = 5;

function encode(value) { return Buffer.from(String(value), 'utf8').toString('base64'); }

const LIST_SCRIPT = `& {
  $session = [Diagnostics.Process]::GetCurrentProcess().SessionId
  $windows = [IO.Path]::GetFullPath($env:WINDIR).TrimEnd('\\') + '\\'
  $rows = foreach ($process in Get-Process | Where-Object { $_.SessionId -eq $session }) {
    $file = $null; try { $file = $process.MainModule.FileName } catch {}
    if (-not $file -or $file.StartsWith($windows, [StringComparison]::OrdinalIgnoreCase)) { continue }
    $description = $null; try { $description = $process.MainModule.FileVersionInfo.FileDescription } catch {}
    [pscustomobject]@{ path = $file; name = $process.ProcessName; description = $description; window = ($process.MainWindowHandle -ne 0) }
  }
  @($rows) | ConvertTo-Json -Compress
}`;

/** One row per program file, with what Dialed must never offer removed. */
function normalizePrograms(raw, ownDirectory) {
  const own = ownDirectory ? path.resolve(ownDirectory).toLowerCase() + path.sep : null;
  const byPath = new Map();
  for (const item of Array.isArray(raw) ? raw : raw ? [raw] : []) {
    if (typeof item?.path !== 'string' || !/^[A-Za-z]:\\/.test(item.path) || typeof item.name !== 'string') continue;
    const key = item.path.toLowerCase();
    const name = item.name.toLowerCase();
    if (ANTI_CHEAT.has(name) || NEVER.has(name) || (own && key.startsWith(own)) || SECURITY.test(String(item.description ?? ''))) continue;
    const entry = byPath.get(key) ?? { path: item.path, name: (typeof item.description === 'string' && item.description.trim()) || item.name, processes: 0, hasWindow: false };
    entry.processes += 1; entry.hasWindow = entry.hasWindow || item.window === true;
    byPath.set(key, entry);
  }
  return [...byPath.values()].sort((left, right) => left.name.localeCompare(right.name));
}

async function listClosablePrograms(ownDirectory, run = runPowerShell) {
  const { stdout } = await run(LIST_SCRIPT);
  let parsed = [];
  try { parsed = JSON.parse(String(stdout).trim() || '[]'); } catch { throw new Error('Dialed could not list the running programs. Nothing was closed.'); }
  return normalizePrograms(parsed, ownDirectory);
}

function closeScript(paths) {
  const list = paths.map((item) => `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(item)}'))`).join(',');
  return `& {
  $session = [Diagnostics.Process]::GetCurrentProcess().SessionId
  $targets = @(${list})
  $of = { param($file) @(Get-Process | Where-Object { $_.SessionId -eq $session } | Where-Object { $f = $null; try { $f = $_.MainModule.FileName } catch {}; $f -and [string]::Equals($f, $file, [StringComparison]::OrdinalIgnoreCase) }) }
  foreach ($file in $targets) { foreach ($process in (& $of $file)) { try { [void]$process.CloseMainWindow() } catch {} } }
  $deadline = (Get-Date).AddSeconds(${GRACE_SECONDS})
  while ((Get-Date) -lt $deadline -and @($targets | Where-Object { (& $of $_).Count }).Count) { Start-Sleep -Milliseconds 250 }
  $result = foreach ($file in $targets) {
    $left = & $of $file
    $outcome = 'CLOSED'
    if ($left.Count) { foreach ($process in $left) { try { Stop-Process -Id $process.Id -Force -ErrorAction Stop } catch {} }; Start-Sleep -Milliseconds 500; $outcome = if ((& $of $file).Count) { 'STILL_RUNNING' } else { 'ENDED' } }
    [pscustomobject]@{ path = $file; outcome = $outcome }
  }
  @($result) | ConvertTo-Json -Compress
}`;
}

/**
 * Closes exactly the chosen programs that appear in a fresh listing: politely first, then, after
 * ${GRACE_SECONDS} seconds, ended like Task Manager's End task. The reader is told both before it runs.
 */
async function closePrograms(paths, ownDirectory, run = runPowerShell) {
  if (!Array.isArray(paths) || !paths.length || paths.length > 40) throw new Error('Choose between 1 and 40 programs to close.');
  const current = await listClosablePrograms(ownDirectory, run);
  const allowed = new Map(current.map((item) => [item.path.toLowerCase(), item]));
  const chosen = [...new Set(paths.filter((item) => typeof item === 'string').map((item) => item.toLowerCase()))].map((key) => allowed.get(key)).filter(Boolean);
  if (!chosen.length) return { results: [] };
  const { stdout } = await run(closeScript(chosen.map((item) => item.path)));
  let parsed = [];
  try { parsed = JSON.parse(String(stdout).trim() || '[]'); } catch { throw new Error('Dialed could not confirm which programs closed. Check Task Manager.'); }
  const outcomes = new Map((Array.isArray(parsed) ? parsed : [parsed]).map((item) => [String(item?.path).toLowerCase(), item?.outcome]));
  return { results: chosen.map((item) => ({ path: item.path, name: item.name, outcome: ['CLOSED', 'ENDED', 'STILL_RUNNING'].includes(outcomes.get(item.path.toLowerCase())) ? outcomes.get(item.path.toLowerCase()) : 'STILL_RUNNING' })) };
}

/**
 * Starts the given programs again through Explorer, so they run as the signed-in user and not with
 * Dialed's administrator rights. Only programs Dialed closed in this session are accepted.
 */
async function reopenPrograms(paths, closedThisSession, run = runPowerShell) {
  const allowed = new Set([...closedThisSession].map((item) => item.toLowerCase()));
  const chosen = [...new Set((Array.isArray(paths) ? paths : []).filter((item) => typeof item === 'string' && allowed.has(item.toLowerCase())))];
  if (!chosen.length) return { reopened: [] };
  const starts = chosen.map((item) => `if (Test-Path -LiteralPath ($p = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(item)}')))) { Start-Process -FilePath (Join-Path $env:WINDIR 'explorer.exe') -ArgumentList ('"' + $p + '"'); $p }`).join('\n');
  const { stdout } = await run(`& {\n${starts}\n}`);
  const started = new Set(String(stdout).split(/\r?\n/).map((line) => line.trim().toLowerCase()).filter(Boolean));
  return { reopened: chosen.filter((item) => started.has(item.toLowerCase())) };
}

module.exports = { GRACE_SECONDS, normalizePrograms, listClosablePrograms, closeScript, closePrograms, reopenPrograms };
