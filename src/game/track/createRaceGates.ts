import * as THREE from 'three';
import { createTrackFrame } from './createTrack.js';
import type { Track } from './createTrack.js';

/** Only arches: no floor stripes or tall checkpoint beacons around the flight path. */
export function createRaceGates(track: Track, count: number) {
  const object = new THREE.Group(); object.name = 'Race checkpoints';
  const geometry = new THREE.TorusGeometry(track.halfWidth + 1.1, 0.18, 8, 96, Math.PI);
  const startMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.1, 0.015, 0.19) });
  const inactiveColor = new THREE.Color(1.5, 0.48, 0.07);
  const activeColor = new THREE.Color(1.6, 0.85, 0.16);
  const gates = new Map<number, THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>>();
  const frame = createTrackFrame();
  const basis = new THREE.Matrix4();
  const arch = (distance: number, name: string, material: THREE.MeshBasicMaterial) => {
    track.sample(distance, frame);
    const mesh = new THREE.Mesh(geometry, material); mesh.name = name;
    mesh.position.copy(frame.position).addScaledVector(frame.up, 0.12);
    mesh.quaternion.setFromRotationMatrix(basis.makeBasis(frame.right, frame.up, frame.tangent.clone().negate()));
    object.add(mesh);
    return mesh;
  };
  for (let i = 0; i < 4; i++) arch(i * 10, 'Start arch ' + (i + 1), startMaterial);
  for (let i = 1; i < count; i++) {
    const distance = i * track.length / count;
    // Obstacles retain invisible timing gates, without an overlapping decorative arch.
    const overlapsObstacle = track.heightObstacles.some(obstacle => {
      const gap = Math.abs(distance - obstacle.distance);
      return Math.min(gap, track.length - gap) < obstacle.depth / 2 + 18;
    });
    if (!overlapsObstacle && distance > 35) gates.set(i, arch(distance, 'Checkpoint arch ' + i, new THREE.MeshBasicMaterial({ color: inactiveColor })));
  }
  let previous = -1;
  return { object, update(nextDistance: number) {
    const index = Math.round(nextDistance / track.length * count) % count;
    if (index === previous) return;
    gates.get(previous)?.material.color.copy(inactiveColor);
    gates.get(index)?.material.color.copy(activeColor);
    previous = index;
  } };
}
