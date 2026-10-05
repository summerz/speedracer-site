import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrackFrame } from '../output/test/game/track/createTrack.js';
import { createDrivingModel, NEUTRAL_INPUT } from '../output/test/game/driving/createDrivingModel.js';
import { flightAcceleration } from '../output/test/game/driving/flightDynamics.js';
import { DEFAULT_DRONE_CONFIGURATION as base, resolveDroneConfiguration } from '../output/test/game/drone/droneConfiguration.js';
import { DRONE_CATALOG } from '../output/test/game/drone/droneCatalog.js';
import { upgradedConfiguration, emptyLevels } from '../output/test/game/progression/catalog.js';

const p = base.performance;
const input = (values = {}) => ({ ...NEUTRAL_INPUT, throttle: true, ...values });
const loads = (values = {}) => ({ grade: 0, curvature: 0, steer: 0, altitudeSpeed: 0, ...values });
function road(gradeAt = () => 0, verticalCurve = 0) {
  return {
    length: 100000, halfWidth: 100000, checkpointSpacing: 100, heightObstacles: [],
    sample(distance, frame = createTrackFrame()) {
      const grade = verticalCurve ? Math.sin(distance * verticalCurve) : gradeAt(distance);
      frame.tangent.set(0, grade, verticalCurve ? Math.cos(distance * verticalCurve) : Math.sqrt(1 - grade ** 2));
      frame.right.set(1, 0, 0); frame.up.crossVectors(frame.tangent, frame.right);
      frame.curvature = 0; // A vertical loop has no lateral bend.
      return frame;
    },
  };
}
function advance(model, seconds, controls = input(), fps = 120) {
  for (let i = 0; i < Math.round(seconds * fps); i++) model.step(1 / fps, controls);
}

test('flat cruise settles at the catalog speed; uphill slows and downhill overspeeds with no impact', () => {
  const speeds = [-1, 0, 1].map(grade => {
    const model = createDrivingModel(road(() => grade)); advance(model, 12);
    assert.equal(model.state.collisions, 0);
    assert.equal(model.state.offTrackExits, 0);
    const equilibrium = p.topSpeed * Math.sqrt(1 - 18 * grade * p.slopeSensitivity / (2 * p.acceleration));
    assert.ok(Math.abs(model.state.speed - equilibrium) < .001);
    return model.state.speed;
  });
  assert.ok(speeds[0] > p.topSpeed + 7);
  assert.ok(speeds[2] < p.topSpeed - 7);
  assert.ok(speeds[0] <= p.topSpeed * (1 + p.downhillOverspeed));
});

test('a crest changes speed continuously and a straight recovers speed after the climb', () => {
  let grade = .8;
  const model = createDrivingModel(road(() => grade)); advance(model, 8);
  const uphill = model.state.speed;
  grade = -.8; model.step(1 / 120, input());
  assert.ok(model.state.speed > uphill && model.state.speed - uphill < .3);
  advance(model, 8); const downhill = model.state.speed;
  grade = 0; advance(model, 8);
  assert.ok(downhill > p.topSpeed);
  assert.ok(Math.abs(model.state.speed - p.topSpeed) < .001);
});

test('corner load grows with speed; left/right steering costs match and straightening restores thrust', () => {
  const acceleration = (speed, values) => flightAcceleration(speed, p.topSpeed, p.acceleration, p, loads(values));
  const cornerLoss = speed => acceleration(speed, {}) - acceleration(speed, { curvature: .004 });
  assert.ok(Math.abs(cornerLoss(80) / cornerLoss(40) - 4) < 1e-10);
  assert.equal(acceleration(80, { steer: 1 }), acceleration(80, { steer: -1 }));
  assert.ok(acceleration(80, { steer: 1 }) < acceleration(80, {}));
  const model = createDrivingModel(road()); model.state.speed = p.topSpeed;
  advance(model, .5, input({ steer: 1 })); const steered = model.state.speed;
  assert.ok(steered < p.topSpeed - 1);
  advance(model, 4); assert.ok(model.state.speed > steered + 1);
  assert.equal(model.state.collisions, 0);
});

test('altitude switching has a brief load which disappears when the target level is reached', () => {
  const model = createDrivingModel(road()); model.state.speed = p.topSpeed;
  model.step(1 / 120, input({ lift: 1 })); advance(model, .08);
  assert.ok(model.state.altitude < model.state.targetAltitude);
  assert.ok(model.state.speed < p.topSpeed - .2);
  advance(model, 4);
  assert.equal(model.state.altitude, model.state.targetAltitude);
  assert.ok(Math.abs(model.state.speed - p.topSpeed) < .001);
});

test('full 3D loops change speed even without steering and never stall under full throttle', () => {
  for (const craft of DRONE_CATALOG) {
    const model = createDrivingModel(road(() => 0, .012), craft.configuration.performance);
    model.state.speed = craft.configuration.performance.topSpeed;
    const speeds = [];
    for (let i = 0; i < 120 * 20; i++) { model.step(1 / 120, input()); speeds.push(model.state.speed); }
    assert.ok(Math.max(...speeds) - Math.min(...speeds) > 10, craft.name);
    assert.ok(Math.min(...speeds) > 30, craft.name);
    assert.equal(model.state.heading, 0);
    assert.equal(model.state.collisions, 0);
  }
});

test('craft load retention differs, and engine/steering upgrades reduce the matching losses', () => {
  const craft = name => DRONE_CATALOG.find(craft => craft.name === name).configuration;
  const loss = (configuration, values) => {
    const tuning = configuration.performance;
    return flightAcceleration(70, 85, 46, tuning, loads()) - flightAcceleration(70, 85, 46, tuning, loads(values));
  };
  assert.ok(loss(craft('Hammerhead'), { grade: .8 }) < loss(craft('Needle'), { grade: .8 }));
  assert.ok(loss(craft('Catamaran'), { curvature: .006, steer: .8 }) < loss(craft('Needle'), { curvature: .006, steer: .8 }));
  const upgraded = upgradedConfiguration(base.id, { ...emptyLevels(), engine: 3, steering: 3 });
  assert.ok(loss(upgraded, { grade: .8 }) < loss(base, { grade: .8 }));
  assert.ok(loss(upgraded, { curvature: .006, steer: .8 }) < loss(base, { curvature: .006, steer: .8 }));
  const stock = createDrivingModel(road(() => .8)), tuned = createDrivingModel(road(() => .8), upgraded.performance);
  advance(stock, 10); advance(tuned, 10);
  assert.ok(tuned.state.speed > stock.state.speed + 8);
  assert.throws(() => resolveDroneConfiguration(base, [{ performanceMultiplier: { downhillOverspeed: 3 } }]), RangeError);
});

test('boost tiers and item speed scaling retain grade effects, bounded overspeed and smooth release', () => {
  const limited = createDrivingModel(road(() => -1)); advance(limited, 12, input({ targetSpeedScale: .5 }));
  assert.ok(limited.state.speed > p.topSpeed * .5 && limited.state.speed <= p.topSpeed * .5 * (1 + p.downhillOverspeed));
  const racer = createDrivingModel(road(() => -.6)); racer.state.speed = p.topSpeed;
  advance(racer, 2.9, input({ boost: true })); const stage1 = racer.state.speed;
  advance(racer, 1.5, input({ boost: true }));
  assert.equal(racer.state.boostStage, 2);
  assert.ok(racer.state.speed > stage1 + 20);
  assert.ok(racer.state.speed <= p.boostStage2Speed * (1 + p.downhillOverspeed));
  const before = racer.state.speed; racer.step(1 / 120, input());
  assert.ok(racer.state.speed < before && before - racer.state.speed < 2);
  advance(racer, 8); assert.ok(racer.state.speed > p.topSpeed && racer.state.speed <= p.topSpeed * (1 + p.downhillOverspeed));
});

test('braking still crawls uphill/downhill and 30/60/120 Hz agree through 3D bends', () => {
  for (const grade of [-1, 1]) {
    const model = createDrivingModel(road(() => grade)); advance(model, 4, input({ brake: true, boost: true }));
    assert.equal(model.state.speed, p.crawlSpeed); assert.equal(model.state.charge, 1);
    const distance = model.state.distance; advance(model, 1, input({ brake: true }));
    assert.ok(Math.abs(model.state.distance - distance - p.crawlSpeed) < 1e-8);
  }
  const states = [30, 60, 120].map(fps => {
    const model = createDrivingModel(road(() => 0, .012));
    advance(model, 4, input(), fps); advance(model, 4, input({ boost: true }), fps);
    return model.state;
  });
  for (const state of states.slice(1)) for (const key of ['speed', 'distance', 'charge']) assert.ok(Math.abs(state[key] - states[0][key]) < 1e-7, key);
});
