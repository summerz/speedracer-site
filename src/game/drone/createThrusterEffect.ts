import * as THREE from 'three';
import { setThrusterIntensity } from './createRacingDrone.js';

export type ThrustMode = 'idle' | 'accelerate' | 'boost' | 'boost-stage2';

/** A drone or equipped item can provide its own palette, independently of thrust. */
export interface ThrusterStyle {
  readonly core: THREE.ColorRepresentation;
  readonly body: THREE.ColorRepresentation;
  readonly tail: THREE.ColorRepresentation;
  readonly afterglow: THREE.ColorRepresentation;
}

export const DEFAULT_THRUSTER_STYLE: ThrusterStyle = {
  core: '#fff1ce', body: '#ff9e35', tail: '#ed4216', afterglow: '#ff8e2c',
};

export interface ThrusterEffect {
  setMode(mode: ThrustMode): void;
  setBoostCharge(progress: number): void;
  setStyle(style: ThrusterStyle): void;
  update(delta: number, reducedMotion: boolean): void;
  dispose(): void;
}

const settings = {
  idle: { length: 0.42, brightness: 0.65, glow: 0.35, particles: 0 },
  accelerate: { length: 1.65, brightness: 1.0, glow: 1.1, particles: 0 },
  boost: { length: 3.1, brightness: 1.4, glow: 2.0, particles: 48 },
  'boost-stage2': { length: 4.8, brightness: 1.9, glow: 3.2, particles: 64 },
} satisfies Record<ThrustMode, { length: number; brightness: number; glow: number; particles: number }>;

const flameVertex = /* glsl */ `
  uniform float uTime;
  uniform float uLength;
  uniform float uRadius;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vUv = uv;
    vec3 p = position;
    float t = p.z;
    float pulse = 1.0 + 0.07 * sin(uTime * 19.0 - t * 15.0);
    p.xy *= uRadius * pulse;
    p.z *= uLength * (1.0 + 0.045 * sin(uTime * 13.0 + t * 8.0));
    p.x += sin(t * 11.0 - uTime * 15.0) * t * t * uRadius * 0.12;
    p.y += sin(t * 14.0 - uTime * 12.0 + 2.0) * t * t * uRadius * 0.10;
    vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = -viewPosition.xyz;
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const flameFragment = /* glsl */ `
  uniform float uTime;
  uniform float uBrightness;
  uniform float uCore;
  uniform float uEnergy;
  uniform vec3 uCoreColor;
  uniform vec3 uBodyColor;
  uniform vec3 uTailColor;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), f.x), f.y);
  }
  void main() {
    float t = vUv.y;
    float angle = vUv.x * 6.283185;
    // Periodic coordinates keep the animated noise continuous at the UV seam.
    vec2 flow = vec2(cos(angle) * 3.0 + sin(angle) * 2.0, t * 8.0 - uTime * 5.0);
    float turbulence = noise(flow) * 0.65 + noise(flow * 2.3) * 0.35;
    float streaks = 0.5 + 0.5 * sin(t * 36.0 - uTime * 24.0 + turbulence * 7.0);
    float envelope = (1.0 - smoothstep(0.55, 1.0, t)) * smoothstep(0.0, 0.045, t);
    float facing = pow(abs(dot(normalize(vNormal), normalize(vView))), 0.65);
    float texture = mix(0.06, 1.0, turbulence * turbulence) * mix(0.3, 1.0, streaks);
    float alpha = envelope * texture * mix(0.4, 0.9, facing);
    vec3 color = mix(uBodyColor, uTailColor, smoothstep(0.2, 0.9, t));
    color = mix(color, uCoreColor, uCore * (1.0 - smoothstep(0.0, 0.5, t)));
    color = mix(color, vec3(1.0), uEnergy * (1.0 - smoothstep(0.0, 0.6, t)) * 0.65);
    gl_FragColor = vec4(color * uBrightness * mix(1.1, 2.3, uCore), alpha);
  }
`;

const particleVertex = /* glsl */ `
  attribute float aAlpha;
  attribute float aSize;
  uniform float uPixelRatio;
  varying float vAlpha;
  void main() {
    vAlpha = aAlpha;
    vec4 p = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * p;
    gl_PointSize = clamp(aSize * uPixelRatio * 240.0 / max(0.1, -p.z), 1.0, 24.0);
  }
`;

const particleFragment = /* glsl */ `
  uniform vec3 uAfterglowColor;
  varying float vAlpha;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float alpha = (1.0 - smoothstep(0.15, 1.0, r)) * vAlpha;
    gl_FragColor = vec4(uAfterglowColor * 3.0, alpha);
  }
`;

/** Attached flames follow the drone; short-lived particles remain in world space. */
export function createThrusterEffect(
  drone: THREE.Group, scene: THREE.Scene, style: ThrusterStyle = DEFAULT_THRUSTER_STYLE,
): ThrusterEffect {
  const anchors = ['thrusterLeft', 'thrusterRight'].map((name) => {
    const anchor = drone.getObjectByName(name);
    if (!anchor) throw new Error(`추진부 부착 위치가 없습니다: ${name}`);
    return anchor;
  });
  // Broad base at z=0, narrow tip at z=1; the drone exhaust points along local +Z.
  const geometry = new THREE.CylinderGeometry(0.005, 1, 1, 32, 18, true);
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, 0, 0.5);
  const palette = {
    uCoreColor: { value: new THREE.Color(style.core) },
    uBodyColor: { value: new THREE.Color(style.body) },
    uTailColor: { value: new THREE.Color(style.tail) },
    uAfterglowColor: { value: new THREE.Color(style.afterglow) },
  };
  const makeMaterial = (core: boolean) => new THREE.ShaderMaterial({
    uniforms: {
      ...palette,
      uTime: { value: 0 }, uLength: { value: 1 }, uRadius: { value: core ? 0.095 : 0.20 },
      uBrightness: { value: settings.idle.brightness }, uCore: { value: core ? 1 : 0 },
      uEnergy: { value: 0 },
    },
    vertexShader: flameVertex, fragmentShader: flameFragment,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    depthTest: true, side: THREE.FrontSide,
  });
  const shell = makeMaterial(false);
  const core = makeMaterial(true);
  const groups = anchors.map((anchor) => {
    const group = new THREE.Group();
    group.name = 'thrusterFlame';
    for (const material of [shell, core]) {
      const mesh = new THREE.Mesh(geometry, material);
      // Length is a shader uniform, so the CPU geometry bounds cannot describe it.
      mesh.frustumCulled = false;
      group.add(mesh);
    }
    anchor.add(group);
    return group;
  });

  const count = 96;
  const positions = new Float32Array(count * 3);
  const alphas = new Float32Array(count);
  const sizes = new Float32Array(count);
  const velocities = new Float32Array(count * 3);
  const ages = new Float32Array(count);
  const lives = new Float32Array(count);
  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  particleGeometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1).setUsage(THREE.DynamicDrawUsage));
  particleGeometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage));
  const particleMaterial = new THREE.ShaderMaterial({
    uniforms: { uPixelRatio: { value: 1 }, uAfterglowColor: palette.uAfterglowColor },
    vertexShader: particleVertex, fragmentShader: particleFragment,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true,
  });
  const particles = new THREE.Points(particleGeometry, particleMaterial);
  particles.name = 'thrusterAfterglow';
  particles.frustumCulled = false;
  scene.add(particles);
  const origin = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  let nextParticle = 0;
  let emission = 0;
  let time = 0;
  let mode: ThrustMode = 'idle';
  let length = settings.idle.length;
  let brightness = settings.idle.brightness;
  let glow = settings.idle.glow;
  let boostCharge = 0;
  let energy = 0;
  let radiusScale = 1;

  return {
    setMode(next) { mode = next; },
    setBoostCharge(progress) { boostCharge = THREE.MathUtils.clamp(progress, 0, 1); },
    setStyle(next) {
      palette.uCoreColor.value.set(next.core);
      palette.uBodyColor.value.set(next.body);
      palette.uTailColor.value.set(next.tail);
      palette.uAfterglowColor.value.set(next.afterglow);
    },
    update(delta, reducedMotion) {
      time += delta;
      const target = settings[mode];
      const blend = 1 - Math.exp(-delta * 9);
      length = THREE.MathUtils.lerp(length, target.length, blend);
      const charging = mode === 'boost' ? THREE.MathUtils.smoothstep(boostCharge, 0.65, 1) : 0;
      brightness = THREE.MathUtils.lerp(brightness, target.brightness + charging * 0.35, blend);
      glow = THREE.MathUtils.lerp(glow, target.glow + charging * 0.9, blend);
      energy = THREE.MathUtils.lerp(energy, mode === 'boost-stage2' ? 1 : charging, blend);
      radiusScale = THREE.MathUtils.lerp(radiusScale, mode === 'boost-stage2' ? 0.85 : 1, blend);
      setThrusterIntensity(drone, glow);
      shell.uniforms.uLength.value = length;
      core.uniforms.uLength.value = length * 0.72;
      for (const material of [shell, core]) {
        material.uniforms.uTime.value = reducedMotion ? 0 : time;
        material.uniforms.uBrightness.value = brightness;
        material.uniforms.uEnergy.value = energy;
        material.uniforms.uRadius.value = (material === core ? 0.095 : 0.20) * radiusScale;
      }
      particleMaterial.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio || 1, 1.75);
      // Existing particles fade when switching away from boost; reuse the particle buffers.
      for (let i = 0; i < count; i++) {
        if (lives[i] === 0) continue;
        ages[i] += delta;
        if (reducedMotion || ages[i] >= lives[i]) { lives[i] = 0; alphas[i] = 0; continue; }
        const p = i * 3;
        positions[p] += velocities[p] * delta;
        positions[p + 1] += velocities[p + 1] * delta;
        positions[p + 2] += velocities[p + 2] * delta;
        alphas[i] = (1 - ages[i] / lives[i]) ** 2;
      }
      emission = reducedMotion ? 0 : emission + target.particles * delta;
      while (emission >= 1) {
        emission--;
        drone.updateWorldMatrix(true, true);
        for (const anchor of anchors) {
          anchor.getWorldPosition(origin);
          anchor.getWorldQuaternion(rotation);
          direction.set(0, 0, 1).applyQuaternion(rotation);
          const i = nextParticle;
          nextParticle = (nextParticle + 1) % count;
          const p = i * 3;
          const distance = length * (0.5 + Math.random() * 0.45);
          positions[p] = origin.x + direction.x * distance + (Math.random() - 0.5) * 0.08;
          positions[p + 1] = origin.y + direction.y * distance + (Math.random() - 0.5) * 0.08;
          positions[p + 2] = origin.z + direction.z * distance;
          const speed = 3.0 + Math.random() * 3.5;
          velocities[p] = direction.x * speed + (Math.random() - 0.5) * 0.18;
          velocities[p + 1] = direction.y * speed + (Math.random() - 0.5) * 0.18;
          velocities[p + 2] = direction.z * speed;
          ages[i] = 0;
          lives[i] = 0.22 + Math.random() * 0.23;
          alphas[i] = 1;
          sizes[i] = 0.05 + Math.random() * 0.075;
        }
      }
      for (const name of ['position', 'aAlpha', 'aSize']) particleGeometry.getAttribute(name).needsUpdate = true;
      particles.visible = !reducedMotion && lives.some((life) => life > 0);
    },
    dispose() {
      groups.forEach((group) => group.removeFromParent());
      particles.removeFromParent();
      geometry.dispose();
      shell.dispose();
      core.dispose();
      particleGeometry.dispose();
      particleMaterial.dispose();
    },
  };
}
