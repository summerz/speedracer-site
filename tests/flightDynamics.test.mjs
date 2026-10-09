import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrackFrame } from '../output/test/game/track/createTrack.js';
import { createDrivingModel, NEUTRAL_INPUT } from '../output/test/game/driving/createDrivingModel.js';
import { flightAcceleration, impactSpeedRetention } from '../output/test/game/driving/flightDynamics.js';
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
    assert.equal(model.state.speed, p.crawlSpeed); assert.equal(model.state.charge, 1.5);
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

test('uphill tightens steering and downhill loosens steering for every craft', () => {
  for (const craft of DRONE_CATALOG) {
    const headings = [-.8, 0, .8].map(grade => {
      const model = createDrivingModel(road(() => grade), craft.configuration.performance);
      model.state.speed = 60;
      model.step(1 / 120, input({ steer: .8 }));
      return model.state.heading;
    });
    assert.ok(headings[0] < headings[1] && headings[1] < headings[2], craft.name);
    assert.ok(impactSpeedRetention(craft.configuration.performance.collisionSpeedLoss) < 1 - craft.configuration.performance.collisionSpeedLoss);
  }
});

test('obstacle recovery is slower than craft contact, boost respects it, and reset clears it', () => {
  for (const boost of [false, true]) for (const craft of DRONE_CATALOG) {
    const p = craft.configuration.performance;
    const obstacle = { distance: 50, depth: 4, minAltitude: 5, maxAltitude: 7, speedRetention: .35 };
    const obstacleModel = createDrivingModel({ ...road(), heightObstacles: [obstacle] }, p);
    Object.assign(obstacleModel.state, { distance: 46, speed: 64 });
    obstacleModel.step(1 / 120, input());
    assert.equal(obstacleModel.state.collisions, 1);
    obstacleModel.state.distance = 100;
    const contactModel = createDrivingModel(road(), p); contactModel.contact();
    const clearModel = createDrivingModel(road(), p);
    for (const model of [obstacleModel, contactModel, clearModel]) model.state.speed = 20;
    for (const model of [obstacleModel, contactModel, clearModel]) advance(model, .5, input({ boost }));
    assert.ok(obstacleModel.state.speed < contactModel.state.speed, craft.name);
    assert.ok(contactModel.state.speed < clearModel.state.speed, craft.name);
    obstacleModel.reset(); const fresh = createDrivingModel(road(), p);
    advance(obstacleModel, .1, input({ boost })); advance(fresh, .1, input({ boost }));
    assert.equal(obstacleModel.state.speed, fresh.state.speed);
  }
});

test('boost maneuver load is small, proportional to steering, frame-rate independent, and charged once per altitude tap', () => {
  for (const fps of [30, 60, 120]) {
    const charges = [0, .5, 1].map(steer => {
      const model = createDrivingModel(road()); advance(model, 1, input({ boost: true, steer }), fps);
      return model.state.charge;
    });
    assert.ok(Math.abs(charges[0] - charges[2] - p.boostDrain * .06) < 1e-9);
    assert.ok(Math.abs(charges[0] - charges[1] - p.boostDrain * .03) < 1e-9);
    const lifted = createDrivingModel(road()), flat = createDrivingModel(road());
    lifted.step(1 / fps, input({ boost: true, lift: 1 })); flat.step(1 / fps, input({ boost: true }));
    assert.ok(Math.abs(flat.state.charge - lifted.state.charge - p.boostDrain * .04) < 1e-9);
    lifted.step(1 / fps, input({ boost: true, lift: 1 })); flat.step(1 / fps, input({ boost: true }));
    assert.ok(Math.abs(flat.state.charge - lifted.state.charge - p.boostDrain * .04) < 1e-9, 'upper limit does not charge a second tap');
    const cruise = createDrivingModel(road()); cruise.step(1 / fps, input({ steer: 1, lift: 1 }));
    const idle = createDrivingModel(road()); idle.step(1 / fps, input());
    assert.equal(cruise.state.charge, idle.state.charge, 'ordinary movement has no battery penalty');
  }
});

test('boost incidents remove additional charge, zero charge stops boost, and obstacles charge only once', () => {
  const obstacle = { distance: 50, depth: 4, minAltitude: 5, maxAltitude: 7, speedRetention: .35 };
  for (const fps of [30, 60, 120]) {
    const clear = createDrivingModel(road()), hit = createDrivingModel({ ...road(), heightObstacles: [obstacle] });
    for (const model of [clear, hit]) Object.assign(model.state, { distance: 46, speed: 64 });
    for (const model of [clear, hit]) model.step(1 / fps, input({ boost: true }));
    assert.equal(hit.state.collisions, 1);
    assert.ok(Math.abs(clear.state.charge - hit.state.charge - .18) < 1e-9);
    for (const model of [clear, hit]) model.step(1 / fps, input({ boost: true }));
    assert.ok(Math.abs(clear.state.charge - hit.state.charge - .18) < 1e-9);
    const contact = createDrivingModel(road()); contact.step(1 / fps, input({ boost: true }));
    const before = contact.state.charge; contact.contact();
    assert.ok(Math.abs(before - contact.state.charge - .08) < 1e-9);
    contact.state.charge = .04; contact.contact();
    assert.equal(contact.state.charge, 0); assert.equal(contact.state.boosting, false);
    assert.equal(contact.state.boostNeedsRelease, true);
    contact.reset(); contact.contact(); assert.equal(contact.state.charge, .98);
    for (const [offset, penalty, notice] of [[12, .15, 'off-track'], [9, .1, 'collision']]) {
      const model = createDrivingModel({ ...road(), halfWidth: 10 });
      Object.assign(model.state, { offset, speed: 64 });
      model.step(1 / fps, input({ boost: true }));
      assert.equal(model.state.notice, notice);
      assert.ok(Math.abs(1 - p.boostDrain / fps - penalty - model.state.charge) < 1e-9);
    }
  }
});

test('instant altitude key taps cost boost only for a valid unbraked level change', () => {
  const model = createDrivingModel(road());
  model.step(0, input({ boost: true, lift: 1 }));
  assert.equal(model.state.charge, 1 - p.boostDrain * .04);
  model.step(0, input({ boost: true, lift: 1 }));
  assert.equal(model.state.charge, 1 - p.boostDrain * .04, 'level limit ignores redundant taps');
  model.step(0, input({ boost: true, brake: true, lift: -1 }));
  assert.equal(model.state.charge, 1 - p.boostDrain * .04, 'braking suppresses boost load');
  model.state.charge = .004;
  model.step(0, input({ boost: true, lift: 1 }));
  assert.equal(model.state.charge, 0);
  assert.equal(model.state.boostNeedsRelease, true);
});
