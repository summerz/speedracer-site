import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrivingModel, NEUTRAL_INPUT, NEAR_MISS_CHARGE } from '../output/test/game/driving/createDrivingModel.js';
import { obstacleInTransition } from '../output/test/game/track/obstacleDynamics.js';
import { ALTITUDE_PROFILES } from '../output/test/game/track/altitudeProfile.js';
import { createOvertakeCallouts, isPerfectStart } from '../output/test/game/driving/raceCallouts.js';

const straight = extra => ({ length: 1200, halfWidth: 14, checkpointSpacing: 100, heightObstacles: [], corridorObstacles: [],
  altitudeProfile: ALTITUDE_PROFILES.beginner, sample: () => ({ curvature: 0 }), ...extra });
const corridor = (distance, safeCenter) => ({ distance, depth: 44, safeCenter, safeWidth: 8, lane: 'left', speedRetention: .5 });
const drive = (model, frames, input = {}) => { for (let i = 0; i < frames; i++) model.step(1 / 60, { ...NEUTRAL_INPUT, throttle: true, ...input }); };

test('a corridor pass within 1.2 m of the band edge is a near miss worth +.08 charge; a centred pass is not', () => {
  const run = offset => {
    const model = createDrivingModel(straight({ corridorObstacles: [corridor(100, -5)] }));
    Object.assign(model.state, { distance: 72, speed: 155, offset, charge: .3 });
    drive(model, 120);
    return model.state;
  };
  const centred = run(-5), near = run(-3.5), edge = run(-1.5);
  assert.equal(centred.collisions, 0); assert.equal(centred.nearMisses, 0); assert.equal(centred.cleanStreak, 1);
  assert.equal(near.collisions, 0); assert.equal(near.nearMisses, 1); assert.equal(near.obstaclesPassed, 1);
  assert.ok(Math.abs(near.charge - centred.charge - NEAR_MISS_CHARGE) < 1e-9 && NEAR_MISS_CHARGE === .08);
  assert.equal(edge.nearMisses, 0, 'a hit is never a near miss'); assert.equal(edge.collisions, 1);
});

test('near-miss charge banks reserves and is capped at 150%', () => {
  for (const charge of [1, 1.48, 1.5]) {
    const model = createDrivingModel(straight({ corridorObstacles: [corridor(100, -5)] }));
    Object.assign(model.state, { distance: 72, speed: 155, offset: -3.5, charge });
    drive(model, 120);
    assert.equal(model.state.nearMisses, 1);
    assert.equal(model.state.charge, Math.min(1.5, charge + NEAR_MISS_CHARGE));
  }
});

test('a late altitude call counts as a near miss; an early one does not', () => {
  const field = { distance: 400, depth: 40, kind: 'rise', visual: 'discharge-arcs', speedRetention: .5, minAltitude: 5, maxAltitude: 8 };
  const run = leadMetres => {
    const model = createDrivingModel(straight({ heightObstacles: [field] }));
    Object.assign(model.state, { speed: 100 });
    const front = 400 - 20 - 2.2;
    while (model.state.distance < front - leadMetres) drive(model, 1);
    model.step(1 / 60, { ...NEUTRAL_INPUT, throttle: true, lift: 1 });
    drive(model, 480);
    return model.state;
  };
  const late = run(20), early = run(300);
  assert.equal(late.collisions, 0); assert.equal(late.nearMisses, 1); assert.equal(late.obstaclesPassed, 1);
  assert.equal(early.collisions, 0); assert.equal(early.nearMisses, 0); assert.equal(early.cleanStreak, 1);
});

test('a moving opening is mid-transition only in the tail of each step', () => {
  const moving = { motion: { stepSeconds: 2, transitionSeconds: .5, phase: 0, clearance: .7 } };
  const levels = [1.8, 4, 6.2];
  assert.equal(obstacleInTransition(moving, levels, .5), false);
  assert.equal(obstacleInTransition(moving, levels, 1.6), true);
  assert.equal(obstacleInTransition(moving, levels, 2.1), false);
  assert.equal(obstacleInTransition({}, levels, 1.6), false);
});

test('arc rail segment: tight lateral margin is a near miss and still counts for the streak only', () => {
  const rail = { distance: 100, length: 80, segments: [{ at: 0, length: 60, side: 1 }] };
  const run = offset => {
    const model = createDrivingModel(straight({ arcRails: [rail] }));
    Object.assign(model.state, { distance: 60, speed: 100, offset });
    drive(model, 180);
    return model.state;
  };
  const tight = run(-2.2), wide = run(-7), hit = run(0);
  assert.equal(tight.nearMisses, 1); assert.equal(tight.cleanStreak, 1); assert.equal(tight.obstaclesPassed, 0);
  assert.equal(wide.nearMisses, 0); assert.equal(wide.cleanStreak, 1);
  assert.equal(hit.collisions, 1); assert.equal(hit.cleanStreak, 0); assert.equal(hit.nearMisses, 0);
});

test('clean streak grows per hazard pass, resets on an obstacle hit, and keeps the best run', () => {
  const model = createDrivingModel(straight({ corridorObstacles: [corridor(100, -5), corridor(300, -5), corridor(500, 5), corridor(700, -5)] }));
  Object.assign(model.state, { distance: 72, speed: 100, offset: -5 });
  const seen = [];
  for (let i = 0; i < 700; i++) { drive(model, 1); const s = model.state; if (!seen.length || seen.at(-1)[0] !== s.cleanStreak) seen.push([s.cleanStreak, s.bestStreak]); }
  assert.deepEqual(seen.map(s => s[0]), [0, 1, 2, 0, 1]);
  assert.equal(model.state.bestStreak, 2); assert.equal(model.state.collisions, 1);
  model.reset(); assert.deepEqual([model.state.cleanStreak, model.state.bestStreak, model.state.nearMisses], [0, 0, 0]);
});

test('perfect start window is +/-0.15 s around GO', () => {
  for (const t of [.15, .05, 0, -.05, -.15]) assert.equal(isPerfectStart(t), true, `${t}`);
  for (const t of [.2, 1, -.2, -1, null]) assert.equal(isPerfectStart(t), false, `${t}`);
});

test('overtake callouts report net rank changes at most once per second', () => {
  const calls = createOvertakeCallouts();
  assert.equal(calls.update(3, 0), null, 'first rank is the baseline');
  assert.deepEqual(calls.update(2, .5), { from: 3, to: 2, gained: true });
  assert.equal(calls.update(3, .9), null, 'debounced'); assert.equal(calls.update(2, 1.2), null, 'back to the shown rank: nothing to say');
  assert.deepEqual(calls.update(3, 1.6), { from: 2, to: 3, gained: false });
  assert.equal(calls.update(1, 2), null); assert.deepEqual(calls.update(1, 2.7), { from: 3, to: 1, gained: true });
  calls.reset(); assert.equal(calls.update(5, 3), null); assert.equal(calls.update(5, 9), null);
});
