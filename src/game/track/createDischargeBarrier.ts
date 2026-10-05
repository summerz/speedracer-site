import * as THREE from 'three';
import type { HeightObstacle } from './createTrack';
export type BarrierReadiness = 'neutral' | 'ready' | 'blocked';

/** Grounded emitters and separate animated ribbons; the space between arcs stays empty. */
export function createDischargeBarrier(obstacle: HeightObstacle, halfWidth: number, maxFlightHeight = 6.2) {
  if (obstacle.kind === 'middle' && !obstacle.motion) {
    const lower = createDischargeBarrier({ ...obstacle, kind: 'rise' }, halfWidth, maxFlightHeight);
    const upper = createDischargeBarrier({ ...obstacle, kind: 'descend' }, halfWidth, maxFlightHeight);
    const object = new THREE.Group(); object.name = 'middleDischargeBarrier';
    object.add(lower.object, upper.object);
    return { object, hit() { lower.hit(); upper.hit(); }, update(time: number, reducedMotion: boolean, readiness: BarrierReadiness = 'neutral', _resolved?: HeightObstacle) {
      lower.update(time, reducedMotion, readiness); upper.update(time, reducedMotion, readiness);
    } };
  }
  const object = new THREE.Group();
  object.name = 'dischargeBarrier';
  const bottom = obstacle.motion ? 0 : obstacle.kind === 'rise' ? 0 : obstacle.maxAltitude + 0.65;
  const top = obstacle.motion ? maxFlightHeight + 3.8 : obstacle.kind === 'rise' ? obstacle.minAltitude - 0.65 : maxFlightHeight + 3.8;
  const color = obstacle.kind === 'rise' ? new THREE.Color(1.05, 0.12, 1.6) : new THREE.Color(0.1, 0.55, 1.8);
  const originalColor = color.clone();
  const readyColor = new THREE.Color(0.05, 1.3, 0.78);
  const blockedColor = new THREE.Color(1.6, 0.24, 0.035);
  const housing = new THREE.MeshStandardMaterial({ color: 0x263440, metalness: 0.75, roughness: 0.4 });
  const contact = new THREE.MeshBasicMaterial({ color });
  const baseGeometry = new THREE.CylinderGeometry(0.65, 0.85, 0.3, 8);
  const postGeometry = new THREE.CylinderGeometry(0.22, 0.32, top + 0.3, 8);
  const ringGeometry = new THREE.TorusGeometry(0.29, 0.075, 5, 12);
  const movingRings: THREE.Mesh[] = [];
  const directionMarkers: THREE.Mesh[] = [];
  const count = Math.max(2, Math.ceil((top - bottom) / 0.75));
  const heights = Array.from({ length: count }, (_, i) => bottom + 0.35 + i / (count - 1) * (top - bottom - 0.7));
  for (const side of [-1, 1]) {
    const base = new THREE.Mesh(baseGeometry, housing); base.position.set(side * halfWidth, 0.15, 0); object.add(base);
    const post = new THREE.Mesh(postGeometry, housing); post.position.set(side * halfWidth, (top + 0.3) / 2, 0); object.add(post);
    for (const y of heights) {
      const ring = new THREE.Mesh(ringGeometry, contact); ring.rotation.x = Math.PI / 2;
      ring.position.set(side * halfWidth, y, 0); object.add(ring);
    }
    if (obstacle.motion) {
      for (const edge of [-1, 1]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(.52, .11, 5, 12), contact);
        ring.rotation.x = Math.PI / 2; ring.position.x = side * halfWidth;
        ring.userData.edge = edge; movingRings.push(ring); object.add(ring);
      }
      const marker = new THREE.Mesh(new THREE.ConeGeometry(.4, .8, 3), contact);
      marker.position.x = side * (halfWidth + .8); directionMarkers.push(marker); object.add(marker);
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
    uniforms: { uTime: { value: 0 }, uImpact: { value: 0 }, uColor: { value: color }, uBlocked: { value: 0 },
      uMoving: { value: obstacle.motion ? 1 : 0 }, uGap: { value: new THREE.Vector2() } },
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    vertexShader: `
      uniform float uTime;
      uniform float uImpact;
      attribute float aSeed;
      varying vec2 vUv;
      varying float vSeed;
      varying float vHeight;
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
        vHeight = p.y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uImpact;
      uniform vec3 uColor;
      uniform float uBlocked;
      uniform float uMoving;
      uniform vec2 uGap;
      varying vec2 vUv;
      varying float vSeed;
      varying float vHeight;
      void main() {
        if (uMoving > .5 && vHeight > uGap.x && vHeight < uGap.y) discard;
        float edge = abs(vUv.y * 2.0 - 1.0);
        float core = 1.0 - smoothstep(0.0, 0.22, edge);
        float glow = exp(-edge * 4.5);
        float activity = 0.65 + 0.35 * sin(vSeed * 7.0 + uTime * 13.0);
        float breakUp = 0.65 + 0.35 * smoothstep(-0.2, 0.2, sin(vUv.x * 73.0 + vSeed + uTime * 17.0));
        float tail = vSeed > 16.0 ? 1.0 - smoothstep(0.4, 1.0, vUv.x) : 1.0;
        float warning = 1.0 + uBlocked * (0.25 + 0.25 * sin(uTime * 8.0));
        gl_FragColor = vec4(mix(uColor, vec3(2.5), core * 0.45) * (1.0 + uImpact * 2.0) * warning, glow * activity * breakUp * tail);
      }
    `,
  });
  object.add(new THREE.Mesh(geometry, material));
  let lastTime = 0;
  let impactTime = -Infinity;
  return {
    object,
    hit() { impactTime = lastTime; },
    update(time: number, reducedMotion: boolean, readiness: BarrierReadiness = 'neutral', resolved: HeightObstacle = obstacle) {
      lastTime = time;
      // Restarted simulations must not replay a previous impact.
      if (time < impactTime) impactTime = -Infinity;
      const impact = Math.exp(-(time - impactTime) * 9);
      material.uniforms.uTime.value = reducedMotion ? 0 : time;
      material.uniforms.uImpact.value = impact;
      material.uniforms.uBlocked.value = readiness === 'blocked' && !reducedMotion ? 1 : 0;
      color.copy(readiness === 'ready' ? readyColor : readiness === 'blocked' ? blockedColor : originalColor);
      object.userData.readiness = readiness;
      contact.color.copy(color).multiplyScalar(1 + impact * 2);
      if (obstacle.motion) {
        const low = resolved.minAltitude - .65, high = resolved.maxAltitude + .65;
        material.uniforms.uGap.value.set(low, high);
        movingRings.forEach(ring => { ring.position.y = ring.userData.edge < 0 ? low : high; });
        // The track supplies the actual ping-pong direction, independent of render animation.
        directionMarkers.forEach(marker => {
          marker.position.y = (low + high) / 2;
          marker.rotation.z = object.userData.movingDirection === -1 ? Math.PI : 0;
        });
        object.userData.gap = [resolved.minAltitude, resolved.maxAltitude];
      }
    },
  };
}
