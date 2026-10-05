export const OFF_TRACK_PENALTY_POINTS = 7;
export const COLLISION_PENALTY_POINTS = 1;
export const CLEAN_HALF_LAP_POINTS = 3;
export const RECORD_BONUS_POINTS = 30;

export interface CleanHalfLap { lap: number; half: 1 | 2; clean: boolean }
interface Incidents { collisions: number; offTrackExits: number; recoveries: number }

/** Forward-only half-lap boundaries: a recovery cannot replay a paid segment. */
export function createCleanHalfLaps(length: number, laps: number) {
  if (!Number.isFinite(length) || length <= 0 || !Number.isInteger(laps) || laps < 1 || laps > 10) throw new RangeError('Invalid clean lap course');
  const segments: CleanHalfLap[] = [];
  let incidents = 0;
  return {
    snapshot: () => segments.map(segment => ({ ...segment })),
    reset() { segments.length = 0; incidents = 0; },
    cross(distance: number, state: Incidents) {
      const count = state.collisions + state.offTrackExits + state.recoveries;
      while (segments.length < laps * 2 && distance >= (segments.length + 1) * length / 2) {
        const index = segments.length;
        segments.push({ lap: Math.floor(index / 2) + 1, half: index % 2 === 0 ? 1 : 2, clean: count === incidents });
        incidents = count;
      }
    },
  };
}
