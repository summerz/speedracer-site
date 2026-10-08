import test from 'node:test';
import assert from 'node:assert/strict';
import { FINISH_REDUCED_SECONDS, FINISH_SECONDS, INTRO_REDUCED_SECONDS, INTRO_SECONDS, cinematicSeconds, ease, finishSplash, finishSwing, finishTimeScale, introProgress, introTitle, ordinal } from '../output/test/game/driving/raceCinematic.js';

test('ordinals handle the teen exceptions', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal), ['1ST', '2ND', '3RD', '4TH', '11TH', '12TH', '13TH', '21ST', '22ND', '23RD', '101ST', '111TH']);
});
test('intro progress is monotonic, eased and reaches exactly the chase pose', () => {
  assert.equal(introProgress(0), 0); assert.equal(introProgress(INTRO_SECONDS), 1); assert.equal(introProgress(99), 1);
  let last = 0; for (let t = 0; t <= INTRO_SECONDS; t += .1) { const s = introProgress(t); assert.ok(s >= last); last = s; }
  assert.ok(ease(.1) < .1 && ease(.9) > .9 && ease(.5) === .5);
});
test('durations follow the spec and shrink under reduced motion', () => {
  assert.equal(cinematicSeconds('intro', false), INTRO_SECONDS); assert.equal(cinematicSeconds('intro', true), INTRO_REDUCED_SECONDS);
  assert.equal(cinematicSeconds('finish', false), FINISH_SECONDS); assert.equal(cinematicSeconds('finish', true), FINISH_REDUCED_SECONDS);
});
test('slow motion covers only the first 0.8 s and never under reduced motion', () => {
  assert.equal(finishTimeScale(0, false), .25); assert.equal(finishTimeScale(.79, false), .25);
  assert.equal(finishTimeScale(.8, false), 1); assert.equal(finishTimeScale(0, true), 1);
});
test('finish swing starts at the chase offset and ends beside the front of the craft', () => {
  const start = finishSwing(0, false), end = finishSwing(5, false);
  assert.ok(Math.abs(start.azimuth - Math.PI) < 1e-9 && start.radius === 8.5 && start.height === 3.5);
  assert.ok(end.azimuth < Math.PI / 2 && end.azimuth > 0);
  assert.equal(finishSwing(5, true).azimuth, Math.PI);
});
test('splash kind decision', () => {
  assert.deepEqual(finishSplash({ rank: null, disqualified: false, isNewBest: false, total: '01:00.000' }), { kind: 'finish', title: 'FINISH', detail: '01:00.000', badge: '' });
  assert.deepEqual(finishSplash({ rank: null, disqualified: false, isNewBest: true, total: '01:00.000' }), { kind: 'best', title: 'FINISH', detail: '01:00.000', badge: 'NEW BEST' });
  assert.deepEqual(finishSplash({ rank: 2, disqualified: false, isNewBest: false, total: 'x' }), { kind: 'rank', title: '2ND', detail: '', badge: '' });
  assert.equal(finishSplash({ rank: 1, disqualified: false, isNewBest: true, total: 'x' }).kind, 'best');
  const failed = finishSplash({ rank: null, disqualified: true, isNewBest: true, total: '02:00.000' });
  assert.deepEqual([failed.kind, failed.title, failed.badge], ['muted', 'FINISH', '']);
  assert.equal(finishSplash({ rank: 3, disqualified: true, isNewBest: false, total: 'x' }).title, 'FINISH');
});
test('intro title card copy', () => {
  assert.deepEqual(introTitle({ district: '네온 주거지', order: 1, name: 'WINDOW RUN', difficulty: '쉬움', laps: 3, field: 6 }),
    { eyebrow: '네온 주거지 · 01', name: 'WINDOW RUN', meta: ['쉬움', '3랩', '6대 출전'] });
  assert.deepEqual(introTitle({ name: 'NEON CIRCUIT', difficulty: '초급', laps: 3 }), { eyebrow: '시험 주행', name: 'NEON CIRCUIT', meta: ['초급', '3랩'] });
});
