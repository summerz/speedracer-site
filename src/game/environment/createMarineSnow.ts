import * as THREE from 'three';
import type { RenderQuality } from '../../platform/renderQuality.js';

const COUNTS: Record<RenderQuality, number> = { low: 240, balanced: 480, high: 800 };
const BOX = 90, HEIGHT = 50;

/** Drifting soft dots wrapped in a box around the camera. One Points draw, CPU-updated positions. */
export function createMarineSnow(seed = 7) {
  const object = new THREE.Group(); object.name = 'marine-snow';
  let s = seed >>> 0;
  const random = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const max = COUNTS.high;
  const base = Array.from({ length: max }, () => ({
    x: random() * BOX, y: random() * HEIGHT, z: random() * BOX,
    vx: (random() - .5) * 1.6, vy: .3 + random() * .9, vz: (random() - .5) * 1.6, phase: random() * 6.28, wob: .3 + random() * .9,
  }));
  const positions = new Float32Array(max * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  const material = new THREE.PointsMaterial({ color: '#bfeff0', size: .7, sizeAttenuation: true, transparent: true, opacity: .5, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false, map: dotTexture() });
  const points = new THREE.Points(geometry, material); points.frustumCulled = false; object.add(points);
  const wrap = (v: number, size: number) => ((v % size) + size) % size;
  geometry.setDrawRange(0, COUNTS.balanced);
  return {
    object,
    update(cameraPos: THREE.Vector3, time = 0, reducedMotion = false) {
      const t = reducedMotion ? 0 : time;
      for (let i = 0; i < max; i++) {
        const p = base[i];
        // Particle is placed in a camera-centred box: offset = wrap(seed + drift - camera).
        const x = p.x + p.vx * t + Math.sin(t * p.wob + p.phase) * .8, y = p.y + p.vy * t, z = p.z + p.vz * t + Math.cos(t * p.wob + p.phase) * .8;
        positions[i * 3] = cameraPos.x + wrap(x - cameraPos.x + BOX / 2, BOX) - BOX / 2;
        positions[i * 3 + 1] = cameraPos.y + wrap(y - cameraPos.y + HEIGHT / 2, HEIGHT) - HEIGHT / 2;
        positions[i * 3 + 2] = cameraPos.z + wrap(z - cameraPos.z + BOX / 2, BOX) - BOX / 2;
      }
      geometry.attributes.position.needsUpdate = true;
    },
    setQuality(quality: RenderQuality) { geometry.setDrawRange(0, COUNTS[quality]); },
    setOverview(value: boolean) { object.visible = !value; },
    dispose() { geometry.dispose(); material.map?.dispose(); material.dispose(); },
  };
}

function dotTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(.4, 'rgba(255,255,255,.5)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 32, 32);
  }
  return new THREE.CanvasTexture(c);
}
