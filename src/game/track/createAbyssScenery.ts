import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Track } from './createTrack.js';
import type { TrackDefinition } from './trackCatalog.js';
import type { RenderQuality } from '../../platform/renderQuality.js';
import { MARINE_ZONES, type MarinePalette } from '../environment/marineZones.js';
import { createTrackLandmark, describeTrackLandmarks, sceneryRoute, scenerySeed } from './createTrackLandmark.js';

/** GLSL vec3 literal from sRGB components (the shaders write them straight to the output, as the old literals did). */
const v3 = (c: THREE.Color, k = 1) => { const o = { r: 0, g: 0, b: 0 }; c.getRGB(o, THREE.SRGBColorSpace); return `vec3(${(o.r * k).toFixed(3)},${(o.g * k).toFixed(3)},${(o.b * k).toFixed(3)})`; };
const sceneryV3 = (hex: string, k = 1) => v3(new THREE.Color(hex), k);
let paletteKey = '';
const timeUniform = { value: 0 };

const PRELUDE_V = `varying vec3 vWorld; varying vec3 vN; varying vec3 vView; varying vec2 vUv; varying float vHash, vDepth, vLen, vY;
uniform float uTime;`;
const PRELUDE_F = `varying vec3 vWorld; varying vec3 vN; varying vec3 vView; varying vec2 vUv; varying float vHash, vDepth, vLen, vY;
uniform float uTime; uniform vec3 fogColor; uniform float fogDensity;
float gridLine(float x){ float d=.5-abs(fract(x)-.5); return 1.-smoothstep(0., max(fwidth(x),.002)*1.4, d); }
vec4 fogOut(vec3 c,float a){
  float f=1.-exp(-fogDensity*fogDensity*vDepth*vDepth);
  #ifdef ADDITIVE
  return vec4(c*(1.-f),a);
  #else
  return vec4(mix(c,fogColor,f),a);
  #endif
}`;
/** Instanced ShaderMaterial with exponential-squared fog applied by hand (additive materials fade out instead of toward the fog colour). */
function shader(key: string, local: string, world: string, fragment: string, o: { additive?: boolean; side?: THREE.Side; extra?: Record<string, THREE.IUniform> } = {}) {
  const material = new THREE.ShaderMaterial({
    uniforms: Object.assign(THREE.UniformsUtils.merge([THREE.UniformsLib.fog, o.extra ?? {}]), { uTime: timeUniform }),
    vertexShader: `${PRELUDE_V}
    void main(){
      vec3 pos=position; mat4 inst=mat4(1.);
      #ifdef USE_INSTANCING
      inst=instanceMatrix;
      #endif
      vHash=fract(sin(dot(inst[3].xyz,vec3(12.9898,78.233,37.719)))*43758.5453);
      vUv=uv; vLen=length(inst[1].xyz);
      ${local}
      vY=pos.y;
      vec4 w=modelMatrix*inst*vec4(pos,1.);
      ${world}
      vWorld=w.xyz; vN=normalize(mat3(modelMatrix)*mat3(inst)*normal);
      vec4 mv=viewMatrix*w; vView=mv.xyz; vDepth=-mv.z;
      gl_Position=projectionMatrix*mv;
    }`,
    fragmentShader: `${PRELUDE_F}
    void main(){ ${fragment}
      #include <colorspace_fragment>
    }`,
    fog: true, side: o.side ?? THREE.DoubleSide, toneMapped: false,
    transparent: !!o.additive, depthWrite: !o.additive, blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    defines: o.additive ? { ADDITIVE: '' } : {},
  });
  const programKey = `${key}:${paletteKey}`;
  material.customProgramCacheKey = () => programKey;
  return material;
}

/** Adds an instanced attribute declaration (and optional varying hand-off) to a shader() material. */
function declareAttributes(m: THREE.ShaderMaterial, vertexDecl: string, vertexInit = '', fragmentDecl = '') {
  m.vertexShader = m.vertexShader.replace('void main(){', `${vertexDecl}\nvoid main(){ ${vertexInit}`);
  if (fragmentDecl) m.fragmentShader = m.fragmentShader.replace('void main(){', `${fragmentDecl}\nvoid main(){`);
}
const tagged = (g: THREE.BufferGeometry, name: string, v: number) => { g.setAttribute(name, new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(v), 1)); return g; };

/**
 * ABYSS: glass domes, tubes, kelp, rocks, light shafts, a caustic seabed and a per-zone mix of jellyfish, whales, mantas, sharks and fish schools.
 * Same return shape as createDistrictScenery. `hidesGround` tells the caller to hide the GridHelper
 * (the seabed plane at y=0.05 would otherwise z-fight with it at distance).
 */
export function createAbyssScenery(track: Track, definition: TrackDefinition, palette: MarinePalette = MARINE_ZONES[0].palette) {
  paletteKey = [palette.glow, palette.accent, palette.kelp.join(), palette.sand, palette.caustic, palette.feature].join();
  const CYAN = new THREE.Color(palette.glow), PINK = new THREE.Color(palette.accent);
  const glowHue = CYAN.getHSL({ h: 0, s: 0, l: 0 }).h, accentHue = PINK.getHSL({ h: 0, s: 0, l: 0 }).h;
  const glow = (k = 1) => sceneryV3(palette.glow, k), accent = () => sceneryV3(palette.accent);
  let seed = (scenerySeed(definition.id) ^ 0xab55) >>> 0;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const range = (a: number, b: number) => a + random() * (b - a);
  const route = sceneryRoute(track), sparse = route.filter((_, i) => i % 2 === 0);
  const routeBox = new THREE.Box3(); route.forEach(p => routeBox.expandByPoint(p));
  const routeTop = routeBox.max.y, routeCenter = routeBox.getCenter(new THREE.Vector3()), routeSize = routeBox.getSize(new THREE.Vector3());
  const bounds = routeBox.clone().expandByScalar(230), size = bounds.getSize(new THREE.Vector3());
  const object = new THREE.Group(); object.name = 'district-abyss';
  const landmarks = describeTrackLandmarks(track, definition, route), landmark = landmarks[0];
  const landmarkObjects = landmarks.map(d => createTrackLandmark(d, false, true));
  object.add(...landmarkObjects);
  const dummy = new THREE.Object3D(), up = new THREE.Vector3(0, 1, 0);
  const matrix = (x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0) => {
    dummy.position.set(x, y, z); dummy.scale.set(sx, sy, sz); dummy.rotation.set(0, ry, 0); dummy.updateMatrix(); return dummy.matrix.clone();
  };
  const nearRoute = (x: number, z: number, limit: number, pts = sparse) => pts.some(p => Math.hypot(p.x - x, p.z - z) < limit);
  const nearLandmark = (x: number, z: number, r: number, pad: number) => landmarks.some(l => Math.hypot(l.position.x - x, l.position.z - z) < r + l.radius + pad);
  const add = (mesh: THREE.InstancedMesh, name: string) => { mesh.name = name; mesh.frustumCulled = false; object.add(mesh); return mesh; };
  const colorBuf = (n: number) => new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 3), 3);

  // --- Domes ---
  interface Dome { center: THREE.Vector3; radius: number; shell: THREE.Matrix4; lights: THREE.Matrix4[]; colors: THREE.Color[] }
  const domes: Dome[] = [];
  const wanted = Math.min(90, Math.max(40, Math.ceil(track.length / 40)));
  for (let a = 0; domes.length < wanted && a < wanted * 40; a++) {
    const x = bounds.min.x + random() * size.x, z = bounds.min.z + random() * size.z, r = range(18, 60);
    if (route.some(p => Math.hypot(p.x - x, p.z - z) < r + track.halfWidth + 36)) continue;
    if (nearLandmark(x, z, r, 28)) continue;
    if (landmarks.some(l => route.some((p, i) => {
      if (i % 20) return false;
      const delta = l.position.clone().sub(p), length = delta.length();
      if (length > 850) return false;
      const view = new THREE.Vector3(x - p.x, 0, z - p.z), axis = new THREE.Vector3(delta.x, 0, delta.z), t = view.dot(axis) / axis.lengthSq();
      return t > .05 && t < .98 && view.addScaledVector(axis, -t).length() < r + 35;
    }))) continue;
    if (domes.some(d => Math.hypot(d.center.x - x, d.center.z - z) < d.radius + r + 6)) continue;
    const lights: THREE.Matrix4[] = [], colors: THREE.Color[] = [];
    const n = Math.round(8 + r / 4);
    for (let i = 0; i < n; i++) {
      const ang = random() * 6.283, dist = Math.sqrt(random()) * r * .78, h = 1.5 + random() * Math.min(12, r * .4);
      lights.push(matrix(x + Math.cos(ang) * dist, h / 2, z + Math.sin(ang) * dist, range(.8, 2.6), h, range(.8, 2.6)));
      colors.push(new THREE.Color().setHSL((random() < .6 ? glowHue : accentHue) + random() * .04, .9, .62).multiplyScalar(1.4));
    }
    domes.push({ center: new THREE.Vector3(x, r / 2, z), radius: r, shell: matrix(x, 0, z, r, r, r), lights, colors });
  }
  const domeGeometry = new THREE.SphereGeometry(1, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  const domeMaterial = shader('abyss-dome', '', '', `
    vec3 n=normalize(vN), v=normalize(-vView);
    float fres=pow(1.-abs(dot(n,v)),2.5);
    float line=max(gridLine(vUv.x*12.)*smoothstep(.985,.86,vUv.y), gridLine(vUv.y*4.));
    vec3 c=${glow(.82)}*(.3+line*.9+fres*.5);
    gl_FragColor=fogOut(c,.07+.04*fres+line*.55);`, { additive: true });
  const domeMesh = add(new THREE.InstancedMesh(domeGeometry, domeMaterial, domes.length), 'abyss-domes');
  const lightMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const maxLights = domes.reduce((n, d) => n + d.lights.length, 0);
  const lightMesh = add(new THREE.InstancedMesh(new THREE.BoxGeometry(), lightMaterial, maxLights), 'abyss-city-lights');
  lightMesh.instanceColor = colorBuf(maxLights);

  // --- Tubes between neighbouring domes ---
  const tubes: THREE.Matrix4[] = [], pairs = new Set<string>();
  domes.forEach((d, i) => {
    if (random() > .55) return;
    const others = domes.map((o, j) => ({ o, j, dist: Math.hypot(o.center.x - d.center.x, o.center.z - d.center.z) })).filter(e => e.j !== i && e.dist < 300).sort((a, b) => a.dist - b.dist);
    const e = others[0]; if (!e || pairs.has(`${e.j}-${i}`)) return;
    pairs.add(`${i}-${e.j}`);
    const dir = new THREE.Vector3(e.o.center.x - d.center.x, 0, e.o.center.z - d.center.z).normalize();
    const from = d.center.clone().addScaledVector(dir, d.radius * .9), to = e.o.center.clone().addScaledVector(dir, -e.o.radius * .9);
    const length = from.distanceTo(to); if (length < 8) return;
    const mid = from.clone().add(to).multiplyScalar(.5);
    for (let k = 0; k <= 8; k++) { const p = from.clone().lerp(to, k / 8); if (nearRoute(p.x, p.z, 3 + track.halfWidth + 12, route)) return; }
    dummy.position.set(mid.x, 3, mid.z); dummy.quaternion.setFromUnitVectors(up, dir); dummy.scale.set(3, length, 3); dummy.updateMatrix(); tubes.push(dummy.matrix.clone());
  });
  dummy.quaternion.identity();
  const tubeMaterial = shader('abyss-tube', '', '', `
    vec3 n=normalize(vN), v=normalize(-vView);
    float fres=pow(1.-abs(dot(n,v)),2.);
    float ring=gridLine(vUv.y*vLen/12.);
    vec3 c=${glow()}*(.4+ring*1.5+fres*.5);
    gl_FragColor=fogOut(c,.1+.12*fres+ring*.7);`, { additive: true });
  const tubeMesh = add(new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 14, 1, true), tubeMaterial, tubes.length), 'abyss-tubes');
  tubes.forEach((m, i) => tubeMesh.setMatrixAt(i, m)); tubeMesh.frustumCulled = false;

  // --- Kelp clumps and rocks (placed near the road band and domes, never in the road clearance) ---
  const near = (reach: number, spread = 160) => { const b = route[Math.floor(random() * route.length)], ang = random() * 6.283, d = track.halfWidth + reach + random() * spread; return [b.x + Math.cos(ang) * d, b.z + Math.sin(ang) * d, b.y]; };
  const free = (x: number, z: number, r: number) => !nearRoute(x, z, r + track.halfWidth + 12) && !domes.some(d => Math.hypot(d.center.x - x, d.center.z - z) < d.radius + r + 4) && !nearLandmark(x, z, r, 14);
  /** Close-in placement: only the full route polyline at `halfWidth + gap` keeps it out of the driving corridor. */
  const freeNear = (x: number, z: number, gap: number) => !nearRoute(x, z, track.halfWidth + gap, route) && !domes.some(d => Math.hypot(d.center.x - x, d.center.z - z) < d.radius + 4) && !nearLandmark(x, z, 2, 14);
  interface Clump { center: THREE.Vector3; radius: number; blades: THREE.Matrix4[] }
  const kelp: Clump[] = [];
  const kelpWanted = Math.min(260, Math.ceil(track.length / 9));
  for (let a = 0; kelp.length < kelpWanted && a < kelpWanted * 20; a++) {
    const [x, z] = near(12); if (!free(x, z, 8)) continue;
    const blades: THREE.Matrix4[] = [], n = 3 + Math.floor(random() * 4);
    for (let i = 0; i < n; i++) blades.push(matrix(x + range(-6, 6), 0, z + range(-6, 6), range(1.4, 2.8), range(12, 40), 1, random() * 3.14));
    kelp.push({ center: new THREE.Vector3(x, 20, z), radius: 40, blades });
  }
  // Near-road kelp: tall enough to reach the (elevated) road so straights have mid-water structure.
  const nearKelpWanted = Math.min(140, Math.ceil(track.length / 16));
  for (let placed = 0, a = 0; placed < nearKelpWanted && a < nearKelpWanted * 30; a++) {
    const [x, z, by] = near(10, 34); if (!freeNear(x, z, 10)) continue;
    const blades: THREE.Matrix4[] = [], n = 2 + Math.floor(random() * 3); let tall = 12;
    for (let i = 0; i < n; i++) {
      const bx = x + range(-4, 4), bz = z + range(-4, 4); if (nearRoute(bx, bz, track.halfWidth + 8, route)) continue;
      const h = Math.max(12, by + range(5, 25)); tall = Math.max(tall, h);
      blades.push(matrix(bx, 0, bz, range(1.6, 3), h, 1, random() * 3.14));
    }
    if (!blades.length) continue;
    kelp.push({ center: new THREE.Vector3(x, tall / 2, z), radius: Math.max(40, tall / 2 + 10), blades }); placed++;
  }
  const bladeGeometry = new THREE.PlaneGeometry(1, 1, 1, 8); bladeGeometry.translate(0, .5, 0);
  // Segmented ribbon: bend grows with (h/H)^2, a slow twist and a tapered tip; dark teal base to glowing tip.
  const kelpMaterial = shader('abyss-kelp', `
    float kt=pos.y;
    pos.x*=1.-.78*kt;
    float tw=kt*(.9+vHash*1.6)*sin(uTime*.35+vHash*20.), cs=cos(tw), sn=sin(tw);
    pos.xz=vec2(cs*pos.x-sn*pos.z, sn*pos.x+cs*pos.z);`, `
    float kb=vY*vY, kp=vHash*40., ka=2.+vLen*.075;
    w.x+=(sin(uTime*.7+kp+vY*1.8)+.35*sin(uTime*1.35+kp*1.7+vY*3.4)+.5)*ka*kb;
    w.z+=(cos(uTime*.55+kp*.8+vY*1.5)*.7+.2*sin(uTime*1.1+kp+vY*4.))*ka*kb;`, `
    float kh=vUv.y, km=1.-smoothstep(0.,.5,abs(vUv.x-.5));
    vec3 c=mix(${sceneryV3(palette.kelp[0])},${sceneryV3(palette.kelp[1])},smoothstep(0.,.65,kh));
    c+=${sceneryV3(palette.kelp[2])}*(kh*kh*sqrt(max(kh,.0001))*.8+km*.04);
    gl_FragColor=fogOut(c,1.);`);
  const kelpMesh = add(new THREE.InstancedMesh(bladeGeometry, kelpMaterial, kelp.reduce((n, c) => n + c.blades.length, 0)), 'abyss-kelp');

  interface Rock { center: THREE.Vector3; radius: number; rocks: THREE.Matrix4[]; tips: THREE.Matrix4[]; tipColors: THREE.Color[] }
  const rocks: Rock[] = [];
  const rockWanted = Math.min(200, Math.ceil(track.length / 16)), nearRockWanted = Math.min(70, Math.ceil(track.length / 40));
  for (let a = 0; rocks.length < rockWanted + nearRockWanted && a < (rockWanted + nearRockWanted) * 20; a++) {
    const close = rocks.length >= rockWanted;
    const [x, z] = close ? near(10, 40) : near(10); if (close ? !freeNear(x, z, 18) : !free(x, z, 10)) continue;
    const rs: THREE.Matrix4[] = [], ts: THREE.Matrix4[] = [], tc: THREE.Color[] = [], n = 2 + Math.floor(random() * 3);
    for (let i = 0; i < n; i++) {
      const rx = x + range(-6, 6), rz = z + range(-6, 6), sx = range(2, 7), sy = range(1.2, 4), sz = range(2, 7), ry = random() * 3.14;
      rs.push(matrix(rx, sy * .45, rz, sx, sy, sz, ry));
      for (let k = 0; k < 2; k++) {
        const th = range(1.2, 3.4);
        ts.push(matrix(rx + range(-sx, sx) * .4, sy * .9 + th / 2, rz + range(-sz, sz) * .4, range(.3, .7), th, range(.3, .7)));
        tc.push((random() < .55 ? PINK : CYAN).clone().multiplyScalar(1.6));
      }
    }
    rocks.push({ center: new THREE.Vector3(x, 2, z), radius: 22, rocks: rs, tips: ts, tipColors: tc });
  }
  const rockMesh = add(new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: palette.rock, roughness: .95, metalness: .1, flatShading: true }), rocks.reduce((n, r) => n + r.rocks.length, 0)), 'abyss-rocks');
  const tipCount = rocks.reduce((n, r) => n + r.tips.length, 0);
  const tipMesh = add(new THREE.InstancedMesh(new THREE.ConeGeometry(.5, 1, 5), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), tipCount), 'abyss-coral-tips');
  tipMesh.instanceColor = colorBuf(tipCount);

  // --- Anchored pylons: cable chains from the seabed up past road height, each with glowing buoys (2 draw calls) ---
  interface Pylon { center: THREE.Vector3; radius: number; pole: THREE.Matrix4; buoys: THREE.Matrix4[]; colors: THREE.Color[] }
  const pylons: Pylon[] = [];
  const pylonStep = 4, pylonCap = Math.min(110, Math.ceil(track.length / 40));
  for (let i = Math.floor(random() * pylonStep), side = 1; i < route.length && pylons.length < pylonCap; i += pylonStep + Math.floor(random() * 2)) {
    const p = route[i], q = route[(i + 1) % route.length], o = route[(i + route.length - 1) % route.length];
    const tx = q.x - o.x, tz = q.z - o.z, tl = Math.hypot(tx, tz); if (tl < 1 || tl > 60) continue;
    side = -side;
    const d = track.halfWidth + range(26, 76), x = p.x + tz / tl * d * side, z = p.z - tx / tl * d * side;
    if (nearRoute(x, z, track.halfWidth + 22, route) || domes.some(dm => Math.hypot(dm.center.x - x, dm.center.z - z) < dm.radius + 3) || nearLandmark(x, z, 2, 14)) continue;
    const h = Math.max(16, p.y + range(8, 22)), top = (random() < .6 ? CYAN : PINK).clone().multiplyScalar(2.2);
    const buoys = [matrix(x, h, z, 1.7, 1.7, 1.7), matrix(x, h * .34, z, .8, .8, .8), matrix(x, h * .67, z, .8, .8, .8)];
    pylons.push({ center: new THREE.Vector3(x, h / 2, z), radius: h / 2 + 4, pole: matrix(x, 0, z, .28, h, .28), buoys, colors: [top, top.clone().multiplyScalar(.6), top.clone().multiplyScalar(.6)] });
  }
  const poleGeometry = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true); poleGeometry.translate(0, .5, 0);
  const poleMaterial = shader('abyss-pylon', '', '', `
    float bead=gridLine(vUv.y*vLen/5.);
    gl_FragColor=fogOut(${glow()}*(.5+bead*1.6),.22+bead*.5);`, { additive: true });
  const poleMesh = add(new THREE.InstancedMesh(poleGeometry, poleMaterial, pylons.length), 'abyss-pylons');
  const buoyCount = pylons.length * 3;
  const buoyMesh = add(new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), buoyCount), 'abyss-buoys');
  buoyMesh.instanceColor = colorBuf(buoyCount);

  // --- Glass tunnels: decorative half-tube arches over 2-3 straight stretches (no collision; 2 draw calls) ---
  const tunnelGlass = createTunnels(track, random, range, palette);
  if (tunnelGlass) { tunnelGlass.glass.name = 'abyss-tunnel-glass'; tunnelGlass.glass.userData.ranges = tunnelGlass.chosen; tunnelGlass.ribs.name = 'abyss-tunnel-ribs'; object.add(tunnelGlass.glass, tunnelGlass.ribs); }

  // --- Landmark: tint city-looking materials to the abyss palette ---
  const tinted = new Set<THREE.Material>();
  landmarkObjects.forEach(o => o.traverse(child => {
    const mesh = child as THREE.Mesh; if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (tinted.has(m)) continue; tinted.add(m);
      const std = m as THREE.MeshStandardMaterial, basic = m as THREE.MeshBasicMaterial;
      if (std.isMeshStandardMaterial) { std.color.set(palette.rock).multiplyScalar(.8); std.emissive.copy(CYAN).multiplyScalar(.1); std.metalness = .3; if (o.userData.landmark?.kind === 'dome') { std.transparent = true; std.opacity = .3; std.depthWrite = false; } }
      else if (basic.isMeshBasicMaterial) { const lum = Math.min(1.1, Math.max(basic.color.r, basic.color.g, basic.color.b, .2)); basic.color.copy(tinted.size % 3 === 0 ? PINK : CYAN).multiplyScalar(lum); }
    }
  }));

  // --- Jellyfish: fixed anchors beside the route (placed with the fauna below); bell pulse, drift and tentacle sway run in the vertex shader. No twinkle: constant glow. ---
  const JELLY_CAP = 24;
  for (let i = 0; i < JELLY_CAP * 7; i++) random(); // the old camera-relative field drew these numbers; keep consuming them so the shaft layout below stays put
  const whalePhase = random() * 6.283, whaleReach = range(450, 750);
  const bell = new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  const tentacles = [0, 1, 2, 3, 4].map(i => { const g = new THREE.ConeGeometry(.05, 3, 4, 3, true); g.rotateX(Math.PI); g.translate(Math.cos(i * 1.257) * .45, -1.5, Math.sin(i * 1.257) * .45); return g; });
  const jellyMaterial = shader('abyss-jelly', `
    float pulse=sin(uTime*.9+vHash*40.);
    if(pos.y>=-.01){ pos.xz*=1.+.07*pulse; pos.y*=1.-.05*pulse; }
    else pos.xz+=vec2(sin(uTime*.8+pos.y*2.+vHash*9.),cos(uTime*.75+pos.y*2.+vHash*7.))*.25*(-pos.y);`, `
    w.xyz+=vec3(sin(uTime*.13+vHash*60.)*7.,sin(uTime*.2+vHash*30.)*3.5,cos(uTime*.11+vHash*80.)*7.);`, `
    vec3 n=normalize(vN), v=normalize(-vView);
    float fres=pow(max(1.-abs(dot(n,v)),0.),1.8);
    vec3 base=mix(${accent()},${glow()},step(.5,fract(vHash*7.)));
    float tent=step(vY,-.01);
    gl_FragColor=fogOut(base*.85*(tent*.8+(1.-tent)*(.6+fres)), tent*.5+(1.-tent)*(.2+fres*.5));`, { additive: true });
  const jellyMesh = add(new THREE.InstancedMesh(mergeGeometries([bell, ...tentacles]), jellyMaterial, JELLY_CAP), 'abyss-jellyfish');

  // --- Light shafts ---
  const SHAFTS = { low: 4, balanced: 6, high: 8 } as const, SHAFT_TOP = routeTop + 250, SHAFT_LENGTH = SHAFT_TOP + 20;
  const shafts = Array.from({ length: SHAFTS.high }, (_, i) => {
    const p = route[Math.floor((i + random()) / SHAFTS.high * route.length) % route.length], ang = random() * 6.283, d = range(40, 200);
    return { x: p.x + Math.cos(ang) * d, z: p.z + Math.sin(ang) * d, tilt: range(.08, .22), dir: random() * 6.283, phase: random() * 6.283, width: range(16, 30) };
  });
  const shaftGeometry = new THREE.ConeGeometry(1, 1, 20, 1, true); shaftGeometry.translate(0, -.5, 0);
  const shaftMaterial = shader('abyss-shaft', '', '', `
    float fade=pow(clamp(vUv.y,0.,1.),1.3);
    float fres=pow(abs(dot(normalize(vN),normalize(vView))),1.6);
    float near=smoothstep(60.,260.,length(vView));
    gl_FragColor=fogOut(${sceneryV3(new THREE.Color(palette.glow).lerp(new THREE.Color('#ffffff'), .35).getHexString())},.2*fade*fres*near);`, { additive: true });
  const shaftMesh = add(new THREE.InstancedMesh(shaftGeometry, shaftMaterial, SHAFTS.high), 'abyss-light-shafts');

  // --- Seabed ---
  const groundSize = Math.max(1800, routeSize.x + 600, routeSize.z + 600);
  const seabedMaterial = shader('abyss-seabed', '', '', `
    float t=uTime*.6;
    vec2 p=vWorld.xz*.033;
    float cA=caustic(p,t), cB=caustic(p*1.9+7.3,t*1.3+3.);
    float fadeD=(1.-smoothstep(140.,520.,vDepth))*(1.-smoothstep(45.,230.,length(vView)));
    vec3 c=${sceneryV3(palette.sand,.55)}+${sceneryV3(palette.caustic)}*(cA*.3+cB*.18)*fadeD+${sceneryV3(palette.sand,.3)}*(1.-fadeD);
    gl_FragColor=fogOut(c,1.);`, { side: THREE.FrontSide });
  seabedMaterial.fragmentShader = seabedMaterial.fragmentShader.replace('void main(){', `
    float caustic(vec2 uv,float t){
      vec2 p=mod(uv*6.28318,6.28318)-250., i=p; float c=1., inten=.005;
      for(int n=0;n<4;n++){ float tt=t*(1.-3.5/float(n+1)); i=p+vec2(cos(tt-i.x)+sin(tt+i.y),sin(tt-i.y)+cos(tt+i.x)); c+=1./length(vec2(p.x/(sin(i.x+tt)/inten),p.y/(cos(i.y+tt)/inten))); }
      c/=4.; c=1.17-pow(c,1.4); return pow(abs(c),8.);
    }
    void main(){`);
  const seabed = new THREE.Mesh(new THREE.PlaneGeometry(groundSize, groundSize), seabedMaterial);
  seabed.name = 'abyss-seabed'; seabed.rotation.x = -Math.PI / 2; seabed.position.set(routeCenter.x, .05, routeCenter.z); seabed.frustumCulled = false; object.add(seabed);

  // --- Zone signature features (own seeded LCG so the shared layout above never shifts; each is 1-2 draw calls, added last) ---
  let fseed = (scenerySeed(definition.id) ^ 0x5ea5c3) >>> 0;
  const frand = () => { fseed = (Math.imul(fseed, 1664525) + 1013904223) >>> 0; return fseed / 4294967296; };
  const frange = (a: number, b: number) => a + frand() * (b - a);
  const hw = track.halfWidth;
  /** A point beside the route on a random side, `reach..reach+spread` m from the road edge. */
  const beside = (reach: number, spread: number) => { const p = route[Math.floor(frand() * route.length)], ang = frand() * 6.283, d = hw + reach + frand() * spread; return { x: p.x + Math.cos(ang) * d, z: p.z + Math.sin(ang) * d, y: p.y }; };
  const KELP_N = { low: 40, balanced: 80, high: 140 } as const, CORAL_N = { low: 60, balanced: 120, high: 200 } as const;
  const SHARE = { low: .34, balanced: .67, high: 1 } as const, scaled = (n: number, q: RenderQuality) => n <= 0 ? 0 : Math.max(1, Math.round(n * SHARE[q]));
  const fauna = palette.fauna;
  const featureMeshes: { mesh: THREE.InstancedMesh; count: (q: RenderQuality) => number }[] = [];
  const scatter = (total: number, spread: number, reach: number, gap: number, place: (x: number, z: number, y: number) => void, group: [number, number]) => {
    let cx = 0, cz = 0, left = 0, placed = 0;
    for (let a = 0; placed < total && a < total * 60; a++) {
      if (left <= 0) { const b = beside(reach, spread); cx = b.x; cz = b.z; left = group[0] + Math.floor(frand() * (group[1] - group[0] + 1)); }
      const x = cx + frange(-10, 10), z = cz + frange(-10, 10); left--;
      if (!freeNear(x, z, gap)) continue;
      place(x, 0, z); placed++;
    }
  };

  if (palette.feature === 'giant-kelp') {
    // Tall tapered stalk (60 m reference, instances scaled to 35-90 m) with leaf blades; separate float bulbs. Sway grows with height^2.
    const H = 60, parts: THREE.BufferGeometry[] = [], bulbParts: THREE.BufferGeometry[] = [];
    const stalk = new THREE.CylinderGeometry(.15, .6, H, 5, 12, true); stalk.translate(0, H / 2, 0); parts.push(stalk);
    for (let i = 0; i < 9; i++) {
      const h = 6 + i * 5.6, ang = i * 2.4, blade = new THREE.PlaneGeometry(2.6, 12, 1, 4); blade.translate(0, 6, 0);
      const bp = blade.attributes.position; for (let k = 0; k < bp.count; k++) bp.setX(k, bp.getX(k) * (1 - .8 * bp.getY(k) / 12));
      blade.rotateZ(-.55); blade.rotateY(ang); blade.translate(0, h, 0); parts.push(blade);
      const bulb = new THREE.SphereGeometry(.85, 7, 5); bulb.translate(Math.cos(ang) * 1.1, h + .6, -Math.sin(ang) * 1.1); bulbParts.push(bulb);
    }
    const sway = `
      float kh=clamp(vY/${H}.,0.,1.), kb=kh*kh, kph=vHash*6.283+(w.x+w.z)*.015;
      w.x+=sin(uTime*1.885+kph)*3.*kb; w.z+=cos(uTime*1.6+kph*1.3)*1.8*kb;`;
    const stalkMaterial = shader('marine-giant-kelp', '', sway, `
      float kh=clamp(vY/${H}.,0.,1.);
      vec3 c=mix(${sceneryV3(palette.kelp[0])},${sceneryV3(palette.kelp[1])},smoothstep(0.,.75,kh)*(.8+.4*vHash))+${sceneryV3(palette.kelp[2])}*kh*kh*.35;
      gl_FragColor=fogOut(c,1.);`);
    const bulbMaterial = shader('marine-kelp-bulb', '', sway, `gl_FragColor=fogOut(${glow(1.05)},1.);`);
    const kelpStalks = add(new THREE.InstancedMesh(mergeGeometries(parts)!, stalkMaterial, KELP_N.high), 'marine-giant-kelp');
    const kelpBulbs = add(new THREE.InstancedMesh(mergeGeometries(bulbParts)!, bulbMaterial, KELP_N.high), 'marine-kelp-bulbs');
    let n = 0;
    scatter(KELP_N.high, 70, 22, 12, (x, _y, z) => { const s = frange(35, 90) / H; const m = matrix(x, 0, z, s, s, s, frand() * 6.283); kelpStalks.setMatrixAt(n, m); kelpBulbs.setMatrixAt(n++, m); }, [4, 9]);
    kelpStalks.instanceMatrix.needsUpdate = kelpBulbs.instanceMatrix.needsUpdate = true;
    featureMeshes.push({ mesh: kelpStalks, count: q => Math.min(n, KELP_N[q]) }, { mesh: kelpBulbs, count: q => Math.min(n, KELP_N[q]) });
  }

  if (palette.feature === 'coral-reef') {
    // One merged cluster (branching trees + brain mounds, vertex tag aTip: 0 body, 1 glowing tip, 2 brain), instanced beside the road.
    const parts: THREE.BufferGeometry[] = [];
    const place = (g: THREE.BufferGeometry, tag: number, ry: number, x: number, y: number, z: number, rz = 0) => { tagged(g, 'aTip', tag); g.rotateZ(rz); g.rotateY(ry); g.translate(x, y, z); parts.push(g); };
    for (let t = 0; t < 4; t++) {
      const a = t * 1.57 + .4, x = Math.cos(a) * (t ? 2.6 : 0), z = Math.sin(a) * (t ? 2.6 : 0), h = 3 + (t % 3) * 1.2;
      place(new THREE.CylinderGeometry(.3, .55, h, 6, 1).translate(0, h / 2, 0), 0, 0, x, 0, z);
      for (let b = 0; b < 3; b++) {
        const L = h * .75, az = b * 2.09 + t, tilt = .5 + b * .12;
        place(new THREE.CylinderGeometry(.14, .26, L, 5, 1).translate(0, L / 2, 0), 0, az, x, h * .9, z, tilt);
        place(new THREE.ConeGeometry(.2, L * .45, 5).translate(0, L + L * .22, 0), 1, az, x, h * .9, z, tilt);
      }
      place(new THREE.ConeGeometry(.3, 1.1, 5).translate(0, h + .5, 0), 1, 0, x, 0, z);
    }
    for (let m = 0; m < 2; m++) place(new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(2.2 - m * .5, 1.5 - m * .4, 2.2 - m * .5), 2, 0, m ? -3.4 : 3.6, 0, m ? 2.2 : -2.4);
    const reefMaterial = shader('marine-coral-reef', '', '', `
      vec3 cn=cross(dFdx(vWorld),dFdy(vWorld)); float sh=.62+.38*abs(cn.y)/max(length(cn),1e-6);
      float pulse=.85+.35*sin(uTime*.8+vHash*40.), pick=fract(vHash*7.);
      vec3 body=mix(${sceneryV3(palette.kelp[1])},${sceneryV3(palette.kelp[2])},.35+.5*fract(vHash*5.))*sh;
      vec3 tip=mix(${glow()},${accent()},pick)*pulse;
      float groove=.7+.3*sin(vUv.x*70.+sin(vUv.y*28.)*3.);
      vec3 brain=mix(${accent()}*.55,${sceneryV3(palette.kelp[2], .9)},pick)*groove*sh;
      vec3 c=vTip>1.5?brain:(vTip>.5?tip:body);
      gl_FragColor=fogOut(c,1.);`);
    declareAttributes(reefMaterial, 'attribute float aTip; varying float vTip;', 'vTip=aTip;', 'varying float vTip;');
    const reef = add(new THREE.InstancedMesh(mergeGeometries(parts)!, reefMaterial, CORAL_N.high), 'marine-coral-reef');
    let n = 0;
    scatter(CORAL_N.high, 60, 14, 14, (x, _y, z) => { const s = frange(2.2, 4.5); reef.setMatrixAt(n++, matrix(x, 0, z, s, s, s, frand() * 6.283)); }, [3, 6]);
    reef.instanceMatrix.needsUpdate = true;
    featureMeshes.push({ mesh: reef, count: q => Math.min(n, CORAL_N[q]) });
  }

  if (fauna.fish > 0) {
    // Schools loop on ellipses beside the road; the whole swim (path, heading, tail wiggle) is computed in the vertex shader from uTime.
    const body = new THREE.OctahedronGeometry(1, 0).scale(.45, .7, 1.8), tail = new THREE.OctahedronGeometry(1, 0).scale(.08, .8, .7).translate(0, 0, -2);
    const fishGeometry = mergeGeometries([body, tail])!;
    const schools: { x: number; y: number; z: number; rx: number; rz: number; w: number; phase: number; fish: number }[] = [];
    for (let a = 0; schools.length < fauna.fish && a < 400; a++) {
      const rx = frange(14, 28), rz = frange(10, 20), reach = Math.max(rx, rz) * 1.3 + 10, p = route[Math.floor(frand() * route.length)], ang = frand() * 6.283, d = hw + reach + 4 + frand() * 18;
      const x = p.x + Math.cos(ang) * d, z = p.z + Math.sin(ang) * d;
      if (nearRoute(x, z, hw + reach, route) || schools.some(s => Math.hypot(s.x - x, s.z - z) < 70)) continue;
      schools.push({ x, y: p.y + frange(6, 30), z, rx, rz, w: (frand() < .5 ? -1 : 1) * frange(.25, .5), phase: frand() * 6.283, fish: 30 + Math.floor(frand() * 31) });
    }
    const total = schools.reduce((n, s) => n + s.fish, 0), perQuality = (q: RenderQuality) => schools.slice(0, scaled(fauna.fish, q)).reduce((n, s) => n + s.fish, 0);
    const aFish = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, total) * 4), 4), aSchool = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, total) * 4), 4);
    fishGeometry.setAttribute('aFish', aFish); fishGeometry.setAttribute('aSchool', aSchool);
    const fishMaterial = shader('marine-fish-school', `
      vHash=fract(aFish.w*7.13);
      float th=aSchool.z*uTime+aSchool.w+aFish.x, rr=1.+aFish.y;
      vec3 ctr=vec3(aSchool.x*cos(th)*rr, aFish.z+sin(uTime*.9+aFish.w)*1.4, aSchool.y*sin(th)*rr);
      vec3 vel=vec3(-aSchool.x*sin(th)*aSchool.z*rr, cos(uTime*.9+aFish.w)*1.26, aSchool.y*cos(th)*aSchool.z*rr);
      vec3 fw=vel/max(length(vel),1e-4), rt=cross(vec3(0.,1.,0.),fw); rt/=max(length(rt),1e-4);
      vec3 up2=cross(fw,rt);
      pos.x+=sin(uTime*9.+aFish.w*6.)*.3*clamp(-pos.z,0.,1.8)/1.8;
      pos=rt*pos.x+up2*pos.y+fw*pos.z+ctr;`, '', `
      vec3 cn=cross(dFdx(vWorld),dFdy(vWorld)); float sh=.62+.38*abs(cn.y)/max(length(cn),1e-6);
      float shim=.5+.5*sin(uTime*3.+vHash*40.);
      vec3 c=mix(${glow()},${accent()},shim*.3)*(.7+.5*sh);
      gl_FragColor=fogOut(c,1.);`);
    declareAttributes(fishMaterial, 'attribute vec4 aFish; attribute vec4 aSchool;');
    const fish = add(new THREE.InstancedMesh(fishGeometry, fishMaterial, Math.max(1, total)), 'marine-fish-schools');
    let n = 0;
    for (const s of schools) for (let i = 0; i < s.fish; i++, n++) {
      fish.setMatrixAt(n, matrix(s.x, s.y, s.z, 1, 1, 1));
      aFish.setXYZW(n, frange(-.7, .7), frange(-.25, .25), frange(-3, 3), frand() * 6.283);
      aSchool.setXYZW(n, s.rx, s.rz, s.w, s.phase);
    }
    fish.instanceMatrix.needsUpdate = aFish.needsUpdate = aSchool.needsUpdate = true;
    featureMeshes.push({ mesh: fish, count: q => perQuality(q) });
  }

  // --- Fauna: jellyfish anchors, sharks, mantas, whales (own seeded LCG; one instanced draw each, added last) ---
  // Path, heading and body motion are computed in the vertex shader from uTime, so reduced motion (time 0) is a still pose.
  let gseed = (scenerySeed(definition.id) ^ 0xfa11a5) >>> 0;
  const grand = () => { gseed = (Math.imul(gseed, 1664525) + 1013904223) >>> 0; return gseed / 4294967296; };
  const grange = (a: number, b: number) => a + grand() * (b - a);
  const hexMix = (a: string, b: string, t: number) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();
  const bodyColor = sceneryV3(palette.whale), bellyColor = sceneryV3(hexMix(palette.whale, palette.caustic, .2)), rimColor = glow(Math.max(fauna.glow, 0) * 1.2);
  const goldenRoute = (k: number) => Math.floor((((k * .618034 + grand() * .12) % 1) + 1) % 1 * route.length) % route.length;
  const sideOf = (i: number) => {
    const p = route[i], q = route[(i + 1) % route.length], o = route[(i + route.length - 1) % route.length], tx = q.x - o.x, tz = q.z - o.z, tl = Math.max(Math.hypot(tx, tz), 1e-3);
    return { p, nx: tz / tl, nz: -tx / tl };
  };

  // Jellyfish: a few close passes, the rest 25-60 m off the road edge and up to ~30 m above it.
  const jellyCount = Math.min(JELLY_CAP, fauna.jellyfish);
  const jellyPlaced: THREE.Matrix4[] = [];
  for (let k = 0; k < jellyCount; k++) {
    const { p, nx, nz } = sideOf(goldenRoute(k)), close = k % 3 === 0, side = k % 2 ? 1 : -1, d = hw + (close ? grange(11, 18) : grange(25, 60)), s = close ? grange(2.5, 4) : grange(3.5, 7);
    jellyPlaced.push(matrix(p.x + nx * d * side, Math.max(5, p.y + (close ? grange(1, 9) : grange(6, 32))), p.z + nz * d * side, s, s, s));
  }
  jellyPlaced.forEach((m, i) => jellyMesh.setMatrixAt(i, m)); jellyMesh.instanceMatrix.needsUpdate = true;
  featureMeshes.push({ mesh: jellyMesh, count: q => Math.min(jellyPlaced.length, scaled(jellyCount, q)) });

  /** Loops an ellipse around a centre beside the road; `clear` keeps the whole loop off the road, otherwise only the centre is placed. */
  interface Swimmer { x: number; y: number; z: number; rx: number; rz: number; w: number; phase: number; s: number }
  const placeSwimmers = (n: number, o: { rx: [number, number]; rz: [number, number]; speed: [number, number]; scale: [number, number]; lift: [number, number]; gap: [number, number]; clear: boolean; top?: boolean }) => {
    const out: Swimmer[] = [];
    for (let a = 0; out.length < n && a < n * 80; a++) {
      const rx = grange(...o.rx), rz = grange(...o.rz), R = Math.max(rx, rz), p = route[goldenRoute(out.length + (a % 7))], ang = grand() * 6.283, d = hw + (o.clear ? R : 0) + grange(...o.gap);
      const x = p.x + Math.cos(ang) * d, z = p.z + Math.sin(ang) * d;
      if (o.clear && nearRoute(x, z, hw + R + 4, route)) continue;
      if (domes.some(dm => Math.hypot(dm.center.x - x, dm.center.z - z) < dm.radius + 4)) continue;
      out.push({ x, y: Math.max(4, (o.top ? routeTop : p.y) + grange(...o.lift)), z, rx, rz, w: (grand() < .5 ? -1 : 1) * grange(...o.speed) / ((rx + rz) / 2), phase: grand() * 6.283, s: grange(...o.scale) });
    }
    return out;
  };
  /** One merged-geometry InstancedMesh of swimmers. `wiggle` bends the body in model space (z is forward); `belly` is a GLSL float 0 (back) .. 1 (belly). */
  const creature = (name: string, geometry: THREE.BufferGeometry, swimmers: Swimmer[], wiggle: string, belly: string, tagBelly = false) => {
    const n = Math.max(1, swimmers.length), aSwim = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    geometry.setAttribute('aSwim', aSwim);
    const material = shader(name, `
      float th=aSwim.z*uTime+aSwim.w;
      vec3 vel=vec3(-aSwim.x*sin(th)*aSwim.z,0.,aSwim.y*cos(th)*aSwim.z);
      vec3 fw=vel/max(length(vel),1e-4), rt=cross(vec3(0.,1.,0.),fw); rt/=max(length(rt),1e-4);
      ${wiggle}
      pos=rt*pos.x+vec3(0.,pos.y,0.)+fw*pos.z;`, `
      w.xyz+=vec3(aSwim.x*cos(th),sin(uTime*.35+aSwim.w)*1.6,aSwim.y*sin(th));`, `
      vec3 cn=cross(dFdx(vWorld),dFdy(vWorld)); cn/=max(length(cn),1e-6);
      float sh=.55+.45*abs(cn.y), fres=pow(max(1.-abs(dot(cn,normalize(-vView))),0.),2.);
      vec3 c=mix(${bodyColor},${bellyColor},clamp(${belly},0.,1.))*sh+${rimColor}*fres;
      gl_FragColor=fogOut(c,1.);`);
    declareAttributes(material, `attribute vec4 aSwim;${tagBelly ? ' attribute float aBelly; varying float vBelly;' : ''}`, tagBelly ? 'vBelly=aBelly;' : '', tagBelly ? 'varying float vBelly;' : '');
    const mesh = add(new THREE.InstancedMesh(geometry, material, n), name);
    swimmers.forEach((sw, i) => { mesh.setMatrixAt(i, matrix(sw.x, sw.y, sw.z, sw.s, sw.s, sw.s)); aSwim.setXYZW(i, sw.rx, sw.rz, sw.w, sw.phase); });
    mesh.instanceMatrix.needsUpdate = aSwim.needsUpdate = true;
    featureMeshes.push({ mesh, count: q => Math.min(swimmers.length, scaled(swimmers.length, q)) });
    return mesh;
  };
  const flat = (g: THREE.BufferGeometry) => { const n = g.toNonIndexed(); n.deleteAttribute('uv'); n.deleteAttribute('normal'); return n; };

  // Sharks: slow patrol loops between the kelp, 10-16 m long.
  const sharks = placeSwimmers(fauna.shark, { rx: [28, 55], rz: [20, 40], speed: [4, 6], scale: [.9, 1.4], lift: [2, 16], gap: [6, 45], clear: true });
  if (sharks.length) {
    const parts = [
      new THREE.SphereGeometry(1, 10, 7).scale(1.3, 1.4, 5),
      new THREE.ConeGeometry(1.3, 7, 6).rotateX(-Math.PI / 2).translate(0, 0, -8),
      new THREE.ConeGeometry(.9, 2.6, 3).rotateX(-.35).translate(0, 2.1, .6),
      new THREE.BoxGeometry(.14, 4.4, 1.7).translate(0, .2, -11.4),
      ...[-1, 1].map(sd => new THREE.BoxGeometry(5, .12, 1.8).rotateZ(sd * .3).translate(sd * 2.5, -1, 1.6)),
    ].map(flat);
    creature('marine-sharks', mergeGeometries(parts)!, sharks, 'pos.x+=sin(uTime*2.2+vHash*30.-pos.z*.6)*.5*smoothstep(1.5,-11.,pos.z);', 'smoothstep(.2,-1.3,vY)');
  }

  // Mantas: broad wings flap in the vertex shader (phase lags toward the tips), gliding over the reef 4-22 m above the road.
  const mantas = placeSwimmers(fauna.manta, { rx: [25, 55], rz: [20, 40], speed: [6, 8], scale: [.9, 1.5], lift: [4, 22], gap: [4, 40], clear: true });
  if (mantas.length) {
    const N = 12, W = 8, pts: number[] = [], bel: number[] = [];
    const vert = (i: number, j: number, side: number) => {
      const u = -1 + 2 * i / N, a = Math.abs(u), zf = -.5 + 4 * Math.pow(1 - a, 1.2), zb = -.5 - 2.5 * Math.pow(1 - a, .9), t = Math.pow(1 - a, 1.4) * [.3, 1, .3][j];
      return [u * W, side ? -t * .45 : t * .9, zf + (zb - zf) * j / 2];
    };
    for (let side = 0; side < 2; side++) for (let i = 0; i < N; i++) for (let j = 0; j < 2; j++) {
      const q = [vert(i, j, side), vert(i + 1, j, side), vert(i, j + 1, side), vert(i + 1, j + 1, side)];
      for (const t of [[0, 1, 2], [1, 3, 2]]) for (const k of t) { pts.push(...q[k]); bel.push(side); }
    }
    const wing = new THREE.BufferGeometry(); wing.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); wing.setAttribute('aBelly', new THREE.Float32BufferAttribute(bel, 1));
    const tail = flat(new THREE.ConeGeometry(.2, 8, 4).rotateX(-Math.PI / 2).translate(0, 0, -6.5)); tagged(tail, 'aBelly', .5);
    creature('marine-mantas', mergeGeometries([wing, tail])!, mantas, 'float ax=abs(pos.x); pos.y+=sin(uTime*1.5+vHash*30.-ax*.32)*ax*.2;', 'vBelly', true);
  }

  // Whales: big slow loops high above the road (trench: far away, lagoon: mid distance), fluke beats in the vertex shader.
  const farWhale = fauna.whale < 2;
  const whales = placeSwimmers(fauna.whale, { rx: [100, 170], rz: [70, 120], speed: [6, 8], scale: [.85, 1.2], lift: [14, 42], gap: farWhale ? [whaleReach * .45, whaleReach * .6] : [45, 110], clear: false, top: true });
  if (whales.length) {
    if (farWhale) whales[0].phase = whalePhase;
    const parts: THREE.BufferGeometry[] = [new THREE.SphereGeometry(1, 10, 7).scale(7, 7, 30)];
    parts.push(new THREE.ConeGeometry(5, 26, 6).rotateX(-Math.PI / 2).translate(0, 0, -36), new THREE.BoxGeometry(26, .8, 7).translate(0, 0, -52));
    for (const sd of [-1, 1]) parts.push(new THREE.BoxGeometry(14, .6, 5).rotateZ(sd * .3).translate(sd * 9, -4, 8));
    creature('marine-whales', mergeGeometries(parts.map(flat))!, whales,
      'float tb=smoothstep(0.,-50.,pos.z); pos.y+=sin(uTime*.9+vHash*40.-pos.z*.045)*3.2*tb; pos.x+=sin(uTime*.45+vHash*20.-pos.z*.03)*1.2*tb;', 'smoothstep(.5,-5.,vY)');
  }

  // --- Update / repack ---
  let quality: RenderQuality = 'balanced';
  const lastPosition = new THREE.Vector3(Infinity, Infinity, Infinity);
  let dirty = true;
  const repack = (position: THREE.Vector3) => {
    const far = quality === 'low' ? 480 : quality === 'high' ? 800 : 650, close = quality === 'low' ? 260 : quality === 'high' ? 520 : 380;
    let d = 0, l = 0, k = 0, r = 0, t = 0, pl = 0, bu = 0; const half = quality === 'low' ? 2 : 1;
    for (const dome of domes) {
      if (dome.center.distanceTo(position) - dome.radius * 1.4 > far) continue;
      domeMesh.setMatrixAt(d++, dome.shell);
      for (let i = 0; i < dome.lights.length; i += half) { lightMesh.setMatrixAt(l, dome.lights[i]); lightMesh.setColorAt(l++, dome.colors[i]); }
    }
    for (let i = 0; i < kelp.length; i += half) { const c = kelp[i]; if (c.center.distanceTo(position) - c.radius > close) continue; for (const m of c.blades) kelpMesh.setMatrixAt(k++, m); }
    for (const py of pylons) {
      if (py.center.distanceTo(position) - py.radius > far) continue;
      poleMesh.setMatrixAt(pl++, py.pole);
      py.buoys.forEach((m, i) => { buoyMesh.setMatrixAt(bu, m); buoyMesh.setColorAt(bu++, py.colors[i]); });
    }
    for (const rock of rocks) {
      if (rock.center.distanceTo(position) - rock.radius > close) continue;
      for (const m of rock.rocks) rockMesh.setMatrixAt(r++, m);
      rock.tips.forEach((m, i) => { tipMesh.setMatrixAt(t, m); tipMesh.setColorAt(t++, rock.tipColors[i]); });
    }
    for (const [mesh, n] of [[domeMesh, d], [lightMesh, l], [kelpMesh, k], [rockMesh, r], [tipMesh, t], [poleMesh, pl], [buoyMesh, bu]] as const) {
      mesh.count = n; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    for (const f of featureMeshes) f.mesh.count = f.count(quality);
    landmarkObjects.forEach((o, i) => { o.visible = landmarks[i].position.distanceTo(position) - landmarks[i].height < (quality === 'low' ? 1400 : 2200); });
  };
  const wrap = (v: number, s: number) => ((v % s) + s) % s;
  const animate = (time: number) => {
    const n = SHAFTS[quality];
    for (let i = 0; i < n; i++) {
      const s = shafts[i];
      dummy.position.set(s.x, SHAFT_TOP, s.z); dummy.rotation.set(0, 0, 0);
      dummy.rotateY(s.dir); dummy.rotateX(s.tilt + Math.sin(time * .15 + s.phase) * .04);
      dummy.scale.set(s.width, SHAFT_LENGTH, s.width); dummy.updateMatrix(); shaftMesh.setMatrixAt(i, dummy.matrix);
    }
    shaftMesh.count = n; shaftMesh.instanceMatrix.needsUpdate = true;
  };
  const update = (position: THREE.Vector3, time = 0) => {
    timeUniform.value = time;
    animate(time);
    if (!dirty && lastPosition.distanceToSquared(position) < 35 ** 2) return;
    dirty = false; lastPosition.copy(position); repack(position);
  };
  update(track.sample(0).position);
  return {
    object, landmark, landmarks, hidesGround: true as const,
    counts: { buildings: domes.length, windows: domes.reduce((n, d) => n + d.lights.length, 0), billboards: 0 },
    setQuality(value: RenderQuality) { if (quality !== value) { quality = value; dirty = true; update(lastPosition.clone(), timeUniform.value); } },
    setOverview(overview: boolean) { object.visible = !overview; },
    update,
  };
}

/** Straight, flat, feature-free stretches of 60-120 m get a translucent glass half-tube with cyan ribs. Decoration only. */
function createTunnels(track: Track, random: () => number, range: (a: number, b: number) => number, palette: MarinePalette) {
  const CYAN = new THREE.Color(palette.glow);
  const STEP = 4, MARGIN = 40, count = Math.floor(track.length / STEP);
  const frame = (d: number) => track.sample(d);
  const blocked: [number, number][] = [];
  const mark = (distance: number, length: number) => blocked.push([distance - MARGIN, distance + length + MARGIN]);
  track.heightObstacles.forEach(o => mark(o.distance - o.depth / 2, o.depth));
  track.corridorObstacles?.forEach(o => mark(o.distance - o.depth / 2, o.depth));
  track.mineFields?.forEach(o => mark(o.distance, o.length));
  track.boostPads?.forEach(o => mark(o.distance - o.length / 2, o.length));
  track.arcRails?.forEach(o => mark(o.distance, o.length));
  track.boostRings?.forEach(o => mark(o.distance, 0));
  track.jumps?.forEach(o => mark(o.approachStart, o.rejoinEnd - o.approachStart));
  const free = (a: number, b: number) => !blocked.some(([lo, hi]) => a < hi && b > lo);
  const straight: boolean[] = [], tangents: THREE.Vector3[] = [];
  for (let i = 0; i <= count; i++) {
    const f = frame(i * STEP);
    straight.push(f.section === 'course' && Math.abs(f.curvature) < .007 && f.up.y > .93 && !track.branches?.some(b => (i * STEP) % track.length >= b.start - 40 && (i * STEP) % track.length <= b.end + 40));
    tangents.push(f.tangent.clone());
  }
  const candidates: { start: number; length: number }[] = [];
  for (let i = Math.ceil(MARGIN / STEP); i * STEP < track.length - MARGIN - 60; i++) {
    let j = i; while (j < count && j - i < 30 && straight[j + 1] && tangents[j + 1].dot(tangents[i]) > .975) j++;
    const length = (j - i) * STEP; if (length >= 60 && free(i * STEP, i * STEP + length)) candidates.push({ start: i * STEP, length });
  }
  const chosen: { start: number; length: number }[] = [];
  const target = 2 + Math.floor(random() * 2);
  while (candidates.length && chosen.length < target) {
    const c = candidates.splice(Math.floor(random() * candidates.length), 1)[0];
    if (chosen.some(o => Math.abs(o.start - c.start) < 400)) continue;
    const length = Math.min(c.length, Math.round(range(60, 120) / STEP) * STEP);
    chosen.push({ start: c.start + Math.floor((c.length - length) / 2 / STEP) * STEP, length });
  }
  if (!chosen.length) return undefined;

  const hw = track.halfWidth, a = hw + 4, N = 2.6, E = 2 / N, maxLevel = track.altitudeProfile.levels[track.altitudeProfile.levels.length - 1];
  const b = Math.max(a * .9, (maxLevel + 4) / Math.pow(1 - Math.pow(hw / a, N), 1 / N));
  const M = 28, RIB = 8, SEG = 2;
  const gp: number[] = [], gn: number[] = [], gu: number[] = [], gi: number[] = [];
  const rp: number[] = [], ri: number[] = [];
  const pt = new THREE.Vector3(), nm = new THREE.Vector3();
  const arc = (f: ReturnType<typeof frame>, th: number, scale = 1) => {
    const c = Math.cos(th), s = Math.sin(th), x = a * Math.sign(c) * Math.pow(Math.abs(c), E) * scale, y = b * Math.pow(Math.abs(s), E) * scale - .2;
    return pt.copy(f.position).addScaledVector(f.right, x).addScaledVector(f.up, y);
  };
  for (const { start, length } of chosen) {
    const rings = Math.round(length / SEG);
    for (let r = 0; r <= rings; r++) {
      const f = frame(start + r * SEG), v0 = gp.length / 3;
      for (let m = 0; m <= M; m++) {
        const th = m / M * Math.PI, c = Math.cos(th), s = Math.sin(th);
        arc(f, th); gp.push(pt.x, pt.y, pt.z);
        nm.copy(f.right).multiplyScalar(Math.sign(c) * Math.pow(Math.abs(c), N - 1) / a).addScaledVector(f.up, Math.pow(Math.abs(s), N - 1) / b).normalize();
        gn.push(nm.x, nm.y, nm.z); gu.push(m / M, r / rings);
      }
      if (r > 0) for (let m = 0; m < M; m++) { const p = v0 - (M + 1) + m, q = v0 + m; gi.push(p, q, p + 1, p + 1, q, q + 1); }
      if ((r * SEG) % RIB === 0 || r === rings) {
        const h = .28, base = rp.length / 3;
        for (let m = 0; m <= M; m++) {
          const th = m / M * Math.PI;
          for (const k of [-1, 1]) { arc(f, th, 1.006).addScaledVector(f.tangent, k * h); rp.push(pt.x, pt.y, pt.z); }
          if (m > 0) { const p = base + (m - 1) * 2; ri.push(p, p + 1, p + 2, p + 2, p + 1, p + 3); }
        }
      }
      if (r > 0) {
        const g = frame(start + (r - 1) * SEG), base = rp.length / 3;
        for (const [fr, w] of [[g, -1], [f, -1], [g, 1], [f, 1]] as const) { // base rails along both road edges
          for (const k of [-.4, .4]) { pt.copy(fr.position).addScaledVector(fr.right, w * (a + k)).addScaledVector(fr.up, .12); rp.push(pt.x, pt.y, pt.z); }
        }
        ri.push(base, base + 1, base + 2, base + 2, base + 1, base + 3, base + 4, base + 5, base + 6, base + 6, base + 5, base + 7);
      }
    }
  }
  const glassGeometry = new THREE.BufferGeometry();
  glassGeometry.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3));
  glassGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(gn, 3));
  glassGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(gu, 2));
  glassGeometry.setIndex(gi);
  const ribGeometry = new THREE.BufferGeometry();
  ribGeometry.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
  ribGeometry.setIndex(ri);
  const glassMaterial = shader('abyss-tunnel', '', '', `
    vec3 n=normalize(vN), v=normalize(-vView);
    float fres=pow(1.-abs(dot(n,v)),2.2);
    float line=gridLine(vUv.x*14.)*.25;
    gl_FragColor=fogOut(${sceneryV3(palette.glow,.97)}*(.55+fres*.9+line),.07+.2*fres+line*.1);`, { additive: true });
  const glass = new THREE.Mesh(glassGeometry, glassMaterial);
  const ribs = new THREE.Mesh(ribGeometry, new THREE.MeshBasicMaterial({ color: CYAN.clone().multiplyScalar(1.3), side: THREE.DoubleSide, toneMapped: false }));
  glass.frustumCulled = ribs.frustumCulled = false; glass.renderOrder = 1;
  return { glass, ribs, chosen };
}
