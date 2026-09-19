const { runPowerShell } = require('../scanner/index.cjs');

const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// powercfg labels are localized, so only the GUID, the parenthesized name and the
// trailing active marker are parsed. Microsoft documents /list and /setactive:
// https://learn.microsoft.com/windows-hardware/design/device-experiences/powercfg-command-line-options
const POWER_PLAN_LIST_SCRIPT = `
$output = (& powercfg.exe /list 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0) { throw $output.Trim() }
$output
`;

function parsePowerPlanList(stdout) {
  const items = [];
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const match = /([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\s*(?:\((.+)\))?\s*(\*)?\s*$/.exec(line);
    if (!match) continue;
    const guid = match[1].toLowerCase();
    if (items.some((item) => item.guid === guid)) continue;
    items.push({ guid, name: (match[2] || '').trim() || 'Unnamed plan', active: Boolean(match[3]) });
  }
  if (items.filter((item) => item.active).length > 1) throw new Error('Windows reported more than one active power plan.');
  return items;
}

function assertPowerPlanGuid(value) {
  const guid = String(value || '').toLowerCase();
  if (!GUID_PATTERN.test(guid)) throw new Error('Power plan identifier is not valid.');
  return guid;
}

async function listPowerPlans(run = runPowerShell) {
  const { stdout } = await run(POWER_PLAN_LIST_SCRIPT);
  const items = parsePowerPlanList(stdout);
  if (items.length === 0) throw new Error('Windows did not return any power plans.');
  return { items, activeGuid: items.find((item) => item.active)?.guid || null };
}

async function setActivePowerPlan(guid, run = runPowerShell) {
  const safeGuid = assertPowerPlanGuid(guid);
  const { stdout, stderr, exitCode } = await run(`& powercfg.exe /setactive ${safeGuid} 2>&1 | Out-String; if ($LASTEXITCODE -ne 0) { throw 'powercfg /setactive failed.' }`);
  return { output: { requestedGuid: safeGuid }, stdout, stderr, exitCode };
}

module.exports = {
  POWER_PLAN_LIST_SCRIPT,
  assertPowerPlanGuid,
  listPowerPlans,
  parsePowerPlanList,
  setActivePowerPlan,
};
