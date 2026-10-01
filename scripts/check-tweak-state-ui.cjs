// A Dialed change that Windows set back is shown as no longer in effect, without an Undo that
// would only be refused; an intact change keeps its Undo. Closed fixture: nothing is changed.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.DIALED_PLAYWRIGHT_PATH || 'playwright');
const { listCapabilities } = require('../src/main/capabilities/index.cjs');
const { openFixture, openSection } = require('./ui-fixture-page.cjs');
const origin = process.env.DIALED_UI_URL || 'http://127.0.0.1:5178';
if (new URL(origin).hostname !== '127.0.0.1') throw new Error('Only loopback fixture servers are allowed.');

async function cardText(windowsSaysOn) {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    await context.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await context.addInitScript(({ capabilities, windowsSaysOn }) => {
      const rows = async () => ({ items: [], errors: [] });
      const unavailable = async () => { throw new Error('Unavailable in closed browser fixture.'); };
      const entries = [{ id: 'gm-1', title: 'Game Mode: turn off', timestamp: new Date(Date.now() - 86400000).toISOString(), status: 'SUCCESS', actionId: 'setting:game-mode',
        capabilityId: 'gaming:game-mode', exitCode: 0, rollback: { available: true, kind: 'restore-user-setting', reason: null }, resultingState: { verified: { enabled: false } }, stderr: '' }];
      window.pcOptiNative = {
        getRuntimeProfile: async () => ({ profile: 'public', capabilities }), listCapabilities: async () => capabilities,
        getAuditHistory: async () => ({ entries, recovery: null, protection: { notices: [] } }),
        listStartupItems: rows, listSafePolicies: rows, listTimingExperiments: rows, listManageableProcesses: rows,
        scanSystem: unavailable, getLocalRecommendations: async () => [], listGameSettingsGuides: async () => [],
        listBenchmarkEvidence: unavailable, getReleaseStatus: unavailable, listPowerPlans: unavailable,
        readUserSettings: async () => ({ 'game-mode': { enabled: windowsSaysOn, manageable: true, windowsDefault: true, differsFromDefault: !windowsSaysOn } }),
      };
    }, { capabilities: listCapabilities('public'), windowsSaysOn });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await openFixture(page, origin);
    await openSection(page, 'Tweaks');
    const card = page.locator('#tweak-game-mode');
    await card.getByText(/Changed by Dialed/).waitFor();
    const text = await card.innerText();
    const undo = await card.getByRole('button', { name: /^Undo/ }).count();
    assert.deepEqual(errors, []);
    return { text, undo };
  } finally { await browser.close(); }
}

async function main() {
  const reverted = await cardText(true);
  assert.match(reverted.text, /No longer in effect/);
  assert.equal(reverted.undo, 0, 'A reverted change offers no Undo that would only be refused.');
  const intact = await cardText(false);
  assert.doesNotMatch(intact.text, /No longer in effect/);
  assert.equal(intact.undo, 1, 'An intact change keeps its Undo.');
  console.log('Tweak state checks passed: reverted change flagged, intact change keeps Undo.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
