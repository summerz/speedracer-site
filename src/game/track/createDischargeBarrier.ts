import * as THREE from 'three';
import type { HeightObstacle } from './createTrack';

/** Grounded emitters and separate animated ribbons; the space between arcs stays empty. */
export function createDischargeBarrier(obstacle: HeightObstacle, halfWidth: number, maxFlightHeight = 6.2) {
  if (obstacle.kind === 'middle') {
    const lower = createDischargeBarrier({ ...obstacle, kind: 'rise' }, halfWidth, maxFlightHeight);
    const upper = createDischargeBarrier({ ...obstacle, kind: 'descend' }, halfWidth, maxFlightHeight);
    const object = new THREE.Group(); object.name = 'middleDischargeBarrier';
    object.add(lower.object, upper.object);
    return { object, hit() { lower.hit(); upper.hit(); }, update(time: number, reducedMotion: boolean) {
      lower.update(time, reducedMotion); upper.update(time, reducedMotion);
    } };
  }
  const object = new THREE.Group();
  object.name = 'dischargeBarrier';
  const bottom = obstacle.kind === 'rise' ? 0 : obstacle.maxAltitude + 0.65;
  const top = obstacle.kind === 'rise' ? obstacle.minAltitude - 0.65 : maxFlightHeight + 3.8;
  const color = obstacle.kind === 'rise' ? new THREE.Color(1.05, 0.12, 1.6) : new THREE.Color(0.1, 0.55, 1.8);
  const housing = new THREE.MeshStandardMaterial({ color: 0x263440, metalness: 0.75, roughness: 0.4 });
  const contact = new THREE.MeshBasicMaterial({ color });
  const baseGeometry = new THREE.CylinderGeometry(0.65, 0.85, 0.3, 8);
  const postGeometry = new THREE.CylinderGeometry(0.22, 0.32, top + 0.3, 8);
  const ringGeometry = new THREE.TorusGeometry(0.29, 0.075, 5, 12);
  const count = Math.max(2, Math.ceil((top - bottom) / 0.75));
  const heights = Array.from({ length: count }, (_, i) => bottom + 0.35 + i / (count - 1) * (top - bottom - 0.7));
  for (const side of [-1, 1]) {
    const base = new THREE.Mesh(baseGeometry, housing); base.position.set(side * halfWidth, 0.15, 0); object.add(base);
    const post = new THREE.Mesh(postGeometry, housing); post.position.set(side * halfWidth, (top + 0.3) / 2, 0); object.add(post);
    for (const y of heights) {
      const ring = new THREE.Mesh(ringGeometry, contact); ring.rotation.x = Math.PI / 2;
      ring.position.set(side * halfWidth, y, 0); object.add(ring);
    }
  }
  const positions: number[] = [], uvs: number[] = [], seeds: number[] = [], indices: number[] = [];
  const segments = 80;
  const ribbon = (start: number, end: number, y: number, seed: number, branch: boolean) => {
    const offset = positions.length / 3;
    for (let i = 0; i <= segments; i++) {
      const u = i / segments;
      const x = THREE.MathUtils.lerp(start, end, u);
      for (let side = 0; side < 2; side++) {
        positions.push(x, y + (branch ? u * 0.6 : 0), branch ? u * 0.45 : 0);
        uvs.push(u, side); seeds.push(seed);
      }
    }
    for (let i = 0; i < segments; i++) {
      const a = offset + i * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  };
  heights.forEach((y, i) => {
    ribbon(-halfWidth, halfWidth, y, i + 1, false);
    // Small offshoots break up parallel silhouettes without filling the entire opening.
    ribbon(-halfWidth * 0.5, halfWidth * 0.05, y, i + 17, true);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));
  geometry.setIndex(indices); geometry.computeBoundingSphere();
  // Include shader displacement so frustum culling cannot hide a visible arc.
  if (geometry.boundingSphere) geometry.boundingSphere.radius += 1;
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uImpact: { value: 0 }, uColor: { value: color } },
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    vertexShader: `
      uniform float uTime;
      uniform float uImpact;
      attribute float aSeed;
      varying vec2 vUv;
      varying float vSeed;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vUv = uv; vSeed = aSeed;
        float tick = floor(uTime * 10.0);
        float segment = uv.x * 40.0;
        float envelope = pow(max(0.0, sin(uv.x * 3.14159265)), 0.4);
        float a = hash(vec2(floor(segment) + aSeed * 71.0, tick));
        float b = hash(vec2(floor(segment) + 1.0 + aSeed * 71.0, tick));
        vec3 p = position;
        p.y += (mix(a, b, fract(segment)) - 0.5) * (0.72 + uImpact * 0.65) * envelope;
        p.z += sin(segment * 0.7 + aSeed * 3.0 + tick) * 0.25 * envelope;
        p.y += (uv.y - 0.5) * (0.24 + uImpact * 0.36);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uImpact;
      uniform vec3 uColor;
      varying vec2 vUv;
      varying float vSeed;
      void main() {
        float edge = abs(vUv.y * 2.0 - 1.0);
        float core = 1.0 - smoothstep(0.0, 0.22, edge);
        float glow = exp(-edge * 4.5);
        float activity = 0.65 + 0.35 * sin(vSeed * 7.0 + uTime * 13.0);
        float breakUp = 0.65 + 0.35 * smoothstep(-0.2, 0.2, sin(vUv.x * 73.0 + vSeed + uTime * 17.0));
        float tail = vSeed > 16.0 ? 1.0 - smoothstep(0.4, 1.0, vUv.x) : 1.0;
        gl_FragColor = vec4(mix(uColor, vec3(2.5), core * 0.7) * (1.0 + uImpact * 2.0), glow * activity * breakUp * tail);
      }
    `,
  });
  object.add(new THREE.Mesh(geometry, material));
  let lastTime = 0;
  let impactTime = -Infinity;
  return {
    object,
    hit() { impactTime = lastTime; },
    update(time: number, reducedMotion: boolean) {
      lastTime = time;
      // Restarted simulations must not replay a previous impact.
      if (time < impactTime) impactTime = -Infinity;
      const impact = Math.exp(-(time - impactTime) * 9);
      material.uniforms.uTime.value = reducedMotion ? 0 : time;
      material.uniforms.uImpact.value = impact;
      contact.color.copy(color).multiplyScalar(1 + impact * 2);
    },
  };
}
