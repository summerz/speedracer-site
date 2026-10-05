import test from 'node:test';
import assert from 'node:assert/strict';
import { expandObstacleLayout } from '../output/test/game/track/obstacleLayout.js';
import { TRACK_CATALOG } from '../output/test/game/track/trackCatalog.js';
import { physicalDistance } from '../output/test/game/track/trackBranches.js';
import { createCatalogTrack } from '../output/test/game/track/trackRuntime.js';
import { createRaceSession } from '../output/test/game/driving/createRaceSession.js';
import { createRaceRecords } from '../output/test/game/driving/raceRecords.js';
import { DEFAULT_DRONE_CONFIGURATION } from '../output/test/game/drone/droneConfiguration.js';

test('every campaign course has more fields and random safe levels with unchanged positions', () => {
  for (const definition of TRACK_CATALOG) {
    const track = createCatalogTrack(definition);
    assert.ok(track.heightObstacles.length > definition.obstacleLevels.length);
    const positions = track.heightObstacles.map(o => o.distance);
    assert.ok(positions[0] >= 140);
    for (const routeId of [null, ...(track.branches ?? []).flatMap(f => f.routes.map(r => r.id))]) {
      const reachable = track.heightObstacles.filter(o => !o.routeId || o.routeId === routeId);
      for (let i = 1; i < reachable.length; i++) assert.ok(
        physicalDistance(track, reachable[i-1].distance, reachable[i].distance-reachable[i-1].distance, routeId) >= 90,
        `${definition.name}: fields on the same route need 90m clearance`);
    }
    for (const random of [() => 0, () => .5, () => .999]) {
      track.randomizeObstacles(random);
      assert.deepEqual(track.heightObstacles.map(o => o.distance), positions);
      const level = Math.floor(random() * track.altitudeProfile.levels.length);
      const height = track.altitudeProfile.levels[level];
      for (const o of track.heightObstacles) assert.ok(height >= o.minAltitude && height <= o.maxAltitude);
    }
  }
});

test('straight segments receive extra fields while bends keep the base spacing', () => {
  const authored = Array.from({ length: 6 }, (_, i) => ({ distance: i * 100, depth: 4, minAltitude: 1, maxAltitude: 2 }));
  const road = curvature => ({ length: 4000, sample: () => ({ section: 'course', curvature, tangent: { y: 0 } }) });
  assert.ok(expandObstacleLayout(road(0), authored).length > expandObstacleLayout(road(.01), authored).length);
});

test('session randomizes once on fresh start/restart, shares fields with rivals and preserves pause/resume', () => {
  const track = createCatalogTrack(TRACK_CATALOG[0]);
  const original = track.randomizeObstacles;
  let calls = 0;
  track.randomizeObstacles = random => { calls++; original(random); };
  const session = createRaceSession(track, DEFAULT_DRONE_CONFIGURATION, createRaceRecords({ trackId: 'random-layout', configurationId: 'stock' }), 0, 'competition', () => .5);
  session.start(); assert.equal(calls, 1);
  const bands = track.heightObstacles.map(o => [o.minAltitude, o.maxAltitude]);
  session.pause(); session.start(); assert.equal(calls, 1);
  assert.deepEqual(track.heightObstacles.map(o => [o.minAltitude, o.maxAltitude]), bands);
  session.restart(); assert.equal(calls, 2);
});
