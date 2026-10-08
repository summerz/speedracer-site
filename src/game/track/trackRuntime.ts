import type { RaceChallengeId } from './raceChallenge.js';
import { createTrack, createTrackFrame } from './createTrack.js';
import type { Track } from './createTrack.js';
import { authorClosedTrack } from './trackAuthoring.js';
import { ALTITUDE_PROFILES } from './altitudeProfile.js';
import type { DifficultyPreset } from './difficulty.js';
import type { TrackDefinition } from './trackCatalog.js';
import { configureExtraObstacles } from './obstacleDynamics.js';
import { withTrackBranches, roadPaths } from './trackBranches.js';

export function trackPreset(definition: TrackDefinition): DifficultyPreset {
  const id = definition.altitudeLevels === 2 ? 'beginner' : definition.altitudeLevels === 3 ? 'intermediate' : 'advanced';
  return { id, label: `난이도 ${definition.rating}/6`, description: definition.features, altitude: ALTITUDE_PROFILES[id],
    layout: { halfWidth: definition.halfWidth, helixTurns: 1, helixPitch: 300, corners: 'gentle' }, obstacleLevels: definition.obstacleLevels };
}
export function createCatalogTrack(definition: TrackDefinition, challenge: RaceChallengeId = 'normal'): Track {
  const track = withTrackBranches(createTrack(undefined, trackPreset(definition), definition.layout ? authorClosedTrack(definition.layout) : undefined), definition.branches);
  return configureExtraObstacles(track, challenge, definition.id);
}
export function trackMetrics(track: Track) {
  const frame = createTrackFrame(); let maxCurvature = 0, minHeight = Infinity, maxHeight = -Infinity, rollingMetres = 0;
  for (const path of roadPaths(track)) for (let d = path.start; d < path.end; d += 5) {
    track.sample(d, frame, path.routeId); maxCurvature = Math.max(maxCurvature, Math.abs(frame.curvature));
    minHeight = Math.min(minHeight, frame.position.y); maxHeight = Math.max(maxHeight, frame.position.y);
    if (frame.section !== 'course' || frame.up.y < .7) rollingMetres += 5;
  }
  const lengthMin = track.length + (track.branches ?? []).reduce((sum, f) => sum + Math.min(...f.routes.map(r => r.length)) - (f.end - f.start), 0);
  const lengthMax = track.length + (track.branches ?? []).reduce((sum, f) => sum + Math.max(...f.routes.map(r => r.length)) - (f.end - f.start), 0);
  return { length: track.length, lengthMin, lengthMax, halfWidth: track.halfWidth, heightRange: maxHeight - minHeight, maxCurvature,
    rollingMetres, altitudeLevels: track.altitudeProfile.levels.length, obstacles: track.heightObstacles.length + (track.corridorObstacles?.length ?? 0) };
}
