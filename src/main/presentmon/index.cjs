const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { parseBenchmarkSource } = require('../benchmarks/index.cjs');
const { isFrameSummary, summarizeCapture } = require('./frame-summary.cjs');
const { ANTI_CHEAT_PROCESS_NAMES_BY_PRODUCT } = require('../scanner/index.cjs');
const { publicTelemetry, startTelemetrySession, validateTelemetrySeries } = require('../telemetry/index.cjs');
const { windowsPowerShellEnvironment } = require('../shared/windows-powershell-env.cjs');

const PRESENTMON_RELEASE = Object.freeze({
  version: '2.5.1',
  fileName: 'PresentMon-2.5.1-x64.exe',
  bytes: 956768,
  sha256: '9bec3083069f58f911e6a512f4806db51a27bd096103087bc1d05ef54c80a191',
  licenseFileName: 'LICENSE.txt',
  licenseSha256: '4c949341b1893c8c6ad82f7fb4eedf622cd1fd9c22a9af8f19b2dac19d1947b6',
  signerSubject: 'CN=Intel Corporation, O=Intel Corporation, S=California, C=US',
  sourceUrl: 'https://github.com/GameTechDev/PresentMon/releases/tag/v2.5.1',
});

const CAPTURE_DURATIONS = Object.freeze([10, 20, 30]);
const MAX_CAPTURE_BYTES = 32 * 1024 * 1024;
const MAX_CAPTURE_COUNT = 100;
const MAX_PROCESS_OUTPUT_BYTES = 2 * 1024 * 1024;
const CAPTURE_SCHEMA_VERSION = '1.0.0';
const MAX_TELEMETRY_FILE_BYTES = 2 * 1024 * 1024;
const TELEMETRY_SETTLE_TIMEOUT_MS = 10000;

const TARGETS_SCRIPT = `
$items = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Id -gt 4 -and $_.MainWindowHandle -ne 0 } | ForEach-Object {
  try {
    [pscustomobject]@{
      pid = [int]$_.Id
      name = [string]$_.ProcessName
      windowTitle = [string]$_.MainWindowTitle
      startedAt = $_.StartTime.ToUniversalTime().ToString('o')
      sessionId = [int]$_.SessionId
    }
  } catch {}
})
ConvertTo-Json -InputObject @($items) -Compress -Depth 3
`;

const PROTECTED_PROCESS_NAMES = new Set([
  'csrss', 'dwm', 'explorer', 'fontdrvhost', 'lsass', 'services', 'sihost', 'smss', 'spoolsv',
  'startmenuexperiencehost', 'system', 'systemsettings', 'taskhostw', 'wininit', 'winlogon',
  'presentmon', 'dialed', 'pc-opti',
  ...Object.values(ANTI_CHEAT_PROCESS_NAMES_BY_PRODUCT).flat(),
].map((name) => String(name).toLowerCase().replace(/\.exe$/i, '')));

function sha256File(filePath, fileSystem = fs) {
  return crypto.createHash('sha256').update(fileSystem.readFileSync(filePath)).digest('hex');
}

function toolPaths(options = {}) {
  const vendorRoot = options.isPackaged
    ? path.join(options.resourcesPath, 'presentmon')
    : path.join(options.appRoot, 'src', 'main', 'presentmon', 'vendor');
  return {
    vendorRoot,
    executablePath: path.join(vendorRoot, PRESENTMON_RELEASE.fileName),
    licensePath: path.join(vendorRoot, PRESENTMON_RELEASE.licenseFileName),
  };
}

function spawnAndCollect(executable, args, options = {}) {
  const spawnProcess = options.spawnProcess || spawn;
  const timeoutMs = options.timeoutMs || 10000;
  const maximumBytes = options.maximumBytes || MAX_PROCESS_OUTPUT_BYTES;
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnProcess(executable, args, { windowsHide: true, ...options.spawnOptions });
    } catch (error) {
      reject(error);
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const append = (current, chunk) => {
      const next = current + chunk.toString();
      if (Buffer.byteLength(next, 'utf8') > maximumBytes) {
        child.kill();
        finish(() => reject(new Error('PresentMon helper output exceeded its fixed limit.')));
      }
      return next;
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error('PresentMon helper operation timed out.')));
    }, timeoutMs);
    child.stdout?.on('data', (chunk) => { stdout = append(stdout, chunk); });
    child.stderr?.on('data', (chunk) => { stderr = append(stderr, chunk); });
    child.on('error', (error) => finish(() => reject(error)));
    child.on('close', (exitCode) => finish(() => resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode })));
  });
}

async function readAuthenticodeSignature(executablePath, dependencies = {}) {
  const encodedPath = Buffer.from(executablePath, 'utf8').toString('base64');
  const script = `
$path = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPath}'))
$signature = Get-AuthenticodeSignature -LiteralPath $path -ErrorAction Stop
[pscustomobject]@{
  status = [string]$signature.Status
  signerSubject = if ($signature.SignerCertificate) { [string]$signature.SignerCertificate.Subject } else { '' }
  timestampSubject = if ($signature.TimeStamperCertificate) { [string]$signature.TimeStamperCertificate.Subject } else { '' }
} | ConvertTo-Json -Compress
`;
  const powershell = `${process.env.SystemRoot || 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
  const result = await spawnAndCollect(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { ...dependencies, spawnOptions: { ...dependencies.spawnOptions, env: windowsPowerShellEnvironment() } });
  if (result.exitCode !== 0) throw new Error(result.stderr || 'Windows could not verify the PresentMon signature.');
  // No output means the check itself did not run; that is an error, not an unsigned file.
  if (!result.stdout) throw new Error(`Windows could not check the PresentMon signature.${result.stderr ? ` ${result.stderr.split(/\r?\n/)[0]}` : ''}`);
  return JSON.parse(result.stdout);
}

async function readPresentMonVersion(executablePath, dependencies = {}) {
  const result = await spawnAndCollect(executablePath, ['--help'], dependencies);
  const output = `${result.stdout}\n${result.stderr}`;
  const match = /PresentMon\s+([0-9]+(?:\.[0-9]+){1,3})/i.exec(output);
  if (!match) throw new Error('The PresentMon executable did not report a supported version banner.');
  return match[1];
}

async function verifyPresentMonTool(options = {}, dependencies = {}) {
  const fileSystem = dependencies.fileSystem || fs;
  const paths = toolPaths(options);
  for (const target of [paths.vendorRoot, paths.executablePath, paths.licensePath]) {
    const stat = fileSystem.lstatSync(target);
    if (stat.isSymbolicLink()) throw new Error('The bundled PresentMon path contains an unsupported symbolic link.');
  }
  const executableStat = fileSystem.statSync(paths.executablePath);
  const licenseStat = fileSystem.statSync(paths.licensePath);
  if (!executableStat.isFile() || executableStat.size !== PRESENTMON_RELEASE.bytes) throw new Error('The bundled PresentMon executable size does not match the pinned release.');
  if (!licenseStat.isFile() || licenseStat.size <= 0 || licenseStat.size > 32 * 1024) throw new Error('The bundled PresentMon license file is unavailable or invalid.');
  const executableSha256 = sha256File(paths.executablePath, fileSystem);
  const licenseSha256 = sha256File(paths.licensePath, fileSystem);
  if (executableSha256 !== PRESENTMON_RELEASE.sha256) throw new Error('The bundled PresentMon executable SHA-256 does not match the pinned official release.');
  if (licenseSha256 !== PRESENTMON_RELEASE.licenseSha256) throw new Error('The bundled PresentMon license SHA-256 does not match the reviewed license.');
  const signature = await (dependencies.readSignature || readAuthenticodeSignature)(paths.executablePath, dependencies);
  if (signature.status !== 'Valid' || signature.signerSubject !== PRESENTMON_RELEASE.signerSubject || !signature.timestampSubject) {
    // Say what Windows reported, so a failure here can be diagnosed rather than guessed at.
    const reported = [
      `status ${signature.status || 'not returned'}`,
      signature.signerSubject === PRESENTMON_RELEASE.signerSubject ? 'signer is Intel' : `signer ${signature.signerSubject || 'not returned'}`,
      signature.timestampSubject ? 'timestamp present' : 'no timestamp',
    ].join(', ');
    throw new Error(`The bundled PresentMon executable does not have the expected valid Intel signature and timestamp (Windows reported: ${reported}).`);
  }
  const version = await (dependencies.readVersion || readPresentMonVersion)(paths.executablePath, dependencies);
  if (version !== PRESENTMON_RELEASE.version) throw new Error(`The bundled PresentMon version '${version}' does not match ${PRESENTMON_RELEASE.version}.`);
  return {
    status: 'AVAILABLE',
    version,
    sha256: executableSha256,
    signerSubject: signature.signerSubject,
    timestampSubject: signature.timestampSubject,
    sourceUrl: PRESENTMON_RELEASE.sourceUrl,
    license: 'MIT',
    executableName: PRESENTMON_RELEASE.fileName,
    executablePath: paths.executablePath,
  };
}

async function inspectPresentMonTool(options = {}, dependencies = {}) {
  try {
    const verified = await verifyPresentMonTool(options, dependencies);
    const { executablePath, ...publicInfo } = verified;
    return publicInfo;
  } catch (error) {
    return {
      status: 'UNAVAILABLE',
      version: PRESENTMON_RELEASE.version,
      sha256: PRESENTMON_RELEASE.sha256,
      signerSubject: PRESENTMON_RELEASE.signerSubject,
      sourceUrl: PRESENTMON_RELEASE.sourceUrl,
      license: 'MIT',
      executableName: PRESENTMON_RELEASE.fileName,
      reason: error instanceof Error ? error.message : 'PresentMon provenance verification failed.',
    };
  }
}

function normalizeTargets(value) {
  const source = Array.isArray(value) ? value : value ? [value] : [];
  if (source.length > 1000) throw new Error('The interactive process inventory exceeded its item limit.');
  return source.flatMap((entry) => {
    const pid = Number(entry?.pid);
    const name = String(entry?.name || '').trim();
    const normalized = name.toLowerCase().replace(/\.exe$/i, '');
    const startedAt = new Date(String(entry?.startedAt || ''));
    const windowTitle = String(entry?.windowTitle || '').trim().slice(0, 240);
    if (!Number.isInteger(pid) || pid <= 4 || pid === process.pid || !/^[A-Za-z0-9_.-]{1,120}$/.test(name) || PROTECTED_PROCESS_NAMES.has(normalized) || !Number.isFinite(startedAt.getTime()) || !windowTitle) return [];
    const targetId = crypto.createHash('sha256').update(`${pid}\0${normalized}\0${startedAt.toISOString()}`, 'utf8').digest('hex').slice(0, 32);
    return [{ targetId, pid, name, windowTitle, startedAt: startedAt.toISOString(), sessionId: Number.isInteger(Number(entry.sessionId)) ? Number(entry.sessionId) : null }];
  }).sort((left, right) => left.name.localeCompare(right.name) || left.pid - right.pid);
}

async function listPresentMonTargets(dependencies = {}) {
  const execute = dependencies.runPowerShell || (async (script) => {
    const powershell = `${process.env.SystemRoot || 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
    const result = await spawnAndCollect(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], dependencies);
    if (result.exitCode !== 0) throw new Error(result.stderr || 'The interactive process inventory failed.');
    return result;
  });
  const result = await execute(TARGETS_SCRIPT);
  return {
    scannedAt: new Date().toISOString(),
    items: normalizeTargets(JSON.parse(result.stdout || '[]')),
    limitations: 'Only current interactive processes with a visible main window are listed. Protected Windows, Dialed, PresentMon, and reviewed anti-cheat process names are excluded. Presence does not prove a process is a game.',
  };
}

function capturesRoot(userDataPath) {
  return path.join(userDataPath, 'presentmon-captures');
}

function assertCaptureId(captureId) {
  if (typeof captureId !== 'string' || !/^[0-9a-f-]{36}$/i.test(captureId)) throw new Error('PresentMon capture id is invalid.');
  return captureId;
}

function capturePaths(userDataPath, captureId) {
  const safeId = assertCaptureId(captureId);
  const root = capturesRoot(userDataPath);
  return { root, csv: path.join(root, `${safeId}.csv`), manifest: path.join(root, `${safeId}.json`), telemetry: path.join(root, `${safeId}.telemetry.json`) };
}

function assertCaptureRoot(userDataPath, fileSystem = fs) {
  const root = capturesRoot(userDataPath);
  fileSystem.mkdirSync(root, { recursive: true });
  const stat = fileSystem.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('The PresentMon capture directory is not a regular app-owned directory.');
  return root;
}

function writeManifest(userDataPath, manifest, fileSystem = fs) {
  const paths = capturePaths(userDataPath, manifest.captureId);
  assertCaptureRoot(userDataPath, fileSystem);
  const temporary = `${paths.manifest}.${crypto.randomUUID()}.tmp`;
  const payload = `${JSON.stringify(manifest, null, 2)}\n`;
  if (Buffer.byteLength(payload, 'utf8') > 128 * 1024) throw new Error('The PresentMon capture manifest exceeds its fixed size limit.');
  try {
    fileSystem.writeFileSync(temporary, payload, { encoding: 'utf8', flag: 'wx' });
    fileSystem.renameSync(temporary, paths.manifest);
  } finally {
    if (fileSystem.existsSync(temporary)) fileSystem.unlinkSync(temporary);
  }
}

function readManifest(userDataPath, captureId, fileSystem = fs) {
  const paths = capturePaths(userDataPath, captureId);
  const stat = fileSystem.lstatSync(paths.manifest);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size <= 0 || stat.size > 128 * 1024) throw new Error('The PresentMon capture manifest is invalid.');
  const manifest = JSON.parse(fileSystem.readFileSync(paths.manifest, 'utf8'));
  if (manifest?.schemaVersion !== CAPTURE_SCHEMA_VERSION || manifest.captureId !== captureId || !['STARTING', 'RECORDING', 'FINALIZING', 'COMPLETE', 'FAILED', 'NEEDS_REVIEW'].includes(manifest.status)) throw new Error('The PresentMon capture manifest schema is invalid.');
  return manifest;
}

function publicCaptureTelemetry(manifest, interrupted) {
  const telemetry = manifest.telemetry;
  if (!telemetry?.requested) return null;
  if (telemetry.status === 'RECORDING') {
    return interrupted
      ? { requested: true, status: 'INTERRUPTED', view: null, error: 'Dialed restarted before hardware readings were saved.' }
      : { requested: true, status: 'RECORDING', view: null, error: null };
  }
  return { requested: true, status: telemetry.status === 'RECORDED' ? 'RECORDED' : 'FAILED', view: telemetry.public || null, error: telemetry.error || null };
}

function publicCapture(manifest, activeCaptureId = null) {
  const interrupted = ['STARTING', 'RECORDING', 'FINALIZING'].includes(manifest.status) && manifest.captureId !== activeCaptureId;
  return {
    captureId: manifest.captureId,
    status: interrupted ? 'NEEDS_REVIEW' : manifest.status,
    target: manifest.target,
    durationSeconds: manifest.durationSeconds,
    startedAt: manifest.startedAt,
    completedAt: manifest.completedAt || null,
    stopReason: manifest.stopReason || null,
    observedDurationSeconds: manifest.observedDurationSeconds ?? null,
    protocolComplete: manifest.protocolComplete === true,
    tool: manifest.tool,
    output: manifest.output || null,
    applications: manifest.applications || [],
    // Captures saved before summaries existed, or with a malformed one, show none.
    frameSummary: manifest.frameSummary && isFrameSummary(manifest.frameSummary) ? manifest.frameSummary : null,
    telemetry: publicCaptureTelemetry(manifest, interrupted),
    error: interrupted ? 'Dialed restarted before this capture reached a verified final state. The raw file is retained for manual review and is not importable.' : manifest.error || null,
  };
}

function readCaptureManifests(userDataPath, fileSystem = fs) {
  const root = capturesRoot(userDataPath);
  try {
    const rootStat = fileSystem.lstatSync(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('The PresentMon capture directory is not a regular app-owned directory.');
    const candidates = fileSystem.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^[0-9a-f-]{36}\.json$/i.test(entry.name));
    if (candidates.length > 10000) throw new Error('Capture inventory exceeds the supported safe read limit.');
    return candidates
      .flatMap((entry) => {
        const captureId = entry.name.slice(0, -5);
        try { return [readManifest(userDataPath, captureId, fileSystem)]; } catch { return []; }
      })
      .sort((left, right) => String(right.startedAt).localeCompare(String(left.startedAt)) || left.captureId.localeCompare(right.captureId))
      .slice(0, MAX_CAPTURE_COUNT);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

function spawnCapture(executablePath, args, dependencies = {}) {
  const spawnProcess = dependencies.spawnProcess || spawn;
  return spawnProcess(executablePath, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
}

function createPresentMonService(options, dependencies = {}) {
  const userDataPath = options.userDataPath;
  const fileSystem = dependencies.fileSystem || fs;
  let active = null;

  async function info() {
    return inspectPresentMonTool(options, dependencies);
  }

  async function targets() {
    return listPresentMonTargets(dependencies);
  }

  function captures() {
    return { entries: readCaptureManifests(userDataPath, fileSystem).map((manifest) => publicCapture(manifest, active?.manifest.captureId || null)), maximumEntries: MAX_CAPTURE_COUNT };
  }

  function previewDeletion(captureId) {
    const safeId = assertCaptureId(captureId);
    if (active?.manifest.captureId === safeId) throw new Error('Stop and finalize the active capture before deleting it.');
    assertCaptureRoot(userDataPath, fileSystem);
    const manifest = readManifest(userDataPath, safeId, fileSystem);
    const paths = capturePaths(userDataPath, safeId);
    const files = [];
    for (const [kind, filePath, maximum] of [['manifest', paths.manifest, 128 * 1024], ['raw-csv', paths.csv, MAX_CAPTURE_BYTES], ['hardware-readings', paths.telemetry, MAX_TELEMETRY_FILE_BYTES]]) {
      if (!fileSystem.existsSync(filePath)) continue;
      const stat = fileSystem.lstatSync(filePath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum) throw new Error('A capture deletion target is linked, invalid, or exceeds its expected size.');
      files.push({ kind, fileName: path.basename(filePath), bytes: stat.size, sha256: sha256File(filePath, fileSystem) });
    }
    if (!files.some((file) => file.kind === 'manifest')) throw new Error('The capture manifest is missing.');
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ captureId: safeId, files }), 'utf8').digest('hex');
    return {
      captureId: safeId,
      targetName: String(manifest.target?.name || 'Unknown target'),
      startedAt: manifest.startedAt,
      status: publicCapture(manifest).status,
      files: files.map(({ kind, fileName, bytes }) => ({ kind, fileName, bytes })),
      totalBytes: files.reduce((total, file) => total + file.bytes, 0),
      fingerprint,
      consequence: 'Permanently deletes this capture manifest, its raw CSV and any saved hardware readings from Dialed’s local user-data directory. Imported benchmark comparisons are separate and are not deleted here.',
    };
  }

  function deleteCapture(preview) {
    const current = previewDeletion(preview?.captureId);
    if (!preview || current.fingerprint !== preview.fingerprint) throw new Error('The capture files changed after preview. Refresh and review the deletion again.');
    const paths = capturePaths(userDataPath, current.captureId);
    if (fileSystem.existsSync(paths.csv)) fileSystem.unlinkSync(paths.csv);
    if (fileSystem.existsSync(paths.telemetry)) fileSystem.unlinkSync(paths.telemetry);
    fileSystem.unlinkSync(paths.manifest);
    return { deleted: true, captureId: current.captureId, deletedFiles: current.files, ...captures() };
  }

  // Hardware readings are secondary evidence: any failure here is recorded on the
  // telemetry field only and never changes the frame-time capture outcome.
  async function settleTelemetry(capture) {
    let timer = null;
    try {
      capture.telemetry.stop('CAPTURE_FINISHED');
      const series = await Promise.race([
        capture.telemetry.result,
        new Promise((resolve) => { timer = setTimeout(() => resolve(null), TELEMETRY_SETTLE_TIMEOUT_MS); }),
      ]);
      if (!series) return { requested: true, status: 'FAILED', public: null, error: 'Hardware readings did not finish in time.' };
      validateTelemetrySeries(series);
      const payload = `${JSON.stringify(series)}\n`;
      if (Buffer.byteLength(payload, 'utf8') > MAX_TELEMETRY_FILE_BYTES) throw new Error('Hardware readings exceeded their file size limit.');
      const temporary = `${capture.paths.telemetry}.${crypto.randomUUID()}.tmp`;
      try {
        fileSystem.writeFileSync(temporary, payload, { encoding: 'utf8', flag: 'wx' });
        fileSystem.renameSync(temporary, capture.paths.telemetry);
      } finally {
        if (fileSystem.existsSync(temporary)) fileSystem.unlinkSync(temporary);
      }
      return {
        requested: true,
        status: series.status,
        fileName: path.basename(capture.paths.telemetry),
        sha256: sha256File(capture.paths.telemetry, fileSystem),
        public: publicTelemetry(series),
        error: series.status === 'FAILED' ? series.errors[0] || 'Hardware readings were not recorded.' : null,
      };
    } catch (error) {
      return { requested: true, status: 'FAILED', public: null, error: error instanceof Error ? error.message : 'Hardware readings could not be saved.' };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function finalize(capture, exitCode, processError = null) {
    if (active?.manifest.captureId !== capture.manifest.captureId || capture.finalizing) return;
    capture.finalizing = true;
    capture.manifest.status = 'FINALIZING';
    writeManifest(userDataPath, capture.manifest, fileSystem);
    const completedAt = new Date((dependencies.now || Date.now)()).toISOString();
    const observedDurationSeconds = Math.max(0, ((dependencies.monotonicNow || (() => performance.now()))() - capture.startedMonotonicMs) / 1000);
    try {
      const stat = fileSystem.lstatSync(capture.paths.csv);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size <= 0 || stat.size > MAX_CAPTURE_BYTES) throw new Error('PresentMon output is missing, empty, linked, or exceeds the 32 MiB capture limit.');
      const parsed = (dependencies.parseSource || parseBenchmarkSource)(capture.paths.csv);
      const outputSha256 = sha256File(capture.paths.csv, fileSystem);
      const abnormalExit = Boolean(processError && !capture.stopRequested);
      capture.manifest = {
        ...capture.manifest,
        status: abnormalExit || capture.stopRequested || observedDurationSeconds < capture.manifest.durationSeconds ? 'NEEDS_REVIEW' : 'COMPLETE',
        observedDurationSeconds,
        protocolComplete: !abnormalExit && !capture.stopRequested && observedDurationSeconds >= capture.manifest.durationSeconds,
        completedAt,
        stopReason: capture.stopRequested ? 'USER' : abnormalExit ? 'PROCESS_ERROR' : observedDurationSeconds < capture.manifest.durationSeconds ? 'EARLY_EXIT' : 'TIMED',
        exitCode,
        output: { fileName: path.basename(capture.paths.csv), bytes: stat.size, sha256: outputSha256, metric: parsed.metric, metricColumn: parsed.metricColumn, unit: parsed.unit, unavailableFrameCount: parsed.unavailableFrameCount },
        applications: parsed.applications.map((application) => ({ application: application.application, processIds: application.processIds, sampleCount: application.samples.length })),
        frameSummary: summarizeCapture(parsed.applications),
        error: processError ? String(processError.message || processError) : null,
      };
    } catch (error) {
      capture.manifest = {
        ...capture.manifest,
        status: processError ? 'FAILED' : 'NEEDS_REVIEW',
        observedDurationSeconds,
        protocolComplete: false,
        completedAt,
        stopReason: capture.stopRequested ? 'USER' : processError ? 'PROCESS_ERROR' : 'TIMED',
        exitCode,
        // When PresentMon itself failed, its reason is the useful one; the missing output
        // file is only a consequence of it.
        error: explainCaptureFailure(capture.stderr) ?? (processError ? String(processError.message || processError) : error instanceof Error ? error.message : 'PresentMon output validation failed.'),
      };
    }
    if (capture.telemetry) capture.manifest = { ...capture.manifest, telemetry: await settleTelemetry(capture) };
    writeManifest(userDataPath, capture.manifest, fileSystem);
    active = null;
  }

  async function start(targetId, durationSeconds, startOptions = {}) {
    if (active) throw new Error('A PresentMon capture is already active.');
    if (!CAPTURE_DURATIONS.includes(Number(durationSeconds))) throw new Error('PresentMon capture duration must be 10, 20, or 30 seconds.');
    const tool = await verifyPresentMonTool(options, dependencies);
    const inventory = await targets();
    const target = inventory.items.find((item) => item.targetId === targetId);
    if (!target) throw new Error('The selected process changed or is no longer an eligible visible target. Refresh targets.');
    const captureId = crypto.randomUUID();
    const paths = capturePaths(userDataPath, captureId);
    assertCaptureRoot(userDataPath, fileSystem);
    if (readCaptureManifests(userDataPath, fileSystem).length >= MAX_CAPTURE_COUNT) throw new Error(`Dialed retains at most ${MAX_CAPTURE_COUNT} native capture manifests. Delete or archive old capture evidence before recording more.`);
    const sessionName = `Dialed_${captureId.replaceAll('-', '')}`;
    const manifest = {
      schemaVersion: CAPTURE_SCHEMA_VERSION,
      captureId,
      status: 'STARTING',
      target: { targetId: target.targetId, pid: target.pid, name: target.name, windowTitle: target.windowTitle, startedAt: target.startedAt },
      durationSeconds: Number(durationSeconds),
      startedAt: new Date((dependencies.now || Date.now)()).toISOString(),
      completedAt: null,
      sessionName,
      tool: { version: tool.version, sha256: tool.sha256, signerSubject: tool.signerSubject, timestampSubject: tool.timestampSubject, sourceUrl: tool.sourceUrl, license: tool.license },
      output: null,
      applications: [],
      error: null,
    };
    writeManifest(userDataPath, manifest, fileSystem);
    const args = [
      '--process_id', String(target.pid),
      '--output_file', paths.csv,
      '--session_name', sessionName,
      '--timed', String(durationSeconds),
      '--terminate_after_timed',
      '--terminate_on_proc_exit',
      '--no_console_stats',
      '--v1_metrics',
    ];
    let child;
    try {
      child = spawnCapture(tool.executablePath, args, dependencies);
    } catch (error) {
      manifest.status = 'FAILED';
      manifest.completedAt = new Date().toISOString();
      manifest.error = error instanceof Error ? error.message : 'PresentMon could not start.';
      writeManifest(userDataPath, manifest, fileSystem);
      throw error;
    }
    const capture = { child, startedMonotonicMs: (dependencies.monotonicNow || (() => performance.now()))(), manifest: { ...manifest, status: 'RECORDING' }, paths, stopRequested: false, stderr: '', finalizing: false, telemetry: null };
    if (startOptions.hardwareReadings === true) {
      // One sample per second for the capture window plus the warm-up reading.
      capture.telemetry = (dependencies.startTelemetrySession || startTelemetrySession)(
        { samples: Number(durationSeconds) + 1, targetPid: target.pid, vendorSensors: startOptions.vendorSensors === true },
        { spawnProcess: dependencies.telemetrySpawnProcess },
      );
      capture.manifest.telemetry = { requested: true, status: 'RECORDING', public: null, error: null };
    }
    active = capture;
    writeManifest(userDataPath, capture.manifest, fileSystem);
    // PresentMon reports why it stopped on either stream, so both are kept.
    child.stderr?.on('data', (chunk) => { capture.stderr = `${capture.stderr}${chunk.toString()}`.slice(-4096); });
    child.stdout?.on('data', (chunk) => { capture.stderr = `${capture.stderr}${chunk.toString()}`.slice(-4096); });
    child.on('error', (error) => { void finalize(capture, null, error); });
    child.on('close', (exitCode) => { void finalize(capture, exitCode, exitCode === 0 || capture.stopRequested ? null : new Error(capture.stderr || `PresentMon exited with code ${exitCode}.`)); });
    return publicCapture(capture.manifest, captureId);
  }

  async function stop() {
    if (!active) return { stopped: false, reason: 'No PresentMon capture is active.' };
    const capture = active;
    capture.stopRequested = true;
    const tool = await verifyPresentMonTool(options, dependencies);
    const result = await spawnAndCollect(tool.executablePath, ['--terminate_existing_session', '--session_name', capture.manifest.sessionName], { ...dependencies, timeoutMs: 5000 });
    if (result.exitCode !== 0) throw new Error(result.stderr || 'PresentMon did not acknowledge the stop request. The timed limit remains active.');
    return { stopped: true, captureId: capture.manifest.captureId };
  }

  function state() {
    return { active: active ? publicCapture(active.manifest, active.manifest.captureId) : null, ...captures() };
  }

  function prepareSources(captureIds) {
    if (!Array.isArray(captureIds) || captureIds.length < 2 || captureIds.length > 20 || new Set(captureIds).size !== captureIds.length) throw new Error('Select 2 to 20 different completed native PresentMon captures.');
    let requestedDuration = null;
    let targetName = null;
    return captureIds.map((captureId) => {
      const manifest = readManifest(userDataPath, assertCaptureId(captureId), fileSystem);
      if (manifest.status !== 'COMPLETE' || manifest.protocolComplete !== true || !manifest.output?.sha256) throw new Error('Only verified complete native captures can be compared.');
      if (requestedDuration !== null && requestedDuration !== manifest.durationSeconds) throw new Error('Native capture requested durations differ; record matched protocols before comparing.');
      requestedDuration = manifest.durationSeconds;
      if (targetName !== null && targetName !== manifest.target.name) throw new Error('Native capture targets differ.');
      targetName = manifest.target.name;
      const paths = capturePaths(userDataPath, captureId);
      const currentHash = sha256File(paths.csv, fileSystem);
      if (currentHash !== manifest.output.sha256) throw new Error('A selected native PresentMon CSV changed after capture and was refused.');
      return { ...(dependencies.parseSource || parseBenchmarkSource)(paths.csv), sourceId: captureId, nativeCaptureId: captureId, toolVersion: manifest.tool.version, capturedAt: manifest.startedAt };
    });
  }

  return { captures, deleteCapture, info, prepareSources, previewDeletion, start, state, stop, targets };
}

// Plain-language reasons for failures people can act on. PresentMon's own text is kept
// for anything not recognised here.
function explainCaptureFailure(output) {
  const text = String(output || '');
  if (/access denied|Performance Log Users/i.test(text)) {
    return 'Windows did not allow PresentMon to start recording. It needs Dialed running as administrator, or your Windows account in the "Performance Log Users" group. Nothing was recorded.';
  }
  return null;
}

module.exports = {
  explainCaptureFailure,
  CAPTURE_DURATIONS,
  CAPTURE_SCHEMA_VERSION,
  MAX_CAPTURE_BYTES,
  MAX_TELEMETRY_FILE_BYTES,
  MAX_CAPTURE_COUNT,
  PRESENTMON_RELEASE,
  PROTECTED_PROCESS_NAMES,
  TARGETS_SCRIPT,
  assertCaptureRoot,
  capturePaths,
  capturesRoot,
  createPresentMonService,
  inspectPresentMonTool,
  listPresentMonTargets,
  normalizeTargets,
  readAuthenticodeSignature,
  readCaptureManifests,
  readPresentMonVersion,
  sha256File,
  spawnAndCollect,
  toolPaths,
  verifyPresentMonTool,
};
