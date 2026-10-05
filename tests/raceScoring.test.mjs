import test from 'node:test';
import assert from 'node:assert/strict';
import { createCleanHalfLaps, OFF_TRACK_PENALTY_POINTS, COLLISION_PENALTY_POINTS } from '../output/test/game/driving/raceScoring.js';
import { createTimeAttack } from '../output/test/game/driving/createTimeAttack.js';
import { createRaceRecords } from '../output/test/game/driving/raceRecords.js';
import { createRaceFeedback } from '../output/test/game/driving/createRaceFeedback.js';
import { createDrivingModel, DRIVING_TUNING, NEUTRAL_INPUT } from '../output/test/game/driving/createDrivingModel.js';
import { calculateReward } from '../output/test/game/progression/progress.js';

const track = { length: 240, halfWidth: 12, checkpointSpacing: 50, heightObstacles: [], sample: () => ({ curvature: 0 }) };
const input = { ...NEUTRAL_INPUT, throttle: true };
const incidents = () => ({ collisions: 0, offTrackExits: 0, recoveries: 0 });
const reward = { raceId: 'scored', difficulty: 'beginner', ...incidents(), penaltyPoints: 0, cleanHalfLaps: 6, improvedExistingBest: false, assisted: false };
const race = () => createTimeAttack(track, DRIVING_TUNING, createRaceRecords({ trackId: 'half-laps', configurationId: 'stock' }));

test('clean is local to each exact half lap, with no partial or duplicate recovery awards', () => {
  const clean = createCleanHalfLaps(240, 3), state = incidents();
  clean.cross(119.999, state); assert.equal(clean.snapshot().length, 0);
  state.collisions++; clean.cross(120, state);
  assert.deepEqual(clean.snapshot(), [{ lap: 1, half: 1, clean: false }]);
  clean.cross(240, state); assert.equal(clean.snapshot()[1].clean, true);
  state.recoveries++; clean.cross(200, state); clean.cross(240, state);
  assert.equal(clean.snapshot().length, 2);
  clean.cross(360, state); assert.equal(clean.snapshot()[2].clean, false);
  state.offTrackExits++; clean.cross(480, state); assert.equal(clean.snapshot()[3].clean, false);
  clean.cross(600, state); clean.cross(720, state); clean.cross(1000, state);
  assert.equal(clean.snapshot().length, 6); assert.equal(clean.snapshot().filter(s => s.clean).length, 3);
  const copy = clean.snapshot(); copy[0].clean = true; assert.equal(clean.snapshot()[0].clean, false);
  clean.reset(); assert.deepEqual(clean.snapshot(), []);
});

test('actual race awards the other five halves after an early contact, at every frame rate', () => {
  for (const fps of [30, 60, 120]) {
    const session = race(); session.start(); let hit = false;
    for (let step = 0; step < fps * 30 && session.phase !== 'finished'; step++) {
      if (!hit && session.model.state.distance > 40) { session.model.contact(); hit = true; }
      session.step(1 / fps, input);
    }
    assert.equal(session.phase, 'finished');
    const snapshot = session.snapshot();
    assert.equal(snapshot.cleanHalfLaps, 5);
    assert.deepEqual(snapshot.cleanSegments.map(s => s.clean), [false, true, true, true, true, true]);
    assert.equal(snapshot.penaltyPoints, 1);
    assert.equal(calculateReward({ ...reward, collisions: 1, penaltyPoints: snapshot.penaltyPoints, cleanHalfLaps: snapshot.cleanHalfLaps }).total, 114);
    session.pause(); assert.equal(session.snapshot().cleanHalfLaps, 5);
    session.restart(); assert.equal(session.snapshot().cleanHalfLaps, 0);
  }
});

test('half lap clean announcement uses distance even with an odd checkpoint count; no replay on pause', () => {
  const feedback = createRaceFeedback();
  const base = { phase: 'running', elapsed: 10, countdown: 0, completedLaps: 0, gatesPassed: 2, gatesPerLap: 5, totalLaps: 3, cleanSegments: [] };
  feedback.update(base);
  const half = { ...base, cleanSegments: [{ lap: 1, half: 1, clean: true }] };
  assert.deepEqual(feedback.update(half), ['half-lap']);
  assert.equal(feedback.announcement.clean, true);
  feedback.update({ ...half, phase: 'paused' }); assert.deepEqual(feedback.update(half), []);
  feedback.update({ ...half, completedLaps: 1, gatesPassed: 0, cleanSegments: [...half.cleanSegments, { lap: 1, half: 2, clean: false }] });
  assert.equal(feedback.announcement.clean, false);
});

test('each collision costs one point; a low departure is not charged as a second wall impact', () => {
  const model = createDrivingModel(track);
  model.contact(); model.contact(); assert.equal(model.state.penaltyPoints, 2 * COLLISION_PENALTY_POINTS);
  model.reset(); Object.assign(model.state, { offset: 15, speed: 50 });
  model.step(1 / 120, input);
  assert.equal(model.state.offTrackExits, 1); assert.equal(model.state.collisions, 0);
  assert.equal(model.state.penaltyPoints, OFF_TRACK_PENALTY_POINTS);
  model.state.offset = 0; model.step(1 / 120, input);
  model.state.offset = 15; model.step(1 / 120, input);
  assert.equal(model.state.penaltyPoints, 2 * OFF_TRACK_PENALTY_POINTS);
  model.state.offset = 0; model.step(1 / 120, input);
  model.state.offset = 11; model.step(1 / 120, input);
  assert.equal(model.state.collisions, 1); assert.equal(model.state.penaltyPoints, 15);
});

test('record improvement outweighs small collisions and rewards still retain a zero floor', () => {
  assert.equal(calculateReward({ ...reward, improvedExistingBest: true }).total, 148);
  assert.equal(calculateReward({ ...reward, collisions: 2, penaltyPoints: 2, cleanHalfLaps: 4, improvedExistingBest: true }).total, 140);
  assert.equal(calculateReward({ ...reward, offTrackExits: 1, penaltyPoints: 7, cleanHalfLaps: 5 }).total, 108);
  assert.equal(calculateReward({ ...reward, collisions: 200, penaltyPoints: 200, cleanHalfLaps: 0 }).total, 0);
  for (const cleanHalfLaps of [-1, .5, 21, NaN]) assert.throws(() => calculateReward({ ...reward, cleanHalfLaps }));
});
