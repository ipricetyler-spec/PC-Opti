// One dynamic import per sidebar section. App lazily loads each section's components through
// these, so a section's code arrives together as one chunk the first time it is opened,
// instead of every section's code being in the chunk that must load before Home can show.
//
// Restore is deliberately not here. It is where the error screen's "Open recovery" leads, so
// it must still open when some other section's chunk cannot be loaded.
export const loadScanDetails = () => import('./scanDetails');
export const loadTweaks = () => import('./tweaks');
export const loadGames = () => import('./games');
export const loadGpu = () => import('./gpu');
export const loadMeasure = () => import('./measure');
export const loadSettings = () => import('./settings');
