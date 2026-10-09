import * as THREE from 'three';
import { createTrackFrame, type Track } from '../track/createTrack.js';
import type { createDrivingModel } from './createDrivingModel.js';

/** Gold, faceted cores are distinct from the mint plates and round boost rings. */
export function createAwakeningCoreVisual(track: Track, model: ReturnType<typeof createDrivingModel>) {
  const object = new THREE.Group(); object.name = 'awakening-cores';
  const crystal = new THREE.OctahedronGeometry(1.2);
  const ring = new THREE.TorusGeometry(1.9, .06, 6, 32);
  const stem = new THREE.CylinderGeometry(.035, .035, 1, 4);
  const gold = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd46a').multiplyScalar(1.65), toneMapped: false });
  const body = new THREE.MeshStandardMaterial({ color: '#c38b22', emissive: '#ffd46a', emissiveIntensity: .8, metalness: .65, roughness: .25 });
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64;
  const context = canvas.getContext('2d')!;
  context.font = 'bold 36px sans-serif'; context.fillStyle = '#ffe6a0'; context.textAlign = 'center'; context.fillText('각성 코어', 128, 46);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const frame = createTrackFrame(), basis = new THREE.Matrix4(), back = new THREE.Vector3();
  let layout: typeof model.cores | undefined;
  const entries: { group: THREE.Group; spin: THREE.Mesh; halo: THREE.Mesh }[] = [];
  return {
    object,
    update(time: number, reducedMotion: boolean) {
      if (layout !== model.cores) {
        layout = model.cores; object.clear(); entries.length = 0;
        for (const core of layout) {
          const group = new THREE.Group(), spin = new THREE.Mesh(crystal, body), halo = new THREE.Mesh(ring, gold);
          const altitude = track.altitudeProfile.levels[track.altitudeProfile.initialLevel] + .7;
          spin.position.y = altitude; halo.position.y = altitude; halo.rotation.x = Math.PI / 2;
          const beam = new THREE.Mesh(stem, gold); beam.scale.y = altitude; beam.position.y = altitude / 2;
          const text = new THREE.Sprite(label); text.position.y = altitude + 2.3; text.scale.set(6, 1.5, 1);
          group.add(spin, halo, beam, text);
          track.sample(core.distance, frame);
          group.position.copy(frame.position).addScaledVector(frame.right, core.offset);
          group.quaternion.setFromRotationMatrix(basis.makeBasis(frame.right, frame.up, back.copy(frame.tangent).negate()));
          object.add(group); entries.push({ group, spin, halo });
        }
      }
      const lap = Math.max(0, Math.floor(model.state.distance / track.length));
      entries.forEach(({ group, spin, halo }, i) => {
        group.visible = model.coreAvailable(i, lap);
        spin.rotation.y = reducedMotion ? Math.PI / 4 : time * 1.7;
        halo.rotation.z = reducedMotion ? 0 : time * .65;
      });
    },
    dispose() { object.removeFromParent(); object.clear(); crystal.dispose(); ring.dispose(); stem.dispose(); gold.dispose(); body.dispose(); texture.dispose(); label.dispose(); },
  };
}
