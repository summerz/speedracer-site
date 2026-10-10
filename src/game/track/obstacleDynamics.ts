import type { ArcRail, BoostPad, BoostRing, CorridorObstacle, HeightObstacle, MineField, Track } from './createTrack.js';
import type { RaceChallengeId } from './raceChallenge.js';
import { physicalDistance } from './trackBranches.js';
import { layoutObstacles, mulberry32, randomCorridorLanes, randomObstacleAltitudes, randomPadLanes, randomRingSides, ringQuota } from './obstacleLayout.js';
import { boostKindFor } from './hazardCatalog.js';
import { mineLane, mineLineOffset } from './mineField.js';
import { createArcRails, createBoostRings } from './arcRail.js';

export const EXTRA_OBSTACLES = {
  easy: { safeWidth: .9, depth: 40, stepSeconds: 2, clearance: .75, mine: { length: 70, mines: 5, radius: 1.4 } },
  normal: { safeWidth: .84, depth: 44, stepSeconds: 1.6, clearance: .7, mine: { length: 80, mines: 7, radius: 1.5 } },
  hard: { safeWidth: .72, depth: 54, stepSeconds: 1.15, clearance: .6, mine: { length: 90, mines: 9, radius: 1.6 } },
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

/** True while a moving field's opening is sliding between two levels. */
export function obstacleInTransition(obstacle: HeightObstacle, levels: readonly number[], time: number) {
  if (!obstacle.motion) return false;
  const { stepSeconds, transitionSeconds, phase } = obstacle.motion;
  return ((Math.max(0, time) + phase) / stepSeconds) % ((levels.length - 1) * 2) % 1 > 1 - transitionSeconds / stepSeconds;
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

/** HUD cue for the next boost pad on this route within `range`, unless a corridor/height field (`hazardDistance`) is nearer. */
export function boostPadGuide(track: Track, distance: number, offset: number, routeId?: string | null, hazardDistance: number | null = null, range = 150) {
  let best: { distance: number; lane: 'left' | 'center' | 'right'; safe: boolean } | null = null;
  for (const pad of track.boostPads ?? []) {
    if (pad.routeId && pad.routeId !== routeId) continue;
    let gap = pad.distance - distance; gap += Math.ceil(-gap / track.length) * track.length;
    if (gap <= range && (!best || gap < best.distance)) best = { distance: gap, lane: pad.lane, safe: Math.abs(offset - pad.center) <= pad.width / 2 };
  }
  return best && (hazardDistance === null || best.distance < hazardDistance) ? best : null;
}

/** HUD cue for the next mine field on this route within `range` (250 m or 3 s ahead, whichever is larger); `hint` (easy only) is the safe line's entry lane. */
export function mineFieldGuide(track: Track, distance: number, speed: number, routeId?: string | null, hazardDistance: number | null = null, easy = false) {
  let best: { distance: number; hint: 'left' | 'center' | 'right' | null } | null = null;
  for (const field of track.mineFields ?? []) {
    if (field.routeId && field.routeId !== routeId) continue;
    let gap = field.distance - distance; gap += Math.ceil((-gap - field.length) / track.length) * track.length;
    if (gap <= Math.max(250, speed * 3) && (!best || gap < best.distance)) best = { distance: Math.max(0, gap),
      hint: easy ? (['left', 'center', 'right'] as const)[mineLane(mineLineOffset(field, 0), track.halfWidth)] : null };
  }
  return best && (hazardDistance === null || best.distance < hazardDistance) ? best : null;
}

/** Gentle, straight-ish road around a field: the site rule for corridors and mine fields. */
export function safePlacement(track: Track, obstacle: { distance: number; routeId?: string }) {
  return [-60, -30, 0, 30, 60].every(offset => {
    const frame = track.sample(obstacle.distance + offset, undefined, obstacle.routeId);
    return frame.section === 'course' && Math.abs(frame.curvature) < .008 && Math.abs(frame.tangent.y) < .55;
  });
}

/**
 * Builds the deterministic base layout (seeded by track length) and keeps a per-run roller on the track.
 * Every roll keeps the base per-path type counts; if a roll cannot place them all, the base layout is reused.
 * `key` (track id or name) fixes the track's one boost kind: pads or rings.
 */
export function configureExtraObstacles(track: Track, challenge: RaceChallengeId, key = `${Math.round(track.length)}`): Track {
  const template = track.heightObstacles[0];
  if (!template) return track;
  const boostKind = boostKindFor(key), ring = boostKind === 'ring';
  Object.assign(track, { boostKind });
  const base = layoutObstacles(track, challenge, mulberry32(Math.round(track.length)), template);
  const quota = ring ? ringQuota(track, challenge) : undefined;
  const rolled = (heights: readonly HeightObstacle[], corridors: readonly CorridorObstacle[], pads: readonly BoostPad[], mineFields: readonly MineField[],
    arcRails: readonly ArcRail[], courseRings: readonly BoostRing[], random: () => number) =>
    ({ heights: [...heights], corridors: [...corridors], pads: [...pads], mineFields: [...mineFields], arcRails: [...arcRails],
      boostRings: ring ? [...createBoostRings(track, arcRails, random, quota), ...courseRings].sort((a, b) => a.distance - b.distance) : [] });
  const baseRandom = mulberry32(Math.round(track.length) + 1);
  (track.heightObstacles as HeightObstacle[]).splice(0, track.heightObstacles.length,
    ...randomObstacleAltitudes(base.heights, track.altitudeProfile.levels, baseRandom, track));
  const corridorObstacles = randomCorridorLanes(base.corridors, track.halfWidth, baseRandom, track);
  const arcRails = createArcRails(track, challenge, baseRandom), start = rolled(base.heights, base.corridors, base.pads, base.mineFields, arcRails, base.rings, baseRandom);
  return Object.assign(track, {
    corridorObstacles, boostPads: randomPadLanes(track, base.pads, corridorObstacles, baseRandom), mineFields: base.mineFields,
    arcRails, boostRings: randomRingSides(track, start.boostRings, corridorObstacles, baseRandom),
    rollObstacleLayout(random: () => number) {
      const rails = createArcRails(track, challenge, random);
      for (let attempt = 0; attempt < 8; attempt++) {
        const next = layoutObstacles(track, challenge, random, template, base.counts);
        if (!next.missed) return rolled(next.heights, next.corridors, next.pads, next.mineFields, rails, next.rings, random);
      }
      return rolled(base.heights, base.corridors, base.pads, base.mineFields, rails, base.rings, random);
    },
  });
}
