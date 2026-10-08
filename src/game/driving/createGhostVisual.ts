import * as THREE from 'three';
import { createRacingDrone } from '../drone/createRacingDrone.js';
import { createTrackFrame } from '../track/createTrack.js';
import type { Track } from '../track/createTrack.js';
import { poseAtTime } from './raceGhost.js';
import type { Ghost } from './raceGhost.js';

/** Translucent cyan wireframe drone replaying a stored run; no shadows, collisions or AI awareness. */
export function createGhostVisual(scene: THREE.Scene, track: Track, ghost: Ghost, variant: string) {
  const object = createRacingDrone({ variant, neonColor: '#77eaff', accentColor: '#77eaff' });
  object.name = 'ghost'; object.visible = false;
  const material = new THREE.MeshBasicMaterial({ color: '#77eaff', wireframe: true, transparent: true, opacity: .35, depthWrite: false, toneMapped: false });
  object.traverse(child => {
    if (child instanceof THREE.Mesh) { child.material = material; child.castShadow = child.receiveShadow = false; }
    else if (child instanceof THREE.Line || child instanceof THREE.Points || child instanceof THREE.Light) child.visible = false;
  });
  scene.add(object);
  const frame = createTrackFrame(), forward = new THREE.Vector3(), right = new THREE.Vector3(), back = new THREE.Vector3(), basis = new THREE.Matrix4();
  return {
    update(elapsed: number, visible: boolean) {
      const pose = poseAtTime(ghost, elapsed);
      object.visible = visible && !pose.finished;
      if (!object.visible) return;
      track.sample(pose.distance, frame, pose.routeId);
      object.position.copy(frame.position).addScaledVector(frame.right, pose.offset).addScaledVector(frame.up, pose.altitude);
      forward.copy(frame.tangent).multiplyScalar(Math.cos(pose.heading)).addScaledVector(frame.right, Math.sin(pose.heading));
      right.copy(frame.right).multiplyScalar(Math.cos(pose.heading)).addScaledVector(frame.tangent, -Math.sin(pose.heading));
      basis.makeBasis(right, frame.up, back.copy(forward).negate());
      object.quaternion.setFromRotationMatrix(basis);
    },
  };
}
