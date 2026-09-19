import { ErrorText } from './ErrorText';
import { AlertTriangle, CheckCircle2, ClipboardList, Copy, Filter, ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react';
import { useMemo, useState } from 'react';
import { computeReadinessState } from '../lib/publicExperience.js';
import type { AuditHistoryRecovery, AuditJournalEntry, BenchmarkEvidenceState, DriftReport, LocalRecommendation, SystemScanSnapshot, TimingExperiment } from '../types';

interface ReadinessCenterProps {
  compact?: boolean;
  snapshot: SystemScanSnapshot | null;
  scanError: string | null;
  recommendations: LocalRecommendation[];
  historyRecovery: AuditHistoryRecovery | null;
  history: AuditJournalEntry[];
  driftReport: DriftReport | null;
  driftError: string | null;
  benchmarkEvidence: BenchmarkEvidenceState;
  timingExperiments: TimingExperiment[];
  onOpenScan: () => void;
  onNavigateRecommendation: (target: LocalRecommendation['targetPanel']) => void;
}

type OutcomeStatus = 'PASS' | 'WARN' | 'BLOCKED' | 'UNKNOWN';

function outcomeClass(status: OutcomeStatus) {
  if (status === 'PASS') return 'border-emerald-500/25 bg-emerald-950/15 text-emerald-100/80';
  if (status === 'WARN') return 'border-amber-500/25 bg-amber-950/15 text-amber-100/80';
  if (status === 'BLOCKED') return 'border-rose-500/25 bg-rose-950/20 text-rose-100/80';
  return 'border-slate-700 bg-slate-900/60 text-slate-300';
}

function toCountMap(records: string[]) {
  return records.reduce((counts, item) => {
    const current = counts.get(item) ?? 0;
    counts.set(item, current + 1);
    return counts;
  }, new Map<string, number>());
}

function toOutcomeBadge(status: OutcomeStatus) {
  if (status === 'PASS') return 'Ready';
  if (status === 'WARN') return 'Review';
  if (status === 'BLOCKED') return 'Blocked';
  return 'Not measured';
}

export function ReadinessCenter({
  compact = false,
  snapshot,
  scanError,
  recommendations,
  historyRecovery,
  history,
  driftReport,
  driftError,
  benchmarkEvidence,
  timingExperiments,
  onOpenScan,
  onNavigateRecommendation,
}: ReadinessCenterProps) {
  const [passportStatus, setPassportStatus] = useState<string | null>(null);
  const [readinessFilter, setReadinessFilter] = useState<'All' | 'PASS' | 'WARN' | 'BLOCKED' | 'UNKNOWN'>('All');

  const antiCheatSignal = useMemo(() => {
    if (!snapshot) {
      return {
        status: 'BLOCKED' as OutcomeStatus,
        detail: 'No scan data yet; anti-cheat state is unknown.',
      };
    }
    const antiCheat = snapshot.diagnostics.antiCheat;
    if (antiCheat.status !== 'AVAILABLE') {
      return {
        status: 'WARN' as OutcomeStatus,
        detail: `${antiCheat.status.toLowerCase()} anti-cheat posture (${antiCheat.reason})`,
      };
    }
    if (antiCheat.value.length === 0) {
      return {
        status: 'PASS' as OutcomeStatus,
        detail: 'No detected anti-cheat product metadata in common Windows inventory channels.',
      };
    }
    const running = antiCheat.value.filter((item) => item.state.toLowerCase() === 'running').length;
    if (running === 0) {
      return {
        status: 'WARN' as OutcomeStatus,
        detail: `${antiCheat.value.length} anti-cheat package(s) found, but runtime state is not explicitly running.`,
      };
    }
    const installedProducts = antiCheat.value.slice(0, 3).map((item) => item.product).join(', ');
    const suffix = antiCheat.value.length > 3 ? ' and others' : '';
    return {
      status: 'WARN' as OutcomeStatus,
      detail: `${running} active anti-cheat indicator${running === 1 ? '' : 's'} detected (${installedProducts}${suffix}).`,
    };
  }, [snapshot]);

  const recommendationCounts = useMemo(() => {
    return {
      total: recommendations.length,
      optional: recommendations.filter((item) => item.actionStatus === 'OPTIONAL_ACTION').length,
      review: recommendations.filter((item) => item.actionStatus === 'REVIEW').length,
      guidanceOnly: recommendations.filter((item) => item.actionStatus === 'GUIDANCE_ONLY').length,
      noAction: recommendations.filter((item) => item.actionStatus === 'NO_ACTION').length,
    };
  }, [recommendations]);

  const historyCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of history) {
      const status = entry.status === 'NEEDS_REVIEW' ? 'NEEDS_REVIEW' : entry.status;
      const current = map.get(status) ?? 0;
      map.set(status, current + 1);
    }
    const unresolvedEntries = history.filter((entry) => (
      entry.status === 'NEEDS_REVIEW'
      || entry.status === 'PENDING'
      || entry.reconciliation?.classification === 'UNKNOWN'
      || entry.reconciliation?.classification === 'UNAVAILABLE'
    ));
    return {
      total: history.length,
      success: map.get('SUCCESS') ?? 0,
      failed: map.get('FAILED') ?? 0,
      needsReview: map.get('NEEDS_REVIEW') ?? 0,
      pending: map.get('PENDING') ?? 0,
      rollbackAvailable: history.filter((entry) => entry.rollback.available).length,
      unresolved: unresolvedEntries.length,
    };
  }, [history]);

  const benchmarkCounts = useMemo(() => {
    const counts = toCountMap(benchmarkEvidence.comparisons.map((comparison) => comparison.classification));
    return {
      total: benchmarkEvidence.comparisons.length,
      measured: (counts.get('MEASURED_DIFFERENCE') ?? 0) + (counts.get('REGRESSION') ?? 0),
      incomplete: counts.get('INCOMPLETE') ?? 0,
      inconclusive: counts.get('INCONCLUSIVE') ?? 0,
      highVariance: counts.get('HIGH_VARIANCE') ?? 0,
    };
  }, [benchmarkEvidence.comparisons]);

  const timingSummary = useMemo(() => {
    return {
      total: timingExperiments.length,
      actionable: timingExperiments.filter((entry) => entry.availability === 'APPLICABLE').length,
      configurable: timingExperiments.filter((entry) => Boolean(entry.actionId)).length,
      researchOnly: timingExperiments.filter((entry) => entry.availability === 'RESEARCH_ONLY').length,
    };
  }, [timingExperiments]);

  const readinessOutcome = useMemo(() => {
    const result = computeReadinessState({
      hasSnapshot: Boolean(snapshot),
      scanError: Boolean(scanError),
      historyRecovery: historyRecovery !== null,
      unresolvedHistory: historyCounts.failed + historyCounts.needsReview + historyCounts.unresolved,
      driftError: Boolean(driftError),
      antiCheatStatus: antiCheatSignal.status,
      reviewRecommendations: recommendationCounts.review,
      benchmarkComparisons: benchmarkEvidence.comparisons,
    });
    const status: OutcomeStatus = result.state === 'Ready' ? 'PASS' : result.state === 'Review' ? 'WARN' : 'BLOCKED';
    return {
      status,
      state: result.state,
      reasons: [...result.blockers, ...result.reviewItems],
      message: result.state === 'Ready'
        ? 'Everything checks out. Nothing needs your attention.'
        : result.state === 'Review'
          ? 'A few things are worth a look:'
          : 'Dialed needs something before it can make changes:',
    };
  }, [antiCheatSignal.status, benchmarkEvidence.comparisons, driftError, historyCounts.failed, historyCounts.needsReview, historyCounts.unresolved, historyRecovery, recommendationCounts.review, scanError, snapshot]);

  const nextActions = useMemo(() => {
    const actions: { label: string; target: LocalRecommendation['targetPanel'] }[] = [];
    const add = (label: string, id: LocalRecommendation['targetPanel']['id'], destination: string, evidenceId?: string) => actions.push({ label, target: { id, label: destination, sectionId: null, evidenceId } });
    if (historyRecovery || historyCounts.failed || historyCounts.needsReview || historyCounts.unresolved) add('Check a change that did not finish.', 'history', 'Open Recovery & history', history.find((entry) => ['FAILED','NEEDS_REVIEW','PENDING','PENDING_REBOOT','UNVERIFIED'].includes(entry.status))?.id);
    if (!snapshot) add('Scan this PC.', 'overview', 'Open scan details');
    if (benchmarkEvidence.comparisons.some((item) => item.classification === 'REGRESSION' || item.classification === 'INCOMPLETE')) add('A performance test needs a look.', 'benchmarks', 'Open Measure', benchmarkEvidence.comparisons.find((item) => item.classification === 'REGRESSION' || item.classification === 'INCOMPLETE')?.experimentId);
    if (driftError || !driftReport?.baseline) add(driftError ? 'Your saved snapshot could not be read.' : 'Save a snapshot of this PC so Dialed can spot changes later.', 'drift', 'Open Changes');
    if (recommendations[0]) actions.push({ label: recommendations[0].title, target: recommendations[0].targetPanel });
    if (!actions.length) add('See what Dialed has changed.', 'history', 'Open Recovery & history');
    return actions;
  }, [history, benchmarkEvidence.comparisons, driftError, driftReport?.baseline, historyCounts.failed, historyCounts.needsReview, historyCounts.unresolved, historyRecovery, recommendations, snapshot]);

  const readinessSignals = {
    scanFreshness: snapshot ? `Scanned ${new Date(snapshot.timestamp).toLocaleString()}` : 'Not scanned yet',
    drift: driftReport?.baseline ? `${driftReport.changes.length} change${driftReport.changes.length === 1 ? '' : 's'} since your snapshot` : driftError ? 'Your saved snapshot could not be read' : 'No snapshot saved yet',
    recommendations: `${recommendationCounts.optional + recommendationCounts.review + recommendationCounts.guidanceOnly} suggestion${recommendationCounts.optional + recommendationCounts.review + recommendationCounts.guidanceOnly === 1 ? '' : 's'}`,
    history: `${historyCounts.total} change${historyCounts.total === 1 ? '' : 's'} recorded on this PC`,
  };

  const readinessRows: Array<{ label: string; status: OutcomeStatus; detail: string; recommendation: string }> = [
    {
      label: 'Scan',
      status: snapshot ? 'PASS' : 'BLOCKED',
      detail: readinessSignals.scanFreshness,
      recommendation: snapshot ? 'Up to date.' : 'Scan before changing anything.',
    },
    {
      label: 'Suggestions',
      status: recommendationCounts.review > 0 ? 'WARN' : recommendationCounts.total > 0 ? 'PASS' : 'UNKNOWN',
      detail: readinessSignals.recommendations,
      recommendation: recommendationCounts.review > 0
        ? 'Decide on the suggestions that need you before changing startup, policies or timing.'
        : recommendationCounts.total > 0
          ? 'Suggestions are ready in Tweaks › Recommended.'
          : 'No suggestions right now.',
    },
    {
      label: 'Change history',
      status: historyCounts.failed > 0 || historyCounts.needsReview > 0 || historyCounts.unresolved > 0 || historyRecovery ? 'WARN' : historyCounts.total > 0 ? 'PASS' : 'UNKNOWN',
      detail: `${historyCounts.success} success · ${historyCounts.failed} failed · ${historyCounts.needsReview} needs review · ${historyCounts.unresolved} unresolved`,
      recommendation: historyRecovery || historyCounts.failed > 0 || historyCounts.needsReview > 0
        ? 'Check the changes that failed or did not finish first.'
        : 'Every change is recorded and can be undone where Windows allows.',
    },
    {
      label: 'Snapshot',
      status: driftError ? 'WARN' : driftReport?.baseline ? 'PASS' : 'UNKNOWN',
      detail: readinessSignals.drift,
      recommendation: driftReport?.baseline ? 'Check what changed since your snapshot before changing more.' : 'Save a snapshot so Dialed can spot changes later.',
    },
    {
      label: 'Performance tests',
      status: benchmarkCounts.total > 0 && benchmarkEvidence.comparisons.every((item) => item.classification === 'MEASURED_DIFFERENCE') ? 'PASS' : benchmarkCounts.total > 0 ? 'WARN' : 'UNKNOWN',
      detail: `${benchmarkCounts.measured} measured · ${benchmarkCounts.incomplete} incomplete · ${benchmarkCounts.inconclusive + benchmarkCounts.highVariance} unstable`,
      recommendation: benchmarkCounts.incomplete > 0 ? 'Finish the tests that are missing runs.' : 'Results apply to this PC and game only.',
    },
    {
      label: 'Anti-cheat',
      status: antiCheatSignal.status,
      detail: antiCheatSignal.detail,
      recommendation: antiCheatSignal.status === 'BLOCKED'
        ? 'Dialed offers no game-related changes until it can check for anti-cheat.'
        : antiCheatSignal.status === 'WARN'
          ? 'Anti-cheat is running. Be careful with timing and startup experiments.'
          : 'No anti-cheat conflict found. Dialed never changes anti-cheat software.',
    },
    {
      label: 'Boot timing',
      status: timingSummary.actionable > 0 ? 'WARN' : timingSummary.total > 0 ? 'PASS' : 'UNKNOWN',
      detail: `${timingSummary.total} experiments (${timingSummary.actionable} actionable · ${timingSummary.configurable} configurable)`,
      recommendation: timingSummary.actionable > 0
        ? 'Try one timing change at a time, and measure after restarting.'
        : timingSummary.total > 0 ? 'Nothing to change right now.' : 'No timing settings found in this scan.',
    },
  ];

  const readinessRowsFiltered = useMemo(() => {
    if (readinessFilter === 'All') return readinessRows;
    return readinessRows.filter((row) => row.status === readinessFilter);
  }, [readinessFilter, readinessRows]);

  const passportText = useMemo(() => {
    const lines = [
      'Dialed Readiness Passport',
      `Generated: ${new Date().toLocaleString()}`,
      `Scan evidence: ${snapshot ? `${snapshot.metrics.os.caption} (${snapshot.metrics.os.build})` : 'Not captured'}`,
      `Scan age: ${snapshot ? new Date(snapshot.timestamp).toLocaleString() : 'N/A'}`,
      `Recommendations: ${recommendationCounts.total} total · optional ${recommendationCounts.optional} · review ${recommendationCounts.review} · guidance-only ${recommendationCounts.guidanceOnly}`,
      `History: ${historyCounts.total} records · ${historyCounts.success} success · ${historyCounts.failed} failed · ${historyCounts.needsReview} needs review · ${historyCounts.unresolved} unresolved`,
      `Rollback-capable records: ${historyCounts.rollbackAvailable}`,
      `Recovery state: ${historyRecovery ? `${historyRecovery.kind} (${historyRecovery.pendingCount ?? 'n/a'} pending)` : 'no pending recovery'}`,
      `Benchmarks: ${benchmarkEvidence.comparisons.length} comparisons · measurable ${benchmarkCounts.measured} · incomplete ${benchmarkCounts.incomplete}`,
      `Drift: ${driftReport?.baseline ? 'baseline saved' : 'baseline not saved'} · drift errors: ${driftError ? 'present' : 'none'}`,
      `Windows timing controls: ${timingSummary.total} (${timingSummary.actionable} actionable · ${timingSummary.researchOnly} research-only)`,
      'No action was taken automatically. Values were read on this PC and stay on this PC.',
    ];
    return lines.join('\n');
  }, [
    benchmarkCounts.incomplete,
    benchmarkCounts.measured,
    driftError,
    driftReport?.baseline,
    historyCounts.failed,
    historyCounts.needsReview,
    historyCounts.rollbackAvailable,
    historyCounts.success,
    historyCounts.total,
    historyCounts.unresolved,
    historyRecovery,
    recommendationCounts.guidanceOnly,
    recommendationCounts.optional,
    recommendationCounts.review,
    recommendationCounts.total,
    snapshot,
    timingSummary.actionable,
    timingSummary.researchOnly,
    timingSummary.total,
  ]);

  const copyReadinessPassport = async () => {
    try {
      await navigator.clipboard.writeText(passportText);
      setPassportStatus('Summary copied.');
    } catch {
      setPassportStatus('Copying was blocked. Turn on Technical details in Settings to show the summary, then copy it by hand.');
    }
  };


  return <div className="space-y-6">
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold text-cyan-200"><ShieldCheck className="h-3.5 w-3.5" />{compact ? 'Home' : 'Readiness center'}</div>
          <h2 className="mt-3 text-2xl font-bold text-white">{compact ? 'What to do next' : 'Is this PC ready for changes?'}</h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-400">
            {compact ? 'A short summary of this PC and the most useful next steps.' : 'One page that checks the scan, suggestions, your change history and test results before you change anything.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={onOpenScan} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700">
            <ShieldCheck className="h-3.5 w-3.5" />
            Scan details
          </button>
          {!compact && <button onClick={copyReadinessPassport} className="inline-flex items-center gap-2 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3.5 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-400/15">
            <Copy className="h-3.5 w-3.5" />Copy summary
          </button>}
        </div>
      </div>

      <div role="status" className={`mt-4 flex items-start gap-2 rounded-lg border p-3 text-xs ${snapshot ? snapshot.metadata.errors.length ? 'border-amber-500/25 bg-amber-950/15 text-amber-100/90' : 'border-emerald-500/25 bg-emerald-950/15 text-emerald-100/90' : 'border-slate-700 bg-slate-950/40 text-slate-300'}`}>
        {snapshot ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
        <span>{snapshot ? `Scanned ${new Date(snapshot.timestamp).toLocaleString()}${snapshot.metadata.errors.length ? ` · ${snapshot.metadata.errors.length} item${snapshot.metadata.errors.length === 1 ? '' : 's'} could not be read` : ''}. To scan again, open Scan details.` : 'This PC has not been scanned yet. Open Scan details to run a scan.'}</span>
      </div>

      <div className={`mt-4 rounded-lg border p-4 text-xs ${outcomeClass(readinessOutcome.status)}`}>
        <p className="font-semibold">{readinessOutcome.state === 'Ready' ? 'All good' : readinessOutcome.state === 'Review' ? 'Worth a look' : 'Needs attention'}</p>
        <p className="mt-1 text-slate-200/90">{readinessOutcome.message}</p>
        {readinessOutcome.reasons.length > 0 && <ul className="mt-2 space-y-1 text-[11px] text-slate-400">{readinessOutcome.reasons.slice(0, 3).map((reason) => <li key={reason}>• {reason}</li>)}</ul>}
      </div>

      <div className="mt-4 grid gap-3">
        <article className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Do this first</p>
          <p className="mt-2 text-sm font-semibold text-slate-100">{nextActions[0].label}</p>
          {nextActions.length > 1 ? <p className="mt-1 text-xs leading-relaxed text-slate-500">plus {nextActions.length - 1} more below</p> : null}
        </article>
      </div>

      {scanError && <p className="mt-4 rounded-lg border border-rose-500/30 bg-rose-950/30 p-3 text-xs text-rose-200"><ErrorText text={scanError} /></p>}
      {!compact && passportStatus && <p data-technical-detail className="mt-4 rounded-lg border border-slate-700 bg-slate-950/60 p-3 text-xs text-slate-200">{passportStatus}</p>}
      {!compact && <pre data-technical-detail className="mt-4 rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-[11px] leading-relaxed text-slate-400">{passportText}</pre>}
    </section>

    {compact && <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-sm font-semibold text-slate-100">Next steps</h3><p className="mt-1 text-xs text-slate-500">Based on your latest scan and history.</p></div><button onClick={() => { onNavigateRecommendation(nextActions[0].target); }}  className="inline-flex items-center gap-1.5 rounded-lg border border-violet-400/25 bg-violet-400/10 px-2.5 py-1.5 text-[11px] font-semibold text-violet-200 disabled:opacity-50"><ClipboardList className="h-3.5 w-3.5" />{nextActions[0].target.label}</button></div>
      <ul className="mt-4 grid gap-2 md:grid-cols-3">{nextActions.slice(0, 3).map((item) => <li key={item.label} className="rounded-lg border border-slate-700 bg-slate-950/40 p-3 text-xs leading-relaxed text-slate-300">{item.label}<button type="button" className="mt-3 block rounded border border-cyan-400/40 px-3 py-2 font-semibold text-cyan-200" onClick={() => onNavigateRecommendation(item.target)}>{item.target.label}</button></li>)}</ul>
    </section>}

    {!compact && <>
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <ReadinessMetric title="Scan" value={snapshot ? 'done' : 'not yet'} detail={readinessSignals.scanFreshness} tone={snapshot ? 'ok' : 'warn'} />
      <ReadinessMetric title="Suggestions" value={`${recommendationCounts.total}`} detail={readinessSignals.recommendations} tone={recommendationCounts.review > 0 ? 'warn' : 'ok'} />
      <ReadinessMetric title="Changes recorded" value={`${historyCounts.total}`} detail={readinessSignals.history} tone={historyCounts.needsReview > 0 ? 'warn' : 'ok'} />
      <ReadinessMetric title="Can be undone" value={`${historyCounts.rollbackAvailable}`} detail={`${historyCounts.success} success · ${historyCounts.failed} failed · ${historyCounts.pending} pending`} tone={historyCounts.failed > 0 ? 'warn' : 'ok'} />
      <ReadinessMetric title="Performance tests" value={`${benchmarkEvidence.records.length} runs`} detail={`${benchmarkCounts.measured} measured · ${benchmarkCounts.incomplete} incomplete · ${benchmarkCounts.inconclusive + benchmarkCounts.highVariance} unstable`} tone={benchmarkCounts.incomplete > 0 ? 'warn' : 'ok'} />
      <ReadinessMetric title="Boot timing" value={`${timingSummary.total} setting${timingSummary.total === 1 ? '' : 's'}`} detail={`${timingSummary.actionable} can be changed`} tone={timingSummary.actionable > 0 ? 'ok' : 'muted'} />
    </section>

    <section data-technical-detail className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="max-w-2xl">
          <h3 className="text-sm font-semibold text-slate-100">Checks</h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            What Dialed checked before suggesting changes. A warning never blocks you; it tells you what to look at first.
          </p>
        </div>
        <ReadinessBadge tone={antiCheatSignal.status} label={`Anti-cheat: ${toOutcomeBadge(antiCheatSignal.status)}`} />
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="block text-[11px] font-medium text-slate-400">
          <span className="mb-1 block"><Filter className="mr-1 inline h-3.5 w-3.5" />Filter rows</span>
          <select
            value={readinessFilter}
            onChange={(event) => setReadinessFilter(event.target.value as 'All' | 'PASS' | 'WARN' | 'BLOCKED' | 'UNKNOWN')}
            className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-200 outline-none focus:border-violet-400"
          >
            <option value="All">All rows</option>
            <option value="PASS">Ready</option>
            <option value="WARN">Review</option>
            <option value="BLOCKED">Blocked</option>
            <option value="UNKNOWN">Not measured</option>
          </select>
        </label>
        <p className="text-[11px] text-slate-500">{readinessRowsFiltered.length} / {readinessRows.length} rows shown</p>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {readinessRowsFiltered.map((row) => (
          <div key={row.label}>
            <ReadinessRow row={row} />
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-amber-100/80">
        <ShieldX className="mr-1 inline h-3.5 w-3.5 text-amber-300" />If Dialed cannot tell whether anti-cheat is running, it assumes it is.
      </p>
    </section>

    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">Changes since your snapshot</h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">{readinessSignals.drift}</p>
        </div>
        {driftReport?.baseline && <span className="rounded bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-300">Snapshot saved</span>}
      </div>
      {driftError && <p className="mt-3 rounded-lg border border-amber-500/25 bg-amber-950/15 p-3 text-xs text-amber-100/80"><ErrorText text={driftError} /></p>}
      {!driftError && driftReport?.baseline && <div className="mt-3 grid gap-3 md:grid-cols-2">
        <ReadinessMetric title="Changes" value={`${driftReport.changes.length}`} detail="Settings that differ from your snapshot" tone={driftReport.changes.length === 0 ? 'ok' : 'warn'} />
        <ReadinessMetric title="Snapshot" value={`Saved ${new Date(driftReport.baseline.createdAt).toLocaleDateString()}`} detail={`From scan ${new Date(driftReport.baseline.snapshotTimestamp).toLocaleDateString()}`} tone="ok" />
      </div>}
      {!driftReport?.baseline && !driftError && <p className="mt-3 rounded-lg border border-slate-700 bg-slate-950/50 p-3 text-xs text-slate-400">No snapshot saved yet. Save one in Restore › Changes.</p>}
    </section>

    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">Next steps</h3>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-500">Work through these before changing startup, policies or boot timing.</p>
        </div>
        <button onClick={() => { onNavigateRecommendation(nextActions[0].target); }}  className="inline-flex items-center gap-1.5 rounded-lg border border-violet-400/25 bg-violet-400/10 px-2.5 py-1.5 text-[11px] font-semibold text-violet-200 disabled:cursor-not-allowed disabled:opacity-50 hover:bg-violet-400/15">
          <ClipboardList className="h-3.5 w-3.5" />{nextActions[0].target.label}
        </button>
      </div>
      <ul className="mt-4 space-y-2 text-xs text-slate-300">
        {nextActions.map((item) => <li key={item.label} className="rounded-lg border border-slate-700 bg-slate-950/40 p-2">• {item.label}<button type="button" className="ml-3 underline" onClick={() => onNavigateRecommendation(item.target)}>{item.target.label}</button></li>)}
      </ul>
    </section>

    </>}
  </div>;
}

function ReadinessMetric({ title, value, detail, tone }: { title: string; value: string; detail: string; tone: 'ok' | 'warn' | 'muted' }) {
  const color = tone === 'ok' ? 'border-emerald-500/25 bg-emerald-950/15 text-emerald-100/80' : tone === 'warn' ? 'border-amber-500/25 bg-amber-950/15 text-amber-100/80' : 'border-slate-700 bg-slate-950/40 text-slate-300';
  return <article className={`rounded-xl border p-4 ${color}`}>
    <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
      {tone === 'ok' ? <CheckCircle2 className="h-3.5 w-3.5" /> : tone === 'warn' ? <AlertTriangle className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
      {title}
    </div>
    <p className="mt-2 text-xl font-bold text-slate-100">{value}</p>
    <p className="mt-1 text-xs leading-relaxed text-slate-500">{detail}</p>
  </article>;
}

function ReadinessBadge({ tone, label }: { tone: OutcomeStatus; label: string }) {
  const styles = tone === 'PASS'
    ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200'
    : tone === 'WARN'
      ? 'border-amber-400/30 bg-amber-500/10 text-amber-200'
      : tone === 'BLOCKED'
        ? 'border-rose-400/30 bg-rose-500/10 text-rose-200'
        : 'border-slate-700 bg-slate-950/50 text-slate-300';
  return <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${styles}`}>{label}</span>;
}

function ReadinessRow({ row }: { row: { label: string; status: OutcomeStatus; detail: string; recommendation: string } }) {
  return <article className={`rounded-xl border p-3 ${outcomeClass(row.status)}`}>
    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{row.label}</p>
    <p className="mt-2 flex items-center gap-2 text-sm font-bold text-slate-100">
      {row.status === 'PASS' ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : row.status === 'WARN' ? <AlertTriangle className="h-4 w-4 text-amber-300" /> : row.status === 'BLOCKED' ? <ShieldX className="h-4 w-4 text-rose-300" /> : <ShieldAlert className="h-4 w-4 text-slate-400" />}
      {toOutcomeBadge(row.status)}
    </p>
    <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{row.detail}</p>
    <p className="mt-2 text-[11px] leading-relaxed text-slate-400">{row.recommendation}</p>
  </article>;
}
