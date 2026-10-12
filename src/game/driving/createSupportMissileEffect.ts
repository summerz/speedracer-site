import * as THREE from 'three';
import { SUPPORT_MISSILE_STOP, type SupportMissileSnapshot } from './supportMissile.js';

export interface MissileTargetEntry { rival: { id: string }; object: THREE.Object3D }
export interface SupportMissileEffect {
  update(snapshot: SupportMissileSnapshot | null | undefined, targets: readonly MissileTargetEntry[], delta: number, reducedMotion: boolean): void;
  reset(): void;
  dispose(): void;
}

/** Hot red-orange core, white tip: distinct from the boost cyan and the drift stage palette. */
export const MISSILE_COLOR = '#ff5a3c';
const TRAIL = 10, SPARKS = 10, FLASH_SECONDS = 0.3, RING_SECONDS = 0.35, SPARK_LIFE = 0.42, TRAIL_SECONDS = 0.15;
const HEAD_GLOW = 0, HEAD_TIP = 1, FLASH = 2, TRAIL_AT = 3, SPARK_AT = TRAIL_AT + TRAIL, COUNT = SPARK_AT + SPARKS;
const STOP_SECONDS = SUPPORT_MISSILE_STOP, CAGE_RADIUS = 3.7, ARCS = 6;

const pointVertex = /* glsl */ `
  attribute float aAlpha;
  attribute float aSize;
  attribute vec3 aColor;
  uniform float uPixelRatio;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vAlpha = aAlpha; vColor = aColor;
    vec4 p = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * p;
    gl_PointSize = clamp(aSize * uPixelRatio * 240.0 / max(0.1, -p.z), 0.0, 160.0);
  }
`;
const pointFragment = /* glsl */ `
  uniform sampler2D uMap;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    float a = texture2D(uMap, gl_PointCoord).a;
    gl_FragColor = vec4(vColor * (1.0 + a), clamp(a * vAlpha, 0.0, 1.0));
  }
`;

const finite = (value: number, fallback = 0) => (Number.isFinite(value) ? value : fallback);

/** Builds `arcs` short flat arcs on a circle, in the XZ plane or the XY plane; one geometry, no per-frame work. */
function cageGeometry(arcs: number, fill: number): THREE.BufferGeometry {
  const steps = 6, inner = CAGE_RADIUS - 0.06, outer = CAGE_RADIUS + 0.06;
  const positions: number[] = [], indices: number[] = [];
  for (let plane = 0; plane < 2; plane++) for (let arc = 0; arc < arcs; arc++) {
    const start = (arc / arcs) * Math.PI * 2 + plane * 0.5, span = (fill / arcs) * Math.PI * 2, base = positions.length / 3;
    for (let i = 0; i <= steps; i++) {
      const a = start + (span * i) / steps, c = Math.cos(a), s = Math.sin(a);
      for (const r of [inner, outer]) positions.push(r * c, plane ? r * s : 0, plane ? 0 : r * s);
      if (i < steps) { const k = base + i * 2; indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

/**
 * Support-missile visuals: a dart with a short trail and hit sparks (one Points draw), a hit shock ring, and the
 * electric lock cage around the stopped rival. Three draw calls, no allocation per frame.
 */
export function createSupportMissileEffect(scene: THREE.Scene): SupportMissileEffect {
  const red = new THREE.Color(MISSILE_COLOR), hot = new THREE.Color('#ff9a5c'), white = new THREE.Color('#ffffff');

  const positions = new Float32Array(COUNT * 3), alpha = new Float32Array(COUNT), size = new Float32Array(COUNT), color = new Float32Array(COUNT * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(color, 3).setUsage(THREE.DynamicDrawUsage));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.4, 'rgba(255,255,255,0.7)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  }
  const texture = new THREE.CanvasTexture(canvas);
  const pointMaterial = new THREE.ShaderMaterial({
    uniforms: { uPixelRatio: { value: 1 }, uMap: { value: texture } },
    vertexShader: pointVertex, fragmentShader: pointFragment,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  });
  const points = new THREE.Points(geometry, pointMaterial);
  points.frustumCulled = false; points.visible = false; points.name = 'supportMissilePoints';
  scene.add(points);

  const setColor = (i: number, c: THREE.Color) => { color[i * 3] = c.r; color[i * 3 + 1] = c.g; color[i * 3 + 2] = c.b; };
  for (let i = 0; i < COUNT; i++) setColor(i, i === HEAD_TIP || i === FLASH ? white : i >= SPARK_AT ? hot : red);

  const ringGeometry = new THREE.RingGeometry(0.86, 1, 64);
  ringGeometry.rotateX(-Math.PI / 2);
  const ringMaterial = new THREE.MeshBasicMaterial({ color: '#ff8a5c', transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
    depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  ring.frustumCulled = false; ring.visible = false; ring.name = 'supportMissileShock';
  scene.add(ring);

  // Rotating arcs while motion is allowed; a plain static ring under reduced motion.
  const arcGeometry = cageGeometry(ARCS, 0.55), staticGeometry = cageGeometry(1, 0.999);
  const cageMaterial = new THREE.MeshBasicMaterial({ color: '#ff7a4a', transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
    depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  const cage = new THREE.Mesh(arcGeometry, cageMaterial);
  cage.frustumCulled = false; cage.visible = false; cage.name = 'supportMissileCage';
  scene.add(cage);

  const pos = new THREE.Vector3(), prev = new THREE.Vector3(), velocity = new THREE.Vector3();
  const hitAt = new THREE.Vector3(), hotTrail = new THREE.Vector3(), step = new THREE.Vector3();
  const sparkVelocity = new Float32Array(SPARKS * 3), sparkAge = new Float32Array(SPARKS).fill(SPARK_LIFE);
  let seenHit = -1, wasFlying = false, hitAge = 1, cageTime = 0, sparksLive = false;

  const hideAll = () => {
    points.visible = false; ring.visible = false; cage.visible = false;
    alpha.fill(0); (geometry.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
  };
  const set = (i: number, p: THREE.Vector3, a: number, s: number) => {
    positions[i * 3] = p.x; positions[i * 3 + 1] = p.y; positions[i * 3 + 2] = p.z; alpha[i] = finite(a); size[i] = finite(s);
  };

  return {
    reset() { seenHit = -1; wasFlying = false; hitAge = 1; sparkAge.fill(SPARK_LIFE); sparksLive = false; velocity.set(0, 0, 0); hideAll(); },
    update(snapshot, targets, delta, reducedMotion) {
      const dt = Math.min(0.1, Math.max(0, finite(delta)));
      pointMaterial.uniforms.uPixelRatio.value = Math.min(2, finite(window.devicePixelRatio, 1));
      if (!snapshot) { seenHit = -1; wasFlying = false; hitAge = 1; sparksLive = false; hideAll(); return; }
      const flying = snapshot.phase === 'flying' && !!snapshot.position;
      let anyPoint = false;

      // New hit: flash + ring + sparks once per id; the first frame after a reset adopts the id silently.
      if (snapshot.hitEventId !== seenHit) {
        const play = seenHit >= 0 && snapshot.hitEventId > seenHit && !!snapshot.position;
        seenHit = snapshot.hitEventId;
        if (play) {
          hitAt.set(finite(snapshot.position!.x), finite(snapshot.position!.y), finite(snapshot.position!.z));
          hitAge = 0; sparksLive = !reducedMotion;
          for (let i = 0; i < SPARKS; i++) {
            const theta = Math.random() * Math.PI * 2, lift = 0.2 + Math.random() * 0.8, speed = 6 + Math.random() * 10;
            sparkVelocity[i * 3] = Math.cos(theta) * speed; sparkVelocity[i * 3 + 1] = lift * speed * 0.8; sparkVelocity[i * 3 + 2] = Math.sin(theta) * speed;
            sparkAge[i] = 0;
          }
        }
      }

      // Missile body + trail.
      if (flying) {
        pos.set(finite(snapshot.position!.x), finite(snapshot.position!.y), finite(snapshot.position!.z));
        if (!wasFlying) { prev.copy(pos); velocity.set(0, 0, 0); }
        if (dt > 1e-5) velocity.lerp(step.copy(pos).sub(prev).multiplyScalar(1 / dt), 0.6);
        prev.copy(pos);
        const flicker = reducedMotion ? 1 : 0.85 + 0.15 * Math.sin(performance.now() * 0.06);
        set(HEAD_GLOW, pos, 0.95 * flicker, 1.5); set(HEAD_TIP, pos, 1, 0.55);
        for (let i = 0; i < TRAIL; i++) {
          const u = (i + 1) / TRAIL;
          // Trail = where the dart was TRAIL_SECONDS * u ago, extrapolated along its current velocity.
          hotTrail.set(pos.x - velocity.x * TRAIL_SECONDS * u, pos.y - velocity.y * TRAIL_SECONDS * u, pos.z - velocity.z * TRAIL_SECONDS * u);
          set(TRAIL_AT + i, hotTrail, 0.8 * (1 - u) ** 1.4, 1.35 * (1 - u * 0.75));
        }
        anyPoint = true;
      } else {
        for (let i = HEAD_GLOW; i < TRAIL_AT + TRAIL; i++) if (i !== FLASH) alpha[i] = 0;
      }
      wasFlying = flying;

      // Hit flash + sparks.
      hitAge += dt;
      if (hitAge < FLASH_SECONDS) {
        const t = hitAge / FLASH_SECONDS;
        set(FLASH, hitAt, (1 - t) ** 1.5, 3.2 + 4.5 * t); anyPoint = true;
      } else alpha[FLASH] = 0;
      if (sparksLive) {
        let live = false;
        for (let i = 0; i < SPARKS; i++) {
          sparkAge[i] += dt;
          const age = sparkAge[i], k = SPARK_AT + i;
          if (age >= SPARK_LIFE) { alpha[k] = 0; continue; }
          live = true;
          const t = age / SPARK_LIFE;
          positions[k * 3] = hitAt.x + sparkVelocity[i * 3] * age;
          positions[k * 3 + 1] = hitAt.y + sparkVelocity[i * 3 + 1] * age - 9 * age * age;
          positions[k * 3 + 2] = hitAt.z + sparkVelocity[i * 3 + 2] * age;
          alpha[k] = (1 - t) ** 1.2; size[k] = 0.55 * (1 - t * 0.6);
        }
        sparksLive = live; anyPoint = anyPoint || live;
      } else for (let i = SPARK_AT; i < COUNT; i++) alpha[i] = 0;
      points.visible = anyPoint;
      geometry.getAttribute('position').needsUpdate = true;
      geometry.getAttribute('aAlpha').needsUpdate = true;
      geometry.getAttribute('aSize').needsUpdate = true;

      // Shock ring.
      ring.visible = !reducedMotion && hitAge < RING_SECONDS;
      if (ring.visible) {
        const t = hitAge / RING_SECONDS;
        ring.position.copy(hitAt); ring.scale.setScalar(1.2 + 8.5 * (1 - (1 - t) ** 2));
        ringMaterial.opacity = finite((1 - t) ** 1.6 * 0.9);
      }

      // Lock cage around the stopped rival, fading with the remaining stop time.
      const stopped = snapshot.phase === 'hit' && snapshot.stopRemaining > 1e-4 && snapshot.targetId !== null;
      let target: THREE.Object3D | undefined;
      if (stopped) for (let i = 0; i < targets.length; i++) if (targets[i].rival.id === snapshot.targetId) { target = targets[i].object; break; }
      cage.visible = !!target;
      if (target) {
        const remaining = Math.min(1, Math.max(0, finite(snapshot.stopRemaining) / STOP_SECONDS));
        cage.geometry = reducedMotion ? staticGeometry : arcGeometry;
        cage.position.copy(target.position); cage.position.y += 0.4;
        if (!reducedMotion) { cageTime += dt; cage.rotation.y = cageTime * 4.2; cage.rotation.x = Math.sin(cageTime * 2.1) * 0.35; }
        else { cage.rotation.set(0, 0, 0); }
        const crackle = reducedMotion ? 1 : 0.78 + 0.22 * Math.sin(cageTime * 70) * Math.sin(cageTime * 23);
        cageMaterial.opacity = finite(Math.min(1, remaining * 2.2) * 0.85 * crackle);
        const pulse = reducedMotion ? 1 : 1 + 0.06 * Math.sin(cageTime * 14);
        cage.scale.setScalar(finite(0.75 + 0.25 * Math.min(1, remaining * 3)) * pulse);
      }
    },
    dispose() {
      [points, ring, cage].forEach((object) => object.removeFromParent());
      geometry.dispose(); texture.dispose(); pointMaterial.dispose();
      ringGeometry.dispose(); ringMaterial.dispose();
      arcGeometry.dispose(); staticGeometry.dispose(); cageMaterial.dispose();
    },
  };
}
