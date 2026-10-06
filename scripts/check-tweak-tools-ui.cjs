// The per-program graphics tools and the boot timing experiments live at the end of All tweaks
// (2026-10-06: the GPU section and the Boot timing tab only repeated these cards). Their cards open
// and scroll to them. Closed fixture: nothing is changed.
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
      window.pcOptiNative = { getRuntimeProfile: async () => ({ profile: 'public', capabilities }), listCapabilities: async () => capabilities,
        getAuditHistory: async () => ({ entries: [], recovery: null, protection: { notices: [] } }), listStartupItems: rows, listSafePolicies: rows,
        listTimingExperiments: rows, listManageableProcesses: rows, scanSystem: no, getLocalRecommendations: async () => [], listGameSettingsGuides: async () => [],
        listBenchmarkEvidence: no, getReleaseStatus: no, listPowerPlans: no, readUserSettings: async () => ({ 'processor-scheduling': { enabled: false, manageable: true, windowsDefault: true, differsFromDefault: true, detail: 'Set to 40 by another program or tool' }, 'multimedia-scheduler': { enabled: false, manageable: true, windowsDefault: true, differsFromDefault: true, detail: '5 of 6 values changed by another program or tool' }, 'network-power': { enabled: false, manageable: true, detail: 'On: Energy-Efficient Ethernet' } }),
        listGpuPreferences: async () => { window.__listed = (window.__listed || 0) + 1; return []; },
        listFullscreenOptimizations: async () => { window.__listed = (window.__listed || 0) + 1; return []; } };
    }, { capabilities: listCapabilities('public') });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await openFixture(page, origin);
    await openSection(page, 'Tweaks');
    const tabs = page.getByRole('tablist', { name: 'Optimize categories' });
    await tabs.getByRole('tab').first().waitFor();
    assert.deepEqual(await tabs.getByRole('tab').allInnerTexts(), ['All tweaks', 'Startup', 'Background apps', 'Windows', 'Upkeep', 'BIOS'], 'Tweaks has six tabs');
    const perProgram = page.locator('#per-program-graphics');
    const bootTiming = page.locator('#boot-timing');
    assert.equal(await perProgram.getAttribute('open'), null, 'Folded until asked for.');
    assert.equal(await bootTiming.getAttribute('open'), null);
    assert.equal(await page.evaluate(() => window.__listed || 0), 0, 'Folded tools read nothing from Windows until opened.');
    await page.locator('#tweak-fullscreen-optimizations').getByRole('button', { name: 'Choose a game', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('per-program-graphics')?.hasAttribute('open'));
    await page.waitForFunction(() => { const r = document.getElementById('per-program-graphics')?.getBoundingClientRect(); return Boolean(r && r.top < window.innerHeight && r.bottom > 0); });
    await page.locator('#tweak-dynamic-tick').getByRole('button', { name: 'Review experiment', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('boot-timing')?.hasAttribute('open'));
    assert.equal(await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'GPU', exact: true }).count(), 0, 'No GPU section.');
    // Processor scheduling: the value in words; the only change is back to the Windows default, and
    // as a recommended fix it can be kept as set instead.
    const scheduling = page.locator('#tweak-processor-scheduling');
    await scheduling.getByText('Set to 40 by another program or tool').waitFor();
    assert.deepEqual(await scheduling.getByRole('button').filter({ hasNotText: /Details/ }).allInnerTexts(), ['Return to Windows default', 'Keep my setting']);
    const network = page.locator('#tweak-network-power');
    await network.getByText('On: Energy-Efficient Ethernet').waitFor();
    assert.deepEqual(await network.getByRole('button').filter({ hasNotText: /Details/ }).allInnerTexts(), ['Turn power saving off']);
    const mmcss = page.locator('#tweak-multimedia-scheduler');
    await mmcss.getByText('5 of 6 values changed by another program or tool').waitFor();
    assert.deepEqual(await mmcss.getByRole('button').filter({ hasNotText: /Details/ }).allInnerTexts(), ['Return to Windows default', 'Keep my setting']);
    // Restore › History carries the steps for when Windows will not start, and saves them as a file.
    await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'Restore', exact: true }).click();
    await page.getByText("If Windows won't start", { exact: true }).click();
    await page.getByText('bcdedit /deletevalue {default} disabledynamictick', { exact: true }).waitFor();
    const saved = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save these steps', exact: true }).click();
    assert.equal((await saved).suggestedFilename(), 'If Windows will not start - Dialed.txt');
    assert.deepEqual(errors, []);
    console.log('Tweak tools checks passed: six tabs, GPU tools and boot timing open from their cards.');
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
