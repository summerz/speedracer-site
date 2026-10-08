import * as THREE from 'three';
import { createTrackFrame, type Track } from './createTrack.js';

const STEP = 3, WALL_HEIGHT = 1.8, FADE_NEAR = 2, FADE_FAR = 6;

/**
 * Arc rails: for every segment an electric lime rail strip along the road edge of the danger half, a faint lime tint with sparse thin flickering arcs across
 * that half (shader on a flat strip over the road) and a low, mostly transparent lime curtain on the road's centre line that fades out near the
 * camera. Only the rail line is over-bright for bloom; geometry follows the road frame (loops and helices) sample by sample.
 * One merged geometry and material per part. `hit` flashes the segments near the craft; `update` flickers and is steady under reduced motion.
 */
export function createArcRailVisual(track: Track) {
  const sites = (track.arcRails ?? []).flatMap(rail => rail.segments.map(segment => ({ rail, segment }))), object = new THREE.Group(); object.name = 'arc-rails';
  const top = WALL_HEIGHT, frame = createTrackFrame();
  const parts = ['strip', 'floor', 'wall'] as const, data = parts.map(() => ({ position: [] as number[], uv: [] as number[], seed: [] as number[], index: [] as number[], seg: [] as number[] }));
  const ribbon = (part: number, i: number, from: number, length: number, routeId: string | undefined, side: number, a: [number, number], b: [number, number]) => {
    const d = data[part], first = d.position.length / 3, count = Math.ceil(length / STEP);
    for (let k = 0; k <= count; k++) {
      const along = k / count * length;
      track.sample(from + along, frame, routeId);
      for (const [u, [lat, lift]] of [[0, a], [1, b]] as const) {
        d.position.push(frame.position.x + frame.right.x * lat * side + frame.up.x * lift, frame.position.y + frame.right.y * lat * side + frame.up.y * lift,
          frame.position.z + frame.right.z * lat * side + frame.up.z * lift);
        d.uv.push(u, along); d.seed.push((i * .618034) % 1); d.seg.push(i);
      }
      if (k < count) { const n = first + k * 2; d.index.push(n, n + 2, n + 1, n + 1, n + 2, n + 3); }
    }
  };
  sites.forEach(({ rail, segment }, i) => {
    const from = rail.distance + segment.at, h = track.halfWidth;
    ribbon(0, i, from, segment.length, rail.routeId, segment.side, [h - 1, .32], [h - .1, .32]);
    ribbon(1, i, from, segment.length, rail.routeId, segment.side, [0, .22], [h - 1, .22]);
    ribbon(2, i, from, segment.length, rail.routeId, segment.side, [0, .1], [0, top]);
  });
  const geometries = data.map(d => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(d.position, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(d.uv, 2));
    geometry.setAttribute('seed', new THREE.Float32BufferAttribute(d.seed, 1)); geometry.setAttribute('flash', new THREE.Float32BufferAttribute(new Float32Array(d.seed.length), 1));
    geometry.setIndex(d.index);
    return geometry;
  });
  const uniforms = { time: { value: 0 }, amp: { value: 1 } };
  const common = `attribute float flash; attribute float seed; varying float f; varying float s; varying vec2 vUv; varying vec3 wp;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}`;
  const frag = (body: string) => `uniform float time; uniform float amp; ${common.replace(/attribute[^;]*;/g, '')}
    void main(){ float tick=floor(time*26.); float flick=1.+amp*(hash(vec2(tick,s*9.))-.5)*.5; ${body} }`;
  const make = (body: string, extra: Partial<THREE.ShaderMaterialParameters> = {}) => new THREE.ShaderMaterial({ toneMapped: false, uniforms, side: THREE.DoubleSide,
    vertexShader: `${common} void main(){f=flash;s=seed;vUv=uv;wp=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`, fragmentShader: frag(body), ...extra });
  const glow = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
  const materials = [
    // Rail strip: bright lime core with travelling dashes.
    make(`float core=1.-smoothstep(.2,1.,abs(vUv.x-.5)*2.); float dash=.7+.3*step(.5,fract(vUv.y/2.5-time*amp*1.5));
      vec3 col=vec3(.5,1.25,.1)*(.6+.8*core)*dash*flick; col=mix(col,vec3(1.1,1.7,.5),f*.35); gl_FragColor=vec4(col,1.);`,
      { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    // Floor: faint lime tint plus sparse thin bolts across the half, one cell every 14 m, redrawn 26 times a second.
    make(`float cell=floor(vUv.y/14.); float on=step(.55,hash(vec2(cell,tick+s*5.)));
      float jag=(mix(hash(vec2(floor(vUv.x*12.),cell+tick)),hash(vec2(floor(vUv.x*12.)+1.,cell+tick)),fract(vUv.x*12.))-.5)*1.6;
      float centre=(cell+.5+(hash(vec2(cell,s))-.5)*.5)*14.+jag; float dv=abs(vUv.y-centre);
      float bolt=exp(-dv*dv*40.)*on*amp;
      vec3 col=vec3(.4,1.,.12)*(bolt*1.2+.5)*flick; col+=vec3(bolt*f*2.); gl_FragColor=vec4(col,clamp(.12+bolt*.8,0.,1.));`, glow),
    // Wall: low, mostly transparent curtain with sparse streaks; fades out within a few metres of the camera.
    make(`float c=floor(vUv.y/3.); float jag=(hash(vec2(floor(vUv.x*8.),c+tick))-.5)*.3;
      float streak=exp(-pow(fract(vUv.y/3.)-.5-jag,2.)*140.)*step(.7,hash(vec2(c,tick+s*3.)));
      float fade=smoothstep(${FADE_NEAR.toFixed(1)},${FADE_FAR.toFixed(1)},distance(wp,cameraPosition));
      vec3 col=vec3(.4,.9,.1)*(.5+streak)*flick*(1.+f); gl_FragColor=vec4(col,(.04+streak*.2)*(1.+f)*fade);`, glow),
  ];
  const meshes = geometries.map((g, i) => { const mesh = new THREE.Mesh(g, materials[i]); mesh.frustumCulled = false; object.add(mesh); return mesh; });

  const hits = sites.map(() => -Infinity);
  let lastTime = 0;
  return {
    object,
    /** Flashes the segments under the craft (within 6 m of `distance`) on its route. */
    hit(distance: number, routeId?: string | null) {
      sites.forEach(({ rail, segment }, i) => {
        if (rail.routeId && rail.routeId !== routeId) return;
        const start = rail.distance + segment.at, gap = ((distance - start) % track.length + track.length * 1.5) % track.length - track.length / 2;
        if (gap > -6 && gap < segment.length + 6) hits[i] = lastTime;
      });
    },
    update(time: number, reducedMotion: boolean) {
      if (time < lastTime) hits.fill(-Infinity);
      lastTime = time; uniforms.time.value = reducedMotion ? 0 : time; uniforms.amp.value = reducedMotion ? 0 : 1;
      geometries.forEach((g, part) => {
        const flash = g.getAttribute('flash') as THREE.BufferAttribute, seg = data[part].seg;
        for (let v = 0; v < seg.length; v++) flash.setX(v, Math.exp(-(time - hits[seg[v]]) * 6));
        flash.needsUpdate = true;
      });
    },
    dispose() {
      object.removeFromParent(); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); meshes.length = 0;
    },
  };
}
