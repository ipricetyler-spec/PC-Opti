import { ErrorText } from './ErrorText';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, FlaskConical, RotateCcw } from 'lucide-react';
import type { AuditJournalEntry } from '../types';
import { TWEAK_GROUPS, changedLabel, tweakMatches, type BatchAction, type TweakCardState, type TweakDestination } from '../lib/tweaks';

export interface UserSettingState {
  enabled: boolean | null;
  manageable: boolean;
  detail?: string;
  unsupported?: string;
  /** What Windows does with no value (null when it depends on the driver). */
  windowsDefault?: boolean | null;
  /** The current value differs from that default. */
  differsFromDefault?: boolean;
  /** Set on this PC although this Windows edition ignores it. */
  leftover?: boolean;
}

/** One finished item of an "Apply selected" run. */
export interface BatchResult { title: string; ok: boolean; message: string }

/** A setting changed from the Windows default by something other than Dialed. */
export interface OutsideChange {
  onReturnToDefault: () => void;
}

function TweakCard({ card, restoringId, busy, userSetting, onOpen, onUndo, onReviewChanges, onToggle, onTest, focused, outside, batchAction, selected, onSelect }: {
  focused?: boolean;
  batchAction?: BatchAction;
  selected?: boolean;
  onSelect?: (selected: boolean) => void;
  outside?: OutsideChange;
  card: TweakCardState;
  restoringId: string | null;
  busy: boolean;
  userSetting?: UserSettingState;
  onOpen: (destination: TweakDestination) => void;
  onUndo: (entry: AuditJournalEntry) => void;
  onReviewChanges: () => void;
  onToggle: (card: TweakCardState, enable: boolean) => void;
  /** Present when this tweak can be tested before and after in Measure. */
  onTest?: () => void;
}) {
  const { definition, state, undoEntry } = card;
  const unsupported = userSetting?.unsupported ?? null;
  const changed = changedLabel(card);
  const detailsId = `tweak-${definition.id}-details`;
  const [open, setOpen] = useState(false);
  const tone = changed ? 'tweak-card-changed' : definition.measureFirst ? 'tweak-card-experiment' : '';
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { if (focused) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, [focused]);
  return <article ref={ref} id={`tweak-${definition.id}`} className={`tweak-card ${tone} min-w-0 rounded-lg p-4 ${focused ? 'ring-2 ring-cyan-400/70' : ''}`}>
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2">
        {batchAction && onSelect && <input type="checkbox" checked={Boolean(selected)} disabled={busy || restoringId !== null} onChange={(event) => onSelect(event.target.checked)} aria-label={`Select ${definition.title}: ${batchAction.label}`} className="mt-0.5 h-4 w-4 shrink-0 accent-cyan-400" />}
        <div className="min-w-0">
        <h4 className="text-sm font-semibold text-white">{definition.title}</h4>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">{definition.summary}</p>
        </div>
      </div>
      {definition.measureFirst && <span className="tweak-badge-measure inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold"><FlaskConical className="h-3 w-3" aria-hidden="true" />Measure it</span>}
    </div>
    <p className="mt-3 text-xs text-slate-300"><span className="text-slate-500">Now: </span><span className="font-mono">{state ?? 'Open to check'}</span></p>
    {changed && <p className="tweak-changed-label mt-1 text-xs font-semibold">{changed}{definition.requiresRestart ? ' · takes effect after a restart' : ''}</p>}
    {(definition.requiresAdmin || definition.requiresRestart) && <p className="mt-1 text-[11px] text-slate-500">{[definition.requiresAdmin && 'Needs administrator rights', definition.requiresRestart && 'needs a restart'].filter(Boolean).join(' · ')}</p>}
    <div className="tweak-actions mt-3 flex flex-wrap items-center gap-2">
      {unsupported && <p className="w-full text-xs text-amber-200">{unsupported}</p>}
      {unsupported && userSetting?.leftover && <><p className="w-full text-xs text-slate-300">This policy is still set on this PC (Dialed did not set it), but Windows ignores it here. Removing it changes nothing about how Windows behaves; it only clears the leftover. You can undo the removal in Restore.</p><button type="button" disabled={busy || restoringId !== null} onClick={() => onToggle(card, false)} className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-slate-500 disabled:opacity-50">{busy ? 'Working…' : 'Remove leftover'}</button></>}
      {outside && <p className="w-full text-xs text-sky-200">Set outside Dialed: another tool or an administrator changed this from the Windows default. Try <strong>Test it</strong> to see whether it helps on your PC, or return it to the Windows default. Either way you can undo it.</p>}
      {outside && <button type="button" disabled={busy || restoringId !== null} onClick={outside.onReturnToDefault} className="rounded-md border border-sky-400/40 px-3 py-1.5 text-xs font-semibold text-sky-100 hover:border-sky-300 disabled:opacity-50">{busy ? 'Working…' : 'Return to Windows default'}</button>}
      {!unsupported && definition.destination && <button type="button" onClick={() => onOpen(definition.destination!)} className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-slate-500">{definition.actionLabel}</button>}
      {definition.oneWay && userSetting?.enabled === false && userSetting.manageable && <button type="button" disabled={busy || restoringId !== null} onClick={() => onToggle(card, true)} className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-slate-500 disabled:opacity-50">{busy ? 'Working…' : definition.actionLabel}</button>}
      {!definition.oneWay && definition.userSettingId && userSetting && userSetting.enabled === null && userSetting.manageable && (['on', 'off'] as const).map((target) => <button key={target} type="button" disabled={busy || restoringId !== null} onClick={() => onToggle(card, target === 'on')} className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-slate-500 disabled:opacity-50">{busy ? 'Working…' : `Turn ${target}`}</button>)}
      {!outside && !definition.oneWay && definition.userSettingId && userSetting && userSetting.enabled !== null && userSetting.manageable && <button type="button" disabled={busy || restoringId !== null} onClick={() => onToggle(card, !userSetting.enabled)} className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-slate-500 disabled:opacity-50">{busy ? 'Working…' : userSetting.enabled ? 'Turn off' : 'Turn on'}</button>}
      {definition.userSettingId && userSetting && !userSetting.manageable && !unsupported && <span className="text-xs text-amber-200">Stored in a form Dialed will not overwrite. Change it in Windows Settings.</span>}
      {undoEntry && <button type="button" disabled={restoringId !== null} onClick={() => onUndo(undoEntry)} className="tweak-undo inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50"><RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />{restoringId === undoEntry.id ? 'Undoing…' : 'Undo'}</button>}
      {!undoEntry && card.changes.length > 0 && <button type="button" onClick={onReviewChanges} className="tweak-undo inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold"><RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />Undo in Restore</button>}
      {onTest && !unsupported && <button type="button" onClick={onTest} className="tweak-badge-measure inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold"><FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />Test it</button>}
      <button type="button" aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen((value) => !value)} className="ml-auto inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200">Details<ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" /></button>
    </div>
    {open && <dl id={detailsId} className="mt-3 grid gap-2 border-t border-slate-800 pt-3 text-xs leading-relaxed">
      {([['What it changes', definition.whatChanges], ['When it helps', definition.whenItHelps], ['Leave it if', definition.leaveItIf], ['Undo', definition.undo]] as const).map(([label, text]) => <div key={label}><dt className="font-semibold text-slate-300">{label}</dt><dd className="text-slate-400">{text}</dd></div>)}
      {definition.suggested && <div><dt className="font-semibold text-slate-300">Dialed suggests</dt><dd className="text-slate-400">{definition.suggested === 'on' ? 'On' : 'Off'}, for most gaming PCs.</dd></div>}
      {definition.measureFirst && <div><dt className="font-semibold text-slate-300">Keep it only if it helps</dt><dd className="text-slate-400">Results vary by PC. Use Test it: Dialed measures your game before and after, makes the change for you, and undoes it if your own runs do not improve.</dd></div>}
    </dl>}
  </article>;
}

export function TweaksOverview({ heading, cards, restoringId, userSettings, busySettingId, error, onOpen, onUndo, onReviewChanges, onToggle, testableIds, onTest, focusId, outsideChanges, batch }: {
  /** Title and introduction; the Tweaks page wording by default. */
  heading?: { title: string; intro: string };
  cards: TweakCardState[];
  restoringId: string | null;
  userSettings: Partial<Record<string, UserSettingState>>;
  busySettingId: string | null;
  error: string | null;
  onOpen: (destination: TweakDestination) => void;
  onUndo: (entry: AuditJournalEntry) => void;
  onReviewChanges: () => void;
  onToggle: (card: TweakCardState, enable: boolean) => void;
  testableIds?: Set<string>;
  onTest?: (tweakId: string) => void;
  /** A tweak opened from search: scrolled to and outlined. */
  focusId?: string | null;
  /** Cards whose setting was changed from the Windows default outside Dialed. */
  outsideChanges?: Partial<Record<string, OutsideChange>>;
  /** "Apply selected": the change each selectable card would make. */
  batch?: {
    actions: Partial<Record<string, BatchAction>>;
    selected: Set<string>;
    onSelect: (tweakId: string, selected: boolean) => void;
    onApply: () => void;
    onClear: () => void;
    running: boolean;
    results: BatchResult[] | null;
    onUndoRun?: () => void;
  };
}) {
  const [query, setQuery] = useState('');
  // Opening a tweak from search clears any filter that would hide it.
  useEffect(() => { if (focusId) setQuery(''); }, [focusId]);
  const shown = cards.filter((card) => tweakMatches(card.definition, query));
  const changedCount = cards.filter((card) => card.changes.length).length;
  return <div className="space-y-8">
    <section>
      <h2 className="text-2xl font-bold text-white">{heading?.title ?? 'Tweaks'}</h2>
      <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-400">{heading?.intro ?? 'Every setting Dialed can change or guide, with what it does and when to leave it alone. Nothing here changes on its own: each change is previewed, confirmed, checked afterwards and can be undone.'}</p>
      {cards.length > 4 && <div className="mt-3 flex flex-wrap items-center gap-2"><label className="sr-only" htmlFor="tweak-filter">Find a tweak</label><input id="tweak-filter" type="search" maxLength={60} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setQuery(''); }} placeholder="Find a tweak…" className="w-64 max-w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200" />{query.trim() && <span role="status" className="text-xs text-slate-400">{shown.length ? `${shown.length} match${shown.length === 1 ? '' : 'es'}` : 'No tweak matches that.'}</span>}</div>}
      {batch && <div className="sticky top-2 z-10 mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-700 bg-slate-950/95 px-3 py-2 text-xs">
        <span role="status" className="text-slate-300">{batch.selected.size ? `${batch.selected.size} selected` : 'Tick several tweaks to apply them together.'}</span>
        <button type="button" disabled={!batch.selected.size || batch.running} onClick={batch.onApply} className="rounded-md bg-cyan-400 px-3 py-1.5 font-semibold text-slate-950 disabled:opacity-40">{batch.running ? 'Applying…' : 'Apply selected'}</button>
        {batch.selected.size > 0 && !batch.running && <button type="button" onClick={batch.onClear} className="rounded-md border border-slate-700 px-3 py-1.5 font-semibold text-slate-300">Clear</button>}
      </div>}
      {batch?.results && <div role="log" aria-label="Apply selected results" className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs">
        <p className="font-semibold text-slate-200">{batch.results.filter((item) => item.ok).length} of {batch.results.length} applied</p>
        <ul className="mt-2 space-y-1">{batch.results.map((item) => <li key={item.title} className={item.ok ? 'text-emerald-200' : 'text-amber-200'}>{item.ok ? '✓' : '✗'} {item.title}: <ErrorText text={item.message} /></li>)}</ul>
        {batch.onUndoRun && <button type="button" onClick={batch.onUndoRun} className="tweak-undo mt-2 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-semibold"><RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />Undo this run</button>}
      </div>}
      {error && <p role="alert" className="mt-2 text-xs text-amber-200"><ErrorText text={error} /></p>}
      <p role="status" className="mt-2 text-xs text-slate-500">{changedCount ? `${changedCount} setting${changedCount === 1 ? ' has' : 's have'} a change made by Dialed, marked with a border.` : 'Dialed has not changed any of these settings.'}</p>
    </section>
    {TWEAK_GROUPS.map((group) => {
      const inGroup = shown.filter((card) => card.definition.group === group);
      if (!inGroup.length) return null;
      return <section key={group} aria-labelledby={`tweak-group-${group.replace(/\W+/g, '-')}`}>
        <h3 id={`tweak-group-${group.replace(/\W+/g, '-')}`} className="tweak-group-label mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">{group}</h3>
        <div className="tweak-grid grid gap-3 md:grid-cols-2">{inGroup.map((card) => <TweakCard key={card.definition.id} card={card} restoringId={restoringId} busy={busySettingId !== null && busySettingId === card.definition.userSettingId} userSetting={userSettings[card.definition.userSettingId ?? card.definition.id]} onOpen={onOpen} onUndo={onUndo} onReviewChanges={onReviewChanges} onToggle={onToggle} onTest={onTest && testableIds?.has(card.definition.id) ? () => onTest(card.definition.id) : undefined} focused={focusId === card.definition.id} outside={outsideChanges?.[card.definition.id]} batchAction={batch?.actions[card.definition.id]} selected={batch?.selected.has(card.definition.id)} onSelect={batch ? (value) => batch.onSelect(card.definition.id, value) : undefined} />)}</div>
      </section>;
    })}
  </div>;
}

/** Reads the active power plan name for the Power plan card. Read-only. */
/** The active plan's name. It reloads whenever refreshKey changes, e.g. after any recorded change. */
export function usePowerPlanName(enabled: boolean, refreshKey?: unknown): string | null {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || !window.pcOptiNative) return;
    let live = true;
    window.pcOptiNative.listPowerPlans()
      .then((inventory) => { if (live) setName(inventory.items.find((plan) => plan.guid === inventory.activeGuid)?.name ?? null); })
      .catch(() => { if (live) setName(null); });
    return () => { live = false; };
  }, [enabled]);
  return name;
}
