import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrivingModel, NEUTRAL_INPUT } from '../output/test/game/driving/createDrivingModel.js';
import { DEFAULT_DRONE_CONFIGURATION } from '../output/test/game/drone/droneConfiguration.js';
import { DRONE_CATALOG, droneStats } from '../output/test/game/drone/droneCatalog.js';
import { emptyLevels, upgradedConfiguration } from '../output/test/game/progression/catalog.js';

const straight = { length: 1200, halfWidth: 50, checkpointSpacing: 100, heightObstacles: [], sample: () => ({ curvature: 0 }) };
const controls = steer => ({ ...NEUTRAL_INPUT, throttle: true, steer });
function release(performance, fps = 60, sign = 1) {
  const model = createDrivingModel(straight, performance);
  model.state.speed = 60;
  model.state.heading = .12 * sign;
  for (let tick = 0; tick < fps * .5; tick++) model.step(1 / fps, controls(0));
  return model;
}

test('all five craft have distinct release braking, shown as time to remove 90% of side-slip', () => {
  const drifts = new Map();
  assert.equal(new Set(DRONE_CATALOG.map(c => c.configuration.performance.lateralBraking)).size, 5);
  for (const craft of DRONE_CATALOG) {
    const p = craft.configuration.performance;
    const model = release(p);
    assert.ok(Math.abs(model.state.heading - .12 * Math.exp(-p.lateralBraking * .5)) < 1e-10);
    const stat = droneStats(craft.configuration).find(stat => stat.label === '좌우 제동');
    assert.equal(stat.value, (Math.log(10) / p.lateralBraking).toFixed(2));
    drifts.set(craft.name, model.state.offset);
  }
  const order = ['Catamaran', 'Hammerhead', 'Vanguard', 'Halo', 'Needle'];
  for (let i = 1; i < order.length; i++) assert.ok(drifts.get(order[i]) > drifts.get(order[i - 1]), order[i]);
  assert.ok(drifts.get('Needle') > drifts.get('Catamaran') * 3, 'the distinction is substantial');
});

test('higher lateral braking removes old motion earlier on reverse input without reducing a held turn', () => {
  const base = DEFAULT_DRONE_CONFIGURATION.performance;
  const simulate = (lateralBraking, reverse) => {
    const model = createDrivingModel(straight, { ...base, lateralBraking });
    model.state.speed = 60; model.state.heading = .12;
    let changedAt = null;
    for (let tick = 1; tick <= 60; tick++) {
      model.step(1 / 120, controls(reverse ? -.35 : 1));
      if (model.state.heading <= 0 && changedAt === null) changedAt = tick;
    }
    return { state: model.state, changedAt };
  };
  const sharp = simulate(14, true), sliding = simulate(3, true);
  assert.notEqual(sharp.changedAt, null);
  assert.notEqual(sliding.changedAt, null);
  assert.ok(sharp.changedAt < sliding.changedAt);
  assert.deepEqual(simulate(14, false).state, simulate(3, false).state, 'sustained steering keeps its yaw performance');
});

test('stabilizer upgrades reduce actual drift independently from steering and forward brakes', () => {
  for (const craft of DRONE_CATALOG) {
    const base = craft.configuration;
    const upgraded = upgradedConfiguration(base.id, { ...emptyLevels(), stabilizer: 3 });
    assert.equal(upgraded.performance.lateralBraking, base.performance.lateralBraking * 1.75);
    assert.equal(upgraded.performance.maxYawRate, base.performance.maxYawRate);
    assert.equal(upgraded.performance.braking, base.performance.braking);
    assert.ok(release(upgraded.performance).state.offset < release(base.performance).state.offset * .75);
  }
});

test('release drift is symmetric and identical at 30/60/120 Hz; restart clears residual motion', () => {
  const p = DEFAULT_DRONE_CONFIGURATION.performance;
  const states = [30, 60, 120].map(fps => release(p, fps).state);
  for (const state of states.slice(1)) for (const key of ['heading', 'offset', 'distance', 'speed'])
    assert.ok(Math.abs(state[key] - states[0][key]) < 1e-8, key);
  const left = release(p, 60, -1);
  assert.ok(Math.abs(left.state.offset + states[0].offset) < 1e-8);
  left.reset();
  left.step(.1, controls(0));
  assert.equal(left.state.heading, 0);
  assert.equal(left.state.offset, 0);
});
