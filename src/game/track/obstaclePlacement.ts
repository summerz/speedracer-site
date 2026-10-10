import type { Track } from './createTrack.js';

/** Gentle, straight-ish road around a field: the site rule for corridors and mine fields. */
export function safePlacement(track: Track, obstacle: { distance: number; routeId?: string }) {
  return [-60, -30, 0, 30, 60].every(offset => {
    const frame = track.sample(obstacle.distance + offset, undefined, obstacle.routeId);
    return frame.section === 'course' && Math.abs(frame.curvature) < .008 && Math.abs(frame.tangent.y) < .55;
  });
}

