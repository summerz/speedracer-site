import test from 'node:test';
import assert from 'node:assert/strict';
import { ALTITUDE_PROFILES, resolveAltitudeProfile } from '../output/test/game/track/altitudeProfile.js';
import { createDrivingModel, NEUTRAL_INPUT } from '../output/test/game/driving/createDrivingModel.js';
import { createTrack } from '../output/test/game/track/createTrack.js';

const straight = { length: 1200, halfWidth: 11, checkpointSpacing: 100, heightObstacles: [], sample: () => ({ curvature: 0 }) };
const finish = model => { for (let i = 0; i < 30; i++) model.step(1 / 120, NEUTRAL_INPUT); };
const tap = (model, lift) => model.step(0, { ...NEUTRAL_INPUT, lift });

for (const [name, profile] of Object.entries(ALTITUDE_PROFILES)) {
  test(`${name}: each tap selects exactly one of ${profile.levels.length} heights and clamps at both ends`, () => {
    const model = createDrivingModel({ ...straight, altitudeProfile: profile });
    tap(model, -1); finish(model);
    assert.equal(model.state.altitudeLevel, 0);
    for (let index = 1; index < profile.levels.length; index++) {
      tap(model, 1);
      assert.equal(model.state.altitudeLevel, index);
      model.step(.1, NEUTRAL_INPUT);
      assert.ok(model.state.altitude > profile.levels[index - 1] && model.state.altitude < profile.levels[index]);
      finish(model);
      assert.equal(model.state.altitude, profile.levels[index]);
    }
    tap(model, 1); finish(model);
    assert.equal(model.state.altitudeLevel, profile.levels.length - 1);
    for (let index = profile.levels.length - 2; index >= 0; index--) {
      tap(model, -1); finish(model);
      assert.equal(model.state.altitudeLevel, index);
      assert.equal(model.state.altitude, profile.levels[index]);
    }
  });
}

test('rapid taps and reversals during transition keep their order, and recovery/reset retain a custom N-level profile', () => {
  const levels = [1.8, 2.5, 3.7, 4.8, 6.2];
  const model = createDrivingModel({ ...straight, altitudeProfile: { levels, initialLevel: 2, transitionSeconds: .2 } });
  levels[2] = 100;
  tap(model, 1); tap(model, 1); tap(model, -1);
  assert.equal(model.state.altitudeLevel, 3);
  assert.equal(model.state.targetAltitude, 4.8);
  finish(model);
  assert.equal(model.state.altitude, 4.8);
  tap(model, 1); model.step(.05, NEUTRAL_INPUT); tap(model, -1); finish(model);
  assert.equal(model.state.altitude, 4.8);
  model.recover();
  assert.equal(model.state.altitudeLevel, 2);
  assert.equal(model.state.altitude, 3.7);
  tap(model, -1); finish(model); model.reset();
  assert.equal(model.state.altitudeLevel, 2);
  assert.equal(model.state.altitude, 3.7);
});

test('unsafe intermediate heights collide while selected safe extremes pass with 3 and 4 levels', () => {
  for (const profile of [ALTITUDE_PROFILES.intermediate, ALTITUDE_PROFILES.advanced]) {
    const obstacle = { distance: 50, depth: 4, kind: 'rise', visual: 'discharge-arcs', speedRetention: .35, minAltitude: 5.2, maxAltitude: 6.2 };
    const model = createDrivingModel({ ...straight, altitudeProfile: profile, heightObstacles: [obstacle] });
    tap(model, 1); finish(model);
    Object.assign(model.state, { distance: 45, speed: 64 });
    model.step(.1, { ...NEUTRAL_INPUT, boost: true });
    assert.equal(model.state.collisions, 1);
    model.reset();
    for (let i = 1; i < profile.levels.length; i++) tap(model, 1);
    for (let i = 0; i < 120; i++) model.step(1 / 120, NEUTRAL_INPUT);
    Object.assign(model.state, { distance: 45, speed: 64 });
    model.step(.1, { ...NEUTRAL_INPUT, boost: true });
    assert.equal(model.state.collisions, 0);
    assert.deepEqual(createTrack(profile).altitudeProfile.levels, profile.levels);
  }
});

test('invalid level ordering, heights, initial index and transition durations are rejected', () => {
  for (const levels of [[], [1.8], [1.8, 1.8], [6.2, 1.8], [0, 6.2], [1.8, NaN], [1.8, Infinity]]) {
    assert.throws(() => resolveAltitudeProfile({ levels, initialLevel: 0, transitionSeconds: .2 }));
  }
  for (const initialLevel of [-1, 2, .5]) assert.throws(() => resolveAltitudeProfile({ levels: [1.8, 6.2], initialLevel, transitionSeconds: .2 }));
  for (const transitionSeconds of [0, -1, NaN]) assert.throws(() => resolveAltitudeProfile({ levels: [1.8, 6.2], initialLevel: 0, transitionSeconds }));
});
