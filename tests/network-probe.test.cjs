const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const capabilities = require('../src/main/capabilities/index.cjs');
const probe = require('../src/main/network-probe/index.cjs');

test('network capability contract describes the current warmed HTTPS plans', () => {
  const capability = capabilities.CAPABILITIES.find(({ id }) => id === 'network:bounded-quality-probe');
  assert.ok(capability);
  const contract = [capability.description, capability.detectionMethod, capability.evidenceLevel, capability.measurableSuccessCriteria].join(' ');
  assert.match(contract, /warmed-https-v2/);
  assert.match(contract, /user-started Quick or Full/);
  assert.match(contract, /nine idle request outcomes/);
  assert.match(contract, /separate download-loaded and upload-loaded/);
  assert.match(contract, /active-transfer overlap/);
  assert.match(contract, /explicit insufficient result/);
  assert.match(contract, /without treating failures as packet loss/);
  assert.match(contract, /Full adaptively chooses transfer sizes within fixed main-owned hard caps/);
  assert.match(contract, /byte counts, sample counts, request outcomes/);
  assert.match(contract, /schema-validated/);
  assert.doesNotMatch(contract, /twelve-request|five idle outcomes|five loaded outcomes|idle latency, loaded latency/i);
});

test('network probe rejects private, local, reserved, and documentation addresses', () => {
  for (const address of ['0.0.0.0','10.1.2.3','100.64.0.1','127.0.0.1','169.254.1.1','172.16.0.1','192.168.1.1','192.0.2.1','198.51.100.2','203.0.113.4','224.0.0.1','::','::1','fc00::1','fe80::1','ff02::1','2001:db8::1','not-an-ip']) assert.equal(probe.isPublicIpAddress(address), false, address);
  for (const address of ['1.1.1.1','8.8.8.8','2606:4700:4700::1111','2001:4860:4860::8888']) assert.equal(probe.isPublicIpAddress(address), true, address);
});

test('DNS validation blocks mixed public and private answers and pinned lookup supports both callback shapes', async () => {
  await assert.rejects(probe.resolvePublicAddresses('fixture.example', async () => [{address:'1.1.1.1',family:4},{address:'127.0.0.1',family:4}]), /private, local, reserved, or invalid/);
  const lookup = probe.createPinnedLookup({address:'1.1.1.1',family:4});
  lookup('fixture.example',{all:true},(error,addresses) => { assert.equal(error,null); assert.deepEqual(addresses,[{address:'1.1.1.1',family:4}]); });
  lookup('fixture.example',{all:false},(error,address,family) => { assert.equal(error,null); assert.equal(address,'1.1.1.1'); assert.equal(family,4); });
  assert.throws(() => probe.createPinnedLookup({address:'127.0.0.1',family:4}), /valid public IP/);
});

test('response metrics use warmed timing, expose percentiles and call failures request failures', () => {
  const metrics = probe.computeProbeMetrics([
    {success:true,responseWaitMs:10,durationMs:999}, {success:true,responseWaitMs:14,durationMs:999},
    {success:false,responseWaitMs:null,durationMs:null}, {success:true,responseWaitMs:12,durationMs:999},
    {success:false,responseWaitMs:null,durationMs:null},
  ], 5);
  assert.equal(metrics.medianMs,12);
  assert.equal(metrics.jitterMs,3);
  assert.equal(metrics.requestFailurePercent,40);
  assert.equal(metrics.successfulSamples,3);
  assert.equal(metrics.failedSamples,2);
  assert.equal(metrics.expectedSamples,5);
  assert.ok(metrics.p90Ms > metrics.medianMs);
  assert.ok(metrics.variabilityMs > 0);
  assert.equal(probe.throughputMbps(1_000_000,1000),8);
  assert.equal('lossPercent' in metrics,false);
});

test('loaded timing is eligible only when successful requests complete inside a sufficiently long active transfer', async () => {
  let releaseTransfer;
  const transferGate = new Promise((resolve) => { releaseTransfer = resolve; });
  const sufficient = await probe.runLoadedPhase({
    direction:'download', count:5, now:() => 100,
    transfer: async ({onTransferStart}) => { onTransferStart(0); await transferGate; return {success:true,transferStartedAtMs:0,completedAtMs:1000,measurementDurationMs:1000}; },
    latency: async (index) => { if (index === 4) releaseTransfer(); return {success:true,responseWaitMs:10,durationMs:10,completedAtMs:200}; },
  });
  assert.equal(sufficient.quality.status,'SUFFICIENT');
  assert.equal(sufficient.quality.overlappingSuccessfulSamples,5);
  assert.ok(sufficient.samples.every((sample) => sample.overlappedTransfer));

  const short = await probe.runLoadedPhase({
    direction:'upload', count:5, now:() => 100,
    transfer: async ({onTransferStart}) => { onTransferStart(0); await new Promise((resolve) => setImmediate(resolve)); return {success:true,transferStartedAtMs:0,completedAtMs:200,measurementDurationMs:200}; },
    latency: async () => ({success:true,responseWaitMs:10,durationMs:10,completedAtMs:150}),
  });
  assert.equal(short.quality.status,'INSUFFICIENT');
  assert.equal(short.quality.transferDurationMs,200);
});

test('adaptive full mode is bounded and distinct from quick mode', () => {
  assert.equal(probe.NETWORK_PROBE_ENDPOINTS.quick.url,'https://speed.cloudflare.com');
  assert.equal(probe.NETWORK_PROBE_ENDPOINTS.quick.methodVersion,probe.NETWORK_METHOD_VERSION);
  assert.equal(probe.NETWORK_PROBE_ENDPOINTS.quick.maximumTotalBytes,probe.DOWNLOAD_BYTES + probe.UPLOAD_BYTES);
  assert.equal(probe.NETWORK_PROBE_ENDPOINTS.quick.requests,22);
  assert.equal(probe.NETWORK_PROBE_ENDPOINTS.full.maximumTotalBytes,probe.FULL_TOTAL_MAX_BYTES);
  assert.ok(probe.FULL_TOTAL_MAX_BYTES < 200 * 1024 * 1024);
  assert.equal(probe.NETWORK_PROBE_ENDPOINTS.quick.maximumParallelConnections,6);
  assert.equal(probe.NETWORK_PROBE_ENDPOINTS.full.maximumParallelConnections,9);
  assert.deepEqual(probe.transferConfiguration('full','download',600),{bytes:80*1024*1024,connections:4});
  assert.deepEqual(probe.transferConfiguration('full','upload',50),{bytes:8*1024*1024,connections:1});
  assert.match(probe.REQUEST_PLAN.download.url,/__down\?bytes=4194304$/);
  assert.match(probe.REQUEST_PLAN.upload.url,/__up\?bytes=524288$/);
});

test('cancellation preserves fixed sample counts and does not invent loaded evidence', async () => {
  const controller = new AbortController();
  let calls = 0;
  const result = await probe.runNetworkQualityProbe({
    signal:controller.signal,
    resolveAddresses:async () => [{address:'1.1.1.1',family:4}],
    measureRequest:async () => { calls += 1; controller.abort(); return {success:true,responseWaitMs:5,durationMs:5,completedAtMs:5}; },
  });
  assert.equal(result.status,'CANCELED');
  assert.equal(result.idleSamples.length,probe.IDLE_SAMPLE_COUNT);
  assert.equal(result.downloadLoadedSamples.length,probe.LOADED_SAMPLE_COUNT);
  assert.equal(result.uploadLoadedSamples.length,probe.LOADED_SAMPLE_COUNT);
  assert.equal(result.quality,'INSUFFICIENT');
  assert.equal(calls,1);
});

test('history migrates v1 entries as legacy, writes v2 atomically, and segregates method evidence', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'dialed-network-history-'));
  fs.writeFileSync(probe.networkHistoryPath(directory), JSON.stringify({schemaVersion:'1.0.0',entries:[{id:'legacy',completedAt:'2026-09-05T00:00:00Z',status:'COMPLETE',endpointId:'cloudflare-bounded-quality-v1',metrics:{idleLatencyMs:12,idleJitterMs:2,lossPercent:0,loadedLatencyMs:28,loadedLatencyIncreaseMs:16,downloadMbps:100,uploadMbps:20}}]}));
  const migrated = probe.readNetworkQualityHistory(directory);
  assert.equal(migrated.status,'READY');
  assert.equal(migrated.entries[0].methodVersion,'legacy-v1');
  assert.equal(migrated.entries[0].quality,'LEGACY');

  const result = {status:'COMPLETE',completedAt:'2026-09-06T12:00:00Z',endpoint:probe.NETWORK_PROBE_ENDPOINTS.quick,methodVersion:probe.NETWORK_METHOD_VERSION,mode:'quick',quality:'SUFFICIENT',runConditions:{downloadBytes:probe.DOWNLOAD_BYTES,uploadBytes:probe.UPLOAD_BYTES,maximumTotalBytes:probe.DOWNLOAD_BYTES+probe.UPLOAD_BYTES,maximumParallelConnections:1},metrics:{idleLatencyMs:10,idleJitterMs:1,idleP90Ms:12,idleVariabilityMs:3,requestFailurePercent:0,downloadLoadedLatencyMs:18,downloadLoadedLatencyIncreaseMs:8,uploadLoadedLatencyMs:20,uploadLoadedLatencyIncreaseMs:10,downloadMbps:90,uploadMbps:18}};
  const state = probe.appendNetworkQualityHistory(directory,result);
  assert.equal(state.entries[0].methodVersion,probe.NETWORK_METHOD_VERSION);
  assert.equal(state.entries[1].methodVersion,'legacy-v1');
  assert.equal(probe.readNetworkQualityHistory(directory).entries[1].methodVersion,'legacy-v1');
  const raw = fs.readFileSync(probe.networkHistoryPath(directory),'utf8');
  assert.match(raw,/"schemaVersion": "2\.0\.0"/);
  assert.doesNotMatch(raw,/samples|1\.1\.1\.1|body/);
  fs.writeFileSync(probe.networkHistoryPath(directory),'{bad json','utf8');
  assert.equal(probe.readNetworkQualityHistory(directory).status,'CORRUPT');
  assert.throws(() => probe.appendNetworkQualityHistory(directory,result),/was not changed/);
});

test('IPC keeps endpoint details main-owned and validates only quick or full renderer mode', () => {
  const root = path.join(__dirname,'..');
  const mainSource = fs.readFileSync(path.join(root,'electron','main.cjs'),'utf8');
  const preloadSource = fs.readFileSync(path.join(root,'electron','preload.cjs'),'utf8');
  const componentSource = fs.readFileSync(path.join(root,'src','components','NetworkQualityLab.tsx'),'utf8');
  assert.match(mainSource,/\['quick', 'full'\]\.includes\(mode\)/);
  assert.match(mainSource,/mode: pending\.preview\.mode/);
  assert.match(mainSource,/activeNetworkProbeProgress = value/);
  assert.match(preloadSource,/previewNetworkQualityProbe: \(mode\)/);
  assert.match(preloadSource,/getNetworkProbeProgress/);
  assert.doesNotMatch(preloadSource,/cloudflare|https:|sampleCount|timeout/i);
  assert.match(componentSource,/previewNetworkQualityProbe\(probeMode\)/);
  assert.match(componentSource,/This is not packet loss/);
  assert.match(componentSource,/Start full speed test/);
});
