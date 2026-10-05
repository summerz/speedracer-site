import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createStormClock, createRaceWeather } from '../output/test/game/environment/createRaceWeather.js';
import { selectRainIntensity } from '../output/test/game/environment/raceEnvironment.js';

test('storm schedules 1–4 strikes per lap at every frame rate and delays each thunder', () => {
  for (const value of [0, .3, .6, .99]) for (const fps of [30, 60, 120]) {
    const clock = createStormClock(1000, () => value);
    const counts = [0, 0, 0]; let thunders = 0, strikes = 0;
    for (let i = 0; i < fps * 30; i++) {
      const distance = Math.min(2999, i / fps * 100);
      const frame = clock.update(distance, 1 / fps, true);
      counts[Math.floor(distance / 1000)] += frame.strikes;
      thunders += frame.thunders; strikes += frame.strikes;
      assert.ok(thunders <= strikes);
    }
    for (let i = 0; i < fps * 3; i++) thunders += clock.update(2999, 1 / fps, true).thunders;
    assert.deepEqual(counts, Array(3).fill(1 + Math.floor(value * 4)));
    assert.equal(thunders, strikes);
  }
});

test('thunder waits at least 0.8s, pause freezes it, reset cancels it, reduced motion softens flash', () => {
  const clock = createStormClock(1000, () => 0);
  const lightning = clock.update(300, .01, true);
  assert.equal(lightning.strikes, 1); assert.equal(lightning.thunders, 0); assert.equal(lightning.flash, 1);
  assert.equal(clock.update(300, .79, true).thunders, 0);
  assert.deepEqual(clock.update(300, 30, false), { flash: 0, thunders: 0, strikes: 0 });
  assert.equal(clock.update(300, .02, true).thunders, 1);
  clock.reset(); assert.equal(clock.update(300, .01, true, true).flash, .2);
  clock.reset(); assert.equal(clock.update(0, 3, true).thunders, 0);
});

test('rain reuses one world-oriented buffer, scales density by quality, and hides in overview', () => {
  const rain = createRaceWeather(true, 1000, () => 0, 'heavy');
  const drops = rain.object.getObjectByName('rain-drops');
  const array = drops.geometry.attributes.position.array;
  rain.setQuality('low'); assert.equal(drops.geometry.drawRange.count, 768);
  rain.update(new THREE.Vector3(10, 20, 30), 0, .1, true, false);
  const before = array.slice(0, 6);
  assert.deepEqual(rain.object.position.toArray(), [10, 20, 30]);
  rain.update(new THREE.Vector3(20, 40, 50), 0, .1, true, false);
  assert.equal(drops.geometry.attributes.position.array, array);
  assert.notDeepEqual(before, array.slice(0, 6));
  const paused = array.slice(0, 6);
  rain.update(new THREE.Vector3(), 0, .1, false, false);
  assert.deepEqual(paused, array.slice(0, 6));
  rain.setQuality('high'); assert.equal(drops.geometry.drawRange.count, 2560);
  assert.ok(array.every(Number.isFinite));
  rain.setOverview(true); assert.equal(rain.object.visible, false);
  rain.setOverview(false); assert.equal(rain.object.visible, true);
  drops.geometry.dispose(); drops.material.dispose();
  const clear = createRaceWeather(false, 1000);
  clear.setOverview(false); assert.equal(clear.object.visible, false);
  assert.equal(clear.update(new THREE.Vector3(), 300, 1, true, false).strikes, 0);
  clear.object.children[0].geometry.dispose(); clear.object.children[0].material.dispose();
});

test('rain selects three stable densities, respects quality caps, and falls faster while running', () => {
  assert.deepEqual([0, .34, .67].map(value => selectRainIntensity(() => value)), ['light', 'moderate', 'heavy']);
  for (const value of [-1, NaN, 1, 2]) assert.ok(['light', 'moderate', 'heavy'].includes(selectRainIntensity(() => value)));
  const counts = [];
  for (const intensity of ['light', 'moderate', 'heavy']) {
    const rain = createRaceWeather(true, 1000, () => 0, intensity);
    const drops = rain.object.children[0];
    counts.push(drops.geometry.drawRange.count);
    rain.update(new THREE.Vector3(), 0, 0, true, false);
    const y = drops.geometry.attributes.position.array[1];
    rain.update(new THREE.Vector3(), 0, .1, true, false);
    const nextY = drops.geometry.attributes.position.array[1];
    assert.ok(Math.abs(((y - nextY + 64) % 64) - 10) < .00001);
    rain.setQuality('high'); assert.ok(drops.geometry.drawRange.count <= 2560);
    rain.reset(); assert.equal(rain.intensity, intensity);
    drops.geometry.dispose(); drops.material.dispose();
  }
  assert.ok(counts[0] < counts[1] && counts[1] < counts[2]);
});
