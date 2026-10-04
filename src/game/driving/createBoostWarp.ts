import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/** One peripheral pass; the center and HTML HUD retain their original image. */
export function createBoostWarp(maxStrength: number) {
  const pass = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, strength: { value: 0 }, aspect: { value: 1 } },
    vertexShader: `varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D tDiffuse; uniform float strength; uniform float aspect; varying vec2 vUv;
      vec4 sampleAt(vec2 uv) { return texture2D(tDiffuse, clamp(uv, vec2(0.001), vec2(0.999))); }
      void main() {
        vec2 center = vec2(0.5, 0.52);
        vec2 ray = vUv - center;
        float edge = pow(smoothstep(0.24, 0.72, length(ray * vec2(min(aspect, 1.7), 1.0))), 1.3);
        float amount = strength * edge;
        if (amount < 0.001) { gl_FragColor = sampleAt(vUv); return; }
        vec2 warped = center + ray * (1.0 - amount * 0.15);
        vec2 trail = ray * amount * 0.14;
        vec4 color = sampleAt(warped) * 0.4;
        color += sampleAt(warped - trail * 0.25) * 0.24;
        color += sampleAt(warped - trail * 0.5) * 0.18;
        color += sampleAt(warped - trail * 0.75) * 0.12;
        color += sampleAt(warped - trail) * 0.06;
        vec2 split = ray * amount * 0.008;
        color.r = mix(color.r, sampleAt(warped + split).r, amount * 0.45);
        color.b = mix(color.b, sampleAt(warped - split).b, amount * 0.45);
        gl_FragColor = color;
      }`,
  });
  pass.enabled = false;
  let strength = 0;
  return {
    pass,
    setSize(width: number, height: number) { pass.uniforms.aspect.value = width / height; },
    reset() { strength = 0; pass.uniforms.strength.value = 0; pass.enabled = false; },
    update(delta: number, stage2: boolean, entry: number, reducedMotion: boolean) {
      if (reducedMotion) { this.reset(); return; }
      const target = stage2 ? Math.min(1, maxStrength * (1 + entry * 0.45)) : 0;
      strength += (target - strength) * (1 - Math.exp(-delta * (stage2 ? 16 : 12)));
      pass.uniforms.strength.value = strength;
      pass.enabled = strength > 0.001;
    },
  };
}
