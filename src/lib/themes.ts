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
  {
    id: 'console-gold',
    name: 'Console Gold',
    description: 'Console\'s layout in black and gold: near-black panels, gold for what is on, ivory for what to measure.',
    swatches: ['#0a0a0a', '#c9a866', '#e6dcc6'],
  },
  {
    id: 'instrument-gold',
    name: 'Instrument Gold',
    description: 'Instrument\'s ruled, dense layout in black and antique gold, with IBM Plex type.',
    swatches: ['#0d0d0c', '#b8955a', '#d8c7a1'],
  },
] as const;

export type AppThemeId = typeof APP_THEMES[number]['id'];

// Black and gold matches the logo (owner, 2026-10-03). A stored choice still wins.
export const DEFAULT_APP_THEME: AppThemeId = 'console-gold';

export function isAppThemeId(value: unknown): value is AppThemeId {
  return APP_THEMES.some((theme) => theme.id === value);
}
