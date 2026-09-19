export const APP_THEMES = [
  {
    id: 'console',
    name: 'Console',
    description: 'Dialed\'s own look: flat navy panels, lime for what is on, amber for what to measure.',
    swatches: ['#0b0e14', '#c6f24e', '#ffb25c'],
  },
  {
    id: 'instrument',
    name: 'Instrument',
    description: 'Graphite panels with an amber accent and IBM Plex type — dense and precise.',
    swatches: ['#111315', '#e8a33d', '#7fb77e'],
  },
] as const;

export type AppThemeId = typeof APP_THEMES[number]['id'];

export const DEFAULT_APP_THEME: AppThemeId = 'console';

export function isAppThemeId(value: unknown): value is AppThemeId {
  return APP_THEMES.some((theme) => theme.id === value);
}
