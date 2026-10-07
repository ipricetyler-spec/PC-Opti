// Close before a game: picks are remembered, the review names every program before anything
// closes, cancelling closes nothing, and Reopen is offered only for what closed.
// Closed fixture: in-memory adapters only; nothing is closed or started.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.DIALED_PLAYWRIGHT_PATH || 'playwright');
const { listCapabilities } = require('../src/main/capabilities/index.cjs');
const { openFixture, openSection } = require('./ui-fixture-page.cjs');
const origin = process.env.DIALED_UI_URL || 'http://127.0.0.1:5178';
if (new URL(origin).hostname !== '127.0.0.1') throw new Error('Only loopback fixture servers are allowed.');

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    await context.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await context.addInitScript(({ capabilities }) => {
      const rows = async () => ({ items: [], errors: [] });
      const no = async () => { throw new Error('Unavailable in closed browser fixture.'); };
      const programs = [
        { path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', name: 'Google Chrome', processes: 13, hasWindow: true },
        { path: 'C:\\Program Files\\Razer\\RazerAppEngine.exe', name: 'RazerAppEngine', processes: 9, hasWindow: true },
      ];
      window.__close = { closed: [], reopened: [] };
      window.pcOptiNative = { getRuntimeProfile: async () => ({ profile: 'public', capabilities }), listCapabilities: async () => capabilities,
        getAuditHistory: async () => ({ entries: [], recovery: null, protection: { notices: [] } }), listStartupItems: rows, listSafePolicies: rows,
        listTimingExperiments: rows, listManageableProcesses: rows, scanSystem: no, getLocalRecommendations: async () => [], listGameSettingsGuides: async () => [],
        listBenchmarkEvidence: no, getReleaseStatus: no, listPowerPlans: no, readUserSettings: async () => ({}),
        listClosablePrograms: async () => programs.filter((item) => !window.__close.closed.includes(item.path)),
        closePrograms: async (paths) => { window.__close.closed.push(...paths); return { results: paths.map((path) => ({ path, name: programs.find((item) => item.path === path).name, outcome: 'CLOSED' })) }; },
        reopenPrograms: async (paths) => { window.__close.reopened.push(...paths); window.__close.closed = []; return { reopened: paths }; } };
    }, { capabilities: listCapabilities('public') });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await openFixture(page, origin);
    await openSection(page, 'Tweaks');
    await page.locator('#tweak-close-before-game').getByRole('button', { name: 'Choose programs', exact: true }).click();
    const section = page.getByRole('region', { name: 'Close before a game' });
    await section.getByRole('button', { name: 'None of your picks is running' }).waitFor();
    await section.getByRole('checkbox', { name: 'Google Chrome (13)' }).check();
    // Remembered across a reload.
    await page.reload(); await openSection(page, 'Tweaks');
    await page.locator('#tweak-close-before-game').getByRole('button', { name: 'Choose programs', exact: true }).click();
    await section.getByRole('checkbox', { name: 'Google Chrome (13)' }).waitFor();
    assert.equal(await section.getByRole('checkbox', { name: 'Google Chrome (13)' }).isChecked(), true);
    // The review names the program and warns about ending; cancelling closes nothing.
    await section.getByRole('button', { name: 'Close 1 chosen' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByText(/chrome\.exe/).waitFor();
    await dialog.getByText(/ended, like End task in Task Manager/).waitFor();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.__close.closed), []);
    await section.getByRole('button', { name: 'Close 1 chosen' }).click();
    await dialog.getByRole('button', { name: 'Close 1' }).click();
    await section.getByText('✓ Google Chrome: closed').waitFor();
    assert.deepEqual(await page.evaluate(() => window.__close.closed), ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe']);
    await section.getByRole('button', { name: 'Reopen them' }).click();
    await section.getByText(/Reopened 1 of 1/).waitFor();
    assert.deepEqual(errors, []);
    console.log('Close before a game checks passed: picks remembered, review names each program, cancel closes nothing, reopen.');
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
