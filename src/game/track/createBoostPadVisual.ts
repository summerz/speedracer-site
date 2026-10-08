import * as THREE from 'three';
import { createTrackFrame, type Track } from './createTrack.js';

const PLATE_LENGTH = 18, GATE_HEIGHT = 5.2, SCROLL_SPEED = 9;

/** One shared "BOOST ▲" label texture; null where no canvas exists (node tests). */
function createLabelTexture() {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 112;
  const ctx = canvas.getContext('2d'); if (!ctx) return null;
  ctx.fillStyle = '#021a1c'; ctx.fillRect(0, 0, 512, 112);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '800 78px "Barlow Condensed", "Arial Narrow", sans-serif';
  ctx.fillStyle = '#7dfff0'; ctx.shadowColor = '#00ffe0'; ctx.shadowBlur = 14; ctx.fillText('BOOST ▲', 256, 58);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture;
}

/**
 * A "boost gate" for every pad: a glowing road plate with scrolling forward chevrons, a pulsing gate frame
 * (two posts and a top bar) with a BOOST label, readable from far away. One instanced mesh each, shared geometry
 * and materials. Local frame: x = lateral, y = up, -z = forward. `hit` flashes the gate and pulses its scale.
 */
export function createBoostPadVisual(track: Track) {
  const pads = track.boostPads ?? [], object = new THREE.Group(); object.name = 'boost-pads';
  const width = pads[0]?.width ?? track.halfWidth * .5, half = width / 2, count = Math.max(1, pads.length);
  const flash = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);

  // Road plate: full pad width, glowing panel with border and forward chevrons drawn in the shader.
  const plateGeometry = new THREE.PlaneGeometry(width, PLATE_LENGTH).rotateX(-Math.PI / 2).translate(0, .16, 0);
  plateGeometry.setAttribute('flash', flash);
  const plateMaterial = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    uniforms: { time: { value: 0 }, size: { value: new THREE.Vector2(width, PLATE_LENGTH) } },
    vertexShader: `attribute float flash; varying float f; varying vec3 p;
      void main(){f=flash;p=position;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}`,
    fragmentShader: `uniform float time; uniform vec2 size; varying float f; varying vec3 p;
      void main(){
        float edge=min(size.x*.5-abs(p.x),size.y*.5-abs(p.z));
        float border=1.-smoothstep(.2,.6,edge);
        float q=-p.z+abs(p.x)*.8-time*${SCROLL_SPEED.toFixed(1)};
        float ph=fract(q/6.);
        float chev=smoothstep(0.,.06,ph)*(1.-smoothstep(.3,.38,ph))*smoothstep(0.,1.4,edge);
        vec3 col=vec3(.02,.55,.55)*.7+vec3(.35,2.4,2.2)*chev+vec3(1.4,2.6,2.6)*border;
        col=mix(col,vec3(3.),f*.75);
        gl_FragColor=vec4(col,.8+f*.2);
      }` });
  const plate = new THREE.InstancedMesh(plateGeometry, plateMaterial, count); plate.count = pads.length; plate.frustumCulled = false;

  // Gate frame: two posts and a top bar, merged into one geometry; label plane sits on the bar's front face.
  const box = (w: number, h: number, d: number, x: number, y: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, 0).toNonIndexed();
  const parts = [box(.45, GATE_HEIGHT, .45, -half - .3, GATE_HEIGHT / 2), box(.45, GATE_HEIGHT, .45, half + .3, GATE_HEIGHT / 2), box(width + 1.05, 1.1, .5, 0, GATE_HEIGHT - .55)];
  const frameGeometry = new THREE.BufferGeometry(); frameGeometry.setAttribute('position', new THREE.Float32BufferAttribute(parts.flatMap(g => [...g.getAttribute('position').array]), 3));
  parts.forEach(g => g.dispose());
  frameGeometry.setAttribute('flash', flash);
  const frameMaterial = new THREE.ShaderMaterial({ toneMapped: false, uniforms: { pulse: { value: 0 } },
    vertexShader: `attribute float flash; varying float f; void main(){f=flash;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}`,
    fragmentShader: `uniform float pulse; varying float f;
      void main(){vec3 col=vec3(.1,1.5,1.4)*(1.+pulse*.5);col=mix(col,vec3(3.),f*.8);gl_FragColor=vec4(col,1.);}` });
  const frame = new THREE.InstancedMesh(frameGeometry, frameMaterial, count); frame.count = pads.length; frame.frustumCulled = false;

  const texture = createLabelTexture();
  const labelGeometry = new THREE.PlaneGeometry(Math.min(width, 5.2), 1).translate(0, GATE_HEIGHT - .55, .28);
  const labelMaterial = new THREE.MeshBasicMaterial({ map: texture, color: texture ? 0xffffff : 0x22ffee, toneMapped: false });
  labelMaterial.color.multiplyScalar(1.4);
  const label = new THREE.InstancedMesh(labelGeometry, labelMaterial, count); label.count = pads.length; label.frustumCulled = false;

  const placement = createTrackFrame(), z = new THREE.Vector3();
  const bases = pads.map(pad => {
    track.sample(pad.distance, placement, pad.routeId);
    z.crossVectors(placement.right, placement.up);
    return new THREE.Matrix4().makeBasis(placement.right, placement.up, z)
      .setPosition(placement.position.clone().addScaledVector(placement.right, pad.center));
  });
  bases.forEach((base, i) => { plate.setMatrixAt(i, base); frame.setMatrixAt(i, base); label.setMatrixAt(i, base); });
  const scaled = new THREE.Matrix4(), grow = new THREE.Matrix4();
  object.add(plate, frame, label);

  const hits = pads.map(() => -Infinity);
  let lastTime = 0;
  return {
    object,
    /** Flashes the pad nearest `distance` on the craft's route. */
    hit(distance: number, routeId?: string | null) {
      let best = -1, nearest = 20;
      pads.forEach((pad, i) => {
        if (pad.routeId && pad.routeId !== routeId) return;
        const gap = Math.abs(((distance - pad.distance) % track.length + track.length * 1.5) % track.length - track.length / 2);
        if (gap < nearest) { nearest = gap; best = i; }
      });
      if (best >= 0) hits[best] = lastTime;
    },
    update(time: number, reducedMotion: boolean) {
      if (time < lastTime) hits.fill(-Infinity);
      lastTime = time;
      plateMaterial.uniforms.time.value = reducedMotion ? 0 : time;
      frameMaterial.uniforms.pulse.value = reducedMotion ? 0 : .5 + .5 * Math.sin(time * 5);
      hits.forEach((hit, i) => {
        const f = Math.exp(-(time - hit) * 6), s = reducedMotion ? 1 : 1 + .22 * f;
        flash.setX(i, f);
        scaled.copy(bases[i]).multiply(grow.makeScale(s, s, 1)); frame.setMatrixAt(i, scaled); label.setMatrixAt(i, scaled);
      });
      flash.needsUpdate = true; frame.instanceMatrix.needsUpdate = true; label.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      object.removeFromParent(); plate.dispose(); frame.dispose(); label.dispose();
      plateGeometry.dispose(); frameGeometry.dispose(); labelGeometry.dispose();
      plateMaterial.dispose(); frameMaterial.dispose(); labelMaterial.dispose(); texture?.dispose();
    },
  };
}
