import * as THREE from 'three';
import type { Track } from './createTrack.js';
import { DISTRICTS } from './trackCatalog.js';
import type { TrackDefinition } from './trackCatalog.js';
import type { RenderQuality } from '../../platform/renderQuality.js';

/** Seeded instanced silhouettes and emissive windows; no per-window lights or draw calls. */
export function createDistrictScenery(track: Track, definition: TrackDefinition) {
  let seed = [...definition.id].reduce((n, c) => Math.imul(n ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const route: THREE.Vector3[] = [];
  const bounds = new THREE.Box3();
  for (let d = 0; d < track.length; d += 16) { const p = track.sample(d).position.clone(); route.push(p); bounds.expandByPoint(p); }
  bounds.expandByScalar(230);
  const object = new THREE.Group(); object.name = `district-${definition.district}`;
  const color = new THREE.Color(DISTRICTS[definition.district].color);
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: '#09131d', roughness: .8, metalness: .45 });
  const windowMaterial = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(1.7), toneMapped: false });
  const accentMaterial = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(.75), toneMapped: false });
  const boxes: THREE.Matrix4[] = [], windows: THREE.Matrix4[] = [], accents: THREE.Matrix4[] = [];
  const dummy = new THREE.Object3D();
  const matrix = (x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    dummy.position.set(x, y, z); dummy.scale.set(sx, sy, sz); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); return dummy.matrix.clone();
  };
  const size = bounds.getSize(new THREE.Vector3());
  const count = Math.min(180, Math.ceil(track.length / 24));
  let attempts = 0;
  while (boxes.length < count && attempts++ < count * 30) {
    const x = bounds.min.x + random() * size.x, z = bounds.min.z + random() * size.z;
    const width = 18 + random() * 28, depth = 18 + random() * 28;
    const clearance = Math.hypot(width, depth) / 2 + track.halfWidth + 26 + (definition.district === 'stadium' ? 50 : 0);
    // Horizontal rejection protects the full vertical swept corridor, including upside-down sections.
    if (route.some(p => Math.hypot(p.x - x, p.z - z) < clearance)) continue;
    const district = definition.district;
    const height = district === 'skyline' ? 100 + random() * 200 : district === 'orbital' ? 80 + random() * 180 : district === 'industrial' ? 25 + random() * 65 : district === 'stadium' ? 25 + random() * 55 : 40 + random() * 120;
    const floor = district === 'orbital' ? 24 + random() * 40 : 0;
    boxes.push(matrix(x, floor + height / 2, z, width, height, depth));
    // Terraced crowns, reactor pylons and arena bleachers produce distinct silhouettes.
    if (district === 'research' || district === 'skyline') boxes.push(matrix(x, floor + height + 12, z, width * .65, 24, depth * .65));
    if (district === 'industrial') boxes.push(matrix(x + width * .3, floor + height + 18, z, 5, 36, 5));
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
  }
  const geometry = new THREE.BoxGeometry();
  const mesh = (mat: THREE.Material, matrices: THREE.Matrix4[], name: string) => {
    const result = new THREE.InstancedMesh(geometry, mat, matrices.length); result.name = name;
    matrices.forEach((m, i) => result.setMatrixAt(i, m)); result.computeBoundingSphere(); object.add(result); return result;
  };
  const bodies = mesh(bodyMaterial, boxes, 'city-silhouettes');
  const lights = mesh(windowMaterial, windows, 'city-windows');
  const crowns = mesh(accentMaterial, accents, 'city-crowns');
  let quality: RenderQuality = 'balanced';
  return {
    object, counts: { buildings: boxes.length, windows: windows.length },
    setQuality(value: RenderQuality) { quality = value; lights.count = value === 'low' ? Math.ceil(windows.length / 2) : windows.length; },
    setOverview(overview: boolean) { object.visible = !overview; },
    update(position: THREE.Vector3) {
      // Three draw calls irrespective of city size; far clipping and fog handle distant districts.
      bodies.visible = crowns.visible = true; lights.visible = quality !== 'low' || position.y < 250;
    },
  };
}
