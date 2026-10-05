import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Track } from './createTrack.js';
import { DISTRICTS } from './trackCatalog.js';
import type { DistrictId, TrackDefinition } from './trackCatalog.js';

export type LandmarkKind = 'terrace' | 'bridge' | 'reactor' | 'arena' | 'dome' | 'spire' | 'orbital-ring';
const forms: Record<DistrictId, readonly LandmarkKind[]> = {
  residential: ['terrace', 'bridge'], industrial: ['reactor', 'spire'], stadium: ['arena', 'dome'],
  skyline: ['spire', 'bridge'], research: ['dome', 'reactor'], orbital: ['orbital-ring', 'bridge'],
};
const labels: Record<LandmarkKind, string> = {
  terrace: '계단형 주거 타워', bridge: '쌍둥이 연결교', reactor: '전력 코어', arena: '원형 경기장',
  dome: '발광 돔', spire: '첨탑', 'orbital-ring': '궤도 링',
};
export function scenerySeed(id: string) {
  return [...id].reduce((n, c) => Math.imul(n ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;
}
export function sceneryRoute(track: Track) {
  const route: THREE.Vector3[] = [];
  for (let d = 0; d < track.length; d += 12) route.push(track.sample(d).position.clone());
  return route;
}

/** The same deterministic placement is used by the race and course preview. */
export function describeTrackLandmark(track: Track, definition: TrackDefinition, route = sceneryRoute(track)) {
  const seed = scenerySeed(definition.id), choices = forms[definition.district];
  const kind = choices[seed % choices.length], scale = .82 + (seed % 997) / 997 * .32;
  const radius = 72 * scale, height = (kind === 'spire' ? 217 : kind === 'bridge' || kind === 'orbital-ring' ? 112 : 100) * scale;
  const margin = radius + track.halfWidth + 36;
  // Try both sides near the opening stretch; reject against the ENTIRE swept route,
  // including distant sections that cross over or under this candidate.
  for (const fraction of [.065, .095, .125, .015, .2, .3, .4, .6, .8]) {
    const frame = track.sample(track.length * fraction);
    const side = new THREE.Vector3(frame.tangent.z, 0, -frame.tangent.x).normalize();
    if (side.lengthSq() < .5) continue;
    for (const offset of [margin, margin + 55, margin + 120, margin + 240]) for (const sign of [1, -1]) {
      const position = frame.position.clone().addScaledVector(side, offset * sign);
      if (route.some(p => Math.hypot(p.x - position.x, p.z - position.z) < margin)) continue;
      position.y = Math.max(definition.district === 'orbital' ? 20 : 0, frame.position.y - height * .45);
      return { id: `${definition.id}-landmark`, name: `${definition.name} · ${labels[kind]}`, kind, scale,
        radius, height, position, rotation: Math.atan2(frame.tangent.x, frame.tangent.z), color: DISTRICTS[definition.district].color };
    }
  }
  throw new Error(`No safe landmark placement for ${definition.id}`);
}
export type TrackLandmark = ReturnType<typeof describeTrackLandmark>;

/** Seven silhouettes, with course-specific proportions; emissive strips replace point lights. */
export function createTrackLandmark(descriptor: TrackLandmark, preview = false) {
  const object = new THREE.Group(); object.name = descriptor.id;
  object.position.copy(descriptor.position); object.rotation.y = descriptor.rotation; object.scale.setScalar(descriptor.scale);
  object.userData.landmark = { id: descriptor.id, kind: descriptor.kind, name: descriptor.name };
  const color = new THREE.Color(descriptor.color);
  const body = preview ? new THREE.MeshBasicMaterial({ color: '#223947', side: THREE.DoubleSide })
    : new THREE.MeshStandardMaterial({ color: '#0b1a24', roughness: .6, metalness: .5, side: THREE.DoubleSide });
  const glow = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(preview ? .85 : 1.6), toneMapped: false });
  const dim = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(.35), toneMapped: false });
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); object.add(mesh); return mesh;
  };
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, material = body) => add(new THREE.BoxGeometry(w, h, d), material, x, y, z);
  const ring = (radius: number, y: number, thickness = 1.4, material = glow) => {
    const mesh = add(new THREE.TorusGeometry(radius, thickness, 6, 48), material, 0, y, 0); mesh.rotation.x = Math.PI / 2; return mesh;
  };
  add(new THREE.CylinderGeometry(62, 65, 5, 24), body, 0, 2.5, 0); ring(62, 5, .8, dim);
  const variation = scenerySeed(descriptor.id) % 9;
  if (descriptor.kind === 'arena') {
    for (let tier = 0; tier < 4; tier++) {
      const radius = 48 + tier * 4;
      add(new THREE.CylinderGeometry(radius, radius + 2, 10, 40, 1, true), body, 0, 11 + tier * 10, 0);
      ring(radius, 16 + tier * 10, 1);
    }
    ring(31, 6, .7, dim);
    for (const x of [-40, 40]) { box(x, 61, 0, 4, 38 + variation, 4); box(x, 82, 0, 22, 2, 2, glow); }
  } else if (descriptor.kind === 'dome') {
    add(new THREE.SphereGeometry(48, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), body, 0, 14, 0);
    for (const height of [14, 28, 42, 54]) ring(Math.sqrt(48 ** 2 - (height - 14) ** 2), height, .65);
    for (let i = 0; i < 4; i++) {
      const arch = add(new THREE.TorusGeometry(49, .7, 4, 24, Math.PI), glow, 0, 14, 0); arch.rotation.y = i * Math.PI / 4;
    }
    box(0, 78, 0, 4, 28 + variation, 4, glow);
  } else if (descriptor.kind === 'reactor') {
    add(new THREE.CylinderGeometry(28, 38, 68, 8), body, 0, 39, 0);
    for (const y of [20, 38, 56, 74]) ring(31, y, 2);
    for (let i = 0; i < 4; i++) {
      const angle = i * Math.PI / 2;
      box(Math.cos(angle) * 49, 28, Math.sin(angle) * 49, 9, 46 + variation, 9);
      box(Math.cos(angle) * 49, 54, Math.sin(angle) * 49, 10, 2, 10, glow);
    }
  } else if (descriptor.kind === 'orbital-ring') {
    const halo = add(new THREE.TorusGeometry(42, 5, 8, 48), body, 0, 62, 0); halo.rotation.x = .3;
    const edge = add(new THREE.TorusGeometry(42, 1, 6, 48), glow, 0, 62, 5.2); edge.rotation.x = .3;
    box(-28, 23, 0, 12, 42, 16); box(28, 23, 0, 12, 42, 16);
    for (const x of [-45, 45]) { box(x, 24, 0, 21, 3, 55); box(x, 26, 0, 21, .8, 55, dim); }
  } else {
    const towers = descriptor.kind === 'bridge' ? [-34, 34] : descriptor.kind === 'terrace' ? [-26, 0, 26] : [0];
    for (const [index, x] of towers.entries()) {
      const height = descriptor.kind === 'spire' ? 156 + variation : 70 + index * 12 + variation;
      box(x, height / 2 + 5, 0, 22, height, 32);
      for (let y = 14; y < height; y += 10) box(x, y, -16.1, 18, 1, .2, glow);
      box(x, height + 13, 0, 12, 16, 18); box(x, height + 22, 0, 13, 1, 19, glow);
    }
    if (descriptor.kind === 'bridge') { box(0, 70, 0, 54, 10, 18); box(0, 76, -9, 54, 1, 1, glow); }
    if (descriptor.kind === 'spire') {
      add(new THREE.ConeGeometry(14, 36, 4), body, 0, 185, 0); box(0, 209, 0, 2, 15, 2, glow);
    }
  }
  // Combine static pieces by material: even the many tower windows cost three draws total.
  for (const [material, name] of [[body, 'body'], [glow, 'lights'], [dim, 'base']] as const) {
    const pieces = object.children.filter(child => child instanceof THREE.Mesh && child.material === material) as THREE.Mesh[];
    pieces.forEach(piece => { piece.updateMatrix(); piece.geometry.applyMatrix4(piece.matrix); });
    const combined = mergeGeometries(pieces.map(piece => piece.geometry));
    if (!combined) throw new Error(`Cannot build ${descriptor.id}`);
    pieces.forEach(piece => { object.remove(piece); piece.geometry.dispose(); });
    combined.computeBoundingSphere();
    const mesh = new THREE.Mesh(combined, material); mesh.name = `landmark-${name}`; object.add(mesh);
  }
  return object;
}

export function disposeScenery(object: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  object.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    if (child instanceof THREE.InstancedMesh) child.dispose();
    geometries.add(child.geometry);
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) materials.add(material);
  });
  geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose());
  object.removeFromParent();
}
