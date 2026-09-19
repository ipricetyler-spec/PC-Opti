export interface AppearancePreferences {
  comfortable: boolean;
  simpleBackground: boolean;
}

export const APPEARANCE_STORAGE_KEY = 'dialed-appearance:v1';
export const DEFAULT_APPEARANCE: AppearancePreferences = { comfortable: false, simpleBackground: false };

export function parseAppearance(raw: string | null): AppearancePreferences {
  if (!raw || raw.length > 512) return { ...DEFAULT_APPEARANCE };
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_APPEARANCE };
    const record = value as Record<string, unknown>;
    return { comfortable: record.comfortable === true, simpleBackground: record.simpleBackground === true };
  } catch { return { ...DEFAULT_APPEARANCE }; }
}

export function readAppearance(): AppearancePreferences {
  try { return parseAppearance(localStorage.getItem(APPEARANCE_STORAGE_KEY)); }
  catch { return { ...DEFAULT_APPEARANCE }; }
}

export function applyAppearance(value: AppearancePreferences): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.density = value.comfortable ? 'comfortable' : 'compact';
  document.documentElement.dataset.background = value.simpleBackground ? 'simple' : 'layered';
}
