// A long confirmation at the smallest supported window must keep its safety warning and its
// recovery notice readable (2026-10-01: the change list used to push the notice out of view).
// Closed fixture: in-memory adapters, loopback page, no host access or mutation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.DIALED_PLAYWRIGHT_PATH || 'playwright');
const { listCapabilities } = require('../src/main/capabilities/index.cjs');
const { bitLockerBootNotice } = require('../src/main/system-protection/index.cjs');
const { appThemes, openFixture, openSection } = require('./ui-fixture-page.cjs');
const origin = process.env.DIALED_UI_URL || 'http://127.0.0.1:5178';
if (new URL(origin).hostname !== '127.0.0.1') throw new Error('Only loopback fixture servers are allowed.');
const out = path.resolve(__dirname, '../output/playwright');

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const results = [];
  try {
    for (const { id: theme } of appThemes().themes) {
      const context = await browser.newContext({ viewport: { width: 960, height: 650 }, reducedMotion: 'reduce' });
      await context.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      await context.addInitScript(({ capabilities, boot }) => {
        const rows = async () => ({ items: [], errors: [] });
        const unavailable = async () => { throw new Error('Unavailable in closed browser fixture.'); };
        const entries = Array.from({ length: 40 }, (_, index) => ({
          id: `fixture-${index}`, title: `Fixture change ${index}`, timestamp: new Date(Date.now() - (index + 1) * 3600000).toISOString(),
          status: 'SUCCESS', actionId: index % 2 ? 'timing:disable-dynamic-tick' : 'setting:game-mode', exitCode: 0,
          rollback: { available: true, reason: null }, resultingState: {}, stderr: '',
        }));
        window.pcOptiNative = {
          getRuntimeProfile: async () => ({ profile: 'public', capabilities }), listCapabilities: async () => capabilities,
          getAuditHistory: async () => ({ entries, recovery: null, protection: { notices: [] } }),
          listStartupItems: rows, listSafePolicies: rows, listTimingExperiments: rows, listManageableProcesses: rows,
          scanSystem: unavailable, getLocalRecommendations: async () => [], listGameSettingsGuides: async () => [],
          listBenchmarkEvidence: unavailable, getReleaseStatus: unavailable, readBootNotice: async () => boot,
          readUserSettings: async () => ({}), listGameProfiles: async () => [], listGameConfigBackups: async () => ({ entries: [] }),
        };
      }, { capabilities: listCapabilities('public'), boot: bitLockerBootNotice('ON') });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      const errors = []; page.on('pageerror', (error) => errors.push(error.message));
      await openFixture(page, origin);
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      for (const density of ['normal', 'comfortable']) {
        await page.evaluate((value) => { document.documentElement.dataset.density = value; }, density);
        await openSection(page, 'Restore');
        await page.getByRole('button', { name: /^Undo all Dialed changes/ }).first().click();
        const dialog = page.getByRole('dialog').first();
        await dialog.waitFor();
        const layout = await page.evaluate(() => {
          const body = document.querySelector('[role=dialog] .overflow-y-auto');
          const inside = (element) => { const a = element.getBoundingClientRect(), b = body.getBoundingClientRect(); return a.top >= b.top - 1 && a.bottom <= b.bottom + 1; };
          body.scrollTop = 0;
          const warning = document.getElementById('action-preview-warning');
          const warningFirst = Boolean(warning) && inside(warning);
          const notice = document.getElementById('action-preview-notice');
          notice.scrollIntoView({ block: 'nearest' });
          return { warningFirst, noticeReachable: inside(notice), scrolls: body.scrollHeight > body.clientHeight };
        });
        assert.ok(layout.warningFirst, `${theme} ${density}: the safety warning is visible without scrolling`);
        assert.ok(layout.noticeReachable, `${theme} ${density}: the recovery notice can be scrolled into view`);
        // Keyboard: Cancel has focus, so Enter does not confirm; Escape closes.
        assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Cancel');
        await page.screenshot({ path: path.join(out, `confirmation-960x650-${theme}-${density}.png`) });
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'detached' });
        results.push(`${theme}/${density}`);
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
  } finally { await browser.close(); }
  console.log(`Long confirmation checks passed: ${results.join(', ')}.`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
