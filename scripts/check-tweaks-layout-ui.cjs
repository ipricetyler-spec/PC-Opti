// The All tweaks layout: cards a reader can act on stay cards; cards that only open a tab are link
// rows; settings with nothing to do or that this Windows edition ignores fold away; each folded tool
// sits under its own group; the action bar stays in view; filter chips narrow the list.
// Closed fixture shaped like a Windows Home gaming PC: in-memory adapters only.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { listCapabilities } = require('../src/main/capabilities/index.cjs');
const { openFixture, openSection } = require('./ui-fixture-page.cjs');
const origin = process.env.DIALED_UI_URL || 'http://127.0.0.1:5178';
if (new URL(origin).hostname !== '127.0.0.1') throw new Error('Only loopback fixture servers are allowed.');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await context.addInitScript(({ capabilities }) => {
    const rows = async () => ({ items: [], errors: [] });
    const no = async () => { throw new Error('fixture'); };
    const home = (reason) => ({ enabled: null, manageable: false, unsupported: reason, leftover: false });
    window.pcOptiNative = { getRuntimeProfile: async () => ({ profile: 'public', capabilities }), listCapabilities: async () => capabilities,
      getAuditHistory: async () => ({ entries: [], recovery: null, protection: { notices: [] } }), listStartupItems: rows, listSafePolicies: rows,
      listTimingExperiments: rows, listManageableProcesses: rows, scanSystem: no, getLocalRecommendations: async () => [], listGameSettingsGuides: async () => [],
      listBenchmarkEvidence: async () => ({ records: [], comparisons: [] }), getReleaseStatus: no, listPowerPlans: no,
      readNvidiaSettings: async () => ({ available: true, rows: [], notes: [] }), listClosablePrograms: async () => [],
      readUserSettings: async () => ({
        'game-mode': { enabled: true, manageable: true, windowsDefault: true }, 'background-recording': { enabled: true, manageable: true, windowsDefault: true },
        'mouse-acceleration': { enabled: false, manageable: true }, 'gpu-scheduling': { enabled: true, manageable: true }, mpo: { enabled: false, manageable: true, windowsDefault: true, differsFromDefault: true },
        'windowed-games': { enabled: null, manageable: true }, 'global-timer-resolution': { enabled: false, manageable: true },
        'consumer-features': home('Windows Home ignores this policy.'), 'block-background-apps': home('Windows Home ignores this policy.'), 'exclude-driver-updates': home('Windows Home ignores this policy.'), 'no-auto-restart': home('Windows Home ignores this policy.'),
        'processor-scheduling': { enabled: true, manageable: true, detail: 'Programs (Windows default)' }, 'multimedia-scheduler': { enabled: false, manageable: true, windowsDefault: true, differsFromDefault: true, detail: '5 of 6 values changed by another program or tool' },
        'network-power': { enabled: true, manageable: true, detail: 'Off on Ethernet' }, 'usb-selective-suspend': { enabled: false, manageable: true, detail: 'On when plugged in' },
        'ultimate-plan': { enabled: false, manageable: true, detail: 'Not in your plan list' }, 'cpu-minimum-state': { enabled: false, manageable: true, detail: '5% when plugged in' },
      }) };
  }, { capabilities: listCapabilities('public') });
  const page = await context.newPage(); page.setDefaultTimeout(8000);
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await openFixture(page, origin);
  await openSection(page, 'Tweaks');
  const main = page.locator('main');
  await main.locator('#tweak-startup-apps').waitFor();
  // Cards that only open a tab are link rows, with the same button as before.
  assert.equal(await main.locator('li[id^=tweak-]').count(), 8);
  await main.locator('li#tweak-close-before-game').getByRole('button', { name: 'Choose programs', exact: true }).waitFor();
  assert.equal(await main.locator('article#tweak-close-before-game').count(), 0);
  // Edition-locked and nothing-to-do settings are folded, not listed as cards.
  const locked = main.locator('details', { hasText: 'this edition of Windows ignores' });
  assert.match(await locked.locator('summary').innerText(), /^4 settings this edition of Windows ignores: Windows suggested apps and content/);
  assert.equal(await main.locator('article#tweak-block-background-apps').isVisible(), false);
  await locked.locator('summary').click();
  assert.equal(await main.locator('article#tweak-block-background-apps').isVisible(), true);
  await main.locator('details', { hasText: 'Nothing to do here (1): Processor scheduling' }).waitFor();
  // Each folded tool sits in the group whose card opens it.
  for (const [group, tool] of [['Power', 'power-plan'], ['Windows-privacy', 'built-in-apps'], ['Graphics', 'per-program-graphics'], ['Graphics', 'nvidia-settings'], ['Experiments', 'boot-timing']]) {
    assert.equal(await main.locator(`section[aria-labelledby="tweak-group-${group}"] #${tool}`).count(), 1, `${tool} under ${group}`);
  }
  // A card Dialed can act on shows what the tick box is for.
  await main.locator('#tweak-usb-selective-suspend').getByText('Select', { exact: true }).waitFor();
  // The action bar stays in view at the bottom of the page.
  await main.locator('#boot-timing').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const bar = await page.getByRole('button', { name: 'Apply selected' }).boundingBox();
  assert.ok(bar && bar.y >= 0 && bar.y < 900, 'the action bar left the viewport');
  // Chips narrow the list to ordinary cards, and All brings everything back.
  const restart = page.getByRole('button', { name: /^Need a restart \(\d+\)$/ });
  const expected = Number((await restart.innerText()).match(/\((\d+)\)/)[1]);
  await restart.click();
  assert.equal(await main.locator('article.tweak-card').count(), expected);
  assert.equal(await main.locator('li[id^=tweak-]').count(), 0);
  await page.getByRole('button', { name: 'All', exact: true }).click();
  assert.equal(await main.locator('li[id^=tweak-]').count(), 8);
  assert.deepEqual(errors, []);
  console.log('Tweaks layout checks passed: link rows, folded groups, tools under their groups, bar stays in view, filter chips.');
  await browser.close();
})().catch((e) => { console.error(e); process.exitCode = 1; });
