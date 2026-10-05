import * as THREE from 'three';
import type { NightEnvironment } from './raceEnvironment';

/** Celestial bodies are angular sky features: no nearby sphere, translation parallax or extra draw. */
export function createNightSky(environment: NightEnvironment, forward: THREE.Vector3) {
  const object = new THREE.Group(); object.name = `sky-${environment.id}`;
  object.userData.environment = environment.id;
  const center = new THREE.Vector3(forward.x, 0, forward.z).normalize();
  if (center.lengthSq() < .1) center.set(0, 0, -1);
  center.applyAxisAngle(new THREE.Vector3(0, 1, 0), -.18);
  center.multiplyScalar(Math.cos(environment.celestialElevation));
  center.y = Math.sin(environment.celestialElevation);
  const right = new THREE.Vector3().crossVectors(center, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, center).normalize();
  const material = new THREE.ShaderMaterial({
    uniforms: {
      zenith: { value: new THREE.Color(environment.zenith) }, horizon: { value: new THREE.Color(environment.horizon) },
      starStrength: { value: environment.stars }, tint: { value: new THREE.Color(environment.celestialColor) },
      center: { value: center }, celestialRight: { value: right }, celestialUp: { value: up },
      diskRadius: { value: Math.tan(environment.celestialRadius) },
      ringed: { value: environment.celestial === 'ringed-planet' ? 1 : 0 },
      crescent: { value: environment.celestial === 'crescent' ? 1 : 0 },
    },
    vertexShader: 'varying vec3 direction; void main(){ direction=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `
      varying vec3 direction;
      uniform vec3 zenith, horizon, tint, center, celestialRight, celestialUp;
      uniform float starStrength, diskRadius, ringed, crescent;
      float hash(vec3 p){p=fract(p*.1031); p+=dot(p,p.yzx+33.33); return fract((p.x+p.y)*p.z);}
      float noise(vec3 p){
        vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
          mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
      }
      float terrain(vec3 p){return noise(p)*.55+noise(p*2.03)*.28+noise(p*4.11)*.17;}
      void main(){
        vec3 d=normalize(direction);
        float altitude=max(d.y,0.);
        vec3 sky=mix(horizon,zenith,smoothstep(0.,.48,altitude))*.65;
        vec3 color=sky;
        float bearing=dot(d,center);
        vec2 uv=vec2(dot(d,celestialRight),dot(d,celestialUp))/(max(bearing,.001)*diskRadius);
        float r=length(uv);
        // A broad, faint atmosphere merges the limb into the night instead of outlining a prop.
        float haze=smoothstep(-.04,.22,d.y)*step(0.,bearing);
        float disk=(1.-smoothstep(.987,1.008,r))*haze;
        float atmosphere=exp(-abs(r-1.)*19.)*haze;
        color+=mix(tint,horizon,.45)*atmosphere*.13;
        float ringMask=0.;
        vec3 ringColor=vec3(0.);
        if(ringed>.5 && bearing>0.){
          vec2 tilted=mat2(.94,-.342,.342,.94)*uv;
          float rr=length(vec2(tilted.x,tilted.y/.32));
          ringMask=smoothstep(1.13,1.2,rr)*(1.-smoothstep(1.84,1.95,rr))*haze;
          // The upper arc passes behind the planet, the lower arc passes in front.
          ringMask*=mix(1.-disk,1.,step(tilted.y,0.));
          float bands=.66+.14*sin(rr*135.)+.1*sin(rr*49.);
          ringColor=mix(tint,vec3(.72,.66,.55),.48)*bands*.35;
        }
        if(r<1.008 && bearing>0.){
          vec3 n=normalize(vec3(uv,sqrt(max(0.,1.-r*r))));
          vec3 sun=normalize(mix(vec3(-.62,.52,.65),vec3(.94,.16,-.26),crescent));
          float light=smoothstep(-.10,.75,dot(n,sun));
          float surface;
          if(ringed>.5){
            float turbulence=terrain(n*8.);
            surface=.52+.26*sin(n.y*47.+turbulence*5.)+.18*turbulence;
          }else{
            float maria=smoothstep(.33,.7,terrain(n*5.));
            float fine=noise(n*42.);
            surface=.35+.48*maria+.16*fine;
            // Irregular circular basins and rims, softened by surface relief.
            for(int i=0;i<3;i++){
              vec2 c=vec2(-.32+float(i)*.34,.30-float(i)*.29);
              float crater=length(uv-c)/(.09+float(i)*.025);
              surface-=.14*(1.-smoothstep(.4,1.,crater));
              surface+=.10*exp(-pow((crater-1.)*9.,2.));
            }
          }
          vec3 surfaceColor=tint*surface*(.035+light*.83);
          // The night side shares the sky color; low altitude is veiled by distant atmosphere.
          surfaceColor=mix(sky*.8,surfaceColor,smoothstep(.01,.20,light));
          surfaceColor+=tint*pow(1.-max(n.z,0.),3.)*.035;
          color=mix(color,surfaceColor,disk);
        }
        color=mix(color,ringColor,ringMask*.75);
        vec3 cell=floor(d*440.), local=fract(d*440.)-.5;
        float star=step(.9975,hash(cell))*pow(max(0.,1.-length(local)*2.),4.);
        color+=vec3(.8,.88,1.)*star*starStrength*smoothstep(.04,.3,altitude)*(1.-disk)*(1.-ringMask);
        // Opaque lower sky and a wide horizon veil bury the lower half behind the distant city.
        color=mix(horizon*.65,color,smoothstep(-.035,.12,d.y));
        gl_FragColor=vec4(color,1.);
      }`,
    side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1100, 32, 16), material);
  sky.name = 'celestial-sky'; sky.renderOrder = -100;
  sky.userData.celestial = environment.celestial;
  object.add(sky);
  return {
    object,
    update(cameraPosition: THREE.Vector3) { object.position.copy(cameraPosition); },
    setOverview(value: boolean) { object.visible = !value; },
  };
}
