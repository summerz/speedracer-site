export type ShortcutAction =
  | { kind: 'go'; hash: string }
  | { kind: 'music' }
  | { kind: 'mode'; mode: 'time-attack' | 'competition' }
  | { kind: 'challenge'; challenge: 'easy' | 'normal' | 'hard' };
export interface ShortcutContext { screen: string; dev: boolean; difficultyVisible: boolean }

const SCREEN_KEYS: Record<string, [string, string]> = { Digit1: ['hangar', ''], Digit2: ['campaign', 'campaign'], Digit3: ['shop', 'shop'] };
const CHALLENGE_KEYS = { KeyE: 'easy', KeyM: 'normal', KeyD: 'hard' } as const;

// event.code (not key): Korean IME turns key into 'ㅂ'. screen: 'hangar' | 'campaign' | 'shop' | 'sound-lab' | 'drive'.
export function menuShortcut(code: string, { screen, dev, difficultyVisible }: ShortcutContext): ShortcutAction | null {
  if (screen === 'campaign' && difficultyVisible && code in CHALLENGE_KEYS) return { kind: 'challenge', challenge: CHALLENGE_KEYS[code as keyof typeof CHALLENGE_KEYS] };
  if (code === 'KeyM') return { kind: 'music' };
  if (screen === 'drive') return null;
  if (screen === 'campaign' && (code === 'KeyT' || code === 'KeyR')) return { kind: 'mode', mode: code === 'KeyT' ? 'time-attack' : 'competition' };
  if (code === 'Digit4') return dev && screen !== 'sound-lab' ? { kind: 'go', hash: 'sound-lab' } : null;
  const target = SCREEN_KEYS[code];
  return target && target[0] !== screen ? { kind: 'go', hash: target[1] } : null;
}
