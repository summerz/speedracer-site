import test from 'node:test';
import assert from 'node:assert/strict';
import { createRaceProgress, RACE_RULES_VERSION } from '../output/test/game/driving/raceProgress.js';
import { createRaceRecords } from '../output/test/game/driving/raceRecords.js';
import { createTimeAttack } from '../output/test/game/driving/createTimeAttack.js';
import { NEUTRAL_INPUT, DRIVING_TUNING as tuning, steeringYawRate } from '../output/test/game/driving/createDrivingModel.js';
import { createTrack, upcomingHeightObstacle } from '../output/test/game/track/createTrack.js';
import { DIFFICULTIES } from '../output/test/game/track/difficulty.js';

const controls = { ...NEUTRAL_INPUT, throttle: true };
const straight = { length: 200, halfWidth: 12, checkpointSpacing: 25, heightObstacles: [], sample: () => ({ curvature: 0 }) };
const memory = () => { const data = new Map(); return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }; };
const scope = { trackId: 'neon-circuit-v1:beginner', configurationId: 'stock-drone' };
const race = (track = straight, storage = memory()) => createTimeAttack(track, tuning, createRaceRecords(scope, storage));
const advance = (session, seconds, input = controls, fps = 120) => {
  for (let i = 0; i < Math.round(seconds * fps); i++) session.step(1 / fps, input);
};
const travel = (from, to, timeFrom = from / 10, timeTo = to / 10, offsetFrom = 0, offsetTo = offsetFrom) => ({ from, to, timeFrom, timeTo, offsetFrom, offsetTo });

test('countdown holds position, time, charge and altitude, then starts after three seconds', () => {
  const session = race();
  session.step(.1, controls);
  assert.equal(session.phase, 'ready');
  session.start();
  advance(session, 2.9, { ...controls, boost: true, lift: 1 });
  assert.equal(session.phase, 'countdown');
  assert.equal(session.snapshot().countdown, 1);
  assert.equal(session.model.state.distance, 0);
  assert.equal(session.model.state.elapsed, 0);
  assert.equal(session.model.state.charge, 1);
  assert.equal(session.model.state.altitudeLevel, 0);
  advance(session, .1);
  assert.equal(session.phase, 'running');
  assert.ok(session.model.state.elapsed < 1e-8);
  advance(session, .1);
  assert.ok(session.model.state.distance > 0);
});

test('countdown and running pause freeze every race clock and resume their own phase', () => {
  const session = race(); session.start(); advance(session, 1);
  session.pause(); const before = session.snapshot();
  advance(session, 20, { ...controls, boost: true });
  assert.deepEqual(session.snapshot(), before);
  session.start(); assert.equal(session.phase, 'countdown'); advance(session, 2.5);
  session.pause(); const state = { ...session.model.state };
  advance(session, 20);
  assert.deepEqual(session.model.state, state);
  session.start(); advance(session, .5);
  assert.ok(Math.abs(session.model.state.elapsed - 1) < 1e-7);
});

test('only ordered forward gates count; reversing and shuttling across the start cannot finish', () => {
  const progress = createRaceProgress(100, 4, 10);
  progress.cross(travel(90, 105)); // Skipped all preceding gates.
  progress.cross(travel(105, 90, 11, 12));
  progress.cross(travel(90, 105, 12, 13));
  assert.equal(progress.snapshot().completedLaps, 0);
  assert.equal(progress.snapshot().checkpoint, 0);
  progress.cross(travel(0, 25, 13, 14));
  progress.cross(travel(25, 0, 14, 15));
  progress.cross(travel(0, 25, 15, 16));
  assert.equal(progress.snapshot().checkpoint, 25);
  progress.cross(travel(25, 100, 16, 20));
  assert.equal(progress.snapshot().completedLaps, 1);
});

test('gate width is tested at the crossing, and a missed gate needs recovery before later gates', () => {
  const progress = createRaceProgress(100, 4, 10);
  progress.cross(travel(0, 50, 0, 5, 0, 30));
  assert.equal(progress.snapshot().checkpoint, 0, 'crossing at offset 15 misses gate 25');
  progress.cross(travel(50, 100, 5, 10));
  assert.equal(progress.snapshot().completedLaps, 0);
  progress.cross(travel(0, 100, 10, 20)); // Actual forward travel after recovery.
  assert.equal(progress.snapshot().completedLaps, 1);
});

test('swept travel catches multiple high speed gates and interpolates the third finish exactly once', () => {
  const progress = createRaceProgress(100, 20, 10);
  assert.equal(progress.cross(travel(0, 310, 0, 31)), 30);
  const s = progress.snapshot();
  assert.equal(s.completedLaps, 3);
  assert.deepEqual(s.lapTimes, [10, 10, 10]);
  assert.equal(progress.cross(travel(310, 410, 31, 41)), null);
  assert.deepEqual(progress.snapshot(), s);
});

test('millisecond lap displays sum to the displayed total, including fractional gate crossings', () => {
  const progress = createRaceProgress(100, 4, 10);
  progress.cross(travel(0, 301, 0, 32.4567));
  const s = progress.snapshot();
  assert.equal(s.lapTimes.reduce((sum, lap) => sum + Math.round(lap * 1000), 0), Math.round(s.finishTime * 1000));
});

test('invalid motion cannot corrupt checkpoint state', () => {
  const progress = createRaceProgress(100, 4, 10);
  for (const segment of [travel(0, NaN), travel(0, Infinity), travel(0, 100, 10, 0), travel(100, 0, 0, 10)]) progress.cross(segment);
  assert.equal(progress.snapshot().checkpoint, 0);
});

test('automatic and manual recovery do not award gates and keep time and boost expenditure', () => {
  const session = race(); session.start(); advance(session, 3.1);
  session.model.state.distance = 20; session.model.state.speed = 85;
  advance(session, .1, { ...controls, boost: true });
  assert.equal(session.model.state.checkpoint, 25);
  const before = session.model.state.elapsed, charge = session.model.state.charge;
  Object.assign(session.model.state, { offset: 20, altitude: 5.8, targetAltitude: 5.8 });
  session.step(1 / 120, controls);
  assert.equal(session.model.state.distance, 25);
  assert.equal(session.snapshot().completedLaps, 0);
  assert.equal(session.model.state.recoveries, 1);
  assert.ok(session.model.state.elapsed > before);
  assert.ok(session.model.state.charge <= charge);
  session.pause(); session.recover();
  assert.equal(session.phase, 'paused');
  assert.equal(session.model.state.distance, 25);
});

test('three laps finish only once; result is stable, persisted and restart fully resets the session', () => {
  const storage = memory(); const session = race(straight, storage); session.start();
  advance(session, 30, { ...controls, boost: true });
  assert.equal(session.phase, 'finished');
  const result = session.snapshot();
  assert.equal(result.completedLaps, 3);
  assert.equal(result.result.saved, true);
  assert.equal(result.result.isNewBest, true);
  assert.ok(Math.abs(result.lapTimes.reduce((a, b) => a + b, 0) - session.model.state.elapsed) < 1e-8);
  assert.equal(session.model.state.distance, straight.length * 3);
  assert.equal(session.model.state.boosting, false);
  advance(session, 20); session.pause();
  assert.deepEqual(session.snapshot(), result);
  assert.equal(createRaceRecords(scope, storage).read().total, result.finishTime);
  session.restart();
  assert.equal(session.phase, 'countdown');
  assert.equal(session.model.state.elapsed, 0);
  assert.equal(session.model.state.distance, 0);
  assert.equal(session.model.state.checkpoint, 0);
  assert.equal(session.model.state.charge, 1);
  assert.equal(session.model.state.boostNeedsRelease, false);
  assert.equal(session.snapshot().completedLaps, 0);
  assert.equal(session.snapshot().result, null);
});

test('30/60/120 Hz complete the same race at the same millisecond', () => {
  const times = [30, 60, 120].map(fps => { const session = race(); session.start(); advance(session, 20, controls, fps); return session.snapshot().finishTime; });
  assert.ok(times[0] > 0);
  assert.deepEqual(times, [times[0], times[0], times[0]]);
});

test('only faster valid records replace the best, with isolated track, rules and equipment identities', () => {
  const storage = memory(); const records = createRaceRecords(scope, storage);
  assert.equal(records.save(30, [10, 10, 10]).isNewBest, true);
  assert.equal(records.save(33, [11, 11, 11]).isNewBest, false);
  assert.equal(records.save(30, [10, 10, 10]).isNewBest, false);
  assert.equal(records.read().total, 30);
  assert.equal(records.save(27, [9, 9, 9]).isNewBest, true);
  assert.equal(createRaceRecords(scope, storage).read().total, 27);
  assert.equal(createRaceRecords({ ...scope, trackId: 'other' }, storage).read(), null);
  assert.equal(createRaceRecords({ ...scope, configurationId: 'upgraded' }, storage).read(), null);
  const payload = JSON.parse(storage.getItem(records.key)); payload.rulesVersion = 'old-rules';
  storage.setItem(records.key, JSON.stringify(payload));
  assert.equal(createRaceRecords(scope, storage).read(), null);
  assert.ok(records.key.includes(RACE_RULES_VERSION));
});

test('a stale tab cannot replace a faster record saved by another tab', () => {
  const storage = memory();
  const first = createRaceRecords(scope, storage), second = createRaceRecords(scope, storage);
  first.save(30, [10, 10, 10]);
  const slower = second.save(36, [12, 12, 12]);
  assert.equal(slower.isNewBest, false);
  assert.equal(slower.best.total, 30);
  assert.equal(createRaceRecords(scope, storage).read().total, 30);
  second.save(27, [9, 9, 9]);
  assert.equal(first.save(33, [11, 11, 11]).best.total, 27);
});

test('malformed, nonfinite, mismatched and wrong lap data are ignored', () => {
  const storage = memory(); const key = createRaceRecords(scope, storage).key;
  const base = { ...scope, rulesVersion: RACE_RULES_VERSION, record: { total: 30, laps: [10, 10, 10], recordedAt: new Date().toISOString() } };
  const cases = ['{oops', 'null', JSON.stringify({ ...base, trackId: 'wrong' }), JSON.stringify({ ...base, record: { ...base.record, total: -1 } }), JSON.stringify({ ...base, record: { ...base.record, laps: [10, 10] } }), JSON.stringify({ ...base, record: { ...base.record, total: 31 } }), JSON.stringify({ ...base, record: { ...base.record, recordedAt: 'invalid' } })];
  for (const data of cases) { storage.setItem(key, data); assert.equal(createRaceRecords(scope, storage).read(), null); }
});

test('denied reads, denied writes and unsupported storage still allow finish and retry', () => {
  for (const storage of [undefined, { getItem() { throw Error('denied'); }, setItem() { throw Error('quota'); } }]) {
    const session = createTimeAttack(straight, tuning, createRaceRecords(scope, storage)); session.start(); advance(session, 20);
    assert.equal(session.phase, 'finished');
    assert.equal(session.snapshot().result.saved, false);
    assert.ok(session.snapshot().result.best.total > 0);
    session.start(); assert.equal(session.phase, 'countdown');
  }
});

for (const preset of Object.values(DIFFICULTIES)) {
  test(`${preset.id}: actual 3D course completes three ordered laps with steering, braking and N-level altitude`, () => {
    const track = createTrack(undefined, preset); const session = race(track); session.start(); advance(session, 3);
    for (let n = 0; n < 120 * 400 && session.phase !== 'finished'; n++) {
      const s = session.model.state;
      const curvature = track.sample(s.distance).curvature;
      const ahead = track.sample(s.distance + 25).curvature;
      const target = Math.min(55, .65 / Math.max(.01, Math.abs(curvature), Math.abs(ahead)));
      const yawRate = steeringYawRate(s.speed, tuning);
      const steer = (curvature * s.speed - s.heading * 2.5 - s.offset * .12) / Math.max(.1, yawRate);
      const next = upcomingHeightObstacle(track, s.distance);
      const levels = session.model.altitudeProfile.levels;
      const level = levels.findIndex(h => h >= next.obstacle.minAltitude && h <= next.obstacle.maxAltitude);
      session.step(1 / 120, { ...controls, brake: s.speed > target + 1, steer, lift: Math.sign(level - s.altitudeLevel) });
    }
    assert.equal(session.phase, 'finished');
    assert.equal(session.snapshot().completedLaps, 3);
    assert.equal(session.model.state.recoveries, 0);
    assert.equal(session.model.state.collisions, 0);
    assert.equal(session.model.state.checkpoint, track.length * 3);
    assert.ok(Math.abs(session.snapshot().lapTimes.reduce((a, b) => a + b) - session.model.state.elapsed) < 1e-7);
  });
}
