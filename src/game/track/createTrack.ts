import { expandObstacleLayout, randomObstacleAltitudes } from './obstacleLayout.js';
import * as THREE from 'three';
import { createDischargeBarrier } from './createDischargeBarrier.js';
import { altitudeCanPass, resolveAltitudeProfile } from './altitudeProfile.js';
import type { DifficultyPreset } from './difficulty.js';
import type { AltitudeProfile } from './altitudeProfile.js';

export interface TrackFrame {
  position: THREE.Vector3;
  tangent: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  /** Lateral steering curvature; loops and helices follow automatically. */
  curvature: number;
  section: 'course' | 'vertical-loop' | 'helix';
}

export interface HeightObstacle {
  readonly distance: number;
  readonly depth: number;
  readonly kind: 'rise' | 'descend' | 'middle';
  readonly visual: 'discharge-arcs';
  readonly speedRetention: number;
  /** Safe craft-center height above the local road, including craft clearance. */
  readonly minAltitude: number;
  readonly maxAltitude: number;
}

export interface Track {
  readonly altitudeProfile: AltitudeProfile;
  readonly sections: readonly { kind: TrackFrame['section']; start: number; end: number }[];
  readonly length: number;
  readonly halfWidth: number;
  readonly checkpointSpacing: number;
  readonly heightObstacles: readonly HeightObstacle[];
  randomizeObstacles?(random: () => number): void;
  sample(distance: number, target?: TrackFrame): TrackFrame;
}

/** Includes the obstacle until the entire craft has cleared its rear face. */
export function upcomingHeightObstacle(track: Track, distance: number) {
  let nearest: { obstacle: HeightObstacle; distance: number } | null = null;
  for (const obstacle of track.heightObstacles) {
    let gap = obstacle.distance - distance;
    gap += Math.ceil((-gap - obstacle.depth / 2 - 2.2) / track.length) * track.length;
    if (!nearest || gap < nearest.distance) nearest = { obstacle, distance: gap };
  }
  return nearest;
}

export function createTrackFrame(): TrackFrame {
  return { position: new THREE.Vector3(), tangent: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3(), curvature: 0, section: 'course' };
}

/** Arc-length sampling keeps distance and speed independent of control-point spacing. */
export interface TrackControlPoint { position: THREE.Vector3; up: THREE.Vector3; section: TrackFrame['section'] }

export function createTrack(profile?: AltitudeProfile, preset?: DifficultyPreset, authored?: readonly TrackControlPoint[]): Track {
  const altitudeProfile = resolveAltitudeProfile(profile ?? preset?.altitude);
  const minHeight = altitudeProfile.levels[0];
  const maxHeight = altitudeProfile.levels[altitudeProfile.levels.length - 1];
  const points: THREE.Vector3[] = [];
  const hints: THREE.Vector3[] = [];
  const kinds: TrackFrame['section'][] = [];
  const add = (x: number, y: number, z: number, up = new THREE.Vector3(0, 1, 0), kind: TrackFrame['section'] = 'course') => {
    points.push(new THREE.Vector3(x, y, z)); hints.push(up); kinds.push(kind);
  };
  if (authored) {
    for (const point of authored) add(point.position.x, point.position.y, point.position.z, point.up.clone(), point.section);
  } else {
  add(-140, 12, 120); add(-140, 12, 40); add(-140, 12, -40); add(-140, 12, -120);
  // A 136 m tall vertical loop. Its 48 m sideways exit keeps both roads apart.
  for (let i = 0; i <= 96; i++) {
    const u = i / 96, angle = u * Math.PI * 2;
    add(-140 + 48 * u * u * (3 - 2 * u), 12 + 68 * (1 - Math.cos(angle)), -200 - 68 * Math.sin(angle),
      new THREE.Vector3(0, Math.cos(angle), Math.sin(angle)), 'vertical-loop');
  }
  add(-92, 16, -310); add(-40, 62, -390); add(60, 32, -400);
  // Two spring turns advance 260 m per turn, with the road facing the coil's axis.
  const turns = preset?.layout.helixTurns ?? 2;
  const pitch = preset?.layout.helixPitch ?? 260;
  const coilSamples = turns * 64;
  for (let i = 0; i <= coilSamples; i++) {
    const angle = i / coilSamples * Math.PI * 2 * turns;
    add(130 + 44 * Math.sin(angle), 76 - 44 * Math.cos(angle), -460 - pitch * angle / (Math.PI * 2),
      new THREE.Vector3(-Math.sin(angle), Math.cos(angle), 0), 'helix');
  }
  const coilEnd = -460 - pitch * turns;
  const gentle = preset?.layout.corners === 'gentle';
  add(200, 32, coilEnd - 70); add(310, gentle ? 32 : 42, coilEnd - 160); add(430, 24, coilEnd - 80);
  if (preset?.layout.corners === 'technical') {
    add(470, 12, coilEnd + 130); add(370, 65, coilEnd + 300);
    add(470, 18, coilEnd + 470); add(370, 65, coilEnd + 630);
  } else { add(gentle ? 470 : 430, 12, coilEnd + 130); add(gentle ? 470 : 430, 18, -450); }
  add(400, gentle ? 32 : 55, -80);
  add(270, 28, 170); add(90, 12, 260); add(-70, 12, 245);
  }
  if (points.length < 4) throw new Error('A closed course needs at least four control points.');
  const curve = new THREE.CatmullRomCurve3(points, true, 'centripetal');
  curve.arcLengthDivisions = 16384;
  const length = curve.getLength();
  const divisions = Math.ceil(length * 3);
  const positions: THREE.Vector3[] = [], orientations: THREE.Quaternion[] = [];
  const sampleKinds: TrackFrame['section'][] = [];
  const tangent = new THREE.Vector3(), normal = new THREE.Vector3(), right = new THREE.Vector3(), back = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const sections: { kind: TrackFrame['section']; start: number; end: number }[] = [];
  for (let i = 0; i <= divisions; i++) {
    const u = i / divisions;
    const t = curve.getUtoTmapping(u, 0);
    const index = Math.min(points.length - 1, Math.floor(t * points.length));
    const mix = t * points.length - index;
    const next = (index + 1) % points.length;
    curve.getTangent(t, tangent).normalize();
    normal.copy(hints[index]).lerp(hints[next], mix);
    normal.addScaledVector(tangent, -normal.dot(tangent)).normalize();
    right.crossVectors(tangent, normal).normalize();
    normal.crossVectors(right, tangent).normalize();
    basis.makeBasis(right, normal, back.copy(tangent).negate());
    positions.push(curve.getPoint(t));
    orientations.push(new THREE.Quaternion().setFromRotationMatrix(basis));
    const kind = mix < 0.5 ? kinds[index] : kinds[next];
    sampleKinds.push(kind);
    const distance = u * length;
    if (!sections.length || sections[sections.length - 1].kind !== kind) sections.push({ kind, start: distance, end: distance });
    else sections[sections.length - 1].end = distance;
  }
  // The closed seam shares exactly the same orientation, including roll.
  positions[divisions].copy(positions[0]); orientations[divisions].copy(orientations[0]);
  const quaternion = new THREE.Quaternion();
  const previousTangent = new THREE.Vector3(), nextTangent = new THREE.Vector3();
  const at = (distance: number) => {
    const u = ((distance % length) + length) % length / length * divisions;
    return { index: Math.floor(u), mix: u - Math.floor(u) };
  };
  const directionAt = (distance: number, target: THREE.Vector3) => {
    const { index, mix } = at(distance);
    quaternion.copy(orientations[index]).slerp(orientations[index + 1], mix);
    return target.set(0, 0, -1).applyQuaternion(quaternion);
  };
  const heightObstacles: HeightObstacle[] = preset ? preset.obstacleLevels.map((level, i) => {
    const height = altitudeProfile.levels[level];
    if (height === undefined) throw new Error('Obstacle requires an unavailable altitude level.');
    return { distance: 110 + i / preset.obstacleLevels.length * (length - 240), depth: 4,
      visual: 'discharge-arcs', speedRetention: 0.35,
      kind: level === 0 ? 'descend' : level === altitudeProfile.levels.length - 1 ? 'rise' : 'middle',
      minAltitude: level === 0 ? minHeight : height - 0.45,
      maxAltitude: level === altitudeProfile.levels.length - 1 ? maxHeight : height + 0.45 };
  }) : [80, 165, length * 0.32, length * 0.43, length * 0.66, length * 0.8].map((distance, i) => ({
    distance, depth: 4, visual: 'discharge-arcs', speedRetention: 0.35, kind: i % 2 === 0 ? 'rise' : 'descend',
    minAltitude: i % 2 === 0 ? Math.max(minHeight, maxHeight - 1) : minHeight,
    maxAltitude: i % 2 === 0 ? maxHeight : Math.min(maxHeight, minHeight + 0.9),
  }));
  const track: Track = {
    altitudeProfile, sections,
    randomizeObstacles(random) {
      heightObstacles.splice(0, heightObstacles.length, ...randomObstacleAltitudes(heightObstacles, altitudeProfile.levels, random));
    },
    length, halfWidth: preset?.layout.halfWidth ?? 11, checkpointSpacing: length / 24,
    heightObstacles,
    sample(distance, target = createTrackFrame()) {
      const { index, mix } = at(distance);
      target.position.copy(positions[index]).lerp(positions[index + 1], mix);
      quaternion.copy(orientations[index]).slerp(orientations[index + 1], mix);
      target.right.set(1, 0, 0).applyQuaternion(quaternion);
      target.up.set(0, 1, 0).applyQuaternion(quaternion);
      target.tangent.set(0, 0, -1).applyQuaternion(quaternion);
      target.section = sampleKinds[index];
      directionAt(distance - 0.5, previousTangent); directionAt(distance + 0.5, nextTangent);
      target.curvature = target.section === 'course' ? nextTangent.sub(previousTangent).dot(target.right) : 0;
      return target;
    },
  };
  heightObstacles.splice(0, heightObstacles.length, ...expandObstacleLayout(track, heightObstacles));
  return track;
}

const maxAltitude = (track: Track) => track.altitudeProfile.levels[track.altitudeProfile.levels.length - 1];

export function createTrackVisual(track: Track, lineColor?: string) {
  const group = new THREE.Group();
  group.name = 'neonLoop';
  const count = Math.ceil(track.length / 1.2);
  const vertices: number[] = [];
  const indices: number[] = [];
  const left: THREE.Vector3[] = [];
  const right: THREE.Vector3[] = [];
  const frame = createTrackFrame();
  for (let i = 0; i <= count; i++) {
    track.sample(i / count * track.length, frame);
    const a = frame.position.clone().addScaledVector(frame.right, -track.halfWidth);
    const b = frame.position.clone().addScaledVector(frame.right, track.halfWidth);
    vertices.push(...a.toArray(), ...b.toArray());
    left.push(a.clone().addScaledVector(frame.up, 0.12));
    right.push(b.clone().addScaledVector(frame.up, 0.12));
    if (i < count) {
      const n = i * 2;
      indices.push(n, n + 2, n + 1, n + 1, n + 2, n + 3);
    }
  }
  const roadGeometry = new THREE.BufferGeometry();
  roadGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  roadGeometry.setIndex(indices); roadGeometry.computeVertexNormals();
  group.add(new THREE.Mesh(roadGeometry, new THREE.MeshStandardMaterial({ color: 0x12242d, roughness: 0.85, metalness: 0.2, side: THREE.DoubleSide })));
  const edgeMaterial = new THREE.MeshBasicMaterial({ color: lineColor ? new THREE.Color(lineColor).multiplyScalar(1.3) : new THREE.Color(0.12, 1.3, 1.1) });
  for (const edge of [left, right]) {
    edge.pop();
    const edgeCurve = new THREE.CatmullRomCurve3(edge, true, 'centripetal');
    group.add(new THREE.Mesh(new THREE.TubeGeometry(edgeCurve, count, 0.12, 5, true), edgeMaterial));
  }
  // Repeated markings and pillars make nearby movement legible without textures.
  const dashGeometry = new THREE.BoxGeometry(0.16, 0.035, 3.8);
  const dashMaterial = new THREE.MeshBasicMaterial({ color: lineColor ? new THREE.Color(lineColor).multiplyScalar(.28) : 0x426c76 });
  const dashCount = Math.floor(track.length / 9);
  const dashes = new THREE.InstancedMesh(dashGeometry, dashMaterial, dashCount);
  const dummy = new THREE.Object3D();
  const basis = new THREE.Matrix4();
  const back = new THREE.Vector3();
  const orient = (object: THREE.Object3D) => object.quaternion.setFromRotationMatrix(basis.makeBasis(frame.right, frame.up, back.copy(frame.tangent).negate()));
  for (let i = 0; i < dashCount; i++) {
    track.sample(i * 9, frame);
    dummy.position.copy(frame.position).addScaledVector(frame.up, 0.035);
    orient(dummy);
    dummy.updateMatrix(); dashes.setMatrixAt(i, dummy.matrix);
  }
  group.add(dashes);
  // Closely spaced verge marks give nearby motion cues at racing speed.
  const vergeCount = Math.floor(track.length / 4);
  const verges = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.03, 1.8), dashMaterial, vergeCount * 2);
  for (let i = 0; i < vergeCount; i++) {
    track.sample(i * 4, frame);
    for (let side = 0; side < 2; side++) {
      dummy.position.copy(frame.position).addScaledVector(frame.right, (side === 0 ? -1 : 1) * (track.halfWidth - 2));
      dummy.position.addScaledVector(frame.up, 0.045);
      orient(dummy);
      dummy.updateMatrix(); verges.setMatrixAt(i * 2 + side, dummy.matrix);
    }
  }
  group.add(verges);
  const railGeometry = new THREE.BoxGeometry(0.4, 3, 1);
  const railMaterial = new THREE.MeshBasicMaterial({ color: 0x285e67 });
  const railCount = Math.floor(track.length / 18);
  const rails = new THREE.InstancedMesh(railGeometry, railMaterial, railCount * 2);
  for (let i = 0; i < railCount; i++) {
    track.sample(i * 18, frame);
    for (let side = 0; side < 2; side++) {
      dummy.position.copy(frame.position).addScaledVector(frame.right, (side === 0 ? -1 : 1) * track.halfWidth);
      dummy.position.addScaledVector(frame.up, 1.5); orient(dummy);
      dummy.updateMatrix(); rails.setMatrixAt(i * 2 + side, dummy.matrix);
    }
  }
  group.add(rails);
  const makeBarriers = () => track.heightObstacles.map(obstacle => {
    track.sample(obstacle.distance, frame);
    const barrier = createDischargeBarrier(obstacle, track.halfWidth, maxAltitude(track));
    barrier.object.position.copy(frame.position);
    orient(barrier.object);
    group.add(barrier.object);
    return barrier;
  });
  let barriers = makeBarriers();
  const refreshObstacles = () => {
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
    for (const barrier of barriers) {
      barrier.object.removeFromParent();
      barrier.object.traverse(child => {
        if (child instanceof THREE.Mesh) {
          geometries.add(child.geometry);
          (Array.isArray(child.material) ? child.material : [child.material]).forEach(m => materials.add(m));
        }
      });
    }
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
    barriers = makeBarriers();
  };
  const bounds = new THREE.Box3().setFromPoints(left.concat(right));
  const extent = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
  const groundSize = Math.max(1800, extent.x + 600, extent.z + 600);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(groundSize, groundSize), new THREE.MeshStandardMaterial({ color: 0x080f17, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(center.x, -0.1, center.z); group.add(ground);
  const grid = new THREE.GridHelper(groundSize, Math.ceil(groundSize / 16), 0x19323f, 0x101f2b); grid.position.set(center.x, 0, center.z); group.add(grid);
  return {
    object: group,
    refreshObstacles,
    hit(distance: number) {
      const next = upcomingHeightObstacle(track, distance);
      if (next && Math.abs(next.distance) <= next.obstacle.depth / 2 + 3.2) {
        barriers[track.heightObstacles.indexOf(next.obstacle)].hit();
      }
    },
    update(time: number, reducedMotion: boolean, distance = 0, altitude = 1.8, speed = 0) {
      const lap = Math.floor(distance / track.length);
      barriers.forEach((barrier, index) => {
        const obstacle = track.heightObstacles[index];
        let ahead = obstacle.distance + lap * track.length - distance;
        if (ahead < -obstacle.depth / 2 - 2.2) ahead += track.length;
        const nearby = ahead < Math.max(120, speed * 3.5);
        barrier.update(time, reducedMotion, nearby ? altitudeCanPass(altitude, obstacle) ? 'ready' : 'blocked' : 'neutral');
      });
    },
  };
}
