// "Make a Windows restore point first" before Apply selected: made -> the tweak runs; already made
// today -> the reader is asked, and declining changes nothing; failed -> nothing is changed.
// Also "Review N recommended" and "Keep my setting". Closed fixture: in-memory adapters only.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.DIALED_PLAYWRIGHT_PATH || 'playwright');
const { listCapabilities } = require('../src/main/capabilities/index.cjs');
const { openFixture, openSection } = require('./ui-fixture-page.cjs');
const origin = process.env.DIALED_UI_URL || 'http://127.0.0.1:5178';
if (new URL(origin).hostname !== '127.0.0.1') throw new Error('Only loopback fixture servers are allowed.');

async function run(outcome, settings = { 'game-mode': { enabled: true, manageable: true, windowsDefault: true, differsFromDefault: false } }) {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    await context.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await context.addInitScript(({ capabilities, outcome, settings }) => {
      const rows = async () => ({ items: [], errors: [] });
      const unavailable = async () => { throw new Error('Unavailable in closed browser fixture.'); };
      window.__calls = { restorePoint: 0, setUserSetting: 0 };
      window.pcOptiNative = {
        getRuntimeProfile: async () => ({ profile: 'public', capabilities }), listCapabilities: async () => capabilities,
        getAuditHistory: async () => ({ entries: [], recovery: null, protection: { notices: [] } }),
        listStartupItems: rows, listSafePolicies: rows, listTimingExperiments: rows, listManageableProcesses: rows,
        scanSystem: unavailable, getLocalRecommendations: async () => [], listGameSettingsGuides: async () => [],
        listBenchmarkEvidence: unavailable, getReleaseStatus: unavailable, listPowerPlans: unavailable,
        readUserSettings: async () => settings,
        createRestorePoint: async () => {
          window.__calls.restorePoint++;
          if (outcome === 'failed') throw new Error('Dialed could not confirm a restore point, so none of the selected changes were made. System Protection is off.');
          return outcome === 'throttled' ? { status: 'THROTTLED', message: 'Windows made a restore point within the past 24 hours.' } : { status: 'VERIFIED', message: 'Made.' };
        },
        setUserSetting: async () => { window.__calls.setUserSetting++; return { success: true, entry: { id: 'e1' } }; },
      };
    }, { capabilities: listCapabilities('public'), outcome, settings });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await openFixture(page, origin);
    await openSection(page, 'Tweaks');
    if (outcome === 'recommended') {
      // Mouse acceleration differs from the recommendation: one button opens the review listing it.
      await page.getByText("1 of 2 match Dialed's recommendation").waitFor();
      await page.getByRole('button', { name: 'Review 1 recommended' }).click();
      await page.getByRole('dialog').getByText(/Mouse acceleration: on → off/).waitFor();
      await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
      // Kept as set, it leaves the recommendation and survives a reload.
      await page.locator('#tweak-mouse-acceleration').getByRole('button', { name: 'Keep my setting' }).click();
      await page.getByText("1 of 2 match Dialed's recommendation · 1 kept as you set it").waitFor();
      assert.equal(await page.getByRole('button', { name: /recommended$/ }).count(), 0);
      await page.reload(); await openSection(page, 'Tweaks');
      await page.locator('#tweak-mouse-acceleration').getByText(/Kept as you set it/).waitFor();
      await page.locator('#tweak-mouse-acceleration').getByRole('button', { name: 'Recommend it again' }).click();
      await page.getByRole('button', { name: 'Review 1 recommended' }).waitFor();
      assert.deepEqual(errors, []);
      return await page.evaluate(() => window.__calls);
    }
    // Game Mode is on, as recommended: counted, and nothing recommended.
    await page.getByText("1 of 1 match Dialed's recommendation").waitFor();
    assert.equal(await page.getByRole('button', { name: /recommended$/ }).count(), 0);
    await page.getByRole('checkbox', { name: /^Select Game Mode/ }).check();
    await page.getByRole('checkbox', { name: 'Make a Windows restore point first' }).check();
    await page.getByRole('button', { name: 'Apply selected' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByText(/does not back up your files/).waitFor();
    await dialog.getByRole('button', { name: 'Apply 1' }).click();
    if (outcome === 'throttled') {
      await page.getByRole('dialog').getByText('Continue without a new restore point?').waitFor();
      await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    }
    if (outcome === 'failed') await page.getByText(/could not confirm a restore point/).first().waitFor();
    if (outcome === 'made') await page.waitForFunction(() => window.__calls.setUserSetting === 1);
    await page.waitForTimeout(300);
    const calls = await page.evaluate(() => window.__calls);
    assert.deepEqual(errors, []);
    return calls;
  } finally { await browser.close(); }
}

async function main() {
  assert.deepEqual(await run('made'), { restorePoint: 1, setUserSetting: 1 });
  assert.deepEqual(await run('throttled'), { restorePoint: 1, setUserSetting: 0 }, 'Declining after the 24-hour limit must change nothing.');
  assert.deepEqual(await run('failed'), { restorePoint: 1, setUserSetting: 0 }, 'A failed restore point must stop the batch.');
  assert.deepEqual(await run('recommended', { 'game-mode': { enabled: true, manageable: true, windowsDefault: true, differsFromDefault: false }, 'mouse-acceleration': { enabled: true, manageable: true, windowsDefault: true, differsFromDefault: false } }), { restorePoint: 0, setUserSetting: 0 }, 'Reviewing recommended and cancelling must change nothing.');
  console.log('Restore point checks passed: made, limited and declined, failed; recommended review and keep my setting.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
