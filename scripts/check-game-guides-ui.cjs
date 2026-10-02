// The game guides read as short rows (setting, value, what it helps, one-line reason credited to
// its source), open per game, filter by what a row helps with, and keep costs, test steps and
// sources one click away. Closed fixture: guides only, nothing is changed.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.DIALED_PLAYWRIGHT_PATH || 'playwright');
const { listCapabilities } = require('../src/main/capabilities/index.cjs');
const { listGameSettingsGuides } = require('../src/main/game-settings/index.cjs');
const { openFixture, openSection } = require('./ui-fixture-page.cjs');
const origin = process.env.DIALED_UI_URL || 'http://127.0.0.1:5178';
if (new URL(origin).hostname !== '127.0.0.1') throw new Error('Only loopback fixture servers are allowed.');

async function main() {
  const guides = listGameSettingsGuides();
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1000, height: 900 }, reducedMotion: 'reduce' });
    await context.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await context.addInitScript(({ capabilities, guides }) => {
      const rows = async () => ({ items: [], errors: [] });
      const unavailable = async () => { throw new Error('Unavailable in closed browser fixture.'); };
      window.pcOptiNative = {
        getRuntimeProfile: async () => ({ profile: 'public', capabilities }), listCapabilities: async () => capabilities,
        getAuditHistory: async () => ({ entries: [], recovery: null, protection: { notices: [] } }),
        listStartupItems: rows, listSafePolicies: rows, listTimingExperiments: rows, listManageableProcesses: rows,
        scanSystem: unavailable, getLocalRecommendations: async () => [], listGameSettingsGuides: async () => guides,
        listBenchmarkEvidence: unavailable, getReleaseStatus: unavailable, listPowerPlans: unavailable,
        listGameProfiles: async () => [], listGameConfigBackups: async () => [],
        discoverInstalledGames: async () => ({ scannedAt: new Date().toISOString(), games: [], limitations: 'Fixture inventory.' }),
      };
    }, { capabilities: listCapabilities('public'), guides });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await openFixture(page, origin);
    await openSection(page, 'Games');
    await page.getByRole('tab', { name: 'Guides', exact: true }).click();
    const status = page.getByRole('status').filter({ hasText: /games\./ });
    await status.getByText(`Showing all ${guides.length} games.`).waitFor();

    // Closed by default: a list of games, each with its one-line summary.
    const fortnite = page.getByRole('button', { name: /^Fortnite/ });
    assert.equal(await fortnite.getAttribute('aria-expanded'), 'false');
    assert.equal(await page.getByText('Rendering Mode', { exact: true }).count(), 0);
    await fortnite.click();
    assert.equal(await fortnite.getAttribute('aria-expanded'), 'true');
    const panel = page.locator('#guide-fortnite-pc-performance-review');
    const row = panel.locator('li').filter({ hasText: 'Rendering Mode' });
    assert.match(await row.innerText(), /Performance[\s\S]*Frame rate[\s\S]*— Epic Games/);
    // Costs, testing and sources sit behind one control.
    assert.equal(await panel.getByText(/How to test:/).count(), 0);
    await panel.getByRole('button', { name: 'Show costs, testing and sources' }).click();
    await panel.getByText(/How to test:/).waitFor();
    assert.match(await row.innerText(), /Cost: Looks plainer/);
    assert.ok(await panel.getByRole('link', { name: /Epic Games — Fortnite on PC: best settings/ }).count() === 1);
    assert.match(await panel.innerText(), /· Game maker/);

    // A filter opens every game that has a matching row and shows only those rows.
    await page.getByRole('group', { name: 'Show settings that help with' }).getByRole('button', { name: 'Visibility', exact: true }).click();
    const visibilityRows = guides.reduce((sum, guide) => sum + guide.settings.filter((setting) => setting.helps === 'VISIBILITY').length, 0);
    const visibilityGames = guides.filter((guide) => guide.settings.some((setting) => setting.helps === 'VISIBILITY')).length;
    await status.getByText(`Showing ${visibilityRows} settings in ${visibilityGames} of ${guides.length} games.`).waitFor();
    await page.getByText('Boost Player Contrast', { exact: true }).waitFor();
    assert.equal(await page.getByText('Rendering Mode', { exact: true }).count(), 0, 'A frame-rate row is hidden under Visibility.');

    // Search finds a setting across games.
    await page.getByRole('group', { name: 'Show settings that help with' }).getByRole('button', { name: 'Everything', exact: true }).click();
    await page.getByRole('textbox', { name: 'Search a game or a setting' }).fill('reflex');
    const reflexGames = guides.filter((guide) => guide.settings.some((setting) => `${setting.label} ${setting.value}`.toLowerCase().includes('reflex'))).length;
    assert.ok(reflexGames >= 8);
    await status.getByText(new RegExp(`in ${reflexGames} of ${guides.length} games\\.`)).waitFor();
    await page.getByRole('textbox', { name: 'Search a game or a setting' }).fill('no such setting');
    await page.getByText(/Nothing matches/).waitFor();

    // No sideways scrolling at a narrow window.
    await page.getByRole('textbox', { name: 'Search a game or a setting' }).fill('');
    await page.getByRole('button', { name: /^Battlefield 6/ }).click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `page scrolls sideways by ${overflow}px`);
    assert.deepEqual(errors, []);
    console.log(`Game guide checks passed: ${guides.length} games, closed by default, costs on request, filter and search.`);
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
