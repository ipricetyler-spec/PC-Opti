const crypto = require('crypto');
const dns = require('dns');
const fs = require('fs');
const https = require('https');
const net = require('net');
const path = require('path');
const { performance } = require('perf_hooks');

const IDLE_SAMPLE_COUNT = 9;
const LOADED_SAMPLE_COUNT = 5;
const SAMPLE_COUNT = IDLE_SAMPLE_COUNT;
const DOWNLOAD_BYTES = 4 * 1024 * 1024;
const UPLOAD_BYTES = 512 * 1024;
const FULL_DOWNLOAD_MAX_BYTES = 81 * 1024 * 1024;
const FULL_UPLOAD_MAX_BYTES = Math.floor(40.5 * 1024 * 1024);
const FULL_TOTAL_MAX_BYTES = FULL_DOWNLOAD_MAX_BYTES + FULL_UPLOAD_MAX_BYTES;
const FULL_MAX_CONNECTIONS = 4;
const MIN_LOADED_OVERLAP_SAMPLES = 3;
const MIN_STEADY_DURATION_MS = 750;
const SAMPLE_TIMEOUT_MS = 5000;
const TRANSFER_TIMEOUT_MS = 20000;
const OVERALL_TIMEOUT_MS = 60000;
const MAX_RESPONSE_BYTES = 80 * 1024 * 1024 + (16 * 1024);
const MAX_HISTORY_ENTRIES = 20;
const MAX_HISTORY_BYTES = 256 * 1024;
const NETWORK_HISTORY_SCHEMA_VERSION = '2.0.0';
const LEGACY_HISTORY_SCHEMA_VERSION = '1.0.0';
const NETWORK_METHOD_VERSION = 'warmed-https-v2';

const endpoint = (mode, values) => Object.freeze({
  mode,
  methodVersion: NETWORK_METHOD_VERSION,
  url: 'https://speed.cloudflare.com',
  idleRequests: IDLE_SAMPLE_COUNT,
  loadedRequestsPerDirection: LOADED_SAMPLE_COUNT,
  maximumDurationSeconds: 60,
  ...values,
});

const NETWORK_PROBE_ENDPOINTS = Object.freeze({
  quick: endpoint('quick', {
    id: 'cloudflare-warmed-http-v2-quick',
    title: 'Quick connection check',
    requests: 3 + IDLE_SAMPLE_COUNT + (2 * LOADED_SAMPLE_COUNT),
    maximumDownloadBytes: DOWNLOAD_BYTES,
    maximumUploadBytes: UPLOAD_BYTES,
    maximumTotalBytes: DOWNLOAD_BYTES + UPLOAD_BYTES,
    maximumParallelConnections: 6,
    privacy: 'One user-started quick check sends warmed HTTPS requests to speed.cloudflare.com, downloads at most 4 MiB, and uploads at most 512 KiB of zero bytes. Cloudflare receives the public IP address and ordinary HTTPS request metadata. Dialed sends no hardware inventory, account data, filenames, or Windows configuration.',
  }),
  full: endpoint('full', {
    id: 'cloudflare-warmed-http-v2-full',
    title: 'Bounded full-speed test',
    requests: 30,
    maximumDownloadBytes: FULL_DOWNLOAD_MAX_BYTES,
    maximumUploadBytes: FULL_UPLOAD_MAX_BYTES,
    maximumTotalBytes: FULL_TOTAL_MAX_BYTES,
    maximumParallelConnections: FULL_MAX_CONNECTIONS + LOADED_SAMPLE_COUNT,
    privacy: 'One user-started full-speed test uses adaptive payloads and up to nine concurrent warmed HTTPS requests to speed.cloudflare.com, including at most four transfer connections. It downloads at most 81 MiB and uploads at most 40.5 MiB of zero bytes (121.5 MiB total). Cloudflare receives the public IP address and ordinary HTTPS request metadata. Dialed sends no hardware inventory, account data, filenames, or Windows configuration.',
  }),
});
const NETWORK_PROBE_ENDPOINT = NETWORK_PROBE_ENDPOINTS.quick;

function ipv4ToInteger(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

function inIpv4Range(value, base, prefix) {
  const baseValue = ipv4ToInteger(base);
  if (value === null || baseValue === null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (baseValue & mask);
}

function isPublicIpAddress(address) {
  const version = net.isIP(address);
  if (version === 4) {
    const value = ipv4ToInteger(address);
    const blocked = [
      ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
      ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
      ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
      ['224.0.0.0', 4], ['240.0.0.0', 4],
    ];
    return !blocked.some(([base, prefix]) => inIpv4Range(value, base, prefix));
  }
  if (version === 6) {
    const normalized = address.toLowerCase().split('%')[0];
    if (normalized === '::' || normalized === '::1') return false;
    if (normalized.startsWith('fc') || normalized.startsWith('fd') || /^fe[89ab]/.test(normalized) || normalized.startsWith('ff')) return false;
    if (normalized.startsWith('2001:db8:')) return false;
    if (normalized.startsWith('::ffff:')) return isPublicIpAddress(normalized.slice(7));
    return true;
  }
  return false;
}

const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
function percentile(values, quantile) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const position = (ordered.length - 1) * quantile;
  const lower = Math.floor(position);
  const fraction = position - lower;
  return ordered[lower + 1] === undefined ? ordered[lower] : ordered[lower] + fraction * (ordered[lower + 1] - ordered[lower]);
}

function sampleTiming(sample) {
  return Number.isFinite(sample.responseWaitMs) ? sample.responseWaitMs : sample.durationMs;
}

function computeProbeMetrics(samples, expectedCount = IDLE_SAMPLE_COUNT) {
  const successful = samples.filter((sample) => sample.success && Number.isFinite(sampleTiming(sample))).map(sampleTiming);
  const differences = successful.slice(1).map((value, index) => Math.abs(value - successful[index]));
  const p10Ms = percentile(successful, 0.1);
  const p90Ms = percentile(successful, 0.9);
  return {
    latencyMs: percentile(successful, 0.5), medianMs: percentile(successful, 0.5), p10Ms, p90Ms,
    variabilityMs: p10Ms === null || p90Ms === null ? null : p90Ms - p10Ms,
    jitterMs: differences.length ? average(differences) : null,
    requestFailurePercent: ((expectedCount - successful.length) / expectedCount) * 100,
    successfulSamples: successful.length, failedSamples: expectedCount - successful.length, expectedSamples: expectedCount,
  };
}

function throughputMbps(bytes, durationMs) {
  if (!Number.isFinite(bytes) || bytes <= 0 || !Number.isFinite(durationMs) || durationMs <= 0) return null;
  return (bytes * 8) / (durationMs * 1000);
}

async function resolvePublicAddresses(hostname, resolver = dns.promises.lookup) {
  const records = await resolver(hostname, { all: true, verbatim: true });
  const addresses = records.map((record) => ({ address: String(record.address || ''), family: net.isIP(String(record.address || '')) }));
  if (!addresses.length) throw new Error('The probe hostname did not resolve to an address.');
  if (addresses.some((record) => !isPublicIpAddress(record.address))) throw new Error('The probe hostname resolved to a private, local, reserved, or invalid address. The request was blocked.');
  return addresses;
}

function createPinnedLookup(record) {
  const address = String(record?.address || '');
  const family = net.isIP(address);
  if (!isPublicIpAddress(address) || family === 0) throw new Error('The selected probe address is no longer a valid public IP address.');
  return (_hostname, options, callback) => {
    const lookupOptions = options && typeof options === 'object' ? options : {};
    const done = typeof options === 'function' ? options : callback;
    if (typeof done !== 'function') throw new Error('The HTTPS lookup callback is unavailable.');
    if (lookupOptions.all) done(null, [{ address, family }]); else done(null, address, family);
  };
}

function requestPlan(direction, bytes = 0, label = direction) {
  const upload = direction === 'upload';
  return { label, direction, url: upload ? `https://speed.cloudflare.com/__up?bytes=${bytes}` : `https://speed.cloudflare.com/__down?bytes=${bytes}`,
    method: upload ? 'POST' : 'GET', responseLimit: upload ? 16 * 1024 : bytes + (16 * 1024), requestBytes: upload ? bytes : 0 };
}

const REQUEST_PLAN = Object.freeze({
  warmup: Object.freeze(requestPlan('download', 0, 'Connection warmup')),
  idle: Object.freeze(requestPlan('download', 0, 'Warmed response timing')),
  loadedDownload: Object.freeze(requestPlan('download', 0, 'Response timing during download')),
  loadedUpload: Object.freeze(requestPlan('download', 0, 'Response timing during upload')),
  download: Object.freeze(requestPlan('download', DOWNLOAD_BYTES, 'Quick download')),
  upload: Object.freeze(requestPlan('upload', UPLOAD_BYTES, 'Quick upload')),
});

function measureHttpsRequest(plan, addresses, signal, dependencies = {}) {
  const request = dependencies.httpsRequest || https.request;
  const now = dependencies.now || (() => performance.now());
  const timeoutMs = plan.requestBytes > 0 || plan.responseLimit > 16 * 1024 ? TRANSFER_TIMEOUT_MS : SAMPLE_TIMEOUT_MS;
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve({ success: false, durationMs: null, responseWaitMs: null, error: 'Canceled.' });
    const url = new URL(plan.url);
    const address = addresses[Math.floor(Math.random() * addresses.length)];
    const createdAtMs = now();
    let connectionReadyAtMs = null;
    let responseStartedAtMs = null;
    let transferStartedAtMs = null;
    let responseBytes = 0;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      const completedAtMs = now();
      resolve({ ...result, createdAtMs, connectionReadyAtMs, responseStartedAtMs, transferStartedAtMs, completedAtMs,
        setupMs: connectionReadyAtMs === null ? null : Math.max(0, connectionReadyAtMs - createdAtMs),
        responseWaitMs: connectionReadyAtMs === null || responseStartedAtMs === null ? null : Math.max(0, responseStartedAtMs - connectionReadyAtMs),
        transferMs: transferStartedAtMs === null ? null : Math.max(0, completedAtMs - transferStartedAtMs), durationMs: Math.max(0, completedAtMs - createdAtMs) });
    };
    const req = request({ protocol: 'https:', hostname: url.hostname, port: 443, path: `${url.pathname}${url.search}`, method: plan.method,
      headers: { Accept: 'application/octet-stream', 'Content-Type': 'application/octet-stream', 'Content-Length': String(plan.requestBytes), 'User-Agent': 'Dialed-Network-Probe/2.0' },
      servername: url.hostname, family: address.family, autoSelectFamily: false, lookup: createPinnedLookup(address), timeout: timeoutMs, signal, agent: dependencies.agent }, (response) => {
      responseStartedAtMs = now();
      response.on('data', (chunk) => {
        if (transferStartedAtMs === null && chunk.length > 0) { transferStartedAtMs = now(); dependencies.onTransferStart?.(transferStartedAtMs); }
        responseBytes += chunk.length;
        if (responseBytes > plan.responseLimit) req.destroy(new Error('Probe response exceeded the bounded size limit.'));
      });
      response.on('end', () => {
        const statusCode = Number(response.statusCode || 0);
        if (statusCode < 200 || statusCode >= 300) finish({ success: false, responseBytes, requestBytes: plan.requestBytes, error: `HTTPS status ${statusCode}.` });
        else finish({ success: true, statusCode, responseBytes, requestBytes: plan.requestBytes });
      });
    });
    req.on('socket', (socket) => {
      const ready = () => {
        if (connectionReadyAtMs !== null) return;
        connectionReadyAtMs = now();
        if (plan.direction === 'upload' && plan.requestBytes > 0) { transferStartedAtMs = connectionReadyAtMs; dependencies.onTransferStart?.(transferStartedAtMs); }
      };
      if (socket.connecting) socket.once('secureConnect', ready); else ready();
    });
    req.on('timeout', () => req.destroy(new Error('Sample timed out.')));
    req.on('error', (error) => finish({ success: false, responseBytes, requestBytes: plan.requestBytes, error: signal?.aborted ? 'Canceled.' : error.message }));
    if (plan.requestBytes > 0) req.write(Buffer.alloc(plan.requestBytes));
    req.end();
  });
}

function measureHttpsSample(endpointValue, addresses, signal, dependencies = {}) {
  const url = endpointValue?.url?.includes('/__') ? endpointValue.url : REQUEST_PLAN.idle.url;
  return measureHttpsRequest({ ...REQUEST_PLAN.idle, url }, addresses, signal, dependencies);
}

async function safeMeasure(measure, label) {
  try { return await measure(); } catch (error) { return { success: false, durationMs: null, responseWaitMs: null, error: error instanceof Error ? error.message : `${label} failed.` }; }
}
function canceledSample(index, error = 'Canceled before sample started.') { return { index, success: false, durationMs: null, responseWaitMs: null, error }; }

function transferConfiguration(mode, direction, preliminaryMbps) {
  if (mode === 'quick') return { bytes: direction === 'download' ? DOWNLOAD_BYTES : UPLOAD_BYTES, connections: 1 };
  const high = Number.isFinite(preliminaryMbps) && preliminaryMbps >= 500;
  const medium = Number.isFinite(preliminaryMbps) && preliminaryMbps >= 100;
  if (direction === 'download') return high ? { bytes: 80 * 1024 * 1024, connections: 4 } : medium ? { bytes: 32 * 1024 * 1024, connections: 2 } : { bytes: 16 * 1024 * 1024, connections: 1 };
  return high ? { bytes: 40 * 1024 * 1024, connections: 4 } : medium ? { bytes: 16 * 1024 * 1024, connections: 2 } : { bytes: 8 * 1024 * 1024, connections: 1 };
}

async function measureTransferRound(direction, totalBytes, connections, endpointValue, addresses, signal, dependencies = {}, hooks = {}) {
  const measure = dependencies.measureRequest || ((plan, records, requestSignal, options) => measureHttpsRequest(plan, records, requestSignal, { ...dependencies, ...options }));
  const count = Math.max(1, Math.min(FULL_MAX_CONNECTIONS, connections));
  const base = Math.floor(totalBytes / count);
  const startedAtMs = (dependencies.now || (() => performance.now()))();
  let activityStartedAtMs = null;
  const members = await Promise.all(Array.from({ length: count }, (_, index) => {
    const bytes = index === count - 1 ? totalBytes - (base * index) : base;
    return safeMeasure(() => measure(requestPlan(direction, bytes, `${direction} transfer ${index + 1}`), addresses, signal, { agent: dependencies.agent,
      onTransferStart: (at) => { if (activityStartedAtMs === null || at < activityStartedAtMs) activityStartedAtMs = at; hooks.onTransferStart?.(activityStartedAtMs); } }), `${direction} transfer ${index + 1}`);
  }));
  const fallbackNow = dependencies.now || (() => performance.now());
  const completedAtMs = Math.max(...members.map((item) => Number.isFinite(item.completedAtMs) ? item.completedAtMs : fallbackNow()));
  const success = members.every((item) => item.success);
  const responseBytes = members.reduce((sum, item) => sum + (Number(item.responseBytes) || 0), 0);
  const requestBytes = members.reduce((sum, item) => sum + (Number(item.requestBytes) || 0), 0);
  const measurementDurationMs = activityStartedAtMs === null ? null : Math.max(0, completedAtMs - activityStartedAtMs);
  return { success, durationMs: Math.max(0, completedAtMs - startedAtMs), measurementDurationMs, responseBytes, requestBytes,
    transferStartedAtMs: activityStartedAtMs, completedAtMs, connections: count, members,
    error: success ? undefined : members.find((item) => item.error)?.error || `${direction} transfer did not complete.`,
    mbps: success ? throughputMbps(direction === 'download' ? responseBytes : requestBytes, measurementDurationMs) : null };
}

async function runLoadedPhase({ direction, transfer, latency, count, signal, now = () => performance.now() }) {
  let announceStart;
  const started = new Promise((resolve) => { announceStart = resolve; });
  let transferSettled = false;
  let transferResult;
  const transferPromise = safeMeasure(() => transfer({ onTransferStart: (at) => announceStart({ at }) }), `${direction} transfer`).then((result) => { transferSettled = true; transferResult = result; return result; });
  const startState = await Promise.race([started, transferPromise.then(() => null)]);
  let samples = [];
  if (startState && !signal?.aborted && !transferSettled) {
    samples = await Promise.all(Array.from({ length: count }, async (_, index) => {
      const startedAtMs = now();
      const result = await safeMeasure(() => latency(index), `${direction} loaded response ${index + 1}`);
      const completedAtMs = Number.isFinite(result.completedAtMs) ? result.completedAtMs : now();
      return { index: index + 1, startedAtMs, completedAtMs, ...result };
    }));
  }
  while (samples.length < count) samples.push(canceledSample(samples.length + 1, signal?.aborted ? 'Canceled before loaded sample started.' : 'Transfer load ended before a loaded response sample could start.'));
  const completedTransfer = transferResult || await transferPromise;
  const marked = samples.map((sample) => ({ ...sample, overlappedTransfer: Boolean(sample.success && Number.isFinite(completedTransfer.transferStartedAtMs) && Number.isFinite(completedTransfer.completedAtMs) && sample.startedAtMs >= completedTransfer.transferStartedAtMs && sample.completedAtMs <= completedTransfer.completedAtMs) }));
  const overlappingSuccessfulSamples = marked.filter((sample) => sample.overlappedTransfer).length;
  const durationSufficient = Number.isFinite(completedTransfer.measurementDurationMs) && completedTransfer.measurementDurationMs >= MIN_STEADY_DURATION_MS;
  return { transfer: completedTransfer, samples: marked, quality: { status: completedTransfer.success && overlappingSuccessfulSamples >= MIN_LOADED_OVERLAP_SAMPLES && durationSufficient ? 'SUFFICIENT' : 'INSUFFICIENT', overlappingSuccessfulSamples, requiredOverlappingSamples: MIN_LOADED_OVERLAP_SAMPLES, transferDurationMs: completedTransfer.measurementDurationMs ?? null, minimumTransferDurationMs: MIN_STEADY_DURATION_MS } };
}

async function runNetworkQualityProbe(dependencies = {}) {
  const mode = dependencies.mode === 'full' ? 'full' : 'quick';
  const endpointValue = NETWORK_PROBE_ENDPOINTS[mode];
  const signal = dependencies.signal;
  const now = dependencies.now || (() => performance.now());
  const resolveAddresses = dependencies.resolveAddresses || ((hostname) => resolvePublicAddresses(hostname));
  const agent = dependencies.agent || new https.Agent({ keepAlive: true, maxSockets: endpointValue.maximumParallelConnections, maxFreeSockets: endpointValue.maximumParallelConnections });
  const measureRequest = dependencies.measureRequest || ((plan, addresses, sampleSignal, options = {}) => measureHttpsRequest(plan, addresses, sampleSignal, { agent, ...options }));
  const progress = dependencies.onProgress || (() => {});
  const startedAt = new Date().toISOString();
  const overallController = new AbortController();
  let timedOut = false;
  const abort = () => overallController.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => { timedOut = true; abort(); }, OVERALL_TIMEOUT_MS);
  const report = (phase, completedSteps, message, bytesTransferred = 0) => progress({ phase, completedSteps, totalSteps: 6, message, bytesTransferred, maximumTotalBytes: endpointValue.maximumTotalBytes });
  try {
    report('RESOLVING', 0, 'Validating the fixed Cloudflare destination.');
    const addresses = await resolveAddresses(new URL(endpointValue.url).hostname);
    report('WARMUP', 1, 'Separating connection and TLS setup from warmed HTTPS response timing.');
    const warmup = await safeMeasure(() => measureRequest(REQUEST_PLAN.warmup, addresses, overallController.signal, { agent }), 'Connection warmup');
    report('IDLE', 2, 'Collecting warmed HTTPS time-to-first-byte samples.');
    const idleSamples = [];
    for (let index = 0; index < IDLE_SAMPLE_COUNT && !overallController.signal.aborted; index += 1) idleSamples.push({ index: index + 1, ...await safeMeasure(() => measureRequest(REQUEST_PLAN.idle, addresses, overallController.signal, { agent }), 'Idle response sample') });
    while (idleSamples.length < IDLE_SAMPLE_COUNT) idleSamples.push(canceledSample(idleSamples.length + 1));
    let preliminaryDownload = null;
    let preliminaryUpload = null;
    if (mode === 'full' && !overallController.signal.aborted) {
      report('ADAPTING', 3, 'Running preliminary transfers to choose bounded payloads and connection count.');
      preliminaryDownload = await measureTransferRound('download', 1024 * 1024, 1, endpointValue, addresses, overallController.signal, { ...dependencies, agent, measureRequest, now });
      preliminaryUpload = await measureTransferRound('upload', 512 * 1024, 1, endpointValue, addresses, overallController.signal, { ...dependencies, agent, measureRequest, now });
    }
    const downloadConfig = transferConfiguration(mode, 'download', preliminaryDownload?.mbps);
    const uploadConfig = transferConfiguration(mode, 'upload', preliminaryUpload?.mbps);
    const latency = (index) => measureRequest({ ...REQUEST_PLAN.idle, label: `Loaded response ${index + 1}` }, addresses, overallController.signal, { agent });
    report('DOWNLOAD', 4, 'Measuring download and verifying response samples overlap active transfer.');
    const unavailable = (direction, bytes) => ({ transfer: { success: false, durationMs: null, measurementDurationMs: null, responseBytes: 0, requestBytes: direction === 'upload' ? bytes : 0, error: `Canceled before ${direction} started.` }, samples: Array.from({ length: LOADED_SAMPLE_COUNT }, (_, index) => canceledSample(index + 1)), quality: { status: 'INSUFFICIENT', overlappingSuccessfulSamples: 0, requiredOverlappingSamples: MIN_LOADED_OVERLAP_SAMPLES, transferDurationMs: null, minimumTransferDurationMs: MIN_STEADY_DURATION_MS } });
    const downloadPhase = overallController.signal.aborted ? unavailable('download', downloadConfig.bytes) : await runLoadedPhase({ direction: 'download', count: LOADED_SAMPLE_COUNT, signal: overallController.signal, now, transfer: (hooks) => measureTransferRound('download', downloadConfig.bytes, downloadConfig.connections, endpointValue, addresses, overallController.signal, { ...dependencies, agent, measureRequest, now }, hooks), latency });
    report('UPLOAD', 5, 'Measuring upload and verifying response samples overlap active transfer.', (preliminaryDownload?.responseBytes || 0) + (downloadPhase.transfer.responseBytes || 0));
    const uploadPhase = overallController.signal.aborted ? unavailable('upload', uploadConfig.bytes) : await runLoadedPhase({ direction: 'upload', count: LOADED_SAMPLE_COUNT, signal: overallController.signal, now, transfer: (hooks) => measureTransferRound('upload', uploadConfig.bytes, uploadConfig.connections, endpointValue, addresses, overallController.signal, { ...dependencies, agent, measureRequest, now }, hooks), latency });
    const idle = computeProbeMetrics(idleSamples);
    const downLoaded = computeProbeMetrics(downloadPhase.samples.filter((sample) => sample.overlappedTransfer), LOADED_SAMPLE_COUNT);
    const upLoaded = computeProbeMetrics(uploadPhase.samples.filter((sample) => sample.overlappedTransfer), LOADED_SAMPLE_COUNT);
    const increase = (loaded) => idle.medianMs === null || loaded.medianMs === null ? null : loaded.medianMs - idle.medianMs;
    const quality = downloadPhase.quality.status === 'SUFFICIENT' && uploadPhase.quality.status === 'SUFFICIENT' ? 'SUFFICIENT' : 'INSUFFICIENT';
    const metrics = { latencyMs: idle.medianMs, jitterMs: idle.jitterMs, idleLatencyMs: idle.medianMs, idleJitterMs: idle.jitterMs, idleP10Ms: idle.p10Ms, idleP90Ms: idle.p90Ms, idleVariabilityMs: idle.variabilityMs,
      downloadLoadedLatencyMs: downLoaded.medianMs, downloadLoadedP90Ms: downLoaded.p90Ms, downloadLoadedLatencyIncreaseMs: increase(downLoaded), uploadLoadedLatencyMs: upLoaded.medianMs, uploadLoadedP90Ms: upLoaded.p90Ms, uploadLoadedLatencyIncreaseMs: increase(upLoaded),
      loadedLatencyMs: downLoaded.medianMs, loadedJitterMs: downLoaded.jitterMs, loadedLatencyIncreaseMs: increase(downLoaded), downloadMbps: downloadPhase.transfer.success ? downloadPhase.transfer.mbps : null, uploadMbps: uploadPhase.transfer.success ? uploadPhase.transfer.mbps : null,
      requestFailurePercent: idle.requestFailurePercent, successfulSamples: idle.successfulSamples, failedSamples: idle.failedSamples, expectedSamples: idle.expectedSamples };
    const canceled = overallController.signal.aborted;
    const anySuccess = idle.successfulSamples > 0 || downloadPhase.transfer.success || uploadPhase.transfer.success;
    const complete = warmup.success && idle.successfulSamples === IDLE_SAMPLE_COUNT && downloadPhase.transfer.success && uploadPhase.transfer.success && quality === 'SUFFICIENT';
    const status = canceled ? 'CANCELED' : complete ? 'COMPLETE' : anySuccess ? 'PARTIAL' : 'OFFLINE';
    const downloadBytes = (preliminaryDownload?.responseBytes || 0) + (downloadPhase.transfer.responseBytes || 0);
    const uploadBytes = (preliminaryUpload?.requestBytes || 0) + (uploadPhase.transfer.requestBytes || 0);
    report('COMPLETE', 6, status === 'COMPLETE' ? 'Measurement complete.' : 'Measurement ended with incomplete evidence.', downloadBytes + uploadBytes);
    return { status, endpoint: endpointValue, methodVersion: NETWORK_METHOD_VERSION, mode, quality, startedAt, completedAt: new Date().toISOString(), warmup,
      samples: idleSamples, idleSamples, loadedSamples: downloadPhase.samples, downloadLoadedSamples: downloadPhase.samples, uploadLoadedSamples: uploadPhase.samples,
      download: downloadPhase.transfer, upload: uploadPhase.transfer, preliminaryDownload, preliminaryUpload, loadQuality: { download: downloadPhase.quality, upload: uploadPhase.quality }, metrics,
      limitations: timedOut ? 'The fixed 60-second overall limit stopped this test. Partial values may not represent the connection.' : quality === 'INSUFFICIENT' ? 'The achieved HTTPS transfer samples completed, but one or both loaded-response phases lacked the required steady duration or verified overlap. Loaded values are unavailable rather than inferred. This is not ICMP ping, packet loss, game-server latency, route diagnosis, or proof that a Windows setting should change.' : 'This versioned method reports warmed HTTPS time to first byte, not ICMP ping. Throughput is an achieved bounded Cloudflare transfer sample, not guaranteed line rate. Request failures are not packet loss. Results do not diagnose a game route, DNS, or a Windows setting.',
      runConditions: { mode, methodVersion: NETWORK_METHOD_VERSION, downloadBytes, uploadBytes, maximumTotalBytes: endpointValue.maximumTotalBytes, maximumParallelConnections: endpointValue.maximumParallelConnections } };
  } finally {
    clearTimeout(timeout); signal?.removeEventListener('abort', abort); if (!dependencies.agent) agent.destroy();
  }
}

function networkHistoryPath(userDataPath) { return path.join(userDataPath, 'network-quality-history.json'); }
function finiteOrNull(value, label, minimum = 0) {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < minimum) throw new Error(`${label} is invalid.`);
  return value;
}

function normalizeHistoryEntry(entry, index, legacy = false) {
  if (!entry || typeof entry !== 'object') throw new Error(`Network history entry ${index + 1} is invalid.`);
  const id = String(entry.id || '');
  if (!/^[0-9a-z_-]{1,100}$/i.test(id)) throw new Error(`Network history entry ${index + 1} has an invalid id.`);
  const completedAt = new Date(String(entry.completedAt || ''));
  if (!Number.isFinite(completedAt.getTime())) throw new Error(`Network history entry ${index + 1} has an invalid timestamp.`);
  if (!['COMPLETE', 'PARTIAL', 'OFFLINE'].includes(entry.status)) throw new Error(`Network history entry ${index + 1} has an invalid status.`);
  const methodVersion = legacy ? 'legacy-v1' : String(entry.methodVersion || '');
  const mode = legacy ? 'legacy' : String(entry.mode || '');
  if (!legacy && (methodVersion !== NETWORK_METHOD_VERSION || !['quick', 'full'].includes(mode))) throw new Error(`Network history entry ${index + 1} has an unsupported method.`);
  return { id, completedAt: completedAt.toISOString(), status: entry.status, endpointId: String(entry.endpointId || '').slice(0, 80), methodVersion, mode, quality: legacy ? 'LEGACY' : entry.quality === 'SUFFICIENT' ? 'SUFFICIENT' : 'INSUFFICIENT',
    runConditions: legacy ? undefined : { downloadBytes: finiteOrNull(entry.runConditions?.downloadBytes, 'Stored download bytes'), uploadBytes: finiteOrNull(entry.runConditions?.uploadBytes, 'Stored upload bytes'), maximumTotalBytes: finiteOrNull(entry.runConditions?.maximumTotalBytes, 'Stored traffic limit'), maximumParallelConnections: finiteOrNull(entry.runConditions?.maximumParallelConnections, 'Stored parallel connection count') },
    metrics: { idleLatencyMs: finiteOrNull(entry.metrics?.idleLatencyMs, 'Stored idle response timing'), idleJitterMs: finiteOrNull(entry.metrics?.idleJitterMs, 'Stored idle jitter'), idleP90Ms: finiteOrNull(entry.metrics?.idleP90Ms, 'Stored idle p90'), idleVariabilityMs: finiteOrNull(entry.metrics?.idleVariabilityMs, 'Stored idle variability'), requestFailurePercent: finiteOrNull(entry.metrics?.requestFailurePercent ?? entry.metrics?.lossPercent, 'Stored request failure percentage'),
      downloadLoadedLatencyMs: finiteOrNull(entry.metrics?.downloadLoadedLatencyMs ?? entry.metrics?.loadedLatencyMs, 'Stored download-loaded response timing'), downloadLoadedLatencyIncreaseMs: finiteOrNull(entry.metrics?.downloadLoadedLatencyIncreaseMs ?? entry.metrics?.loadedLatencyIncreaseMs, 'Stored download-loaded increase', -100000), uploadLoadedLatencyMs: finiteOrNull(entry.metrics?.uploadLoadedLatencyMs, 'Stored upload-loaded response timing'), uploadLoadedLatencyIncreaseMs: finiteOrNull(entry.metrics?.uploadLoadedLatencyIncreaseMs, 'Stored upload-loaded increase', -100000), downloadMbps: finiteOrNull(entry.metrics?.downloadMbps, 'Stored download throughput'), uploadMbps: finiteOrNull(entry.metrics?.uploadMbps, 'Stored upload throughput') } };
}

function readNetworkQualityHistory(userDataPath, fileSystem = fs) {
  const target = networkHistoryPath(userDataPath);
  if (!fileSystem.existsSync(target)) return { status: 'READY', entries: [] };
  try {
    const stat = fileSystem.statSync(target);
    if (!stat.isFile() || stat.size > MAX_HISTORY_BYTES) throw new Error('The local network history file is not a supported regular file.');
    const parsed = JSON.parse(fileSystem.readFileSync(target, 'utf8'));
    const legacy = parsed?.schemaVersion === LEGACY_HISTORY_SCHEMA_VERSION;
    if (!parsed || (!legacy && parsed.schemaVersion !== NETWORK_HISTORY_SCHEMA_VERSION) || !Array.isArray(parsed.entries) || parsed.entries.length > MAX_HISTORY_ENTRIES) throw new Error('The local network history schema is not valid.');
    return { status: 'READY', entries: parsed.entries.map((entry, index) => normalizeHistoryEntry(entry, index, legacy || entry?.methodVersion === 'legacy-v1')) };
  } catch (error) { return { status: 'CORRUPT', entries: [], error: error instanceof Error ? error.message : 'The local network history could not be read.' }; }
}

function writeNetworkQualityHistory(userDataPath, entries, fileSystem = fs) {
  if (!Array.isArray(entries) || entries.length > MAX_HISTORY_ENTRIES) throw new Error('The local network history count is invalid.');
  fileSystem.mkdirSync(userDataPath, { recursive: true });
  const target = networkHistoryPath(userDataPath);
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  const payload = `${JSON.stringify({ schemaVersion: NETWORK_HISTORY_SCHEMA_VERSION, updatedAt: new Date().toISOString(), entries }, null, 2)}\n`;
  if (Buffer.byteLength(payload, 'utf8') > MAX_HISTORY_BYTES) throw new Error('The local network history would exceed its size limit.');
  try { fileSystem.writeFileSync(temporary, payload, { encoding: 'utf8', flag: 'wx' }); fileSystem.renameSync(temporary, target); }
  finally { if (fileSystem.existsSync(temporary)) fileSystem.unlinkSync(temporary); }
}

function appendNetworkQualityHistory(userDataPath, result, fileSystem = fs) {
  if (!result || result.status === 'CANCELED') throw new Error('Canceled network samples are not saved.');
  const current = readNetworkQualityHistory(userDataPath, fileSystem);
  if (current.status !== 'READY') throw new Error(`Local network history was not changed: ${current.error}`);
  const entry = normalizeHistoryEntry({ id: crypto.randomUUID(), completedAt: result.completedAt, status: result.status, endpointId: result.endpoint.id, methodVersion: result.methodVersion, mode: result.mode, quality: result.quality, runConditions: result.runConditions, metrics: result.metrics }, 0);
  const entries = [entry, ...current.entries].slice(0, MAX_HISTORY_ENTRIES);
  writeNetworkQualityHistory(userDataPath, entries, fileSystem);
  return { status: 'READY', entries };
}

module.exports = { DOWNLOAD_BYTES, FULL_DOWNLOAD_MAX_BYTES, FULL_MAX_CONNECTIONS, FULL_TOTAL_MAX_BYTES, FULL_UPLOAD_MAX_BYTES, IDLE_SAMPLE_COUNT, LEGACY_HISTORY_SCHEMA_VERSION, LOADED_SAMPLE_COUNT, MAX_HISTORY_ENTRIES, MAX_RESPONSE_BYTES, MIN_LOADED_OVERLAP_SAMPLES, MIN_STEADY_DURATION_MS, NETWORK_HISTORY_SCHEMA_VERSION, NETWORK_METHOD_VERSION, NETWORK_PROBE_ENDPOINT, NETWORK_PROBE_ENDPOINTS, OVERALL_TIMEOUT_MS, REQUEST_PLAN, SAMPLE_COUNT, SAMPLE_TIMEOUT_MS, TRANSFER_TIMEOUT_MS, UPLOAD_BYTES, appendNetworkQualityHistory, computeProbeMetrics, createPinnedLookup, isPublicIpAddress, measureHttpsRequest, measureHttpsSample, measureTransferRound, networkHistoryPath, percentile, readNetworkQualityHistory, resolvePublicAddresses, runLoadedPhase, runNetworkQualityProbe, throughputMbps, transferConfiguration, writeNetworkQualityHistory };
