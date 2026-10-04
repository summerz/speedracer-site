import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createRacingDrone, DRONE_VARIANTS } from '../output/test/game/drone/createRacingDrone.js';

const weights = THREE.ColorManagement.getLuminanceCoefficients(new THREE.Vector3());
const luminance = c => c.r * weights.x + c.g * weights.y + c.b * weights.z;
for (const variant of DRONE_VARIANTS) {
  test(`${variant.id}: both neon colors cross the Bloom threshold and preserve their hue`, () => {
    const drone = createRacingDrone({ variant: variant.id, neonBoost: 1.6, thrusterIntensity: 1 });
    const { neonMat, accentMat } = drone.userData.materials;
    for (const [material, color] of [[neonMat, variant.neon], [accentMat, variant.accent]]) {
      assert.ok(luminance(material.color) > .9, 'default neon must be visible to the Bloom high-pass');
      assert.equal(material.toneMapped, false);
      const before = new THREE.Vector3().setFromColor(new THREE.Color(color)).normalize();
      const after = new THREE.Vector3().setFromColor(material.color).normalize();
      assert.ok(before.distanceTo(after) < 1e-10, 'brightness compensation must not tint the craft');
    }
  });
}
