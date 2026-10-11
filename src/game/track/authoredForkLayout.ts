import type { BoostPad, CorridorObstacle, HeightObstacle, Track } from './createTrack.js';
import { safePlacement } from './obstaclePlacement.js';
import { forkDecisionPlacementClear } from './forkDecisionSafety.js';
import { advanceTrackDistance } from './trackBranches.js';
import { jumpPlacementClear } from './trackJump.js';

/** Pilot forks own their complete layout; run randomization must preserve these sites. */
export function isAuthoredForkRoute(track: Track | undefined, routeId?: string | null): boolean {
  return !!routeId && !!track?.branches?.some(f => f.authoredLayout && f.routes.some(r => r.id === routeId));
}

export function authoredForkLayout(track: Track, template: HeightObstacle) {
  const heights: HeightObstacle[] = [], corridors: CorridorObstacle[] = [], pads: BoostPad[] = [];
  for (const fork of track.branches ?? []) {
    if (!fork.authoredLayout) continue;
    const terrace = fork.authoredLayout === 'terrace-height';
    for (const route of fork.routes) {
      const at = (metres: number) => {
        const d = advanceTrackDistance(track, route.mouthEnd, metres, route.id);
        if (d > route.mergeStart - 15) throw new Error(`Authored fork site outside route body: ${route.id}`);
        return d;
      };
      if (route.cue?.choice === 'left' || route.cue?.choice === 'lower') {
        const levels = track.altitudeProfile.levels;
        let previousDistance: number | undefined;
        for (const level of [levels.length - 1, 0]) {
          const height = levels[level];
          let distance = previousDistance === undefined ? at(terrace ? 65 : 20)
            : advanceTrackDistance(track, previousDistance, terrace ? 140 : 120, route.id);
          while (!forkDecisionPlacementClear(track, distance, route.id, template.depth / 2 + 3)) {
            distance = advanceTrackDistance(track, distance, 10, route.id);
            if (distance > route.mergeStart - 15) throw new Error(`No clear altitude-fork site: ${route.id}`);
          }
          heights.push({ ...template, motion: undefined, routeId: route.id, distance,
            kind: level === 0 ? 'descend' : 'rise',
            minAltitude: level === 0 ? height : height - .45,
            maxAltitude: level === 0 ? height + .45 : height });
          previousDistance = distance;
        }
      } else if (route.cue?.choice === 'center') {
        // A new footprint can bend the neutral route; keep the corridor on gentle pavement.
        let distance = at(80);
        while (!safePlacement(track, { distance, routeId: route.id })) {
          distance = advanceTrackDistance(track, distance, 10, route.id);
          if (distance > route.mergeStart - 15) throw new Error(`No safe authored corridor site: ${route.id}`);
        }
        corridors.push({ routeId: route.id, distance, depth: 4, speedRetention: template.speedRetention,
          lane: 'center', safeCenter: 0, safeWidth: track.halfWidth * 1.1 });
      } else {
        let distance = at(terrace ? 130 : 80);
        if (!jumpPlacementClear(track, distance, route.id, 7)) {
          // Keep the authored boost route's reward on pavement, after the landing.
          while (!jumpPlacementClear(track, distance, route.id, 7) && distance < route.mergeStart - 15)
            distance = advanceTrackDistance(track, distance, 10, route.id);
          if (distance > route.mergeStart - 15) throw new Error(`No clear jump boost site: ${route.id}`);
        }
        pads.push({ routeId: route.id, distance, lane: 'center', center: 0, width: track.halfWidth, length: 14 });
      }
    }
  }
  return { heights, corridors, pads };
}
