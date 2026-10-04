import * as THREE from 'three';
import type { SpeedEffects } from '../drone/droneConfiguration';

/** Screen-space ribbons have a real pixel width, unlike WebGL line primitives. */
export function createSpeedLines(style: SpeedEffects) {
  const count = 40;
  const positions = new Float32Array(count * 12);
  const uvs = new Float32Array(count * 8);
  const indices: number[] = [];
  for (let i = 0; i < count; i++) {
    uvs.set([0, 0, 0, 1, 1, 0, 1, 1], i * 8);
    const vertex = i * 4;
    indices.push(vertex, vertex + 2, vertex + 1, vertex + 1, vertex + 2, vertex + 3);
  }
  const geometry = new THREE.BufferGeometry();
  const attribute = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', attribute);
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  const material = new THREE.ShaderMaterial({
    uniforms: { opacity: { value: 0 }, color: { value: new THREE.Color(0x9bd4e4) } },
    vertexShader: `varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `uniform float opacity; uniform vec3 color; varying vec2 vUv;
      void main() {
        float edge = smoothstep(0.0, 0.22, vUv.y) * smoothstep(0.0, 0.22, 1.0 - vUv.y);
        float tip = smoothstep(0.0, 0.18, vUv.x) * smoothstep(0.0, 0.12, 1.0 - vUv.x);
        gl_FragColor = vec4(color, opacity * edge * tip);
      }`,
    transparent: true, depthWrite: false, depthTest: false, toneMapped: false, side: THREE.DoubleSide,
  });
  const object = new THREE.Mesh(geometry, material);
  object.name = 'speedRibbons';
  object.frustumCulled = false;
  object.renderOrder = 5;
  let width = 1;
  let height = 1;
  return {
    object,
    setSize(w: number, h: number) { width = w; height = h; },
    update(time: number, speed: number, boosting: boolean, reducedMotion: boolean, stage2 = false) {
      const strength = reducedMotion || !boosting ? 0 : THREE.MathUtils.clamp((speed - style.streakStartSpeed) / style.referenceSpeed, 0, 1);
      material.uniforms.opacity.value = strength * (stage2 ? style.boostStage2StreakOpacity : boosting ? style.boostStreakOpacity : style.streakOpacity);
      object.visible = material.uniforms.opacity.value > 0.001;
      if (!object.visible) return;
      const pixels = stage2 ? style.boostStage2StreakWidth : boosting ? style.boostStreakWidth : style.streakWidth;
      for (let i = 0; i < count; i++) {
        const angle = i * 2.399963;
        const phase = (i * 0.618 + time * (0.65 + speed / style.referenceSpeed)) % 1;
        const radius = 0.58 + phase * 0.92;
        const length = 0.12 + strength * (boosting ? 0.42 : 0.24);
        const x = Math.cos(angle) * 1.2;
        const y = Math.sin(angle) * 1.2;
        const dx = x * width;
        const dy = y * height;
        const magnitude = Math.hypot(dx, dy);
        const halfWidth = pixels * Math.min(1, phase * 8, (1 - phase) * 8);
        const px = -dy / magnitude * halfWidth / width;
        const py = dx / magnitude * halfWidth / height;
        const startX = x * radius;
        const startY = 0.04 + y * radius;
        const endX = x * (radius + length);
        const endY = 0.04 + y * (radius + length);
        positions.set([
          startX - px, startY - py, 0, startX + px, startY + py, 0,
          endX - px, endY - py, 0, endX + px, endY + py, 0,
        ], i * 12);
      }
      attribute.needsUpdate = true;
    },
  };
}
