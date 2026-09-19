const { runPowerShell } = require('../scanner/index.cjs');
const { assertPowerPlanGuid, listPowerPlans } = require('../power-plans/index.cjs');

// Two power changes made through powercfg, Microsoft's documented tool:
// https://learn.microsoft.com/windows-hardware/design/device-experiences/powercfg-command-line-options
//
// 1. Ultimate Performance: Windows hides this built-in plan on most PCs. Duplicating its
//    fixed source scheme adds a copy to the plan list. Nothing is activated.
// 2. CPU minimum state: the "Minimum processor state" of one plan, when plugged in (AC).
//    Only the AC value is changed; battery (DC) behaviour is left alone.
// 3. USB selective suspend: whether Windows may put idle USB devices to sleep, when
//    plugged in (AC). 0 = Disabled, 1 = Enabled. The battery value is left alone.
const ULTIMATE_SOURCE_GUID = 'e9a42b02-d5df-448d-aa00-03f14749eb61';
const SUB_PROCESSOR = '54533251-82be-4824-96c1-47b60b740d00';
const PROCTHROTTLEMIN = '893dee8e-2bef-41e0-89c6-b55d0929964c';
const SUB_USB = '2a737441-1930-4402-8d77-b2bebba308a3';
const USBSELECTIVESUSPEND = '48e6b7a6-50f5-4782-a5d4-53bb8f07e226';
const HEX_PATTERN = /0x([0-9a-f]{8})/gi;

async function duplicateUltimatePlan(run = runPowerShell) {
  const { stdout, stderr, exitCode } = await run(`& powercfg.exe /duplicatescheme ${ULTIMATE_SOURCE_GUID} 2>&1 | Out-String; if ($LASTEXITCODE -ne 0) { throw 'powercfg /duplicatescheme failed.' }`);
  return { output: { requested: true }, stdout, stderr, exitCode };
}

async function deletePowerPlan(guid, run = runPowerShell) {
  const safeGuid = assertPowerPlanGuid(guid);
  if (safeGuid === ULTIMATE_SOURCE_GUID) throw new Error('The built-in Ultimate Performance source scheme is never deleted.');
  const { stdout, stderr, exitCode } = await run(`& powercfg.exe /delete ${safeGuid} 2>&1 | Out-String; if ($LASTEXITCODE -ne 0) { throw 'powercfg /delete failed.' }`);
  return { output: { deletedGuid: safeGuid }, stdout, stderr, exitCode };
}

/**
 * powercfg /query output is localized, but for one setting it always ends with the current
 * AC index then the current DC index, both as 0x-prefixed hex. Earlier hex values are the
 * possible minimum, maximum and increment, so the last two are taken and range-checked.
 */
function parseSettingIndexes(stdout) {
  const values = [...String(stdout || '').matchAll(HEX_PATTERN)].map((match) => parseInt(match[1], 16));
  if (values.length < 2) throw new Error('Windows did not report the power setting.');
  const [ac, dc] = values.slice(-2);
  if (![ac, dc].every((value) => Number.isInteger(value) && value >= 0 && value <= 100)) throw new Error('Windows reported a power setting outside 0–100%.');
  return { ac, dc };
}

async function readCpuMinimumState(guid, run = runPowerShell) {
  const safeGuid = assertPowerPlanGuid(guid);
  const { stdout } = await run(`& powercfg.exe /query ${safeGuid} ${SUB_PROCESSOR} ${PROCTHROTTLEMIN} 2>&1 | Out-String; if ($LASTEXITCODE -ne 0) { throw 'powercfg /query failed.' }`);
  return { schemeGuid: safeGuid, ...parseSettingIndexes(stdout) };
}

async function writeCpuMinimumAc(guid, percent, run = runPowerShell) {
  const safeGuid = assertPowerPlanGuid(guid);
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) throw new Error('Minimum processor state must be 0–100%.');
  // Re-activating the plan makes Windows apply the new index straight away.
  const { stdout, stderr, exitCode } = await run(`& { & powercfg.exe /setacvalueindex ${safeGuid} ${SUB_PROCESSOR} ${PROCTHROTTLEMIN} ${percent} 2>&1 | Out-String; if ($LASTEXITCODE -ne 0) { throw 'powercfg /setacvalueindex failed.' }; $active = (& powercfg.exe /getactivescheme | Out-String); if ($active -match '${safeGuid}') { & powercfg.exe /setactive ${safeGuid} | Out-Null } }`);
  return { output: { schemeGuid: safeGuid, ac: percent }, stdout, stderr, exitCode };
}

async function readUsbSelectiveSuspend(guid, run = runPowerShell) {
  const safeGuid = assertPowerPlanGuid(guid);
  const { stdout } = await run(`& powercfg.exe /query ${safeGuid} ${SUB_USB} ${USBSELECTIVESUSPEND} 2>&1 | Out-String; if ($LASTEXITCODE -ne 0) { throw 'powercfg /query failed.' }`);
  const { ac, dc } = parseSettingIndexes(stdout);
  if (![ac, dc].every((value) => value === 0 || value === 1)) throw new Error('Windows reported a USB suspend setting other than Disabled or Enabled.');
  return { schemeGuid: safeGuid, ac, dc };
}

async function writeUsbSelectiveSuspendAc(guid, value, run = runPowerShell) {
  const safeGuid = assertPowerPlanGuid(guid);
  if (value !== 0 && value !== 1) throw new Error('USB selective suspend must be Disabled (0) or Enabled (1).');
  const { stdout, stderr, exitCode } = await run(`& { & powercfg.exe /setacvalueindex ${safeGuid} ${SUB_USB} ${USBSELECTIVESUSPEND} ${value} 2>&1 | Out-String; if ($LASTEXITCODE -ne 0) { throw 'powercfg /setacvalueindex failed.' }; $active = (& powercfg.exe /getactivescheme | Out-String); if ($active -match '${safeGuid}') { & powercfg.exe /setactive ${safeGuid} | Out-Null } }`);
  return { output: { schemeGuid: safeGuid, ac: value }, stdout, stderr, exitCode };
}

/** The plan list with the English "Ultimate Performance" name flagged; localized names are not guessed. */
async function ultimatePlanState(adapters = {}) {
  const inventory = await (adapters.listPowerPlans || listPowerPlans)();
  const existing = inventory.items.filter((item) => item.guid === ULTIMATE_SOURCE_GUID || /ultimate performance/i.test(item.name));
  return { inventory, present: existing.length > 0, plans: existing };
}

module.exports = {
  PROCTHROTTLEMIN,
  SUB_PROCESSOR,
  SUB_USB,
  USBSELECTIVESUSPEND,
  ULTIMATE_SOURCE_GUID,
  deletePowerPlan,
  duplicateUltimatePlan,
  parseSettingIndexes,
  readCpuMinimumState,
  readUsbSelectiveSuspend,
  ultimatePlanState,
  writeCpuMinimumAc,
  writeUsbSelectiveSuspendAc,
};
