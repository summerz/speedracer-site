import * as THREE from 'three';
import { createTrackFrame } from './createTrack.js';
import type { Track } from './createTrack.js';

/** Four gold start arches and checkpoint beacons stay distinct from discharge obstacles. */
export function createRaceGates(track: Track, count: number) {
  const object = new THREE.Group(); object.name = 'Race checkpoints';
  const strip = new THREE.BoxGeometry(track.halfWidth * 2, 0.06, 1.6);
  const beacon = new THREE.BoxGeometry(0.35, 7, 0.35);
  const gates: THREE.Group[] = [];
  const inactive = new THREE.MeshBasicMaterial({ color: 0x426171 });
  const active = new THREE.MeshBasicMaterial({ color: 0xaafcf0 });
  const start = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 0.86, 0.12) });
  const startGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.35, 0.98, 0.14) });
  const frame = createTrackFrame();
  const basis = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    track.sample(i * track.length / count, frame);
    const gate = new THREE.Group();
    gate.position.copy(frame.position).addScaledVector(frame.up, 0.12);
    gate.quaternion.setFromRotationMatrix(basis.makeBasis(frame.right, frame.up, frame.tangent.clone().negate()));
    const material = i === 0 ? start : inactive;
    gate.add(new THREE.Mesh(strip, material));
    if (i > 0) {
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(beacon, material);
        post.position.set(side * (track.halfWidth + 0.4), 3.5, 0); gate.add(post);
      }
    }
    gates.push(gate); object.add(gate);
  }
  const radius = track.halfWidth + 1.1;
  const archGeometry = new THREE.TorusGeometry(radius, 0.18, 8, 96, Math.PI);
  const footGeometry = new THREE.CylinderGeometry(0.5, 0.7, 0.45, 12);
  // Each arch follows the road frame; the first stays exactly at the timed lap line.
  for (let i = 0; i < 4; i++) {
    track.sample(i * 10, frame);
    const arch = new THREE.Group(); arch.name = `Start arch ${i + 1}`;
    arch.position.copy(frame.position).addScaledVector(frame.up, 0.12);
    arch.quaternion.setFromRotationMatrix(basis.makeBasis(frame.right, frame.up, frame.tangent.clone().negate()));
    arch.add(new THREE.Mesh(archGeometry, start));
    for (const side of [-1, 1]) {
      const foot = new THREE.Mesh(footGeometry, startGlow);
      foot.position.set(side * radius, 0.1, 0); arch.add(foot);
    }
    object.add(arch);
  }
  // Attach every shared material from creation so scene disposal also covers a race never started.
  gates[1]?.children.forEach(child => { (child as THREE.Mesh).material = active; });
  let previous = gates.length > 1 ? 1 : -1;
  return { object, update(nextDistance: number) {
    const index = Math.round(nextDistance / track.length * count) % count;
    if (index === previous) return;
    if (previous > 0) gates[previous].children.forEach(child => { (child as THREE.Mesh).material = inactive; });
    if (index > 0) gates[index].children.forEach(child => { (child as THREE.Mesh).material = active; });
    previous = index;
  } };
}
