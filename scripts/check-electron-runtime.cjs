// Real Electron + real sandboxed preload + actual main source, with closed adapters.
// Loads the built renderer only after an inert IPC test; native services stay closed.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dialed-electron-fixture-'));
  const env = { ...process.env, DIALED_ELECTRON_FIXTURE_DIRECTORY: directory };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require('electron'), [__filename, '--fixture-child'], { env, windowsHide: true, encoding: 'utf8', timeout: 45000 });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  assert.equal(result.status, 0, 'Electron fixture failed');
  const report = JSON.parse(fs.readFileSync(path.join(directory, 'report.json'), 'utf8'));
  assert.equal(report.pass, true);
  console.log(`Real Electron fixture passed. Isolated evidence: ${path.join(directory, 'report.json')}`);
} else {
  const electron = require('electron');
  const vm = require('node:vm');
  const directory = process.env.DIALED_ELECTRON_FIXTURE_DIRECTORY;
  assert.ok(process.argv.includes('--fixture-child'));
  assert.ok(directory && path.dirname(path.resolve(directory)) === path.resolve(os.tmpdir()) && path.basename(directory).startsWith('dialed-electron-fixture-'));
  electron.app.setPath('userData', directory);
  electron.app.setPath('sessionData', directory);
  electron.app.commandLine.appendSwitch('disable-background-networking');
  electron.app.commandLine.appendSwitch('disable-component-update');
  const denied = (name) => () => { throw new Error(`Closed fixture adapter: ${name}`); };
  let window;
  let rendererScenario = false;
  const rendererCalls = [];
  const rendererDenied = [];
  const allowedReads = new Set(['pc-opti:get-runtime-profile','pc-opti:list-capabilities','pc-opti:get-audit-history','pc-opti:list-manageable-processes','pc-opti:list-startup-items','pc-opti:list-safe-policies','pc-opti:list-timing-experiments','pc-opti:get-network-probe-info','pc-opti:list-network-quality-history']);
  const registered = new Set();
  const dispatched = [];
  const rejected = [];
  const html = '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'none\'"><title>Dialed isolated IPC fixture</title><p>Fixture only</p>';
  const fixtureUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  function allowedUrl(url) {
    if (url === fixtureUrl) return true;
    if (!rendererScenario || !url.startsWith('file:')) return false;
    try { const target = fs.realpathSync(require('node:url').fileURLToPath(url)); const relative = path.relative(fs.realpathSync(path.join(root,'dist')),target); return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); } catch { return false; }
  }
  function FixtureWindow(options) {
    assert.equal(options.webPreferences.nodeIntegration, false);
    assert.equal(options.webPreferences.contextIsolation, true);
    assert.equal(options.webPreferences.sandbox, true);
    assert.equal(options.webPreferences.preload, path.join(root, 'electron/preload.cjs'));
    window = new electron.BrowserWindow({ ...options, show: false });
    window.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !allowedUrl(details.url) }));
    const loadFixture = () => electron.BrowserWindow.prototype.loadURL.call(window, fixtureUrl);
    window.loadFile = loadFixture;
    window.loadURL = loadFixture;
    return window;
  }
  const fakeElectron = {
    BrowserWindow: FixtureWindow,
    app: { isPackaged: false, requestSingleInstanceLock: () => true, on: () => {}, whenReady: () => ({then: () => {}}), getPath: (name) => { assert.equal(name, 'userData'); return directory; }, getAppPath: () => root },
    ipcMain: { handle: (channel, handler) => {
      assert.ok(!registered.has(channel)); registered.add(channel);
      electron.ipcMain.handle(channel, (event,...args) => {
        if (rendererScenario) { rendererCalls.push(channel); if (!allowedReads.has(channel)) { rendererDenied.push(channel); throw new Error('Renderer fixture: service unavailable; no host operation performed'); } return handler(event,...args); }
        if (channel !== 'pc-opti:list-manageable-processes') { rejected.push(channel); throw new Error('Fixture permits only its read-only inventory IPC'); }
        dispatched.push(channel); return handler(event,...args);
      });
    } },
    shell: {openPath: denied('openPath'),openExternal: denied('openExternal')},
    dialog: new Proxy({}, {get: (_target,key) => denied(`dialog:${String(key)}`)}),
  };
  const modules = {
    '../src/main/acceptance-user-data/index.cjs': {configureAcceptanceUserDataPath: () => {}},
    '../src/main/shared/preview-store.cjs': require('../src/main/shared/preview-store.cjs'),
    '../src/main/capabilities/index.cjs': require('../src/main/capabilities/index.cjs'),
    '../src/main/scanner/index.cjs': {listStartupItems: async () => ({items:[],errors:[]}),listSafePolicies: async () => ({items:[],errors:[]}),listManageableProcesses: async () => ({items:[{pid:4242,name:'fixture-only',creationTime:'123456789',cpuPercent:null,workingSetBytes:1}],errors:[]})},
    '../src/main/journal/index.cjs': {inspectJournalRecovery: () => ({entries:[],recovery:null})},
    '../src/main/network-probe/index.cjs': {NETWORK_PROBE_ENDPOINTS:{quick:{id:'cloudflare-warmed-http-v2-quick',mode:'quick',methodVersion:'warmed-https-v2',title:'Fixture only',url:'https://example.invalid',requests:0,idleRequests:0,loadedRequestsPerDirection:0,maximumDownloadBytes:0,maximumUploadBytes:0,maximumTotalBytes:0,maximumDurationSeconds:60,maximumParallelConnections:1,privacy:'Synthetic endpoint description. This fixture cannot make network requests.'}},readNetworkQualityHistory: () => ({status:'READY',entries:[]})},
    '../src/main/timing/index.cjs': {listTimingExperiments: () => ({items:[],errors:[]})},
    '../src/main/navigation/index.cjs': {isAllowedAppNavigation: () => false,normalizeExternalTarget: denied('external target')},
  };
  const context = vm.createContext({
    require: (name) => {
      if (name === 'electron') return fakeElectron;
      if (['crypto','path','url'].includes(name)) return require(name);
      if (name === '../package.json') return {dialed:{defaultProfile:'public',inputDriver:{status:'UNCONFIGURED'},update:{}}};
      if (modules[name]) return modules[name];
      if (name.startsWith('../src/main/')) return new Proxy({}, {get: (_target,key) => denied(`${name}:${String(key)}`)});
      throw new Error(`Dependency not allowed: ${name}`);
    },
    process: {env:{},argv:[],platform:'win32',resourcesPath:directory},
    __dirname:path.join(root,'electron'),console,setTimeout,clearTimeout,AbortController,Buffer,URL,
  });
  vm.runInContext(fs.readFileSync(path.join(root,'electron/main.cjs'),'utf8'), context, {filename:'actual-main.cjs'});
  const timeout = setTimeout(() => { console.error('Electron fixture timed out'); electron.app.exit(1); },30000);
  electron.app.whenReady().then(async () => {
    vm.runInContext('createWindow()',context);
    await new Promise((resolve,reject) => { window.webContents.once('did-finish-load',resolve); window.webContents.once('did-fail-load',(_event,code,description) => reject(new Error(`${code}: ${description}`))); });
    const result = await window.webContents.executeJavaScript(`(async () => ({ node: typeof require, process: typeof process, bridgeFrozen: Object.isFrozen(window.pcOptiNative), bridgeCount: Object.keys(window.pcOptiNative).length, inventory: await window.pcOptiNative.listManageableProcesses() }))()`);
    assert.equal(result.node,'undefined'); assert.equal(result.process,'undefined'); assert.equal(result.bridgeFrozen,true);
    assert.ok(result.bridgeCount > 50); assert.equal(result.inventory.items[0].name,'fixture-only');
    assert.equal(result.inventory.items[0].cpuPercent,null);
    assert.deepEqual(dispatched,['pc-opti:list-manageable-processes']);
    const deniedResult = await window.webContents.executeJavaScript(`window.pcOptiNative.scanSystem().then(() => false, error => error.message.includes('Fixture permits only'))`);
    assert.equal(deniedResult,true);
    assert.deepEqual(rejected,['pc-opti:scan-system']);
    assert.equal(window.isVisible(),false);
    rendererScenario = true;
    await electron.BrowserWindow.prototype.loadFile.call(window,path.join(root,'dist/index.html'));
    const rendererWorkspaces = [];
    for (const name of ['Home','Scan','Optimize','Games','Network','Input Devices','Measure','Verify','Settings']) {
      const state = await window.webContents.executeJavaScript(`(async () => {
        const pause = () => new Promise(resolve => setTimeout(resolve,50));
        let button;
        for(let attempt=0;attempt<100;attempt++) { button = [...document.querySelectorAll('aside nav button')].find(item => item.textContent.trim().startsWith(${JSON.stringify(name)})); if(button) break; await pause(); }
        if(!button) throw new Error('Workspace navigation missing: ' + ${JSON.stringify(name)});
        button.click();
        for(let attempt=0;attempt<100;attempt++) { await pause(); if(document.querySelector('main')?.innerText.trim().length > 50 && !document.querySelector('main')?.innerText.includes('Loading ')) break; }
        const main = document.querySelector('main');
        return {name:${JSON.stringify(name)},selected:button.getAttribute('aria-current'),navCount:document.querySelectorAll('aside nav button').length,contentLength:main?.innerText.length || 0,loading:main?.innerText.includes('Loading ') || false,fallback:document.body.innerText.includes('This view could not be displayed'),overflow:document.documentElement.scrollWidth > document.documentElement.clientWidth,node:typeof require};
      })()`);
      assert.equal(state.selected,'page'); assert.equal(state.navCount,9); assert.ok(state.contentLength > 50); assert.equal(state.fallback,false); assert.equal(state.loading,false,`Unresolved loading state: ${name}`); assert.equal(state.overflow,false); assert.equal(state.node,'undefined');
      rendererWorkspaces.push(state);
    }
    assert.ok(rendererCalls.includes('pc-opti:get-runtime-profile'));
    assert.ok(rendererCalls.includes('pc-opti:get-audit-history'));
    assert.equal(window.isVisible(),false);
    fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify({pass:true,sourceHashes:Object.fromEntries(['main.cjs','preload.cjs'].map(file => [file,require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root,'electron',file))).digest('hex')])),blockedOutsideFixtureChannel:true,rendererWorkspaces,rendererCalls:[...new Set(rendererCalls)],rendererUnavailableServices:[...new Set(rendererDenied)],rendererIndexSha256:require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root,'dist/index.html'))).digest('hex'),rendererEvidence:'Real built renderer shell with synthetic empty reads and deliberately unavailable services. No populated-state or installed-host acceptance.',electron:process.versions.electron,registeredChannels:registered.size,...result,scope:'Actual main source and actual sandboxed preload with real Electron IPC; closed fake service adapters; synthetic renderer shell included; populated states and host acceptance excluded.'},null,2));
    clearTimeout(timeout); window.destroy(); electron.app.exit(0);
  }).catch((error) => { console.error(error); clearTimeout(timeout); electron.app.exit(1); });
}

