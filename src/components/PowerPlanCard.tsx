import { ErrorText } from './ErrorText';
import { BatteryCharging, LoaderCircle, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { PowerPlanInventory } from '../types';
import { useConfirm } from './ConfirmContext';

export function PowerPlanCard({ onChanged }: { onChanged: () => void }) {
  const confirm = useConfirm();
  const [inventory, setInventory] = useState<PowerPlanInventory | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!window.pcOptiNative?.listPowerPlans) { setError('Power plans can be changed in the Dialed desktop app.'); return; }
    setBusy(true);
    setError(null);
    try { setInventory(await window.pcOptiNative.listPowerPlans()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Windows power plans could not be read.'); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const activate = async (guid: string) => {
    const native = window.pcOptiNative;
    const target = inventory?.items.find((item) => item.guid === guid);
    const current = inventory?.items.find((item) => item.active);
    if (!native || !target || busy) return;
    const confirmed = await confirm({
      title: `Switch to ${target.name}?`,
      description: 'Windows switches to this plan. No plan is created, edited or deleted.',
      details: `From: ${current?.name || 'unknown'}\nTo: ${target.name}`,
      notice: 'Higher-performance plans can raise power use, fan noise and heat, and may not change game results. Measure before keeping it. You can restore the previous plan from Restore › Recovery & history.',
      confirmLabel: `Switch to ${target.name}`,
    });
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const result = await native.activatePowerPlan(guid);
      if (!result.success) throw new Error(result.error || 'Windows did not confirm the plan switch.');
      setStatus(`${target.name} is active and verified. Restore is available in Recovery & history.`);
      onChanged();
      setInventory(await native.listPowerPlans());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The power plan could not be switched.');
    } finally { setBusy(false); }
  };

  return <section aria-label="Power plan" className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="flex items-center gap-2 text-emerald-300"><BatteryCharging className="h-5 w-5" /><h2 className="text-sm font-semibold">Power plan</h2></div><p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-400">Switch between the plans already on this PC. Dialed records the previous plan so you can restore it exactly.</p></div>
      <button type="button" onClick={() => void refresh()} disabled={busy} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />Refresh plans</button>
    </div>
    {inventory && <ul className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{inventory.items.map((plan) => <li key={plan.guid} className={`flex items-center justify-between gap-2 rounded-lg border p-3 text-xs ${plan.active ? 'border-emerald-500/30 bg-emerald-950/15 text-emerald-100' : 'border-slate-800 bg-slate-950/40 text-slate-300'}`}>
      <span className="min-w-0 truncate font-semibold">{plan.name}</span>
      {plan.active ? <span className="shrink-0 rounded bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold text-emerald-300">Active</span> : <button type="button" onClick={() => void activate(plan.guid)} disabled={busy} className="shrink-0 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-1.5 text-[11px] font-semibold text-cyan-200 disabled:opacity-50">{busy ? <LoaderCircle className="h-3 w-3 animate-spin" /> : 'Use this plan'}</button>}
    </li>)}</ul>}
    {status && <p role="status" className="mt-3 text-xs text-emerald-200">{status}</p>}
    {error && <p role="alert" className="mt-3 text-xs text-amber-200"><ErrorText text={error} /></p>}
  </section>;
}
