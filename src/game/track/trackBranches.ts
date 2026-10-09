import * as THREE from 'three';
import { createTrackFrame, type Track, type TrackFrame, type HeightObstacle } from './createTrack.js';

export interface BranchRecipe {
  readonly id: string;
  readonly kind: 'horizontal' | 'vertical';
  readonly experience: 'city' | 'reactor' | 'arena' | 'sky' | 'prism' | 'orbit';
  readonly intertwined?: boolean;
  readonly direction?: 1 | -1;
  /** Minimum ground clearance below the pavement in a low-lying coil. */
  readonly groundClearance?: number;
}
export interface BranchRoute {
  readonly id: string; readonly name: string; readonly description: string;
  readonly length: number; readonly features: readonly string[];
  /** Shared-progress boundaries of the dedicated entry/merge mouths. */
  readonly mouthEnd: number; readonly mergeStart: number;
}
export interface TrackFork {
  readonly id: string; readonly kind: BranchRecipe['kind'];
  readonly start: number; readonly end: number;
  /** Both roads share this many physical metres at the entrance and exit. */
  readonly junctionLength: number;
  readonly routes: readonly [BranchRoute, BranchRoute];
}
export interface RoadPath { start: number; end: number; routeId: string | null }
const localDistance = (track: Track, distance: number) => { const d = distance % track.length; return d < 0 ? d + track.length : d; };
const smooth = (u: number) => { const t = THREE.MathUtils.clamp(u, 0, 1); return t * t * t * (10 + t * (-15 + t * 6)); };
// Race progress differs on longer routes. Junction edges must pair the same authored
// cross-section, rather than unrelated positions with the same race progress.
const junctionPairs = new WeakMap<Track, Map<string, (distance: number) => TrackFrame>>();
function arcIndex(cumulative: readonly number[], arc: number) {
  let lo = 0, hi = cumulative.length - 1;
  while (lo + 1 < hi) { const mid = (lo + hi) >> 1; if (cumulative[mid] <= arc) lo = mid; else hi = mid; }
  return lo + (arc - cumulative[lo]) / Math.max(.00001, cumulative[lo + 1] - cumulative[lo]);
}
/** Ease angular speed at either end, with an even sweep through the middle. */
const sweep = (u: number) => {
  const t = THREE.MathUtils.clamp(u, 0, 1), ramp = .15;
  const edge = (x: number) => x ** 3 / ramp ** 2 - x ** 4 / (2 * ramp ** 3);
  return (t < ramp ? edge(t) : t > 1 - ramp ? 1 - ramp - edge(1 - t) : t - ramp / 2) / (1 - ramp);
};

/** Shared progress is used for laps/rank; each route advances at its own physical arc length. */
export function forkAt(track: Track, distance: number) {
  const d = localDistance(track, distance);
  return track.branches?.find(f => d >= f.start && d < f.end);
}
export function upcomingFork(track: Track, distance: number, range = 180) {
  const d = localDistance(track, distance);
  return track.branches?.find(f => f.start > d && f.start - d <= range);
}
/** Physical metres for a shared-progress interval, including forks and the lap seam. */
export function physicalDistance(track: Track, from: number, gap: number, routeId?: string | null): number {
  if (gap < 0) return -physicalDistance(track, from + gap, -gap, routeId);
  if (!track.branches?.length) return gap;
  let remaining = gap, cursor = from, metres = 0;
  while (remaining > 1e-8) {
    const d = localDistance(track, cursor), fork = forkAt(track, cursor);
    const boundary = fork ? [fork.start + fork.junctionLength, fork.end - fork.junctionLength, fork.end].find(end => end > d)! : track.branches.find(f => f.start > d)?.start ?? track.length;
    const step = Math.min(remaining, Math.max(.000001, boundary - d));
    metres += step * routeDistanceScale(track, cursor + step / 2, routeId);
    remaining -= step; cursor += step;
  }
  return metres;
}
/** Invert physical travel across shared roads and longer branch interiors. */
export function advanceTrackDistance(track: Track, from: number, metres: number, routeId?: string | null): number {
  if (!track.branches?.length) return from + metres;
  let remaining = metres, cursor = from;
  while (remaining > 1e-8) {
    const d = localDistance(track, cursor), fork = forkAt(track, cursor);
    const boundary = fork ? [fork.start + fork.junctionLength, fork.end - fork.junctionLength, fork.end].find(end => end > d)! : track.branches.find(f => f.start > d)?.start ?? track.length;
    const gap = Math.max(.000001, boundary - d);
    const scale = routeDistanceScale(track, cursor + gap / 2, routeId);
    const step = Math.min(remaining, gap * scale);
    cursor += step / scale; remaining -= step;
  }
  return cursor;
}
export function selectBranch(track: Track, distance: number, offset: number, altitudeLevel: number) {
  const fork = forkAt(track, distance);
  if (!fork) return null;
  const index = fork.kind === 'horizontal' ? (offset > .4 ? 1 : 0) :
    (altitudeLevel >= verticalThreshold(track) ? 1 : 0);
  return fork.routes[index].id;
}
/** Lowest 0-based altitude level that takes the high route: 2 levels -> 1, 3 -> 1, 4 -> 2. */
export const verticalThreshold = (track: Pick<Track, 'altitudeProfile'>) => Math.floor(track.altitudeProfile.levels.length / 2);
/** Curvature-induced lateral drift fades out over the trunk approach, so a neutral craft arrives centred at the entrance. */
export function forkApproachDrift(track: Track, distance: number) {
  const d = localDistance(track, distance);
  const fork = track.branches?.find(f => d >= f.start - 150 && d < f.start + f.junctionLength);
  return fork ? 1 - smooth((d - fork.start + 150) / (150 + fork.junctionLength)) : 1;
}
export function routeDistanceScale(track: Track, distance: number, routeId?: string | null) {
  const fork = forkAt(track, distance);
  const route = fork?.routes.find(r => r.id === routeId) ?? fork?.routes[0];
  if (!fork || !route) return 1;
  const d = localDistance(track, distance), junction = fork.junctionLength;
  if (d < fork.start + junction || d >= fork.end - junction) return 1;
  return (route.length - junction * 2) / (fork.end - fork.start - junction * 2);
}
export function branchChoiceOpen(track: Track, distance: number) {
  const fork = forkAt(track, distance);
  return !!fork && localDistance(track, distance) < fork.start + fork.junctionLength;
}
/** One trunk plus both branches, without an invisible third road through a junction. */
export function roadPaths(track: Track): RoadPath[] {
  const paths: RoadPath[] = []; let start = 0;
  for (const fork of track.branches ?? []) {
    const entrance = fork.start + fork.junctionLength, exit = fork.end - fork.junctionLength;
    if (start < entrance) paths.push({ start, end: entrance, routeId: null });
    for (const route of fork.routes) paths.push({ start: entrance, end: exit, routeId: route.id });
    start = exit;
  }
  paths.push({ start, end: track.length, routeId: null });
  return paths;
}

/** Every entrance opens sideways first; trim the joined Y to one exposed outline. */
export function roadBoundary(track: Track, distance: number, frame: TrackFrame, routeId?: string | null) {
  const edges = [frame.position.clone().addScaledVector(frame.right, -track.halfWidth),
    frame.position.clone().addScaledVector(frame.right, track.halfWidth)];
  const visible = [true, true];
  const fork = forkAt(track, distance);
  if (!fork || !routeId) return { edges, visible };
  const side = fork.routes.findIndex(r => r.id === routeId);
  if (side < 0) return { edges, visible };
  const route = fork.routes[side], d = localDistance(track, distance);
  // Never trim a later crossing, coil or rolling road.
  if (d > route.mouthEnd && d < route.mergeStart) return { edges, visible };
  const other = junctionPairs.get(track)?.get(routeId)?.(d) ?? track.sample(distance, undefined, fork.routes[1 - side].id);
  const inner = side ? 0 : 1;
  const otherInner = other.position.clone().addScaledVector(other.right, side ? track.halfWidth : -track.halfWidth);
  const axis = frame.right.clone().add(other.right).normalize();
  const gap = side ? edges[inner].clone().sub(otherInner).dot(axis) : otherInner.clone().sub(edges[inner]).dot(axis);
  if (gap <= 0 && Math.abs(edges[inner].clone().sub(otherInner).dot(frame.up)) < track.halfWidth) {
    edges[inner].lerp(otherInner, .5);
    visible[inner] = false;
  }
  return { edges, visible };
}
export function roadPoints(track: Track, step = 8) {
  return roadPaths(track).flatMap(path => {
    const points: THREE.Vector3[] = [];
    for (let d = path.start; d <= path.end; d += step) points.push(track.sample(d, undefined, path.routeId).position.clone());
    points.push(track.sample(path.end, undefined, path.routeId).position.clone());
    return points;
  });
}

const names = {
  city: ['블록 슬라럼', '스카이 익스프레스'], reactor: ['리액터 코일', '송전 우회로'],
  arena: ['인사이드 어택', '아웃사이드 부스트'], sky: ['타워 다이브', '스카이 크루즈'],
  prism: ['프리즘 트위스트', '광학 고가도로'], orbit: ['오비탈 코일', '호라이즌 런'],
} as const;

/** Author a clear junction on an ordinary road; existing loops/coils remain intact. */
export function withTrackBranches(track: Track, recipes: readonly BranchRecipe[] = []): Track {
  if (!recipes.length) return track;
  const baseSample = track.sample.bind(track);
  const eligible: { start: number; end: number }[] = [];
  let run = -1;
  for (let d = 85; d <= track.length - 90; d += 5) {
    const frame = baseSample(d);
    if (frame.section === 'course' && frame.up.y > .8 && Math.abs(frame.tangent.y) < .65) {
      if (run < 0) run = d;
    } else if (run >= 0) {
      if (d - run > 255) eligible.push({ start: run, end: d - 10 });
      run = -1;
    }
  }
  if (run >= 0 && track.length - 90 - run > 255) eligible.push({ start: run, end: track.length - 100 });
  const samplers = new Map<string, (distance: number, target: TrackFrame) => TrackFrame>();
  const pairs = new Map<string, (distance: number) => TrackFrame>();
  junctionPairs.set(track, pairs);
  const forks: TrackFork[] = [];
  for (const [recipeIndex, recipe] of recipes.entries()) {
    // An early first fork makes the feature immediately discoverable.
    const available = eligible.filter(e => (!recipe.intertwined || e.end - e.start - 20 >= 450)
      && !forks.some(f => e.start < f.end + 60 && e.end > f.start - 60));
    available.sort((a, b) => {
      // Leave enough room for the Y mouths before a full coil.
      const minimum = recipe.intertwined ? 620 : 350;
      const spacious = Number(b.end - b.start >= minimum) - Number(a.end - a.start >= minimum);
      if (spacious) return spacious;
      return recipeIndex === 0 ? a.start - b.start : (b.end - b.start) - (a.end - a.start);
    });
    const interval = available[0];
    if (!interval) throw new Error(`No safe fork interval: ${recipe.id}`);
    const span = Math.min(680, interval.end - interval.start - 20);
    const start = interval.start + 10, end = start + span;
    const junctionLength = 35;
    // A dedicated, symmetric Y comes before any route-specific experience.
    const mouthFraction = Math.min(100 / (span - junctionLength * 2), recipe.intertwined ? .18 : .25);
    const bodySpan = (span - junctionLength * 2) * (1 - mouthFraction * 2);
    // The ellipse descends 52 m below its axis. Account for the base road's
    // height and bank so its lower turn (including the pavement) clears ground.
    let coilRise = 28;
    if (recipe.intertwined && recipe.groundClearance !== undefined) for (let d = start; d <= end; d += .5) {
      const u = (d - start - junctionLength) / (span - junctionLength * 2);
      const body = (u - mouthFraction) / (1 - mouthFraction * 2);
      if (body < .15 || body > .85) continue;
      const base = baseSample(d);
      const phase = smooth((body - .15) / .7) * Math.PI * 2;
      for (const sign of [-1, 1]) coilRise = Math.max(coilRise,
        (track.halfWidth + recipe.groundClearance - base.position.y - sign * 52 * Math.cos(phase) * base.right.y) / base.up.y - sign * 52 * Math.sin(phase));
    }
    let technicalLength = 0;
    const geometry: { cumulative: number[]; entryArc: number; innerLength: number }[] = [];
    const makeRoute = (side: 0 | 1): BranchRoute => {
      const id = `${recipe.id}:${side}`;
      const count = Math.ceil(span * 2);
      const positions: THREE.Vector3[] = [], frames: TrackFrame[] = [], cumulative = [0];
      // A broad climbing route buys boost room at the cost of a little extra distance.
      // Preserve that trade-off even when the original road bends toward the outside route.
      let extraRise = 0;
      do {
        positions.length = 0; frames.length = 0; cumulative.splice(0, cumulative.length, 0);
        for (let i = 0; i <= count; i++) {
          const u = THREE.MathUtils.clamp((i / count * span - junctionLength) / (span - junctionLength * 2), 0, 1);
          const mouth = smooth(u / mouthFraction) * smooth((1 - u) / mouthFraction);
          const body = THREE.MathUtils.clamp((u - mouthFraction) / (1 - mouthFraction * 2), 0, 1);
          let envelope = Math.sin(Math.PI * body) ** (side ? 2 : 3);
          const base = baseSample(start + span * i / count);
          const sign = side ? 1 : -1;
          const weave = side ? 0 : 10 * Math.min(1, bodySpan / 240) ** 2 * Math.sin(4 * Math.PI * body);
          let sideways = sign * (side ? 52 : 34) + weave;
          let rise = side ? 18 : 7;
          if (recipe.kind === 'vertical') { sideways = sign * 34 + weave * .5; rise = side ? 76 : 2; }
          if (recipe.intertwined) {
            // Opposite points on an ellipse cross in plan while remaining separated in 3D.
            envelope = smooth(body / .15) * smooth((1 - body) / .15);
            const phase = smooth((body - .15) / .7) * Math.PI * 2;
            sideways = sign * 52 * Math.cos(phase);
            rise = coilRise + sign * 52 * Math.sin(phase);
          }
          // A vertical-only split hides one deck behind the other from the driver's view.
          // All choices first form a sideways Y on one deck, then rise/coil/roll independently.
          const mouthSide = sign * (track.halfWidth + 11);
          const mouthRise = 0;
          const position = base.position.clone().addScaledVector(base.right, mouthSide * mouth + (sideways - mouthSide) * envelope)
            .addScaledVector(base.up, mouthRise * mouth + (rise + extraRise - mouthRise) * envelope);
          positions.push(position); frames.push(base);
          if (i) cumulative.push(cumulative[i - 1] + position.distanceTo(positions[i - 1]));
        }
        if (!side || recipe.intertwined || cumulative[count] >= technicalLength * 1.03 || extraRise >= 240) break;
        extraRise += 12;
      } while (true);
      const entryIndex = Math.round(junctionLength / span * count), exitIndex = count - entryIndex;
      const entryArc = cumulative[entryIndex], exitArc = cumulative[exitIndex];
      const innerLength = exitArc - entryArc, length = innerLength + junctionLength * 2;
      geometry[side] = { cumulative, entryArc, innerLength };
      const mouthIndex = Math.round((junctionLength + mouthFraction * (span - junctionLength * 2)) / span * count);
      const sharedAt = (index: number) => start + junctionLength + (cumulative[index] - entryArc) / innerLength * (span - junctionLength * 2);
      const mouthEnd = sharedAt(mouthIndex), mergeStart = sharedAt(count - mouthIndex);
      if (!side) technicalLength = length;
      const orientations: THREE.Quaternion[] = [];
      const tangents: THREE.Vector3[] = [];
      const matrix = new THREE.Matrix4(), back = new THREE.Vector3();
      for (let i = 0; i <= count; i++) {
        const tangent = i <= entryIndex || i >= exitIndex ? frames[i].tangent.clone() : positions[i + 1].clone().sub(positions[i - 1]).normalize();
        tangents.push(tangent);
      }
      // Parallel transport avoids a flipped normal when a climbing branch points almost vertically.
      const transported = [frames[0].up.clone()];
      const transport = new THREE.Quaternion();
      for (let i = 1; i <= count; i++) transported.push(i <= entryIndex || i > exitIndex ? frames[i].up.clone() : transported[i - 1].clone()
        .applyQuaternion(transport.setFromUnitVectors(tangents[i - 1], tangents[i])));
      const seamRoll = Math.atan2(tangents[exitIndex].dot(transported[exitIndex].clone().cross(frames[exitIndex].up)),
        transported[exitIndex].dot(frames[exitIndex].up));
      for (let i = 0; i <= count; i++) {
        const tangent = tangents[i];
        const u = (i / count * span - junctionLength) / (span - junctionLength * 2);
        const body = (u - mouthFraction) / (1 - mouthFraction * 2);
        const up = transported[i].clone().applyAxisAngle(tangent, seamRoll * smooth(body));
        // Technical paths offer a full road roll only after leaving the Y.
        const roll = side === 0 && recipe.experience !== 'city' && recipe.experience !== 'arena'
          ? sweep(body) * Math.PI * 2 * (recipe.direction ?? 1) : 0;
        up.applyAxisAngle(tangent, roll);
        const right = new THREE.Vector3().crossVectors(tangent, up).normalize();
        up.crossVectors(right, tangent).normalize();
        orientations.push(new THREE.Quaternion().setFromRotationMatrix(matrix.makeBasis(right, up, back.copy(tangent).negate())));
      }
      const quaternion = new THREE.Quaternion();
      samplers.set(id, (distance, target) => {
        if (distance <= start + junctionLength || distance >= end - junctionLength) return baseSample(distance, target);
        const arc = entryArc + (distance - start - junctionLength) / (span - junctionLength * 2) * innerLength;
        const index = arcIndex(cumulative, arc), lo = Math.floor(index), mix = index - lo;
        target.position.copy(positions[lo]).lerp(positions[lo + 1], mix);
        quaternion.copy(orientations[lo]).slerp(orientations[lo + 1], mix);
        target.right.set(1, 0, 0).applyQuaternion(quaternion);
        target.up.set(0, 1, 0).applyQuaternion(quaternion);
        target.tangent.set(0, 0, -1).applyQuaternion(quaternion);
        target.section = recipe.intertwined ? 'helix' : 'course';
        const delta = tangents[Math.min(count, lo + 2)].clone().sub(tangents[Math.max(0, lo - 1)]);
        target.curvature = recipe.intertwined ? 0 : delta.dot(target.right) / Math.max(.01, cumulative[Math.min(count, lo + 2)] - cumulative[Math.max(0, lo - 1)]);
        target.distanceScale = innerLength / (span - junctionLength * 2);
        return target;
      });
      const technical = side === 0;
      const features = recipe.intertwined ? ['입체 교차', '코일', ...(technical ? ['노면 회전'] : [])] :
        technical ? ['연속 굽이', ...(recipe.experience !== 'city' && recipe.experience !== 'arena' ? ['노면 회전'] : []), '고도 장애물'] :
          [recipe.kind === 'vertical' ? '큰 상승·하강' : '넓은 커브', '연속 가속'];
      return { id, name: names[recipe.experience][side], length, features, mouthEnd, mergeStart,
        description: technical ? '가까운 구조물 · 굽이와 고도 대응' : '트인 전망 · 긴 부스트 기회' };
    };
    const routes: [BranchRoute, BranchRoute] = [makeRoute(0), makeRoute(1)];
    for (const side of [0, 1]) pairs.set(routes[side].id, distance => {
      const own = geometry[side], other = geometry[1 - side];
      const arc = own.entryArc + (distance - start - junctionLength) / (span - junctionLength * 2) * own.innerLength;
      const index = arcIndex(own.cumulative, arc), lo = Math.floor(index), mix = index - lo;
      const otherArc = THREE.MathUtils.lerp(other.cumulative[lo], other.cumulative[lo + 1], mix);
      const pairedDistance = start + junctionLength + (otherArc - other.entryArc) / other.innerLength * (span - junctionLength * 2);
      return track.sample(pairedDistance, undefined, routes[1 - side].id);
    });
    forks.push({ id: recipe.id, kind: recipe.kind, start, end, junctionLength, routes });
  }
  Object.assign(track, { branches: forks });
  track.sample = (distance, target = createTrackFrame(), routeId) => {
    const fork = forkAt(track, distance);
    if (!fork) return baseSample(distance, target);
    const route = fork.routes.find(r => r.id === routeId) ?? fork.routes[0];
    return samplers.get(route.id)!(localDistance(track, distance), target);
  };
  const obstacles = track.heightObstacles as HeightObstacle[];
  const template = obstacles[0];
  obstacles.splice(0, obstacles.length, ...obstacles.filter(o => !forks.some(f => o.distance >= f.start - 125 && o.distance <= f.end + 100)));
  if (template) for (const fork of forks) for (const [side, route] of fork.routes.entries()) {
    // The technical branch has more decisions; the wide branch leaves room for continuous boost.
    for (const u of side ? [.64] : [.36, .76]) obstacles.push({ ...template, routeId: route.id, distance: fork.start + (fork.end - fork.start) * u });
  }
  obstacles.sort((a, b) => a.distance - b.distance);
  return track;
}
