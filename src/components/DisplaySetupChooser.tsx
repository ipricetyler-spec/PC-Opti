import { Gamepad2, MonitorCog, Cpu, AlertTriangle } from 'lucide-react';
import type { DisplayModeReport, InstalledGameDiscovery, SystemScanSnapshot } from '../types';
import {
  chosenGameName,
  effectiveGpu,
  gpuAssociation,
  graphicsAdapters,
  normalizeManualGameName,
  selectableMonitors,
  selectionIsStale,
  setupCompleteness,
  type DisplaySetupSelection,
  type NamedDisplay,
} from '../lib/displaySetup';

const FIELD_CLASS = 'mt-2 block w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm text-white';

export function DisplaySetupChooser({
  selection, modeReport, namedDisplays, snapshot, discovery, saveFailed, onChange,
}: {
  selection: DisplaySetupSelection;
  modeReport: DisplayModeReport | null;
  namedDisplays: NamedDisplay[];
  snapshot: SystemScanSnapshot | null;
  discovery: InstalledGameDiscovery | null;
  saveFailed: boolean;
  onChange: (next: DisplaySetupSelection) => void;
}) {
  const monitors = selectableMonitors(modeReport, namedDisplays);
  const adapters = graphicsAdapters(snapshot);
  const association = gpuAssociation(adapters, selection.gpuName);
  const chosenGpu = effectiveGpu(adapters, selection.gpuName);
  const completeness = setupCompleteness(selection, adapters, discovery);
  const stale = selectionIsStale(selection, modeReport);
  const detected = discovery?.games ?? [];
  const usingManualGame = selection.guideId === null && (selection.manualGameName !== null || detected.length === 0);

  const update = (patch: Partial<DisplaySetupSelection>) => onChange({ ...selection, ...patch });

  return <div className="rounded-xl border border-slate-700 bg-slate-950/40 p-4">
    <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-100"><MonitorCog className="h-4 w-4 text-cyan-300" /> Step 1 · Choose your setup</h4>
    <p className="mt-1 text-xs leading-relaxed text-slate-400">Dialed records which game, monitor and graphics card a comparison belongs to, so a later measurement is matched to the same setup. Choosing here changes no setting.</p>

    {stale && <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-950/15 p-3 text-xs leading-relaxed text-amber-100">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>The monitor you chose{selection.monitorLabel ? ` (${selection.monitorLabel})` : ''} is not attached right now. Your saved setup is kept as it is — reconnect that monitor, or choose a different one below.</span>
    </p>}

    <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-4">
      <div>
        <label className="block text-xs font-semibold text-slate-300" htmlFor="display-setup-game">
          <span className="flex items-center gap-1.5"><Gamepad2 className="h-3.5 w-3.5 text-cyan-300" /> Game</span>
        </label>
        <select
          id="display-setup-game"
          className={FIELD_CLASS}
          value={usingManualGame ? '__manual__' : selection.guideId ?? ''}
          onChange={(event) => {
            const value = event.target.value;
            if (value === '__manual__') update({ guideId: null, manualGameName: selection.manualGameName ?? '' });
            else update({ guideId: value || null, manualGameName: null });
          }}
        >
          <option value="">Not chosen yet</option>
          {detected.map((game) => <option key={game.guideId} value={game.guideId}>{game.game}</option>)}
          <option value="__manual__">My game is not listed</option>
        </select>
        {usingManualGame && <label className="mt-2 block text-xs text-slate-400">
          Game name
          <input
            type="text"
            className={FIELD_CLASS}
            value={selection.manualGameName ?? ''}
            maxLength={80}
            placeholder="Type the game's name"
            onChange={(event) => update({ guideId: null, manualGameName: normalizeManualGameName(event.target.value) })}
          />
        </label>}
        {detected.length === 0 && <p className="mt-2 text-xs text-slate-500">No games were detected from installed-application information. Type the name instead — Dialed never launches a program you point it at.</p>}
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-300" htmlFor="display-setup-monitor">
          <span className="flex items-center gap-1.5"><MonitorCog className="h-3.5 w-3.5 text-cyan-300" /> Monitor you play on</span>
        </label>
        <select
          id="display-setup-monitor"
          className={FIELD_CLASS}
          value={selection.monitorKey ?? ''}
          disabled={monitors.length === 0 && !selection.monitorKey}
          onChange={(event) => {
            const key = event.target.value || null;
            const monitor = monitors.find((item) => item.monitorKey === key);
            update({ monitorKey: key, monitorLabel: monitor ? monitor.label : key === selection.monitorKey ? selection.monitorLabel : null });
          }}
        >
          <option value="">Not chosen yet</option>
          {/* A saved monitor stays visible even before displays are read, so the box never
              says "Not chosen yet" while the setup summary names a monitor. */}
          {selection.monitorKey && !monitors.some((monitor) => monitor.monitorKey === selection.monitorKey) && <option value={selection.monitorKey}>
            {selection.monitorLabel ?? 'Saved monitor'}{monitors.length ? ' — not attached now' : ' (not read yet)'}
          </option>}
          {monitors.map((monitor, index) => <option
            key={monitor.monitorKey ?? `unidentified-${index}`}
            value={monitor.monitorKey ?? ''}
            disabled={!monitor.selectable}
          >{monitor.label}{monitor.selectable ? '' : ' — cannot be identified'}</option>)}
        </select>
        {monitors.length === 0
          ? <p className="mt-2 text-xs text-slate-500">Read display information first and your monitors will appear here.</p>
          : <ul className="mt-2 space-y-1 text-xs text-slate-400">{monitors.map((monitor, index) => <li key={monitor.monitorKey ?? `detail-${index}`}>{monitor.label}: {monitor.detail}</li>)}</ul>}
        {monitors.some((monitor) => !monitor.selectable) && <p className="mt-2 text-xs text-slate-500">A monitor Windows cannot identify individually cannot be chosen, because a later measurement could not be matched back to it reliably.</p>}
      </div>

      <div>
        <span className="block text-xs font-semibold text-slate-300">
          <span className="flex items-center gap-1.5"><Cpu className="h-3.5 w-3.5 text-cyan-300" /> Graphics card</span>
        </span>
        {association === 'UNKNOWN' && <p className="mt-2 text-xs text-slate-500">No graphics card information was reported. Run a scan on Home and it will appear here.</p>}
        {association === 'SINGLE_GPU' && chosenGpu && <div className="mt-2 rounded-lg border border-slate-700 p-3 text-xs text-slate-300">
          <p className="font-semibold text-slate-100">{chosenGpu.name}</p>
          <p className="mt-1">Driver {chosenGpu.driverVersion === 'Not returned' ? 'version not reported' : chosenGpu.driverVersion}</p>
        </div>}
        {(association === 'NEEDS_USER_CHOICE' || association === 'USER_CHOSEN') && <>
          <label className="sr-only" htmlFor="display-setup-gpu">Which graphics card drives that monitor</label>
          <select
            id="display-setup-gpu"
            className={FIELD_CLASS}
            value={selection.gpuName ?? ''}
            onChange={(event) => update({ gpuName: event.target.value || null })}
          >
            <option value="">Not chosen yet</option>
            {adapters.map((adapter) => <option key={adapter.name} value={adapter.name}>{adapter.name}</option>)}
          </select>
          <p className="mt-2 text-xs text-slate-400">This PC reports more than one graphics card. Windows does not say which one draws a given monitor, so Dialed asks rather than guessing — a wrong guess would label your measurements with a card that never ran the game.</p>
          {chosenGpu && <p className="mt-2 text-xs text-slate-300">Driver {chosenGpu.driverVersion === 'Not returned' ? 'version not reported' : chosenGpu.driverVersion}</p>}
        </>}
      </div>
    </div>

    <p role="status" className="mt-4 text-xs leading-relaxed text-slate-300">
      {completeness.complete
        ? <span className="text-emerald-200">Setup chosen: {chosenGameName(selection, discovery)} on {selection.monitorLabel}{chosenGpu ? `, drawn by ${chosenGpu.name}` : ''}. Saving a baseline comes next.</span>
        : <>Still needed: {completeness.missing.join(' · ')}</>}
    </p>
    {saveFailed && <p role="alert" className="mt-2 text-xs text-amber-200">Your choices could not be saved to this device, so they will be gone when Dialed closes. What is on screen is unchanged.</p>}
  </div>;
}
