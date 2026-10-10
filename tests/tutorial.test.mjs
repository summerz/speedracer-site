import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrivingTutorial, TUTORIAL_STEPS, TUTORIAL_SPEED_SCALE } from '../output/test/game/driving/drivingTutorial.js';
import { createTutorialProgress, TUTORIAL_STORAGE_KEY } from '../output/test/game/driving/tutorialProgress.js';
import { createTutorialTrack, createTutorialRuntime, TUTORIAL_HAZARD_DISTANCE, TUTORIAL_NEAR_MISS_DISTANCE } from '../output/test/game/driving/scriptedTutorial.js';
import { createDrivingModel, DRIVING_TUNING, NEUTRAL_INPUT } from '../output/test/game/driving/createDrivingModel.js';
import { createTimeAttack } from '../output/test/game/driving/createTimeAttack.js';
import { createRaceSession } from '../output/test/game/driving/createRaceSession.js';
import { createRaceRecords } from '../output/test/game/driving/raceRecords.js';
import { createCatalogTrack } from '../output/test/game/track/trackRuntime.js';
import { TRACK_CATALOG } from '../output/test/game/track/trackCatalog.js';
import { DRONE_CATALOG } from '../output/test/game/drone/droneCatalog.js';

const frame = changes => ({ phase: 'running', speed: 60, steer: 0, brake: false, distance: 0, altitudeLevel: 0,
  boosting: false, obstaclesPassed: 0, collisions: 0, nearMisses: 0, ...changes });
const action = changes => ({ steer: 0, brake: false, boost: false, ...changes });
const advance = (tutorial, seconds, changes = {}) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) tutorial.update(1 / 60, frame(changes));
};
const select = (tutorial, step) => {
  while (tutorial.snapshot()?.step !== step) { tutorial.skip(); advance(tutorial, 1.2); }
  tutorial.update(0, frame()); tutorial.continue();
};
const checks = tutorial => Object.fromEntries(tutorial.snapshot().checks.map(check => [check.id, check.done]));
const memory = () => { const data = new Map(); return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }; };

test('intro requires continue; lesson and transition clocks stop in countdown or pause', () => {
  const tutorial = createDrivingTutorial({ mode: 'first-run' });
  assert.equal(tutorial.continue(), false);
  advance(tutorial, 10); assert.equal(tutorial.snapshot().phase, 'intro');
  assert.equal(tutorial.continue(), true); advance(tutorial, 1);
  assert.ok(Math.abs(tutorial.snapshot().progress - .5) < 1e-8);
  const before = tutorial.snapshot();
  advance(tutorial, 10, { phase: 'countdown' }); advance(tutorial, 10, { phase: 'paused' });
  assert.deepEqual(tutorial.snapshot(), before);
  advance(tutorial, 1); assert.equal(tutorial.snapshot().phase, 'done');
  advance(tutorial, 20, { phase: 'paused' }); assert.equal(tutorial.snapshot().nextIn, 1.2);
  advance(tutorial, 1.2); assert.equal(tutorial.snapshot().step, 'steer');
  assert.equal(tutorial.snapshot().phase, 'intro');
});
test('each steering action unfreezes only its required direction and stops again for the second action', () => {
  const tutorial = createDrivingTutorial({ mode: 'practice' }); select(tutorial, 'steer');
  assert.equal(tutorial.continue(), false);
  assert.equal(tutorial.acceptInput(action({ steer: 1 }), frame()), false);
  assert.equal(tutorial.acceptInput(action({ steer: -1 }), frame()), true);
  advance(tutorial, .45, { steer: -1 });
  assert.deepEqual(checks(tutorial), { left: true, right: false });
  assert.equal(tutorial.snapshot().phase, 'await'); assert.equal(tutorial.snapshot().expectedCheck, 'right');
  assert.equal(tutorial.acceptInput(action({ steer: 1 }), frame()), true);
  advance(tutorial, .45, { steer: 1 }); assert.equal(tutorial.snapshot().phase, 'done');
});
test('altitude needs actual changes, and boost needs both activation and a change while actually boosting', () => {
  const tutorial = createDrivingTutorial({ mode: 'practice' }); select(tutorial, 'altitude');
  assert.equal(tutorial.acceptInput(action({ requestedAltitudeLevel: 0 }), frame()), false);
  tutorial.acceptInput(action({ requestedAltitudeLevel: 1 }), frame());
  advance(tutorial, .45, { altitudeLevel: 1, altitudeChanged: false });
  assert.deepEqual(checks(tutorial), { up: false, down: false });
  tutorial.acceptInput(action({ requestedAltitudeLevel: 1 }), frame());
  tutorial.update(1 / 60, frame({ altitudeLevel: 1, altitudeChanged: true }));
  advance(tutorial, .45, { altitudeLevel: 1 });
  tutorial.acceptInput(action({ requestedAltitudeLevel: 0 }), frame({ altitudeLevel: 1 }));
  tutorial.update(1 / 60, frame({ altitudeChanged: true })); advance(tutorial, .45);
  assert.equal(tutorial.snapshot().phase, 'done'); advance(tutorial, 1.2); tutorial.continue();
  tutorial.acceptInput(action({ boost: true }), frame()); advance(tutorial, .45);
  assert.equal(checks(tutorial).on, false);
  tutorial.acceptInput(action({ boost: true }), frame()); advance(tutorial, .45, { boosting: true });
  assert.deepEqual(checks(tutorial), { on: true, 'alt-change': false });
  tutorial.acceptInput(action({ boost: true, requestedAltitudeLevel: 1 }), frame({ boosting: true }));
  tutorial.update(1 / 60, frame({ boosting: true, altitudeLevel: 1, altitudeChanged: true }));
  advance(tutorial, .45, { boosting: true, altitudeLevel: 1 }); assert.equal(tutorial.snapshot().phase, 'done');
});
test('hazard waits at its target and requires safe altitude plus an actual collision-free pass', () => {
  const tutorial = createDrivingTutorial({ mode: 'practice' });
  tutorial.setTargets({ hazard: { kind: 'hazard', distance: 240, offset: 0, altitude: 6.2, altitudeLevel: 1, worldPosition: { x: 0, y: 0, z: 0 } } });
  select(tutorial, 'hazard'); tutorial.update(.016, frame({ atTarget: true }));
  assert.equal(tutorial.snapshot().phase, 'await');
  assert.equal(tutorial.acceptInput(action({ requestedAltitudeLevel: 0 }), frame()), false);
  tutorial.acceptInput(action({ requestedAltitudeLevel: 1 }), frame());
  tutorial.update(.016, frame({ obstaclesPassed: 1, collisions: 1 }));
  assert.equal(tutorial.snapshot().phase, 'act');
  tutorial.update(.016, frame({ obstaclesPassed: 1 })); assert.equal(tutorial.snapshot().phase, 'done');
});
test('closest-point freeze must be continued before a real new near miss completes the demonstration', () => {
  const tutorial = createDrivingTutorial({ mode: 'practice' }); select(tutorial, 'near-miss');
  tutorial.update(.016, frame({ nearMisses: 1, atTarget: true }));
  assert.equal(tutorial.snapshot().phase, 'freeze'); assert.equal(tutorial.snapshot().inputLocked, true);
  advance(tutorial, 10, { nearMisses: 2 }); assert.equal(tutorial.snapshot().phase, 'freeze');
  assert.equal(tutorial.continue(), true); tutorial.update(.016, frame({ nearMisses: 2 }));
  assert.equal(tutorial.snapshot().phase, 'done');
});
test('end summaries and snapshots are detached; skip-all emits exactly one terminal outcome', () => {
  const outcomes = [], received = [];
  const tutorial = createDrivingTutorial({ mode: 'practice', onFinish: value => outcomes.push(value) });
  const unsubscribe = tutorial.onChange(value => received.push(value));
  tutorial.snapshot().checks[0].done = true; assert.equal(tutorial.snapshot().checks[0].done, false);
  tutorial.update(0, frame()); tutorial.continue(); advance(tutorial, 2); advance(tutorial, 1.2);
  tutorial.skip(); advance(tutorial, 1.2); unsubscribe(); const count = received.length;
  tutorial.skipAll(); tutorial.skipAll(); assert.equal(received.length, count);
  assert.equal(tutorial.snapshot(), null); assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].outcome, 'skipped'); assert.equal(outcomes[0].completedSteps, 1);
  assert.equal(outcomes[0].skippedSteps, 6); assert.equal(outcomes[0].steps.length, 7);
  tutorial.status().steps[0].result = 'pending'; assert.equal(tutorial.status().steps[0].result, 'completed');
});

const fixture = (craft = DRONE_CATALOG[0], challenge = 'normal') => {
  const track = createTutorialTrack(createCatalogTrack(TRACK_CATALOG[0], challenge));
  const storage = memory(); const records = createRaceRecords({ trackId: 'tutorial', configurationId: craft.configuration.id, laps: 1 }, storage);
  records.save(200, [200]); const saved = [...storage.data];
  const session = createRaceSession(track, craft.configuration, records, 0, 'time-attack', () => .5, 'desktop', { practice: true, laps: 3, lapLimit: 1 });
  const tutorial = createDrivingTutorial({ mode: 'practice' }); const runtime = createTutorialRuntime(track, session, tutorial);
  session.start();
  for (let i = 0; i < 240 && session.phase !== 'running'; i++) runtime.step(1 / 60, NEUTRAL_INPUT);
  return { track, storage, saved, records, session, tutorial, runtime };
};
test('fixed first-course layout is identical across challenges, with only its two teaching targets', () => {
  const tracks = ['easy', 'normal', 'hard'].map(challenge => fixture(undefined, challenge).track);
  for (const track of tracks) {
    assert.deepEqual(track.heightObstacles, tracks[0].heightObstacles);
    assert.deepEqual(track.corridorObstacles, tracks[0].corridorObstacles);
    assert.equal(track.heightObstacles[0].distance, TUTORIAL_HAZARD_DISTANCE);
    assert.equal(track.corridorObstacles[0].distance, TUTORIAL_NEAR_MISS_DISTANCE);
    for (const key of ['branches', 'mineFields', 'arcRails', 'boostPads', 'boostRings']) assert.equal(track[key].length, 0);
    assert.equal(track.awakeningCoresEnabled, false); assert.equal(track.rollObstacleLayout, undefined);
  }
});
test('reading, wrong inputs, pause and completion delays preserve the entire world and boost clocks', () => {
  const { session, tutorial, runtime, track } = fixture();
  const before = structuredClone(session.snapshot()), worldTime = track.obstacleTime;
  for (let i = 0; i < 600; i++) runtime.step(1 / 60, { ...NEUTRAL_INPUT, boost: true, steer: 1 }, [{ lift: 1 }]);
  assert.deepEqual(session.snapshot(), before); assert.equal(track.obstacleTime, worldTime);
  select(tutorial, 'altitude');
  const waiting = structuredClone(session.snapshot());
  for (let i = 0; i < 60; i++) runtime.step(1 / 60, NEUTRAL_INPUT, [{ lift: -1 }]);
  assert.deepEqual(session.snapshot(), waiting);
  runtime.step(1 / 60, NEUTRAL_INPUT, [{ lift: 1 }]);
  assert.equal(tutorial.snapshot().phase, 'act');
  session.pause(); const paused = structuredClone(session.snapshot());
  for (let i = 0; i < 60; i++) runtime.step(1 / 60, { ...NEUTRAL_INPUT, boost: true }, [{ lift: -1 }]);
  assert.deepEqual(session.snapshot(), paused);
  assert.equal(tutorial.continue(), false);
});
test('boost altitude wait preserves an active boost even after the player releases the boost input', () => {
  const { session, tutorial, runtime } = fixture(); select(tutorial, 'boost');
  for (let i = 0; i < 30; i++) runtime.step(1 / 60, { ...NEUTRAL_INPUT, boost: true });
  assert.equal(tutorial.snapshot().phase, 'await');
  assert.equal(tutorial.snapshot().expectedCheck, 'alt-change');
  assert.equal(session.model.state.boosting, true);
  const before = structuredClone(session.snapshot());
  for (let i = 0; i < 600; i++) runtime.step(1 / 60, NEUTRAL_INPUT);
  assert.deepEqual(session.snapshot(), before);
  runtime.step(1 / 60, { ...NEUTRAL_INPUT, boost: true }, [{ lift: 1 }, { lift: -1 }]);
  assert.equal(session.model.state.altitudeLevel, 1);
  assert.equal(checks(tutorial)['alt-change'], true);
});
for (const craft of DRONE_CATALOG) for (const fps of [30, 60, 120]) {
  test(`scripted practice completes seven real lessons without collision or record writes: ${craft.configuration.id} ${fps}fps`, () => {
    const { session, tutorial, runtime, records, storage, saved, track } = fixture(craft);
    let controls = { ...NEUTRAL_INPUT }, sawFreeze = false;
    const seen = new Set();
    for (let tick = 0; tick < fps * 90 && session.phase !== 'finished'; tick++) {
      const lesson = tutorial.snapshot(); seen.add(lesson.step);
      if (lesson.phase === 'intro') { tutorial.continue(); controls = { ...NEUTRAL_INPUT }; }
      if (lesson.phase === 'freeze') {
        sawFreeze = true; assert.equal(session.model.state.distance, TUTORIAL_NEAR_MISS_DISTANCE);
        assert.ok(Math.abs(session.model.state.offset - 1.8) < .001);
        assert.equal(session.model.state.nearMisses, 0); assert.equal(session.model.state.collisions, 0);
        if (fps !== 120) {
          const before = structuredClone(session.snapshot());
          runtime.step(1 / fps, { ...NEUTRAL_INPUT, brake: true, steer: -1, boost: true }, [{ lift: -1 }]);
          assert.deepEqual(session.snapshot(), before);
        }
        tutorial.continue(); // Resume in the same render frame: no extra tick is required.
      }
      const requests = [];
      if (lesson.phase === 'await') {
        controls = { ...NEUTRAL_INPUT };
        if (lesson.step === 'steer') controls.steer = lesson.expectedCheck === 'left' ? -1 : 1;
        if (lesson.step === 'altitude') requests.push({ lift: lesson.expectedCheck === 'up' ? 1 : -1 });
        if (lesson.step === 'boost') { controls.boost = true; if (lesson.expectedCheck === 'alt-change') requests.push({ lift: session.model.state.altitudeLevel === 0 ? 1 : -1 }); }
        if (lesson.step === 'brake') controls.brake = true;
        if (lesson.step === 'hazard') requests.push({ lift: 1 });
      }
      runtime.step(1 / fps, controls, requests);
    }
    assert.equal(session.phase, 'finished', JSON.stringify(tutorial.snapshot()));
    assert.equal(tutorial.status().outcome, 'completed'); assert.equal(tutorial.status().completedSteps, 7);
    assert.deepEqual(tutorial.status().steps.map(s => s.id), TUTORIAL_STEPS.map(s => s.id));
    assert.ok(tutorial.status().steps.every(s => s.result === 'completed')); assert.equal(seen.size, 7); assert.ok(sawFreeze);
    const state = session.model.state;
    assert.equal(state.collisions, 0); assert.equal(state.offTrackExits, 0); assert.equal(state.nearMisses, 1);
    assert.equal(state.obstaclesPassed, 2); assert.equal(state.awakeningCores, 0);
    assert.ok(state.distance < track.length); assert.equal(session.snapshot().lapTimes.length, 0);
    assert.equal(session.snapshot().competition, null); assert.equal(session.snapshot().result, null);
    assert.equal(records.read().total, 200); assert.deepEqual([...storage.data], saved);
    assert.equal(tutorial.speedScale(), TUTORIAL_SPEED_SCALE);
  });
}
test('only the first course automatically starts; completion/dismissal persist, abandonment and broken saves retry', () => {
  const storage = memory(); const progress = createTutorialProgress(storage);
  assert.equal(progress.shouldStart(false), false); assert.equal(progress.shouldStart(true), true);
  assert.equal(createTutorialProgress(storage).shouldStart(true), true);
  for (const outcome of ['completed', 'skipped']) {
    progress.finish(outcome); assert.equal(createTutorialProgress(storage).shouldStart(true), false);
    assert.equal(createTutorialProgress(storage).outcome(), outcome);
  }
  storage.setItem(TUTORIAL_STORAGE_KEY, '{broken'); assert.equal(createTutorialProgress(storage).shouldStart(true), true);
  storage.setItem(TUTORIAL_STORAGE_KEY, JSON.stringify({ version: 2, outcome: 'completed' })); assert.equal(createTutorialProgress(storage).shouldStart(true), true);
  const denied = createTutorialProgress({ getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } });
  denied.finish('skipped'); assert.equal(denied.shouldStart(true), false);
});
const straight = { length: 2000, halfWidth: 12, checkpointSpacing: 25, heightObstacles: [], sample: () => ({ curvature: 0 }) };
test('explicit lesson finish is available only for a running practice and leaves personal best unchanged', () => {
  for (const practice of [false, true]) {
    const storage = memory(), records = createRaceRecords({ trackId: 'explicit-finish', configurationId: 'stock', laps: 1 }, storage);
    records.save(200, [200]); const saved = [...storage.data];
    const race = createTimeAttack(straight, DRIVING_TUNING, records, 0, { laps: 1, practice });
    assert.equal(race.finishPractice(), false); race.start();
    for (let i = 0; i < 240 && race.phase !== 'running'; i++) race.step(1 / 60, NEUTRAL_INPUT);
    race.pause(); assert.equal(race.finishPractice(), false); race.start();
    assert.equal(race.finishPractice(), practice);
    assert.equal(race.phase, practice ? 'finished' : 'running');
    assert.equal(race.snapshot().result, null); assert.equal(race.snapshot().lapTimes.length, 0);
    assert.deepEqual([...storage.data], saved);
  }
});
test('practice ignores lap deadlines, finishes normally, and never writes either stored or in-memory personal best', () => {
  const storage = memory(); const records = createRaceRecords({ trackId: 'practice-isolation', configurationId: 'stock', laps: 1 }, storage);
  records.save(200, [200]); const before = [...storage.data];
  const race = createTimeAttack(straight, DRIVING_TUNING, records, 0, { laps: 1, lapLimit: 1, practice: true });
  race.start(); for (let i = 0; i < 60 * 60 && race.phase !== 'finished'; i++) race.step(1 / 60, { ...NEUTRAL_INPUT, throttle: true });
  assert.equal(race.phase, 'finished'); assert.equal(race.snapshot().disqualified, false); assert.equal(race.snapshot().lapLimit, null);
  assert.equal(race.snapshot().result, null); assert.equal(race.snapshot().lapTimes.length, 1);
  assert.equal(records.read().total, 200); assert.deepEqual([...storage.data], before);
});
test('guided speed reduces ordinary, boost and awakening speed and releases without changing controls', () => {
  for (const mode of ['ordinary', 'boost', 'awakening']) {
    const models = [1, .85].map(scale => {
      const model = createDrivingModel(straight);
      if (mode === 'awakening') { model.state.awakeningCores = 1; model.useAwakening(); }
      for (let i = 0; i < 240; i++) model.step(1 / 60, { ...NEUTRAL_INPUT, throttle: true, boost: mode === 'boost', guidedSpeedScale: scale });
      return model;
    });
    const [full, guided] = models; assert.ok(guided.state.speed < full.state.speed * .9, mode);
    const speed = guided.state.speed;
    for (let i = 0; i < 30; i++) guided.step(1 / 60, { ...NEUTRAL_INPUT, throttle: true, boost: mode === 'boost', guidedSpeedScale: 1 });
    assert.ok(guided.state.speed > speed, mode);
  }
});
