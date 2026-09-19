import { Check, Palette } from 'lucide-react';
import { useState } from 'react';
import { APP_THEMES, type AppThemeId } from '../lib/themes';
import { APPEARANCE_STORAGE_KEY, applyAppearance, readAppearance, type AppearancePreferences } from '../lib/appearancePreferences';

// This module is eagerly imported by App, so saved readability applies on Home
// at startup too, before the user opens Settings.
applyAppearance(readAppearance());

interface ThemePickerProps {
  activeTheme: AppThemeId;
  onChange: (theme: AppThemeId) => void;
}

export function ThemePicker({ activeTheme, onChange }: ThemePickerProps) {
  const [appearance, setAppearance] = useState(readAppearance);
  const [saveError, setSaveError] = useState(false);
  function updateAppearance(next: AppearancePreferences) {
    setAppearance(next);
    applyAppearance(next);
    try { localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(next)); setSaveError(false); }
    catch { setSaveError(true); }
  }
  return <section className="mb-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-xl">
    <div className="flex items-start gap-3">
      <div className="rounded-lg border border-cyan-400/20 bg-cyan-400/10 p-2 text-cyan-300"><Palette className="h-5 w-5" /></div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-cyan-300">Appearance</p>
        <h2 className="mt-1 text-xl font-bold text-white">Theme</h2>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">Changes how Dialed looks. Nothing else.</p>
      </div>
    </div>
    <div className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-3">
      {APP_THEMES.map((theme) => {
        const selected = theme.id === activeTheme;
        return <button key={theme.id} type="button" aria-pressed={selected} onClick={() => onChange(theme.id)} className={`rounded-xl border p-3 text-left transition ${selected ? 'border-cyan-400/60 bg-cyan-500/10 ring-1 ring-cyan-400/30' : 'border-slate-700 bg-slate-950/45 hover:border-slate-500'}`}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap gap-1.5">{theme.swatches.map((swatch) => <span key={swatch} className="h-5 w-5 shrink-0 rounded-full border border-white/10" style={{ backgroundColor: swatch }} />)}</div>
            {selected ? <Check className="h-4 w-4 shrink-0 text-cyan-300" /> : null}
          </div>
          <h3 className="mt-3 text-sm font-semibold text-slate-100">{theme.name}</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{theme.description}</p>
        </button>;
      })}
    </div>
    <fieldset className="mt-5 space-y-3 border-t border-slate-700 pt-4">
      <legend className="px-1 text-sm font-semibold text-slate-100">Readability</legend>
      <label className="flex items-start gap-3 text-sm text-slate-200">
        <input className="mt-1" type="checkbox" checked={appearance.comfortable} onChange={(event) => updateAppearance({ ...appearance, comfortable: event.target.checked })} />
        <span>Comfortable text and controls<span className="mt-1 block text-xs text-slate-400">Larger text, spacing and control targets throughout Dialed.</span></span>
      </label>
      <label className="flex items-start gap-3 text-sm text-slate-200">
        <input className="mt-1" type="checkbox" checked={appearance.simpleBackground} onChange={(event) => updateAppearance({ ...appearance, simpleBackground: event.target.checked })} />
        <span>Simple backgrounds<span className="mt-1 block text-xs text-slate-400">Use flat surfaces while keeping the selected theme's colours.</span></span>
      </label>
      <p className="text-xs text-slate-400">Dialed also follows your system's reduced-motion preference.</p>
      {saveError && <p role="status" className="text-xs text-amber-300">Applied for now, but these preferences could not be saved for the next launch.</p>}
    </fieldset>
  </section>;
}
