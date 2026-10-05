import test from 'node:test';
import assert from 'node:assert/strict';
import { createRaceSoundFeedback } from '../output/test/game/driving/createRaceSoundFeedback.js';
import { createDrivingModel, NEUTRAL_INPUT } from '../output/test/game/driving/createDrivingModel.js';

const obstacle = { distance: 300, depth: 4, minAltitude: 5, maxAltitude: 7 };
const track = { length: 10000, halfWidth: 20, checkpointSpacing: 100, heightObstacles: [obstacle], sample: () => ({ curvature: 0 }) };
const state = (values = {}) => ({ collisions: 0, offTrackExits: 0, charge: 1, boosting: false, distance: 0, speed: 85, altitude: 1.8, targetAltitude: 1.8, ...values });

test('full recharge chimes once, with no ready/start/pause spam', () => {
  const feedback = createRaceSoundFeedback(track);
  assert.deepEqual(feedback.update('running', state()).cues, []);
  feedback.update('running', state({ charge: .8 }));
  assert.deepEqual(feedback.update('paused', state()).cues, []);
  assert.deepEqual(feedback.update('running', state()).cues, ['boost-full']);
  assert.deepEqual(feedback.update('running', state()).cues, []);
  feedback.reset(); assert.deepEqual(feedback.update('running', state()).cues, []);
});

test('success requires a full, uninterrupted battery use; pause preserves the attempt', () => {
  const feedback = createRaceSoundFeedback(track);
  feedback.update('running', state({ charge: .98, boosting: true }));
  feedback.update('paused', state({ charge: .5 }));
  feedback.update('running', state({ charge: .2, boosting: true }));
  assert.deepEqual(feedback.update('running', state({ charge: 0 })).cues, ['boost-complete']);
  assert.deepEqual(feedback.update('running', state({ charge: 0 })).cues, []);
  feedback.reset(); feedback.update('running', state({ charge: .5, boosting: true }));
  feedback.update('running', state({ charge: .5 }));
  feedback.update('running', state({ charge: .2, boosting: true }));
  assert.deepEqual(feedback.update('running', state({ charge: 0 })).cues, []);
});

test('real battery drain/refill produces exactly one cue of each kind at 30/60/120fps', () => {
  for (const fps of [30, 60, 120]) {
    const model = createDrivingModel({ ...track, heightObstacles: [] });
    const feedback = createRaceSoundFeedback(track), cues = [];
    for (let i = 0; i < fps * 16; i++) {
      model.step(1 / fps, { ...NEUTRAL_INPUT, throttle: true, boost: i < fps * 6 });
      cues.push(...feedback.update('running', model.state).cues);
    }
    assert.deepEqual(cues, ['boost-complete', 'boost-full']);
  }
});

test('warning follows speed-dependent range, current/target height, lap wrap, and race phase', () => {
  const feedback = createRaceSoundFeedback(track);
  assert.equal(feedback.update('running', state()).warning, null);
  assert.equal(feedback.update('running', state({ distance: 170 })).warning, null);
  assert.equal(feedback.update('running', state({ distance: 170, speed: 155 })).warning, 'up');
  assert.equal(feedback.update('running', state({ distance: 210 })).warning, 'up');
  assert.equal(feedback.update('running', state({ distance: 210, altitude: 6, targetAltitude: 6 })).warning, null);
  assert.equal(feedback.update('running', state({ distance: 210, altitude: 6, targetAltitude: 1.8 })).warning, 'up');
  assert.equal(feedback.update('paused', state({ distance: 210 })).warning, null);
  assert.equal(feedback.update('finished', state({ distance: 210 })).warning, null);
  assert.equal(feedback.update('running', state({ distance: 10300 })).warning, 'up');
  assert.equal(feedback.update('running', state({ distance: 303 })).warning, null);
});


test('warnings point down above the safe band, including a wrong selected target', () => {
  const feedback = createRaceSoundFeedback(track);
  assert.equal(feedback.update('running', state({ distance: 210, altitude: 8, targetAltitude: 8 })).warning, 'down');
  assert.equal(feedback.update('running', state({ distance: 210, altitude: 6, targetAltitude: 8 })).warning, 'down');
  assert.equal(feedback.update('running', state({ distance: 210, altitude: 5, targetAltitude: 7 })).warning, null);
});

test('collision and off-track battery losses never count as a successful full boost use', () => {
  for (const incident of [{ collisions: 1 }, { offTrackExits: 1 }]) {
    const feedback = createRaceSoundFeedback(track);
    feedback.update('running', state({ charge: .98, boosting: true }));
    assert.deepEqual(feedback.update('running', state({ charge: 0, ...incident })).cues, []);
    feedback.reset(); feedback.update('running', state({ charge: .98, boosting: true }));
    feedback.update('running', state({ charge: .7, boosting: true, ...incident }));
    assert.deepEqual(feedback.update('running', state({ charge: 0, ...incident })).cues, []);
  }
});
