import { ErrorText } from './ErrorText';
import { useState } from 'react';
import { Monitor, ArrowRight } from 'lucide-react';
import type { ReportedDisplayInventory } from '../electron';
import type { DisplayModeReport, InstalledGameDiscovery, SystemScanSnapshot } from '../types';
import { DisplaySetupChooser } from './DisplaySetupChooser';
import { DISPLAY_SETUP_KEY, EMPTY_SELECTION, chosenGameName, effectiveGpu, graphicsAdapters, monitorDisplayName, parseSelection, saveSelection, setupCompleteness, type DisplaySetupSelection, type NamedDisplay } from '../lib/displaySetup';
import { DisplayBaselineForm } from './DisplayBaselineForm';
import { DISPLAY_BASELINES_KEY, FIELD_LABELS, baselineFor, contextChanges, describeField, gameKeyFor, pairKey, parseBaselines, removeBaseline, saveBaselines, upsertBaseline, type BaselineContext, type BaselineSettings, type DisplayBaseline } from '../lib/displayBaseline';
import { DISPLAY_EXPERIMENTS_KEY, experimentFor, parseExperiments } from '../lib/displayExperiment';
import { SESSION_KEY, parseSessions } from '../lib/experimentSessions';
import type { TestPrefill } from './TestAChange';

function RefreshRateCheck({ report, named }: { report: DisplayModeReport | null; named: NamedDisplay[] }) {
  if (!report) return null;
  return <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950/40 p-4">
    <div><h4 className="text-sm font-semibold text-slate-100">Is every monitor at its highest refresh rate?</h4><p className="mt-1 text-xs leading-relaxed text-slate-400">Windows often leaves a 144 Hz or 240 Hz monitor at 60 Hz. This lists the rates each display offers right now and changes nothing.</p></div>
    {<ul className="mt-3 space-y-2">{report.displays.map((display, index) => <li key={`${display.label}-${display.adapter}`} className={`rounded-lg border p-3 text-xs ${display.status === 'HIGHER_RATE_AVAILABLE' ? 'border-amber-500/30 bg-amber-950/15 text-amber-100' : 'border-slate-700 text-slate-300'}`}>
      <p className="font-semibold">{monitorDisplayName(display, index, named)}{display.currentWidth && display.currentHeight ? ` · ${display.currentWidth} × ${display.currentHeight}` : ''} · {display.currentHz ? `${display.currentHz} Hz now` : 'current rate unknown'}</p>
      <p className="mt-1 leading-relaxed">{display.status === 'HIGHER_RATE_AVAILABLE'
        ? `This display offers up to ${display.maxHzAtCurrentResolution} Hz at this resolution. Open Windows Settings › System › Display › Advanced display and choose ${display.maxHzAtCurrentResolution} Hz, then confirm the game uses the same rate.`
        : display.status === 'AT_HIGHEST_OFFERED'
          ? 'Already at the highest rate Windows offers for this resolution. If you expected more, check the cable, port or dock (for example, use DisplayPort or HDMI 2.1).'
          : 'Windows did not report enough mode information to compare.'}</p>
      {display.maxHzAnyResolution && display.maxHzAtCurrentResolution && display.maxHzAnyResolution > display.maxHzAtCurrentResolution && <p className="mt-1 text-slate-400">Up to {display.maxHzAnyResolution} Hz is offered at a different resolution.</p>}
    </li>)}</ul>}
    {report && report.displays.length === 0 && <p className="mt-3 text-xs text-slate-400">No attached displays were reported.</p>}
  </div>;
}

const references = [
  ['Windows refresh-rate settings', 'https://support.microsoft.com/en-us/windows/hardware/display-graphics/change-the-refresh-rate-on-your-monitor-in-windows'],
  ['NVIDIA latency, frame cap and synchronization guide', 'https://www.nvidia.com/en-us/geforce/guides/gfecnt/202010/system-latency-optimization-guide/'],
  ['AMD FreeSync setup', 'https://www.amd.com/en/resources/support-articles/faqs/DH3-013.html'],
  ['AMD Anti-Lag and in-game Anti-Lag 2 support', 'https://www.amd.com/en/products/software/adrenalin/radeon-software-anti-lag.html'],
] as const;

export function DisplaySetupGuide({ onOpenMeasure, onTest, snapshot, discovery }: {
  onOpenMeasure: () => void;
  /** Opens Measure › Test a change with this display setting filled in. */
  onTest: (prefill: TestPrefill) => void;
  snapshot: SystemScanSnapshot | null;
  discovery: InstalledGameDiscovery | null;
}) {
  const [goal, setGoal] = useState<'balanced' | 'latency'>('balanced');
  const [testField, setTestField] = useState<keyof BaselineSettings>('frameCap');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [inventory, setInventory] = useState<ReportedDisplayInventory | null>(null);
  const [modeReport, setModeReport] = useState<DisplayModeReport | null>(null);
  const [readingDisplays, setReadingDisplays] = useState(false);
  const [displayError, setDisplayError] = useState<string | null>(null);
  // Restored once on mount so a setup chosen earlier survives closing the app.
  const [selection, setSelection] = useState<DisplaySetupSelection>(() => {
    try { return parseSelection(window.localStorage.getItem(DISPLAY_SETUP_KEY)); }
    catch { return EMPTY_SELECTION; }
  });
  const [saveFailed, setSaveFailed] = useState(false);
  const [baselines, setBaselines] = useState<DisplayBaseline[]>(() => {
    try { return parseBaselines(window.localStorage.getItem(DISPLAY_BASELINES_KEY)); }
    catch { return []; }
  });

  // Step 2 needs a complete step 1: a baseline belongs to one game, monitor and card.
  const adapters = graphicsAdapters(snapshot);
  const gpu = effectiveGpu(adapters, selection.gpuName);
  const gameName = chosenGameName(selection, discovery);
  const setupDone = setupCompleteness(selection, adapters, discovery).complete;
  const chosenDisplay = modeReport?.displays.find((display) => display.monitorKey === selection.monitorKey) ?? null;
  const baselineContext: BaselineContext | null = setupDone && gameName && selection.monitorKey
    ? {
      gameKey: gameKeyFor(selection.guideId, gameName),
      gameName,
      guideId: selection.guideId,
      monitorKey: selection.monitorKey,
      monitorLabel: selection.monitorLabel ?? 'Chosen monitor',
      gpuName: gpu?.name ?? null,
      driverVersion: gpu && gpu.driverVersion !== 'Not returned' ? gpu.driverVersion : null,
    }
    : null;
  const existingBaseline = baselineContext ? baselineFor(baselines, baselineContext.gameKey, baselineContext.monitorKey) : null;
  // Only compared once displays have been read: an unread report is not evidence that
  // the monitor was unplugged, and would otherwise raise a false alarm on every visit.
  const baselineChanges = existingBaseline && modeReport
    ? contextChanges(existingBaseline, {
      monitorPresent: chosenDisplay !== null,
      observedRefreshHz: chosenDisplay?.currentHz ?? null,
      gpuName: baselineContext?.gpuName ?? null,
      driverVersion: baselineContext?.driverVersion ?? null,
    })
    : [];

  const persistBaselines = (next: DisplayBaseline[]): boolean => {
    let saved = false;
    try { saved = saveBaselines(window.localStorage, next); } catch { saved = false; }
    // Only reflect the change on screen once it is actually stored, so the saved
    // baseline shown is never one that will be gone after a restart.
    if (saved) setBaselines(next);
    return saved;
  };

  const changeSelection = (next: DisplaySetupSelection) => {
    setSelection(next);
    // What is on screen is authoritative; a storage failure is reported, never silent.
    setSaveFailed(!saveSelection(window.localStorage, next));
  };

  // One read serves the setup chooser, the reported-display cards and the refresh-rate
  // check, so the screen asks Windows once rather than three times.
  const readDisplays = async () => {
    if (readingDisplays) return;
    setReadingDisplays(true);
    setDisplayError(null);
    try {
      if (!window.pcOptiNative?.readDisplayInventory || !window.pcOptiNative?.readDisplayModes) {
        throw new Error('Display information is available in the Dialed desktop app.');
      }
      const [reportedInventory, modes] = await Promise.all([
        window.pcOptiNative.readDisplayInventory(),
        window.pcOptiNative.readDisplayModes(),
      ]);
      setInventory(reportedInventory);
      setModeReport(modes);
    } catch (error) {
      setDisplayError(error instanceof Error ? error.message : 'Display information could not be read.');
    } finally { setReadingDisplays(false); }
  };
  const openReference = async (url: string) => {
    setLinkError(null);
    try {
      if (window.pcOptiNative) await window.pcOptiNative.openExternalLink(url);
      else window.open(url, '_blank', 'noopener,noreferrer');
    } catch { setLinkError('The reference could not be opened. Try again when the desktop connection is available.'); }
  };
  return <section className="rounded-2xl border border-slate-700 bg-slate-900/70 p-5" aria-label="Display and GPU setup guide">
    <h3 className="flex items-center gap-2 text-lg font-semibold text-white"><Monitor className="h-5 w-5 text-cyan-300" /> Display and GPU setup</h3>
    <p className="mt-2 text-sm leading-relaxed text-slate-300">Set up one game and display together, then compare. Read the current display information, choose what you are testing, and use the setup guide for synchronization and graphics-card settings.</p>
    <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950/40 p-4">
      <button type="button" onClick={() => void readDisplays()} disabled={readingDisplays} className="rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-sm font-semibold text-cyan-200 disabled:opacity-50">{readingDisplays ? 'Reading display information…' : inventory ? 'Refresh display information' : 'Read display information'}</button>
      <p className="mt-2 text-xs leading-relaxed text-slate-400">Runs only when requested and changes no display setting. Reported refresh rate is not the monitor's maximum, measured frame delivery or proof of G-SYNC / FreeSync. Desktop size uses logical pixels after Windows scaling, not the physical panel resolution.</p>
      {displayError && <p role="alert" className="mt-3 text-xs text-amber-200">{displayError}{inventory ? ' Previous display information is retained; it may be stale.' : ''}</p>}
      {inventory && <>
        <p role="status" className="mt-3 text-xs text-slate-400">Read {new Date(inventory.collectedAt).toLocaleString()} · {inventory.displays.length} reported display{inventory.displays.length === 1 ? '' : 's'}. Refresh after reconnecting a monitor or changing its mode.</p>
        <ul className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))] gap-3">
          {inventory.displays.map((display, index) => <li key={`${display.id}-${index}`} className="min-w-0 rounded-lg border border-slate-700 p-3">
            <h4 className="break-words text-sm font-semibold text-slate-100">{display.label}</h4>
            <dl className="mt-2 space-y-1 text-xs text-slate-300">
              <div><dt className="inline">Reported refresh: </dt><dd className="inline">{display.refreshRateHz === null ? 'Unknown' : `${Number(display.refreshRateHz.toFixed(2))} Hz`}</dd></div>
              <div><dt className="inline">Desktop size: </dt><dd className="inline">{display.logicalWidth === null || display.logicalHeight === null ? 'Unknown' : `${display.logicalWidth} × ${display.logicalHeight} logical px`}</dd></div>
              <div><dt className="inline">Windows scale: </dt><dd className="inline">{display.scaleFactor === null ? 'Unknown' : `${Math.round(display.scaleFactor * 100)}%`}</dd></div>
            </dl>
          </li>)}
        </ul>
      </>}
    </div>
    <div className="mt-4"><DisplaySetupChooser
      selection={selection}
      modeReport={modeReport}
      namedDisplays={inventory?.displays ?? []}
      snapshot={snapshot}
      discovery={discovery}
      saveFailed={saveFailed}
      onChange={changeSelection}
    /></div>
    <div className="mt-4">{baselineContext
      ? <DisplayBaselineForm
        key={pairKey(baselineContext.gameKey, baselineContext.monitorKey)}
        context={baselineContext}
        observedRefreshHz={chosenDisplay?.currentHz ?? null}
        existing={existingBaseline}
        changes={baselineChanges}
        onSave={(baseline) => persistBaselines(upsertBaseline(baselines, baseline))}
        onDiscard={(id) => persistBaselines(removeBaseline(baselines, id))}
      />
      : <p className="rounded-xl border border-dashed border-slate-700 p-4 text-xs text-slate-500">Step 2 · Save your baseline — available once the game, monitor and graphics card are chosen above.</p>}</div>
    <div className="mt-4">{existingBaseline ? <div className="rounded-xl border border-slate-700 bg-slate-950/40 p-4">
        <h4 className="text-sm font-semibold text-slate-100">Step 3 · Test a display setting</h4>
        {legacyExperimentInProgress(existingBaseline.id) && <p className="mt-2 rounded-lg border border-slate-700 bg-slate-950/60 p-2 text-[11px] leading-relaxed text-slate-400">A display test started in an older version of Dialed is still open for this baseline. Tests now run in one place, so start it again below; the recordings it already made are kept under Measure.</p>}
        <p className="mt-1 text-xs leading-relaxed text-slate-400">Pick the one setting you want to try. Measure opens with it filled in, measures {existingBaseline.context.gameName} before and after, and checks your monitor and graphics card still match this baseline.</p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-xs font-semibold text-slate-300">Setting
            <select className="mt-1 block rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm text-white" value={testField} onChange={(event) => setTestField(event.target.value as keyof BaselineSettings)}>
              {(Object.keys(FIELD_LABELS) as Array<keyof BaselineSettings>).map((field) => <option key={field} value={field}>{FIELD_LABELS[field]} (now {describeField(field, existingBaseline.settings)})</option>)}
            </select>
          </label>
          <button type="button" className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-bold text-slate-950" onClick={() => onTest({ game: existingBaseline.context.gameName, manual: { title: FIELD_LABELS[testField], fromText: describeField(testField, existingBaseline.settings), displayBaselineId: existingBaseline.id } })}>Test it</button>
        </div>
      </div>
      : <p className="rounded-xl border border-dashed border-slate-700 p-4 text-xs text-slate-500">Step 3 · Test a display setting — available once a baseline is saved.</p>}</div>
    <RefreshRateCheck report={modeReport} named={inventory?.displays ?? []} />
    <details className="mt-4 rounded-xl border border-slate-700 bg-slate-950/40 p-4">
      <summary className="cursor-pointer text-sm font-semibold text-slate-100">Setup guide: choosing synchronization, frame cap and graphics-card settings</summary>
      <p className="mt-2 text-xs leading-relaxed text-slate-400">You make these changes yourself, in the game or your graphics-card software. Dialed does not change them for you.</p>
    <label className="mt-3 block text-xs font-semibold text-slate-300">Your comparison goal
      <select value={goal} onChange={(event) => setGoal(event.target.value as typeof goal)} className="mt-2 block w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm text-white">
        <option value="balanced">Smooth motion with less tearing</option>
        <option value="latency">Prioritize response; tearing may be acceptable</option>
      </select>
    </label>
    <ol className="mt-4 list-decimal space-y-4 pl-5 text-sm leading-relaxed text-slate-300">
      <li><strong className="text-white">Confirm the intended display.</strong> Open Windows Settings → System → Display → Advanced display, select the gaming monitor and review the supported refresh rates. Choose a supported rate for your resolution and cable. Verify the game uses the same monitor and intended resolution; Windows' own dynamic refresh rate is a separate feature from a game's G-SYNC / FreeSync support.</li>
      <li><strong className="text-white">Record one baseline.</strong> Save it in step 2 above — resolution, refresh rate, display mode, frame cap, V-Sync, G-SYNC / FreeSync and any latency feature. Start with the game’s own supported controls and a repeatable scene.</li>
      <li><strong className="text-white">Choose synchronization deliberately.</strong> {goal === 'balanced'
        ? 'For a display with G-SYNC or FreeSync, confirm its monitor setting and configuration in the GPU vendor software. Compare within its supported refresh-rate range. Above that range, V-Sync and cap behavior matter; follow the vendor’s combination for this game.'
        : 'Compare V-Sync off against your baseline if tearing is acceptable. Higher delivered FPS can help response, but an uncapped workload may also increase GPU load and heat, and make frames wait longer before they are shown. Measure the actual tradeoff.'}</li>
      <li><strong className="text-white">Use one intentional cap and latency path.</strong> Compare a sustainable in-game frame cap before stacking multiple limiters. For supported NVIDIA games, start with in-game Reflex; its behavior takes precedence over the driver's Low Latency Mode. NVIDIA documents that G-SYNC, V-Sync and Reflex / Ultra Low Latency already cap your frame rate slightly below your monitor's refresh rate on their own, so do not add another cap on top. For Radeon, check current support: Anti-Lag 2 requires game integration. Don't use third-party tools to force on a feature the game or driver doesn't support.</li>
      <li><strong className="text-white">Use per-game vendor settings.</strong> NVIDIA Control Panel → Manage 3D settings → Program Settings or the current NVIDIA app’s game profile; AMD Software → Gaming → Games for the selected title. Labels vary by driver. Record previous values and avoid changing global settings for one game.</li>
      <li><strong className="text-white">Compare and recover.</strong> Change one setting, repeat the scene several times and compare frame pacing, tearing and responsiveness. FPS and frame-time captures alone do not measure the full delay from your input to the screen changing (often called click-to-photon latency). Keep a reproducible improvement; otherwise restore that setting’s recorded previous value.</li>
    </ol>
    <button type="button" onClick={onOpenMeasure} className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-cyan-300 underline underline-offset-2">Open Measure for other comparisons <ArrowRight className="h-3.5 w-3.5" /></button>
    </details>
    <details className="mt-4 text-xs text-slate-400"><summary className="cursor-pointer font-semibold">Official setup references · reviewed September 5, 2026</summary>
      <ul className="mt-2 space-y-2">{references.map(([title, url]) => <li key={url}><button type="button" onClick={() => void openReference(url)} className="text-left text-cyan-300 underline underline-offset-2">{title}</button></li>)}</ul>
    </details>
    {linkError ? <p role="alert" className="mt-3 text-xs text-amber-200"><ErrorText text={linkError} /></p> : null}
  </section>;
}

/** True when a display experiment for this baseline was started (before Test a change
 *  existed) and has no decision yet, so it keeps its own steps rather than being lost. */
function legacyExperimentInProgress(baselineId: string): boolean {
  try {
    const experiment = experimentFor(parseExperiments(window.localStorage.getItem(DISPLAY_EXPERIMENTS_KEY)), baselineId);
    if (!experiment) return false;
    const session = parseSessions(window.localStorage.getItem(SESSION_KEY)).find((item) => item.id === experiment.sessionId);
    return session?.decision === 'UNDECIDED';
  } catch {
    return false;
  }
}
