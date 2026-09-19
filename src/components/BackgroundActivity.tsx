import { Activity, CheckCircle2, CircleOff } from 'lucide-react';

export function BackgroundActivity() {
  return <section className="mb-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
    <div className="flex items-start gap-3">
      <Activity className="mt-0.5 h-5 w-5 text-cyan-300" />
      <div>
        <h3 className="font-semibold text-slate-100">Background activity</h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">What Dialed runs, and when.</p>
      </div>
    </div>
    <div className="mt-4 grid gap-3 md:grid-cols-3">
      <article className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
        <p className="flex items-center gap-2 text-xs font-semibold text-slate-200"><CheckCircle2 className="h-4 w-4 text-emerald-300" />Once when Dialed opens</p>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-400">One scan of this PC. It does not repeat unless you ask.</p>
      </article>
      <article className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
        <p className="flex items-center gap-2 text-xs font-semibold text-slate-200"><Activity className="h-4 w-4 text-cyan-300" />Only while you request it</p>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-400">Network tests, input-device checks and game recordings run only when you press start, and stop when they finish.</p>
      </article>
      <article className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
        <p className="flex items-center gap-2 text-xs font-semibold text-slate-200"><CircleOff className="h-4 w-4 text-violet-300" />Never continuous</p>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-400">Nothing runs in the tray, at startup or on a schedule. Closing Dialed quits it completely.</p>
      </article>
    </div>
    <p data-technical-detail className="mt-3 text-[11px] leading-relaxed text-slate-500">While open, Dialed shows a few helper processes in Task Manager, like any desktop app. They only draw the window.</p>
  </section>;
}
