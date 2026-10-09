import test from 'node:test';
import assert from 'node:assert/strict';
import { hazardEdgeAlert } from '../output/test/game/driving/hazardEdgeAlert.js';

const run = args => hazardEdgeAlert({ corridor: null, arcRail: null, speed: 10, ...args });
const rail = (distance, side, safe = false) => ({ arcRail: { distance, side, safe } });
const corr = (distance, lane, safe = false) => ({ corridor: { distance, lane, safe } });

test('nothing without a guide', () => assert.deepEqual(run({}), { left: null, right: null, arrow: null }));
test('window is max(120, speed*3) ahead', () => {
  assert.equal(run(rail(130, 1)).right, null);
  assert.equal(run(rail(110, 1)).right?.level, 'warn');
  assert.equal(run({ ...rail(130, 1), speed: 50 }).right?.level, 'warn');
  assert.equal(run(corr(125, 'left')).right, null);
});
test('rail lights the danger side with rail tone and points to the opposite side', () => {
  assert.deepEqual(run(rail(100, 1)), { left: null, right: { tone: 'rail', level: 'warn' }, arrow: 'left' });
  assert.deepEqual(run(rail(100, -1)), { left: { tone: 'rail', level: 'warn' }, right: null, arrow: 'right' });
});
test('corridor lights every blocked side; arrow to the open lane, none for center', () => {
  const c = { tone: 'corridor', level: 'warn' };
  assert.deepEqual(run(corr(100, 'left')), { left: null, right: c, arrow: 'left' });
  assert.deepEqual(run(corr(100, 'right')), { left: c, right: null, arrow: 'right' });
  assert.deepEqual(run(corr(100, 'center')), { left: c, right: c, arrow: null });
});
test('danger when unsafe and close or inside; calm and no arrow when safe', () => {
  assert.equal(run(rail(34, 1)).right.level, 'danger');
  assert.equal(run(rail(36, 1)).right.level, 'warn');
  assert.equal(run({ ...rail(60, 1), speed: 60 }).right.level, 'danger');
  assert.equal(run(rail(0, 1)).right.level, 'danger');
  assert.equal(run(corr(-3, 'left')).right.level, 'danger');
  assert.deepEqual(run(rail(10, 1, true)), { left: null, right: { tone: 'rail', level: 'calm' }, arrow: null });
  assert.deepEqual(run(corr(10, 'left', true)).arrow, null);
});
test('arc rail wins a shared edge and the arrow', () => {
  const r = run({ ...rail(100, 1), ...corr(100, 'left') });
  assert.deepEqual(r.right, { tone: 'rail', level: 'warn' });
  assert.deepEqual(r.arrow, 'left');
  const both = run({ ...rail(100, -1), ...corr(100, 'center') });
  assert.equal(both.left.tone, 'rail'); assert.equal(both.right.tone, 'corridor');
});
