// Optional browser acceptance harness. Uses an existing Playwright installation,
// fixture IPC only, and a separately started local Vite server; never runs Windows tuning.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.DIALED_PLAYWRIGHT_PATH || 'playwright');
const { buildBiosPlan } = require('../src/main/bios-guidance/index.cjs');
const { listCapabilities } = require('../src/main/capabilities/index.cjs');
const { listGameSettingsGuides } = require('../src/main/game-settings/index.cjs');

const raw = {
  cpu: [{ name: 'AMD Ryzen 7 9800X3D 8-Core Processor' }],
  board: [{ manufacturer: 'ASUSTeK COMPUTER INC.', product: 'TUF GAMING X870-PLUS WIFI', revision: 'Fixture revision 1' }],
  system: [{ manufacturer: 'ASUSTeK COMPUTER INC.', pcSystemType: 1 }],
  bios: [{ version: 'FIXTURE ONLY', date: '2026-08-01' }], chassis: [3],
  memory: [0, 1].map((slot) => ({ partNumber: 'FIXTURE-DDR5-KIT', memoryType: 34, configuredSpeed: 4800, capacityBytes: 16 * 2 ** 30, slot: `DIMM${slot}` })),
  gpus: ['NVIDIA GeForce RTX 4080'],
};
const now = '2026-08-27T12:00:00Z';
const plan = buildBiosPlan(raw, { now });
const unsupported = buildBiosPlan({ ...raw, system: [{ manufacturer: 'Dell', pcSystemType: 1 }] }, { now });
const unavailable = buildBiosPlan({ errors: ['Fixture inventory unavailable.'] }, { now });
const themes = ['midnight', 'ember', 'violet', 'forest', 'graphite', 'oled', 'aurora', 'carbon-gold'];
const out = path.resolve(__dirname, '../output/playwright');
const origin = process.env.DIALED_UI_URL || 'http://127.0.0.1:5178';
if (new URL(origin).hostname !== '127.0.0.1') throw new Error('Fixture test is restricted to a loopback server.');

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 960, height: 700 }, acceptDownloads: true });
    await context.addInitScript(({ plan, unsupported, unavailable, capabilities, guides }) => {
      const rows = async () => ({ items: [], errors: [] });
      window.pcOptiNative = {
        getRuntimeProfile: async () => ({ profile: 'public', capabilities }),
        listCapabilities: async () => capabilities,
        getLocalRecommendations: async () => [],
        getAuditHistory: async () => ({ entries: [], recovery: null }),
        listStartupItems: rows, listManageableProcesses: rows, listSafePolicies: rows, listTimingExperiments: rows,
        listGameSettingsGuides: async () => guides,
        readBiosPlan: async () => {
          const mode = sessionStorage.getItem('bios-fixture-mode');
          if (mode === 'error') throw new Error('Fixture read error');
          return mode === 'oem' ? unsupported : mode === 'unavailable' ? unavailable : plan;
        },
        openExternalLink: async (url) => { window.fixtureOpenedSource = url; return { opened: true }; },
      };
    }, { plan, unsupported, unavailable, capabilities: listCapabilities('public'), guides: listGameSettingsGuides() });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin);
    await page.keyboard.press('Tab');
    const skipLink = page.getByRole('link', { name: 'Skip to main content' });
    assert.equal(await skipLink.evaluate((element) => document.activeElement === element), true);
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'main-content');
    await page.locator('aside nav button').filter({ hasText: /^Optimize/ }).click();
    await page.getByRole('tab', { name: 'BIOS', exact: true }).click();
    await page.getByRole('heading', { name: 'Use your RAM kit’s supported EXPO profile' }).waitFor();
    assert.equal(await page.locator('aside nav button').count(), 9);
    assert.equal(await page.getByRole('heading', { name: /Explore PBO/ }).count(), 0);
    await page.getByRole('checkbox', { name: 'Include advanced CPU tuning' }).check();
    await page.getByRole('heading', { name: /Explore PBO/ }).waitFor();
    await page.getByRole('checkbox', { name: 'Include advanced CPU tuning' }).uncheck();
    await page.getByText('Steps, compatibility and recovery', { exact: true }).first().click();
    await page.getByLabel('Previous setting: Use your RAM kit’s supported EXPO profile', { exact: true }).fill('Fixture previous value: Auto; test pending.');
    await page.getByLabel('Progress: Use your RAM kit’s supported EXPO profile', { exact: true }).selectOption('Changed — needs testing');
    await page.getByRole('tab', { name: 'Recommended', exact: true }).click();
    await page.getByRole('heading', { name: 'Choose a small, reviewable set of changes' }).waitFor();
    await page.getByRole('tab', { name: 'BIOS', exact: true }).click();
    await page.reload();
    await page.locator('aside nav button').filter({ hasText: /^Optimize/ }).click();
    await page.getByRole('tab', { name: 'BIOS', exact: true }).click();
    await page.getByLabel('Previous setting: Use your RAM kit’s supported EXPO profile', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Previous setting: Use your RAM kit’s supported EXPO profile', { exact: true }).inputValue(), 'Fixture previous value: Auto; test pending.');
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save BIOS plan', exact: true }).click();
    const download = await downloadEvent;
    const saved = path.join(out, 'bios-plan-fixture.txt');
    await download.saveAs(saved);
    const content = fs.readFileSync(saved, 'utf8');
    assert.match(content, /Fixture previous value: Auto; test pending/);
    assert.match(content, /Recovery:/);
    assert.match(content, /https:\/\//);

    const layouts = [];
    await page.getByText('Steps, compatibility and recovery', { exact: true }).first().click();
    for (const theme of themes) {
      await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
      for (const width of [960, 1280]) {
        await page.setViewportSize({ width, height: 700 });
        const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: document.documentElement.clientWidth }));
        assert.ok(dimensions.scroll <= dimensions.width, `${theme} overflow at ${width}`);
        layouts.push({ theme, width, overflow: false });
      }
    }
    await page.setViewportSize({ width: 960, height: 700 });
    await page.screenshot({ path: path.join(out, 'bios-plan-carbon-gold-960.png'), fullPage: true });

    for (const mode of ['oem', 'unavailable', 'error']) {
      await page.evaluate((value) => sessionStorage.setItem('bios-fixture-mode', value), mode);
      await page.getByRole('button', { name: 'Refresh hardware', exact: true }).click();
      if (mode === 'error') await page.getByText('Fixture read error', { exact: true }).waitFor();
      else await page.getByRole('heading', { name: 'No reviewed recipe for this combination yet' }).waitFor();
      assert.equal(await page.getByRole('heading', { name: 'Use your RAM kit’s supported EXPO profile' }).count(), 0);
    }
    assert.deepEqual(errors, []);
    const result = { fixtureOnly: true, themes: 8, layoutChecks: layouts, navigationSections: 9, notesPersisted: true, downloadVerified: true, unsupportedAndErrorStates: true, pageErrors: errors };
    fs.writeFileSync(path.join(out, 'bios-ui-acceptance.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
