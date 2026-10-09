import test from 'node:test';
import assert from 'node:assert/strict';
import { REPLAY_SECONDS, createReplayBuffer } from '../output/test/game/driving/raceReplay.js';

const pose = () => ({ x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, speed: 0, mode: 0 });
const fill = (buffer, seconds, hz = 60) => { for (let i = 0; i <= seconds * hz; i++) { const t = i / hz; buffer.record(t, t * 10, 1, 0, 0, 0, 0, 1, t * 5, t > 2 ? 2 : 1); } };

test('empty or single-sample buffers have nothing to replay', () => {
  const buffer = createReplayBuffer(); assert.equal(buffer.seconds(), 0); assert.equal(buffer.sample(.5, pose()), null);
  buffer.record(0, 0, 0, 0, 0, 0, 0, 1, 0, 0); assert.equal(buffer.sample(.5, pose()), null);
});
test('keeps only the last REPLAY_SECONDS and interpolates positions linearly', () => {
  const buffer = createReplayBuffer(); fill(buffer, 8);
  assert.ok(Math.abs(buffer.seconds() - REPLAY_SECONDS) < 1e-6);
  const out = pose(); buffer.sample(1, out); assert.ok(Math.abs(out.x - 80) < 1e-3);
  buffer.sample(0, out); assert.ok(Math.abs(out.x - (8 - REPLAY_SECONDS) * 10) < 1e-2);
  buffer.sample(.5, out); assert.ok(Math.abs(out.x - (8 - REPLAY_SECONDS / 2) * 10) < 1e-2); assert.ok(Math.abs(out.speed - (8 - REPLAY_SECONDS / 2) * 5) < 1e-2);
});
test('rate limiting drops dense samples but force keeps the final pose', () => {
  const buffer = createReplayBuffer(); buffer.record(0, 0, 0, 0, 0, 0, 0, 1, 0, 0); buffer.record(.001, 5, 0, 0, 0, 0, 0, 1, 0, 0);
  assert.equal(buffer.seconds(), 0); buffer.record(.002, 9, 0, 0, 0, 0, 0, 1, 0, 0, true);
  const out = pose(); buffer.sample(1, out); assert.ok(Math.abs(out.x - 9) < 1e-4);
});
test('wrap-around keeps ordering and reset empties the buffer', () => {
  const buffer = createReplayBuffer(32); fill(buffer, 4);
  const out = pose(); let last = -Infinity; for (let u = 0; u <= 1; u += .1) { buffer.sample(u, out); assert.ok(out.x >= last); last = out.x; }
  buffer.reset(); assert.equal(buffer.seconds(), 0); assert.equal(buffer.sample(0, out), null);
});
test('quaternions interpolate along the short arc and stay unit length', () => {
  const buffer = createReplayBuffer(); buffer.record(0, 0, 0, 0, 0, 0, 0, 1, 0, 0); buffer.record(1, 0, 0, 0, 0, 0, 0, -1, 0, 0);
  const out = pose(); buffer.sample(.5, out); assert.ok(Math.abs(Math.hypot(out.qx, out.qy, out.qz, out.qw) - 1) < 1e-6); assert.ok(Math.abs(out.qw) > .99);
});
test('thrust mode follows the earlier sample', () => {
  const buffer = createReplayBuffer(); fill(buffer, 3.5); const out = pose();
  buffer.sample(0, out); assert.equal(out.mode, 1); buffer.sample(1, out); assert.equal(out.mode, 2);
});
