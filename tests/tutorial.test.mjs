import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrivingTutorial, TUTORIAL_STEPS } from '../output/test/game/driving/drivingTutorial.js';
import { createTutorialProgress, TUTORIAL_STORAGE_KEY } from '../output/test/game/driving/tutorialProgress.js';
import { createDrivingModel, DRIVING_TUNING, NEUTRAL_INPUT } from '../output/test/game/driving/createDrivingModel.js';
import { createTimeAttack } from '../output/test/game/driving/createTimeAttack.js';
import { createRaceRecords } from '../output/test/game/driving/raceRecords.js';

const frame = changes => ({ phase: 'running', speed: 60, steer: 0, brake: false, altitudeLevel: 0,
  boosting: false, obstaclesPassed: 0, collisions: 0, nearMisses: 0, hazardNearby: false, ...changes });
const advance = (tutorial, seconds, changes = {}) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) tutorial.update(1 / 60, frame(changes));
};
const select = (tutorial, step, changes = {}) => {
  while (tutorial.snapshot()?.step !== step) { tutorial.skip(); advance(tutorial, 1.2, changes); }
};
const checks = tutorial => Object.fromEntries(tutorial.snapshot().checks.map(check => [check.id, check.done]));
const memory = () => { const data = new Map(); return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }; };

test('automatic acceleration requires driving time, and pause/countdown freeze completion and transition', () => {
  const tutorial = createDrivingTutorial({ mode: 'first-run' });
  advance(tutorial, 10, { phase: 'countdown' }); advance(tutorial, 10, { phase: 'paused' });
  assert.equal(tutorial.snapshot().progress, 0);
  advance(tutorial, 1); assert.ok(Math.abs(tutorial.snapshot().progress - .5) < 1e-8);
  advance(tutorial, 10, { brake: true }); assert.equal(tutorial.snapshot().phase, 'show');
  advance(tutorial, 1); assert.equal(tutorial.snapshot().phase, 'done');
  const before = tutorial.snapshot(); advance(tutorial, 20, { phase: 'paused' });
  assert.deepEqual(tutorial.snapshot(), before);
  advance(tutorial, 1.2); assert.equal(tutorial.snapshot().step, 'steer');
});
test('checks require both steering directions and both manual altitude directions in their own steps', () => {
  const tutorial = createDrivingTutorial({ mode: 'practice' }); select(tutorial, 'steer');
  advance(tutorial, .2, { steer: -1 }); assert.deepEqual(checks(tutorial), { left: true, right: false });
  advance(tutorial, .2, { steer: 1 }); assert.equal(tutorial.snapshot().phase, 'done'); advance(tutorial, 1.2);
  tutorial.update(.016, frame({ altitudeLevel: 1, altitudeChanged: false }));
  assert.deepEqual(checks(tutorial), { up: false, down: false });
  tutorial.update(.016, frame({ altitudeLevel: 0 })); tutorial.update(.016, frame({ altitudeLevel: 1 }));
  assert.equal(tutorial.snapshot().phase, 'done');
});
test('boost requires an actual activation and an altitude change while boost is active', () => {
  const tutorial = createDrivingTutorial({ mode: 'practice' }); select(tutorial, 'boost');
  tutorial.update(.016, frame({ altitudeLevel: 1 }));
  assert.deepEqual(checks(tutorial), { on: false, 'alt-change': false });
  tutorial.update(.016, frame({ altitudeLevel: 1, boosting: true }));
  assert.deepEqual(checks(tutorial), { on: true, 'alt-change': false });
  tutorial.update(.016, frame({ altitudeLevel: 0, boosting: true }));
  assert.equal(tutorial.snapshot().phase, 'done');
});
test('braking needs a deliberate press; hazard requires a seen obstacle and a later collision-free pass', () => {
  const tutorial = createDrivingTutorial({ mode: 'practice' }); select(tutorial, 'brake');
  advance(tutorial, .1, { brake: true }); advance(tutorial, .1); assert.equal(tutorial.snapshot().phase, 'show');
  advance(tutorial, .2, { brake: true }); advance(tutorial, 1.2);
  tutorial.update(.016, frame({ obstaclesPassed: 1 })); assert.equal(tutorial.snapshot().phase, 'show');
  tutorial.update(.016, frame({ obstaclesPassed: 1, hazardNearby: true }));
  tutorial.update(.016, frame({ obstaclesPassed: 2, collisions: 1 })); assert.equal(tutorial.snapshot().phase, 'show');
  tutorial.update(.016, frame({ obstaclesPassed: 2, collisions: 1, hazardNearby: true }));
  tutorial.update(.016, frame({ obstaclesPassed: 3, collisions: 1 })); assert.equal(tutorial.snapshot().phase, 'done');
});
test('near misses from earlier steps never complete the near-miss lesson', () => {
  const tutorial = createDrivingTutorial({ mode: 'practice' }); select(tutorial, 'near-miss', { nearMisses: 5 });
  advance(tutorial, 3, { nearMisses: 5 }); assert.equal(tutorial.snapshot().phase, 'show');
  tutorial.update(.016, frame({ nearMisses: 6 })); assert.equal(tutorial.snapshot().phase, 'done');
});
test('every step can be skipped without fabricating completed checks; the finish callback fires once', () => {
  const outcomes = []; const tutorial = createDrivingTutorial({ mode: 'first-run', onFinish: value => outcomes.push(value) });
  for (const step of TUTORIAL_STEPS) {
    assert.equal(tutorial.snapshot().step, step.id); tutorial.skip(); tutorial.skip();
    assert.equal(tutorial.snapshot().phase, 'done'); assert.ok(tutorial.snapshot().checks.every(check => !check.done));
    advance(tutorial, 1.2);
  }
  assert.equal(tutorial.snapshot(), null); assert.equal(outcomes.length, 1);
  assert.deepEqual(outcomes[0], { mode: 'first-run', outcome: 'skipped', completedSteps: 0, skippedSteps: 7 });
  tutorial.skipAll(); advance(tutorial, 2); assert.equal(outcomes.length, 1); assert.equal(tutorial.speedScale(), 1);
});
test('all seven naturally completed lessons finish once and return the original speed smoothly', () => {
  const outcomes = []; const tutorial = createDrivingTutorial({ mode: 'first-run', onFinish: value => outcomes.push(value) });
  advance(tutorial, 2); advance(tutorial, 1.2);
  advance(tutorial, .2, { steer: -1 }); advance(tutorial, .2, { steer: 1 }); advance(tutorial, 1.2);
  tutorial.update(.016, frame({ altitudeLevel: 1 })); tutorial.update(.016, frame()); advance(tutorial, 1.2);
  tutorial.update(.016, frame({ boosting: true })); tutorial.update(.016, frame({ boosting: true, altitudeLevel: 1 })); advance(tutorial, 1.2);
  advance(tutorial, .2, { brake: true }); advance(tutorial, 1.2);
  tutorial.update(.016, frame({ hazardNearby: true })); tutorial.update(.016, frame({ obstaclesPassed: 1 })); advance(tutorial, 1.2, { obstaclesPassed: 1 });
  tutorial.update(.016, frame({ obstaclesPassed: 1, nearMisses: 1 })); advance(tutorial, 1.2, { obstaclesPassed: 1, nearMisses: 1 });
  assert.equal(outcomes[0].outcome, 'completed'); assert.equal(outcomes[0].completedSteps, 7); assert.equal(tutorial.snapshot(), null);
  assert.equal(tutorial.speedScale(), .85); advance(tutorial, .5); assert.ok(tutorial.speedScale() > .85 && tutorial.speedScale() < 1);
  advance(tutorial, 1); assert.equal(tutorial.speedScale(), 1);
});
test('snapshots are detached, subscribers unsubscribe, and dismissing the whole guide restores speed', () => {
  const tutorial = createDrivingTutorial({ mode: 'practice' }); const received = [];
  const unsubscribe = tutorial.onChange(value => received.push(value));
  const value = tutorial.snapshot(); value.checks[0].done = true; assert.equal(tutorial.snapshot().checks[0].done, false);
  advance(tutorial, .1); assert.ok(received.length > 1); unsubscribe(); const count = received.length;
  tutorial.skipAll(); tutorial.skipAll(); assert.equal(received.length, count); assert.equal(tutorial.snapshot(), null);
  assert.equal(tutorial.status().skippedSteps, 7); advance(tutorial, 1); assert.equal(tutorial.speedScale(), 1);
});
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
