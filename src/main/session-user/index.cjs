const { runPowerShell } = require('../scanner/index.cjs');

// Dialed always runs as administrator. A standard user who approves the Windows prompt with
// someone else's administrator password runs Dialed as that other account, so the current-user
// registry hive, AppData, Documents and per-user apps all belong to the administrator, not to the
// person at the keyboard. Changes there would report success and do nothing for the reader.
// The person at the keyboard is taken as the owner of Explorer in Dialed's own session.
const SCRIPT = String.raw`& {
  $ErrorActionPreference = 'Stop'
  $me = [Security.Principal.WindowsIdentity]::GetCurrent()
  $session = (Get-Process -Id $PID).SessionId
  $owners = @(Get-CimInstance Win32_Process -Filter "Name='explorer.exe'" | Where-Object { $_.SessionId -eq $session } | ForEach-Object {
    try { (Invoke-CimMethod -InputObject $_ -MethodName GetOwnerSid).Sid } catch { $null }
  } | Where-Object { $_ } | Select-Object -Unique)
  $names = @($owners | ForEach-Object {
    $sid = $_
    try { (New-Object Security.Principal.SecurityIdentifier($sid)).Translate([Security.Principal.NTAccount]).Value } catch { $sid }
  })
  [pscustomobject]@{ processSid = $me.User.Value; processName = $me.Name; sessionSids = [string[]]$owners; sessionNames = [string[]]$names } | ConvertTo-Json -Compress
}`;

const SID = /^S-1-5-21(-\d+){4}$/;

/**
 * Compares the account Dialed runs as with the account signed in to its session.
 * sameUser is null when that cannot be told (no Explorer, or several owners).
 */
function classifySessionIdentity(report) {
  const processSid = typeof report?.processSid === 'string' ? report.processSid : '';
  const sessionSids = (Array.isArray(report?.sessionSids) ? report.sessionSids : typeof report?.sessionSids === 'string' ? [report.sessionSids] : []).filter((sid) => typeof sid === 'string' && SID.test(sid));
  const sessionNames = Array.isArray(report?.sessionNames) ? report.sessionNames.filter((name) => typeof name === 'string') : typeof report?.sessionNames === 'string' ? [report.sessionNames] : [];
  const processName = typeof report?.processName === 'string' ? report.processName : '';
  if (!SID.test(processSid) || sessionSids.length !== 1) return { sameUser: null, processName, sessionName: null };
  return { sameUser: sessionSids[0] === processSid, processName, sessionName: sessionNames[0] || null };
}

async function readSessionIdentity(run = runPowerShell) {
  if (run === runPowerShell && process.env.NODE_TEST_CONTEXT) throw new Error('The session identity is not read inside the test runner; pass a fake.');
  const { stdout } = await run(SCRIPT);
  return classifySessionIdentity(JSON.parse(stdout));
}

// Capabilities that change the current user's registry hive or files. Under another
// administrator's account they would change that account instead.
const PER_USER_CAPABILITIES = Object.freeze(new Set([
  'startup:disable-current-user-run',
  'graphics:per-app-gpu-preference',
  'gaming:game-mode',
  'gaming:background-recording',
  'input:mouse-acceleration',
  'graphics:windowed-game-optimizations',
  'graphics:fullscreen-optimizations',
  'windows:optional-app-remove-current-user',
  'game:reviewed-profile',
  'game:config-backup',
  'game:config-restore',
  'maintenance:clear-temp-files',
  'maintenance:clear-shader-caches',
  'maintenance:clear-crash-dumps',
]));

function accountMismatchMessage(identity) {
  const running = identity?.processName ? ` (${identity.processName})` : '';
  const signedIn = identity?.sessionName ? ` (${identity.sessionName})` : '';
  return `Dialed is running as a different Windows account${running} from the one signed in${signedIn}, because another account's administrator password was used to start it. Settings for the signed-in account cannot be changed this way. Sign in to an administrator account, or ask its owner to make the change.`;
}

/** Refuses a per-user change while Dialed runs as another account. Unknown is not refused. */
function assertPerUserCapabilityAllowed(capabilityId, identity) {
  if (PER_USER_CAPABILITIES.has(capabilityId) && identity?.sameUser === false) throw new Error(accountMismatchMessage(identity));
}

module.exports = { PER_USER_CAPABILITIES, SCRIPT, accountMismatchMessage, assertPerUserCapabilityAllowed, classifySessionIdentity, readSessionIdentity };
