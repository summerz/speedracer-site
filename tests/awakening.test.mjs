import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrivingModel, NEUTRAL_INPUT } from '../output/test/game/driving/createDrivingModel.js';
import { createTimeAttack } from '../output/test/game/driving/createTimeAttack.js';
import { createRaceSession } from '../output/test/game/driving/createRaceSession.js';
import { createRaceRecords } from '../output/test/game/driving/raceRecords.js';
import { createAwakeningCores, AWAKENING_SPEED_SCALE } from '../output/test/game/driving/awakening.js';
import { DRONE_CATALOG } from '../output/test/game/drone/droneCatalog.js';
import { TRACK_CATALOG } from '../output/test/game/track/trackCatalog.js';
import { createCatalogTrack } from '../output/test/game/track/trackRuntime.js';
import { forkAt } from '../output/test/game/track/trackBranches.js';
import { createMineField } from '../output/test/game/track/mineField.js';
import { ALTITUDE_PROFILES } from '../output/test/game/track/altitudeProfile.js';

const configuration = DRONE_CATALOG[0].configuration;
const road = extra => ({ length: 5000, halfWidth: 14, checkpointSpacing: 100, heightObstacles: [],
  altitudeProfile: ALTITUDE_PROFILES.advanced, sample: () => ({ curvature: 0 }), ...extra });
const input = overrides => ({ ...NEUTRAL_INPUT, throttle: true, ...overrides });
const advance = (model, seconds, controls = input(), fps = 60) => {
  for (let i = 0; i < Math.round(seconds * fps); i++) model.step(1 / fps, controls);
};
const records = (laps = 3) => createRaceRecords({ trackId: 'awakening-test', configurationId: configuration.id, laps });

test('cores bank independently of boost, use swept lateral pickup, and return next lap and after reset', () => {
  const model = createDrivingModel(road());
  const core = model.cores[0];
  Object.assign(model.state, { distance: core.distance - 1, speed: 150, charge: .4, offset: 5 });
  model.step(1 / 60, input());
  assert.equal(model.state.awakeningCores, 0, 'missed the core outside its reach');
  Object.assign(model.state, { distance: core.distance - 1, speed: 150, offset: 0, heading: 0 });
  model.step(1 / 60, input());
  assert.equal(model.state.awakeningCores, 1);
  assert.equal(model.state.coresCollected, 1);
  assert.equal(model.coreAvailable(0, 0), false);
  assert.ok(model.state.charge < .5, 'core does not fill boost');
  Object.assign(model.state, { distance: core.distance - 1, speed: 150 });
  model.step(1 / 60, input());
  assert.equal(model.state.awakeningCores, 1, 'cannot collect again on the same lap');
  Object.assign(model.state, { distance: 5000 + core.distance - 1, speed: 150 });
  model.step(1 / 60, input());
  assert.equal(model.state.awakeningCores, 2, 'inventory can stack');
  assert.equal(model.coreAvailable(0, 1), false);
  model.reset();
  assert.equal(model.state.awakeningCores, 0);
  assert.equal(model.state.coresCollected, 0);
  assert.equal(model.coreAvailable(0, 0), true);
});

test('an activation costs exactly one core, lasts five seconds at every frame rate, and preserves boost', () => {
  const states = [30, 60, 120].map(fps => {
    const model = createDrivingModel(road());
    assert.equal(model.useAwakening(), false);
    Object.assign(model.state, { awakeningCores: 3, charge: 1.5 });
    assert.equal(model.useAwakening(), true);
    assert.equal(model.state.awakeningCores, 2);
    assert.equal(model.useAwakening(), false, 'cannot spend another while active');
    advance(model, 4, input({ steer: 1, brake: true, lift: 1, boost: true, targetSpeedScale: .1 }), fps);
    assert.ok(Math.abs(model.state.awakeningRemaining - 1) < 1e-7);
    assert.equal(model.state.charge, 1.5);
    assert.equal(model.state.collisions, 0);
    assert.equal(model.state.altitudeLevel, 0, 'manual altitude input is ignored');
    assert.equal(model.state.speed, configuration.performance.boostStage2Speed * AWAKENING_SPEED_SCALE);
    advance(model, 1, input({ brake: true, boost: true }), fps);
    assert.equal(model.state.awakeningRemaining, 0);
    assert.equal(model.state.awakeningsUsed, 1);
    assert.equal(model.state.charge, 1.5);
    return { ...model.state };
  });
  for (const state of states.slice(1)) for (const key of ['distance', 'speed', 'offset', 'altitude', 'elapsed'])
    assert.ok(Math.abs(state[key] - states[0][key]) < 1e-7, key);
});

test('each craft reaches its own second-stage maximum plus five percent and returns smoothly to manual control', () => {
  for (const { name, configuration: craft } of DRONE_CATALOG) {
    const model = createDrivingModel(road(), craft.performance);
    Object.assign(model.state, { awakeningCores: 1, charge: 1.5 });
    model.useAwakening(); advance(model, 5);
    const peak = craft.performance.boostStage2Speed * 1.05;
    assert.equal(model.state.speed, peak, name);
    model.step(1 / 120, input());
    assert.ok(model.state.speed < peak && model.state.speed > peak * .95, 'handoff is not an abrupt speed cut');
    advance(model, .8);
    assert.ok(model.state.speed <= craft.performance.topSpeed * (1 + craft.performance.downhillOverspeed), name);
    const offset = model.state.offset;
    advance(model, .2, input({ steer: 1 }));
    assert.ok(model.state.offset > offset, 'steering returns');
    model.step(1 / 120, input({ boost: true }));
    assert.equal(model.state.boosting, true, 'stored boost can be spent after release');
  }
});

test('height, corridor, mine, rail, wall and craft collisions cannot damage an awakened craft', () => {
  const mine = createMineField(500, undefined, { length: 150, mines: 12, radius: 1.5 }, 14, () => .4);
  const track = road({
    heightObstacles: [{ distance: 50, depth: 50, minAltitude: 5.2, maxAltitude: 6.2, speedRetention: .35 }],
    corridorObstacles: [{ distance: 250, depth: 50, safeCenter: -5, safeHalfWidth: 2.3, speedRetention: .35 }],
    mineFields: [mine], arcRails: [{ distance: 800, length: 120, segments: [{ at: 0, length: 120, side: 1 }] }],
  });
  for (const distance of [40, 240, 510, 810]) {
    const model = createDrivingModel(track);
    Object.assign(model.state, { distance, offset: 15, speed: 160, awakeningCores: 1, charge: 1.5 });
    model.useAwakening(); model.contact();
    advance(model, .5, input({ boost: true, brake: true, steer: 1 }));
    assert.equal(model.state.collisions, 0, `at ${distance}`);
    assert.equal(model.state.penaltyPoints, 0);
    assert.equal(model.state.offTrackExits, 0);
    assert.equal(model.state.charge, 1.5);
    assert.ok(model.state.speed >= 160);
    model.endAwakening(); model.contact();
    assert.equal(model.state.collisions, 1, 'ordinary contact is restored');
    assert.ok(model.state.charge < 1.5);
  }
});

test('expiry inside an obstacle gives manual control a safe altitude and lane', () => {
  const track = road({
    heightObstacles: [{ distance: 500, depth: 100, minAltitude: 4.2, maxAltitude: 5.2, speedRetention: .35 }],
    corridorObstacles: [{ distance: 500, depth: 100, safeCenter: -5, safeHalfWidth: 2.3, speedRetention: .35 }],
  });
  const model = createDrivingModel(track);
  Object.assign(model.state, { distance: 490, offset: 6, speed: 160, awakeningCores: 1 });
  model.useAwakening(); model.state.awakeningRemaining = 1 / 120;
  model.step(1 / 120, input());
  assert.equal(model.state.awakeningRemaining, 0);
  assert.equal(model.state.offset, -5);
  assert.equal(model.state.altitude, 4.7);
  assert.equal(model.state.heading, 0);
  advance(model, .3);
  assert.equal(model.state.collisions, 0, 'no immediate collision after handoff');
});

test('countdown and pause cannot activate or consume cores; pause freezes the effect and finish/restart clear it', () => {
  const race = createTimeAttack(road({ length: 200 }), configuration.performance, records(1), 1, { laps: 1 });
  race.model.state.awakeningCores = 2;
  assert.equal(race.useAwakening(), false);
  race.start(); advance(race, 3, input({ throttle: false }));
  race.model.state.awakeningCores = 2;
  assert.equal(race.useFocus(), true);
  assert.equal(race.useAwakening(), true);
  assert.equal(race.snapshot().focusRemaining, 0);
  assert.equal(race.useFocus(), false);
  advance(race, .3); race.pause();
  const state = { ...race.model.state };
  advance(race, 10);
  assert.deepEqual(race.model.state, state);
  assert.equal(race.useAwakening(), false);
  race.start(); advance(race, 4);
  assert.equal(race.phase, 'finished');
  assert.equal(race.model.state.awakeningRemaining, 0);
  assert.equal(race.model.state.speed, 0);
  assert.equal(race.useAwakening(), false);
  race.restart();
  assert.equal(race.model.state.awakeningCores, 0);
  assert.equal(race.model.state.awakeningsUsed, 0);
});

test('competition contact skips both participants during awakening, including the expiry substep', () => {
  const race = createRaceSession(road(), configuration, records(), 0, 'competition', () => .4);
  race.start(); advance(race, 3, input({ throttle: false }));
  Object.assign(race.model.state, { distance: 100, offset: 0, speed: 100, awakeningCores: 1 });
  race.useAwakening();
  const other = race.rivals[0].controller.model.state;
  Object.assign(other, { distance: 100, offset: 0, speed: 100, altitude: race.model.state.altitude });
  race.rivals.slice(1).forEach((rival, i) => Object.assign(rival.controller.model.state, { distance: 500 + 50 * i, offset: 8 }));
  const before = other.collisions;
  race.model.state.awakeningRemaining = 1 / 120;
  race.step(1 / 120, input());
  assert.equal(race.model.state.awakeningRemaining, 0);
  assert.equal(race.model.state.collisions, 0);
  assert.equal(other.collisions, before, 'ghost pass does not damage the opponent');
});

test('every catalog course offers clear shared-road cores and can be crossed under awakening with every craft', () => {
  for (const definition of TRACK_CATALOG) {
    const track = createCatalogTrack(definition);
    const cores = createAwakeningCores(track);
    assert.ok(cores.length >= 2, `${definition.name}: enough pickups`);
    for (const core of cores) {
      assert.equal(forkAt(track, core.distance), undefined, 'both fork choices can access the core');
      assert.ok(core.distance > 0 && core.distance < track.length);
    }
    for (const { name, configuration: craft } of DRONE_CATALOG) {
      const starts = [0, track.length * .45, ...(track.branches ?? []).map(f => f.start - 50)];
      for (const distance of starts) {
        const model = createDrivingModel(track, craft.performance);
        Object.assign(model.state, { distance, awakeningCores: 1, charge: 1.5 });
        model.useAwakening(); advance(model, 5);
        assert.equal(model.state.awakeningRemaining, 0);
        assert.equal(model.state.collisions, 0, `${definition.name}/${name}`);
        assert.equal(model.state.offTrackExits, 0);
        assert.ok(model.state.distance > distance, `${definition.name}/${name}: forward progress`);
        assert.equal(model.state.speed, craft.performance.boostStage2Speed * 1.05, `${definition.name}/${name}: full speed`);
        assert.ok(Number.isFinite(model.state.distance + model.state.offset + model.state.altitude));
        assert.ok(Math.abs(model.state.offset) < track.halfWidth - 1.7);
      }
    }
  }
});
