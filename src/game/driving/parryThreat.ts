import type { Track } from '../track/createTrack.js';
import { routeDistanceScale } from '../track/trackBranches.js';
import { corridorCanPass, resolveHeightObstacle } from '../track/obstacleDynamics.js';
import { PARRY_TUNING, type ParryPosition, type ParryTarget } from './parry.js';
export interface ParryPose {
  distance: number; offset: number; altitude: number; targetAltitude: number; speed: number; routeId?: string | null;
}
export function parryWorldPosition(track: Track, distance: number, offset: number, altitude: number, routeId?: string | null): ParryPosition | null {
  const f = track.sample(distance, undefined, routeId);
  // Geometry-free driving fixtures intentionally supply only curvature.
  if (!f.position || !f.right || !f.up) return null;
  return { x: f.position.x + f.right.x * offset + f.up.x * altitude,
    y: f.position.y + f.right.y * offset + f.up.y * altitude,
    z: f.position.z + f.right.z * offset + f.up.z * altitude };
}
/** Short ballistic forecast, not an automatic dodge or a promise that steering cannot change the threat. */
export function predictParryThreat(track: Track, s: ParryPose, levels: readonly number[], lateralSpeed: number,
  verticalSpeed: number, timeScale = 1, ignored: (id: string) => boolean = () => false): ParryTarget | null {
  if (s.speed <= 0) return null;
  let nearest: ParryTarget | null = null;
  const candidate = (kind: ParryTarget['kind'], key: string, distance: number, reach: number, offset: number,
    altitude: number, collides: (t: number) => boolean) => {
    const scale = routeDistanceScale(track, distance, s.routeId);
    const lap = Math.ceil((s.distance - distance - reach / scale) / track.length);
    const center = distance + lap * track.length;
    const seconds = Math.max(0, (center - reach / scale - s.distance) * scale / s.speed) * timeScale;
    const id = `${key}:${lap}`;
    if (ignored(id) || seconds > PARRY_TUNING.warningSeconds || !collides(seconds / timeScale) || nearest && nearest.secondsToImpact <= seconds) return;
    nearest = { id, kind, secondsToImpact: seconds, worldPosition: parryWorldPosition(track, center, offset, altitude, s.routeId) };
  };
  const lateral = (t: number) => s.offset + lateralSpeed * t;
  const altitude = (t: number) => s.altitude + Math.sign(s.targetAltitude - s.altitude)
    * Math.min(Math.abs(s.targetAltitude - s.altitude), verticalSpeed * t);
  track.heightObstacles.forEach((raw, i) => {
    if (raw.routeId && raw.routeId !== s.routeId) return;
    candidate('height', `height-${i}`, raw.distance, raw.depth / 2 + 2.2, 0, s.altitude, t => {
      const o = resolveHeightObstacle(raw, levels, (track.obstacleTime ?? 0) + t * timeScale);
      return Math.abs(lateral(t)) < track.halfWidth + 1.6 && (altitude(t) < o.minAltitude || altitude(t) > o.maxAltitude);
    });
  });
  track.corridorObstacles?.forEach((o, i) => {
    if (o.routeId && o.routeId !== s.routeId) return;
    candidate('corridor', `corridor-${i}`, o.distance, o.depth / 2 + 2.2, o.safeCenter, s.altitude,
      t => Math.abs(lateral(t)) < track.halfWidth + 1.6 && !corridorCanPass(lateral(t), o));
  });
  track.mineFields?.forEach((field, f) => {
    if (field.routeId && field.routeId !== s.routeId) return;
    field.mines.forEach((mine, m) => candidate('mine', `mine-${f}-${m}`, field.distance + mine.at,
      mine.radius + 2.2, mine.offset, s.altitude, t => Math.abs(lateral(t) - mine.offset) < mine.radius + 1.6));
  });
  return nearest;
}

export interface ParryCraftPose extends ParryPose { heading: number }
/** Swept relative-motion box, matching craftContact; routes must also meet in world space. */
export function predictCraftParryThreat(track: Track, a: ParryCraftPose, b: ParryCraftPose,
  id: string, aScale = 1, bScale = 1): ParryTarget | null {
  const wrapped = a.distance - b.distance - Math.round((a.distance - b.distance) / track.length) * track.length;
  const scaleA = routeDistanceScale(track, a.distance, a.routeId), scaleB = routeDistanceScale(track, b.distance, b.routeId);
  const starts = [wrapped, a.offset - b.offset, a.altitude - b.altitude];
  const va = [a.speed * Math.cos(a.heading) * aScale / scaleA, a.speed * Math.sin(a.heading) * aScale, 0];
  const vb = [b.speed * Math.cos(b.heading) * bScale / scaleB, b.speed * Math.sin(b.heading) * bScale, 0];
  const sizes = [4.4, 3.2, 1.1];
  let enter = 0, leave: number = PARRY_TUNING.warningSeconds;
  for (let axis = 0; axis < 3; axis++) {
    const v = va[axis] - vb[axis];
    if (Math.abs(v) < 1e-9) { if (Math.abs(starts[axis]) > sizes[axis]) return null; continue; }
    const x = (-sizes[axis] - starts[axis]) / v, y = (sizes[axis] - starts[axis]) / v;
    enter = Math.max(enter, Math.min(x, y)); leave = Math.min(leave, Math.max(x, y));
    if (enter > leave) return null;
  }
  const pa = parryWorldPosition(track, a.distance + va[0] * enter, a.offset + va[1] * enter, a.altitude, a.routeId);
  const pb = parryWorldPosition(track, b.distance + vb[0] * enter, b.offset + vb[1] * enter, b.altitude, b.routeId);
  if (pa && pb && (pa.x - pb.x) ** 2 + (pa.y - pb.y) ** 2 + (pa.z - pb.z) ** 2 > 36) return null;
  return { id, kind: 'craft', secondsToImpact: enter, worldPosition: pb };
}
