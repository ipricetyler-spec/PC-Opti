import { ErrorText } from './ErrorText';
import { ArrowRight, CheckCircle2, Cpu, HardDrive, LoaderCircle, MemoryStick, Monitor, RefreshCw, RotateCcw, TriangleAlert } from 'lucide-react';
import type { AuditHistoryRecovery, AuditJournalEntry, BenchmarkEvidenceState, LocalRecommendation, SystemScanSnapshot } from '../types';
import { graphicsAdapters } from '../lib/displaySetup';
import { TestsOnHome } from './TestsOnHome';

type Target = LocalRecommendation['targetPanel'];

export interface HomeItem {
  key: string;
  title: string;
  detail: string;
  action: string;
  target: Target;
  urgent?: boolean;
}

function gigabytes(bytes: number): string {
  return bytes >= 1024 ** 4 ? `${(bytes / 1024 ** 4).toFixed(1)} TB` : `${Math.round(bytes / 1024 ** 3)} GB`;
}

const UNFINISHED = new Set(['FAILED', 'NEEDS_REVIEW', 'PENDING', 'PENDING_REBOOT', 'UNVERIFIED']);
// Suggestions that ask for a decision or offer a fix come before information-only ones.
const PRIORITY: Record<LocalRecommendation['actionStatus'], number> = { REVIEW: 0, OPTIONAL_ACTION: 1, GUIDANCE_ONLY: 2, NO_ACTION: 3 };

/**
 * What Home asks you to do, most important first: a change that did not finish, a test
 * that showed things got worse, then the scan's suggestions. At most three are shown.
 */
export function homeItems({ snapshot, history, historyRecovery, recommendations, benchmarkEvidence }: {
  snapshot: SystemScanSnapshot | null;
  history: AuditJournalEntry[];
  historyRecovery: AuditHistoryRecovery | null;
  recommendations: LocalRecommendation[];
  benchmarkEvidence: BenchmarkEvidenceState;
}): HomeItem[] {
  const items: HomeItem[] = [];
  const unfinished = history.filter((entry) => UNFINISHED.has(entry.status));
  if (historyRecovery || unfinished.length) {
    items.push({
      key: 'unfinished',
      title: unfinished.length > 1 ? `${unfinished.length} changes did not finish` : 'A change did not finish',
      detail: 'Dialed could not confirm the result. Check it before changing anything else.',
      action: 'Check it',
      target: { id: 'history', label: 'Check it', sectionId: null, evidenceId: unfinished[0]?.id },
      urgent: true,
    });
  }
  if (!snapshot) {
    items.push({ key: 'scan', title: 'Scan this PC', detail: 'Dialed needs a scan before it can suggest anything.', action: 'Scan now', target: { id: 'overview', label: 'Scan now', sectionId: null }, urgent: true });
  }
  const worse = benchmarkEvidence.comparisons.find((item) => item.classification === 'REGRESSION');
  if (worse) {
    items.push({ key: 'regression', title: 'A change made things worse', detail: 'One of your tests measured lower performance after a change. Consider undoing it.', action: 'See the result', target: { id: 'benchmarks', label: 'See the result', sectionId: null, evidenceId: worse.experimentId }, urgent: true });
  }
  const suggestions = recommendations
    .filter((item) => item.actionStatus !== 'NO_ACTION')
    .map((item, index) => ({ item, index }))
    .sort((left, right) => PRIORITY[left.item.actionStatus] - PRIORITY[right.item.actionStatus] || left.index - right.index)
    .map(({ item }) => item);
  for (const item of suggestions) {
    items.push({ key: item.id, title: item.title, detail: item.observation, action: item.targetPanel.label, target: item.targetPanel });
  }
  return items.slice(0, 3);
}

export function HomeSummary({ snapshot, isScanning, scanError, history, historyRecovery, recommendations, benchmarkEvidence, onScan, onOpenScanDetails, onNavigate, onOpenRestore, onOpenSuggestions, onOpenTest }: {
  snapshot: SystemScanSnapshot | null;
  isScanning: boolean;
  scanError: string | null;
  history: AuditJournalEntry[];
  historyRecovery: AuditHistoryRecovery | null;
  recommendations: LocalRecommendation[];
  benchmarkEvidence: BenchmarkEvidenceState;
  onScan: () => void;
  onOpenScanDetails: () => void;
  onNavigate: (target: Target) => void;
  onOpenRestore: () => void;
  onOpenSuggestions: () => void;
  onOpenTest: () => void;
}) {
  const items = homeItems({ snapshot, history, historyRecovery, recommendations, benchmarkEvidence });
  const suggestionCount = recommendations.filter((item) => item.actionStatus !== 'NO_ACTION').length;
  const shownSuggestions = items.filter((item) => !['unfinished', 'scan', 'regression'].includes(item.key)).length;
  const undoable = history.filter((entry) => entry.rollback.available).length;
  const memory = snapshot?.metrics.memory.status === 'AVAILABLE' ? snapshot.metrics.memory.value : null;
  const drives = snapshot?.metrics.storage.status === 'AVAILABLE' ? snapshot.metrics.storage.value : [];
  const gpu = graphicsAdapters(snapshot)[0] ?? null;
  const cpu = snapshot?.metrics.cpu.status === 'AVAILABLE' ? snapshot.metrics.cpu.value : null;
  const facts: Array<{ icon: typeof Cpu; label: string; value: string; detail: string }> = snapshot ? [
    { icon: Cpu, label: 'Processor', value: cpu ? cpu.name : 'Not reported', detail: cpu ? `${cpu.cores} cores · ${cpu.logicalProcessors} threads` : '' },
    { icon: Monitor, label: 'Graphics', value: gpu?.name ?? 'Not reported', detail: gpu?.driverVersion && gpu.driverVersion !== 'Not returned' ? `Driver ${gpu.driverVersion}` : '' },
    { icon: MemoryStick, label: 'Memory', value: memory ? gigabytes(memory.totalBytes) : 'Not reported', detail: memory ? `${memory.loadPercentage}% in use` : '' },
    { icon: HardDrive, label: 'Storage', value: drives.length ? `${gigabytes(drives.reduce((sum, drive) => sum + drive.freeBytes, 0))} free` : 'Not reported', detail: drives.length ? `on ${drives.length} drive${drives.length === 1 ? '' : 's'}` : '' },
  ] : [];

  return <div className="space-y-6">
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <h2 className="text-2xl font-bold text-white">This PC</h2>
          <p className="mt-1 text-sm text-slate-400">{isScanning ? 'Scanning…' : snapshot ? `${snapshot.metrics.os.caption} · scanned ${new Date(snapshot.timestamp).toLocaleString()}` : 'Not scanned yet.'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onScan} disabled={isScanning} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 disabled:opacity-50">{isScanning ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}{snapshot ? 'Scan again' : 'Scan now'}</button>
          <button type="button" onClick={onOpenScanDetails} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3.5 py-2 text-xs font-semibold text-slate-200">Scan details<ArrowRight className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      {scanError && <p role="alert" className="mt-3 text-xs text-amber-200"><ErrorText text={scanError} /></p>}
      {facts.length > 0 && <dl className="mt-5 grid gap-3 grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))]">
        {facts.map(({ icon: Icon, label, value, detail }) => <div key={label} className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500"><Icon className="h-3.5 w-3.5" aria-hidden="true" />{label}</dt>
          <dd className="mt-1 truncate text-sm font-semibold text-slate-100" title={value}>{value}</dd>
          {detail && <dd className="text-xs text-slate-500">{detail}</dd>}
        </div>)}
      </dl>}
    </section>

    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
      <h3 className="text-base font-semibold text-slate-100">Worth doing</h3>
      {items.length ? <ul className="mt-3 divide-y divide-slate-800">
        {items.map((item) => <li key={item.key} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className={`flex items-center gap-1.5 text-sm font-semibold ${item.urgent ? 'text-amber-200' : 'text-slate-100'}`}>{item.urgent && <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />}{item.title}</p>
            <p className="mt-0.5 text-xs text-slate-400">{item.detail}</p>
          </div>
          <button type="button" onClick={() => onNavigate(item.target)} className="shrink-0 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-200">{item.action}</button>
        </li>)}
      </ul> : <p className="mt-3 flex items-center gap-2 text-sm text-emerald-200"><CheckCircle2 className="h-4 w-4" />Nothing needs your attention right now.</p>}
      {suggestionCount > shownSuggestions && <button type="button" onClick={onOpenSuggestions} className="mt-2 text-xs text-cyan-300 underline underline-offset-2">See all {suggestionCount} suggestions</button>}
    </section>

    <section className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-100"><RotateCcw className="h-4 w-4 text-cyan-300" aria-hidden="true" />Changes Dialed made</h3>
        <p className="mt-1 text-xs text-slate-400">{undoable ? `${undoable} change${undoable === 1 ? '' : 's'} can be undone.` : history.length ? 'Nothing left to undo.' : 'Dialed has not changed anything yet.'}</p>
      </div>
      <button type="button" onClick={onOpenRestore} className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200">Open Restore</button>
    </section>

    <TestsOnHome onOpen={onOpenTest} />
  </div>;
}
