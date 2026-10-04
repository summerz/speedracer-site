import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createRaceViews, raceViewLayout, overviewPose } from '../output/test/game/driving/createRaceViews.js';
import { createTrack } from '../output/test/game/track/createTrack.js';
import { DIFFICULTIES } from '../output/test/game/track/difficulty.js';
import { DEFAULT_DRONE_CONFIGURATION } from '../output/test/game/drone/droneConfiguration.js';
import { createDrivingModel, NEUTRAL_INPUT } from '../output/test/game/driving/createDrivingModel.js';

const track = createTrack(undefined, DIFFICULTIES.intermediate);
test('cockpit choice survives the three track layouts and each camera gets its own scene visibility', () => {
  const camera = new THREE.PerspectiveCamera(65, 1, .1, 1100);
  const drone = new THREE.Group(), mount = new THREE.Object3D(), canopy = new THREE.Object3D();
  mount.name = 'cockpitCameraMount'; canopy.name = 'canopy'; drone.add(mount, canopy);
  const scene = new THREE.Scene(); scene.add(drone, camera); scene.fog = new THREE.FogExp2(0, .01);
  const fog = scene.fog;
  const views = createRaceViews(camera, drone, scene, track);
  views.toggleCockpit();
  for (const expected of ['pip', 'primary', 'hidden']) {
    assert.equal(views.cycleTrack(), expected); assert.equal(views.view, 'cockpit');
    views.prepareOverview(); assert.equal(scene.fog, null); assert.equal(canopy.visible, true);
    assert.equal(scene.getObjectByName('overviewPlayer').visible, true);
    views.prepareDriving(); assert.equal(scene.fog, fog); assert.equal(canopy.visible, false);
    assert.equal(camera.getObjectByName('cockpitInstruments').visible, true);
    assert.equal(scene.getObjectByName('overviewPlayer').visible, false);
  }
  views.toggleCockpit(); assert.equal(views.view, 'chase');
});

test('PIP stays inside desktop, portrait and short landscape screens; swapping preserves viewport sizes', () => {
  for (const [width, height] of [[1440, 900], [375, 800], [900, 600], [844, 390]]) {
    const pip = raceViewLayout(width, height, 'pip'), primary = raceViewLayout(width, height, 'primary');
    for (const rect of [pip.driving, pip.track, primary.driving, primary.track]) {
      assert.ok(rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0);
      assert.ok(rect.x + rect.width <= width && rect.y + rect.height <= height);
    }
    assert.deepEqual(pip.track, primary.driving); assert.deepEqual(pip.driving, primary.track);
    const aspect = pip.track.width / pip.track.height;
    const pose = overviewPose(track, aspect), camera = new THREE.PerspectiveCamera(50, aspect, .1, 10000);
    camera.position.copy(pose.position); camera.lookAt(pose.center); camera.updateMatrixWorld();
    for (let d = 0; d < track.length; d += 16) {
      const point = track.sample(d).position.clone().project(camera);
      assert.ok(Math.abs(point.x) < 1 && Math.abs(point.y) < 1);
    }
  }
});

test('a sharp real track corner requires slowing down, even with curvature-aware steering', () => {
  const driveCorner = (targetSpeed) => {
    const model = createDrivingModel({ ...track, heightObstacles: [] });
    Object.assign(model.state, { distance: 880, speed: targetSpeed, altitude: 6.2, targetAltitude: 6.2, altitudeLevel: 2 });
    for (let i = 0; i < 800 && model.state.distance < 1100 && model.state.recoveries === 0; i++) {
      const s = model.state;
      const loss = 1 + s.speed * .006 + Math.max(0, s.speed - DEFAULT_DRONE_CONFIGURATION.performance.corneringReferenceSpeed) ** 2 * DEFAULT_DRONE_CONFIGURATION.performance.highSpeedSteeringLoss;
      const wanted = (track.sample(s.distance).curvature * s.speed - s.heading * 4 - s.offset * .1) * loss / DEFAULT_DRONE_CONFIGURATION.performance.maxYawRate;
      model.step(1 / 120, { ...NEUTRAL_INPUT, throttle: s.speed < targetSpeed, brake: s.speed > targetSpeed + 1, steer: Math.max(-1, Math.min(1, wanted)) });
    }
    return model.state;
  };
  assert.equal(driveCorner(85).recoveries, 1, 'full cruise speed leaves the track');
  const slowed = driveCorner(45); assert.equal(slowed.recoveries, 0); assert.equal(slowed.collisions, 0);
  assert.ok(slowed.distance >= 1100, 'braking allows the corner to be completed');
});
