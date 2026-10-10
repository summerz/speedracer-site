import * as THREE from 'three';
import type { DistrictId } from './trackCatalog.js';
import type { RenderQuality } from '../../platform/renderQuality.js';

const HELI_COUNT = { low: 1, balanced: 3, high: 5 } as const;
const TRAFFIC_COUNT = { low: 6, balanced: 12, high: 20 } as const;
const MAX_HELIS = 5, MAX_FLYERS = 20, BEAM_LENGTH = 100, GROUND_Y = 0.2;

const BEAM_VERTEX = `
varying vec2 vUv; varying vec3 vN; varying vec3 vP;
void main() {
  vUv = uv; vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0); vP = mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
const BEAM_FRAGMENT = `
uniform vec3 uColor; varying vec2 vUv; varying vec3 vN; varying vec3 vP;
void main() {
  float fade = pow(clamp(vUv.y, 0.0, 1.0), 1.3);
  float fres = pow(abs(dot(normalize(vN), normalize(vP))), 1.6);
  float near = smoothstep(60.0, 260.0, length(vP)); // fade beams that sweep past the camera
  gl_FragColor = vec4(uColor, 0.22 * fade * fres * near);
}`;
const SPOT_VERTEX = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SPOT_FRAGMENT = `
uniform vec3 uColor; varying vec2 vUv;
void main() { float d = length(vUv - 0.5) * 2.0; float a = 0.18 * pow(clamp(1.0 - d, 0.0, 1.0), 1.5); gl_FragColor = vec4(uColor, a); }`;

interface Heli {
  group: THREE.Group; pivot: THREE.Group; beam: THREE.Mesh; spot: THREE.Mesh; rotor: THREE.Mesh; strobe: THREE.Mesh;
  anchor: THREE.Vector3; radius: number; speed: number; phase: number; dir: number; bob: number; pitch: number; yawRate: number;
}
interface Flyer { start: THREE.Vector3; dir: THREE.Vector3; speed: number; phase: number; yaw: number }

/** Cheap decorative air life: orbiting searchlight helicopters and instanced passing traffic. No gameplay effect, no THREE lights. */
export function createSkyTraffic(route: THREE.Vector3[], bounds: THREE.Box3, district: DistrictId, seed: number) {
  let s = seed >>> 0;
  const random = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const range = (a: number, b: number) => a + random() * (b - a);
  const object = new THREE.Group(); object.name = 'sky-traffic';
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(item: T) => { disposables.push(item); return item; };

  const bodyMaterial = track(new THREE.MeshBasicMaterial({ color: '#0b1520' }));
  const rotorMaterial = track(new THREE.MeshBasicMaterial({ color: '#9fb8c8', transparent: true, opacity: .25, side: THREE.DoubleSide, depthWrite: false }));
  const lightMaterial = (hex: string) => track(new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(2.4), toneMapped: false }));
  const redMaterial = lightMaterial('#ff2a2a'), greenMaterial = lightMaterial('#2aff6a'), strobeMaterial = lightMaterial('#ffffff');
  const box = track(new THREE.BoxGeometry()), sphere = track(new THREE.SphereGeometry(.35, 8, 6)), disc = track(new THREE.CircleGeometry(5.5, 20));
  const beamGeometry = track(new THREE.ConeGeometry(BEAM_LENGTH * .14, BEAM_LENGTH, 24, 1, true)); beamGeometry.translate(0, -BEAM_LENGTH / 2, 0);
  const spotGeometry = track(new THREE.CircleGeometry(16, 28));
  const beamMaterial = track(new THREE.ShaderMaterial({ uniforms: { uColor: { value: new THREE.Color('#fff4d6') } }, vertexShader: BEAM_VERTEX, fragmentShader: BEAM_FRAGMENT,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  const spotMaterial = track(new THREE.ShaderMaterial({ uniforms: { uColor: { value: new THREE.Color('#fff4d6') } }, vertexShader: SPOT_VERTEX, fragmentShader: SPOT_FRAGMENT,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));

  const part = (geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => {
    const m = new THREE.Mesh(geometry, material); m.position.set(x, y, z); m.scale.set(sx, sy, sz); parent.add(m); return m;
  };

  const routeTop = route.reduce((top, p) => Math.max(top, p.y), 0);
  const heliLift = district === 'orbital' ? 40 : 0;
  const helis: Heli[] = [];
  for (let i = 0; i < MAX_HELIS; i++) {
    // Spread anchors along the lap and fly just above road level so drivers actually pass under them.
    const near = route[Math.floor((i + random() * .6) / MAX_HELIS * route.length) % Math.max(1, route.length)] ?? new THREE.Vector3();
    const side = random() * Math.PI * 2, offset = range(60, 160);
    const height = Math.max(60, near.y + (district === 'desert' ? range(18, 40) : range(28, 70) + heliLift));
    const anchor = new THREE.Vector3(near.x + Math.cos(side) * offset, height, near.z + Math.sin(side) * offset);
    const group = new THREE.Group(); group.name = 'sky-helicopter';
    part(box, bodyMaterial, group, 0, 0, 0, 6, 2, 2);
    part(box, bodyMaterial, group, -5.5, .4, 0, 6, .6, .6);
    part(box, bodyMaterial, group, -8.4, 1.1, 0, .5, 2, .4);
    const rotor = part(disc, rotorMaterial, group, 0, 1.6, 0); rotor.rotation.x = -Math.PI / 2;
    part(sphere, redMaterial, group, 0, 0, -1.1);
    part(sphere, greenMaterial, group, 0, 0, 1.1);
    const strobe = part(sphere, strobeMaterial, group, 0, 1.3, 0, 1.2, 1.2, 1.2);
    const pivot = new THREE.Group(); pivot.rotation.order = 'YXZ'; group.add(pivot);
    const beam = new THREE.Mesh(beamGeometry, beamMaterial); beam.frustumCulled = false; pivot.add(beam);
    const spot = new THREE.Mesh(spotGeometry, spotMaterial); spot.rotation.x = -Math.PI / 2; spot.frustumCulled = false;
    object.add(group, spot);
    helis.push({ group, pivot, beam, spot, rotor, strobe, anchor, radius: range(40, 110), speed: range(.05, .12), phase: random() * Math.PI * 2,
      dir: random() < .5 ? -1 : 1, bob: random() * Math.PI * 2, pitch: range(25, 40) * Math.PI / 180, yawRate: .3 * (random() < .5 ? -1 : 1) });
  }

  const flyerGeometry = track(new THREE.BoxGeometry(1, 1, 1));
  const flyerMaterial = track(new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }));
  const trailMaterial = track(new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: .25, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  const flyers = track(new THREE.InstancedMesh(flyerGeometry, flyerMaterial, MAX_FLYERS)); flyers.name = 'sky-traffic-flyers';
  const trails = track(new THREE.InstancedMesh(flyerGeometry, trailMaterial, MAX_FLYERS)); trails.name = 'sky-traffic-trails';
  flyers.frustumCulled = false; trails.frustumCulled = false;
  const size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
  const laneLength = Math.hypot(size.x, size.z) + 300;
  const lanes: Flyer[] = [];
  const white = new THREE.Color('#cfe8ff').multiplyScalar(1.8), amber = new THREE.Color('#ffb347').multiplyScalar(1.8), trailWhite = new THREE.Color('#cfe8ff'), trailAmber = new THREE.Color('#ffb347');
  for (let i = 0; i < MAX_FLYERS; i++) {
    const angle = random() * Math.PI, dir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)), perp = new THREE.Vector3(-dir.z, 0, dir.x);
    const lateral = (random() - .5) * Math.hypot(size.x, size.z) * .8;
    const start = center.clone().addScaledVector(perp, lateral).addScaledVector(dir, -laneLength / 2); start.y = routeTop + range(90, 230);
    lanes.push({ start, dir, speed: range(25, 60), phase: random() * laneLength, yaw: Math.atan2(-dir.z, dir.x) });
    const isAmber = random() < .2;
    flyers.setColorAt(i, isAmber ? amber : white); trails.setColorAt(i, isAmber ? trailAmber : trailWhite);
  }
  object.add(flyers, trails);

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  let quality: RenderQuality = 'balanced';
  const applyQuality = () => {
    helis.forEach((h, i) => { const on = i < HELI_COUNT[quality]; h.group.visible = on; h.spot.visible = on; });
    flyers.count = trails.count = TRAFFIC_COUNT[quality];
  };
  const update = (time: number) => {
    helis.forEach((h, i) => {
      if (i >= HELI_COUNT[quality]) return;
      const a = h.phase + time * h.speed * h.dir;
      h.group.position.set(h.anchor.x + Math.cos(a) * h.radius, h.anchor.y + Math.sin(time * .5 + h.bob) * 2, h.anchor.z + Math.sin(a) * h.radius);
      h.group.rotation.y = Math.atan2(-h.dir * Math.cos(a), -h.dir * Math.sin(a));
      h.rotor.rotation.z = time * 40;
      h.strobe.visible = time % 1.2 < .08;
      const pitch = h.pitch + Math.sin(time * .4 + h.phase) * .1, yaw = time * h.yawRate + h.phase - h.group.rotation.y;
      h.pivot.rotation.set(pitch, yaw, 0);
      const length = h.group.position.y / Math.cos(pitch), scale = length / BEAM_LENGTH;
      h.beam.scale.setScalar(scale);
      // World direction of the beam axis, then its ground intersection.
      const worldYaw = yaw + h.group.rotation.y, reach = Math.tan(pitch) * h.group.position.y;
      h.spot.position.set(h.group.position.x - Math.sin(worldYaw) * reach, GROUND_Y, h.group.position.z - Math.cos(worldYaw) * reach);
      h.spot.scale.setScalar(.8 + scale * .35);
    });
    for (let i = 0; i < flyers.count; i++) {
      const f = lanes[i], d = (time * f.speed + f.phase) % laneLength;
      q.setFromAxisAngle(up, f.yaw);
      p.copy(f.start).addScaledVector(f.dir, d); sc.set(4, 1, 1); flyers.setMatrixAt(i, m4.compose(p, q, sc));
      p.addScaledVector(f.dir, -17); sc.set(30, .5, .5); trails.setMatrixAt(i, m4.compose(p, q, sc));
    }
    flyers.instanceMatrix.needsUpdate = trails.instanceMatrix.needsUpdate = true;
  };
  applyQuality(); update(0);
  return {
    object, update,
    setQuality(value: RenderQuality) { quality = value; applyQuality(); },
    dispose() { disposables.forEach(d => d.dispose()); },
  };
}
