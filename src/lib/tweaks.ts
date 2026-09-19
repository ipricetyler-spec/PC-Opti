/**
 * The Tweaks page: one card per setting Dialed can change or guide, grouped, each with
 * its current state and a plain explanation. Most cards open the existing guarded screen
 * (preview, confirmation, verification). Simple per-user on/off settings are switched on
 * the card, still behind a confirmation, with the change journaled and verified. "Undo"
 * always uses the verified rollback of the recorded change.
 *
 * Pure, so it can be tested without a browser.
 */
import type { AuditJournalEntry } from '../types';

export type TweakGroup = 'Power' | 'Startup & background' | 'Windows & privacy' | 'Input' | 'Graphics' | 'Experiments' | 'Maintenance';

export const TWEAK_GROUPS: TweakGroup[] = ['Power', 'Startup & background', 'Windows & privacy', 'Input', 'Graphics', 'Experiments', 'Maintenance'];

export type TweakDestination =
  | { tab: 'startup'; view: 'startup' | 'background' | 'windows' | 'timing' | 'maintenance' | 'bios' }
  | { tab: 'game-settings'; view: 'profiles' | 'display' }
  | { tab: 'gpu' };

export interface TweakDefinition {
  id: string;
  group: TweakGroup;
  title: string;
  /** Audit capabilities whose recorded changes belong to this card. */
  capabilityIds: string[];
  /** One card per setting, or a card that stands for many items (startup entries, processes). */
  perItem: boolean;
  summary: string;
  whatChanges: string;
  whenItHelps: string;
  leaveItIf: string;
  undo: string;
  /** Experiments are only kept when your own before/after runs show a benefit. */
  measureFirst: boolean;
  destination: TweakDestination | null;
  actionLabel: string;
  /** A per-user Windows setting Dialed turns on or off directly on the card. */
  userSettingId?: 'game-mode' | 'background-recording' | 'gpu-scheduling' | 'mpo' | 'global-timer-resolution' | 'mouse-acceleration' | 'ultimate-plan' | 'cpu-minimum-state' | 'block-background-apps' | 'exclude-driver-updates' | 'no-auto-restart' | 'windowed-games' | 'usb-selective-suspend' | 'consumer-features';
  /** Which state Dialed suggests, when there is one. */
  suggested?: 'on' | 'off';
  /** Machine-wide settings need administrator rights; some need a restart to take effect. */
  requiresAdmin?: boolean;
  requiresRestart?: boolean;
  /** The card only makes the change (actionLabel); reversing it is done with Undo. */
  oneWay?: boolean;
}

/**
 * Whether a tweak matches a search. Short searches (1-2 letters) match the start of a word
 * in the title, so "se" finds "USB selective suspend" but not "Mouse acceleration"; longer
 * ones match anywhere in the title or summary.
 */
export function tweakMatches(definition: Pick<TweakDefinition, 'title' | 'summary'>, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const title = definition.title.toLowerCase();
  if (title.split(/[^a-z0-9]+/).some((word) => word.startsWith(needle))) return true;
  return needle.length >= 3 && `${title} ${definition.summary.toLowerCase()}`.includes(needle);
}

export const TWEAKS: TweakDefinition[] = [
  {
    id: 'power-plan', group: 'Power', title: 'Power plan', capabilityIds: ['power:switch-plan'], perItem: false,
    summary: 'Which Windows power plan is active.',
    whatChanges: 'Switches the active Windows power plan to one already on this PC. No plan settings are edited.',
    whenItHelps: 'On desktops left on a power-saving plan, a higher-performance plan can keep clocks up during games.',
    leaveItIf: 'You are on a laptop running on battery, or your PC maker\'s own plan is active and working well. On most modern desktop CPUs, Balanced already ramps up quickly.',
    undo: 'Undo switches back to the plan that was active before, if it still exists.',
    measureFirst: false, destination: { tab: 'startup', view: 'windows' }, actionLabel: 'Review plans',
  },
  {
    id: 'ultimate-plan', group: 'Power', title: 'Ultimate Performance plan', capabilityIds: ['power:ultimate-plan'], perItem: false,
    summary: 'A built-in Windows plan that Windows hides on most PCs.',
    whatChanges: 'Adds the Ultimate Performance plan to your plan list by copying Windows\' own hidden plan. It is not switched on; choose it under Power plan if you want it.',
    whenItHelps: 'It keeps the processor and devices fully awake, trimming wake-up delays. On most modern desktop processors, High performance or Balanced behaves almost the same.',
    leaveItIf: 'You are on a laptop, or you care about idle power use and heat. There is little to gain on a modern desktop.',
    undo: 'Undo removes the plan Dialed added. Switch to another plan first if it is active.',
    measureFirst: false, destination: null, actionLabel: 'Add plan', userSettingId: 'ultimate-plan', oneWay: true,
  },
  {
    id: 'startup-apps', group: 'Startup & background', title: 'Startup apps', capabilityIds: ['startup:disable-current-user-run', 'startup:disable-machine-run'], perItem: true,
    summary: 'Programs that start with Windows.',
    whatChanges: 'Removes a chosen program from the Windows Run list so it no longer starts at sign-in. The program itself is not removed.',
    whenItHelps: 'Fewer programs at sign-in means a faster start and less running in the background while you play.',
    leaveItIf: 'It is something you rely on at start: audio or peripheral software, cloud sync, security tools.',
    undo: 'Each removal is recorded and can be restored exactly from Restore.',
    measureFirst: false, destination: { tab: 'startup', view: 'startup' }, actionLabel: 'Review startup apps',
  },
  {
    id: 'ecoqos', group: 'Startup & background', title: 'Background app efficiency mode', capabilityIds: ['process:enable-ecoqos'], perItem: true,
    summary: 'Ask Windows to run chosen background programs in efficiency mode.',
    whatChanges: 'Turns on Windows efficiency mode (EcoQoS) for a running background program in this session. It lowers that program\'s priority and lets Windows run it on slower cores.',
    whenItHelps: 'A busy background program (a launcher, updater or sync tool) competes with your game for CPU time.',
    leaveItIf: 'The program needs to be responsive, like voice chat or streaming software. It only lasts until the program restarts.',
    undo: 'Undo turns efficiency mode back off for that program while it is still running.',
    measureFirst: false, destination: { tab: 'startup', view: 'background' }, actionLabel: 'Review programs',
  },
  {
    id: 'consumer-features', group: 'Windows & privacy', title: 'Windows suggested apps and content', capabilityIds: ['policy:disable-windows-consumer-features'], perItem: false,
    summary: 'Stop Windows installing suggested apps and showing promotional content. Windows Enterprise and Education only.',
    whatChanges: 'Sets the documented Windows policy that turns off "consumer experiences": suggested apps and promotional tiles.',
    whenItHelps: 'Keeps unwanted apps from appearing and running in the background. This is a tidiness and privacy setting, not an FPS setting.',
    leaveItIf: 'You like Windows suggestions. Microsoft documents this policy for Enterprise and Education only; Home and Pro ignore it.',
    undo: 'Undo restores the exact previous policy value, or removes it if it was not set.',
    measureFirst: false, destination: { tab: 'startup', view: 'windows' }, actionLabel: 'Review policy', userSettingId: 'consumer-features',
  },
  {
    id: 'game-mode', group: 'Windows & privacy', title: 'Game Mode', capabilityIds: ['gaming:game-mode'], perItem: false,
    summary: 'Windows prioritizes the game and holds back update installs and notifications while you play.',
    whatChanges: 'Turns Windows Game Mode on or off (Settings › Gaming › Game Mode). One per-user setting.',
    whenItHelps: 'It keeps Windows Update and notifications out of the way during play. It is on by default; turning it off rarely helps.',
    leaveItIf: 'It is already on. If a specific game stutters with it on, test that game with it off and measure.',
    undo: 'Undo puts back the exact previous value, or the Windows default if there was none.',
    measureFirst: false, destination: null, actionLabel: 'Turn on', userSettingId: 'game-mode', suggested: 'on',
  },
  {
    id: 'background-recording', group: 'Windows & privacy', title: 'Game Bar background recording', capabilityIds: ['gaming:background-recording'], perItem: false,
    summary: 'Game Bar "Record what happened": continuous recording of your last few minutes of play.',
    whatChanges: 'Turns background recording on or off (Settings › Gaming › Captures). One per-user setting.',
    whenItHelps: 'Turning it off stops continuous video encoding while you play, which frees a little graphics and disk work.',
    leaveItIf: 'You use it to save clips. Turning it off does not affect taking screenshots or recording on demand.',
    undo: 'Undo puts back the exact previous value, or the Windows default if there was none.',
    measureFirst: false, destination: null, actionLabel: 'Turn off', userSettingId: 'background-recording', suggested: 'off',
  },
  {
    id: 'block-background-apps', group: 'Windows & privacy', title: 'Block background apps', capabilityIds: ['policy:block-background-apps'], perItem: false,
    summary: 'Stop Microsoft Store apps running in the background. Windows Pro, Enterprise and Education only.',
    whatChanges: 'Sets the Windows privacy policy that stops Store apps running in the background. One machine-wide policy; needs administrator rights.',
    whenItHelps: 'Fewer Store apps (such as mail, Xbox or widgets) waking up while you play. It does not affect desktop programs like game launchers.',
    leaveItIf: 'You rely on Store apps for notifications or live updates while they are closed.',
    undo: 'Undo removes the policy again, or restores the exact previous value.',
    measureFirst: false, destination: null, actionLabel: 'Turn on', userSettingId: 'block-background-apps', requiresAdmin: true,
  },
  {
    id: 'exclude-driver-updates', group: 'Windows & privacy', title: 'Keep Windows Update from installing drivers', capabilityIds: ['policy:exclude-windows-update-drivers'], perItem: false,
    summary: 'Stop Windows Update replacing drivers you installed yourself. Windows Pro, Enterprise and Education only.',
    whatChanges: 'Sets the Windows Update policy that leaves drivers out of the monthly Windows updates. One machine-wide policy; needs administrator rights.',
    whenItHelps: 'When Windows Update has replaced your graphics or chipset driver with an older or generic one.',
    leaveItIf: 'You do not update drivers yourself. You then need to get driver updates from your graphics card or motherboard maker. Some Home editions may ignore this policy.',
    undo: 'Undo removes the policy again, or restores the exact previous value.',
    measureFirst: false, destination: null, actionLabel: 'Turn on', userSettingId: 'exclude-driver-updates', requiresAdmin: true,
  },
  {
    id: 'no-auto-restart', group: 'Windows & privacy', title: 'No automatic restart while signed in', capabilityIds: ['policy:no-auto-restart-signed-in'], perItem: false,
    summary: 'Windows waits for you to restart after updates instead of restarting on its own. Windows Pro, Enterprise and Education only.',
    whatChanges: 'Sets the Windows Update policy that prevents automatic restarts while someone is signed in. One machine-wide policy; needs administrator rights.',
    whenItHelps: 'Stops an update restart interrupting a game, a download or a long task. Updates still install.',
    leaveItIf: 'You tend never to restart. Security updates that need a restart wait until you do. Some Home editions may ignore this policy.',
    undo: 'Undo removes the policy again, or restores the exact previous value.',
    measureFirst: false, destination: null, actionLabel: 'Turn on', userSettingId: 'no-auto-restart', requiresAdmin: true,
  },
  {
    id: 'usb-selective-suspend', group: 'Input', title: 'USB selective suspend', capabilityIds: ['power:usb-selective-suspend'], perItem: false,
    summary: 'Whether Windows may put USB devices to sleep while they are idle. Turning it off can stop a mouse, keyboard, headset or controller from dropping out.',
    whatChanges: 'Sets USB selective suspend to Disabled in the active power plan, when plugged in. The battery setting is left alone.',
    whenItHelps: 'Only when a USB device disconnects, stutters or is slow to respond after sitting idle. It fixes that problem; it does not make games faster.',
    leaveItIf: 'Your USB devices work fine. With it off, idle USB devices use a little more power, which matters mostly on laptops.',
    undo: 'Undo turns USB selective suspend back on for the same plan.',
    measureFirst: false, destination: null, actionLabel: 'Turn off', userSettingId: 'usb-selective-suspend', oneWay: true,
  },
  {
    id: 'mouse-acceleration', group: 'Input', title: 'Mouse acceleration', capabilityIds: ['input:mouse-acceleration'], perItem: false,
    summary: 'Windows "Enhance pointer precision": the pointer moves further when you move the mouse faster.',
    whatChanges: 'Turns Enhance pointer precision on or off, writing the same three mouse values Windows Settings does. Applied straight away; no restart.',
    whenItHelps: 'Off, the same hand movement always moves the pointer the same distance, which helps consistent aim on the desktop and in games that use the Windows pointer.',
    leaveItIf: 'You prefer it on for desktop use. Most modern shooters read the mouse directly (raw input) and ignore this setting, so it rarely changes aim in games.',
    undo: 'Undo puts back the exact previous three values.',
    measureFirst: false, destination: null, actionLabel: 'Turn off', userSettingId: 'mouse-acceleration', suggested: 'off',
  },
  {
    id: 'gpu-scheduling', group: 'Graphics', title: 'Hardware-accelerated GPU scheduling', capabilityIds: ['graphics:hardware-gpu-scheduling'], perItem: false,
    summary: 'Lets the graphics card manage its own work queue instead of Windows.',
    whatChanges: 'Turns hardware-accelerated GPU scheduling on or off (Settings › Display › Graphics). One machine-wide setting; needs administrator rights and a restart.',
    whenItHelps: 'It can trim a little CPU overhead on supported cards, and NVIDIA DLSS Frame Generation requires it. Many PCs see no measurable change.',
    leaveItIf: 'Your driver or graphics card does not support it (the setting is then ignored), or a game or capture tool misbehaves with it on.',
    undo: 'Undo puts back the exact previous value, or removes it so the driver decides again. Restart again afterwards.',
    measureFirst: false, destination: null, actionLabel: 'Turn on', userSettingId: 'gpu-scheduling', suggested: 'on', requiresAdmin: true, requiresRestart: true,
  },
  {
    id: 'mpo', group: 'Graphics', title: 'Multiplane overlay (MPO)', capabilityIds: ['graphics:multiplane-overlay'], perItem: false,
    summary: 'Lets the graphics card send parts of the screen (a video, a game window, the pointer) to the monitor as separate layers. Turning it off fixes flicker on some setups.',
    whatChanges: 'With MPO on, Windows hands some layers straight to the display hardware instead of combining everything into one image first, which saves work. Turning it off makes Windows combine every layer itself. It uses the value NVIDIA documents for troubleshooting; one machine-wide setting, needs administrator rights and a restart.',
    whenItHelps: 'Only when you see flicker, black flashes or stutter, most often with NVIDIA cards and two monitors at different refresh rates. It fixes those glitches; it does not make games faster.',
    leaveItIf: 'You have no flicker or stutter. With MPO off, video playback and windowed apps can use slightly more graphics power. In true exclusive fullscreen the game bypasses this layering, so MPO has little effect either way; many games labelled "fullscreen" actually run borderless, where it still applies.',
    undo: 'Undo puts back the exact previous value. Restart again afterwards.',
    measureFirst: false, destination: null, actionLabel: 'Turn off', userSettingId: 'mpo', suggested: 'on', requiresAdmin: true, requiresRestart: true,
  },
  {
    id: 'windowed-games', group: 'Graphics', title: 'Optimizations for windowed games', capabilityIds: ['graphics:windowed-game-optimizations'], perItem: false,
    summary: 'Lets older games that run in a window or borderless use the same faster way of showing frames as fullscreen games.',
    whatChanges: 'Turns the Windows 11 switch in Settings › Display › Graphics on or off, for your account only. Other graphics options stored alongside it are left exactly as they are.',
    whenItHelps: 'DirectX 10 and 11 games played borderless or windowed. It can lower input delay and lets variable refresh rate (G-SYNC, FreeSync) work in a window. DirectX 12 and Vulkan games, and games in exclusive fullscreen, are not affected.',
    leaveItIf: 'A game, overlay or capture tool shows glitches with it on. Some Windows 11 versions already turn it on by default.',
    undo: 'Undo puts back the exact previous value, or removes it so Windows uses its default again. Restart the game afterwards.',
    measureFirst: false, destination: null, actionLabel: 'Turn on', userSettingId: 'windowed-games', suggested: 'on',
  },
  {
    id: 'fullscreen-optimizations', group: 'Graphics', title: 'Fullscreen optimizations per game', capabilityIds: ['graphics:fullscreen-optimizations'], perItem: true,
    summary: 'Whether Windows runs one game\'s fullscreen mode through its own display handling. Set per game, never for every program.',
    whatChanges: 'Ticks or clears “Disable fullscreen optimizations” on the game\'s Compatibility tab, for your account only. Other compatibility options on that game are left as they are.',
    whenItHelps: 'Only when one game has alt-tab trouble, overlay problems or uneven frame pacing in fullscreen. Most games run best with the optimizations left on.',
    leaveItIf: 'The game works well. Turning them off can make alt-tab slower and stops overlays like the Game Bar showing over the game.',
    undo: 'Undo puts back the exact previous compatibility setting for that game.',
    measureFirst: false, destination: { tab: 'gpu' }, actionLabel: 'Choose a game',
  },
  {
    id: 'gpu-preference', group: 'Graphics', title: 'Graphics processor per program', capabilityIds: ['graphics:per-app-gpu-preference'], perItem: true,
    summary: 'Which graphics processor Windows uses for a game.',
    whatChanges: 'Saves the Windows per-program choice between the power-saving and high-performance graphics processor.',
    whenItHelps: 'On PCs with two graphics processors, such as most gaming laptops, when a game runs on the built-in one by mistake.',
    leaveItIf: 'Your PC has only one graphics processor. The choice then has no effect.',
    undo: 'Undo restores the previous choice for that program, or removes it if there was none.',
    measureFirst: false, destination: { tab: 'gpu' }, actionLabel: 'Open GPU',
  },
  {
    id: 'game-profiles', group: 'Graphics', title: 'Game settings profiles', capabilityIds: ['game:config-restore'], perItem: true,
    summary: 'Reviewed settings for supported games, applied to the game\'s own config file.',
    whatChanges: 'Backs up the game\'s settings file, then applies Dialed\'s reviewed profile for that game.',
    whenItHelps: 'When a game\'s defaults favour looks over smoothness and you want a documented starting point.',
    leaveItIf: 'You have already tuned the game yourself. The game may also rewrite its file after updates.',
    undo: 'Restore the backup Dialed made before applying, from Games › Backups.',
    measureFirst: false, destination: { tab: 'game-settings', view: 'profiles' }, actionLabel: 'Open game profiles',
  },
  {
    id: 'dynamic-tick', group: 'Experiments', title: 'Dynamic tick', capabilityIds: ['timing:disable-dynamic-tick', 'timing:restore-default-dynamic-tick'], perItem: false,
    summary: 'A boot setting that changes how Windows schedules its timer.',
    whatChanges: 'Sets the boot option that turns off dynamic tick, so the system timer keeps a regular rhythm. Needs a restart.',
    whenItHelps: 'Some systems report steadier frame pacing. Many see no difference, and power use rises slightly.',
    leaveItIf: 'You are on a laptop, or you will not measure before and after.',
    undo: 'Undo restores the previous boot setting exactly. Restart again afterwards.',
    measureFirst: true, destination: { tab: 'startup', view: 'timing' }, actionLabel: 'Review experiment',
  },
  {
    id: 'clock-source', group: 'Experiments', title: 'Platform clock source', capabilityIds: ['timing:restore-automatic-clock-source'], perItem: false,
    summary: 'Returns a forced clock source to Windows\' automatic choice.',
    whatChanges: 'Removes a forced "use platform clock" boot option, so Windows chooses its timer automatically again. Needs a restart.',
    whenItHelps: 'When another tool forced the platform clock (HPET). Forcing it often makes timing slower, not faster.',
    leaveItIf: 'The option is not set. Dialed only offers this when it is.',
    undo: 'Undo puts the previous boot setting back exactly. Restart again afterwards.',
    measureFirst: true, destination: { tab: 'startup', view: 'timing' }, actionLabel: 'Review experiment',
  },
  {
    id: 'temp-files', group: 'Maintenance', title: 'Temporary files', capabilityIds: ['maintenance:clear-temp-files'], perItem: false,
    summary: 'Delete old files from your temporary folder.',
    whatChanges: 'Deletes files in your user temporary folder that are not in use.',
    whenItHelps: 'Frees disk space. It does not make games faster.',
    leaveItIf: 'You have plenty of free space.',
    undo: 'Deleted files cannot be restored. Dialed lists them before deleting.',
    measureFirst: false, destination: { tab: 'startup', view: 'maintenance' }, actionLabel: 'Review cleanup',
  },
  {
    id: 'shader-caches', group: 'Maintenance', title: 'Graphics shader caches', capabilityIds: ['maintenance:clear-shader-caches'], perItem: false,
    summary: 'Clear the saved shader caches of DirectX and your graphics driver.',
    whatChanges: 'Deletes cached compiled shaders. Games and the driver rebuild them as needed.',
    whenItHelps: 'After a driver update, or when a game stutters or shows glitches that a cache rebuild can fix.',
    leaveItIf: 'Everything runs well. The first sessions afterwards may stutter briefly while shaders rebuild.',
    undo: 'Deleted caches cannot be restored; they are rebuilt automatically.',
    measureFirst: false, destination: { tab: 'startup', view: 'maintenance' }, actionLabel: 'Review caches',
  },
  {
    id: 'retrim', group: 'Maintenance', title: 'SSD ReTRIM', capabilityIds: ['maintenance:retrim-drive'], perItem: false,
    summary: 'Ask Windows to tell an SSD which blocks are free.',
    whatChanges: 'Runs the same ReTRIM Windows runs on a schedule, for one SSD. Needs administrator rights.',
    whenItHelps: 'When scheduled optimization has been turned off or has not run for a while.',
    leaveItIf: 'Windows\' own schedule is on. It already does this.',
    undo: 'Nothing to undo. ReTRIM does not change settings or files.',
    measureFirst: false, destination: { tab: 'startup', view: 'maintenance' }, actionLabel: 'Review drives',
  },
  {
    id: 'cpu-minimum-state', group: 'Experiments', title: 'CPU minimum state 100%', capabilityIds: ['power:cpu-minimum-state'], perItem: false,
    summary: 'The lowest speed the processor may drop to, as a percentage of its maximum. This raises the floor to 100% when plugged in.',
    whatChanges: 'Sets the minimum processor state of the active power plan to 100% when plugged in, so Windows asks the processor not to slow down when it is idle. The battery setting is left alone.',
    whenItHelps: 'Possibly on systems that are slow to raise their clock speed. Modern processors manage their own speed and boost within milliseconds, so many PCs see no difference, and Task Manager samples too slowly to show one.',
    leaveItIf: 'You care about idle power, heat or fan noise, or you will not measure before and after.',
    undo: 'Undo puts back the exact previous percentage on the same plan.',
    measureFirst: true, destination: null, actionLabel: 'Set to 100%', userSettingId: 'cpu-minimum-state', oneWay: true,
  },
  {
    id: 'global-timer-resolution', group: 'Experiments', title: 'Global timer resolution', capabilityIds: ['timing:global-timer-resolution'], perItem: false,
    summary: 'Lets one program\'s timer request apply to the whole system again, as before Windows 11.',
    whatChanges: 'Sets GlobalTimerResolutionRequests = 1 in the kernel settings, or removes it to go back to the Windows 11 default. One machine-wide setting; needs administrator rights and a restart.',
    whenItHelps: 'Possibly when a game depends on a timer resolution another program requests. Claims of large gains in 1% lows are unproven; many PCs see no difference.',
    leaveItIf: 'You are on a laptop (idle power use can rise), on Windows 10 (it has no effect there), or you will not measure before and after.',
    undo: 'Undo removes the value again, or restores the exact previous one. Restart again afterwards.',
    measureFirst: true, destination: null, actionLabel: 'Turn on', userSettingId: 'global-timer-resolution', suggested: 'off', requiresAdmin: true, requiresRestart: true,
  },
  {
    id: 'bios', group: 'Experiments', title: 'BIOS settings guide', capabilityIds: [], perItem: false,
    summary: 'What to check in your BIOS, like memory profiles. Dialed never changes BIOS settings.',
    whatChanges: 'Nothing. A guide to settings you change yourself in the BIOS.',
    whenItHelps: 'Memory running below its rated speed (XMP/EXPO off) is a common, real loss.',
    leaveItIf: 'You are not comfortable in the BIOS. A wrong setting can stop the PC from starting.',
    undo: 'Your motherboard\'s "load defaults" option. Dialed has no undo for BIOS changes.',
    measureFirst: false, destination: { tab: 'startup', view: 'bios' }, actionLabel: 'Open guide',
  },
];

/** Recorded changes that are still in effect and can be undone, newest first. */
export function activeChanges(history: AuditJournalEntry[], capabilityIds: string[]): AuditJournalEntry[] {
  return history
    .filter((entry) => entry.status === 'SUCCESS' && entry.capabilityId && capabilityIds.includes(entry.capabilityId)
      && entry.rollback.available && !entry.rollback.completedAt)
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
}

export interface TweakCardState {
  definition: TweakDefinition;
  /** Current state in plain words, or null when it has not been read. */
  state: string | null;
  changes: AuditJournalEntry[];
  /** For a one-setting card, the change the Undo button reverses. */
  undoEntry: AuditJournalEntry | null;
}

export function buildTweakCards(definitions: TweakDefinition[], history: AuditJournalEntry[], states: Partial<Record<string, string | null>>, available: (definition: TweakDefinition) => boolean = () => true): TweakCardState[] {
  return definitions.filter(available).map((definition) => {
    const changes = activeChanges(history, definition.capabilityIds);
    return {
      definition,
      state: states[definition.id] ?? null,
      changes,
      // Several items (startup entries, programs) cannot share one Undo button; those are
      // reviewed individually in Restore.
      undoEntry: !definition.perItem && changes.length ? changes[0] : null,
    };
  });
}

export function changedLabel(card: TweakCardState): string | null {
  if (!card.changes.length) return null;
  if (card.definition.perItem) return `${card.changes.length} change${card.changes.length === 1 ? '' : 's'} made by Dialed`;
  return `Changed by Dialed ${new Date(card.changes[0].timestamp).toLocaleDateString()}`;
}
