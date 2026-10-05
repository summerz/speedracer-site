import type { CorridorObstacle, HeightObstacle, Track } from './createTrack.js';
import type { RaceChallengeId } from './raceChallenge.js';
import { physicalDistance } from './trackBranches.js';

export const EXTRA_OBSTACLES = {
  normal: { every: 6, safeWidth: .84, depth: 44, stepSeconds: 1.6, clearance: .7 },
  hard: { every: 4, safeWidth: .72, depth: 54, stepSeconds: 1.15, clearance: .6 },
} as const;

/** One level always remains reachable, including while the opening slides between discrete levels. */
export function resolveHeightObstacle(obstacle: HeightObstacle, levels: readonly number[], time: number): HeightObstacle {
  if (!obstacle.motion) return obstacle;
  const { stepSeconds, transitionSeconds, phase, clearance } = obstacle.motion;
  const steps = (levels.length - 1) * 2;
  const position = ((Math.max(0, time) + phase) / stepSeconds) % steps;
  const step = Math.floor(position), fraction = position - step;
  const levelAt = (index: number) => index <= levels.length - 1 ? index : steps - index;
  const from = levelAt(step), to = levelAt((step + 1) % steps);
  const transition = transitionSeconds / stepSeconds;
  // Hold, expand toward the next level, then contract away from the previous level.
  // Unlike a narrow interpolated hole, this never demands an unavailable half-level.
  const blend = Math.max(0, (fraction - (1 - transition)) / transition);
  const bounds = (index: number) => ({
    min: index === 0 ? levels[0] : levels[index] - clearance,
    max: index === levels.length - 1 ? levels.at(-1)! : levels[index] + clearance,
  });
  const a = bounds(from), b = bounds(to);
  const union = { min: Math.min(a.min, b.min), max: Math.max(a.max, b.max) };
  // Keep both levels clear long enough for a .2-second altitude command.
  const mix = blend < .25 ? blend * 4 : Math.max(0, (blend - .75) * 4);
  const start = blend < .25 ? a : union, end = blend < .25 ? union : b;
  const minAltitude = start.min + (end.min - start.min) * mix;
  const maxAltitude = start.max + (end.max - start.max) * mix;
  return { ...obstacle, minAltitude, maxAltitude, kind: minAltitude <= levels[0] ? 'descend'
    : maxAltitude >= levels.at(-1)! ? 'rise' : 'middle' };
}

export function obstacleArrivalTime(track: Track, fallbackTime: number, distance: number, speed: number, depth = 0,
  fromDistance = 0, routeId?: string | null) {
  // The nose reaches the front of the field before its centre reaches the gate.
  return (track.obstacleTime ?? fallbackTime) + Math.max(0, physicalDistance(track, fromDistance, distance, routeId) - depth / 2 - 2.2) / Math.max(12, speed);
}

export function corridorCanPass(offset: number, obstacle: CorridorObstacle, craftHalfWidth = 1.6) {
  return Math.abs(offset - obstacle.safeCenter) + craftHalfWidth <= obstacle.safeWidth / 2 + 1e-8;
}

export function upcomingCorridor(track: Track, distance: number, routeId?: string | null) {
  let nearest: { obstacle: CorridorObstacle; distance: number } | null = null;
  for (const obstacle of track.corridorObstacles ?? []) {
    if (obstacle.routeId && obstacle.routeId !== routeId) continue;
    let gap = obstacle.distance - distance;
    gap += Math.ceil((-gap - obstacle.depth / 2 - 2.2) / track.length) * track.length;
    if (!nearest || gap < nearest.distance) nearest = { obstacle, distance: gap };
  }
  return nearest;
}

/** Replace isolated, gently curved fields; never stack a corridor and a moving opening. */
export function configureExtraObstacles(track: Track, challenge: RaceChallengeId): Track {
  if (challenge === 'easy') return track;
  const tuning = EXTRA_OBSTACLES[challenge];
  const heights: HeightObstacle[] = [], corridors: CorridorObstacle[] = [];
  const eligible = track.heightObstacles.filter(obstacle => [-60, -30, 0, 30, 60].every(offset => {
      const frame = track.sample(obstacle.distance + offset, undefined, obstacle.routeId);
      return frame.section === 'course' && Math.abs(frame.curvature) < .008 && Math.abs(frame.tangent.y) < .55;
    }));
  // Distribute across the whole lap, including short courses, with both mechanics introduced.
  const count = Math.min(eligible.length, Math.max(2, Math.ceil(eligible.length / tuning.every)));
  const chosen = new Set(Array.from({ length: count }, (_, i) => eligible[Math.round(i * (eligible.length - 1) / Math.max(1, count - 1))]));
  let selected = 0;
  for (const obstacle of track.heightObstacles) {
    if (!chosen.has(obstacle)) { heights.push(obstacle); continue; }
    if (selected++ % 2 === 0) {
      const laneIndex = corridors.length % 3;
      corridors.push({ routeId: obstacle.routeId, distance: obstacle.distance, depth: tuning.depth, speedRetention: obstacle.speedRetention,
        safeCenter: (laneIndex - 1) * track.halfWidth * .58, safeWidth: track.halfWidth * tuning.safeWidth,
        lane: (['left', 'center', 'right'] as const)[laneIndex] });
    } else heights.push({ ...obstacle, motion: { stepSeconds: tuning.stepSeconds, transitionSeconds: .7,
      phase: selected * .73, clearance: tuning.clearance } });
  }
  (track.heightObstacles as HeightObstacle[]).splice(0, track.heightObstacles.length, ...heights);
  return Object.assign(track, { corridorObstacles: corridors });
}
