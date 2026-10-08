import * as THREE from 'three';
import { createTrackFrame, type Track } from './createTrack.js';
import { merge } from './createMineFieldVisual.js';

/**
 * A floating cyan (reward colour) ring for every boost ring, facing along the road frame: a bright torus, a soft additive halo
 * and a faint film across the opening. It sits where crafts travel in that section (the starting altitude level, lifted so the
 * ring clears the road). Shared geometry and materials per part, instanced; `hit` flashes the ring and pulses its scale.
 */
export function createBoostRingVisual(track: Track) {
  const rings = track.boostRings ?? [], object = new THREE.Group(); object.name = 'boost-rings';
  const radius = rings[0]?.radius ?? 3.5, count = Math.max(1, rings.length), levels = track.altitudeProfile;
  const lift = Math.max(levels.levels[levels.initialLevel], radius + .3);
  const flash = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
  const uniforms = { time: { value: 0 }, pulse: { value: 0 } };
  const shader = (body: string, extra: Partial<THREE.ShaderMaterialParameters> = {}) => new THREE.ShaderMaterial({ toneMapped: false, uniforms, side: THREE.DoubleSide,
    vertexShader: `attribute float flash; varying float f; varying vec2 vUv; void main(){f=flash;vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}`,
    fragmentShader: `uniform float time; uniform float pulse; varying float f; varying vec2 vUv; void main(){ ${body} }`, ...extra });
  const glow = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
  const parts = [
    [merge([new THREE.TorusGeometry(radius, .22, 8, 40).toNonIndexed()]), shader(`vec3 col=vec3(.1,1.7,1.6)*(1.+pulse*.4); col=mix(col,vec3(3.5),f*.8); gl_FragColor=vec4(col,1.);`)],
    [merge([new THREE.TorusGeometry(radius, .75, 8, 40).toNonIndexed()]), shader(`vec3 col=vec3(.05,.9,.9)*(.35+pulse*.15+f*.8); gl_FragColor=vec4(col,.3+f*.3);`, glow)],
    [merge([new THREE.CircleGeometry(radius * .96, 40).toNonIndexed()]), shader(`float r=length(vUv-.5)*2.; vec3 col=vec3(.1,1.1,1.1)*(.25+.35*r*r+.3*sin(r*9.-time*3.)*.5+f*.8); gl_FragColor=vec4(col,.1+.1*r+f*.2);`, glow)],
  ] as const;
  const meshes = parts.map(([geometry, material]) => {
    geometry.setAttribute('flash', flash);
    const mesh = new THREE.InstancedMesh(geometry, material, count); mesh.count = rings.length; mesh.frustumCulled = false; object.add(mesh); return mesh;
  });

  const frame = createTrackFrame(), z = new THREE.Vector3();
  const bases = rings.map(ring => {
    track.sample(ring.distance, frame, ring.routeId); z.crossVectors(frame.right, frame.up);
    return new THREE.Matrix4().makeBasis(frame.right, frame.up, z)
      .setPosition(frame.position.clone().addScaledVector(frame.right, ring.offset).addScaledVector(frame.up, lift));
  });
  const scaled = new THREE.Matrix4(), grow = new THREE.Matrix4();
  bases.forEach((base, i) => meshes.forEach(mesh => mesh.setMatrixAt(i, base)));
  const hits = rings.map(() => -Infinity);
  let lastTime = 0;
  return {
    object,
    /** Flashes the ring nearest `distance` on the craft's route. */
    hit(distance: number, routeId?: string | null) {
      let best = -1, nearest = 20;
      rings.forEach((ring, i) => {
        if (ring.routeId && ring.routeId !== routeId) return;
        const gap = Math.abs(((distance - ring.distance) % track.length + track.length * 1.5) % track.length - track.length / 2);
        if (gap < nearest) { nearest = gap; best = i; }
      });
      if (best >= 0) hits[best] = lastTime;
    },
    update(time: number, reducedMotion: boolean) {
      if (time < lastTime) hits.fill(-Infinity);
      lastTime = time; uniforms.time.value = reducedMotion ? 0 : time; uniforms.pulse.value = reducedMotion ? 0 : .5 + .5 * Math.sin(time * 4);
      hits.forEach((hit, i) => {
        const f = Math.exp(-(time - hit) * 6), s = reducedMotion ? 1 : 1 + .3 * f;
        flash.setX(i, f);
        scaled.copy(bases[i]).multiply(grow.makeScale(s, s, s)); meshes.forEach(mesh => mesh.setMatrixAt(i, scaled));
      });
      flash.needsUpdate = true; meshes.forEach(mesh => { mesh.instanceMatrix.needsUpdate = true; });
    },
    dispose() {
      object.removeFromParent(); meshes.forEach(mesh => mesh.dispose());
      parts.forEach(([geometry, material]) => { geometry.dispose(); material.dispose(); });
    },
  };
}
