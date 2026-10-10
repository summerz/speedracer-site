import type { BoostPad, CorridorObstacle, HeightObstacle, Track } from './createTrack.js';
import { advanceTrackDistance } from './trackBranches.js';

/** Pilot forks own their complete layout; run randomization must preserve these sites. */
export function isAuthoredForkRoute(track: Track | undefined, routeId?: string | null): boolean {
  return !!routeId && !!track?.branches?.some(f => f.authoredLayout && f.routes.some(r => r.id === routeId));
}

export function authoredForkLayout(track: Track, template: HeightObstacle) {
  const heights: HeightObstacle[] = [], corridors: CorridorObstacle[] = [], pads: BoostPad[] = [];
  for (const fork of track.branches ?? []) {
    if (fork.authoredLayout !== 'arena-three') continue;
    for (const route of fork.routes) {
      const at = (metres: number) => {
        const d = advanceTrackDistance(track, route.mouthEnd, metres, route.id);
        if (d > route.mergeStart - 15) throw new Error(`Authored fork site outside route body: ${route.id}`);
        return d;
      };
      if (route.cue?.choice === 'left') {
        const levels = track.altitudeProfile.levels;
        for (const [i, level] of [levels.length - 1, 0].entries()) {
          const height = levels[level];
          heights.push({ ...template, motion: undefined, routeId: route.id, distance: at(65 + i * 140),
            kind: level === 0 ? 'descend' : 'rise',
            minAltitude: level === 0 ? height : height - .45,
            maxAltitude: level === 0 ? height + .45 : height });
        }
      } else if (route.cue?.choice === 'center') {
        corridors.push({ routeId: route.id, distance: at(130), depth: 4, speedRetention: template.speedRetention,
          lane: 'center', safeCenter: 0, safeWidth: track.halfWidth * 1.1 });
      } else {
        pads.push({ routeId: route.id, distance: at(130), lane: 'center', center: 0, width: track.halfWidth, length: 14 });
      }
    }
  }
  return { heights, corridors, pads };
}
