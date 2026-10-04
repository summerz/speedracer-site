import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/** One optional pass, with two small feathered exhaust masks in the driving view only. */
export function createExhaustHaze(drone: THREE.Group, camera: THREE.PerspectiveCamera) {
  const starts = [new THREE.Vector2(), new THREE.Vector2()];
  const ends = [new THREE.Vector2(), new THREE.Vector2()];
  const radii = new THREE.Vector2();
  const anchors = ['thrusterLeft', 'thrusterRight'].map((name) => drone.getObjectByName(name)!);
  const world = new THREE.Vector3(), projected = new THREE.Vector3(), viewPosition = new THREE.Vector3();
  let requested = false;
  const pass = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, starts: { value: starts }, ends: { value: ends },
      radii: { value: radii }, aspect: { value: 1 }, time: { value: 0 }, strength: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse; uniform vec2 starts[2]; uniform vec2 ends[2];
      uniform vec2 radii; uniform float aspect, time, strength; varying vec2 vUv;
      float plume(vec2 a, vec2 b, float radius) {
        if (radius <= 0.0) return 0.0;
        vec2 metric=vec2(aspect,1.0), p=vUv*metric, origin=a*metric, axis=(b-a)*metric;
        float t=clamp(dot(p-origin,axis)/max(dot(axis,axis),0.00001),0.0,1.0);
        float distance=length(p-origin-axis*t);
        return (1.0-smoothstep(radius*0.2,radius,distance))*sin(t*3.14159265);
      }
      void main(){
        float mask=max(plume(starts[0],ends[0],radii.x),plume(starts[1],ends[1],radii.y));
        // Broad moving ripples bend the track lines; fine ripples add heat shimmer.
        vec2 wave=vec2(sin(vUv.y*85.0-time*9.0)+0.45*sin(vUv.x*155.0+time*13.0),
          0.65*cos(vUv.x*75.0-time*7.0)+0.3*sin(vUv.y*190.0-time*17.0));
        vec2 displacement=wave*mask*strength/vec2(aspect,1.0);
        gl_FragColor=texture2D(tDiffuse,clamp(vUv+displacement,vec2(0.001),vec2(0.999)));
      }`,
  });
  // ShaderPass clones uniforms; bind the vectors that projection updates.
  pass.uniforms.starts.value = starts;
  pass.uniforms.ends.value = ends;
  pass.uniforms.radii.value = radii;
  pass.enabled = false;
  return {
    pass,
    setEnabled(value: boolean) { requested = value; if (!value) pass.enabled = false; },
    update(time: number, stage: number, active: boolean, cockpit: boolean, reducedMotion: boolean) {
      pass.enabled = requested && active && !cockpit && !reducedMotion;
      if (!pass.enabled) return;
      drone.updateWorldMatrix(true, true); camera.updateWorldMatrix(true, false);
      // The chase camera sits about 5.4 units behind the craft. Keep the mask in
      // the visible plume; following the full boost flame tip puts it behind us.
      const tailStart = stage === 2 ? .8 : stage === 1 ? .65 : .45;
      let visible = false;
      anchors.forEach((anchor, index) => {
        world.set(0, 0, tailStart); anchor.localToWorld(world);
        projected.copy(world).project(camera);
        starts[index].set(projected.x * .5 + .5, projected.y * .5 + .5);
        const depth = -viewPosition.copy(world).applyMatrix4(camera.matrixWorldInverse).z;
        world.set(0, 0, tailStart + 1.6); anchor.localToWorld(world); projected.copy(world).project(camera);
        ends[index].set(projected.x * .5 + .5, projected.y * .5 + .5);
        const endDepth = -world.applyMatrix4(camera.matrixWorldInverse).z;
        const inFront = depth > camera.near && endDepth > camera.near;
        const width = stage === 2 ? .78 : stage === 1 ? .65 : .52;
        radii.setComponent(index, inFront ? Math.min(.19, width / (depth * 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)))) : 0);
        visible ||= inFront;
      });
      pass.enabled = visible;
      pass.uniforms.aspect.value = camera.aspect;
      pass.uniforms.time.value = time;
      pass.uniforms.strength.value = stage === 2 ? .010 : stage === 1 ? .007 : .004;
    },
  };
}
