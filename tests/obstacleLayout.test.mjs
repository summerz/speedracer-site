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
      const statics = track.heightObstacles.filter(o => !o.motion);
      const bands = statics.map(o => track.altitudeProfile.levels.findIndex(h => h >= o.minAltitude && h <= o.maxAltitude));
      assert.ok(bands.every(b => b >= 0));
      for (let i = 2; i < bands.length; i++) assert.ok(!(bands[i] === bands[i-1] && bands[i] === bands[i-2]), `${definition.name}: three identical levels`);
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

test('hard tracks randomize corridor lanes and moving-field phases without triple repeats', () => {
  const seeded = seed => () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const definition = TRACK_CATALOG.find(d => { const t = createCatalogTrack(d, 'hard'); return (t.corridorObstacles?.length ?? 0) >= 3 && t.heightObstacles.some(o => o.motion); });
  assert.ok(definition);
  const track = createCatalogTrack(definition, 'hard'), random = seeded(7);
  const distances = track.corridorObstacles.map(o => o.distance), lanes = new Set(), phases = new Set();
  for (let run = 0; run < 20; run++) {
    track.randomizeObstacles(random);
    const corridors = track.corridorObstacles;
    assert.deepEqual(corridors.map(o => o.distance), distances);
    corridors.forEach((c, i) => {
      lanes.add(c.lane);
      assert.equal(c.safeCenter, (['left', 'center', 'right'].indexOf(c.lane) - 1) * track.halfWidth * .58);
      if (i >= 2) assert.ok(!(c.lane === corridors[i-1].lane && c.lane === corridors[i-2].lane));
    });
    for (const o of track.heightObstacles.filter(o => o.motion)) {
      const cycle = o.motion.stepSeconds * (track.altitudeProfile.levels.length - 1) * 2;
      assert.ok(o.motion.phase >= 0 && o.motion.phase < cycle);
      phases.add(o.motion.phase);
    }
  }
  assert.ok(lanes.size >= 2);
  assert.ok(phases.size > 1);
});
