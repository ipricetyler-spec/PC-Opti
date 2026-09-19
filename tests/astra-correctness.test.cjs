const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const scanner = require('../src/main/scanner/index.cjs');
const journal = require('../src/main/journal/index.cjs');
const benchmarks = require('../src/main/benchmarks/index.cjs');
const timing = require('../src/main/timing/index.cjs');

test('missing process CPU remains unknown and sorts behind measured zero', () => {
  const result = scanner.normalizeProcessInventory([
    { pid: 900, name: 'unknown', workingSetBytes: 999 },
    { pid: 901, name: 'zero', cpuPercent: 0 },
    { pid: 902, name: 'busy', cpuPercent: 4 },
  ]);
  assert.deepEqual(result.map((item) => [item.name, item.cpuPercent]), [['busy', 4], ['zero', 0], ['unknown', null]]);
});

test('same PID and name with changed lifetime refuses before journaling or writing', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dialed-lifetime-'));
  let writes = 0;
  try {
    await assert.rejects(journal.enableProcessEcoQos(directory, { pid: 999, name: 'fixture', creationTime: '133000000000000000' }, {
      readRunningProcess: async () => ({ pid: 999, name: 'fixture', creationTime: '133000000000000001' }),
      setProcessEcoQos: async () => { writes += 1; },
    }), /reused/);
    assert.equal(writes, 0);
    assert.deepEqual(journal.readJournal(directory), []);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('native QoS logic uses one bound handle and refuses replacement or exit before write using fake Win32 calls', { skip: process.platform !== 'win32' }, () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/main/scanner/index.cjs'), 'utf8');
  let code = source.match(/const ECO_QOS_TYPE_DEFINITION = `([\s\S]*?)`;/)[1];
  const productionCompileOnly = code.replace('class PCOptiEcoQos', 'class PCOptiEcoQosCompileOnly');
  const timingSource = fs.readFileSync(path.join(__dirname, '../src/main/timing/index.cjs'), 'utf8');
  const directoryLockCompileOnly = timingSource.match(/Add-Type -TypeDefinition @'\r?\n([\s\S]*?)\r?\n'@/)[1];
  const methods = {
    OpenProcess: 'private static IntPtr OpenProcess(uint access, bool inherit, int pid) { Opens++; return new IntPtr(123); }',
    CloseHandle: 'private static bool CloseHandle(IntPtr h) { Closes++; return true; }',
    GetProcessTimes: 'private static bool GetProcessTimes(IntPtr h, out long creation, out long exit, out long kernel, out long user) { if(h.ToInt64()!=123) throw new Exception("wrong handle"); creation=Lifetime; exit=Exited?1:0; kernel=user=0; return true; }',
    GetProcessInformation: 'private static bool GetProcessInformation(IntPtr h, int c, ref PROCESS_POWER_THROTTLING_STATE s, uint n) { if(h.ToInt64()!=123) throw new Exception("wrong handle"); s.ControlMask=5; s.StateMask=Enabled?5u:4u; if(ExitDuringRead) Exited=true; return true; }',
    SetProcessInformation: 'private static bool SetProcessInformation(IntPtr h, int c, ref PROCESS_POWER_THROTTLING_STATE s, uint n) { if(h.ToInt64()!=123 || (s.StateMask & 4)==0) throw new Exception("wrong handle or other QoS bit lost"); Writes++; Enabled=(s.StateMask & 1)!=0; return true; }',
  };
  code = code.replace(/\[DllImport\("kernel32.dll", SetLastError = true\)\]\s+private static extern [\s\S]*?;/g, (declaration) => {
    const name = Object.keys(methods).find((key) => declaration.includes(`${key}(`));
    assert.ok(name, declaration);
    return methods[name];
  });
  assert.doesNotMatch(code, /DllImport/);
  const fixture = `
    static int Opens, Closes, Writes; static long Lifetime=133000000000000000; static bool Exited, Enabled, ExitDuringRead;
    public static void VerifyFixture() {
      if(!SetEcoQos(99,true,Lifetime) || Opens!=1 || Closes!=1 || Writes!=1) throw new Exception("success did not use one handle");
      Writes=0; Enabled=false;
      try { SetEcoQos(99,true,Lifetime-1); throw new Exception("replacement accepted"); } catch(InvalidOperationException) {}
      if(Writes!=0) throw new Exception("replacement mutated");
      ExitDuringRead=true;
      try { SetEcoQos(99,true,Lifetime); throw new Exception("exited process accepted"); } catch(InvalidOperationException) {}
      if(Writes!=0 || Opens!=Closes) throw new Exception("exit mutated or leaked handle");
    }
  `;
  code = code.replace(/}\s*$/, `${fixture}\n}`);
  const encoded = Buffer.from(code, 'utf8').toString('base64');
  const productionEncoded = Buffer.from(productionCompileOnly, 'utf8').toString('base64');
  const lockEncoded = Buffer.from(directoryLockCompileOnly, 'utf8').toString('base64');
  const script = `Add-Type -TypeDefinition ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${productionEncoded}'))) -ErrorAction Stop; Add-Type -TypeDefinition ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${lockEncoded}'))) -ErrorAction Stop; Add-Type -TypeDefinition ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))) -ErrorAction Stop; [PCOptiEcoQos]::VerifyFixture(); 'fixture-pass'`;
  const result = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.match(result, /fixture-pass/);
});

function record(phase, sampleUnit = 'FRAME') {
  return { experimentId: 'correctness', phase, workload: 'fixture', tool: 'fixture', toolVersion: '1', metric: 'time', unit: 'ms', direction: 'LOWER_IS_BETTER', variant: phase, changeDescription: 'one change', capturedAt: '2026-09-05T00:00:00Z', samples: phase === 'BASELINE' ? [10,10,10] : [9,9,9], sampleUnit, trialIds: [0,1,2].map((id) => `${phase}-${id}`), conditions: Object.fromEntries(benchmarks.CONDITION_FIELDS.map((key) => [key, 'declared'])) };
}

test('frame pairs stay descriptive while independent run summaries disclose their rule', () => {
  const frames = benchmarks.validateRecordSet([record('BASELINE'), record('CANDIDATE')]);
  const comparison = benchmarks.compareExperiment(frames, 'correctness');
  assert.equal(comparison.classification, 'INCONCLUSIVE');
  assert.equal(comparison.favorableDeltaPercent, 10);
  assert.match(comparison.reason, /cannot say whether it is real/);
  const trials = benchmarks.validateRecordSet([record('BASELINE', 'TRIAL'), record('CANDIDATE', 'TRIAL')]);
  assert.equal(benchmarks.compareExperiment(trials, 'correctness').classification, 'MEASURED_DIFFERENCE');
  assert.match(benchmarks.compareExperiment(trials, 'correctness').decisionRule, /not a significance test/);
  trials[1].trialIds = [...trials[0].trialIds];
  assert.equal(benchmarks.compareExperiment(trials, 'correctness').classification, 'INCONCLUSIVE');
  frames[1].conditions.scene = 'different';
  assert.equal(benchmarks.compareExperiment(frames, 'correctness').classification, 'INCOMPARABLE');
});

test('BCD backup refuses a redirected ancestor before directory creation or export', async () => {
  const root = path.resolve('fixture-user-data');
  let exports = 0;
  let creates = 0;
  await assert.rejects(timing.createBcdBackup(root, timing.TIMING_ACTIONS.DISABLE_DYNAMIC_TICK, {
    fs: { existsSync: () => true, lstatSync: () => ({ isSymbolicLink: () => true, isDirectory: () => true }), mkdirSync: () => { creates++; } },
    runPowerShell: async () => { exports++; },
  }), /redirected/);
  assert.equal(exports, 0);
  assert.equal(creates, 0);
});
