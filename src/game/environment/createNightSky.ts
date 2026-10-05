import * as THREE from 'three';
import type { NightEnvironment } from './raceEnvironment';

/** Camera-relative geometry, world-fixed directions: track rolls also roll the horizon. */
export function createNightSky(environment: NightEnvironment, forward: THREE.Vector3) {
  const object = new THREE.Group(); object.name = `sky-${environment.id}`;
  object.userData.environment = environment.id;
  const skyMaterial = new THREE.ShaderMaterial({
    uniforms: { zenith: { value: new THREE.Color(environment.zenith) }, horizon: { value: new THREE.Color(environment.horizon) }, starStrength: { value: environment.stars } },
    vertexShader: 'varying vec3 direction; void main(){ direction=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `varying vec3 direction; uniform vec3 zenith; uniform vec3 horizon; uniform float starStrength;
      float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
      void main(){vec3 d=normalize(direction); float altitude=max(d.y,0.);
        vec3 color=mix(horizon,zenith,smoothstep(0.,.42,altitude));
        vec3 cell=floor(d*440.); vec3 local=fract(d*440.)-.5;
        float star=step(.9975,hash(cell))*pow(max(0.,1.-length(local)*2.),4.);
        color+=vec3(.8,.88,1.)*star*starStrength*smoothstep(.04,.3,altitude);
        gl_FragColor=vec4(color*.65,1.); }`,
    side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1100, 32, 16), skyMaterial); sky.renderOrder = -100;
  object.add(sky);
  const direction = new THREE.Vector3(forward.x, 0, forward.z).normalize();
  if (direction.lengthSq() < .1) direction.set(0, 0, -1);
  direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), -.28);
  direction.y = .42; direction.normalize();
  const planetMaterial = new THREE.ShaderMaterial({
    uniforms: { tint: { value: new THREE.Color(environment.celestialColor) }, crescent: { value: environment.celestial === 'crescent' ? 1 : 0 } },
    vertexShader: 'varying vec3 normalOut; void main(){normalOut=normal; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `varying vec3 normalOut; uniform vec3 tint; uniform float crescent;
      void main(){vec3 n=normalize(normalOut); vec3 sun=mix(vec3(-.5,.55,.7),vec3(.93,.1,-.4),crescent);
        float light=max(0.,dot(n,normalize(sun)));
        float terrain=.9+.1*sin(n.x*29.+sin(n.y*43.))*sin(n.z*37.);
        float bands=.9+.1*sin(n.y*48.+n.x*4.);
        gl_FragColor=vec4(tint*(.055+light*.72)*terrain*bands,1.); }`,
    fog: false, toneMapped: false,
  });
  const radius = environment.celestial === 'satellite' ? 60 : environment.celestial === 'ringed-planet' ? 86 : 105;
  const planet = new THREE.Mesh(new THREE.SphereGeometry(radius, 40, 24), planetMaterial);
  planet.position.copy(direction).multiplyScalar(750); planet.name = environment.celestial;
  // Face the observer so shading and crescent phase are independent of course bearing.
  planet.lookAt(0, 0, 0); object.add(planet);
  if (environment.celestial === 'ringed-planet') {
    const material = new THREE.MeshBasicMaterial({ color: '#8a6aa5', side: THREE.DoubleSide, transparent: true, opacity: .52, depthWrite: false, fog: false, toneMapped: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 1.35, radius * 2.15, 64), material);
    ring.position.copy(planet.position); ring.lookAt(0, 0, 0); ring.rotateX(.95); ring.rotateZ(.38); ring.name = 'planet-rings'; object.add(ring);
  }
  return {
    object,
    update(cameraPosition: THREE.Vector3) { object.position.copy(cameraPosition); },
    setOverview(value: boolean) { object.visible = !value; },
  };
}
