import * as THREE from 'three';
import type { MarinePalette, MarineZoneId } from '../environment/marineZones.js';
import type { RenderQuality } from '../../platform/renderQuality.js';
import type { Track } from './createTrack.js';
import { GiantBuilder, buildGalleon, buildLiner, buildOctopus, buildTurtle } from './marineGiantModels.js';

export interface MarineGiantBackdrop { fog: string; horizon: string }

const VERT = `
attribute vec3 aColor; attribute vec4 aMeta; attribute vec3 aLocal;
uniform float uTime, uDetail;
varying vec3 vColor, vWorld, vN, vLocal; varying vec4 vMeta;
void main(){
  vec3 p=position; float sw=aMeta.y;
  if(sw>0.){ float t=uTime*.8+aMeta.z; p.x+=sin(t+p.y*.03)*sw; p.z+=cos(t*.83+p.x*.03)*sw*.7; }
  vec4 w=modelMatrix*vec4(p,1.);
  vWorld=w.xyz; vN=mat3(modelMatrix)*normal; vColor=aColor; vMeta=aMeta; vLocal=aLocal;
  gl_Position=projectionMatrix*viewMatrix*w;
  if(aMeta.w>.5&&uDetail<.5) gl_Position=vec4(2.,2.,2.,1.);
}`;
const FRAG = `
uniform vec3 uFog, uGlow, uAccent; uniform float uTime, uVis, uBaseY, uHaze, uFogK, uSun, uEmit, uEye, uTone;
varying vec3 vColor, vWorld, vN, vLocal; varying vec4 vMeta;
void main(){
  vec3 dv=cameraPosition-vWorld; float dist=length(dv), nl=dot(vN,vN);
  vec3 V=dist>1e-4?dv/dist:vec3(0.,1.,0.), N=nl>1e-8?vN*inversesqrt(nl):vec3(0.,1.,0.); if(!gl_FrontFacing) N=-N;
  float diff=clamp(dot(N,normalize(vec3(.25,.9,.35)))*.5+.5,0.,1.);
  float fres=pow(1.-clamp(abs(dot(N,V)),0.,1.),2.2);
  float low=1.-smoothstep(0.,uHaze,vWorld.y-uBaseY);
  float vis=uVis*(1.-.82*low)*exp(-min(pow(dist*uFogK,2.),8.));
  vec3 albedo=vColor, emissive=vec3(0.); float kind=vMeta.x;
  if(kind>.5&&kind<1.5){
    float pulse=.78+.22*sin(uTime*.9+vMeta.z*6.2831);
    emissive=vColor*pulse*uEmit; albedo*=.15;
  } else if(kind>1.5){
    vec3 u=vLocal+vec3(0.,0.,1e-4); u/=max(length(u),1e-4); float o=uEye;
    float h=mix(.05,.82,o), open=smoothstep(h+.05,h-.03,abs(u.y))*smoothstep(.1,.4,u.z);
    float iris=1.-smoothstep(.5,.95,length(u.xy*vec2(1.,1.1)));
    float pupil=1.-smoothstep(.7,1.,length(vec2(u.x/.5,u.y/(.1+.14*o))));
    emissive=mix(vec3(.01),uGlow*.55+uAccent*.3,iris*(1.-pupil))*open*(.2+.8*o);
    albedo*=1.-open;
  }
  vec3 lit=albedo*uTone*(.3+.9*diff*uSun);
  vec3 col=mix(uFog,lit,vis)+uGlow*fres*vis*.4+emissive*(.6+.4*vis);
  gl_FragColor=vec4(max(col,vec3(0.)),1.);
}`;
const BEAM_VERT = `varying vec3 vN, vWorld; varying float vT; void main(){ vec4 w=modelMatrix*vec4(position,1.); vWorld=w.xyz; vN=normalize(mat3(modelMatrix)*normal); vT=clamp(position.z/${520..toFixed(1)},0.,1.); gl_Position=projectionMatrix*viewMatrix*w; }`;
const BEAM_FRAG = `uniform vec3 uColor; uniform float uAlpha; varying vec3 vN, vWorld; varying float vT;
void main(){
  vec3 d=cameraPosition-vWorld; float dl=dot(d,d), nl=dot(vN,vN);
  vec3 V=dl>1e-6?d*inversesqrt(dl):vec3(0.,1.,0.), n=nl>1e-6?vN*inversesqrt(nl):vec3(0.,1.,0.);
  float f=pow(clamp(abs(dot(n,V)),1e-4,1.),1.6), t=clamp(vT,0.,1.);
  float a=clamp(uAlpha*f*pow(max(1.-t,1e-4),1.3)*smoothstep(0.,.05,t),0.,1.);
  gl_FragColor=vec4(uColor*a,a);
}`;

const smoothstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** One slow blink per 13 s; time 0 (reduced motion) rests with the eye open. */
export const eyeOpenAt = (time: number) => { const p = (((time + 7) % 13) + 13) % 13 / 13; return .9 * Math.min(smoothstep(.12, .3, p), 1 - smoothstep(.7, .88, p)); };

/** Picks a spot 1700-2000 m from the lap's centre, outside the route, where the most route samples look toward it. */
export function placeMarineGiant(track: Track) {
  const N = 96, pts: THREE.Vector3[] = [], tans: THREE.Vector3[] = [];
  for (let i = 0; i < N; i++) { const f = track.sample(track.length * i / N); pts.push(f.position.clone()); tans.push(new THREE.Vector3(f.tangent.x, 0, f.tangent.z).normalize()); }
  const c = pts.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / N); c.y = 0;
  const radius = Math.max(...pts.map(p => Math.hypot(p.x - c.x, p.z - c.z))), dist = Math.min(2000, Math.max(1700, radius + 900));
  const start = Math.atan2(tans[0].x, tans[0].z);
  let best = { score: -1, bearing: 0, position: new THREE.Vector3() };
  for (let k = 0; k < 48; k++) {
    const bearing = k / 48 * Math.PI * 2, position = new THREE.Vector3(c.x + Math.sin(bearing) * dist, 0, c.z + Math.cos(bearing) * dist);
    let score = 0;
    for (let i = 0; i < N; i++) {
      const to = new THREE.Vector3(position.x - pts[i].x, 0, position.z - pts[i].z).normalize(), cos = to.dot(tans[i]);
      score += (cos > .72 ? 1 : 0) + (cos > .93 ? .5 : 0) + (i < 6 && cos > .6 ? 3 : 0);
    }
    const diff = Math.abs(Math.atan2(Math.sin(bearing - start), Math.cos(bearing - start)));
    score -= diff * .4;
    if (score > best.score) best = { score, bearing, position };
  }
  return { position: best.position, center: c, distance: dist, visibleFraction: best.score };
}

const TUNING: Record<MarineZoneId, { vis: number; sun: number; emit: number; yaw: number; scale: number; tone: number }> = {
  trench: { vis: .62, sun: 1, emit: 1.1, yaw: .5, scale: 1.5, tone: 2.6 },
  kelp: { vis: .62, sun: 1.1, emit: .9, yaw: 1.2, scale: 1.25, tone: 2.2 },
  coral: { vis: .62, sun: 1.1, emit: 1, yaw: .8, scale: 1.5, tone: 1.8 },
  lagoon: { vis: .55, sun: 1.3, emit: .9, yaw: -1.15, scale: 1.3, tone: .9 },
};

export function createMarineGiant(zone: MarineZoneId, track: Track, palette: MarinePalette, backdrop: MarineGiantBackdrop) {
  const tune = TUNING[zone], spot = placeMarineGiant(track);
  const object = new THREE.Group(); object.name = `marine-giant-${zone}`;
  let quality: RenderQuality = 'balanced', built: THREE.Mesh | undefined, lamp: THREE.Vector3 | undefined;
  const fog = new THREE.Color(backdrop.fog).lerp(new THREE.Color(backdrop.horizon), .3);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uDetail: { value: 1 }, uFog: { value: fog }, uGlow: { value: new THREE.Color(palette.glow) }, uAccent: { value: new THREE.Color(palette.accent) },
      uVis: { value: tune.vis }, uBaseY: { value: 20 }, uHaze: { value: 260 }, uFogK: { value: .0003 }, uSun: { value: tune.sun }, uEmit: { value: tune.emit }, uEye: { value: .9 }, uTone: { value: tune.tone },
    },
    vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide, fog: false,
  });
  const beamMaterial = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(palette.glow) }, uAlpha: { value: .42 } }, vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  });
  let beam: THREE.Mesh | undefined, geometry: THREE.BufferGeometry | undefined;
  const mount = new THREE.Group(); object.add(mount);
  const rebuild = () => {
    const low = quality === 'low', b = new GiantBuilder();
    if (built) { mount.remove(built); geometry?.dispose(); }
    if (zone === 'trench') buildOctopus(b, palette, low); else if (zone === 'kelp') buildGalleon(b, palette, low); else if (zone === 'coral') buildTurtle(b, palette, low); else lamp = buildLiner(b, palette, low).lamp;
    geometry = b.build();
    built = new THREE.Mesh(geometry, material); built.name = `${zone}-giant-body`; built.frustumCulled = false; mount.add(built);
    if (zone === "lagoon" && lamp && !beam) {
      const cone = new THREE.ConeGeometry(70, 520, 20, 1, true); cone.translate(0, -260, 0); cone.rotateX(-Math.PI / 2); cone.rotateX(.06);
      const back = cone.clone().rotateY(Math.PI), merged = new THREE.BufferGeometry();
      const pos = new Float32Array([...cone.attributes.position.array, ...back.attributes.position.array]), nor = new Float32Array([...cone.attributes.normal.array, ...back.attributes.normal.array]);
      const off = cone.attributes.position.count; merged.setAttribute('position', new THREE.BufferAttribute(pos, 3)); merged.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      merged.setIndex([...Array.from(cone.index!.array), ...Array.from(back.index!.array, i => i + off)]);
      beam = new THREE.Mesh(merged, beamMaterial); beam.name = 'lighthouse-beam'; beam.position.copy(lamp); beam.frustumCulled = false; beam.renderOrder = 2; mount.add(beam);
    }
  };
  rebuild();
  // Face the lap's centre at a three-quarter angle and push the base under the horizon.
  const yaw = Math.atan2(spot.center.x - spot.position.x, spot.center.z - spot.position.z) + tune.yaw;
  mount.scale.setScalar(tune.scale);
  object.position.set(spot.position.x, 20, spot.position.z); object.rotation.y = yaw;
  return {
    object, placement: spot,
    update(cameraPosition: THREE.Vector3, time = 0) {
      void cameraPosition; material.uniforms.uTime.value = time;
      if (zone === 'trench') material.uniforms.uEye.value = eyeOpenAt(time);
      if (beam) beam.rotation.y = time * .38 + 1.2;
    },
    setQuality(value: RenderQuality) { if (value === quality) return; const wasLow = quality === 'low'; quality = value; material.uniforms.uDetail.value = value === 'low' ? 0 : 1; if (wasLow !== (value === 'low')) rebuild(); },
    setOverview(value: boolean) { object.visible = !value; },
    dispose() { geometry?.dispose(); material.dispose(); beamMaterial.dispose(); beam?.geometry.dispose(); },
  };
}
