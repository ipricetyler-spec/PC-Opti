// Plain names for the settings game profiles change. The raw key stays visible under technical
// details, because it is what the reader would look for in the game's own file.

const NAMES: Record<string, string> = {
  'sg.ShadowQuality': 'Shadows',
  'sg.PostProcessQuality': 'Post-processing',
  'sg.EffectsQuality': 'Effects',
  MotionBlur: 'Motion blur',
  DynamicShadows: 'Dynamic shadows',
};

// Unreal Engine scalability levels, as the in-game menus name them.
const QUALITY = ['Low', 'Medium', 'High', 'Epic', 'Cinematic'];

export function plainSettingName(key: string): string {
  return NAMES[key] ?? key;
}

export function plainSettingValue(key: string, value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return 'Not set';
  if (key.startsWith('sg.') && /^[0-4]$/.test(value)) return QUALITY[Number(value)];
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === 'true' ? 'On' : 'Off';
  return value;
}
