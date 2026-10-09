import type { Track } from '../track/createTrack.js';
import { forkAt } from '../track/trackBranches.js';
import { resolveHeightObstacle } from '../track/obstacleDynamics.js';
import { mineLineOffset, CRAFT_HALF_WIDTH, CRAFT_HALF_LENGTH } from '../track/mineField.js';

export const AWAKENING_SECONDS = 5, AWAKENING_SPEED_SCALE = 1.05, CORE_REACH = 3.5;
export const AWAKENING_CAPACITY = 3;
export interface AwakeningCore { distance: number; offset: number }
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Put cores on shared, clear road so neither fork choice loses access to the item. */
export function createAwakeningCores(track: Track): AwakeningCore[] {
  const clear = (d: number) => !forkAt(track, d - 35) && !forkAt(track, d + 35)
    && !track.heightObstacles.some(o => Math.abs(o.distance - d) < o.depth / 2 + 45)
    && !track.corridorObstacles?.some(o => Math.abs(o.distance - d) < o.depth / 2 + 45)
    && !track.mineFields?.some(o => d > o.distance - 45 && d < o.distance + o.length + 45)
    && !track.arcRails?.some(o => d > o.distance - 45 && d < o.distance + o.length + 45)
    && !track.boostPads?.some(o => Math.abs(o.distance - d) < 30)
    && !track.boostRings?.some(o => Math.abs(o.distance - d) < 30);
  // One pickup per lap leaves most of the lap under manual control, even at awakening speed.
  for (let d = Math.max(100, track.length * .2); d < Math.min(track.length * .7, track.length - 35); d += 15) {
    if (clear(d)) return [{ distance: d, offset: 0 }];
  }
  return [];
}

/** A track-relative flight corridor, independent of the manual yaw/speed limits.
 * Current fields take priority; looking ahead lets the craft settle before entry.
 * With lookAhead=0 this projects a safe pose when manual control resumes. */
export function awakeningTarget(track: Track, distance: number, routeId: string | null | undefined,
  altitude: number, levels: readonly number[], time: number, speed: number, lookAhead = 120) {
  const local = ((distance % track.length) + track.length) % track.length;
  const startAt = (start: number, span: number) => {
    let gap = start - local;
    if (gap + span < -CRAFT_HALF_LENGTH) gap += track.length;
    return gap;
  };
  const sameRoute = (id?: string) => !id || id === routeId;
  const lanes: { gap: number; offset: number }[] = [];
  for (const o of track.corridorObstacles ?? []) {
    if (!sameRoute(o.routeId)) continue;
    const gap = startAt(o.distance - o.depth / 2, o.depth);
    if (gap <= lookAhead && gap + o.depth >= -CRAFT_HALF_LENGTH) lanes.push({ gap, offset: o.safeCenter });
  }
  for (const field of track.mineFields ?? []) {
    if (!sameRoute(field.routeId)) continue;
    const gap = startAt(field.distance, field.length);
    if (gap <= lookAhead && gap + field.length >= -CRAFT_HALF_LENGTH)
      lanes.push({ gap, offset: mineLineOffset(field, clamp(-gap + Math.min(18, lookAhead), 0, field.length)) });
  }
  for (const rail of track.arcRails ?? []) {
    if (!sameRoute(rail.routeId)) continue;
    for (const segment of rail.segments) {
      const gap = startAt(rail.distance + segment.at, segment.length);
      if (gap <= lookAhead && gap + segment.length >= -CRAFT_HALF_LENGTH)
        lanes.push({ gap, offset: -segment.side * Math.min(track.halfWidth - CRAFT_HALF_WIDTH - .5, 4) });
    }
  }
  lanes.sort((a, b) => Math.max(0, a.gap) - Math.max(0, b.gap));
  let level = levels.reduce((best, h, i) => Math.abs(h - altitude) < Math.abs(levels[best] - altitude) ? i : best, 0);
  const heights = track.heightObstacles.filter(o => sameRoute(o.routeId)).map(o => ({ o, gap: startAt(o.distance - o.depth / 2, o.depth) }))
    .filter(({ o, gap }) => gap <= lookAhead && gap + o.depth >= -CRAFT_HALF_LENGTH)
    .sort((a, b) => Math.max(0, a.gap) - Math.max(0, b.gap));
  let safeAltitude = levels[level];
  if (heights.length) {
    const { o, gap } = heights[0];
    const opening = resolveHeightObstacle(o, levels, time + Math.max(0, gap) / Math.max(1, speed));
    const safe = levels.map((h, i) => ({ h, i })).filter(({ h }) => h >= opening.minAltitude && h <= opening.maxAltitude);
    safe.sort((a, b) => Math.abs(a.h - altitude) - Math.abs(b.h - altitude));
    if (safe.length) level = safe[0].i;
    safeAltitude = clamp(levels[level], opening.minAltitude, opening.maxAltitude);
  }
  const bound = Math.max(0, track.halfWidth - CRAFT_HALF_WIDTH - .5);
  return { offset: clamp(lanes[0]?.offset ?? 0, -bound, bound), level, altitude: safeAltitude };
}
