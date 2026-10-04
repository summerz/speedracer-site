import * as THREE from 'three';
import { createTrackFrame } from './createTrack.js';
import type { Track } from './createTrack.js';

/** Ground strips and paired beacons distinguish race gates from discharge obstacles. */
export function createRaceGates(track: Track, count: number) {
  const object = new THREE.Group(); object.name = 'Race checkpoints';
  const strip = new THREE.BoxGeometry(track.halfWidth * 2, 0.06, 1.6);
  const beacon = new THREE.BoxGeometry(0.35, 7, 0.35);
  const gates: THREE.Group[] = [];
  const inactive = new THREE.MeshBasicMaterial({ color: 0x426171 });
  const active = new THREE.MeshBasicMaterial({ color: 0xaafcf0 });
  const start = new THREE.MeshBasicMaterial({ color: 0xffd78e });
  const frame = createTrackFrame();
  const basis = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    track.sample(i * track.length / count, frame);
    const gate = new THREE.Group();
    gate.position.copy(frame.position).addScaledVector(frame.up, 0.12);
    gate.quaternion.setFromRotationMatrix(basis.makeBasis(frame.right, frame.up, frame.tangent.clone().negate()));
    const material = i === 0 ? start : inactive;
    gate.add(new THREE.Mesh(strip, material));
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(beacon, material);
      post.position.set(side * (track.halfWidth + 0.4), 3.5, 0); gate.add(post);
    }
    if (i === 0) {
      const flag = new THREE.Mesh(new THREE.BoxGeometry(track.halfWidth * 2 + 1, 0.35, 0.35), start);
      flag.position.y = 7; gate.add(flag);
    }
    gates.push(gate); object.add(gate);
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
