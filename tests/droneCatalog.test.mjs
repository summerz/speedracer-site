import test from 'node:test';
import assert from 'node:assert/strict';
import { DRONE_CATALOG, droneStats } from '../output/test/game/drone/droneCatalog.js';
import { resolveDroneConfiguration } from '../output/test/game/drone/droneConfiguration.js';
import { createDrivingModel, NEUTRAL_INPUT, steeringYawRate } from '../output/test/game/driving/createDrivingModel.js';

const track = { length: 1200, halfWidth: 11, checkpointSpacing: 100, heightObstacles: [], sample: () => ({ curvature: 0 }) };
const get = (name) => DRONE_CATALOG.find(craft => craft.name === name).configuration;

test('all five aircraft reach the shown cruise and boost speeds; restart retains their tuning', () => {
  assert.equal(new Set(DRONE_CATALOG.map(craft => craft.configuration.modelVariant)).size, 5);
  for (const craft of DRONE_CATALOG) {
    const config = resolveDroneConfiguration(craft.configuration);
    const model = createDrivingModel(track, config.performance);
    for (let i = 0; i < 300; i++) model.step(1 / 60, { ...NEUTRAL_INPUT, throttle: true });
    assert.equal(model.state.speed, config.performance.topSpeed);
    assert.equal(droneStats(config)[1].value, (model.state.speed * 3.6).toFixed(0));
    for (let i = 0; i < 220; i++) model.step(1 / 60, { ...NEUTRAL_INPUT, throttle: true, boost: true });
    assert.equal(model.state.speed, config.performance.boostStage2Speed);
    model.reset(); model.step(.1, { ...NEUTRAL_INPUT, throttle: true });
    assert.ok(Math.abs(model.state.speed - config.performance.acceleration * .1) < 1e-8);
  }
});

test('Halo accelerates faster, Needle cruises faster, Catamaran steers faster at cruise and boost', () => {
  const vanguard = get('Vanguard').performance;
  const halo = createDrivingModel(track, get('Halo').performance);
  const balanced = createDrivingModel(track, vanguard);
  halo.step(.1, { ...NEUTRAL_INPUT, throttle: true }); balanced.step(.1, { ...NEUTRAL_INPUT, throttle: true });
  assert.ok(halo.state.speed > balanced.state.speed);
  assert.ok(get('Needle').performance.topSpeed > get('Halo').performance.topSpeed);
  for (const speed of [60, 125, 155]) assert.ok(steeringYawRate(speed, get('Catamaran').performance) > steeringYawRate(speed, vanguard));
});

test('wall loss matches the display and electric-field severity respects craft resistance', () => {
  const electric = { ...track, heightObstacles: [{ id: 0, distance: 5, depth: 4, minAltitude: 4, maxAltitude: 7, speedRetention: .35 }] };
  const losses = [];
  for (const craft of DRONE_CATALOG) {
    const p = craft.configuration.performance;
    const model = createDrivingModel(track, p);
    model.state.speed = 60; model.state.offset = 9.6;
    model.step(1 / 120, { ...NEUTRAL_INPUT, steer: 1 });
    assert.equal(model.state.collisions, 1);
    assert.ok(Math.abs(model.state.speed / (60 - 5 / 120) - (1 - p.collisionSpeedLoss)) < 1e-8);
    assert.equal(droneStats(craft.configuration)[3].value, (p.collisionSpeedLoss * 100).toFixed(0));
    const field = createDrivingModel(electric, p); field.state.speed = 60; field.step(.1, NEUTRAL_INPUT);
    assert.equal(field.state.collisions, 1);
    losses.push([craft.name, field.state.speed]);
  }
  assert.ok(losses.find(([name]) => name === 'Hammerhead')[1] > losses.find(([name]) => name === 'Needle')[1]);
  assert.throws(() => resolveDroneConfiguration(get('Vanguard'), [{ performanceMultiplier: { collisionSpeedLoss: 3 } }]), RangeError);
  const upgraded = resolveDroneConfiguration(get('Hammerhead'), [{ performanceMultiplier: { collisionSpeedLoss: .9 } }]);
  assert.ok(Number(droneStats(upgraded)[3].value) < Number(droneStats(get('Hammerhead'))[3].value));
});
