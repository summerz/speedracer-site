import test from 'node:test';
import assert from 'node:assert/strict';
import { createRaceProgress } from '../output/test/game/driving/raceProgress.js';
import { createRaceRecords } from '../output/test/game/driving/raceRecords.js';
import { createTimeAttack } from '../output/test/game/driving/createTimeAttack.js';
import { checkpointSplits, raceResultData } from '../output/test/game/driving/raceResultData.js';
import { DRIVING_TUNING, NEUTRAL_INPUT } from '../output/test/game/driving/createDrivingModel.js';

const track = { length: 200, halfWidth: 12, checkpointSpacing: 25, heightObstacles: [], sample: () => ({ curvature: 0 }) };
const input = { ...NEUTRAL_INPUT, throttle: true };
const scope = { trackId: 'split-test', configurationId: 'stock' };
const storage = () => { const map = new Map(); return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) }; };
const advance = (race, seconds, controls = input) => {
  for (let tick = 0; tick < Math.round(seconds * 120); tick++) race.step(1 / 120, controls);
};

test('swept checkpoints interpolate across laps, including the finish, and reset without stale times', () => {
  const progress = createRaceProgress(100, 4, 12, 2);
  progress.cross({ from: 0, to: 205, timeFrom: 0, timeTo: 20.5, offsetFrom: 0, offsetTo: 0 });
  const result = progress.snapshot();
  assert.deepEqual(result.checkpointTimes, [2.5, 5, 7.5, 10, 12.5, 15, 17.5, 20]);
  assert.equal(result.checkpointTimes.at(-1), result.finishTime);
  result.checkpointTimes[0] = 100;
  assert.equal(progress.snapshot().checkpointTimes[0], 2.5);
  progress.reset(); assert.deepEqual(progress.snapshot().checkpointTimes, []);
});

test('checkpoint deltas compare cumulative and sector times with correct faster/slower signs', () => {
  const splits = checkpointSplits([2, 5, 7, 11, 13], [3, 4, 8, 10, 14], 4, 100);
  assert.deepEqual(splits.map(split => split.delta), [-1, 1, -1, 1, -1]);
  assert.deepEqual(splits.map(split => split.segmentDelta), [-1, 2, -2, 2, -2]);
  assert.equal(splits[4].lap, 2); assert.equal(splits[4].gate, 1); assert.equal(splits[4].distance, 125);
  assert.ok(checkpointSplits([2, 5], undefined, 4, 100).every(split => split.delta === null && split.bestSegmentTime === null));
});

test('PB checkpoint times survive storage, are copied, and only belong to the winning full run', () => {
  const store = storage(), records = createRaceRecords(scope, store);
  const times = [5, 10, 15, 20, 25, 30];
  records.save(30, [10, 10, 10], times); times[0] = 99;
  const read = records.read(); read.checkpointTimes[0] = 99;
  const saved = createRaceRecords(scope, store).read();
  assert.deepEqual(saved.checkpointTimes, [5, 10, 15, 20, 25, 30]);
  records.save(33, [11, 11, 11], [4, 11, 14, 22, 24, 33]);
  assert.deepEqual(records.read(), saved);
  assert.throws(() => records.save(20, [6, 6, 8], [7, 6, 9, 12, 17, 20]), /Invalid completed race/);
  assert.throws(() => records.save(20, [6, 6, 8], [3, 7, 9, 12, 17, 20]), /Invalid completed race/);
});

test('legacy PBs remain readable and geometry mismatches never fabricate a checkpoint delta', () => {
  for (const times of [undefined, [5, 10, 15, 20, 25, 30]]) {
    const records = createRaceRecords(scope, storage()); records.save(30, [10, 10, 10], times);
    const race = createTimeAttack(track, DRIVING_TUNING, records);
    race.start(); advance(race, 7);
    assert.ok(race.snapshot().checkpointSplits.length > 0);
    assert.ok(race.snapshot().checkpointSplits.every(split => split.delta === null));
    assert.equal(race.snapshot().comparisonRecord.total, 30);
  }
});

test('a new best compares against the pre-race PB; finish and pause freeze stats, restart clears them', () => {
  const records = createRaceRecords(scope, storage());
  records.save(60, [20, 20, 20], Array.from({ length: 24 }, (_, index) => (index + 1) * 2.5));
  const race = createTimeAttack(track, DRIVING_TUNING, records);
  race.start(); advance(race, 3, { ...input, boost: true });
  assert.equal(race.snapshot().raceStats.boostUses, 0, 'countdown is not a boost activation');
  advance(race, .2, { ...input, boost: true });
  race.model.contact();
  race.pause(); const paused = race.snapshot(); advance(race, 3, { ...input, boost: true });
  assert.deepEqual(race.snapshot(), paused);
  race.start(); advance(race, 30);
  const result = race.snapshot();
  assert.equal(result.phase, 'finished'); assert.equal(result.result.isNewBest, true);
  assert.equal(result.comparisonRecord.total, 60);
  assert.equal(result.checkpointSplits.at(-1).delta, result.finishTime - 60);
  assert.equal(result.checkpointSplits.length, 24);
  assert.equal(result.raceStats.collisions, 1); assert.equal(result.raceStats.boostUses, 1);
  assert.equal(result.raceStats.nearMisses, race.model.state.nearMisses);
  result.comparisonRecord.checkpointTimes[0] = 999;
  assert.equal(race.snapshot().comparisonRecord.checkpointTimes[0], 2.5);
  const frozen = race.snapshot(); advance(race, 4, { ...input, boost: true });
  assert.deepEqual(race.snapshot(), frozen);
  race.restart();
  assert.deepEqual(race.snapshot().raceStats, { collisions: 0, nearMisses: 0, bestStreak: 0, offTrackExits: 0, boostUses: 0 });
  assert.deepEqual(race.snapshot().checkpointSplits, []);
  assert.equal(race.snapshot().comparisonRecord.total, frozen.finishTime);
});

test('boost counts actual starts, not held frames, blocked inputs, stage changes or awakening', () => {
  const race = createTimeAttack(track, DRIVING_TUNING, createRaceRecords(scope));
  race.start(); advance(race, 3);
  advance(race, .1, { ...input, boost: true, brake: true });
  assert.equal(race.model.state.boostUses, 0);
  race.model.state.charge = 1.5;
  advance(race, 1.8, { ...input, boost: true });
  assert.equal(race.model.state.boostUses, 1);
  advance(race, .1); advance(race, .1, { ...input, boost: true });
  assert.equal(race.model.state.boostUses, 2);
  race.model.state.awakeningCores = 1; assert.equal(race.useAwakening(), true);
  advance(race, .1, { ...input, boost: true });
  assert.equal(race.model.state.boostUses, 2);
});


test('pure UI adapter exposes lap deltas, pre-save total, optional sectors and all incident counts', () => {
  const records = createRaceRecords(scope);
  records.save(60, [20, 20, 20], Array.from({ length: 24 }, (_, index) => (index + 1) * 2.5));
  const race = createTimeAttack(track, DRIVING_TUNING, records);
  race.start(); advance(race, 30);
  const snapshot = race.snapshot(), data = raceResultData(snapshot);
  assert.equal(data.previousBestTotal, 60);
  assert.deepEqual(data.lapDeltas, snapshot.lapTimes.map(time => time - 20));
  assert.equal(data.sectors.length, 24);
  assert.equal(data.sectors[0].delta, data.sectors[0].time - 2.5);
  assert.equal(data.sectors.at(-1).cumulativeDelta, snapshot.finishTime - 60);
  for (const field of ['nearMisses', 'bestStreak', 'collisions', 'offTrackExits', 'boostUses'])
    assert.equal(data[field], race.model.state[field]);
  assert.equal('sectors' in raceResultData({ ...snapshot, checkpointSplits: [] }), false);
  const noBest = raceResultData({ ...snapshot, comparisonRecord: null,
    checkpointSplits: checkpointSplits(snapshot.checkpointTimes, undefined, 8, 200) });
  assert.equal(noBest.previousBestTotal, null);
  assert.ok(noBest.lapDeltas.every(delta => delta === null)); assert.equal('sectors' in noBest, false);
  data.lapDeltas[0] = 999; data.sectors[0].delta = 999;
  assert.notEqual(raceResultData(snapshot).sectors[0].delta, 999);
});

test('actual near misses, best clean streak and departures reach the result adapter', () => {
  const course = { ...track, halfWidth: 14, corridorObstacles: [{ distance: 100, depth: 44, safeCenter: -5,
    safeWidth: 8, lane: 'left', speedRetention: .5 }] };
  const race = createTimeAttack(course, DRIVING_TUNING, createRaceRecords(scope));
  race.start(); advance(race, 3);
  race.model.state.offset = 20; advance(race, .1);
  assert.ok(race.model.state.offTrackExits > 0);
  race.model.state.offset = -3.5;
  advance(race, 30);
  const data = raceResultData(race.snapshot());
  assert.equal(race.phase, 'finished');
  assert.equal(data.nearMisses, 3); assert.equal(data.bestStreak, 3);
  assert.equal(data.offTrackExits, 1);
});
