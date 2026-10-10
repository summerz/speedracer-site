import * as THREE from 'three';
import type { RaceEnvironment } from './raceEnvironment';

/** Celestial bodies are angular sky features: no nearby sphere, translation parallax or extra draw. */
/** `shimmer` (CSS color) tints the underwater surface caustics. */
export function createNightSky(environment: RaceEnvironment, forward: THREE.Vector3, shimmer = '#8cf2e6') {
  const shimmerRgb = { r: 0, g: 0, b: 0 }; new THREE.Color(shimmer).getRGB(shimmerRgb, THREE.SRGBColorSpace);
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
      storm: { value: environment.rain ? 1 : 0 }, flash: { value: 0 },
      zenith: { value: new THREE.Color(environment.zenith) }, horizon: { value: new THREE.Color(environment.horizon) },
      starStrength: { value: environment.stars }, tint: { value: new THREE.Color(environment.celestialColor) },
      center: { value: center }, celestialRight: { value: right }, celestialUp: { value: up },
      diskRadius: { value: Math.tan(environment.celestialRadius) },
      ringed: { value: environment.celestial === 'ringed-planet' ? 1 : 0 },
      crescent: { value: environment.celestial === 'crescent' ? 1 : 0 },
      uTime: { value: 0 }, underwater: { value: environment.underwater ? 1 : 0 }, shimmer: { value: new THREE.Vector3(shimmerRgb.r, shimmerRgb.g, shimmerRgb.b) },
    },
    vertexShader: 'varying vec3 direction; void main(){ direction=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `
      varying vec3 direction;
      uniform float storm, flash;
      uniform vec3 zenith, horizon, tint, center, celestialRight, celestialUp;
      uniform float starStrength, diskRadius, ringed, crescent, uTime, underwater; uniform vec3 shimmer;
      float hash(vec3 p){p=fract(p*.1031); p+=dot(p,p.yzx+33.33); return fract((p.x+p.y)*p.z);}
      float noise(vec3 p){
        vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
          mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
      }
      // Pixel-width transitions keep graphic shapes crisp without jagged moving edges.
      float edge(float threshold,float value){
        float width=max(fwidth(value),.0001);
        return smoothstep(threshold-width,threshold+width,value);
      }
      float terrain(vec3 p){return noise(p)*.72+noise(p*2.03)*.28;}
      void main(){
        vec3 d=normalize(direction);
        float altitude=max(d.y,0.);
        vec3 sky=mix(horizon,zenith,smoothstep(0.,.48,altitude))*.65;
        vec3 color=sky;
        float bearing=dot(d,center);
        vec2 uv=vec2(dot(d,celestialRight),dot(d,celestialUp))/(max(bearing,.001)*diskRadius);
        float r=length(uv);
        // A clear silhouette and a thin atmospheric rim match the city's sharp lines.
        float silhouette=(1.-edge(1.,r))*step(0.,bearing);
        float disk=silhouette;
        float atmosphere=exp(-abs(r-1.)*180.)*step(0.,bearing);
        color+=mix(tint,horizon,.25)*atmosphere*.075;
        float ringMask=0.;
        vec3 ringColor=vec3(0.);
        if(ringed>.5 && bearing>0.){
          vec2 tilted=mat2(.94,-.342,.342,.94)*uv;
          float rr=length(vec2(tilted.x,tilted.y/.32));
          ringMask=edge(1.16,rr)*(1.-edge(1.92,rr));
          // The upper arc passes behind the planet, the lower arc passes in front.
          ringMask*=mix(1.-silhouette,1.,step(tilted.y,0.));
          float stripe=sin((rr-1.16)*92.);
          float bands=mix(.25,.72,edge(-.1,stripe));
          // A pair of dark divisions break up the concentric, sharply separated ring bands.
          bands*=1.-.8*edge(1.48,rr)*(1.-edge(1.51,rr));
          bands*=1.-.8*edge(1.73,rr)*(1.-edge(1.77,rr));
          ringColor=mix(tint,vec3(.72,.66,.55),.48)*bands*.45;
        }
        if(r<1.008 && bearing>0.){
          vec3 n=normalize(vec3(uv,sqrt(max(0.,1.-r*r))));
          vec3 sun=normalize(mix(vec3(-.62,.52,.65),vec3(.94,.16,-.26),crescent));
          float sunward=dot(n,sun);
          // Three broad lighting tones retain volume without a soft photographic gradient.
          float light=.055+.34*smoothstep(-.035,.005,sunward)+.43*smoothstep(.42,.46,sunward);
          float surface;
          if(ringed>.5){
            float stripe=sin(n.y*30.+(terrain(n*4.)-.5)*1.5);
            surface=.34+.22*edge(-.3,stripe)+.25*edge(.5,stripe);
          }else{
            float relief=terrain(n*4.);
            surface=.36+.22*edge(.43,relief)+.22*edge(.59,relief);
            // Large basins and narrow rims read as terrain rather than blurred clouds.
            for(int i=0;i<4;i++){
              vec2 c=vec2(-.42+float(i)*.29,.38+.17*sin(float(i)*2.4));
              float crater=length(uv-c)/(.085+float(i)*.018);
              float basin=1.-edge(.87,crater);
              float rim=edge(.87,crater)*(1.-edge(1.,crater));
              surface=mix(surface,surface*.48,basin);
              surface+=.16*rim;
            }
          }
          vec3 surfaceColor=tint*surface*light;
          surfaceColor+=sky*.35*(1.-smoothstep(-.035,.005,sunward));
          color=mix(color,surfaceColor,disk);
        }
        color=mix(color,ringColor,ringMask*.75);
        vec3 cell=floor(d*440.), local=fract(d*440.)-.5;
        float star=step(.9975,hash(cell))*pow(max(0.,1.-length(local)*2.),4.);
        color+=vec3(.8,.88,1.)*star*starStrength*smoothstep(.04,.3,altitude)*(1.-disk)*(1.-ringMask);
        // Tint a narrow horizon band without deleting the lower hemisphere.
        // Actual ground/buildings occlude the complete body as the camera moves.
        float horizonHaze=.18*exp(-pow(d.y/.055,2.));
        color=mix(color,horizon*.65,horizonHaze);
        float clouds=smoothstep(.2,.65,noise(d*5.+vec3(0.,2.,0.)));
        color=mix(color, mix(zenith,horizon,clouds)*.7, storm*(.78+clouds*.2));
        if(underwater>.5){
          // Water surface seen from below: project the view ray onto a plane and layer moving ripple lines.
          vec3 w=vec3(0.);
          if(d.y>.02){
            vec2 q=d.xz/(d.y+.12)*1.6;
            float a=sin(q.x*3.1+uTime*.45+sin(q.y*2.3+uTime*.3)*1.6);
            float b=sin(q.y*3.7-uTime*.38+sin(q.x*2.9-uTime*.27)*1.4);
            float c=sin((q.x+q.y)*5.3+uTime*.6);
            float caustic=pow(1.-abs(a*b),5.)*.75+pow(1.-abs(c*a),7.)*.5;
            float up=smoothstep(.04,.75,d.y);
            w=mix(zenith,shimmer,.3)*caustic*up*.7+zenith*up*.3;
          }
          color=sky*.8+w;
          color=mix(color,horizon*.7,horizonHaze);
        }
        color+=vec3(.55,.68,.85)*flash;
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
    update(cameraPosition: THREE.Vector3, time = 0) { object.position.copy(cameraPosition); material.uniforms.uTime.value = time; },
    setLightning(value: number) { material.uniforms.flash.value = value; },
    setOverview(value: boolean) { object.visible = !value; },
  };
}
