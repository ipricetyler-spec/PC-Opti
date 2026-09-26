import { ErrorText } from './ErrorText';
import { sessionCaptureIds, type ExperimentSession } from '../lib/experimentSessions';
import { ArrowDownWideNarrow, ArrowUpWideNarrow, BarChart3, FileUp, LoaderCircle, Search, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { BenchmarkComparison, BenchmarkEvidenceState, BenchmarkImportPreview, BenchmarkRecord, PresentMonImportMetadata, PresentMonImportSourceSummary, SystemScanSnapshot } from '../types';
import { computeFrameTimeStats, downsampleFrameTimes } from '../lib/frameTimeStats';
import { plainLabel } from '../lib/plainLabels';
import { compareHardwareConditions, formatMetricValue } from '../lib/telemetry';
import type { TelemetryView } from '../types';
import { NativePresentMonCapture } from './NativePresentMonCapture';
import { ShowDetails } from './ShowDetails';

interface BenchmarkEvidenceProps {
  snapshot?: SystemScanSnapshot | null;
  focusedExperimentId?: string | null;
  sessionContext?: ExperimentSession | null;
  evidence: BenchmarkEvidenceState;
  loading: boolean;
  error: string | null;
  presentMonImport: { token: string; sources: PresentMonImportSourceSummary[] } | null;
  onRefresh: () => void;
  onImport: () => void;
  onNativeImportPreview: (preview: BenchmarkImportPreview) => void;
  onPreparePresentMonImport: (metadata: PresentMonImportMetadata) => void;
  onCancelPresentMonImport: () => void;
  onDelete: (experimentId: string) => void;
}

export const PRESENTMON_CONDITIONS = [
  ['osBuild', 'OS build'],
  ['powerMode', 'Power mode'],
  ['appVersion', 'Application version'],
  ['graphicsPreset', 'Graphics preset'],
  ['resolution', 'Resolution'],
  ['scene', 'Scene or replay'],
  ['duration', 'Capture duration'],
  ['warmup', 'Warm-up procedure'],
  ['backgroundWorkload', 'Background workload'],
  ['driverVersion', 'Graphics driver version'],
  ['ambientNotes', 'Ambient limitations'],
] as const;

const INPUT_CLASS = 'mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 outline-none focus:border-violet-400';

function number(value: number | undefined, digits = 3) {
  return value === undefined || !Number.isFinite(value) ? 'not available' : value.toFixed(digits).replace(/\.0+$/, '');
}

function classificationClass(classification: BenchmarkComparison['classification']) {
  if (classification === 'REGRESSION') return 'border-rose-500/30 bg-rose-950/20 text-rose-200';
  if (classification === 'MEASURED_DIFFERENCE') return 'border-emerald-500/25 bg-emerald-950/10 text-emerald-200';
  if (classification === 'INCONCLUSIVE' || classification === 'HIGH_VARIANCE') return 'border-amber-500/25 bg-amber-950/10 text-amber-200';
  return 'border-slate-700 bg-slate-950/50 text-slate-300';
}

function comparisonTimestamp(comparison: BenchmarkComparison) {
  const timestamps = [comparison.baseline?.capturedAt, comparison.candidate?.capturedAt]
    .filter((value): value is string => Boolean(value))
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value));
  if (timestamps.length === 0) return 0;
  return Math.max(...timestamps);
}

type ComparisonClassification = BenchmarkComparison['classification'];

export function BenchmarkEvidence({ snapshot = null, focusedExperimentId, sessionContext, evidence, loading, error, presentMonImport, onRefresh, onImport, onNativeImportPreview, onPreparePresentMonImport, onCancelPresentMonImport, onDelete }: BenchmarkEvidenceProps) {
  const summary = useMemo(() => {
    const classes = {
      measured: 0,
      regression: 0,
      incomparable: 0,
      highVariance: 0,
      inconclusive: 0,
      incomplete: 0,
      stable: 0,
    };
    for (const comparison of evidence.comparisons) {
      if (comparison.classification === 'MEASURED_DIFFERENCE') classes.measured += 1;
      else if (comparison.classification === 'REGRESSION') classes.regression += 1;
      else if (comparison.classification === 'INCOMPARABLE') classes.incomparable += 1;
      else if (comparison.classification === 'HIGH_VARIANCE') classes.highVariance += 1;
      else if (comparison.classification === 'INCONCLUSIVE') classes.inconclusive += 1;
      else classes.incomplete += 1;
      if (comparison.classification === 'MEASURED_DIFFERENCE' || comparison.classification === 'REGRESSION') classes.stable += 1;
    }
    return classes;
  }, [evidence.comparisons]);

  const [captureReadings, setCaptureReadings] = useState<Map<string, TelemetryView | null>>(new Map());
  useEffect(() => {
    const native = window.pcOptiNative;
    if (!native?.getPresentMonCaptureState) return;
    let current = true;
    void native.getPresentMonCaptureState().then((state) => {
      if (current) setCaptureReadings(new Map(state.entries.map((entry) => [entry.captureId, entry.telemetry?.status === 'RECORDED' ? entry.telemetry.view : null])));
    }).catch(() => undefined);
    return () => { current = false; };
  }, [evidence.records.length]);
  const [query, setQuery] = useState('');
  useEffect(() => { setQuery(focusedExperimentId || ''); setClassificationFilter('all'); }, [focusedExperimentId]);
  const [classificationFilter, setClassificationFilter] = useState<'all' | ComparisonClassification>('all');
  const [sortMode, setSortMode] = useState<'recent' | 'oldest' | 'experimentId'>('recent');

  const filteredComparisons = useMemo(() => {
    const filtered = evidence.comparisons.filter((comparison) => {
      if (classificationFilter !== 'all' && comparison.classification !== classificationFilter) return false;
      if (!query.trim()) return true;
      const terms = query.trim().toLowerCase();
      return comparison.experimentId.toLowerCase().includes(terms)
        || comparison.reason.toLowerCase().includes(terms)
        || comparison.classification.toLowerCase().includes(terms)
        || (comparison.scopeWarning ?? '').toLowerCase().includes(terms)
        || (comparison.rollbackGuidance?.reason ?? '').toLowerCase().includes(terms);
    });
    if (sortMode === 'experimentId') {
      filtered.sort((left, right) => left.experimentId.localeCompare(right.experimentId));
    } else {
      filtered.sort((left, right) => sortMode === 'recent' ? comparisonTimestamp(right) - comparisonTimestamp(left) : comparisonTimestamp(left) - comparisonTimestamp(right));
    }
    return filtered;
  }, [classificationFilter, evidence.comparisons, query, sortMode]);

  const clearFilters = () => {
    setQuery('');
    setClassificationFilter('all');
    setSortMode('recent');
  };

  return <div className="space-y-6">
    <NativePresentMonCapture onImportPreview={onNativeImportPreview} />

    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2 text-violet-300"><BarChart3 className="h-5 w-5" /><span className="text-sm font-semibold">Results</span></div>
          <h2 className="mt-2 text-xl font-bold text-white">Did it help?</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-400">Your before-and-after results. Dialed only calls something an improvement when the difference is bigger than the normal run-to-run wobble. You can also import results from another benchmark tool.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={onRefresh} disabled={loading} className="rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 disabled:opacity-60">Refresh</button>
          <button onClick={onImport} disabled={loading} className="inline-flex items-center gap-2 rounded-lg bg-violet-400 px-3.5 py-2 text-xs font-bold text-slate-950 disabled:opacity-60">{loading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <FileUp className="h-3.5 w-3.5" />}Import results</button>
        </div>
      </div>
            <details data-technical-detail className="mt-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-xs text-slate-400">
        <summary className="cursor-pointer font-semibold text-slate-300">Import file format</summary>
        <p className="mt-2 leading-relaxed">JSON uses <code>schemaVersion: "1.0.0"</code> and a <code>records</code> array. CSV uses one row per sample. Each baseline/candidate needs at least three samples and the fields experimentId, phase, workload, tool, toolVersion, metric, unit, direction, variant, changeDescription, capturedAt, plus every recorded condition. An optional linkedAuditEntryId may connect a regression to rollback evidence.</p>
      </details>
      {error && <p className="mt-4 rounded-lg border border-rose-500/30 bg-rose-950/30 p-3 text-xs text-rose-200"><ErrorText text={error} /></p>}
    </section>

    {evidence.comparisons.length > 0 && <ShowDetails label="Filter results and see totals" defaultOpen={query.trim() !== '' || classificationFilter !== 'all'}>
      <div className="space-y-4">
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="inline-flex min-w-[220px] flex-1 gap-2 rounded-lg border border-slate-700 bg-slate-950/50 px-2 py-2 text-xs text-slate-300">
          <Search className="mt-0.5 h-3.5 w-3.5 text-slate-400" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} className="w-full bg-transparent outline-none placeholder:text-slate-500" placeholder="Search results" />
        </label>
        <label className="text-xs">
          <span className="mb-1 block text-slate-400">Result</span>
          <select value={classificationFilter} onChange={(event) => setClassificationFilter(event.target.value as 'all' | ComparisonClassification)} className="min-w-[14rem] rounded-lg border border-slate-700 bg-slate-950/50 px-2 py-2 text-slate-100">
            <option value="all">All results</option>
            <option value="MEASURED_DIFFERENCE">It helped</option>
            <option value="REGRESSION">Regression</option>
            <option value="INCONCLUSIVE">No clear difference</option>
            <option value="INCOMPLETE">Incomplete</option>
            <option value="INCOMPARABLE">Not comparable</option>
            <option value="HIGH_VARIANCE">Too inconsistent</option>
          </select>
        </label>
        <label className="text-xs">
          <span className="mb-1 block text-slate-400">Sort</span>
          <button onClick={() => setSortMode(sortMode === 'recent' ? 'oldest' : sortMode === 'oldest' ? 'experimentId' : 'recent')} className="inline-flex min-w-[12rem] items-center gap-2 rounded-lg border border-slate-700 bg-slate-950/50 px-2 py-2 text-xs text-slate-100">
            {sortMode === 'recent' ? <><ArrowDownWideNarrow className="h-3.5 w-3.5" />Newest first</> : sortMode === 'oldest' ? <><ArrowUpWideNarrow className="h-3.5 w-3.5" />Oldest first</> : <>Name A→Z</>}
          </button>
        </label>
        <button onClick={clearFilters} className="rounded-lg border border-slate-700 bg-slate-950/60 px-2 py-2 text-xs text-slate-300 disabled:opacity-50" disabled={!query && classificationFilter === 'all' && sortMode === 'recent'}><X className="h-3.5 w-3.5" /> Clear filters</button>
      </div>
      <p role="status" aria-live="polite" aria-atomic="true" className="text-xs text-slate-400">
        Showing <span className="font-semibold text-slate-100">{filteredComparisons.length}</span> of <span className="font-semibold text-slate-100">{evidence.comparisons.length}</span> results.
      </p>
    </section>

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Results" value={`${evidence.comparisons.length}`} detail={`from ${evidence.records.length} run${evidence.records.length === 1 ? '' : 's'}`} tone="neutral" />
      <MetricCard label="Clear answers" value={`${summary.stable}`} detail={`${summary.measured} helped · ${summary.regression} got worse`} tone="good" />
      <MetricCard label="No clear answer" value={`${summary.inconclusive + summary.highVariance}`} detail={`${summary.inconclusive} no clear difference · ${summary.highVariance} too inconsistent`} tone="warn" />
      <MetricCard label="Unfinished" value={`${summary.incomplete}`} detail={`${summary.incomparable} not comparable`} tone="warn" />
    </section>
      </div>
    </ShowDetails>}

    {presentMonImport && <div key={presentMonImport.token}><PresentMonImportForm snapshot={snapshot} sessionContext={sessionContext} sources={presentMonImport.sources} loading={loading} onSubmit={onPreparePresentMonImport} onCancel={onCancelPresentMonImport} /></div>}

    {filteredComparisons.map((comparison) => <ComparisonCard key={`${comparison.experimentId}-${comparison.classification}`} comparison={comparison} readings={captureReadings} onDelete={onDelete} loading={loading} />)}

    {!loading && evidence.records.length === 0 && <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-8 text-center"><BarChart3 className="mx-auto h-8 w-8 text-slate-600" /><p className="mt-3 text-sm text-slate-400">No results yet. Record a game above, or import results.</p></section>}
    {!loading && evidence.records.length > 0 && filteredComparisons.length === 0 && <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-8 text-center"><BarChart3 className="mx-auto h-8 w-8 text-slate-600" /><p className="mt-3 text-sm text-slate-400">Nothing matches these filters.</p></section>}
  </div>;
}

/** One saved before/after comparison: headline numbers, frame pacing, graph and hardware. */
export function ComparisonCard({ comparison, readings, onDelete, loading = false, title }: {
  comparison: BenchmarkComparison;
  readings: Map<string, TelemetryView | null>;
  onDelete?: (experimentId: string) => void;
  loading?: boolean;
  /** A readable name for the heading; the saved id otherwise. */
  title?: string;
}) {
  return <article className={`rounded-2xl border p-5 ${classificationClass(comparison.classification)}`}>
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{title ?? comparison.experimentId}</h3><span className="rounded bg-slate-950/50 px-2 py-0.5 text-[11px] font-bold">{plainLabel(comparison.classification)}</span></div>
          <p className="mt-2 text-xs leading-relaxed opacity-80">{comparison.reason}</p>
        </div>
        {onDelete && <button onClick={() => onDelete(comparison.experimentId)} disabled={loading} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-rose-200 disabled:opacity-50"><Trash2 className="h-3 w-3" />Delete</button>}
      </div>
      {comparison.baseline && comparison.candidate && <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Before (average)" value={`${number(comparison.baselineStats?.mean)} ${comparison.baseline.unit}`} detail={`${comparison.baseline.samples.length} samples · middle value ${number(comparison.baselineStats?.median)}`} />
        <Metric label="After (average)" value={`${number(comparison.candidateStats?.mean)} ${comparison.candidate.unit}`} detail={`${comparison.candidate.samples.length} samples · middle value ${number(comparison.candidateStats?.median)}`} />
        <Metric label="Change" value={`${number(comparison.favorableDeltaPercent, 2)}%`} detail="Above zero means better" />
        <Metric label="Normal wobble" value={`${number(comparison.variabilityPercent, 2)}%`} detail={comparison.sampleUnit === 'TRIAL' ? 'How much your runs varied on their own' : 'Variation within one recording; record more runs for a firmer answer'} />
      </div>}
      {comparison.baseline && comparison.candidate && comparison.sampleUnit !== 'TRIAL' && <FrameTimeDetails baseline={comparison.baseline} candidate={comparison.candidate} />}
      {comparison.baseline && comparison.candidate && <HardwareConditions baseline={comparison.baseline} candidate={comparison.candidate} readings={readings} />}
      {comparison.decisionRule && <p className="mt-3 text-xs text-slate-400">{comparison.decisionRule}</p>}
      {comparison.scopeWarning && <p className="mt-4 rounded-lg bg-slate-950/40 p-3 text-[11px] leading-relaxed text-slate-400">{comparison.scopeWarning}</p>}
        {comparison.rollbackGuidance && <p className={`mt-3 rounded-lg border p-3 text-[11px] leading-relaxed ${comparison.rollbackGuidance.available ? 'border-amber-500/30 bg-amber-950/20 text-amber-100' : 'border-slate-700 bg-slate-950/40 text-slate-400'}`}>{comparison.rollbackGuidance.reason}</p>}
      <details data-technical-detail className="mt-4 rounded-xl border border-slate-700/70 bg-slate-950/40 p-3">
        <summary className="cursor-pointer text-xs font-semibold text-slate-300">Raw numbers and test conditions</summary>
        <pre className="mt-3 max-h-80 overflow-auto text-[11px] leading-relaxed text-slate-400">{JSON.stringify({ baseline: comparison.baseline, candidate: comparison.candidate, statistics: { baseline: comparison.baselineStats, candidate: comparison.candidateStats }, conditionMismatches: comparison.conditionMismatches }, null, 2)}</pre>
      </details>
    </article>;
}

function MetricCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: 'good' | 'warn' | 'neutral' }) {
  const toneClass = tone === 'good'
    ? 'border-emerald-500/25 bg-emerald-950/10 text-emerald-100'
    : tone === 'warn'
      ? 'border-amber-500/25 bg-amber-950/10 text-amber-100'
      : 'border-slate-700 bg-slate-950/50 text-slate-300';
  return <article className={`rounded-xl border p-3 ${toneClass}`}>
    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-2 text-lg font-bold">{value}</p>
    <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{detail}</p>
  </article>;
}

function FrameTimeDetails({ baseline, candidate }: { baseline: BenchmarkRecord; candidate: BenchmarkRecord }) {
  const before = computeFrameTimeStats(baseline.samples, baseline.unit);
  const after = computeFrameTimeStats(candidate.samples, candidate.unit);
  if (!before || !after) return null;
  const rows: Array<[string, number, number, 'higher' | 'lower', number, string]> = [
    ['Average FPS', before.averageFps, after.averageFps, 'higher', 1, ''],
    ['1% low FPS', before.onePercentLowFps, after.onePercentLowFps, 'higher', 1, ''],
    ['0.1% low FPS', before.pointOnePercentLowFps, after.pointOnePercentLowFps, 'higher', 1, ''],
    ['95th percentile frame time', before.p95Ms, after.p95Ms, 'lower', 2, ' ms'],
    ['99th percentile frame time', before.p99Ms, after.p99Ms, 'lower', 2, ' ms'],
    ['Stutters (over 2× median frame time)', before.stutterCount, after.stutterCount, 'lower', 0, ''],
  ];
  const ceiling = Math.max(before.p999Ms, after.p999Ms) * 1.25;
  const line = (samples: number[]) => {
    const points = downsampleFrameTimes(samples, 300);
    return points.map((value, index) => `${index === 0 ? 'M' : 'L'}${((index / Math.max(1, points.length - 1)) * 600).toFixed(1)},${(165 - (Math.min(value, ceiling) / ceiling) * 155).toFixed(1)}`).join(' ');
  };
  return <div className="mt-4 rounded-xl border border-slate-700/70 bg-slate-950/40 p-3">
    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Frame pacing</p>
    <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[24rem] text-left text-xs"><thead className="text-slate-500"><tr><th className="py-1 font-semibold">Measure</th><th className="py-1 font-semibold">Before</th><th className="py-1 font-semibold">After</th></tr></thead><tbody>{rows.map(([label, left, right, better, digits, unit]) => {
      const improved = better === 'higher' ? right > left : right < left;
      return <tr key={label} className="border-t border-slate-800"><td className="py-1.5 pr-3 text-slate-400">{label}</td><td className="py-1.5 pr-3 text-slate-200">{left.toFixed(digits)}{unit}</td><td className={`py-1.5 font-semibold ${left.toFixed(digits) === right.toFixed(digits) ? 'text-slate-200' : improved ? 'text-emerald-300' : 'text-amber-300'}`}>{right.toFixed(digits)}{unit}</td></tr>;
    })}</tbody></table></div>
    <svg viewBox="0 0 600 170" role="img" aria-label="Frame time across each capture, before and after" className="mt-3 h-40 w-full" preserveAspectRatio="none"><path d={line(baseline.samples)} fill="none" stroke="var(--app-chart-idle)" strokeWidth="1.2" /><path d={line(candidate.samples)} fill="none" stroke="var(--app-chart-loaded)" strokeWidth="1.2" /></svg>
    <p className="mt-1 text-[11px] text-slate-500"><span style={{ color: 'var(--app-chart-idle)' }}>Before</span> · <span style={{ color: 'var(--app-chart-loaded)' }}>After</span> · taller spikes are slower frames.</p>
  </div>;
}

function HardwareConditions({ baseline, candidate, readings }: { baseline: BenchmarkRecord; candidate: BenchmarkRecord; readings: Map<string, TelemetryView | null> }) {
  const before = (baseline.trialIds || []).map((id) => readings.get(id) ?? null);
  const after = (candidate.trialIds || []).map((id) => readings.get(id) ?? null);
  const result = compareHardwareConditions(before, after);
  if (!result.rows.length) return null;
  return <div className="mt-4 rounded-xl border border-slate-700/70 bg-slate-950/40 p-3">
    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Hardware during these captures</p>
    <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[24rem] text-left text-xs"><thead className="text-slate-500"><tr><th className="py-1 pr-3 font-semibold">Reading (average)</th><th className="py-1 pr-3 font-semibold">Before</th><th className="py-1 pr-3 font-semibold">After</th><th className="py-1 font-semibold">Note</th></tr></thead><tbody>{result.rows.map((row) => <tr key={row.key} className="border-t border-slate-800">
      <td className="py-1.5 pr-3 text-slate-400">{row.label}</td>
      <td className="py-1.5 pr-3 text-slate-200">{formatMetricValue(row.baselineMean, row.unit)}<span data-technical-detail className="text-slate-500"> ({row.baselineRuns} run{row.baselineRuns === 1 ? '' : 's'})</span></td>
      <td className="py-1.5 pr-3 text-slate-200">{formatMetricValue(row.candidateMean, row.unit)}<span data-technical-detail className="text-slate-500"> ({row.candidateRuns} run{row.candidateRuns === 1 ? '' : 's'})</span></td>
      <td className={`py-1.5 ${row.flagged ? 'font-semibold text-amber-300' : 'text-slate-500'}`}>{row.flagged ? 'Conditions differed' : ''}</td>
    </tr>)}</tbody></table></div>
    {result.limitWarning && <p className="mt-2 text-[11px] leading-relaxed text-amber-200">{result.limitWarning}</p>}
    <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{result.canFlag ? 'Readings that changed noticeably between before and after are marked.' : 'Record 3 or more runs on each side to mark readings that changed.'} If temperature or clock speed changed a lot, that may explain part of the result.</p>
  </div>;
}

function conditionPrefill(snapshot?: SystemScanSnapshot | null): Record<string, string> {
  if (!snapshot) return {};
  const graphics = snapshot.diagnostics.graphics.status === 'AVAILABLE' ? snapshot.diagnostics.graphics.value[0] : null;
  return {
    osBuild: `${snapshot.metrics.os.caption} build ${snapshot.metrics.os.build}`.trim(),
    powerMode: snapshot.diagnostics.powerScheme.status === 'AVAILABLE' ? snapshot.diagnostics.powerScheme.value.name : '',
    driverVersion: graphics ? `${graphics.name} ${graphics.driverVersion}`.trim() : '',
  };
}

/** The answers the import form starts with: taken from the linked test session and the
 *  latest scan. A test fills the remaining conditions itself. */
export function defaultPresentMonMetadata(snapshot: SystemScanSnapshot | null | undefined, sessionContext: ExperimentSession | null | undefined, sources: PresentMonImportSourceSummary[]): PresentMonImportMetadata {
  return {
    experimentId: sessionContext?.id || '',
    workload: sessionContext?.workload || '',
    toolVersion: sources.length > 0 && sources.every((source) => source.toolVersion && source.toolVersion === sources[0].toolVersion) ? sources[0].toolVersion || '' : '',
    changeDescription: sessionContext?.changeDescription || '',
    conditions: Object.fromEntries(PRESENTMON_CONDITIONS.map(([field]) => [field, conditionPrefill(snapshot)[field] || ''])),
    runs: sources.map((source, index) => ({
      sourceId: source.sourceId,
      phase: (sessionContext ? sessionCaptureIds(sessionContext, 'candidate').includes(source.sourceId) : index >= sources.length / 2) ? 'CANDIDATE' : 'BASELINE',
      application: source.applications[0]?.application || '',
      variant: (sessionContext ? sessionCaptureIds(sessionContext, 'candidate').includes(source.sourceId) : index >= sources.length / 2) ? 'After' : 'Before',
      capturedAt: source.capturedAt,
      notes: sessionContext?.changeMode === 'MANUAL' ? `User-declared manual change at ${sessionContext.manualChangedAt}. Not verified by Dialed; no automatic restore.` : '',
      linkedAuditEntryId: (sessionContext && sessionCaptureIds(sessionContext, 'candidate').includes(source.sourceId)) ? sessionContext.auditId || null : null,
    })),
  };
}

function PresentMonImportForm({
  snapshot,
  sessionContext,
  sources,
  loading,
  onSubmit,
  onCancel,
}: {
  snapshot?: SystemScanSnapshot | null;
  sessionContext?: ExperimentSession | null;
  sources: PresentMonImportSourceSummary[];
  loading: boolean;
  onSubmit: (metadata: PresentMonImportMetadata) => void;
  onCancel: () => void;
}) {
  const [metadata, setMetadata] = useState<PresentMonImportMetadata>(() => defaultPresentMonMetadata(snapshot, sessionContext, sources));

  const updateRun = (index: number, update: Partial<PresentMonImportMetadata['runs'][number]>) => {
    setMetadata((current) => ({
      ...current,
      runs: current.runs.map((run, runIndex) => runIndex === index ? { ...run, ...update, ...(update.phase && ['Before', 'After'].includes(run.variant) ? { variant: update.phase === 'BASELINE' ? 'Before' : 'After' } : {}), linkedAuditEntryId: (update.phase || run.phase) === 'CANDIDATE' ? sessionContext?.auditId || null : null } : run),
    }));
  };

  return <form className="rounded-2xl border border-violet-500/30 bg-violet-950/10 p-5" onSubmit={(event) => { event.preventDefault(); onSubmit(metadata); }}>
    <h3 className="font-semibold text-violet-200">Describe what you tested</h3>
    <p className="mt-1 text-xs leading-relaxed text-slate-400">Say which recordings are before and which are after, and what you changed. Every run should be the same game and scene.</p>
    <div className="mt-4 grid gap-3 md:grid-cols-2">
      <TextField label="Test name" value={metadata.experimentId} onChange={(value) => setMetadata({ ...metadata, experimentId: value })} placeholder="game-scene-change-01" />
      <TextField label="Workload" value={metadata.workload} onChange={(value) => setMetadata({ ...metadata, workload: value })} placeholder="Scene (for example: Range, bot drill)" />
      <TextField label="PresentMon version" value={metadata.toolVersion} onChange={(value) => setMetadata({ ...metadata, toolVersion: value })} placeholder="Filled in from the capture tool when known" />
      <TextField label="What you changed" value={metadata.changeDescription} onChange={(value) => setMetadata({ ...metadata, changeDescription: value })} placeholder="One change only, e.g. Multithreaded rendering on" />
    </div>
    <div className="mt-5 grid gap-4 lg:grid-cols-2">
      {sources.map((source, index) => {
        const run = metadata.runs[index];
        const selectedApplication = source.applications.find((item) => item.application === run.application);
        return <fieldset key={source.sourceId} className="rounded-xl border border-slate-700 bg-slate-950/50 p-4">
          <legend className="px-1 text-xs font-semibold text-slate-200">{`Capture ${index + 1} · ${run.phase.toLowerCase()}`}</legend>
          <p data-technical-detail className="break-all text-[11px] text-slate-400">{source.fileName}</p>
          <p data-technical-detail className="mt-1 text-[11px] text-slate-500">{source.metricColumn} ({source.unit}) · {selectedApplication?.sampleCount ?? 0} samples · {source.unavailableFrameCount} unavailable rows skipped</p>
          <label className="mt-3 block text-[11px] font-medium text-slate-400">Phase<select className={INPUT_CLASS} value={run.phase} onChange={(event) => updateRun(index, { phase: event.target.value as 'BASELINE' | 'CANDIDATE' })}><option value="BASELINE">BASELINE</option><option value="CANDIDATE">CANDIDATE</option></select></label>
          <label className="mt-3 block text-[11px] font-medium text-slate-400">Application<select className={INPUT_CLASS} value={run.application} onChange={(event) => updateRun(index, { application: event.target.value })}>{source.applications.map((application) => <option key={application.application} value={application.application}>{application.application} · {application.sampleCount} samples</option>)}</select></label>
          <TextField label="Variant" value={run.variant} onChange={(value) => updateRun(index, { variant: value })} />
          <TextField label="Captured at (ISO timestamp)" value={run.capturedAt} onChange={(value) => updateRun(index, { capturedAt: value })} />
          <TextField label="Run notes (optional)" value={run.notes} onChange={(value) => updateRun(index, { notes: value })} required={false} />
        </fieldset>;
      })}
    </div>
    <h4 className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">Were these the same for every run?</h4><p className="mt-2 text-xs text-slate-400">Windows version, power plan and graphics driver are filled in from your latest scan. Confirm nothing else changed between runs.</p>
    <div className="mt-2 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {PRESENTMON_CONDITIONS.map(([field, label]) => <div key={field}><TextField label={label} value={metadata.conditions[field]} onChange={(value) => setMetadata({ ...metadata, conditions: { ...metadata.conditions, [field]: value } })} /></div>)}
    </div>
    <div className="mt-5 flex justify-end gap-2">
      <button type="button" onClick={onCancel} disabled={loading} className="rounded-lg border border-slate-700 px-3.5 py-2 text-xs font-semibold text-slate-300 disabled:opacity-50">Cancel</button>
      <button type="submit" disabled={loading} className="inline-flex items-center gap-2 rounded-lg bg-violet-400 px-3.5 py-2 text-xs font-bold text-slate-950 disabled:opacity-50">{loading && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}Review exact import</button>
    </div>
  </form>;
}

function TextField({ label, value, onChange, placeholder, required = true }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; required?: boolean }) {
  return <label className="block text-[11px] font-medium text-slate-400">{label}<input className={INPUT_CLASS} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} required={required} /></label>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="rounded-xl border border-slate-700/70 bg-slate-950/50 p-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-2 text-sm font-bold text-slate-100">{value}</p><p className="mt-1 text-[11px] text-slate-500">{detail}</p></div>;
}
