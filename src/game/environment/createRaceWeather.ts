import * as THREE from 'three';
import type { RenderQuality } from '../../platform/renderQuality.js';
import { RAIN_INTENSITIES, selectRainIntensity, type RainIntensity } from './raceEnvironment.js';

/** Lap-distance scheduling guarantees 1–4 strikes, independent of pace or frame rate. */
export function createStormClock(length: number, random: () => number = Math.random) {
  if (!Number.isFinite(length) || length <= 0) throw new RangeError('Invalid storm lap');
  const unit = () => { const n = random(); return Number.isFinite(n) ? THREE.MathUtils.clamp(n, 0, .999999) : 0; };
  let lap = -1, strikes: number[] = [], next = 0, clock = 0, flashAge = 100;
  const thunder: number[] = [];
  const schedule = (index: number) => {
    lap = index; next = 0;
    const count = 1 + Math.floor(unit() * 4);
    strikes = Array.from({ length: count }, (_, i) => (index + .1 + .8 * (i + .15 + unit() * .7) / count) * length);
  };
  return {
    reset() { lap = -1; strikes = []; next = 0; clock = 0; flashAge = 100; thunder.length = 0; },
    update(distance: number, delta: number, active: boolean, reducedMotion = false) {
      if (!active) return { flash: 0, thunders: 0, strikes: 0 };
      const dt = Math.max(0, Number.isFinite(delta) ? delta : 0);
      clock += dt; flashAge += dt;
      const currentLap = Math.max(0, Math.floor(distance / length));
      let fired = 0;
      if (lap < 0) schedule(0);
      while (lap <= currentLap) {
        while (next < strikes.length && distance >= strikes[next]) {
          next++; fired++; flashAge = 0; thunder.push(clock + .8 + unit() * 1.6);
        }
        if (lap === currentLap) break;
        schedule(lap + 1);
      }
      let thunders = 0;
      for (let i = thunder.length - 1; i >= 0; i--) if (thunder[i] <= clock) { thunder.splice(i, 1); thunders++; }
      const flash = flashAge < .55 ? Math.exp(-flashAge * 8) * (reducedMotion ? .2 : 1) : 0;
      return { flash, thunders, strikes: fired };
    },
  };
}

const DROP_COUNTS: Record<RenderQuality, number> = { low: 384, balanced: 768, high: 1280 };
/** One reusable line buffer; no sprites, textures or additional postprocessing pass. */
export function createRaceWeather(rain: boolean, length: number, random: () => number = Math.random, intensity: RainIntensity = selectRainIntensity(random)) {
  const object = new THREE.Group(); object.name = 'race-weather'; object.visible = rain;
  const positions = new Float32Array(DROP_COUNTS.high * 6);
  const seeds = Array.from({ length: DROP_COUNTS.high }, () => [Math.random() * 100 - 50, Math.random() * 64 - 32, Math.random() * 100 - 50]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  const density = RAIN_INTENSITIES[intensity].density;
  const material = new THREE.LineBasicMaterial({ color: 0x95bddd, transparent: true, opacity: .48, depthWrite: false, toneMapped: false });
  const drops = new THREE.LineSegments(geometry, material); drops.name = 'rain-drops'; drops.frustumCulled = false; object.add(drops);
  const storm = createStormClock(length, random);
  let elapsed = 0, count = Math.round(DROP_COUNTS.balanced * density);
  geometry.setDrawRange(0, count * 2);
  const wrap = (value: number, size: number) => ((value % size) + size) % size - size / 2;
  return {
    object,
    intensity,
    reset() { elapsed = 0; storm.reset(); },
    setQuality(quality: RenderQuality) { count = Math.round(DROP_COUNTS[quality] * density); geometry.setDrawRange(0, count * 2); },
    update(camera: THREE.Vector3, distance: number, delta: number, active: boolean, reducedMotion: boolean) {
      object.position.copy(camera);
      if (!rain) return { flash: 0, thunders: 0, strikes: 0 };
      if (active) elapsed += delta;
      for (let i = 0; i < count; i++) {
        const [x, y, z] = seeds[i]; const index = i * 6;
        positions[index] = wrap(x - elapsed * 10, 100); positions[index + 1] = wrap(y - elapsed * 100, 64); positions[index + 2] = z;
        positions[index + 3] = positions[index] + .35; positions[index + 4] = positions[index + 1] + 3.4; positions[index + 5] = z;
      }
      geometry.attributes.position.needsUpdate = true;
      return storm.update(distance, delta, active, reducedMotion);
    },
    setOverview(value: boolean) { object.visible = rain && !value; },
  };
}
