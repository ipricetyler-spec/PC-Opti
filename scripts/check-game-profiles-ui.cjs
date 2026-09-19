// Browser + real backend integration against isolated fixture files only.
// Requires an existing Playwright installation and a loopback Vite server.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.DIALED_PLAYWRIGHT_PATH || 'playwright');
const profiles = require('../src/main/game-profiles/index.cjs');
const configs = require('../src/main/game-config/index.cjs');
const { createPreviewStore } = require('../src/main/shared/preview-store.cjs');
const { listCapabilities } = require('../src/main/capabilities/index.cjs');
const { listGameSettingsGuides } = require('../src/main/game-settings/index.cjs');
const out = path.resolve(__dirname, '../output/playwright');
const origin = process.env.DIALED_UI_URL || 'http://127.0.0.1:5178';
if (new URL(origin).hostname !== '127.0.0.1') throw new Error('Fixture test is restricted to loopback.');
const themes = ['midnight', 'ember', 'violet', 'forest', 'graphite', 'oled', 'aurora', 'carbon-gold'];

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const root = fs.mkdtempSync(path.join(out, 'game-profile-fixture-'));
  const roots = { localAppData: path.join(root, 'Local'), documents: path.join(root, 'Documents') };
  const userData = path.join(root, 'user-data');
  const original = '[ScalabilityGroups]\r\nsg.ShadowQuality=3\r\nsg.PostProcessQuality=3\r\nsg.EffectsQuality=3\r\nsg.TextureQuality=3\r\n';
  const source = path.join(roots.localAppData, 'FortniteGame/Saved/Config/WindowsClient/GameUserSettings.ini');
  const rocket = path.join(roots.documents, 'My Games/Rocket League/TAGame/Config/TASystemSettings.ini');
  const valorant = path.join(roots.localAppData, 'VALORANT/Saved/Config/fixture-account-na/WindowsClient/GameUserSettings.ini');
  const arc = path.join(roots.localAppData, 'PioneerGame/Saved/Config/WindowsClient/GameUserSettings.ini');
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.mkdirSync(path.dirname(rocket), { recursive: true });
  fs.mkdirSync(path.dirname(valorant), { recursive: true });
  fs.mkdirSync(path.dirname(arc), { recursive: true });
  fs.writeFileSync(source, original);
  fs.writeFileSync(rocket, '[SystemSettings]\nMotionBlur=True\nDynamicShadows=True\nResX=1920\n');
  fs.writeFileSync(valorant, '[ScalabilityGroups]\nsg.ViewDistanceQuality=3\nsg.AntiAliasingQuality=3\nsg.ShadowQuality=3\nsg.PostProcessQuality=3\nsg.TextureQuality=1\nsg.EffectsQuality=3\nsg.FoliageQuality=3\nsg.ShadingQuality=3\n');
  fs.writeFileSync(arc, '[ScalabilityGroups]\nsg.ResolutionQuality=100\nsg.ViewDistanceQuality=2\nsg.AntiAliasingQuality=2\nsg.ShadowQuality=1\nsg.PostProcessQuality=0\nsg.TextureQuality=2\nsg.EffectsQuality=0\nsg.FoliageQuality=2\nsg.ShadingQuality=2\n');
  const closed = { listProcessNames: async () => ['System', 'FixtureOnly'] };
  const store = createPreviewStore();
  const restoreStore = createPreviewStore();
  const calls = [];
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 960, height: 700 } });
    await context.exposeBinding('__gameFixture', async (_source, method, id, mode) => {
      calls.push(method);
      if (method === 'list') return profiles.listGameProfiles();
      if (method === 'backups') return configs.listGameConfigBackups(userData);
      if (method === 'preview') {
        if (mode === 'running') throw new Error('Close the game before preview, apply or restore. No file was changed.');
        const pending = store.issue(await profiles.previewGameProfile(id, roots, closed));
        return { ...pending.preview, token: pending.token };
      }
      if (method === 'apply') {
        const pending = store.take(id);
        if (mode === 'stale') fs.appendFileSync(source, '; fixture external edit\r\n');
        return profiles.applyGameProfile(userData, pending.preview, roots, closed);
      }
      throw new Error('Unknown fixture method');
    });
    // Restore uses its own explicit binding so the real preview remains private.
    await context.exposeBinding('__restoreFixture', async (_source, id, apply) => {
      calls.push(apply ? 'restore' : 'restore-preview');
      if (!apply) {
        const issued = restoreStore.issue(configs.createGameConfigRestorePreview(userData, id));
        return configs.publicRestorePreview(issued.preview, issued.token);
      }
      const pending = restoreStore.take(id);
      return configs.applyGameConfigRestore(userData, pending.preview);
    });
    await context.addInitScript(({ capabilities, guides }) => {
      const rows = async () => ({ items: [], errors: [] });
      const call = (method, id) => window.__gameFixture(method, id, sessionStorage.getItem('game-fixture-mode'));
      window.pcOptiNative = {
        getRuntimeProfile: async () => ({ profile: 'public', capabilities }), listCapabilities: async () => capabilities,
        scanSystem: async () => { throw new Error('Fixture scan is unavailable; no host was scanned.'); },
        getLocalRecommendations: async () => [], getAuditHistory: async () => ({ entries: [], recovery: null }),
        getReleaseStatus: async () => ({
          version: '2.7.0', packaged: false, executableName: 'electron.exe',
          updateMode: 'VERIFIED_USER_INITIATED', updateCheckAvailable: false,
          update: { status: 'UNCONFIGURED', configured: false, channel: 'stable', feedHost: '', missingFields: ['feedUrl', 'manifestKeyId', 'manifestPublicKeySpkiBase64', 'publisherSubject', 'publisherThumbprint', 'allowedInstallerHosts'], errors: [], backgroundUpdates: false },
          signature: { status: 'NOT_APPLICABLE', statusMessage: 'Fixture development preview.', signerSubject: '', signerThumbprint: '', timestampSubject: '' },
        }),
        checkForUpdates: async () => { throw new Error('Fixture updater is intentionally unconfigured.'); },
        downloadUpdate: async () => { throw new Error('Fixture updater is intentionally unconfigured.'); },
        launchUpdateInstaller: async () => { throw new Error('Fixture updater is intentionally unconfigured.'); },
        listInstalledApplications: async () => ({ scannedAt: new Date().toISOString(), items: [], limitations: 'Fixture inventory.' }),
        listOptionalAppCandidates: async () => ({ scannedAt: new Date().toISOString(), items: [{ id: 'microsoft-news', title: 'Microsoft News', consequence: 'Fixture consequence.', name: 'Microsoft.BingNews', packageFullName: 'Microsoft.BingNews_4.0.0.0_x64__fixture', packageFamilyName: 'Microsoft.BingNews_fixture', version: '4.0.0.0', publisher: 'CN=Fixture', architecture: 'X64', signatureKind: 'Store', scope: 'CURRENT_USER', recovery: 'Exact rollback is unavailable.', fingerprint: '0'.repeat(64) }], limitations: 'Fixture allowlist.' }),
        previewOptionalAppRemoval: async () => { throw new Error('Fixture does not remove Windows packages.'); },
        applyOptionalAppRemoval: async () => { throw new Error('Fixture does not remove Windows packages.'); },
        openWindowsSettings: async (pageId) => ({ opened: true, pageId }),
        listStartupItems: rows, listManageableProcesses: rows, listSafePolicies: rows, listTimingExperiments: rows,
        listGameSettingsGuides: async () => guides, listGameProfiles: () => call('list'),
        previewGameProfile: (id) => call('preview', id), applyGameProfile: (token) => call('apply', token),
        listGameConfigBackups: () => call('backups'), discoverInstalledGames: async () => ({ scannedAt: new Date().toISOString(), games: [], limitations: 'Fixture-only inventory.' }),
        previewGameConfigRestore: (id) => window.__restoreFixture(id, false), applyGameConfigRestore: (token) => window.__restoreFixture(token, true),
        getNetworkProbeInfo: async () => ([{ id:'cloudflare-warmed-http-v2-quick',mode:'quick',methodVersion:'warmed-https-v2',title:'Fixture only',url:'https://example.com',requests:22,idleRequests:9,loadedRequestsPerDirection:5,maximumDownloadBytes:100,maximumUploadBytes:100,maximumTotalBytes:200,maximumDurationSeconds:60,maximumParallelConnections:6,privacy:'Fixture only.' }]),
        listNetworkQualityHistory: async () => ({ status: 'READY', entries: [] }),
        getPresentMonInfo: async () => ({ status: 'UNAVAILABLE', version: '2.5.1', sha256: 'fixture', signerSubject: 'fixture', sourceUrl: 'https://github.com/GameTechDev/PresentMon/releases/tag/v2.5.1', license: 'MIT', executableName: 'PresentMon.exe', reason: 'Browser fixture does not launch native tools.' }),
        listPresentMonTargets: async () => ({ scannedAt: new Date().toISOString(), items: [], limitations: 'Browser fixture targets.' }),
        getPresentMonCaptureState: async () => ({ active: null, entries: [], maximumEntries: 100 }),
        startPresentMonCapture: async () => { throw new Error('Browser fixture does not launch native tools.'); },
        stopPresentMonCapture: async () => ({ stopped: false }),
        prepareNativePresentMonImport: async () => ({ canceled: true }),
        previewPresentMonCaptureDeletion: async () => { throw new Error('Fixture has no native capture.'); },
        deletePresentMonCapture: async () => { throw new Error('Fixture has no native capture.'); },
        openExternalLink: async () => ({ opened: true }),
      };
    }, { capabilities: listCapabilities('public'), guides: listGameSettingsGuides() });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('dialog', (dialog) => dialog.accept());
    await page.goto(origin);
    await page.locator('aside nav button').filter({ hasText: /^Games/ }).click();
    await page.getByRole('tab', { name: 'Profiles', exact: true }).click();
    const section = page.getByRole('region', { name: 'Game optimization profiles' });
    await section.getByRole('button', { name: 'Preview Fortnite', exact: true }).click();
    await section.getByRole('heading', { name: 'Fortnite — exact changes' }).waitFor();
    assert.equal(await section.locator('tbody tr').count(), 3);
    assert.equal(calls.filter((name) => name === 'apply').length, 0);
    await section.getByRole('button', { name: 'Cancel profile preview' }).click();
    assert.equal(fs.readFileSync(source, 'utf8'), original);
    await section.getByRole('button', { name: 'Preview Fortnite', exact: true }).click();
    const layouts = [];
    for (const theme of themes) for (const width of [960, 1280]) {
      await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
      await page.setViewportSize({ width, height: 700 });
      const layout = await section.evaluate((element) => ({ width: element.clientWidth, scroll: element.scrollWidth, pageWidth: document.documentElement.clientWidth, pageScroll: document.documentElement.scrollWidth }));
      assert.ok(layout.scroll <= layout.width && layout.pageScroll <= layout.pageWidth, `${theme} overflow at ${width}`);
      layouts.push({ theme, width, overflow: false });
    }
    await page.setViewportSize({ width: 960, height: 700 });
    await section.screenshot({ path: path.join(out, 'game-profiles-carbon-gold-960.png') });
    await section.getByRole('button', { name: 'Back up & apply 3 changes', exact: true }).click();
    await section.getByRole('heading', { name: 'Applied — file verified' }).waitFor();
    assert.equal(calls.filter((name) => name === 'apply').length, 1);
    assert.equal(await section.getByRole('list', { name: 'Profile operation log' }).locator('li').count(), 5);
    await section.getByRole('button', { name: 'Preview restoring this backup' }).click();
    await page.getByRole('status').filter({ hasText: /Restored and hash-verified 1 file/ }).waitFor();
    assert.equal(fs.readFileSync(source, 'utf8'), original);
    await section.getByRole('button', { name: 'Preview Rocket League', exact: true }).click();
    await section.getByRole('button', { name: 'Back up & apply 2 changes', exact: true }).click();
    await section.getByRole('heading', { name: 'Applied — file verified' }).waitFor();
    await section.getByRole('button', { name: 'Preview Rocket League', exact: true }).click();
    await section.getByText('Already matches this profile. Nothing to apply.', { exact: true }).waitFor();
    assert.equal(await section.getByRole('button', { name: 'Back up & apply 0 changes' }).isDisabled(), true);
    await section.getByRole('button', { name: 'Preview VALORANT', exact: true }).click();
    await section.getByRole('heading', { name: 'VALORANT — exact changes' }).waitFor();
    assert.equal(await section.locator('tbody tr').count(), 3);
    await section.getByRole('button', { name: 'Back up & apply 3 changes', exact: true }).click();
    await section.getByRole('heading', { name: 'Applied — file verified' }).waitFor();
    await section.getByRole('button', { name: 'Preview ARC Raiders', exact: true }).click();
    await section.getByRole('heading', { name: 'ARC Raiders — exact changes' }).waitFor();
    assert.equal(await section.locator('tbody tr').count(), 1);
    await section.getByRole('button', { name: 'Back up & apply 1 change', exact: true }).click();
    await section.getByRole('heading', { name: 'Applied — file verified' }).waitFor();
    assert.match(fs.readFileSync(arc, 'utf8'), /sg\.ShadowQuality=0/);
    await page.evaluate(() => sessionStorage.setItem('game-fixture-mode', 'running'));
    await section.getByRole('button', { name: 'Preview Fortnite', exact: true }).click();
    await section.getByRole('alert').filter({ hasText: 'Close the game' }).waitFor();
    await page.evaluate(() => sessionStorage.setItem('game-fixture-mode', 'stale'));
    await section.getByRole('button', { name: 'Preview Fortnite', exact: true }).click();
    await section.getByRole('button', { name: 'Back up & apply 3 changes', exact: true }).click();
    await section.getByRole('alert').filter({ hasText: 'changed after preview' }).waitFor();
    assert.equal(fs.readFileSync(source, 'utf8'), `${original}; fixture external edit\r\n`);
    await page.evaluate(() => sessionStorage.removeItem('game-fixture-mode'));
    await page.reload();
    await page.locator('aside nav button').filter({ hasText: /^Games/ }).click();
    await page.getByRole('tab', { name: 'Backups', exact: true }).click();
    await page.getByRole('heading', { name: 'Local configuration backups' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Preview restore', exact: true }).count(), 4);
    assert.equal(await page.locator('aside nav button').count(), 9);
    await page.locator('aside nav button').filter({ hasText: /^Scan/ }).click();
    await page.getByRole('heading', { name: 'Useful evidence before another optimization' }).waitFor();
    await page.getByRole('tab', { name: 'Windows controls' }).click();
    await page.getByRole('heading', { name: 'Only reviewed current-user Store packages' }).waitFor();
    await page.getByText('Microsoft News', { exact: true }).waitFor();
    const controlsLayout = await page.locator('main').evaluate((element) => ({ width: element.clientWidth, scroll: element.scrollWidth, pageWidth: document.documentElement.clientWidth, pageScroll: document.documentElement.scrollWidth }));
    assert.ok(controlsLayout.scroll <= controlsLayout.width && controlsLayout.pageScroll <= controlsLayout.pageWidth, 'Windows controls overflow');
    await page.locator('aside nav button').filter({ hasText: /^Settings/ }).click();
    await page.getByRole('heading', { name: 'Verify every layer before an installer opens' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Check trusted feed' }).isDisabled(), true);
    await page.getByText('Updates stay disabled until release trust is configured and verified.', { exact: true }).waitFor();
    await page.getByText('Not configured', { exact: true }).waitFor();
    const releaseLayout = await page.locator('main').evaluate((element) => ({ width: element.clientWidth, scroll: element.scrollWidth, pageWidth: document.documentElement.clientWidth, pageScroll: document.documentElement.scrollWidth }));
    assert.ok(releaseLayout.scroll <= releaseLayout.width && releaseLayout.pageScroll <= releaseLayout.pageWidth, 'Release status overflow');
    // All nine workspaces, both disclosure modes, eight themes and two widths.
    // These are browser fixture states, not native hardware acceptance.
    const workspaceMatrix = [];
    const workspaceNames = ['Home','Scan','Optimize','Games','Network','Input Devices','Measure','Verify','Settings'];
    for (const workspace of workspaceNames) {
      await page.locator('aside nav button').filter({ hasText: new RegExp('^' + workspace) }).click();
      await page.locator('#main-content').waitFor();
      await page.waitForTimeout(60);
      for (const mode of ['hidden','shown']) for (const theme of themes) for (const width of [960,1280]) {
        await page.evaluate(({theme,mode}) => { document.documentElement.dataset.theme = theme; document.documentElement.dataset.technicalDetails = mode; }, {theme,mode});
        await page.setViewportSize({width,height:800});
        const dimensions = await page.evaluate(() => ({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
        assert.ok(dimensions.scroll <= dimensions.width, `${workspace}/${mode}/${theme}/${width} overflow`);
        workspaceMatrix.push({workspace,mode,theme,width,state:'fixture-empty-or-unavailable',overflow:false});
      }
      // Follow every mounted subtab and ensure it has a real labelled panel.
      const tabLists = page.getByRole('tablist');
      for (let listIndex=0; listIndex<await tabLists.count(); listIndex++) {
        const tabs = tabLists.nth(listIndex).getByRole('tab');
        for (let tabIndex=0; tabIndex<await tabs.count(); tabIndex++) {
          await tabs.nth(tabIndex).click();
          const selectedTab = tabs.nth(tabIndex);
          const panelId = await selectedTab.getAttribute('aria-controls');
          const tabId = await selectedTab.getAttribute('id');
          assert.ok(panelId && tabId, 'Tab identity/association missing');
          await page.locator(`[id="${panelId}"]`).waitFor();
          assert.equal(await page.locator(`[id="${panelId}"]`).getAttribute('aria-labelledby'),tabId);
        }
      }
      await page.screenshot({path:path.join(out,`workspace-${workspace.toLowerCase().replaceAll(' ','-')}-current.png`),fullPage:true});
    }
    fs.writeFileSync(path.join(out,'workspace-matrix-report.json'),JSON.stringify({fixtureOnly:true,sourceSha256:configs.sha256(fs.readFileSync(path.join(__dirname,'../src/App.tsx'))),checks:workspaceMatrix},null,2));
    await page.locator('aside nav button').filter({hasText:/^Home/}).click();
    await page.getByLabel('Workload / scene',{exact:true}).fill('Fixture replay');
    await page.getByLabel('One change to evaluate',{exact:true}).fill('One fixture change');
    await page.getByRole('button',{name:'Start saved session',exact:true}).click();
    assert.ok(await page.evaluate(() => localStorage.getItem('dialed-experiment-sessions:v1')), JSON.stringify({errors, text:await page.getByRole('region',{name:'Saved experiment sessions'}).textContent()}));
    await page.reload();
    await page.getByLabel('Resume session',{exact:true}).waitFor();
    assert.match(await page.getByLabel('Resume session',{exact:true}).textContent(),/Fixture replay/);
    assert.equal(await page.getByRole('button',{name: /Prepare linked comparison$/}).isDisabled(),true);
    await page.getByRole('button',{name:'Edit session notes',exact:true}).click();
    await page.getByLabel('Session workload',{exact:true}).fill('Renamed fixture replay');
    await page.getByRole('button',{name:'Save session notes',exact:true}).click();
    await page.getByRole('button',{name:'Archive session',exact:true}).click();
    assert.match(await page.getByLabel('Resume session',{exact:true}).textContent(),/Archived/);
    assert.equal(await page.getByRole('button',{name: /Prepare linked comparison$/}).isDisabled(),true);
    await page.reload();
    await page.getByRole('button',{name:'Restore archived session',exact:true}).click();
    assert.doesNotMatch(await page.getByLabel('Resume session',{exact:true}).textContent(),/Archived/);
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button',{name:'Export saved sessions',exact:true}).click();
    await (await downloaded).saveAs(path.join(out,'session-export-fixture.json'));
    assert.match(fs.readFileSync(path.join(out,'session-export-fixture.json'),'utf8'),/Renamed fixture replay/);
    await page.getByRole('button',{name:'Delete session',exact:true}).click();
    await page.getByRole('button',{name:'Confirm delete session',exact:true}).click();
    assert.equal(await page.getByLabel('Resume session',{exact:true}).count(),0);
    const exportedSessions = JSON.parse(fs.readFileSync(path.join(out,'session-export-fixture.json'),'utf8'));
    const importSessions = exportedSessions.map(item => ({...item,decision:'KEEP',archived:true,unknownOperation:'never execute'}));
    const upload = (value) => ({name:'session-restore.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});
    await page.getByLabel('Preview importing saved sessions',{exact:true}).setInputFiles(upload(importSessions));
    await page.getByRole('heading',{name:'Review session import',exact:true}).waitFor();
    assert.equal(await page.getByLabel('Resume session',{exact:true}).count(),0,'Preview imported sessions before confirmation');
    assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('dialed-experiment-sessions:v1'))),[]);
    await page.getByRole('button',{name:'Merge reviewed sessions',exact:true}).click();
    const imported = await page.evaluate(()=>JSON.parse(localStorage.getItem('dialed-experiment-sessions:v1')));
    assert.equal(imported.length,1);assert.equal(imported[0].decision,'UNDECIDED');assert.equal(imported[0].archived,true);
    assert.equal('unknownOperation' in imported[0],false);
    await page.getByRole('button',{name:'Restore archived session',exact:true}).click();
    const restoredState = await page.evaluate(()=>localStorage.getItem('dialed-experiment-sessions:v1'));
    const restored = JSON.parse(restoredState);
    assert.equal(restored[0].archived,false);
    await page.getByLabel('Preview importing saved sessions',{exact:true}).setInputFiles(upload([{...restored[0],workload:'Conflicting import'}]));
    await page.getByRole('alert').filter({hasText:'already exists with different content'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Merge reviewed sessions',exact:true}).count(),0);
    assert.equal(await page.evaluate(()=>localStorage.getItem('dialed-experiment-sessions:v1')),restoredState);
    await page.getByLabel('Preview importing saved sessions',{exact:true}).setInputFiles(upload(restored));
    await page.getByRole('heading',{name:'Review session import',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Merge reviewed sessions',exact:true}).isDisabled(),true,'Identical import should not duplicate sessions');
    await page.getByRole('button',{name:'Cancel import',exact:true}).click();

    assert.deepEqual(errors, []);
    // Deliberately reject one lazy module in a fresh page; recovery must keep
    // navigation usable and must not replay any fixture mutation.
    const faultPage = await context.newPage();
    const expectedFaults = [];
    faultPage.on('pageerror', (error) => expectedFaults.push(error.message));
    await faultPage.route('**/InputDevicesCenter-*.js', (route) => route.abort());
    await faultPage.goto(origin);
    const callsBeforeFault = calls.length;
    await faultPage.locator('aside nav button').filter({hasText:/^Input Devices/}).click();
    await faultPage.getByRole('heading',{name:'This view could not be displayed'}).waitFor();
    await faultPage.getByRole('button',{name:'Open recovery',exact:true}).click();
    await faultPage.getByRole('tab',{name:'Recovery & history',exact:true}).waitFor();
    assert.equal(calls.length,callsBeforeFault,'Display recovery replayed an operation');
    await faultPage.close();
    const report = { status: 'PASS', scope: 'Browser plus real backend against fixture files; no Windows/game-host validation', layouts, sessionArchiveImport: 'PASS', windowsControls: 'PASS', updaterFailClosed: 'PASS', errors, calls, fixtureDirectory: root };
    fs.writeFileSync(path.join(out, 'game-profiles-ui-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

