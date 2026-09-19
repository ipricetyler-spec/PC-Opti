import { ErrorText } from './ErrorText';
import { CheckCircle2, CircleStop, Cpu, ExternalLink, LoaderCircle, Play, RefreshCw, ShieldCheck, Trash2, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { BenchmarkImportPreview, PresentMonCaptureConsentPreview, PresentMonCaptureState, PresentMonTarget, PresentMonToolInfo } from '../types';
import { plainLabel } from '../lib/plainLabels';
import { readHardwareReadingsPreference } from '../lib/telemetry';
import { useConfirm } from './ConfirmContext';
import { HardwareReadingsSummary } from './HardwareReadingsSummary';

interface NativePresentMonCaptureProps {
  onImportPreview: (preview: BenchmarkImportPreview) => void;
  /** Recorder only: no heading and no list of saved recordings. Used inside a test,
   *  which shows its own before and after runs. */
  compact?: boolean;
  /** Called with the latest state whenever a recording finishes or the list changes. */
  onStateChange?: (state: PresentMonCaptureState) => void;
  /** Inside a test: the game it names. The matching program is chosen; if none matches,
   *  nothing is chosen, so another program is never recorded by accident. */
  preferTarget?: string;
}

const letters = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

/** The running program whose name or window title matches the game's name. */
export function matchingTarget<T extends { name: string; windowTitle: string }>(targets: T[], game: string): T | null {
  const wanted = letters(game);
  if (wanted.length < 3) return null;
  return targets.find((target) => letters(target.name).includes(wanted) || letters(target.windowTitle).includes(wanted)) ?? null;
}

function bytes(value: number) {
  return value < 1024 * 1024 ? `${(value / 1024).toFixed(0)} KiB` : `${(value / 1024 / 1024).toFixed(1)} MiB`;
}

export function NativePresentMonCapture({ onImportPreview, compact = false, onStateChange, preferTarget }: NativePresentMonCaptureProps) {
  const [tool, setTool] = useState<PresentMonToolInfo | null>(null);
  const [targets, setTargets] = useState<PresentMonTarget[]>([]);
  const [targetLimitations, setTargetLimitations] = useState('');
  const [captureState, setCaptureState] = useState<PresentMonCaptureState>({ active: null, entries: [], maximumEntries: 100 });
  const [targetId, setTargetId] = useState('');
  const [duration, setDuration] = useState<10 | 20 | 30>(20);
  const [selectedCaptures, setSelectedCaptures] = useState<string[]>([]);
  const [showAllRecordings, setShowAllRecordings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const confirm = useConfirm();
  const [hardwareReadings, setHardwareReadings] = useState(() => readHardwareReadingsPreference());

  const refreshState = async () => {
    if (!window.pcOptiNative) return;
    setCaptureState(await window.pcOptiNative.getPresentMonCaptureState());
  };

  const refreshAll = async () => {
    if (!window.pcOptiNative || busy) return;
    setBusy(true);
    setError(null);
    try {
      const [info, inventory, state] = await Promise.all([
        window.pcOptiNative.getPresentMonInfo(),
        window.pcOptiNative.listPresentMonTargets(),
        window.pcOptiNative.getPresentMonCaptureState(),
      ]);
      setTool(info);
      setTargets(inventory.items);
      setTargetLimitations(inventory.limitations);
      setCaptureState(state);
      if (!inventory.items.some((target) => target.targetId === targetId)) {
        const wanted = preferTarget ? matchingTarget(inventory.items, preferTarget) : null;
        setTargetId(wanted?.targetId || (preferTarget !== undefined ? '' : inventory.items[0]?.targetId || ''));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load your recordings.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { void refreshAll(); }, []);
  useEffect(() => {
    if (!captureState.active || !window.pcOptiNative) return;
    const timer = window.setInterval(() => { void refreshState().catch((reason) => setError(reason instanceof Error ? reason.message : 'Capture status refresh failed.')); }, 1000);
    return () => window.clearInterval(timer);
  }, [captureState.active?.captureId]);

  useEffect(() => { onStateChange?.(captureState); }, [captureState, onStateChange]);

  const selectedTarget = targets.find((target) => target.targetId === targetId) || null;
  const completeCaptures = useMemo(() => captureState.entries.filter((entry) => entry.status === 'COMPLETE' && entry.protocolComplete === true), [captureState.entries]);

  const start = async () => {
    if (!window.pcOptiNative || !selectedTarget || busy || captureState.active || tool?.status !== 'AVAILABLE') return;
    setBusy(true);
    setError(null);
    setStatus(null);
    let preview: PresentMonCaptureConsentPreview;
    try {
      preview = await window.pcOptiNative.previewPresentMonCapture(selectedTarget.targetId, duration, hardwareReadings);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'PresentMon capture preview could not be created safely.');
      setBusy(false);
      return;
    }
    const confirmed = await confirm({
      title: `Start a ${preview.durationSeconds}-second frame-time capture?`,
      description: preview.consequence,
      details: `Target: ${preview.target.name} (PID ${preview.target.pid})\nWindow: ${preview.target.windowTitle}\nPresentMon ${preview.toolVersion}\nHardware readings: ${preview.hardwareReadings ? 'on — CPU, memory and GPU counters once per second' : 'off'}`,
      notice: 'Play the same scene the same way each time while it records.',
      confirmLabel: 'Start recording',
    });
    if (!confirmed) {
      setBusy(false);
      return;
    }
    try {
      await window.pcOptiNative.startPresentMonCapture(preview.token);
      await refreshState();
      setStatus('Recording. Keep playing the same scene; Dialed stops on its own when time is up.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'PresentMon capture could not start safely.');
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (!window.pcOptiNative || !captureState.active || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await window.pcOptiNative.stopPresentMonCapture();
      setStatus(result.stopped ? 'Stopping and saving…' : result.reason || 'Nothing was recording.');
      await refreshState();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'PresentMon did not acknowledge the stop request; its fixed timed limit remains active.');
    } finally {
      setBusy(false);
    }
  };

  const toggleCapture = (captureId: string) => {
    setSelectedCaptures((current) => current.includes(captureId)
      ? current.filter((id) => id !== captureId)
      : current.length < 20 ? [...current, captureId] : current);
  };

  const compareSelected = async () => {
    if (!window.pcOptiNative || (selectedCaptures.length !== 2 && selectedCaptures.length < 6) || busy) return;
    setBusy(true);
    setError(null);
    try {
      const preview = await window.pcOptiNative.prepareNativePresentMonImport(selectedCaptures);
      if (!preview.token || !preview.sources) throw new Error('Those recordings could not be compared. One may be incomplete.');
      onImportPreview(preview);
      setStatus('Ready. Say which recording is before and which is after.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Those recordings could not be compared.');
    } finally {
      setBusy(false);
    }
  };

  const deleteCapture = async (captureId: string) => {
    if (!window.pcOptiNative || busy || captureState.active?.captureId === captureId) return;
    setBusy(true);
    setError(null);
    try {
      const preview = await window.pcOptiNative.previewPresentMonCaptureDeletion(captureId);
      const fileSummary = preview.files.map((file) => `${file.fileName} (${bytes(file.bytes)})`).join('\n');
      const confirmed = await confirm({
        title: 'Permanently delete this capture?',
        description: `${preview.targetName} · started ${new Date(preview.startedAt).toLocaleString()}`,
        details: fileSummary,
        notice: preview.consequence,
        confirmLabel: 'Delete capture',
        tone: 'danger',
      });
      if (!confirmed) return;
      const result = await window.pcOptiNative.deletePresentMonCapture(preview.token);
      setCaptureState({ active: result.active, entries: result.entries, maximumEntries: result.maximumEntries });
      setSelectedCaptures((current) => current.filter((id) => id !== captureId));
      setStatus(`Deleted ${result.deletedFiles.length} local capture file(s). This cannot be undone.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The capture could not be deleted safely.');
    } finally {
      setBusy(false);
    }
  };

  return <section className={compact ? '' : 'rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-slate-900 via-slate-900 to-cyan-950/20 p-5'}>
    {!compact && <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
      <div className="max-w-3xl"><div className="flex items-center gap-2 text-cyan-300"><Cpu className="h-5 w-5" /><span className="text-sm font-semibold">Measure a game</span></div><h2 className="mt-2 text-xl font-bold text-white">Record how smoothly a game runs</h2><p className="mt-1 text-sm leading-relaxed text-slate-400">Pick a running game and record 10–30 seconds of play. Dialed uses Intel's PresentMon to time every frame, and keeps the results on this PC. Nothing is installed and nothing touches the game itself.</p></div>
      <button type="button" onClick={refreshAll} disabled={busy || Boolean(captureState.active)} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 disabled:opacity-40"><RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />Refresh</button>
    </div>}

    {(!compact || tool?.status !== 'AVAILABLE') && <div className={`mt-4 rounded-xl border p-4 ${tool?.status === 'AVAILABLE' ? 'border-emerald-500/25 bg-emerald-950/15' : 'border-amber-500/25 bg-amber-950/10'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2 text-xs font-semibold text-slate-100">{tool?.status === 'AVAILABLE' ? <ShieldCheck className="h-4 w-4 text-emerald-300" /> : <TriangleAlert className="h-4 w-4 text-amber-300" />}PresentMon {tool?.version || 'checking…'} · {tool ? plainLabel(tool.status) : 'Checking'}</div>{tool?.sourceUrl ? <button type="button" onClick={() => window.pcOptiNative?.openExternalLink(tool.sourceUrl)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-cyan-300"><ExternalLink className="h-3 w-3" />Official release</button> : null}</div>
      {tool?.status === 'AVAILABLE' ? <p data-technical-detail className="mt-2 break-words text-[11px] leading-relaxed text-slate-500">MIT · {tool.executableName} · SHA-256 {tool.sha256} · {tool.signerSubject} · timestamp signature present</p> : <p className="mt-2 text-[11px] leading-relaxed text-amber-100/80">{tool?.reason || 'Checking that PresentMon is the genuine, signed Intel release…'}</p>}
    </div>}

    <div className={`${compact ? '' : 'mt-4 '}grid gap-3 lg:grid-cols-[1fr_auto_auto_auto] lg:items-end`}>
      <label className="text-xs text-slate-400"><span className="mb-1 block">Game</span><select value={targetId} onChange={(event) => setTargetId(event.target.value)} disabled={Boolean(captureState.active)} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200"><option value="">Choose a running game</option>{targets.map((target) => <option key={target.targetId} value={target.targetId}>{target.name} · PID {target.pid} · {target.windowTitle}</option>)}</select></label>
      <label className="text-xs text-slate-400"><span className="mb-1 block">Duration</span><select value={duration} onChange={(event) => setDuration(Number(event.target.value) as 10 | 20 | 30)} disabled={Boolean(captureState.active)} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200"><option value={10}>10 seconds</option><option value={20}>20 seconds</option><option value={30}>30 seconds</option></select></label>
      {captureState.active ? <button type="button" onClick={stop} disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-lg border border-rose-400/30 bg-rose-400/10 px-4 py-2 text-xs font-semibold text-rose-200 disabled:opacity-40"><CircleStop className="h-4 w-4" />Stop</button> : <button type="button" onClick={start} disabled={busy || !selectedTarget || tool?.status !== 'AVAILABLE'} className="inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-400 px-4 py-2 text-xs font-black text-slate-950 disabled:opacity-40">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-current" />}Start recording</button>}
      {compact && <button type="button" onClick={refreshAll} disabled={busy || Boolean(captureState.active)} title="Look for running games again" className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 disabled:opacity-40"><RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />Refresh</button>}
    </div>
    <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs leading-relaxed text-slate-300">
      <input type="checkbox" checked={hardwareReadings} onChange={(event) => setHardwareReadings(event.target.checked)} disabled={Boolean(captureState.active)} className="mt-0.5 h-4 w-4 accent-cyan-400" />
      <span>Also record CPU and graphics card load, temperature and clock speeds while measuring (temperature and power need an NVIDIA card).</span>
    </label>
    <p data-technical-detail className="mt-2 text-[11px] leading-relaxed text-slate-600">{targetLimitations || 'Looking for running games…'}</p>
    {captureState.active ? <p className="mt-3 rounded-lg border border-cyan-500/25 bg-cyan-950/20 p-3 text-xs text-cyan-100">Recording {captureState.active.target.name} · PID {captureState.active.target.pid} · {captureState.active.durationSeconds}s maximum · {plainLabel(captureState.active.status)}</p> : null}
    {error ? <p role="alert" className="mt-3 rounded-lg border border-rose-500/25 bg-rose-950/20 p-3 text-xs text-rose-200"><ErrorText text={error} /></p> : null}
    {status ? <p className="mt-3 rounded-lg border border-cyan-500/20 bg-cyan-950/10 p-3 text-xs text-cyan-100">{status}</p> : null}

    {!compact && <><div className="mt-5 flex flex-wrap items-end justify-between gap-3"><div><h3 className="text-sm font-semibold text-slate-100">Your recordings</h3><p className="mt-1 text-[11px] text-slate-500">Pick two recordings to compare them, or 6–20 for a more reliable result (several before and several after). {captureState.entries.length} of {captureState.maximumEntries} saved.</p></div><button type="button" onClick={compareSelected} disabled={(selectedCaptures.length !== 2 && selectedCaptures.length < 6) || busy} className="inline-flex items-center gap-2 rounded-lg border border-violet-400/30 bg-violet-400/10 px-3 py-2 text-xs font-semibold text-violet-200 disabled:opacity-40"><CheckCircle2 className="h-4 w-4" />Compare ({selectedCaptures.length} picked)</button></div>
    <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{(showAllRecordings ? captureState.entries : captureState.entries.slice(-4)).map((entry) => {
      const selectable = entry.status === 'COMPLETE' && entry.protocolComplete === true;
      const selected = selectedCaptures.includes(entry.captureId);
      return <article key={entry.captureId} className={`rounded-xl border p-4 ${selected ? 'border-violet-400/50 bg-violet-950/20' : selectable ? 'border-slate-700 bg-slate-950/45' : 'border-amber-500/20 bg-amber-950/10'}`}>
        <button type="button" onClick={() => selectable && toggleCapture(entry.captureId)} disabled={!selectable} aria-pressed={selected} className="w-full text-left disabled:cursor-not-allowed disabled:opacity-80">
          <div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold text-slate-100">{entry.target.name} · {entry.durationSeconds}s</p><span className="rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-400">{plainLabel(entry.status)}</span></div>
          <p data-technical-detail className="mt-2 text-[11px] text-slate-500">{new Date(entry.startedAt).toLocaleString()} · PID {entry.target.pid}</p>
          {entry.output ? <p data-technical-detail className="mt-2 text-[11px] text-slate-400">{entry.output.metricColumn} · {bytes(entry.output.bytes)} · {entry.applications.reduce((total, app) => total + app.sampleCount, 0)} parsed frames</p> : null}
          {entry.stopReason ? <p className="mt-2 text-xs text-slate-400">Stopped: {plainLabel(entry.stopReason)} · recorded {entry.observedDurationSeconds?.toFixed(1) ?? 'unknown'}s / {entry.durationSeconds}s asked. {entry.protocolComplete ? 'Ready to compare.' : 'Incomplete, so it cannot be compared.'}</p> : null}
          {entry.error ? <p className="mt-2 text-[11px] leading-relaxed text-amber-200"><ErrorText text={entry.error} /></p> : null}
        </button>
        {entry.telemetry ? entry.telemetry.status === 'RECORDED' && entry.telemetry.view ? <details className="mt-2 text-xs text-slate-300">
          <summary className="cursor-pointer font-semibold text-cyan-200">Hardware readings</summary>
          <div className="mt-2"><HardwareReadingsSummary view={entry.telemetry.view} /></div>
        </details> : <p className="mt-2 text-[11px] text-slate-500">Hardware readings: {entry.telemetry.status === 'RECORDING' ? 'recording…' : entry.telemetry.error || plainLabel(entry.telemetry.status)}</p> : null}
        <button type="button" onClick={() => void deleteCapture(entry.captureId)} disabled={busy || captureState.active?.captureId === entry.captureId} className="mt-3 inline-flex items-center gap-1 rounded border border-rose-500/20 bg-rose-500/5 px-2 py-1 text-[11px] font-semibold text-rose-200 disabled:opacity-40"><Trash2 className="h-3 w-3" />Delete</button>
      </article>;
    })}</div>
    {captureState.entries.length > 4 && <button type="button" onClick={() => setShowAllRecordings((value) => !value)} className="mt-3 text-xs text-cyan-300 underline underline-offset-2">{showAllRecordings ? 'Show only the newest 4' : `Show all ${captureState.entries.length} recordings`}</button>}
    {completeCaptures.length === 0 && !captureState.active ? <p className="mt-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-xs text-slate-500">No recordings yet. Dialed only records when you press Start.</p> : null}</>}
  </section>;
}
