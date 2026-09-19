import { ErrorText } from './ErrorText';
import { useMemo, useState } from 'react';
import { ClipboardList, AlertTriangle, Trash2 } from 'lucide-react';
import { useConfirm } from './ConfirmContext';
import {
  DISPLAY_MODES,
  FIELD_LABELS,
  LATENCY_FEATURES,
  ON_OFF,
  REQUIRED_FIELDS,
  SYNC_MODES,
  describeField,
  emptySettings,
  known,
  missingRequired,
  type BaselineContext,
  type BaselineSettings,
  type DisplayBaseline,
  type Field,
  type FieldSource,
} from '../lib/displayBaseline';

const FIELD_CLASS = 'mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm text-white';
const UNKNOWN: Field<never> = { value: null, source: 'UNKNOWN' };

const OPTION_LABELS = {
  displayMode: { FULLSCREEN: 'Fullscreen', BORDERLESS: 'Borderless window', WINDOWED: 'Windowed' },
  vsync: { OFF: 'Off', ON: 'On', ADAPTIVE: 'Adaptive', FAST: 'Fast Sync / Enhanced Sync' },
  onOff: { ON: 'On', OFF: 'Off' },
  latency: { NONE: 'None', REFLEX_ON: 'NVIDIA Reflex', REFLEX_BOOST: 'NVIDIA Reflex + Boost', ANTI_LAG: 'AMD Anti-Lag', ANTI_LAG_2: 'AMD Anti-Lag 2', XELL: 'Intel XeLL', OTHER: 'Other' },
} as const;

function SourceBadge({ source }: { source: FieldSource }) {
  const style = source === 'OBSERVED'
    ? 'border-cyan-400/30 bg-cyan-400/10 text-cyan-200'
    : source === 'MANUAL'
      ? 'border-slate-600 bg-slate-800/60 text-slate-200'
      : 'border-slate-700 bg-slate-900 text-slate-400';
  const label = source === 'OBSERVED' ? 'Read from Windows' : source === 'MANUAL' ? 'Entered by you' : 'Not known';
  return <span className={`ml-2 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${style}`}>{label}</span>;
}

function FieldLabel({ field, source, htmlFor }: { field: keyof BaselineSettings; source: FieldSource; htmlFor: string }) {
  const required = REQUIRED_FIELDS.includes(field);
  return <label htmlFor={htmlFor} className="flex flex-wrap items-center text-xs font-semibold text-slate-300">
    {FIELD_LABELS[field]}{required && <span className="ml-1 text-amber-300" aria-label="required">*</span>}
    <SourceBadge source={source} />
  </label>;
}

/** A positive integer from a text box, or null when it is blank or not a number. */
function parseWhole(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,5}$/.test(trimmed)) return null;
  return Number(trimmed);
}

function EnumField<T extends string>({ field, value, options, labels, onChange }: {
  field: keyof BaselineSettings;
  value: Field<T>;
  options: readonly T[];
  labels: Record<T, string>;
  onChange: (next: Field<T>) => void;
}) {
  const id = `baseline-${field}`;
  return <div>
    <FieldLabel field={field} source={value.source} htmlFor={id} />
    <select id={id} className={FIELD_CLASS} value={value.value ?? ''} onChange={(event) => {
      const next = event.target.value as T | '';
      onChange(next ? known(next) : UNKNOWN);
    }}>
      <option value="">Not known</option>
      {options.map((option) => <option key={option} value={option}>{labels[option]}</option>)}
    </select>
  </div>;
}

export function DisplayBaselineForm({ context, observedRefreshHz, existing, changes, onSave, onDiscard }: {
  context: BaselineContext;
  observedRefreshHz: number | null;
  existing: DisplayBaseline | null;
  changes: string[];
  onSave: (baseline: DisplayBaseline) => boolean;
  onDiscard: (id: string) => boolean;
}) {
  const confirm = useConfirm();
  const initial = useMemo(() => existing?.settings ?? emptySettings(observedRefreshHz), [existing, observedRefreshHz]);
  const [draft, setDraft] = useState<BaselineSettings>(initial);
  // Number boxes keep what was typed so a half-entered value is not wiped mid-edit.
  const [text, setText] = useState(() => ({
    width: initial.resolution.value ? String(initial.resolution.value.width) : '',
    height: initial.resolution.value ? String(initial.resolution.value.height) : '',
    refresh: initial.refreshHz.value !== null ? String(initial.refreshHz.value) : '',
    cap: typeof initial.frameCap.value === 'number' ? String(initial.frameCap.value) : '',
    vrrMin: initial.vrrRange.value ? String(initial.vrrRange.value.minHz) : '',
    vrrMax: initial.vrrRange.value ? String(initial.vrrRange.value.maxHz) : '',
  }));
  const [capMode, setCapMode] = useState<'' | 'UNCAPPED' | 'CAP'>(
    initial.frameCap.value === 'UNCAPPED' ? 'UNCAPPED' : typeof initial.frameCap.value === 'number' ? 'CAP' : '',
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const set = <K extends keyof BaselineSettings>(field: K, value: BaselineSettings[K]) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setNotice(null);
  };
  const setTextField = (key: keyof typeof text, value: string) => setText((current) => ({ ...current, [key]: value }));

  const updateResolution = (width: string, height: string) => {
    const w = parseWhole(width);
    const h = parseWhole(height);
    set('resolution', w !== null && h !== null && w >= 320 && h >= 320 ? known({ width: w, height: h }) : UNKNOWN);
  };
  const updateRefresh = (value: string) => {
    const hz = parseWhole(value);
    if (hz !== null && hz >= 20 && hz <= 1000) {
      // Keep the "read from Windows" label only while the value is what Windows reported.
      set('refreshHz', known(hz, hz === observedRefreshHz && initial.refreshHz.source === 'OBSERVED' ? 'OBSERVED' : 'MANUAL'));
    } else set('refreshHz', UNKNOWN);
  };
  const updateCap = (mode: '' | 'UNCAPPED' | 'CAP', fps: string) => {
    setCapMode(mode);
    if (mode === 'UNCAPPED') set('frameCap', known('UNCAPPED' as const));
    else if (mode === 'CAP') {
      const value = parseWhole(fps);
      set('frameCap', value !== null && value >= 10 && value <= 2000 ? known(value) : UNKNOWN);
    } else set('frameCap', UNKNOWN);
  };
  const updateVrrRange = (min: string, max: string) => {
    const low = parseWhole(min);
    const high = parseWhole(max);
    set('vrrRange', low !== null && high !== null && low >= 20 && high <= 1000 && low < high ? known({ minHz: low, maxHz: high }) : UNKNOWN);
  };

  const missing = missingRequired(draft);
  const unsaved = JSON.stringify(draft) !== JSON.stringify(existing?.settings ?? emptySettings(observedRefreshHz));

  const save = async () => {
    setError(null);
    setNotice(null);
    if (missing.length) {
      setError(`Fill in ${missing.join(', ')} before saving. These four decide how frames are paced, so without them a before-and-after comparison cannot say what it compared.`);
      return;
    }
    if (existing) {
      const confirmed = await confirm({
        title: 'Replace the saved baseline?',
        description: `There is already a baseline for ${context.gameName} on ${context.monitorLabel}. Only one is kept per game and monitor.`,
        details: (Object.keys(FIELD_LABELS) as Array<keyof BaselineSettings>)
          .map((field) => `${FIELD_LABELS[field]}: ${describeField(field, existing.settings)} → ${describeField(field, draft)}`)
          .join('\n'),
        detailsLabel: 'Saved → new',
        notice: 'Measurements already taken against the old baseline stay as they are.',
        confirmLabel: 'Replace baseline',
      });
      if (!confirmed) return;
    }
    const baseline: DisplayBaseline = {
      schemaVersion: 1,
      id: crypto.randomUUID(),
      savedAt: new Date().toISOString(),
      context,
      settings: draft,
    };
    if (onSave(baseline)) setNotice('Baseline saved on this device.');
    else setError('The baseline could not be saved to this device. Nothing on screen has been lost — try again, or free up space and retry.');
  };

  const discard = async () => {
    if (!existing) return;
    const confirmed = await confirm({
      title: 'Discard the saved baseline?',
      description: `This removes the baseline for ${context.gameName} on ${context.monitorLabel}.`,
      details: (Object.keys(FIELD_LABELS) as Array<keyof BaselineSettings>)
        .map((field) => `${FIELD_LABELS[field]}: ${describeField(field, existing.settings)}`)
        .join('\n'),
      detailsLabel: 'Baseline being removed',
      notice: 'This cannot be undone. Measurements already taken are not deleted.',
      confirmLabel: 'Discard baseline',
      tone: 'danger',
    });
    if (!confirmed) return;
    if (!onDiscard(existing.id)) setError('The baseline could not be removed from this device. It is still saved.');
  };

  return <div className="rounded-xl border border-slate-700 bg-slate-950/40 p-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-100"><ClipboardList className="h-4 w-4 text-cyan-300" /> Step 2 · Save your baseline</h4>
      {unsaved && <span role="status" className="rounded-full border border-amber-500/30 bg-amber-950/20 px-2 py-0.5 text-[11px] font-semibold text-amber-200">Unsaved changes</span>}
    </div>
    <p className="mt-1 text-xs leading-relaxed text-slate-400">Record the settings you are using right now, before changing anything. Take them from the game's own settings menu and your graphics-card software. Anything you do not know can stay as "Not known" — that is recorded honestly rather than guessed. Fields marked * are needed to compare.</p>

    {changes.length > 0 && <div role="alert" className="mt-3 rounded-lg border border-amber-500/30 bg-amber-950/15 p-3 text-xs leading-relaxed text-amber-100">
      <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4 shrink-0" /> Your setup has changed since this baseline was saved</p>
      <ul className="mt-1 list-disc pl-5">{changes.map((change) => <li key={change}>{change}</li>)}</ul>
      <p className="mt-1">A comparison against this baseline would not be like for like. Save a new baseline, or restore the earlier setup first.</p>
    </div>}

    <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-4">
      <div>
        <FieldLabel field="resolution" source={draft.resolution.source} htmlFor="baseline-resolution-width" />
        <div className="mt-1 flex items-center gap-2">
          <input id="baseline-resolution-width" aria-label="Game resolution width in pixels" inputMode="numeric" placeholder="Width" className={`${FIELD_CLASS} mt-0`} value={text.width}
            onChange={(event) => { setTextField('width', event.target.value); updateResolution(event.target.value, text.height); }} />
          <span className="text-slate-500" aria-hidden="true">×</span>
          <input aria-label="Game resolution height in pixels" inputMode="numeric" placeholder="Height" className={`${FIELD_CLASS} mt-0`} value={text.height}
            onChange={(event) => { setTextField('height', event.target.value); updateResolution(text.width, event.target.value); }} />
        </div>
        <p className="mt-1 text-[11px] text-slate-500">What the game renders at, from its settings — not your desktop size.</p>
      </div>

      <div>
        <FieldLabel field="refreshHz" source={draft.refreshHz.source} htmlFor="baseline-refresh" />
        <input id="baseline-refresh" inputMode="numeric" placeholder="e.g. 144" className={FIELD_CLASS} value={text.refresh}
          onChange={(event) => { setTextField('refresh', event.target.value); updateRefresh(event.target.value); }} />
      </div>

      <EnumField field="displayMode" value={draft.displayMode} options={DISPLAY_MODES} labels={OPTION_LABELS.displayMode} onChange={(value) => set('displayMode', value)} />

      <div>
        <FieldLabel field="frameCap" source={draft.frameCap.source} htmlFor="baseline-frame-cap" />
        <select id="baseline-frame-cap" className={FIELD_CLASS} value={capMode} onChange={(event) => updateCap(event.target.value as typeof capMode, text.cap)}>
          <option value="">Not known</option>
          <option value="UNCAPPED">No cap</option>
          <option value="CAP">Capped at…</option>
        </select>
        {capMode === 'CAP' && <input aria-label="Frame cap in frames per second" inputMode="numeric" placeholder="FPS, e.g. 141" className={FIELD_CLASS} value={text.cap}
          onChange={(event) => { setTextField('cap', event.target.value); updateCap('CAP', event.target.value); }} />}
      </div>

      <EnumField field="vsync" value={draft.vsync} options={SYNC_MODES} labels={OPTION_LABELS.vsync} onChange={(value) => set('vsync', value)} />
      <EnumField field="vrr" value={draft.vrr} options={ON_OFF} labels={OPTION_LABELS.onOff} onChange={(value) => set('vrr', value)} />

      <div>
        <FieldLabel field="vrrRange" source={draft.vrrRange.source} htmlFor="baseline-vrr-min" />
        <div className="mt-1 flex items-center gap-2">
          <input id="baseline-vrr-min" aria-label="G-SYNC or FreeSync range minimum in hertz" inputMode="numeric" placeholder="Min Hz" className={`${FIELD_CLASS} mt-0`} value={text.vrrMin}
            onChange={(event) => { setTextField('vrrMin', event.target.value); updateVrrRange(event.target.value, text.vrrMax); }} />
          <span className="text-slate-500" aria-hidden="true">–</span>
          <input aria-label="G-SYNC or FreeSync range maximum in hertz" inputMode="numeric" placeholder="Max Hz" className={`${FIELD_CLASS} mt-0`} value={text.vrrMax}
            onChange={(event) => { setTextField('vrrMax', event.target.value); updateVrrRange(text.vrrMin, event.target.value); }} />
        </div>
        <p className="mt-1 text-[11px] text-slate-500">Optional. Listed in your monitor's manual or specifications.</p>
      </div>

      <EnumField field="hdr" value={draft.hdr} options={ON_OFF} labels={OPTION_LABELS.onOff} onChange={(value) => set('hdr', value)} />
      <EnumField field="latency" value={draft.latency} options={LATENCY_FEATURES} labels={OPTION_LABELS.latency} onChange={(value) => set('latency', value)} />
    </div>

    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button type="button" onClick={() => void save()} className="rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-200">{existing ? 'Save changes to baseline' : 'Save baseline'}</button>
      {existing && <button type="button" onClick={() => void discard()} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 px-3 py-2 text-sm font-semibold text-rose-200"><Trash2 className="h-4 w-4" /> Discard baseline</button>}
      {existing && <span className="text-xs text-slate-500">Saved {new Date(existing.savedAt).toLocaleString()}</span>}
    </div>
    {missing.length > 0 && !error && <p className="mt-2 text-xs text-slate-400">Still needed to save: {missing.join(' · ')}</p>}
    {error && <p role="alert" className="mt-2 text-xs text-amber-200"><ErrorText text={error} /></p>}
    {notice && <p role="status" className="mt-2 text-xs text-emerald-200">{notice}</p>}
  </div>;
}
