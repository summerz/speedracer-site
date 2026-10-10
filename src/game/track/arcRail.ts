import type { ArcRail, BoostRing, Track } from './createTrack.js';
import type { RaceChallengeId } from './raceChallenge.js';
import { ARC_RAILS_PER_TRACK, hazardEnabled } from './hazardCatalog.js';
import { CRAFT_HALF_WIDTH, MINE_LINE_SLOPE } from './mineField.js';
import { roadPaths, routeDistanceScale } from './trackBranches.js';

export const RING_RADIUS = 3.5;
/** A ring triggers while the craft centre is within this of the ring centre (the craft's own width is not counted). */
export const RING_REACH = RING_RADIUS - .8;
const MARGIN = 32, SEGMENT = [80, 150] as const;
/** Clear metres between two segments: enough to cross from one safe half to the other at the minefield slope limit. */
export const arcGap = (challenge: RaceChallengeId) => Math.max(challenge === 'easy' ? 120 : 80, 2 * CRAFT_HALF_WIDTH / MINE_LINE_SLOPE);

export interface StuntSection { routeId?: string; start: number; end: number }
const cache = new WeakMap<Track, StuntSection[]>();
/** Every maximal vertical-loop/helix run on each road path (2 m sampling). */
export function stuntSections(track: Track): StuntSection[] {
  const cached = cache.get(track);
  if (cached) return cached;
  const list: StuntSection[] = [];
  for (const path of roadPaths(track)) {
    let run: StuntSection | null = null;
    for (let d = path.start; d <= path.end + 1e-6; d += 2) {
      const at = Math.min(d, path.end), inside = track.sample(at, undefined, path.routeId).section !== 'course';
      if (inside) { if (run) run.end = at; else run = { routeId: path.routeId ?? undefined, start: at, end: at }; }
      else if (run) { list.push(run); run = null; }
    }
    if (run) list.push(run);
  }
  cache.set(track, list);
  return list;
}

/** The segment (absolute distances) of a rail on this route that covers `distance`, if any. */
export function activeArcSegment(rails: readonly ArcRail[], routeId: string | undefined, distance: number) {
  for (const rail of rails) {
    if (rail.routeId && rail.routeId !== routeId) continue;
    for (const segment of rail.segments) {
      const start = rail.distance + segment.at;
      if (distance >= start && distance <= start + segment.length) return { start, end: start + segment.length, side: segment.side };
    }
  }
  return undefined;
}

/** `ARC_RAILS_PER_TRACK` rails on randomly chosen stunt sections (fewer if fewer fit), trimmed 30+ m at both ends; random first side, segment lengths and switch count, every gap >= `arcGap`. */
export function createArcRails(track: Track, challenge: RaceChallengeId, random: () => number): ArcRail[] {
  const fits = stuntSections(track).flatMap(section => {
    // Hands-off craft drift to the centre in the 150 m before a fork (see forkApproachDrift), so a rail never runs into that approach.
    const fork = section.routeId ? undefined : track.branches?.find(f => f.start >= section.start && f.start - 150 < section.end);
    // A forked helix includes its Y mouths in the section classification, but
    // those mouths are for route selection, before ordinary hazard steering.
    const route = track.branches?.flatMap(f => f.routes).find(r => r.id === section.routeId);
    // Route handoff also needs time to release the selection input before
    // crossing onto a safe half; use the easy lane-switch allowance here.
    const distance = Math.max(section.start + MARGIN, route ? route.mouthEnd + Math.max(120, arcGap(challenge)) : -Infinity);
    const length = Math.min(section.end - MARGIN, route ? route.mergeStart - MARGIN : Infinity, fork ? fork.start - 150 : Infinity) - distance;
    const stretch = 1 / Math.min(1, routeDistanceScale(track, distance + length / 2, section.routeId));
    const gap = arcGap(challenge) * stretch, [min, max] = [SEGMENT[0] * stretch, SEGMENT[1] * stretch];
    const most = Math.floor((length + gap) / (min + gap));
    return most < 1 ? [] : [{ section, distance, length, gap, min, max, most }];
  });
  const chosen = hazardEnabled('arc-rail') ? fits.map(fit => ({ fit, key: random() })).sort((a, b) => a.key - b.key)
    .slice(0, ARC_RAILS_PER_TRACK[challenge]).map(c => c.fit).sort((a, b) => a.distance - b.distance) : [];
  return chosen.map(({ section, distance, length, gap, min, max, most }) => {
    const count = 1 + Math.min(most - 1, Math.floor(random() * most));
    const lengths = Array.from({ length: count }, () => min + random() * (max - min));
    const excess = lengths.reduce((a, b) => a + b, 0) + (count - 1) * gap - length, spare = lengths.reduce((a, b) => a + b - min, 0);
    if (excess > 0 && spare > 0) for (let i = 0; i < count; i++) lengths[i] -= (lengths[i] - min) * Math.min(1, excess / spare);
    const slack = Math.max(0, length - lengths.reduce((a, b) => a + b, 0) - (count - 1) * gap);
    const weights = Array.from({ length: count + 1 }, () => random() + .05), total = weights.reduce((a, b) => a + b, 0);
    let side: -1 | 1 = random() < .5 ? -1 : 1, at = slack * weights[0] / total;
    const segments = lengths.map((len, i) => {
      const segment = { at, length: len, side }; side = -side as -1 | 1;
      at += len + gap + (i < count - 1 ? slack * weights[i + 1] / total : 0);
      return segment;
    });
    return { routeId: section.routeId, distance, length, segments };
  });
}

/** Every stunt-section ring mark: 1 per section (2 beyond 400 m) at its middle (loop apex / helix centre). */
export function ringMarks(track: Track) {
  return stuntSections(track).flatMap(section => {
    const span = section.end - section.start;
    return (span > 400 ? [1 / 3, 2 / 3] : [.5]).map(mark => ({ routeId: section.routeId, start: section.start, end: section.end, at: section.start + span * mark }));
  });
}

/** `quota` rings per path (key as in LayoutCounts) on randomly chosen marks, in a rail gap when one is near, never in a danger half; every mark without `quota`. */
export function createBoostRings(track: Track, rails: readonly ArcRail[], random: () => number, quota?: ReadonlyMap<string, number>): BoostRing[] {
  const rings: BoostRing[] = [], marks = ringMarks(track);
  const keep = new Set(quota ? [...new Set(marks.map(m => m.routeId ?? ''))].flatMap(key => marks.filter(m => (m.routeId ?? '') === key)
    .map(mark => ({ mark, key: random() })).sort((a, b) => a.key - b.key).slice(0, quota.get(key) ?? 0).map(c => c.mark)) : marks);
  for (const mark of marks) {
    if (!keep.has(mark)) continue;
    const lo = mark.start + 12, hi = mark.end - 12;
    let distance = Math.max(lo, Math.min(hi, mark.at + (random() * 2 - 1) * 15));
    const hit = activeArcSegment(rails, mark.routeId, distance);
    if (hit) {
      const free = [hit.start - 6, hit.end + 6].filter(d => d >= lo && d <= hi && !activeArcSegment(rails, mark.routeId, d) && Math.abs(d - distance) <= 90)
        .sort((a, b) => Math.abs(a - distance) - Math.abs(b - distance))[0];
      if (free !== undefined) distance = free;
    }
    const danger = activeArcSegment(rails, mark.routeId, distance);
    const sign = danger ? -danger.side : random() < .5 ? -1 : 1;
    rings.push({ routeId: mark.routeId, distance, offset: sign * track.halfWidth * .45, radius: RING_RADIUS });
  }
  return rings;
}

/** Craft over the electrified half? The craft's whole width counts. */
export const arcRailHit = (offset: number, side: -1 | 1) => offset * side > -CRAFT_HALF_WIDTH;

/** HUD cue for the next rail segment on this route (200 m or 4.5 s ahead, whichever is larger; 0 inside one), unless a nearer hazard (`hazardDistance`) exists. */
export function arcRailGuide(track: Track, distance: number, offset: number, speed: number, routeId?: string | null, hazardDistance: number | null = null) {
  let best: { distance: number; side: -1 | 1; safe: boolean } | null = null;
  for (const rail of track.arcRails ?? []) {
    if (rail.routeId && rail.routeId !== routeId) continue;
    for (const segment of rail.segments) {
      const start = rail.distance + segment.at;
      let gap = start - distance; gap += Math.ceil((-gap - segment.length) / track.length) * track.length;
      if (gap <= Math.max(200, speed * 4.5) && (!best || Math.max(0, gap) < best.distance))
        best = { distance: Math.max(0, gap), side: segment.side, safe: !arcRailHit(offset, segment.side) };
    }
  }
  return best && (hazardDistance === null || best.distance < hazardDistance) ? best : null;
}

/** HUD cue for the next boost ring on this route within `range`, unless a nearer hazard exists. */
export function boostRingGuide(track: Track, distance: number, offset: number, routeId?: string | null, hazardDistance: number | null = null, range = 150) {
  let best: { distance: number; side: 'left' | 'right'; safe: boolean } | null = null;
  for (const ring of track.boostRings ?? []) {
    if (ring.routeId && ring.routeId !== routeId) continue;
    let gap = ring.distance - distance; gap += Math.ceil(-gap / track.length) * track.length;
    if (gap <= range && (!best || gap < best.distance)) best = { distance: gap, side: ring.offset < 0 ? 'left' : 'right', safe: Math.abs(offset - ring.offset) <= RING_REACH };
  }
  return best && (hazardDistance === null || best.distance < hazardDistance) ? best : null;
}
