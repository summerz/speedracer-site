import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrack } from '../output/test/game/track/createTrack.js';
import { createDrivingModel, NEUTRAL_INPUT } from '../output/test/game/driving/createDrivingModel.js';

const track = createTrack();
test('full road frames remain orthonormal and continuous through vertical poses, inversion and the closed seam', () => {
  let previous = track.sample(-.25), invertedLoop = false, invertedHelix = false;
  for (let d = 0; d < track.length; d += .25) {
    const frame = track.sample(d);
    for (const vector of [frame.tangent, frame.right, frame.up]) {
      assert.ok(vector.toArray().every(Number.isFinite));
      assert.ok(Math.abs(vector.length() - 1) < 1e-8);
    }
    assert.ok(Math.abs(frame.tangent.dot(frame.up)) < 1e-8);
    assert.ok(Math.abs(frame.right.dot(frame.up)) < 1e-8);
    assert.ok(Math.abs(frame.right.dot(frame.tangent)) < 1e-8);
    assert.ok(previous.up.dot(frame.up) > .995, `roll discontinuity at ${d}`);
    assert.ok(previous.tangent.dot(frame.tangent) > .995, `tangent discontinuity at ${d}`);
    if (frame.section === 'vertical-loop' && frame.up.y < -.95) invertedLoop = true;
    if (frame.section === 'helix' && frame.up.y < -.95) invertedHelix = true;
    previous = frame;
  }
  assert.ok(invertedLoop && invertedHelix);
  assert.ok(track.sample(0).up.distanceTo(track.sample(track.length).up) < 1e-8);
});

test('the vertical loop and spring follow automatically while allowing lateral obstacle avoidance', () => {
  for (const kind of ['vertical-loop', 'helix']) {
    const section = track.sections.find(s => s.kind === kind);
    const model = createDrivingModel({ ...track, heightObstacles: [] });
    Object.assign(model.state, { distance: section.start + 10, speed: 55 });
    while (model.state.distance < section.end - 10) model.step(1 / 60, { ...NEUTRAL_INPUT, throttle: true });
    assert.ok(Math.abs(model.state.offset) < 1e-8);
    assert.ok(Math.abs(model.state.heading) < 1e-8);
    assert.equal(model.state.collisions, 0);
    assert.equal(model.state.recoveries, 0);
    Object.assign(model.state, { distance: (section.start + section.end) / 2 });
    model.step(.1, { ...NEUTRAL_INPUT, throttle: true, steer: 1 });
    assert.ok(model.state.offset > 0);
    const frame = track.sample(model.state.distance);
    const position = frame.position.clone().addScaledVector(frame.right, model.state.offset).addScaledVector(frame.up, model.state.altitude);
    assert.ok(Math.abs(position.clone().sub(frame.position).dot(frame.up) - model.state.altitude) < 1e-8);
  }
});

test('separated track passes leave enough space for road width and arches', () => {
  const samples = [];
  for (let d = 0; d < track.length; d += 8) samples.push({ d, position: track.sample(d).position });
  let nearest = Infinity;
  for (let i = 0; i < samples.length; i++) for (let j = i + 1; j < samples.length; j++) {
    const gap = samples[j].d - samples[i].d;
    if (gap < 70 || track.length - gap < 70) continue;
    nearest = Math.min(nearest, samples[i].position.distanceTo(samples[j].position));
  }
  assert.ok(nearest > track.halfWidth * 2 + 12, `separate passes are only ${nearest} m apart`);
});
