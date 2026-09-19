import { partName } from '../lib/friendlyError';
import { ErrorText } from './ErrorText';
import { AlertTriangle, CheckCircle2, Filter, RefreshCw, RotateCcw, Search, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { SafeOsPolicy } from '../types';

interface SafePoliciesProps {
  policies: SafeOsPolicy[];
  errors: Array<{ component: string; message: string }>;
  loading: boolean;
  activePolicyId: string | null;
  actionError: string | null;
  onRefresh: () => void;
  onEnable: (policy: SafeOsPolicy) => void;
}

export function SafePolicies({ policies, errors, loading, activePolicyId, actionError, onRefresh, onEnable }: SafePoliciesProps) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'disabled' | 'invalid' | 'unsupported'>('all');
  const [sortMode, setSortMode] = useState<'name' | 'enabled' | 'revert'>('name');

  const visiblePolicies = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const rows = policies.filter((policy) => {
      const unsupportedValue = policy.valueExists && policy.valueKind !== 'DWord';
      if (statusFilter === 'enabled' && !policy.enabled) return false;
      if (statusFilter === 'disabled' && policy.enabled) return false;
      if (statusFilter === 'invalid' && policy.valueExists) return false;
      if (statusFilter === 'unsupported' && !unsupportedValue) return false;
      if (!normalized) return true;

      return policy.title.toLowerCase().includes(normalized)
        || policy.description.toLowerCase().includes(normalized)
        || policy.description.toLowerCase().includes(normalized)
        || `${policy.valueKind ?? ''}`.toLowerCase().includes(normalized);
    });

    if (sortMode === 'enabled') rows.sort((left, right) => Number(right.enabled) - Number(left.enabled) || left.title.localeCompare(right.title));
    else if (sortMode === 'revert') rows.sort((left, right) => `${left.valueExists}`.localeCompare(`${right.valueExists}`) || left.title.localeCompare(right.title));
    else rows.sort((left, right) => left.title.localeCompare(right.title));
    return rows;
  }, [policies, query, sortMode, statusFilter]);

  return (
    <div id="safe-policies" className="scroll-mt-6 space-y-6">
      <section className="rounded-2xl border border-cyan-500/20 bg-gradient-to-r from-slate-900 via-slate-900 to-cyan-950/20 p-6 shadow-xl">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold text-cyan-300"><ShieldCheck className="h-3.5 w-3.5" /> Windows policies</div>
            <h2 className="mt-3 text-2xl font-bold text-white">Windows policies</h2>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-400">Settings Microsoft documents for managing Windows. Dialed never blocks Windows Update, turns off Defender or runs "privacy" scripts.</p>
          </div>
          <button onClick={onRefresh} disabled={loading} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-60"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> {loading ? 'Reading…' : 'Refresh'}</button>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 text-sm text-slate-300"><div className="flex gap-2 font-semibold text-slate-100"><RotateCcw className="h-4 w-4 text-violet-400" /> A restore point first</div><p className="mt-2 text-xs leading-relaxed text-slate-500">Before changing a policy, Dialed creates a Windows restore point and checks it was made. Windows allows one restore point a day; if one was made recently, Dialed asks you before going ahead.</p></section>

      {actionError && <p className="rounded-lg border border-rose-500/30 bg-rose-950/30 p-3 text-xs text-rose-200"><ErrorText text={actionError} /></p>}
      {errors.length > 0 && <section className="rounded-2xl border border-amber-500/30 bg-amber-950/20 p-5"><div className="flex items-center gap-2 text-sm font-semibold text-amber-300"><AlertTriangle className="h-4 w-4" /> Some policies could not be read</div><ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-amber-100/80">{errors.map((error) => <li key={`${error.component}-${error.message}`}>{partName(error.component)}: <ErrorText text={error.message} /></li>)}</ul></section>}

      <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-xs">
        <div className="mb-2 flex flex-wrap gap-2">
          <label className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950/50 px-2 py-1.5 text-slate-300">
            <Search className="h-3.5 w-3.5 text-slate-400" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search policies" className="w-64 bg-transparent outline-none placeholder:text-slate-500" />
          </label>
          <label className="text-[11px] text-slate-400">
            <div className="mb-1 flex items-center gap-1"><Filter className="h-3 w-3" /> Policy state</div>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | 'enabled' | 'disabled' | 'invalid' | 'unsupported')} className="rounded border border-slate-700 bg-slate-950/50 px-2 py-1 text-xs text-slate-100">
              <option value="all">All</option>
              <option value="enabled">Enabled</option>
              <option value="disabled">Not configured</option>
              <option value="invalid">No value</option>
              <option value="unsupported">Set to an unexpected value</option>
            </select>
          </label>
          <label className="text-[11px] text-slate-400">
            <div className="mb-1">Sort</div>
            <select value={sortMode} onChange={(event) => setSortMode(event.target.value as 'name' | 'enabled' | 'revert')} className="rounded border border-slate-700 bg-slate-950/50 px-2 py-1 text-xs text-slate-100">
              <option value="name">Name</option>
              <option value="enabled">Enabled first</option>
              <option value="revert">Value present</option>
            </select>
          </label>
        </div>
        <p role="status" aria-live="polite" aria-atomic="true" className="text-slate-500">
          Showing <span className="font-semibold text-slate-200">{visiblePolicies.length}</span> of <span className="font-semibold text-slate-200">{policies.length}</span> policies.
        </p>
      </section>

      {loading ? <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 text-sm text-slate-400">Reading…</section> : visiblePolicies.map((policy) => {
        const active = activePolicyId === policy.id;
        const unsupportedValue = policy.valueExists && policy.valueKind !== 'DWord';
        return <section key={policy.id} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-xl"><div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-slate-100">{policy.title}</h3><span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-bold text-amber-300">Risk: {policy.risk}</span>{policy.enabled && <span className="inline-flex items-center gap-1 rounded bg-cyan-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-cyan-300"><CheckCircle2 className="h-3 w-3" />Already configured</span>}
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">{policy.description}</p>
            <dl data-technical-detail className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
              <PolicyDetail label="Windows policy value" value="HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\CloudContent\\DisableWindowsConsumerFeatures" />
              <PolicyDetail label="Current state" value={policy.enabled ? 'DWORD 1 (enabled)' : policy.valueExists ? `${policy.valueKind || 'Unknown'} ${policy.value ?? ''}` : 'Not configured'} />
            </dl>
          </div>
          <button onClick={() => onEnable(policy)} disabled={active || policy.enabled || unsupportedValue} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-cyan-400 px-3 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"><ShieldCheck className="h-3.5 w-3.5" /> {active ? 'Applying…' : policy.enabled ? 'Already configured' : unsupportedValue ? 'Set to an unexpected value' : 'Apply'}</button>
        </div></section>;
      })}
      {!loading && visiblePolicies.length === 0 && <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-6 text-sm text-slate-500">Nothing matches these filters.</section>}
      {!loading && policies.length === 0 && <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 text-sm text-slate-500">Windows did not return any policies.</section>}
    </div>
  );
}

function PolicyDetail({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-slate-950/50 p-2"><dt className="text-slate-500">{label}</dt><dd className="mt-1 break-all text-slate-300">{value}</dd></div>;
}
