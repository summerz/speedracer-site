import test from 'node:test';
import assert from 'node:assert/strict';
import { createTouchInput, joystickPosition } from '../output/test/game/driving/touchInput.js';

test('joystick diagonals steer and brake together, upper diagonals keep auto throttle', () => {
  for (const x of [-40, 40]) {
    const input = createTouchInput(); input.pressStick(1); input.moveStick(1, x, 40, 40);
    assert.equal(input.read(true).brake, true); assert.equal(input.read(true).throttle, false);
    assert.equal(Math.sign(input.read(true).steer), Math.sign(x));
    input.moveStick(1, x, -40, 40);
    assert.equal(input.read(true).brake, false); assert.equal(input.read(true).throttle, true);
    assert.equal(Math.sign(input.read(true).steer), Math.sign(x));
  }
});
test('dragging outside clamps to the circle, with a neutral center', () => {
  assert.equal(joystickPosition(500, 0, 40).steer, 1);
  assert.equal(joystickPosition(-500, 0, 40).steer, -1);
  assert.equal(joystickPosition(2, 0, 40).steer, 0);
  const point = joystickPosition(500, 500, 40);
  assert.ok(Math.abs(Math.hypot(point.x, point.y) - 1) < 1e-10);
});
test('release outside the stick clears steer and brake without releasing a second boost finger', () => {
  const input = createTouchInput(); input.pressStick(1); input.moveStick(1, -40, 40, 40); input.pressBoost(2);
  assert.equal(input.release(1), false);
  assert.deepEqual(input.read(true), { throttle:true, brake:false, steer:0, boost:true });
  assert.equal(input.release(2), true); assert.equal(input.read(true).boost, false);
});
test('second finger cannot take over stick, and releasing boost does not reset steering', () => {
  const input = createTouchInput(); assert.equal(input.pressStick(1), true); assert.equal(input.pressStick(3), false);
  input.moveStick(1, 40, 0, 40); input.moveStick(3, -40, 0, 40); input.pressBoost(2);
  input.release(3); input.release(2);
  assert.equal(input.read(true).steer, 1);
});
test('pause/cancel/reset returns every input to neutral, subsequent touches work', () => {
  const input = createTouchInput(); input.pressStick(4); input.moveStick(4, -40, 40, 40); input.pressBoost(5);
  assert.deepEqual(input.read(false), { throttle:false, brake:false, steer:0, boost:false });
  input.reset(); assert.deepEqual(input.read(true), { throttle:true, brake:false, steer:0, boost:false });
  assert.equal(input.pressStick(6), true);
});

test('one continuous boost drag selects every altitude without recentering, holding stays stable', () => {
  const input = createTouchInput(); input.pressBoost(2, 300, 0, 4, 150, 450);
  for (const y of [295, 310, 280]) assert.equal(input.moveBoost(2, y), undefined);
  assert.equal(input.moveBoost(2, 250), 1);
  assert.equal(input.moveBoost(2, 200), 2);
  assert.equal(input.moveBoost(2, 150), 3);
  for (let i = 0; i < 10; i++) assert.equal(input.moveBoost(2, 150), undefined);
  assert.equal(input.boostDirection, 1);
  assert.equal(input.read(true).boost, true);
  assert.equal(input.release(2), true);
  assert.equal(input.boostPosition, null);
  assert.equal(input.read(true).boost, false);
});

test('a fast drag selects the final level directly, clamps outside and works down from the highest level', () => {
  for (const count of [2, 3, 4, 6, 12]) {
    const input = createTouchInput(); input.pressBoost(2, 300, 0, count, 150, 450);
    assert.equal(input.moveBoost(2, -1000), count - 1);
    assert.equal(input.moveBoost(2, -2000), undefined);
    assert.equal(input.boostPosition, 0);
    input.release(2);
    input.pressBoost(3, 300, count - 1, count, 150, 450);
    assert.equal(input.moveBoost(3, 1000), 0);
    assert.equal(input.boostPosition, 1);
  }
});

test('selection is anchored to the pressed altitude and moving back selects earlier levels', () => {
  const input = createTouchInput(); input.pressBoost(2, 300, 1, 4, 150, 450);
  assert.equal(input.moveBoost(2, 200), 3);
  assert.equal(input.moveBoost(2, 250), 2);
  assert.equal(input.moveBoost(2, 300), 1);
  assert.equal(input.moveBoost(2, 350), 0);
  assert.equal(input.boostDirection, -1);
});

test('small jitter at a selection boundary does not repeatedly toggle altitude', () => {
  const input = createTouchInput(); input.pressBoost(2, 300, 0, 4, 150, 450);
  assert.equal(input.moveBoost(2, 250), 1);
  assert.equal(input.moveBoost(2, 210), 2);
  for (const y of [214, 220, 216, 223, 219]) assert.equal(input.moveBoost(2, y), undefined);
  assert.equal(input.moveBoost(2, 230), 1);
  for (const y of [223, 216, 220]) assert.equal(input.moveBoost(2, y), undefined);
});

test('steering and boost fingers are independent; another boost finger cannot take over or release the gesture', () => {
  const input = createTouchInput(); input.pressStick(1);
  assert.equal(input.pressBoost(2, 300, 0, 4, 150, 450), true);
  input.moveStick(1, -40, 40, 40);
  const steering = input.read(true);
  assert.equal(input.pressBoost(3, 300, 0, 4, 150, 450), false);
  assert.equal(input.moveBoost(1, 150), undefined);
  assert.equal(input.moveBoost(3, 150), undefined);
  assert.equal(input.release(3), false);
  assert.equal(input.moveBoost(2, 150), 3);
  assert.deepEqual(input.read(true), steering);
  assert.equal(input.release(1), false);
  assert.equal(input.read(true).boost, true);
  input.reset();
  assert.equal(input.moveBoost(2, 300), undefined);
  assert.equal(input.boostDirection, 0);
  assert.equal(input.pressBoost(4, 300, 2, 3, 150, 450), true);
  assert.equal(input.moveBoost(4, 450), 0);
});
