import { roadPoints } from './trackBranches.js';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Track } from './createTrack.js';
import { DISTRICTS } from './trackCatalog.js';
import type { TrackDefinition } from './trackCatalog.js';
import { cityForDistrict } from './cityCatalog.js';

import { LANDMARK_TYPES, LANDMARK_DISTRICTS, LANDMARK_ENCOUNTERS } from './landmarkCatalog.js';
import type { LandmarkKind } from './landmarkCatalog.js';
export type { LandmarkKind } from './landmarkCatalog.js';
export function scenerySeed(id: string) {
  return [...id].reduce((n, c) => Math.imul(n ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;
}
export function sceneryRoute(track: Track) {
  const route: THREE.Vector3[] = [];
  route.push(...roadPoints(track, 12));
  return route;
}

/** The same deterministic placement is used by the race and course preview. */
export function describeTrackLandmark(track: Track, definition: TrackDefinition, route = sceneryRoute(track)) {
  const seed = scenerySeed(definition.id), choices = LANDMARK_DISTRICTS[definition.district].signature;
  const kind = choices[seed % choices.length], scale = .82 + (seed % 997) / 997 * .32;
  const radius = 72 * scale, height = LANDMARK_TYPES[kind].height * scale;
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
      return { district: definition.district, id: `${definition.id}-landmark`, name: `${definition.name} · ${LANDMARK_TYPES[kind].name}`, kind, scale,
        radius, height, position, rotation: Math.atan2(frame.tangent.x, frame.tangent.z), color: DISTRICTS[definition.district].color };
    }
  }
  throw new Error(`No safe landmark placement for ${definition.id}`);
}
export type TrackLandmark = ReturnType<typeof describeTrackLandmark>;

/** Three readable encounters in every district, with safe, deterministic approach placement. */
export function describeTrackLandmarks(track: Track, definition: TrackDefinition, route = sceneryRoute(track)): TrackLandmark[] {
  const original = describeTrackLandmark(track, definition, route);
  const result: TrackLandmark[] = [];
  const kinds = [original.kind, ...LANDMARK_DISTRICTS[definition.district].companions];
  for (const [index, encounter] of LANDMARK_ENCOUNTERS.entries()) {
    const kind = kinds[index];
    // Tall spires retain a similar skyline height rather than tripling their already tall shape.
    const spec = { ...encounter, kind, scale: kind === 'spire' ? encounter.scale * .7 : encounter.scale };
    const radius = 72 * spec.scale, height = LANDMARK_TYPES[spec.kind].height * spec.scale;
    // Underwater megastructures need breathing room proportional to their silhouette.
    // Keep Neon City placements stable; radius already includes the entire mesh footprint.
    const clearance = 42 * (cityForDistrict(definition.district) === 'marine' ? Math.max(1, spec.scale) : 1);
    const margin = radius + track.halfWidth + clearance;
    let best: { position: THREE.Vector3; rotation: number; score: number } | undefined;
    // Score the approach, not only the closest sideways pass. Fixed candidates keep previews stable.
    for (const shift of [0, .04, -.04, .09, -.09, .16, -.16, .24, -.24, .32, -.32]) {
      const distance = (spec.fraction + shift + 1) % 1 * track.length;
      const frame = track.sample(distance);
      if (frame.up.y < .65 || Math.abs(frame.tangent.y) > .6) continue;
      const side = new THREE.Vector3(frame.tangent.z, 0, -frame.tangent.x).normalize();
      for (const extra of [0, 70, 170, 300]) for (const sign of [1, -1]) {
        const position = frame.position.clone().addScaledVector(side, (margin + extra) * sign);
        if (route.some(p => Math.hypot(p.x - position.x, p.z - position.z) < margin)) continue;
        if (result.some(p => Math.hypot(p.position.x - position.x, p.position.z - position.z) < p.radius + radius + 30)) continue;
        position.y = Math.max(0, frame.position.y - height * .12);
        // Reject fleeting silhouettes: require a continuous, useful forward approach.
        let visible = 0, longest = 0;
        for (let before = 900; before >= -100; before -= 20) {
          const approach = track.sample(distance - before);
          const delta = position.clone().add(new THREE.Vector3(0, height * .45, 0)).sub(approach.position);
          const range = delta.length(), alignment = delta.normalize().dot(approach.tangent);
          visible = approach.up.y > .65 && alignment > .70 && range < 1000 && height / range > .18 ? visible + 20 : 0;
          longest = Math.max(longest, visible);
        }
        if (longest < 120) continue;
        let score = -Infinity;
        for (const before of [160, 280, 420, 600, 800]) {
          const approach = track.sample(distance - before);
          if (approach.up.y < .65) continue;
          const target = position.clone().add(new THREE.Vector3(0, height * .45, 0)).sub(approach.position);
          const range = target.length(), alignment = target.normalize().dot(approach.tangent);
          // A forward view with a large apparent silhouette wins over an invisible safe position.
          if (alignment > .70) score = Math.max(score, alignment * 3 + Math.min(1, height / range) - extra / 2500);
        }
        if (!best || score > best.score) best = { position, rotation: Math.atan2(frame.tangent.x, frame.tangent.z), score };
      }
    }
    if (!best || !Number.isFinite(best.score)) throw new Error(`No visible landmark approach for ${definition.id}:${index}`);
    result.push({ ...original, id: `${definition.id}-landmark-${index}`, name: `${LANDMARK_TYPES[spec.kind].name} ${index === 0 ? '· 메가스트럭처' : ''}`.trim(),
      kind: spec.kind, scale: spec.scale, radius, height, position: best.position, rotation: best.rotation });
  }
  return result;
}

/** Seven silhouettes, with course-specific proportions; emissive strips replace point lights. */
export function createTrackLandmark(descriptor: TrackLandmark, preview = false, underwater = false) {
  const object = new THREE.Group(); object.name = descriptor.id;
  object.position.copy(descriptor.position); object.rotation.y = descriptor.rotation; object.scale.setScalar(descriptor.scale);
  object.userData.landmark = { id: descriptor.id, kind: descriptor.kind, name: descriptor.name };
  const color = new THREE.Color(descriptor.color);
  const signature = descriptor.id.match(/-landmark-([0-9]+)$/)?.[1];
  const accent = signature === undefined ? color : new THREE.Color(LANDMARK_DISTRICTS[descriptor.district].accents[Number(signature) % 3]);
  const body = preview ? new THREE.MeshBasicMaterial({ color: '#223947', side: THREE.DoubleSide })
    : new THREE.MeshStandardMaterial({ color: signature === undefined ? '#0b1a24' : '#26364a', roughness: .6, metalness: .5, side: THREE.DoubleSide });
  const glowStrength = signature === undefined || signature === '0' ? 1.8 : 2.8;
  const glow = new THREE.MeshBasicMaterial({ color: accent.clone().multiplyScalar(preview ? .85 : glowStrength), toneMapped: false });
  const dim = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(signature === undefined ? .35 : .85), toneMapped: false });
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
    // Both faces and the outer rim stay luminous on approaches from either direction.
    for (const sign of [-1, 1]) {
      const edge = add(new THREE.TorusGeometry(42, 1, 6, 48), glow, 0, 62 - Math.sin(.3) * 5.4 * sign, Math.cos(.3) * 5.4 * sign);
      edge.rotation.x = .3;
    }
    const rim = add(new THREE.TorusGeometry(47, .9, 6, 48), glow, 0, 62, 0); rim.rotation.x = .3;
    box(-28, 23, 0, 12, 42, 16); box(28, 23, 0, 12, 42, 16);
    for (const x of [-45, 45]) { box(x, 24, 0, 21, 3, 55); box(x, 26, 0, 21, .8, 55, dim); }
  } else if (underwater && descriptor.kind === 'bridge') {
    // Underwater: coral-rock spires joined by a glowing arch instead of ground-city towers.
    for (const [index, x] of [-34, 34].entries()) {
      const h = 100 + index * 18 + variation;
      add(new THREE.ConeGeometry(6, h, 7), body, x, h / 2 + 5, 0);
      for (const f of [.3, .55, .78]) ring(6 * (1 - f) + 1, h * f + 5, .9);
    }
    add(new THREE.TorusGeometry(34, 1.6, 6, 32, Math.PI), glow, 0, 30, 0);
  } else {
    const towers = descriptor.kind === 'bridge' ? [-34, 34] : descriptor.kind === 'terrace' ? [-26, 0, 26] : [0];
    for (const [index, x] of towers.entries()) {
      const height = descriptor.kind === 'spire' ? 156 + variation : 70 + index * 12 + variation;
      box(x, height / 2 + 5, 0, 22, height, 32);
      for (let y = 14; y < height; y += 10) {
        box(x, y, -16.1, 18, 1, .2, glow); box(x, y, 16.1, 18, 1, .2, glow);
        box(x - 11.1, y, 0, .2, 1, 30, glow); box(x + 11.1, y, 0, .2, 1, 30, glow);
      }
      for (const z of [-16, 16]) box(x, height / 2 + 5, z, .9, height, .9, glow);
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
