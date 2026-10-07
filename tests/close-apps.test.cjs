const assert = require('node:assert/strict');
const { test } = require('node:test');
const closeApps = require('../src/main/close-apps/index.cjs');
const capabilities = require('../src/main/capabilities/index.cjs');

// Shapes as listed on the owner's PC (read-only), plus the entries that must never be offered.
const LISTED = [
  { path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', name: 'chrome', description: 'Google Chrome', window: false },
  { path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', name: 'chrome', description: 'Google Chrome', window: true },
  { path: 'C:\\Riot Games\\Riot Client\\RiotClientServices.exe', name: 'RiotClientServices', description: 'Riot Client', window: false },
  { path: 'C:\\Program Files\\Riot Vanguard\\vgtray.exe', name: 'vgtray', description: 'Vanguard tray', window: false },
  { path: 'C:\\ProgramData\\Microsoft\\Windows Defender\\Platform\\4.18\\MpDefenderCoreService.exe', name: 'MpDefenderCoreService', description: 'Microsoft Defender Session Helper', window: false },
  { path: 'C:\\Program Files (x86)\\Microsoft\\EdgeWebView\\Application\\msedgewebview2.exe', name: 'msedgewebview2', description: 'Microsoft Edge WebView2', window: false },
  { path: 'C:\\Program Files\\NVIDIA Corporation\\NvContainer\\nvcontainer.exe', name: 'nvcontainer', description: 'nvcontainer', window: false },
  { path: 'C:\\Program Files\\Dialed\\Dialed.exe', name: 'Dialed', description: 'Dialed', window: true },
  { path: 'relative\\x.exe', name: 'x', description: 'x', window: false },
];

test('only ordinary programs are listed, one row per program file', () => {
  const programs = closeApps.normalizePrograms(LISTED, 'C:\\Program Files\\Dialed');
  assert.deepEqual(programs.map((item) => [item.name, item.processes, item.hasWindow]), [['Google Chrome', 2, true], ['Riot Client', 1, false]]);
});

test('only chosen programs in a fresh listing are closed, and outcomes are reported per program', async () => {
  const scripts = [];
  const run = async (script) => {
    scripts.push(script);
    if (scripts.length === 1) return { stdout: JSON.stringify(LISTED) };
    return { stdout: JSON.stringify([{ path: LISTED[0].path, outcome: 'ENDED' }]) };
  };
  const result = await closeApps.closePrograms([LISTED[0].path.toUpperCase(), LISTED[3].path, 'C:\\not\\running.exe'], 'C:\\Program Files\\Dialed', run);
  assert.deepEqual(result.results.map((item) => [item.name, item.outcome]), [['Google Chrome', 'ENDED']]);
  assert.equal(scripts.length, 2);
  assert.doesNotMatch(scripts[1], new RegExp(Buffer.from(LISTED[3].path).toString('base64')), 'anti-cheat is never passed to the close script');
  assert.match(scripts[1], /CloseMainWindow/);
  assert.match(scripts[1], /AddSeconds\(5\)/);
  await assert.rejects(() => closeApps.closePrograms([], null, run), /between 1 and 40/);
});

test('reopening accepts only programs closed this session and starts them through Explorer', async () => {
  let script = '';
  const result = await closeApps.reopenPrograms([LISTED[0].path, LISTED[2].path], new Set([LISTED[0].path]), async (text) => { script = text; return { stdout: `${LISTED[0].path}\r\n` }; });
  assert.deepEqual(result.reopened, [LISTED[0].path]);
  assert.match(script, /explorer\.exe/);
  assert.doesNotMatch(script, new RegExp(Buffer.from(LISTED[2].path).toString('base64')));
  assert.deepEqual(await closeApps.reopenPrograms([LISTED[2].path], new Set(), async () => { throw new Error('must not run'); }), { reopened: [] });
});

test('the capability promises no FPS figure and says closing is not undoable like a setting', () => {
  const capability = capabilities.capabilityForAction('process:close-chosen-programs');
  assert.equal(capability.id, 'process:close-chosen-programs');
  assert.match(capability.expectedBenefit, /No FPS or latency figure is promised/);
  assert.match(capability.rollbackLimitations, /unsaved work in it is lost/);
});
