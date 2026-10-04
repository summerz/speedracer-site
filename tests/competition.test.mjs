import test from 'node:test';
import assert from 'node:assert/strict';
import { createRaceSession, rankParticipants, craftContact, aiDrivingInput } from '../output/test/game/driving/createRaceSession.js';
import { createRaceRecords } from '../output/test/game/driving/raceRecords.js';
import { createTrack } from '../output/test/game/track/createTrack.js';
import { DIFFICULTIES } from '../output/test/game/track/difficulty.js';
import { DEFAULT_DRONE_CONFIGURATION as config } from '../output/test/game/drone/droneConfiguration.js';
const course = createTrack();
const straight = { ...course, length: 500, halfWidth: 14, checkpointSpacing: 25, heightObstacles: [], sample: () => ({ curvature: 0 }) };
const input = { throttle: true, brake: false, steer: 0, lift: 0, boost: false };
const session = (track = straight, slots = 0) => createRaceSession(track, config, createRaceRecords({ trackId: 'competition-test', configurationId: 'test' }), slots, 'competition');
const advance = (race, seconds, controls = input, fps = 120) => {
  for (let n = 0; n < Math.round(seconds * fps); n++) race.step(1 / fps, controls);
};
const entry = (id, distance, finishTime = null) => ({ id, name: id, color: '#ffffff', player: id === 'player', distance, completedLaps: 0, finishTime });
const pose = (distance, offset = 0, altitude = 2) => ({ distance, offset, altitude });

test('rank uses full lap distance, then exact finish time rather than a frozen finish position', () => {
  const ranks = rankParticipants([entry('player', 520), entry('a', 490), entry('b', 1030), entry('c', 20)]);
  assert.deepEqual(ranks.map(p => p.id), ['b', 'player', 'a', 'c']);
  assert.deepEqual(ranks.map(p => p.rank), [1, 2, 3, 4]);
  const finish = rankParticipants([entry('player', 1500, 20.1), entry('a', 1499), entry('b', 1500, 20.099), entry('c', 1500, 21)]);
  assert.deepEqual(finish.map(p => p.id), ['b', 'player', 'c', 'a']);
  const tie = rankParticipants([entry('ai-1', 1500, 20.1), entry('player', 1500, 20.1)]);
  assert.equal(tie[0].id, 'player', 'a millisecond tie cannot worsen the player’s already announced rank');
});

test('swept contact catches crossing, a lap gap and the start seam; separate heights and lanes are safe', () => {
  assert.equal(craftContact(pose(20), pose(40), pose(30), pose(31), 500), true);
  assert.equal(craftContact(pose(510), pose(512), pose(11), pose(13), 500), true);
  assert.equal(craftContact(pose(499), pose(503), pose(1), pose(3), 500), true);
  assert.equal(craftContact(pose(20, 0, 6), pose(40, 0, 6), pose(30), pose(31), 500), false);
  assert.equal(craftContact(pose(20, 6), pose(40, 6), pose(30), pose(31), 500), false);
});

test('shared countdown, pause, resume and restart freeze/reset all four participants', () => {
  const race = session(); race.start(); advance(race, 2.9);
  assert.equal(race.phase, 'countdown');
  assert.ok(race.rivals.every(p => p.controller.model.state.elapsed === 0));
  race.pause(); const paused = race.snapshot(); const positions = race.rivals.map(p => ({ ...p.controller.model.state }));
  advance(race, 10); assert.deepEqual(race.snapshot(), paused);
  assert.deepEqual(race.rivals.map(p => p.controller.model.state), positions);
  race.start(); advance(race, 1); assert.equal(race.phase, 'running');
  const elapsed = race.model.state.elapsed;
  assert.ok(race.rivals.every(p => Math.abs(p.controller.model.state.elapsed - elapsed) < 1e-8));
  race.restart(); assert.equal(race.phase, 'countdown');
  assert.equal(race.model.state.elapsed, 0);
  assert.deepEqual(race.rivals.map(p => p.controller.model.state.distance), [-7, -14, -21]);
});

test('contact slows both crafts using their collision resistance and does not penalize every simulation tick', () => {
  const race = session(); race.start(); advance(race, 3);
  Object.assign(race.model.state, { distance: 60, offset: 0, speed: 40 });
  Object.assign(race.rivals[0].controller.model.state, { distance: 62, offset: 0, speed: 40 });
  race.step(1 / 120, input);
  assert.equal(race.model.state.notice, 'craft-collision');
  assert.equal(race.model.state.collisions, 1); assert.ok(race.model.state.speed < 35);
  assert.equal(race.rivals[0].controller.model.state.collisions, 1);
  assert.ok(race.rivals[0].controller.model.state.speed < 35);
  advance(race, .2); assert.equal(race.model.state.collisions, 1);
  assert.equal(race.model.state.recoveries, 0);
});

test('focus slows every active racer while every official elapsed clock keeps running', () => {
  const race = session(straight, 1); race.start(); advance(race, 4);
  assert.equal(race.useFocus(), true); assert.ok(race.rivals.every(p => p.controller.snapshot().focusUsed === 1));
  const before = race.model.state.elapsed; advance(race, 1);
  assert.ok(Math.abs(race.model.state.elapsed - before - 1) < 1e-7);
  assert.ok(race.rivals.every(p => Math.abs(p.controller.model.state.elapsed - race.model.state.elapsed) < 1e-7));
  race.pause(); const snapshot = race.snapshot(); advance(race, 2); assert.deepEqual(race.snapshot(), snapshot);
});

test('braking lets AI overtake, boost lets the player pass, and every pilot completes three laps', () => {
  const race = session(); race.start(); advance(race, 3);
  advance(race, 5, { ...input, brake: true });
  assert.equal(race.snapshot().competition.playerRank, 4);
  let overtaken = false;
  for (let n = 0; n < 6000; n++) {
    race.step(1 / 120, { ...input, boost: true, lift: n === 0 ? 1 : 0 });
    if (race.snapshot().competition.playerRank < 4) overtaken = true;
    if (race.snapshot().competition.complete) break;
  }
  assert.equal(overtaken, true);
  assert.equal(race.phase, 'finished'); assert.equal(race.snapshot().competition.complete, true);
  assert.ok(race.snapshot().competition.standings.every(p => p.completedLaps === 3 && p.finishTime > 0));
  const finished = race.snapshot(); advance(race, 1); assert.deepEqual(race.snapshot(), finished);
  race.start(); assert.equal(race.phase, 'countdown');
  assert.ok(race.rivals.every(p => p.controller.phase === 'countdown' && p.controller.model.state.elapsed === 0));
});

for (const difficulty of Object.values(DIFFICULTIES)) test(`all AI finish the actual ${difficulty.id} course with ordinary inputs`, () => {
  const track = createTrack(undefined, difficulty), race = session(track);
  race.start();
  for (let n = 0; n < 15000; n++) {
    const controls = aiDrivingInput(track, config, race.model.state, 1, []);
    race.step(1 / 30, controls);
    if (race.snapshot().competition.complete) break;
  }
  assert.equal(race.snapshot().competition.complete, true, JSON.stringify(race.snapshot().competition));
  assert.ok(race.snapshot().competition.standings.every(p => p.completedLaps === 3));
  assert.ok(race.rivals.every(p => p.controller.model.state.recoveries === 0));
});

test('rendering at 30, 60 or 120 Hz preserves AI finish times and the final standings', () => {
  const outcomes = [30, 60, 120].map(fps => {
    const race = session(); race.start();
    for (let n = 0; n < fps * 100 && !race.snapshot().competition.complete; n++) race.step(1 / fps, input);
    assert.equal(race.snapshot().competition.complete, true);
    return race.snapshot().competition.standings.map(p => [p.id, p.rank, p.finishTime]);
  });
  assert.deepEqual(outcomes[0], outcomes[1]); assert.deepEqual(outcomes[1], outcomes[2]);
});
