const path = require('node:path');
const { runPowerShell, ANTI_CHEAT_PROCESS_NAMES_BY_PRODUCT } = require('../scanner/index.cjs');

// "Close before a game": programs the reader picked by name, closed together after one review and
// reopened on request. Closing is not undoable the way a setting is: what a program had open is
// gone, and reopening starts it fresh. Programs in the Windows folder, Dialed, and the security and
// anti-cheat programs Dialed recognises are not listed, and only a program in a fresh listing can
// be closed. Recognition is by name, publisher and Windows Security Center registration, so it is
// not a guarantee: the review names every program before anything closes.
const ANTI_CHEAT = new Set([
  ...Object.values(ANTI_CHEAT_PROCESS_NAMES_BY_PRODUCT).flat(),
  // Products the shared list does not carry: FACEIT, EA AntiCheat, Tencent ACE, GameGuard, PunkBuster, EAC's launcher.
  'faceit', 'faceitclient', 'faceitservice', 'eaanticheat.gameservice', 'eaanticheat.gameservicelauncher', 'eaanticheat.installer',
  'sguard64', 'sguardsvc64', 'ace-tray', 'gamemon', 'gamemon64', 'gameguard', 'pnkbstra', 'pnkbstrb', 'start_protected_game', 'easyanticheat_launcher',
]);
// Windows shell and input pieces that can live outside the Windows folder.
const NEVER = new Set(['explorer', 'dwm', 'csrss', 'winlogon', 'sihost', 'ctfmon', 'textinputhost', 'searchhost', 'startmenuexperiencehost', 'shellexperiencehost', 'runtimebroker', 'applicationframehost', 'systemsettings', 'securityhealthsystray', 'msmpeng', 'nissrv', 'powershell', 'pwsh', 'conhost', 'cmd', 'windowsterminal', 'openconsole',
  // Graphics driver containers and the browser engine other apps run inside; closing them breaks other programs.
  'nvcontainer', 'nvdisplay.container', 'msedgewebview2',
  // AMD's driver software, for the same reason as NVIDIA's, and the Windows touch keyboard.
  'radeonsoftware', 'amdrsserv', 'amdrssrcext', 'amdow', 'cncmd', 'tabtip']);
// Security, VPN and password software, matched on the file's description and publisher.
const SECURITY = /defender|antivirus|anti-virus|anti-malware|security|firewall|malwarebytes|eset|bitdefender|kaspersky|avast|\bavg\b|norton|mcafee|sophos|crowdstrike|sentinelone|trend micro|webroot|f-secure|\bvpn\b|wireguard|openvpn|tailscale|password|bitwarden|keepass/i;
const GRACE_SECONDS = 5;
const OUTCOMES = ['CLOSED', 'ENDED', 'STILL_OPEN', 'STILL_RUNNING'];

function encode(value) { return Buffer.from(String(value), 'utf8').toString('base64'); }

// Paths come from Win32_Process, which does not open the process for memory reads the way
// Process.MainModule does; opening a protected game that way is what anti-cheat watches for.
const LIST_SCRIPT = String.raw`& {
  $session = (Get-Process -Id $PID).SessionId
  $windows = [IO.Path]::GetFullPath($env:WINDIR).TrimEnd('\') + '\'
  $security = @()
  try {
    $security = @(Get-CimInstance -Namespace 'root\SecurityCenter2' -ClassName AntiVirusProduct -OperationTimeoutSec 3 -ErrorAction Stop | ForEach-Object {
      $exe = [Environment]::ExpandEnvironmentVariables([string]$_.pathToSignedProductExe).Trim('"')
      if ($exe -match '^[A-Za-z]:\\') { (Split-Path -Parent $exe).TrimEnd('\') + '\' }
    })
  } catch {}
  $windowed = @{}
  foreach ($p in Get-Process) { if ($p.SessionId -eq $session -and $p.MainWindowHandle -ne 0) { $windowed[[int]$p.Id] = $true } }
  $rows = foreach ($process in Get-CimInstance Win32_Process | Where-Object { $_.SessionId -eq $session -and $_.ExecutablePath }) {
    $file = [string]$process.ExecutablePath
    if ($file.StartsWith($windows, [StringComparison]::OrdinalIgnoreCase)) { continue }
    $registered = $false
    foreach ($directory in $security) { if ($file.StartsWith($directory, [StringComparison]::OrdinalIgnoreCase)) { $registered = $true } }
    $info = $null; try { $info = [Diagnostics.FileVersionInfo]::GetVersionInfo($file) } catch {}
    [pscustomobject]@{ path = $file; name = [IO.Path]::GetFileNameWithoutExtension($file); description = [string]$info.FileDescription; company = [string]$info.CompanyName; window = $windowed.ContainsKey([int]$process.ProcessId); security = $registered }
  }
  @($rows) | ConvertTo-Json -Compress
}`;

/** One row per program file, with what Dialed must not offer removed. */
function normalizePrograms(raw, ownDirectory) {
  const own = ownDirectory ? path.resolve(ownDirectory).toLowerCase() + path.sep : null;
  const byPath = new Map();
  for (const item of Array.isArray(raw) ? raw : raw ? [raw] : []) {
    if (typeof item?.path !== 'string' || !/^[A-Za-z]:\\/.test(item.path) || typeof item.name !== 'string') continue;
    const key = item.path.toLowerCase();
    const name = item.name.toLowerCase();
    if (ANTI_CHEAT.has(name) || NEVER.has(name) || (own && key.startsWith(own)) || item.security === true
      || SECURITY.test(`${item.description ?? ''} ${item.company ?? ''}`)) continue;
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

function decodeList(paths) {
  return paths.map((item) => `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(item)}'))`).join(',');
}

function closeScript(paths) {
  return String.raw`& {
  $session = (Get-Process -Id $PID).SessionId
  $targets = @(${decodeList(paths)})
  $running = {
    $map = @{}
    foreach ($p in Get-CimInstance Win32_Process | Where-Object { $_.SessionId -eq $session -and $_.ExecutablePath }) {
      $key = ([string]$p.ExecutablePath).ToLowerInvariant()
      if (-not $map.ContainsKey($key)) { $map[$key] = New-Object System.Collections.Generic.List[int] }
      $map[$key].Add([int]$p.ProcessId)
    }
    $map
  }
  $idsOf = { param($map, $file) $key = $file.ToLowerInvariant(); if ($map.ContainsKey($key)) { @($map[$key]) } else { @() } }
  $map = & $running
  foreach ($file in $targets) { foreach ($id in (& $idsOf $map $file)) { try { [void](Get-Process -Id $id -ErrorAction Stop).CloseMainWindow() } catch {} } }
  $deadline = (Get-Date).AddSeconds(${GRACE_SECONDS})
  do { Start-Sleep -Milliseconds 400; $map = & $running } while ((Get-Date) -lt $deadline -and @($targets | Where-Object { @(& $idsOf $map $_).Count }).Count)
  $result = foreach ($file in $targets) {
    $ids = @(& $idsOf $map $file)
    $outcome = 'CLOSED'
    if ($ids.Count) {
      # A program that still shows a window may be asking whether to save; it is left open.
      $showing = @($ids | Where-Object { try { (Get-Process -Id $_ -ErrorAction Stop).MainWindowHandle -ne 0 } catch { $false } })
      if ($showing.Count) { $outcome = 'STILL_OPEN' }
      else {
        foreach ($id in $ids) { try { Stop-Process -Id $id -Force -ErrorAction Stop } catch {} }
        Start-Sleep -Milliseconds 500
        $outcome = if (@(& $idsOf (& $running) $file).Count) { 'STILL_RUNNING' } else { 'ENDED' }
      }
    }
    [pscustomobject]@{ path = $file; outcome = $outcome }
  }
  @($result) | ConvertTo-Json -Compress
}`;
}

/**
 * Closes exactly the chosen programs that appear in a fresh listing. Each is asked to close; after
 * ${GRACE_SECONDS} seconds one with no window left is ended like Task Manager's End task, and one
 * still showing a window is left open. The reader is told this before it runs.
 */
async function closePrograms(paths, ownDirectory, run = runPowerShell) {
  if (!Array.isArray(paths) || !paths.length || paths.length > 40) throw new Error('Choose between 1 and 40 programs to close.');
  const current = await listClosablePrograms(ownDirectory, run);
  const allowed = new Map(current.map((item) => [item.path.toLowerCase(), item]));
  const chosen = [...new Set(paths.filter((item) => typeof item === 'string').map((item) => item.toLowerCase()))].map((key) => allowed.get(key)).filter(Boolean);
  if (!chosen.length) return { results: [] };
  const { stdout } = await run(closeScript(chosen.map((item) => item.path)), 60000);
  let parsed = [];
  try { parsed = JSON.parse(String(stdout).trim() || '[]'); } catch { throw new Error('Dialed could not confirm which programs closed. Check Task Manager.'); }
  const outcomes = new Map((Array.isArray(parsed) ? parsed : [parsed]).map((item) => [String(item?.path).toLowerCase(), item?.outcome]));
  return { results: chosen.map((item) => ({ path: item.path, name: item.name, outcome: OUTCOMES.includes(outcomes.get(item.path.toLowerCase())) ? outcomes.get(item.path.toLowerCase()) : 'STILL_RUNNING' })) };
}

// Reads whether a process runs with administrator rights, to check what Explorer started.
const TOKEN_READER = `
using System;
using System.Runtime.InteropServices;
public static class DialedToken {
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int id);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool GetTokenInformation(IntPtr token, int kind, out int value, int length, out int returned);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  // 1 elevated, 0 not, -1 could not be read.
  public static int Elevated(int id) {
    IntPtr process = OpenProcess(0x1000, false, id);
    if (process == IntPtr.Zero) return -1;
    try {
      IntPtr token;
      if (!OpenProcessToken(process, 0x0008, out token)) return -1;
      try { int value, returned; return GetTokenInformation(token, 20, out value, 4, out returned) ? (value != 0 ? 1 : 0) : -1; }
      finally { CloseHandle(token); }
    } finally { CloseHandle(process); }
  }
}`;

function reopenScript(paths) {
  return String.raw`& {
  $session = (Get-Process -Id $PID).SessionId
  $targets = @(${decodeList(paths)})
  Add-Type -TypeDefinition ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(TOKEN_READER)}'))) -ErrorAction Stop
  foreach ($file in $targets) { if (Test-Path -LiteralPath $file) { Start-Process -FilePath (Join-Path $env:WINDIR 'explorer.exe') -ArgumentList ('"' + $file + '"') } }
  Start-Sleep -Seconds 4
  $now = @(Get-CimInstance Win32_Process | Where-Object { $_.SessionId -eq $session -and $_.ExecutablePath })
  $result = foreach ($file in $targets) {
    $ids = @($now | Where-Object { [string]::Equals([string]$_.ExecutablePath, $file, [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { [int]$_.ProcessId })
    $levels = @($ids | ForEach-Object { [DialedToken]::Elevated($_) })
    [pscustomobject]@{ path = $file; running = [bool]$ids.Count; elevated = ($levels -contains 1) }
  }
  @($result) | ConvertTo-Json -Compress
}`;
}

/**
 * Asks Explorer to start the given programs, which normally runs them as the signed-in user without
 * Dialed's administrator rights. That hand-off is Explorer's behaviour, not a guarantee, so each
 * program is checked afterwards and one found running as administrator is reported. Only programs
 * Dialed closed in this session are accepted. The caller refuses this entirely when Dialed runs as
 * a different account from the one signed in, where there is no Explorer of that account to ask.
 */
async function reopenPrograms(paths, closedThisSession, run = runPowerShell) {
  const allowed = new Set([...closedThisSession].map((item) => item.toLowerCase()));
  const chosen = [...new Set((Array.isArray(paths) ? paths : []).filter((item) => typeof item === 'string' && allowed.has(item.toLowerCase())))];
  if (!chosen.length) return { reopened: [], elevated: [], notStarted: [] };
  const { stdout } = await run(reopenScript(chosen), 60000);
  let parsed = [];
  try { parsed = JSON.parse(String(stdout).trim() || '[]'); } catch { throw new Error('Dialed could not confirm which programs started again. Check whether they are open.'); }
  const state = new Map((Array.isArray(parsed) ? parsed : [parsed]).map((item) => [String(item?.path).toLowerCase(), item]));
  const running = chosen.filter((item) => state.get(item.toLowerCase())?.running === true);
  return {
    reopened: running,
    elevated: running.filter((item) => state.get(item.toLowerCase())?.elevated === true),
    notStarted: chosen.filter((item) => !running.includes(item)),
  };
}

module.exports = { GRACE_SECONDS, LIST_SCRIPT, TOKEN_READER, normalizePrograms, listClosablePrograms, closeScript, reopenScript, closePrograms, reopenPrograms };
