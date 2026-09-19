// Representative UI evidence only. No Electron, host inventory, native tools or mutations.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.DIALED_PLAYWRIGHT_PATH || 'playwright');
const { listCapabilities } = require('../src/main/capabilities/index.cjs');
const { listGameSettingsGuides } = require('../src/main/game-settings/index.cjs');
const origin = process.env.DIALED_UI_URL || 'http://127.0.0.1:5178';
if (new URL(origin).hostname !== '127.0.0.1') throw new Error('Only loopback fixture servers are allowed.');
const out = path.resolve(__dirname, '../output/playwright');
const themes = ['midnight', 'ember', 'violet', 'forest', 'graphite', 'oled', 'aurora', 'carbon-gold'];

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const report = { scope: 'Representative populated process/history, process loading/failure, scan failure, appearance and keyboard fixtures. Browser CSS scaling is not Windows DPI acceptance.', checks: [] };
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    // Reject external traffic even if an accidental product request is introduced.
    await context.route('**/*', route => new URL(route.request().url()).origin === new URL(origin).origin ? route.continue() : route.abort());
    await context.addInitScript(({ capabilities, guides }) => {
      const rows = async () => ({ items: [], errors: [] });
      const unavailable = async () => { throw new Error('Unavailable in closed browser fixture.'); };
      window.__workspaceState = { mode: 'populated', release: null, displayReads: 0 };
      const processes = [
        { pid: 101, name: 'Fixture editor with a long descriptive process name', creationTime: '1001', cpuPercent: 12.5, workingSetBytes: 134217728, efficiencyMode: false },
        { pid: 102, name: 'Fixture unknown CPU', creationTime: null, cpuPercent: null, workingSetBytes: 4194304, efficiencyMode: false },
        { pid: 103, name: 'Fixture efficient worker', creationTime: '1003', cpuPercent: 0, workingSetBytes: 2097152, efficiencyMode: true },
      ];
      const entries = ['SUCCESS', 'FAILED', 'PENDING', 'NEEDS_REVIEW'].map((status, index) => ({
        id: `fixture-history-${index}`, title: `Fixture ${status.toLowerCase()} operation`, timestamp: '2026-09-05T12:00:00Z', status,
        actionId: 'fixture-only', exitCode: status === 'SUCCESS' ? 0 : null,
        rollback: { available: false, reason: 'Synthetic evidence has no real rollback.' },
        resultingState: { fixture: true }, stderr: status === 'FAILED' ? 'Fixture operation failed without touching the host.' : '',
      }));
      // Every method is a closed in-memory adapter; unavailable methods cannot fall back to the host.
      window.pcOptiNative = {
        getRuntimeProfile: async () => ({ profile: 'public', capabilities }), listCapabilities: async () => capabilities,
        getAuditHistory: async () => ({ entries, recovery: null }),
        listStartupItems: rows, listSafePolicies: rows, listTimingExperiments: rows,
        listManageableProcesses: async () => {
          if (window.__workspaceState.mode === 'loading') await new Promise(resolve => { window.__workspaceState.release = resolve; });
          if (window.__workspaceState.mode === 'error') throw new Error('Fixture process inventory failed; previous rows retained.');
          return { items: processes, errors: [] };
        },
        scanSystem: async () => { throw new Error('Fixture scan failure: no host scan was attempted.'); },
        getLocalRecommendations: async () => [], listGameSettingsGuides: async () => guides,
        listBenchmarkEvidence: unavailable, getReleaseStatus: unavailable,
        getNetworkProbeInfo: async () => ([{ id:'cloudflare-warmed-http-v2-quick',mode:'quick',methodVersion:'warmed-https-v2',title:'Fixture fixed endpoint',url:'https://example.invalid/fixture',requests:22,idleRequests:9,loadedRequestsPerDirection:5,maximumDownloadBytes:100,maximumUploadBytes:100,maximumTotalBytes:200,maximumDurationSeconds:60,maximumParallelConnections:6,privacy:'In-memory fixture only.' }]),
        listNetworkQualityHistory: async () => ({ status: 'READY', entries: [0,1].map(index => ({ id:`network-fixture-${index}`,completedAt:`2026-09-05T12:0${index}:00Z`,status:'COMPLETE',endpointId:'cloudflare-warmed-http-v2-quick',methodVersion:'warmed-https-v2',mode:'quick',quality:'SUFFICIENT',metrics:{idleLatencyMs:index*2,idleJitterMs:0,idleP90Ms:index*2,idleVariabilityMs:0,requestFailurePercent:0,downloadLoadedLatencyMs:null,downloadLoadedLatencyIncreaseMs:null,uploadLoadedLatencyMs:null,uploadLoadedLatencyIncreaseMs:null,downloadMbps:10+index,uploadMbps:0} })) }),
        previewNetworkQualityProbe: unavailable, runNetworkQualityProbe: unavailable,
        readDisplayInventory: async () => {
          if (++window.__workspaceState.displayReads > 1) throw new Error('Fixture display refresh failure.');
          return { collectedAt: '2026-09-05T12:00:00Z', displays: [{ id: 1, label: 'Fixture monitor', refreshRateHz: 143.98, logicalWidth: 1707, logicalHeight: 960, scaleFactor: 1.5 }] };
        },
        listGameProfiles: async () => [], listGameConfigBackups: async () => ({ entries: [] }),
        discoverInstalledGames: async () => ({ scannedAt: '2026-09-05T12:00:00Z', games: [], limitations: 'Fixture inventory.' }),
        listInstalledApplications: async () => ({ items: [], limitations: 'Fixture inventory.' }),
        listOptionalAppCandidates: async () => ({ items: [], limitations: 'Fixture inventory.' }),
        enableProcessEcoQos: unavailable, openWindowsSettings: unavailable, openExternalLink: unavailable,
      };
    }, { capabilities: listCapabilities('public'), guides: listGameSettingsGuides() });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const navigate = name => page.locator('aside nav button').filter({ hasText: new RegExp(`^${name}`) }).click();
    async function layout(state) {
      for (const theme of themes) for (const scale of [1, 1.25, 1.5, 2]) {
        await page.evaluate(({ theme, scale }) => {
          document.documentElement.dataset.theme = theme;
          document.documentElement.style.zoom = String(scale);
        }, { theme, scale });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        // ResizeObserver-driven chart containers settle after CSS zoom changes.
        await page.waitForTimeout(150);
        const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
        if (dimensions.scroll > dimensions.width + 1 && !report.checks.some(check => check.state === state && check.overflow)) {
          await page.screenshot({ path: path.join(out, 'workspace-states-overflow.png'), fullPage: true });
          const offenders = await page.evaluate(() => [...document.querySelectorAll('main *')].map(e => ({ tag: e.tagName, class: e.className, text: e.textContent.slice(0, 70), parent: e.parentElement?.outerHTML.slice(0, 450), right: e.getBoundingClientRect().right })).filter(e => e.right > innerWidth + 1).slice(-15));
          console.error('Overflow details', offenders);
        }
        report.checks.push({ state, theme, cssScale: scale, overflow: dimensions.scroll > dimensions.width + 1 });
      }
      await page.evaluate(() => { document.documentElement.style.zoom = ''; });
    }
    await page.goto(origin);
    const search = page.getByRole('searchbox', { name: 'Find a workspace' });
    await search.fill('controller');
    assert.equal(await page.locator('aside nav button').count(), 1);
    await search.press('Enter');
    await page.locator('aside nav button[aria-current="page"]').filter({ hasText: 'Input Devices' }).waitFor();
    assert.equal(await search.inputValue(), '');
    await search.fill('nothing-matches-this');
    assert.equal(await page.locator('aside nav button').count(), 0);
    await search.press('Escape');
    assert.equal(await page.locator('aside nav button').count(), 9);
    report.checks.push({ state: 'Workspace search aliases, single-result Enter, empty result and Escape recovery', passed: true });
    await navigate('Optimize');
    await page.getByRole('tab', { name: 'Background Apps', exact: true }).click();
    await page.getByText('Fixture unknown CPU', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Refresh to verify process identity' }).isDisabled(), true);
    await layout('Optimize populated processes: known/unknown CPU and existing efficiency');
    await page.getByPlaceholder('Search process name or PID...').fill('no matching fixture');
    await page.getByText('No background processes match the current filters.', { exact: true }).waitFor();
    report.checks.push({ state: 'Optimize populated filter has no matches', passed: true });
    await page.getByPlaceholder('Search process name or PID...').fill('');
    await page.evaluate(() => { window.__workspaceState.mode = 'loading'; });
    await page.getByRole('button', { name: 'Refresh process list' }).click();
    await page.getByText('Reading native process telemetry…', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Reading processes…' }).isDisabled(), true);
    report.checks.push({ state: 'Optimize loading disables repeated refresh', passed: true });
    await page.evaluate(() => { window.__workspaceState.mode = 'error'; window.__workspaceState.release(); });
    await page.getByText(/Fixture process inventory failed/).waitFor();
    await page.getByText('Fixture unknown CPU', { exact: true }).waitFor();
    await layout('Optimize failed refresh with retained prior rows');
    await navigate('Verify');
    await page.getByRole('tab', { name: 'Recovery & history', exact: true }).click();
    await page.getByRole('heading', { name: 'Fixture pending operation', exact: true }).waitFor();
    await layout('Verify populated success/failure/pending/needs-review history');
    const tabs = page.getByRole('tablist', { name: 'Verification categories' });
    await tabs.getByRole('tab', { name: 'Recovery & history', exact: true }).focus();
    await page.keyboard.press('Home');
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-selected') === 'true' && document.activeElement?.textContent === 'Readiness');
    await page.keyboard.press('End');
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-selected') === 'true' && document.activeElement?.textContent === 'Recovery & history');
    report.checks.push({ state: 'Verify keyboard Home/End selection and focus', passed: true });
    await navigate('Scan');
    await page.getByRole('button', { name: 'Run verified scan', exact: true }).click();
    await page.getByText('Fixture scan failure: no host scan was attempted.', { exact: true }).waitFor();
    await layout('Scan explicit fixture failure');
    await navigate('Network');
    await page.getByRole('combobox', { name: /^Baseline run/ }).selectOption('network-fixture-0');
    await page.getByRole('combobox', { name: /^Candidate run/ }).selectOption('network-fixture-1');
    for (const phase of ['Baseline run','Candidate run']) {
      await page.getByLabel(`${phase} · Adapter / connection`, { exact: true }).fill('Fixture Ethernet');
      await page.getByLabel(`${phase} · VPN state (including none)`, { exact: true }).fill('none');
      await page.getByLabel(`${phase} · Background workload`, { exact: true }).fill('idle');
    }
    await page.getByRole('button', { name: 'Save declared conditions', exact: true }).click();
    await page.getByText(/Matched declarations and versioned endpoint/).waitFor();
    assert.equal(await page.locator('dl').filter({ hasText: 'Idle request time (ms)' }).getByText('+2.00', { exact: true }).count(), 1);
    await page.getByLabel('Candidate run · VPN state (including none)', { exact: true }).fill('enabled');
    await page.getByRole('button', { name: 'Save declared conditions', exact: true }).click();
    await page.getByText('Declared conditions differ. These runs are not a matched comparison.', { exact: true }).waitFor();
    assert.equal(await page.locator('dl').filter({ hasText: 'Idle request time (ms)' }).count(), 0);
    await page.getByLabel('Candidate run · VPN state (including none)', { exact: true }).fill('none');
    await page.getByRole('button', { name: 'Save declared conditions', exact: true }).click();
    await layout('Network populated saved matched-condition comparison');
    await navigate('Home');
    await navigate('Network');
    await page.getByRole('combobox', { name: /^Baseline run/ }).selectOption('network-fixture-0');
    await page.getByRole('combobox', { name: /^Candidate run/ }).selectOption('network-fixture-1');
    assert.equal(await page.getByLabel('Candidate run · VPN state (including none)', { exact: true }).inputValue(), 'none');
    await page.getByText(/Matched declarations and versioned endpoint/).waitFor();
    report.checks.push({ state: 'Network saved declarations persist; matching compares, mismatch refuses; no probe API', passed: true });
    await navigate('Games');
    assert.equal(await page.evaluate(() => window.__workspaceState.displayReads), 0);
    await page.getByRole('button', { name: 'Read display information', exact: true }).click();
    await page.getByText('143.98 Hz', { exact: true }).waitFor();
    await page.getByText('1707 × 960 logical px', { exact: true }).waitFor();
    await page.getByText('150%', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Refresh display information', exact: true }).click();
    await page.getByText(/Fixture display refresh failure/).waitFor();
    await page.getByText('143.98 Hz', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__workspaceState.displayReads), 2);
    report.checks.push({ state: 'Display read is explicit; logical size/scale precise; failed refresh preserves prior rows', passed: true });
    await navigate('Settings');
    const summaryPreview = await page.getByLabel('Exact support export JSON').textContent();
    const downloadPending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download this support summary', exact: true }).click();
    const supportDownload = await downloadPending;
    assert.equal(fs.readFileSync(await supportDownload.path(), 'utf8'), summaryPreview);
    assert.ok(!summaryPreview.includes('fixture-history-'));
    report.checks.push({ state: 'Exact preview equals support download; fixture audit IDs omitted', passed: true });
    await page.getByRole('checkbox', { name: /Comfortable text and controls/ }).check();
    await page.getByRole('checkbox', { name: /Simple backgrounds/ }).check();
    await layout('Settings comfortable text and simple background');
    await page.reload();
    await page.locator('aside nav').waitFor();
    const appearance = await page.evaluate(() => ({ density: document.documentElement.dataset.density, background: document.documentElement.dataset.background, motion: matchMedia('(prefers-reduced-motion: reduce)').matches, duration: getComputedStyle(document.querySelector('main')).animationDuration }));
    assert.equal(appearance.density, 'comfortable');
    assert.equal(appearance.background, 'simple');
    assert.equal(appearance.motion, true);
    assert.ok(parseFloat(appearance.duration) < 0.001);
    report.checks.push({ state: 'Appearance persists on Home reload and OS reduced motion applies', ...appearance });
    await page.screenshot({ path: path.join(out, 'workspace-states-comfortable-home.png'), fullPage: true });
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, 'workspace-states-report.json'), JSON.stringify(report, null, 2));
    assert.deepEqual(report.checks.filter(check => check.overflow), [], 'Representative layouts overflowed; see workspace-states-report.json');
    console.log(`Representative workspace fixture checks passed: ${report.checks.length}.`);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
