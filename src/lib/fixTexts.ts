/**
 * Plain wording for the "Why, undo and how to check" part of each suggested fix. The
 * capability registry keeps the precise technical wording for Show details and reviews;
 * these say the same things in everyday language. Every limit the registry states (what
 * cannot be undone, when undo is refused) is kept here too.
 */
export interface FixTexts {
  expectedBenefit: string;
  undo: string;
  verification: string;
}

const RECORDED = 'The result is recorded in Restore.';

export const FIX_TEXTS: Readonly<Record<string, FixTexts>> = Object.freeze({
  'startup:disable-current-user-run': {
    expectedBenefit: 'Less starting up in the background when you sign in. It does not promise a faster boot.',
    undo: 'Undo puts the startup entry back exactly as it was. Undo is refused if something else has since been saved under the same name.',
    verification: `Dialed reads the entry again afterwards to confirm it is gone, or back after an undo. ${RECORDED}`,
  },
  'startup:disable-machine-run': {
    expectedBenefit: 'Less starting up in the background when anyone signs in to this PC. It does not promise a faster boot.',
    undo: 'Undo puts the startup entry back exactly as it was, for all users. Undo is refused if something else has since been saved under the same name.',
    verification: `Dialed reads the entry again afterwards to confirm it is gone, or back after an undo. ${RECORDED}`,
  },
  'process:enable-ecoqos': {
    expectedBenefit: 'The app gets a lower share of the processor, leaving more for your game. It does not promise higher FPS.',
    undo: 'Undo turns efficiency mode off again while the app is still running. Once the app closes the setting is gone anyway, so there is nothing to undo.',
    verification: `Dialed asks Windows afterwards whether that same running app is in efficiency mode. ${RECORDED}`,
  },
  'policy:disable-windows-consumer-features': {
    expectedBenefit: 'Windows stops adding suggested apps and sponsored content, on editions that follow this policy.',
    undo: 'Undo puts the policy back exactly as it was. Undo is refused if the policy was changed after Dialed set it.',
    verification: `Dialed creates a restore point first (Windows allows one a day), then reads the policy again after the change and after an undo. ${RECORDED}`,
  },
  'timing:restore-automatic-clock-source': {
    expectedBenefit: 'Removes a forced clock setting so Windows chooses its own again. Whether games feel different depends on the PC. Measure it.',
    undo: 'Undo puts the previous setting back. Undo is refused if the boot setting was changed after Dialed changed it.',
    verification: 'Dialed reads the boot setting again afterwards. Restart, then compare before-and-after recordings to see any effect.',
  },
  'timing:disable-dynamic-tick': {
    expectedBenefit: 'Can make timing steadier on some PCs, but it depends on the hardware and can raise power use. Measure it.',
    undo: 'Undo puts the previous setting back, or removes it if there was none. Undo is refused if the boot setting was changed after Dialed changed it.',
    verification: 'Dialed reads the boot setting again afterwards. Restart, then compare recordings, power use and temperatures.',
  },
  'maintenance:clear-temp-files': {
    expectedBenefit: 'Frees disk space. It does not make the PC faster.',
    undo: 'Deleted files cannot be brought back, so there is no undo.',
    verification: `Dialed counts only the files it actually deleted and reports that space. ${RECORDED}`,
  },
  'maintenance:clear-shader-caches': {
    expectedBenefit: 'Clears old graphics caches, which can help after a driver update, and frees space. Games rebuild them, so the next few launches may stutter briefly.',
    undo: 'Deleted caches cannot be brought back. Games rebuild them on their own.',
    verification: `Dialed counts only the files it actually deleted and reports that space. ${RECORDED}`,
  },
  'maintenance:clear-crash-dumps': {
    expectedBenefit: 'Frees space used by old crash reports. It does not make the PC faster.',
    undo: 'Deleted files cannot be brought back, so there is no undo.',
    verification: `Dialed counts only the files it actually deleted and reports that space. ${RECORDED}`,
  },
  'maintenance:retrim-drive': {
    expectedBenefit: 'Routine SSD upkeep that Windows also does on a schedule. It does not promise a speed-up.',
    undo: 'Nothing to undo. It is a one-off maintenance request, not a setting.',
    verification: `Windows reports whether it accepted the request for that drive. ${RECORDED}`,
  },
});

/** Why each kind of fix is listed. */
export const WHY_LISTED = Object.freeze({
  startup: 'It starts when you sign in, and Dialed can turn it off and back on safely.',
  process: 'It is running in the background, is not in efficiency mode, and is not on the list of apps Dialed never touches.',
  policy: 'This Windows preference is currently off on your PC.',
  timing: 'A boot timing experiment is possible on this PC. It is not ticked by default, and it needs a restart.',
});

export function fixTextsFor(capabilityId: string): FixTexts | null {
  return Object.prototype.hasOwnProperty.call(FIX_TEXTS, capabilityId) ? FIX_TEXTS[capabilityId] : null;
}
