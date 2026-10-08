import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACK_CATALOG } from '../output/test/game/track/trackCatalog.js';
import { createTrack } from '../output/test/game/track/createTrack.js';
import { DIFFICULTIES } from '../output/test/game/track/difficulty.js';
import { createCatalogTrack } from '../output/test/game/track/trackRuntime.js';
import { boostPadGuide, configureExtraObstacles, resolveHeightObstacle, corridorCanPass, obstacleArrivalTime } from '../output/test/game/track/obstacleDynamics.js';
import { createDrivingModel, NEUTRAL_INPUT } from '../output/test/game/driving/createDrivingModel.js';
import { createRaceSession } from '../output/test/game/driving/createRaceSession.js';
import { createRaceRecords } from '../output/test/game/driving/raceRecords.js';
import { DEFAULT_DRONE_CONFIGURATION } from '../output/test/game/drone/droneConfiguration.js';
import { ALTITUDE_PROFILES } from '../output/test/game/track/altitudeProfile.js';

test('all catalog courses add corridors and moving fields (mine fields are on hold) on every challenge, getting denser and tighter', () => {
  const total = t => t.heightObstacles.length + (t.corridorObstacles?.length ?? 0) + (t.mineFields?.length ?? 0);
  const tracks = { easy: [], normal: [], hard: [] };
  for (const definition of TRACK_CATALOG) {
    const [easy, normal, hard] = ['easy', 'normal', 'hard'].map(c => createCatalogTrack(definition, c));
    for (const [name, track] of Object.entries({ easy, normal, hard })) {
      tracks[name].push(track);
      for (const o of [...track.corridorObstacles, ...track.heightObstacles.filter(o => o.motion), ...track.mineFields.map(f => ({ ...f, distance: f.distance + f.length / 2 }))]) {
        for (const offset of [-60, 0, 60]) {
          const f = track.sample(o.distance + offset, undefined, o.routeId);
          assert.equal(f.section, 'course'); assert.ok(Math.abs(f.curvature) < .008);
        }
      }
    }
    assert.ok(total(easy) <= total(normal) && total(normal) <= total(hard), definition.name);
  }
  for (const [name, list] of Object.entries(tracks)) {
    assert.ok(list.some(t => t.corridorObstacles.length) && list.some(t => t.heightObstacles.some(o => o.motion)), name);
    assert.ok(list.every(t => !t.mineFields.length), `${name}: no mine fields while on hold`);
    assert.ok(list.filter(t => t.corridorObstacles.length && t.heightObstacles.some(o => o.motion)).length >= list.length * .6, `${name}: most courses show both hazards`);
  }
  const step = c => tracks[c].flatMap(t => t.heightObstacles.filter(o => o.motion).map(o => o.motion))[0];
  assert.ok(step('hard').stepSeconds < step('normal').stepSeconds && step('normal').stepSeconds < step('easy').stepSeconds);
  assert.ok(step('hard').clearance < step('normal').clearance && step('normal').clearance < step('easy').clearance);
  assert.equal(step('easy').stepSeconds, 2); assert.equal(step('easy').clearance, .75);
  const widths = c => tracks[c].flatMap(t => t.corridorObstacles.map(o => o.safeWidth / t.halfWidth))[0];
  assert.ok(widths('easy') > widths('normal') && widths('normal') > widths('hard'));
});

test('free drive tracks get corridors too, and no mine fields while on hold', () => {
  const track = configureExtraObstacles(createTrack(undefined, DIFFICULTIES.intermediate), 'normal');
  assert.ok(track.corridorObstacles.length >= 1);
  assert.equal(track.mineFields.length, 0);
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

test('boost pad HUD feed reports the upcoming pad and lane, flags the lateral band, and yields to a nearer hazard', () => {
  const pad = { distance: 500, lane: 'right', center: 6, width: 6, length: 14 };
  const track = { length: 2000, boostPads: [pad, { ...pad, distance: 900, lane: 'left', center: -6, routeId: 'other' }] };
  const guide = (distance, offset, hazard = null) => boostPadGuide(track, distance, offset, 'main', hazard);
  assert.deepEqual(guide(400, 6), { distance: 100, lane: 'right', safe: true });
  assert.equal(guide(400, 0).safe, false);
  assert.equal(guide(300, 6), null, 'beyond 150 m');
  assert.equal(guide(400, 6, 60), null, 'a nearer corridor or height field wins');
  assert.equal(guide(400, 6, 160).lane, 'right');
  assert.equal(guide(520, 6), null, 'passed pad is a lap away');
});
