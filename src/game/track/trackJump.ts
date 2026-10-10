import { createTrackFrame, type Track, type TrackFrame } from './createTrack.js';
import { physicalDistance, routeDistanceScale } from './trackBranches.js';

export interface JumpRecipe { readonly id: string; readonly branchId: string; readonly routeIndex: 0 | 1 }
/** Shared course distances, repeated each lap. The landing surface is `drop` world metres lower. */
export interface TrackJump {
  readonly id: string; readonly routeId: string;
  readonly approachStart: number; readonly start: number; readonly end: number;
  readonly landingEnd: number; readonly rejoinEnd: number; readonly drop: number;
  readonly launchLevel: number; readonly landingLevel: number;
}
export interface JumpCue {
  readonly jump: TrackJump; readonly phase: 'approach' | 'airborne' | 'landing';
  /** Physical metres to takeoff, or to the end of the gap/landing allowance. */
  readonly distance: number; readonly requiredLevel: number;
}
const wrap = (track: Track, d: number) => { const remainder = d % track.length; return remainder < 0 ? remainder + track.length : remainder; };
const smooth = (u: number) => u * u * u * (u * (u * 6 - 15) + 10);
const smoothSlope = (u: number) => 30 * u * u * (u - 1) * (u - 1);

export function upcomingTrackJump(track: Track, distance: number, routeId?: string | null): JumpCue | null {
  const d = wrap(track, distance), epsilon = 1e-8;
  const jump = track.jumps?.find(j => j.routeId === routeId && d >= j.approachStart - epsilon && d <= j.landingEnd + epsilon);
  if (!jump) return null;
  const phase = d < jump.start - epsilon ? 'approach' : d < jump.end - epsilon ? 'airborne' : 'landing';
  const end = phase === 'approach' ? jump.start : phase === 'airborne' ? jump.end : jump.landingEnd;
  return { jump, phase, distance: physicalDistance(track, d, Math.max(0, end - d), routeId),
    requiredLevel: phase === 'approach' ? jump.launchLevel : jump.landingLevel };
}

/** Reserve both the driving decision and the full extent of an adjacent field/pickup. */
export function jumpPlacementClear(track: Track, distance: number, routeId?: string | null, radius = 0): boolean {
  const d = wrap(track, distance);
  return !track.jumps?.some(j => j.routeId === routeId
    && d + radius / routeDistanceScale(track, d, routeId) >= j.approachStart
    && d - radius / routeDistanceScale(track, d, routeId) <= j.landingEnd);
}

/** Hover flight still uses the existing altitude controls; only its road-relative reference descends. */
export function withTrackJumps(track: Track, recipes: readonly JumpRecipe[] = []): Track {
  if (!recipes.length) return track;
  const ids = new Set<string>(), routes = new Set<string>();
  const jumps = recipes.map(recipe => {
    const fork = track.branches?.find(f => f.id === recipe.branchId), route = fork?.routes[recipe.routeIndex];
    if (!fork || !route) throw new Error(`Unknown jump branch: ${recipe.id}`);
    if (!recipe.id || ids.has(recipe.id) || routes.has(route.id)) throw new Error(`Duplicate jump or route: ${recipe.id}`);
    ids.add(recipe.id); routes.add(route.id);
    const centre = (route.mouthEnd + route.mergeStart) / 2, scale = routeDistanceScale(track, centre, route.id);
    const start = centre - 30 / scale, end = start + 60 / scale;
    const jump: TrackJump = Object.freeze({ id: recipe.id, routeId: route.id, approachStart: start - 100 / scale,
      start, end, landingEnd: end + 50 / scale, rejoinEnd: end + 150 / scale, drop: 12,
      launchLevel: track.altitudeProfile.levels.length - 1, landingLevel: 0 });
    if (jump.approachStart < route.mouthEnd || jump.rejoinEnd > route.mergeStart)
      throw new Error(`Jump does not fit clear branch: ${recipe.id}`);
    return jump;
  });
  const baseSample = track.sample.bind(track);
  const offset = (j: TrackJump, d: number) => {
    if (d < j.start || d > j.rejoinEnd) return { height: 0, slope: 0 };
    if (d < j.end) {
      const u = (d - j.start) / (j.end - j.start);
      return { height: -j.drop * smooth(u), slope: -j.drop * smoothSlope(u) / (j.end - j.start) };
    }
    if (d <= j.landingEnd) return { height: -j.drop, slope: 0 };
    const u = (d - j.landingEnd) / (j.rejoinEnd - j.landingEnd);
    return { height: -j.drop * (1 - smooth(u)), slope: j.drop * smoothSlope(u) / (j.rejoinEnd - j.landingEnd) };
  };
  const before = createTrackFrame(), after = createTrackFrame();
  const adjust = (frame: TrackFrame, j: TrackJump, d: number) => {
    const shift = offset(j, d);
    frame.position.y += shift.height;
    frame.tangent.multiplyScalar(frame.distanceScale ?? 1); frame.tangent.y += shift.slope;
    frame.distanceScale = frame.tangent.length(); frame.tangent.normalize();
    frame.right.crossVectors(frame.tangent, frame.up).normalize(); frame.up.crossVectors(frame.right, frame.tangent).normalize();
    return frame;
  };
  const curves = jumps.map(jump => {
    const fork = track.branches!.find(f => f.routes.some(r => r.id === jump.routeId))!;
    const start = fork.start + fork.junctionLength, end = fork.end - fork.junctionLength;
    const count = Math.ceil((end - start) * 4), step = (end - start) / count;
    // Reparametrize the entire fork body by arc length: descending changes its real length,
    // but the shared start/end progress and both 35m junctions must stay fixed.
    const arcs = [0]; let previous = adjust(baseSample(start, undefined, jump.routeId), jump, start).position.clone();
    for (let i = 1; i <= count; i++) {
      const d = start + i * step, point = adjust(baseSample(d, undefined, jump.routeId), jump, d).position.clone();
      arcs.push(arcs[i - 1] + point.distanceTo(previous)); previous = point;
    }
    const length = arcs[count], scale = length / (end - start);
    const sharedAt = (old: number) => {
      const index = Math.max(0, Math.min(count, (old - start) / step)), lo = Math.min(count - 1, Math.floor(index));
      return start + (arcs[lo] + (arcs[lo + 1] - arcs[lo]) * (index - lo)) / scale;
    };
    const mapped: TrackJump = Object.freeze({ ...jump, approachStart: sharedAt(jump.approachStart), start: sharedAt(jump.start),
      end: sharedAt(jump.end), landingEnd: sharedAt(jump.landingEnd), rejoinEnd: sharedAt(jump.rejoinEnd) });
    const route = fork.routes.find(r => r.id === jump.routeId)!;
    Object.assign(route, { length: length + fork.junctionLength * 2, mouthEnd: sharedAt(route.mouthEnd), mergeStart: sharedAt(route.mergeStart) });
    return { jump, mapped, start, end, scale, arcs, step, count };
  });
  Object.assign(track, { jumps: Object.freeze(curves.map(c => c.mapped)) });
  track.sample = (distance, target = createTrackFrame(), routeId) => {
    const d = wrap(track, distance), curve = curves.find(c => c.jump.routeId === routeId && d > c.start && d < c.end);
    if (!curve) return baseSample(distance, target, routeId);
    const arc = (d - curve.start) * curve.scale;
    let lo = 0, hi = curve.count;
    while (lo + 1 < hi) { const mid = (lo + hi) >>> 1; if (curve.arcs[mid] <= arc) lo = mid; else hi = mid; }
    const old = curve.start + (lo + (arc - curve.arcs[lo]) / (curve.arcs[hi] - curve.arcs[lo])) * curve.step;
    const frame = adjust(baseSample(old, target, routeId), curve.jump, old);
    adjust(baseSample(old - .25, before, routeId), curve.jump, old - .25);
    adjust(baseSample(old + .25, after, routeId), curve.jump, old + .25);
    frame.curvature = after.tangent.sub(before.tangent).dot(frame.right) / (.5 * (frame.distanceScale ?? 1));
    frame.distanceScale = curve.scale;
    return frame;
  };
  return track;
}
