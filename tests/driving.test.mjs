import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrivingModel, DRIVING_TUNING as tuning, NEUTRAL_INPUT, steeringYawRate } from '../output/test/game/driving/createDrivingModel.js';
import { createTrack, createTrackFrame, upcomingHeightObstacle } from '../output/test/game/track/createTrack.js';

const straight = { length: 1200, halfWidth: 11, checkpointSpacing: 100, heightObstacles: [], sample: () => ({ curvature: 0 }) };
const input = (overrides = {}) => ({ ...NEUTRAL_INPUT, ...overrides });
const advance = (model, seconds, controls, fps = 60) => {
  for (let i = 0; i < Math.round(seconds * fps); i++) model.step(1 / fps, controls);
};

test('30, 60 and 120 Hz produce the same acceleration, travel and boost charge', () => {
  const states = [30, 60, 120].map((fps) => {
    const model = createDrivingModel(straight);
    advance(model, 2, input({ throttle: true }), fps);
    advance(model, 2, input({ throttle: true, boost: true }), fps);
    advance(model, 3, input({ brake: true }), fps);
    return { ...model.state };
  });
  for (const state of states.slice(1)) {
    for (const key of ['distance', 'speed', 'charge', 'elapsed']) assert.ok(Math.abs(state[key] - states[0][key]) < 1e-7, key);
  }
});

test('coasting loses speed and a held brake keeps crawling forward', () => {
  const model = createDrivingModel(straight);
  advance(model, 3, input({ throttle: true }));
  assert.ok(model.state.speed > tuning.topSpeed * .99 && model.state.speed < tuning.topSpeed);
  advance(model, 1, input());
  assert.ok(model.state.speed < tuning.topSpeed && model.state.speed > 0);
  advance(model, 3, input({ brake: true }));
  assert.equal(model.state.speed, tuning.crawlSpeed);
  const distance = model.state.distance;
  advance(model, 2, input({ brake: true }));
  assert.ok(Math.abs(model.state.distance - distance - tuning.crawlSpeed * 2) < 1e-7);
});

test('holding boost after depletion cannot repeatedly trigger recharged boost', () => {
  const model = createDrivingModel(straight);
  advance(model, 4.5, input({ boost: true }));
  assert.ok(model.state.speed > tuning.boostStage2Speed * .99 && model.state.speed < tuning.boostStage2Speed);
  assert.ok(model.state.boosting && model.state.charge < 0.11);
  advance(model, 9, input({ boost: true }));
  assert.equal(model.state.boosting, false);
  assert.equal(model.state.boostNeedsRelease, true);
  assert.equal(model.state.charge, 1);
  assert.ok(model.state.speed <= tuning.topSpeed);
  model.step(1 / 60, input());
  assert.equal(model.state.boostNeedsRelease, false);
  model.step(1 / 60, input({ boost: true }));
  assert.equal(model.state.boosting, true);
  assert.ok(model.state.charge < 1);
});

test('brake takes priority over throttle and boost without draining charge', () => {
  const model = createDrivingModel(straight);
  advance(model, 3, input({ throttle: true }));
  const before = model.state.speed;
  advance(model, .5, input({ throttle: true, brake: true, boost: true }));
  assert.ok(model.state.speed < before);
  assert.equal(model.state.charge, 1);
  assert.equal(model.state.boosting, false);
});

test('one height command finishes a rapid transition after the key is released', () => {
  const model = createDrivingModel(straight);
  model.step(1 / 120, input({ lift: 1 }));
  assert.ok(model.state.altitude > tuning.minAltitude && model.state.altitude < tuning.maxAltitude);
  advance(model, .2, input());
  assert.equal(model.state.altitude, tuning.maxAltitude);
  assert.equal(model.state.targetAltitude, tuning.maxAltitude);
  advance(model, .5, input());
  assert.equal(model.state.altitude, tuning.maxAltitude);
  model.step(1 / 120, input({ lift: -1 }));
  advance(model, .2, input());
  assert.equal(model.state.altitude, tuning.minAltitude);
  advance(model, 3, input({ throttle: true, lift: -1 }));
  assert.equal(model.state.altitude, tuning.minAltitude);
  assert.ok(model.state.distance > 80);
});

test('a fast low-altitude wall crossing is contained and slows the craft', () => {
  const model = createDrivingModel(straight);
  Object.assign(model.state, { speed: 64, offset: 9.3, heading: 1 });
  model.step(.1, input({ throttle: true }));
  assert.ok(Math.abs(model.state.offset) <= straight.halfWidth - tuning.craftHalfWidth);
  assert.ok(model.state.speed < 45);
  assert.equal(model.state.collisions, 1);
  assert.equal(model.state.recoveries, 0);
  assert.equal(model.state.notice, 'collision');
});

test('a departure preserves forward progress and charges one penalty per excursion', () => {
  const model = createDrivingModel(straight);
  Object.assign(model.state, { distance: 298, checkpoint: 200, speed: 64, offset: 14.9, heading: 1, altitude: 4.8, targetAltitude: 4.8 });
  model.step(.1, input());
  assert.equal(model.state.recoveries, 0);
  assert.ok(model.state.distance > 298);
  assert.ok(model.state.speed > 0 && model.state.speed < 64);
  assert.equal(model.state.altitude, 4.8);
  assert.equal(model.state.offTrackExits, 1);
  assert.equal(model.state.penaltyPoints, 7);
  assert.equal(model.state.notice, 'off-track');
  for (let n = 0; n < 5; n++) {
    model.state.offset = 15;
    model.step(1 / 120, input());
  }
  assert.equal(model.state.penaltyPoints, 7, 'remaining outside cannot charge every frame');
  model.state.offset = 0;
  model.step(1 / 120, input());
  model.state.offset = -15;
  model.step(1 / 120, input());
  assert.equal(model.state.offTrackExits, 2);
  assert.equal(model.state.penaltyPoints, 14);
  model.reset();
  assert.equal(model.state.penaltyPoints, 0);
  assert.equal(model.state.offTrackExits, 0);
});

test('forward checkpoint crossings near the edge are accepted without recovery', () => {
  const model = createDrivingModel(straight);
  Object.assign(model.state, { distance: 99, speed: 44, altitude: 4.8, targetAltitude: 4.8, offset: 12 });
  model.step(.1, input({ throttle: true }));
  assert.ok(model.state.distance > 100);
  assert.equal(model.state.checkpoint, 100);
  assert.equal(model.state.recoveries, 0);
});

test('long blocked frames are capped and restarting clears the complete session', () => {
  const model = createDrivingModel(straight);
  model.step(10, input({ throttle: true, boost: true }));
  assert.ok(model.state.elapsed <= .101);
  model.recover();
  model.reset();
  assert.deepEqual(model.state, createDrivingModel(straight).state);
  model.step(.1, input({ boost: true }));
  assert.equal(model.state.boosting, true);
});

test('the loop joins continuously and every corner leaves room for the road width', () => {
  const track = createTrack();
  const start = track.sample(0);
  const end = track.sample(track.length);
  assert.ok(start.position.distanceTo(end.position) < 1e-7);
  assert.ok(start.tangent.distanceTo(end.tangent) < 1e-7);
  let maxCurvature = 0;
  let minHeight = Infinity;
  let maxHeight = -Infinity;
  const frame = createTrackFrame();
  for (let d = 0; d < track.length; d += .5) {
    track.sample(d, frame);
    maxCurvature = Math.max(maxCurvature, Math.abs(frame.curvature));
    minHeight = Math.min(minHeight, frame.position.y);
    maxHeight = Math.max(maxHeight, frame.position.y);
  }
  assert.ok(1 / maxCurvature > track.halfWidth * 1.2);
  assert.ok(maxHeight - minHeight > 15);
  assert.ok(track.sample(-1).position.distanceTo(track.sample(track.length - 1).position) < 1e-7);
});

test('steering, braking and height changes complete a lap through every obstacle', () => {
  const track = createTrack();
  const model = createDrivingModel(track);
  for (let n = 0; n < 60 * 90 && model.state.distance < track.length; n++) {
    const s = model.state;
    const curvature = track.sample(s.distance).curvature;
    const ahead = track.sample(s.distance + 22).curvature;
    const target = Math.min(tuning.topSpeed, .75 / Math.max(.01, Math.abs(curvature), Math.abs(ahead)));
    const yawRate = steeringYawRate(s.speed, tuning);
    const steer = (curvature * s.speed - s.heading * 1.8 - s.offset * .07) / Math.max(.1, yawRate);
    const next = upcomingHeightObstacle(track, s.distance);
    const desiredHeight = next.obstacle.kind === 'rise' ? tuning.maxAltitude : tuning.minAltitude;
    const lift = Math.sign(desiredHeight - s.targetAltitude);
    model.step(1 / 60, input({ throttle: s.speed < target, brake: s.speed > target + 2, steer, lift }));
  }
  assert.ok(model.state.distance >= track.length, 'lap completed');
  assert.ok(Math.abs(model.state.checkpoint - track.length) < 1e-7, 'all recovery checkpoints crossed');
  assert.equal(model.state.collisions, 0);
  assert.equal(model.state.recoveries, 0);
});

for (const kind of ['rise', 'descend']) {
  test(`${kind} field reduces speed once per passage while allowing continued travel`, () => {
    const obstacle = { distance: 50, depth: 4, kind, visual: 'discharge-arcs', speedRetention: .35,
      minAltitude: kind === 'rise' ? 5.2 : tuning.minAltitude, maxAltitude: kind === 'rise' ? tuning.maxAltitude : 2.7 };
    const track = { ...straight, heightObstacles: [obstacle] };
    const model = createDrivingModel(track);
    const wrongHeight = kind === 'rise' ? tuning.minAltitude : tuning.maxAltitude;
    Object.assign(model.state, { distance: 45, speed: 64, altitude: wrongHeight, targetAltitude: wrongHeight });
    model.step(.1, input({ throttle: true, boost: true }));
    assert.ok(model.state.distance > 45.8, 'passes into the field');
    assert.ok(model.state.speed > 64 * .2 && model.state.speed < 64 * .4, 'substantial speed loss without stopping');
    assert.equal(model.state.notice, 'height-collision');
    assert.equal(model.state.collisions, 1);
    advance(model, .5, input({ throttle: true }));
    assert.ok(model.state.distance > 54.2, 'clears the field');
    assert.equal(model.state.collisions, 1, 'no repeated penalty inside the volume');
    assert.equal(model.state.recoveries, 0);
    Object.assign(model.state, { distance: track.length + 45, speed: 64 });
    model.step(.1, input({ boost: true }));
    assert.equal(model.state.collisions, 2, 'same field can hit again next lap');

    model.reset();
    model.step(1 / 120, input({ lift: kind === 'rise' ? 1 : -1 }));
    advance(model, .2, input());
    Object.assign(model.state, { distance: 45, speed: 64 });
    advance(model, .3, input({ boost: true }));
    assert.ok(model.state.distance > 54.2);
    assert.equal(model.state.collisions, 0, 'correct height avoids the penalty');
  });
}

test('height obstacles still apply on a second lap and a fixed height cannot clear both types', () => {
  const track = createTrack();
  const rises = track.heightObstacles.filter(o => o.kind === 'rise');
  const descents = track.heightObstacles.filter(o => o.kind === 'descend');
  assert.ok(Math.min(...rises.map(o => o.minAltitude)) > Math.max(...descents.map(o => o.maxAltitude)));
  const model = createDrivingModel(track);
  const first = track.heightObstacles[0];
  Object.assign(model.state, { distance: track.length + first.distance - 5, speed: 64 });
  model.step(.1, input({ boost: true }));
  assert.equal(model.state.notice, 'height-collision');
  assert.ok(model.state.distance < track.length + first.distance);
});

test('holding the brake from rest accelerates smoothly to crawl without boost or reverse travel', () => {
  const model = createDrivingModel(straight);
  model.step(1 / 120, input({ brake: true, boost: true }));
  assert.ok(model.state.speed > 0 && model.state.speed < tuning.crawlSpeed);
  advance(model, 2, input({ brake: true, boost: true }));
  assert.equal(model.state.speed, tuning.crawlSpeed);
  assert.equal(model.state.boostStage, 0);
  assert.equal(model.state.charge, 1);
});

test('boost speeds increase lateral travel for the same steering input', () => {
  const responses = [tuning.topSpeed, tuning.boostSpeed, tuning.boostStage2Speed].map(speed => {
    const model = createDrivingModel({ ...straight, halfWidth: 100 });
    model.state.speed = speed;
    advance(model, .25, input({ steer: .4 }));
    return model.state.offset;
  });
  assert.ok(responses[1] > responses[0] * 1.05);
  assert.ok(responses[2] > responses[1]);
});


test('direct altitude targets skip intermediate levels, move smoothly and survive boost release', () => {
  for (const levels of [[1.8, 4, 6.2], [1.8, 3.2, 4.7, 6.2]]) {
    const model = createDrivingModel({ ...straight, altitudeProfile: { levels, initialLevel: 0, transitionSeconds: .2 } });
    model.step(0, input({ boost: true, targetAltitudeLevel: levels.length - 1 }));
    assert.equal(model.state.altitudeLevel, levels.length - 1);
    assert.equal(model.state.altitude, levels[0], 'selection must not teleport');
    assert.equal(model.state.targetAltitude, levels.at(-1));
    const charge = model.state.charge;
    model.step(0, input({ boost: true, targetAltitudeLevel: levels.length - 1 }));
    assert.equal(model.state.charge, charge, 'holding a selected level cannot keep charging a surcharge');
    advance(model, .2, input());
    assert.equal(model.state.altitude, levels.at(-1));
    advance(model, .2, input());
    assert.equal(model.state.altitudeLevel, levels.length - 1);
    model.step(0, input({ targetAltitudeLevel: 0 }));
    advance(model, .2, input());
    assert.equal(model.state.altitude, levels[0]);
  }
});

test('changing an altitude target during a transition completes the remaining travel promptly', () => {
  const levels = [1.8, 3.2, 4.7, 6.2];
  const model = createDrivingModel({ ...straight, altitudeProfile: { levels, initialLevel: 0, transitionSeconds: .2 } });
  model.step(0, input({ targetAltitudeLevel: 3 }));
  advance(model, .05, input());
  model.step(0, input({ targetAltitudeLevel: 2 }));
  advance(model, .2, input());
  assert.equal(model.state.altitude, levels[2]);
  model.step(0, input({ targetAltitudeLevel: -100 }));
  assert.equal(model.state.altitudeLevel, 0);
  model.step(0, input({ targetAltitudeLevel: 100 }));
  assert.equal(model.state.altitudeLevel, 3);
  model.step(0, input({ targetAltitudeLevel: NaN }));
  assert.equal(model.state.altitudeLevel, 3);
});

test('a boost pad refills charge and adds speed once per lap, only for a craft inside its lane', () => {
  const pad = { distance: 300, lane: 'right', center: 6.4, width: 5.5, length: 14 };
  const track = { ...straight, boostPads: [pad] };
  const cross = (model, offset, from) => {
    Object.assign(model.state, { distance: from, offset, speed: 40, charge: .3 });
    const before = model.state.boostPads;
    for (let i = 0; i < 600 && model.state.distance < from + 40; i++) model.step(1 / 120, input({ throttle: true }));
    return model.state.boostPads - before;
  };
  const speedAfter = offset => { // charge and speed on the very step that crosses the pad
    const model = createDrivingModel(track); Object.assign(model.state, { distance: 290, offset, speed: 40, charge: .3 });
    let before;
    while (model.state.distance < 330) { before = { speed: model.state.speed, charge: model.state.charge, pads: model.state.boostPads }; model.step(1 / 120, input()); if (model.state.boostPads > before.pads) break; }
    return { before, state: model.state };
  };
  const hit = speedAfter(6.4);
  assert.equal(hit.state.boostPads, 1);
  assert.ok(Math.abs(hit.state.charge - hit.before.charge - .35) < .01 && hit.state.speed - hit.before.speed > 17, `${hit.before.charge}->${hit.state.charge}`);
  assert.equal(speedAfter(0).state.boostPads, 0);
  assert.equal(speedAfter(6.4 + 2.76).state.boostPads, 0);
  const model = createDrivingModel(track);
  assert.equal(cross(model, 0, 290), 0);
  assert.equal(cross(model, 6.4, 290), 1);
  assert.equal(cross(model, 6.4, 290), 0, 'same lap');
  assert.equal(cross(model, 6.4, 1200 + 290), 1, 'next lap');
  assert.equal(cross(model, 6.4, 1200 + 290), 0);
});
