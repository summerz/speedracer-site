import * as THREE from 'three';
import type { Track } from './createTrack.js';
import { DISTRICTS } from './trackCatalog.js';
import type { TrackDefinition } from './trackCatalog.js';
import type { RenderQuality } from '../../platform/renderQuality.js';
import { createTrackLandmark, describeTrackLandmarks, sceneryRoute, scenerySeed } from './createTrackLandmark.js';

/** Seeded instanced silhouettes and emissive windows; no per-window lights or draw calls. */
export function createDistrictScenery(track: Track, definition: TrackDefinition) {
  let seed = scenerySeed(definition.id);
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const route = sceneryRoute(track);
  const bounds = new THREE.Box3();
  route.forEach(p => bounds.expandByPoint(p));
  bounds.expandByScalar(230);
  const object = new THREE.Group(); object.name = `district-${definition.district}`;
  const landmarks = describeTrackLandmarks(track, definition, route);
  const landmark = landmarks[0];
  const landmarkObjects = landmarks.map(descriptor => createTrackLandmark(descriptor));
  const color = new THREE.Color(DISTRICTS[definition.district].color);
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: definition.district === 'desert' ? '#241d14' : '#09131d', roughness: .8, metalness: .45 });
  const windowMaterial = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(1.7), toneMapped: false });
  const accentMaterial = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(.75), toneMapped: false });
  const boxes: THREE.Matrix4[] = [], windows: THREE.Matrix4[] = [], accents: THREE.Matrix4[] = [];
  const clusters: { center: THREE.Vector3; radius: number; boxes: THREE.Matrix4[]; windows: THREE.Matrix4[]; accents: THREE.Matrix4[] }[] = [];
  const dummy = new THREE.Object3D();
  const matrix = (x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    dummy.position.set(x, y, z); dummy.scale.set(sx, sy, sz); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); return dummy.matrix.clone();
  };
  const size = bounds.getSize(new THREE.Vector3());
  const count = Math.min(180, Math.ceil(track.length / 24));
  let attempts = 0;
  while (clusters.length < count && attempts++ < count * 30) {
    const x = bounds.min.x + random() * size.x, z = bounds.min.z + random() * size.z;
    const width = 18 + random() * 28, depth = 18 + random() * 28;
    const radius = definition.district === 'stadium' ? Math.hypot(27 + (width + 12) / 2, depth * .75) : Math.hypot(width, depth) / 2;
    const clearance = radius + track.halfWidth + 36;
    // Horizontal rejection protects the full vertical swept corridor, including upside-down sections.
    if (route.some(p => Math.hypot(p.x - x, p.z - z) < clearance)) continue;
    if (landmarks.some(landmark => Math.hypot(landmark.position.x - x, landmark.position.z - z) < radius + landmark.radius + 28)) continue;
    // Keep the opening approach to each landmark free of tall buildings.
    if (landmarks.some(landmark => route.some((p, i) => {
      if (i % 20) return false;
      const delta = landmark.position.clone().sub(p), length = delta.length();
      if (length > 850) return false;
      const view = new THREE.Vector3(x - p.x, 0, z - p.z), axis = new THREE.Vector3(delta.x, 0, delta.z);
      const t = view.dot(axis) / axis.lengthSq();
      return t > .05 && t < .98 && view.addScaledVector(axis, -t).length() < radius + 35;
    }))) continue;
    const district = definition.district;
    const height = district === 'skyline' ? 100 + random() * 200 : district === 'orbital' ? 80 + random() * 180 : district === 'industrial' ? 25 + random() * 65 : district === 'stadium' ? 25 + random() * 55 : district === 'harbor' ? 20 + random() * 40 : district === 'desert' ? 16 + random() * 34 : 40 + random() * 120;
    const floor = district === 'orbital' ? 24 + random() * 40 : 0;
    const firstBox = boxes.length, firstWindow = windows.length, firstAccent = accents.length;
    boxes.push(matrix(x, floor + height / 2, z, width, height, depth));
    // Terraced crowns, reactor pylons and arena bleachers produce distinct silhouettes.
    if (district === 'research' || district === 'skyline') boxes.push(matrix(x, floor + height + 12, z, width * .65, 24, depth * .65));
    if (district === 'industrial') boxes.push(matrix(x + width * .3, floor + height + 18, z, 5, 36, 5));
    if (district === 'harbor') {
      // Narrow pylons and a cantilevered beam above each dock warehouse.
      boxes.push(matrix(x - width * .3, floor + height + 16, z, 4, 32, 4));
      boxes.push(matrix(x, floor + height + 31, z, width * .85, 3, 4));
      accents.push(matrix(x, floor + height + 33, z, width * .85, .6, 4));
    }
    if (district === 'desert') {
      boxes.push(matrix(x, floor + height + 5, z, width * .7, 10, depth * .7));
      boxes.push(matrix(x, floor + height + 12, z, width * .4, 4, depth * .4));
      for (const side of [-1, 1]) {
        boxes.push(matrix(x + side * width * .32, floor + height + 11, z, width * .18, .7, depth * .6));
        accents.push(matrix(x + side * width * .32, floor + height + 11.5, z, width * .16, .3, depth * .55));
      }
    }
    if (district === 'stadium') {
      for (let tier = 1; tier <= 3; tier++) boxes.push(matrix(x + tier * 9, floor + tier * 6, z, width + 12, 5, depth * 1.5));
    }
    for (let y = floor + 8; y < floor + height - 3; y += district === 'industrial' ? 12 : 7) {
      if (random() < .2) continue;
      windows.push(matrix(x, y, z - depth / 2 - .05, width * (.5 + random() * .35), .8, .12));
      windows.push(matrix(x + width / 2 + .05, y, z, .12, .8, depth * .8));
      if (random() > .35) windows.push(matrix(x, y, z + depth / 2 + .05, width * .75, .8, .12));
    }
    accents.push(matrix(x, floor + height, z, width + .3, .55, depth + .3));
    clusters.push({ center: new THREE.Vector3(x, floor + height / 2, z), radius: Math.hypot(radius, height / 2 + 36),
      boxes: boxes.slice(firstBox), windows: windows.slice(firstWindow), accents: accents.slice(firstAccent) });
  }
  const geometry = new THREE.BoxGeometry();
  const mesh = (mat: THREE.Material, matrices: THREE.Matrix4[], name: string) => {
    const result = new THREE.InstancedMesh(geometry, mat, matrices.length); result.name = name;
    matrices.forEach((m, i) => result.setMatrixAt(i, m)); result.computeBoundingSphere(); object.add(result); return result;
  };
  const bodies = mesh(bodyMaterial, boxes, 'city-silhouettes');
  const lights = mesh(windowMaterial, windows, 'city-windows');
  const crowns = mesh(accentMaterial, accents, 'city-crowns');
  object.add(...landmarkObjects);
  let quality: RenderQuality = 'balanced';
  const lastPosition = new THREE.Vector3(Infinity, Infinity, Infinity);
  let dirty = true;
  const update = (position: THREE.Vector3) => {
    if (!dirty && lastPosition.distanceToSquared(position) < 35 ** 2) return;
    dirty = false; lastPosition.copy(position);
    const ranges = quality === 'low' ? [480, 165] : quality === 'high' ? [800, 380] : [650, 280];
    let bodyCount = 0, windowCount = 0, crownCount = 0;
    for (const cluster of clusters) {
      const distance = cluster.center.distanceTo(position) - cluster.radius;
      if (distance > ranges[0]) continue;
      for (const matrix of cluster.boxes) bodies.setMatrixAt(bodyCount++, matrix);
      for (const matrix of cluster.accents) crowns.setMatrixAt(crownCount++, matrix);
      if (distance > ranges[1]) continue;
      for (let i = 0; i < cluster.windows.length; i += quality === 'low' ? 2 : 1) lights.setMatrixAt(windowCount++, cluster.windows[i]);
    }
    for (const [mesh, count] of [[bodies, bodyCount], [lights, windowCount], [crowns, crownCount]] as const) {
      mesh.count = count; mesh.instanceMatrix.needsUpdate = true;
    }
    landmarkObjects.forEach((object, i) => {
      const descriptor = landmarks[i];
      const range = quality === 'low' ? 1400 : 2200;
      object.visible = descriptor.position.distanceTo(position) - descriptor.height < range;
    });
  };
  update(track.sample(0).position);
  return {
    object, landmark, landmarks, counts: { buildings: clusters.length, windows: windows.length },
    setQuality(value: RenderQuality) { if (quality !== value) { quality = value; dirty = true; update(lastPosition.clone()); } },
    setOverview(overview: boolean) { object.visible = !overview; },
    update,
  };
}
