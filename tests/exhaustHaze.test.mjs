import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createRacingDrone, DRONE_VARIANTS } from '../output/test/game/drone/createRacingDrone.js';
import { createExhaustHaze } from '../output/test/game/driving/createExhaustHaze.js';

test('all five boost plumes stay in front of the close chase camera; cockpit and reduced motion suppress haze', () => {
  for (const variant of DRONE_VARIANTS) {
    const drone = createRacingDrone({ variant: variant.id });
    const camera = new THREE.PerspectiveCamera(80, 16 / 9, .1, 1100);
    camera.position.set(0, 2.2, 5.4); camera.lookAt(0, -.5, -9);
    const haze = createExhaustHaze(drone, camera);
    haze.setEnabled(true);
    for (const stage of [0, 1, 2]) {
      haze.update(1, stage, true, false, false);
      assert.equal(haze.pass.enabled, true, `${variant.id}: stage ${stage}`);
      assert.ok(haze.pass.uniforms.radii.value.toArray().every(r => r > 0 && Number.isFinite(r)));
    }
    for (const [active, cockpit, reduced] of [[false, false, false], [true, true, false], [true, false, true]]) {
      haze.update(1, 2, active, cockpit, reduced);
      assert.equal(haze.pass.enabled, false);
    }
    haze.pass.dispose();
    const geometries = new Set(), materials = new Set();
    drone.traverse(o => { if (o.isMesh) { geometries.add(o.geometry); materials.add(o.material); } });
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
  }
});
