import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrack, createTrackVisual } from '../output/test/game/track/createTrack.js';
import { createRaceGates } from '../output/test/game/track/createRaceGates.js';
import { altitudeCanPass } from '../output/test/game/track/altitudeProfile.js';
import { DIFFICULTIES } from '../output/test/game/track/difficulty.js';

test('checkpoint decorations contain only arches, and leave electrical obstacles clear', () => {
  const track = createTrack(undefined, DIFFICULTIES.intermediate);
  const gates = createRaceGates(track, 24);
  assert.equal(gates.object.children.filter(child => child.name.startsWith('Start arch')).length, 4);
  for (const child of gates.object.children) {
    assert.equal(child.geometry.type, 'TorusGeometry');
    if (!child.name.startsWith('Checkpoint arch')) continue;
    const index = Number(child.name.split(' ').at(-1));
    const distance = index * track.length / 24;
    assert.ok(track.heightObstacles.every(obstacle => Math.abs(distance - obstacle.distance) >= obstacle.depth / 2 + 18));
  }
});

test('upcoming electrical fields show physical passability, update mid-transition, and clear after passage', () => {
  const track = createTrack(undefined, DIFFICULTIES.intermediate);
  const visual = createTrackVisual(track);
  const obstacle = track.heightObstacles.find(o => o.kind === 'middle');
  const barrier = visual.object.children.find(child => child.name === 'middleDischargeBarrier');
  const readiness = () => barrier.children.map(child => child.userData.readiness);
  visual.update(1, false, obstacle.distance - 60, track.altitudeProfile.levels[0], 85);
  assert.deepEqual(readiness(), ['blocked', 'blocked']);
  visual.update(2, false, obstacle.distance - 60, obstacle.minAltitude, 85);
  assert.deepEqual(readiness(), ['ready', 'ready']);
  visual.update(3, false, obstacle.distance - 60, obstacle.maxAltitude + .01, 85);
  assert.deepEqual(readiness(), ['blocked', 'blocked']);
  visual.update(4, false, obstacle.distance + obstacle.depth / 2 + 3, obstacle.minAltitude, 85);
  assert.deepEqual(readiness(), ['neutral', 'neutral']);
  const firstObstacle = track.heightObstacles[0];
  const firstBarrier = visual.object.children.find(child => child.name === 'dischargeBarrier');
  visual.update(5, false, track.length - 20, firstObstacle.minAltitude, 85);
  assert.equal(firstBarrier.userData.readiness ?? firstBarrier.children[0].userData.readiness, 'ready');
  assert.equal(altitudeCanPass(obstacle.maxAltitude, obstacle), true);
  assert.equal(altitudeCanPass(obstacle.minAltitude - .01, obstacle), false);
});
