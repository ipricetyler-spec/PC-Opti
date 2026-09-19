const AUDIT = ['SUCCESS','FAILED','PENDING','NEEDS_REVIEW'] as const;
const OUTCOMES = ['INCONCLUSIVE','HIGH_VARIANCE','REGRESSION','MEASURED_DIFFERENCE','INCOMPLETE','INCOMPARABLE'] as const;
const THEMES = ['console','instrument'];
function counts(value: unknown, field: string, allowed: readonly string[]) {
  const result: Record<string, number> = Object.fromEntries([...allowed,'UNKNOWN'].map(key => [key,0]));
  if (!Array.isArray(value)) return { availability: 'UNAVAILABLE', counts: result };
  for (const entry of value.slice(0,10000)) {
    const status = entry && typeof entry === 'object' ? entry[field] : null;
    result[allowed.includes(status) ? status : 'UNKNOWN']++;
  }
  return { availability: value.length > 10000 ? 'BOUNDED_TO_10000' : 'AVAILABLE', counts: result };
}
export function buildSupportSummary(input: { auditEntries?: unknown; comparisons?: unknown; appVersion?: unknown; theme?: unknown; technicalDetails?: unknown; density?: unknown; background?: unknown; sessionRaw?: string | null }) {
  let sessions: { availability: string; count: number | null } = {availability:'UNAVAILABLE',count:null};
  if (input.sessionRaw === null) sessions = {availability:'AVAILABLE',count:0};
  else if (typeof input.sessionRaw === 'string' && input.sessionRaw.length <= 64000) {
    try { const parsed = JSON.parse(input.sessionRaw); if (Array.isArray(parsed) && parsed.length <= 20) sessions = {availability:'AVAILABLE',count:parsed.length}; } catch { /* Only unavailability is exported; original contents remain local. */ }
  }
  return {
    format: 'dialed-support-summary-v2',
    scope: 'Allowlisted aggregate counts and app appearance only. No identities, hardware, paths, raw evidence, errors or session notes.',
    appVersion: typeof input.appVersion === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}(?:-[a-z0-9.]{1,32})?$/i.test(input.appVersion) ? input.appVersion : 'UNKNOWN',
    appearance: {
      theme: typeof input.theme === 'string' && THEMES.includes(input.theme) ? input.theme : 'UNKNOWN',
      technicalDetails: typeof input.technicalDetails === 'boolean' ? input.technicalDetails : null,
      density: typeof input.density === 'string' && ['comfortable','compact'].includes(input.density) ? input.density : 'UNKNOWN',
      background: typeof input.background === 'string' && ['simple','layered'].includes(input.background) ? input.background : 'UNKNOWN',
    },
    audit: counts(input.auditEntries,'status',AUDIT), comparisons: counts(input.comparisons,'classification',OUTCOMES), sessions,
  };
}
