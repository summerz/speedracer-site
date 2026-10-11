import * as THREE from 'three';
import type { ParrySnapshot } from './parry.js';

export interface ParryEffect {
  update(parry: ParrySnapshot | null | undefined, delta: number, reducedMotion: boolean): void;
  reset(): void;
  dispose(): void;
}

export const PARRY_WARNING_COLOR = '#ffb347';
export const PARRY_SHIELD_COLOR = '#bff8ff';
const WINDOW_SECONDS = 0.3, WARNING_SECONDS = 0.7, FLASH_SECONDS = 0.28, RING_SECONDS = 0.3, FIZZLE_SECONDS = 0.3, SPARK_LIFE = 0.34;
const SPARKS = 8, RETICLE = 0, FLASH = 1, SPARK_AT = 2, COUNT = SPARK_AT + SPARKS;
const GLOW = 0, RETICLE_SPRITE = 1;

const finite = (value: number, fallback = 0) => (Number.isFinite(value) ? value : fallback);

/** One Points draw: an atlas of a soft glow (flash, sparks) and a hazard reticle (corner brackets + ring). */
const pointVertex = /* glsl */ `
  attribute float aAlpha;
  attribute float aSize;
  attribute float aKind;
  attribute vec3 aColor;
  uniform float uPixelRatio;
  varying float vAlpha;
  varying float vKind;
  varying vec3 vColor;
  void main() {
    vAlpha = aAlpha; vKind = aKind; vColor = aColor;
    vec4 p = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * p;
    // The reticle (kind 1) keeps a screen-space size that tightens with aSize (1 -> 0); glow sprites scale with depth.
    float world = aSize * uPixelRatio * 240.0 / max(0.1, -p.z);
    gl_PointSize = vKind > 0.5 ? (38.0 + 44.0 * clamp(aSize, 0.0, 1.0)) * uPixelRatio : clamp(world, 0.0, 200.0);
  }
`;
const pointFragment = /* glsl */ `
  uniform sampler2D uMap;
  varying float vAlpha;
  varying float vKind;
  varying vec3 vColor;
  void main() {
    vec2 uv = vec2(gl_PointCoord.x * 0.5 + vKind * 0.5, gl_PointCoord.y);
    float a = texture2D(uMap, uv).a;
    gl_FragColor = vec4(vColor * (1.0 + a * 0.6), clamp(a * vAlpha, 0.0, 1.0));
  }
`;

/** Fresnel rim plus a triplanar hex lattice; every normalize/pow input is guarded. */
const shieldVertex = /* glsl */ `
  varying vec3 vNormalView;
  varying vec3 vViewPosition;
  varying vec3 vObject;
  void main() {
    vObject = position;
    vNormalView = normalMatrix * normal;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;
const shieldFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uTime;
  varying vec3 vNormalView;
  varying vec3 vViewPosition;
  varying vec3 vObject;
  float hexEdge(vec2 p) {
    p *= 4.2;
    const vec2 s = vec2(1.0, 1.7320508);
    vec4 hc = floor(vec4(p, p - vec2(0.5, 1.0)) / s.xyxy) + 0.5;
    vec4 h = vec4(p - hc.xy * s, p - (hc.zw + 0.5) * s);
    vec2 q = dot(h.xy, h.xy) < dot(h.zw, h.zw) ? h.xy : h.zw;
    vec2 a = abs(q);
    float d = max(dot(a, s * 0.5), a.x);
    return smoothstep(0.40, 0.5, d);
  }
  void main() {
    float nl = length(vNormalView), vl = length(vViewPosition);
    vec3 n = nl > 1e-5 ? vNormalView / nl : vec3(0.0, 0.0, 1.0);
    vec3 v = vl > 1e-5 ? vViewPosition / vl : vec3(0.0, 0.0, 1.0);
    float rim = pow(clamp(1.0 - abs(dot(n, v)), 0.0, 1.0), 2.2);
    vec3 w = abs(normalize(vObject + vec3(1e-4)));
    w = w * w * w;
    float ws = max(w.x + w.y + w.z, 1e-4);
    float hex = (hexEdge(vObject.yz) * w.x + hexEdge(vObject.xz) * w.y + hexEdge(vObject.xy) * w.z) / ws;
    float sweep = 0.75 + 0.25 * sin(vObject.z * 6.0 - uTime * 14.0);
    float a = (0.10 + rim * 0.55 + hex * (0.35 + 0.25 * rim)) * sweep * uOpacity;
    gl_FragColor = vec4(uColor * (1.0 + hex * 0.5), clamp(a, 0.0, 1.0));
  }
`;

/**
 * Parry visuals: an amber hazard reticle at the predicted impact, a hex energy shell during the guard window,
 * a deflect flash with sparks and an expanding ring on success, a faint grey fizzle on failure.
 * Three draw calls (points, shell, ring); no allocation per frame.
 */
export function createParryEffect(drone: THREE.Object3D, scene: THREE.Scene): ParryEffect {
  const amber = new THREE.Color(PARRY_WARNING_COLOR), cyan = new THREE.Color(PARRY_SHIELD_COLOR);
  const white = new THREE.Color('#ffffff'), grey = new THREE.Color('#9aa7ad');

  const positions = new Float32Array(COUNT * 3), alpha = new Float32Array(COUNT), size = new Float32Array(COUNT);
  const kind = new Float32Array(COUNT), color = new Float32Array(COUNT * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(color, 3).setUsage(THREE.DynamicDrawUsage));

  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 64;
  const g = canvas.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.4, 'rgba(255,255,255,0.7)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    // Reticle: thin ring, four corner brackets and a centre dot.
    g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineWidth = 3; g.lineCap = 'round';
    g.beginPath(); g.arc(96, 32, 17, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 3.5;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const x = 96 + sx * 27, y = 32 + sy * 27;
      g.beginPath(); g.moveTo(x - sx * 10, y); g.lineTo(x, y); g.lineTo(x, y - sy * 10); g.stroke();
    }
    g.beginPath(); g.arc(96, 32, 2.6, 0, Math.PI * 2); g.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  const pointMaterial = new THREE.ShaderMaterial({
    uniforms: { uPixelRatio: { value: 1 }, uMap: { value: texture } },
    vertexShader: pointVertex, fragmentShader: pointFragment,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, toneMapped: false,
  });
  const points = new THREE.Points(geometry, pointMaterial);
  points.frustumCulled = false; points.visible = false; points.renderOrder = 20; points.name = 'parryPoints';
  scene.add(points);
  const setColor = (i: number, c: THREE.Color) => { color[i * 3] = c.r; color[i * 3 + 1] = c.g; color[i * 3 + 2] = c.b; };
  setColor(RETICLE, amber); setColor(FLASH, white); kind[RETICLE] = RETICLE_SPRITE; kind[FLASH] = GLOW;
  for (let i = SPARK_AT; i < COUNT; i++) { setColor(i, i % 2 ? white : cyan); kind[i] = GLOW; }

  // Hex shell hugging the craft (child of the drone so it banks and shakes with it).
  const shellGeometry = new THREE.IcosahedronGeometry(1, 3);
  const shellMaterial = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: cyan.clone() }, uOpacity: { value: 0 }, uTime: { value: 0 } },
    vertexShader: shieldVertex, fragmentShader: shieldFragment,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
  });
  const shell = new THREE.Mesh(shellGeometry, shellMaterial);
  shell.position.set(0, 0.3, -0.15); shell.scale.set(1.9, 1.05, 2.5);
  shell.frustumCulled = false; shell.visible = false; shell.name = 'parryShell';
  drone.add(shell);

  const ringGeometry = new THREE.RingGeometry(0.88, 1, 64);
  ringGeometry.rotateX(-Math.PI / 2);
  const ringMaterial = new THREE.MeshBasicMaterial({ color: PARRY_SHIELD_COLOR, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
    depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  ring.frustumCulled = false; ring.visible = false; ring.name = 'parryRing';
  scene.add(ring);

  const hitAt = new THREE.Vector3(), craft = new THREE.Vector3();
  const sparkVelocity = new Float32Array(SPARKS * 3), sparkAge = new Float32Array(SPARKS).fill(SPARK_LIFE);
  let seenSuccess = -1, seenFailure = -1, flashAge = 1, ringAge = 1, fizzleAge = 1, sparksLive = false, time = 0;

  const hideAll = () => {
    points.visible = false; ring.visible = false; shell.visible = false; shellMaterial.uniforms.uOpacity.value = 0;
    alpha.fill(0); (geometry.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
  };

  return {
    reset() { seenSuccess = seenFailure = -1; flashAge = ringAge = fizzleAge = 1; sparksLive = false; sparkAge.fill(SPARK_LIFE); hideAll(); },
    update(parry, delta, reducedMotion) {
      const dt = Math.min(0.1, Math.max(0, finite(delta)));
      time += dt;
      if (!parry || !parry.enabled) { seenSuccess = seenFailure = -1; flashAge = ringAge = fizzleAge = 1; sparksLive = false; hideAll(); return; }
      pointMaterial.uniforms.uPixelRatio.value = Math.min(2, finite(window.devicePixelRatio, 1));
      drone.getWorldPosition(craft);
      let any = false;

      // New events: the first frame after a reset adopts the ids silently.
      if (parry.successEventId !== seenSuccess) {
        const play = seenSuccess >= 0 && parry.successEventId > seenSuccess;
        seenSuccess = parry.successEventId;
        if (play) {
          const p = parry.lastEvent?.outcome === 'success' ? parry.lastEvent.target?.worldPosition : null;
          if (p) hitAt.set(finite(p.x, craft.x), finite(p.y, craft.y), finite(p.z, craft.z)); else hitAt.copy(craft);
          flashAge = 0; ringAge = 0; fizzleAge = 1; sparksLive = !reducedMotion;
          if (sparksLive) for (let i = 0; i < SPARKS; i++) {
            const theta = Math.random() * Math.PI * 2, lift = 0.2 + Math.random() * 0.8, speed = 5 + Math.random() * 9;
            sparkVelocity[i * 3] = Math.cos(theta) * speed; sparkVelocity[i * 3 + 1] = lift * speed * 0.8; sparkVelocity[i * 3 + 2] = Math.sin(theta) * speed;
            sparkAge[i] = 0;
          }
        }
      }
      if (parry.failureEventId !== seenFailure) {
        if (seenFailure >= 0 && parry.failureEventId > seenFailure) fizzleAge = 0;
        seenFailure = parry.failureEventId;
      }

      // Impact warning reticle, tightening as the impact approaches.
      const target = parry.target;
      const wp = target?.worldPosition;
      if (wp) {
        const u = Math.min(1, Math.max(0, finite(target!.secondsToImpact, WARNING_SECONDS) / WARNING_SECONDS));
        const pulse = reducedMotion ? 1 : 0.6 + 0.4 * Math.sin(time * (14 + 26 * (1 - u)));
        positions[RETICLE * 3] = finite(wp.x); positions[RETICLE * 3 + 1] = finite(wp.y); positions[RETICLE * 3 + 2] = finite(wp.z);
        alpha[RETICLE] = finite((0.55 + 0.45 * (1 - u)) * pulse); size[RETICLE] = u;
        any = true;
      } else alpha[RETICLE] = 0;

      // Success flash + sparks.
      flashAge += dt;
      const flashSeconds = reducedMotion ? FLASH_SECONDS * 0.6 : FLASH_SECONDS;
      if (flashAge < flashSeconds) {
        const t = flashAge / flashSeconds;
        positions[FLASH * 3] = hitAt.x; positions[FLASH * 3 + 1] = hitAt.y; positions[FLASH * 3 + 2] = hitAt.z;
        alpha[FLASH] = finite((1 - t) ** 1.4); size[FLASH] = finite(reducedMotion ? 4 : 3 + 5 * t); any = true;
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
          positions[k * 3 + 1] = hitAt.y + sparkVelocity[i * 3 + 1] * age - 8 * age * age;
          positions[k * 3 + 2] = hitAt.z + sparkVelocity[i * 3 + 2] * age;
          alpha[k] = finite((1 - t) ** 1.2); size[k] = 0.5 * (1 - t * 0.6);
        }
        sparksLive = live; any = any || live;
      } else for (let i = SPARK_AT; i < COUNT; i++) alpha[i] = 0;
      points.visible = any;
      geometry.getAttribute('position').needsUpdate = true;
      geometry.getAttribute('aAlpha').needsUpdate = true;
      geometry.getAttribute('aSize').needsUpdate = true;

      // Expanding shield ring from the craft.
      ringAge += dt;
      const ringSeconds = reducedMotion ? RING_SECONDS * 0.6 : RING_SECONDS;
      ring.visible = ringAge < ringSeconds;
      if (ring.visible) {
        const t = ringAge / ringSeconds;
        ring.position.copy(craft); ring.position.y += 0.3;
        ring.scale.setScalar(finite(reducedMotion ? 4 : 1.8 + 6.5 * (1 - (1 - t) ** 2), 2));
        ringMaterial.opacity = finite((1 - t) ** 1.5 * 0.9);
      }

      // Guard window shell (cyan-white), or the grey fizzle after a missed window.
      fizzleAge += dt;
      const guarding = parry.phase === 'window';
      const fizzleSeconds = reducedMotion ? FIZZLE_SECONDS * 0.6 : FIZZLE_SECONDS;
      const uniforms = shellMaterial.uniforms;
      if (guarding) {
        const left = Math.min(1, Math.max(0, finite(parry.windowRemaining) / WINDOW_SECONDS));
        (uniforms.uColor.value as THREE.Color).copy(cyan);
        uniforms.uOpacity.value = finite(reducedMotion ? 0.8 : 0.35 + 0.65 * left);
        shell.scale.set(1.9, 1.05, 2.5);
        shell.visible = true;
      } else if (fizzleAge < fizzleSeconds) {
        const t = fizzleAge / fizzleSeconds;
        (uniforms.uColor.value as THREE.Color).copy(grey);
        const flicker = reducedMotion ? 1 : 0.6 + 0.4 * Math.sin(time * 90) * Math.sin(time * 31);
        uniforms.uOpacity.value = finite(0.38 * (1 - t) * flicker);
        shell.scale.set(1.9, 1.05, 2.5).multiplyScalar(finite(reducedMotion ? 1 : 1 + 0.08 * t, 1));
        shell.visible = true;
      } else shell.visible = false;
      uniforms.uTime.value = reducedMotion ? 0 : finite(time % 1000);
    },
    dispose() {
      points.removeFromParent(); ring.removeFromParent(); shell.removeFromParent();
      geometry.dispose(); texture.dispose(); pointMaterial.dispose();
      shellGeometry.dispose(); shellMaterial.dispose(); ringGeometry.dispose(); ringMaterial.dispose();
    },
  };
}
