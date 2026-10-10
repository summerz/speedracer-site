import * as THREE from 'three';
import type { Track } from './createTrack.js';
import { DISTRICTS } from './trackCatalog.js';
import type { TrackDefinition } from './trackCatalog.js';
import type { RenderQuality } from '../../platform/renderQuality.js';
import { createSkyTraffic } from './createSkyTraffic.js';
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
  const timeUniform = { value: 0 };
  const HASH = 'fract(sin(dot(instanceMatrix[3].xyz, vec3(12.9898, 78.233, 37.719))) * 43758.5453)';
  const patch = (mat: THREE.MeshBasicMaterial, key: string, fragment: string) => {
    mat.customProgramCacheKey = () => key;
    mat.onBeforeCompile = shader => {
      shader.uniforms.uTime = timeUniform;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vHash;\nvarying vec2 vUv2;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>\nvHash = ${HASH};\nvUv2 = uv;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying float vHash;\nvarying vec2 vUv2;')
        .replace('#include <color_fragment>', `#include <color_fragment>\n${fragment}`);
    };
  };
  patch(windowMaterial, 'city-window-flicker', `
    {
      float h = vHash, b = 1.0;
      if (h < 0.10) {
        float period = 9.0 + h * 110.0, t = fract(uTime / period + h * 13.0);
        b = mix(0.15, 1.0, smoothstep(0.25, 0.25 + 0.4 / period, t) * (1.0 - smoothstep(1.0 - 0.4 / period, 1.0, t)));
      } else if (h > 0.94) {
        float period = 6.0 + (h - 0.94) * 133.0, t = mod(uTime + h * 97.0, period);
        b = t < 0.6 ? mix(0.3, 1.0, step(0.5, fract(uTime * 17.0 + h * 7.0))) : 1.0;
      }
      diffuseColor.rgb *= b;
    }`);
  const billboardMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  patch(billboardMaterial, 'city-billboard-ads', `
    {
      float h = vHash, len = 6.0 + h * 4.0, tc = uTime / len, cyc = floor(tc), ph = fract(tc);
      vec3 pal[4] = vec3[4](vec3(0.337, 0.855, 0.812), vec3(1.0, 0.31, 0.847), vec3(1.0, 0.702, 0.278), vec3(0.545, 0.482, 1.0));
      int ia = int(mod(floor(cyc + h * 5.0), 4.0)), ib = int(mod(floor(cyc - 1.0 + h * 5.0), 4.0));
      vec3 ca = pal[ia], cb = pal[ib];
      float wipe = clamp(ph * len / 0.35, 0.0, 1.0);
      vec3 base = vUv2.x > wipe ? cb : ca;
      float cy = vUv2.x > wipe ? cyc - 1.0 : cyc;
      float bands = 0.4 + 0.6 * step(0.5, fract(vUv2.y * 3.0 + cy * 0.37));
      float border = max(max(step(vUv2.x, 0.04), step(0.96, vUv2.x)), max(step(vUv2.y, 0.06), step(0.94, vUv2.y)));
      diffuseColor.rgb = base * max(bands, border * 1.25) * 0.95;
    }`);
  const accentMaterial = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(.75), toneMapped: false });
  const boxes: THREE.Matrix4[] = [], windows: THREE.Matrix4[] = [], accents: THREE.Matrix4[] = [], billboards: THREE.Matrix4[] = [];
  const clusters: { center: THREE.Vector3; radius: number; foot: number; boxes: THREE.Matrix4[]; windows: THREE.Matrix4[]; accents: THREE.Matrix4[]; billboards: THREE.Matrix4[] }[] = [];
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
    const firstBox = boxes.length, firstWindow = windows.length, firstAccent = accents.length, firstBillboard = billboards.length;
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
    if (district !== 'desert' && district !== 'harbor' && random() < .22 && height > 45) {
      // Face the panel toward the nearest stretch of road so drivers actually see it.
      const near = route.reduce((a, p) => Math.hypot(p.x - x, p.z - z) < Math.hypot(a.x - x, a.z - z) ? p : a), dx = near.x - x, dz = near.z - z, y = floor + height * (.55 + random() * .25);
      billboards.push(Math.abs(dx) > Math.abs(dz) ? matrix(x + Math.sign(dx) * (width / 2 + .3), y, z, .25, 11, Math.min(depth * .7, 26)) : matrix(x, y, z + Math.sign(dz) * (depth / 2 + .3), Math.min(width * .7, 26), 11, .25));
    }
    accents.push(matrix(x, floor + height, z, width + .3, .55, depth + .3));
    clusters.push({ center: new THREE.Vector3(x, floor + height / 2, z), foot: radius, radius: Math.hypot(radius, height / 2 + 36),
      boxes: boxes.slice(firstBox), windows: windows.slice(firstWindow), accents: accents.slice(firstAccent), billboards: billboards.slice(firstBillboard) });
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
  const boards = mesh(billboardMaterial, billboards, 'city-billboards');

  // --- Depth layers: separate seeded stream so the main city layout above is untouched. ---
  const district = definition.district;
  let seed2 = (scenerySeed(definition.id) ^ 0xd15c) >>> 0;
  const rnd = () => { seed2 = (Math.imul(seed2, 1664525) + 1013904223) >>> 0; return seed2 / 4294967296; };
  // Far skyline ring: one instanced draw with procedural window dots in world space.
  const ringMaterial = new THREE.MeshBasicMaterial({ color: district === 'desert' ? '#16110b' : '#060c14', toneMapped: false });
  ringMaterial.customProgramCacheKey = () => 'city-far-ring';
  ringMaterial.onBeforeCompile = shader => {
    shader.uniforms.uTime = timeUniform; shader.uniforms.uLit = { value: color.clone().multiplyScalar(1.2) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vHash;\nvarying vec3 vCell;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      vHash = ${HASH};
      vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
      float wy = (modelMatrix * instanceMatrix * vec4(position, 1.0)).y;
      float xFace = step(0.5, abs(normal.x));
      float u = mix(position.x * sc.x + sign(normal.z) * 1000.0, position.z * sc.z + sign(normal.x) * 2000.0, xFace);
      vCell = vec3(u, wy, step(0.5, abs(normal.y)));`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform vec3 uLit;\nvarying float vHash;\nvarying vec3 vCell;')
      .replace('#include <color_fragment>', `#include <color_fragment>
      if (vCell.z < 0.5) {
        vec2 cell = vec2(floor(vCell.x / 5.0), floor(vCell.y / 4.5)), f = vec2(fract(vCell.x / 5.0), fract(vCell.y / 4.5));
        float h = fract(sin(dot(cell + vHash * 91.0, vec2(12.9898, 78.233))) * 43758.5453);
        float period = 20.0 + h * 40.0;
        float h2 = fract(sin(dot(cell + vHash * 91.0 + floor(uTime / period), vec2(39.346, 11.135))) * 43758.5453);
        float on = step(h2, 0.35) * step(0.2, f.x) * step(f.x, 0.8) * step(0.3, f.y) * step(f.y, 0.65);
        diffuseColor.rgb += uLit * on;
      }`);
  };
  const ringAll: THREE.Matrix4[] = [];
  const ringCenter = bounds.getCenter(new THREE.Vector3()), halfDiag = Math.hypot(size.x, size.z) / 2;
  for (let i = 0; i < 140; i++) {
    const angle = rnd() * Math.PI * 2, dist = halfDiag + 120 + rnd() * 530;
    let w = 30 + rnd() * 50, d = 30 + rnd() * 50, h: number;
    if (district === 'skyline' || district === 'orbital') h = 120 + rnd() * 260;
    else if (district === 'residential' || district === 'research') h = 70 + rnd() * 150;
    else if (district === 'industrial') { h = 40 + rnd() * 80; if (rnd() < .12) { w = d = 10 + rnd() * 6; h = 140; } }
    else if (district === 'desert') { w = 60 + rnd() * 100; d = 50 + rnd() * 80; h = 20 + rnd() * 40; }
    else h = 30 + rnd() * 60;
    dummy.position.set(ringCenter.x + Math.cos(angle) * dist, h / 2, ringCenter.z + Math.sin(angle) * dist);
    dummy.scale.set(w, h, d); dummy.rotation.set(0, rnd() * Math.PI, 0); dummy.updateMatrix(); ringAll.push(dummy.matrix.clone());
  }
  dummy.rotation.set(0, 0, 0);
  const ring = mesh(ringMaterial, ringAll, 'city-far-ring');
  ring.frustumCulled = false;

  // Low-rise fill near the road: cheap small buildings drawn only inside the window range.
  type LowRise = { center: THREE.Vector3; radius: number; boxes: THREE.Matrix4[]; accents: THREE.Matrix4[] };
  const lowRise: LowRise[] = [];
  if (district !== 'orbital') {
    const wanted = Math.round(clusters.length * 2.5), sparseRoute = route.filter((_, i) => i % 2 === 0);
    for (let a = 0; lowRise.length < wanted && a < wanted * 25; a++) {
      const base = route[Math.floor(rnd() * route.length)], ang = rnd() * Math.PI * 2, reach = track.halfWidth + 14 + rnd() * 240;
      const x = base.x + Math.cos(ang) * reach, z = base.z + Math.sin(ang) * reach;
      const boxesHere: THREE.Matrix4[] = [], accentsHere: THREE.Matrix4[] = [];
      let radius: number, top: number;
      if (district === 'harbor') {
        const n = 3 + Math.floor(rnd() * 4), stack = 1 + Math.floor(rnd() * 3), alongX = rnd() < .5;
        radius = Math.hypot(6 * n, 3 * stack) + 2; top = stack * 3;
        for (let k = 0; k < n; k++) for (let l = 0; l < stack; l++) {
          const off = (k - (n - 1) / 2) * 3.2;
          boxesHere.push(alongX ? matrix(x, 1.5 + l * 3, z + off, 12, 3, 3) : matrix(x + off, 1.5 + l * 3, z, 3, 3, 12));
        }
        accentsHere.push(alongX ? matrix(x, top + .2, z, 12.3, .4, n * 3.2) : matrix(x, top + .2, z, n * 3.2, .4, 12.3));
      } else {
        const w = 8 + rnd() * 12, d = 8 + rnd() * 12;
        const h = district === 'desert' ? 3 + rnd() * 5 : 6 + rnd() * 12;
        radius = Math.hypot(w, d) / 2; top = h;
        boxesHere.push(matrix(x, h / 2, z, w, h, d));
        accentsHere.push(matrix(x, h + .2, z, w + .3, .4, d + .3));
      }
      if (sparseRoute.some(p => Math.hypot(p.x - x, p.z - z) < radius + track.halfWidth + 14)) continue;
      if (clusters.some(c => Math.hypot(c.center.x - x, c.center.z - z) < c.foot + radius + 4)) continue;
      if (landmarks.some(l => Math.hypot(l.position.x - x, l.position.z - z) < radius + l.radius + 20)) continue;
      lowRise.push({ center: new THREE.Vector3(x, top / 2, z), radius: radius + top / 2, boxes: boxesHere, accents: accentsHere });
    }
  }
  const lowBodies = mesh(bodyMaterial, lowRise.flatMap(b => b.boxes), 'city-lowrise');
  const lowCrowns = mesh(accentMaterial, lowRise.flatMap(b => b.accents), 'city-lowrise-crowns');
  const traffic = createSkyTraffic(route, bounds, definition.district, scenerySeed(definition.id) ^ 0x5eed);
  object.add(traffic.object);
  let quality: RenderQuality = 'balanced';
  const lastPosition = new THREE.Vector3(Infinity, Infinity, Infinity);
  let dirty = true;
  const update = (position: THREE.Vector3, time = 0) => {
    timeUniform.value = time;
    traffic.update(time);
    if (!dirty && lastPosition.distanceToSquared(position) < 35 ** 2) return;
    dirty = false; lastPosition.copy(position);
    const ranges = quality === 'low' ? [480, 165] : quality === 'high' ? [800, 380] : [650, 280];
    let bodyCount = 0, windowCount = 0, crownCount = 0, boardCount = 0, lowCount = 0, lowCrownCount = 0;
    for (const cluster of clusters) {
      const distance = cluster.center.distanceTo(position) - cluster.radius;
      if (distance > ranges[0]) continue;
      for (const matrix of cluster.boxes) bodies.setMatrixAt(bodyCount++, matrix);
      for (const matrix of cluster.accents) crowns.setMatrixAt(crownCount++, matrix);
      if (distance > ranges[1]) continue;
      for (const matrix of cluster.billboards) boards.setMatrixAt(boardCount++, matrix);
      for (let i = 0; i < cluster.windows.length; i += quality === 'low' ? 2 : 1) lights.setMatrixAt(windowCount++, cluster.windows[i]);
    }
    for (let i = 0; i < lowRise.length; i += quality === 'low' ? 2 : 1) {
      const b = lowRise[i];
      if (b.center.distanceTo(position) - b.radius > ranges[1]) continue;
      for (const matrix of b.boxes) lowBodies.setMatrixAt(lowCount++, matrix);
      for (const matrix of b.accents) lowCrowns.setMatrixAt(lowCrownCount++, matrix);
    }
    ring.count = quality === 'low' ? ringAll.length >> 1 : ringAll.length;
    for (const [mesh, count] of [[bodies, bodyCount], [lights, windowCount], [crowns, crownCount], [boards, boardCount], [lowBodies, lowCount], [lowCrowns, lowCrownCount]] as const) {
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
    object, landmark, landmarks, counts: { buildings: clusters.length, windows: windows.length, billboards: billboards.length },
    setQuality(value: RenderQuality) { traffic.setQuality(value); if (quality !== value) { quality = value; dirty = true; update(lastPosition.clone()); } },
    setOverview(overview: boolean) { object.visible = !overview; },
    update,
  };
}
