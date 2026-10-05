import { RACE_CHALLENGES, type RaceChallengeId } from './raceChallenge.js';
import { createTrack, createTrackFrame } from './createTrack.js';
import type { HeightObstacle, Track } from './createTrack.js';
import { authorClosedTrack } from './trackAuthoring.js';
import { ALTITUDE_PROFILES } from './altitudeProfile.js';
import type { DifficultyPreset } from './difficulty.js';
import type { TrackDefinition } from './trackCatalog.js';

export function trackPreset(definition: TrackDefinition): DifficultyPreset {
  const id = definition.altitudeLevels === 2 ? 'beginner' : definition.altitudeLevels === 3 ? 'intermediate' : 'advanced';
  return { id, label: `난이도 ${definition.rating}/6`, description: definition.features, altitude: ALTITUDE_PROFILES[id],
    layout: { halfWidth: definition.halfWidth, helixTurns: 1, helixPitch: 300, corners: 'gentle' }, obstacleLevels: definition.obstacleLevels };
}
export function createCatalogTrack(definition: TrackDefinition, challenge: RaceChallengeId = 'normal'): Track {
  const track = createTrack(undefined, trackPreset(definition), definition.layout ? authorClosedTrack(definition.layout) : undefined);
  const obstacles = track.heightObstacles as HeightObstacle[];
  const scale = RACE_CHALLENGES[challenge].obstacleScale;
  if (scale < 1) obstacles.splice(0, obstacles.length, ...obstacles.filter((_, i) => i % 5 !== 4));
  else if (scale > 1) {
    const extra = obstacles.slice(0, -1).flatMap((obstacle, i) => {
      if (i % 3 || obstacles[i + 1].distance - obstacle.distance < 180) return [];
      return [{ ...obstacle, distance: (obstacle.distance + obstacles[i + 1].distance) / 2 }];
    });
    obstacles.push(...extra); obstacles.sort((a, b) => a.distance - b.distance);
  }
  return track;
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
