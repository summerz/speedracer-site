import { jumpPlacementClear } from './trackJump.js';
import type { BoostPad, BoostRing, CorridorObstacle, HeightObstacle, MineField, Track } from './createTrack.js';
import { BOOSTS_PER_KM, HAZARD_GAP, HAZARD_SHARE, hazardEnabled } from './hazardCatalog.js';
import { RING_RADIUS, ringMarks } from './arcRail.js';
import { createMineField, MINE_CHAIN_SLOPE } from './mineField.js';
import { EXTRA_OBSTACLES, safePlacement } from './obstacleDynamics.js';
import type { RaceChallengeId } from './raceChallenge.js';
import { physicalDistance, roadPaths } from './trackBranches.js';

export function obstacleAtLevel(obstacle: HeightObstacle, levels: readonly number[], level: number): HeightObstacle {
  const height = levels[level];
  return { ...obstacle, kind: level === 0 ? 'descend' : level === levels.length - 1 ? 'rise' : 'middle',
    minAltitude: level === 0 ? levels[0] : height - .45,
    maxAltitude: level === levels.length - 1 ? levels.at(-1)! : height + .45 };
}

/** Extra fields prefer straight road; bends still leave room to change altitude. */
export function expandObstacleLayout(track: Track, authored: readonly HeightObstacle[]): HeightObstacle[] {
  if (!authored.length || track.length < 500) return [...authored];
  const baseCount = Math.ceil(authored.length * 1.35);
  const distances = Array.from({ length: baseCount }, (_, i) => 140 + i / baseCount * (track.length - 260));
  for (let i = 0; i < baseCount - 1; i++) {
    const midpoint = (distances[i] + distances[i + 1]) / 2;
    if (distances[i + 1] - distances[i] < 220) continue;
    const frames = [-45, 0, 45].map(offset => track.sample(midpoint + offset));
    if (frames.every(f => f.section === 'course' && Math.abs(f.curvature) < .0025 && Math.abs(f.tangent.y) < .4)) distances.push(midpoint);
  }
  return distances.sort((a, b) => a - b).map((distance, i) => ({ ...authored[i % authored.length], distance }));
}

/** Random index in [0,n) that never makes a third identical pick in a row. */
function sequencePicker(n: number, random: () => number) {
  const history: number[] = [];
  return () => {
    const value = random();
    let index = n > 1 && Number.isFinite(value) ? Math.max(0, Math.min(n - 1, Math.floor(value * n))) : 0;
    if (n > 1 && history.length === 2 && history[0] === index && history[1] === index) {
      const other = random();
      index = (index + 1 + (Number.isFinite(other) ? Math.max(0, Math.min(n - 2, Math.floor(other * (n - 1)))) : 0)) % n;
    }
    history.push(index); if (history.length > 2) history.shift();
    return index;
  };
}

/** Positions are fixed here; safe altitudes and moving-field phases change once per run, shared by all racers. */
export function randomObstacleAltitudes(obstacles: readonly HeightObstacle[], levels: readonly number[], random: () => number): HeightObstacle[] {
  // ponytail: branch routes share one sequence, so a streak can span two routes' fields.
  const pick = sequencePicker(levels.length, random);
  return obstacles.map(obstacle => {
    if (!obstacle.motion) return obstacleAtLevel(obstacle, levels, pick());
    const value = random(), cycle = obstacle.motion.stepSeconds * (levels.length - 1) * 2;
    return { ...obstacle, motion: { ...obstacle.motion, phase: Number.isFinite(value) ? Math.max(0, Math.min(.999999, value)) * cycle : 0 } };
  });
}

const LANES = ['left', 'center', 'right'] as const;

/** Corridor safe lanes change once per run. Same formula as configureExtraObstacles. */
export function randomCorridorLanes(corridors: readonly CorridorObstacle[], halfWidth: number, random: () => number): CorridorObstacle[] {
  const pick = sequencePicker(3, random);
  return corridors.map(corridor => {
    const laneIndex = pick();
    return { ...corridor, safeCenter: (laneIndex - 1) * halfWidth * .58, lane: LANES[laneIndex] };
  });
}

/**
 * Pad lanes are decided after the corridors: a pad 80-120 m before a corridor (a risk pad) leaves that corridor's safe lane;
 * every other pad takes a random lane. Same lane formula as the corridors.
 */
export function randomPadLanes(track: Track, pads: readonly BoostPad[], corridors: readonly CorridorObstacle[], random: () => number): BoostPad[] {
  return pads.map(pad => {
    const next = corridors.find(c => (c.routeId ?? null) === (pad.routeId ?? null) && c.distance > pad.distance
      && (gap => gap >= 80 - 1e-6 && gap <= 120 + 1e-6)(physicalDistance(track, pad.distance, c.distance - pad.distance, pad.routeId)));
    const lanes = [0, 1, 2].filter(i => !next || LANES[i] !== next.lane);
    const value = random(), laneIndex = lanes[Number.isFinite(value) ? Math.max(0, Math.min(lanes.length - 1, Math.floor(value * lanes.length))) : 0];
    return { ...pad, lane: LANES[laneIndex], center: (laneIndex - 1) * track.halfWidth * .58 };
  });
}

/** Course rings (offset 0 from the layout) lean to one side; a ring 80-120 m before a corridor takes the side away from its safe lane. Stunt rings keep their offset. */
export function randomRingSides(track: Track, rings: readonly BoostRing[], corridors: readonly CorridorObstacle[], random: () => number): BoostRing[] {
  return rings.map(ring => {
    if (track.sample(ring.distance, undefined, ring.routeId).section !== 'course') return ring;
    const next = corridors.find(c => (c.routeId ?? null) === (ring.routeId ?? null) && c.distance > ring.distance
      && (gap => gap >= 80 - 1e-6 && gap <= 120 + 1e-6)(physicalDistance(track, ring.distance, c.distance - ring.distance, ring.routeId)));
    const away = next && next.lane !== 'center' ? (next.lane === 'left' ? 1 : -1) : random() < .5 ? -1 : 1;
    return { ...ring, offset: away * track.halfWidth * .45 };
  });
}

/** Small seeded PRNG: deterministic base layouts for previews, docs and metrics. */
export function mulberry32(seed: number) {
  return () => {
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

type FieldType = 'static' | 'corridor' | 'moving' | 'mine';
export type LayoutCounts = ReadonlyMap<string, Readonly<Record<FieldType | 'pad', number>>>;
export interface ObstacleLayout { heights: HeightObstacle[]; corridors: CorridorObstacle[]; pads: BoostPad[]; rings: BoostRing[]; mineFields: MineField[]; counts: LayoutCounts; missed: number }
interface Slot { index: number; distance: number; physical: number; plain: boolean; course: boolean; gentle: boolean }
interface SlotPath { routeId: string | null; slots: Slot[]; physicalLength: number }

const slotCache = new WeakMap<Track, SlotPath[]>();
/** Candidate sites every 10 m: trunk pieces (outside fork zones) merged into one path, plus each fork route. */
function slotPaths(track: Track): SlotPath[] {
  const cached = slotCache.get(track);
  if (cached) return cached;
  const forks = track.branches ?? [], paths = new Map<string | null, SlotPath>();
  for (const path of roadPaths(track)) {
    const fork = path.routeId ? forks.find(f => f.routes.some(r => r.id === path.routeId)) : undefined;
    const lo = fork ? Math.max(path.start, fork.start + 80) : Math.max(path.start, 140);
    const hi = fork ? Math.min(path.end, fork.end - 80) : Math.min(path.end, track.length - 120);
    const entry = paths.get(path.routeId) ?? { routeId: path.routeId, slots: [], physicalLength: 0 };
    entry.physicalLength += physicalDistance(track, path.start, path.end - path.start, path.routeId);
    for (let d = Math.ceil(lo / 10) * 10; d <= hi; d += 10) {
      if (!fork && forks.some(f => d >= f.start - 125 && d <= f.end + 100)) continue;
      if (!jumpPlacementClear(track, d, path.routeId, 100)) continue;
      const course = track.sample(d, undefined, path.routeId).section === 'course';
      entry.slots.push({ index: entry.slots.length, distance: d, physical: physicalDistance(track, 0, d, path.routeId),
        plain: course, course, gentle: safePlacement(track, { distance: d, routeId: path.routeId ?? undefined }) });
    }
    paths.set(path.routeId, entry);
  }
  const list = [...paths.values()];
  // A fork route that runs entirely through a stunt section still keeps its static fields, as the authored routes always did.
  for (const path of list) if (path.routeId && !path.slots.some(slot => slot.plain)) path.slots.forEach(slot => { slot.plain = true; });
  slotCache.set(track, list);
  return list;
}

/** Share of a path's fields that may stay unplaced before hard fields give way to statics. */
const TOLERANCE = .2;
const spacing = (a: FieldType, b: FieldType) => a === 'static' && b === 'static' ? 90 : 130;
const shuffled = <T,>(list: readonly T[], random: () => number) => {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.min(i, Math.floor(random() * (i + 1))); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
};

type Placed = { type: FieldType; slot: Slot };

/**
 * `count` sites from `sites` (sorted along the road), at least `gap` metres apart. A backward pass fixes the latest
 * feasible site of each field so the rest always fits; sites then stay near an even share of the run, so fields spread out.
 */
function placeRun(sites: readonly Slot[], count: number, gap: number, random: () => number): Slot[] | null {
  const latest: number[] = []; let limit = Infinity, cursor = sites.length - 1;
  for (let k = count - 1; k >= 0; k--) {
    while (cursor >= 0 && sites[cursor].physical > limit - (k < count - 1 ? gap : 0)) cursor--;
    if (cursor < 0) return null;
    limit = latest[k] = sites[cursor].physical;
  }
  const placed: Slot[] = [];
  for (let k = 0; k < count; k++) {
    const from = k ? placed[k - 1].physical + gap : -Infinity;
    const fits = sites.filter(s => s.physical >= from && s.physical <= latest[k]);
    const centre = (k + .5) / count * sites.length, half = sites.length / count / 2;
    const near = fits.filter(s => Math.abs(sites.indexOf(s) - centre) <= half), pool = near.length ? near : fits;
    placed.push(pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]);
  }
  return placed;
}

/** Corridors, moving and mine fields first, in a random order, on gentle road 130 m apart (centre to centre). */
function placeHard(slots: readonly Slot[], types: readonly FieldType[], random: () => number): Placed[] | null {
  const run = placeRun(slots.filter(s => s.gentle), types.length, 130, random);
  return run && run.map((slot, i) => ({ type: types[i], slot }));
}

/** Statics share out the room left between hard fields (90 m apart, 130 m from a hard field); the best fit is `short` fields too many. */
function placeStatics(slots: readonly Slot[], hard: readonly Placed[], count: number, random: () => number) {
  const marks = hard.map(p => p.slot.physical).sort((a, b) => a - b);
  const gaps = [-Infinity, ...marks].map((mark, i) => {
    const lo = mark + 130, hi = (i < marks.length ? marks[i] : Infinity) - 130;
    const sites = slots.filter(s => s.plain && s.physical >= lo && s.physical <= hi);
    let capacity = 0, last = -Infinity;
    for (const s of sites) if (s.physical - last >= 90) { capacity++; last = s.physical; }
    return { sites, capacity, take: 0 };
  });
  let open = gaps.filter(g => g.capacity), short = count;
  while (short && open.length) {
    const gap = open[Math.min(open.length - 1, Math.floor(random() * open.length))];
    gap.take++; short--;
    if (gap.take === gap.capacity) open = open.filter(g => g !== gap);
  }
  const placed = [...hard];
  for (const gap of gaps) if (gap.take) for (const slot of placeRun(gap.sites, gap.take, 90, random) ?? []) placed.push({ type: 'static', slot });
  return { placed, short };
}

/**
 * One path: random hard-field order and sites, then statics; the best of several attempts wins.
 * When fields cannot all fit, hard ones turn static one by one (statics are easier to place); statics still short are dropped,
 * unless `strict` (counts must match exactly, otherwise the attempt is a miss).
 */
function placeTypes(slots: readonly Slot[], want: Readonly<Record<FieldType, number>>, random: () => number, strict: boolean) {
  const left = { ...want }; let kept: { placed: Placed[]; short: number } | undefined, stale = 0;
  for (;;) {
    let best: { placed: Placed[]; short: number } | undefined;
    for (let attempt = 0; attempt < (strict ? 40 : 80) && best?.short !== 0; attempt++) {
      const hard = left.corridor + left.moving + left.mine ? placeHard(slots, shuffled([...Array<FieldType>(left.corridor).fill('corridor'),
        ...Array<FieldType>(left.moving).fill('moving'), ...Array<FieldType>(left.mine).fill('mine')], random), random) : [];
      if (!hard) continue;
      const result = placeStatics(slots, hard, left.static, random);
      if (!best || result.short < best.short) best = result;
    }
    if (strict) return best?.short === 0 ? { placed: best.placed, missed: 0 } : { placed: [], missed: 1 };
    if (best) { if (!kept || best.short < kept.short) { kept = best; stale = 0; } else stale++; }
    const total = want.static + want.mine + want.corridor + want.moving;
    if (kept && (kept.short <= TOLERANCE * total || stale >= 6 || !left.corridor && !left.mine && !left.moving)) return { placed: kept.placed, missed: kept.short };
    const type = (['corridor', 'moving', 'mine'] as const).reduce((a, b) => left[b] > left[a] ? b : a);
    left[type]--; left.static++;
  }
}

const NO_FIELDS = { static: 0, corridor: 0, moving: 0, mine: 0, pad: 0 };

export function layoutCounts(heights: readonly HeightObstacle[], corridors: readonly CorridorObstacle[], pads: readonly BoostPad[] = [], mineFields: readonly MineField[] = [], rings: readonly BoostRing[] = []): LayoutCounts {
  const counts = new Map<string, Record<FieldType | 'pad', number>>();
  const bump = (routeId: string | undefined, type: FieldType | 'pad') => {
    const key = routeId ?? '';
    counts.set(key, { ...counts.get(key) ?? NO_FIELDS, [type]: (counts.get(key)?.[type] ?? 0) + 1 });
  };
  for (const o of heights) bump(o.routeId, o.motion ? 'moving' : 'static');
  for (const o of corridors) bump(o.routeId, 'corridor');
  for (const o of mineFields) bump(o.routeId, 'mine');
  for (const o of [...pads, ...rings]) bump(o.routeId, 'pad');
  return counts;
}

/** Boosts a path carries (pads, or rings on stunt sections and course road together). */
const boostTotal = (path: SlotPath, challenge: RaceChallengeId) => Math.round(path.physicalLength / 1000 * BOOSTS_PER_KM[challenge]);

/** Rings per path (key as in LayoutCounts) that sit in stunt sections: at most half of the path's boosts while it has course road to share. */
export function ringQuota(track: Track, challenge: RaceChallengeId): ReadonlyMap<string, number> {
  const quota = new Map<string, number>(), marks = ringMarks(track);
  for (const path of slotPaths(track)) {
    const total = boostTotal(path, challenge), own = marks.filter(m => (m.routeId ?? null) === path.routeId).length;
    quota.set(path.routeId ?? '', Math.min(own, path.slots.some(s => s.course) ? Math.ceil(total / 2) : total));
  }
  return quota;
}

/**
 * Boost sites on one path (pads or course rings; lanes come later): on course road, at least 40 m from every field's depth edge
 * and 120 m from each other. The first half (rounded down) sit 80-120 m before a corridor; those that find no site become free boosts.
 */
function placeBoosts(path: SlotPath, count: number, fields: readonly { physical: number; depth: number; corridor: boolean }[], random: () => number) {
  const placed: Slot[] = [];
  const ok = (s: Slot) => s.course && fields.every(f => Math.abs(s.physical - f.physical) - f.depth / 2 >= 40.5) && placed.every(p => Math.abs(s.physical - p.physical) >= 120.5);
  const take = (pool: readonly Slot[]) => { if (pool.length) placed.push(pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]); return pool.length > 0; };
  for (const c of shuffled(fields.filter(f => f.corridor), random)) {
    if (placed.length >= Math.floor(count / 2)) break;
    take(path.slots.filter(s => ok(s) && s.physical >= c.physical - 119.5 && s.physical <= c.physical - 80.5));
  }
  while (placed.length < count && take(path.slots.filter(ok)));
  return { missed: count - placed.length, slots: placed };
}

/**
 * Picks a fresh set of sites for every field: order, position and type sequence all change with `random`.
 * Per-path type counts follow the challenge density, or `counts` when given (so every run matches the base layout).
 * `missed` is how many fields found no valid site (with `counts`, any shortfall).
 */
export function layoutObstacles(track: Track, challenge: RaceChallengeId, random: () => number, template: HeightObstacle,
  counts?: LayoutCounts, options: { mines?: boolean } = {}): ObstacleLayout {
  const tuning = EXTRA_OBSTACLES[challenge], share = HAZARD_SHARE[challenge], mineSize = tuning.mine;
  const ring = track.boostKind === 'ring', boosts = hazardEnabled(ring ? 'boost-ring' : 'boost-pad'), quota = ring ? ringQuota(track, challenge) : undefined;
  const heights: HeightObstacle[] = [], corridors: CorridorObstacle[] = [], pads: BoostPad[] = [], rings: BoostRing[] = [], mineFields: MineField[] = [];
  let missed = 0;
  for (const path of slotPaths(track)) {
    const key = path.routeId ?? '';
    const target = Math.max(path.routeId ? 1 : 0, Math.round(path.physicalLength / HAZARD_GAP[challenge]));
    const corridor = hazardEnabled('corridor') ? Math.min(target, Math.round(target * share.corridor)) : 0;
    const moving = hazardEnabled('moving-field') ? Math.min(target - corridor, Math.round(target * share.moving)) : 0;
    const mine = options.mines ?? hazardEnabled('minefield') ? Math.min(target - corridor - moving, Math.round(target * share.mine)) : 0;
    const course = path.slots.some(s => s.course), total = boosts ? boostTotal(path, challenge) : 0;
    const want = counts ? counts.get(key) ?? NO_FIELDS : { static: hazardEnabled('static-field') ? target - corridor - moving - mine : 0, corridor, moving, mine,
      pad: course ? Math.max(0, total - (quota?.get(key) ?? 0)) : 0 };
    const order = placeTypes(path.slots, want, random, !!counts);
    missed += order.missed;
    const depth = { corridor: tuning.depth, moving: template.depth, mine: mineSize.length, static: template.depth };
    const sites = placeBoosts(path, want.pad, order.placed.map(({ type, slot }) => ({ physical: slot.physical,
      depth: depth[type], corridor: type === 'corridor' })), random);
    const routeId = path.routeId ?? undefined;
    for (const s of sites.slots) {
      if (ring) rings.push({ routeId, distance: s.distance, offset: 0, radius: RING_RADIUS });
      else pads.push({ routeId, distance: s.distance, lane: 'center', center: 0, width: track.halfWidth * .5, length: 14 });
    }
    missed += sites.missed;
    // Back-to-back fields chain: an entry lies within what a craft can slide sideways over the gap since the previous exit.
    let previous: MineField | undefined;
    for (const { type, slot } of order.placed.sort((a, b) => a.slot.physical - b.slot.physical)) {
      if (type === 'corridor') corridors.push({ routeId, distance: slot.distance, depth: tuning.depth, speedRetention: template.speedRetention,
        safeCenter: 0, safeWidth: track.halfWidth * tuning.safeWidth, lane: 'center' });
      else if (type === 'mine') {
        const start = slot.distance - mineSize.length / 2, gap = previous ? start - previous.distance - previous.length : Infinity;
        previous = createMineField(start, routeId, mineSize, track.halfWidth, random, gap > 0 && gap < 300 ? { offset: previous!.line.at(-1)!.offset, reach: MINE_CHAIN_SLOPE * gap } : undefined);
        mineFields.push(previous);
      }
      else heights.push(type === 'moving' ? { ...template, routeId, distance: slot.distance, motion: { stepSeconds: tuning.stepSeconds, transitionSeconds: .7, phase: 0, clearance: tuning.clearance } }
        : { ...template, routeId, distance: slot.distance });
    }
  }
  for (const list of [heights, corridors, pads, rings, mineFields]) list.sort((a, b) => a.distance - b.distance);
  return { heights, corridors, pads, rings, mineFields, counts: layoutCounts(heights, corridors, pads, mineFields, rings), missed };
}
