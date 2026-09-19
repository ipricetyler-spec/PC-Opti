import { ErrorText } from './ErrorText';
import { ArrowRight, CheckCircle2, ClipboardList, Search, ShieldAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { LocalRecommendation } from '../types';
import { plainLabel } from '../lib/plainLabels';

interface RecommendationsPanelProps {
  recommendations: LocalRecommendation[];
  error: string | null;
  onNavigate: (target: LocalRecommendation['targetPanel']) => void;
}

function statusClass(status: LocalRecommendation['actionStatus']) {
  if (status === 'OPTIONAL_ACTION') return 'bg-cyan-500/10 text-cyan-300';
  if (status === 'REVIEW') return 'bg-amber-500/10 text-amber-300';
  if (status === 'NO_ACTION') return 'bg-emerald-500/10 text-emerald-300';
  return 'bg-violet-500/10 text-violet-300';
}

export function RecommendationsPanel({ recommendations, error, onNavigate }: RecommendationsPanelProps) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | LocalRecommendation['actionStatus']>('all');
  const [riskFilter, setRiskFilter] = useState<'all' | LocalRecommendation['risk']>('all');
  const [sortMode, setSortMode] = useState<'priority' | 'risk' | 'confidence'>('priority');

  const filteredRecommendations = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const rows = recommendations.filter((item) => {
      if (statusFilter !== 'all' && item.actionStatus !== statusFilter) return false;
      if (riskFilter !== 'all' && item.risk !== riskFilter) return false;
      if (!normalized) return true;
      return item.title.toLowerCase().includes(normalized)
        || item.observation.toLowerCase().includes(normalized)
        || item.rationale.toLowerCase().includes(normalized)
        || item.evidence.summary.toLowerCase().includes(normalized);
    });
    const riskOrder: Record<string, number> = { Low: 0, Medium: 1, High: 2 };
    const confidenceOrder: Record<string, number> = { Low: 0, Medium: 1, High: 2 };
    if (sortMode === 'risk') rows.sort((left, right) => riskOrder[left.risk] - riskOrder[right.risk] || left.title.localeCompare(right.title));
    else if (sortMode === 'confidence') rows.sort((left, right) => confidenceOrder[left.confidence] - confidenceOrder[right.confidence] || left.title.localeCompare(right.title));
    else rows.sort((left, right) => left.actionStatus.localeCompare(right.actionStatus) || left.title.localeCompare(right.title));
    return rows;
  }, [query, recommendations, riskFilter, sortMode, statusFilter]);

  const resetFilters = () => {
    setQuery('');
    setStatusFilter('all');
    setRiskFilter('all');
    setSortMode('priority');
  };

  return <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
    <div className="flex items-start gap-3">
      <ClipboardList className="mt-0.5 h-5 w-5 text-violet-400" />
      <div>
        <h3 className="font-semibold text-slate-100">What Dialed suggests</h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">Based on your scan. Nothing here changes on its own.</p>
      </div>
    </div>
    {error && <p className="mt-4 rounded-lg border border-rose-500/30 bg-rose-950/30 p-3 text-xs text-rose-200"><ErrorText text={error} /></p>}
    <section className="mt-4 rounded-xl border border-slate-800 bg-slate-950/40 p-4 text-xs">
      <div className="mb-3 flex flex-wrap gap-2">
        <label className="inline-flex items-center gap-2 rounded border border-slate-700 bg-slate-900/50 px-2 py-1.5 text-slate-300">
          <Search className="h-3.5 w-3.5 text-slate-400" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search suggestions" className="w-72 bg-transparent outline-none placeholder:text-slate-500" />
        </label>
        <label className="text-[11px] text-slate-400">
          <div className="mb-1">Status</div>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | LocalRecommendation['actionStatus'])} className="rounded border border-slate-700 bg-slate-900/50 px-2 py-1 text-xs text-slate-100">
            <option value="all">All</option>
            <option value="OPTIONAL_ACTION">Optional action</option>
            <option value="GUIDANCE_ONLY">Guidance only</option>
            <option value="REVIEW">Review</option>
            <option value="NO_ACTION">No action</option>
          </select>
        </label>
        <label className="text-[11px] text-slate-400">
          <div className="mb-1">Risk</div>
          <select value={riskFilter} onChange={(event) => setRiskFilter(event.target.value as 'all' | LocalRecommendation['risk'])} className="rounded border border-slate-700 bg-slate-900/50 px-2 py-1 text-xs text-slate-100">
            <option value="all">All</option>
            <option value="Low">Low</option>
            <option value="Medium">Medium</option>
            <option value="High">High</option>
          </select>
        </label>
        <label className="text-[11px] text-slate-400">
          <div className="mb-1">Sort</div>
          <select value={sortMode} onChange={(event) => setSortMode(event.target.value as 'priority' | 'risk' | 'confidence')} className="rounded border border-slate-700 bg-slate-900/50 px-2 py-1 text-xs text-slate-100">
            <option value="priority">Status</option>
            <option value="risk">Risk</option>
            <option value="confidence">Confidence</option>
          </select>
        </label>
        <button onClick={resetFilters} className="rounded-lg border border-slate-700 bg-slate-900/50 px-2 py-1.5 text-[11px] text-slate-300">Reset</button>
      </div>
      <p role="status" aria-live="polite" aria-atomic="true" className="text-slate-500">Showing <span className="font-semibold text-slate-200">{filteredRecommendations.length}</span> of <span className="font-semibold text-slate-200">{recommendations.length}</span> recommendations.</p>
    </section>
    <div className="mt-4 space-y-3">
      {filteredRecommendations.map((item) => <details key={item.id} className="group rounded-xl border border-slate-800 bg-slate-950/50 p-4">
        <summary className="cursor-pointer list-none">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-semibold text-slate-100">{item.title}</h4>
                <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${statusClass(item.actionStatus)}`}>{plainLabel(item.actionStatus)}</span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">{item.observation}</p>
            </div>
            <div className="flex shrink-0 gap-2 text-[11px] text-slate-500"><span>{item.risk} risk</span><span>·</span><span>{item.confidence} confidence</span></div>
          </div>
        </summary>
        <div className="mt-4 grid gap-3 border-t border-slate-800 pt-4 text-xs lg:grid-cols-2">
          <Detail label="What Dialed found" value={item.observation} />
          <Detail label="Why this may matter" value={item.rationale} />
          <Detail label="Possible benefit" value={item.expectedBenefit} />
          <Detail label="What happens here" value={item.actionId ? 'Nothing yet. Open the section named below to decide.' : 'Nothing. This is for your information.'} />
          <Detail label="Risk & confidence" value={`${item.risk} risk · ${item.confidence} confidence.`} />
          <Detail label="Undo" value={`${item.rollback.method}. ${item.rollback.limitations}`} />
          <Detail label="How to check" value={item.verification} />
        </div>
        <details data-technical-detail className="mt-3 rounded-lg border border-slate-800 bg-slate-950/30 p-3 text-[11px] leading-relaxed text-slate-400">
          <summary className="cursor-pointer font-semibold text-slate-300">Technical evidence</summary>
          <p className="mt-2"><span className="font-semibold text-slate-300">Scan evidence:</span> {item.evidence.summary}</p>
          <p className="mt-1"><span className="font-semibold text-slate-300">Action:</span> {item.capabilityId}</p>
        </details>
        <button type="button" onClick={() => onNavigate(item.targetPanel)} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-violet-400/25 bg-violet-400/10 px-2.5 py-1.5 text-[11px] font-semibold text-violet-200 hover:bg-violet-400/15">
          {item.targetPanel.label}<ArrowRight className="h-3 w-3" />
        </button>
        {item.actionStatus === 'OPTIONAL_ACTION' && <div className="mt-3 flex gap-2 rounded-lg border border-cyan-500/20 bg-cyan-950/20 p-2.5 text-[11px] text-cyan-100/80"><CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-cyan-300" />Dialed can do this for you: use the button above. Nothing was changed yet.</div>}
      </details>)}
      {!error && filteredRecommendations.length === 0 && recommendations.length > 0 && <div className="rounded-xl border border-amber-500/20 bg-amber-950/20 p-4 text-xs text-amber-100/80"><ShieldAlert className="h-4 w-4 shrink-0 text-amber-300" />Nothing matches these filters.</div>}
      {!error && recommendations.length === 0 && <div className="flex gap-2 rounded-xl border border-emerald-500/20 bg-emerald-950/10 p-4 text-xs text-emerald-100/80"><ShieldAlert className="h-4 w-4 shrink-0 text-emerald-300" />Nothing to suggest from this scan.</div>}
    </div>
  </section>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 leading-relaxed text-slate-300">{value}</p></div>;
}
