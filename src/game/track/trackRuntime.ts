import { createTrack, createTrackFrame } from './createTrack.js';
import type { Track } from './createTrack.js';
import { authorClosedTrack } from './trackAuthoring.js';
import { ALTITUDE_PROFILES } from './altitudeProfile.js';
import type { DifficultyPreset } from './difficulty.js';
import type { TrackDefinition } from './trackCatalog.js';

export function trackPreset(definition: TrackDefinition): DifficultyPreset {
  const id = definition.altitudeLevels === 2 ? 'beginner' : definition.altitudeLevels === 3 ? 'intermediate' : 'advanced';
  return { id, label: `난이도 ${definition.rating}/6`, description: definition.features, altitude: ALTITUDE_PROFILES[id],
    layout: { halfWidth: definition.halfWidth, helixTurns: 1, helixPitch: 300, corners: 'gentle' }, obstacleLevels: definition.obstacleLevels };
}
export function createCatalogTrack(definition: TrackDefinition): Track {
  return createTrack(undefined, trackPreset(definition), definition.layout ? authorClosedTrack(definition.layout) : undefined);
}
export function trackMetrics(track: Track) {
  const frame = createTrackFrame(); let maxCurvature = 0, minHeight = Infinity, maxHeight = -Infinity, rollingMetres = 0;
  for (let d = 0; d < track.length; d += 5) {
    track.sample(d, frame); maxCurvature = Math.max(maxCurvature, Math.abs(frame.curvature));
    minHeight = Math.min(minHeight, frame.position.y); maxHeight = Math.max(maxHeight, frame.position.y);
    if (frame.section !== 'course' || frame.up.y < .7) rollingMetres += 5;
  }
  return { length: track.length, halfWidth: track.halfWidth, heightRange: maxHeight - minHeight, maxCurvature,
    rollingMetres, altitudeLevels: track.altitudeProfile.levels.length, obstacles: track.heightObstacles.length };
}
