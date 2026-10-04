// Black and gold is the default. A Console theme saved before that (Dialed saved the theme on every
// start) moves to Console Gold once; Console chosen afterwards sticks. Closed fixture.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.DIALED_PLAYWRIGHT_PATH || 'playwright');
const { listCapabilities } = require('../src/main/capabilities/index.cjs');
const { openFixture } = require('./ui-fixture-page.cjs');
const origin = process.env.DIALED_UI_URL || 'http://127.0.0.1:5178';
if (new URL(origin).hostname !== '127.0.0.1') throw new Error('Only loopback fixture servers are allowed.');

async function themeOnStart(storage) {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    await context.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await context.addInitScript(({ capabilities, storage }) => {
      if (!sessionStorage.getItem('seeded')) { for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value); sessionStorage.setItem('seeded', '1'); }
      const rows = async () => ({ items: [], errors: [] });
      const no = async () => { throw new Error('Unavailable in closed browser fixture.'); };
      window.pcOptiNative = { getRuntimeProfile: async () => ({ profile: 'public', capabilities }), listCapabilities: async () => capabilities,
        getAuditHistory: async () => ({ entries: [], recovery: null, protection: { notices: [] } }), listStartupItems: rows, listSafePolicies: rows,
        listTimingExperiments: rows, listManageableProcesses: rows, scanSystem: no, getLocalRecommendations: async () => [], listGameSettingsGuides: async () => [],
        listBenchmarkEvidence: no, getReleaseStatus: no, listPowerPlans: no };
    }, { capabilities: listCapabilities('public'), storage });
    const page = await context.newPage();
    await openFixture(page, origin);
    await page.waitForFunction(() => Boolean(document.documentElement.dataset.theme));
    const first = await page.evaluate(() => document.documentElement.dataset.theme);
    await page.reload();
    await page.waitForFunction(() => Boolean(document.documentElement.dataset.theme));
    const second = await page.evaluate(() => document.documentElement.dataset.theme);
    return { first, second };
  } finally { await browser.close(); }
}

async function main() {
  assert.deepEqual(await themeOnStart({}), { first: 'console-gold', second: 'console-gold' }, 'A fresh install opens in black and gold.');
  assert.deepEqual(await themeOnStart({ 'pcopti-theme:v1': 'console' }), { first: 'console-gold', second: 'console-gold' }, 'A Console saved before the change moves to gold once.');
  assert.deepEqual(await themeOnStart({ 'pcopti-theme:v1': 'console', 'pcopti-theme-gold-default:v1': '1' }), { first: 'console', second: 'console' }, 'Console chosen afterwards sticks.');
  assert.deepEqual(await themeOnStart({ 'pcopti-theme:v1': 'instrument' }), { first: 'instrument', second: 'instrument' }, 'Any other saved theme is kept.');
  console.log('Theme default checks passed: fresh install gold, old Console moved once, later choices kept.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
