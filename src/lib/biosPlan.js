export const BIOS_NOTE_STATUSES = ['Not reviewed', 'Already set', 'Changed — needs testing', 'Tested by me', 'Skipped'];

export function parseBiosNotes(serialized, ids) {
  try {
    const parsed = JSON.parse(serialized || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(ids.filter((id) => Object.hasOwn(parsed, id)).map((id) => {
      const entry = parsed[id];
      return [id, {
        status: BIOS_NOTE_STATUSES.includes(entry?.status) ? entry.status : 'Not reviewed',
        previousValue: typeof entry?.previousValue === 'string' ? entry.previousValue.slice(0, 1000) : '',
      }];
    }));
  } catch { return {}; }
}

export function formatBiosPlan(plan, notes = {}) {
  const hw = plan.hardware;
  const display = (value) => value || 'Unknown';
  const lines = [
    'DIALED — MY BIOS PLAN',
    `Generated: ${display(plan.generatedAt)} | Catalog: ${plan.catalogVersion} | Review before: ${plan.reviewAfter}`,
    'Manual guidance only. User notes are not independently verified settings or stability evidence.',
    `CPU: ${display(hw.cpu.name)}`,
    `Board: ${display(hw.board.manufacturer)} ${display(hw.board.product)} | revision: ${display(hw.board.revision)}`,
    `BIOS: ${display(hw.bios.version)} | date: ${display(hw.bios.date)}`,
    `GPU: ${hw.gpus.join(', ') || 'Unknown'}`,
    ...hw.memory.map((item) => `RAM: ${display(item.partNumber)} | slot ${display(item.slot)} | ${item.capacityBytes ? `${item.capacityBytes / 2 ** 30} GiB` : 'Unknown capacity'} | reported configured speed ${item.configuredSpeed || 'Unknown'}`),
    '', 'MATCH', plan.match.reason, plan.limitations,
    ...(plan.match.supportUrl ? [`Board support: ${plan.match.supportUrl}`] : []),
    '', 'BEFORE CHANGING ANYTHING', ...plan.preparation.map((step, index) => `${index + 1}. ${step}`),
    ...plan.preparationSources.map((source) => `${source.title}: ${source.url}`),
    ...plan.warnings.map((warning) => `Check: ${warning}`), ...hw.errors.map((error) => `Inventory: ${error}`),
  ];
  for (const item of plan.recommendations) {
    const note = notes[item.id];
    lines.push('', `${item.title} [${item.risk}${item.advanced ? ' / optional advanced' : ''}]`,
      `Why this appears: ${item.matchReason}`, `Current setting: ${item.currentState}`,
      `Target: ${item.target}`, `Benefit: ${item.benefit}`, `Tradeoff: ${item.tradeoff}`,
      `Your status: ${note?.status || 'Not reviewed'}`, `Your previous-setting notes: ${note?.previousValue || 'Not recorded'}`,
      'Compatibility checks:', ...item.checks.map((step) => `- ${step}`), `Menu hint: ${item.menuHint}`,
      'Steps:', ...item.steps.map((step, index) => `${index + 1}. ${step}`),
      `Verify: ${item.verify}`, `Recovery: ${item.undo}`,
      ...item.sources.map((source) => `Source (reviewed ${source.reviewedAt}): ${source.title} — ${source.url}`));
  }
  if (!plan.recommendations.length) lines.push('', 'No reviewed tuning recommendation matched this inventory. Do not use a preset for a different system.');
  return lines.join('\n');
}
