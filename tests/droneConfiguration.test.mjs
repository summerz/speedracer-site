import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_DRONE_CONFIGURATION as base, resolveDroneConfiguration } from '../output/test/game/drone/droneConfiguration.js';
import { createDrivingModel, NEUTRAL_INPUT } from '../output/test/game/driving/createDrivingModel.js';

const track = { length: 1200, halfWidth: 11, checkpointSpacing: 100, heightObstacles: [], sample: () => ({ curvature: 0 }) };

test('equipment stacks performance and changes visuals without mutating reusable profiles', () => {
  const original = structuredClone(base);
  const upgraded = resolveDroneConfiguration(base, [
    { performanceMultiplier: { topSpeed: 1.1, acceleration: 1.2, maxYawRate: 1.2, boostDrain: .9 }, speedEffects: { cruiseFovGain: 7 } },
    { performanceMultiplier: { topSpeed: 1.1 }, speedEffects: { boostStreakOpacity: .4 } },
  ]);
  assert.ok(Math.abs(upgraded.performance.topSpeed - base.performance.topSpeed * 1.21) < 1e-8);
  assert.equal(upgraded.performance.boostDrain, base.performance.boostDrain * .9);
  assert.equal(upgraded.speedEffects.cruiseFovGain, 7);
  assert.equal(upgraded.speedEffects.boostStreakOpacity, .4);
  assert.equal(upgraded.speedEffects.baseFov, base.speedEffects.baseFov);
  assert.deepEqual(base, original);
});

test('resolved equipment affects actual acceleration, top speed and steering', () => {
  const upgraded = resolveDroneConfiguration(base, [{ performanceMultiplier: { topSpeed: 1.2, acceleration: 1.5, maxYawRate: 1.5 } }]);
  const normal = createDrivingModel(track, base.performance);
  const faster = createDrivingModel(track, upgraded.performance);
  for (let i = 0; i < 600; i++) {
    normal.step(1 / 60, { ...NEUTRAL_INPUT, throttle: true });
    faster.step(1 / 60, { ...NEUTRAL_INPUT, throttle: true });
  }
  assert.ok(Math.abs(faster.state.speed - upgraded.performance.topSpeed) < .001);
  assert.ok(faster.state.distance > normal.state.distance);
  normal.state.speed = faster.state.speed = 45; // Compare steering upgrades at equal speed.
  normal.step(.1, { ...NEUTRAL_INPUT, steer: 1 });
  faster.step(.1, { ...NEUTRAL_INPUT, steer: 1 });
  assert.ok(faster.state.heading > normal.state.heading);
  faster.reset();
  for (let i = 0; i < 600; i++) faster.step(1 / 60, { ...NEUTRAL_INPUT, throttle: true });
  assert.ok(Math.abs(faster.state.speed - upgraded.performance.topSpeed) < .001, 'restart retains the equipped configuration');
});

test('invalid modifiers are rejected and boost never becomes slower than upgraded cruise speed', () => {
  assert.throws(() => resolveDroneConfiguration(base, [{ performanceMultiplier: { topSpeed: NaN } }]), RangeError);
  assert.throws(() => resolveDroneConfiguration(base, [{ performanceMultiplier: { maxYawRate: -1 } }]), RangeError);
  assert.throws(() => resolveDroneConfiguration(base, [{ speedEffects: { referenceSpeed: 0 } }]), RangeError);
  const upgraded = resolveDroneConfiguration(base, [{ performanceMultiplier: { topSpeed: 2 } }]);
  assert.equal(upgraded.performance.boostSpeed, upgraded.performance.topSpeed);
});
