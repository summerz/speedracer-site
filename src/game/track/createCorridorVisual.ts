import * as THREE from 'three';
import { createTrackFrame, type CorridorObstacle, type Track } from './createTrack.js';
import type { BarrierReadiness } from './createDischargeBarrier.js';

/** A curved road ribbon, clear lane and sparse full-height discharge. No solid gate or wall. */
export function createCorridorVisual(track: Track, obstacle: CorridorObstacle) {
  const object = new THREE.Group(); object.name = 'narrow-corridor';
  const danger: number[] = [], guide: number[] = [], filaments: number[] = [];
  const frame = createTrackFrame(), point = new THREE.Vector3();
  const low = obstacle.safeCenter - obstacle.safeWidth / 2, high = obstacle.safeCenter + obstacle.safeWidth / 2;
  const start = obstacle.distance - obstacle.depth / 2, end = obstacle.distance + obstacle.depth / 2;
  const vertex = (distance: number, offset: number, altitude: number) => {
    track.sample(distance, frame, obstacle.routeId);
    return point.copy(frame.position).addScaledVector(frame.right, offset).addScaledVector(frame.up, altitude).toArray();
  };
  const quad = (target: number[], a: number[], b: number[], c: number[], d: number[]) => target.push(...a, ...b, ...c, ...a, ...c, ...d);
  const line = (target: number[], d1: number, x1: number, d2: number, x2: number, width = .15) => {
    quad(target, vertex(d1, x1 - width, .14), vertex(d1, x1 + width, .14),
      vertex(d2, x2 + width, .14), vertex(d2, x2 - width, .14));
  };
  for (let d = start; d < end; d += 4) {
    const next = Math.min(end, d + 4);
    for (const [a, b] of [[-track.halfWidth, low], [high, track.halfWidth]]) {
      if (b <= a) continue;
      // Strong diagonal floor hatching, kept separate from the clear route.
      quad(danger, vertex(d, a, .09), vertex(Math.min(next, d + 1.4), a, .09),
        vertex(next, b, .09), vertex(Math.max(d, next - 1.4), b, .09));
      for (let x = a + .4; x < b; x += 2.3) {
        const y = track.altitudeProfile.levels.at(-1)! + 2.8;
        quad(filaments, vertex(d, x - .055, .2), vertex(d, x + .055, .2),
          vertex(d + .4, x + .055, y), vertex(d + .4, x - .055, y));
      }
    }
    line(guide, d, low, next, low); line(guide, d, high, next, high);
  }
  // An approach trail leads toward the opening, before the hazard itself begins.
  for (let d = start - 110; d < end - 3; d += 13) {
    const x = obstacle.safeCenter;
    line(guide, d, x - 1.25, d + 2, x, .2); line(guide, d, x + 1.25, d + 2, x, .2);
  }
  const riskMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, .28, .04),
    transparent: true, opacity: .65, side: THREE.DoubleSide, depthWrite: false });
  const guideMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(.08, 1.5, .95), side: THREE.DoubleSide });
  const filamentMaterial = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, uniforms: { time: { value: 0 }, impact: { value: 0 } },
    vertexShader: `varying vec3 p; void main(){p=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `uniform float time; uniform float impact; varying vec3 p;
      void main(){float flicker=.25+.25*sin(p.y*9.+p.x*.5+time*18.);
      gl_FragColor=vec4(vec3(1.6,.25,.04)*(1.+impact*2.),flicker*(.3+impact*.5));}` });
  for (const [positions, material] of [[danger, riskMaterial], [guide, guideMaterial], [filaments, filamentMaterial]] as const) {
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeBoundingSphere(); object.add(new THREE.Mesh(geometry, material));
  }
  let lastTime = 0, impactTime = -Infinity;
  return {
    object,
    hit() { impactTime = lastTime; },
    update(time: number, reducedMotion: boolean, readiness: BarrierReadiness) {
      lastTime = time; if (time < impactTime) impactTime = -Infinity;
      const impact = Math.exp(-(time - impactTime) * 9);
      filamentMaterial.uniforms.time.value = reducedMotion ? 0 : time;
      filamentMaterial.uniforms.impact.value = impact;
      riskMaterial.opacity = .55 + impact * .35;
      guideMaterial.color.setRGB(.08, readiness === 'ready' ? 1.8 : 1.25, readiness === 'ready' ? 1.2 : .65);
      object.userData.readiness = readiness;
    },
  };
}
