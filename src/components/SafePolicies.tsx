import { AlertTriangle, CheckCircle2, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react';
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
  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-cyan-500/20 bg-gradient-to-r from-slate-900 via-slate-900 to-cyan-950/20 p-6 shadow-xl">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold text-cyan-300"><ShieldCheck className="h-3.5 w-3.5" /> Safe OS policies</div>
            <h2 className="mt-3 text-2xl font-bold text-white">Transparent, policy-based debloat</h2>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-400">Only documented Windows policy paths are offered. PC-Opti does not delete system packages, block Windows Update, disable Defender, or use generic “privacy” scripts.</p>
          </div>
          <button onClick={onRefresh} disabled={loading} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-60"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> {loading ? 'Reading policies…' : 'Refresh policy status'}</button>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 text-sm text-slate-300"><div className="flex gap-2 font-semibold text-slate-100"><RotateCcw className="h-4 w-4 text-violet-400" /> Safety checkpoint and exact rollback</div><p className="mt-2 text-xs leading-relaxed text-slate-500">Before a permanent policy change, PC-Opti requests a Windows System Restore checkpoint. If that request errors, the policy is not applied. The previous policy-value state is also kept locally for a single-click restore in Local Audit History.</p></section>

      {actionError && <p className="rounded-lg border border-rose-500/30 bg-rose-950/30 p-3 text-xs text-rose-200">{actionError}</p>}
      {errors.length > 0 && <section className="rounded-2xl border border-amber-500/30 bg-amber-950/20 p-5"><div className="flex items-center gap-2 text-sm font-semibold text-amber-300"><AlertTriangle className="h-4 w-4" /> Policy inventory limits</div><ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-amber-100/80">{errors.map((error) => <li key={`${error.component}-${error.message}`}>{error.component}: {error.message}</li>)}</ul></section>}

      {loading ? <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 text-sm text-slate-400">Reading documented Windows policy state…</section> : policies.map((policy) => {
        const active = activePolicyId === policy.id;
        const unsupportedValue = policy.valueExists && policy.valueKind !== 'DWord';
        return <section key={policy.id} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-xl"><div className="flex flex-col justify-between gap-4 md:flex-row md:items-start"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-slate-100">{policy.title}</h3><span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">Risk: {policy.risk}</span>{policy.enabled && <span className="inline-flex items-center gap-1 rounded bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-300"><CheckCircle2 className="h-3 w-3" />Already configured</span>}</div><p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">{policy.description}</p><dl className="mt-4 grid gap-2 text-xs sm:grid-cols-2"><PolicyDetail label="Windows policy value" value="HKLM\SOFTWARE\Policies\Microsoft\Windows\CloudContent\DisableWindowsConsumerFeatures" /><PolicyDetail label="Current state" value={policy.enabled ? 'DWORD 1 (enabled)' : policy.valueExists ? `${policy.valueKind || 'Unknown'} ${policy.value ?? ''}` : 'Not configured'} /></dl></div><button onClick={() => onEnable(policy)} disabled={active || policy.enabled || unsupportedValue} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-cyan-400 px-3 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"><ShieldCheck className="h-3.5 w-3.5" /> {active ? 'Applying…' : policy.enabled ? 'Already configured' : unsupportedValue ? 'Unsupported value type' : 'Apply safe policy'}</button></div></section>;
      })}
      {!loading && policies.length === 0 && <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 text-sm text-slate-500">No supported policy state was returned by Windows.</section>}
    </div>
  );
}

function PolicyDetail({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-slate-950/50 p-2"><dt className="text-slate-500">{label}</dt><dd className="mt-1 break-all text-slate-300">{value}</dd></div>;
}
