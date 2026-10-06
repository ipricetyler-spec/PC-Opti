// The recording hotkey: off by default, chosen from a short fixed list, remembered per viewer.
export const RECORDING_HOTKEY_KEY = 'dialed-recording-hotkey:v1';
export const RECORDING_HOTKEYS = ['Control+Shift+F9', 'Control+Shift+F10', 'Control+Alt+F9', 'Control+Alt+F10'] as const;
export type RecordingHotkey = typeof RECORDING_HOTKEYS[number];

export const hotkeyLabel = (accelerator: RecordingHotkey) => accelerator.replace('Control', 'Ctrl').replaceAll('+', ' + ');

export function readRecordingHotkey(): RecordingHotkey | null {
  try {
    const stored = window.localStorage.getItem(RECORDING_HOTKEY_KEY);
    return (RECORDING_HOTKEYS as readonly string[]).includes(stored ?? '') ? stored as RecordingHotkey : null;
  } catch { return null; }
}

export function saveRecordingHotkey(value: RecordingHotkey | null) {
  try { if (value) window.localStorage.setItem(RECORDING_HOTKEY_KEY, value); else window.localStorage.removeItem(RECORDING_HOTKEY_KEY); } catch { /* a convenience only */ }
}

/**
 * What a key press should do. Starting needs a recording the reader already confirmed in Dialed
 * for this game, because a confirmation cannot be shown over a game.
 */
export function hotkeyAction(input: { recording: boolean; busy: boolean; toolReady: boolean; targetChosen: boolean; approved: boolean }): 'STOP' | 'START' | 'REFUSE' {
  if (input.recording) return input.busy ? 'REFUSE' : 'STOP';
  if (input.busy || !input.toolReady || !input.targetChosen || !input.approved) return 'REFUSE';
  return 'START';
}

/** A short cue the reader can hear from inside a game: rising for start, falling for stop, low for refused. */
export function playCue(kind: 'START' | 'STOP' | 'REFUSE') {
  try {
    const context = new AudioContext();
    const notes = kind === 'START' ? [660, 880] : kind === 'STOP' ? [880, 660] : [220, 220];
    notes.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = frequency;
      gain.gain.value = 0.08;
      oscillator.connect(gain).connect(context.destination);
      const at = context.currentTime + index * 0.14;
      oscillator.start(at);
      oscillator.stop(at + 0.11);
    });
    setTimeout(() => void context.close(), 600);
  } catch { /* sound is a courtesy; the recording itself is unaffected */ }
}
