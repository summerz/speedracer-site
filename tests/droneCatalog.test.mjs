import test from 'node:test';
import assert from 'node:assert/strict';
import { DRONE_CATALOG, droneStats } from '../output/test/game/drone/droneCatalog.js';
import { flightAcceleration } from '../output/test/game/driving/flightDynamics.js';
import { resolveDroneConfiguration } from '../output/test/game/drone/droneConfiguration.js';
import { createDrivingModel, NEUTRAL_INPUT, steeringYawRate } from '../output/test/game/driving/createDrivingModel.js';

const track = { length: 1200, halfWidth: 11, checkpointSpacing: 100, heightObstacles: [], sample: () => ({ curvature: 0 }) };
const get = (name) => DRONE_CATALOG.find(craft => craft.name === name).configuration;

test('all five aircraft settle at the shown cruise speed and approach stage 2 speed; restart retains their tuning', () => {
  assert.equal(new Set(DRONE_CATALOG.map(craft => craft.configuration.modelVariant)).size, 5);
  for (const craft of DRONE_CATALOG) {
    const config = resolveDroneConfiguration(craft.configuration);
    const model = createDrivingModel(track, config.performance);
    for (let i = 0; i < 600; i++) model.step(1 / 60, { ...NEUTRAL_INPUT, throttle: true });
    assert.ok(Math.abs(model.state.speed - config.performance.topSpeed) < .001);
    assert.equal(droneStats(config)[1].value, (model.state.speed * 3.6).toFixed(0));
    for (let i = 0; i < 220; i++) model.step(1 / 60, { ...NEUTRAL_INPUT, throttle: true, boost: true });
    assert.ok(model.state.speed > config.performance.boostStage2Speed * .94 && model.state.speed < config.performance.boostStage2Speed);
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
    const acceleration = flightAcceleration(60, p.topSpeed, 0, p, { grade: 0, curvature: 0, steer: 1, altitudeSpeed: 0 });
    assert.ok(Math.abs(model.state.speed / (60 + acceleration / 120) - (1 - p.collisionSpeedLoss)) < 1e-8);
    assert.equal(droneStats(craft.configuration).find(stat => stat.label === '충돌 감속').value, (p.collisionSpeedLoss * 100).toFixed(0));
    const field = createDrivingModel(electric, p); field.state.speed = 60; field.step(.1, NEUTRAL_INPUT);
    assert.equal(field.state.collisions, 1);
    losses.push([craft.name, field.state.speed]);
  }
  assert.ok(losses.find(([name]) => name === 'Hammerhead')[1] > losses.find(([name]) => name === 'Needle')[1]);
  assert.throws(() => resolveDroneConfiguration(get('Vanguard'), [{ performanceMultiplier: { collisionSpeedLoss: 3 } }]), RangeError);
  const upgraded = resolveDroneConfiguration(get('Hammerhead'), [{ performanceMultiplier: { collisionSpeedLoss: .9 } }]);
  assert.ok(Number(droneStats(upgraded).find(stat => stat.label === '충돌 감속').value) < Number(droneStats(get('Hammerhead')).find(stat => stat.label === '충돌 감속').value));
});
