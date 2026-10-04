import test from 'node:test';
import assert from 'node:assert/strict';
import { createRaceFeedback } from '../output/test/game/driving/createRaceFeedback.js';
import { createRaceProgress } from '../output/test/game/driving/raceProgress.js';

const snapshot = (values = {}) => ({ phase: 'running', elapsed: 10, countdown: 0, completedLaps: 0, gatesPassed: 0, gatesPerLap: 24, totalLaps: 3, ...values });

test('each countdown tick and race start cue fires once; resuming is not a new start', () => {
  const feedback = createRaceFeedback();
  for (const countdown of [3, 2, 1]) {
    const state = snapshot({ phase: 'countdown', countdown });
    assert.deepEqual(feedback.update(state), ['countdown']);
    assert.deepEqual(feedback.update(state), []);
  }
  assert.deepEqual(feedback.update(snapshot()), ['start']);
  feedback.update(snapshot({ phase: 'paused' }));
  assert.deepEqual(feedback.update(snapshot()), []);
});

test('half lap, lap completion and final lap use validated checkpoint progress', () => {
  const feedback = createRaceFeedback();
  const progress = createRaceProgress(240, 24, 12);
  let from = 0;
  const move = to => {
    progress.cross({ from, to, offsetFrom: 0, offsetTo: 0, timeFrom: from / 10, timeTo: to / 10 });
    from = to;
    return feedback.update(snapshot({ ...progress.snapshot(), elapsed: to / 10 }));
  };
  assert.deepEqual(move(110), []);
  assert.deepEqual(move(120), ['half-lap']);
  assert.equal(feedback.announcement.title, 'LAP 1 · 50%');
  assert.deepEqual(move(130), []);
  assert.deepEqual(move(240), ['lap']);
  assert.equal(feedback.announcement.title, 'LAP 1 COMPLETE');
  assert.deepEqual(move(360), ['half-lap']);
  assert.deepEqual(move(480), ['final-lap']);
  assert.equal(feedback.announcement.title, 'FINAL LAP');
  assert.match(feedback.announcement.detail, /2랩 완료/);
  assert.deepEqual(move(600), ['half-lap']);
  progress.cross({ from: 600, to: 720, offsetFrom: 0, offsetTo: 0, timeFrom: 60, timeTo: 72 });
  const final = snapshot({ ...progress.snapshot(), elapsed: 72, phase: 'finished' });
  assert.deepEqual(feedback.update(final), ['finish']);
  assert.equal(feedback.announcement, null);
  assert.deepEqual(feedback.update(final), []);
});

test('recovery and pause preserve cue history and announcement expiry uses race time', () => {
  const feedback = createRaceFeedback();
  const half = snapshot({ gatesPassed: 12 });
  feedback.update(half);
  const id = feedback.announcement.id;
  feedback.update({ ...half, phase: 'paused' });
  assert.equal(feedback.announcement.id, id);
  assert.deepEqual(feedback.update(half), []);
  assert.deepEqual(feedback.update(snapshot({ gatesPassed: 10, elapsed: 11 })), []);
  assert.deepEqual(feedback.update({ ...half, elapsed: 12 }), []);
  feedback.update({ ...half, elapsed: 12.5 });
  assert.equal(feedback.announcement, null);
});

test('a skipped render frame still detects crossed milestones, showing the newest cue', () => {
  const feedback = createRaceFeedback();
  assert.deepEqual(feedback.update(snapshot({ completedLaps: 2 })), ['half-lap', 'lap', 'half-lap', 'final-lap']);
  assert.equal(feedback.announcement.kind, 'final-lap');
});

test('restart allows cues again, with a fresh announcement identity for the UI', () => {
  const feedback = createRaceFeedback();
  feedback.update(snapshot({ gatesPassed: 12 }));
  const id = feedback.announcement.id;
  feedback.reset();
  assert.equal(feedback.announcement, null);
  assert.deepEqual(feedback.update(snapshot({ gatesPassed: 12 })), ['half-lap']);
  assert.ok(feedback.announcement.id > id);
});
