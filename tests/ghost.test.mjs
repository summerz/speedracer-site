import test from 'node:test';
import assert from 'node:assert/strict';
import { GHOST_MAX_BYTES, createGhostRecorder, formatDelta, ghostDelta, ghostKey, loadGhost, parseGhost, poseAtTime, quantize, saveGhost, serializeGhost, shouldSaveGhost, timeAtDistance } from '../output/test/game/driving/raceGhost.js';

const st = (elapsed, speed = 50, extra = {}) => ({ elapsed, distance: elapsed * speed, offset: Math.sin(elapsed) * 3.14159, altitude: 4.5, heading: .0123456, routeId: null, ...extra });
const record = (seconds, speed = 50) => { const r = createGhostRecorder(); for (let t = 0; t <= seconds; t += 1 / 60) r.sample(st(t, speed)); return r.finish(st(seconds, speed), seconds, seconds * speed); };
const memory = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), m }; };

test('recorder samples at 10 Hz and quantizes to 2 decimals', () => {
  const g = record(10);
  assert.ok(g.s.length >= 100 && g.s.length <= 103);
  assert.ok(g.s.every(p => p.every(n => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6)));
  assert.equal(quantize(1.006), 1.01);
  assert.deepEqual(g.s.at(-1).slice(0, 2), [10, 500]);
});
test('recorder keeps route ids by index and resets', () => {
  const r = createGhostRecorder(); r.sample(st(0, 50, { routeId: 'a' })); r.sample(st(.2, 50, { routeId: 'b' }));
  const g = r.finish(st(.3, 50, { routeId: 'b' }), .3, 15);
  assert.deepEqual(g.routes, ['a', 'b']); assert.deepEqual(g.s.map(p => p[5]), [0, 1, 1]);
  r.reset(); assert.equal(r.finish(st(0), 0, 0).s.length, 1);
});
test('serialize round-trips and rejects broken payloads', () => {
  const g = record(5); assert.deepEqual(parseGhost(serializeGhost(g)), g);
  for (const bad of [null, '', '{', '{}', JSON.stringify({ ...g, v: 2 }), JSON.stringify({ ...g, s: [] }), JSON.stringify({ ...g, s: [[1, 1, 1, 1, 1, 9], [2, 2, 2, 2, 2, 0]] }),
    JSON.stringify({ ...g, s: [[2, 5, 0, 0, 0, 0], [1, 6, 0, 0, 0, 0]] })]) assert.equal(parseGhost(bad), null);
});
test('time at distance interpolates, clamps the start and returns null past the finish', () => {
  const g = record(10, 50);
  assert.ok(Math.abs(timeAtDistance(g, 250) - 5) < .02); assert.ok(Math.abs(timeAtDistance(g, 123.4) - 2.468) < .02);
  assert.equal(timeAtDistance(g, -5), 0); assert.equal(timeAtDistance(g, 501), null);
  assert.ok(Math.abs(ghostDelta(g, 5.31, 250) - .31) < .02); assert.ok(ghostDelta(g, 4.69, 250) < 0);
});
test('pose at time interpolates and parks at the finish', () => {
  const g = record(10, 50), mid = poseAtTime(g, 4.55);
  assert.ok(Math.abs(mid.distance - 227.5) < .1 && !mid.finished && mid.routeId === null);
  assert.ok(poseAtTime(g, 10).finished && poseAtTime(g, 99).distance === 500 && poseAtTime(g, -1).distance === 0);
});
test('delta formatting uses a true minus when ahead', () => {
  assert.deepEqual(formatDelta(-.31), { text: '−0.31', ahead: true });
  assert.deepEqual(formatDelta(.42), { text: '+0.42', ahead: false });
  assert.deepEqual(formatDelta(-.001), { text: '+0.00', ahead: false });
});
test('save decision: only a clean new best in time attack', () => {
  const base = { mode: 'time-attack', disqualified: false, isNewBest: true };
  assert.equal(shouldSaveGhost(base), true);
  assert.equal(shouldSaveGhost({ ...base, isNewBest: false }), false);
  assert.equal(shouldSaveGhost({ ...base, disqualified: true }), false);
  assert.equal(shouldSaveGhost({ ...base, mode: 'competition' }), false);
});
test('ghost key combines track and challenge', () => assert.equal(ghostKey('window-run:v1', 'easy'), 'speedracer-ghost:window-run:v1:easy'));
test('a synthetic 3-lap recording stays under the size budget', () => {
  const g = record(180, 62), text = serializeGhost(g); console.log(`3-lap ghost: ${g.s.length} samples, ${text.length} bytes`);
  assert.ok(text.length < GHOST_MAX_BYTES);
  const s = memory(); assert.equal(saveGhost(s, 'k', g), true); assert.deepEqual(loadGhost(s, 'k'), g);
});
test('oversized ghosts are not stored', () => assert.equal(saveGhost(memory(), 'k', record(900, 60)), false));
test('storage that throws never breaks save or load', () => {
  const boom = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
  assert.equal(saveGhost(boom, 'k', record(5)), false); assert.equal(loadGhost(boom, 'k'), null);
  assert.equal(saveGhost(undefined, 'k', record(5)), false); assert.equal(loadGhost(undefined, 'k'), null);
  assert.equal(loadGhost({ getItem: () => 'garbage', setItem() {} }, 'k'), null);
});
