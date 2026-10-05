import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACK_CATALOG } from '../output/test/game/track/trackCatalog.js';
import { createCatalogTrack } from '../output/test/game/track/trackRuntime.js';
import { resolveHeightObstacle, corridorCanPass, obstacleArrivalTime } from '../output/test/game/track/obstacleDynamics.js';
import { createDrivingModel, NEUTRAL_INPUT } from '../output/test/game/driving/createDrivingModel.js';
import { createRaceSession } from '../output/test/game/driving/createRaceSession.js';
import { createRaceRecords } from '../output/test/game/driving/raceRecords.js';
import { DEFAULT_DRONE_CONFIGURATION } from '../output/test/game/drone/droneConfiguration.js';
import { ALTITUDE_PROFILES } from '../output/test/game/track/altitudeProfile.js';

test('all 24 courses introduce both hazards on normal/hard while easy keeps static fields', () => {
  for (const definition of TRACK_CATALOG) {
    const easy = createCatalogTrack(definition, 'easy');
    assert.equal(easy.corridorObstacles?.length ?? 0, 0);
    assert.ok(easy.heightObstacles.every(o => !o.motion));
    const normal = createCatalogTrack(definition, 'normal'), hard = createCatalogTrack(definition, 'hard');
    for (const track of [normal, hard]) {
      assert.ok(track.corridorObstacles.length >= 1, definition.name);
      assert.ok(track.heightObstacles.some(o => o.motion), definition.name);
      for (const o of [...track.corridorObstacles, ...track.heightObstacles.filter(o => o.motion)]) {
        for (const offset of [-60, 0, 60]) {
          const f = track.sample(o.distance + offset, undefined, o.routeId);
          assert.equal(f.section, 'course'); assert.ok(Math.abs(f.curvature) < .008);
        }
      }
    }
    assert.ok(hard.corridorObstacles.length >= normal.corridorObstacles.length);
    assert.ok(hard.corridorObstacles[0].safeWidth < normal.corridorObstacles[0].safeWidth);
    assert.ok(hard.heightObstacles.find(o => o.motion).motion.stepSeconds < normal.heightObstacles.find(o => o.motion).motion.stepSeconds);
  }
});

test('moving openings visit every N level and allow a discrete level throughout their cycle', () => {
  for (const profile of Object.values(ALTITUDE_PROFILES)) {
    const obstacle = { distance: 200, depth: 4, motion: { stepSeconds: 1.15, transitionSeconds: .7, phase: 0, clearance: .6 } };
    const levels = profile.levels, period = 2 * (levels.length - 1) * 1.15;
    const visited = new Set();
    for (let t = 0; t < period; t += .01) {
      const gap = resolveHeightObstacle(obstacle, levels, t);
      const safe = levels.filter(h => h >= gap.minAltitude - 1e-8 && h <= gap.maxAltitude + 1e-8);
      assert.ok(safe.length, `${levels.length} levels at ${t}`); safe.forEach(h => visited.add(h));
      const repeated = resolveHeightObstacle(obstacle, levels, t + period);
      assert.ok(Math.abs(gap.minAltitude - repeated.minAltitude) < 1e-7);
    }
    assert.equal(visited.size, levels.length);
  }
  assert.equal(obstacleArrivalTime({ obstacleTime: 10 }, 99, 102.2, 100, 20), 10.9);
});

test('corridor sweep charges once per lap at every altitude and rewards a clear passage', () => {
  const corridor = { distance: 100, depth: 44, safeCenter: -5, safeWidth: 8, lane: 'left', speedRetention: .5 };
  const track = { length: 1200, halfWidth: 14, checkpointSpacing: 100, heightObstacles: [],
    corridorObstacles: [corridor], altitudeProfile: ALTITUDE_PROFILES.advanced, sample: () => ({ curvature: 0 }) };
  assert.equal(corridorCanPass(-5, corridor), true); assert.equal(corridorCanPass(0, corridor), false);
  for (const altitude of track.altitudeProfile.levels) {
    const model = createDrivingModel(track);
    Object.assign(model.state, { distance: 72, speed: 155, altitude, targetAltitude: altitude });
    for (let i = 0; i < 120; i++) model.step(1 / 60, { ...NEUTRAL_INPUT, throttle: true, boost: true });
    assert.equal(model.state.collisions, 1); assert.equal(model.state.penaltyPoints, 3);
    assert.equal(model.state.obstaclesPassed, 0); assert.ok(model.state.distance > 124);
    Object.assign(model.state, { distance: 1272, speed: 155 });
    for (let i = 0; i < 120; i++) model.step(1 / 60, { ...NEUTRAL_INPUT, throttle: true });
    assert.equal(model.state.collisions, 2); assert.equal(model.state.penaltyPoints, 6);
  }
  const safe = createDrivingModel(track);
  Object.assign(safe.state, { distance: 72, speed: 155, offset: -5 });
  for (let i = 0; i < 120; i++) safe.step(1 / 60, { ...NEUTRAL_INPUT, throttle: true, boost: true });
  assert.equal(safe.state.collisions, 0); assert.equal(safe.state.obstaclesPassed, 1);
});

test('moving field clock is shared by all racers and frozen during pause', () => {
  const track = createCatalogTrack(TRACK_CATALOG[0]);
  const session = createRaceSession(track, DEFAULT_DRONE_CONFIGURATION, createRaceRecords({ trackId: 'moving-clock', configurationId: 'test' }), 0, 'competition', () => .5);
  session.start();
  for (let i = 0; i < 240; i++) session.step(1 / 60, { ...NEUTRAL_INPUT, throttle: true });
  assert.ok(track.obstacleTime > 0);
  const clock = track.obstacleTime; session.pause();
  session.step(1, NEUTRAL_INPUT); assert.equal(track.obstacleTime, clock);
  session.start(); session.step(.1, NEUTRAL_INPUT); assert.ok(track.obstacleTime > clock);
  session.restart(); assert.equal(track.obstacleTime, 0);
});
