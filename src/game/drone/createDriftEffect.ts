import * as THREE from 'three';

export type DriftStage = 0 | 1 | 2 | 3;
export interface DriftReward { id: number; stage: DriftStage; earnedCharge: number; addedCharge: number; cancelled: boolean }
/** Mirrors the logic-side snapshot contract (docs/DRIFT.md). */
export interface DriftView {
  active: boolean;
  direction: -1 | 0 | 1;
  angle: number;
  seconds: number;
  stage: DriftStage;
  stageProgress: number;
  pendingCharge: number;
  lastReward: DriftReward | null;
}

export interface DriftEffect {
  update(drift: DriftView | undefined, delta: number, reducedMotion: boolean): void;
  reset(): void;
  dispose(): void;
}

/** One palette shared by the 3D effect and the HUD pips. */
export const DRIFT_STAGE_COLORS = ['#cfeff5', '#7cf3ff', '#ffb347', '#ff5fd2'] as const;

const TRAIL_SECONDS = 0.15, STEP = 1 / 60, POINTS = 24, SPARKS = 64, FADE_OUT = 0.3, RING_SECONDS = 0.4;
const SPARK_RATE = [0, 34, 70, 130] as const;
const STAGE_STRENGTH = [0.35, 0.65, 0.85, 1] as const;

const ribbonVertex = /* glsl */ `
  attribute float aAlpha;
  varying float vAlpha;
  void main() {
    vAlpha = aAlpha;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const ribbonFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAlpha;
  void main() { gl_FragColor = vec4(uColor * 2.2, clamp(vAlpha * uOpacity, 0.0, 1.0)); }
`;
const sparkVertex = /* glsl */ `
  attribute float aAlpha;
  attribute float aSize;
  uniform float uPixelRatio;
  varying float vAlpha;
  void main() {
    vAlpha = aAlpha;
    vec4 p = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * p;
    gl_PointSize = clamp(aSize * uPixelRatio * 240.0 / max(0.1, -p.z), 2.0, 40.0);
  }
`;
const sparkFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform sampler2D uMap;
  varying float vAlpha;
  void main() {
    float a = texture2D(uMap, gl_PointCoord).a;
    vec3 c = mix(uColor * 2.6, vec3(3.0, 3.0, 3.0), smoothstep(0.55, 1.0, a));
    gl_FragColor = vec4(c, clamp(a * vAlpha, 0.0, 1.0));
  }
`;

const finite = (value: number, fallback = 0) => (Number.isFinite(value) ? value : fallback);

/** Rear-thruster ribbons, outer-side sparks and a ground ring flash; three draw calls, nothing allocated per frame. */
export function createDriftEffect(drone: THREE.Group, scene: THREE.Scene): DriftEffect {
  const anchors = ['thrusterLeft', 'thrusterRight'].map((name) => {
    const anchor = drone.getObjectByName(name);
    if (!anchor) throw new Error(`드리프트 궤적 부착 위치가 없습니다: ${name}`);
    return anchor;
  });
  const palette = DRIFT_STAGE_COLORS.map((hex) => new THREE.Color(hex));
  const color = new THREE.Color(palette[1]);

  // Ribbons: both sides share one geometry; vertex 2i / 2i+1 are the two edges of history point i (0 = newest).
  const history = new Float32Array(2 * POINTS * 3);
  const stamp = new Float32Array(POINTS);
  const ribbonPositions = new Float32Array(2 * POINTS * 2 * 3);
  const ribbonAlpha = new Float32Array(2 * POINTS * 2);
  const indices: number[] = [];
  for (let side = 0; side < 2; side++) for (let i = 0; i < POINTS - 1; i++) {
    const a = (side * POINTS + i) * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const ribbonGeometry = new THREE.BufferGeometry();
  ribbonGeometry.setAttribute('position', new THREE.BufferAttribute(ribbonPositions, 3).setUsage(THREE.DynamicDrawUsage));
  ribbonGeometry.setAttribute('aAlpha', new THREE.BufferAttribute(ribbonAlpha, 1).setUsage(THREE.DynamicDrawUsage));
  ribbonGeometry.setIndex(indices);
  const ribbonMaterial = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color }, uOpacity: { value: 0 } },
    vertexShader: ribbonVertex, fragmentShader: ribbonFragment,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  });
  const ribbon = new THREE.Mesh(ribbonGeometry, ribbonMaterial);
  ribbon.frustumCulled = false; ribbon.visible = false; ribbon.name = 'driftTrail';
  scene.add(ribbon);

  // Sparks.
  const sparkPositions = new Float32Array(SPARKS * 3);
  const sparkAlpha = new Float32Array(SPARKS);
  const sparkSize = new Float32Array(SPARKS);
  const sparkVelocity = new Float32Array(SPARKS * 3);
  const sparkAge = new Float32Array(SPARKS).fill(1);
  const sparkLife = new Float32Array(SPARKS).fill(1);
  const sparkGeometry = new THREE.BufferGeometry();
  sparkGeometry.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3).setUsage(THREE.DynamicDrawUsage));
  sparkGeometry.setAttribute('aAlpha', new THREE.BufferAttribute(sparkAlpha, 1).setUsage(THREE.DynamicDrawUsage));
  sparkGeometry.setAttribute('aSize', new THREE.BufferAttribute(sparkSize, 1).setUsage(THREE.DynamicDrawUsage));
  const spriteCanvas = document.createElement('canvas');
  spriteCanvas.width = spriteCanvas.height = 64;
  const g = spriteCanvas.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.35, 'rgba(255,255,255,0.8)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  }
  const sparkTexture = new THREE.CanvasTexture(spriteCanvas);
  const sparkMaterial = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color }, uPixelRatio: { value: 1 }, uMap: { value: sparkTexture } },
    vertexShader: sparkVertex, fragmentShader: sparkFragment,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  });
  const sparks = new THREE.Points(sparkGeometry, sparkMaterial);
  sparks.frustumCulled = false; sparks.visible = false; sparks.name = 'driftSparks';
  scene.add(sparks);

  // End-of-drift ring flash, flat under the craft.
  const ringGeometry = new THREE.RingGeometry(0.88, 1, 64);
  ringGeometry.rotateX(-Math.PI / 2);
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: '#ffffff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  ring.frustumCulled = false; ring.visible = false; ring.name = 'driftRing'; ring.position.set(0, -0.3, 0.8);
  drone.add(ring);

  const tmp = new THREE.Vector3(), tangent = new THREE.Vector3(), side = new THREE.Vector3(), up = new THREE.Vector3();
  const back = new THREE.Vector3(), out = new THREE.Vector3(), origin = new THREE.Vector3();
  let clock = 0, accum = 0, head = 0, primed = false, fade = 0, wasActive = false, seenReward = -1, rewardPrimed = false;
  let ringAge = RING_SECONDS, ringStrength = 1, emit = 0, cursor = 0;

  const hideAll = () => { ribbon.visible = false; sparks.visible = false; ring.visible = false; ringAge = RING_SECONDS; fade = 0; primed = false; wasActive = false; };

  function pushHistory() {
    head = (head + POINTS - 1) % POINTS; // newest slot moves backwards so older points keep their index offset
    stamp[head] = clock;
    for (let s = 0; s < 2; s++) {
      anchors[s].getWorldPosition(tmp);
      const o = (s * POINTS + head) * 3;
      history[o] = tmp.x; history[o + 1] = tmp.y; history[o + 2] = tmp.z;
    }
  }
  function prime() {
    for (let s = 0; s < 2; s++) {
      anchors[s].getWorldPosition(tmp);
      for (let i = 0; i < POINTS; i++) { const o = (s * POINTS + i) * 3; history[o] = tmp.x; history[o + 1] = tmp.y; history[o + 2] = tmp.z; }
    }
    stamp.fill(-1e3); head = 0; accum = 0; primed = true;
  }
  function buildRibbon(strength: number) {
    up.set(0, 1, 0).transformDirection(drone.matrixWorld);
    if (up.lengthSq() < 0.5) up.set(0, 1, 0);
    for (let s = 0; s < 2; s++) for (let i = 0; i < POINTS; i++) {
      const cur = (s * POINTS + (head + i) % POINTS) * 3;
      const prev = (s * POINTS + (head + Math.max(0, i - 1)) % POINTS) * 3;
      const next = (s * POINTS + (head + Math.min(POINTS - 1, i + 1)) % POINTS) * 3;
      tangent.set(history[prev] - history[next], history[prev + 1] - history[next + 1], history[prev + 2] - history[next + 2]);
      side.crossVectors(tangent, up);
      const len = side.length();
      if (len > 1e-5) side.multiplyScalar(1 / len); else side.set(0, 0, 0);
      const t = Math.min(1, Math.max(0, (clock - stamp[(head + i) % POINTS]) / TRAIL_SECONDS)), half = 0.045 * (1 - t);
      const v = (s * POINTS + i) * 2;
      for (let k = 0; k < 2; k++) {
        const sign = k ? 1 : -1, o = (v + k) * 3;
        ribbonPositions[o] = history[cur] + side.x * half * sign;
        ribbonPositions[o + 1] = history[cur + 1] + side.y * half * sign;
        ribbonPositions[o + 2] = history[cur + 2] + side.z * half * sign;
        ribbonAlpha[v + k] = 0.9 * (1 - t) * (1 - t) * (len > 1e-5 ? 1 : 0);
      }
    }
    (ribbonGeometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (ribbonGeometry.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
    ribbonMaterial.uniforms.uOpacity.value = strength;
  }
  function emitSpark(direction: number) {
    for (let n = 0; n < SPARKS; n++) {
      const i = (cursor + n) % SPARKS;
      if (sparkAge[i] < sparkLife[i]) continue;
      cursor = (i + 1) % SPARKS;
      const outward = -direction || 1; // outer side is opposite the drift direction
      origin.set(outward * (0.7 + Math.random() * 0.3), -0.05 - Math.random() * 0.12, 1.5 + Math.random() * 0.5);
      origin.applyMatrix4(drone.matrixWorld);
      back.set(0, 0, 1).transformDirection(drone.matrixWorld);
      out.set(outward, 0, 0).transformDirection(drone.matrixWorld);
      const spread = 2.5 + Math.random() * 2.5, rear = 0.6 + Math.random() * 1.6, lift = 2.2 + Math.random() * 2.2;
      sparkPositions[i * 3] = origin.x; sparkPositions[i * 3 + 1] = origin.y; sparkPositions[i * 3 + 2] = origin.z;
      sparkVelocity[i * 3] = out.x * spread + back.x * rear;
      sparkVelocity[i * 3 + 1] = out.y * spread + back.y * rear + lift;
      sparkVelocity[i * 3 + 2] = out.z * spread + back.z * rear;
      sparkAge[i] = 0; sparkLife[i] = 0.25 + Math.random() * 0.15; sparkSize[i] = 0.18 + Math.random() * 0.16;
      return;
    }
  }
  function updateSparks(dt: number, rate: number, direction: number, canEmit: boolean) {
    if (canEmit && rate > 0) {
      emit += rate * dt;
      for (; emit >= 1; emit -= 1) emitSpark(direction);
    } else emit = 0;
    let alive = 0;
    for (let i = 0; i < SPARKS; i++) {
      if (sparkAge[i] >= sparkLife[i]) { sparkAlpha[i] = 0; continue; }
      sparkAge[i] += dt;
      alive++;
      const t = Math.min(1, sparkAge[i] / sparkLife[i]);
      sparkVelocity[i * 3 + 1] -= 7 * dt;
      sparkPositions[i * 3] += sparkVelocity[i * 3] * dt;
      sparkPositions[i * 3 + 1] += sparkVelocity[i * 3 + 1] * dt;
      sparkPositions[i * 3 + 2] += sparkVelocity[i * 3 + 2] * dt;
      sparkAlpha[i] = t >= 1 ? 0 : (1 - t) * 0.95;
    }
    sparks.visible = alive > 0;
    (sparkGeometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (sparkGeometry.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
    (sparkGeometry.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
  }

  return {
    update(drift, delta, reducedMotion) {
      const dt = Math.min(0.1, Math.max(0, finite(delta)));
      if (!drift) { if (ribbon.visible || sparks.visible || ring.visible) hideAll(); rewardPrimed = false; return; }
      const stage = (drift.stage >= 0 && drift.stage <= 3 ? Math.round(finite(drift.stage)) : 0) as DriftStage;
      const active = !!drift.active;
      // First sight after construct/reset only records the reward id; a stale reward must not replay.
      const reward = drift.lastReward;
      if (!rewardPrimed) { rewardPrimed = true; seenReward = reward?.id ?? -1; }
      else if (reward && reward.id !== seenReward) {
        seenReward = reward.id;
        if (!reward.cancelled && reward.stage > 0 && !reducedMotion) {
          ringAge = 0; ringStrength = STAGE_STRENGTH[reward.stage];
          ringMaterial.color.copy(palette[reward.stage]);
        }
      }

      if (active) { if (!primed || !wasActive) prime(); fade = 1; color.lerp(palette[stage], 1 - Math.exp(-dt * 16)); }
      else if (fade > 0) fade = Math.max(0, fade - dt / FADE_OUT);
      wasActive = active;
      clock += dt; accum += dt;
      if (fade > 0) {
        if (accum >= STEP) { accum %= STEP; pushHistory(); }
        ribbon.visible = true;
        buildRibbon(STAGE_STRENGTH[stage] * fade);
      } else { ribbon.visible = false; primed = false; }

      if (reducedMotion) { sparks.visible = false; sparkAge.fill(1); sparkLife.fill(1); emit = 0; }
      else {
        sparkMaterial.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio || 1, 1.75);
        updateSparks(dt, SPARK_RATE[stage], drift.direction, active);
      }

      if (ringAge < RING_SECONDS) {
        ringAge += dt;
        const t = Math.min(1, ringAge / RING_SECONDS);
        ring.visible = t < 1;
        ring.scale.setScalar(1.3 + 2.7 * (1 - (1 - t) ** 2));
        ringMaterial.opacity = (1 - t) ** 2 * 0.9 * ringStrength;
      } else ring.visible = false;
    },
    reset() { hideAll(); sparkAge.fill(1); sparkLife.fill(1); sparkAlpha.fill(0); emit = 0; rewardPrimed = false; },
    dispose() {
      ribbon.removeFromParent(); sparks.removeFromParent(); ring.removeFromParent();
      ribbonGeometry.dispose(); ribbonMaterial.dispose(); sparkGeometry.dispose(); sparkMaterial.dispose(); sparkTexture.dispose(); ringGeometry.dispose(); ringMaterial.dispose();
    },
  };
}
