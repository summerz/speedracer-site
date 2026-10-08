/** Pure rules for the race callouts; no DOM or three.js. */
export const PERFECT_START_WINDOW = .15, PERFECT_START_SPEED = .6, OVERTAKE_DEBOUNCE = 1;

/** `pressedAt` is the seconds left until GO when boost was pressed (negative after GO). */
export const isPerfectStart = (pressedAt: number | null) => pressedAt !== null && Math.abs(pressedAt) <= PERFECT_START_WINDOW + 1e-9;

export interface Callout { id: number; kind: 'perfect' | 'gain' | 'loss'; text: string }
export interface Overtake { from: number; to: number; gained: boolean }
/** Reports the net rank change since the last callout, at most once per `debounce` seconds of race time. */
export function createOvertakeCallouts(debounce = OVERTAKE_DEBOUNCE) {
  let shown: number | null = null, last = -Infinity;
  return {
    reset() { shown = null; last = -Infinity; },
    update(rank: number, time: number): Overtake | null {
      if (shown === null) { shown = rank; return null; }
      if (rank === shown || time - last < debounce) return null;
      const call = { from: shown, to: rank, gained: rank < shown };
      shown = rank; last = time;
      return call;
    },
  };
}
