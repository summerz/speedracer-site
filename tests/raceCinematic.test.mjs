import test from 'node:test';
import assert from 'node:assert/strict';
import { FINISH_REDUCED_SECONDS, FINISH_SECONDS, INTRO_REDUCED_SECONDS, INTRO_SECONDS, REPLAY_SHOTS, SHOWCASE_MAX, cinematicSeconds, ease, finishSplash, finishSwing, finishTimeScale, introProgress, introTitle, ordinal, replayShot, showcaseAt, showcasePlan } from '../output/test/game/driving/raceCinematic.js';

test('ordinals handle the teen exceptions', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal), ['1ST', '2ND', '3RD', '4TH', '11TH', '12TH', '13TH', '21ST', '22ND', '23RD', '101ST', '111TH']);
});
test('intro progress is monotonic, eased and reaches exactly the chase pose', () => {
  assert.equal(introProgress(0), 0); assert.equal(introProgress(INTRO_SECONDS), 1); assert.equal(introProgress(99), 1);
  let last = 0; for (let t = 0; t <= INTRO_SECONDS; t += .1) { const s = introProgress(t); assert.ok(s >= last); last = s; }
  assert.ok(ease(.1) < .1 && ease(.9) > .9 && ease(.5) === .5);
});
test('durations follow the spec and shrink under reduced motion', () => {
  assert.equal(cinematicSeconds('intro', false), INTRO_SECONDS + 2.2); assert.equal(cinematicSeconds('intro', false, 7), INTRO_SECONDS + showcasePlan(7, false).total); assert.equal(cinematicSeconds('intro', true), INTRO_REDUCED_SECONDS);
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

test('showcase: time attack is one 2.2 s player shot, reduced motion has none', () => {
  const plan = showcasePlan(0, false);
  assert.deepEqual(plan, { shots: [{ kind: 'player', index: 0, start: 0, duration: 2.2 }], total: 2.2 });
  assert.deepEqual(showcasePlan(7, true), { shots: [], total: 0 }); assert.equal(showcaseAt(showcasePlan(7, true), 1), null);
});
test('showcase: competition is 2 s player then 0.7 s per nearest rival, capped near 6.5 s', () => {
  const few = showcasePlan(3, false);
  assert.deepEqual(few.shots.map(s => [s.kind, s.index, +s.start.toFixed(2), +s.duration.toFixed(2)]), [['player', 0, 0, 2], ['rival', 0, 2, .7], ['rival', 1, 2.7, .7], ['rival', 2, 3.4, .7]]);
  assert.ok(Math.abs(few.total - 4.1) < 1e-9);
  const full = showcasePlan(7, false);
  assert.equal(full.shots.filter(s => s.kind === 'rival').length, 6); assert.deepEqual(full.shots.filter(s => s.kind === 'rival').map(s => s.index), [0, 1, 2, 3, 4, 5]);
  assert.ok(full.total <= SHOWCASE_MAX + 1e-9 && full.total > SHOWCASE_MAX - .7);
  for (let i = 1; i < full.shots.length; i++) assert.ok(Math.abs(full.shots[i].start - (full.shots[i - 1].start + full.shots[i - 1].duration)) < 1e-9);
});
test('showcaseAt picks the shot, local progress and a blend only in the last half second', () => {
  const plan = showcasePlan(7, false);
  assert.deepEqual({ ...showcaseAt(plan, 0) }, { shot: 0, u: 0, blend: 0 });
  assert.equal(showcaseAt(plan, 1.99).shot, 0); assert.equal(showcaseAt(plan, 2).shot, 1); assert.ok(Math.abs(showcaseAt(plan, 2.35).u - .5) < 1e-9);
  assert.equal(showcaseAt(plan, plan.total - .51).blend, 0);
  const end = showcaseAt(plan, plan.total); assert.equal(end.shot, plan.shots.length - 1); assert.equal(end.u, 1); assert.equal(end.blend, 1);
  assert.ok(showcaseAt(plan, plan.total - .25).blend > .4);
  assert.equal(showcaseAt(plan, 99).shot, plan.shots.length - 1);
});
test('replay shots: one full pass per shot, hard cut, then repeat', () => {
  assert.equal(REPLAY_SHOTS, 3);
  assert.deepEqual({ ...replayShot(0, 3.5) }, { shot: 0, u: 0, v: .4 });
  assert.equal(replayShot(3.49, 3.5).shot, 0); assert.ok(replayShot(3.49, 3.5).u > .99);
  assert.deepEqual({ ...replayShot(3.5, 3.5) }, { shot: 1, u: 0, v: 0 });
  assert.equal(replayShot(7.1, 3.5).shot, 2); assert.equal(replayShot(10.6, 3.5).shot, 0);
  assert.deepEqual({ ...replayShot(-1, 3.5) }, { shot: 0, u: 0, v: .4 });
  const out = { shot: 0, u: 0, v: 0 }; assert.equal(replayShot(5.25, 3.5, out), out); assert.equal(out.shot, 1); assert.ok(Math.abs(out.u - .5) < 1e-9 && Math.abs(out.v - .5) < 1e-9);
  assert.ok(Math.abs(replayShot(1.75, 3.5).v - .7) < 1e-9); assert.ok(replayShot(3.49, 3.5).v > .99); assert.ok(Math.abs(replayShot(8.75, 3.5).v - .5) < 1e-9);
});
