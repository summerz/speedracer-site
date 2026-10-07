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

test('boost swipes ignore jitter and change one altitude step while boost stays held', () => {
  const input = createTouchInput(); input.pressBoost(2, 100);
  for (const y of [95, 109, 80, 73]) assert.equal(input.moveBoost(2, y), 0);
  assert.equal(input.moveBoost(2, 72), 1);
  for (const y of [65, 50, 75, 120, 145]) assert.equal(input.moveBoost(2, y), 0);
  assert.equal(input.boostDirection, 1);
  assert.equal(input.read(true).boost, true);
  assert.equal(input.release(2), true);
  assert.equal(input.boostDirection, 0);
  assert.equal(input.read(true).boost, false);
});

test('returning to the press center rearms the next up or down altitude step', () => {
  const input = createTouchInput(); input.pressBoost(2, 200);
  assert.equal(input.moveBoost(2, 160), 1);
  assert.equal(input.moveBoost(2, 189), 0);
  assert.equal(input.boostDirection, 1);
  assert.equal(input.moveBoost(2, 190), 0);
  assert.equal(input.boostDirection, 0);
  assert.equal(input.moveBoost(2, 160), 1);
  input.moveBoost(2, 200);
  assert.equal(input.moveBoost(2, 228), -1);
  assert.equal(input.moveBoost(2, 260), 0);
  assert.equal(input.read(true).boost, true);
});

test('boost swipe and steering fingers remain independent, cancellation clears the gesture', () => {
  const input = createTouchInput(); input.pressStick(1); input.pressBoost(2, 100);
  input.moveStick(1, -40, 40, 40);
  const steering = input.read(true);
  assert.equal(input.moveBoost(1, 50), 0);
  assert.equal(input.moveBoost(2, 60), 1);
  assert.deepEqual(input.read(true), steering);
  assert.equal(steering.brake, true); assert.ok(steering.steer < -.6);
  assert.equal(input.release(1), false);
  assert.equal(input.boostDirection, 1);
  input.reset();
  assert.equal(input.moveBoost(2, 100), 0);
  assert.equal(input.boostDirection, 0);
  input.pressBoost(3, 500);
  assert.equal(input.moveBoost(3, 530), -1);
});
