import { BarChart3 } from 'lucide-react';

interface TechnicalDetailsSettingProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}

export function TechnicalDetailsSetting({ enabled, onChange }: TechnicalDetailsSettingProps) {
  return <section className="mb-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-xl">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
      <div className="flex items-start gap-3">
        <div className="rounded-lg border border-violet-400/20 bg-violet-400/10 p-2 text-violet-300"><BarChart3 className="h-5 w-5" /></div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-violet-300">Display detail</p>
          <h2 className="mt-1 text-xl font-bold text-white">Technical details</h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-400">Show extra detail for troubleshooting: device IDs, raw numbers, file paths. Safety warnings and undo steps are always shown either way.</p>
        </div>
      </div>
      <label className="inline-flex shrink-0 cursor-pointer items-center gap-3 rounded-xl border border-slate-700 bg-slate-950/45 px-4 py-3 text-sm font-semibold text-slate-200">
        <input aria-label="Technical details" type="checkbox" checked={enabled} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-cyan-400" />
        {enabled ? 'Shown' : 'Hidden'}
      </label>
    </div>
  </section>;
}
