export type ShortcutAction =
  | { kind: 'go'; hash: string }
  | { kind: 'music' }
  | { kind: 'sfx' }
  | { kind: 'mode'; mode: 'time-attack' | 'competition' }
  | { kind: 'difficulty' };
export interface ShortcutContext { screen: string; dev: boolean; difficultyVisible: boolean }

const SCREEN_KEYS: Record<string, [string, string]> = { Digit1: ['hangar', ''], Digit2: ['campaign', 'campaign'], Digit3: ['shop', 'shop'] };

// event.code (not key): Korean IME turns key into 'ㅂ'. screen: 'hangar' | 'campaign' | 'shop' | 'sound-lab' | 'drive'.
export function menuShortcut(code: string, { screen, dev, difficultyVisible }: ShortcutContext): ShortcutAction | null {
  if (code === 'KeyM') return { kind: 'music' };
  if (code === 'KeyN') return { kind: 'sfx' };
  if (screen === 'campaign' && difficultyVisible && code === 'KeyD') return { kind: 'difficulty' };
  if (screen === 'drive') return null;
  if (screen === 'campaign' && (code === 'KeyT' || code === 'KeyR')) return { kind: 'mode', mode: code === 'KeyT' ? 'time-attack' : 'competition' };
  if (code === 'Digit4') return dev && screen !== 'sound-lab' ? { kind: 'go', hash: 'sound-lab' } : null;
  const target = SCREEN_KEYS[code];
  return target && target[0] !== screen ? { kind: 'go', hash: target[1] } : null;
}
