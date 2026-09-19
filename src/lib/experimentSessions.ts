export interface ExperimentSession {
  id: string; workload: string; changeDescription: string; createdAt: string;
  baselineId: string; candidateId: string; auditId: string;
  /** INCONCLUSIVE is a deliberate decision that the evidence did not settle it — distinct
   *  from UNDECIDED, which means no decision has been made yet. */
  decision: 'UNDECIDED' | 'KEEP' | 'REVIEW_RESTORE' | 'INCONCLUSIVE';
  changeMode?: 'AUDIT' | 'MANUAL';
  manualChangedAt?: string;
  baselineIds?: string[];
  candidateIds?: string[];
  archived?: boolean;
}
export function sessionCaptureIds(session: ExperimentSession, phase: 'baseline' | 'candidate'): string[] {
  return session[`${phase}Ids`] ?? (session[`${phase}Id`] ? [session[`${phase}Id`]] : []);
}
export function sameCaptureGroup(actual: string[] | undefined, expected: string[]): boolean {
  return !!actual && actual.length === expected.length && new Set(actual).size === actual.length && expected.every(id => actual.includes(id));
}
export function previewSessionImport(existing: ExperimentSession[], raw: string): { sessions: ExperimentSession[]; added: number; skipped: number } {
  const incoming = parseSessions(raw).map(item => ({...item,decision:'UNDECIDED' as const}));
  const next = parseSessions(JSON.stringify(existing));
  let added = 0;
  let skipped = 0;
  for (const item of incoming) {
    const previous = next.find(saved => saved.id === item.id);
    if (previous) {
      if (JSON.stringify({...previous,decision:'UNDECIDED'}) !== JSON.stringify(item)) throw new Error(`Session ${item.id} already exists with different content. No sessions were overwritten. Delete that session explicitly before restoring its exported copy.`);
      skipped++;
    } else { next.push(item); added++; }
  }
  return {sessions:parseSessions(JSON.stringify(next)),added,skipped};
}
export const SESSION_KEY = 'dialed-experiment-sessions:v1';
export const SESSION_SELECTION_KEY = 'dialed-experiment-selected:v1';
export const SESSION_RECOVERY_KEY = 'dialed-experiment-sessions:recovery:v1';
export function selectedSessionId(sessions: ExperimentSession[], saved: string | null): string {
  return sessions.some((item) => item.id === saved) ? saved! : sessions[0]?.id || '';
}
export function recoverSessionStorage(storage: Pick<Storage, 'getItem' | 'setItem'>): void {
  const raw = storage.getItem(SESSION_KEY);
  // Preserve the exact unreadable content before replacing the active store. A
  // failed backup write must never erase the original.
  if (raw !== null) {
    const previous = storage.getItem(SESSION_RECOVERY_KEY);
    if (previous !== null && previous !== raw) throw new Error('An older recovery backup already exists. Export both records before manually clearing that backup; the current data was preserved.');
    storage.setItem(SESSION_RECOVERY_KEY, raw);
  }
  storage.setItem(SESSION_KEY, '[]');
}
export function parseSessions(raw: string | null): ExperimentSession[] {
  if (!raw) return [];
  if (raw.length > 64000) throw new Error('Saved sessions exceed the supported size. Existing data was preserved.');
  const data: unknown = JSON.parse(raw);
  if (!Array.isArray(data) || data.length > 20) throw new Error('Saved sessions could not be read. Existing data was preserved.');
  const ids = new Set<string>();
  return data.map((value) => {
    if (!value || typeof value !== 'object') throw new Error('Invalid saved session.');
    const item = value as Record<string, unknown>;
    for (const key of ['id', 'workload', 'changeDescription', 'createdAt', 'baselineId', 'candidateId', 'auditId', 'decision']) {
      if (typeof item[key] !== 'string' || (item[key] as string).length > 240) throw new Error('Invalid saved session field.');
    }
    if (!/^session-[a-z0-9-]+$/.test(String(item.id)) || ids.has(String(item.id)) || !Number.isFinite(Date.parse(String(item.createdAt))) || !['UNDECIDED','KEEP','REVIEW_RESTORE','INCONCLUSIVE'].includes(String(item.decision))) throw new Error('Invalid saved session identity.');
    if (item.baselineId && item.baselineId === item.candidateId) throw new Error('A capture cannot be both baseline and candidate.');
    ids.add(String(item.id));
    if (item.changeMode !== undefined && item.changeMode !== 'AUDIT' && item.changeMode !== 'MANUAL') throw new Error('Invalid change evidence mode.');
    if (item.manualChangedAt !== undefined && (typeof item.manualChangedAt !== 'string' || item.manualChangedAt.length > 80 || (item.manualChangedAt && !Number.isFinite(Date.parse(item.manualChangedAt))))) throw new Error('Invalid manual change timestamp.');
    if (item.changeMode === 'MANUAL' && item.auditId) throw new Error('Manual changes cannot claim an applied audit action.');
    if (item.changeMode !== 'MANUAL' && item.manualChangedAt) throw new Error('Manual change evidence requires an explicit manual mode.');
    if (item.archived !== undefined && typeof item.archived !== 'boolean') throw new Error('Invalid session archive flag.');
    for (const phase of ['baseline','candidate']) {
      const group = item[`${phase}Ids`];
      if (group !== undefined && (!Array.isArray(group) || group.length > 20 || group.some(id => typeof id !== 'string' || !id || id.length > 240))) throw new Error('Invalid capture group.');
      if (Array.isArray(group) && (group[0] || '') !== item[`${phase}Id`]) throw new Error('Capture group disagrees with its legacy selection.');
    }
    const allCaptures = [...(item.baselineIds as string[] | undefined ?? (item.baselineId ? [item.baselineId] : [])),...(item.candidateIds as string[] | undefined ?? (item.candidateId ? [item.candidateId] : []))];
    if (allCaptures.length > 20 || new Set(allCaptures).size !== allCaptures.length) throw new Error('Capture groups must contain distinct captures, at most 20 total.');
    const keys = ['id','workload','changeDescription','createdAt','baselineId','candidateId','auditId','decision'];
    for (const key of ['changeMode','manualChangedAt','baselineIds','candidateIds','archived']) if (item[key] !== undefined) keys.push(key);
    return Object.fromEntries(keys.map((key) => [key,item[key]])) as unknown as ExperimentSession;
  });
}

export function sessionPairIssue(session: ExperimentSession, captures: Array<{ captureId: string; status: string; startedAt: string; completedAt: string | null; durationSeconds: number; protocolComplete?: boolean; stopReason: string | null; target: { name: string } }>, audit: Array<{ id: string; status: string; timestamp?: string }>): string | null {
  const baselineIds = sessionCaptureIds(session,'baseline');
  const candidateIds = sessionCaptureIds(session,'candidate');
  const allIds = [...baselineIds,...candidateIds];
  if (!baselineIds.length || !candidateIds.length) return 'Select saved captures for both groups. Missing or deleted captures cannot be used.';
  if (allIds.length > 20 || new Set(allIds).size !== allIds.length) return 'Use distinct captures, at most 20 total, across both groups.';
  if (!(baselineIds.length === 1 && candidateIds.length === 1) && !(baselineIds.length >= 3 && candidateIds.length >= 3)) return 'Use one capture per phase for a descriptive pair, or at least three per phase for repeated trials.';
  const selected = allIds.map(id => captures.find(item => item.captureId === id));
  if (selected.some(item => !item)) return 'Missing or deleted captures cannot be used.';
  const entries = selected as typeof captures;
  if (entries.some(item => item.status !== 'COMPLETE' || item.stopReason !== 'TIMED' || item.protocolComplete !== true)) return 'Only completed timed captures with verified duration can be compared in a session.';
  if (entries.some(item => item.target.name !== entries[0].target.name || item.durationSeconds !== entries[0].durationSeconds)) return 'The target name or requested duration differs. Record matched captures.';
  if (entries.some(item => !item.completedAt || !Number.isFinite(Date.parse(item.completedAt)) || !Number.isFinite(Date.parse(item.startedAt)) || Date.parse(item.completedAt) <= Date.parse(item.startedAt))) return 'Every capture needs a valid start and completion time.';
  const baselineEnd = Math.max(...entries.slice(0,baselineIds.length).map(item => Date.parse(item.completedAt!)));
  const candidateStart = Math.min(...entries.slice(baselineIds.length).map(item => Date.parse(item.startedAt)));
  if (baselineEnd >= candidateStart) return 'All baseline captures must finish before any candidate starts.';
  if (session.changeMode === 'MANUAL') {
    if (session.auditId) return 'Manual changes cannot claim a verified Dialed action.';
    if (!session.changeDescription.trim()) return 'Describe the manual change you made.';
    if (!session.manualChangedAt || !Number.isFinite(Date.parse(session.manualChangedAt)) || Date.parse(session.manualChangedAt) <= baselineEnd || Date.parse(session.manualChangedAt) >= candidateStart) return 'Declare when the manual change was made, between the baseline and candidate captures.';
    return null;
  }
  const change = audit.find((item) => item.id === session.auditId);
  if (!change || change.status !== 'SUCCESS') return 'Select the successful saved action being measured. Unresolved or missing actions cannot establish an applied change.';
  if (!change.timestamp || !Number.isFinite(Date.parse(change.timestamp)) || Date.parse(change.timestamp) <= baselineEnd || Date.parse(change.timestamp) >= candidateStart) return 'The saved action must fall between the baseline and candidate captures.';
  return null;
}
