const assert = require('node:assert/strict');
const { test } = require('node:test');
const { tempDir } = require('./helpers/temp-dir.cjs');
const closeApps = require('../src/main/close-apps/index.cjs');
const capabilities = require('../src/main/capabilities/index.cjs');
const journal = require('../src/main/journal/index.cjs');
const sessionUser = require('../src/main/session-user/index.cjs');

// Shapes as listed on the owner's PC (read-only), plus the entries that must not be offered.
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const RIOT = 'C:\\Riot Games\\Riot Client\\RiotClientServices.exe';
const LISTED = [
  { path: CHROME, name: 'chrome', description: 'Google Chrome', company: 'Google LLC', window: false },
  { path: CHROME, name: 'chrome', description: 'Google Chrome', company: 'Google LLC', window: true },
  { path: RIOT, name: 'RiotClientServices', description: 'Riot Client', company: 'Riot Games, Inc.', window: false },
  { path: 'C:\\Program Files\\Riot Vanguard\\vgtray.exe', name: 'vgtray', description: 'Vanguard tray', window: false },
  { path: 'C:\\Program Files\\FACEIT AC\\faceitclient.exe', name: 'faceitclient', description: 'FACEIT', window: false },
  { path: 'C:\\Program Files\\EA\\AC\\EAAntiCheat.GameService.exe', name: 'EAAntiCheat.GameService', description: 'EA', window: false },
  { path: 'C:\\ProgramData\\Microsoft\\Windows Defender\\Platform\\4.18\\MpDefenderCoreService.exe', name: 'MpDefenderCoreService', description: 'Microsoft Defender Session Helper', window: false },
  // Matched by publisher, not description.
  { path: 'C:\\Program Files\\Malwarebytes\\Anti-Malware\\mbamtray.exe', name: 'mbamtray', description: 'Tray Application', company: 'Malwarebytes', window: false },
  // Matched only because Windows Security Center registered its folder.
  { path: 'C:\\Program Files\\Obscure AV\\tray.exe', name: 'tray', description: 'Tray', company: 'Obscure Ltd', window: false, security: true },
  { path: 'C:\\Program Files\\Mullvad VPN\\Mullvad VPN.exe', name: 'Mullvad VPN', description: 'Mullvad VPN', company: 'Mullvad VPN AB', window: false },
  { path: 'C:\\Program Files (x86)\\Microsoft\\EdgeWebView\\Application\\msedgewebview2.exe', name: 'msedgewebview2', description: 'Microsoft Edge WebView2', window: false },
  { path: 'C:\\Program Files\\NVIDIA Corporation\\NvContainer\\nvcontainer.exe', name: 'nvcontainer', description: 'nvcontainer', window: false },
  { path: 'C:\\Program Files\\Dialed\\Dialed.exe', name: 'Dialed', description: 'Dialed', window: true },
  { path: 'C:\\Program Files\\AMD\\CNext\\CNext\\RadeonSoftware.exe', name: 'RadeonSoftware', description: 'AMD Software: Host Application', window: false },
  { path: 'C:\\Program Files\\Common Files\\microsoft shared\\ink\\TabTip.exe', name: 'TabTip', description: 'Touch Keyboard and Handwriting Panel', window: false },
  { path: 'relative\\x.exe', name: 'x', description: 'x', window: false },
];

test('only ordinary programs are listed, one row per program file', () => {
  const programs = closeApps.normalizePrograms(LISTED, 'C:\\Program Files\\Dialed');
  assert.deepEqual(programs.map((item) => [item.name, item.processes, item.hasWindow]), [['Google Chrome', 2, true], ['Riot Client', 1, false]]);
});

test('the listing reads paths without opening processes, and the scripts keep their backslashes', () => {
  assert.doesNotMatch(closeApps.LIST_SCRIPT, /MainModule/);
  assert.doesNotMatch(closeApps.closeScript([CHROME]), /MainModule/);
  assert.match(closeApps.LIST_SCRIPT, /Win32_Process/);
  // A cooked template literal would drop these backslashes and silently change the filter.
  assert.ok(closeApps.LIST_SCRIPT.includes("'root\\SecurityCenter2'"));
  assert.ok(closeApps.LIST_SCRIPT.includes("TrimEnd('\\') + '\\'"));
});

test('only chosen programs in a fresh listing are closed, and outcomes are reported per program', async () => {
  const scripts = [];
  const run = async (script) => {
    scripts.push(script);
    if (scripts.length === 1) return { stdout: JSON.stringify(LISTED) };
    return { stdout: JSON.stringify([{ path: CHROME, outcome: 'STILL_OPEN' }, { path: RIOT, outcome: 'ENDED' }]) };
  };
  const result = await closeApps.closePrograms([CHROME.toUpperCase(), RIOT, LISTED[3].path, 'C:\\not\\running.exe'], 'C:\\Program Files\\Dialed', run);
  assert.deepEqual(result.results.map((item) => [item.name, item.outcome]), [['Google Chrome', 'STILL_OPEN'], ['Riot Client', 'ENDED']]);
  assert.equal(scripts.length, 2);
  assert.doesNotMatch(scripts[1], new RegExp(Buffer.from(LISTED[3].path).toString('base64')), 'anti-cheat is never passed to the close script');
  assert.match(scripts[1], /CloseMainWindow/);
  assert.match(scripts[1], /AddSeconds\(5\)/);
  // A program still showing a window is left alone, never force-ended.
  assert.match(scripts[1], /MainWindowHandle -ne 0[\s\S]*STILL_OPEN[\s\S]*Stop-Process/);
  await assert.rejects(() => closeApps.closePrograms([], null, run), /between 1 and 40/);
});

test('reopening accepts only programs closed this session and reports what came back with admin rights', async () => {
  let script = '';
  const run = async (text) => { script = text; return { stdout: JSON.stringify([{ path: CHROME, running: true, elevated: true }]) }; };
  const result = await closeApps.reopenPrograms([CHROME, RIOT], new Set([CHROME]), run);
  assert.deepEqual(result, { reopened: [CHROME], elevated: [CHROME], notStarted: [] });
  assert.match(script, /explorer\.exe/);
  assert.match(script, /DialedToken/);
  assert.doesNotMatch(script, new RegExp(Buffer.from(RIOT).toString('base64')));
  const absent = await closeApps.reopenPrograms([CHROME], new Set([CHROME]), async () => ({ stdout: JSON.stringify([{ path: CHROME, running: false, elevated: false }]) }));
  assert.deepEqual(absent, { reopened: [], elevated: [], notStarted: [CHROME] });
  assert.deepEqual(await closeApps.reopenPrograms([RIOT], new Set(), async () => { throw new Error('must not run'); }), { reopened: [], elevated: [], notStarted: [] });
});

test('closing and reopening are refused when Dialed runs as a different account from the one signed in', () => {
  assert.ok(sessionUser.PER_USER_CAPABILITIES.has('process:close-chosen-programs'));
  assert.throws(() => sessionUser.assertPerUserCapabilityAllowed('process:close-chosen-programs', { sameUser: false, processName: 'PC\\Admin', sessionName: 'PC\\Kid' }), /different Windows account/);
  sessionUser.assertPerUserCapabilityAllowed('process:close-chosen-programs', { sameUser: true });
});

test('what was closed is written to History as something Dialed cannot undo', () => {
  const directory = tempDir('dialed-close-history-');
  const entry = journal.recordClosedPrograms(directory, [{ name: 'Google Chrome', path: CHROME, outcome: 'CLOSED' }, { name: 'Riot Client', path: RIOT, outcome: 'STILL_OPEN' }]);
  assert.equal(entry.title, 'Close before a game: Google Chrome (closed), Riot Client (left open)');
  assert.equal(entry.status, 'SUCCESS');
  assert.equal(entry.rollback.available, false);
  assert.match(entry.rollback.reason, /not undone by Dialed/);
  assert.equal(journal.recordClosedPrograms(directory, []), null);
});

test('the capability promises no FPS figure and does not claim more than it checks', () => {
  const capability = capabilities.capabilityForAction('process:close-chosen-programs');
  assert.equal(capability.id, 'process:close-chosen-programs');
  assert.match(capability.expectedBenefit, /No FPS or latency figure is promised/);
  assert.match(capability.rollbackLimitations, /still showing a window is left open/);
  assert.equal(capability.riskLevel, 'Medium');
  assert.doesNotMatch(JSON.stringify(capability), /never listed|do not inherit administrator rights/);
});
