import * as THREE from 'three';
import type { DistrictId } from './trackCatalog.js';
import type { RenderQuality } from '../../platform/renderQuality.js';

// Index 0 is the pursuit helicopter (all qualities); the rest orbit anchors spread along the lap.
const HELI_COUNT = { low: 2, balanced: 4, high: 6 } as const;
const ANCHOR_FRACTIONS = [.15, .55, .85, .35, .7];
const ENGAGE_RANGE = 350, PURSUIT_SCALE = 2.2;
const TRAFFIC_COUNT = { low: 6, balanced: 12, high: 20 } as const;
const MAX_HELIS = 6, MAX_FLYERS = 20, BEAM_LENGTH = 100, GROUND_Y = 0.2;

const BEAM_VERTEX = `
varying vec2 vUv; varying vec3 vN; varying vec3 vP; varying vec3 vApex; varying vec3 vAxis;
void main() {
  vUv = uv; vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0); vP = mv.xyz;
  vApex = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz; vAxis = normalize((modelViewMatrix * vec4(0.0, -1.0, 0.0, 0.0)).xyz);
  gl_Position = projectionMatrix * mv;
}`;
const BEAM_FRAGMENT = `
uniform vec3 uColor; uniform float uEngage; varying vec2 vUv; varying vec3 vN; varying vec3 vP; varying vec3 vApex; varying vec3 vAxis;
void main() {
  float u = clamp(vUv.y, 0.0, 1.0);
  // sweeping beams fade toward the ground; chase beams are a shaft that is bright at the lamp and at the road
  float fade = mix(pow(u, 1.3), 0.3 + 0.7 * pow(abs(2.0 * u - 1.0), 2.0), uEngage);
  float fres = pow(abs(dot(normalize(vN), normalize(vP))), mix(1.6, 1.1, uEngage)); // soft edges
  float len = length(vP);
  float axis = length(cross(vApex, vAxis)); // camera (view origin) to the beam axis: no haze when the lens is inside or beside the cone
  float near = mix(smoothstep(60.0, 260.0, len), smoothstep(0.0, 2.0, axis) * smoothstep(30.0, 75.0, len), uEngage);
  gl_FragColor = vec4(uColor, mix(0.22, 0.32, uEngage) * fade * fres * near);
}`;
const SPOT_VERTEX = `varying vec2 vUv; varying vec3 vP; void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vP = mv.xyz; gl_Position = projectionMatrix * mv; }`;
const SPOT_FRAGMENT = `
uniform vec3 uColor; uniform float uEngage; varying vec2 vUv; varying vec3 vP;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float soft = pow(clamp(1.0 - d, 0.0, 1.0), 1.5), crisp = smoothstep(1.0, 0.72, d) * (0.75 + 0.25 * smoothstep(0.7, 0.0, d)); // defined pool with a hot centre
  float near = smoothstep(3.0, 14.0, length(vP));
  gl_FragColor = vec4(uColor, near * mix(0.18 * soft, 0.32 * crisp, uEngage));
}`;

interface Heli {
  group: THREE.Group; pivot: THREE.Group; beam: THREE.Mesh; spot: THREE.Mesh; rotor: THREE.Mesh; strobe: THREE.Mesh; red: THREE.Mesh; green: THREE.Mesh;
  beamMat: THREE.ShaderMaterial; spotMat: THREE.ShaderMaterial; aim: THREE.Vector3; engage: number; aimed: boolean;
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
  const redMaterial = lightMaterial('#ff2a2a'), greenMaterial = lightMaterial('#2aff6a'), strobeMaterial = lightMaterial('#ffffff'), lampMaterial = lightMaterial('#fff0c8');
  const box = track(new THREE.BoxGeometry()), sphere = track(new THREE.SphereGeometry(.35, 8, 6)), disc = track(new THREE.CircleGeometry(5.5, 20));
  const beamGeometry = track(new THREE.ConeGeometry(BEAM_LENGTH * .11, BEAM_LENGTH, 24, 1, true)); beamGeometry.translate(0, -BEAM_LENGTH / 2, 0);
  const spotGeometry = track(new THREE.CircleGeometry(16, 28));
  const beamMaterial = track(new THREE.ShaderMaterial({ uniforms: { uColor: { value: new THREE.Color('#fff4d6') }, uEngage: { value: 0 } }, vertexShader: BEAM_VERTEX, fragmentShader: BEAM_FRAGMENT,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  const spotMaterial = track(new THREE.ShaderMaterial({ uniforms: { uColor: { value: new THREE.Color('#fff4d6') }, uEngage: { value: 0 } }, vertexShader: SPOT_VERTEX, fragmentShader: SPOT_FRAGMENT,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));

  const part = (geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => {
    const m = new THREE.Mesh(geometry, material); m.position.set(x, y, z); m.scale.set(sx, sy, sz); parent.add(m); return m;
  };

  const routeTop = route.reduce((top, p) => Math.max(top, p.y), 0);
  const heliLift = district === 'orbital' ? 40 : 0;
  const helis: Heli[] = [];
  for (let i = 0; i < MAX_HELIS; i++) {
    // Spread anchors along the lap and fly just above road level so drivers actually pass under them.
    const fraction = Math.min(.97, Math.max(.02, ANCHOR_FRACTIONS[(i - 1 + ANCHOR_FRACTIONS.length) % ANCHOR_FRACTIONS.length] + range(-.05, .05)));
    const near = route[Math.floor(fraction * route.length) % Math.max(1, route.length)] ?? new THREE.Vector3();
    const side = random() * Math.PI * 2, offset = range(20, 70);
    const height = Math.max(60, near.y + (district === 'desert' ? range(18, 40) : range(28, 70) + heliLift));
    const anchor = new THREE.Vector3(near.x + Math.cos(side) * offset, height, near.z + Math.sin(side) * offset);
    const group = new THREE.Group(); group.name = 'sky-helicopter';
    if (i === 0) group.scale.setScalar(PURSUIT_SCALE); // the chase helicopter reads from 100+ m away
    part(box, bodyMaterial, group, 0, 0, 0, 6, 2, 2);
    part(box, bodyMaterial, group, -5.5, .4, 0, 6, .6, .6);
    part(box, bodyMaterial, group, -8.4, 1.1, 0, .5, 2, .4);
    const rotor = part(disc, rotorMaterial, group, 0, 1.6, 0); rotor.rotation.x = -Math.PI / 2;
    const red = part(sphere, redMaterial, group, 0, 0, -1.2, 1.7, 1.7, 1.7);
    const green = part(sphere, greenMaterial, group, 0, 0, 1.2, 1.7, 1.7, 1.7);
    part(sphere, lampMaterial, group, 0, -1.1, 0, 1.9, 1.3, 1.9); // searchlight lamp at the beam origin
    const strobe = part(sphere, strobeMaterial, group, 0, 1.3, 0, 2, 2, 2);
    const pivot = new THREE.Group(); pivot.rotation.order = 'YXZ'; group.add(pivot);
    const beamMat = track(beamMaterial.clone()), spotMat = track(spotMaterial.clone());
    const beam = new THREE.Mesh(beamGeometry, beamMat); beam.frustumCulled = false; pivot.add(beam);
    const spot = new THREE.Mesh(spotGeometry, spotMat); spot.rotation.x = -Math.PI / 2; spot.frustumCulled = false;
    object.add(group, spot);
    helis.push({ group, pivot, beam, spot, rotor, strobe, red, green, beamMat, spotMat, aim: new THREE.Vector3(), engage: 0, aimed: false, anchor, radius: range(50, 90), speed: range(.05, .12), phase: random() * Math.PI * 2,
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
  // Route progress (cumulative arc length) so the pursuit helicopter can fly alongside the player.
  const cum: number[] = [0];
  for (let i = 1; i < route.length; i++) cum.push(cum[i - 1] + route[i].distanceTo(route[i - 1]));
  const lapLength = Math.max(1, cum[cum.length - 1]);
  const chase = {
    index: 0, started: false, following: true, traveled: 0, until: lapLength * range(.35, .48), side: random() < .5 ? -1 : 1, lastS: 0,
    ahead: range(65, 95), height: range(26, 38), lateral: range(45, 62), yaw: 0,
  };
  const dronePos = new THREE.Vector3(), prevDrone = new THREE.Vector3(), droneVel = new THREE.Vector3(), lead = new THREE.Vector3();
  const target = new THREE.Vector3(), chaseVel = new THREE.Vector3(), rel = new THREE.Vector3(), tmp = new THREE.Vector3(), desired = new THREE.Vector3();
  let havePlayer = false, roadY = 0;
  const nearestIndex = (pos: THREE.Vector3) => {
    const from = chase.started ? Math.max(0, chase.index - 30) : 0, to = chase.started ? Math.min(route.length - 1, chase.index + 30) : route.length - 1;
    let best = -1, bestD = Infinity;
    for (let i = from; i <= to; i++) { const d = (route[i].x - pos.x) ** 2 + (route[i].z - pos.z) ** 2; if (d < bestD) { bestD = d; best = i; } }
    if (chase.started && bestD > 150 * 150) return nearestIndexFull(pos);
    return best;
  };
  const nearestIndexFull = (pos: THREE.Vector3) => {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < route.length; i++) { const d = (route[i].x - pos.x) ** 2 + (route[i].z - pos.z) ** 2; if (d < bestD) { bestD = d; best = i; } }
    return best;
  };
  const indexAt = (s: number) => { // route index at arc length s (clamped); starts from the player index
    let i = chase.index;
    while (i < route.length - 1 && cum[i] < s) i++;
    while (i > 0 && cum[i] > s) i--;
    return i;
  };
  const chaseTarget = (out: THREE.Vector3) => {
    const base = cum[chase.index], at = base + (chase.following ? chase.ahead : 380); // peel off forward: it returns from ahead, in view
    const j = indexAt(at), k = Math.min(route.length - 1, j + 1), h = Math.max(0, j - 1);
    const tx = route[k].x - route[h].x, tz = route[k].z - route[h].z, tl = Math.hypot(tx, tz) || 1;
    const lateral = chase.following ? chase.lateral : 120;
    out.set(route[j].x + (-tz / tl) * lateral * chase.side, route[j].y + (chase.following ? chase.height : 75), route[j].z + (tx / tl) * lateral * chase.side);
  };
  const trackPlayer = (position: THREE.Vector3, dt: number) => {
    if (!havePlayer || position.distanceToSquared(prevDrone) > 80 * 80) { // first frame or restart: no velocity, re-seat the chaser
      droneVel.set(0, 0, 0); havePlayer = true; chase.started = false;
    } else if (dt > 0) droneVel.lerp(tmp.copy(position).sub(prevDrone).divideScalar(dt), 1 - Math.exp(-dt / .2));
    prevDrone.copy(position); dronePos.copy(position);
    const wasStarted = chase.started;
    chase.index = nearestIndex(position); chase.started = true;
    roadY = position.y - 1; // the drone hovers just above the road surface
    const s = cum[chase.index];
    if (wasStarted) {
      const ds = s - chase.lastS; if (ds > 0 && ds < 200) chase.traveled += ds;
      if (chase.traveled >= chase.until) {
        chase.traveled = 0; chase.following = !chase.following; chase.side = random() < .5 ? -1 : 1;
        chase.until = lapLength * (chase.following ? range(.35, .48) : range(.14, .2));
        chase.ahead = range(65, 95); chase.height = range(26, 38); chase.lateral = range(45, 62);
      }
    } else { chase.traveled = 0; chase.following = true; chase.until = lapLength * range(.35, .48); }
    chase.lastS = s;
    return !wasStarted;
  };
  const aimHeli = (h: Heli, dt: number, reduced: boolean, time: number, forceEngage: boolean) => {
    const gp = h.group.position;
    const inRange = havePlayer && gp.distanceToSquared(dronePos) < ENGAGE_RANGE * ENGAGE_RANGE;
    const engaged = forceEngage || inRange;
    h.engage += ((engaged ? 1 : 0) - h.engage) * (1 - Math.exp(-dt / .5));
    if (!engaged || !havePlayer) { // sweep target: ground point of the free-running search pattern
      const reach = Math.tan(h.pitch + Math.sin(time * .4 + h.phase) * .1) * gp.y, worldYaw = time * h.yawRate + h.phase;
      desired.set(gp.x - Math.sin(worldYaw) * reach, GROUND_Y, gp.z - Math.cos(worldYaw) * reach);
    } else { desired.copy(dronePos).addScaledVector(droneVel, .34); desired.y = roadY; }
    if (!h.aimed) { h.aim.copy(desired); h.aimed = true; } else h.aim.lerp(desired, 1 - Math.exp(-dt / (reduced ? .8 : .25)));
    const ax = h.aim.x - gp.x, az = h.aim.z - gp.z, dy = Math.max(8, gp.y - h.aim.y), planeY = h.aim.y;
    const t = (gp.y - planeY) / dy, pitch = Math.atan2(Math.hypot(ax, az), dy), worldYaw = Math.atan2(-ax, -az);
    h.pivot.rotation.set(pitch, worldYaw - h.group.rotation.y, 0);
    const scale = Math.hypot(ax, dy, az) * t / BEAM_LENGTH;
    h.beam.scale.setScalar(h === helis[0] ? scale / PURSUIT_SCALE : scale); // the beam is a child of the scaled group
    h.spot.position.set(gp.x + ax * t, planeY, gp.z + az * t);
    h.spot.scale.setScalar(((.8 + scale * .35) * (1 - h.engage) + .22 * h.engage) * (1 + .04 * Math.sin(time * 6 + h.phase)));
    h.beamMat.uniforms.uEngage.value = h.spotMat.uniforms.uEngage.value = h.engage;
  };
  const update = (time: number, position?: THREE.Vector3, delta = 0, reduced = false) => {
    const dt = Math.min(.1, Math.max(0, delta));
    const seated = position ? trackPlayer(position, dt) : false;
    helis.forEach((h, i) => {
      if (i >= HELI_COUNT[quality]) return;
      h.rotor.rotation.z = time * 40;
      h.strobe.visible = time % 1.2 < .12; h.red.visible = h.green.visible = (time * 1.4 + h.phase) % 1 < .6;
      if (i === 0) {
        if (!position) { h.group.visible = h.spot.visible = false; return; }
        h.group.visible = h.spot.visible = true;
        chaseTarget(target);
        if (seated) { h.group.position.copy(target); h.engage = 1; chaseVel.set(0, 0, 0); h.aimed = false; }
        else if (dt > 0) { // spring on the position relative to the (moving) target; speed-capped so it flies in rather than teleporting
          rel.copy(target).sub(h.group.position).multiplyScalar(.6).addScaledVector(tmp.copy(droneVel).sub(chaseVel), 1.55);
          chaseVel.addScaledVector(rel, dt);
          const speed = chaseVel.length(), cap = Math.max(60, droneVel.length() * 1.6); if (speed > cap) chaseVel.multiplyScalar(cap / speed);
          h.group.position.addScaledVector(chaseVel, dt);
        }
        h.group.position.y += Math.sin(time * .5 + h.bob) * .02;
        if (chaseVel.lengthSq() > 25 && dt > 0) {
          const want = Math.atan2(-chaseVel.z, chaseVel.x); let d = want - h.group.rotation.y; d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
          h.group.rotation.y += d * (1 - Math.exp(-dt / .6));
        }
        aimHeli(h, dt, reduced, time, chase.following);
        return;
      }
      const a = h.phase + time * h.speed * h.dir;
      h.group.position.set(h.anchor.x + Math.cos(a) * h.radius, h.anchor.y + Math.sin(time * .5 + h.bob) * 2, h.anchor.z + Math.sin(a) * h.radius);
      h.group.rotation.y = Math.atan2(-h.dir * Math.cos(a), -h.dir * Math.sin(a));
      aimHeli(h, dt, reduced, time, false);
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
