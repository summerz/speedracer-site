import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DIFFICULTIES } from '../output/test/game/track/difficulty.js';
import { createTrack } from '../output/test/game/track/createTrack.js';
import { createDrivingModel, NEUTRAL_INPUT } from '../output/test/game/driving/createDrivingModel.js';
import { DEFAULT_DRONE_CONFIGURATION } from '../output/test/game/drone/droneConfiguration.js';
import { overviewPose } from '../output/test/game/driving/createRaceViews.js';
const tracks = Object.values(DIFFICULTIES).map(p => createTrack(undefined, p));

test('difficulty changes physical layout and reachable obstacle demands, preserving default craft speed', () => {
  assert.deepEqual(tracks.map(t => t.halfWidth), [14, 11, 9]);
  assert.ok(tracks[0].length < tracks[1].length && tracks[1].length < tracks[2].length);
  for (const [i, track] of tracks.entries()) {
    assert.equal(track.altitudeProfile.levels.length, i + 2);
    assert.ok(track.heightObstacles.length > [6, 8, 12][i]);
    for (const obstacle of track.heightObstacles) {
      assert.ok(track.altitudeProfile.levels.some(h => h >= obstacle.minAltitude && h <= obstacle.maxAltitude));
    }
    const model = createDrivingModel({ ...track, heightObstacles: [], sample: () => ({ curvature: 0 }) });
    for (let n = 0; n < 600; n++) model.step(1 / 60, { ...NEUTRAL_INPUT, throttle: true });
    assert.ok(Math.abs(model.state.speed - DEFAULT_DRONE_CONFIGURATION.performance.topSpeed) < .001);
  }
  assert.equal(tracks[0].heightObstacles.some(o => o.kind === 'middle'), false);
  assert.ok(tracks[1].heightObstacles.some(o => o.kind === 'middle'));
  assert.equal(new Set(tracks[2].heightObstacles.filter(o => o.kind === 'middle').map(o => o.minAltitude)).size, 2);
});

for (const [index, track] of tracks.entries()) {
  test(`${Object.keys(DIFFICULTIES)[index]} has continuous closed frames and separated track passes`, () => {
    let previous = track.sample(-.5);
    const samples = [];
    for (let d = 0; d < track.length; d += .5) {
      const f = track.sample(d);
      assert.ok(f.up.toArray().every(Number.isFinite));
      assert.ok(previous.up.dot(f.up) > .98, `roll at ${d}`);
      assert.ok(previous.tangent.dot(f.tangent) > .98, `heading at ${d}`);
      if (d % 8 === 0) samples.push({ d, position: f.position.clone() });
      previous = f;
    }
    for (let i = 0; i < samples.length; i++) for (let j = i + 1; j < samples.length; j++) {
      const gap = samples[j].d - samples[i].d;
      if (gap < 90 || track.length - gap < 90) continue;
      assert.ok(samples[i].position.distanceTo(samples[j].position) > track.halfWidth * 2 + 8);
    }
    assert.ok(track.sample(track.length).up.distanceTo(track.sample(0).up) < 1e-8);
  });
}

test('middle passage accepts its safe level and penalizes both lower and upper levels once', () => {
  const track = tracks[1]; const obstacle = track.heightObstacles.find(o => o.kind === 'middle');
  const straight = { ...track, heightObstacles: [obstacle], sample: () => ({ curvature: 0 }) };
  for (const altitude of [1.8, 4, 6.2]) {
    const model = createDrivingModel(straight);
    Object.assign(model.state, { distance: obstacle.distance - 8, speed: 55, altitude, targetAltitude: altitude });
    for (let i = 0; i < 60; i++) model.step(1 / 60, { ...NEUTRAL_INPUT, throttle: true });
    assert.equal(model.state.collisions, altitude === 4 ? 0 : 1);
    assert.ok(model.state.distance > obstacle.distance + 5);
  }
});

test('overview contains the entire track at wide and narrow viewport sizes', () => {
  for (const track of tracks) for (const aspect of [16 / 9, 9 / 16, 1]) {
    const pose = overviewPose(track, aspect);
    const camera = new THREE.PerspectiveCamera(50, aspect, .1, 10000);
    camera.position.copy(pose.position); camera.lookAt(pose.center); camera.updateMatrixWorld();
    for (let d = 0; d < track.length; d += 4) {
      const projected = track.sample(d).position.project(camera);
      assert.ok(Math.abs(projected.x) < .95 && Math.abs(projected.y) < .95 && projected.z < 1);
    }
  }
});
