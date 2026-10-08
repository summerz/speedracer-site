import * as THREE from 'three';
import { createTrackFrame, type Track } from './createTrack.js';

const BAND_LENGTH = 8, BAND_LEAD = 40, COLUMN_WIDTH = .5;

/** Several position/normal/uv geometries as one non-indexed geometry. */
export function merge(parts: THREE.BufferGeometry[]) {
  const geometry = new THREE.BufferGeometry();
  for (const [name, size] of [['position', 3], ['normal', 3], ['uv', 2]] as const) {
    geometry.setAttribute(name, new THREE.Float32BufferAttribute(parts.flatMap(g => [...g.getAttribute(name).array]), size));
  }
  parts.forEach(g => g.dispose());
  return geometry;
}

/**
 * Electric mine fields: every mine is a crisp magenta orb at the road and at the top of the flight range, joined by a
 * thin vertical lightning column (no altitude bypasses it) and a dark ground ring; each field starts 40 m after a magenta hatched warning band.
 * Unlit and over-bright for bloom. Instanced meshes with shared geometry and materials; local frame x = lateral, y = up, -z = forward.
 * `hit` flashes the mines near the craft; `update` flickers everything and is static under reduced motion.
 */
export function createMineFieldVisual(track: Track) {
  const fields = track.mineFields ?? [], object = new THREE.Group(); object.name = 'mine-fields';
  const sites = fields.flatMap(field => field.mines.map(mine => ({ field, mine }))), count = Math.max(1, sites.length);
  const top = track.altitudeProfile.levels.at(-1)! + 2.8, radius = fields[0]?.mines[0]?.radius ?? 1.5;
  const flash = new THREE.InstancedBufferAttribute(new Float32Array(count), 1), seed = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
  sites.forEach((_, i) => seed.setX(i, (i * 0.618034) % 1));
  const uniforms = { time: { value: 0 } };
  const common = `attribute float flash; attribute float seed; varying float f; varying float s; varying vec2 vUv; varying vec3 n;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}`;

  const orbGeometry = merge([new THREE.IcosahedronGeometry(radius, 2).translate(0, radius + .15, 0), new THREE.IcosahedronGeometry(radius, 2).translate(0, top, 0)]);
  orbGeometry.setAttribute('flash', flash); orbGeometry.setAttribute('seed', seed);
  const orbMaterial = new THREE.ShaderMaterial({ toneMapped: false, uniforms,
    vertexShader: `${common} void main(){f=flash;s=seed;n=normalize(mat3(instanceMatrix)*normal);gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}`,
    fragmentShader: `uniform float time; ${common.replace(/attribute[^;]*;/g, '')}
      void main(){
        float tick=floor(time*22.);
        float crackle=step(.72,hash(floor(n.xy*5.+n.z*3.)+s*31.+tick));
                vec3 col=vec3(1.1,.06,.5)*(.8+.2*hash(vec2(s*17.,tick)))+vec3(.2,.05,.15)*crackle+vec3(.5,.3,.45)*pow(abs(n.z),8.);
        col=mix(col,vec3(1.8,.7,1.4),f*.5);
        gl_FragColor=vec4(col,1.);
      }` });
  const orbs = new THREE.InstancedMesh(orbGeometry, orbMaterial, count);

  // Two crossed vertical strips; the shader draws a jagged bolt along each.
  const strip = (turn: number) => new THREE.PlaneGeometry(COLUMN_WIDTH * 2, top).translate(0, top / 2, 0).rotateY(turn);
  const columnGeometry = merge([strip(0), strip(Math.PI / 2)]);
  columnGeometry.setAttribute('flash', flash); columnGeometry.setAttribute('seed', seed);
  const columnMaterial = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false, uniforms,
    vertexShader: `${common} void main(){f=flash;s=seed;vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}`,
    fragmentShader: `uniform float time; ${common.replace(/attribute[^;]*;/g, '')}
      void main(){
        float tick=floor(time*18.), y=vUv.y*${(top / 1.6).toFixed(1)};
        float jag=(mix(hash(vec2(floor(y),tick+s*7.)),hash(vec2(floor(y)+1.,tick+s*7.)),fract(y))-.5)*.42;
        float d=abs(vUv.x-.5-jag);
        float bolt=exp(-d*d*2600.)*(.7+.6*hash(vec2(tick,s*13.)));
        gl_FragColor=vec4(vec3(1.5,.3,1.1)*bolt*(1.+f)+vec3(bolt*f),bolt*(.7+f*.3));
      }` });
  const columns = new THREE.InstancedMesh(columnGeometry, columnMaterial, count);

  // Warning band: thin magenta diagonal hatching across the whole road.
  const bandGeometry = new THREE.PlaneGeometry(track.halfWidth * 2, BAND_LENGTH).rotateX(-Math.PI / 2).translate(0, .18, 0);
  const bandMaterial = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, uniforms,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    vertexShader: `varying vec3 p; void main(){p=position;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}`,
    fragmentShader: `uniform float time; varying vec3 p;
      void main(){
        float stripe=step(.82,fract((p.x+p.z)*.25));
        vec3 col=vec3(1.4,.15,.8)*(.9+.1*sin(time*8.));
        gl_FragColor=vec4(col,.3*stripe);
      }` });
  const bands = new THREE.InstancedMesh(bandGeometry, bandMaterial, Math.max(1, fields.length));
  // Ground ring: dark disc with a thin magenta rim marking each mine's footprint on the road.
  const ringGeometry = new THREE.CircleGeometry(radius * 2, 32).rotateX(-Math.PI / 2).translate(0, .15, 0);
  const ringMaterial = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    vertexShader: `varying vec3 p; void main(){p=position;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}`,
    fragmentShader: `varying vec3 p;
      void main(){
        float r=length(p.xz)/${(radius * 2).toFixed(2)}, rim=smoothstep(.86,.93,r)*(1.-smoothstep(.97,1.,r));
        gl_FragColor=vec4(mix(vec3(.02,0.,.03),vec3(1.3,.15,.8),rim),.55+.4*rim);
      }` });
  const rings = new THREE.InstancedMesh(ringGeometry, ringMaterial, count);
  for (const mesh of [orbs, columns, bands, rings]) { mesh.frustumCulled = false; object.add(mesh); }
  orbs.count = columns.count = rings.count = sites.length; bands.count = fields.length;

  const frame = createTrackFrame(), z = new THREE.Vector3(), basis = new THREE.Matrix4();
  const place = (distance: number, routeId: string | undefined, lateral: number) => {
    track.sample(distance, frame, routeId); z.crossVectors(frame.right, frame.up);
    return basis.makeBasis(frame.right, frame.up, z).setPosition(frame.position.clone().addScaledVector(frame.right, lateral)).clone();
  };
  sites.forEach(({ field, mine }, i) => { const m = place(field.distance + mine.at, field.routeId, mine.offset); orbs.setMatrixAt(i, m); columns.setMatrixAt(i, m); rings.setMatrixAt(i, m); });
  fields.forEach((field, i) => bands.setMatrixAt(i, place(field.distance + field.mines[0].at - BAND_LEAD, field.routeId, 0)));

  const hits = sites.map(() => -Infinity);
  let lastTime = 0;
  return {
    object,
    /** Flashes the mines within 8 m of `distance` on the craft's route. */
    hit(distance: number, routeId?: string | null) {
      sites.forEach(({ field, mine }, i) => {
        if (field.routeId && field.routeId !== routeId) return;
        const gap = ((distance - field.distance - mine.at) % track.length + track.length * 1.5) % track.length - track.length / 2;
        if (Math.abs(gap) < 8) hits[i] = lastTime;
      });
    },
    update(time: number, reducedMotion: boolean) {
      if (time < lastTime) hits.fill(-Infinity);
      lastTime = time; uniforms.time.value = reducedMotion ? 0 : time;
      hits.forEach((hit, i) => flash.setX(i, Math.exp(-(time - hit) * 6)));
      flash.needsUpdate = true;
    },
    dispose() {
      object.removeFromParent(); orbs.dispose(); columns.dispose(); bands.dispose(); rings.dispose();
      orbGeometry.dispose(); columnGeometry.dispose(); bandGeometry.dispose(); ringGeometry.dispose();
      orbMaterial.dispose(); columnMaterial.dispose(); bandMaterial.dispose(); ringMaterial.dispose();
    },
  };
}
