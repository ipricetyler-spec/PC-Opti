// Recording inside Test a change: one confirmation covers every later recording of the same game,
// at any length, and is remembered; the optional start delay counts down and can be canceled. Closed fixture:
// in-memory adapters, loopback page, nothing is launched or recorded.
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
      const unavailable = async () => { throw new Error('Unavailable in closed browser fixture.'); };
      window.__recording = { previews: 0, starts: 0, hotkeys: [] };
      const target = { targetId: 'fixture-target', pid: 4242, name: 'VALORANT-Win64-Shipping.exe', windowTitle: 'VALORANT', startedAt: new Date().toISOString(), sessionId: 1 };
      window.pcOptiNative = {
        getRuntimeProfile: async () => ({ profile: 'public', capabilities }), listCapabilities: async () => capabilities,
        getAuditHistory: async () => ({ entries: [], recovery: null, protection: { notices: [] } }),
        listStartupItems: rows, listSafePolicies: rows, listTimingExperiments: rows, listManageableProcesses: rows,
        scanSystem: unavailable, getLocalRecommendations: async () => [], listGameSettingsGuides: async () => [],
        listBenchmarkEvidence: async () => ({ records: [], comparisons: [] }), getReleaseStatus: unavailable, readUserSettings: async () => ({}),
        getPresentMonInfo: async () => ({ status: 'AVAILABLE', version: '2.3.0', message: '' }),
        listPresentMonTargets: async () => ({ items: [target], limitations: 'Fixture.' }),
        getPresentMonCaptureState: async () => ({ active: null, entries: [], maximumEntries: 100 }),
        previewPresentMonCapture: async (targetId, durationSeconds, hardwareReadings) => { window.__recording.previews++; return { token: `t${window.__recording.previews}`, target, durationSeconds, hardwareReadings, toolVersion: '2.3.0', consequence: 'Fixture recording.', expiresAt: new Date(Date.now() + 60000).toISOString() }; },
        startPresentMonCapture: async () => { window.__recording.starts++; },
        setRecordingHotkey: async (accelerator) => { window.__recording.hotkeys.push(accelerator); return { registered: true }; },
        onRecordingHotkey: (listener) => { window.__fireHotkey = listener; return () => { window.__fireHotkey = null; }; },
      };
    }, { capabilities: listCapabilities('public') });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await openFixture(page, origin);
    await openSection(page, 'Measure');
    await page.getByRole('radio', { name: /manual|my own|something else/i }).first().check().catch(() => {});
    const inputs = page.getByPlaceholder('e.g. Multithreaded rendering').or(page.getByPlaceholder(/e\.g\. Multithread/));
    if (await inputs.count()) await inputs.first().fill('Fixture setting');
    if (await page.getByPlaceholder('e.g. On').count()) await page.getByPlaceholder('e.g. On').fill('On');
    if (await page.getByPlaceholder('e.g. Off').count()) await page.getByPlaceholder('e.g. Off').fill('Off');
    await page.getByPlaceholder('e.g. VALORANT').fill('VALORANT');
    await page.getByRole('button', { name: 'Start test' }).click();
    const startButton = page.getByRole('button', { name: 'Start recording' });
    await startButton.waitFor();
    // The hotkey, turned on before anything was confirmed, refuses: a confirmation cannot be shown over a game.
    await page.getByLabel('Recording hotkey').selectOption('Control+Shift+F9');
    await page.waitForFunction(() => window.__recording.hotkeys.includes('Control+Shift+F9') && typeof window.__fireHotkey === 'function');
    await page.evaluate(() => window.__fireHotkey());
    await page.getByText(/The hotkey did nothing: start this recording once/).waitFor();
    assert.equal(await page.evaluate(() => window.__recording.previews), 0);
    // First recording asks once.
    await startButton.click();
    await page.getByRole('dialog').waitFor();
    await page.getByRole('dialog').getByRole('button', { name: 'Start recording' }).click();
    await page.waitForFunction(() => window.__recording.starts === 1);
    // The same recording again starts without another confirmation.
    await startButton.click();
    await page.waitForFunction(() => window.__recording.starts === 2);
    assert.equal(await page.getByRole('dialog').count(), 0, 'A repeat recording of the same game asked again.');
    // A different length of the same game does not ask again, and the approval is remembered.
    await page.getByLabel('Duration').selectOption('10');
    await startButton.click();
    await page.waitForFunction(() => window.__recording.starts === 3);
    assert.equal(await page.getByRole('dialog').count(), 0, 'A different length of the same game asked again.');
    assert.match(await page.evaluate(() => localStorage.getItem('dialed-recording-approved-games:v1')), /valorant-win64-shipping\.exe/);
    // A start delay counts down and can be canceled before anything is recorded.
    await page.getByLabel('Duration').selectOption('20');
    await page.getByLabel('Start').selectOption('5');
    await startButton.click();
    await page.getByText(/Recording starts in \d s/).waitFor();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByText('Recording canceled before it started. Nothing was recorded.').waitFor();
    assert.equal(await page.evaluate(() => window.__recording.starts), 3);
    // Left to finish, the countdown starts the recording.
    await startButton.click();
    await page.waitForFunction(() => window.__recording.starts === 4, null, { timeout: 15000 });
    // After a canceled countdown, an immediate recording still starts.
    await page.getByLabel('Start').selectOption('5');
    await startButton.click();
    await page.getByText(/Recording starts in \d s/).waitFor();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByLabel('Start').selectOption('0');
    await startButton.click();
    await page.waitForFunction(() => window.__recording.starts === 5);
    // Confirmed once, the hotkey starts the same recording from the game at once, without the delay.
    await page.getByLabel('Start').selectOption('5');
    await page.evaluate(() => window.__fireHotkey());
    await page.waitForFunction(() => window.__recording.starts === 6, null, { timeout: 3000 });
    assert.equal(await page.getByText(/Recording starts in \d s/).count(), 0, 'The hotkey waited for the start delay.');
    // Turned off, the key is handed back.
    await page.getByLabel('Recording hotkey').selectOption('');
    await page.waitForFunction(() => window.__recording.hotkeys.at(-1) === null && window.__fireHotkey === null);
    // Stopping the test during a countdown records nothing (Codex review R4).
    await page.getByLabel('Start').selectOption('5');
    await startButton.click();
    await page.getByText(/Recording starts in \d s/).waitFor();
    await page.getByRole('button', { name: 'Stop this test' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Stop test' }).click();
    await page.waitForTimeout(6500);
    assert.equal(await page.evaluate(() => window.__recording.starts), 6, 'A countdown outlived its test and started a recording.');
    assert.deepEqual(errors, []);
    console.log('Recording checks passed: one confirmation per game (remembered), delay with cancel, hotkey refuses unconfirmed and starts confirmed.');
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
