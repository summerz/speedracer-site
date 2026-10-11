import type { Track } from './createTrack.js';
import { physicalDistance } from './trackBranches.js';

/** Shared metres, matching the HUD's furthest possible advance notice. */
export const FORK_PREVIEW_MAX = 500;
/** Physical metres after the route locks: time to change altitude for the next field. */
export const FORK_ALTITUDE_RECOVERY = 200;

/** Keep the entire hazard out, including its leading/trailing edge and craft clearance.
 * radius is in shared metres, as obstacle depth/length is authored in that coordinate.
 * Applies to upstream roads too, including the previous lap and a previous fork.
 */
export function forkDecisionPlacementClear(track: Track, distance: number, routeId?: string | null, radius = 0): boolean {
  for (const fork of track.branches ?? []) {
    if (fork.kind !== 'vertical') continue;
    let relative = ((distance - fork.start) % track.length + track.length) % track.length;
    if (relative >= track.length - FORK_PREVIEW_MAX - radius) relative -= track.length;
    if (relative + radius < -FORK_PREVIEW_MAX) continue;
    if (relative - radius <= fork.junctionLength) return false;
    // Downstream branch hazards must belong to this junction, or its shared exit.
    if (routeId && !fork.routes.some(r => r.id === routeId)) continue;
    if (physicalDistance(track, fork.start + fork.junctionLength,
      relative - radius - fork.junctionLength, routeId) < FORK_ALTITUDE_RECOVERY) return false;
  }
  return true;
}
