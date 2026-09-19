const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const root = path.resolve(__dirname,'..');

// Execute the actual entrypoints with an explicit closed set of adapters.
// Unknown dependencies/operations fail, never fall through to Windows or disk.
function harness(displays = []) {
  const handlers = new Map(), mutations = [], calls = [];
  const events = new EventEmitter();
  let bridge, dispatch = false;
  let displayReads = 0;
  const observed = {pid:4242,name:'fixture-app',creationTime:'123456789',cpuPercent:null,workingSetBytes:1};
  const denied = (name) => () => { throw new Error(`Unconfigured fixture operation: ${name}`); };
  const fakeElectron = {
    screen: {getAllDisplays: () => { displayReads += 1; if (displays instanceof Error) throw displays; return displays; }, getPrimaryDisplay: () => (Array.isArray(displays) ? displays[0] : null)},
    app:{isPackaged:false,requestSingleInstanceLock:()=>true,on:()=>{},whenReady:()=>({then:()=>{}}),getPath:()=>'/fixture-only',getAppPath:()=>root},
    ipcMain:{handle:(channel,handler)=>{ assert.ok(!handlers.has(channel)); handlers.set(channel,handler); }},
    contextBridge:{exposeInMainWorld:(name,value)=>{assert.equal(name,'pcOptiNative');bridge=value;}},
    ipcRenderer:{on:events.on.bind(events),removeListener:events.removeListener.bind(events),invoke:async (channel,...args)=>{calls.push({channel,args}); if (!dispatch) return null; const handler=handlers.get(channel); assert.ok(handler,`Missing ${channel}`); return handler({},...args);}},
    shell:{openPath:denied('openPath'),openExternal:denied('openExternal')},dialog:{showOpenDialog:denied('dialog')},BrowserWindow:denied('window'),
  };
  const modules = {
    '../src/main/acceptance-user-data/index.cjs':{configureAcceptanceUserDataPath:()=>{}},
    '../src/main/shared/preview-store.cjs':require('../src/main/shared/preview-store.cjs'),
    '../src/main/capabilities/index.cjs':{resolveRuntimeProfile:()=> 'public',requireCapability:()=>{},listCapabilities:()=>[]},
    '../src/main/scanner/index.cjs':{listManageableProcesses:async()=>({items:[{...observed}],errors:[]})},
    '../src/main/journal/index.cjs':{enableProcessEcoQos:async(_directory,selected)=>{mutations.push(selected);return {success:true};}},
    '../src/main/input-devices/index.cjs':{createInputService:(directory,options)=>require('../src/main/input-devices/index.cjs').createInputService(directory,{...options,native:async()=>{throw new Error('Unexpected native access from blocked IPC');}})},
  };
  const fakeRequire=(name)=>{
    if(name==='electron')return fakeElectron;
    if(['crypto','path','url'].includes(name))return require(name);
    if(name==='../package.json')return {dialed:{defaultProfile:'public',inputDriver:{status:'UNCONFIGURED'},update:{}}};
    if(modules[name])return modules[name];
    if(name.startsWith('../src/main/'))return new Proxy({}, {get:(_target,key)=>denied(`${name}:${String(key)}`)});
    throw new Error(`Dependency not allowed in fixture: ${name}`);
  };
  for(const file of ['main.cjs','preload.cjs'])vm.runInNewContext(fs.readFileSync(path.join(root,'electron',file),'utf8'),{require:fakeRequire,process:{env:{},argv:[],platform:'win32',resourcesPath:'/fixture-only'},__dirname:path.join(root,'electron'),console,setTimeout,clearTimeout,AbortController,Buffer,URL},{filename:file});
  return {handlers,bridge,mutations,calls,events,displayReads:()=>displayReads,dispatch:()=>{dispatch=true;}};
}

test('every actual preload invoke targets a registered main handler', async()=>{
  const h=harness();
  for(const [name,invoke] of Object.entries(h.bridge)) {
    if(name==='onBundledInputSetupClosed') { invoke(()=>{})(); continue; }
    await invoke();
  }
  for(const call of h.calls)assert.ok(h.handlers.has(call.channel),`Unregistered IPC: ${call.channel}`);
  assert.ok(h.calls.length>50);
});

test('actual input IPC cannot use the legacy path for new writes regardless of native availability', async()=>{
  const h=harness(); h.dispatch(); const id='a'.repeat(64);
  await assert.rejects(h.bridge.previewInputPolling(id,1000),/Use Change rate/);
  await assert.rejects(h.bridge.previewInputIsolation(id),/Use Change rate/);
  await assert.rejects(h.bridge.previewInputTier(id),/Use Change rate/);
  assert.deepEqual(h.mutations,[]);
});

test('setup close subscription carries no Electron authority or operation payload and can unsubscribe',()=>{
  const h=harness(); const received=[];
  assert.throws(()=>h.bridge.onBundledInputSetupClosed(null),/listener required/);
  const unsubscribe=h.bridge.onBundledInputSetupClosed((...args)=>received.push(args));
  h.events.emit('pc-opti:bundled-input-setup-closed',{sender:'privileged-event'},{status:'CONFIGURATION_VERIFIED'});
  assert.deepEqual(received,[[]]);
  unsubscribe();
  h.events.emit('pc-opti:bundled-input-setup-closed',{});
  assert.equal(received.length,1);
  assert.equal(h.calls.length,0);
});

test('actual preload forwards the selected device digest to native setup without an operation', async () => {
  const h = harness();
  await h.bridge.openBundledInputSetup('a'.repeat(64));
  await h.bridge.openBundledInputSetup('b'.repeat(64));
  assert.deepEqual(h.calls, [
    { channel: 'pc-opti:open-bundled-input-setup', args: ['a'.repeat(64)] },
    { channel: 'pc-opti:open-bundled-input-setup', args: ['b'.repeat(64)] },
  ]);
  assert.equal(h.mutations.length, 0);
});

test('actual preload/main EcoQoS path binds the selected lifetime before dispatch',async()=>{
  const h=harness();h.dispatch();
  await h.bridge.listManageableProcesses();
  await assert.rejects(h.bridge.enableProcessEcoQos(4242,'987654321'),/inventory changed/);
  await assert.rejects(h.bridge.enableProcessEcoQos(4242),/inventory changed/);
  assert.equal(h.mutations.length,0);
  await h.bridge.enableProcessEcoQos(4242,'123456789');
  assert.equal(h.mutations.length,1);
  assert.equal(h.mutations[0].creationTime,'123456789');
});

test('display inventory is explicitly requested, read-only and preserves unknown reports', async () => {
  const h = harness([
    { id: 1, label: ' Fixture monitor ', displayFrequency: 143.98, bounds: { width: 1707, height: 960 }, scaleFactor: 1.5 },
    { id: NaN, label: '', displayFrequency: 0, bounds: { width: -1, height: Infinity }, scaleFactor: NaN },
  ]);
  assert.equal(h.displayReads(), 0);
  h.dispatch();
  const result = await h.bridge.readDisplayInventory();
  assert.equal(h.displayReads(), 1);
  assert.equal(result.displays[0].refreshRateHz, 143.98);
  assert.equal(result.displays[0].logicalWidth, 1707);
  assert.equal(result.displays[0].scaleFactor, 1.5);
  assert.equal(result.displays[0].label, 'Fixture monitor');
  assert.equal(result.displays[0].primary, true);
  assert.equal(result.displays[1].primary, false);
  for (const key of ['id', 'refreshRateHz', 'logicalWidth', 'logicalHeight', 'scaleFactor']) assert.equal(result.displays[1][key], null);
  assert.equal(result.displays[1].label, 'Display 2');
  assert.ok(Number.isFinite(Date.parse(result.collectedAt)));
  assert.equal(h.mutations.length, 0);
});

test('display inventory failure is propagated instead of inventing display evidence', async () => {
  const h = harness(new Error('Fixture display API unavailable'));
  h.dispatch();
  await assert.rejects(h.bridge.readDisplayInventory(), /Fixture display API unavailable/);
  assert.equal(h.mutations.length, 0);
});
