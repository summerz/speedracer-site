import { campaignLapLimit, campaignRankLimit, type TrackDefinition } from './trackCatalog.js';

/** Player-selected challenge is independent of an authored course's geometry/altitude levels. */
export type RaceChallengeId = 'easy' | 'normal' | 'hard';
export const RACE_CHALLENGES = {
  easy: { label: '쉬움', timeScale: 1.15, obstacleScale: .8, aiPace: .90, aiRating: -1, warningSeconds: 1.9 },
  normal: { label: '중간', timeScale: 1, obstacleScale: 1, aiPace: 1, aiRating: 0, warningSeconds: 1.5 },
  hard: { label: '어려움', timeScale: .90, obstacleScale: 1.25, aiPace: 1.08, aiRating: 1, warningSeconds: 1.15 },
} as const;
export function raceChallenge(value: unknown): RaceChallengeId {
  return value === 'easy' || value === 'hard' ? value : 'normal';
}
export function challengeLapLimit(track: TrackDefinition, challenge: RaceChallengeId = 'normal') {
  return Math.round(campaignLapLimit(track) * RACE_CHALLENGES[challenge].timeScale);
}
export function challengeStars(mode: 'time-attack' | 'competition', track: TrackDefinition, challenge: RaceChallengeId,
  result: { laps: number[]; rank: number; disqualified: boolean }): number {
  if (result.disqualified || result.laps.length !== track.laps || result.laps.some(lap => !Number.isFinite(lap) || lap <= 0)) return 0;
  if (mode === 'competition') {
    const cutoff = campaignRankLimit(track);
    if (result.rank < 1 || result.rank > cutoff) return 0;
    // With only two passing ranks, a comfortable lap margin distinguishes one and two stars.
    if (cutoff === 2) return result.rank === 1 ? 3 : Math.max(...result.laps) <= challengeLapLimit(track, challenge) * .97 + 1e-9 ? 2 : 1;
    return result.rank <= Math.max(1, cutoff - 2) ? 3 : result.rank < cutoff ? 2 : 1;
  }
  const slowest = Math.max(...result.laps), limit = challengeLapLimit(track, challenge);
  return slowest > limit ? 0 : slowest <= limit * .90 + 1e-9 ? 3 : slowest <= limit * .97 + 1e-9 ? 2 : 1;
}
