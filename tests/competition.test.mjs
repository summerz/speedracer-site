import test from 'node:test';
import assert from 'node:assert/strict';
import { createRaceSession, selectRivalCrafts, rankParticipants, craftContact, aiDrivingInput } from '../output/test/game/driving/createRaceSession.js';
import { createRaceRecords } from '../output/test/game/driving/raceRecords.js';
import { createTrack } from '../output/test/game/track/createTrack.js';
import { DIFFICULTIES } from '../output/test/game/track/difficulty.js';
import { DEFAULT_DRONE_CONFIGURATION as config } from '../output/test/game/drone/droneConfiguration.js';
import { DRONE_CATALOG } from '../output/test/game/drone/droneCatalog.js';
import { createRivalVisuals } from '../output/test/game/driving/createRivalVisuals.js';
import { createTimeAttack } from '../output/test/game/driving/createTimeAttack.js';
import { AI_RACERS, AI_STYLE_LABELS, aiDrivingProfile, distinctAiColor, selectAiRacer } from '../output/test/game/driving/aiRoster.js';
import * as THREE from 'three';
const course = createTrack();
const straight = { ...course, length: 500, halfWidth: 14, checkpointSpacing: 25, heightObstacles: [], sample: () => ({ curvature: 0 }) };
const input = { throttle: true, brake: false, steer: 0, lift: 0, boost: false };
const session = (track = straight, slots = 0) => createRaceSession(track, config, createRaceRecords({ trackId: 'competition-test', configurationId: 'test' }), slots, 'competition', () => .999);
const advance = (race, seconds, controls = input, fps = 120) => {
  for (let n = 0; n < Math.round(seconds * fps); n++) race.step(1 / fps, controls);
};
const entry = (id, distance, finishTime = null) => ({ id, name: id, color: '#ffffff', player: id === 'player', distance, completedLaps: 0, finishTime });
const pose = (distance, offset = 0, altitude = 2) => ({ distance, offset, altitude });

test('24 named racers have fixed, distinct identities, colors and a wide skill range', () => {
  assert.equal(AI_RACERS.length, 24);
  for (const field of ['id', 'name', 'color']) assert.equal(new Set(AI_RACERS.map(p => p[field])).size, 24);
  assert.deepEqual([...new Set(AI_RACERS.map(p => p.rating))].sort(), [1, 2, 3, 4, 5, 6]);
  for (const pilot of AI_RACERS) {
    assert.ok(DRONE_CATALOG.some(p => p.configuration.modelVariant === pilot.modelVariant));
    assert.ok(DRONE_CATALOG.every(p => p.lineColor !== pilot.color));
    assert.ok(AI_STYLE_LABELS[pilot.style]);
    const desktop = aiDrivingProfile(pilot, 'desktop'), mobile = aiDrivingProfile(pilot, 'touch');
    assert.ok(mobile.pace < desktop.pace);
    assert.ok(mobile.cornerLimit < desktop.cornerLimit);
    assert.ok(mobile.boostStartCharge > desktop.boostStartCharge);
    assert.deepEqual(aiDrivingProfile(pilot, 'desktop'), desktop);
  }
  const steady = AI_RACERS.filter(p => p.modelVariant === 'vanguard' && p.style === 'steady');
  assert.ok(aiDrivingProfile(steady[1], 'desktop').pace / aiDrivingProfile(steady[0], 'desktop').pace > 1.2);
});

test('every craft matchup has recognizable eligible paint, and roster draws can reach all 24 identities', () => {
  const seen = new Set();
  for (const player of DRONE_CATALOG) for (const craft of DRONE_CATALOG) {
    if (craft === player) continue;
    for (let i = 0; i < 100; i++) {
      const pilot = selectAiRacer(craft.configuration.modelVariant, player.lineColor, () => i / 100);
      assert.equal(pilot.modelVariant, craft.configuration.modelVariant);
      assert.ok(distinctAiColor(pilot.color, player.lineColor));
      seen.add(pilot.id);
    }
  }
  assert.equal(seen.size, 24);
  assert.equal(distinctAiColor('#30e9ff', '#27eaff'), false);
  assert.equal(distinctAiColor('#eef3ff', '#27eaff'), true);
});

test('platform changes driver decisions while names, colors, models and retries stay fixed', () => {
  const make = platform => createRaceSession(straight, config, createRaceRecords({ trackId: 'platform', configurationId: 'fixed' }), 0, 'competition', () => .6, platform);
  const desktop = make('desktop'), mobile = make('touch');
  const identities = race => race.rivals.map(p => [p.id, p.name, p.color, p.configuration.modelVariant, p.style, p.rating]);
  assert.deepEqual(identities(desktop), identities(mobile));
  assert.equal(mobile.controlMode, 'touch');
  assert.ok(mobile.rivals.every((p, i) => p.profile.pace < desktop.rivals[i].profile.pace));
  const before = desktop.rivals.map(p => [p.racer, p.profile]);
  desktop.start(); advance(desktop, 5); desktop.restart();
  assert.deepEqual(desktop.rivals.map(p => [p.racer, p.profile]), before);
  assert.deepEqual(identities(desktop), identities(mobile));
});

test('the same named driver actually completes the mobile race more slowly', () => {
  const pilot = AI_RACERS.find(p => p.id === 'aegis');
  const times = ['desktop', 'touch'].map(platform => {
    const racer = createTimeAttack(straight, config.performance, createRaceRecords({ trackId: 'platform-pace', configurationId: platform }));
    racer.start();
    for (let tick = 0; tick < 12000 && racer.phase !== 'finished'; tick++) {
      racer.step(1 / 120, aiDrivingInput(straight, config, racer.model.state, 1, [], aiDrivingProfile(pilot, platform)));
    }
    assert.equal(racer.phase, 'finished');
    return racer.snapshot().finishTime;
  });
  assert.ok(times[1] > times[0] * 1.02, `${times}`);
});

test('all racer styles run more slowly on both platforms while retaining safe corner and boost decisions', () => {
  // Freeze the previous balance as a comparison, then exercise ordinary race physics.
  const previousProfile = (pilot, platform) => {
    const skill = (pilot.rating - 1) / 5, touch = platform === 'touch';
    const style = {
      straight: { pace: 1, corner: -.02, charge: .48, end: .03 },
      corner: { pace: .96, corner: .07, charge: .55, end: .03 },
      burst: { pace: .98, corner: 0, charge: .34, end: .03 },
      steady: { pace: .93, corner: .02, charge: .72, end: .15 },
    }[pilot.style];
    return {
      pace: (.82 + skill * .18) * style.pace * (touch ? .95 : 1),
      cornerLimit: (.5 + skill * .2 + style.corner + (pilot.rating >= 5 ? touch ? .06 : .12 : 0)) * (touch ? .93 : 1),
      boostStartCharge: style.charge + (1 - skill) * .12 + (touch ? .05 : 0),
      boostEndCharge: style.end,
      boostCurvature: pilot.style === 'straight' ? .0025 : .003,
    };
  };
  for (const platform of ['desktop', 'touch']) for (const pilot of AI_RACERS) {
    const previous = previousProfile(pilot, platform), current = aiDrivingProfile(pilot, platform);
    const craft = DRONE_CATALOG.find(p => p.configuration.modelVariant === pilot.modelVariant).configuration;
    const run = profile => {
      const racer = createTimeAttack(straight, craft.performance,
        createRaceRecords({ trackId: 'balance-comparison', configurationId: pilot.id }), 0, { laps: 3 });
      racer.start();
      for (let tick = 0; tick < 9000 && racer.phase !== 'finished'; tick++)
        racer.step(1 / 60, aiDrivingInput(straight, craft, racer.model.state, 1, [], profile));
      assert.equal(racer.phase, 'finished');
      return racer.snapshot().finishTime;
    };
    const before = run(previous), after = run(current);
    assert.ok(after > before, `${pilot.id}/${platform}: ${before}s -> ${after}s`);
    const state = { ...session().model.state, speed: 100, charge: previous.boostStartCharge + .01 };
    assert.equal(aiDrivingInput(straight, craft, state, 1, [], previous).boost, true);
    assert.equal(aiDrivingInput(straight, craft, state, 1, [], current).boost, false);
    const corner = { ...straight, sample: () => ({ curvature: .02 }) };
    const agileCraft = { ...craft, performance: { ...craft.performance, maxYawRate: 10 } };
    state.speed = previous.cornerLimit / .02;
    assert.equal(aiDrivingInput(corner, agileCraft, state, 1, [], previous).brake, false);
    assert.equal(aiDrivingInput(corner, agileCraft, state, 1, [], current).brake, true);
  }
});

test('each player faces seven opponents covering all four other models', () => {
  for (const player of DRONE_CATALOG) {
    const seen = new Set();
    for (const random of [() => 0, () => .999]) {
      const entries = selectRivalCrafts(player.configuration, random);
      assert.equal(entries.length, 7);
      assert.equal(new Set(entries.map(p => p.configuration.modelVariant)).size, 4);
      assert.ok(entries.every(p => p.configuration.modelVariant !== player.configuration.modelVariant));
      entries.forEach(p => seen.add(p.configuration.modelVariant));
    }
    assert.equal(seen.size, 4);
  }
});

test('AI liveries differ from every player color and keep catalog performance and paint untouched', () => {
  const original = JSON.stringify(DRONE_CATALOG), race = session();
  const visuals = createRivalVisuals(new THREE.Scene(), course, race.rivals);
  assert.equal(new Set(race.rivals.map(p => p.color)).size, 7);
  for (const rival of race.rivals) {
    assert.ok(DRONE_CATALOG.every(p => p.lineColor !== rival.color));
    assert.equal(rival.configuration.boostStyle.pulseColor, rival.color);
    assert.equal(rival.configuration.boostStyle.body, rival.color);
    // Rivals run the catalog craft with their level's upgrades; the catalog itself is checked unchanged below.
    assert.ok(rival.configuration.performance.topSpeed >=
      DRONE_CATALOG.find(p => p.configuration.modelVariant === rival.configuration.modelVariant).configuration.performance.topSpeed);
    const visual = visuals.entries.find(p => p.rival === rival);
    assert.equal(visual.color, rival.color);
    const actual = visual.object.userData.materials.neonMat.color;
    const expected = new THREE.Color(rival.color);
    const hueVector = color => new THREE.Vector3(color.r, color.g, color.b).normalize();
    assert.ok(hueVector(actual).distanceTo(hueVector(expected)) < 1e-12);
    assert.ok(Math.max(actual.r, actual.g, actual.b) > 1, 'AI neon remains bright enough for bloom');
    assert.ok(hueVector(visual.object.userData.accentBase).distanceTo(hueVector(expected)) < 1e-12);
  }
  visuals.dispose();
  assert.equal(JSON.stringify(DRONE_CATALOG), original);
});

test('a fast AI starts overtaking a slower craft before reaching it and holds clearance until fully past', () => {
  const state = { ...session().model.state, distance: 40, offset: 0, heading: 0, speed: 120 };
  const other = { ...state, distance: 80, speed: 60 };
  const free = aiDrivingInput(straight, config, state, 1, []);
  const pass = aiDrivingInput(straight, config, state, 1, [other]);
  assert.ok(free.steer > 0);
  assert.ok(pass.steer < 0, 'change lane while the slower craft is still 40m ahead');
  assert.ok(aiDrivingInput(straight, config, state, 1, [{ ...other, distance: 35 }]).steer < 0);
  assert.deepEqual(aiDrivingInput(straight, config, state, 1, [{ ...other, altitude: state.altitude + 3 }]), free);
});

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

test('shared countdown, pause, resume and restart freeze/reset all eight participants', () => {
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
  assert.deepEqual(race.rivals.map(p => p.controller.model.state.distance), [-7, -14, -21, -28, -35, -42, -49]);
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

test('braking lets AI overtake and every pilot completes three laps without waiting for the player', () => {
  const race = session(); race.start(); advance(race, 3);
  advance(race, 5, { ...input, brake: true });
  assert.equal(race.snapshot().competition.playerRank, 8);
  for (let n = 0; n < 6000; n++) {
    race.step(1 / 120, { ...input, boost: true, lift: n === 0 ? 1 : 0 });
    if (race.snapshot().competition.complete) break;
  }
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
  assert.ok(race.rivals.every(p => p.controller.model.state.offTrackExits === 0));
});

for (const difficulty of Object.values(DIFFICULTIES)) test(`all five models sustain stage 2 and cleanly finish ${difficulty.id} within the racing pace budget`, () => {
  const track = createTrack(undefined, difficulty);
  const budget = { beginner: 134, intermediate: 155, advanced: 190 }[difficulty.id];
  for (const craft of DRONE_CATALOG) {
    const racer = createTimeAttack(track, craft.configuration.performance,
      createRaceRecords({ trackId: 'ai-pace', configurationId: craft.name }));
    racer.start(); let stage2 = 0;
    for (let tick = 0; tick < 120 * (budget + 4) && racer.phase !== 'finished'; tick++) {
      racer.step(1 / 120, aiDrivingInput(track, craft.configuration, racer.model.state, 1, []));
      if (racer.model.state.boostStage === 2) stage2++;
    }
    assert.equal(racer.phase, 'finished', craft.name);
    assert.ok(racer.snapshot().finishTime < budget, `${craft.name}: ${racer.snapshot().finishTime}s`);
    assert.ok(stage2 > 120, `${craft.name} should hold stage 2 for over one second`);
    assert.equal(racer.model.state.collisions, 0, craft.name);
    assert.equal(racer.model.state.offTrackExits, 0, craft.name);
  }
});

for (const difficulty of Object.values(DIFFICULTIES)) for (const platform of ['desktop', 'touch']) {
  test(`all 24 fixed racers finish ${difficulty.id} cleanly on ${platform}`, () => {
    const track = createTrack(undefined, difficulty), times = new Map();
    for (const pilot of AI_RACERS) {
      const craft = DRONE_CATALOG.find(p => p.configuration.modelVariant === pilot.modelVariant);
      const racer = createTimeAttack(track, craft.configuration.performance,
        createRaceRecords({ trackId: 'roster', configurationId: pilot.id }));
      const profile = aiDrivingProfile(pilot, platform);
      racer.start();
      for (let tick = 0; tick < 9000 && racer.phase !== 'finished'; tick++) {
        racer.step(1 / 30, aiDrivingInput(track, craft.configuration, racer.model.state, 1, [], profile));
      }
      assert.equal(racer.phase, 'finished', pilot.id);
      assert.equal(racer.model.state.collisions, 0, pilot.id);
      assert.equal(racer.model.state.offTrackExits, 0, pilot.id);
      times.set(pilot.id, racer.snapshot().finishTime);
    }
    assert.ok(times.get('aegis') < times.get('glint') * .88, 'strong steady driver noticeably outpaces weak driver in the same craft');
  });
}

test('rendering at 30, 60 or 120 Hz preserves AI finish times and the final standings', () => {
  const outcomes = [30, 60, 120].map(fps => {
    const race = session(); race.start();
    for (let n = 0; n < fps * 100 && !race.snapshot().competition.complete; n++) race.step(1 / fps, input);
    assert.equal(race.snapshot().competition.complete, true);
    return race.snapshot().competition.standings.map(p => [p.id, p.rank, p.finishTime]);
  });
  assert.deepEqual(outcomes[0], outcomes[1]); assert.deepEqual(outcomes[1], outcomes[2]);
});


test('every grid has seven distinct identities, skilled leaders and safe three-column starts', () => {
  for (const craft of DRONE_CATALOG) for (const random of [() => 0, () => .55, () => .999]) {
    const race = createRaceSession(course, craft.configuration, createRaceRecords({ trackId: 'field-test', configurationId: craft.configuration.id }), 0, 'competition', random, 'desktop', {}, 1);
    assert.equal(race.rivals.length, 7);
    assert.equal(new Set(race.rivals.map(p => p.id)).size, 7);
    assert.ok(race.rivals.some(p => p.rating >= 5));
    assert.ok(Math.max(...race.rivals.map(p => p.rating)) - Math.min(...race.rivals.map(p => p.rating)) >= 3);
    assert.ok(race.rivals.every(p => Math.abs(p.controller.model.state.offset) < course.halfWidth - 3));
    const identities = race.rivals.map(p => p.id);
    race.start(); advance(race, 5); race.restart();
    assert.deepEqual(race.rivals.map(p => p.id), identities);
    assert.equal(race.snapshot().competition.standings.length, 8);
  }
});

test('a headless rival steers onto a free boost pad ahead', () => {
  const track = { ...straight, boostPads: [{ distance: 250, lane: 'right', center: 14 * .58, width: 7, length: 14 }] };
  const racer = createTimeAttack(track, config.performance, createRaceRecords({ trackId: 'pad', configurationId: 'rival' }));
  racer.start();
  for (let tick = 0; tick < 6000 && racer.model.state.distance < 280; tick++) racer.step(1 / 120, aiDrivingInput(track, config, racer.model.state, 1, []));
  assert.equal(racer.model.state.boostPads, 1);
});
