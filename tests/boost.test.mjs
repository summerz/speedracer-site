import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrivingModel, NEUTRAL_INPUT } from '../output/test/game/driving/createDrivingModel.js';
import { DEFAULT_DRONE_CONFIGURATION as base, resolveDroneConfiguration } from '../output/test/game/drone/droneConfiguration.js';

const track = { length: 4000, halfWidth: 11, checkpointSpacing: 100, heightObstacles: [], sample: () => ({ curvature: 0 }) };
const boost = { ...NEUTRAL_INPUT, boost: true };
const advance = (model, seconds, controls = boost, fps = 60) => {
  for (let i = 0; i < Math.round(seconds * fps); i++) model.step(1 / fps, controls);
};

test('continuous boost enters stage 2 at three seconds with consistent 30/60/120 Hz timing', () => {
  const states = [30, 60, 120].map((fps) => {
    const model = createDrivingModel(track);
    advance(model, 2.9, boost, fps);
    assert.equal(model.state.boostStage, 1);
    assert.ok(model.state.speed > base.performance.boostSpeed * .985 && model.state.speed < base.performance.boostSpeed);
    assert.ok(model.state.boostStageProgress > .96 && model.state.boostStageProgress < 1);
    advance(model, .1, boost, fps);
    assert.equal(model.state.boostStage, 2);
    assert.ok(Math.abs(model.state.charge - .4) < 1e-8);
    advance(model, .5, boost, fps);
    assert.ok(model.state.speed > base.performance.boostSpeed && model.state.speed > base.performance.boostStage2Speed * .93 && model.state.speed < base.performance.boostStage2Speed);
    return { ...model.state };
  });
  for (const state of states.slice(1)) {
    for (const key of ['boostElapsed', 'speed', 'charge', 'distance']) assert.ok(Math.abs(state[key] - states[0][key]) < 1e-8, key);
  }
});

test('releasing or braking discards continuous accumulation without refilling the battery', () => {
  for (const interruption of [NEUTRAL_INPUT, { ...boost, brake: true }]) {
    const model = createDrivingModel(track);
    advance(model, 2);
    model.step(1 / 60, interruption);
    assert.equal(model.state.boostStage, 0);
    assert.equal(model.state.boostElapsed, 0);
    assert.equal(model.state.boostStageProgress, 0);
    advance(model, 2);
    assert.equal(model.state.boostStage, 1, 'separate uses cannot add up to stage 2');
    assert.ok(model.state.charge < .21);
  }
});

test('recovery, restart and suspension clear stage and accumulation', () => {
  for (const action of ['recover', 'reset', 'interruptBoost']) {
    const model = createDrivingModel(track);
    advance(model, 3.5);
    const before = model.state.charge;
    model[action]();
    assert.equal(model.state.boostStage, 0);
    assert.equal(model.state.boostElapsed, 0);
    assert.equal(model.state.boostStageProgress, 0);
    assert.equal(model.state.boosting, false);
    assert.equal(model.state.charge, action === 'reset' ? 1 : before);
    model.step(1 / 60, boost);
    assert.equal(model.state.boostStage, 1);
  }
});

test('depletion exits stage 2; recharged boost starts again in stage 1 after releasing', () => {
  const model = createDrivingModel(track);
  advance(model, 5);
  assert.equal(model.state.charge, 0);
  assert.equal(model.state.boostStage, 0);
  assert.equal(model.state.boostNeedsRelease, true);
  advance(model, 8);
  assert.equal(model.state.charge, 1);
  assert.equal(model.state.boostStage, 0);
  model.step(1 / 60, NEUTRAL_INPUT);
  model.step(1 / 60, boost);
  assert.equal(model.state.boostStage, 1);
});

test('equipment controls stage 2 timing, actual speed and palette without changing the base craft', () => {
  const original = structuredClone(base);
  const config = resolveDroneConfiguration(base, [{
    performanceMultiplier: { boostStage2Threshold: .5, boostDrain: .5, boostStage2Speed: 1.1, boostStage2Acceleration: 1.2 },
    speedEffects: { boostStage2FovGain: 6 }, boostStyle: { pulseColor: '#ff99cc', tail: '#9988ff' },
  }]);
  const model = createDrivingModel(track, config.performance);
  assert.ok(Math.abs(model.boostStage2Seconds - 3) < 1e-8);
  advance(model, 4);
  assert.equal(model.state.boostStage, 2);
  assert.ok(model.state.speed > config.performance.boostSpeed && model.state.speed > config.performance.boostStage2Speed * .95 && model.state.speed < config.performance.boostStage2Speed);
  assert.ok(Math.abs(model.state.charge - .6) < 1e-8);
  assert.equal(config.boostStyle.pulseColor, '#ff99cc');
  assert.equal(config.boostStyle.tail, '#9988ff');
  assert.deepEqual(base, original);
});

test('stage configuration rejects unreachable thresholds and keeps speed tiers ordered', () => {
  for (const threshold of [0, -1, 1, 2, NaN]) {
    assert.throws(() => resolveDroneConfiguration({ ...base, performance: { ...base.performance, boostStage2Threshold: threshold } }), RangeError);
  }
  assert.throws(() => resolveDroneConfiguration(base, [{ boostStyle: { pulseColor: 'bogus' } }]), RangeError);
  const config = resolveDroneConfiguration(base, [{ performanceMultiplier: { topSpeed: 2 } }]);
  assert.equal(config.performance.boostStage2Speed, config.performance.boostSpeed);
});


test('stored boost loses a small amount on contacts and departures even without boosting',()=>{
  const model=createDrivingModel(track);model.state.speed=100;
  model.contact();assert.ok(Math.abs(model.state.charge-.98)<1e-8);
  model.reset(); model.state.speed=100;model.state.altitude=5;model.state.offset=track.halfWidth+5;
  model.step(1/120,NEUTRAL_INPUT);
  assert.equal(model.state.offTrackExits,1);assert.ok(Math.abs(model.state.charge-.9625)<.001);
  const charge=model.state.charge;model.step(1/120,NEUTRAL_INPUT);assert.equal(model.state.charge,charge);
});
