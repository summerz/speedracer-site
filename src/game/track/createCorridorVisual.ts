import * as THREE from 'three';
import { createTrackFrame, type CorridorObstacle, type Track } from './createTrack.js';
import type { BarrierReadiness } from './createDischargeBarrier.js';

/**
 * A curved road ribbon, clear lane and sparse full-height discharge. No solid gate or wall.
 * Everything is built once in the corridor's local frame (x = lateral offset); the clear lane is a shader band and
 * a translated guide mesh.
 */
export function createCorridorVisual(track: Track, obstacle: CorridorObstacle) {
  const object = new THREE.Group(); object.name = 'narrow-corridor';
  const danger: number[] = [], guide: number[] = [], filaments: number[] = [];
  const frame = createTrackFrame(), point = new THREE.Vector3(), centre = createTrackFrame();
  track.sample(obstacle.distance, centre, obstacle.routeId);
  const zAxis = new THREE.Vector3().crossVectors(centre.right, centre.up);
  object.position.copy(centre.position);
  object.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(centre.right, centre.up, zAxis));
  const half = obstacle.safeWidth / 2, edge = track.halfWidth;
  const start = obstacle.distance - obstacle.depth / 2, end = obstacle.distance + obstacle.depth / 2;
  const vertex = (distance: number, offset: number, altitude: number) => {
    track.sample(distance, frame, obstacle.routeId);
    point.copy(frame.position).sub(centre.position).addScaledVector(frame.right, offset).addScaledVector(frame.up, altitude);
    return [point.dot(centre.right), point.dot(centre.up), point.dot(zAxis)];
  };
  const quad = (target: number[], a: number[], b: number[], c: number[], d: number[]) => target.push(...a, ...b, ...c, ...a, ...c, ...d);
  const line = (target: number[], d1: number, x1: number, d2: number, x2: number, width = .15) => {
    quad(target, vertex(d1, x1 - width, .14), vertex(d1, x1 + width, .14),
      vertex(d2, x2 + width, .14), vertex(d2, x2 - width, .14));
  };
  for (let d = start; d < end; d += 4) {
    const next = Math.min(end, d + 4);
    // Strong diagonal floor hatching across the whole road; the shader leaves the clear lane open.
    quad(danger, vertex(d, -edge, .09), vertex(Math.min(next, d + 1.4), -edge, .09),
      vertex(next, edge, .09), vertex(Math.max(d, next - 1.4), edge, .09));
    for (let x = -edge + .4; x < edge; x += 2.3) {
      const y = track.altitudeProfile.levels.at(-1)! + 2.8;
      quad(filaments, vertex(d, x - .055, .2), vertex(d, x + .055, .2),
        vertex(d + .4, x + .055, y), vertex(d + .4, x - .055, y));
    }
    line(guide, d, -half, next, -half); line(guide, d, half, next, half);
  }
  // An approach trail leads toward the opening, before the hazard itself begins.
  for (let d = start - 110; d < end - 3; d += 13) {
    line(guide, d, -1.25, d + 2, 0, .2); line(guide, d, 1.25, d + 2, 0, .2);
  }
  const band = new THREE.Vector2(obstacle.safeCenter - half, obstacle.safeCenter + half);
  const riskMaterial = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { color: { value: new THREE.Color(1.6, .28, .04) }, opacity: { value: .65 }, band: { value: band } },
    vertexShader: `varying float x; void main(){x=position.x;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `uniform vec3 color; uniform float opacity; uniform vec2 band; varying float x;
      void main(){if(x>band.x&&x<band.y)discard;gl_FragColor=vec4(color,opacity);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }` });
  const guideMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 1.6, 1.7), side: THREE.DoubleSide });
  const filamentMaterial = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, uniforms: { time: { value: 0 }, impact: { value: 0 }, band: { value: band } },
    vertexShader: `varying vec3 p; void main(){p=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `uniform float time; uniform float impact; uniform vec2 band; varying vec3 p;
      void main(){if(p.x>band.x&&p.x<band.y)discard;float flicker=.25+.25*sin(p.y*9.+p.x*.5+time*18.);
      gl_FragColor=vec4(vec3(1.6,.25,.04)*(1.+impact*2.),flicker*(.3+impact*.5));}` });
  const meshes: THREE.Mesh[] = [];
  for (const [positions, material] of [[danger, riskMaterial], [guide, guideMaterial], [filaments, filamentMaterial]] as const) {
    if (!positions.length) continue;
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeBoundingSphere(); const mesh = new THREE.Mesh(geometry, material); object.add(mesh); meshes.push(mesh);
  }
  meshes[1].position.x = obstacle.safeCenter;
  let lastTime = 0, impactTime = -Infinity;
  return {
    object,
    hit() { impactTime = lastTime; },
    update(time: number, reducedMotion: boolean, readiness: BarrierReadiness) {
      lastTime = time; if (time < impactTime) impactTime = -Infinity;
      const impact = Math.exp(-(time - impactTime) * 9);
      filamentMaterial.uniforms.time.value = reducedMotion ? 0 : time;
      filamentMaterial.uniforms.impact.value = impact;
      riskMaterial.uniforms.opacity.value = .55 + impact * .35;
      guideMaterial.color.setRGB(readiness === 'ready' ? 1.6 : 1.1, readiness === 'ready' ? 1.8 : 1.2, readiness === 'ready' ? 1.9 : 1.3);
      object.userData.readiness = readiness;
    },
  };
}
