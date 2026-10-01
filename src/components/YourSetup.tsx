import { useEffect, useState } from 'react';
import { latestMeasuredRate, readMeasuredRates } from '../lib/measuredRates';
import { savedTestLine } from '../lib/networkTestMemory';
import { yourSetupLines, type SetupSection } from '../lib/yourSetup';

/** Home's read-only summary of what is set now. Every read here changes nothing. */
export function YourSetup({ onOpen }: { onOpen: (section: SetupSection) => void }) {
  const [powerPlan, setPowerPlan] = useState<string | null | undefined>(undefined);
  const [powerPlanError, setPowerPlanError] = useState(false);
  const [appliedProfiles, setAppliedProfiles] = useState<Array<{ game: string; at: string }> | null>([]);
  const [lastNetwork, setLastNetwork] = useState<{ line: string } | null | undefined>(null);
  const [lastRate] = useState(() => latestMeasuredRate(readMeasuredRates()));
  useEffect(() => {
    const api = window.pcOptiNative;
    let live = true;
    if (api?.listPowerPlans) api.listPowerPlans()
      .then((inventory) => { if (live) setPowerPlan(inventory.items.find((plan) => plan.guid === inventory.activeGuid)?.name ?? null); })
      .catch(() => { if (live) setPowerPlanError(true); });
    else setPowerPlanError(true);
    if (api?.listGameConfigBackups) api.listGameConfigBackups()
      .then((value) => {
        if (!live) return;
        const latest = new Map<string, { game: string; at: string }>();
        for (const backup of Array.isArray(value) ? value : []) {
          if (!backup.profileUndo) continue;
          const seen = latest.get(backup.gameId);
          if (!seen || backup.createdAt > seen.at) latest.set(backup.gameId, { game: backup.profileUndo.game, at: backup.createdAt });
        }
        setAppliedProfiles([...latest.values()].sort((a, b) => b.at.localeCompare(a.at)));
      })
      .catch(() => { if (live) setAppliedProfiles(null); });
    if (api?.listNetworkQualityHistory) api.listNetworkQualityHistory()
      .then((history) => { if (live) setLastNetwork(history.status === 'READY' ? (history.entries[0] ? { line: savedTestLine(history.entries[0]) } : null) : undefined); })
      .catch(() => { if (live) setLastNetwork(undefined); });
    return () => { live = false; };
  }, []);
  const lines = yourSetupLines({ powerPlan, powerPlanError, lastRate, appliedProfiles, lastNetwork });
  return <section aria-label="Your setup" className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
    <h3 className="text-sm font-semibold text-slate-100">Your setup</h3>
    <p className="mt-1 text-xs text-slate-400">What is set now. Each line says whether it was read from Windows, measured or recorded by Dialed.</p>
    <dl className="mt-3 grid gap-2 sm:grid-cols-2">
      {lines.map((line) => <div key={line.key} className="min-w-0 rounded-lg border border-slate-800 p-3">
        <dt className="flex items-center justify-between gap-2 text-[11px] text-slate-500"><span className="font-semibold uppercase tracking-wide">{line.label}</span><span>{line.source}</span></dt>
        <dd className="mt-1 flex items-start justify-between gap-2 text-xs text-slate-200"><span className="min-w-0">{line.value}</span><button type="button" onClick={() => onOpen(line.key)} className="shrink-0 text-cyan-300 underline underline-offset-2">Open</button></dd>
      </div>)}
    </dl>
  </section>;
}
